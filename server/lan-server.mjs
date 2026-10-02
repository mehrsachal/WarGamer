#!/usr/bin/env node
// Optional classroom server for WarGamer — zero dependencies, no internet needed.
// Serves dist/WarGamer.html and a tiny JSON store so every PC on the LAN shares one
// database (classes, students, scenarios, exercises, attempts).
//   node server/lan-server.mjs [--port 8080] [--data ./server/data]
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, mkdirSync, existsSync, renameSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { networkInterfaces } from 'node:os';

const here = dirname(fileURLToPath(import.meta.url));
const arg = (k, d) => {
  const i = process.argv.indexOf(k);
  return i > 0 ? process.argv[i + 1] : d;
};
const PORT = Number(arg('--port', process.env.PORT ?? 8080));
const DATA = resolve(arg('--data', join(here, 'data')));
const HTML = resolve(join(here, '..', 'dist', 'WarGamer.html'));
const STORES = new Set(['settings', 'classes', 'students', 'scenarios', 'exercises', 'attempts']);

mkdirSync(DATA, { recursive: true });
const file = join(DATA, 'db.json');
let db = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
for (const s of STORES) db[s] ??= {};
let saveTimer = null;
const save = () => {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    writeFileSync(file + '.tmp', JSON.stringify(db));
    renameSync(file + '.tmp', file);
  }, 200);
};

const send = (res, code, body, type = 'application/json') => {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(type === 'application/json' ? JSON.stringify(body) : body);
};

createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
  if (parts[0] !== 'api') {
    if (!existsSync(HTML)) return send(res, 500, 'dist/WarGamer.html missing — run "npm run build" first.', 'text/plain');
    return send(res, 200, readFileSync(HTML), 'text/html; charset=utf-8');
  }
  if (parts[1] === 'ping') return send(res, 200, { wargamer: true, stores: [...STORES] });
  const store = parts[1];
  if (!STORES.has(store)) return send(res, 404, { error: 'unknown store' });
  const id = parts[2];
  if (req.method === 'GET') {
    if (!id) return send(res, 200, Object.values(db[store]));
    return db[store][id] ? send(res, 200, db[store][id]) : send(res, 404, { error: 'not found' });
  }
  if (req.method === 'PUT' && id) {
    let body = '';
    req.on('data', (c) => {
      body += c;
      if (body.length > 50e6) req.destroy();
    });
    req.on('end', () => {
      try {
        const obj = JSON.parse(body);
        db[store][id] = obj;
        save();
        send(res, 200, { ok: true });
      } catch {
        send(res, 400, { error: 'bad json' });
      }
    });
    return;
  }
  if (req.method === 'DELETE' && id) {
    delete db[store][id];
    save();
    return send(res, 200, { ok: true });
  }
  send(res, 405, { error: 'method' });
}).listen(PORT, () => {
  const ips = Object.values(networkInterfaces()).flat().filter((n) => n && n.family === 'IPv4' && !n.internal).map((n) => n.address);
  console.log(`WarGamer LAN server on port ${PORT}`);
  console.log(`  Instructor: http://localhost:${PORT}`);
  for (const ip of ips) console.log(`  Students:   http://${ip}:${PORT}`);
  console.log(`  Data file:  ${file}`);
});

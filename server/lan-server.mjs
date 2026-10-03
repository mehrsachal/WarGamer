#!/usr/bin/env node
// Optional classroom server for WarGamer — zero dependencies, no internet needed.
// Serves dist/WarGamer.html (+ its PWA files) and a tiny JSON store so every PC on the LAN
// shares one database (classes, students, scenarios, exercises, attempts).
//   node server/lan-server.mjs [--port 8080] [--data ./server/data]
// The desktop app runs the same server in-process (Classroom → Host classroom on LAN…).
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import core from './lan-core.cjs';

const here = dirname(fileURLToPath(import.meta.url));
const arg = (k, d) => {
  const i = process.argv.indexOf(k);
  return i > 0 ? process.argv[i + 1] : d;
};
const PORT = Number(arg('--port', process.env.PORT ?? 8080));
const DATA = resolve(arg('--data', join(here, 'data')));
const DIST = resolve(join(here, '..', 'dist'));

const srv = core.createLanServer({ port: PORT, dataDir: DATA, distDir: DIST, log: console.log });
try {
  await srv.start();
} catch (e) {
  console.error(e.code === 'EADDRINUSE' ? `Port ${PORT} is already in use — try: node server/lan-server.mjs --port ${PORT + 1}` : `Could not start the server: ${e.message}`);
  process.exit(1);
}
console.log(`WarGamer LAN server on port ${srv.port}`);
console.log(`  Instructor: http://localhost:${srv.port}`);
for (const u of srv.urls().slice(1)) console.log(`  Students:   ${u}`);
console.log(`  Data file:  ${srv.dataFile}`);

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    srv.flush();
    process.exit(0);
  });
}

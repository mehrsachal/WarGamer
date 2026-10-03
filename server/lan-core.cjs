// WarGamer classroom server core — zero dependencies, no internet needed.
// Serves the single-file app (dist/WarGamer.html), its PWA files (manifest, service worker,
// icons) and a tiny JSON store so every PC on the LAN shares one database.
// Used by the CLI (server/lan-server.mjs) and in-process by the desktop app (electron/main.cjs).
'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const STORES = ['settings', 'classes', 'students', 'scenarios', 'exercises', 'attempts'];
const MAX_BODY = 50e6;

/** Static files (besides the app page) that may be served from the dist folder. */
const ASSET_RE = /^\/(manifest\.webmanifest|sw\.js|icons\/[A-Za-z0-9_.-]+\.(?:png|svg))$/;
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
};

/** Non-internal IPv4 addresses of this machine (what students type in). */
function lanAddresses() {
  return Object.values(os.networkInterfaces())
    .flat()
    .filter((n) => n && (n.family === 'IPv4' || n.family === 4) && !n.internal)
    .map((n) => n.address);
}

function loadDb(file, log) {
  let db = {};
  if (fs.existsSync(file)) {
    try {
      db = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (!db || typeof db !== 'object' || Array.isArray(db)) throw new Error('not an object');
    } catch (e) {
      // Keep the damaged file for recovery and start with an empty store rather than refusing to run.
      const keep = `${file}.corrupt-${Date.now()}`;
      fs.renameSync(file, keep);
      log(`  WARNING: ${path.basename(file)} could not be read (${e.message}); kept as ${keep}`);
      db = {};
    }
  }
  for (const s of STORES) if (!db[s] || typeof db[s] !== 'object') db[s] = {};
  return db;
}

/**
 * Create (but do not start) a classroom server.
 * @param {object} o
 * @param {number} [o.port=8080]      first port to try
 * @param {number} [o.portRetries=0]  on EADDRINUSE try the next N ports
 * @param {string} [o.host]           listen address (default: all interfaces)
 * @param {string} o.dataDir          folder holding db.json
 * @param {string} o.distDir          folder holding WarGamer.html (+ PWA files)
 * @param {(msg: string) => void} [o.log]
 */
function createLanServer(o) {
  const log = o.log ?? (() => {});
  const dataDir = path.resolve(o.dataDir);
  const distDir = path.resolve(o.distDir);
  const htmlFile = path.join(distDir, 'WarGamer.html');
  fs.mkdirSync(dataDir, { recursive: true });
  const file = path.join(dataDir, 'db.json');
  const db = loadDb(file, log);

  let saveTimer = null;
  const writeNow = () => {
    clearTimeout(saveTimer);
    saveTimer = null;
    fs.writeFileSync(file + '.tmp', JSON.stringify(db));
    fs.renameSync(file + '.tmp', file);
  };
  const save = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(writeNow, 200);
  };
  const flush = () => {
    if (saveTimer) writeNow();
  };

  const send = (res, code, body, type = 'application/json', cache = 'no-store') => {
    res.writeHead(code, { 'Content-Type': type, 'Cache-Control': cache, 'X-Content-Type-Options': 'nosniff' });
    res.end(type === 'application/json' ? JSON.stringify(body) : body);
  };

  const sendFile = (req, res, f) => {
    let buf;
    try {
      buf = fs.readFileSync(f);
    } catch {
      return send(res, 404, 'Not found', 'text/plain');
    }
    // no-cache: always revalidate; offline use is handled by the service worker.
    res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] ?? 'application/octet-stream', 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff', 'Content-Length': buf.length });
    res.end(req.method === 'HEAD' ? undefined : buf);
  };

  const handler = (req, res) => {
    let url;
    try {
      url = new URL(req.url, 'http://x');
    } catch {
      return send(res, 400, { error: 'bad url' });
    }
    let parts;
    try {
      parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
    } catch {
      return send(res, 400, { error: 'bad url' });
    }
    if (parts[0] !== 'api') {
      if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { error: 'method' });
      const asset = ASSET_RE.exec(url.pathname);
      if (asset) return sendFile(req, res, path.join(distDir, ...asset[1].split('/')));
      // Every other path is the app itself (single page).
      if (!fs.existsSync(htmlFile)) return send(res, 500, 'dist/WarGamer.html missing — run "npm run build" first.', 'text/plain');
      return sendFile(req, res, htmlFile);
    }
    if (parts[1] === 'ping') return send(res, 200, { wargamer: true, stores: STORES });
    const store = parts[1];
    if (!STORES.includes(store)) return send(res, 404, { error: 'unknown store' });
    const id = parts[2];
    if (req.method === 'GET') {
      if (!id) return send(res, 200, Object.values(db[store]));
      return Object.prototype.hasOwnProperty.call(db[store], id) ? send(res, 200, db[store][id]) : send(res, 404, { error: 'not found' });
    }
    if (req.method === 'PUT' && id) {
      let body = '';
      let tooBig = false;
      req.on('data', (c) => {
        body += c;
        if (body.length > MAX_BODY) {
          tooBig = true;
          req.destroy();
        }
      });
      req.on('end', () => {
        if (tooBig) return;
        try {
          db[store][id] = JSON.parse(body);
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
  };

  const server = http.createServer(handler);
  let port = null;

  const listenOn = (p) =>
    new Promise((resolve, reject) => {
      const onErr = (e) => {
        server.off('listening', onOk);
        reject(e);
      };
      const onOk = () => {
        server.off('error', onErr);
        resolve(server.address().port);
      };
      server.once('error', onErr);
      server.once('listening', onOk);
      server.listen(p, o.host);
    });

  return {
    STORES,
    dataFile: file,
    server,
    get port() {
      return port;
    },
    /** Start listening. Resolves with the port actually used. */
    async start() {
      const first = o.port ?? 8080;
      const retries = first === 0 ? 0 : (o.portRetries ?? 0);
      for (let i = 0; ; i++) {
        try {
          port = await listenOn(first + i);
          return port;
        } catch (e) {
          if (e.code !== 'EADDRINUSE' || i >= retries) throw e;
        }
      }
    },
    /** Addresses students can open, the local one first. */
    urls() {
      if (port == null) return [];
      return [`http://localhost:${port}`, ...lanAddresses().map((ip) => `http://${ip}:${port}`)];
    },
    /**
     * Add records the server does not have yet (by id); existing records are never overwritten.
     * Used by the desktop app to carry the instructor's local data into the classroom database.
     */
    importMissing(data) {
      const counts = {};
      for (const s of STORES) {
        const rows = data && Array.isArray(data[s]) ? data[s] : [];
        let n = 0;
        for (const r of rows) {
          if (!r || typeof r.id !== 'string' || Object.prototype.hasOwnProperty.call(db[s], r.id)) continue;
          db[s][r.id] = r;
          n++;
        }
        if (n) counts[s] = n;
      }
      if (Object.keys(counts).length) save();
      return counts;
    },
    /** Number of records per store. */
    counts() {
      return Object.fromEntries(STORES.map((s) => [s, Object.keys(db[s]).length]));
    },
    flush,
    /** Stop listening and write any pending changes. */
    stop() {
      return new Promise((resolve) => {
        flush();
        if (!server.listening) return resolve();
        server.close(() => resolve());
        server.closeAllConnections?.();
      });
    },
  };
}

module.exports = { createLanServer, lanAddresses, STORES, ASSET_RE, MIME };

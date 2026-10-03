// Desktop app / PWA / LAN classroom server tests.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { PWA_ICONS, cacheName, manifest, serviceWorker } from '../scripts/pwa.mjs';

// The CommonJS modules are loaded at run time (as the desktop app does), not bundled.
const load = createRequire(resolve('package.json'));
const { createLanServer } = load(resolve('server/lan-core.cjs')) as typeof import('../server/lan-core.cjs');
const { markdownToHtml, guidePage } = load(resolve('electron/markdown.cjs')) as typeof import('../electron/markdown.cjs');

const HTML = '<!doctype html><html><body>WarGamer test page</body></html>';

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'wg-lan-'));
  const dist = join(root, 'dist');
  mkdirSync(join(dist, 'icons'), { recursive: true });
  writeFileSync(join(dist, 'WarGamer.html'), HTML);
  writeFileSync(join(dist, 'manifest.webmanifest'), JSON.stringify(manifest('9.9.9')));
  writeFileSync(join(dist, 'sw.js'), serviceWorker('wargamer-test'));
  writeFileSync(join(dist, 'icons', 'icon-192.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  writeFileSync(join(root, 'secret.txt'), 'do not serve');
  return { root, dist, data: join(root, 'data'), done: () => rmSync(root, { recursive: true, force: true }) };
}

test('LAN server: serves the app, PWA files with correct MIME types, and nothing outside dist', async () => {
  const f = fixture();
  const srv = createLanServer({ port: 0, dataDir: f.data, distDir: f.dist });
  const port = await srv.start();
  const base = `http://127.0.0.1:${port}`;
  try {
    for (const p of ['/', '/index.html', '/WarGamer.html', '/some/deep/route']) {
      const r = await fetch(base + p);
      assert.equal(r.status, 200, p);
      assert.match(r.headers.get('content-type') ?? '', /^text\/html/);
      assert.equal(await r.text(), HTML);
    }
    const m = await fetch(`${base}/manifest.webmanifest`);
    assert.equal(m.status, 200);
    assert.match(m.headers.get('content-type') ?? '', /^application\/manifest\+json/);
    assert.equal((await m.json()).short_name, 'WarGamer');
    const sw = await fetch(`${base}/sw.js`);
    assert.match(sw.headers.get('content-type') ?? '', /^text\/javascript/);
    assert.match(await sw.text(), /wargamer-test/);
    const icon = await fetch(`${base}/icons/icon-192.png`);
    assert.equal(icon.headers.get('content-type'), 'image/png');
    assert.equal((await fetch(`${base}/icons/missing.png`)).status, 404);
    // Traversal attempts never reach files outside dist (they fall back to the app page).
    for (const p of ['/icons/..%2F..%2Fsecret.txt', '/..%2Fsecret.txt', '/icons/%2e%2e/%2e%2e/secret.txt']) {
      const r = await fetch(base + p);
      assert.notEqual(await r.text(), 'do not serve', p);
    }
    assert.equal((await fetch(`${base}/`, { method: 'POST' })).status, 405);
  } finally {
    await srv.stop();
    f.done();
  }
});

test('LAN server: JSON store round trip persists to db.json; importMissing never overwrites', async () => {
  const f = fixture();
  let srv = createLanServer({ port: 0, dataDir: f.data, distDir: f.dist });
  let base = `http://127.0.0.1:${await srv.start()}`;
  try {
    assert.deepEqual(await (await fetch(`${base}/api/ping`)).json(), { wargamer: true, stores: ['settings', 'classes', 'students', 'scenarios', 'exercises', 'attempts'] });
    const put = await fetch(`${base}/api/classes/c1`, { method: 'PUT', body: JSON.stringify({ id: 'c1', name: 'BIC-49' }) });
    assert.deepEqual(await put.json(), { ok: true });
    assert.equal((await fetch(`${base}/api/classes/c1`)).status, 200);
    assert.equal((await fetch(`${base}/api/classes/nope`)).status, 404);
    assert.equal((await fetch(`${base}/api/classes/toString`)).status, 404);
    assert.equal((await fetch(`${base}/api/bogus`)).status, 404);
    assert.equal((await fetch(`${base}/api/classes/c2`, { method: 'PUT', body: '{bad' })).status, 400);
    const counts = srv.importMissing({ classes: [{ id: 'c1', name: 'LOCAL COPY' } as never, { id: 'c3', name: 'New' } as never], bogus: [{ id: 'x' }] });
    assert.deepEqual(counts, { classes: 1 });
    const all = (await (await fetch(`${base}/api/classes`)).json()) as { id: string; name: string }[];
    assert.equal(all.find((c) => c.id === 'c1')?.name, 'BIC-49', 'existing record kept');
    assert.ok(all.some((c) => c.id === 'c3'));
    await fetch(`${base}/api/classes/c3`, { method: 'DELETE' });
    await srv.stop(); // flushes pending writes
    const disk = JSON.parse(readFileSync(join(f.data, 'db.json'), 'utf8'));
    assert.deepEqual(Object.keys(disk.classes), ['c1']);
    // A restart reads the same database.
    srv = createLanServer({ port: 0, dataDir: f.data, distDir: f.dist });
    base = `http://127.0.0.1:${await srv.start()}`;
    assert.equal(((await (await fetch(`${base}/api/classes/c1`)).json()) as { name: string }).name, 'BIC-49');
  } finally {
    await srv.stop();
    f.done();
  }
});

test('LAN server: a corrupt db.json is set aside instead of crashing; busy ports are skipped', async () => {
  const f = fixture();
  mkdirSync(f.data, { recursive: true });
  writeFileSync(join(f.data, 'db.json'), '{"classes": {');
  const logs: string[] = [];
  const srv = createLanServer({ port: 0, dataDir: f.data, distDir: f.dist, log: (m) => logs.push(m) });
  assert.deepEqual(srv.counts(), { settings: 0, classes: 0, students: 0, scenarios: 0, exercises: 0, attempts: 0 });
  assert.ok(readdirSync(f.data).some((n) => n.startsWith('db.json.corrupt-')));
  assert.match(logs.join('\n'), /could not be read/);
  // Occupy a port, then ask for it with retries: the next free one is used.
  const blocker = createServer();
  const busy: number = await new Promise((res) => blocker.listen(0, () => res((blocker.address() as { port: number }).port)));
  const srv2 = createLanServer({ port: busy, portRetries: 5, dataDir: f.data, distDir: f.dist });
  try {
    const got = await srv2.start();
    assert.notEqual(got, busy);
    assert.ok(got > busy && got <= busy + 5);
    assert.ok(srv2.urls()[0].endsWith(`:${got}`));
  } finally {
    await srv2.stop();
    blocker.close();
    f.done();
  }
});

test('PWA: manifest is installable and the cache name follows version and page content', () => {
  const m = manifest('1.2.3');
  assert.equal(m.display, 'standalone');
  assert.equal(m.start_url, './');
  assert.ok(m.icons.some((i) => i.sizes === '192x192') && m.icons.some((i) => i.sizes === '512x512'));
  assert.ok(m.icons.some((i) => i.purpose === 'maskable'));
  assert.equal(PWA_ICONS.length, 3);
  const a = cacheName('1.2.3', 'page A');
  assert.match(a, /^wargamer-v1\.2\.3-[0-9a-f]{10}$/);
  assert.equal(a, cacheName('1.2.3', 'page A'));
  assert.notEqual(a, cacheName('1.2.3', 'page B'));
  assert.notEqual(a, cacheName('1.2.4', 'page A'));
});

/** Run the generated service worker against in-memory fakes of the SW globals. */
async function runServiceWorker(scope: string, network: (url: string) => Response | Promise<Response>) {
  const handlers: Record<string, (e: unknown) => void> = {};
  const store = new Map<string, Map<string, Response>>();
  const key = (r: string | Request | URL) => (typeof r === 'string' ? r : r instanceof URL ? r.href : r.url);
  const cacheFor = (name: string) => {
    if (!store.has(name)) store.set(name, new Map());
    const m = store.get(name)!;
    return {
      put: async (r: string | Request, res: Response) => void m.set(key(r).split('?')[0], res.clone()),
      match: async (r: string | Request) => m.get(key(r).split('?')[0])?.clone(),
      add: async (r: Request) => {
        const res = await fetchFn(r);
        if (!res.ok) throw new Error('bad status');
        m.set(key(r), res);
      },
    };
  };
  const fetchFn = async (r: string | Request | URL) => network(key(r));
  const caches = {
    open: async (n: string) => cacheFor(n),
    keys: async () => [...store.keys()],
    delete: async (n: string) => store.delete(n),
  };
  const self = {
    registration: { scope },
    location: new URL(scope),
    clients: { claim: async () => {} },
    skipWaiting: async () => {},
    addEventListener: (t: string, fn: (e: unknown) => void) => (handlers[t] = fn),
  };
  new Function('self', 'caches', 'fetch', serviceWorker('wargamer-v1-abc'))(self, caches, fetchFn);
  const extend = async (type: string) => {
    let p: Promise<unknown> = Promise.resolve();
    handlers[type]({ waitUntil: (x: Promise<unknown>) => (p = x) });
    await p;
  };
  const request = async (url: string, method = 'GET') => {
    let resp: Promise<Response> | null = null;
    handlers.fetch({ request: new Request(url, { method }), respondWith: (r: Promise<Response>) => (resp = r) });
    return resp ? await (resp as Promise<Response>) : null; // null = not intercepted
  };
  return { extend, request, store };
}

test('PWA: service worker serves the app shell cache-first and never intercepts the API', async () => {
  let online = true;
  const net = (url: string) => {
    if (!online) throw new TypeError('offline');
    if (url.endsWith('/missing.png')) return new Response('', { status: 404 });
    return new Response(url.includes('/api/') ? '{}' : HTML, { headers: { 'content-type': url.endsWith('.png') ? 'image/png' : 'text/html' } });
  };
  // Old cache from a previous version gets deleted on activate.
  const sw = await runServiceWorker('http://lan:8080/', net);
  sw.store.set('wargamer-v0-old', new Map());
  sw.store.set('other-app', new Map());
  await sw.extend('install');
  await sw.extend('activate');
  assert.deepEqual([...sw.store.keys()].sort(), ['other-app', 'wargamer-v1-abc']);
  online = false;
  for (const u of ['http://lan:8080/', 'http://lan:8080/index.html', 'http://lan:8080/WarGamer.html?x=1']) {
    const r = await sw.request(u);
    assert.ok(r, u);
    assert.equal(await r.text(), HTML, `${u} served offline`);
  }
  assert.ok(await sw.request('http://lan:8080/icons/icon-192.png'), 'icons cached');
  assert.equal(await sw.request('http://lan:8080/api/ping'), null, 'API not intercepted');
  assert.equal(await sw.request('http://lan:8080/api/classes/c1', 'PUT'), null);
  assert.equal(await sw.request('https://api.anthropic.com/v1/messages'), null, 'other origins not intercepted');
  assert.equal(await sw.request('http://lan:8080/README.html'), null, 'unrelated pages not intercepted');
});

test('PWA: service worker works under a sub-path scope (static hosting)', async () => {
  const seen: string[] = [];
  const sw = await runServiceWorker('https://host.example/training/', (url) => {
    seen.push(url);
    // This host publishes the app only as the folder index.
    if (url.endsWith('/WarGamer.html')) return new Response('nf', { status: 404, headers: { 'content-type': 'text/html' } });
    return new Response(HTML, { headers: { 'content-type': 'text/html' } });
  });
  await sw.extend('install');
  assert.ok(seen.includes('https://host.example/training/'));
  const r = await sw.request('https://host.example/training/');
  assert.equal(await r!.text(), HTML);
  assert.equal(await sw.request('https://host.example/elsewhere/'), null, 'outside scope not intercepted');
});

test('User guide: Markdown renders the README constructs safely', () => {
  const html = markdownToHtml(
    [
      '# WarGamer — Trainer',
      '',
      'Plain **bold** and *em* with `code <b>` and [link](https://example.com) and [bad](javascript:alert(1)).',
      '',
      '| Step | What |',
      '|---|---|',
      '| **Brief** | Narrative |',
      '',
      '```bash',
      'node server/lan-server.mjs   # <port>',
      '```',
      '',
      '- one',
      '- two',
      '  continued',
      '1. first',
      '',
      '> note',
      '',
      '---',
    ].join('\n'),
  );
  assert.match(html, /<h1 id="wargamer-trainer">WarGamer — Trainer<\/h1>/);
  assert.match(html, /<strong>bold<\/strong>/);
  assert.match(html, /<em>em<\/em>/);
  assert.match(html, /<code>code &lt;b&gt;<\/code>/);
  assert.match(html, /<a href="https:\/\/example.com">link<\/a>/);
  assert.match(html, /<a href="#">bad<\/a>/);
  assert.doesNotMatch(html, /javascript:/);
  assert.match(html, /<table><thead><tr><th>Step<\/th><th>What<\/th><\/tr><\/thead><tbody><tr><td><strong>Brief<\/strong><\/td><td>Narrative<\/td><\/tr><\/tbody><\/table>/);
  assert.match(html, /<pre><code class="lang-bash">node server\/lan-server.mjs   # &lt;port&gt;<\/code><\/pre>/);
  assert.match(html, /<ul><li>one<\/li><li>two continued<\/li><\/ul>/);
  assert.match(html, /<ol><li>first<\/li><\/ol>/);
  assert.match(html, /<blockquote><p>note<\/p><\/blockquote>/);
  assert.match(html, /<hr>/);
  const page = guidePage('# Hi');
  assert.match(page, /Content-Security-Policy/);
  assert.doesNotMatch(page, /<script/i);
});

test('User guide: the real README renders without losing sections', () => {
  const md = readFileSync('README.md', 'utf8');
  const html = markdownToHtml(md);
  const headings = md.split('\n').filter((l) => /^#{1,6}\s/.test(l)).length;
  assert.equal((html.match(/<h[1-6] /g) ?? []).length, headings);
  assert.ok(!html.includes('```'));
});

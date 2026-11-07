// Tactical Hex Trainer server entry point. Runs on a closed LAN with no internet dependency.
//   THT_PORT (8080)  THT_HOST (0.0.0.0)  THT_CONTENT (repo root: data/, maps/, scenarios/)
//   THT_DB (var/tht.sqlite)  THT_CLIENT (packages/client/dist)
import { networkInterfaces } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildApp } from './app';
import { loadContent } from './content';
import { Store } from './store';

const here = fileURLToPath(new URL('.', import.meta.url));
const repo = resolve(here, '..', '..', '..');
const env = process.env;
const port = Number(env.THT_PORT ?? 8080);
const host = env.THT_HOST ?? '0.0.0.0';
const contentRoot = resolve(env.THT_CONTENT ?? repo);
const dbFile = resolve(env.THT_DB ?? resolve(repo, 'var', 'tht.sqlite'));
const clientDir = resolve(env.THT_CLIENT ?? resolve(repo, 'packages', 'client', 'dist'));

const content = loadContent(contentRoot, (m) => console.warn(m));
const store = new Store(dbFile);
const { app, games } = await buildApp({ content, store, clientDir, logger: env.THT_LOG === '1' });
const restored = games.restore((m) => console.warn(m));
await app.listen({ port, host });

const addrs = Object.values(networkInterfaces())
  .flat()
  .filter((a) => a && a.family === 'IPv4' && !a.internal)
  .map((a) => `http://${a!.address}:${port}`);
console.log(`Tactical Hex Trainer listening on http://localhost:${port}${addrs.length ? ` (LAN: ${addrs.join(', ')})` : ''}`);
console.log(`content: ${contentRoot}  scenarios: ${content.scenarios.size}  db: ${dbFile}  games restored: ${restored}`);

const stop = async () => {
  await app.close();
  store.close();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);

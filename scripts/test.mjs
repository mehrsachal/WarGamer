// Bundles tests/*.test.ts with esbuild and runs them with the built-in node:test runner.
import * as esbuild from 'esbuild';
import { readdirSync, rmSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const out = '.build-tmp/tests';
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
const filter = process.argv[2];
const entries = readdirSync('tests')
  .filter((f) => f.endsWith('.test.ts'))
  .filter((f) => !filter || f.includes(filter))
  .map((f) => `tests/${f}`);
await esbuild.build({
  entryPoints: entries,
  bundle: true,
  platform: 'node',
  format: 'esm',
  outdir: out,
  outExtension: { '.js': '.mjs' },
  target: ['node20'],
  jsx: 'automatic',
  jsxImportSource: 'preact',
  define: { __APP_VERSION__: '"test"' },
  loader: { '.css': 'text' },
  logLevel: 'error',
});
const files = readdirSync(out).filter((f) => f.endsWith('.mjs')).map((f) => `${out}/${f}`);
const r = spawnSync(process.execPath, ['--test', '--test-reporter=spec', ...files], { stdio: 'inherit' });
process.exit(r.status ?? 1);

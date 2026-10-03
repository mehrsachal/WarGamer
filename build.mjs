// Bundles the whole app (code, styles, NATO symbol library) into ONE self-contained
// HTML file: dist/WarGamer.html. It runs from file:// with no network access.
import * as esbuild from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync } from 'node:fs';
import { PWA_ICONS, cacheName, manifest, serviceWorker } from './scripts/pwa.mjs';

const watch = process.argv.includes('--watch');
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const iconSvg = existsSync('build/icon.svg') ? readFileSync('build/icon.svg', 'utf8') : null;
const favicon = iconSvg
  ? `data:image/svg+xml;base64,${Buffer.from(iconSvg.replace(/<!--[\s\S]*?-->/g, '').replace(/>\s+</g, '><')).toString('base64')}`
  : "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect x='3' y='8' width='26' height='16' fill='%2380e0ff' stroke='%23000' stroke-width='2'/%3E%3Cpath d='M3 8 L29 24 M29 8 L3 24' stroke='%23000' stroke-width='2'/%3E%3C/svg%3E";

async function buildOnce() {
  const result = await esbuild.build({
    entryPoints: ['src/main.tsx'],
    bundle: true,
    minify: !watch && !process.env.NOMIN,
    format: 'iife',
    target: ['es2020'],
    write: false,
    jsx: 'automatic',
    jsxImportSource: 'preact',
    legalComments: 'none',
    define: { __APP_VERSION__: JSON.stringify(pkg.version), 'process.env.NODE_ENV': '"production"' },
    loader: { '.css': 'text' },
  });
  const js = result.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>WarGamer — Tactical Training System</title>
<meta name="description" content="Offline tactical wargaming trainer: plan, wargame, assess.">
<meta name="theme-color" content="#0f1418">
<link rel="icon" href="${favicon}">
</head>
<body>
<div id="app"><div style="font:16px sans-serif;padding:40px;color:#ccc;background:#111;height:100vh">Loading WarGamer…</div></div>
<script>${js}</script>
</body>
</html>`;
  mkdirSync('dist', { recursive: true });
  writeFileSync('dist/WarGamer.html', html);
  console.log(`dist/WarGamer.html written (${(html.length / 1024).toFixed(0)} KB)`);
  writePwa(html);
}

// PWA files (used only when served over http(s); see src/pwa.ts and server/lan-core.cjs).
function writePwa(html) {
  mkdirSync('dist/icons', { recursive: true });
  for (const i of PWA_ICONS) {
    const src = `build/${i.src.split('/').pop()}`;
    if (existsSync(src)) copyFileSync(src, `dist/${i.src}`);
    else console.warn(`warning: ${src} missing (run build/render-icons.mjs)`);
  }
  writeFileSync('dist/manifest.webmanifest', JSON.stringify(manifest(pkg.version), null, 2));
  const cache = cacheName(pkg.version, html);
  writeFileSync('dist/sw.js', serviceWorker(cache));
  console.log(`dist/manifest.webmanifest, dist/sw.js (${cache}), dist/icons/ written`);
}

if (watch) {
  const { watch: fsWatch } = await import('node:fs');
  await buildOnce();
  let timer = null;
  fsWatch('src', { recursive: true }, () => {
    clearTimeout(timer);
    timer = setTimeout(() => buildOnce().catch((e) => console.error(e.message)), 150);
  });
  console.log('Watching src/ ...');
} else {
  await buildOnce();
}

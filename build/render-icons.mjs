// Renders build/icon.svg to the PNG icons used by the desktop installers (icon.png = 1024 px)
// and the PWA (192/512 + maskable). Needs Playwright's Chromium; only run it when the SVG changes:
//   PLAYWRIGHT=/path/to/playwright/index.mjs node build/render-icons.mjs
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const { chromium } = await import(process.env.PLAYWRIGHT ?? 'playwright');
const svg = readFileSync(join(here, 'icon.svg'), 'utf8');
// Maskable variant: full-bleed sheet with the mark scaled into the 80 % safe circle.
const maskSvg = svg
  .replaceAll('x="64" y="64" width="896" height="896" rx="196"', 'x="0" y="0" width="1024" height="1024" rx="0"')
  .replace('<g id="mark">', '<g id="mark" transform="translate(512 537) scale(0.8) translate(-512 -537)">');
const uri = (s) => `data:image/svg+xml;base64,${Buffer.from(s).toString('base64')}`;
const jobs = [
  [1024, 'icon.png', svg],
  [512, 'icon-512.png', svg],
  [256, 'icon-256.png', svg],
  [192, 'icon-192.png', svg],
  [512, 'icon-maskable-512.png', maskSvg],
];
const browser = await chromium.launch();
const page = await browser.newPage();
for (const [size, name, src] of jobs) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<html><body style="margin:0;background:transparent"><img src="${uri(src)}" style="width:${size}px;height:${size}px;display:block"></body></html>`);
  await page.waitForTimeout(150);
  await page.screenshot({ path: join(here, name), omitBackground: src === svg, clip: { x: 0, y: 0, width: size, height: size } });
  console.log(`build/${name}`);
}
await browser.close();

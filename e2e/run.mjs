// UI end-to-end check (Playwright): briefing -> deployment -> moves, panels, artillery -> full 16-turn game vs
// the AI -> result screen. Usage: start the server, then  node e2e/run.mjs [baseUrl] [screenshotDir]
const base = process.argv[2] ?? 'http://localhost:8080';
const shots = process.argv[3];
const pw = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright').catch(() => import('/opt/node-tools/node_modules/playwright/index.mjs'));
const browser = await pw.chromium.launch();
const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => m.type() === 'error' && errors.push(`console: ${m.text()}`));
const shot = async (name) => shots && page.screenshot({ path: `${shots}/${name}.png` });
const hook = () => page.evaluate(() => window.__tht);
const waitMyTurn = async (timeout = 60000) => {
  await page.waitForFunction(() => window.__tht?.myTurn || window.__tht?.view?.phase === 'over', null, { timeout });
  await page.waitForTimeout(300);
};
/** Bring a hex on screen, then click (or just hover) it. */
const clickHex = async (hx, hoverOnly = false) => {
  await page.evaluate((x) => window.__tht.centreOn(x), hx);
  await page.waitForTimeout(150);
  const pt = await page.evaluate((x) => window.__tht.screenOf(x), hx);
  if (hoverOnly) await page.mouse.move(pt.x, pt.y);
  else await page.mouse.click(pt.x, pt.y);
  await page.waitForTimeout(250);
};
const fail = (m) => {
  console.error('FAIL:', m);
  process.exitCode = 1;
};

await page.goto(`${base}/`);
await page.click('[data-testid="scenario-ridgeline-coy-attack"]');
await page.waitForSelector('[data-testid="briefing"]');
await shot('01_briefing');
await page.click('[data-testid="start-game"]');
await page.waitForSelector('[data-testid="deploy-tray"]');
await page.waitForTimeout(800);
await shot('02_deployment');
// SET-04: a placement outside the zone is refused
let h = await hook();
const sec = h.view.units.find((u) => u.id === 'a1-1');
let p;
await clickHex(sec.hex);
const north = { q: sec.hex.q, r: sec.hex.r - 12 };
await clickHex(north);
await page.waitForSelector('[data-testid="toast"]');
if (!(await page.textContent('[data-testid="toast"]')).includes('deployment zone')) fail('outside-zone placement not refused');
await page.click('[data-testid="btn-end"]');
await page.waitForFunction(() => window.__tht?.view?.phase === 'play' && window.__tht?.myTurn, null, { timeout: 60000 });
await page.waitForTimeout(300);
h = await hook();
if (h.view.phase !== 'play' || h.view.turn !== 1) fail(`expected turn 1, got ${h.view.phase} ${h.view.turn}`);
await shot('03_turn1');

// MOV-03/04: select a section, see reach bands, move tactically
await clickHex(sec.hex);
h = await hook();
const tac = h.reach.filter((r) => r.band === 'tactical');
const dash = h.reach.filter((r) => r.band === 'dash');
if (!tac.length || !dash.length) fail('reach bands missing');
await shot('04_reach');
const dest = tac.sort((a, b) => b.cost - a.cost)[0].key.split(',').map(Number);
await clickHex({ q: dest[0], r: dest[1] }, true);
await shot('05_path');
p = await page.evaluate((x) => window.__tht.screenOf(x), { q: dest[0], r: dest[1] });
await page.mouse.click(p.x, p.y);
await page.waitForTimeout(600);
h = await hook();
const moved = h.view.units.find((u) => u.id === 'a1-1');
if (moved.hex.q !== dest[0] || moved.hex.r !== dest[1] || moved.posture !== 'moved') fail('tactical move not applied');

// UI-01 panels
for (const [btn, sel, name] of [
  ['[data-testid="btn-objectives"]', '[data-testid="objectives"]', '06_objectives'],
  ['text=Data', '[data-testid="data-panel"]', '07_data'],
  ['text=Help', '[data-testid="help-panel"]', '08_help'],
]) {
  await page.click(btn);
  await page.waitForSelector(sel);
  await shot(name);
  await page.keyboard.press('Escape');
}
// VIS-02 viewshed
await page.click('[data-testid="btn-viewshed"]');
await page.waitForTimeout(400);
await shot('09_viewshed');
await page.click('[data-testid="btn-viewshed"]');

// end turn 1, AI plays, turn 2: FS-02 artillery not before turn 2
await page.click('[data-testid="btn-end"]');
await page.click('[data-testid="btn-confirm-end"]');
await page.waitForFunction(() => window.__tht?.view?.turn === 2 && window.__tht?.myTurn, null, { timeout: 60000 });
h = await hook();
if (h.view.turn !== 2) fail(`expected turn 2, got ${h.view.turn}`);
await shot('10_turn2');
const target = h.view.units.find((u) => !u.own && u.hex);
if (target) {
  await page.click('[data-testid="btn-artillery"]');
  await page.waitForSelector('[data-testid="artillery"]');
  await shot('11_artillery_panel');
  await page.click('[data-testid="artillery"] .btn.primary');
  await clickHex(target.hex, true);
  await shot('12_artillery_target');
  p = await page.evaluate((x) => window.__tht.screenOf(x), target.hex);
  await page.mouse.click(p.x, p.y);
  await page.waitForTimeout(600);
  h = await hook();
  if (!h.view.pendingFires.length) fail('artillery mission not registered');
} else console.log('note: no enemy visible on turn 2; artillery step skipped');

// play out the remaining turns (VIC-02 result screen at the end of turn 16)
for (let i = 0; i < 40; i++) {
  h = await hook();
  if (h.view.phase === 'over') break;
  const turn = h.view.turn;
  await page.click('[data-testid="btn-end"]');
  await page.click('[data-testid="btn-confirm-end"]');
  await page.waitForFunction((t) => window.__tht?.view?.phase === 'over' || (window.__tht?.view?.turn > t && window.__tht?.myTurn), turn, { timeout: 90000 });
  if (i === 6) await shot('13_midgame');
}
await page.waitForSelector('[data-testid="result"]', { timeout: 60000 });
await shot('14_result');
h = await hook();
if (h.view.phase !== 'over' || !h.view.result) fail('game did not end');
console.log(`result: ${JSON.stringify(h.view.result)}`);
if (errors.length) fail(errors.join('\n'));
await browser.close();
console.log(process.exitCode ? 'E2E FAILED' : 'E2E OK');

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SKETCH_SHIFT, presetBic49 } from '../src/scenario/presetBic49';
import { generateScenario } from '../src/scenario/generator';
import { autoPlan } from '../src/plan/plan';
import { Engine } from '../src/sim/engine';
import { assessWargame } from '../src/assess/wargame';
import type { Plan } from '../src/core/types';

const SEEDS = [1, 2, 3, 4];

/** DS siting kept, but no fire plan, obstacles, SP/LPs or altn posns, and poor contingencies. */
function noFirePlan(good: Plan): Plan {
  const mid: Plan = JSON.parse(JSON.stringify(good));
  mid.units = mid.units.filter((u) => !['SP_PTL', 'LP'].includes(u.role));
  mid.units.forEach((u) => (u.altPos = undefined));
  mid.graphics = mid.graphics.filter((g) => g.kind === 'FDL');
  mid.contingency = {
    SCREEN_CONTACT: { option: 'HOLD_ALL_COSTS' },
    EN_PROBE: { option: 'ALL_WPNS' },
    EN_ASSEMBLY: { option: 'NOTHING' },
    EN_FORMING_UP: { option: 'WAIT' },
    EN_ASSAULT: { option: 'ALL_FIRE' },
    POST_LOST: { option: 'HIGHER_CATK' },
    LOCALITY_LOST: { option: 'OWN_CATK' },
    REORG: { option: 'STAND_DOWN,EVAC_DEAD_FIRST,SITREP' },
  };
  mid.qcSorties = [];
  return mid;
}

/** Localities sited far back (vital gr given up), no fire plan, obstacles or surveillance, wrong contingencies. */
function poorPlan(good: Plan): Plan {
  const bad: Plan = JSON.parse(JSON.stringify(good));
  bad.units = bad.units.filter((u) => !['SP_PTL', 'LP', 'SCREEN'].includes(u.role));
  // sketch coordinates (BIC-49 v2 sheet: + 4500 m E)
  const X = SKETCH_SHIFT.x;
  const xs = [1500 + X, 2200 + X, 2900 + X];
  bad.units
    .filter((u) => u.templateKey === 'RIFLE_PL')
    .forEach((u, i) => {
      u.pos = { x: xs[i % 3], y: 2850 };
      u.role = 'FDL';
      u.altPos = undefined;
    });
  for (const u of bad.units) if (u.templateKey !== 'RIFLE_PL') u.pos = { x: 2200 + X, y: 2700 };
  bad.graphics = bad.graphics.filter((g) => g.kind === 'FDL');
  bad.contingency = {
    SCREEN_CONTACT: { option: 'HOLD_ALL_COSTS' },
    EN_PROBE: { option: 'ALL_WPNS' },
    EN_ASSEMBLY: { option: 'NOTHING' },
    EN_FORMING_UP: { option: 'WAIT' },
    EN_ASSAULT: { option: 'ALL_FIRE' },
    POST_LOST: { option: 'WITHDRAW' },
    LOCALITY_LOST: { option: 'WITHDRAW_ALL' },
    REORG: { option: 'STAND_DOWN,EVAC_DEAD_FIRST' },
  };
  bad.qcSorties = [];
  return bad;
}

function run(plan: Plan, seed: number) {
  const e = new Engine(presetBic49(), plan, { seed, fog: 'FULL', interactive: false, difficulty: 'STANDARD' });
  e.runToEnd();
  return { sum: e.summary(), pct: assessWargame(e).pct };
}

test('wargame is deterministic for a given seed', () => {
  const plan = autoPlan(presetBic49());
  const a = run(plan, 7).sum;
  const b = run(plan, 7).sum;
  assert.deepEqual(a, b);
});

const avg = (xs: number[]) => xs.reduce((m, x) => m + x, 0) / xs.length;

test('wargame discriminates a sound plan from poor ones', () => {
  const s = presetBic49();
  const good = autoPlan(s);
  const g = SEEDS.map((sd) => run(good, sd));
  const far = SEEDS.map((sd) => run(poorPlan(good), sd));
  const mid = SEEDS.map((sd) => run(noFirePlan(good), sd));
  // a Bn Gp attk on a coy can still succeed, but a sound plan holds most of the time
  assert.ok(g.filter((r) => r.sum.result !== 'LOST').length >= 3, 'sound plan mostly holds');
  // siting the def behind the vital gr loses it, however few cas are taken
  assert.ok(far.every((r) => r.sum.result === 'LOST' && !r.sum.vitalHeld), 'vital gr given up');
  // without a fire plan, altn posns and sound decisions the def bleeds
  assert.ok(avg(mid.map((r) => r.sum.ownCas)) > avg(g.map((r) => r.sum.ownCas)), 'more own cas without a fire plan');
  const gp = avg(g.map((r) => r.pct));
  assert.ok(gp > avg(far.map((r) => r.pct)) + 15, 'battle score: sound vs far-back plan');
  assert.ok(gp > avg(mid.map((r) => r.pct)) + 20, 'battle score: sound vs no-fire-plan');
  for (const r of [...g, ...far, ...mid]) {
    assert.ok(r.sum.ownCas <= r.sum.ownStart, 'own cas never exceed own strength');
    assert.ok(r.sum.enCas <= r.sum.enStart, 'en cas never exceed en strength');
  }
});

test('wargame runs to completion on generated scenarios at every level', () => {
  // (until v2 the four scenarios below shared one cached terrain raster — same id for the same seed — so
  // BN/BDE were fought on the PL raster; the cache is now keyed by extent too and each level gets its own)
  let total = 0;
  for (const level of ['PL', 'COY', 'BN', 'BDE'] as const) {
    const s = generateScenario({ level, terrain: 'SEMI_DESERT', seed: 99 });
    const e = new Engine(s, autoPlan(s), { seed: 3, fog: 'PARTIAL', interactive: false, difficulty: 'STANDARD' });
    e.runToEnd();
    assert.ok(e.over, `${level} finished`);
    const sm = e.summary();
    assert.ok(['HELD', 'PARTIAL', 'LOST'].includes(sm.result));
    assert.ok(sm.enCas > 0, `${level}: en took cas`);
    // at least the screen battle and the reorg; how many more depends on what the fog lets you see
    assert.ok(e.decisions.length >= 2, `${level}: injects raised (${e.decisions.length})`);
    total += e.decisions.length;
  }
  assert.ok(total >= 12, `injects raised across the levels (${total})`);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BIC49_MIGRATIONS, BIC49_VERSION, SKETCH_SHIFT, presetBic49 } from '../src/scenario/presetBic49';
import { generateScenario } from '../src/scenario/generator';
import { shiftBetween, translatePlan, translateScenario } from '../src/scenario/transform';
import { FOX_NAMES, PUNJAB_VILLAGES } from '../src/scenario/names';
import { migrateAttempt } from '../src/scenario/migrate';
import { autoPlan } from '../src/plan/plan';
import { TerrainModel } from '../src/terrain/terrain';
import { bbox, centroid, dist, type Vec } from '../src/core/geom';
import type { Attempt, Feature, OpsLevel, TerrainType } from '../src/core/types';

function featurePos(f: Feature): Vec {
  if ('poly' in f) return centroid(f.poly);
  if ('pts' in f) return centroid(f.pts);
  if ('c' in f) return f.c;
  return f.pos;
}

// BIC-49 v2: the issued sketch sits in the centre of a 13.5 km landscape sheet, shifted 4500 m E.
const X = SKETCH_SHIFT.x;
const at = (x: number, y: number) => ({ x: x + X, y });

test('BIC-49 preset builds a terrain model with sensible queries', () => {
  const s = presetBic49();
  const t = new TerrainModel(s.terrain);
  assert.equal(t.cols, 540);
  assert.equal(t.rows, 380);
  // 15 r is higher than open ground next to it
  const top = t.elevAt(at(1750, 4775));
  const flat = t.elevAt(at(1750, 4300));
  assert.ok(top > flat + 8, `15 r should be elevated (${top} vs ${flat})`);
  // dry nullah impedes tanks; road bridge does not
  assert.ok(t.goingAt(at(2100, 4965), 'TRACKED') < 0.5);
  assert.equal(t.squareRef(at(1600, 4800)), 'Sq 1573');
  assert.match(t.describe(at(1000, 6500)), /Clump 2/);
  // line of sight: Alipur BUA blocks view through it
  const westOfAlipur = at(2300, 4870);
  const eastOfAlipur = at(3200, 4870);
  assert.equal(t.los(westOfAlipur, eastOfAlipur), 0);
  // open ground: clear view along the nullah line south side
  assert.ok(t.los(at(1750, 4775), at(1750, 5600), 2, 1.5) > 0.5);
  const path = t.findPath(at(1150, 7100), at(2100, 4100), 'TRACKED');
  assert.ok(path.length > 3);
});

test('BIC-49 v2 is a landscape sheet with the sketch centred and the grid labels kept', () => {
  const s = presetBic49();
  const { width, height, gridOrigin, gridSq } = s.terrain;
  assert.equal(s.version, BIC49_VERSION);
  assert.ok(width / height > 1.35 && width / height < 1.6, `aspect ${width / height}`);
  assert.equal(width, 13500);
  assert.equal(gridOrigin.e, 3);
  const t = new TerrainModel(s.terrain);
  // the sheet shows eastings 03..29 (30 on the E edge); the original sketch keeps 12..21
  assert.equal(t.squareRef({ x: 10, y: 10 }), 'Sq 0364');
  assert.equal(t.squareRef({ x: width - 10, y: 10 }), 'Sq 2964');
  assert.equal(t.squareRef(at(10, 10)), 'Sq 1264');
  assert.equal(t.squareRef(at(4490, 10)), 'Sq 2064');
  // landmarks where the issued sketch (and the DS) put them
  const named = (n: string) => s.terrain.features.find((f) => f.name === n)!;
  const h15 = named('15 r');
  assert.ok(h15.kind === 'height' && Math.abs(h15.c.x - (3.5 * gridSq + X)) < 1 && Math.abs(h15.c.y - 9.55 * gridSq) < 1);
  const br1 = named('Br 1');
  assert.ok(br1.kind === 'bridge' && t.squareRef(br1.pos) === 'Sq 1473');
  const alipur = named('ALIPUR');
  assert.ok(alipur.kind === 'bua' && t.squareRef(centroid(alipur.poly)) === 'Sq 1773');
  const itg = (n: string) => s.ds.itgs.find((i) => i.name === n)!.pos;
  assert.ok(dist(itg('15 r'), h15.c) < 1, 'DS ITG 15 r on the feature');
  assert.ok(dist(itg('Alipur'), centroid(alipur.poly)) < 120, 'DS ITG Alipur on the BUA');
  // AOR, en entry and DS lie in the sketch area; the boundaries frame it
  const ab = bbox(s.own.aor);
  assert.equal(ab.minX, 2 * gridSq + X);
  assert.equal(ab.maxX, 7 * gridSq + X);
  assert.ok(s.enemy.entry.every((p) => p.x > X && p.x < X + 9 * gridSq));
  assert.ok(s.ds.approaches.every((a) => a.path.every((p) => p.x > X && p.x < X + 9 * gridSq)));
  assert.deepEqual(s.own.boundaries.map((b) => b.label), ['105 ✕ 250', 'A | B', '139 | 146']);
});

test('BIC-49 flanks join the sketch at the seams and fill the sheet', () => {
  const s = presetBic49();
  const { width, height } = s.terrain;
  const lin = (n: string) => s.terrain.features.find((f) => f.name === n && 'pts' in f) as { pts: Vec[] };
  // continuous water obstacles and border from edge to edge
  for (const n of ['Interstate Bdry', 'Dry Nullah', 'Disty No 5']) {
    const pts = lin(n).pts;
    const xs = pts.map((p) => p.x);
    assert.equal(Math.min(...xs), 0, `${n} reaches the W edge`);
    assert.equal(Math.max(...xs), width, `${n} reaches the E edge`);
    for (let i = 1; i < pts.length; i++) assert.ok(pts[i].x > pts[i - 1].x, `${n} runs W -> E without gaps`);
  }
  // features in both flanks: villages, heights, BOPs, roads, clumps and kidney bunds
  const west = s.terrain.features.filter((f) => featurePos(f).x < X);
  const east = s.terrain.features.filter((f) => featurePos(f).x > X + 4500);
  for (const side of [west, east]) {
    assert.ok(side.filter((f) => f.kind === 'bua' && f.name).length >= 5, 'named villages');
    assert.ok(side.filter((f) => f.kind === 'height' && f.name).length >= 3, 'named rises');
    assert.ok(side.filter((f) => f.kind === 'bop').length >= 4, 'BOPs');
    assert.ok(side.some((f) => f.kind === 'road'), 'a metalled rd');
    assert.ok(side.some((f) => f.kind === 'trees'), 'clumps');
    assert.ok(side.some((f) => f.kind === 'kbund'), 'kidney bund');
  }
  assert.ok(s.terrain.features.some((f) => f.kind === 'canal'), 'minor canal');
  assert.ok(s.terrain.features.filter((f) => f.kind === 'bridge').length >= 8, 'flank bridges');
  // every flank village name comes from the names lists
  const known = new Set([...PUNJAB_VILLAGES, ...FOX_NAMES].map((n) => n.toUpperCase()));
  for (const f of [...west, ...east]) if (f.kind === 'bua' && f.name && !/^CHAK \d+$/.test(f.name)) assert.ok(known.has(f.name), f.name);
  // the narrative's "incl Hayatabad" is now on the sheet, E of the AOR and W of the Bn rt bdry
  const hay = s.terrain.features.find((f) => f.name === 'HAYATABAD');
  assert.ok(hay && featurePos(hay).x > X + 3500 && featurePos(hay).x < X + 6000);
  // all features inside the sheet
  for (const f of s.terrain.features) {
    const p = featurePos(f);
    assert.ok(p.x >= 0 && p.x <= width && p.y >= 0 && p.y <= height, `${f.id} inside`);
  }
  // deterministic
  assert.equal(JSON.stringify(presetBic49().terrain), JSON.stringify(s.terrain));
});

test('translate helpers move every coordinate and round-trip', () => {
  const s = presetBic49();
  const back = translateScenario(s, { x: -SKETCH_SHIFT.x, y: 0 });
  const again = translateScenario(back, SKETCH_SHIFT);
  assert.equal(JSON.stringify(again), JSON.stringify(s));
  assert.equal(featurePos(back.terrain.features.find((f) => f.name === '15 r')!).x, 3.5 * 500);
  assert.equal(back.ds.itgs[0].pos.x, s.ds.itgs[0].pos.x - SKETCH_SHIFT.x);
  assert.equal(back.enemy.entry[0].x, s.enemy.entry[0].x - SKETCH_SHIFT.x);
  assert.equal(back.own.boundaries[0].pts[0].x, s.own.boundaries[0].pts[0].x - SKETCH_SHIFT.x);
  // plans
  const plan = autoPlan(s);
  plan.units[0].area = [{ x: 1, y: 2 }, { x: 3, y: 4 }, { x: 5, y: 1 }];
  plan.groups = [{ id: 'g', label: 'G', memberIds: [plan.units[0].id], area: [{ x: 0, y: 0 }] }];
  const moved = translatePlan(plan, { x: 100, y: -50 });
  assert.equal(moved.units[0].pos.x, plan.units[0].pos.x + 100);
  assert.equal(moved.units[0].area![1].y, 4 - 50);
  assert.equal(moved.groups![0].area![0].x, 100);
  assert.equal(moved.graphics[0].pts[0].y, plan.graphics[0].pts[0].y - 50);
  assert.notEqual(plan.units[0].pos.x, moved.units[0].pos.x, 'input not mutated');
  assert.deepEqual(translatePlan(moved, { x: -100, y: 50 }).units[0].pos, plan.units[0].pos);
  // version arithmetic
  assert.deepEqual(shiftBetween(BIC49_MIGRATIONS, undefined, BIC49_VERSION), SKETCH_SHIFT);
  assert.deepEqual(shiftBetween(BIC49_MIGRATIONS, 1, 2), SKETCH_SHIFT);
  assert.deepEqual(shiftBetween(BIC49_MIGRATIONS, 2, 2), { x: 0, y: 0 });
});

test('migrating a v1 BIC-49 attempt keeps the plan and the AAR on the same ground', () => {
  const s = presetBic49();
  const v1 = translateScenario(s, { x: -SKETCH_SHIFT.x, y: 0 });
  const t1 = new TerrainModel({ ...v1.terrain, width: 4500, gridOrigin: { e: 12, n: 64 } });
  const t2 = new TerrainModel(s.terrain);
  // a plan and an AAR record made on v1 (sketch frame)
  const planV1 = translatePlan(autoPlan(s), { x: -SKETCH_SHIFT.x, y: 0 });
  const frame = { t: 0, u: [['u1', 1750, 4775, 100, 0]] as [string, number, number, number, number][], f: [[1750, 4775, 1000, 6500, 1]] as [number, number, number, number, number][] };
  const attempt = {
    id: 'a1', exerciseId: 'x', studentId: 'st', scenarioId: s.id, status: 'COMPLETE', plan: planV1, startedAt: 0,
    wargame: { frames: [frame], enemyPlan: { faa: { x: 1, y: 2 }, fup: { x: 3, y: 4 }, bof: { x: 5, y: 6 }, faaName: '', fupName: '', bofName: '', approach: [{ x: 7, y: 8 }], objectives: [{ pos: { x: 9, y: 10 }, name: 'o', phase: 1 }] } },
  } as unknown as Attempt;
  const m = migrateAttempt(attempt, s);
  assert.ok(m, 'migrated');
  assert.equal(m.scenarioVersion, BIC49_VERSION);
  for (let i = 0; i < planV1.units.length; i++) {
    assert.equal(t2.squareRef(m.plan.units[i].pos), t1.squareRef(planV1.units[i].pos), 'same grid square');
    assert.equal(t2.describe(m.plan.units[i].pos), t1.describe(planV1.units[i].pos), 'same place');
  }
  assert.equal(t2.describe({ x: m.wargame!.frames[0].u[0][1], y: m.wargame!.frames[0].u[0][2] }), 'area 15 r');
  assert.equal(m.wargame!.frames[0].f[0][2], 1000 + SKETCH_SHIFT.x);
  assert.equal(m.wargame!.enemyPlan!.objectives[0].pos.x, 9 + SKETCH_SHIFT.x);
  // idempotent: a migrated attempt is left alone
  assert.equal(migrateAttempt(m, s), null);
  // other scenarios are untouched
  assert.equal(migrateAttempt({ ...attempt, scenarioId: 'gen_x' }, s), null);
});

for (const level of ['PL', 'COY', 'BN', 'BDE'] as OpsLevel[]) {
  for (const terrain of ['PLAINS', 'CANAL', 'DESERT', 'SEMI_DESERT'] as TerrainType[]) {
    test(`generator: ${level} / ${terrain}`, () => {
      const s = generateScenario({ level, terrain, seed: 1234 });
      assert.equal(s.level, level);
      assert.ok(s.terrain.features.length > 10);
      const aspect = s.terrain.width / s.terrain.height;
      assert.ok(aspect >= 1.4 && aspect <= 1.6, `landscape sheet (${aspect})`);
      // features fill the whole extent: something in each outer sixth of the sheet
      const xs = s.terrain.features.map((f) => featurePos(f).x / s.terrain.width);
      assert.ok(xs.filter((x) => x < 1 / 6).length >= 3 && xs.filter((x) => x > 5 / 6).length >= 3, 'flanks populated');
      // the AOR is central and the DS ITGs stay inside it
      const ab = bbox(s.own.aor);
      assert.ok(ab.minX > s.terrain.width * 0.2 && ab.maxX < s.terrain.width * 0.8, 'AOR central');
      assert.ok(s.ds.itgs.every((i) => i.pos.x >= ab.minX && i.pos.x <= ab.maxX), 'ITGs in AOR');
      assert.ok(s.ds.approaches.length >= 2, 'approaches computed');
      assert.ok(s.ds.itgs.length >= 2, 'itgs computed');
      assert.ok(s.ds.linesOfDef.length >= 1, 'lines of def computed');
      assert.ok(s.narrative.length >= 5);
      const again = generateScenario({ level, terrain, seed: 1234 });
      assert.deepEqual(again.terrain.features.length, s.terrain.features.length, 'deterministic');
      assert.equal(again.narrative[0].body, s.narrative[0].body);
    });
  }
}

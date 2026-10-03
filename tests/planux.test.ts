import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DOCTRINE } from '../src/core/doctrine';
import { dist, polygonArea } from '../src/core/geom';
import type { Plan, PlacedUnit } from '../src/core/types';
import { TEMPLATES } from '../src/core/units';
import {
  areaCentroid,
  areaExtentFacing,
  areaRadius,
  defaultArea,
  defaultEggAxes,
  enclosingEgg,
  fitFreehand,
  isAreaUnit,
  rotatePts,
  sampleClosed,
  scaleAlong,
  setUnitArea,
  simplifyRdp,
  unitArea,
} from '../src/plan/area';
import { emptyPlan, autoPlan } from '../src/plan/plan';
import { defaultFoundBy, foundLabel, groupUnits, mergeBack, pruneGroups, removeUnits, splitOptions, splitUnit, strengthBook, ungroup } from '../src/plan/taskorg';
import { presetBic49 } from '../src/scenario/presetBic49';
import { Engine } from '../src/sim/engine';

const unit = (o: Partial<PlacedUnit> & { id: string; templateKey: string }): PlacedUnit => ({ label: o.id, pos: { x: 1000, y: 1000 }, facing: 0, role: 'FDL', ...o });

test('area: centroid of a polygon and of an offset square', () => {
  const sq = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
    { x: 0, y: 10 },
  ];
  assert.deepEqual(areaCentroid(sq), { x: 5, y: 5 });
  // uneven vertex density must not bias the area centroid (vertex mean would)
  const dense = [{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 4, y: 0 }, { x: 6, y: 0 }, { x: 8, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];
  const c = areaCentroid(dense);
  assert.ok(Math.abs(c.x - 5) < 1e-9 && Math.abs(c.y - 5) < 1e-9);
});

test('area: default eggs are sized from doctrine and keep the sim footprint', () => {
  for (const key of ['RIFLE_SEC', 'RIFLE_PL', 'RIFLE_COY', 'INF_BN']) {
    const t = TEMPLATES[key];
    const ax = defaultEggAxes(key);
    const frontage = ax.front * 2;
    const [lo, hi] = DOCTRINE.frontage[t.echelon];
    assert.ok(frontage >= lo * 0.75 && frontage <= hi * 1.25, `${key} frontage ${frontage} vs ${lo}-${hi}`);
    assert.ok(ax.depth < ax.front, `${key} egg deeper than wide`);
    const egg = defaultArea({ templateKey: key, pos: { x: 5000, y: 5000 }, facing: 30 });
    assert.ok(egg.length >= 8 && egg.length <= 16);
    const r = areaRadius(egg);
    assert.ok(Math.abs(r - t.radius) / t.radius < 0.03, `${key} equivalent radius ${r} vs ${t.radius}`);
    const c = areaCentroid(egg);
    assert.ok(dist(c, { x: 5000, y: 5000 }) < 0.01);
    // oriented to the facing: wide across the front
    const ext = areaExtentFacing(egg, 30);
    assert.ok(Math.abs(ext.front - ax.front) / ax.front < 0.03 && Math.abs(ext.depth - ax.depth) / ax.depth < 0.05);
  }
});

test('area: which units are eggs', () => {
  assert.equal(isAreaUnit({ templateKey: 'RIFLE_PL', role: 'FDL' }), true);
  assert.equal(isAreaUnit({ templateKey: 'RIFLE_COY', role: 'DEPTH' }), true);
  assert.equal(isAreaUnit({ templateKey: 'CHQ', role: 'CHQ' }), true);
  assert.equal(isAreaUnit({ templateKey: 'SCREEN_PL', role: 'SCREEN' }), true);
  assert.equal(isAreaUnit({ templateKey: 'RIFLE_SEC', role: 'SP_PTL' }), false);
  assert.equal(isAreaUnit({ templateKey: 'LP', role: 'LP' }), false);
  assert.equal(isAreaUnit({ templateKey: 'RR_DET', role: 'SP_WPN' }), false);
  assert.equal(isAreaUnit({ templateKey: 'QC_DET', role: 'QC' }), false);
});

test('area: unitArea follows pos; setUnitArea keeps pos = centroid', () => {
  const u = unit({ id: 'a', templateKey: 'RIFLE_PL' });
  u.area = defaultArea(u);
  u.pos = { x: 1300, y: 900 };
  const a = unitArea(u);
  assert.ok(dist(areaCentroid(a), u.pos) < 0.01);
  setUnitArea(u, scaleAlong(a, u.pos, { x: 1, y: 0 }, 2, 1).map((p) => ({ x: p.x + 50, y: p.y })));
  assert.ok(dist(areaCentroid(u.area!), u.pos) < 0.2);
  assert.ok(Math.abs(u.pos.x - 1350) < 0.2);
});

test('area: rotate and scale transforms', () => {
  const egg = defaultArea({ templateKey: 'RIFLE_PL', pos: { x: 0, y: 0 }, facing: 0 });
  const r = rotatePts(egg, { x: 0, y: 0 }, 90);
  const e0 = areaExtentFacing(egg, 0);
  const e1 = areaExtentFacing(r, 90);
  assert.ok(Math.abs(e0.front - e1.front) < 0.5 && Math.abs(e0.depth - e1.depth) < 0.5);
  const big = scaleAlong(egg, { x: 0, y: 0 }, { x: 1, y: 0 }, 2, 1);
  assert.ok(Math.abs(polygonArea(sampleClosed(big)) / polygonArea(sampleClosed(egg)) - 2) < 0.02);
});

test('area: RDP simplification and freehand fitting', () => {
  const line = Array.from({ length: 50 }, (_, i) => ({ x: i * 10, y: (i % 2) * 0.3 }));
  assert.equal(simplifyRdp(line, 1).length, 2);
  // a wobbly hand-drawn circle of radius 200 -> 8..16 control points still enclosing ~ the same area
  const raw = Array.from({ length: 180 }, (_, i) => {
    const a = (i / 180) * Math.PI * 2;
    const r = 200 + Math.sin(i * 1.7) * 6;
    return { x: 1000 + Math.cos(a) * r, y: 1000 + Math.sin(a) * r };
  });
  const fit = fitFreehand(raw, true);
  assert.ok(fit.length >= 8 && fit.length <= 16, `got ${fit.length}`);
  const ratio = polygonArea(sampleClosed(fit)) / (Math.PI * 200 * 200);
  assert.ok(ratio > 0.9 && ratio < 1.08, `area ratio ${ratio}`);
  // open stroke keeps its ends
  const open = fitFreehand(Array.from({ length: 60 }, (_, i) => ({ x: i * 20, y: Math.sin(i / 6) * 150 })), false);
  assert.ok(open.length >= 2 && open.length <= 16);
  assert.deepEqual(open[0], { x: 0, y: 0 });
});

test('area: enclosing egg contains its members', () => {
  const pts = [
    { x: 0, y: 0 },
    { x: 400, y: 50 },
    { x: 200, y: 300 },
    { x: 100, y: 120 },
  ];
  const egg = enclosingEgg(pts, 60);
  const s = sampleClosed(egg);
  // every input point is inside the sampled outline
  const inside = (p: { x: number; y: number }) => {
    let ins = false;
    for (let i = 0, j = s.length - 1; i < s.length; j = i++) if (s[i].y > p.y !== s[j].y > p.y && p.x < ((s[j].x - s[i].x) * (p.y - s[i].y)) / (s[j].y - s[i].y) + s[i].x) ins = !ins;
    return ins;
  };
  for (const p of pts) assert.ok(inside(p));
});

function planOf(units: PlacedUnit[]): Plan {
  const p = emptyPlan();
  p.units = units;
  return p;
}

test('task org: split a pl into secs, detach, merge back — strengths balance', () => {
  const plan = planOf([unit({ id: 'pl', templateKey: 'RIFLE_PL', label: '2 Pl' })]);
  const o = splitOptions(plan, plan.units[0]);
  assert.ok(o.elements && o.one && o.men);
  const secs = splitUnit(plan, 'pl', { kind: 'ELEMENTS' });
  assert.equal(secs.length, 3);
  assert.deepEqual(secs.map((s) => s.label), ['2 Pl / 1 Sec', '2 Pl / 2 Sec', '2 Pl / 3 Sec']);
  for (const s of secs) {
    assert.equal(s.splitFrom, 'pl');
    assert.equal(s.strength, 10);
    assert.ok(s.area && s.area.length >= 8);
  }
  let book = strengthBook(plan);
  assert.equal(book.get('pl')!.effective, 5);
  assert.equal(book.get('pl')!.weapons.LMG ?? 0, 0);
  assert.equal(book.get('pl')!.weapons.MG, 1);
  assert.equal(book.get('pl')!.weapons.RL, 2);
  // total personnel conserved
  const total = [...book.values()].reduce((m, e) => m + e.effective, 0);
  assert.equal(total, 35);
  // no more elements to split off
  assert.equal(splitOptions(plan, plan.units[0]).elements, false);
  mergeBack(plan, secs[1].id);
  book = strengthBook(plan);
  assert.equal(plan.units.length, 3);
  assert.equal(book.get('pl')!.effective, 15);
  removeUnits(plan, ['pl']);
  assert.equal(plan.units.length, 0, 'removing the origin removes its split elements');
});

test('task org: detach N men as an LP found from the pl', () => {
  const plan = planOf([unit({ id: 'pl', templateKey: 'RIFLE_PL', label: '1 Pl' })]);
  const [lp] = splitUnit(plan, 'pl', { kind: 'MEN', men: 3, role: 'LP' });
  assert.equal(lp.templateKey, 'LP');
  assert.equal(lp.parentId, 'pl');
  assert.equal(lp.strength, 3);
  assert.equal(strengthBook(plan).get('pl')!.effective, 32);
  assert.equal(foundLabel(plan, lp), `${lp.label} — from 1 Pl (1+2)`);
});

test('task org: weapon dets split by weapon', () => {
  const plan = planOf([unit({ id: 'm', templateKey: 'MOR60_SEC', label: '60 Mor', role: 'SP_WPN' })]);
  assert.ok(splitOptions(plan, plan.units[0]).weapon);
  const [d] = splitUnit(plan, 'm', { kind: 'WEAPON' });
  const book = strengthBook(plan);
  assert.equal(book.get(d.id)!.weapons.MOR60, 1);
  assert.equal(book.get('m')!.weapons.MOR60, 1);
  assert.equal(book.get('m')!.effective + book.get(d.id)!.effective, 6);
  assert.equal(splitOptions(plan, plan.units[0]).weapon, false);
});

test('task org: legacy SP/LP deduction keeps the v1 rule', () => {
  const plan = planOf([
    unit({ id: 'pl', templateKey: 'RIFLE_PL' }),
    unit({ id: 'sp', templateKey: 'RIFLE_SEC', role: 'SP_PTL', parentId: 'pl' }),
    unit({ id: 'lp', templateKey: 'LP', role: 'LP', parentId: 'pl' }),
    unit({ id: 'lp2', templateKey: 'LP', role: 'LP', parentId: 'pl' }),
    unit({ id: 'lp3', templateKey: 'LP', role: 'LP', parentId: 'pl' }),
  ]);
  // 35 - 10 - 9 = 16 < half strength -> floored at 18
  assert.equal(strengthBook(plan).get('pl')!.effective, 18);
});

test('task org: groups stay consistent', () => {
  const plan = planOf([unit({ id: 'a', templateKey: 'RIFLE_PL', label: '2 Pl' }), unit({ id: 'b', templateKey: 'RR_DET', role: 'SP_WPN' }), unit({ id: 'c', templateKey: 'GLHMG_DET', role: 'SP_WPN' })]);
  const g = groupUnits(plan, ['a', 'b'])!;
  assert.equal(g.label, '2 Pl Gp');
  assert.equal(plan.units.find((u) => u.id === 'a')!.groupId, g.id);
  const g2 = groupUnits(plan, ['b', 'c'], 'Wpn Gp')!;
  assert.deepEqual(plan.groups!.find((x) => x.id === g.id)!.memberIds, ['a']);
  assert.equal(plan.units.find((u) => u.id === 'b')!.groupId, g2.id);
  removeUnits(plan, ['a']);
  pruneGroups(plan);
  assert.equal(plan.groups!.length, 1);
  ungroup(plan, g2.id);
  assert.equal(plan.groups, undefined);
  assert.ok(plan.units.every((u) => !u.groupId));
});

test('task org: default found-by picks a fwd locality for LPs and depth for SPs', () => {
  const plan = planOf([
    unit({ id: 'f1', templateKey: 'RIFLE_PL', pos: { x: 0, y: 0 } }),
    unit({ id: 'f2', templateKey: 'RIFLE_PL', pos: { x: 1000, y: 0 } }),
    unit({ id: 'd', templateKey: 'RIFLE_PL', role: 'DEPTH', pos: { x: 500, y: -600 } }),
  ]);
  assert.equal(defaultFoundBy(plan, 'LP', { x: 900, y: 400 }), 'f2');
  assert.equal(defaultFoundBy(plan, 'SP_PTL', { x: 900, y: 1400 }), 'd');
});

test('sim: split elements become their own units and are deducted from the origin', () => {
  const s = presetBic49();
  const plan = autoPlan(s);
  assert.ok(plan.units.filter((u) => isAreaUnit(u)).every((u) => u.area && u.area.length >= 8), 'DS plan has eggs');
  const pl = plan.units.find((u) => u.templateKey === 'RIFLE_PL' && u.role === 'FDL')!;
  const secs = splitUnit(plan, pl.id, { kind: 'ELEMENTS' });
  const e = new Engine(s, plan, { seed: 1, fog: 'FULL', interactive: false, difficulty: 'STANDARD' });
  const origin = e.byId.get(pl.id)!;
  const book = strengthBook(plan);
  assert.equal(origin.strength, book.get(pl.id)!.effective);
  for (const sec of secs) {
    const su = e.byId.get(sec.id)!;
    assert.equal(su.strength, 10);
    assert.equal(su.weapons.LMG, 2);
  }
  assert.equal(origin.weapons.LMG ?? 0, 0);
  // found-from shows in the sim label
  const lp = plan.units.find((u) => u.role === 'LP' && u.parentId)!;
  assert.match(e.byId.get(lp.id)!.label, / fm /);
  // locality footprint comes from the egg (default egg = template radius)
  const dep = plan.units.find((u) => u.role === 'DEPTH')!;
  assert.ok(Math.abs(e.byId.get(dep.id)!.radius - TEMPLATES[dep.templateKey].radius) < 3);
});

test('sim: a larger hand-drawn area widens the footprint within bounds', () => {
  const s = presetBic49();
  const plan = autoPlan(s);
  const pl = plan.units.find((u) => u.templateKey === 'RIFLE_PL' && u.role === 'FDL')!;
  setUnitArea(pl, scaleAlong(unitArea(pl), pl.pos, { x: 1, y: 0 }, 1.8, 1.2));
  const e = new Engine(s, plan, { seed: 1, fog: 'FULL', interactive: false, difficulty: 'STANDARD' });
  const r = e.byId.get(pl.id)!.radius;
  assert.ok(r > TEMPLATES.RIFLE_PL.radius * 1.3 && r <= TEMPLATES.RIFLE_PL.radius * 2, `radius ${r}`);
});

test('task org: a second detachment is sited clear of the first; secs spread over a resized locality', () => {
  const plan = planOf([unit({ id: 'pl', templateKey: 'RIFLE_PL', label: '1 Pl' })]);
  const [lp] = splitUnit(plan, 'pl', { kind: 'MEN', men: 3, role: 'LP' });
  const [op] = splitUnit(plan, 'pl', { kind: 'MEN', men: 3, role: 'OP' });
  assert.ok(dist(lp.pos, op.pos) >= 60, 'OP not stacked on the LP');
  // widen the pl egg to twice its frontage: the secs follow the drawn outline
  const pl = plan.units[0];
  const a0 = unitArea(pl);
  setUnitArea(pl, scaleAlong(a0, areaCentroid(a0), { x: 1, y: 0 }, 2, 1));
  const secs = splitUnit(plan, 'pl', { kind: 'ELEMENTS' });
  const spread = Math.abs(secs[0].pos.x - secs[1].pos.x);
  const { front } = defaultEggAxes('RIFLE_PL');
  assert.ok(spread > front * 2.0, `secs spread ${spread} m over a ${front * 4} m frontage`);
});

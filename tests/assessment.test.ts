import { test } from 'node:test';
import assert from 'node:assert/strict';
import { presetBic49 } from '../src/scenario/presetBic49';
import { generateScenario } from '../src/scenario/generator';
import { autoPlan, emptyPlan } from '../src/plan/plan';
import { assessPlan } from '../src/assess/plan';
import { evaluateDecision } from '../src/assess/decisions';
import { finalScore } from '../src/assess/wargame';
import { gradeFor } from '../src/core/doctrine';
import { sha256 } from '../src/store/auth';
import type { OpsLevel } from '../src/core/types';

test('plan marking: DS-style plan scores high, empty plan scores near zero', () => {
  const s = presetBic49();
  const ds = assessPlan(s, autoPlan(s));
  assert.ok(ds.pct >= 85, `DS plan ${ds.pct.toFixed(1)}%`);
  const none = assessPlan(s, emptyPlan());
  assert.ok(none.pct < 10, `empty plan ${none.pct.toFixed(1)}%`);
  // every item carries a doctrinal reference and a score in [0, 1]
  for (const i of ds.items) {
    assert.ok(i.score >= 0 && i.score <= 1, i.id);
    assert.ok(i.ref, `${i.id} has a reference`);
  }
});

test('plan marking: a degraded plan scores between the empty and DS plans', () => {
  const s = presetBic49();
  const good = autoPlan(s);
  const poor = JSON.parse(JSON.stringify(good)) as typeof good;
  poor.graphics = poor.graphics.filter((g) => g.kind === 'FDL');
  poor.units = poor.units.filter((u) => !['SP_PTL', 'LP', 'SCREEN'].includes(u.role));
  poor.qcSorties = [];
  const a = assessPlan(s, poor).pct;
  assert.ok(a < assessPlan(s, good).pct - 15, `poor ${a.toFixed(1)}%`);
  assert.ok(a > assessPlan(s, emptyPlan()).pct);
});

for (const level of ['PL', 'COY', 'BN', 'BDE'] as OpsLevel[]) {
  test(`plan marking: auto plan on generated ${level} scenario passes`, () => {
    const s = generateScenario({ level, terrain: 'PLAINS', seed: 42 });
    const r = assessPlan(s, autoPlan(s));
    assert.ok(r.pct >= 75, `${level} auto plan ${r.pct.toFixed(1)}%`);
  });
}

test('decision evaluator follows doctrine', () => {
  assert.equal(evaluateDecision('SCREEN_CONTACT', 'ENGAGE_WITHDRAW', {}).verdict, 'BEST');
  assert.equal(evaluateDecision('SCREEN_CONTACT', 'HOLD_ALL_COSTS', {}).verdict, 'WRONG');
  assert.equal(evaluateDecision('EN_PROBE', 'MIN_FIRE_ALT', {}).verdict, 'BEST');
  assert.notEqual(evaluateDecision('EN_PROBE', 'ALL_WPNS', {}).verdict, 'BEST');
  const v = evaluateDecision('EN_PROBE', 'ALL_WPNS', {});
  assert.ok(v.rationale.length > 10 && v.ref.length > 0);
});

test('final score and grades', () => {
  assert.equal(gradeFor(90).grade, 'A+');
  assert.equal(gradeFor(80).grade, 'A');
  assert.equal(gradeFor(65).grade, 'B');
  assert.equal(gradeFor(55).grade, 'C');
  assert.equal(gradeFor(10).grade, 'D');
  const f = finalScore(80, 60, 0.5, 0);
  assert.equal(f.pct, 70);
  assert.equal(finalScore(100, 100, 0.5, 20).pct, 100, 'clamped at 100');
});

test('sha256 matches known vectors', () => {
  assert.equal(sha256(''), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  assert.equal(sha256('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.equal(sha256('a'.repeat(1000)), '41edece42d63e8d9bf515a9ba6932e1c20cbc9f5a5d134645adb5db1b9737ea3');
});

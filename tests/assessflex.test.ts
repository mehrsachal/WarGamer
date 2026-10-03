// Flexible (graded) marking, composable contingencies, richer injects and decision UX logic.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { presetBic49 } from '../src/scenario/presetBic49';
import { autoPlan, emptyPlan } from '../src/plan/plan';
import { applyMarking, applyOverrides, assessPlan, assessPlanAsync, kendallTauB, RUBRIC } from '../src/assess/plan';
import { evaluateCustom, evaluateDecision, evaluateResponse } from '../src/assess/decisions';
import { setTextJudge, type TextJudge } from '../src/assess/textJudge';
import { CONTINGENCIES, EXTRA_SITUATIONS, choiceActions, inferActions, setChoiceActions } from '../src/plan/contingency';
import { Engine } from '../src/sim/engine';
import { drawnInjects } from '../src/sim/injects';
import type { Plan } from '../src/core/types';

const s = presetBic49();
const good = autoPlan(s);

function shifted(p: Plan, dx: number, dy: number): Plan {
  const q: Plan = JSON.parse(JSON.stringify(p));
  for (const u of q.units) {
    u.pos = { x: u.pos.x + dx, y: u.pos.y + dy };
    if (u.altPos) u.altPos = { x: u.altPos.x + dx, y: u.altPos.y + dy };
  }
  for (const g of q.graphics) g.pts = g.pts.map((pt) => ({ x: pt.x + dx, y: pt.y + dy }));
  return q;
}

function poorPlan(): Plan {
  const poor: Plan = JSON.parse(JSON.stringify(good));
  poor.graphics = poor.graphics.filter((g) => g.kind === 'FDL');
  poor.units = poor.units.filter((u) => !['SP_PTL', 'LP', 'SCREEN'].includes(u.role));
  poor.qcSorties = [];
  return poor;
}

test('graded marking: DS high, empty near zero, a sound alternative well above a poor plan', () => {
  const ds = assessPlan(s, good).pct;
  const empty = assessPlan(s, emptyPlan()).pct;
  // the same scheme of manoeuvre sited on other gr: 150 m to the flank and 300 m back
  const alt = assessPlan(s, shifted(good, 150, -300)).pct;
  const poor = assessPlan(s, poorPlan()).pct;
  assert.ok(ds >= 85, `DS ${ds.toFixed(1)}`);
  assert.ok(empty < 10, `empty ${empty.toFixed(1)}`);
  assert.ok(alt >= 80, `alternative ${alt.toFixed(1)}`);
  assert.ok(alt > poor + 15, `alternative ${alt.toFixed(1)} vs poor ${poor.toFixed(1)}`);
  // partial credit: scores are graded, not all 0 / 1
  const r = assessPlan(s, shifted(good, 150, -600));
  assert.ok(r.items.some((i) => i.score > 0.05 && i.score < 0.95), 'some items get partial credit');
  for (const i of r.items) {
    assert.ok(i.score >= 0 && i.score <= 1, i.id);
    if (i.verdict !== 'NA') assert.ok(i.band, `${i.id} has a band`);
    if (i.score < 0.85 && i.verdict !== 'NA') assert.ok(i.tip, `${i.id} has advice`);
  }
});

test('graded marking: ceding gr is penalised progressively', () => {
  const pct = (dy: number) => assessPlan(s, shifted(good, 0, dy)).items.find((i) => i.id === 'FWD')!.score;
  assert.ok(pct(0) >= pct(-500) && pct(-500) > pct(-1000) && pct(-1000) > pct(-1800), `${pct(0)} ${pct(-500)} ${pct(-1000)} ${pct(-1800)}`);
});

test('strictness scales the tolerances', () => {
  const p = shifted(good, 200, -700);
  const lenient = assessPlan(s, p, { marking: { strictness: 'LENIENT' } }).pct;
  const std = assessPlan(s, p).pct;
  const strict = assessPlan(s, p, { marking: { strictness: 'STRICT' } }).pct;
  assert.ok(lenient > std && std > strict, `${lenient.toFixed(1)} > ${std.toFixed(1)} > ${strict.toFixed(1)}`);
});

test('group weights and disabled items', () => {
  const p = poorPlan();
  const base = assessPlan(s, p);
  const noFire = assessPlan(s, p, { marking: { strictness: 'STANDARD', groupWeights: { 'Fire plan': 0, 'Obs plan': 0 } } });
  assert.ok(!noFire.groups.some((g) => g.group === 'Fire plan'), 'zero-weight group dropped');
  assert.ok(noFire.pct > base.pct, 'removing the weak groups raises the score');
  const heavy = assessPlan(s, p, { marking: { strictness: 'STANDARD', groupWeights: { 'Fire plan': 2 } } });
  assert.ok(heavy.pct < base.pct, 'weighting a weak group lowers the score');
  const off = assessPlan(s, p, { marking: { strictness: 'STANDARD', disabled: ['SOS', 'KA'] } });
  assert.ok(!off.items.some((i) => i.id === 'SOS' || i.id === 'KA'), 'disabled items removed');
  assert.ok(off.pct > base.pct);
  // applyMarking is idempotent on the defaults
  assert.equal(applyMarking(base.items).pct.toFixed(6), base.pct.toFixed(6));
  // the catalogue covers every item the rubric produces
  const ids = new Set(RUBRIC.map((r) => r.id));
  for (const i of assessPlan(s, good).items) assert.ok(ids.has(i.id), `${i.id} in RUBRIC`);
});

test('ordering questions use rank correlation with ties and partial orders', () => {
  const ds = { a: 1, b: 2, c: 3 };
  assert.equal(kendallTauB(['a', 'b', 'c'], undefined, ds), 1);
  assert.equal(kendallTauB(['c', 'b', 'a'], undefined, ds), -1);
  const tie = kendallTauB(['a', 'b', 'c'], [1, 2, 2], ds);
  assert.ok(tie > 0.7 && tie < 1, `tie ${tie}`);
  const partial = kendallTauB(['a'], undefined, ds);
  assert.ok(partial > 0.5 && partial < 1, `partial ${partial}`);
  // a near-miss order earns most of the marks
  const p: Plan = JSON.parse(JSON.stringify(good));
  const [x, y, ...rest] = p.appreciation.approachOrder;
  p.appreciation.approachOrder = [x, ...rest, y];
  const near = assessPlan(s, p).items.find((i) => i.id === 'APCH_PRI')!.score;
  assert.ok(near > 0.6 && near < 1, `near-miss ${near}`);
});

test('contingency combinations: best > partial > conflicting; several sound sets', () => {
  const ctx = { threatOffAxis: true, altPlanned: 2, sosPlanned: true };
  const best = evaluateResponse('EN_ASSAULT', { actions: ['SOS', 'READJUST_ALT', 'HOLD_FIRE_KA', 'REPORT'] }, ctx).score;
  const partial = evaluateResponse('EN_ASSAULT', { actions: ['SOS', 'REPORT'] }, ctx).score;
  const conflicting = evaluateResponse('EN_ASSAULT', { actions: ['SOS', 'HOLD_FIRE_KA', 'ALL_WPNS', 'DEPTH_FWD'] }, ctx).score;
  assert.ok(best > partial && partial > conflicting, `${best} > ${partial} > ${conflicting}`);
  assert.equal(evaluateResponse('EN_ASSAULT', { actions: ['SOS', 'READJUST_ALT', 'HOLD_FIRE_KA', 'REPORT'] }, ctx).verdict, 'BEST');
  // two different sound responses to an armr conc both reach BEST
  const c2 = { dfNearFaa: true, armourSeen: true, ucavLeft: 1, aqcAvail: true };
  assert.equal(evaluateResponse('EN_ASSEMBLY', { actions: ['DF_FAA', 'QC_SURV', 'STAND_TO', 'REPORT'] }, c2).verdict, 'BEST');
  assert.equal(evaluateResponse('EN_ASSEMBLY', { actions: ['DF_FAA', 'UCAV', 'REPORT'] }, c2).verdict, 'BEST');
  // withdraw-all conflicts with holding
  const lost = evaluateResponse('LOCALITY_LOST', { actions: ['HOLD_FAST', 'CPEN', 'WITHDRAW_ALL'] }, {});
  assert.ok(lost.score < 0.3 && lost.gaps!.some((g) => /contradicts/i.test(g)));
  // the essential action missing caps the score
  assert.ok(evaluateResponse('EN_ASSAULT', { actions: ['READJUST_ALT', 'HOLD_FIRE_KA', 'REPORT', 'RECALL_LP'] }, ctx).score <= 0.45);
  // every extra situation has a sound quick pick that reaches BEST and an unsound one that does not
  for (const d of EXTRA_SITUATIONS) {
    const sound = evaluateResponse(d.key, { actions: d.legacy[d.options[0].id] }, { located: true, altAvailable: true });
    const bad = evaluateResponse(d.key, { actions: d.legacy[d.options[d.options.length - 1].id] }, {});
    assert.ok(sound.score >= 0.85, `${d.key} sound ${sound.score}`);
    assert.ok(bad.score < sound.score, `${d.key} unsound`);
  }
});

test('free text: understood as actions, negations respected, modest bonus, never a penalty', () => {
  assert.deepEqual(inferActions('Do not withdraw; hold fast and call DF on the FUP').sort(), ['DF_FUP', 'HOLD_FAST']);
  const acts = ['SOS', 'HOLD_FIRE_KA'];
  const without = evaluateResponse('EN_ASSAULT', { actions: acts }, { threatOffAxis: false, sosPlanned: true }).score;
  const withText = evaluateResponse('EN_ASSAULT', { actions: acts, text: 'Call DF SOS, hold fire till the killing area, recall LPs and inform higher HQ.' }, { threatOffAxis: false, sosPlanned: true }).score;
  assert.ok(withText >= without, 'text never lowers the score');
  const textOnly = evaluateResponse('EN_FORMING_UP', { actions: [], text: 'Spoiling attack by fire on the FUP with the standing patrol and DF on the FUP; standing patrol keeps observing.' }, { spInRange: true });
  assert.ok(textOnly.score >= 0.55 && textOnly.understood!.includes('SPOIL_FIRE'), `text only ${textOnly.score}`);
  assert.equal(evaluateResponse('EN_ASSAULT', { actions: [] }, {}).score, 0);
});

test('backward compatibility: v1 {option} plans mark like the equivalent actions', () => {
  const v1: Plan = JSON.parse(JSON.stringify(good));
  for (const k of Object.keys(v1.contingency)) delete v1.contingency[k].actions;
  const v2: Plan = JSON.parse(JSON.stringify(good));
  for (const d of CONTINGENCIES) if (v2.contingency[d.key]) v2.contingency[d.key] = setChoiceActions(d.key, v2.contingency[d.key], choiceActions(d.key, v2.contingency[d.key]));
  const a = assessPlan(s, v1).items.filter((i) => i.id.startsWith('CONT_'));
  const b = assessPlan(s, v2).items.filter((i) => i.id.startsWith('CONT_'));
  assert.deepEqual(a.map((i) => i.score.toFixed(4)), b.map((i) => i.score.toFixed(4)));
  // the comma-joined reorg list of v1 still works
  assert.equal(evaluateDecision('REORG', 'CASEVAC_CHAIN,BUDDY_AID,AMMO_REDIST,AMMO_REPLEN,REPLACE_WPNS,RESITE_WPNS,MANPOWER,RE_SURV,SITREP,MORALE', {}).verdict, 'BEST');
  assert.equal(evaluateDecision('REORG', 'STAND_DOWN,EVAC_DEAD_FIRST', {}).verdict, 'WRONG');
  // legacy single options keep their doctrinal verdicts
  assert.equal(evaluateDecision('POST_LOST', 'LOCAL_CATK', { delay: 10, depthAvailable: true }).verdict, 'BEST');
  assert.equal(evaluateDecision('POST_LOST', 'WITHDRAW', {}).verdict, 'WRONG');
  assert.notEqual(evaluateDecision('POST_LOST', 'LOCAL_CATK', { delay: 60, depthAvailable: true }).verdict, 'BEST');
});

test('own contingencies are marked (modest weight) and pre-load the inject', () => {
  const p: Plan = JSON.parse(JSON.stringify(good));
  p.customContingencies = [{ id: 'c1', trigger: 'EN_ARTY', situation: 'Hy shelling on 2 Pl before H hr', actions: ['TAKE_COVER', 'CB_REQ', 'STAND_BY_LIFT', 'REPORT'], text: '' }];
  const it = assessPlan(s, p).items.find((i) => i.id === 'CONT_CUSTOM');
  assert.ok(it && it.weight <= 1.5 && it.score >= 0.8, `custom ${it?.score}`);
  const other = evaluateCustom({ id: 'c2', trigger: 'OTHER', situation: 'En heliborne landing in depth', actions: ['REPORT', 'HOLD_FAST', 'WITHDRAW_ALL'], text: '' });
  const other2 = evaluateCustom({ id: 'c3', trigger: 'OTHER', situation: 'En heliborne landing in depth', actions: ['REPORT', 'HOLD_FAST', 'DF_TGT', 'STAND_TO'], text: '' });
  assert.ok(other2.score > other.score);
});

test('instructor overrides apply and can be removed', () => {
  const a = assessPlan(s, poorPlan());
  const o = applyOverrides(a, { 'plan:SOS': { score: 1, note: 'SOS given verbally' } }, 'plan');
  assert.ok(o.pct > a.pct);
  const sos = o.items.find((i) => i.id === 'SOS')!;
  assert.equal(sos.score, 1);
  assert.equal(sos.auto, 0);
  const back = applyOverrides(o, {}, 'plan');
  assert.equal(back.pct.toFixed(6), a.pct.toFixed(6));
});

test('async marking uses the registered text judge for free text', async () => {
  const p: Plan = JSON.parse(JSON.stringify(good));
  p.appreciation.text.ground = 'The Western apch is the most suitable for the en.';
  const offline = (await assessPlanAsync(s, p)).items.find((i) => i.id === 'APRC_TEXT')!.score;
  const mock: TextJudge = { judge: async (reqs) => reqs.map(() => ({ score: 1, note: 'Excellent.', covered: [0], source: 'AI' as const })) };
  setTextJudge(mock);
  try {
    const ai = (await assessPlanAsync(s, p)).items.find((i) => i.id === 'APRC_TEXT')!;
    assert.ok(ai.score > offline, `${ai.score} > ${offline}`);
    assert.match(ai.detail, /AI judge/);
  } finally {
    setTextJudge(null);
  }
  // the sync variant stays offline and deterministic
  assert.equal(assessPlan(s, p).pct, assessPlan(s, p).pct);
});

test('new injects are seeded: deterministic per seed, varied across seeds', () => {
  const draw = (seed: number) => drawnInjects(new Engine(s, good, { seed, fog: 'FULL', interactive: false, difficulty: 'STANDARD' }));
  assert.deepEqual(draw(11), draw(11));
  const sets = new Set([1, 2, 3, 4, 5, 6].map((sd) => draw(sd).join(',')));
  assert.ok(sets.size >= 4, `varied draws (${sets.size})`);
  for (const sd of [1, 2]) {
    const e = new Engine(s, good, { seed: sd, fog: 'FULL', interactive: false, difficulty: 'STANDARD' });
    e.runToEnd();
    const extra = e.decisions.filter((d) => EXTRA_SITUATIONS.some((x) => x.key === d.key));
    assert.ok(extra.length >= 1, `seed ${sd}: extra injects raised`);
    // not pre-planned and auto mode: handled by SOPs and not marked
    assert.ok(extra.every((d) => d.unmarked && d.source === 'SOP'));
  }
});

test('decision UX: composed response, act on map, no action', () => {
  const e = new Engine(s, good, { seed: 5, fog: 'FULL', interactive: true, difficulty: 'STANDARD' });
  assert.equal(e.runUntil(e.endT), 'DECISION');
  const p = e.pending!;
  assert.ok(p.actions && p.actions.length > 3, 'actions offered');
  assert.ok(p.preplannedActions && p.preplannedActions.length, 'pre-loaded from the contingency plan');
  // act on the map: the battle stays paused while orders are given
  e.actOnMap();
  const t0 = e.t;
  e.step();
  assert.equal(e.t, t0, 'paused while acting on the map');
  const screen = e.blue().find((u) => u.role === 'SCREEN');
  if (p.key === 'SCREEN_CONTACT' && screen) e.order({ type: 'WITHDRAW', unitId: screen.id });
  e.resumeFromMap('Screens engage at long range then withdraw on permission.');
  assert.equal(e.pending, null);
  const rec = e.decisions[e.decisions.length - 1];
  assert.equal(rec.source, 'MAP');
  if (p.key === 'SCREEN_CONTACT' && screen) assert.ok(rec.actions!.includes('WD_ON_ORDER'), rec.actions!.join(','));
  // next decision: no action is recorded and marked as such
  if (e.runUntil(e.endT) === 'DECISION') {
    e.decide({ option: '', actions: [], source: 'MODAL' });
    const r2 = e.decisions[e.decisions.length - 1];
    assert.equal(r2.score, 0);
    assert.match(r2.rationale, /No action/);
  }
});

// Decision injects (DS-style "REQs" during the wargame). Each fires once when BLUE
// perceives the situation; pauses for the student (interactive) or applies the
// pre-planned contingency (auto). The response is a composed set of actions + free text
// (or the orders the student gives on the map), marked against the actual situation.
//
// Besides the core situations of the contingency plan, every battle draws a seeded subset
// of further injects (en arty on a locality, comms lost, a gap on a flank, CHQ hit, cas evac
// under fire, amn low, EW jamming, an en UAV overhead, civilians on the axis) so that no two
// battles feel the same.

import { type Vec, angleDiff, bearing, dist } from '../core/geom';
import { Rng } from '../core/rng';
import { evaluateResponse, describeResponse, verdictOf, type DecisionContext } from '../assess/decisions';
import { ACTIONS, actionText, choiceActions, contingencyDef, customFor, inferActions, quickPickFor } from '../plan/contingency';
import { launchCatk, moveTo, recallLps, withdrawToMain } from './blue';
import { alive, type Engine } from './engine';
import { fireDf, fireOnPoint, launchAttackQc, requestUcav } from './fires';
import type { DecisionInput, ManualOrder, PendingDecision, SimUnit } from './types';

/** Sim minutes after a decision during which manual orders still count towards it. */
export const MAP_WINDOW_MIN = 10;

/** Inject-only situations a battle may draw from. */
export const EXTRA_INJECTS = ['EN_ARTY', 'COMMS_LOST', 'FLANK_GAP', 'CHQ_HIT', 'CASEVAC', 'AMMO_LOW', 'EW_JAM', 'EN_UAV', 'CIVILIANS'] as const;

interface InjectState {
  rng: Rng;
  /** Inject-only situations drawn for this battle, with the earliest time each may fire. */
  extras: Map<string, number>;
  lastExtra: number;
  comms?: { unitId: string; until: number };
  replen?: { unitId: string; at: number; amount: number };
  /** C2 disrupted (CHQ hit without a hand-over) until this time: C attks launch later. */
  c2Until?: number;
  /** Manual orders given during the battle. */
  manual: { t: number; o: ManualOrder }[];
  /** Late orders still count towards this decision. */
  window?: { rec: number; key: string; until: number; ctx: DecisionContext; text?: string; actions: string[] };
}

const STATE = new WeakMap<Engine, InjectState>();

function st(e: Engine): InjectState {
  let s = STATE.get(e);
  if (!s) {
    const rng = new Rng((e.opts.seed * 7919 + 104729) >>> 0);
    const lvl = e.s.level;
    const pool = EXTRA_INJECTS.filter((k) => contingencyDef(k).levels.includes(lvl)).filter((k) => (k === 'EW_JAM' ? e.s.enemy.ewThreat !== 'LOW' : k === 'EN_UAV' ? e.s.enemy.airThreat !== 'LOW' : true));
    rng.shuffle(pool);
    const n = Math.min(pool.length, rng.int(3, 4));
    const extras = new Map<string, number>();
    const cross = e.s.times.enCrossBorder;
    const h = e.hHour;
    for (const k of pool.slice(0, n)) {
      const at =
        k === 'EW_JAM' ? rng.int(cross + 60, Math.max(cross + 61, h - 60))
        : k === 'EN_UAV' ? rng.int(cross + 30, Math.max(cross + 31, h - 120))
        : k === 'CIVILIANS' ? rng.int(cross + 20, Math.max(cross + 21, h - 150))
        : k === 'COMMS_LOST' ? h + rng.int(-60, 25)
        : k === 'FLANK_GAP' ? h + rng.int(15, 70)
        : k === 'CHQ_HIT' ? h + rng.int(-20, 45)
        : cross;
      extras.set(k, at);
    }
    s = { rng, extras, lastExtra: -9999, manual: [] };
    STATE.set(e, s);
  }
  return s;
}

/** The inject-only situations drawn for this battle (seeded; for tests and the AAR). */
export function drawnInjects(e: Engine): string[] {
  return [...st(e).extras.keys()];
}

function contactsNear(e: Engine, p: Vec, r: number, minConf = 0.35) {
  return [...e.contacts.values()].filter((c) => c.conf >= minConf && dist(c.pos, p) <= r);
}

function depthForce(e: Engine): SimUnit | undefined {
  const inf = e.blue().filter((u) => (u.role === 'DEPTH' || u.role === 'RES') && (u.kind === 'INF') && !u.catk && u.strength / u.start > 0.5);
  // prefer the planned C attk force
  const planned = e.plan.contingency.POST_LOST?.unitId;
  return inf.find((u) => u.id === planned) ?? inf.sort((a, b) => b.strength - a.strength)[0];
}

function lostLocality(e: Engine): SimUnit | undefined {
  const id = e.flags.lastLostLocality as string | undefined;
  return id ? e.byId.get(id) : undefined;
}

function fwdLocalities(e: Engine): SimUnit[] {
  return e.blue().filter((u) => (u.role === 'FDL' || u.role === 'DEPTH') && u.kind === 'INF' && u.state !== 'WITHDRAW');
}

function fire(e: Engine, key: string, prompt: string, ctx: DecisionContext & Record<string, unknown>, focus?: Vec, unitChoices?: { id: string; label: string }[]): void {
  e.fired.add(key);
  const def = contingencyDef(key);
  const pre = e.plan.contingency[key];
  const own = customFor(e.plan.customContingencies, key);
  const preActions = pre ? choiceActions(key, pre) : own ? own.actions : [];
  const preText = pre?.text ?? own?.text;
  const p: PendingDecision = {
    key,
    title: def.title,
    prompt: `${e.timeStr()}: ${prompt}`,
    situation: prompt,
    options: def.options.map((o) => ({ id: o.id, text: o.text, needsUnit: !!def.needsUnit && (o.id === 'LOCAL_CATK' || o.id === 'SPOIL_FIRE'), needsDelay: def.needsDelay && o.id === 'LOCAL_CATK' })),
    actions: def.actions.map((id) => ({ id, cat: ACTIONS[id].cat, text: actionText(id, key), param: ACTIONS[id].param })),
    multi: def.multi,
    preplanned: pre?.option || (own ? quickPickFor(key, own.actions) ?? own.actions.join(',') : undefined),
    preplannedActions: preActions,
    preplannedText: preText,
    planned: !!(preActions.length || preText?.trim()),
    core: def.core,
    preplannedDelay: pre?.delayMin,
    preplannedUnit: pre?.unitId,
    preplannedDf: pre?.dfId,
    unitChoices,
    time: e.t,
    focus,
    context: ctx,
  };
  e.addLog(`DECISION — ${def.title}: ${prompt}`, 'warn');
  if (e.opts.interactive) e.pending = p;
  else applyDecision(e, p, e.preplannedInput(p));
}

export function checkInjects(e: Engine): void {
  const S = st(e);
  tickEffects(e, S);
  if (e.pending || e.over) return;
  const t = e.t;
  const blue = e.blue();

  // ---- screen battle
  if (!e.fired.has('SCREEN_CONTACT')) {
    const screens = blue.filter((u) => u.role === 'SCREEN');
    const hit = screens.find((s) => contactsNear(e, s.pos, 1800, 0.3).length || s.phaseCas > 0);
    if (hit) {
      const cs = contactsNear(e, hit.pos, 1800, 0.3);
      fire(e, 'SCREEN_CONTACT', `${hit.label} ${e.where(hit.pos)} reports contact with en adv elms (${cs.length} gp${cs.length === 1 ? '' : 's'}) ${cs[0] ? e.where(cs[0].pos) : ''}. Orders for the screens?`, { screens: screens.length }, hit.pos);
      return;
    }
  }

  // ---- en recce / probing
  if (!e.fired.has('EN_PROBE') && e.marks.probeStart) {
    const prober = e.red().find((r) => r.probing);
    const c = prober ? e.contacts.get(prober.id) : undefined;
    if (prober && c && c.conf >= 0.3 && e.fdlDistance(c.pos) < 1000) {
      fire(e, 'EN_PROBE', `En ptl (${c.size === 'UNKNOWN' ? 'small gp' : c.size.toLowerCase()}) seen moving towards the FDLs ${e.where(c.pos)}, apparently to locate wpns and mfd lanes. Your action?`, {}, c.pos);
      return;
    }
  }

  // ---- en assembly in the FAA
  if (!e.fired.has('EN_ASSEMBLY') && (e.redPhase === 'ASSEMBLY' || e.redPhase === 'FUP')) {
    const cs = contactsNear(e, e.redPlan.faa, 900, 0.4);
    const armour = cs.some((c) => c.ident === 'ARMOUR');
    if (cs.length >= 2 || armour) {
      const ctx: DecisionContext = {
        dfNearFaa: !!e.dfNear(e.redPlan.faa, 450),
        armourSeen: armour,
        ucavLeft: e.ucavLeft,
        aqcAvail: e.qcs.some((q) => q.kind === 'ATTACK' && !q.lost && q.usedStrikes === 0),
      };
      fire(e, 'EN_ASSEMBLY', `${cs[0].by} reports en assembling in strength${armour ? ' incl tks' : ''} ${e.where(cs[0].pos)}. Your action?`, ctx, cs[0].pos);
      return;
    }
  }

  // ---- en forming up (REQ 2)
  if (!e.fired.has('EN_FORMING_UP') && e.redPhase === 'FUP' && e.marks.fupFormed) {
    const cs = contactsNear(e, e.redPlan.fup, 700, 0.4);
    if (cs.length) {
      const sp = blue.filter((u) => u.role === 'SP_PTL').sort((a, b) => dist(a.pos, e.redPlan.fup) - dist(b.pos, e.redPlan.fup))[0];
      const spIn = sp && dist(sp.pos, e.redPlan.fup) <= 700 && e.terrain.los(sp.pos, e.redPlan.fup, 2, 1.5) > 0.2;
      const gl = blue.find((u) => (u.weapons.GLHMG ?? 0) > 0 && dist(u.pos, e.redPlan.fup) <= 1750 && e.terrain.los(u.pos, e.redPlan.fup, 2, 1.5) > 0.3);
      const ctx: DecisionContext = { spAvailable: !!sp && dist(sp.pos, e.redPlan.fup) < 1500, spInRange: !!spIn, glhmgInRange: !!gl, dfNearFup: !!e.dfNear(e.redPlan.fup, 400), depthAvailable: !!depthForce(e), aqcAvail: e.qcs.some((q) => q.kind === 'ATTACK' && !q.lost && q.usedStrikes === 0) };
      const choices = blue.filter((u) => u.kind === 'INF' && u.role !== 'LP').map((u) => ({ id: u.id, label: `${u.label} (${String(u.role).toLowerCase()})` }));
      fire(e, 'EN_FORMING_UP', `${cs[0].by} reports en tps${cs.some((c) => c.ident === 'ARMOUR') ? ' and tks' : ''} forming up for attk ${e.where(cs[0].pos)}. Assessment and action?`, ctx, cs[0].pos, choices);
      return;
    }
  }

  // ---- en assault (REQ 3)
  if (!e.fired.has('EN_ASSAULT') && e.redPhase === 'ASSAULT1') {
    const cs = [...e.contacts.values()].filter((c) => c.conf >= 0.3 && e.byId.get(c.unitId)?.state === 'ASSAULT' && e.fdlDistance(c.pos) < 2000);
    const underFire = blue.some((u) => (u.role === 'FDL') && u.supp > 0.25);
    if (cs.length || underFire) {
      const fdl = blue.filter((u) => u.role === 'FDL');
      const threatB = (u: SimUnit) => bearing(u.pos, cs[0]?.pos ?? e.redPlan.fup);
      const offAxis = fdl.some((u) => angleDiff(u.facing, threatB(u)) > 35);
      const ctx: DecisionContext = { altPlanned: fdl.filter((u) => !!u.altPos).length, threatOffAxis: offAxis, sosPlanned: e.dfs.some((d) => d.sos) };
      fire(e, 'EN_ASSAULT', `En (${cs.length ? cs.map((c) => (c.ident === 'ARMOUR' ? 'tks' : c.size.toLowerCase())).join(', ') : 'strength unknown'}) has crossed the SL ${cs[0] ? e.where(cs[0].pos) : ''}; BOF has opened fire on the fwd localities. Your action?`, ctx, cs[0]?.pos ?? e.redPlan.sl);
      return;
    }
  }

  // ---- loss of a post (REQ 4a)
  if (!e.fired.has('POST_LOST') && e.marks.firstElementLost) {
    const loc = lostLocality(e);
    if (loc) {
      const nLost = loc.elements.filter((x) => x.lost).length;
      const df = depthForce(e);
      const choices = blue.filter((u) => u.kind === 'INF' && u.id !== loc.id && u.role !== 'LP' && u.role !== 'SP_PTL').map((u) => ({ id: u.id, label: `${u.label} (${String(u.role).toLowerCase()}, ${Math.round((100 * u.strength) / u.start)}%)` }));
      const ctx: DecisionContext = {
        elementsLost: nLost,
        depthAvailable: !!df,
        catkPlanned: e.plan.graphics.some((g) => g.kind === 'CATK' && dist(g.pts[g.pts.length - 1], loc.pos) < 300),
      };
      (ctx as Record<string, unknown>).locId = loc.id;
      fire(e, 'POST_LOST', `${loc.label} reports en has captured ${nLost === 1 ? '1 x LMG bkr / sec' : `${nLost} secs`} ${e.where(loc.pos)} and is pressing hard. Options and recommended course?`, ctx, loc.pos, choices);
      return;
    }
  }

  // ---- loss of a locality (REQ 4b)
  if (!e.fired.has('LOCALITY_LOST')) {
    const cap = e.units.find((u) => u.side === 'BLUE' && u.state === 'CAPTURED' && (u.role === 'FDL' || u.role === 'DEPTH'));
    if (cap) {
      const ctx: DecisionContext = { depthAvailable: !!depthForce(e), cpenPlanned: e.plan.graphics.some((g) => g.kind === 'CPEN') };
      (ctx as Record<string, unknown>).locId = cap.id;
      fire(e, 'LOCALITY_LOST', `${cap.label} ${e.where(cap.pos)} has been overrun; en is reorganising on it. Your action?`, ctx, cap.pos);
      return;
    }
  }

  // ---- reorg (REQ 5)
  if (!e.fired.has('REORG')) {
    const failed = e.redPhase === 'FAILED' && t > (e.marks.attackFailed ?? e.marks.failedLogged ?? t) + 15;
    const consolidated = e.redPhase === 'CONSOLIDATE' && t > (e.marks.consolidated ?? t) + 30;
    const late = t >= e.endT - 25 && (e.marks.h1 ?? 0) > 0;
    const catkRunning = e.blue().some((u) => u.catk) || !!e.flags.higherCatk;
    if ((failed || consolidated) && !catkRunning || late) {
      fire(e, 'REORG', `The battle has died down. ${e.stats.blueCas > 0 ? `Own cas so far ${Math.round(e.stats.blueCas)}.` : ''} Select ALL actions for reorg, cas evac and amn replenishment.`, {});
      return;
    }
  }

  checkExtraInjects(e, S);
}

// ---------------------------------------------------------------------------- inject-only situations

function checkExtraInjects(e: Engine, S: InjectState): void {
  const t = e.t;
  if (t - S.lastExtra < 25 || e.redPhase === 'OVER' || e.marks.reorgDone) return;
  const ready = (k: string) => S.extras.has(k) && !e.fired.has(k) && t >= (S.extras.get(k) ?? 0);
  const go = (k: string, prompt: string, ctx: DecisionContext & Record<string, unknown>, focus?: Vec) => {
    S.lastExtra = t;
    fire(e, k, prompt, ctx, focus);
  };
  const locs = fwdLocalities(e);
  const assaulting = e.redPhase === 'ASSAULT1' || e.redPhase === 'ASSAULT2' || e.redPhase === 'REORG1';
  const day = e.light === 'DAY';

  if (ready('EN_ARTY') && t >= e.s.times.enCrossBorder) {
    for (const m of e.missions) {
      if (m.side !== 'RED' || t < m.start || t >= m.end) continue;
      const u = locs.find((x) => dist(x.pos, m.target) < 220 + x.radius * 0.5);
      if (!u) continue;
      const located = (e.redIntel.get(u.id)?.conf ?? 0) > 0.6;
      return go('EN_ARTY', `${u.label} ${e.where(u.pos)} reports hy en arty / mor fire falling on the locality${u.phaseCas > 0 ? ' with cas' : ''}. Your orders?`, { locId: u.id, located, altAvailable: !!u.altPos }, u.pos);
    }
  }
  if (ready('COMMS_LOST') && (assaulting || e.redPhase === 'FUP' || e.redPhase === 'ASSEMBLY')) {
    const fdl = locs.filter((u) => u.role === 'FDL');
    if (fdl.length) {
      const u = fdl[S.rng.int(0, fdl.length - 1)];
      S.comms = { unitId: u.id, until: Infinity };
      return go('COMMS_LOST', `Radio comms with ${u.label} ${e.where(u.pos)} have been lost — no reply on the coy net for 5 min.`, { locId: u.id }, u.pos);
    }
  }
  if (ready('FLANK_GAP') && assaulting) {
    const flank = e.s.own.flanks.length ? e.s.own.flanks[S.rng.int(0, e.s.own.flanks.length - 1)] : { side: S.rng.chance(0.5) ? 'L' : 'R', name: 'the flank sub-unit' };
    const fdl = locs.filter((u) => u.role === 'FDL').sort((a, b) => a.pos.x - b.pos.x);
    const u = flank.side === 'L' ? fdl[0] : fdl[fdl.length - 1];
    if (u) return go('FLANK_GAP', `Bn HQ: ${flank.name} on your ${flank.side === 'L' ? 'L' : 'R'} flank is falling back under pressure — a gap is opening next to ${u.label}.`, { locId: u.id, side: flank.side, altAvailable: !!u.altPos }, { x: u.pos.x + (flank.side === 'L' ? -500 : 500), y: u.pos.y });
  }
  if (ready('CHQ_HIT') && (assaulting || e.redPhase === 'FUP')) {
    const hq = e.blue().find((u) => u.role === 'CHQ');
    if (hq) {
      const cas = Math.min(3, Math.max(0, hq.strength - 2));
      if (cas > 0) e.inflict(hq, cas, 'En arty (CHQ hit)');
      return go('CHQ_HIT', `${hq.label} ${e.where(hq.pos)} has received a direct hit — the comd is a cas and the CP set is damaged.`, { locId: hq.id }, hq.pos);
    }
  }
  if (ready('CASEVAC') && assaulting) {
    const u = locs.find((x) => x.role === 'FDL' && x.strength / x.start < 0.85 && x.strength / x.start > 0.3);
    if (u) return go('CASEVAC', `${u.label} ${e.where(u.pos)}: ${Math.round(u.start - u.strength)} cas, several seriously wounded; requests cas evac. The locality is still under fire.`, { locId: u.id }, u.pos);
  }
  if (ready('AMMO_LOW') && assaulting) {
    const u = locs.filter((x) => x.role === 'FDL').sort((a, b) => a.ammo - b.ammo)[0];
    if (u && u.ammo < 0.7) {
      return go('AMMO_LOW', `${u.label} ${e.where(u.pos)} reports amn running low (${Math.round(u.ammo * 100)}% of first line left) — LMG nos particularly short.`, { locId: u.id }, u.pos);
    }
  }
  if (ready('EW_JAM')) return go('EW_JAM', 'The coy net is being jammed — music and a carrier on the main freq; messages to the pls are not getting through.', {});
  if (ready('EN_UAV') && day) {
    const u = locs.length ? locs[S.rng.int(0, locs.length - 1)] : undefined;
    if (u) return go('EN_UAV', `A small en UAV is circling at about 300 m over ${u.label} ${e.where(u.pos)}.`, { locId: u.id }, u.pos);
  }
  if (ready('CIVILIANS') && day) {
    const a = e.s.ds.approaches.find((x) => x.id === e.redPlan.approachId) ?? e.s.ds.approaches[0];
    const near = a?.path.map((p) => ({ p, d: e.fdlDistance(p) })).filter((x) => x.d > 500).sort((x, y) => x.d - y.d)[0]?.p;
    if (near) return go('CIVILIANS', `A column of about 60 civilians with carts is moving along the ${a.name} towards the posn ${e.where(near)}.`, {}, near);
  }
}

/** Continuing effects of inject responses (comms restoration, amn replenishment). */
function tickEffects(e: Engine, S: InjectState): void {
  if (S.comms) {
    const u = e.byId.get(S.comms.unitId);
    if (!u || !alive(u)) S.comms = undefined;
    else if (e.t >= S.comms.until) {
      e.addLog(`Comms restored with ${u.label}.`, 'good');
      S.comms = undefined;
    } else u.supp = Math.max(u.supp, 0.15);
  }
  if (S.replen && e.t >= S.replen.at) {
    const u = e.byId.get(S.replen.unitId);
    if (u && alive(u)) {
      u.ammo = Math.min(1, u.ammo + S.replen.amount);
      e.addLog(`Amn replenished at ${u.label} (carrying party from F ech).`, 'good');
    }
    S.replen = undefined;
  }
}

// ---------------------------------------------------------------------------- decisions

function sameSet(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((x) => b.includes(x));
}

export function applyDecision(e: Engine, p: PendingDecision, input: DecisionInput): void {
  const S = st(e);
  const key = p.key;
  const def = contingencyDef(key);
  const ctx = p.context as DecisionContext & Record<string, unknown>;
  const source = input.source ?? 'MODAL';
  const delay = (input.delayMin ?? 15) + (S.c2Until && e.t < S.c2Until ? 10 : 0);
  const chosen = input.unitId ? e.byId.get(input.unitId) : undefined;
  if (key === 'POST_LOST') {
    ctx.delay = Math.max(0, e.t - (e.marks.firstElementLost ?? e.t)) + delay;
    const df = depthForce(e);
    ctx.chosenUnitIsDepth = !chosen || (df ? chosen.id === df.id || chosen.role === 'DEPTH' || chosen.role === 'RES' : false);
  }
  const explicit = input.actions ?? choiceActions(key, { option: input.options?.length ? input.options.join(',') : input.option });
  const understood = inferActions(input.text, def.actions).filter((a) => !explicit.includes(a));
  const verdict = evaluateResponse(key, { actions: explicit, text: input.text }, ctx);
  // no contingency planned (auto mode): the sub-units act on SOPs — marked down for a core
  // situation, not marked for an inject-only one the student could not foresee
  const unmarked = source === 'SOP' && !p.core;
  if (source === 'SOP' && p.core) {
    verdict.score *= 0.5;
    verdict.verdict = verdictOf(verdict.score);
    verdict.rationale = `No contingency was planned — the sub-units acted on their SOPs. ${verdict.rationale}`;
  }
  const preActs = p.preplannedActions ?? [];
  e.decisions.push({
    key,
    time: e.t,
    title: p.title,
    option: input.option || quickPickFor(key, explicit) || explicit.join(','),
    optionText: describeResponse(key, { actions: explicit, text: input.text }),
    preplanned: p.preplanned ?? '',
    score: verdict.score,
    verdict: verdict.verdict,
    rationale: unmarked ? `Handled by the sub-unit SOPs (not pre-planned — not marked). ${verdict.rationale}` : verdict.rationale,
    ref: verdict.ref,
    actions: explicit,
    text: input.text?.trim() || undefined,
    source,
    changed: !!p.planned && (source === 'MODAL' || source === 'MAP') && !sameSet(preActs, explicit),
    unmarked: unmarked || undefined,
    understood: verdict.understood?.length ? verdict.understood : undefined,
    strengths: verdict.strengths,
    gaps: verdict.gaps,
    textNote: verdict.textNote,
    textScore: verdict.textScore,
  });
  e.orders.push({ time: e.t, text: `${p.title}: ${explicit.length ? `${explicit.length} action${explicit.length === 1 ? '' : 's'}` : input.text?.trim() ? 'orders in own words' : 'no action'}${source === 'MAP' ? ' (on the map)' : ''}` });
  if (source === 'MODAL' || source === 'MAP') S.window = { rec: e.decisions.length - 1, key, until: e.t + MAP_WINDOW_MIN, ctx, text: input.text, actions: [...explicit] };
  // orders understood from the free text are executed like radio orders
  const acts = new Set([...explicit, ...understood]);
  applyEffects(e, S, p, ctx, acts, chosen, delay, source === 'MAP', input.dfId);
}

function applyEffects(e: Engine, S: InjectState, p: PendingDecision, ctx: DecisionContext & Record<string, unknown>, sel: Set<string>, chosen: SimUnit | undefined, delay: number, bookkeepingOnly: boolean, dfId?: string): void {
  const has = (a: string) => sel.has(a);
  /** Fires the nominated pre-selected DF if it is near `p`, else adjusted fire onto `p`. */
  const dfOn = (p: Vec, minutes: number, label: string): string => {
    const df = dfId ? e.dfs.find((d) => d.id === dfId) : undefined;
    return df && dist(df.pos, p) < 700 ? fireDf(e, df, minutes) : fireOnPoint(e, p, 'ARTY', minutes, label);
  };
  const loc = ctx.locId ? e.byId.get(String(ctx.locId)) : undefined;
  const fx = !bookkeepingOnly;
  switch (p.key) {
    case 'SCREEN_CONTACT': {
      e.screenPolicy = has('HOLD_ALL_COSTS') ? 'HOLD_ALL_COSTS' : has('WITHDRAW_NOW') ? 'WITHDRAW_NOW' : has('REINFORCE_SCREEN') ? 'REINFORCE' : 'ENGAGE_WITHDRAW';
      if (!fx) break;
      const screens = e.blue().filter((u) => u.role === 'SCREEN');
      if (has('WITHDRAW_NOW')) screens.forEach((s) => withdrawToMain(e, s, 'ordered on contact'));
      if (has('REINFORCE_SCREEN')) {
        const d = depthForce(e);
        if (d && screens[0]) {
          moveTo(e, d, screens[0].pos, 'MOVE');
          d.role = 'SCREEN';
          d.task = 'Reinforcing screens';
        }
      }
      if (has('DF_SCREEN') || (has('ENGAGE_LONG') && !has('WITHDRAW_NOW'))) {
        for (const s of screens) {
          const near = contactsNear(e, s.pos, 2500, 0.3)[0];
          if (near) e.addLog(fireOnPoint(e, near.pos, 'ARTY', 5, 'arty in sp of screens'), 'info');
        }
      }
      break;
    }
    case 'EN_PROBE':
      e.flags.probePolicy = has('ALL_WPNS') ? 'ALL_WPNS' : has('MIN_WPNS') || has('AGGR_PTL') ? 'MIN_FIRE_ALT' : has('DF_TGT') ? 'DF_ON_PTL' : has('HOLD_FIRE') ? 'IGNORE' : 'MIN_FIRE_ALT';
      if (fx && has('DF_TGT')) {
        const prober = e.red().find((r) => r.probing);
        if (prober) e.addLog(fireOnPoint(e, prober.pos, 'ARTY', 4, 'DF on en ptl'), 'info');
        e.flags.wastedDf = ((e.flags.wastedDf as number) ?? 0) + 1;
      }
      break;
    case 'EN_ASSEMBLY': {
      if (!fx) break;
      const c = contactsNear(e, e.redPlan.faa, 900, 0.3).sort((a, b) => (b.ident === 'ARMOUR' ? 1 : 0) - (a.ident === 'ARMOUR' ? 1 : 0))[0];
      if (has('DF_FAA')) e.addLog(dfOn(c?.pos ?? e.redPlan.faa, 6, 'DF on FAA'), 'info');
      if (has('UCAV') && c) e.addLog(requestUcav(e, c.unitId, ['armour', 'confirmed']).msg, 'info');
      if (has('AQC') && c) e.addLog(launchAttackQc(e, c.unitId), 'info');
      if (has('STAND_TO')) e.addLog('Localities warned: assault likely — stand to.', 'info');
      break;
    }
    case 'EN_FORMING_UP': {
      if (!fx) break;
      const fupContacts = contactsNear(e, e.redPlan.fup, 700, 0.3);
      const realAtFup = e.red().filter((r) => dist(r.pos, e.redPlan.fup) < 450).length > 0;
      if (has('SPOIL_FIRE')) {
        const sp = chosen ?? e.blue().filter((u) => u.role === 'SP_PTL').sort((a, b) => dist(a.pos, e.redPlan.fup) - dist(b.pos, e.redPlan.fup))[0];
        if (sp) {
          e.flags.spoilBy = sp.id;
          e.marks.spoilUntil = e.t + 10;
          if (sp.role !== 'SP_PTL') {
            // a sec from the nominated sub-unit moves fwd to fire
            moveTo(e, sp, { x: (sp.pos.x + e.redPlan.fup.x) / 2, y: (sp.pos.y + e.redPlan.fup.y) / 2 }, 'MOVE');
            sp.task = 'Spoiling attk by fire';
          }
        }
        if (realAtFup) e.flags.fupDelay = 20;
      }
      if (has('DF_FUP')) {
        if (has('SPOIL_FIRE')) e.addLog(dfOn(fupContacts[0]?.pos ?? e.redPlan.fup, 6, 'DF on FUP'), 'info');
        else {
          e.addLog(dfOn(fupContacts[0]?.pos ?? e.redPlan.fup, 8, 'DF on FUP'), 'info');
          if (e.s.own.fire.mor81) fireOnPoint(e, fupContacts[0]?.pos ?? e.redPlan.fup, 'MOR81', 6, '81mm on FUP');
          if (realAtFup) e.flags.fupDelay = Math.max((e.flags.fupDelay as number) ?? 0, 10);
        }
      }
      if (has('SPOIL_ASSAULT')) {
        const f = chosen ?? depthForce(e);
        if (f) {
          const tgt = e.red().filter((r) => dist(r.pos, e.redPlan.fup) < 500).sort((a, b) => b.strength - a.strength)[0];
          if (tgt) {
            f.catk = true;
            f.targetId = tgt.id;
            f.restoreId = undefined;
            f.waitUntil = e.t + 5;
            f.task = 'Spoiling attk — assault on FUP';
          }
        }
        if (realAtFup) e.flags.fupDelay = 20;
      }
      if (has('AQC') && fupContacts[0]) e.addLog(launchAttackQc(e, fupContacts[0].unitId), 'info');
      if (has('SOS')) {
        for (const d of e.dfs.filter((x) => x.sos)) e.addLog(fireDf(e, d, 5), 'info');
        e.flags.wastedDf = ((e.flags.wastedDf as number) ?? 0) + 1;
      }
      break;
    }
    case 'EN_ASSAULT': {
      if (has('SOS')) e.marks.sosCalled = e.marks.sosCalled ?? e.t;
      if (has('SOS') || has('HOLD_FIRE_KA')) e.fireControl = 'DOCTRINE';
      if (has('ALL_WPNS')) e.fireControl = 'EARLY';
      if (!fx) break;
      if (has('SOS') || has('RECALL_LP')) recallLps(e);
      if (has('SOS')) {
        const sos = e.dfs.filter((x) => x.sos);
        for (const d of sos) e.addLog(fireDf(e, d, 6), 'info');
        if (!sos.length) {
          const c = [...e.contacts.values()].filter((x) => x.conf > 0.3 && e.byId.get(x.unitId)?.state === 'ASSAULT')[0];
          e.addLog(`No DF (SOS) planned — ${fireOnPoint(e, c?.pos ?? e.redPlan.sl, 'ARTY', 6, 'emergency DF')}`, 'warn');
        }
        e.marks.sosCalled = e.t;
      }
      if (has('READJUST_ALT')) {
        const threat = [...e.contacts.values()].filter((c) => c.conf > 0.3 && e.byId.get(c.unitId)?.state === 'ASSAULT')[0]?.pos ?? e.redPlan.fup;
        for (const u of e.blue().filter((x) => (x.role === 'FDL' || x.role === 'SP_WPN') && x.altPos && x.state === 'POSN')) {
          if (angleDiff(u.facing, bearing(u.pos, threat)) <= 35) continue;
          moveTo(e, u, u.altPos!, 'MOVE', false);
          u.task = 'Readjusting to altn posn';
        }
        e.addLog(`Readjustment ordered${has('REPORT') ? '; Bn HQ informed' : ''}.`, 'info');
      }
      if (has('DEPTH_FWD')) {
        const d = depthForce(e);
        const f = e.nearestBlueLocality(e.redPlan.sl, ['FDL']);
        if (d && f) {
          moveTo(e, d, { x: f.pos.x + 80, y: f.pos.y - 80 }, 'MOVE');
          d.role = 'FDL';
          d.task = 'Moved fwd to thicken FDLs';
        }
      }
      break;
    }
    case 'POST_LOST': {
      if (!fx) break;
      if (has('CPEN')) {
        const d = depthForce(e);
        const cp = e.plan.graphics.find((g) => g.kind === 'CPEN');
        if (d && !has('LOCAL_CATK')) {
          moveTo(e, d, cp?.pts[0] ?? d.altPos ?? d.pos, 'MOVE');
          d.task = 'Occupy C pen posn';
        }
      }
      if (has('REINFORCE_LOC') && loc) {
        const d = depthForce(e);
        if (d) {
          const give = Math.min(10, d.strength * 0.3);
          d.strength -= give;
          const live = loc.elements.filter((x) => !x.lost);
          for (const el of live) el.str += give / Math.max(1, live.length);
          loc.strength += give;
          e.addLog(`Depth sec moved to reinforce ${loc.label}.`, 'info');
        }
      }
      if (has('DF_PEN') && loc) e.addLog(fireOnPoint(e, loc.pos, 'MOR60', 4, '60mm on penetration'), 'info');
      if (has('LOCAL_CATK')) {
        const f = chosen && alive(chosen) ? chosen : depthForce(e);
        if (f) e.addLog(launchCatk(e, f, loc, delay, ctx.catkPlanned ? 1.25 : 1), 'warn');
        else e.addLog('No force aval for a local C attk.', 'crit');
      }
      if (has('REQ_HIGHER_CATK') && loc && !has('LOCAL_CATK')) {
        e.flags.higherCatk = { at: e.t + 55, locId: loc.id, bonus: 1 };
        e.addLog('Bn C attk requested; Bn HQ estimates 50-60 min.', 'info');
      }
      if (has('WITHDRAW_LOC') && loc) {
        withdrawToMain(e, loc, 'ordered');
        loc.role = 'RES';
      }
      break;
    }
    case 'LOCALITY_LOST': {
      if (!fx) break;
      if (has('CPEN')) {
        const d = depthForce(e);
        const cp = e.plan.graphics.find((g) => g.kind === 'CPEN');
        if (d && !d.catk && !has('OWN_CATK')) {
          moveTo(e, d, cp?.pts[0] ?? d.pos, 'MOVE');
          d.task = 'Occupy C pen posn';
        }
      }
      if (has('REQ_HIGHER_CATK') && loc) {
        const coord = has('COORD_CATK');
        e.flags.higherCatk = { at: e.t + 45 + (S.c2Until && e.t < S.c2Until ? 10 : 0), locId: loc.id, bonus: coord ? 1.3 : 1.05 };
        e.addLog(`Higher C attk requested${coord ? ' with SL, route, fire sp, guides and codewords coord' : ''}.`, 'info');
      }
      if (has('OWN_CATK')) {
        const f = depthForce(e);
        if (f) e.addLog(launchCatk(e, f, loc, 10, 0.9), 'warn');
      }
      if (has('DF_LOST_LOC') && loc) e.addLog(fireOnPoint(e, loc.pos, 'ARTY', 8, 'DF on lost locality'), 'info');
      if (has('WITHDRAW_ALL')) {
        for (const u of e.blue().filter((x) => x.role === 'FDL' || x.role === 'DEPTH')) withdrawToMain(e, u, 'coy withdrawing');
        e.finish('Own tps withdrew');
      }
      break;
    }
    case 'REORG': {
      for (const u of e.blue()) {
        if (has('AMMO_REDIST')) u.ammo = Math.min(1, u.ammo + 0.25);
        if (has('AMMO_REPLEN')) u.ammo = Math.min(1, u.ammo + 0.5);
        u.supp = 0;
      }
      e.marks.reorgDone = e.t;
      e.addLog(`Reorg under way: ${sel.size} actions ordered.`, 'info');
      if (e.redPhase === 'FAILED' || e.redPhase === 'CONSOLIDATE') e.endT = Math.min(e.endT, e.t + 30);
      break;
    }
    // ------------------------------------------------------------------ inject-only situations
    case 'EN_ARTY': {
      if (!fx || !loc) break;
      if (has('TAKE_COVER')) {
        loc.dug = Math.min(0.98, loc.dug + 0.12);
        e.addLog(`${loc.label} taking cover under OHP.`, 'info');
      }
      if (has('MOVE_ALT_POSN') && loc.altPos) {
        moveTo(e, loc, loc.altPos, 'MOVE', false);
        loc.task = 'Moving to altn posn (located)';
        e.redIntel.delete(loc.id);
      }
      if (has('CB_REQ')) {
        if (e.ammo.ARTY > 60) {
          e.ammo.ARTY -= 36;
          e.ammo.EN_ARTY = Math.round(e.ammo.EN_ARTY * 0.9);
          for (const m of e.missions) if (m.side === 'RED' && m.end > e.t + 2 && dist(m.target, loc.pos) < 600) m.end = e.t + 2;
          e.addLog('CB fire engaging the en btys — en shelling slackens.', 'good');
        } else e.addLog('CB requested — no arty amn to spare.', 'warn');
      }
      if (has('WITHDRAW_LOC')) withdrawToMain(e, loc, 'ordered out of the shelling');
      break;
    }
    case 'COMMS_LOST': {
      if (!loc) break;
      const mins = has('LINE_COMMS') ? 2 : has('ALT_FREQ') ? 3 : has('RUNNER') ? 10 : has('PRE_ARRANGED') ? 15 : 30;
      S.comms = { unitId: loc.id, until: e.t + mins };
      if (fx && has('WITHDRAW_LOC')) withdrawToMain(e, loc, 'ordered');
      break;
    }
    case 'FLANK_GAP': {
      if (!fx || !loc) break;
      if (has('REFUSE_FLANK') && loc.altPos && loc.state === 'POSN') {
        moveTo(e, loc, loc.altPos, 'MOVE', false);
        loc.task = 'Refusing the flank';
      }
      if (has('DEPTH_FILL')) {
        const d = depthForce(e);
        if (d) {
          moveTo(e, d, { x: loc.pos.x + (ctx.side === 'L' ? -350 : 350), y: loc.pos.y - 150 }, 'MOVE');
          d.role = 'FDL';
          d.task = 'Filling the gap on the flank';
        }
      }
      if (has('WITHDRAW_ALL')) {
        for (const u of e.blue().filter((x) => x.role === 'FDL' || x.role === 'DEPTH')) withdrawToMain(e, u, 'conforming with the flank');
        e.finish('Own tps withdrew');
      }
      break;
    }
    case 'CHQ_HIT': {
      if (!has('TWO_IC_COMD')) S.c2Until = e.t + (has('WAIT_FOR_ORDERS') ? 40 : 30);
      if (!fx) break;
      const hq = loc;
      if (hq && has('MOVE_CHQ_ALT')) {
        moveTo(e, hq, hq.altPos ?? { x: hq.pos.x + 150, y: hq.pos.y - 150 }, 'MOVE', false);
        hq.task = 'Moving to alt CHQ';
      }
      e.addLog(has('TWO_IC_COMD') ? '2IC has assumed comd; alt CP open.' : 'Comd not re-established — orders to the pls are delayed.', has('TWO_IC_COMD') ? 'info' : 'warn');
      break;
    }
    case 'CASEVAC': {
      if (!fx || !loc) break;
      if (has('STOP_FIGHT_EVAC')) loc.supp = Math.min(1, loc.supp + 0.3);
      if (has('BUDDY_AID') || has('CASEVAC_WHEN_PERMITS')) e.addLog(`Cas at ${loc.label} treated; evac to the CAP when the fire permits.`, 'info');
      break;
    }
    case 'AMMO_LOW': {
      if (!fx || !loc) break;
      if (has('AMMO_REDIST')) loc.ammo = Math.min(1, loc.ammo + 0.12);
      if (has('AMMO_PRIORITY')) loc.ammo = Math.min(1, loc.ammo + 0.05);
      if (has('AMMO_REPLEN')) S.replen = { unitId: loc.id, at: e.t + 20, amount: 0.45 };
      if (has('FIRE_DISC')) e.fireControl = 'DOCTRINE';
      if (has('WITHDRAW_LOC')) withdrawToMain(e, loc, 'out of amn');
      break;
    }
    case 'EW_JAM': {
      if (!fx) break;
      const careless = has('TRANSMIT_CLEAR') || (!has('EMCON') && !has('LINE_COMMS'));
      if (careless) {
        for (const u of e.blue().filter((x) => x.role === 'CHQ' || x.role === 'CP')) e.redIntel.set(u.id, { pos: { ...u.pos }, conf: 0.8, lastSeen: e.t });
        e.addLog('En EW has located the coy CP / CHQ from its transmissions.', 'warn');
      } else e.addLog('Anti-jamming drills in force; comms by alt means.', 'info');
      break;
    }
    case 'EN_UAV': {
      if (!fx || !loc) break;
      if (!has('CAM_DISC') || has('ENGAGE_UAV')) {
        for (const u of e.blue().filter((x) => dist(x.pos, loc.pos) < 500)) e.redIntel.set(u.id, { pos: { ...u.pos }, conf: 0.9, lastSeen: e.t });
        e.addLog(`The en UAV has located ${loc.label}${has('ENGAGE_UAV') ? ' (it drew small-arms fire)' : ''}.`, 'warn');
      } else e.addLog('UAV gone; nothing seen to have been located.', 'info');
      break;
    }
    case 'CIVILIANS': {
      if (!fx) break;
      if (has('LET_THROUGH')) {
        for (const u of fwdLocalities(e).filter((x) => x.role === 'FDL')) e.redIntel.set(u.id, { pos: { ...u.pos }, conf: 0.7, lastSeen: e.t });
        e.addLog('Infiltrators among the civilians have reported the FDLs to the en.', 'warn');
      } else if (has('ROUTE_CIV')) e.addLog('Civilians routed off the axis by the police.', 'info');
      break;
    }
  }
}

// ---------------------------------------------------------------------------- acting on the map

/** The student closes the decision card to act on the map; the battle stays paused. */
export function beginMapResponse(e: Engine): void {
  if (!e.pending) return;
  e.pending.onMap = { since: e.t, orderIdx: st(e).manual.length };
}

/** Records a manual order; while a decision is open or within its window it counts towards it. */
export function noteManualOrder(e: Engine, o: ManualOrder): void {
  const S = st(e);
  S.manual.push({ t: e.t, o });
  const w = S.window;
  if (!w || e.t > w.until || e.pending) return;
  const a = orderAction(e, w.key, o);
  if (!a || w.actions.includes(a)) return;
  w.actions.push(a);
  const rec = e.decisions[w.rec];
  if (!rec || rec.key !== w.key) return;
  const v = evaluateResponse(w.key, { actions: w.actions, text: w.text }, w.ctx);
  Object.assign(rec, { actions: [...w.actions], optionText: describeResponse(w.key, { actions: w.actions, text: w.text }), score: v.score, verdict: v.verdict, rationale: `${v.rationale} (incl. orders given within ${MAP_WINDOW_MIN} min)`, strengths: v.strengths, gaps: v.gaps });
}

/** The response made of the orders the student gave on the map since the card was closed. */
export function mapResponseInput(e: Engine, text?: string): DecisionInput {
  const p = e.pending;
  const S = st(e);
  const from = p?.onMap?.orderIdx ?? S.manual.length;
  const acts: string[] = [];
  let unitId: string | undefined;
  for (const m of S.manual.slice(from)) {
    const a = p ? orderAction(e, p.key, m.o) : undefined;
    if (a && !acts.includes(a)) acts.push(a);
    if (m.o.type === 'CATK') unitId = m.o.unitId;
  }
  return { option: p ? quickPickFor(p.key, acts) ?? acts[0] ?? '' : '', actions: acts, text: text?.trim() || undefined, unitId, delayMin: 5, source: 'MAP' };
}

/** Maps a manual order onto an action of the situation (or undefined if not relevant). */
export function orderAction(e: Engine, key: string, o: ManualOrder): string | undefined {
  const offered = contingencyDef(key).actions;
  const first = (...c: string[]) => c.find((a) => offered.includes(a));
  const firePos = (p: Vec | undefined) => {
    if (!p) return first('DF_TGT', 'DF_PEN', 'DF_LOST_LOC', 'DF_SCREEN', 'DF_GAP', 'CB_REQ');
    if (dist(p, e.redPlan.faa) < 600 && offered.includes('DF_FAA')) return 'DF_FAA';
    if (dist(p, e.redPlan.fup) < 600 && offered.includes('DF_FUP')) return 'DF_FUP';
    return first('DF_PEN', 'DF_LOST_LOC', 'DF_SCREEN', 'DF_GAP', 'DF_TGT', 'DF_FUP', 'DF_FAA');
  };
  switch (o.type) {
    case 'DF': {
      const df = e.dfs.find((d) => d.id === o.dfId);
      if (df?.sos && offered.includes('SOS')) return 'SOS';
      return firePos(df?.pos);
    }
    case 'FIRE_CONTACT':
      return firePos(e.contacts.get(o.contactId)?.pos);
    case 'QC_SURV':
      return first('QC_SURV', 'SP_OBSERVE', 'PTL_GAP');
    case 'AQC':
      return first('AQC');
    case 'UCAV':
      return first('UCAV');
    case 'MOVE_ALT':
      return first('READJUST_ALT', 'MOVE_ALT_POSN', 'REFUSE_FLANK', 'RESITE_WPNS');
    case 'WITHDRAW': {
      const u = e.byId.get(o.unitId);
      if (u?.role === 'SCREEN') return first('WD_ON_ORDER', 'WITHDRAW_NOW');
      return first('WITHDRAW_LOC', 'WITHDRAW_ALL');
    }
    case 'CATK':
      return first('LOCAL_CATK', 'OWN_CATK', 'SPOIL_ASSAULT');
    case 'CPEN':
      return first('CPEN');
    case 'HOLD':
      return first('HOLD_FAST', 'HOLD_ALL_COSTS', 'STAND_BY_LIFT');
    default:
      return undefined;
  }
}

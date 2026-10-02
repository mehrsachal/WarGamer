// Decision injects (DS-style "REQs" during the wargame). Each fires once when BLUE
// perceives the situation; pauses for the student (interactive) or applies the
// pre-planned contingency (auto). The answer is marked against the actual situation.

import { type Vec, angleDiff, bearing, dist } from '../core/geom';
import { evaluateDecision, type DecisionContext } from '../assess/decisions';
import { contingencyDef, optionText } from '../plan/contingency';
import { launchCatk, moveTo, recallLps, withdrawToMain } from './blue';
import { alive, type Engine } from './engine';
import { fireDf, fireOnPoint, launchAttackQc, requestUcav } from './fires';
import type { DecisionInput, PendingDecision, SimUnit } from './types';

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

function fire(e: Engine, key: string, prompt: string, ctx: DecisionContext & Record<string, unknown>, focus?: Vec, unitChoices?: { id: string; label: string }[]): void {
  e.fired.add(key);
  const def = contingencyDef(key);
  const pre = e.plan.contingency[key];
  const p: PendingDecision = {
    key,
    title: def.title,
    prompt: `${e.timeStr()}: ${prompt}`,
    options: def.options.map((o) => ({ id: o.id, text: o.text, needsUnit: !!def.needsUnit && (o.id === 'LOCAL_CATK' || o.id === 'SPOIL_FIRE'), needsDelay: def.needsDelay && o.id === 'LOCAL_CATK' })),
    multi: def.multi,
    preplanned: pre?.option,
    preplannedDelay: pre?.delayMin,
    preplannedUnit: pre?.unitId,
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
      const ctx: DecisionContext = { spAvailable: !!sp && dist(sp.pos, e.redPlan.fup) < 1500, spInRange: !!spIn, glhmgInRange: !!gl, dfNearFup: !!e.dfNear(e.redPlan.fup, 400), depthAvailable: !!depthForce(e) };
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
    }
  }
}

export function applyDecision(e: Engine, p: PendingDecision, input: DecisionInput): void {
  const key = p.key;
  const ctx = p.context as DecisionContext & Record<string, unknown>;
  const opt = input.option;
  const delay = input.delayMin ?? 15;
  const chosen = input.unitId ? e.byId.get(input.unitId) : undefined;
  if (key === 'POST_LOST') {
    ctx.delay = Math.max(0, e.t - (e.marks.firstElementLost ?? e.t)) + delay;
    const df = depthForce(e);
    ctx.chosenUnitIsDepth = !chosen || (df ? chosen.id === df.id || chosen.role === 'DEPTH' || chosen.role === 'RES' : false);
  }
  const verdict = evaluateDecision(key, opt, ctx, input.options);
  const pre = p.preplanned ?? '';
  e.decisions.push({
    key,
    time: e.t,
    title: p.title,
    option: input.options ? input.options.join(',') : opt,
    optionText: input.options ? input.options.map((o) => optionText(key, o)).join(' | ') : optionText(key, opt),
    preplanned: pre,
    score: verdict.score,
    verdict: verdict.verdict,
    rationale: verdict.rationale,
    ref: verdict.ref,
  });
  e.orders.push({ time: e.t, text: `${p.title}: ${input.options ? `${input.options.length} actions` : optionText(key, opt)}` });

  switch (key) {
    case 'SCREEN_CONTACT': {
      e.screenPolicy = opt;
      const screens = e.blue().filter((u) => u.role === 'SCREEN');
      if (opt === 'WITHDRAW_NOW') screens.forEach((s) => withdrawToMain(e, s, 'ordered on contact'));
      if (opt === 'REINFORCE') {
        const d = depthForce(e);
        if (d && screens[0]) {
          moveTo(e, d, screens[0].pos, 'MOVE');
          d.role = 'SCREEN';
          d.task = 'Reinforcing screens';
        }
      }
      for (const s of screens) {
        const near = contactsNear(e, s.pos, 2500, 0.3)[0];
        if (near && opt !== 'WITHDRAW_NOW') e.addLog(fireOnPoint(e, near.pos, 'ARTY', 5, 'arty in sp of screens'), 'info');
      }
      break;
    }
    case 'EN_PROBE':
      e.flags.probePolicy = opt;
      if (opt === 'DF_ON_PTL') {
        const prober = e.red().find((r) => r.probing);
        if (prober) e.addLog(fireOnPoint(e, prober.pos, 'ARTY', 4, 'DF on en ptl'), 'info');
        e.flags.wastedDf = ((e.flags.wastedDf as number) ?? 0) + 1;
      }
      break;
    case 'EN_ASSEMBLY': {
      const c = contactsNear(e, e.redPlan.faa, 900, 0.3).sort((a, b) => (b.ident === 'ARMOUR' ? 1 : 0) - (a.ident === 'ARMOUR' ? 1 : 0))[0];
      if (opt === 'DF_FAA') e.addLog(fireOnPoint(e, c?.pos ?? e.redPlan.faa, 'ARTY', 6, 'DF on FAA'), 'info');
      if (opt === 'UCAV_FAA' && c) e.addLog(requestUcav(e, c.unitId, ['armour', 'confirmed']).msg, 'info');
      if (opt === 'AQC_FAA' && c) e.addLog(launchAttackQc(e, c.unitId), 'info');
      break;
    }
    case 'EN_FORMING_UP': {
      const fupContacts = contactsNear(e, e.redPlan.fup, 700, 0.3);
      const realAtFup = e.red().filter((r) => dist(r.pos, e.redPlan.fup) < 450).length > 0;
      if (opt === 'SPOIL_FIRE') {
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
        e.addLog(fireOnPoint(e, fupContacts[0]?.pos ?? e.redPlan.fup, 'ARTY', 6, 'DF on FUP'), 'info');
        if (realAtFup) e.flags.fupDelay = 20;
      } else if (opt === 'DF_FUP') {
        e.addLog(fireOnPoint(e, fupContacts[0]?.pos ?? e.redPlan.fup, 'ARTY', 8, 'DF on FUP'), 'info');
        if (e.s.own.fire.mor81) fireOnPoint(e, fupContacts[0]?.pos ?? e.redPlan.fup, 'MOR81', 6, '81mm on FUP');
        if (realAtFup) e.flags.fupDelay = 10;
      } else if (opt === 'SPOIL_ASSAULT') {
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
      } else if (opt === 'SOS_NOW') {
        for (const d of e.dfs.filter((x) => x.sos)) e.addLog(fireDf(e, d, 5), 'info');
        e.flags.wastedDf = ((e.flags.wastedDf as number) ?? 0) + 1;
      }
      break;
    }
    case 'EN_ASSAULT': {
      if (opt === 'SOS_READJUST' || opt === 'SOS_HOLD') {
        recallLps(e);
        const sos = e.dfs.filter((x) => x.sos);
        for (const d of sos) e.addLog(fireDf(e, d, 6), 'info');
        if (!sos.length) {
          const c = [...e.contacts.values()].filter((x) => x.conf > 0.3 && e.byId.get(x.unitId)?.state === 'ASSAULT')[0];
          e.addLog(`No DF (SOS) planned — ${fireOnPoint(e, c?.pos ?? e.redPlan.sl, 'ARTY', 6, 'emergency DF')}`, 'warn');
        }
        e.marks.sosCalled = e.t;
        e.fireControl = 'DOCTRINE';
      }
      if (opt === 'SOS_READJUST') {
        const threat = [...e.contacts.values()].filter((c) => c.conf > 0.3 && e.byId.get(c.unitId)?.state === 'ASSAULT')[0]?.pos ?? e.redPlan.fup;
        for (const u of e.blue().filter((x) => (x.role === 'FDL' || x.role === 'SP_WPN') && x.altPos && x.state === 'POSN')) {
          if (angleDiff(u.facing, bearing(u.pos, threat)) <= 35) continue;
          moveTo(e, u, u.altPos!, 'MOVE', false);
          u.task = 'Readjusting to altn posn';
        }
        e.addLog('Readjustment ordered; Bn HQ informed.', 'info');
      }
      if (opt === 'ALL_FIRE') e.fireControl = 'EARLY';
      if (opt === 'DEPTH_FWD') {
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
      const loc = e.byId.get(String(ctx.locId));
      if (opt === 'LOCAL_CATK') {
        const f = chosen && alive(chosen) ? chosen : depthForce(e);
        if (f) e.addLog(launchCatk(e, f, loc, delay, ctx.catkPlanned ? 1.25 : 1), 'warn');
        else e.addLog('No force aval for a local C attk.', 'crit');
      } else if (opt === 'REINFORCE_CONTAIN' && loc) {
        const d = depthForce(e);
        if (d) {
          const give = Math.min(10, d.strength * 0.3);
          d.strength -= give;
          const live = loc.elements.filter((x) => !x.lost);
          for (const el of live) el.str += give / Math.max(1, live.length);
          loc.strength += give;
          e.addLog(`Depth sec moved to reinforce ${loc.label}.`, 'info');
        }
        if (loc) e.addLog(fireOnPoint(e, loc.pos, 'MOR60', 4, '60mm on penetration'), 'info');
      } else if (opt === 'CPEN') {
        const d = depthForce(e);
        const cp = e.plan.graphics.find((g) => g.kind === 'CPEN');
        if (d) {
          moveTo(e, d, cp?.pts[0] ?? d.altPos ?? d.pos, 'MOVE');
          d.task = 'Occupy C pen posn';
        }
      } else if (opt === 'HIGHER_CATK' && loc) {
        e.flags.higherCatk = { at: e.t + 55, locId: loc.id, bonus: 1 };
        e.addLog('Bn C attk requested; Bn HQ estimates 50-60 min.', 'info');
      } else if (opt === 'WITHDRAW' && loc) {
        withdrawToMain(e, loc, 'ordered');
        loc.role = 'RES';
      }
      break;
    }
    case 'LOCALITY_LOST': {
      const loc = e.byId.get(String(ctx.locId));
      if (opt === 'CPEN_HIGHER') {
        const d = depthForce(e);
        const cp = e.plan.graphics.find((g) => g.kind === 'CPEN');
        if (d && !d.catk) {
          moveTo(e, d, cp?.pts[0] ?? d.pos, 'MOVE');
          d.task = 'Occupy C pen posn';
        }
        if (loc) e.flags.higherCatk = { at: e.t + 45, locId: loc.id, bonus: 1.3 };
        e.addLog('C pen posn being occupied; higher C attk requested with SL, route, fire sp, guides and codewords coord.', 'info');
      } else if (opt === 'OWN_CATK') {
        const f = depthForce(e);
        if (f) e.addLog(launchCatk(e, f, loc, 10, 0.9), 'warn');
      } else if (opt === 'DF_HOLD' && loc) {
        e.addLog(fireOnPoint(e, loc.pos, 'ARTY', 8, 'DF on lost locality'), 'info');
      } else if (opt === 'WITHDRAW_ALL') {
        for (const u of e.blue().filter((x) => x.role === 'FDL' || x.role === 'DEPTH')) withdrawToMain(e, u, 'coy withdrawing');
        e.finish('Own tps withdrew');
      }
      break;
    }
    case 'REORG': {
      const sel = input.options ?? opt.split(',').filter(Boolean);
      for (const u of e.blue()) {
        if (sel.includes('AMMO_REDIST')) u.ammo = Math.min(1, u.ammo + 0.25);
        if (sel.includes('AMMO_REPLEN')) u.ammo = Math.min(1, u.ammo + 0.5);
        u.supp = 0;
      }
      e.marks.reorgDone = e.t;
      e.addLog(`Reorg under way: ${sel.length} actions ordered.`, 'info');
      if (e.redPhase === 'FAILED' || e.redPhase === 'CONSOLIDATE') e.endT = Math.min(e.endT, e.t + 30);
      break;
    }
  }
}

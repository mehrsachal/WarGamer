// Foxland (RED) attack: security zone clearance, recce & probing, assembly in the FAA,
// forming up, phased assault with BOF and tanks in close support, reorg and Ph 2 — or
// break-off when the attack loses its impetus (ICIB Sec 114 paras 33-36).

import { type Vec, add, dist, distToPolyline, lerp, norm, resample, scale, sub } from '../core/geom';
import { DOCTRINE } from '../core/doctrine';
import type { Approach, NamedPoint } from '../core/types';
import { TEMPLATES } from '../core/units';
import { alive, type Engine } from './engine';
import type { SimUnit } from './types';
import { newMission } from './fires';
import { type RedChoice, type RedDecisionPoint, pickVal, ruleChoice } from './aiHooks';

const ASSAULT_ROLES = new Set(['ASSAULT', 'RESERVE', 'TANKS', 'ENGR']);

export function buildRed(e: Engine): void {
  const s = e.s;
  const infKeys = new Set(['EN_INF_COY', 'EN_INF_BN']);
  const inf: string[] = [];
  let n = 0;
  for (const item of s.enemy.force) {
    for (let i = 0; i < item.count; i++) {
      const id = `red_${item.templateKey}_${i}`;
      const tpl = TEMPLATES[item.templateKey];
      let role: SimUnit['role'] = 'ASSAULT';
      if (item.templateKey === 'EN_RECCE') role = 'RECCE';
      else if (item.templateKey === 'EN_SUPPORT_COY') role = 'BOF';
      else if (tpl.kind === 'ARMOUR') role = 'TANKS';
      else if (item.templateKey === 'EN_ENGR') role = 'ENGR';
      else if (infKeys.has(item.templateKey)) inf.push(id);
      const entry = s.enemy.entry[n++ % s.enemy.entry.length];
      const label = `${tpl.short} ${i + 1}`;
      const u = e.makeUnit('RED', item.templateKey, id, `En ${label}`, entry, 180, role);
      u.waitUntil = 1e9;
    }
  }
  // infantry roles: adv guard, two assault (Ph 1), the rest reserve (Ph 2)
  inf.forEach((id, i) => {
    const u = e.byId.get(id)!;
    if (s.level === 'PL') u.role = i === 0 ? 'ASSAULT' : 'RESERVE';
    else u.role = i === 0 ? 'ADV_GUARD' : i <= 2 ? 'ASSAULT' : 'RESERVE';
  });
  planAttack(e, false);
  // entry schedule
  const cross = s.times.enCrossBorder;
  const mainEntry = e.hHour - (s.enemy.attackAtNight ? 330 : 300);
  let r = 0;
  for (const u of e.allRed()) {
    if (u.role === 'RECCE') u.waitUntil = cross + 10 * r++;
    else if (u.role === 'ADV_GUARD') u.waitUntil = cross + 25;
    else u.waitUntil = Math.max(cross + 60, mainEntry + e.rng.int(0, 20));
  }
}

function approachById(e: Engine, id: string): Approach {
  return e.s.ds.approaches.find((a) => a.id === id) ?? e.s.ds.approaches[0];
}

function pointOn(a: Approach, refY: number, ahead: number): Vec {
  const pts = resample(a.path, 25);
  return pts.reduce((b, p) => (Math.abs(p.y - refY - ahead) < Math.abs(b.y - refY - ahead) ? p : b), pts[0]);
}

function fdlY(e: Engine): number {
  const ds = e.s.ds;
  const l = ds.linesOfDef.find((x) => x.id === ds.recommendedFdl) ?? ds.linesOfDef[0];
  if (!l) return e.s.terrain.height * 0.45;
  return l.pts.reduce((m, p) => m + p.y, 0) / l.pts.length;
}

/** RED appreciation: pick the approach and objectives from what RED knows of BLUE. */
export function planAttack(e: Engine, final: boolean, force?: { approachId?: string; objId?: string }): void {
  const s = e.s;
  const ds = s.ds;
  const apchs = [...ds.approaches].sort((a, b) => a.pri - b.pri);
  const known = [...e.redIntel.entries()].filter(([, v]) => v.conf >= 0.3).map(([id, v]) => ({ u: e.byId.get(id)!, pos: v.pos })).filter((k) => k.u && alive(k.u));
  const scores = apchs.map((a) => {
    const going = a.tankGoing === 'good' ? 1 : a.tankGoing === 'fair' ? 0.7 : 0.4;
    let def = 0;
    for (const k of known) {
      const d = distToPolyline(k.pos, a.path).d;
      const w = d < 700 ? 1 : d < 1400 ? 0.5 : 0;
      const val = k.u.strength / 35 + (k.u.weapons.RR106 ?? 0) * 0.6 + (k.u.weapons.BS ?? 0) * 0.8 + (k.u.weapons.MG ?? 0) * 0.3 + (k.u.weapons.GLHMG ?? 0) * 0.5;
      def += w * val;
    }
    return going * 2 + 0.8 / a.pri - (final ? def * 0.35 : 0);
  });
  let idx = 0;
  const diff = e.opts.difficulty;
  const forced = force?.approachId ? apchs.findIndex((a) => a.id === force.approachId) : -1;
  if (forced >= 0) idx = forced;
  else if (!final) idx = e.rng.chance(diff === 'HARD' ? 0.85 : 0.7) ? 0 : e.rng.int(0, apchs.length - 1);
  else if (diff === 'HARD') idx = scores.indexOf(Math.max(...scores));
  else {
    const temp = diff === 'TRAINING' ? 0.9 : 0.5;
    const w = scores.map((x) => Math.exp(x / temp));
    idx = apchs.indexOf(e.rng.weighted(apchs, w));
    if (diff === 'TRAINING' && e.rng.chance(0.5)) idx = 0;
  }
  const a = apchs[Math.max(0, idx)];
  const fy = fdlY(e);
  const pick = (list: NamedPoint[], fallbackAhead: number, label: string): NamedPoint => list.find((p) => p.approachId === a.id) ?? { name: `${label} ${e.terrain.squareRef(pointOn(a, fy, fallbackAhead))}`, pos: pointOn(a, fy, fallbackAhead) };
  const faa = pick(ds.likelyFAAs, 2800, 'FAA');
  let fup = pick(ds.likelyFUPs, 1400, 'FUP');
  const bof = pick(ds.likelyBOFs, 1000, 'BOF');
  // FUP must be out of direct fire of known BLUE localities (SPs/LPs excepted)
  const threat = known.filter((k) => ['FDL', 'DEPTH', 'SCREEN'].includes(k.u.role as string));
  if (threat.some((k) => dist(k.pos, fup.pos) < 900)) {
    const back = pointOn(a, fy, Math.max(1500, fup.pos.y - fy + 500));
    fup = { name: `FUP ${e.terrain.squareRef(back)}`, pos: back };
  }
  // objectives
  const crossing = pointOn(a, fy, 0);
  const knownLoc = known.filter((k) => k.u.role === 'FDL' && k.u.kind === 'INF').sort((p, q) => dist(p.pos, crossing) - dist(q.pos, crossing));
  const objectives: { phase: number; pos: Vec; name: string; blueId?: string }[] = [];
  const forcedObj = force?.objId ? known.find((k) => k.u.id === force.objId) : undefined;
  const ph1 = forcedObj ? [forcedObj, ...knownLoc.filter((k) => k.u.id !== forcedObj.u.id && dist(k.pos, forcedObj.pos) < 1200).sort((p, q) => dist(p.pos, forcedObj.pos) - dist(q.pos, forcedObj.pos)).slice(0, 1)] : knownLoc.slice(0, 2);
  for (const k of ph1) objectives.push({ phase: 1, pos: k.pos, name: e.where(k.pos).replace(/^area /, ''), blueId: k.u.id });
  if (objectives.length === 0) {
    // RED has not located the FDLs: attack the ground it expects to be held
    const guess = [...ds.itgs].filter((i) => Math.abs(i.pos.y - fy) < 600).sort((p, q) => dist(p.pos, crossing) - dist(q.pos, crossing))[0];
    const pos = guess?.pos ?? crossing;
    objectives.push({ phase: 1, pos, name: guess?.name ?? e.where(pos) });
  }
  const depthKnown = known.filter((k) => k.u.role === 'DEPTH').sort((p, q) => dist(p.pos, objectives[0].pos) - dist(q.pos, objectives[0].pos))[0];
  const vital = ds.itgs.find((i) => i.vital);
  if (depthKnown) objectives.push({ phase: 2, pos: depthKnown.pos, name: e.where(depthKnown.pos).replace(/^area /, ''), blueId: depthKnown.u.id });
  else if (vital && !objectives.some((o) => dist(o.pos, vital.pos) < 300)) objectives.push({ phase: 2, pos: vital.pos, name: vital.name });
  else {
    const p = add(objectives[0].pos, { x: 0, y: -700 });
    objectives.push({ phase: 2, pos: p, name: e.where(p) });
  }
  const sl = lerp(fup.pos, objectives[0].pos, 0.12);
  const inf = e.allRed().filter((u) => u.role === 'ASSAULT' || u.role === 'RESERVE').length;
  const tanks = e.allRed().filter((u) => u.kind === 'ARMOUR').reduce((m, u) => m + u.startVehicles, 0);
  e.redPlan = {
    approachId: a.id,
    approachName: a.name,
    faa: faa.pos,
    faaName: faa.name,
    fup: fup.pos,
    fupName: fup.name,
    bof: bof.pos,
    bofName: bof.name,
    sl,
    hHour: e.hHour,
    objectives,
    text: [
      `${s.enemy.name} (${inf} inf sub-units${tanks ? `, ${tanks} tks` : ''}) attacked along the ${a.name}${final && known.length ? `, chosen after locating ${known.length} of your posns` : ''}.`,
      `FAA ${faa.name}; FUP ${fup.name}; BOF ${bof.name}; planned H hr ${e.timeStr(e.hHour)}.`,
      `Ph 1 obj: ${objectives.filter((o) => o.phase === 1).map((o) => o.name).join(', ')}. Ph 2 obj: ${objectives.filter((o) => o.phase === 2).map((o) => o.name).join(', ') || '-'}.`,
    ],
  };
  if (final) e.redPlanFinal = true;
}

function setPath(e: Engine, u: SimUnit, to: Vec, opts: { direct?: boolean; cover?: number; state?: SimUnit['state'] } = {}): void {
  const target = e.terrain.clampPt(to);
  u.path = opts.direct ? [target] : e.terrain.findPath(u.pos, target, u.mode, { preferCover: opts.cover ?? 0.5 });
  u.pathIdx = 0;
  u.state = opts.state ?? 'MOVE';
}

function spread(p: Vec, i: number, r: number): Vec {
  const a = i * 2.1;
  return { x: p.x + Math.cos(a) * r, y: p.y + Math.sin(a) * r };
}

function knownBlueNear(e: Engine, p: Vec, r: number, roles?: string[]): SimUnit[] {
  const out: SimUnit[] = [];
  for (const [id, v] of e.redIntel) {
    if (v.conf < 0.3) continue;
    const u = e.byId.get(id);
    if (!u || !alive(u)) continue;
    if (roles && !roles.includes(u.role as string)) continue;
    if (dist(v.pos, p) <= r) out.push(u);
  }
  return out;
}

function redArty(e: Engine, target: Vec, minutes: number, label: string, kind: 'PREP' | 'DF' = 'DF'): void {
  if (e.ammo.EN_ARTY <= 0) return;
  const btys = Math.max(1, Math.min(e.s.enemy.artyBatteries, kind === 'PREP' ? e.s.enemy.artyBatteries : 1));
  const m = newMission(e, 'RED', 'EN_ARTY', kind, target, 160, e.t + 3, minutes, btys * 10, 105, false, label);
  e.missions.push(m);
}

export function runRed(e: Engine): void {
  const s = e.s;
  const t = e.t;
  const plan = e.redPlan;
  const fy = fdlY(e);
  const apch = approachById(e, plan.approachId);

  // ---- phase clock
  if (e.redPhase === 'PRE' && t >= s.times.enCrossBorder) {
    e.redPhase = 'SECURITY';
    e.addLog('BOPs report en crossing the interstate bdry in strength.', 'warn');
  }
  const replanAt = e.hHour - (s.enemy.attackAtNight ? 330 : 300) - 15;
  if (e.ai && !e.redPlanFinal && t === replanAt - 30) e.ai.redPrefetch?.(e, planDp(e));
  if (!e.redPlanFinal && t >= replanAt) {
    if (!e.ai) {
      planAttack(e, true);
      e.marks.redPlanned = t;
    } else {
      const dp = planDp(e);
      const ch = aiDecide(e, dp);
      if (ch !== 'WAIT') applyPlanChoice(e, dp, ch);
    }
  }

  // ---- entries
  for (const u of e.allRed()) {
    if (u.state !== 'OFFMAP' || t < (u.waitUntil ?? 1e9)) continue;
    u.waitUntil = undefined;
    u.state = 'HALT';
    if (u.role === 'RECCE') {
      const ai = e.allRed().filter((x) => x.role === 'RECCE').indexOf(u) % s.ds.approaches.length;
      const a = s.ds.approaches[ai];
      u.task = `Recce ${a.name}`;
      u.objPos = pointOn(a, fy, 600);
      setPath(e, u, u.objPos, { cover: 0.8 });
    } else if (u.role === 'ADV_GUARD') {
      u.task = 'Adv guard — clear security zone';
      u.objPos = pointOn(apch, fy, 300);
      setPath(e, u, u.objPos, { cover: 0.4 });
    } else {
      u.task = 'Move to FAA';
      setPath(e, u, spread(plan.faa, e.allRed().indexOf(u), 180), { cover: 0.7 });
    }
  }

  const red = e.red();
  // ---- recce: advance until BLUE is located or fired upon, then observe
  for (const u of red.filter((x) => x.role === 'RECCE' && !x.probing)) {
    if (u.state === 'HALT' && u.task === 'Obsn post' && t % 30 === 0 && u.objPos && dist(u.pos, u.objPos) > 200 && !knownBlueNear(e, u.pos, 1300).length && u.supp < 0.2) {
      setPath(e, u, u.objPos, { cover: 0.8 });
      u.task = 'Recce — resuming search';
    }
    if (u.state === 'MOVE' && (knownBlueNear(e, u.pos, 1300, ['FDL', 'DEPTH']).length || u.supp > 0.25 || u.phaseCas > 1)) {
      u.state = 'HALT';
      u.task = 'Obsn post';
      u.path = [];
    }
  }
  // probing ptl at dusk (once)
  const probeT = Math.floor(e.hHour / 1440) * 1440 + s.times.light.lastLight - 100;
  if (!e.marks.probeStart && t >= probeT && t < e.hHour - 90) {
    const r = red.find((x) => x.role === 'RECCE' && x.strength > 4);
    if (r) {
      const target = [...e.redIntel.entries()].map(([id, v]) => ({ u: e.byId.get(id), v })).filter((k) => k.u && alive(k.u) && k.u.role === 'FDL').sort((p, q) => dist(p.v.pos, r.pos) - dist(q.v.pos, r.pos))[0];
      const goal = target ? lerp(target.v.pos, r.pos, 250 / Math.max(250, dist(target.v.pos, r.pos))) : pointOn(apch, fy, 250);
      setPath(e, r, goal, { cover: 0.9 });
      r.task = 'Probing ptl';
      r.role = 'RECCE';
      r.probing = true;
      e.marks.probeStart = t;
    }
  }
  for (const u of red.filter((x) => x.role === 'RECCE' && x.probing)) {
    if ((u.state === 'HALT' && e.marks.probeStart && t > e.marks.probeStart + 5) || u.phaseCas > 3) {
      u.probing = false;
      setPath(e, u, pointOn(apch, fy, 1500), { cover: 0.9, state: 'WITHDRAW' });
      u.task = 'Probe complete — withdrawing';
      e.marks.probeEnd = t;
    }
  }

  // ---- feint (AI enemy commander only): a demonstration on another apch just before H hr
  runFeint(e, red, fy);

  // ---- adv guard: drive in protective detachments, then break contact with the main posn
  for (const u of red.filter((x) => x.role === 'ADV_GUARD')) {
    if (u.state === 'BROKEN' || u.state === 'WITHDRAW' || u.task.startsWith('Out of contact') || u.task === 'Feint') continue;
    const loss = u.phaseCas / Math.max(1, u.phaseStart);
    const attacked = (e.flags.screensAttacked as string[] | undefined) ?? [];
    const screens = knownBlueNear(e, u.pos, 1600, ['SCREEN', 'SP_PTL']).filter((b) => b.state !== 'WITHDRAW' && !attacked.includes(b.id));
    const main = knownBlueNear(e, u.pos, 1500, ['FDL', 'DEPTH', 'RES']);
    const underFire = u.supp > 0.3 && !u.targetId;
    if (loss > 0.35 || (underFire && !screens.length) || (main.length && !u.targetId)) {
      // contact with the main posn (or too costly): pull back out of direct fire and observe
      const ref = main[0]?.pos ?? e.redIntel.get(main[0]?.id ?? '')?.pos ?? u.pos;
      const away = norm(sub(u.pos, ref));
      const back = main.length ? add(ref, scale(away.x || away.y ? away : { x: 0, y: 1 }, 1400)) : pointOn(apch, fy, 1600);
      setPath(e, u, back, { cover: 0.8, state: 'MOVE' });
      u.targetId = undefined;
      u.task = `Out of contact — ${loss > 0.35 ? 'hy cas' : 'main posn located'}`;
      if (!e.marks.contactMain) {
        e.marks.contactMain = t;
        e.addLog(`En adv guard has bumped the main posn and is pulling back to ${e.where(back)}.`, 'warn');
      }
      continue;
    }
    if (screens.length && u.state !== 'ASSAULT' && !u.targetId) {
      const sc = screens.sort((a, b) => dist(a.pos, u.pos) - dist(b.pos, u.pos))[0];
      if (e.ai) {
        const dp = screenDp(e, u, sc);
        const ch = aiDecide(e, dp);
        if (ch === 'WAIT') continue;
        const act = ch.picks.act || 'ATTACK';
        if (act === 'FIX' || act === 'BYPASS') {
          const at = e.redIntel.get(sc.id)?.pos ?? sc.pos;
          e.flags.screensAttacked = [...attacked, sc.id];
          if (act === 'FIX') {
            u.targetId = sc.id;
            u.phaseStart = u.strength;
            u.phaseCas = 0;
            setPath(e, u, offsetBefore(sc.pos, u.pos, 600), { cover: 0.7 });
            u.task = `Fixing screen ${e.where(sc.pos)}`;
            e.flags[`fixUntil_${u.id}`] = t + 25;
            redArty(e, at, 15, 'en arty on screens');
            e.marks.screenAttacked = e.marks.screenAttacked ?? t;
          } else {
            setPath(e, u, u.objPos ?? pointOn(apch, fy, 300), { cover: 0.9 });
            u.task = 'Adv guard — bypassing screen';
            redArty(e, at, 5, 'en arty on screens');
          }
          continue;
        }
      }
      u.targetId = sc.id;
      u.phaseStart = u.strength;
      u.phaseCas = 0;
      setPath(e, u, sc.pos, { direct: true, state: 'ASSAULT' });
      u.task = `Attk on screen ${e.where(sc.pos)}`;
      e.flags.screensAttacked = [...attacked, sc.id];
      redArty(e, e.redIntel.get(sc.id)?.pos ?? sc.pos, 10, 'en arty on screens');
      e.marks.screenAttacked = e.marks.screenAttacked ?? t;
    }
    if (u.targetId) {
      const tgt = e.byId.get(u.targetId);
      const fixUntil = e.flags[`fixUntil_${u.id}`] as number | undefined;
      if (!tgt || !alive(tgt) || tgt.state === 'WITHDRAW' || dist(tgt.pos, u.pos) > 2200) {
        u.targetId = undefined;
        u.objPos = pointOn(apch, fy, 300);
        setPath(e, u, u.objPos, { cover: 0.6 });
        u.task = 'Adv guard — continuing adv';
        if (fixUntil !== undefined) e.flags[`fixUntil_${u.id}`] = undefined;
      } else if (fixUntil !== undefined && t >= fixUntil) {
        // the screen has not given way under fire: assault it
        e.flags[`fixUntil_${u.id}`] = undefined;
        u.phaseStart = u.strength;
        u.phaseCas = 0;
        setPath(e, u, tgt.pos, { direct: true, state: 'ASSAULT' });
        u.task = `Attk on screen ${e.where(tgt.pos)}`;
      }
    }
  }
  // any other en elm left halted under fire breaks contact
  for (const u of red.filter((x) => (x.role === 'RECCE' || x.role === 'RESERVE' || x.role === 'BOF') && x.state === 'HALT' && x.supp > 0.45 && !x.probing)) {
    const b = e.blue().sort((p, q) => dist(p.pos, u.pos) - dist(q.pos, u.pos))[0];
    if (!b || dist(b.pos, u.pos) > 1600) continue;
    const away = norm(sub(u.pos, b.pos));
    setPath(e, u, add(u.pos, scale(away, 500)), { cover: 0.9 });
    u.task = 'Breaking contact';
  }

  // ---- harassing fire on known posns in the afternoon
  if (e.redPhase !== 'PRE' && t < e.hHour - 60 && t % 75 === 0) {
    const known = [...e.redIntel.entries()].filter(([, v]) => v.conf > 0.5);
    if (known.length) {
      const [, v] = known[e.rng.int(0, known.length - 1)];
      redArty(e, v.pos, 4, 'en harassing fire');
    }
  }

  // ---- move to FUP / BOF
  const travel = Math.round((dist(plan.faa, plan.fup) / 1000 / (s.enemy.attackAtNight ? 2.2 : 3.5)) * 60);
  const leaveFaa = e.hHour - 30 - travel;
  if ((e.redPhase === 'SECURITY' || e.redPhase === 'RECCE' || e.redPhase === 'ASSEMBLY') && t >= e.hHour - 330) e.redPhase = 'ASSEMBLY';
  if (e.redPhase === 'ASSEMBLY' && t >= leaveFaa) {
    e.redPhase = 'FUP';
    e.marks.leaveFaa = t;
    let i = 0;
    for (const u of red) {
      if (u.role === 'ASSAULT' || u.role === 'ENGR' || u.role === 'TANKS') setPath(e, u, spread(plan.fup, i++, 120), { cover: 0.8 });
      else if (u.role === 'RESERVE') setPath(e, u, add(plan.fup, scale(norm(sub(plan.faa, plan.fup)), 500)), { cover: 0.8 });
      else if (u.role === 'BOF') setPath(e, u, plan.bof, { cover: 0.8 });
      if (ASSAULT_ROLES.has(u.role as string) || u.role === 'BOF') u.task = u.role === 'BOF' ? `Move to BOF ${plan.bofName}` : `Move to FUP ${plan.fupName}`;
    }
  }
  if (e.redPhase === 'FUP') {
    const atFup = red.filter((u) => u.role === 'ASSAULT' && dist(u.pos, plan.fup) < 260);
    if (atFup.length && !e.marks.fupFormed) {
      e.marks.fupFormed = t;
      for (const u of atFup) u.task = 'Forming up';
    }
    if (t >= e.hHour) launchPhase(e, 1);
  }

  // ---- assault management
  if (e.redPhase === 'ASSAULT1' || e.redPhase === 'ASSAULT2') manageAssault(e);
  if (e.redPhase === 'REORG1' && t >= (e.marks.reorgUntil ?? 0)) launchPhase(e, 2);
  if (e.ai) reactToCatk(e, red);

  // ---- BOF: support from BOF posn
  for (const u of red.filter((x) => x.role === 'BOF')) {
    if (u.state === 'HALT' && dist(u.pos, plan.bof) < 150) {
      u.state = 'POSN';
      u.dug = 0.3;
      u.task = `BOF ${plan.bofName}`;
    }
  }

  // ---- consolidating units dig in
  for (const u of red.filter((x) => x.state === 'CONSOLIDATE')) u.dug = Math.min(0.55, u.dug + 0.008);

  // ---- end conditions
  if (e.redPhase === 'FAILED' && !e.marks.failedLogged) {
    e.marks.failedLogged = t;
    e.addLog('En attk has lost its impetus; en withdrawing towards the FAA.', 'good');
    for (const u of red) {
      if (u.role === 'RECCE') continue;
      setPath(e, u, spread(plan.faa, red.indexOf(u), 200), { cover: 0.6, state: 'WITHDRAW' });
      u.task = 'Withdrawing';
    }
  }
  if (e.redPhase === 'FAILED' && t > (e.marks.failedLogged ?? t) + 40 && e.fired.has('REORG')) e.finish('En attk repulsed');
  if (e.redPhase === 'CONSOLIDATE') {
    const since = e.marks.consolidated ?? t;
    if (t > since + 120 && e.fired.has('REORG')) e.finish('En consolidated on captured ground');
  }
}

function launchPhase(e: Engine, phase: 1 | 2): void {
  const plan = e.redPlan;
  const red = e.red();
  const objs = plan.objectives.filter((o) => o.phase === phase);
  if (phase === 1) {
    // a successful spoiling attk / DF on the FUP forces the en to re-form (delays H hr)
    const delay = (e.flags.fupDelay as number | undefined) ?? 0;
    if (delay > 0) {
      e.flags.fupDelay = 0;
      e.hHour = e.t + delay;
      e.marks.hDelayed = (e.marks.hDelayed ?? 0) + delay;
      return;
    }
  }
  const assault = red.filter((u) => (phase === 1 ? u.role === 'ASSAULT' : u.role === 'RESERVE' || (u.role === 'ADV_GUARD' && u.strength / u.start > 0.6)));
  if (!assault.length || !objs.length) {
    if (phase === 2) {
      e.redPhase = 'CONSOLIDATE';
      e.marks.consolidated = e.t;
    } else e.redPhase = 'FAILED';
    return;
  }
  e.redPhase = phase === 1 ? 'ASSAULT1' : 'ASSAULT2';
  e.marks[`h${phase}`] = e.t;
  assault.forEach((u, i) => {
    const o = objs[i % objs.length];
    const blue = o.blueId ? e.byId.get(o.blueId) : undefined;
    const target = blue && alive(blue) ? blue.pos : o.pos;
    u.role = 'ASSAULT';
    u.phase = phase;
    u.targetId = blue && alive(blue) ? blue.id : undefined;
    u.objPos = target;
    u.phaseStart = u.strength;
    u.phaseCas = 0;
    u.supp = 0;
    const sl = phase === 1 ? lerp(plan.fup, target, 0.1) : u.pos;
    u.path = [sl, offsetBefore(target, sl, 20)];
    u.pathIdx = 0;
    u.state = 'ASSAULT';
    u.task = `Ph ${phase} attk on ${o.name}`;
  });
  for (const tk of red.filter((u) => u.kind === 'ARMOUR')) {
    const o = objs[0];
    const cs = offsetBefore(o.pos, tk.pos, 350);
    tk.path = [cs];
    tk.pathIdx = 0;
    tk.state = 'ASSAULT';
    tk.objPos = o.pos;
    tk.task = `Tks in CS Ph ${phase}`;
    tk.phase = phase;
  }
  for (const en of red.filter((u) => u.role === 'ENGR')) {
    en.path = [offsetBefore(objs[0].pos, en.pos, 250)];
    en.pathIdx = 0;
    en.state = 'ASSAULT';
    en.task = 'Breaching party';
  }
  // arty: prep on the objectives, lifting later as the assault closes
  for (const o of objs) {
    const known = o.blueId ? e.redIntel.get(o.blueId) : undefined;
    redArty(e, known?.pos ?? o.pos, phase === 1 ? 25 : 15, `en ${phase === 1 ? 'prep bombardment' : 'Ph 2 fire'} on ${o.name}`, 'PREP');
  }
  e.addLog(`${phase === 1 ? 'En attk has commenced' : 'En Ph 2 has commenced'}${phase === 1 && (e.marks.hDelayed ?? 0) > 0 ? ` (H hr delayed by ${e.marks.hDelayed} min)` : ''}.`, 'crit');
}

function offsetBefore(target: Vec, from: Vec, d: number): Vec {
  const v = sub(from, target);
  const L = Math.hypot(v.x, v.y);
  if (L < 1) return target;
  return add(target, scale(v, d / L));
}

function manageAssault(e: Engine): void {
  const red = e.red();
  const phase = e.redPhase === 'ASSAULT1' ? 1 : 2;
  const assault = e.allRed().filter((u) => u.role === 'ASSAULT' && u.phase === phase);
  // lift prep fire when assaulting troops are within safety distance
  for (const m of e.missions) {
    if (m.side !== 'RED' || m.kind !== 'PREP' || m.end <= e.t) continue;
    if (assault.some((u) => alive(u) && dist(u.pos, m.target) < DOCTRINE.safety.FIELD + 120)) m.end = e.t;
  }
  for (const u of assault) {
    if (!alive(u) || u.state === 'WITHDRAW' || u.state === 'BROKEN' || u.state === 'CONSOLIDATE') continue;
    const loss = u.phaseCas / Math.max(1, u.phaseStart);
    // retarget to a BLUE locality discovered on the way
    if (!u.targetId) {
      const near = knownBlueNear(e, u.pos, 700, ['FDL', 'DEPTH', 'SP_PTL', 'SCREEN']).filter((b) => b.state !== 'CAPTURED').sort((a, b) => dist(a.pos, u.pos) - dist(b.pos, u.pos))[0];
      if (near) {
        u.targetId = near.id;
        u.objPos = near.pos;
        u.path = [offsetBefore(near.pos, u.pos, 20)];
        u.pathIdx = 0;
        u.task = `Attk on ${e.where(near.pos)}`;
      }
    }
    if (loss > 0.55 || u.morale < 0.3) {
      u.state = 'WITHDRAW';
      u.path = e.terrain.findPath(u.pos, e.redPlan.fup, 'FOOT', { preferCover: 0.8 });
      u.pathIdx = 0;
      u.task = 'Attk broken — falling back';
      e.addLog(`En attk on ${u.objPos ? e.where(u.objPos) : 'the FDLs'} is breaking up; en falling back.`, 'good');
      continue;
    }
    if (loss > 0.35 && !u.log && dist(u.pos, u.objPos ?? u.pos) > 250) {
      u.log = 'ground';
      u.waitUntil = e.t + 10;
      u.task = 'Pinned — gone to ground';
      continue;
    }
    // objective captured?
    const tgt = u.targetId ? e.byId.get(u.targetId) : undefined;
    const reached = u.objPos && dist(u.pos, u.objPos) < 60;
    if ((tgt && (tgt.state === 'CAPTURED' || tgt.state === 'DESTROYED' || tgt.state === 'WITHDRAW')) || (!tgt && reached)) {
      if (tgt && tgt.state !== 'CAPTURED' && tgt.state !== 'DESTROYED' && dist(u.pos, tgt.pos) > 120) continue;
      u.state = 'CONSOLIDATE';
      u.capturedAt = e.t;
      u.dug = 0.1;
      u.path = [];
      u.task = `Reorg on ${u.objPos ? e.where(u.objPos) : 'obj'}`;
    }
  }
  // tanks follow the leading assault and close onto captured objectives
  for (const tk of red.filter((u) => u.kind === 'ARMOUR')) {
    const lead = assault.filter((u) => alive(u)).sort((a, b) => dist(a.pos, a.objPos ?? a.pos) - dist(b.pos, b.objPos ?? b.pos))[0];
    if (!lead) continue;
    if (lead.state === 'CONSOLIDATE' && tk.pathIdx >= tk.path.length) {
      tk.path = [add(lead.pos, { x: 60, y: 120 })];
      tk.pathIdx = 0;
      tk.state = 'MOVE';
      tk.task = 'Tks on obj — reorg';
    } else if (lead.state === 'ASSAULT' && tk.pathIdx >= tk.path.length && dist(tk.pos, lead.pos) > 450) {
      tk.path = [offsetBefore(lead.pos, tk.pos, 250)];
      tk.pathIdx = 0;
      tk.state = 'ASSAULT';
    }
    if (tk.vehicles > 0 && tk.vehicles <= Math.ceil(tk.startVehicles / 3) && tk.state !== 'WITHDRAW') {
      tk.state = 'WITHDRAW';
      tk.path = [e.redPlan.fup];
      tk.pathIdx = 0;
      tk.task = 'Tks pulling back';
    }
  }
  const live = assault.filter((u) => alive(u) && u.state !== 'WITHDRAW' && u.state !== 'BROKEN');
  const consolidated = assault.filter((u) => alive(u) && u.state === 'CONSOLIDATE');
  if (live.length && live.every((u) => u.state === 'CONSOLIDATE')) {
    if (phase === 1) {
      let act = 'PH2_PLANNED';
      if (e.ai) {
        const ch = aiDecide(e, reorgDp(e, consolidated));
        if (ch === 'WAIT') return;
        act = ch.picks.act || act;
      }
      if (act === 'HOLD') {
        e.redPhase = 'CONSOLIDATE';
        e.marks.consolidated = e.t;
      } else {
        e.redPhase = 'REORG1';
        e.marks.reorgUntil = e.t + (act === 'PH2_QUICK' ? 10 : 25);
      }
      e.addLog(`En reorganising on ${[...new Set(consolidated.map((u) => e.where(u.pos)))].join(', ')}.`, 'warn');
    } else {
      e.redPhase = 'CONSOLIDATE';
      e.marks.consolidated = e.t;
      e.addLog('En Ph 2 complete; en consolidating.', 'crit');
    }
  } else if (!live.length) {
    // every assaulting sub-unit has failed: second wave once (not in TRAINING), else give up
    const reserve = red.filter((u) => u.role === 'RESERVE' && alive(u));
    let act = 'SECOND_WAVE';
    if (phase === 1 && reserve.length && !e.flags.secondWave && e.opts.difficulty !== 'TRAINING' && e.ai) {
      const ch = aiDecide(e, ph1FailDp(e, reserve.length, consolidated.length));
      if (ch === 'WAIT') return;
      act = ch.picks.act || act;
      if (act === 'BREAK_OFF') {
        e.flags.secondWave = true;
        if (consolidated.length) {
          e.redPhase = 'CONSOLIDATE';
          e.marks.consolidated = e.t;
        } else {
          e.redPhase = 'FAILED';
          e.marks.attackFailed = e.t;
        }
        return;
      }
    }
    if (phase === 1 && reserve.length && !e.flags.secondWave && e.opts.difficulty !== 'TRAINING') {
      e.flags.secondWave = true;
      e.flags.fupDelay = 0;
      for (const r of reserve) {
        r.role = 'ASSAULT';
        r.phase = undefined;
      }
      e.redPhase = 'FUP';
      e.hHour = e.t + (act === 'SECOND_WAVE_PREP' ? 45 : 30);
      if (act === 'SECOND_WAVE_PREP') for (const o of e.redPlan.objectives.filter((x) => x.phase === 1)) redArty(e, (o.blueId ? e.redIntel.get(o.blueId)?.pos : undefined) ?? o.pos, 20, `en fresh bombardment on ${o.name}`, 'PREP');
      for (const r of reserve) {
        r.path = e.terrain.findPath(r.pos, e.redPlan.fup, 'FOOT', { preferCover: 0.8 });
        r.pathIdx = 0;
        r.state = 'MOVE';
        r.task = 'Second wave — moving to FUP';
      }
      e.addLog('En committing his res for a fresh attk.', 'warn');
    } else if (consolidated.length) {
      e.redPhase = phase === 1 ? 'REORG1' : 'CONSOLIDATE';
      e.marks.reorgUntil = e.t + 25;
      if (phase === 2) e.marks.consolidated = e.t;
    } else {
      e.redPhase = 'FAILED';
      e.marks.attackFailed = e.t;
    }
  }
}

export function redPlanTextFinal(e: Engine): string[] {
  const out = [...e.redPlan.text];
  if (e.marks.hDelayed) out.push(`H hr was delayed by ${e.marks.hDelayed} min by own action against the FUP.`);
  if (e.flags.secondWave) out.push('En committed his reserve in a second wave after the first assault failed.');
  if (e.redPhase === 'FAILED') out.push('The attk failed and the en withdrew.');
  if (e.redPhase === 'CONSOLIDATE') out.push('The en secured his objectives and consolidated.');
  for (const n of (e.flags.enCdrNotes as string[] | undefined) ?? []) out.push(n);
  return out;
}

// ------------------------------------------------------------------ enemy commander decision points
// Only used when a controller is attached (e.ai). Each builds a small enumerated menu from what
// Foxland knows (redIntel) and applies the controller's pick; the rule-based default reproduces
// the behaviour above. Nothing here consumes the RNG, so offline battles are unchanged.

const ECH: Record<string, string> = { TEAM: 'Det', SEC: 'Sec', PL: 'Pl', COY: 'Coy', BN: 'Bn', BDE: 'Bde' };
const ROLE_CODE: Record<string, string> = { FDL: 'fdl', DEPTH: 'dp', SCREEN: 'scn', SP_PTL: 'sp', LP: 'lp', RES: 'res', SP_WPN: 'wpn', CHQ: 'hq', CP: 'cp', OBS: 'obs', QC: 'qc', ENGR: 'pnr' };

/** Compact place description ("15 r", "350NE Alipur", "155 735"). */
export function shortWhere(e: Engine, p: Vec): string {
  return e
    .where(p)
    .replace(/^area /, '')
    .replace(/^(\d+) m ([NESW]+) of /, '$1$2 ')
    .replace(/^GR /, '');
}

/** What Foxland knows of own posns, in a stable order. */
function knownList(e: Engine): { u: SimUnit; pos: Vec; conf: number }[] {
  const out: { u: SimUnit; pos: Vec; conf: number }[] = [];
  for (const [id, v] of e.redIntel) {
    const u = e.byId.get(id);
    if (!u || !alive(u) || v.conf < 0.3) continue;
    out.push({ u, pos: v.pos, conf: v.conf });
  }
  return out.sort((a, b) => a.pos.x - b.pos.x || a.pos.y - b.pos.y);
}

/** "fdl Pl@15 r c.8" */
function knownText(e: Engine, k: { u: SimUnit; pos: Vec; conf: number }): string {
  return `${ROLE_CODE[k.u.role as string] ?? 'posn'} ${ECH[k.u.echelon] ?? ''}@${shortWhere(e, k.pos)} c.${Math.min(9, Math.round(k.conf * 10))}`;
}

function aiDecide(e: Engine, dp: RedDecisionPoint): RedChoice | 'WAIT' {
  const ch = e.ai ? e.ai.redDecide(e, dp) : ruleChoice(dp);
  if (ch !== 'WAIT' && ch.src !== 'RULE' && ch.intent) {
    const notes = ((e.flags.enCdrNotes as string[] | undefined) ?? []).slice();
    notes.push(`En cdr (${e.timeStr()}): ${ch.intent}`);
    e.flags.enCdrNotes = notes;
  }
  return ch;
}

function strengthLine(e: Engine): string {
  const red = e.allRed().filter((u) => alive(u));
  const inf = red.filter((u) => u.kind === 'INF' && u.role !== 'RECCE' && u.role !== 'BOF');
  const tks = red.reduce((m, u) => m + u.vehicles, 0);
  const pct = Math.round((100 * inf.reduce((m, u) => m + u.strength, 0)) / Math.max(1, inf.reduce((m, u) => m + u.start, 0)));
  return `${inf.length} inf coys ${pct}%${tks ? `, ${tks} tks` : ''}`;
}

function pctOf(us: SimUnit[]): number {
  return Math.round((100 * us.reduce((m, u) => m + u.strength, 0)) / Math.max(1, us.reduce((m, u) => m + u.start, 0)));
}

export function planDp(e: Engine): RedDecisionPoint {
  const ds = e.s.ds;
  const known = knownList(e);
  const apchs = [...ds.approaches].sort((a, b) => a.pri - b.pri);
  const apchOpts = apchs.map((a, i) => ({
    id: `A${i + 1}`,
    val: a.id,
    text: `${a.name.replace(/ Apch$/, '')} tk:${a.tankGoing} own posns near:${known.filter((k) => distToPolyline(k.pos, a.path).d < 900).length}`,
  }));
  const locs = known.filter((k) => (k.u.role === 'FDL' || k.u.role === 'DEPTH') && k.u.kind === 'INF');
  const others = known.filter((k) => !locs.includes(k)).slice(0, 6);
  const night = e.s.enemy.attackAtNight;
  return {
    key: 'PLAN',
    kind: 'PLAN',
    sit: `Final attk plan. Planned H ${e.timeStr(e.hHour).replace(/ hrs$/, '')}${night ? ' (night)' : ''}. Force ${strengthLine(e)}.${others.length ? ` Also known: ${others.map((k) => knownText(e, k)).join('; ')}.` : ''}`,
    groups: [
      { name: 'apch', def: '', options: apchOpts },
      { name: 'obj', def: '', options: [{ id: 'AUTO', text: 'nearest locality(s) to apch', val: '' }, ...locs.map((k, i) => ({ id: `L${i + 1}`, val: k.u.id, text: knownText(e, k) }))] },
      { name: 'h', def: 'H0', options: ['H-15', 'H0', 'H+15', 'H+30'].map((id) => ({ id, text: id === 'H0' ? 'as planned' : `shift ${id.slice(1)} min` })) },
      { name: 'feint', def: 'NONE', options: [{ id: 'NONE', text: 'no feint' }, ...apchOpts.map((o) => ({ id: `F${o.id}`, val: o.val, text: `adv gd feint on ${o.text.split(' tk:')[0]} at H-45` }))] },
    ],
  };
}

function applyPlanChoice(e: Engine, dp: RedDecisionPoint, ch: RedChoice): void {
  const shift = ({ 'H-15': -15, 'H+15': 15, 'H+30': 30 } as Record<string, number>)[ch.picks.h ?? ''] ?? 0;
  if (shift) e.hHour += shift;
  const approachId = pickVal(dp, ch, 'apch') || undefined;
  const objId = pickVal(dp, ch, 'obj') || undefined;
  planAttack(e, true, approachId || objId ? { approachId, objId } : undefined);
  const feint = pickVal(dp, ch, 'feint');
  if (feint && feint !== 'NONE' && feint !== e.redPlan.approachId) e.flags.feint = { apchId: feint, at: e.hHour - 45, done: false };
  e.marks.redPlanned = e.t;
}

function runFeint(e: Engine, red: SimUnit[], fy: number): void {
  const f = e.flags.feint as { apchId: string; at: number; done: boolean } | undefined;
  if (!f) return;
  const a = approachById(e, f.apchId);
  if (!f.done && e.t >= f.at) {
    f.done = true;
    const u =
      red.find((x) => x.role === 'ADV_GUARD' && x.strength / x.start > 0.4 && x.state !== 'WITHDRAW' && x.state !== 'BROKEN') ??
      red.find((x) => x.role === 'RECCE' && x.strength > 4 && !x.probing);
    if (u) {
      u.targetId = undefined;
      u.phaseStart = u.strength;
      u.phaseCas = 0;
      setPath(e, u, pointOn(a, fy, 450), { cover: 0.5 });
      u.task = 'Feint';
    }
    redArty(e, pointOn(a, fy, 0), 8, 'en arty (feint)');
    return;
  }
  // feint party: hold at the demonstration line, then break clean once it has drawn fire
  for (const u of red.filter((x) => x.task === 'Feint')) {
    if ((u.state === 'HALT' && e.t > f.at + 25) || u.phaseCas / Math.max(1, u.phaseStart) > 0.3) {
      setPath(e, u, pointOn(a, fy, 1600), { cover: 0.8 });
      u.task = 'Out of contact — feint complete';
    }
  }
}

function screenDp(e: Engine, u: SimUnit, sc: SimUnit): RedDecisionPoint {
  const k = knownList(e);
  const sk = k.find((x) => x.u.id === sc.id);
  const main = k.filter((x) => ['FDL', 'DEPTH'].includes(x.u.role as string));
  return {
    key: `SCREEN:${sc.id}`,
    kind: 'SCREEN',
    sit: `Adv gd ${pctOf([u])}% contacts own ${sk ? knownText(e, sk) : `screen@${shortWhere(e, sc.pos)}`}, ${Math.round(dist(u.pos, sc.pos) / 100) / 10} km. Main posn ${main.length ? `known: ${main.map((x) => knownText(e, x)).join('; ')}` : 'not yet located'}.`,
    groups: [
      {
        name: 'act',
        def: 'ATTACK',
        options: [
          { id: 'ATTACK', text: 'drive in the screen now, arty 10 min' },
          { id: 'FIX', text: 'fix by fire from 600 m, arty 15 min, assault after 25 min if it holds' },
          { id: 'BYPASS', text: 'bypass under cover, keep adv to locate main posn' },
        ],
      },
    ],
    focus: sc.pos,
  };
}

function ph1FailDp(e: Engine, reserves: number, consolidated: number): RedDecisionPoint {
  return {
    key: 'PH1_FAIL',
    kind: 'PH1_FAIL',
    sit: `Ph 1 assault has failed${consolidated ? ` (${consolidated} sub-unit(s) hold a foothold)` : ''}. Force ${strengthLine(e)}; ${reserves} res coy(s) uncommitted. Own DF (SOS) ${e.marks.sosCalled ? 'active' : 'not seen'}.`,
    groups: [
      {
        name: 'act',
        def: 'SECOND_WAVE',
        options: [
          { id: 'SECOND_WAVE', text: 'commit res: fresh attk from FUP in 30 min' },
          { id: 'SECOND_WAVE_PREP', text: 'commit res in 45 min after a fresh 20 min bombardment' },
          { id: 'BREAK_OFF', text: consolidated ? 'break off, hold the foothold' : 'break off the attk, withdraw' },
        ],
      },
    ],
  };
}

function reorgDp(e: Engine, consolidated: SimUnit[]): RedDecisionPoint {
  const k = knownList(e).filter((x) => x.u.role === 'DEPTH' || x.u.role === 'RES');
  return {
    key: 'REORG1',
    kind: 'REORG1',
    sit: `Ph 1 obj taken (${consolidated.length} sub-unit(s) ${pctOf(consolidated)}%). Force ${strengthLine(e)}. Own depth ${k.length ? k.map((x) => knownText(e, x)).join('; ') : 'not located'}. Own C attk likely.`,
    groups: [
      {
        name: 'act',
        def: 'PH2_PLANNED',
        options: [
          { id: 'PH2_PLANNED', text: 'reorg 25 min, then Ph 2 as planned' },
          { id: 'PH2_QUICK', text: 'hasty reorg 10 min, Ph 2 before own C attk' },
          { id: 'HOLD', text: 'no Ph 2: consolidate on Ph 1 obj' },
        ],
      },
    ],
  };
}

function reactToCatk(e: Engine, red: SimUnit[]): void {
  const seen = (e.flags.catkSeen as string[] | undefined) ?? [];
  for (const b of e.blue().filter((x) => x.catk && x.state === 'ASSAULT')) {
    const key = `CATK:${b.id}`;
    if (seen.includes(key)) continue;
    const intel = e.redIntel.get(b.id);
    if (!intel || intel.conf < 0.3) continue;
    const threatened = red.filter((r) => (r.state === 'CONSOLIDATE' || r.state === 'ASSAULT') && r.kind === 'INF' && dist(r.pos, intel.pos) < 900);
    if (!threatened.length) continue;
    const reserves = red.filter((r) => (r.role === 'RESERVE' || r.kind === 'ARMOUR') && r.state !== 'WITHDRAW' && r.state !== 'BROKEN');
    const dp: RedDecisionPoint = {
      key,
      kind: 'CATK',
      sit: `Own C attk (${ECH[b.echelon] ?? 'force'}) closing on our ${threatened.length} sub-unit(s) at ${shortWhere(e, threatened[0].pos)} (${pctOf(threatened)}%), ${Math.round(dist(intel.pos, threatened[0].pos) / 10) * 10} m away. ${reserves.length} res/tk elm(s) aval. Arty amn ${e.ammo.EN_ARTY > 0 ? 'aval' : 'nil'}.`,
      groups: [
        {
          name: 'act',
          def: 'HOLD_FIGHT',
          options: [
            { id: 'HOLD_FIGHT', text: 'hold and fight from the captured posn' },
            { id: 'REINFORCE', text: 'rush res/tks onto the obj' },
            { id: 'ARTY_DF', text: 'arty DF on the C attk 10 min' },
            { id: 'WITHDRAW', text: 'give up the obj, withdraw to FUP' },
          ],
        },
      ],
      focus: intel.pos,
    };
    const ch = aiDecide(e, dp);
    if (ch === 'WAIT') return;
    e.flags.catkSeen = [...seen, key];
    const act = ch.picks.act || 'HOLD_FIGHT';
    if (act === 'REINFORCE') {
      reserves.forEach((r, i) => {
        setPath(e, r, spread(threatened[0].pos, i, 90), { cover: 0.5 });
        r.task = 'Reinforcing the obj';
      });
    } else if (act === 'ARTY_DF') {
      redArty(e, intel.pos, 10, 'en DF on own C attk');
    } else if (act === 'WITHDRAW') {
      for (const r of threatened) {
        setPath(e, r, e.redPlan.fup, { cover: 0.8, state: 'WITHDRAW' });
        r.task = 'Withdrawing before C attk';
      }
      if (!red.some((r) => alive(r) && r.state === 'CONSOLIDATE')) {
        e.redPhase = 'FAILED';
        e.marks.attackFailed = e.t;
      }
    }
    return;
  }
}

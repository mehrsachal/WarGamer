// Indirect fire (arty / mortar DFs, DF SOS, adjusted fire), quadcopters (surveillance
// and attack QC) with EW / AD threats, and UCAV strikes on justified demand.

import { type Vec, add, dist, lerp } from '../core/geom';
import { uid } from '../core/rng';
import { alive, type DfTarget, type Engine } from './engine';
import { reportContact } from './sensors';
import { sizeFactor } from './combat';
import type { FireAsset, FireKind, FireMission, QcState, SimUnit } from './types';

const LETHALITY: Record<number, number> = { 60: 0.035, 81: 0.06, 105: 0.1, 122: 0.12, 155: 0.17 };

export function newMission(
  e: Engine,
  side: 'BLUE' | 'RED',
  asset: FireAsset,
  kind: FireKind,
  target: Vec,
  radius: number,
  start: number,
  minutes: number,
  rpm: number,
  calibre: number,
  observed: boolean,
  label: string,
  errSd?: number,
): FireMission {
  const sd = errSd ?? (observed ? 30 : kind === 'DF' || kind === 'SOS' ? 55 : 170);
  return {
    id: uid('fm'),
    side,
    asset,
    kind,
    target,
    radius,
    start,
    end: start + minutes,
    rpm,
    calibre,
    observed,
    label,
    error: { x: e.rng.normal(0, sd), y: e.rng.normal(0, sd) },
  };
}

/** Is there a BLUE observer (FOO/MFC/OP/CP or any locality for close targets) with LOS to p? */
export function blueObserverFor(e: Engine, p: Vec, prefer: 'ARTY' | 'MOR' | 'ANY' = 'ANY'): SimUnit | undefined {
  const obs = e
    .blue()
    .filter((u) => u.state !== 'MOVE')
    .filter((u) => {
      if (prefer === 'ARTY' && u.key !== 'ARTY_OBS') return false;
      if (prefer === 'MOR' && u.key !== 'MOR_OBS') return false;
      return true;
    })
    .filter((u) => dist(u.pos, p) < (u.key === 'ARTY_OBS' || u.key === 'MOR_OBS' ? 3500 : 1500))
    .filter((u) => e.terrain.los(u.pos, p, e.terrain.eyeHeight(u.pos), 2) > 0.3);
  return obs.sort((a, b) => dist(a.pos, p) - dist(b.pos, p))[0];
}

function batteriesFor(e: Engine, asset: 'ARTY' | 'MOR81' | 'MOR60', sos: boolean): { rpm: number; calibre: number } {
  if (asset === 'ARTY') {
    const btys = sos ? Math.max(1, e.s.own.fire.artyBatteries) : Math.min(2, e.s.own.fire.artyBatteries);
    return { rpm: btys * 12, calibre: Number(e.s.own.fire.artyCalibre) };
  }
  if (asset === 'MOR81') return { rpm: 20, calibre: 81 };
  const tubes = e.blue().reduce((m, u) => m + e.weaponCount(u, 'MOR60'), 0);
  return { rpm: Math.max(0, Math.round(tubes * 6)), calibre: 60 };
}

function adjustBatteries(e: Engine, asset: 'ARTY' | 'MOR81' | 'MOR60'): { rpm: number; calibre: number } {
  if (asset === 'ARTY') {
    const btys = 1;
    return { rpm: btys * 12, calibre: Number(e.s.own.fire.artyCalibre) };
  }
  if (asset === 'MOR81') return { rpm: 20, calibre: 81 };
  const tubes = e.blue().reduce((m, u) => m + e.weaponCount(u, 'MOR60'), 0);
  return { rpm: Math.max(0, Math.round(tubes * 6)), calibre: 60 };
}

/** Fire a planned DF / DF (SOS). Returns a message. */
export function fireDf(e: Engine, df: DfTarget, minutes = 5): string {
  if (df.asset === 'MOR81' && !e.s.own.fire.mor81) return 'No 81mm mors in sp.';
  const { rpm, calibre } = batteriesFor(e, df.asset, df.sos);
  if (rpm <= 0) return `${df.asset} not aval.`;
  if (e.ammo[df.asset] <= 0) return `${df.asset} out of amn.`;
  const obs = blueObserverFor(e, df.pos, df.asset === 'ARTY' ? 'ARTY' : 'ANY');
  const delay = df.sos ? 1 : 3;
  e.missions.push(newMission(e, 'BLUE', df.asset, df.sos ? 'SOS' : 'DF', df.pos, df.radius, e.t + delay, minutes, rpm, calibre, !!obs, df.label, obs ? 30 : 60));
  df.fired++;
  return `${df.label} called (${df.asset === 'ARTY' ? e.s.own.fire.artyLabel.split('(')[0].trim() : df.asset}); first rds in ${delay} min${obs ? `, obsd by ${obs.label}` : ', unobserved'}.`;
}

/** New target fire on a contact (adjusted if an observer can see it). */
export function fireOnPoint(e: Engine, p: Vec, asset: 'ARTY' | 'MOR81' | 'MOR60', minutes: number, label: string): string {
  if (asset === 'MOR81' && !e.s.own.fire.mor81) return 'No 81mm mors in sp.';
  const pre = e.dfNear(p, 350);
  if (pre && pre.asset === asset) return fireDf(e, pre, minutes);
  const { rpm, calibre } = label.startsWith('FOO') ? adjustBatteries(e, asset) : batteriesFor(e, asset, false);
  if (rpm <= 0 || e.ammo[asset] <= 0) return `${asset} not aval.`;
  const obs = blueObserverFor(e, p, asset === 'ARTY' ? 'ARTY' : 'ANY');
  const delay = obs ? 6 : 8;
  e.missions.push(newMission(e, 'BLUE', asset, 'ADJUST', p, 150, e.t + delay, minutes, rpm, calibre, !!obs, label, obs ? 45 : 180));
  return `Fire mission (${label}) — new tgt, ${obs ? `adjusted by ${obs.label}` : 'UNOBSERVED (no obsr with LOS)'}; on tgt in ${delay} min.`;
}

function exposure(e: Engine, u: SimUnit, m: FireMission): number {
  const cover = e.terrain.coverAt(u.pos);
  let f: number;
  if (u.state === 'MOVE' || u.state === 'ASSAULT' || u.state === 'WITHDRAW') f = 1;
  else if (u.state === 'HALT') {
    // troops forming up / in an assembly area are a dense target
    const dense = e.redPlan && (dist(u.pos, e.redPlan.fup) < 350 || dist(u.pos, e.redPlan.faa) < 400);
    f = u.side === 'RED' && dense ? 1.25 : 0.7;
  } else f = Math.max(0.03, 0.5 - 0.47 * u.dug);
  void m;
  return f * (1 - 0.6 * cover) * sizeFactor(u);
}

export function resolveFires(e: Engine): void {
  const t = e.t;
  for (const m of e.missions) {
    if (t < m.start || t >= m.end) continue;
    const ammoKey = m.asset === 'EN_ARTY' || m.asset === 'EN_MOR' ? 'EN_ARTY' : m.asset;
    if (e.ammo[ammoKey] <= 0) {
      m.end = t;
      continue;
    }
    // fire lifts when own assaulting tps close in (RED prep / BLUE adjusted fire)
    if ((m.side === 'RED' || m.kind === 'ADJUST') && e.units.some((u) => u.side === m.side && alive(u) && u.state !== 'OFFMAP' && u.kind !== 'ARMOUR' && dist(u.pos, add(m.target, m.error)) < m.radius + 160)) {
      m.end = t;
      continue;
    }
    const rounds = Math.min(m.rpm, e.ammo[ammoKey]);
    e.ammo[ammoKey] -= rounds;
    const impact = add(m.target, m.error);
    // observed fire walks onto the target
    if (m.observed) m.error = { x: m.error.x * 0.6, y: m.error.y * 0.6 };
    const leth = LETHALITY[m.calibre] ?? 0.1;
    for (const u of e.units) {
      if (!alive(u) || u.state === 'OFFMAP') continue;
      const d = dist(u.pos, impact);
      const reach = m.radius + u.radius * 0.6;
      if (d > reach + 60) continue;
      const overlap = Math.max(0, Math.min(1, 1 - Math.max(0, d - m.radius * 0.5) / reach));
      if (overlap <= 0) continue;
      if (u.vehicles > 0) {
        const pk = rounds * 0.0012 * (m.calibre >= 155 ? 2 : 1) * overlap;
        if (e.rng.chance(pk)) e.killTank(u, m.side === 'BLUE' ? 'arty' : 'en arty');
        u.supp = Math.min(1, u.supp + 0.15 * overlap);
        continue;
      }
      const exp = exposure(e, u, m);
      const cas = e.rng.poisson(rounds * leth * exp * overlap);
      if (cas > 0) {
        e.inflict(u, cas, m.label);
        if (u.side === m.side) e.addLog(`Own fire (${m.label}) falling on ${u.label} — ${cas} cas! Danger close.`, 'crit');
      }
      u.supp = Math.min(1, u.supp + 0.4 * overlap);
      // troops caught moving in the open go to ground
      if (u.side === 'RED' && (u.state === 'MOVE' || u.state === 'ASSAULT') && e.rng.chance(0.35 * overlap)) u.waitUntil = Math.max(u.waitUntil ?? 0, t + 2);
      if (u.side === 'RED') e.flags[`df_hit_${u.id}`] = t;
    }
    if (t % 2 === 0) e.frameFire.push([Math.round(impact.x), Math.round(impact.y), Math.round(impact.x), Math.round(impact.y), m.side === 'BLUE' ? 3 : 4]);
    e.fireEvents.push({ from: impact, to: impact, kind: m.side === 'BLUE' ? 3 : 4 });
  }
  if (e.missions.length > 200) e.missions = e.missions.filter((m) => m.end > t - 30);
}

// ------------------------------------------------------------------ quadcopters

const QC_ENDURANCE = 35;
const QC_RECHARGE = 40;
const QC_SPEED = 900; // m/min (~55 kph)

export function ensureQcs(e: Engine): void {
  if (e.qcs.length) return;
  for (const det of e.units.filter((u) => u.side === 'BLUE' && u.key === 'QC_DET')) {
    e.qcs.push({ id: `${det.id}_s`, kind: 'SURV', base: det.pos, pos: { ...det.pos }, airborne: false, endurance: QC_ENDURANCE, launchedAt: -1, readyAt: e.t, lost: false, usedStrikes: 0 });
    e.qcs.push({ id: `${det.id}_a`, kind: 'ATTACK', base: det.pos, pos: { ...det.pos }, airborne: false, endurance: 20, launchedAt: -1, readyAt: e.t, lost: false, usedStrikes: 0 });
  }
}

export function launchSurvQc(e: Engine, target: Vec): string {
  ensureQcs(e);
  const q = e.qcs.find((x) => x.kind === 'SURV' && !x.lost && !x.airborne && x.readyAt <= e.t);
  if (!q) {
    const busy = e.qcs.find((x) => x.kind === 'SURV' && !x.lost);
    return busy ? (busy.airborne ? 'Surv QC already airborne — retasked.' : `Surv QC recharging; ready ${e.timeStr(busy.readyAt)}.`) : 'No surv QC aval.';
  }
  q.airborne = true;
  q.launchedAt = e.t;
  q.target = target;
  q.pos = { ...q.base };
  return `Surv QC launched to ${e.where(target)} (endurance ${QC_ENDURANCE} min).`;
}

export function retaskSurvQc(e: Engine, target: Vec): string {
  ensureQcs(e);
  const q = e.qcs.find((x) => x.kind === 'SURV' && !x.lost && x.airborne);
  if (q) {
    q.target = target;
    return `Surv QC retasked to ${e.where(target)}.`;
  }
  return launchSurvQc(e, target);
}

export function launchAttackQc(e: Engine, unitId: string): string {
  ensureQcs(e);
  const q = e.qcs.find((x) => x.kind === 'ATTACK' && !x.lost && !x.airborne && x.usedStrikes === 0);
  if (!q) return 'No A/QC aval (already expended or lost).';
  const c = e.contacts.get(unitId);
  if (!c) return 'Tgt not held.';
  q.airborne = true;
  q.launchedAt = e.t;
  q.target = c.pos;
  q.targetUnitId = unitId;
  q.pos = { ...q.base };
  return `A/QC launched on ${c.ident === 'ARMOUR' ? 'tks' : 'en'} ${e.where(c.pos)}; time to tgt ~${Math.ceil(dist(q.base, c.pos) / QC_SPEED)} min.`;
}

export function runQc(e: Engine): void {
  ensureQcs(e);
  // pre-planned surveillance sorties
  for (const s of e.plan.qcSorties) {
    if (s.start === e.t) {
      const g = e.plan.graphics.find((x) => x.id === s.areaId);
      if (g?.pts[0]) e.addLog(launchSurvQc(e, g.pts[0]), 'info');
    }
  }
  const ew = e.s.enemy.ewThreat === 'HIGH' ? 0.012 : e.s.enemy.ewThreat === 'MED' ? 0.006 : 0.002;
  for (const q of e.qcs) {
    if (q.lost || !q.airborne || !q.target) continue;
    const toGo = dist(q.pos, q.target);
    q.pos = toGo <= QC_SPEED ? { ...q.target } : lerp(q.pos, q.target, QC_SPEED / toGo);
    const up = e.t - q.launchedAt;
    // EW: jamming of the control link
    if (e.rng.chance(ew)) {
      const lost = e.rng.chance(0.3);
      q.airborne = false;
      q.readyAt = e.t + QC_RECHARGE;
      if (lost) q.lost = true;
      e.addLog(`${q.kind === 'SURV' ? 'Surv QC' : 'A/QC'} link jammed by en EW — ${lost ? 'QC lost' : 'returned to base'}.`, 'warn');
      e.marks.qcJammed = e.t;
      continue;
    }
    // en small arms / AD against a QC over a concentration
    const redNear = e.red().filter((r) => dist(r.pos, q.pos) < 500 && r.strength > 30);
    if (redNear.length && e.rng.chance(0.004 * redNear.length)) {
      q.lost = true;
      q.airborne = false;
      e.addLog(`${q.kind === 'SURV' ? 'Surv QC' : 'A/QC'} shot down ${e.where(q.pos)}.`, 'warn');
      continue;
    }
    if (q.kind === 'SURV') {
      const night = e.isNight();
      const fp = night ? 450 : 650;
      for (const r of e.red()) {
        if (dist(r.pos, q.pos) > fp) continue;
        const conceal = e.terrain.concealAt(r.pos);
        const p = (night ? 0.55 : 0.75) * (1 - 0.6 * conceal) * e.s.weather.vis;
        if (e.rng.chance(p)) reportContact(e, r, 'Surv QC', 0.9, 100);
      }
      if (up >= q.endurance) {
        q.airborne = false;
        q.readyAt = e.t + QC_RECHARGE;
        e.addLog('Surv QC returning to base (endurance).', 'info');
      }
    } else if (toGo <= QC_SPEED) {
      // attack QC strike
      q.airborne = false;
      q.usedStrikes = 1;
      const tgt = q.targetUnitId ? e.byId.get(q.targetUnitId) : undefined;
      if (tgt && alive(tgt) && dist(tgt.pos, q.pos) < 250) {
        if (tgt.vehicles > 0) {
          if (e.rng.chance(0.45)) e.killTank(tgt, 'A/QC');
          else e.addLog('A/QC strike on en tk — near miss.', 'info');
        } else {
          const cas = e.rng.int(1, 4);
          e.inflict(tgt, cas, 'A/QC');
          tgt.supp = Math.min(1, tgt.supp + 0.3);
          e.addLog(`A/QC strike ${e.where(tgt.pos)}: ${cas} en cas.`, 'good');
        }
        e.flags[`df_hit_${tgt.id}`] = e.t;
      } else e.addLog('A/QC strike — tgt had moved, no effect.', 'info');
    }
  }
}

// ------------------------------------------------------------------ UCAV

export function requestUcav(e: Engine, contactId: string, justification: string[]): { ok: boolean; msg: string; justified: boolean } {
  const c = e.contacts.get(contactId);
  if (!c) return { ok: false, msg: 'Tgt not held.', justified: false };
  if (e.ucavLeft <= 0) return { ok: false, msg: 'UCAV not aval (no sorties left).', justified: false };
  const highValue = c.ident === 'ARMOUR' || c.size === 'COY' || c.size === 'BN' || c.ident === 'SUPPORT';
  const confirmed = c.conf >= 0.55 && e.t - c.lastSeen <= 15;
  const outOfDf = !e.dfNear(c.pos, 400);
  const justified = highValue && confirmed;
  if (!justified) {
    e.addLog(`UCAV demand on ${e.where(c.pos)} not approved by Bde HQ — ${!highValue ? 'tgt not of high value' : 'tgt not confirmed / stale'}.`, 'warn');
    return { ok: false, msg: 'Demand rejected — not justified.', justified: false };
  }
  e.ucavLeft--;
  const at = e.t + e.rng.int(20, 35);
  e.ucavPending.push({ at, contactId, target: c.pos, justified: true });
  void outOfDf;
  void justification;
  e.addLog(`UCAV strike approved on ${c.ident === 'ARMOUR' ? 'en armr' : 'en conc'} ${e.where(c.pos)}; TOT ~${e.timeStr(at)}.`, 'info');
  return { ok: true, msg: `UCAV strike approved; TOT ${e.timeStr(at)}.`, justified: true };
}

export function runUcav(e: Engine): void {
  const due = e.ucavPending.filter((p) => p.at <= e.t);
  if (!due.length) return;
  e.ucavPending = e.ucavPending.filter((p) => p.at > e.t);
  for (const p of due) {
    const abort = e.s.enemy.airThreat === 'HIGH' ? 0.25 : e.s.enemy.airThreat === 'MED' ? 0.12 : 0.05;
    if (e.rng.chance(abort)) {
      e.addLog('UCAV sortie aborted — en AD / air threat.', 'warn');
      continue;
    }
    const tgts = e.red().filter((r) => dist(r.pos, p.target) < 350);
    if (!tgts.length) {
      e.addLog(`UCAV strike ${e.where(p.target)} — tgt area empty (en had moved).`, 'warn');
      continue;
    }
    let report = '';
    for (let i = 0; i < 2; i++) {
      const tk = tgts.find((r) => r.vehicles > 0 && alive(r));
      if (tk && e.rng.chance(0.6)) {
        e.killTank(tk, 'UCAV');
        report += ' 1 x tk destroyed.';
      } else {
        const inf = tgts.filter((r) => r.vehicles === 0 && alive(r)).sort((a, b) => b.strength - a.strength)[0];
        if (inf) {
          const dense = dist(inf.pos, e.redPlan.fup) < 400 || dist(inf.pos, e.redPlan.faa) < 400;
          const cas = e.rng.int(3, dense ? 10 : 6);
          e.inflict(inf, cas, 'UCAV');
          inf.supp = 1;
          report += ` ${cas} en cas.`;
          e.flags[`df_hit_${inf.id}`] = e.t;
        }
      }
    }
    e.marks.ucavStrike = e.t;
    e.addLog(`UCAV strike ${e.where(p.target)}:${report || ' no visible effect.'}`, 'good');
  }
}

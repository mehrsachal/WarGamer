// Direct fire and close combat.

import { type Vec, add, dist } from '../core/geom';
import { WEAPONS, type WeaponKey } from '../core/units';
import { alive, type Engine } from './engine';
import type { SimUnit } from './types';

const SMALL_ARMS_OPEN: Partial<Record<WeaponKey, number>> = { RIFLE: 400, LMG: 500, RL: 300 };

export function causeOf(w: WeaponKey): string {
  if (w === 'RIFLE' || w === 'LMG' || w === 'EN_RIFLE' || w === 'EN_LMG') return 'Small arms';
  if (w === 'MG' || w === 'GLHMG' || w === 'EN_MMG' || w === 'EN_AGL') return 'MG / GLHMG / AGL';
  if (w === 'TK_GUN' || w === 'TK_MG') return 'Tk fire';
  return 'A tk / RR / RL';
}

function exposure(e: Engine, u: SimUnit): number {
  const cover = e.terrain.coverAt(u.pos);
  let f: number;
  if (u.state === 'MOVE' || u.state === 'WITHDRAW') f = 1;
  else if (u.breaching) f = 0.95;
  else if (u.state === 'ASSAULT') f = u.waitUntil && u.waitUntil > e.t ? 0.45 : 1.05;
  else if (u.state === 'HALT') f = 0.45;
  else f = Math.max(0.06, 0.4 - 0.32 * u.dug);
  return f * (1 - 0.5 * cover) * sizeFactor(u);
}

/** Small, dispersed teams present a smaller target than a company in the open. */
export function sizeFactor(u: SimUnit): number {
  return Math.min(1, Math.sqrt(Math.max(1, u.strength) / 30));
}

function visFactor(e: Engine, shooter: SimUnit): number {
  if (e.light === 'DAY') return Math.max(0.5, e.vis);
  if (e.light === 'TWILIGHT') return 0.7;
  // night: NVDs, fixed lines, illumination
  return shooter.nvd ? 0.55 : 0.3;
}

function firerFactor(u: SimUnit): number {
  const frac = u.strength / Math.max(1, u.start);
  let f = Math.pow(Math.max(0, frac), 0.6) * (1 - 0.7 * u.supp);
  if (u.state === 'ASSAULT') f *= 0.55;
  else if (u.state === 'MOVE' || u.state === 'WITHDRAW') f *= 0.25;
  if (u.ammo < 0.25) f *= 0.5;
  if (u.ammo <= 0.02) f = 0;
  return f;
}

function rangeFactor(d: number, R: number): number {
  if (d > R) return 0;
  return d <= R * 0.5 ? 1.3 : 1.3 - 0.6 * ((d - R * 0.5) / (R * 0.5));
}

interface Cand {
  u: SimUnit;
  d: number;
  confirmed: boolean;
}

/** Targets a shooter may engage given its side's knowledge and line of sight. */
function candidates(e: Engine, s: SimUnit, maxR: number): Cand[] {
  const out: Cand[] = [];
  if (s.side === 'BLUE') {
    for (const r of e.red()) {
      const d = dist(s.pos, r.pos);
      if (d > maxR) continue;
      const c = e.contacts.get(r.id);
      // own troops always see an enemy who is on top of them
      const close = d < 120;
      if (!c && !close) continue;
      const conf = c ? c.conf : 0.6;
      if (conf < 0.25 && !close) continue;
      out.push({ u: r, d, confirmed: conf >= 0.5 || close });
    }
  } else {
    for (const b of e.blue()) {
      const d = dist(s.pos, b.pos);
      if (d > maxR) continue;
      const k = e.redIntel.get(b.id);
      const close = d < 150;
      const flash = b.sig > 0.4 && d < 1200;
      if (!k && !close && !flash) continue;
      if (k && k.conf < 0.25 && !close && !flash) continue;
      if (b.role === 'LP' && b.task === 'LP (by ni)') continue;
      out.push({ u: b, d, confirmed: true });
    }
  }
  return out;
}

/** BLUE fire discipline (ICIB Sec 76 para 11). */
function blueMayEngage(e: Engine, s: SimUnit, w: WeaponKey, c: Cand): boolean {
  const t = c.u;
  const night = e.isNight();
  // LPs and standing ptls fire only in self defence or on a spoiling task
  if (s.role === 'LP') return c.d < 100;
  if (s.role === 'SP_PTL') return (e.flags.spoilBy === s.id && (e.marks.spoilUntil ?? 0) >= e.t) || c.d < 150;
  if (night && !c.confirmed) return false;
  // probing patrols: frustrate with minimum fire
  if (t.role === 'RECCE') {
    const pol = e.flags.probePolicy as string | undefined;
    if (pol === 'IGNORE') return c.d < 100;
    if (pol === 'ALL_WPNS') return true;
    if (pol === 'DF_ON_PTL') return c.d < 150;
    return w === 'MG' || w === 'GLHMG' || c.d < 150;
  }
  if (e.fireControl === 'EARLY' || s.role === 'SCREEN') return true;
  const open = SMALL_ARMS_OPEN[w];
  if (open !== undefined && t.vehicles === 0) return c.d <= open || (w === 'RL' && t.vehicles > 0);
  // long-range wpns engage confirmed groups / vehicles
  return c.confirmed && (t.vehicles > 0 || t.strength >= 8);
}

export function resolveDirectFire(e: Engine): void {
  const pending = new Map<string, Map<string, number>>();
  const shooters = e.units.filter((u) => alive(u) && u.state !== 'OFFMAP' && u.ammo > 0.02);
  const diffRed = e.opts.difficulty === 'HARD' ? 1.15 : e.opts.difficulty === 'TRAINING' ? 0.8 : 1;
  for (const s of shooters) {
    if (s.waitUntil && s.waitUntil > e.t && s.state === 'MOVE') continue;
    const wkeys = (Object.keys(s.weapons) as WeaponKey[]).filter((w) => (s.weapons[w] ?? 0) > 0 && !WEAPONS[w].indirect);
    if (!wkeys.length) continue;
    const maxR = Math.max(...wkeys.map((w) => WEAPONS[w].range));
    const cands = candidates(e, s, maxR);
    if (!cands.length) continue;
    const ff = firerFactor(s);
    if (ff <= 0) continue;
    const vf = visFactor(e, s);
    const losCache = new Map<string, number>();
    const los = (t: SimUnit) => {
      let v = losCache.get(t.id);
      if (v === undefined) {
        v = e.terrain.los(s.pos, t.pos, e.terrain.eyeHeight(s.pos, s.vehicles > 0 ? 2.6 : 1.8), t.vehicles > 0 ? 2.3 : 1.2);
        losCache.set(t.id, v);
      }
      return v;
    };
    let fired = false;
    for (const w of wkeys) {
      const W = WEAPONS[w];
      const n = e.weaponCount(s, w);
      if (n <= 0) continue;
      let pool = cands.filter((c) => c.d <= W.range && c.d >= (W.minRange ?? 0));
      if (s.side === 'BLUE') pool = pool.filter((c) => blueMayEngage(e, s, w, c));
      if (!pool.length) continue;
      // anti-armour weapons go for vehicles first; others for the closest dismounted threat
      let target: Cand | undefined;
      if (W.at > 0) target = pool.filter((c) => c.u.vehicles > 0).sort((a, b) => a.d - b.d)[0];
      if (!target) {
        const dism = pool.filter((c) => c.u.vehicles === 0);
        const assaulting = dism.filter((c) => c.u.state === 'ASSAULT');
        target = (assaulting.length ? assaulting : dism).sort((a, b) => a.d - b.d)[0];
      }
      if (!target) continue;
      const l = los(target.u);
      if (l < 0.25) continue;
      const rf = rangeFactor(target.d, W.range);
      if (target.u.vehicles > 0 && W.at > 0) {
        const moving = target.u.state === 'MOVE' || target.u.state === 'ASSAULT';
        const pk = W.at * Math.min(n, 2) * rf * vf * ff * (moving ? 1 : 0.6) * l * (s.side === 'RED' ? diffRed : 1);
        if (e.rng.chance(Math.min(0.85, pk))) e.killTank(target.u, `${s.label} (${W.name})`);
        target.u.supp = Math.min(1, target.u.supp + 0.1);
      } else {
        let exp = exposure(e, target.u);
        if (w === 'TK_GUN' || w === 'RR106' || w === 'EN_RL') exp = Math.max(exp, 0.22); // bunker busting
        const cas = n * W.ap * rf * vf * ff * exp * l * (s.side === 'RED' ? diffRed : 1);
        const m = pending.get(target.u.id) ?? new Map<string, number>();
        m.set(causeOf(w), (m.get(causeOf(w)) ?? 0) + cas);
        pending.set(target.u.id, m);
        target.u.supp = Math.min(1, target.u.supp + Math.min(0.25, cas * 0.06 + n * 0.008));
      }
      s.sig = Math.max(s.sig, W.signature);
      s.ammo = Math.max(0, s.ammo - 0.0009 * Math.min(n, 10) * (w === 'LMG' || w === 'MG' || w === 'GLHMG' ? 1.6 : 1));
      fired = true;
      if (e.rng.chance(0.35)) {
        const kind = s.side === 'BLUE' ? 1 : 2;
        e.fireEvents.push({ from: s.pos, to: target.u.pos, kind });
        if (e.frameFire.length < 400) e.frameFire.push([Math.round(s.pos.x), Math.round(s.pos.y), Math.round(target.u.pos.x), Math.round(target.u.pos.y), kind]);
      }
    }
    if (fired) s.firedAt = e.t;
  }
  for (const [id, m] of pending) {
    const u = e.byId.get(id);
    if (!u) continue;
    for (const [cause, exp] of m) {
      const cas = e.rng.poisson(exp);
      if (cas > 0) e.inflict(u, cas, cause);
    }
  }
}

function elementPos(u: SimUnit, i: number): Vec {
  return add(u.pos, u.elements[i].off);
}

/** Close combat: RED assaults on BLUE localities, and BLUE counter-attacks. */
export function resolveCloseCombat(e: Engine): void {
  const diffRed = e.opts.difficulty === 'HARD' ? 1.15 : e.opts.difficulty === 'TRAINING' ? 0.8 : 1;
  // ---------------------------------------------------------------- RED assaults
  // group the assaulting sub-units by the locality they are closing with
  const groups = new Map<string, SimUnit[]>();
  for (const a of e.red()) {
    if (a.state !== 'ASSAULT' || !a.targetId || a.kind === 'ARMOUR') continue;
    if (a.waitUntil && a.waitUntil > e.t) continue;
    const d = e.byId.get(a.targetId);
    if (!d || !alive(d) || d.side !== 'BLUE') continue;
    if (dist(a.pos, d.pos) > 130 + d.radius * 0.6) continue;
    const g = groups.get(d.id) ?? [];
    g.push(a);
    groups.set(d.id, g);
  }
  for (const [did, atks] of groups) {
    const d = e.byId.get(did)!;
    const live = d.elements.map((el, i) => ({ el, i })).filter((x) => !x.el.lost);
    if (!live.length) continue;
    atks.sort((p, q) => q.strength - p.strength);
    const lead = atks[0];
    const engaged = live.sort((p, q) => dist(elementPos(d, p.i), lead.pos) - dist(elementPos(d, q.i), lead.pos))[0];
    const tanks = e.red().filter((t) => t.kind === 'ARMOUR' && dist(t.pos, lead.pos) < 500).reduce((m, t) => m + t.vehicles, 0);
    // frontage limits how many tps can close with one post at a time
    const mass = atks.reduce((m, a, i) => m + a.strength * (1 - 0.5 * a.supp) * (i === 0 ? 1 : 0.35), 0);
    const atk = mass * (1 + 0.12 * Math.min(tanks, 4)) * diffRed;
    const sup = d.elements.filter((x) => !x.lost && x !== engaged.el).reduce((m, x) => m + x.str, 0) * 0.35;
    const def = (engaged.el.str + sup) * (1 + 2.2 * d.dug) * (1 - 0.5 * d.supp) * (d.ammo < 0.2 ? 0.6 : 1);
    const ratio = atk / Math.max(1, def);
    const defCas = engaged.el.str * 0.045 * Math.max(0.2, Math.min(3, ratio));
    const atkCas = engaged.el.max * 0.11 * (1 + d.dug) * (1 - 0.5 * d.supp) / Math.pow(Math.max(0.5, Math.min(4, ratio)), 0.3);
    const dc = Math.min(engaged.el.str, e.rng.poisson(defCas));
    if (dc > 0) {
      engaged.el.str -= dc;
      d.strength -= dc;
      e.stats.blueCas += dc;
      e.causes.BLUE['Close combat'] = (e.causes.BLUE['Close combat'] ?? 0) + dc;
    }
    const ac = e.rng.poisson(atkCas);
    if (ac > 0) e.inflict(lead, ac, 'Close combat');
    for (const a of atks) a.supp = Math.min(1, a.supp + 0.05);
    d.supp = Math.min(1, d.supp + 0.08);
    // at most one post falls every few minutes: each is fought for
    const lastLoss = e.marks[`lastloss_${d.id}`] ?? -99;
    if (engaged.el.str <= engaged.el.max * 0.3 && e.t - lastLoss >= 4) {
      e.marks[`lastloss_${d.id}`] = e.t;
      d.strength -= engaged.el.str;
      e.stats.blueCas += engaged.el.str;
      e.causes.BLUE['Close combat'] = (e.causes.BLUE['Close combat'] ?? 0) + engaged.el.str;
      engaged.el.str = 0;
      engaged.el.lost = true;
      const nLost = d.elements.filter((x) => x.lost).length;
      e.marks[`lost_${d.id}_${nLost}`] = e.t;
      if (!e.marks.firstElementLost) e.marks.firstElementLost = e.t;
      e.flags.lastLostLocality = d.id;
      if (nLost >= d.elements.length) {
        d.state = 'CAPTURED';
        d.strength = 0;
        d.capturedAt = e.t;
        for (const a of atks) a.capturedAt = e.t;
        e.marks[`captured_${d.id}`] = e.t;
        e.addLog(`${d.label} ${e.where(d.pos)} has been overrun.`, 'crit');
      } else {
        const what = d.elements.length >= 3 && d.echelon === 'PL' ? (nLost === 1 ? '1 x LMG bkr / sec' : `${nLost} secs`) : `${nLost} x ${d.elements[0].name.split(' ')[0].toLowerCase()}`;
        e.addLog(`${d.label} reports en has captured ${what} ${e.where(elementPos(d, engaged.i))} and is pressing on.`, 'crit');
        for (const a of atks) a.capturedAt = a.capturedAt ?? e.t;
      }
    }
  }

  // ---------------------------------------------------------------- BLUE counter-attacks
  for (const c of e.blue()) {
    if (!c.catk || c.state !== 'ASSAULT' || !c.targetId) continue;
    if (c.waitUntil && c.waitUntil > e.t) continue;
    const r = e.byId.get(c.targetId);
    if (!r || !alive(r) || r.state === 'WITHDRAW') {
      finishCatk(e, c, true);
      continue;
    }
    if (dist(c.pos, r.pos) > 140) {
      // keep closing on the moving target
      if (c.pathIdx >= c.path.length) {
        c.path = [r.pos];
        c.pathIdx = 0;
      }
      continue;
    }
    const since = e.t - (r.capturedAt ?? e.t);
    const speed = since <= 20 ? 1.6 : since <= 30 ? 1.35 : since <= 60 ? 1.0 : 0.7; // speed & violence (ICIB Sec 76 para 14)
    const blueP = c.strength * (1 - 0.5 * c.supp) * speed * (c.bonus ?? 1);
    const redP = r.strength * (1 + 2 * r.dug) * (1 - 0.5 * r.supp);
    const ratio = blueP / Math.max(1, redP);
    const rc = e.rng.poisson(r.strength * 0.07 * Math.max(0.2, Math.min(4, ratio)));
    const bc = e.rng.poisson(c.strength * 0.06 * (1 + r.dug) / Math.max(0.5, Math.min(4, ratio)));
    if (rc > 0) e.inflict(r, rc, 'C attk');
    if (bc > 0) e.inflict(c, bc, 'C attk');
    if (r.strength / Math.max(1, r.start) < 0.3 || (ratio > 2.2 && e.rng.chance(0.3))) {
      r.state = 'WITHDRAW';
      r.path = e.terrain.findPath(r.pos, e.redPlan.fup, 'FOOT', { preferCover: 0.8 });
      r.pathIdx = 0;
      r.task = 'Ejected by C attk';
      finishCatk(e, c, true);
    } else if (c.strength / Math.max(1, c.start) < 0.45 || (ratio < 0.5 && e.rng.chance(0.25))) {
      finishCatk(e, c, false);
    }
  }
}

function finishCatk(e: Engine, c: SimUnit, success: boolean): void {
  c.catk = false;
  c.state = 'POSN';
  c.path = [];
  c.dug = 0.25;
  const lostId = c.restoreId;
  const loc = lostId ? e.byId.get(lostId) : undefined;
  if (success) {
    e.marks.catkSuccess = e.t;
    if (loc) {
      // re-occupy the lost posts with the C attk force
      const lostEls = loc.elements.filter((x) => x.lost);
      const give = Math.min(c.strength * 0.6, lostEls.reduce((m, x) => m + x.max, 0));
      for (const el of lostEls) {
        el.lost = false;
        el.str = give / Math.max(1, lostEls.length);
      }
      if (loc.state === 'CAPTURED') {
        loc.state = 'POSN';
        loc.capturedAt = undefined;
      }
      loc.strength += give;
      loc.start = Math.max(loc.start, loc.strength);
      c.strength -= give;
      c.pos = add(loc.pos, { x: 40, y: -60 });
    }
    e.addLog(`C attk by ${c.label} successful — ${loc ? `${loc.label} posn restored` : 'en ejected'}.`, 'good');
  } else {
    e.marks.catkFailed = e.t;
    e.addLog(`C attk by ${c.label} has failed; ${c.label} going firm ${e.where(c.pos)}.`, 'crit');
  }
}

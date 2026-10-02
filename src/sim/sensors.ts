// Detection and the two pictures of the battle (fog of war).
// BLUE knows RED only through `contacts`; RED knows BLUE through `redIntel`.

import { dist } from '../core/geom';
import { alive, type Engine } from './engine';
import type { Contact, SimUnit } from './types';

function roleFactor(u: SimUnit): number {
  switch (u.role) {
    case 'OBS':
    case 'OP':
    case 'CP':
      return 1.25;
    case 'SP_PTL':
    case 'LP':
    case 'SCREEN':
    case 'RECCE':
      return 1.1;
    case 'FDL':
    case 'BOF':
      return 0.9;
    case 'TANKS':
      return 0.75;
    default:
      return 0.6;
  }
}

function lightFactor(e: Engine, o: SimUnit): number {
  if (e.light === 'DAY') return e.vis;
  if (e.light === 'TWILIGHT') return Math.max(e.vis, o.nvd ? 0.55 : 0.4);
  return o.nvd ? Math.max(e.vis, 0.42 * e.s.weather.vis) : e.vis;
}

/** How conspicuous `u` is (multiplier on the observer's range). */
function signature(u: SimUnit, e: Engine): number {
  const moving = u.state === 'MOVE' || u.state === 'ASSAULT' || u.state === 'WITHDRAW';
  const conceal = e.terrain.concealAt(u.pos);
  let s: number;
  if (u.vehicles > 0) s = moving ? 1.5 : 0.75;
  else if (moving) s = 0.85;
  else s = 0.55 * (1 - 0.55 * u.dug);
  s *= 1 - 0.5 * conceal;
  const fire = u.sig * (e.isNight() ? 1.8 : 1.1);
  s += fire;
  const size = Math.max(0.55, Math.pow(Math.max(1, u.strength) / 30, 0.22));
  return s * size;
}

function detectP(e: Engine, o: SimUnit, u: SimUnit): number {
  const d = dist(o.pos, u.pos);
  const range = o.obsRange * roleFactor(o) * lightFactor(e, o);
  const eff = range * signature(u, e);
  if (d > eff) {
    // listening posts / standing ptls hear tracked vehicles at night
    if (e.isNight() && (o.role === 'LP' || o.role === 'SP_PTL' || o.role === 'SCREEN') && u.vehicles > 0 && (u.state === 'MOVE' || u.state === 'ASSAULT') && d < 1600) return 0.12;
    if (e.isNight() && (o.role === 'LP' || o.role === 'SP_PTL') && u.strength > 40 && (u.state === 'MOVE' || u.state === 'ASSAULT') && d < 450) return 0.1;
    return 0;
  }
  const eye = e.terrain.eyeHeight(o.pos, o.vehicles > 0 ? 2.8 : 2);
  const los = e.terrain.los(o.pos, u.pos, eye, u.vehicles > 0 ? 2.4 : 1.6);
  if (los < 0.15) return 0;
  return Math.min(0.95, 0.06 + 0.42 * los * Math.sqrt(1 - d / eff));
}

export function identify(u: SimUnit): Contact['ident'] {
  if (u.kind === 'ARMOUR') return 'ARMOUR';
  if (u.role === 'RECCE') return 'RECCE';
  if (u.kind === 'MG' || u.role === 'BOF') return 'SUPPORT';
  return 'INF';
}

export function sizeOf(u: SimUnit): Contact['size'] {
  if (u.vehicles > 0) return u.vehicles >= 8 ? 'COY' : 'PL';
  const s = u.strength;
  return s >= 300 ? 'BN' : s >= 70 ? 'COY' : s >= 20 ? 'PL' : s >= 6 ? 'SEC' : 'TEAM';
}

export function reportContact(e: Engine, u: SimUnit, by: SimUnit | string, quality: number, d: number): void {
  const byLabel = typeof by === 'string' ? by : by.label;
  const night = e.isNight();
  const errSd = typeof by === 'string' ? 25 : d * (night ? 0.05 : 0.025) + 10;
  const prev = e.contacts.get(u.id);
  const pos = { x: u.pos.x + e.rng.normal(0, errSd), y: u.pos.y + e.rng.normal(0, errSd) };
  const identOk = quality > 0.55 || d < 900 || u.vehicles > 0;
  const c: Contact = prev ?? {
    id: `c_${u.id}`,
    unitId: u.id,
    pos,
    lastSeen: e.t,
    firstSeen: e.t,
    conf: 0,
    ident: 'UNKNOWN',
    size: 'UNKNOWN',
    by: byLabel,
    moving: false,
    vehicles: 0,
  };
  c.pos = pos;
  c.lastSeen = e.t;
  c.conf = Math.min(1, c.conf + 0.3 + quality * 0.3);
  c.by = byLabel;
  c.moving = u.state === 'MOVE' || u.state === 'ASSAULT' || u.state === 'WITHDRAW';
  if (identOk) {
    c.ident = identify(u);
    c.size = sizeOf(u);
    c.vehicles = u.vehicles;
  }
  if (!prev) {
    e.contacts.set(u.id, c);
    const what = c.ident === 'ARMOUR' ? `${u.vehicles} x en tks` : c.ident === 'UNKNOWN' ? 'en mov' : `en ${c.ident === 'RECCE' ? 'recce ptl' : c.size === 'UNKNOWN' ? 'tps' : `${c.size.toLowerCase()} size tps`}`;
    e.addLog(`${byLabel} reports ${what} ${e.where(u.pos)}.`, c.ident === 'ARMOUR' || c.size === 'COY' || c.size === 'BN' ? 'warn' : 'info');
  } else if (prev.ident === 'UNKNOWN' && c.ident !== 'UNKNOWN') {
    e.addLog(`${byLabel} cfms ${c.ident === 'ARMOUR' ? `${u.vehicles} x tks` : `${c.size.toLowerCase()} size inf`} ${e.where(u.pos)}.`, c.ident === 'ARMOUR' ? 'warn' : 'info');
  }
}

export function runSensors(e: Engine): void {
  const blue = e.blue();
  const red = e.red();
  const fog = e.opts.fog;

  // ---------------------------------------------------------------- BLUE picture of RED
  if (fog === 'OFF') {
    for (const r of red) reportContact(e, r, 'Int', 1, 0);
  } else {
    for (const r of red) {
      let best = 0;
      let bestObs: SimUnit | null = null;
      for (const b of blue) {
        if (b.state === 'MOVE' && b.role !== 'SCREEN') continue;
        const p = detectP(e, b, r);
        if (p > best) {
          best = p;
          bestObs = b;
        }
      }
      if (bestObs && e.rng.chance(best)) reportContact(e, r, bestObs, roleFactor(bestObs) > 1 ? 0.8 : 0.4, dist(bestObs.pos, r.pos));
    }
  }
  for (const [id, c] of e.contacts) {
    const u = e.byId.get(id);
    if (!u || !alive(u)) {
      if (e.t - c.lastSeen > 3) e.contacts.delete(id);
      continue;
    }
    const age = e.t - c.lastSeen;
    if (age > 4) c.conf = Math.max(0, c.conf - 0.012);
    if (c.conf <= 0.02 && age > 90) e.contacts.delete(id);
  }

  // ---------------------------------------------------------------- RED picture of BLUE
  const probeIgnored = e.flags.probePolicy === 'IGNORE';
  for (const b of blue) {
    if (b.role === 'LP' && b.task === 'LP (by ni)') continue;
    let best = 0;
    for (const r of red) {
      let p = detectP(e, r, b);
      if (r.role === 'RECCE' && probeIgnored) p *= 1.5;
      if (p > best) best = p;
    }
    // positions that fire are pin-pointed by the en BOF / OPs
    if (b.sig > 0.5) best = Math.max(best, 0.25 * b.sig);
    if (best > 0 && e.rng.chance(best)) {
      const prev = e.redIntel.get(b.id);
      const err = 40 + (e.isNight() ? 40 : 0);
      e.redIntel.set(b.id, {
        pos: { x: b.pos.x + e.rng.normal(0, err), y: b.pos.y + e.rng.normal(0, err) },
        conf: Math.min(1, (prev?.conf ?? 0) + 0.25),
        lastSeen: e.t,
      });
    }
  }
  for (const [id, v] of e.redIntel) {
    const u = e.byId.get(id);
    if (!u || !alive(u)) {
      e.redIntel.delete(id);
      continue;
    }
    // a unit that has moved away is no longer where RED thinks it is
    if (dist(u.pos, v.pos) > 300) v.conf = Math.max(0, v.conf - 0.05);
    if (e.t - v.lastSeen > 45) v.conf = Math.max(0.35 * Math.min(1, v.conf * 2), v.conf - 0.0015);
  }
}

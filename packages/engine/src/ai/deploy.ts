// AI-02 deployment: garrison each objective in proportion to its value, site support weapons for fields of
// fire over the approaches (preferring reverse slopes: short-range fields of fire while hidden from long
// range), keep mortars and HQ back in cover. Produces Deploy commands.
import type { Command } from '../events';
import { type Hex, hexDistance, hexKey, hexRange } from '../hex';
import { lineOfSight } from '../los';
import type { SideView, UnitView } from '../view';
import { type AiKnowledge, distToSet, own, tie } from './perception';

interface Site {
  h: Hex;
  key: string;
  cover: number;
  conceal: number;
  dEnemy: number;
  /** Visible hexes in front within 5 / 12 / 20 hexes (sampled). */
  fofShort: number;
  fofLong: number;
  fofAT: number;
  /** Share of far approach samples that can see this hex (0 = hidden from long range). */
  exposure: number;
  nearObj: { id: string; d: number; value: number }[];
}

const EYE = { observerHeight_m: 1.6, targetHeight_m: 1.0 };

function analyseSites(k: AiKnowledge): Site[] {
  const zone = k.ownZone.filter((h) => k.map.has(h));
  const enemyZone = k.enemyZone;
  const dEnemyCache = new Map<string, number>();
  const dEnemy = (h: Hex) => {
    const key = hexKey(h);
    let d = dEnemyCache.get(key);
    if (d === undefined) {
      d = distToSet(h, enemyZone);
      dEnemyCache.set(key, d);
    }
    return d;
  };
  const objs = k.objectives;
  const sites: Site[] = [];
  for (const h of zone) {
    const nearObj = objs.map((o) => ({ id: o.id, d: hexDistance(h, o.hex), value: o.value })).filter((x) => x.d <= 9);
    if (!nearObj.length) continue;
    const cell = k.map.cell(h);
    const de = dEnemy(h);
    let fofShort = 0;
    let fofLong = 0;
    let fofAT = 0;
    let seen = 0;
    let samples = 0;
    for (const f of hexRange(h, 20)) {
      if (!k.map.has(f)) continue;
      const d = hexDistance(h, f);
      if (d === 0) continue;
      const front = dEnemy(f) < de - 1;
      if (!front) continue;
      const sampled = d <= 5 || (f.q + f.r) % 2 === 0;
      if (!sampled) continue;
      const clear = lineOfSight(k.map, h, f, EYE).clear;
      if (clear) {
        if (d <= 5) fofShort++;
        if (d <= 12) fofLong++;
        const fc = k.map.cell(f);
        if (fc.terrain.moveCost.tracked !== null) fofAT++;
      }
      if (d >= 8 && (f.q + 2 * f.r) % 3 === 0) {
        samples++;
        if (clear) seen++;
      }
    }
    sites.push({ h, key: hexKey(h), cover: cell.terrain.cover, conceal: cell.terrain.concealment, dEnemy: de, fofShort, fofLong, fofAT, exposure: samples ? seen / samples : 0, nearObj });
  }
  return sites;
}

type Role = 'garrison' | 'support' | 'at' | 'mortar' | 'hq' | 'vehicle' | 'air';

function roleOf(k: AiKnowledge, u: UnitView): Role {
  const t = k.data.unitType(u.typeId);
  if (t.isAir) return 'air';
  if (t.category === 'mortar') return 'mortar';
  if (t.category === 'hq') return 'hq';
  if (t.category === 'vehicle') return 'vehicle';
  if (t.weapons.some((w) => k.data.weapon(w).lethality.hard >= 0.5 && k.data.weapon(w).maxRange >= 7)) return 'at';
  if (t.category === 'support') return 'support';
  return 'garrison';
}

/** Deployment orders for every own unit that has no position yet (or all units when `all`). */
export function planDeployment(k: AiKnowledge, v: SideView, opts: { all?: boolean } = {}): Command[] {
  const sites = analyseSites(k);
  const maxF = (f: (s: Site) => number) => Math.max(1, ...sites.map(f));
  const mShort = maxF((s) => s.fofShort);
  const mLong = maxF((s) => s.fofLong);
  const mAT = maxF((s) => s.fofAT);
  const units = own(v).filter((u) => !u.carriedBy && (opts.all || !u.hex));
  const placed = own(v).filter((u) => u.hex && !units.includes(u)).map((u) => ({ hex: u.hex!, air: k.data.unitType(u.typeId).isAir }));
  const count = new Map<string, number>();
  for (const p of placed) if (!p.air) count.set(hexKey(p.hex), (count.get(hexKey(p.hex)) ?? 0) + 1);
  const totalValue = k.objectives.reduce((m, o) => m + o.value, 0) || 1;
  const garrisons = units.filter((u) => roleOf(k, u) === 'garrison');
  // quota of garrison units per objective, by value, at least one each
  const quota = new Map<string, number>();
  const objs = [...k.objectives].sort((a, b) => b.value - a.value);
  for (const o of objs) quota.set(o.id, Math.max(1, Math.round((garrisons.length * o.value) / totalValue)));
  const assigned = new Map<string, number>();
  const order: Role[] = ['garrison', 'at', 'support', 'vehicle', 'hq', 'mortar', 'air'];
  const ordered = [...units].sort((a, b) => order.indexOf(roleOf(k, a)) - order.indexOf(roleOf(k, b)) || k.data.unitType(b.typeId).value - k.data.unitType(a.typeId).value);
  const cmds: Command[] = [];
  const chosen: Hex[] = placed.filter((p) => !p.air).map((p) => p.hex);
  const maxStack = k.data.rules.stacking.maxUnitsPerHex;
  for (const u of ordered) {
    const t = k.data.unitType(u.typeId);
    const role = roleOf(k, u);
    // which objective this garrison unit is for
    let target: string | undefined;
    if (role === 'garrison') {
      target = objs.find((o) => (assigned.get(o.id) ?? 0) < (quota.get(o.id) ?? 0))?.id ?? objs[0]?.id;
      if (target) assigned.set(target, (assigned.get(target) ?? 0) + 1);
    }
    let best: { s: Site; score: number } | undefined;
    for (const s of sites) {
      if (!t.isAir && t.mobilityClass !== 'air' && k.map.cell(s.h).terrain.moveCost[t.mobilityClass] === null) continue;
      const n = count.get(s.key) ?? 0;
      const onObjective = k.objectives.some((o) => o.hex.q === s.h.q && o.hex.r === s.h.r);
      if (!t.isAir && n >= (onObjective ? maxStack : 1)) continue;
      const crowd = chosen.filter((c) => hexDistance(c, s.h) <= 1).length;
      const coverScore = 1 - s.cover;
      const reverse = (1 - s.exposure) * Math.min(1, s.fofShort / Math.max(4, mShort * 0.5));
      let score = 0;
      switch (role) {
        case 'garrison': {
          const o = s.nearObj.find((x) => x.id === target);
          if (!o) continue;
          const onIt = o.d === 0 && n < 2 ? 3.5 : 0;
          score = onIt + 2.2 * (1 - o.d / 4) + 1.4 * (s.fofShort / mShort) + 1.2 * coverScore + 0.8 * s.conceal + 1.2 * reverse - 0.5 * s.exposure;
          if (o.d > 4) score -= 3;
          break;
        }
        case 'support': {
          const near = Math.min(...s.nearObj.map((x) => x.d));
          score = 2.4 * (s.fofLong / mLong) + 0.8 * coverScore + 0.6 * s.conceal + 0.8 * reverse - 0.15 * near;
          break;
        }
        case 'at':
          score = 3 * (s.fofAT / mAT) + 0.8 * coverScore + 0.8 * s.conceal - 0.1 * Math.min(...s.nearObj.map((x) => x.d));
          break;
        case 'vehicle':
          score = 2 * (s.fofLong / mLong) + 1.5 * (1 - s.exposure) + 0.6 * s.conceal - 0.2 * Math.min(...s.nearObj.map((x) => x.d));
          break;
        case 'hq':
        case 'mortar':
          score = 0.12 * s.dEnemy + 2 * (1 - s.exposure) + 1 * coverScore + 0.8 * s.conceal - 0.1 * Math.min(...s.nearObj.map((x) => x.d));
          break;
        case 'air':
          score = -s.dEnemy * 0.1 + (s.fofLong / mLong);
          break;
      }
      score -= 0.9 * crowd;
      score += tie(u.id, s.key);
      if (!best || score > best.score) best = { s, score };
    }
    if (!best) continue;
    cmds.push({ type: 'Deploy', unitId: u.id, hex: { ...best.s.h } });
    if (!t.isAir) {
      count.set(best.s.key, (count.get(best.s.key) ?? 0) + 1);
      chosen.push(best.s.h);
    }
  }
  return cmds;
}

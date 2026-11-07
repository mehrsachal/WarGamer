// AI-02 — defensive behaviour for one action at a time. Priorities each turn:
//   1. mortars on observed enemy (never on or next to own troops)
//   2. off-map artillery on high-value or close targets
//   3. direct fire — best expected value, with fire discipline (hold fire at poor odds and long range so
//      concealed positions are not given away)
//   4. reinforce threatened objectives / move back onto lost ones
//   5. UAV forward to observe the approaches
//   6. pull exposed, suppressed units back into cover
// Units that are well sited simply hold (static: concealed, no moved penalty).
import { directFireCheck, indirectFireCheck, indirectHit } from '../combat';
import type { Command } from '../events';
import { type Hex, hexDistance, hexEquals, hexKey, hexNeighbors } from '../hex';
import { reachable } from '../move';
import type { SideView, UnitView } from '../view';
import { type AiKnowledge, distToSet, enemies, knownEnemyHexes, occupancy, ownOnMap, tie, unitValue, viewSeesHex } from './perception';

export interface AiTuning {
  /** Minimum hit chance worth revealing a concealed position for, beyond close range. */
  minOdds: number;
  /** Hexes inside which the AI always opens fire. */
  closeRange: number;
  /** Expected-value threshold for mortar / artillery missions. */
  mortarEV: number;
  artilleryEV: number;
  /** How much threat (enemy value near an objective) relative to the garrison triggers reinforcement. */
  reinforceRatio: number;
}

export const DEFAULT_TUNING: AiTuning = { minOdds: 0.16, closeRange: 4, mortarEV: 0.45, artilleryEV: 1.6, reinforceRatio: 0.7 };

type Tried = Set<string>;

function enemiesAt(v: SideView, h: Hex): UnitView[] {
  return enemies(v).filter((e) => hexEquals(e.hex!, h));
}

function friendlyNear(v: SideView, h: Hex, radius: number): boolean {
  return ownOnMap(v).some((u) => hexDistance(u.hex!, h) <= radius);
}

/** 1 — organic mortars. */
function mortarFire(k: AiKnowledge, v: SideView, tried: Tried): Command | null {
  let best: { cmd: Command; ev: number } | undefined;
  const targets = new Map<string, Hex>();
  for (const e of enemies(v)) targets.set(hexKey(e.hex!), e.hex!);
  for (const u of ownOnMap(v)) {
    const t = k.data.unitType(u.typeId);
    for (const wid of t.weapons) {
      const w = k.data.weapon(wid);
      if (!w.indirect || tried.has(`fire:${u.id}`)) continue;
      for (const h of targets.values()) {
        if (!indirectFireCheck(k.ctx, u, wid, h).ok) continue;
        if (friendlyNear(v, h, w.areaEffect.adjacent > 0 ? 1 : 0)) continue;
        if (!viewSeesHex(k, v, h)) continue;
        let ev = 0;
        for (const e of enemiesAt(v, h)) ev += indirectHit(k.ctx, w, hexDistance(u.hex!, h), e, true, false).p * unitValue(k, e);
        if (w.areaEffect.adjacent > 0) for (const n of hexNeighbors(h)) for (const e of enemiesAt(v, n)) ev += indirectHit(k.ctx, w, hexDistance(u.hex!, h), e, true, true).p * unitValue(k, e);
        ev += tie(u.id, hexKey(h));
        if (ev >= k.data.rules.hit.min && (!best || ev > best.ev)) best = { cmd: { type: 'IndirectFire', unitId: u.id, weaponId: wid, hex: { ...h } }, ev };
      }
    }
  }
  return best && best.ev >= DEFAULT_TUNING.mortarEV ? best.cmd : null;
}

/** 2 — off-map artillery. */
function artillery(k: AiKnowledge, v: SideView, tried: Tried, tune: AiTuning): Command | null {
  const ready = v.fireSupport.filter((f) => f.available && !tried.has(`arty:${f.id}`));
  if (!ready.length) return null;
  let best: { cmd: Command; ev: number } | undefined;
  for (const f of ready) {
    const w = k.data.weapon(f.weaponId);
    const seen = new Set<string>();
    for (const e of enemies(v)) {
      const h = e.hex!;
      if (seen.has(hexKey(h))) continue;
      seen.add(hexKey(h));
      if (friendlyNear(v, h, w.areaEffect.adjacent > 0 ? 1 : 0)) continue;
      if (!viewSeesHex(k, v, h)) continue;
      let ev = 0;
      for (const x of enemiesAt(v, h)) ev += indirectHit(k.ctx, w, null, x, true, false).p * unitValue(k, x);
      for (const n of hexNeighbors(h)) for (const x of enemiesAt(v, n)) ev += indirectHit(k.ctx, w, null, x, true, true).p * unitValue(k, x);
      // a delayed mission is worth less against moving targets
      if (f.delay > 0) ev *= 0.6;
      const nearObjective = k.objectives.some((o) => hexDistance(o.hex, h) <= 5);
      if (nearObjective) ev *= 1.4;
      if (!best || ev > best.ev) best = { cmd: { type: 'CallFire', assetId: f.id, hex: { ...h } }, ev };
    }
  }
  return best && best.ev >= tune.artilleryEV ? best.cmd : null;
}

/** 3 — direct fire. */
function directFire(k: AiKnowledge, v: SideView, tried: Tried, tune: AiTuning): Command | null {
  let best: { cmd: Command; ev: number } | undefined;
  const foes = enemies(v);
  if (!foes.length) return null;
  for (const u of ownOnMap(v)) {
    if (tried.has(`fire:${u.id}`)) continue;
    const t = k.data.unitType(u.typeId);
    const cell = k.map.cell(u.hex!);
    const concealed = cell.terrain.concealment >= 0.5 && !u.fired;
    for (const wid of t.weapons) {
      const w = k.data.weapon(wid);
      if (w.indirect) continue;
      for (const e of foes) {
        const c = directFireCheck(k.ctx, u, wid, e, true);
        if (!c.ok) continue;
        const et = k.data.unitType(e.typeId);
        const close = c.distance <= tune.closeRange;
        const nearObj = k.objectives.some((o) => hexDistance(o.hex, e.hex!) <= 3);
        if (!close && !nearObj && c.p < tune.minOdds && concealed) continue;
        if (et.targetClass === 'soft' && w.lethality.hard >= 0.5 && w.ammo !== 'unlimited' && c.p < 0.3) continue; // keep AT rounds for armour
        const lethal = w.lethality[et.targetClass];
        let ev = c.p * et.value * (0.5 + lethal) * (e.status === 'S' ? 0.7 : 1);
        if (nearObj) ev *= 1.3;
        ev += tie(u.id, e.id, wid);
        if (!best || ev > best.ev) best = { cmd: { type: 'Fire', unitId: u.id, weaponId: wid, targetId: e.id }, ev };
      }
    }
  }
  return best ? best.cmd : null;
}

function threatTo(k: AiKnowledge, v: SideView, o: Hex): number {
  let threat = 0;
  for (const e of enemies(v)) if (hexDistance(e.hex!, o) <= 5) threat += unitValue(k, e);
  for (const g of v.ghosts) if (g.turn >= v.turn - 1 && hexDistance(g.hex, o) <= 5) threat += k.data.unitType(g.typeId).value * 0.5;
  return threat;
}

function garrisonValue(k: AiKnowledge, v: SideView, o: Hex): number {
  return ownOnMap(v)
    .filter((u) => hexDistance(u.hex!, o) <= 1 && k.data.unitType(u.typeId).holdsGround)
    .reduce((m, u) => m + unitValue(k, u), 0);
}

/** Is this unit holding an objective that is itself under threat? */
function isGarrison(k: AiKnowledge, v: SideView, u: UnitView): boolean {
  return k.objectives.some((o) => hexDistance(o.hex, u.hex!) <= 1 && (v.objectives.find((x) => x.id === o.id)?.owner === k.side || threatTo(k, v, o.hex) > 0));
}

/** Exposure of a hex to known enemies (how many could see and engage it). */
function exposure(k: AiKnowledge, v: SideView, h: Hex): number {
  let n = 0;
  for (const e of enemies(v)) {
    const d = hexDistance(e.hex!, h);
    if (d <= 8) n += 1 / (1 + d / 4);
  }
  return n * k.map.cell(h).terrain.cover;
}

/** 4 — reinforce threatened objectives and move back onto lost ones. */
function reinforce(k: AiKnowledge, v: SideView, tried: Tried, tune: AiTuning): Command | null {
  const blocked = knownEnemyHexes(k, v);
  const occ = occupancy(k, v);
  const needs = k.objectives
    .map((o) => {
      const owner = v.objectives.find((x) => x.id === o.id)?.owner ?? null;
      const threat = threatTo(k, v, o.hex);
      const garrison = garrisonValue(k, v, o.hex);
      const lost = owner !== k.side;
      const need = (lost ? 2 + threat : threat - garrison * tune.reinforceRatio) * (0.5 + o.value / 5);
      return { o, need, lost };
    })
    .filter((x) => x.need > 0)
    .sort((a, b) => b.need - a.need);
  for (const { o, lost } of needs) {
    const candidates = ownOnMap(v)
      .filter((u) => {
        const t = k.data.unitType(u.typeId);
        if (t.isAir || !t.holdsGround || t.category === 'mortar' || t.category === 'hq') return false;
        if (tried.has(`move:${u.id}`) || u.posture === 'dashed') return false;
        if (hexDistance(u.hex!, o.hex) <= 1) return false;
        if (isGarrison(k, v, u) && !lost) return false;
        return hexDistance(u.hex!, o.hex) <= 12;
      })
      .sort((a, b) => hexDistance(a.hex!, o.hex) - hexDistance(b.hex!, o.hex) || a.id.localeCompare(b.id));
    for (const u of candidates) {
      const reach = reachable(k.ctx, u, { blocked, occupancy: occ });
      let best: { h: Hex; score: number } | undefined;
      for (const n of reach.values()) {
        if (!n.canStop || hexEquals(n.hex, u.hex!)) continue;
        const d = hexDistance(n.hex, o.hex);
        const cover = k.map.cell(n.hex).terrain.cover;
        const score = -d * 1.2 - exposure(k, v, n.hex) * 0.8 - cover * 0.8 - (n.band === 'dash' ? 0.6 : 0) + tie(u.id, hexKey(n.hex));
        if (!best || score > best.score) best = { h: n.hex, score };
      }
      if (best && hexDistance(best.h, o.hex) < hexDistance(u.hex!, o.hex)) return { type: 'MoveUnit', unitId: u.id, to: { ...best.h } };
      tried.add(`move:${u.id}`);
    }
  }
  return null;
}

/** 5 — UAV forward to watch the approaches, staying out of small-arms reach of known enemies. */
function uav(k: AiKnowledge, v: SideView, tried: Tried): Command | null {
  for (const u of ownOnMap(v)) {
    const t = k.data.unitType(u.typeId);
    if (!t.isAir || tried.has(`move:${u.id}`) || u.mpSpent > 0) continue;
    const foes = enemies(v);
    const focus = foes.length ? foes : v.ghosts.map((g) => ({ hex: g.hex }));
    const goal: Hex = focus.length ? focus[0].hex! : k.enemyZone[Math.floor(k.enemyZone.length / 2)];
    const reach = reachable(k.ctx, u);
    let best: { h: Hex; score: number } | undefined;
    for (const n of reach.values()) {
      const d = hexDistance(n.hex, goal);
      const danger = foes.filter((e) => hexDistance(e.hex!, n.hex) <= 3).length;
      const score = -Math.abs(d - 6) - danger * 3 + tie(u.id, hexKey(n.hex));
      if (!best || score > best.score) best = { h: n.hex, score };
    }
    tried.add(`move:${u.id}`);
    if (best && !hexEquals(best.h, u.hex!)) return { type: 'MoveUnit', unitId: u.id, to: { ...best.h } };
  }
  return null;
}

/** 6 — exposed and suppressed units fall back into cover (never off an objective). */
function fallBack(k: AiKnowledge, v: SideView, tried: Tried): Command | null {
  const blocked = knownEnemyHexes(k, v);
  const occ = occupancy(k, v);
  for (const u of ownOnMap(v)) {
    const t = k.data.unitType(u.typeId);
    if (t.isAir || u.status !== 'S' || tried.has(`move:${u.id}`)) continue;
    if (k.objectives.some((o) => hexEquals(o.hex, u.hex!))) continue;
    const here = k.map.cell(u.hex!).terrain.cover;
    if (here < 0.9 || exposure(k, v, u.hex!) <= 0) continue;
    tried.add(`move:${u.id}`);
    const dEnemy = (h: Hex) => distToSet(h, enemies(v).map((e) => e.hex!));
    let best: { h: Hex; score: number } | undefined;
    for (const n of reachable(k.ctx, u, { blocked, occupancy: occ }).values()) {
      if (!n.canStop || n.band === 'dash') continue;
      const cover = k.map.cell(n.hex).terrain.cover;
      if (cover >= here) continue;
      const score = -cover * 3 + 0.2 * dEnemy(n.hex) - exposure(k, v, n.hex) + tie(u.id, hexKey(n.hex));
      if (!best || score > best.score) best = { h: n.hex, score };
    }
    if (best) return { type: 'MoveUnit', unitId: u.id, to: { ...best.h } };
  }
  return null;
}

/** The next defensive action, or null when the AI is done for this turn. */
export function nextDefenceCommand(k: AiKnowledge, v: SideView, tried: Tried, tune: AiTuning = DEFAULT_TUNING): Command | null {
  if (v.phase !== 'play' || v.activeSide !== k.side) return null;
  return mortarFire(k, v, tried) ?? artillery(k, v, tried, tune) ?? directFire(k, v, tried, tune) ?? reinforce(k, v, tried, tune) ?? uav(k, v, tried) ?? fallBack(k, v, tried);
}

/** Key used to stop the runner retrying an action that the rules refused. */
export function commandKey(c: Command): string {
  switch (c.type) {
    case 'Fire':
    case 'IndirectFire':
      return `fire:${c.unitId}`;
    case 'CallFire':
      return `arty:${c.assetId}`;
    case 'MoveUnit':
      return `move:${c.unitId}`;
    default:
      return c.type;
  }
}

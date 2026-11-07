// Scripted test players used to check the defensive AI (AI-02 / AI-04 acceptance): a passive player that only
// ends turns, and a "sound attack" player that does fire and manoeuvre with bounding overwatch, prep fires and
// dismounts short of the objective. This is a test harness, not the offensive AI (AI-03, Phase 3). It sees only
// its own SideView.
import { directFireCheck, indirectFireCheck, indirectHit } from '../combat';
import type { Side } from '../data/schema';
import type { Command, GameEvent } from '../events';
import type { Game } from '../game';
import { type Hex, hexDistance, hexEquals, hexKey } from '../hex';
import { reachable } from '../move';
import type { SideView, UnitView } from '../view';
import { type AiKnowledge, distToSet, enemies, knowledge, knownEnemyHexes, occupancy, ownOnMap, tie, unitValue, viewSeesHex } from './perception';

type Tried = Set<string>;

function objectiveOrder(k: AiKnowledge): { id: string; hex: Hex; value: number }[] {
  return [...k.objectives].sort((a, b) => distToSet(a.hex, k.ownZone) - distToSet(b.hex, k.ownZone));
}

/**
 * Objective each unit works towards: a fixing group (the three nearest manoeuvre units) takes the nearest
 * objective, the main effort goes for the most valuable one; in the last turns everybody goes for the most
 * valuable objective not yet held.
 */
function assignTargets(k: AiKnowledge, v: SideView): Map<string, Hex> {
  const order = objectiveOrder(k);
  const notHeld = order.filter((o) => v.objectives.find((x) => x.id === o.id)?.owner !== k.side);
  const out = new Map<string, Hex>();
  const main = [...(notHeld.length ? notHeld : order)].sort((a, b) => b.value - a.value)[0];
  const near = notHeld[0] ?? main;
  const units = ownOnMap(v).filter((u) => !k.data.unitType(u.typeId).isAir);
  if (v.turn >= v.turns - 3 || near.id === main.id) {
    for (const u of units) out.set(u.id, main.hex);
    return out;
  }
  const manoeuvre = units.filter((u) => k.data.unitType(u.typeId).category === 'infantry').sort((a, b) => hexDistance(a.hex!, near.hex) - hexDistance(b.hex!, near.hex) || a.id.localeCompare(b.id));
  const fixing = new Set(manoeuvre.slice(0, 3).map((u) => u.id));
  for (const u of units) out.set(u.id, fixing.has(u.id) ? near.hex : main.hex);
  return out;
}

function currentTarget(k: AiKnowledge, v: SideView): Hex {
  const order = objectiveOrder(k);
  const best = [...order].filter((o) => v.objectives.find((x) => x.id === o.id)?.owner !== k.side).sort((a, b) => b.value - a.value)[0];
  return (best ?? order[order.length - 1]).hex;
}

function exposureTo(k: AiKnowledge, v: SideView, h: Hex): number {
  let n = 0;
  for (const e of enemies(v)) {
    const d = hexDistance(e.hex!, h);
    if (d <= 10) n += 1 / (1 + d / 3);
  }
  return n;
}

function bestDirectFire(k: AiKnowledge, v: SideView, u: UnitView): Command | null {
  let best: { cmd: Command; ev: number } | undefined;
  const t = k.data.unitType(u.typeId);
  for (const wid of t.weapons) {
    const w = k.data.weapon(wid);
    if (w.indirect) continue;
    for (const e of enemies(v)) {
      const c = directFireCheck(k.ctx, u, wid, e, true);
      if (!c.ok) continue;
      const et = k.data.unitType(e.typeId);
      if (et.targetClass === 'soft' && w.ammo !== 'unlimited' && w.lethality.hard >= 0.5 && c.p < 0.25) continue;
      const ev = c.p * et.value * (0.5 + w.lethality[et.targetClass]) + tie(u.id, e.id, wid);
      if (!best || ev > best.ev) best = { cmd: { type: 'Fire', unitId: u.id, weaponId: wid, targetId: e.id }, ev };
    }
  }
  return best?.cmd ?? null;
}

function indirect(k: AiKnowledge, v: SideView, tried: Tried, target: Hex): Command | null {
  const foes = enemies(v);
  for (const f of v.fireSupport) {
    if (!f.available || tried.has(`arty:${f.id}`)) continue;
    const w = k.data.weapon(f.weaponId);
    let best: { h: Hex; ev: number } | undefined;
    for (const e of foes) {
      if (ownOnMap(v).some((u) => hexDistance(u.hex!, e.hex!) <= 1)) continue;
      if (!viewSeesHex(k, v, e.hex!)) continue;
      let ev = 0;
      for (const x of foes) {
        const d = hexDistance(x.hex!, e.hex!);
        if (d <= 1) ev += indirectHit(k.ctx, w, null, x, true, d === 1).p * unitValue(k, x);
      }
      const nearMain = hexDistance(e.hex!, target) <= 3;
      // guns are kept for the main objective (or armour anywhere)
      if (!nearMain && !foes.some((x) => hexEquals(x.hex!, e.hex!) && k.data.unitType(x.typeId).targetClass === 'hard')) continue;
      ev *= nearMain ? 2 : 1;
      if (!best || ev > best.ev) best = { h: e.hex!, ev };
    }
    if (best && best.ev > 0.6) return { type: 'CallFire', assetId: f.id, hex: { ...best.h } };
  }
  for (const u of ownOnMap(v)) {
    if (tried.has(`fire:${u.id}`)) continue;
    const t = k.data.unitType(u.typeId);
    for (const wid of t.weapons) {
      const w = k.data.weapon(wid);
      if (!w.indirect) continue;
      let best: { h: Hex; ev: number } | undefined;
      for (const e of foes) {
        if (!indirectFireCheck(k.ctx, u, wid, e.hex!).ok) continue;
        if (ownOnMap(v).some((o) => hexDistance(o.hex!, e.hex!) <= (w.areaEffect.adjacent > 0 ? 1 : 0))) continue;
        if (!viewSeesHex(k, v, e.hex!)) continue;
        const ev = foes.filter((x) => hexEquals(x.hex!, e.hex!)).reduce((m, x) => m + indirectHit(k.ctx, w, hexDistance(u.hex!, e.hex!), x, true, false).p * unitValue(k, x), 0) * (hexDistance(e.hex!, target) <= 3 ? 2 : 1);
        if (!best || ev > best.ev) best = { h: e.hex!, ev };
      }
      if (best && best.ev > 0.3) return { type: 'IndirectFire', unitId: u.id, weaponId: wid, hex: { ...best.h } };
    }
  }
  return null;
}

/** One advance move toward `target`, preferring cover and avoiding known enemy fields of fire. */
function advance(k: AiKnowledge, v: SideView, u: UnitView, target: Hex, opts: { stopShort: number; allowDash: boolean }): Command | null {
  const reach = reachable(k.ctx, u, { blocked: knownEnemyHexes(k, v), occupancy: occupancy(k, v) });
  const here = hexDistance(u.hex!, target);
  let best: { h: Hex; score: number } | undefined;
  for (const n of reach.values()) {
    if (!n.canStop || hexEquals(n.hex, u.hex!)) continue;
    if (!opts.allowDash && n.band === 'dash') continue;
    const d = hexDistance(n.hex, target);
    if (d < opts.stopShort) continue;
    const cell = k.map.cell(n.hex);
    const score = -d * 1.3 + (1 - cell.terrain.cover) * 2.5 + cell.terrain.concealment * 1.2 - exposureTo(k, v, n.hex) * 1.4 + tie(u.id, hexKey(n.hex));
    if (!best || score > best.score) best = { h: n.hex, score };
  }
  if (!best || hexDistance(best.h, target) >= here) return null;
  return { type: 'MoveUnit', unitId: u.id, to: { ...best.h } };
}

function nextAttackCommand(k: AiKnowledge, v: SideView, tried: Tried): Command | null {
  if (v.phase !== 'play' || v.activeSide !== k.side) return null;
  const targets = assignTargets(k, v);
  const mainTarget = currentTarget(k, v);
  const ind = indirect(k, v, tried, mainTarget);
  if (ind) return ind;
  const foes = enemies(v);
  const mine = ownOnMap(v);
  const contact = (u: UnitView) => foes.some((e) => hexDistance(e.hex!, u.hex!) <= 6);
  // bounding overwatch only in contact: half the units move, the other half fire
  const bounding = (u: UnitView) => !contact(u) || (u.id.charCodeAt(u.id.length - 1) + v.turn) % 2 === 0;
  // 1. overwatch group and support weapons fire first
  for (const u of mine) {
    if (tried.has(`fire:${u.id}`)) continue;
    const t = k.data.unitType(u.typeId);
    if (t.isAir) continue;
    const target = targets.get(u.id) ?? mainTarget;
    const moving = t.category === 'infantry' && bounding(u) && foes.every((e) => hexDistance(e.hex!, u.hex!) > 2) && hexDistance(u.hex!, target) > 1;
    if (moving) continue;
    tried.add(`fire:${u.id}`);
    const f = bestDirectFire(k, v, u);
    if (f) return f;
  }
  // 2. movement
  for (const u of mine) {
    if (tried.has(`move:${u.id}`)) continue;
    tried.add(`move:${u.id}`);
    const t = k.data.unitType(u.typeId);
    const target = targets.get(u.id) ?? mainTarget;
    const d = hexDistance(u.hex!, target);
    const nearFoe = contact(u);
    if (t.isAir) {
      const ahead = mine.filter((m) => !k.data.unitType(m.typeId).isAir).sort((a, b) => hexDistance(a.hex!, mainTarget) - hexDistance(b.hex!, mainTarget))[0];
      const goal = ahead ? ahead.hex! : mainTarget;
      const reach = reachable(k.ctx, u);
      let best: { h: Hex; score: number } | undefined;
      for (const n of reach.values()) {
        const score = -Math.abs(hexDistance(n.hex, mainTarget) - Math.max(2, hexDistance(goal, mainTarget) - 5)) - foes.filter((e) => hexDistance(e.hex!, n.hex) <= 2).length * 4 + tie(u.id, hexKey(n.hex));
        if (!best || score > best.score) best = { h: n.hex, score };
      }
      if (best && !hexEquals(best.h, u.hex!)) return { type: 'MoveUnit', unitId: u.id, to: { ...best.h } };
      continue;
    }
    if (u.passengers.length && (d <= 6 || nearFoe)) {
      for (const pid of u.passengers)
        if (!tried.has(`dismount:${pid}`)) {
          tried.add(`dismount:${pid}`);
          return { type: 'Dismount', unitId: pid, hex: { ...u.hex! } };
        }
    }
    if (u.status === 'S') continue;
    if (t.category === 'mortar') {
      const w = k.data.weapon(t.weapons[0]);
      if (d > w.maxRange - 3) {
        const m = advance(k, v, u, target, { stopShort: w.maxRange - 6, allowDash: true });
        if (m) return m;
      }
      continue;
    }
    if (t.category === 'support' || t.category === 'vehicle' || t.category === 'recce' || t.category === 'hq') {
      if (u.shots > 0) continue;
      const stand = t.category === 'vehicle' && u.passengers.length ? 5 : t.category === 'vehicle' ? 3 : t.category === 'hq' ? 6 : 4;
      if (d > stand) {
        const m = advance(k, v, u, target, { stopShort: stand, allowDash: !nearFoe });
        if (m) return m;
      }
      continue;
    }
    // infantry: on the objective's doorstep, go in if it is free
    const objFree = !foes.some((e) => hexEquals(e.hex!, target));
    if (d === 1 && objFree && u.shots === 0) return { type: 'MoveUnit', unitId: u.id, to: { ...target } };
    // stand off two hexes from a defended objective, in cover, and shoot it out
    if (!objFree && d <= 2) continue;
    if (!bounding(u) && v.turn < v.turns - 2) continue;
    if (u.shots > 0) continue;
    const m = advance(k, v, u, target, { stopShort: objFree ? 0 : 2, allowDash: !nearFoe }) ?? advance(k, v, u, target, { stopShort: objFree ? 0 : 2, allowDash: true });
    if (m) return m;
  }
  // 3. units that moved tactically may still fire
  for (const u of mine) {
    if (tried.has(`fire2:${u.id}`) || u.shots > 0) continue;
    tried.add(`fire2:${u.id}`);
    const f = bestDirectFire(k, v, u);
    if (f) return f;
  }
  return null;
}

export type ScriptedStyle = 'passive' | 'attack';

/** Play one turn (or deployment) for a scripted side. */
export function scriptedTurn(game: Game, side: Side, style: ScriptedStyle): GameEvent[] {
  const events: GameEvent[] = [];
  const s = game.state;
  if (s.phase === 'over' || s.activeSide !== side) return events;
  if (s.phase === 'deploy') {
    const r = game.dispatch(side, { type: 'EndDeployment' });
    if (r.ok) events.push(r.event);
    return events;
  }
  if (style === 'attack') {
    const k = knowledge(game.ctx, side);
    const tried = new Set<string>();
    for (let i = 0; i < 150; i++) {
      const v = game.view(side);
      const cmd = nextAttackCommand(k, v, tried);
      if (!cmd) break;
      if (cmd.type === 'Fire' || cmd.type === 'IndirectFire') tried.add(`fire:${cmd.unitId}`);
      if (cmd.type === 'CallFire') tried.add(`arty:${cmd.assetId}`);
      const r = game.dispatch(side, cmd);
      if (r.ok) events.push(r.event);
    }
  }
  if (game.state.phase === 'play' && game.state.activeSide === side) {
    const r = game.dispatch(side, { type: 'EndTurn' });
    if (r.ok) events.push(r.event);
  }
  return events;
}

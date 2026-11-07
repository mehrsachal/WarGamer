// What the AI is allowed to work with (AI-01): its side's SideView, the map and data, and the public parts of
// the scenario (objectives, own setup, the enemy's assembly area as the expected direction of attack).
// Nothing here reads GameState.
import type { MapModel, Ruleset } from '../data/ruleset';
import type { Objective, Scenario, Side } from '../data/schema';
import { type Hex, hexDistance, hexKey } from '../hex';
import { lineOfSight } from '../los';
import { otherSide } from '../state';
import type { GameContext } from '../state';
import type { SideView, UnitView } from '../view';
import { observerSensors, sensorRange } from '../visibility';

export interface AiKnowledge {
  side: Side;
  map: MapModel;
  data: Ruleset;
  /** Static context for engine helpers (only public scenario fields are read by the AI). */
  ctx: GameContext;
  objectives: Objective[];
  ownZone: Hex[];
  /** The enemy assembly area — the briefing's "expected direction of attack". */
  enemyZone: Hex[];
  turns: number;
}

export function knowledge(ctx: GameContext, side: Side): AiKnowledge {
  const s: Scenario = ctx.scenario;
  return {
    side,
    map: ctx.map,
    data: ctx.data,
    ctx,
    objectives: s.objectives,
    ownZone: s.sides[side].deploymentZone,
    enemyZone: s.sides[otherSide(side)].deploymentZone,
    turns: s.turns,
  };
}

export const own = (v: SideView) => v.units.filter((u) => u.own);
export const ownOnMap = (v: SideView) => v.units.filter((u) => u.own && u.hex);
export const enemies = (v: SideView) => v.units.filter((u) => !u.own && u.hex);

/** Hexes holding known enemy ground units (movement blockers). */
export function knownEnemyHexes(k: AiKnowledge, v: SideView): Set<string> {
  const out = new Set<string>();
  for (const e of enemies(v)) if (!k.data.unitType(e.typeId).isAir) out.add(hexKey(e.hex!));
  return out;
}

/** Ground units per hex as far as this side knows (own + visible enemy). */
export function occupancy(k: AiKnowledge, v: SideView): Map<string, number> {
  const occ = new Map<string, number>();
  for (const u of v.units) {
    if (!u.hex || k.data.unitType(u.typeId).isAir) continue;
    const key = hexKey(u.hex);
    occ.set(key, (occ.get(key) ?? 0) + 1);
  }
  return occ;
}

/** Can any own unit see this hex (FS-01 observer rule, from the side's own information)? */
export function viewSeesHex(k: AiKnowledge, v: SideView, h: Hex): boolean {
  const hh = k.data.rules.los.hexTargetHeight_m;
  for (const u of ownOnMap(v)) {
    const t = k.data.unitType(u.typeId);
    for (const s of observerSensors(k.ctx, t)) {
      if (hexDistance(u.hex!, h) > sensorRange(k.ctx, s)) continue;
      const height = s.altitude_m > 0 ? s.altitude_m : t.eyeHeight_m;
      if (lineOfSight(k.map, u.hex!, h, { observerHeight_m: height, targetHeight_m: hh }).clear) return true;
    }
  }
  return false;
}

/** Distance from a hex to the nearest hex of a set (BFS-free: sets here are small). */
export function distToSet(h: Hex, set: readonly Hex[]): number {
  let best = Infinity;
  for (const x of set) {
    const d = hexDistance(h, x);
    if (d < best) best = d;
  }
  return best;
}

/** Rough combat value of a unit (type value × remaining strength). */
export function unitValue(k: AiKnowledge, u: UnitView): number {
  const t = k.data.unitType(u.typeId);
  return t.value * (u.steps / Math.max(1, u.maxSteps));
}

/** Deterministic tie-break from ids (no RNG: the AI must not consume game dice). */
export function tie(...parts: (string | number)[]): number {
  let h = 2166136261;
  for (const ch of parts.join('|')) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return ((h >>> 0) % 1000) / 1e6;
}

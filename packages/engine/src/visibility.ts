// VIS-02 / VIS-03 / VIS-05 — what each side can see.
// A side sees an enemy unit if any of its units (on the map, not mounted) has a sensor whose effective range
// reaches it and LOS from the sensor (eye height, or altitude for a UAV camera) to the target height is clear.
// Effective range = sensor range (day / dusk / night) × weather × (1 − target concealment), where concealment
// comes from the target's hex and is reduced while the target moves and removed when it has fired.
// Units within the auto-spot range are always seen when LOS is clear.
import type { Sensor, Side, UnitType } from './data/schema';
import { type Hex, hexDistance, hexKey } from './hex';
import { lineOfSight, viewshed } from './los';
import { type GameContext, type GameState, type Posture, SIDES, type UnitState, onMap, otherSide } from './state';

/** Observation range of one sensor in the current light and weather (before concealment). */
export function sensorRange(ctx: GameContext, s: Sensor): number {
  const { scenario, data } = ctx;
  const r = data.rules.visibility;
  const base = scenario.timeOfDay === 'day' ? s.dayRange : scenario.timeOfDay === 'night' ? s.nightRange : s.nightRange + (s.dayRange - s.nightRange) * r.duskRange;
  return base * r.weatherRange[scenario.weather];
}

export interface ObserverLike {
  typeId: string;
  hex: Hex | null;
}
export interface TargetLike {
  typeId: string;
  hex: Hex | null;
  posture: Posture;
  fired: boolean;
}

export function observerSensors(ctx: GameContext, t: UnitType): Sensor[] {
  return t.sensors.map((id) => ctx.data.sensors.get(id)!).filter(Boolean);
}

/** Longest range at which this unit could see an unconcealed target (used for viewsheds). */
export function maxObservation(ctx: GameContext, typeId: string): number {
  return Math.max(0, ...observerSensors(ctx, ctx.data.unitType(typeId)).map((s) => sensorRange(ctx, s)));
}

/** Can this observer see that target right now? */
export function canObserve(ctx: GameContext, obs: ObserverLike, target: TargetLike, smoke?: ReadonlySet<string>): boolean {
  if (!obs.hex || !target.hex) return false;
  const { data, map } = ctx;
  const ot = data.unitType(obs.typeId);
  const tt = data.unitType(target.typeId);
  const d = hexDistance(obs.hex, target.hex);
  const vis = data.rules.visibility;
  const cell = map.get(target.hex);
  if (!cell) return false;
  const terrainConceal = Math.min(0.95, cell.terrain.concealment * tt.stealth);
  const baseConceal = tt.isAir ? 0 : terrainConceal * (target.posture === 'static' ? 1 : vis.movingConcealment);
  const conceal = vis.firingReveals && target.fired ? 0 : baseConceal;
  for (const s of observerSensors(ctx, ot)) {
    const eff = sensorRange(ctx, s) * (1 - conceal * s.concealmentFactor);
    if (d > Math.max(eff, vis.autoSpotRange)) continue;
    const observerHeight = s.altitude_m > 0 ? s.altitude_m : ot.eyeHeight_m;
    if (lineOfSight(map, obs.hex, target.hex, { observerHeight_m: observerHeight, targetHeight_m: tt.height_m, smoke }).clear) return true;
  }
  return false;
}

/** Can any unit of `side` see this hex (target at the rules' hex target height)? Used by the observer rule (FS-01). */
export function sideSeesHex(ctx: GameContext, state: GameState, side: Side, h: Hex): boolean {
  const hh = ctx.data.rules.los.hexTargetHeight_m;
  for (const u of onMap(state)) {
    if (u.side !== side) continue;
    const t = ctx.data.unitType(u.typeId);
    for (const s of observerSensors(ctx, t)) {
      if (hexDistance(u.hex!, h) > sensorRange(ctx, s)) continue;
      const height = s.altitude_m > 0 ? s.altitude_m : t.eyeHeight_m;
      if (lineOfSight(ctx.map, u.hex!, h, { observerHeight_m: height, targetHeight_m: hh }).clear) return true;
    }
  }
  return false;
}

/** Hexes a unit can see (VIS-02 overlay), using its best sensor. */
export function unitViewshed(ctx: GameContext, u: ObserverLike): Set<string> {
  if (!u.hex) return new Set();
  const t = ctx.data.unitType(u.typeId);
  const out = new Set<string>();
  for (const s of observerSensors(ctx, t)) {
    const height = s.altitude_m > 0 ? s.altitude_m : t.eyeHeight_m;
    for (const k of viewshed(ctx.map, u.hex, Math.floor(sensorRange(ctx, s)), { observerHeight_m: height, targetHeight_m: ctx.data.rules.los.hexTargetHeight_m })) out.add(k);
  }
  return out;
}

/** Enemy units `side` can currently see. */
export function computeVisible(ctx: GameContext, state: GameState, side: Side): string[] {
  const mine = onMap(state).filter((u) => u.side === side);
  const out: string[] = [];
  for (const e of onMap(state)) {
    if (e.side === side) continue;
    if (mine.some((m) => canObserve(ctx, m, e))) out.push(e.id);
  }
  return out;
}

/** Recompute visibility for both sides and refresh last-known positions (ghosts). Mutates state. */
export function updateVisibility(ctx: GameContext, state: GameState): void {
  for (const side of SIDES) {
    const vis = computeVisible(ctx, state, side);
    state.visible[side] = vis;
    const ghosts = state.ghosts[side];
    for (const id of vis) {
      const u = state.units[id];
      ghosts[id] = { hex: { ...u.hex! }, turn: state.turn, typeId: u.typeId };
    }
    // eliminated enemies stop being ghosts once their loss is known
    for (const id of Object.keys(ghosts)) {
      const u = state.units[id];
      if (!u || u.eliminated) delete ghosts[id];
    }
  }
}

/** Is a given unit visible to `side` (own units always are)? */
export function isVisibleTo(state: GameState, u: UnitState, side: Side): boolean {
  return u.side === side || state.visible[side].includes(u.id);
}

export function enemyOf(u: UnitState): Side {
  return otherSide(u.side);
}

export function hexOccupancy(state: GameState, ctx: GameContext): Map<string, number> {
  const occ = new Map<string, number>();
  for (const u of onMap(state)) {
    if (ctx.data.unitType(u.typeId).isAir) continue;
    const k = hexKey(u.hex!);
    occ.set(k, (occ.get(k) ?? 0) + 1);
  }
  return occ;
}

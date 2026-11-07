// CBT-01..05 — fire permission and hit probability.
// P(hit) = clamp( B_weapon(range band, target class) × C_terrain × M_posture × M_shooter × M_env , min, max )
// with M_env = light × weather. Small arms with a 0 % hard-target value cannot hurt armour (CBT-05).
import type { Weapon } from './data/schema';
import { type Hex, hexDistance } from './hex';
import { lineOfSight } from './los';
import type { GameContext, Posture, Status } from './state';
import { observerSensors } from './visibility';

export type FireBlock =
  | 'not_your_unit'
  | 'no_weapon'
  | 'indirect_weapon'
  | 'direct_weapon'
  | 'mounted'
  | 'suppressed'
  | 'dashed'
  | 'moved_static_weapon'
  | 'no_shots'
  | 'no_ammo'
  | 'out_of_range'
  | 'too_close'
  | 'no_los'
  | 'not_visible'
  | 'cannot_damage'
  | 'no_observer'
  | 'off_map';

export interface HitBreakdown {
  /** B_weapon for the range band and target class. */
  base: number;
  bandToHex: number;
  targetClass: 'soft' | 'hard' | 'air';
  /** C_terrain. */
  cover: number;
  /** M_posture (target). */
  posture: number;
  /** M_shooter. */
  shooter: number;
  light: number;
  weather: number;
  /** M_env = light × weather (× unobserved factor for indirect fire). */
  env: number;
  /** Area effect factor (adjacent hex) for indirect fire. */
  area: number;
  raw: number;
  p: number;
}

export interface FireCheck {
  ok: boolean;
  reason?: FireBlock;
  p: number;
  distance: number;
  breakdown?: HitBreakdown;
}

export interface ShooterLike {
  typeId: string;
  hex: Hex | null;
  status: Status;
  posture: Posture;
  shots: number;
  ammo: Record<string, number | null>;
  carriedBy?: string;
}

export interface FireTargetLike {
  typeId: string;
  hex: Hex | null;
  posture: Posture;
}

export function rangeBand(w: Weapon, d: number) {
  return w.rangeBands.find((b) => d <= b.toHex) ?? w.rangeBands[w.rangeBands.length - 1];
}

function hasThermal(ctx: GameContext, typeId: string): boolean {
  return observerSensors(ctx, ctx.data.unitType(typeId)).some((s) => s.thermal);
}

/** M_env components for a shooter (thermal sights recover most of the night penalty). */
export function envFactors(ctx: GameContext, shooterTypeId: string | null): { light: number; weather: number } {
  const h = ctx.data.rules.hit;
  const tod = ctx.scenario.timeOfDay;
  const light = tod === 'day' ? h.light.day : tod === 'dusk' ? h.light.dusk : shooterTypeId && hasThermal(ctx, shooterTypeId) ? h.light.nightThermal : h.light.night;
  return { light, weather: h.weather[ctx.scenario.weather] };
}

/** The CBT-02 formula, shared by direct and indirect fire. */
export function hitProbability(
  ctx: GameContext,
  w: Weapon,
  distance: number,
  target: FireTargetLike,
  shooter: { typeId: string | null; posture: Posture | null },
  extra: { area?: number; unobserved?: boolean } = {},
): HitBreakdown {
  const rules = ctx.data.rules.hit;
  const tt = ctx.data.unitType(target.typeId);
  const band = rangeBand(w, distance);
  const targetClass = tt.targetClass;
  const base = targetClass === 'hard' ? band.hardHit : targetClass === 'air' ? band.airHit : band.softHit;
  const cell = target.hex ? ctx.map.get(target.hex) : undefined;
  const cover = tt.isAir || !cell ? 1 : cell.terrain.cover;
  const posture = rules.targetPosture[target.posture];
  const shooterM = shooter.posture === null ? 1 : shooter.posture === 'moved' ? rules.shooter.moved : rules.shooter.static;
  const { light, weather } = envFactors(ctx, shooter.typeId);
  const env = light * weather * (extra.unobserved ? rules.unobservedIndirect : 1);
  const area = extra.area ?? 1;
  const raw = base * cover * posture * shooterM * env * area;
  const p = base <= 0 || area <= 0 ? 0 : Math.min(rules.max, Math.max(rules.min, raw));
  return { base, bandToHex: band.toHex, targetClass, cover, posture, shooter: shooterM, light, weather, env, area, raw, p };
}

/** Common checks on the shooter's ability to fire a weapon this turn. */
function shooterChecks(ctx: GameContext, s: ShooterLike, w: Weapon | undefined): FireBlock | undefined {
  const t = ctx.data.unitType(s.typeId);
  if (!w || !t.weapons.includes(w.id)) return 'no_weapon';
  if (s.carriedBy || !s.hex) return 'mounted';
  if (s.status === 'S') return 'suppressed';
  if (s.posture === 'dashed') return 'dashed';
  if (w.requiresStatic && s.posture !== 'static') return 'moved_static_weapon';
  if (s.shots >= ctx.data.rules.fire.shotsPerTurn) return 'no_shots';
  const ammo = s.ammo[w.id];
  if (ammo !== null && ammo !== undefined && ammo <= 0) return 'no_ammo';
  return undefined;
}

/** CBT-01/02: can the shooter fire this weapon at that target, and with what chance? */
export function directFireCheck(ctx: GameContext, s: ShooterLike, weaponId: string, target: FireTargetLike, targetVisible: boolean): FireCheck {
  const w = ctx.data.weapons.get(weaponId);
  const d = s.hex && target.hex ? hexDistance(s.hex, target.hex) : Infinity;
  const block = shooterChecks(ctx, s, w);
  if (block) return { ok: false, reason: block, p: 0, distance: d };
  if (w!.indirect) return { ok: false, reason: 'indirect_weapon', p: 0, distance: d };
  if (!targetVisible) return { ok: false, reason: 'not_visible', p: 0, distance: d };
  if (d > w!.maxRange) return { ok: false, reason: 'out_of_range', p: 0, distance: d };
  if (d < w!.minRange) return { ok: false, reason: 'too_close', p: 0, distance: d };
  const st = ctx.data.unitType(s.typeId);
  const tt = ctx.data.unitType(target.typeId);
  const los = lineOfSight(ctx.map, s.hex!, target.hex!, { observerHeight_m: st.eyeHeight_m, targetHeight_m: tt.height_m });
  if (!los.clear) return { ok: false, reason: 'no_los', p: 0, distance: d };
  const breakdown = hitProbability(ctx, w!, d, target, { typeId: s.typeId, posture: s.posture });
  if (breakdown.p <= 0) return { ok: false, reason: 'cannot_damage', p: 0, distance: d, breakdown };
  return { ok: true, p: breakdown.p, distance: d, breakdown };
}

/** FS-01: can this on-map unit fire its indirect weapon at a hex? (observer rule checked by the caller). */
export function indirectFireCheck(ctx: GameContext, s: ShooterLike, weaponId: string, h: Hex): FireCheck {
  const w = ctx.data.weapons.get(weaponId);
  const d = s.hex ? hexDistance(s.hex, h) : Infinity;
  if (!ctx.map.has(h)) return { ok: false, reason: 'off_map', p: 0, distance: d };
  const block = shooterChecks(ctx, s, w);
  if (block) return { ok: false, reason: block, p: 0, distance: d };
  if (!w!.indirect) return { ok: false, reason: 'direct_weapon', p: 0, distance: d };
  if (d > w!.maxRange) return { ok: false, reason: 'out_of_range', p: 0, distance: d };
  if (d < w!.minRange) return { ok: false, reason: 'too_close', p: 0, distance: d };
  return { ok: true, p: 1, distance: d };
}

/** Odds for a unit in (or next to) an indirect-fire impact hex. Off-map guns use their first band. */
export function indirectHit(ctx: GameContext, w: Weapon, distance: number | null, target: FireTargetLike, observed: boolean, adjacent: boolean): HitBreakdown {
  const d = distance ?? w.rangeBands[0].toHex;
  return hitProbability(ctx, w, d, target, { typeId: null, posture: null }, { area: adjacent ? w.areaEffect.adjacent : 1, unobserved: !observed });
}

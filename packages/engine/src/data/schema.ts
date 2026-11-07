// Section 4 — data model. All game numbers live in JSON validated here; the engine reads nothing else.
import { z } from 'zod';

export const MobilityClass = z.enum(['foot', 'wheeled', 'tracked', 'air']);
export type MobilityClass = z.infer<typeof MobilityClass>;
export const GroundMobility = z.enum(['foot', 'wheeled', 'tracked']);
export type GroundMobility = z.infer<typeof GroundMobility>;

export const Side = z.enum(['blue', 'red']);
export type Side = z.infer<typeof Side>;

const pct = z.number().min(0).max(1);
/** Move cost per ground mobility class; null = impassable. */
const MoveCost = z.object({
  foot: z.number().min(0).nullable(),
  wheeled: z.number().min(0).nullable(),
  tracked: z.number().min(0).nullable(),
});
const MoveCostDelta = z.object({ foot: z.number().nullable(), wheeled: z.number().nullable(), tracked: z.number().nullable() });

// ---------------------------------------------------------------- terrain.json (MAP-02/03)
export const TerrainType = z.object({
  id: z.string().min(1),
  name: z.string(),
  /** C_terrain: multiplier applied to hit chance against a target in this hex (1 = no cover). */
  cover: z.number().min(0.05).max(1),
  /** 0..1: fraction of observation range lost when spotting a static target in this hex. */
  concealment: pct,
  moveCost: MoveCost,
  /** Height of vegetation / buildings above ground that blocks LOS through the hex. */
  losHeight_m: z.number().min(0).max(60),
  /** Glyph id used by the client renderer. */
  symbol: z.string(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  description: z.string().optional(),
});
export type TerrainType = z.infer<typeof TerrainType>;

// ---------------------------------------------------------------- edges.json (MAP-04)
export const EdgeFeature = z.object({
  id: z.string().min(1),
  name: z.string(),
  /** Added to the cost of crossing this edge (null = this class cannot cross unless a crossing exists). */
  moveCostModifier: MoveCostDelta,
  blocksLOS: z.boolean(),
  losHeight_m: z.number().min(0).max(30).default(0),
  /** Mobility classes that may cross the edge without a crossing feature. */
  crossableBy: z.array(GroundMobility),
  /** Road-type edges: moving along them uses this cost instead of the destination terrain cost (MOV-05). */
  roadCost: MoveCost.optional(),
  /** Bridges / fords: lets every listed class cross obstacle edges on the same hex side and cancels their modifiers. */
  providesCrossing: z.array(GroundMobility).optional(),
  draw: z.enum(['centerline', 'edge']).default('edge'),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  width: z.number().min(0.5).max(12).default(2),
});
export type EdgeFeature = z.infer<typeof EdgeFeature>;

// ---------------------------------------------------------------- weapons.json (UNIT-03)
export const RangeBand = z.object({
  /** Upper bound of the band in hexes (inclusive). Bands must be ascending. */
  toHex: z.number().int().min(0),
  softHit: pct,
  hardHit: pct,
  airHit: pct.default(0),
});
export const Weapon = z
  .object({
    id: z.string().min(1),
    name: z.string(),
    minRange: z.number().int().min(0),
    maxRange: z.number().int().min(0),
    rangeBands: z.array(RangeBand).min(1),
    ammo: z.union([z.literal('unlimited'), z.number().int().min(1)]),
    indirect: z.boolean(),
    /** Fraction of the effect applied to each hex adjacent to the impact hex (0 = none). */
    areaEffect: z.object({ adjacent: pct }).default({ adjacent: 0 }),
    /** Chance that a hit removes a step (otherwise it only suppresses), by target class. */
    lethality: z.object({ soft: pct, hard: pct, air: pct }),
    /** Weapon cannot fire in a turn its unit has moved (crew-served / indirect). */
    requiresStatic: z.boolean().default(false),
    /** Off-map / fire-support weapon (not carried by a counter). */
    offMap: z.boolean().default(false),
  })
  .superRefine((w, ctx) => {
    if (w.minRange > w.maxRange) ctx.addIssue({ code: 'custom', message: `${w.id}: minRange > maxRange` });
    let prev = -1;
    for (const b of w.rangeBands) {
      if (b.toHex <= prev) ctx.addIssue({ code: 'custom', message: `${w.id}: rangeBands must ascend` });
      prev = b.toHex;
    }
    if (w.rangeBands[w.rangeBands.length - 1].toHex < w.maxRange)
      ctx.addIssue({ code: 'custom', message: `${w.id}: last range band (${w.rangeBands[w.rangeBands.length - 1].toHex}) must reach maxRange (${w.maxRange})` });
  });
export type Weapon = z.infer<typeof Weapon>;

// ---------------------------------------------------------------- sensors.json (VIS-05)
export const Sensor = z.object({
  id: z.string().min(1),
  name: z.string(),
  dayRange: z.number().int().min(0),
  nightRange: z.number().int().min(0),
  /** Altitude of the sensor above its hex's ground (UAV camera). 0 = uses the unit's eye height. */
  altitude_m: z.number().min(0).default(0),
  /** Multiplier on target concealment (thermal < 1 sees through some cover). */
  concealmentFactor: z.number().min(0).max(1).default(1),
  /** Thermal / night-capable sight: the owning unit uses the night-thermal light modifier when firing at night. */
  thermal: z.boolean().default(false),
});
export type Sensor = z.infer<typeof Sensor>;

// ---------------------------------------------------------------- units.json (UNIT-02)
export const UnitType = z.object({
  id: z.string().min(1),
  name: z.string(),
  /** APP-6 symbol identification code (affiliation position is replaced per side at render time). */
  symbol: z.string().min(10),
  category: z.enum(['infantry', 'support', 'mortar', 'recce', 'hq', 'engineer', 'vehicle', 'air']),
  mobilityClass: MobilityClass,
  movePoints: z.number().min(0),
  steps: z.number().int().min(1),
  crew: z.number().int().min(0),
  weapons: z.array(z.string()),
  sensors: z.array(z.string()).min(1),
  /** Number of foot units this unit can carry (UNIT-04). */
  transportCapacity: z.number().int().min(0).default(0),
  eyeHeight_m: z.number().min(0).max(10),
  /** Height presented as a target (LOS target height; a UAV's flying altitude). */
  height_m: z.number().min(0).max(1000),
  isAir: z.boolean().default(false),
  targetClass: z.enum(['soft', 'hard', 'air']),
  /** Counts for objective ownership (UAVs cannot hold ground). */
  holdsGround: z.boolean().default(true),
  /** UAV endurance in turns before it must land / is lost (ISR-03). */
  endurance: z.number().int().min(1).optional(),
  /** Multiplier on the concealment the unit gets from terrain (vehicles < 1, snipers > 1; capped at 0.95). */
  stealth: z.number().min(0).max(3).default(1),
  /** Points of value used by AI targeting and casualty scoring. */
  value: z.number().min(0).default(1),
});
export type UnitType = z.infer<typeof UnitType>;

// ---------------------------------------------------------------- rules.json (tunable constants)
const SlopeBand = z.object({ maxPct: z.number().min(0), add: MoveCostDelta });
export const Rules = z.object({
  hit: z.object({
    min: pct,
    max: pct,
    /** M_posture: target posture multiplier. */
    targetPosture: z.object({ static: z.number(), moved: z.number(), dashed: z.number() }),
    /** M_shooter: shooter state multiplier (suppressed and dashed units cannot fire at all). */
    shooter: z.object({ static: z.number(), moved: z.number() }),
    /** M_env components. */
    light: z.object({ day: z.number(), dusk: z.number(), night: z.number(), nightThermal: z.number() }),
    weather: z.object({ clear: z.number(), dust: z.number(), rain: z.number(), fog: z.number(), snow: z.number() }),
    /** Multiplier for indirect fire on a hex no friendly unit can see (only if the scatter rule allows it). */
    unobservedIndirect: z.number(),
  }),
  suppression: z.object({
    /** Base rally chance at the start of the unit's own turn. */
    recoveryChance: pct,
    /** Extra rally chance per point of cover protection, i.e. + bonus × (1 - cover). */
    coverBonus: pct,
    /** Move point multiplier while suppressed. */
    moveFactor: z.number().min(0).max(1),
    /** Added to weapon lethality when the target is already suppressed (sustained fire breaks units). */
    repeatHitLethality: pct.default(0),
  }),
  move: z.object({
    /** Share of a unit's move points that keeps it "tactical" (may still fire). Beyond it the unit dashes. */
    tacticalFraction: pct,
    /** Uphill slope (% = rise / hex size) bands adding move cost; null = class cannot climb that slope. */
    slopeBands: z.array(SlopeBand).min(1),
    /** Move points a foot unit spends to mount a vehicle in its own or an adjacent hex. */
    mountCost: z.number().min(0),
    /** Fraction of the turn's move allowance consumed by dismounting (1 = the whole turn's movement). */
    dismountCostFraction: pct,
  }),
  los: z.object({
    /** Target height used when shading which hexes a unit can see (viewshed). */
    hexTargetHeight_m: z.number().min(0),
  }),
  visibility: z.object({
    /** Observation range multiplier by weather (MAP-09). */
    weatherRange: z.object({ clear: z.number(), dust: z.number(), rain: z.number(), fog: z.number(), snow: z.number() }),
    /** Observation range multiplier at dusk (between the day and night ranges). */
    duskRange: z.number().min(0).max(1),
    /** Concealment multiplier for a target that moved this turn (moving units are easier to spot). */
    movingConcealment: pct,
    /** Units within this many hexes are always seen if LOS is clear. */
    autoSpotRange: z.number().int().min(0),
    /** Units that fired this turn ignore concealment for the enemy (VIS-04). */
    firingReveals: z.boolean(),
  }),
  indirect: z.object({
    /** FS-01: indirect fire needs a friendly unit that can see the target hex. */
    requireObserver: z.boolean(),
  }),
  passengers: z.object({ lossChanceOnVehicleKill: pct }),
  /** MOV-07: most ground units allowed in one hex (air units do not count). */
  stacking: z.object({ maxUnitsPerHex: z.number().int().min(1) }),
  /** Number of fire actions (direct or indirect) a unit may make in its turn. */
  fire: z.object({ shotsPerTurn: z.number().int().min(1) }),
  scoring: z.object({ objectiveWeight: z.number(), killWeightPerStep: z.number(), lossWeightPerStep: z.number() }),
});
export type Rules = z.infer<typeof Rules>;

// ---------------------------------------------------------------- maps/<id>.json
export const MapHex = z.object({
  q: z.number().int(),
  r: z.number().int(),
  elevation_m: z.number(),
  terrainId: z.string(),
  /** Edge features keyed by direction 0..5 (see hex.ts DIRECTIONS). Mirrored to the neighbour on load. */
  edges: z.record(z.string(), z.array(z.string())).default({}),
  label: z.string().optional(),
});
export type MapHex = z.infer<typeof MapHex>;

export const MapLabel = z.object({ q: z.number().int(), r: z.number().int(), text: z.string(), kind: z.enum(['village', 'feature', 'height', 'objective', 'water']) });
export const GameMap = z.object({
  id: z.string().min(1),
  name: z.string(),
  hexSize_m: z.number().min(10).max(5000),
  orientation: z.enum(['flat', 'pointy']),
  /** Rectangular extent in offset coordinates (cols × rows). */
  width: z.number().int().min(1),
  height: z.number().int().min(1),
  hexes: z.array(MapHex).min(1),
  /** Grid reference of the centre of hex (0,0): easting / northing in metres. */
  gridRefOrigin: z.object({ easting: z.number(), northing: z.number() }),
  labels: z.array(MapLabel).default([]),
  classification: z.string().default('UNCLASSIFIED — FICTIONAL'),
});
export type GameMap = z.infer<typeof GameMap>;

// ---------------------------------------------------------------- scenarios/<id>.json
const HexRef = z.object({ q: z.number().int(), r: z.number().int() });
export const OrbatEntry = z.object({
  id: z.string().min(1),
  typeId: z.string(),
  name: z.string(),
  /** Pre-placed position (otherwise placed during deployment inside the zone). */
  hex: HexRef.optional(),
  /** Starts mounted in this vehicle (orbat id). */
  mountedIn: z.string().optional(),
});
export type OrbatEntry = z.infer<typeof OrbatEntry>;

export const FireSupportAsset = z.object({
  id: z.string().min(1),
  name: z.string(),
  weaponId: z.string(),
  missions: z.number().int().min(0),
  /** First turn on which missions may be called. */
  fromTurn: z.number().int().min(1),
  /** Call-for-fire delay in own turns (0 = immediate, 1 = lands at the start of your next turn). */
  delay: z.number().int().min(0).max(2),
});
export type FireSupportAsset = z.infer<typeof FireSupportAsset>;

export const SideSetup = z.object({
  name: z.string(),
  deploymentZone: z.array(HexRef),
  orbat: z.array(OrbatEntry).min(1),
  fireSupport: z.array(FireSupportAsset).default([]),
  briefing: z.string().default(''),
});
export type SideSetup = z.infer<typeof SideSetup>;

export const Objective = z.object({
  id: z.string().min(1),
  name: z.string(),
  hex: HexRef,
  value: z.number().int().min(0),
  initialOwner: Side.nullable(),
});
export type Objective = z.infer<typeof Objective>;

export const VictoryRules = z.object({
  /** At the final turn the side owning the greater objective value wins (VIC-02). */
  objectiveMajority: z.boolean().default(true),
  /** Immediate win when the enemy falls below this share of its starting steps. */
  attritionWinBelowPct: z.object({ blue: pct.optional(), red: pct.optional() }).default({}),
  /** Winner if objective value is tied at the end (defender). */
  tieWinner: Side.nullable().default(null),
  /** Optional: the game ends once this side holds every objective at the end of its turn. */
  suddenDeathAllObjectives: z.boolean().default(false),
});
export type VictoryRules = z.infer<typeof VictoryRules>;

export const Scenario = z.object({
  id: z.string().min(1),
  title: z.string(),
  mapId: z.string(),
  turns: z.number().int().min(1).max(99),
  minutesPerTurn: z.number().min(1),
  weather: z.enum(['clear', 'dust', 'rain', 'fog', 'snow']),
  timeOfDay: z.enum(['day', 'dusk', 'night']),
  /** Side that moves first each turn. */
  firstSide: Side,
  briefing: z.object({
    situation: z.string(),
    mission: z.string(),
    forces: z.string(),
    time: z.string(),
    victory: z.string(),
    lessons: z.array(z.string()).default([]),
  }),
  sides: z.object({ blue: SideSetup, red: SideSetup }),
  objectives: z.array(Objective),
  victoryRules: VictoryRules,
  /** Default AI side for vs-AI play and its posture. */
  ai: z.object({ side: Side, posture: z.enum(['defend', 'attack']) }).optional(),
  reinforcements: z.array(z.object({ turn: z.number().int(), side: Side, entry: z.array(HexRef), orbat: z.array(OrbatEntry) })).default([]),
  classification: z.string().default('UNCLASSIFIED — FICTIONAL'),
});
export type Scenario = z.infer<typeof Scenario>;

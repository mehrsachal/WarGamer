import type { MapModel, Ruleset } from './data/ruleset';
import type { Scenario, Side } from './data/schema';
import { type Hex, hexKey } from './hex';

/** Everything static a game needs: validated data, map and scenario. */
export interface GameContext {
  data: Ruleset;
  map: MapModel;
  scenario: Scenario;
}

export type Status = 'C' | 'S';
/** What the unit did in its last own turn: drives the target-posture modifier and fire permission. */
export type Posture = 'static' | 'moved' | 'dashed';

export interface UnitState {
  id: string;
  side: Side;
  typeId: string;
  name: string;
  /** Null while mounted in a vehicle or after elimination. */
  hex: Hex | null;
  steps: number;
  maxSteps: number;
  /** CBT-03: C = combat-ready, S = suppressed. */
  status: Status;
  posture: Posture;
  /** Move points spent in the current own turn. */
  mpSpent: number;
  /** Fire actions used in the current own turn. */
  shots: number;
  /** Fired during its last own turn (reveals the unit to the enemy until its next turn starts). */
  fired: boolean;
  /** Rounds left per weapon id; null = unlimited. */
  ammo: Record<string, number | null>;
  carriedBy?: string;
  passengers: string[];
  eliminated: boolean;
  /** UAV turns of flight left. */
  enduranceLeft?: number;
}

export interface PendingFire {
  id: string;
  side: Side;
  assetId: string;
  weaponId: string;
  hex: Hex;
  callTurn: number;
  impactTurn: number;
  observed: boolean;
}

export interface Ghost {
  hex: Hex;
  turn: number;
  typeId: string;
}

export interface GameResult {
  winner: Side | null;
  reason: 'objectives' | 'attrition' | 'all_objectives' | 'tie';
  turn: number;
  vp: Record<Side, number>;
  score: Record<Side, number>;
  stepsLost: Record<Side, number>;
}

export interface GameState {
  scenarioId: string;
  seed: number;
  /** Next RNG draw index (CBT-07). */
  rngCursor: number;
  /** Number of events applied. */
  seq: number;
  phase: 'deploy' | 'play' | 'over';
  turn: number;
  activeSide: Side;
  deployed: Record<Side, boolean>;
  units: Record<string, UnitState>;
  /** Unit ids in ORBAT order (Prev / Next unit). */
  order: string[];
  objectives: Record<string, Side | null>;
  /** Missions left per fire-support asset. */
  fireSupport: Record<Side, Record<string, number>>;
  pendingFires: PendingFire[];
  /** Enemy unit ids each side can currently see (VIS-03). */
  visible: Record<Side, string[]>;
  /** Last-known enemy positions (faded ghosts). */
  ghosts: Record<Side, Record<string, Ghost>>;
  startSteps: Record<Side, number>;
  result?: GameResult;
}

export const SIDES: readonly Side[] = ['blue', 'red'];

export function otherSide(s: Side): Side {
  return s === 'blue' ? 'red' : 'blue';
}

export function unitsOf(state: GameState, side: Side): UnitState[] {
  return state.order.map((id) => state.units[id]).filter((u) => u.side === side && !u.eliminated);
}

/** Units standing on the map (not mounted, not eliminated). */
export function onMap(state: GameState): UnitState[] {
  return state.order.map((id) => state.units[id]).filter((u) => !u.eliminated && u.hex);
}

export function unitsAt(state: GameState, h: Hex): UnitState[] {
  const k = hexKey(h);
  return onMap(state).filter((u) => hexKey(u.hex!) === k);
}

export function stepsOf(state: GameState, side: Side): number {
  return Object.values(state.units)
    .filter((u) => u.side === side && !u.eliminated)
    .reduce((m, u) => m + u.steps, 0);
}

/** Initial state for a scenario: pre-placed units on the map, the rest awaiting deployment. */
export function initialState(ctx: GameContext, seed: number): GameState {
  const { scenario, data } = ctx;
  const units: Record<string, UnitState> = {};
  const order: string[] = [];
  const fireSupport: GameState['fireSupport'] = { blue: {}, red: {} };
  for (const side of SIDES) {
    const ss = scenario.sides[side];
    for (const o of ss.orbat) {
      const t = data.unitType(o.typeId);
      const ammo: Record<string, number | null> = {};
      for (const w of t.weapons) {
        const wd = data.weapon(w);
        ammo[w] = wd.ammo === 'unlimited' ? null : wd.ammo;
      }
      units[o.id] = {
        id: o.id,
        side,
        typeId: o.typeId,
        name: o.name,
        hex: o.mountedIn ? null : o.hex ? { q: o.hex.q, r: o.hex.r } : null,
        steps: t.steps,
        maxSteps: t.steps,
        status: 'C',
        posture: 'static',
        mpSpent: 0,
        shots: 0,
        fired: false,
        ammo,
        carriedBy: o.mountedIn,
        passengers: [],
        eliminated: false,
        enduranceLeft: t.endurance,
      };
      order.push(o.id);
    }
    for (const o of ss.orbat) if (o.mountedIn) units[o.mountedIn].passengers.push(o.id);
    for (const f of ss.fireSupport) fireSupport[side][f.id] = f.missions;
  }
  const objectives: Record<string, Side | null> = {};
  for (const o of scenario.objectives) objectives[o.id] = o.initialOwner;
  const startSteps = { blue: 0, red: 0 };
  for (const u of Object.values(units)) startSteps[u.side] += u.steps;
  return {
    scenarioId: scenario.id,
    seed: seed >>> 0,
    rngCursor: 0,
    seq: 0,
    phase: 'deploy',
    turn: 0,
    activeSide: scenario.firstSide,
    deployed: { blue: false, red: false },
    units,
    order,
    objectives,
    fireSupport,
    pendingFires: [],
    visible: { blue: [], red: [] },
    ghosts: { blue: {}, red: {} },
    startSteps,
  };
}

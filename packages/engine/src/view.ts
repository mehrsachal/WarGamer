// SET-05 / NFR-04 — what one side is allowed to know. The server sends only this to a client; enemy units
// appear only while currently seen, otherwise as last-known ghosts, and the log is redacted per side.
import type { FireSupportAsset, Side } from './data/schema';
import type { LogItem } from './events';
import type { Hex } from './hex';
import type { GameContext, GameResult, GameState, PendingFire, Posture, Status } from './state';

export interface UnitView {
  id: string;
  side: Side;
  typeId: string;
  name: string;
  hex: Hex | null;
  steps: number;
  maxSteps: number;
  status: Status;
  posture: Posture;
  fired: boolean;
  own: boolean;
  // own units only
  mpSpent: number;
  shots: number;
  ammo: Record<string, number | null>;
  carriedBy?: string;
  passengers: string[];
  enduranceLeft?: number;
}

export interface GhostView {
  id: string;
  typeId: string;
  hex: Hex;
  turn: number;
}

export interface ObjectiveView {
  id: string;
  name: string;
  hex: Hex;
  value: number;
  owner: Side | null;
}

export interface FireSupportView extends FireSupportAsset {
  missionsLeft: number;
  available: boolean;
}

export interface SideView {
  side: Side;
  scenarioId: string;
  phase: GameState['phase'];
  turn: number;
  turns: number;
  activeSide: Side;
  firstSide: Side;
  seq: number;
  deployed: Record<Side, boolean>;
  units: UnitView[];
  ghosts: GhostView[];
  objectives: ObjectiveView[];
  vp: Record<Side, number>;
  fireSupport: FireSupportView[];
  pendingFires: PendingFire[];
  deploymentZone: Hex[];
  weather: string;
  timeOfDay: string;
  minutesPerTurn: number;
  result?: GameResult;
}

export function sideView(ctx: GameContext, s: GameState, side: Side): SideView {
  const visible = new Set(s.visible[side]);
  const units: UnitView[] = [];
  for (const id of s.order) {
    const u = s.units[id];
    if (u.eliminated) continue;
    if (u.side === side) {
      units.push({
        id: u.id,
        side: u.side,
        typeId: u.typeId,
        name: u.name,
        hex: u.hex ? { ...u.hex } : null,
        steps: u.steps,
        maxSteps: u.maxSteps,
        status: u.status,
        posture: u.posture,
        fired: u.fired,
        own: true,
        mpSpent: u.mpSpent,
        shots: u.shots,
        ammo: { ...u.ammo },
        carriedBy: u.carriedBy,
        passengers: [...u.passengers],
        enduranceLeft: u.enduranceLeft,
      });
    } else if (s.phase !== 'deploy' && visible.has(u.id) && u.hex) {
      units.push({
        id: u.id,
        side: u.side,
        typeId: u.typeId,
        name: ctx.data.unitType(u.typeId).name,
        hex: { ...u.hex },
        steps: u.steps,
        maxSteps: u.maxSteps,
        status: u.status,
        posture: u.posture,
        fired: u.fired,
        own: false,
        mpSpent: 0,
        shots: 0,
        ammo: {},
        passengers: [],
      });
    }
  }
  const ghosts: GhostView[] = Object.entries(s.ghosts[side])
    .filter(([id]) => !visible.has(id))
    .map(([id, g]) => ({ id, typeId: g.typeId, hex: { ...g.hex }, turn: g.turn }));
  const vp = { blue: 0, red: 0 };
  const objectives = ctx.scenario.objectives.map((o) => {
    const owner = s.objectives[o.id];
    if (owner) vp[owner] += o.value;
    return { id: o.id, name: o.name, hex: { ...o.hex }, value: o.value, owner };
  });
  const fireSupport = ctx.scenario.sides[side].fireSupport.map((f) => {
    const left = s.fireSupport[side][f.id] ?? 0;
    return { ...f, missionsLeft: left, available: s.phase === 'play' && s.turn >= f.fromTurn && left > 0 };
  });
  return {
    side,
    scenarioId: s.scenarioId,
    phase: s.phase,
    turn: s.turn,
    turns: ctx.scenario.turns,
    activeSide: s.activeSide,
    firstSide: ctx.scenario.firstSide,
    seq: s.seq,
    deployed: { ...s.deployed },
    units,
    ghosts,
    objectives,
    vp,
    fireSupport,
    pendingFires: s.pendingFires.filter((p) => p.side === side).map((p) => ({ ...p })),
    deploymentZone: s.phase === 'deploy' ? ctx.scenario.sides[side].deploymentZone.map((h) => ({ q: h.q, r: h.r })) : [],
    weather: ctx.scenario.weather,
    timeOfDay: ctx.scenario.timeOfDay,
    minutesPerTurn: ctx.scenario.minutesPerTurn,
    result: s.result,
  };
}

/**
 * Log items a side may read (CBT-08 under fog of war): hidden shooters are redacted and enemy units are named
 * by type only (their ORBAT names are not given away). `typeName` maps a unit type id to its display name.
 */
export function filterLog(items: readonly LogItem[], side: Side, typeName: (typeId: string) => string = (t) => t): LogItem[] {
  const out: LogItem[] = [];
  for (const it of items) {
    if (it.side !== side && !it.seenBy.includes(side)) continue;
    const enemyActor = it.side !== side;
    switch (it.k) {
      case 'fire': {
        let x = { ...it };
        if (enemyActor && !it.shooterSeenBy.includes(side)) x = { ...x, shooterId: '', shooterName: '', shooterTypeId: null, from: null };
        else if (enemyActor) x = { ...x, shooterName: it.shooterTypeId ? typeName(it.shooterTypeId) : it.shooterName };
        if (it.targetSide !== side) x = { ...x, targetName: typeName(it.targetTypeId) };
        out.push(x);
        break;
      }
      case 'impact':
        out.push(enemyActor ? { ...it, source: '', sourceName: '' } : it);
        break;
      case 'move':
        out.push(enemyActor ? { ...it, name: typeName(it.typeId) } : it);
        break;
      case 'dismount':
      case 'passenger_loss':
      case 'mount':
        out.push(enemyActor ? { ...it, name: '' } : it);
        break;
      default:
        out.push(it);
    }
  }
  return out;
}

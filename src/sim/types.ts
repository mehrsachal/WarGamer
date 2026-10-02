import type { Vec } from '../core/geom';
import type { Echelon, Role, Side } from '../core/types';
import type { UnitKind, WeaponKey } from '../core/units';
import type { MoveMode } from '../terrain/terrain';

export type UnitState =
  | 'OFFMAP'
  | 'POSN'
  | 'MOVE'
  | 'HALT'
  | 'ASSAULT'
  | 'CONSOLIDATE'
  | 'WITHDRAW'
  | 'BROKEN'
  | 'DESTROYED'
  | 'CAPTURED';

export type RedRole = 'RECCE' | 'ADV_GUARD' | 'ASSAULT' | 'RESERVE' | 'BOF' | 'TANKS' | 'ENGR';

export interface Element {
  name: string;
  str: number;
  max: number;
  lost: boolean;
  /** Offset from unit centre (m). */
  off: Vec;
}

export interface SimUnit {
  id: string;
  side: Side;
  key: string;
  kind: UnitKind;
  echelon: Echelon;
  label: string;
  name: string;
  sidc: string;
  pos: Vec;
  home: Vec;
  facing: number;
  role: Role | RedRole;
  state: UnitState;
  strength: number;
  start: number;
  vehicles: number;
  startVehicles: number;
  weapons: Partial<Record<WeaponKey, number>>;
  elements: Element[];
  ammo: number;
  morale: number;
  supp: number;
  /** Entrenchment 0..1 (0 = in the open, 1 = trenches with OHP & cam). */
  dug: number;
  mode: MoveMode;
  speed: number;
  path: Vec[];
  pathIdx: number;
  /** Personnel lost during the current move/assault (for break-off checks). */
  phaseCas: number;
  phaseStart: number;
  altPos?: Vec;
  parentId?: string;
  task: string;
  /** Unit being assaulted / supported. */
  targetId?: string;
  objPos?: Vec;
  firedAt: number;
  /** Fire signature produced this tick (0..1). */
  sig: number;
  obsRange: number;
  nvd: boolean;
  radius: number;
  /** Red plan bookkeeping. */
  phase?: number;
  waitUntil?: number;
  capturedAt?: number;
  catk?: boolean;
  /** Own locality a counter-attack is restoring. */
  restoreId?: string;
  /** Coordination bonus for counter-attacks (rehearsed / coordinated). */
  bonus?: number;
  probing?: boolean;
  /** Held up at an obstacle (bunched, exposed). */
  breaching?: boolean;
  log?: string;
}

export interface Contact {
  id: string;
  unitId: string;
  pos: Vec;
  lastSeen: number;
  firstSeen: number;
  conf: number;
  ident: 'UNKNOWN' | 'INF' | 'ARMOUR' | 'SUPPORT' | 'RECCE';
  size: Echelon | 'UNKNOWN';
  by: string;
  moving: boolean;
  vehicles: number;
}

export type FireKind = 'DF' | 'SOS' | 'ADJUST' | 'PREP' | 'DIRECT' | 'UCAV' | 'AQC';
export type FireAsset = 'ARTY' | 'MOR81' | 'MOR60' | 'EN_ARTY' | 'EN_MOR';

export interface FireMission {
  id: string;
  side: Side;
  asset: FireAsset;
  kind: FireKind;
  target: Vec;
  radius: number;
  start: number;
  end: number;
  /** Rounds per minute delivered. */
  rpm: number;
  calibre: number;
  observed: boolean;
  label: string;
  error: Vec;
}

export interface FireEvent {
  from: Vec;
  to: Vec;
  kind: 0 | 1 | 2 | 3 | 4;
}

export interface QcState {
  id: string;
  kind: 'SURV' | 'ATTACK';
  base: Vec;
  pos: Vec;
  target?: Vec;
  targetUnitId?: string;
  airborne: boolean;
  endurance: number;
  launchedAt: number;
  readyAt: number;
  lost: boolean;
  usedStrikes: number;
}

export interface LogEntry {
  time: number;
  text: string;
  level: 'info' | 'warn' | 'crit' | 'good';
}

export interface DecisionOption {
  id: string;
  text: string;
  needsUnit?: boolean;
  needsDelay?: boolean;
}

export interface PendingDecision {
  key: string;
  title: string;
  prompt: string;
  options: DecisionOption[];
  multi?: boolean;
  preplanned?: string;
  preplannedDelay?: number;
  preplannedUnit?: string;
  unitChoices?: { id: string; label: string }[];
  time: number;
  focus?: Vec;
  context: Record<string, unknown>;
}

export interface DecisionInput {
  option: string;
  options?: string[];
  unitId?: string;
  delayMin?: number;
}

export type ManualOrder =
  | { type: 'DF'; dfId: string }
  | { type: 'FIRE_CONTACT'; contactId: string; asset: 'ARTY' | 'MOR81' | 'MOR60' }
  | { type: 'QC_SURV'; target: Vec }
  | { type: 'QC_RECALL' }
  | { type: 'AQC'; contactId: string }
  | { type: 'UCAV'; contactId: string; justification: string[] }
  | { type: 'MOVE_ALT'; unitId: string }
  | { type: 'WITHDRAW'; unitId: string }
  | { type: 'CATK'; unitId: string; target: Vec }
  | { type: 'CPEN'; unitId: string }
  | { type: 'HOLD'; unitId: string };

export interface EnemyPlan {
  approachId: string;
  approachName: string;
  faa: Vec;
  faaName: string;
  fup: Vec;
  fupName: string;
  bof: Vec;
  bofName: string;
  sl: Vec;
  hHour: number;
  objectives: { phase: number; pos: Vec; name: string; blueId?: string }[];
  text: string[];
}

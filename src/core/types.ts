import type { Vec } from './geom';
import type { LightTable } from './time';

export type Side = 'BLUE' | 'RED';
/** The echelon the student commands. PL/COY = minor tactics, BN/BDE = major ops. */
export type OpsLevel = 'PL' | 'COY' | 'BN' | 'BDE';
export type Echelon = 'TEAM' | 'SEC' | 'PL' | 'COY' | 'BN' | 'BDE' | 'DIV';
export type TerrainType = 'PLAINS' | 'CANAL' | 'DESERT' | 'SEMI_DESERT';

// ---------------------------------------------------------------- terrain

export interface FeatureBase {
  id: string;
  name?: string;
}
export interface BuaFeature extends FeatureBase {
  kind: 'bua';
  poly: Vec[];
  storeys: number;
}
export type LinearKind = 'road' | 'track' | 'canal' | 'disty' | 'nullah' | 'river' | 'border' | 'bund' | 'railway';
export interface LinearFeature extends FeatureBase {
  kind: LinearKind;
  pts: Vec[];
  /** Road class e.g. "Cl 30 A 1". */
  cls?: string;
  /** Width in metres (water obstacles). */
  width?: number;
}
export interface HeightFeature extends FeatureBase {
  kind: 'height';
  c: Vec;
  rx: number;
  ry: number;
  rot: number;
  /** Relative height in metres ("16 r"). */
  h: number;
}
export type AreaKind = 'trees' | 'broken' | 'grass' | 'dunes' | 'marsh';
export interface AreaFeature extends FeatureBase {
  kind: AreaKind;
  poly: Vec[];
}
export interface PointFeature extends FeatureBase {
  kind: 'bop' | 'bridge' | 'graveyard';
  pos: Vec;
  side?: Side;
  rot?: number;
}
export interface KBundFeature extends FeatureBase {
  kind: 'kbund';
  c: Vec;
  r: number;
  /** Bearing the open side faces. */
  rot: number;
}
export type Feature = BuaFeature | LinearFeature | HeightFeature | AreaFeature | PointFeature | KBundFeature;

export interface TerrainData {
  width: number;
  height: number;
  /** Analysis raster cell (m). */
  cell: number;
  /** Map grid square (m). 500 for minor tactics, 1000 for major ops. */
  gridSq: number;
  /** Label of the south-west grid lines (e.g. 12 / 64 as in the BIC-49 sketch). */
  gridOrigin: { e: number; n: number };
  features: Feature[];
  type: TerrainType;
}

// ---------------------------------------------------------------- scenario

export interface NamedPoint {
  name: string;
  pos: Vec;
  approachId?: string;
}

export interface Approach {
  id: string;
  name: string;
  /** Left / Centre / Right as seen by the defender facing the enemy. */
  flank: 'L' | 'C' | 'R';
  path: Vec[];
  tankGoing: 'good' | 'fair' | 'poor';
  /** DS priority, 1 = most likely. */
  pri: number;
  capacity: string;
  notes: string[];
}

export interface ITG {
  id: string;
  name: string;
  pos: Vec;
  pri: number;
  vital?: boolean;
  notes?: string;
}

export interface LineOfDef {
  id: string;
  name: string;
  pts: Vec[];
  itgIds: string[];
  pri: number;
}

export interface DsSolution {
  approaches: Approach[];
  itgs: ITG[];
  linesOfDef: LineOfDef[];
  /** Line of FDLs the DS considers "as far forward as tactically feasible". */
  recommendedFdl: string;
  recommendedDepth?: string;
  screenArea?: NamedPoint;
  likelyFAAs: NamedPoint[];
  likelyFUPs: NamedPoint[];
  likelyBOFs: NamedPoint[];
  notes: string[];
}

export interface NarrativeSection {
  key: string;
  title: string;
  body: string;
}

export type ResourceStatus = 'ORGANIC' | 'UC' | 'DS' | 'IN_SP' | 'ON_DEMAND';
export interface ResourceItem {
  templateKey: string;
  count: number;
  status: ResourceStatus;
  note?: string;
}

export interface FireSupport {
  artyBatteries: number;
  artyCalibre: '105' | '122' | '155';
  artyLabel: string;
  mor81: boolean;
  ucavSorties: number;
  mines: { apM: number; atM: number }; // metres of frontage that can be laid
  wireM: number;
}

export interface EnemyForceItem {
  templateKey: string;
  count: number;
}

export interface Scenario {
  id: string;
  title: string;
  subtitle?: string;
  level: OpsLevel;
  source: 'preset' | 'generated' | 'custom';
  seed: number;
  createdAt: number;
  terrain: TerrainData;
  narrative: NarrativeSection[];
  requirements: string[];
  own: {
    formation: string;
    higher: string;
    aor: Vec[];
    boundaries: { pts: Vec[]; label: string; echelon: Echelon }[];
    flanks: { side: 'L' | 'R'; name: string }[];
    resources: ResourceItem[];
    fire: FireSupport;
  };
  enemy: {
    name: string;
    force: EnemyForceItem[];
    entry: Vec[];
    attackAtNight: boolean;
    ewThreat: 'LOW' | 'MED' | 'HIGH';
    airThreat: 'LOW' | 'MED' | 'HIGH';
    artyBatteries: number;
  };
  times: {
    now: number;
    defReady: number;
    enCrossBorder: number;
    /** Planned enemy H hour (hidden from the student). */
    hHour: number;
    end: number;
    light: LightTable;
  };
  weather: {
    cond: 'clear' | 'haze' | 'rain' | 'fog' | 'dust';
    going: 'dry' | 'wet';
    temp: string;
    wind: string;
    vis: number;
  };
  ds: DsSolution;
}

// ---------------------------------------------------------------- plan

export type Role =
  | 'FDL'
  | 'DEPTH'
  | 'SCREEN'
  | 'SP_PTL'
  | 'LP'
  | 'OP'
  | 'CHQ'
  | 'CP'
  | 'RES'
  | 'SP_WPN'
  | 'OBS'
  | 'QC'
  | 'ENGR';

export interface PlacedUnit {
  id: string;
  templateKey: string;
  label: string;
  pos: Vec;
  /** Bearing of the centre of the primary arc of fire. */
  facing: number;
  role: Role;
  altPos?: Vec;
  /** Parent locality this weapon/detachment is grouped with. */
  parentId?: string;
  notes?: string;
}

export type GraphicKind = 'FDL' | 'KILL_AREA' | 'MINEFIELD' | 'WIRE' | 'DF' | 'CATK' | 'CPEN' | 'QC_AREA' | 'PTL_ROUTE' | 'NOTE';

export interface PlanGraphic {
  id: string;
  kind: GraphicKind;
  pts: Vec[];
  props: {
    subtype?: string;
    sos?: boolean;
    label?: string;
    priority?: number;
    unitId?: string;
    radius?: number;
    text?: string;
  };
}

export interface Appreciation {
  approachOrder: string[];
  itgOrder: string[];
  lineOrder: string[];
  fdlLine: string;
  depthLine: string;
  bias: '' | 'L' | 'C' | 'R';
  enMostLikelyApproach: string;
  priorityOfWork: string[];
  text: Record<string, string>;
}

export interface ContingencyChoice {
  option: string;
  unitId?: string;
  delayMin?: number;
}
export type ContingencyPlan = Record<string, ContingencyChoice>;

export interface Plan {
  units: PlacedUnit[];
  graphics: PlanGraphic[];
  appreciation: Appreciation;
  contingency: ContingencyPlan;
  /** QC sortie windows planned in advance (exercise minutes). */
  qcSorties: { start: number; areaId: string }[];
  updatedAt: number;
}

// ---------------------------------------------------------------- people & exercises

export interface ClassGroup {
  id: string;
  name: string;
  course: string;
  notes: string;
  createdAt: number;
  archived?: boolean;
}

export interface Student {
  id: string;
  classId: string;
  rank: string;
  name: string;
  number: string;
  unit: string;
  syndicate: string;
  pinHash?: string;
  createdAt: number;
}

export type FogLevel = 'FULL' | 'PARTIAL' | 'OFF';

export interface ExerciseSettings {
  fog: FogLevel;
  injects: boolean;
  hints: boolean;
  revealPlanScore: 'IMMEDIATE' | 'AFTER_WARGAME' | 'INSTRUCTOR';
  difficulty: 'TRAINING' | 'STANDARD' | 'HARD';
  planWeight: number;
  timeLimitMin: number;
}

export interface Exercise {
  id: string;
  title: string;
  scenarioId: string;
  classId: string;
  studentIds: string[];
  settings: ExerciseSettings;
  createdAt: number;
  dueAt?: number;
  closed?: boolean;
}

export interface ScoreItem {
  id: string;
  group: string;
  title: string;
  weight: number;
  /** 0..1 */
  score: number;
  verdict: 'PASS' | 'PARTIAL' | 'FAIL' | 'NA';
  detail: string;
  ref: string;
}

export interface AssessmentResult {
  total: number;
  max: number;
  pct: number;
  items: ScoreItem[];
  groups: { group: string; pct: number; weight: number }[];
}

export interface DecisionRecord {
  key: string;
  time: number;
  title: string;
  option: string;
  optionText: string;
  preplanned: string;
  score: number;
  verdict: 'BEST' | 'ACCEPTABLE' | 'POOR' | 'WRONG';
  rationale: string;
  ref: string;
}

export interface WargameSummary {
  seed: number;
  result: 'HELD' | 'PARTIAL' | 'LOST';
  resultText: string;
  ownCas: number;
  ownStart: number;
  enCas: number;
  enStart: number;
  tanksKilled: number;
  tanksStart: number;
  localitiesLost: number;
  vitalHeld: boolean;
  endTime: number;
}

export interface WargameRecord {
  summary: WargameSummary;
  decisions: DecisionRecord[];
  orders: { time: number; text: string }[];
  log: { time: number; text: string; level: 'info' | 'warn' | 'crit' | 'good' }[];
  assessment: AssessmentResult;
  /** Compact frames for the AAR replay. */
  frames: ReplayFrame[];
  enemyPlanText: string[];
  units: { id: string; sidc: string; label: string; side: Side; start: number }[];
  causes: Record<Side, Record<string, number>>;
  enemyPlan?: { faa: Vec; fup: Vec; bof: Vec; faaName: string; fupName: string; bofName: string; approach: Vec[]; objectives: { pos: Vec; name: string; phase: number }[] };
}

export interface ReplayFrame {
  t: number;
  /** [id, x, y, strengthPct, stateCode] */
  u: [string, number, number, number, number][];
  /** Fire events since last frame: [fromX, fromY, toX, toY, kind] */
  f: [number, number, number, number, number][];
}

export interface Attempt {
  id: string;
  exerciseId: string;
  studentId: string;
  scenarioId: string;
  status: 'PLANNING' | 'SUBMITTED' | 'COMPLETE';
  plan: Plan;
  startedAt: number;
  submittedAt?: number;
  completedAt?: number;
  planAssessment?: AssessmentResult;
  wargame?: WargameRecord;
  finalPct?: number;
  grade?: string;
  remarks?: string;
  instructorAdj?: number;
}

export interface AppSettings {
  id: 'settings';
  institution: string;
  instructorHash: string;
  instructorName: string;
  createdAt: number;
}

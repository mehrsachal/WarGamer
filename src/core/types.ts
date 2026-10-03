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
  /**
   * Frame of the procedural micro-relief (undulation and dune noise): seed and the world point
   * used as its origin. Absent = derived from the extent at origin (0,0). A preset whose sheet was
   * widened keeps its old frame here so the original ground (and the wargame balance) is unchanged.
   */
  noise?: { seed: string; origin: Vec };
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
  /** Geometry version of a preset (bumped when its map frame changes; attempts made on an older version are migrated). */
  version?: number;
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
  /** Parent locality this weapon/detachment is grouped with (also the locality an SP/LP/detachment is found from). */
  parentId?: string;
  notes?: string;
  /**
   * Area occupied (goose egg), as closed outline control points in world metres; drawn as a smooth
   * closed curve. Absent = a default egg sized from the template is used.
   */
  area?: Vec[];
  /** Personnel override (split elements, detachments). Absent = template strength. */
  strength?: number;
  /** Id of the unit this element was split (divided) from; its strength is deducted from that unit. */
  splitFrom?: string;
  /** Task-organisation group this unit belongs to. */
  groupId?: string;
}

/** A task-organisation grouping of placed units (e.g. "2 Pl Gp" = 2 Pl + RR det + GL). */
export interface PlanGroup {
  id: string;
  label: string;
  memberIds: string[];
  echelon?: Echelon;
  /** Optional outline enclosing the group (goose egg); absent = hull of the members. */
  area?: Vec[];
}

/**
 * Semantic kind of a graphic. The first group is read by the plan assessment; the second group is
 * free drawing (a FREE/AREA/ARROW shape can be re-tagged to a semantic kind at any time).
 */
export type GraphicKind =
  | 'FDL'
  | 'KILL_AREA'
  | 'MINEFIELD'
  | 'WIRE'
  | 'DF'
  | 'CATK'
  | 'CPEN'
  | 'QC_AREA'
  | 'PTL_ROUTE'
  | 'NOTE'
  | 'FREE'
  | 'AREA'
  | 'ARROW'
  | 'TEXT'
  | 'PHASE_LINE'
  | 'BOUNDARY'
  | 'OBSTACLE'
  | 'TRP'
  | 'SYMBOL';

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
    /** Free-drawing style. */
    color?: 'BLUE' | 'RED' | 'BLACK' | 'GREEN' | 'PURPLE' | 'AMBER';
    dash?: boolean;
    width?: number;
    closed?: boolean;
    smooth?: boolean;
    fill?: boolean;
    /** SIDC for SYMBOL graphics (point symbols placed freely). */
    sidc?: string;
    /** Rotation in degrees for TEXT / SYMBOL. */
    rot?: number;
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
  /**
   * Ties / partial orderings: rank number per position of the ordered list (equal numbers =
   * equal priority). Absent = strict order 1, 2, 3 …
   */
  rankTies?: Partial<Record<'approachOrder' | 'itgOrder' | 'lineOrder' | 'priorityOfWork', number[]>>;
  /** Optional justification per choice (approachOrder, itgOrder, lineOrder, fdlLine, enMostLikelyApproach, bias, priorityOfWork). */
  why?: Record<string, string>;
}

export interface ContingencyChoice {
  /** Primary option id (kept for compatibility; the first selected action). */
  option: string;
  /** All selected actions (composable response). */
  actions?: string[];
  /** Free-text course of action / rationale in the student's own words. */
  text?: string;
  unitId?: string;
  delayMin?: number;
  /** Pre-selected DF to fire (for DF actions). */
  dfId?: string;
}
export type ContingencyPlan = Record<string, ContingencyChoice>;

/** A contingency the student adds themselves (trigger + response). */
export interface CustomContingency {
  id: string;
  /** Trigger category from the catalogue, or 'OTHER'. */
  trigger: string;
  /** Situation in the student's words. */
  situation: string;
  actions: string[];
  text: string;
}

export interface Plan {
  units: PlacedUnit[];
  graphics: PlanGraphic[];
  appreciation: Appreciation;
  contingency: ContingencyPlan;
  /** QC sortie windows planned in advance (exercise minutes). */
  qcSorties: { start: number; areaId: string }[];
  updatedAt: number;
  groups?: PlanGroup[];
  customContingencies?: CustomContingency[];
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
  /** Marking configuration (flexibility). Absent = STANDARD with default weights. */
  marking?: MarkingConfig;
}

export interface MarkingConfig {
  strictness: 'LENIENT' | 'STANDARD' | 'STRICT';
  /** Multipliers per rubric group (1 = default). */
  groupWeights?: Record<string, number>;
  /** Rubric item ids switched off by the instructor. */
  disabled?: string[];
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
  /** Performance band shown to the student (graded marking). */
  band?: 'EXCELLENT' | 'GOOD' | 'ADEQUATE' | 'NEEDS_WORK';
  /** What to improve (doctrinal advice), shown when the item is not excellent. */
  tip?: string;
  /** Automatic score before an instructor override. */
  auto?: number;
  /** Instructor override of this item. */
  override?: { score: number; note?: string };
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
  /** Composed actions and free text, when the response was not a single option. */
  actions?: string[];
  text?: string;
  /** Short note from the AI umpire, if AI marking was used. */
  aiNote?: string;
  /** Where the response came from (modal, pre-planned contingency, orders on the map, AI). */
  source?: 'MODAL' | 'PREPLANNED' | 'MAP' | 'AI' | 'SOP';
  /** The response differs from the student's contingency plan. */
  changed?: boolean;
  /** Not marked (an inject-only situation the student could not pre-plan, handled by SOP in auto mode). */
  unmarked?: boolean;
  /** Actions understood from the free text. */
  understood?: string[];
  strengths?: string[];
  gaps?: string[];
  /** Judge note on the free text. */
  textNote?: string;
  /** Judge score (0..1) of the free text used in the score. */
  textScore?: number;
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
  /** LLM usage and AI-made decisions during this battle (absent when AI was off). */
  ai?: AiRecord;
}

export interface AiRecord {
  model: string;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  /** Enemy-commander and radio-net decisions taken by the AI, for the AAR. */
  events: { time: number; who: 'EN_CDR' | 'RADIO' | 'UMPIRE'; text: string }[];
  /** AI mentor debrief text, if requested. */
  mentor?: string;
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
  /** Scenario.version the plan coordinates refer to (absent = version 1 / unversioned). */
  scenarioVersion?: number;
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
  /**
   * Instructor per-item overrides, keyed "plan:<item id>" or "war:<item id>"; applied to the
   * stored assessments and the final score.
   */
  itemOverrides?: Record<string, { score: number; note?: string }>;
}

export interface AppSettings {
  id: 'settings';
  institution: string;
  instructorHash: string;
  instructorName: string;
  createdAt: number;
}

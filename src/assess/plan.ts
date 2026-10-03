// Objective assessment of a defensive plan against ICIB doctrine and the DS appreciation.
//
// The marking is graded, not pass/fail: every item is a measurable check on the marked plan
// (distances, LOS, counts, order) scored on a smooth tolerance curve, and the siting checks
// are principle-based (fields of fire over the approaches, obstacles in front, control of
// ITGs / vital gr, mutual support measured edge-to-edge between the localities' areas,
// depth, all-round def, concealment) so ANY tactically sound solution earns the marks; the
// match with the DS solution is only one small contributor. Orderings are marked by rank
// correlation (ties and partial orders allowed), free text by the text judge. Two DS
// marking the same plan with the same settings get the same result.
//
// The instructor's MarkingConfig scales the tolerances (strictness), re-weights groups and
// switches items off; per-attempt overrides are applied with applyOverrides().

import { DOCTRINE, REF, WORK_ITEMS } from '../core/doctrine';
import {
  type Vec,
  angleDiff,
  bearing,
  centroid,
  clamp,
  dist,
  distToPolygon,
  distToPolyline,
  pointInPolygon,
  polylineIntersection,
  polylineLength,
  resample,
} from '../core/geom';
import type { AssessmentResult, MarkingConfig, OpsLevel, Plan, PlacedUnit, PlanGraphic, ScoreItem, Scenario } from '../core/types';
import { TEMPLATES, WEAPONS } from '../core/units';
import { CONTINGENCIES, choiceActions, choicePlanned } from '../plan/contingency';
import { workload } from '../plan/plan';
import { terrainFor } from '../terrain/terrain';
import { evaluateCustom, evaluateResponse, textRequest, type DecisionContext } from './decisions';
import { getTextJudge, offlineJudgement, type TextJudgement, type TextJudgeRequest } from './textJudge';

interface LevelNorms {
  locKey: string;
  locName: string;
  spacing: [number, number];
  depth: [number, number];
  frontage: [number, number];
  spAhead: [number, number] | null;
  lpAhead: [number, number] | null;
  screenAhead: [number, number] | null;
  screenSpace: number;
  catkMax: number;
  chqBehind: [number, number];
  ka: [number, number];
  mfdMax: number;
  vitalR: number;
  k: number;
}

export const NORMS: Record<OpsLevel, LevelNorms> = {
  PL: { locKey: 'RIFLE_SEC', locName: 'sec', spacing: [50, 260], depth: [60, 300], frontage: [200, 520], spAhead: null, lpAhead: [250, 500], screenAhead: null, screenSpace: 500, catkMax: 350, chqBehind: [20, 250], ka: [60, 450], mfdMax: 300, vitalR: 200, k: 0.5 },
  COY: { locKey: 'RIFLE_PL', locName: 'pl', spacing: [300, 1000], depth: [300, 1300], frontage: [800, 1700], spAhead: DOCTRINE.standingPtlRange as unknown as [number, number], lpAhead: DOCTRINE.lpRange as unknown as [number, number], screenAhead: [600, 3200], screenSpace: 1500, catkMax: 1300, chqBehind: [150, 1100], ka: [100, 650], mfdMax: DOCTRINE.protMfdMaxAhead, vitalR: 300, k: 1 },
  BN: { locKey: 'RIFLE_COY', locName: 'coy', spacing: [800, 2600], depth: [700, 2800], frontage: [2500, 5500], spAhead: [1000, 3200], lpAhead: null, screenAhead: [1500, 5500], screenSpace: 3000, catkMax: 3200, chqBehind: [800, 3500], ka: [200, 1200], mfdMax: 700, vitalR: 600, k: 2.2 },
  BDE: { locKey: 'INF_BN', locName: 'bn', spacing: [2000, 6500], depth: [1500, 6500], frontage: [6000, 14000], spAhead: [2000, 6000], lpAhead: null, screenAhead: [3000, 10000], screenSpace: 5000, catkMax: 7000, chqBehind: [2000, 8000], ka: [400, 2500], mfdMax: 1500, vitalR: 1200, k: 4 },
};

const AT_KEYS = new Set(['RR_DET', 'BS_DET', 'ATGM_PL']);

// ---------------------------------------------------------------------------- rubric catalogue

/** Rubric groups in display order. */
export const GROUPS = ['Appreciation', 'Siting of localities', 'Siting of wpns', 'Obs plan', 'Fire plan', 'Surv & security', 'C attk & C2', 'Contingency plan', 'Time & space'] as const;

/** All rubric items (for the instructor's marking settings). Titles are generic. */
export const RUBRIC: { id: string; group: string; title: string }[] = [
  ['APCH_PRI', 'Appreciation', 'Pri of apchs'],
  ['EN_MLA', 'Appreciation', 'En most likely apch (APs)'],
  ['ITG_PRI', 'Appreciation', 'Pri of ITGs'],
  ['LINE_SEL', 'Appreciation', 'Sel of line of def'],
  ['BIAS', 'Appreciation', 'Bias of def / A tk def'],
  ['POW', 'Appreciation', 'Pri of work'],
  ['APRC_TEXT', 'Appreciation', 'Written deductions'],
  ['FWD', 'Siting of localities', 'Def as far fwd as tac feasible'],
  ['SCREEN_SPACE', 'Siting of localities', 'Space left for screens'],
  ['VITAL', 'Siting of localities', 'Vital gr held'],
  ['GROUND', 'Siting of localities', 'Localities on tac gr'],
  ['APCH_COVER', 'Siting of localities', 'Apchs covered by fire'],
  ['APCH_SPLIT', 'Siting of localities', 'Resp of an apch not divided'],
  ['MUTUAL', 'Siting of localities', 'Mutual sp b/w localities'],
  ['DEPTH', 'Siting of localities', 'Depth'],
  ['TWO_UP', 'Siting of localities', 'Layout (two up / secs up)'],
  ['FRONTAGE', 'Siting of localities', 'Frontage'],
  ['IN_AOR', 'Siting of localities', 'Within given bdrys'],
  ['FOF', 'Siting of localities', 'F of F of fwd localities'],
  ['ALT', 'Siting of localities', 'Altn posns (all-round def)'],
  ['CONCEAL', 'Siting of localities', 'Cover & concealment'],
  ['DS_MATCH', 'Siting of localities', 'Agreement with the DS line (guide)'],
  ['AT_APCH', 'Siting of wpns', 'A tk wpns cover the most likely tk apch'],
  ['AT_OBLIQUE', 'Siting of wpns', 'A tk fire oblique / enfilade'],
  ['AT_PROT', 'Siting of wpns', 'A tk wpns protected / defiladed'],
  ['AT_DEPTH', 'Siting of wpns', 'Depth in A tk def'],
  ['MG_SITING', 'Siting of wpns', 'MG / GLHMG cover the most dangerous apch'],
  ['MORS', 'Siting of wpns', 'Mors in depth / defilade'],
  ['MFD', 'Obs plan', 'Mfds planned'],
  ['MFD_COVER', 'Obs plan', 'Obs covered by fire'],
  ['MFD_APCH', 'Obs plan', 'Obs across the most likely apch'],
  ['OBS_FRONT', 'Obs plan', 'Obs in front of the localities'],
  ['MFD_RES', 'Obs plan', 'Mfds within mines aval'],
  ['WIRE', 'Obs plan', 'Wire outside grenade rg'],
  ['SOS', 'Fire plan', 'DF (SOS) on the most vulnerable apch'],
  ['DF_TGTS', 'Fire plan', 'DFs on likely FAA / FUP / BOF'],
  ['DF_COUNT', 'Fire plan', 'No of DFs'],
  ['KA', 'Fire plan', 'Pri killing area'],
  ['SP', 'Surv & security', 'Standing ptl on the likely FUP / apch'],
  ['LP', 'Surv & security', 'LPs fwd of the localities (ni)'],
  ['OBS', 'Surv & security', 'Obsrs on vantage pts'],
  ['QC', 'Surv & security', 'QC surv plan'],
  ['SCREEN', 'Surv & security', 'Loc of screens'],
  ['CATK', 'C attk & C2', 'C attk plan'],
  ['CATK_PRI', 'C attk & C2', 'C attk objs in order of pri'],
  ['CATK_FORCE', 'C attk & C2', 'C attk force earmarked (depth)'],
  ['CATK_ROUTE', 'C attk & C2', 'C attk route & distance'],
  ['CPEN', 'C attk & C2', 'C pen posn'],
  ['CHQ', 'C attk & C2', 'Loc of HQ'],
  ['CP', 'C attk & C2', 'CP in FDLs with view'],
  ['CTRL', 'C attk & C2', 'Control measures (bdrys / PLs)'],
  ...CONTINGENCIES.map((d) => [`CONT_${d.key}`, 'Contingency plan', d.title] as [string, string, string]),
  ['CONT_CUSTOM', 'Contingency plan', 'Own contingencies'],
  ['READY', 'Time & space', 'Def ready by the given time'],
  ['RES_USED', 'Time & space', 'All resources employed'],
].map(([id, group, title]) => ({ id, group, title }));

/** Doctrinal advice shown when an item is not excellent. */
const TIPS: Record<string, string> = {
  APCH_PRI: 'Rank the apchs by how well they suit the en (going, cover, length, obs, capacity) — the most likely first.',
  EN_MLA: 'Deduce the en’s most likely apch from his doctrine (Sec 114) and the gr.',
  ITG_PRI: 'Pick the gr that dominates the apchs and gives obsn deep into the en area first.',
  LINE_SEL: 'Select the line that holds the vital gr, dominates the apchs and leaves room for screens.',
  BIAS: 'Bias the def (and the A tk wpns) towards the most likely tk apch.',
  POW: 'Normal pri: protection & surv, RR/MG siting, F of F, digging, line comms, obs …',
  APRC_TEXT: 'Record your deductions in writing — each deduction should lead to a "so what" for your plan.',
  FWD: 'Take up the def as far fwd as tac feasible, leaving enough gr in front for the screens.',
  SCREEN_SPACE: 'Leave gr in front of the FDLs for the screens to fight a delaying battle.',
  VITAL: 'The vital gr must be held — its loss makes the def untenable.',
  GROUND: 'Site localities on tac gr: ITGs, high gr with obsn, or cover — not in the open low gr.',
  APCH_COVER: 'Every apch must be covered by direct fire from the localities over its killing area.',
  APCH_SPLIT: 'Make each apch the clear resp of one locality; do not let a bdry run down an apch.',
  MUTUAL: 'Localities must be close enough to cover the gaps between them by fire (mutual sp).',
  DEPTH: 'Keep a locality in depth to stop a penetration and to C attk.',
  TWO_UP: 'Two up, one in depth gives frontage and depth; at pl lvl, secs are usually three up.',
  FRONTAGE: 'Match the frontage to the sub-unit (Sec 72 para 6c).',
  IN_AOR: 'Stay within the given bdrys (screens / SPs excepted).',
  FOF: 'Site fwd localities where they have 270-500 m clear F of F to the front.',
  ALT: 'Prepare altn posns 200+ m away so the locality can fight in any direction.',
  CONCEAL: 'Use the cover and concealment the gr offers (woods, BUAs, reverse slopes).',
  DS_MATCH: 'A guide only: the DS sited the FDLs on the recommended line.',
  AT_APCH: 'Site the A tk wpns within effective rg of the most likely tk apch.',
  AT_OBLIQUE: 'A tk wpns should engage tks obliquely / in enfilade, not head-on.',
  AT_PROT: 'Protect A tk wpns inside a locality or in defilade.',
  AT_DEPTH: 'Site some A tk wpns in depth.',
  MG_SITING: 'Site MGs / GLHMG to cover the most dangerous apch, preferably in enfilade.',
  MORS: 'Site mors in depth and in defilade, within rg of their DFs.',
  MFD: 'Use the mines aval: protective mfds in front of the localities, A tk mfd across the tk apch.',
  MFD_COVER: 'Every obstacle must be covered by fire (protective by small arms, A tk by A tk wpns).',
  MFD_APCH: 'Obstruct the most likely apch.',
  OBS_FRONT: 'Put obstacles in front of the fwd localities, within small-arms rg.',
  MFD_RES: 'Plan mfds within the mines aval.',
  WIRE: 'Wire 35-150 m in front of the posts — outside grenade rg, inside small-arms rg.',
  SOS: 'One DF (SOS) per fire unit on the most vulnerable apch, 150-600 m in front of the FDLs.',
  DF_TGTS: 'Pick up the likely FAA, FUP and BOF as DFs.',
  DF_COUNT: 'About six DFs per fire unit.',
  KA: 'Mark the pri killing area on the most likely apch, covered by several posns with LOS.',
  SP: 'Push a standing ptl fwd to watch the likely FUP and to mount a spoiling attk by fire.',
  LP: 'Post LPs ahead of the fwd localities by ni.',
  OBS: 'Site the obsrs on vantage pts with LOS to their DFs.',
  QC: 'Plan QC surv over the likely FUP / FAA, especially at the critical evening / ni.',
  SCREEN: 'Site the screens on gr that denies the en close obsn of the main posn.',
  CATK: 'Integrate the C attk plan from the start.',
  CATK_PRI: 'Pri 1 C attk obj: the locality on the most likely apch.',
  CATK_FORCE: 'Earmark the depth sub-unit as the C attk force.',
  CATK_ROUTE: 'Plan a covered route onto a flank of the penetration, launchable within 30 min.',
  CPEN: 'Plan a C pen posn to check a penetration.',
  CHQ: 'Site the HQ in depth, covered, near the main route.',
  CP: 'Site the CP in the FDLs where it sees the apchs.',
  CTRL: 'Bdrys must not run along an apch; PLs / TRPs help control the battle.',
  CONT_CUSTOM: 'Your own contingencies should describe a realistic situation and a sound, complete response.',
  READY: 'Balance the work (obs, altn posns) against the time aval.',
  RES_USED: 'Employ all the resources allotted.',
};

// ---------------------------------------------------------------------------- scoring helpers

export type Band = NonNullable<ScoreItem['band']>;

export function bandOf(score: number): Band {
  return score >= 0.85 ? 'EXCELLENT' : score >= 0.65 ? 'GOOD' : score >= 0.45 ? 'ADEQUATE' : 'NEEDS_WORK';
}

export const BAND_LABEL: Record<Band, string> = { EXCELLENT: 'Excellent', GOOD: 'Good', ADEQUATE: 'Adequate', NEEDS_WORK: 'Needs work' };

/** A rubric item (also used by the battle assessment). */
export function scoreItem(id: string, group: string, title: string, weight: number, score: number, detail: string, ref: string, na = false): ScoreItem {
  const s = na ? 0 : clamp(score, 0, 1);
  return {
    id,
    group,
    title,
    weight: na ? 0 : weight,
    score: s,
    verdict: na ? 'NA' : s >= 0.8 ? 'PASS' : s >= 0.4 ? 'PARTIAL' : 'FAIL',
    detail,
    ref,
    band: na ? undefined : bandOf(s),
    tip: na || s >= 0.85 ? undefined : TIPS[id] ?? (id.startsWith('CONT_') ? 'Compose a complete response: fire, manoeuvre, protection, C2 / reporting and admin.' : undefined),
  };
}

const smoothstep = (t: number) => {
  const x = clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
};

/** Strictness: tolerance multiplier and score exponent. */
const STRICT = { LENIENT: { tol: 1.45, exp: 0.85 }, STANDARD: { tol: 1, exp: 1 }, STRICT: { tol: 0.7, exp: 1.2 } } as const;

/**
 * Graded tolerance curve: 1 inside [lo, hi]; outside it falls smoothly to 0.5 at `soft`
 * (scaled by strictness) and to 0 at twice that.
 */
function makeBand(tol: number) {
  return (v: number, lo: number, hi: number, soft: number): number => {
    if (v >= lo && v <= hi) return 1;
    const off = v < lo ? lo - v : v - hi;
    return 1 - smoothstep(off / (2 * Math.max(1e-6, soft * tol)));
  };
}

/** Kendall-style agreement between two orderings (1 = identical). Kept for compatibility. */
export function orderAgreement(student: string[], ds: string[]): number {
  const common = ds.filter((x) => student.includes(x));
  if (common.length < 2) return student[0] && student[0] === ds[0] ? 1 : 0;
  let agree = 0;
  let total = 0;
  for (let i = 0; i < common.length; i++) {
    for (let j = i + 1; j < common.length; j++) {
      total++;
      if (student.indexOf(common[i]) < student.indexOf(common[j])) agree++;
    }
  }
  const coverage = common.length / ds.length;
  return (agree / total) * (0.7 + 0.3 * coverage);
}

/**
 * Kendall tau-b between the student's (possibly tied / partial) ranking and the DS ranking
 * over the DS items. Items the student did not rank count as tied after the ranked ones.
 */
export function kendallTauB(order: string[], ranks: number[] | undefined, dsRank: Record<string, number>): number {
  const items = Object.keys(dsRank);
  if (items.length < 2) return order[0] === items[0] ? 1 : 0;
  const sr: Record<string, number> = {};
  order.forEach((id, i) => (sr[id] = ranks?.[i] ?? i + 1));
  const last = Math.max(0, ...Object.values(sr)) + 1;
  let c = 0;
  let d = 0;
  let tS = 0;
  let tD = 0;
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const a = sr[items[i]] ?? last;
      const b = sr[items[j]] ?? last;
      const x = dsRank[items[i]];
      const y = dsRank[items[j]];
      const ds = Math.sign(a - b);
      const dd = Math.sign(x - y);
      if (ds === 0 && dd === 0) continue;
      if (ds === 0) tS++;
      else if (dd === 0) tD++;
      else if (ds === dd) c++;
      else d++;
    }
  }
  const den = Math.sqrt((c + d + tS) * (c + d + tD));
  return den ? (c - d) / den : 0;
}

/** Ranks per position from rankTies (normalised to dense ranks). */
function ranksOf(order: string[], ties?: number[]): number[] {
  if (!ties || ties.length !== order.length) return order.map((_, i) => i + 1);
  return ties;
}

// ---------------------------------------------------------------------------- locality geometry

interface Loc {
  u: PlacedUnit;
  /** Centre of the occupied area. */
  c: Vec;
  /** Outline (area or default egg). */
  poly: Vec[];
  /** Equivalent radius. */
  r: number;
  /** Share of a full sub-unit (split elements count partially). */
  w: number;
}

function circle(c: Vec, r: number, n = 16): Vec[] {
  const out: Vec[] = [];
  for (let i = 0; i < n; i++) out.push({ x: c.x + Math.cos((2 * Math.PI * i) / n) * r, y: c.y + Math.sin((2 * Math.PI * i) / n) * r });
  return out;
}

function locOf(u: PlacedUnit): Loc {
  const tpl = TEMPLATES[u.templateKey];
  const w = tpl ? clamp((u.strength ?? tpl.personnel) / Math.max(1, tpl.personnel), 0.1, 1) : 1;
  if (u.area && u.area.length >= 3) {
    const c = centroid(u.area);
    const r = Math.max(10, u.area.reduce((m, p) => m + dist(p, c), 0) / u.area.length);
    return { u, c, poly: u.area, r, w };
  }
  const r = tpl?.radius ?? 50;
  return { u, c: u.pos, poly: circle(u.pos, r), r, w };
}

/** Edge-to-edge distance between two localities (0 if they overlap). */
function edgeDist(a: Loc, b: Loc): number {
  if (pointInPolygon(a.c, b.poly) || pointInPolygon(b.c, a.poly)) return 0;
  let m = Infinity;
  for (const p of a.poly) m = Math.min(m, distToPolygon(p, b.poly));
  for (const p of b.poly) m = Math.min(m, distToPolygon(p, a.poly));
  return m;
}

/** Point of the outline nearest to p (where a locality fires from). */
function edgeToward(l: Loc, p: Vec): Vec {
  let best = l.c;
  let bd = Infinity;
  for (const q of l.poly) {
    const d = dist(q, p);
    if (d < bd) {
      bd = d;
      best = q;
    }
  }
  // fire from just inside the edge
  return { x: best.x + (l.c.x - best.x) * 0.15, y: best.y + (l.c.y - best.y) * 0.15 };
}

/** Semantic kind of a graphic: free shapes count when tagged by their label. */
export function semanticKind(g: PlanGraphic): PlanGraphic['kind'] {
  if (g.kind !== 'FREE' && g.kind !== 'AREA' && g.kind !== 'ARROW' && g.kind !== 'TEXT') return g.kind;
  const t = `${g.props.label ?? ''} ${g.props.text ?? ''}`.toLowerCase();
  if (g.kind === 'TEXT') return 'TEXT';
  if (/\bka\b|kill(ing)? (area|zone)/.test(t)) return 'KILL_AREA';
  if (/\bc ?attk\b|counter[- ]?attack/.test(t)) return 'CATK';
  if (/\bc ?pen\b|counter[- ]?pen/.test(t)) return 'CPEN';
  if (/\bmfd\b|mine/.test(t)) return 'MINEFIELD';
  if (/\bwire\b/.test(t)) return 'WIRE';
  if (/\bobs(tacle)?\b|ditch|abatis/.test(t)) return 'OBSTACLE';
  if (/\bqc\b/.test(t)) return 'QC_AREA';
  return g.kind;
}

export interface PlanGeometry {
  fdlLine: Vec[];
  fdlYAt: (x: number) => number;
  fwd: PlacedUnit[];
  depth: PlacedUnit[];
  locs: PlacedUnit[];
}

export function planGeometry(s: Scenario, plan: Plan): PlanGeometry {
  const n = NORMS[s.level];
  const locs = plan.units.filter((u) => u.templateKey === n.locKey && (u.role === 'FDL' || u.role === 'DEPTH' || u.role === 'RES'));
  let fwd = locs.filter((u) => u.role === 'FDL');
  let depth = locs.filter((u) => u.role === 'DEPTH' || u.role === 'RES');
  if (!fwd.length && locs.length) {
    const maxY = Math.max(...locs.map((u) => locOf(u).c.y));
    fwd = locs.filter((u) => locOf(u).c.y > maxY - n.depth[0]);
    depth = locs.filter((u) => !fwd.includes(u));
  }
  const g = plan.graphics.find((x) => x.kind === 'FDL' && x.pts.length >= 2);
  const line = g ? [...g.pts].sort((a, b) => a.x - b.x) : fwd.map((u) => locOf(u).c).sort((a, b) => a.x - b.x);
  const fdlYAt = (x: number) => {
    if (!line.length) return s.terrain.height / 2;
    if (line.length === 1 || x <= line[0].x) return line[0].y;
    for (let i = 1; i < line.length; i++) if (x <= line[i].x) {
      const a = line[i - 1];
      const b = line[i];
      return a.y + ((b.y - a.y) * (x - a.x)) / Math.max(1, b.x - a.x);
    }
    return line[line.length - 1].y;
  };
  return { fdlLine: line, fdlYAt, fwd, depth, locs };
}

// ---------------------------------------------------------------------------- free text

const APRC_FIELDS: { key: string; label: string }[] = [
  { key: 'ground', label: 'Gr & weather — deductions' },
  { key: 'enemy', label: 'En sit — options aval to en' },
  { key: 'own', label: 'Own sit — str and tps to task' },
  { key: 'timeSpace', label: 'Time & space — deductions' },
  { key: 'courses', label: 'Courses — analysis' },
  { key: 'plan', label: 'Plan (outline)' },
];

const WHY_FIELDS = ['approachOrder', 'itgOrder', 'lineOrder', 'fdlLine', 'enMostLikelyApproach', 'bias', 'priorityOfWork'] as const;

/** All free-text items of a plan that the text judge marks. */
export function planTextRequests(s: Scenario, plan: Plan): TextJudgeRequest[] {
  const ds = s.ds;
  const pri = [...ds.approaches].sort((a, b) => a.pri - b.pri);
  const a1 = pri[0];
  const itgs = [...ds.itgs].sort((a, b) => a.pri - b.pri);
  const rec = ds.linesOfDef.find((l) => l.id === ds.recommendedFdl);
  const dep = ds.linesOfDef.find((l) => l.id === ds.recommendedDepth);
  const faa = ds.likelyFAAs.find((f) => f.approachId === a1?.id) ?? ds.likelyFAAs[0];
  const fup = ds.likelyFUPs.find((f) => f.approachId === a1?.id) ?? ds.likelyFUPs[0];
  const bof = ds.likelyBOFs[0];
  const vital = itgs.find((i) => i.vital);
  const kp: Record<string, string[]> = {
    ground: [...pri.slice(0, 3).map((a) => `${a.name} ${a.tankGoing} tk going`), `${itgs[0]?.name ?? ''} dominates the apchs`, vital ? `${vital.name} is vital gr` : 'vital gr', 'obstacles and killing areas', 'cover and concealment, fields of fire'],
    enemy: [`en most likely to attack along the ${a1?.name ?? ''}`, faa ? `FAA ${faa.name}` : 'FAA', fup ? `FUP ${fup.name}` : 'FUP', bof ? `BOF ${bof.name}` : 'BOF', s.enemy.attackAtNight ? 'attack by night after last light' : 'attack by day', 'attack in two phases with tanks'],
    own: ['relative strength of own troops to enemy', 'tasks to troops', 'two up one in depth', 'fire support and obstacles available'],
    timeSpace: ['priority of work', 'defence ready by the given time', 'activities done concurrently', 'time for obstacles and alternate positions'],
    courses: ['course A and course B', 'advantages and disadvantages', 'enemy reactions and own counter actions', 'selected course and why'],
    plan: [rec ? `FDLs on ${rec.name}` : 'FDLs', dep ? `depth on ${dep.name}` : 'depth locality', `bias towards the ${a1?.flank === 'L' ? 'left' : a1?.flank === 'R' ? 'right' : 'centre'}`, 'counter attack by the depth sub-unit', `DF SOS on the ${a1?.name ?? 'most likely approach'}`, 'screens and standing patrol'],
  };
  const out: TextJudgeRequest[] = [];
  for (const f of APRC_FIELDS) {
    const answer = plan.appreciation.text[f.key]?.trim();
    if (answer) out.push({ id: `APRC_${f.key}`, task: f.label, situation: `${s.title}: defence by ${s.own.formation}.`, keyPoints: kp[f.key], answer });
  }
  const why = plan.appreciation.why ?? {};
  const whyKp: Record<string, string[]> = {
    approachOrder: pri.flatMap((a) => a.notes.slice(0, 2)).slice(0, 5),
    itgOrder: itgs.slice(0, 4).map((i) => `${i.name}${i.notes ? `: ${i.notes}` : ''}`),
    lineOrder: ds.linesOfDef.map((l) => l.name).slice(0, 4),
    fdlLine: ds.notes.slice(0, 4),
    enMostLikelyApproach: a1 ? [a1.name, ...a1.notes.slice(0, 3)] : [],
    bias: [`bias to the ${a1?.flank === 'L' ? 'left' : a1?.flank === 'R' ? 'right' : 'centre'}`, 'most likely tank approach', 'anti-tank weapons'],
    priorityOfWork: ['protection and surveillance first', 'site RRs and MGs', 'clear fields of fire', 'dig trenches'],
  };
  for (const k of WHY_FIELDS) {
    const answer = why[k]?.trim();
    if (answer && whyKp[k]?.length) out.push({ id: `WHY_${k}`, task: `Justify your choice (${k})`, situation: s.title, keyPoints: whyKp[k], answer });
  }
  for (const d of CONTINGENCIES) {
    const t = plan.contingency[d.key]?.text?.trim();
    if (t) out.push(textRequest(`CONT_${d.key}`, d.key, t));
  }
  for (const c of plan.customContingencies ?? []) {
    const t = `${c.situation ?? ''}\n${c.text ?? ''}`.trim();
    if (t) out.push(c.trigger !== 'OTHER' ? textRequest(`CUST_${c.id}`, c.trigger, c.text || c.situation, c.situation) : { id: `CUST_${c.id}`, task: 'Own contingency', situation: c.situation, keyPoints: ['report to higher HQ', 'covered by fire / obsn', 'keep the depth sub-unit for the C attk', 'hold the posn', 'cas evac and amn', 'warn the localities'], answer: t });
  }
  return out;
}

export interface AssessOptions {
  marking?: MarkingConfig;
  /** Judgements of the free-text items by id (from planTextRequests); absent = offline judge. */
  judgements?: Map<string, TextJudgement | null>;
}

/** Async variant used on submission: the registered text judge (AI when configured) marks the free text. */
export async function assessPlanAsync(s: Scenario, plan: Plan, opts: AssessOptions = {}): Promise<AssessmentResult> {
  const reqs = planTextRequests(s, plan);
  const judgements = new Map<string, TextJudgement | null>();
  if (reqs.length) {
    try {
      const res = await getTextJudge().judge(reqs);
      reqs.forEach((r, i) => judgements.set(r.id, res[i] ?? offlineJudgement(r)));
    } catch {
      reqs.forEach((r) => judgements.set(r.id, offlineJudgement(r)));
    }
  }
  return assessPlan(s, plan, { ...opts, judgements });
}

// ---------------------------------------------------------------------------- assessment

export function assessPlan(s: Scenario, plan: Plan, opts: AssessOptions = {}): AssessmentResult {
  const t = terrainFor(s.id, s.terrain, s.weather.going === 'wet');
  const n = NORMS[s.level];
  const ds = s.ds;
  const lvl = s.level;
  const strict = STRICT[opts.marking?.strictness ?? 'STANDARD'];
  const band = makeBand(strict.tol);
  const items: ScoreItem[] = [];
  const item = scoreItem;
  const judge = (r: TextJudgeRequest | undefined): TextJudgement | null => (r ? (opts.judgements?.has(r.id) ? opts.judgements.get(r.id)! : offlineJudgement(r)) : null);
  const reqs = new Map(planTextRequests(s, plan).map((r) => [r.id, r]));
  const why = (k: string) => judge(reqs.get(`WHY_${k}`));
  const withWhy = (base: number, k: string): [number, string] => {
    const j = why(k);
    if (!j) return [base, ''];
    return [Math.min(1, base + (base < 1 ? 0.12 * j.score : 0)), ` Justification: ${j.note}`];
  };
  const G = planGeometry(s, plan);
  const { fwd, depth, locs, fdlYAt } = G;
  const L = new Map(plan.units.map((u) => [u.id, locOf(u)]));
  const lo = (u: PlacedUnit) => L.get(u.id)!;
  const pri = [...ds.approaches].sort((a, b) => a.pri - b.pri);
  const a1 = pri[0];
  const ahead = (p: Vec) => p.y - fdlYAt(p.x);
  const units = (key: string) => plan.units.filter((u) => u.templateKey === key);
  const byRole = (r: string) => plan.units.filter((u) => u.role === r);
  const gfx = plan.graphics.map((g) => ({ g, kind: semanticKind(g) }));
  const graphics = (...kinds: string[]) => gfx.filter((x) => kinds.includes(x.kind)).map((x) => x.g);
  const recLine = ds.linesOfDef.find((l) => l.id === ds.recommendedFdl);
  const recY = recLine ? recLine.pts.reduce((m, p) => m + p.y, 0) / recLine.pts.length : undefined;
  const aorFront = Math.max(...s.own.aor.map((p) => p.y));
  const app = plan.appreciation;
  const crossing = (a: typeof a1): Vec => {
    if (G.fdlLine.length >= 2) {
      const ext = [{ x: G.fdlLine[0].x - 2000, y: G.fdlLine[0].y }, ...G.fdlLine, { x: G.fdlLine[G.fdlLine.length - 1].x + 2000, y: G.fdlLine[G.fdlLine.length - 1].y }];
      const x = polylineIntersection(a.path, ext);
      if (x) return x;
    }
    const pts = resample(a.path, 25);
    return pts.reduce((b, p) => (Math.abs(ahead(p)) < Math.abs(ahead(b)) ? p : b), pts[0]);
  };
  const effCount = (us: PlacedUnit[]) => us.reduce((m, u) => m + lo(u).w, 0);

  // ================================================================ A. Appreciation
  {
    const g = 'Appreciation';
    const nm = (id: string) => ds.approaches.find((a) => a.id === id)?.name ?? id;
    const dsA: Record<string, number> = Object.fromEntries(pri.map((a) => [a.id, a.pri]));
    if (app.approachOrder.length) {
      const ranks = ranksOf(app.approachOrder, app.rankTies?.approachOrder);
      const tau = kendallTauB(app.approachOrder, ranks, dsA);
      const topRank = Math.min(...ranks);
      const top = app.approachOrder.filter((_, i) => ranks[i] === topRank);
      const topSc = top.includes(a1.id) ? 1 / Math.max(1, top.length) ** 0.5 : app.approachOrder.slice(0, 2).includes(a1.id) ? 0.4 : 0;
      const [sc, wn] = withWhy(0.6 * clamp((tau + 0.2) / 1.2, 0, 1) + 0.4 * topSc, 'approachOrder');
      items.push(item('APCH_PRI', g, 'Pri of apchs', 4, sc, `Your order: ${app.approachOrder.map((id, i) => `${i && ranks[i] === ranks[i - 1] ? '= ' : i ? '> ' : ''}${nm(id)}`).join(' ')}. DS: ${pri.map((a) => a.name).join(' > ')} (rank agreement τ = ${tau.toFixed(2)}).${wn}`, REF.COY_CONSIDERATIONS));
    } else items.push(item('APCH_PRI', g, 'Pri of apchs', 4, 0, 'Pri of apchs not recorded (not credited).', REF.COY_CONSIDERATIONS));

    const mla = app.enMostLikelyApproach;
    const mlaA = ds.approaches.find((a) => a.id === mla);
    const [mlaSc, mlaW] = withWhy(mla === a1.id ? 1 : mlaA ? (mlaA.pri === 2 ? 0.5 : 0.25) : 0, 'enMostLikelyApproach');
    items.push(item('EN_MLA', g, 'En most likely apch (APs)', 2, mla ? mlaSc : 0, mla ? `You assessed the ${mlaA?.name ?? mla}; DS: ${a1.name}.${mlaW}` : 'En most likely apch not recorded (not credited).', REF.FOXLAND_ATTACK));

    const itgSorted = [...ds.itgs].sort((a, b) => a.pri - b.pri);
    const dsI: Record<string, number> = Object.fromEntries(itgSorted.map((i) => [i.id, i.pri]));
    if (app.itgOrder.length) {
      const ranks = ranksOf(app.itgOrder, app.rankTies?.itgOrder);
      const tau = kendallTauB(app.itgOrder, ranks, dsI);
      const top3 = itgSorted.slice(0, 3).map((i) => i.id);
      // DS top-3 gr found in the student's top 3 (full) or top 5 (half)
      const ov = top3.reduce((m, id) => m + (app.itgOrder.slice(0, 3).includes(id) ? 1 : app.itgOrder.slice(0, 5).includes(id) ? 0.5 : 0), 0) / Math.max(1, top3.length);
      const [sc, wn] = withWhy(0.55 * ov + 0.45 * clamp((tau + 0.2) / 1.2, 0, 1), 'itgOrder');
      items.push(item('ITG_PRI', g, 'Pri of ITGs', 3, sc, `Your top 3: ${app.itgOrder.slice(0, 3).map((id) => ds.itgs.find((i) => i.id === id)?.name ?? id.replace('feat:', '')).join(', ')}. DS top 3: ${top3.map((id) => ds.itgs.find((i) => i.id === id)?.name).join(', ')}.${wn}`, REF.COY_CONSIDERATIONS));
    } else items.push(item('ITG_PRI', g, 'Pri of ITGs', 3, 0, 'Pri of ITGs not recorded (not credited).', REF.COY_CONSIDERATIONS));

    const chosen = ds.linesOfDef.find((l) => l.id === app.fdlLine);
    if (chosen) {
      let base: number;
      let d: string;
      if (chosen.id === ds.recommendedFdl) {
        base = 1;
        d = `${chosen.name} — as DS.`;
      } else {
        // merits of the chosen line: room for screens, ITGs (vital gr) it holds, DS pri
        const cy = chosen.pts.reduce((m, p) => m + p.y, 0) / chosen.pts.length;
        const space = band(aorFront - cy, n.screenAhead ? n.screenSpace * 0.7 : 0, 1e9, n.screenSpace * 0.5);
        const vital = ds.itgs.find((i) => i.vital);
        const holdsVital = vital ? (chosen.itgIds.includes(vital.id) ? 1 : 0.4) : 1;
        const priSc = chosen.pri <= 2 ? 1 : chosen.pri === 3 ? 0.6 : 0.35;
        base = 0.85 * (0.4 * space + 0.35 * holdsVital + 0.25 * priSc);
        d = `${chosen.name} (DS: ${recLine?.name ?? '-'}). ${base >= 0.6 ? 'A viable alternative if logically developed.' : 'Less suitable — see the DS deductions.'}`;
      }
      if (app.lineOrder.length >= 2) {
        const tau = kendallTauB(app.lineOrder, ranksOf(app.lineOrder, app.rankTies?.lineOrder), Object.fromEntries(ds.linesOfDef.map((l) => [l.id, l.pri])));
        base = 0.85 * base + 0.15 * clamp((tau + 0.2) / 1.2, 0, 1);
      }
      const [sc, wn] = withWhy(base, 'fdlLine');
      items.push(item('LINE_SEL', g, 'Sel of line of def', 3, sc, d + wn, REF.IE_SOLN));
    } else items.push(item('LINE_SEL', g, 'Sel of line of def', 3, 0, 'Line of FDLs not selected in the aprc (not credited).', REF.IE_SOLN));

    const adj = (a: string, b: string) => (a === 'C' || b === 'C') && a !== b;
    const [bSc, bW] = withWhy(app.bias === a1.flank ? 1 : app.bias && adj(app.bias, a1.flank) ? 0.5 : app.bias ? 0.2 : 0, 'bias');
    items.push(item('BIAS', g, 'Bias of def / A tk def', 1, app.bias ? bSc : 0, `Bias ${app.bias || 'not stated'}; DS ${a1.flank}.${bW}`, REF.IE_SOLN));

    if (app.priorityOfWork.length) {
      const dsP: Record<string, number> = Object.fromEntries(DOCTRINE.priorityOfWork.map((k, i) => [k, i + 1]));
      const tau = kendallTauB(app.priorityOfWork, ranksOf(app.priorityOfWork, app.rankTies?.priorityOfWork), dsP);
      const first = app.priorityOfWork[0] === 'PROTECTION_SURV' ? 1 : app.priorityOfWork.slice(0, 2).includes('PROTECTION_SURV') ? 0.6 : 0.2;
      const [sc, wn] = withWhy(0.7 * clamp((tau + 0.1) / 1.1, 0, 1) + 0.3 * first, 'priorityOfWork');
      items.push(item('POW', g, 'Pri of work', 2, sc, `First items: ${app.priorityOfWork.slice(0, 3).map((k) => WORK_ITEMS[k]?.label ?? k).join('; ')} (τ = ${tau.toFixed(2)}).${wn}`, REF.PRIORITY_OF_WORK));
    } else items.push(item('POW', g, 'Pri of work', 2, 0, 'Pri of work not set (not credited).', REF.PRIORITY_OF_WORK));

    const js = APRC_FIELDS.map((f) => ({ f, j: judge(reqs.get(`APRC_${f.key}`)) }));
    const answered = js.filter((x) => x.j);
    const tsc = js.reduce((m, x) => m + (x.j?.score ?? 0), 0) / APRC_FIELDS.length;
    const src = answered.some((x) => x.j?.source === 'AI') ? 'AI judge' : 'keyword check';
    items.push(item('APRC_TEXT', g, 'Written deductions', 2, Math.min(1, tsc * 1.15), answered.length ? `${answered.length}/${APRC_FIELDS.length} parts written (${src}). ${answered.map((x) => `${x.f.label.split(' —')[0]}: ${x.j!.note}`).slice(0, 3).join(' ')}` : 'No written deductions (optional — not credited).', REF.PLANNING_SEQ));
  }

  // ================================================================ B. Localities
  {
    const g = 'Siting of localities';
    if (!locs.length) {
      items.push(item('LOCS', g, `${n.locName.toUpperCase()} localities placed`, 20, 0, 'No localities placed.', REF.TWO_UP));
    } else {
      const F = fwd.map(lo);
      const D = depth.map(lo);
      const fwdY = F.length ? F.reduce((m, l) => m + l.c.y * l.w, 0) / Math.max(0.01, F.reduce((m, l) => m + l.w, 0)) : Math.max(...locs.map((u) => lo(u).c.y));
      const space = aorFront - fwdY;
      // far fwd as tac feasible: not ceding gr, but room for screens
      if (recY !== undefined) {
        const dy = fwdY - recY;
        const notCeded = band(dy, -250 * n.k, 1e9, 500 * n.k);
        const room = n.screenAhead ? band(space, n.screenSpace * 0.8, 1e9, n.screenSpace * 0.5) : 1;
        const sc = n.screenAhead ? 0.6 * notCeded + 0.4 * room : notCeded;
        const d = notCeded >= 0.6 ? `FDLs ${dy >= 0 ? `${Math.round(dy)} m fwd of` : `${Math.round(-dy)} m behind`} the DS line, ${Math.round(space)} m from the fwd edge of the AOR${room < 0.9 ? ' — little room left for screens' : ''}.` : `FDLs ${Math.round(-dy)} m behind the DS line — gr is ceded to the en without a fight.`;
        items.push(item('FWD', g, 'Def as far fwd as tac feasible', 4, sc, d, REF.BIC49));
      }
      items.push(item('SCREEN_SPACE', g, 'Space left for screens', 2, n.screenAhead ? band(space, n.screenSpace, 1e9, n.screenSpace * 0.6) : 1, `${Math.round(space)} m between FDLs and the fwd edge (need ≥ ${n.screenSpace} m).`, REF.SCREENS, !n.screenAhead));
      const allL = [...F, ...D];
      const vital = ds.itgs.find((i) => i.vital);
      if (vital) {
        const d = Math.min(...allL.map((l) => distToPolygon(vital.pos, l.poly)));
        items.push(item('VITAL', g, `Vital gr (${vital.name}) held`, 4, band(d, 0, n.vitalR * 0.6, n.vitalR * 1.2), d <= n.vitalR * 0.6 ? `${vital.name} is held by a locality.` : `Nearest locality ${Math.round(d)} m from ${vital.name}.`, REF.DEF_DEFINITIONS));
      }
      // tac gr: ITGs, elevation advantage, cover — any good gr counts, not only the DS's
      {
        const merits: string[] = [];
        let sum = 0;
        for (const l of allL) {
          const itg = ds.itgs.map((i) => ({ i, d: distToPolygon(i.pos, l.poly) })).sort((a, b) => a.d - b.d)[0];
          const itgM = itg ? band(itg.d, 0, n.vitalR * 0.5, n.vitalR) * (itg.i.pri <= 3 ? 1 : itg.i.pri <= 6 ? 0.85 : 0.7) : 0;
          const ring = circle(l.c, Math.max(300, 600 * n.k), 12);
          const around = ring.reduce((m, p) => m + t.elevAt(t.clampPt(p)), 0) / ring.length;
          const rise = t.elevAt(l.c) - around;
          const elevM = clamp(0.35 + rise / 6, 0, 1);
          const covM = clamp(t.coverAt(l.c) + t.concealAt(l.c) + (t.isBua(l.c) || t.isTrees(l.c) ? 0.3 : 0), 0, 0.85);
          const m = Math.max(itgM, elevM, covM);
          sum += m;
          merits.push(`${l.u.label} ${itgM >= Math.max(elevM, covM) && itg ? `on/near ${itg.i.name}` : elevM >= covM ? `${rise >= 0 ? '+' : ''}${rise.toFixed(1)} m above the gr around` : 'in cover'}`);
        }
        items.push(item('GROUND', g, 'Localities on tac gr', 3, sum / allL.length, `${merits.join('; ')}.`, `${REF.FUNDAMENTALS}; ${REF.COY_CONSIDERATIONS}`));
      }
      // approaches covered by fire: LOS sampling over the killing band of each approach
      {
        let cov = 0;
        let wsum = 0;
        const notes: string[] = [];
        const shooters = allL;
        const rng = Math.max(n.spacing[1] * 0.9, 450 * n.k);
        for (const a of pri) {
          const w = 1 / a.pri;
          wsum += w;
          const pts = resample(a.path, Math.max(40, 60 * n.k)).filter((p) => {
            const ah = ahead(p);
            return ah >= n.ka[0] * 0.5 && ah <= n.ka[1] * 1.6;
          });
          if (!pts.length) {
            cov += w * 0.5;
            notes.push(`${a.name}: n/a`);
            continue;
          }
          let c = 0;
          for (const p of pts) {
            let k = 0;
            for (const l of shooters) {
              const from = edgeToward(l, p);
              if (dist(from, p) > rng) continue;
              if (t.los(from, p, t.eyeHeight(from), 1.5) > 0.35) k++;
              if (k >= 2) break;
            }
            c += k >= 2 ? 1 : k === 1 ? 0.75 : 0;
          }
          const f = c / pts.length;
          cov += w * clamp(f / 0.8, 0, 1);
          notes.push(`${a.name}: ${Math.round(f * 100)}%`);
        }
        items.push(item('APCH_COVER', g, 'Apchs covered by fire', 4, cov / wsum, `Share of each apch's killing band (${Math.round(n.ka[0] * 0.5)}-${Math.round(n.ka[1] * 1.6)} m ahead) under direct fire (LOS, ≤ ${Math.round(rng)} m): ${notes.join('; ')}.`, `${REF.COY_CONSIDERATIONS}; ${REF.FIELD_OF_FIRE}`));
      }
      // responsibility of an approach not divided
      {
        let split = 0;
        let splitN = 0;
        for (const a of pri) {
          const c = crossing(a);
          const d2 = F.map((l) => distToPolygon(c, l.poly)).sort((x, y) => x - y);
          if (d2.length >= 2) {
            splitN++;
            const divided = d2[0] > n.spacing[0] * 0.3 && Math.abs(d2[1] - d2[0]) < n.spacing[0] * 0.35;
            split += divided ? 0.3 : 1;
          }
        }
        for (const b of graphics('BOUNDARY')) {
          for (const a of pri.slice(0, 1)) {
            const c = crossing(a);
            if (distToPolyline(c, b.pts).d < 150 * n.k) {
              splitN++;
              split += 0.2;
            }
          }
        }
        items.push(item('APCH_SPLIT', g, 'Resp of an apch not divided b/w localities', 2, splitN ? split / splitN : 1, splitN && split < splitN - 0.01 ? 'An apch runs between two localities (or along a bdry) — responsibility is divided.' : 'Each apch is the clear resp of one locality.', REF.APPROACH_NOT_SPLIT, F.length < 2));
      }
      // mutual support: edge-to-edge gaps between adjacent fwd localities, covered by fire
      if (F.length >= 2) {
        const sorted = [...F].sort((a, b) => a.c.x - b.c.x);
        const R = TEMPLATES[n.locKey].radius;
        const lo0 = Math.max(0, n.spacing[0] - 2 * R);
        const hi0 = n.spacing[1] - 2 * R;
        let ms = 0;
        const notes: string[] = [];
        for (let i = 1; i < sorted.length; i++) {
          const a = sorted[i - 1];
          const b = sorted[i];
          const gap = edgeDist(a, b);
          const mid = { x: (a.c.x + b.c.x) / 2, y: (a.c.y + b.c.y) / 2 };
          const la = t.los(edgeToward(a, mid), mid, 2, 1.5) > 0.3 ? 1 : 0;
          const lb = t.los(edgeToward(b, mid), mid, 2, 1.5) > 0.3 ? 1 : 0;
          const losF = la + lb === 2 ? 1 : la + lb === 1 ? 0.85 : 0.6;
          ms += band(gap, lo0, hi0, hi0 * 0.6) * losF;
          notes.push(`${a.u.label}–${b.u.label} gap ${Math.round(gap)} m${losF < 1 ? ` (${la + lb ? 'gap seen from one side only' : 'gap not under obsn'})` : ''}`);
        }
        items.push(item('MUTUAL', g, 'Mutual sp b/w localities', 4, ms / (sorted.length - 1), `${notes.join('; ')} (edge to edge; norm ${Math.round(lo0)}-${Math.round(hi0)} m).`, REF.MUTUAL_SUPPORT));
      } else items.push(item('MUTUAL', g, 'Mutual sp b/w localities', 4, 0, 'Only one fwd locality.', REF.MUTUAL_SUPPORT, lvl === 'PL' && F.length === 1));
      // depth
      if (lvl !== 'PL' || D.length) {
        const best = D.map((l) => {
          const behind = -ahead(l.c);
          const lat = distToPolyline(l.c, a1.path).d;
          return { l, sc: band(behind, n.depth[0], n.depth[1], n.depth[1] * 0.45) * (0.7 + 0.3 * band(lat, 0, n.spacing[1], n.spacing[1])) * (0.6 + 0.4 * l.w), behind };
        }).sort((x, y) => y.sc - x.sc)[0];
        items.push(item('DEPTH', g, 'Depth', 4, best ? best.sc : 0, best ? `${best.l.u.label} ${Math.round(best.behind)} m behind the FDLs (norm ${n.depth[0]}-${n.depth[1]} m).` : 'No depth locality — the def can be overrun in one continuous attk.', REF.DEPTH));
      }
      // layout
      {
        const nf = effCount(fwd);
        const nd = effCount(depth);
        let tu: number;
        let tuD: string;
        if (lvl === 'PL') {
          tu = band(nf, 3, 3, 0.8) * 0.75 + (nd > 0 || nf >= 2.8 ? 0.25 : 0);
          tuD = `${nf.toFixed(nf % 1 ? 1 : 0)} secs up, ${nd.toFixed(nd % 1 ? 1 : 0)} in depth (pls usually deploy three secs up).`;
        } else {
          tu = nd >= 0.9 ? band(nf, 2, 2, 0.8) : nd >= 0.4 ? 0.6 * band(nf, 2, 2, 0.8) + 0.2 : nf >= 3 ? 0.55 : 0.3;
          tuD = `${nf.toFixed(nf % 1 ? 1 : 0)} up, ${nd.toFixed(nd % 1 ? 1 : 0)} in depth.`;
        }
        items.push(item('TWO_UP', g, lvl === 'PL' ? 'Secs up / depth' : 'Two up, one in depth', 2, tu, tuD, REF.TWO_UP));
      }
      if (F.length) {
        const xs = F.flatMap((l) => l.poly.map((p) => p.x));
        const fr = Math.max(...xs) - Math.min(...xs);
        items.push(item('FRONTAGE', g, 'Frontage', 1, band(fr, n.frontage[0], n.frontage[1], n.frontage[1] * 0.4), `${Math.round(fr)} m (norm ${n.frontage[0]}-${n.frontage[1]} m).`, REF.FRONTAGES));
      }
      {
        const check = plan.units.filter((u) => !['SCREEN', 'SP_PTL', 'LP', 'OP'].includes(u.role));
        const fr = check.map((u) => {
          const l = lo(u);
          const pts = u.area && u.area.length >= 3 ? l.poly : [u.pos];
          return { u, f: pts.filter((p) => pointInPolygon(p, s.own.aor)).length / pts.length };
        });
        const out = fr.filter((x) => x.f < 0.999);
        const sc = fr.length ? fr.reduce((m, x) => m + x.f ** 2, 0) / fr.length : 1;
        items.push(item('IN_AOR', g, 'Within given bdrys', 2, out.length ? clamp(sc - 0.08 * out.length, 0, 1) : 1, out.length ? `Outside the AOR: ${out.map((x) => `${x.u.label}${x.f > 0 ? ' (partly)' : ''}`).join(', ')}.` : 'All posns within bdrys.', REF.DEF_DEFINITIONS));
      }
      // field of fire to the front of each fwd locality (from its fwd edge)
      if (F.length) {
        let fof = 0;
        for (const l of F) {
          let vis = 0;
          let tot = 0;
          const fwdPt = edgeToward(l, { x: l.c.x + Math.sin((l.u.facing * Math.PI) / 180) * 1e4, y: l.c.y + Math.cos((l.u.facing * Math.PI) / 180) * 1e4 });
          for (let a = -45; a <= 45; a += 15) {
            for (const d of [150, 300, 450]) {
              const b = ((l.u.facing + a) * Math.PI) / 180;
              const p = { x: fwdPt.x + Math.sin(b) * d * Math.max(1, n.k * 0.8), y: fwdPt.y + Math.cos(b) * d * Math.max(1, n.k * 0.8) };
              tot++;
              if (t.los(fwdPt, p, t.eyeHeight(fwdPt), 1.2) > 0.4) vis++;
            }
          }
          fof += vis / Math.max(1, tot);
        }
        const f = fof / F.length;
        items.push(item('FOF', g, 'F of F of fwd localities', 2, band(f, 0.7, 1, 0.3), `${Math.round(100 * f)}% of the gr 150-450 m to the front is under direct fire (desired 270-500 m clear).`, REF.FIELD_OF_FIRE));
      }
      {
        const sc = F.map((l) => (l.u.altPos ? band(dist(l.u.altPos, l.c), DOCTRINE.altPosnMin * Math.min(1, n.k), DOCTRINE.altPosnMax * Math.max(1, n.k), 150 * Math.max(1, n.k)) : 0));
        const ok = sc.filter((x) => x >= 0.8).length;
        items.push(item('ALT', g, 'Altn posns (all-round def)', 2, F.length ? sc.reduce((m, x) => m + x, 0) / F.length : 0, `${ok}/${F.length} fwd localities have altn posns ${DOCTRINE.altPosnMin}+ m away.`, `${REF.ALT_POSN}; ${REF.ALL_ROUND}`));
      }
      // cover & concealment relative to what the gr around offers
      {
        let sum = 0;
        for (const l of allL) {
          const own = t.coverAt(l.c) + t.concealAt(l.c) + (t.isBua(l.c) || t.isTrees(l.c) ? 0.3 : 0);
          const ring = circle(l.c, Math.max(250, 400 * n.k), 12);
          const best = Math.max(own, ...ring.map((p) => t.coverAt(t.clampPt(p)) + t.concealAt(t.clampPt(p))));
          sum += best < 0.15 ? 1 : clamp(0.35 + 0.65 * (own / best), 0, 1);
        }
        const sc = sum / allL.length;
        items.push(item('CONCEAL', g, 'Cover & concealment', 1, sc, `Localities use ${Math.round(sc * 100)}% of the cover / concealment aval nearby.`, `${REF.FUNDAMENTALS}; ${REF.PRIORITY_OF_WORK}`));
      }
      if (recLine && F.length) {
        const sc = F.reduce((m, l) => m + band(distToPolyline(l.c, recLine.pts).d, 0, 250 * n.k, 450 * n.k), 0) / F.length;
        items.push(item('DS_MATCH', g, 'Agreement with the DS line (guide)', 1, sc, `Mean distance of the fwd localities from the DS line (${recLine.name}): ${Math.round(F.reduce((m, l) => m + distToPolyline(l.c, recLine.pts).d, 0) / F.length)} m. A sound alternative scores on the principles above.`, REF.IE_SOLN));
      }
    }
  }

  // ================================================================ C. Weapons
  {
    const g = 'Siting of wpns';
    const at = plan.units.filter((u) => AT_KEYS.has(u.templateKey));
    const atAvail = s.own.resources.filter((r) => AT_KEYS.has(r.templateKey)).reduce((m, r) => m + r.count, 0);
    if (atAvail > 0 || at.length) {
      const range = (u: PlacedUnit) => {
        const w = TEMPLATES[u.templateKey].weapons;
        return w.BS ? WEAPONS.BS.range : w.RR106 ? WEAPONS.RR106.range : 300;
      };
      const per = at.map((u) => band(distToPolyline(u.pos, a1.path).d, 0, range(u) * 0.8, range(u) * 0.3));
      const best = [...per].sort((a, b) => b - a).slice(0, Math.max(1, Math.min(2, atAvail)));
      items.push(item('AT_APCH', g, 'A tk wpns cover the most likely tk apch', 4, best.reduce((m, x) => m + x, 0) / Math.max(1, Math.min(2, atAvail)), `${per.filter((x) => x >= 0.8).length} A tk wpn(s) within effective rg of the ${a1.name}.`, REF.AT_SITING));
      let obl = 0;
      for (const u of at) {
        const near = distToPolyline(u.pos, a1.path);
        const pts = resample(a1.path, 50);
        const idx = pts.findIndex((p) => dist(p, near.pt) < 60);
        const dir = idx > 0 ? bearing(pts[idx - 1], pts[idx]) : 180;
        const look = bearing(u.pos, near.pt);
        obl += band(angleDiff(look, (dir + 180) % 360), 30, 180, 15);
      }
      items.push(item('AT_OBLIQUE', g, 'A tk fire oblique / enfilade', 2, at.length ? obl / at.length : 0, 'A tk wpns should engage the tk apch obliquely, not head-on.', REF.AT_SITING, !at.length));
      const locL = locs.map(lo);
      const prot = at.map((u) => Math.max(locL.some((l) => distToPolygon(u.pos, l.poly) <= 150 * Math.max(1, n.k * 0.6)) ? 1 : 0, clamp(t.coverAt(u.pos) / 0.3, 0, 1)));
      items.push(item('AT_PROT', g, 'A tk wpns protected / defiladed', 2, at.length ? prot.reduce((m, x) => m + x, 0) / at.length : 0, `${prot.filter((x) => x >= 0.8).length}/${at.length} sited within a locality or in cover.`, REF.AT_SITING, !at.length));
      const atDepth = at.filter((u) => -ahead(u.pos) > 150 * n.k);
      items.push(item('AT_DEPTH', g, 'Depth in A tk def', 1, atDepth.length ? 1 : 0, atDepth.length ? 'A tk wpns sited in depth too.' : 'All A tk wpns on the FDLs — no depth to the A tk def.', REF.AT_SITING, at.length < 2));
    }
    const autos = plan.units.filter((u) => u.templateKey === 'GLHMG_DET' || u.templateKey === 'MG_DET');
    if (autos.length || s.own.resources.some((r) => r.templateKey === 'GLHMG_DET' || r.templateKey === 'MG_DET')) {
      const sc = autos.map((u) => band(distToPolyline(u.pos, a1.path).d, 0, u.templateKey === 'GLHMG_DET' ? 1500 : 900, 300) * band(ahead(u.pos), -250 * n.k, 1e9, 200 * n.k));
      items.push(item('MG_SITING', g, 'MG / GLHMG cover the most dangerous apch', 2, autos.length ? sc.reduce((m, x) => m + x, 0) / autos.length : 0, autos.length ? `${sc.filter((x) => x >= 0.8).length}/${autos.length} sited to cover the ${a1.name}.` : 'Not placed.', `${REF.MG_SITING}; ${REF.RR_GLHMG}`));
    }
    const mors = plan.units.filter((u) => u.templateKey === 'MOR60_SEC' || u.templateKey === 'MOR81_PL');
    if (mors.length) {
      const sc = mors.map((u) => band(-ahead(u.pos), 100 * n.k, u.templateKey === 'MOR60_SEC' ? 900 : 3000, 150 * n.k) * (t.coverAt(u.pos) > 0.2 || t.concealAt(u.pos) > 0.3 || -ahead(u.pos) > 200 ? 1 : 0.7));
      items.push(item('MORS', g, 'Mors in depth / defilade', 1, sc.reduce((m, x) => m + x, 0) / mors.length, `${sc.filter((x) => x >= 0.8).length}/${mors.length} sited in depth within rg of the DFs.`, REF.DF_SELECTION));
    }
  }

  // ================================================================ D. Obstacles
  {
    const g = 'Obs plan';
    const mfd = graphics('MINEFIELD');
    const wire = graphics('WIRE');
    const other = graphics('OBSTACLE');
    const allObs = [...mfd, ...wire, ...other];
    const minesAvail = s.own.fire.mines.apM + s.own.fire.mines.atM > 0;
    if (lvl !== 'BDE' || mfd.length || other.length) {
      if (!mfd.length) items.push(item('MFD', g, 'Mfds planned', 3, minesAvail ? (other.length ? 0.3 : 0) : 1, minesAvail ? `No mfds planned although mines are aval${other.length ? ' (other obs planned)' : ''}.` : 'No mines aval.', REF.OBSTACLES));
      const obsForCover = [...mfd, ...other];
      if (obsForCover.length) {
        let covered = 0;
        for (const m of obsForCover) {
          const mid = m.pts[Math.floor(m.pts.length / 2)];
          const tac = m.props.subtype === 'TACTICAL' || m.props.subtype === 'DEFENSIVE';
          const coverers = tac ? plan.units.filter((u) => AT_KEYS.has(u.templateKey) || u.templateKey === n.locKey) : plan.units.filter((u) => u.templateKey === n.locKey || u.templateKey === 'MG_DET' || u.templateKey === 'GLHMG_DET');
          const maxR = tac ? 1100 * Math.max(1, n.k * 0.6) : n.mfdMax;
          let best = 0;
          for (const u of coverers) {
            const from = edgeToward(lo(u), mid);
            const d = dist(from, mid);
            if (t.los(from, mid, t.eyeHeight(from), 1) <= 0.3) continue;
            best = Math.max(best, band(d, 0, maxR, maxR * 0.4));
          }
          covered += best;
        }
        items.push(item('MFD_COVER', g, 'Obs covered by fire', 3, covered / obsForCover.length, `${Math.round(covered * 10) / 10}/${obsForCover.length} obs within rg & view of the wpns that must cover them (prot ≤ ${n.mfdMax} m by small arms; A tk mfd by A tk wpns).`, REF.OBSTACLES));
        const onApch = obsForCover.some((m) => polylineIntersection(m.pts, a1.path) || distToPolyline(m.pts[0], a1.path).d < 200 * n.k || distToPolyline(m.pts[m.pts.length - 1], a1.path).d < 200 * n.k);
        items.push(item('MFD_APCH', g, 'Obs across the most likely apch', 2, onApch ? 1 : 0.2, onApch ? `Obs sited across the ${a1.name}.` : `The ${a1.name} is not obstructed.`, REF.OBSTACLES));
      }
      if (mfd.length) {
        const len = mfd.reduce((m, x) => m + polylineLength(x.pts), 0);
        const budget = s.own.fire.mines.apM + s.own.fire.mines.atM;
        items.push(item('MFD_RES', g, 'Mfds within mines aval', 1, len <= budget * 1.05 ? 1 : clamp(budget / len, 0, 1), `${Math.round(len)} m planned vs ${budget} m of mines aval.`, REF.OBSTACLES));
      }
      if (wire.length) {
        let ok = 0;
        for (const w of wire) {
          const mid = w.pts[Math.floor(w.pts.length / 2)];
          const near = fwd.map((u) => distToPolygon(mid, lo(u).poly)).sort((a, b) => a - b)[0] ?? Infinity;
          ok += band(near, DOCTRINE.wireMinAhead * 0.5, DOCTRINE.wireMaxAhead, 60);
        }
        items.push(item('WIRE', g, 'Wire outside grenade rg, covered by fire', 1, ok / wire.length, `${Math.round(ok * 10) / 10}/${wire.length} wire obs sited ${DOCTRINE.wireMinAhead}-${DOCTRINE.wireMaxAhead} m from the posts.`, REF.WIRE));
      }
      // obstacles in front of each fwd locality
      if (fwd.length && (minesAvail || allObs.length)) {
        let f = 0;
        for (const u of fwd) {
          const l = lo(u);
          const fb = (u.facing * Math.PI) / 180;
          const has = allObs.some((o) =>
            resample(o.pts.length > 1 ? o.pts : [o.pts[0], o.pts[0]], 25).some((p) => {
              const dx = p.x - l.c.x;
              const dy = p.y - l.c.y;
              const along = dx * Math.sin(fb) + dy * Math.cos(fb);
              const lat = Math.abs(dx * Math.cos(fb) - dy * Math.sin(fb));
              return along > l.r * 0.3 && along < l.r + n.mfdMax * 1.5 && lat < l.r + 200 * n.k;
            }),
          );
          f += has ? 1 : 0;
        }
        items.push(item('OBS_FRONT', g, 'Obs in front of the localities', 2, f / fwd.length, `${f}/${fwd.length} fwd localities have an obstacle in front of them, within small-arms rg.`, REF.OBSTACLES));
      }
    }
  }

  // ================================================================ E. Fire plan
  {
    const g = 'Fire plan';
    const dfs = plan.graphics.filter((x) => x.kind === 'DF');
    const trps = plan.graphics.filter((x) => x.kind === 'TRP');
    const sos = dfs.filter((d) => d.props.sos);
    const sosArty = sos.filter((d) => (d.props.subtype ?? 'ARTY') === 'ARTY');
    let sosScore = 0;
    let sosD = 'No DF (SOS) planned.';
    const sosUse = sosArty.length ? sosArty : sos;
    if (sosUse.length) {
      const scored = sosUse.map((d) => {
        const p = d.pts[0];
        const onA = band(distToPolyline(p, a1.path).d, 0, 300 * Math.max(1, n.k * 0.6), 250 * Math.max(1, n.k * 0.6));
        const ah = ahead(p);
        const near = Math.min(...plan.units.filter((u) => u.role === 'FDL' || u.role === 'DEPTH').map((u) => distToPolygon(p, lo(u).poly)), 1e9);
        const posSc = band(ah, DOCTRINE.dfSosMinAhead * Math.min(1, n.k), DOCTRINE.dfSosMaxAhead * Math.max(1, n.k), 200 * Math.max(1, n.k * 0.6)) * band(near, 120, 1e9, 60);
        return { d, sc: 0.6 * onA + 0.4 * posSc, ah, onA, near };
      }).sort((a, b) => b.sc - a.sc);
      const b = scored[0];
      sosScore = b.sc * (sosArty.length ? 1 : 0.85) - (sosArty.length > Math.max(1, s.own.fire.artyBatteries) ? 0.15 : 0);
      sosD = `${sosArty.length ? 'Arty' : 'Mor'} DF (SOS) ${Math.round(b.ah)} m ahead of the FDLs${b.onA >= 0.8 ? ` on the ${a1.name}` : ' — not on the most vulnerable apch'}${b.near < 120 ? ' — DANGER CLOSE to own posn' : ''}${sosArty.length > Math.max(1, s.own.fire.artyBatteries) ? '; only one SOS per fire unit' : ''}.`;
    }
    items.push(item('SOS', g, 'DF (SOS) on the most vulnerable apch', 4, sosScore, sosD, REF.DF_SOS));
    const want = [...ds.likelyFUPs.filter((f) => f.approachId === a1.id), ...ds.likelyFAAs.filter((f) => f.approachId === a1.id), ...ds.likelyBOFs.filter((f) => f.approachId === a1.id), ...ds.likelyFUPs.filter((f) => f.approachId !== a1.id)];
    const R = 400 * Math.max(1, n.k * 0.6);
    const hitSc = want.map((w) => Math.max(0, ...dfs.map((d) => band(dist(d.pts[0], w.pos), 0, R, R * 0.6)), ...trps.map((d) => 0.7 * band(dist(d.pts[0], w.pos), 0, R, R * 0.6))));
    const hit = want.filter((_, i) => hitSc[i] >= 0.7);
    items.push(item('DF_TGTS', g, 'DFs on likely FAA / FUP / BOF', 3, want.length ? hitSc.reduce((m, x) => m + x, 0) / want.length : 1, `${hit.length}/${want.length} likely en depl areas picked up as DFs${want.length - hit.length ? ` (missed: ${want.filter((w) => !hit.includes(w)).map((w) => w.name).slice(0, 4).join(', ')})` : ''}.`, REF.DF_SELECTION));
    const perUnit = new Map<string, number>();
    for (const d of dfs) perUnit.set(d.props.subtype ?? 'ARTY', (perUnit.get(d.props.subtype ?? 'ARTY') ?? 0) + 1);
    const maxPer = Math.max(0, ...perUnit.values());
    items.push(item('DF_COUNT', g, 'No of DFs', 1, dfs.length ? band(dfs.length + trps.length * 0.5, 3, 99, 1.5) * band(maxPer, 0, DOCTRINE.dfPerFireUnit + 2, 3) : 0, `${dfs.length} DFs (${[...perUnit.entries()].map(([k, v]) => `${k} ${v}`).join(', ') || 'nil'})${trps.length ? ` + ${trps.length} TRP` : ''}; about ${DOCTRINE.dfPerFireUnit} per fire unit recommended.`, REF.DF_SELECTION));
    const kas = graphics('KILL_AREA');
    const prim = kas.find((k) => k.props.subtype === 'PRIMARY') ?? kas[0];
    if (!prim) items.push(item('KA', g, 'Killing areas', 3, 0, 'No killing area marked.', REF.FIRE_PLAN));
    else {
      const c = centroid(prim.pts);
      const onApch = band(distToPolyline(c, a1.path).d, 0, 300 * Math.max(1, n.k * 0.6), 300 * Math.max(1, n.k * 0.6));
      const ah = ahead(c);
      const shooters = plan.units.filter((u) => (u.templateKey === n.locKey || u.templateKey === 'MG_DET' || u.templateKey === 'GLHMG_DET' || AT_KEYS.has(u.templateKey)) && dist(edgeToward(lo(u), c), c) <= 900 * Math.max(1, n.k * 0.7) && t.los(edgeToward(lo(u), c), c, 2, 1.2) > 0.3);
      const sc = 0.4 * onApch + band(ah, n.ka[0], n.ka[1], n.ka[1] * 0.6) * 0.3 + Math.min(1, shooters.length / 2) * 0.3;
      items.push(item('KA', g, 'Pri killing area', 3, sc, `Pri KA ${Math.round(ah)} m ahead of FDLs${onApch >= 0.8 ? ` on the ${a1.name}` : ' — off the most likely apch'}; covered by ${shooters.length} posns with LOS.`, REF.FIRE_PLAN));
    }
  }

  // ================================================================ F. Surveillance & security
  {
    const g = 'Surv & security';
    const fup1 = ds.likelyFUPs.find((f) => f.approachId === a1.id) ?? ds.likelyFUPs[0];
    if (n.spAhead) {
      const sps = byRole('SP_PTL');
      const kk = Math.max(1, n.k * 0.6);
      const best = sps
        .map((u) => {
          const ah = ahead(u.pos);
          const toFup = fup1 ? dist(u.pos, fup1.pos) : 9999;
          const from = u.parentId ? plan.units.find((x) => x.id === u.parentId) : undefined;
          return { u, from, sc: (0.5 * band(ah, n.spAhead![0], n.spAhead![1], n.spAhead![1] * 0.4) + 0.5 * band(toFup, 0, 700 * kk, 600 * kk)) * (from ? 1 : 0.92), ah, toFup };
        })
        .sort((a, b) => b.sc - a.sc)[0];
      items.push(item('SP', g, 'Standing ptl on the likely FUP / apch', 3, best ? best.sc : 0, best ? `${best.u.label}${best.from ? ` (found from ${best.from.label})` : ' (not found from a locality)'} ${Math.round(best.ah)} m ahead, ${Math.round(best.toFup)} m from likely FUP ${fup1?.name ?? ''} (norm ${n.spAhead[0]}-${n.spAhead[1]} m ahead).` : 'No standing ptl — the en can form up unobserved.', `${REF.STANDING_PTL}; ${REF.SPOILING}`));
    }
    if (n.lpAhead) {
      const lps = byRole('LP');
      const scs = lps.map((u) => band(ahead(u.pos), n.lpAhead![0], n.lpAhead![1], 150)).sort((a, b) => b - a);
      const need = Math.max(1, lvl === 'PL' ? 1 : fwd.length);
      items.push(item('LP', g, 'LPs fwd of the localities (ni)', 2, scs.slice(0, need).reduce((m, x) => m + x, 0) / need, `${scs.filter((x) => x >= 0.8).length} LP(s) ${n.lpAhead[0]}-${n.lpAhead[1]} m ahead (need ${need}).`, REF.OP_LP));
    }
    const obs = plan.units.filter((u) => u.templateKey === 'ARTY_OBS' || u.templateKey === 'MOR_OBS');
    if (obs.length || s.own.resources.some((r) => r.templateKey === 'ARTY_OBS')) {
      const dfs = plan.graphics.filter((x) => x.kind === 'DF');
      let osc = 0;
      for (const o of obs) {
        const vantage = t.elevAt(o.pos) > 3 || t.isBua(o.pos) || locs.some((l) => distToPolygon(o.pos, lo(l).poly) < 120 && ahead(lo(l).c) > -100);
        const seen = dfs.filter((d) => dist(o.pos, d.pts[0]) < 3500 && t.los(o.pos, d.pts[0], t.eyeHeight(o.pos), 2) > 0.3).length;
        osc += 0.4 * (vantage ? 1 : 0.3) + 0.6 * (dfs.length ? seen / dfs.length : 0);
      }
      items.push(item('OBS', g, 'Obsrs on vantage pts with view of DFs', 2, obs.length ? osc / obs.length : 0, obs.length ? 'Measured: vantage point and LOS to the planned DFs.' : 'Arty / mor obsrs not sited.', REF.SURVEILLANCE));
    }
    const qcAvail = s.own.resources.some((r) => r.templateKey === 'QC_DET');
    if (qcAvail) {
      const areas = graphics('QC_AREA');
      const onFupFaa = areas.some((a) => [...ds.likelyFUPs, ...ds.likelyFAAs].some((p) => dist(a.pts[0], p.pos) <= (a.props.radius ?? 600) + 300));
      const lastLight = Math.floor(s.times.hHour / 1440) * 1440 + s.times.light.lastLight;
      const nightCover = plan.qcSorties.some((q) => q.start >= lastLight - 90 && q.start <= lastLight + 300);
      const placed = units('QC_DET').length > 0;
      const sc = (placed ? 0.3 : 0) + (onFupFaa ? 0.35 : areas.length ? 0.15 : 0) + (nightCover ? 0.35 : plan.qcSorties.length ? 0.15 : 0);
      items.push(item('QC', g, 'QC surv plan (FUP / FAA, timings)', 2, sc, `${placed ? 'QC det sited' : 'QC det not sited'}; ${onFupFaa ? 'surv area over likely FUP/FAA' : 'no surv area over likely FUP/FAA'}; ${nightCover ? 'sorties cover the critical evening / night' : 'no sorties planned for the critical evening / night'}.`, REF.BIC49));
    }
    if (n.screenAhead && s.own.resources.some((r) => r.templateKey === 'SCREEN_PL' || (lvl === 'BDE' && r.templateKey === 'RIFLE_COY'))) {
      const scr = byRole('SCREEN');
      const best = scr
        .map((u) => {
          const c = lo(u).c;
          const ah = ahead(c);
          const onA = band(distToPolyline(c, a1.path).d, 0, 800 * Math.max(1, n.k * 0.6), 500 * Math.max(1, n.k * 0.6));
          const ground = ds.itgs.some((i) => dist(i.pos, c) < 350 * Math.max(1, n.k * 0.6)) || t.elevAt(c) > 3 || t.coverAt(c) > 0.3;
          return { u, ah, sc: 0.4 * band(ah, n.screenAhead![0], n.screenAhead![1], n.screenAhead![1] * 0.4) + 0.35 * onA + 0.25 * (ground ? 1 : 0.2) };
        })
        .sort((a, b) => b.sc - a.sc)[0];
      items.push(item('SCREEN', g, 'Loc of screens', 3, best ? best.sc : 0, best ? `${best.u.label} ${Math.round(best.ah)} m ahead of the FDLs (DS: ${ds.screenArea?.name ?? '-'}).` : 'Loc for screens not selected (Narr 1 requires it).', REF.SCREENS));
    }
  }

  // ================================================================ G. C attk & C2
  {
    const g = 'C attk & C2';
    const catks = graphics('CATK').sort((a, b) => (a.props.priority ?? 9) - (b.props.priority ?? 9));
    if (lvl !== 'PL') {
      if (!catks.length) items.push(item('CATK', g, 'C attk plan', 4, 0, 'No C attk planned — it must be integrated from the start.', REF.CATK_PLAN));
      else {
        const c1 = crossing(a1);
        const first = catks[0];
        const obj = first.pts[first.pts.length - 1];
        const target = [...fwd].sort((a, b) => dist(lo(a).c, c1) - dist(lo(b).c, c1))[0];
        const toObj = target ? distToPolygon(obj, lo(target).poly) : 1e9;
        const objOk = band(toObj, 0, 200 * Math.max(1, n.k * 0.6), 250 * Math.max(1, n.k * 0.6));
        // a C attk onto any fwd locality is sound; the one on the most likely apch first is best
        const anyFwd = Math.max(0, ...fwd.map((u) => band(distToPolygon(obj, lo(u).poly), 0, 200 * Math.max(1, n.k * 0.6), 250 * Math.max(1, n.k * 0.6))));
        const priSc = Math.max(objOk, 0.5 * anyFwd);
        items.push(item('CATK_PRI', g, 'C attk objs in order of pri', 2, priSc, priSc >= 0.8 ? `Pri 1 C attk obj is ${target?.label}, the locality on the ${a1.name}.` : 'Pri 1 C attk obj is not the locality on the most likely apch.', REF.CATK_PLAN));
        const force = first.props.unitId ? plan.units.find((u) => u.id === first.props.unitId) : undefined;
        const forceOk = force && (force.role === 'DEPTH' || force.role === 'RES');
        items.push(item('CATK_FORCE', g, 'C attk force earmarked (depth)', 2, forceOk ? 0.75 + 0.25 * lo(force).w : force ? 0.4 : 0, force ? `${force.label} (${force.role.toLowerCase()}) earmarked.` : 'No force earmarked.', REF.CATK_PLAN));
        const len = polylineLength(first.pts);
        let flank = 1;
        if (first.pts.length >= 2 && target) {
          const last = first.pts[first.pts.length - 2];
          flank = band(angleDiff(bearing(last, obj), (target.facing + 180) % 360), 40, 180, 25);
        }
        items.push(item('CATK_ROUTE', g, 'C attk route & distance', 2, 0.5 * (0.4 + 0.6 * flank) + 0.5 * band(len, 0, n.catkMax, n.catkMax * 0.6), `Route ${Math.round(len)} m${flank < 0.8 ? ', frontal into the penetration' : ', from a flank'}; must be launchable within ${DOCTRINE.coyCatkMaxMin} min.`, REF.CATK_PLAN));
      }
      const cpen = graphics('CPEN');
      items.push(item('CPEN', g, 'C pen posn', 1, cpen.length ? 1 : 0, cpen.length ? 'C pen posn planned.' : 'No C pen posn.', REF.COUNTER_PEN));
    }
    const hqKeys = ['CHQ', 'BN_HQ', 'BDE_HQ', 'PL_HQ'];
    const hq = plan.units.find((u) => hqKeys.includes(u.templateKey));
    if (hq) {
      const behind = -ahead(hq.pos);
      const nearDepth = depth.length ? Math.min(...depth.map((d) => distToPolygon(hq.pos, lo(d).poly))) : 999;
      const covered = t.coverAt(hq.pos) > 0.25 || t.concealAt(hq.pos) > 0.3 || t.isBua(hq.pos);
      const route = t.onRoad(hq.pos) || s.terrain.features.some((f) => (f.kind === 'road' || f.kind === 'track') && distToPolyline(hq.pos, f.pts).d < 250 * Math.max(1, n.k * 0.6));
      const sc = 0.35 * band(behind, n.chqBehind[0], n.chqBehind[1], n.chqBehind[1] * 0.6) + 0.25 * (lvl === 'PL' ? 1 : band(nearDepth, 0, 300 * n.k, 300 * n.k)) + 0.2 * (covered ? 1 : 0.2) + 0.2 * (route ? 1 : 0.3);
      items.push(item('CHQ', g, 'Loc of HQ', 2, sc, `${hq.label} ${Math.round(behind)} m behind FDLs${covered ? ', covered/concealed' : ', in the open'}${route ? ', near the main route' : ''}.`, REF.CP_CHQ));
    } else items.push(item('CHQ', g, 'Loc of HQ', 2, 0, 'HQ not sited.', REF.CP_CHQ));
    const cp = plan.units.find((u) => u.templateKey === 'CP');
    if (cp) {
      let vis = 0;
      let tot = 0;
      for (const a of pri) {
        for (const p of resample(a.path, 200)) {
          const ah = ahead(p);
          if (ah < 200 * n.k || ah > 1500 * n.k) continue;
          tot++;
          if (t.los(cp.pos, p, t.eyeHeight(cp.pos), 2) > 0.3) vis++;
        }
      }
      const inFdl = band(ahead(cp.pos), -250 * n.k, 1e9, 150 * n.k);
      items.push(item('CP', g, 'CP in FDLs with view', 2, 0.4 * inFdl + 0.6 * (tot ? clamp(vis / tot / 0.8, 0, 1) : 0), `CP ${inFdl >= 0.8 ? 'in the FDLs' : 'not in the FDLs'}; sees ${tot ? Math.round((100 * vis) / tot) : 0}% of the apchs 200-1500 m ahead.`, REF.CP_CHQ));
    }
    const ctrl = graphics('BOUNDARY', 'PHASE_LINE');
    if (ctrl.length) {
      const bad = graphics('BOUNDARY').filter((b) => pri.slice(0, 2).some((a) => resample(a.path, 100).filter((p) => ahead(p) > -200 && ahead(p) < n.ka[1] * 2).some((p) => distToPolyline(p, b.pts).d < 120 * n.k)));
      items.push(item('CTRL', g, 'Control measures (bdrys / PLs)', 1, bad.length ? 0.35 : 1, bad.length ? 'A bdry runs along an apch — its resp is split between sub-units.' : `${ctrl.length} control measure(s) sensibly placed.`, REF.APPROACH_NOT_SPLIT));
    }
  }

  // ================================================================ H. Pre-planned contingencies
  {
    const g = 'Contingency plan';
    const fup1 = ds.likelyFUPs.find((f) => f.approachId === a1.id) ?? ds.likelyFUPs[0];
    const faa1 = ds.likelyFAAs.find((f) => f.approachId === a1.id) ?? ds.likelyFAAs[0];
    const dfs = plan.graphics.filter((x) => x.kind === 'DF');
    const sp = byRole('SP_PTL').sort((a, b) => dist(a.pos, fup1?.pos ?? a.pos) - dist(b.pos, fup1?.pos ?? b.pos))[0];
    const depthInf = depth.filter((u) => TEMPLATES[u.templateKey].kind === 'INF');
    const armour = s.enemy.force.some((f) => TEMPLATES[f.templateKey]?.kind === 'ARMOUR');
    const ctxFor = (key: string): DecisionContext => {
      const c = plan.contingency[key];
      switch (key) {
        case 'SCREEN_CONTACT':
          return { screens: byRole('SCREEN').length };
        case 'EN_ASSEMBLY': {
          const nominated = c?.dfId ? dfs.filter((d) => d.id === c.dfId) : dfs;
          return { dfNearFaa: !!faa1 && nominated.some((d) => dist(d.pts[0], faa1.pos) < 450), armourSeen: armour, ucavLeft: s.own.fire.ucavSorties, aqcAvail: units('QC_DET').length > 0 };
        }
        case 'EN_FORMING_UP':
          return {
            spAvailable: !!sp && !!fup1 && dist(sp.pos, fup1.pos) < 1500,
            spInRange: !!sp && !!fup1 && dist(sp.pos, fup1.pos) <= 700 && t.los(sp.pos, fup1.pos, 2, 1.5) > 0.2,
            glhmgInRange: !!fup1 && plan.units.some((u) => u.templateKey === 'GLHMG_DET' && dist(u.pos, fup1.pos) <= 1750),
            depthAvailable: depthInf.length > 0,
            aqcAvail: units('QC_DET').length > 0,
          };
        case 'EN_ASSAULT':
          return { altPlanned: fwd.filter((u) => u.altPos).length, threatOffAxis: true, sosPlanned: dfs.some((d) => d.props.sos) };
        case 'POST_LOST': {
          const u = c?.unitId ? plan.units.find((x) => x.id === c.unitId) : undefined;
          return { elementsLost: 1, depthAvailable: depthInf.length > 0, delay: c?.delayMin ?? 15, chosenUnitIsDepth: !u || u.role === 'DEPTH' || u.role === 'RES', catkPlanned: graphics('CATK').length > 0 };
        }
        case 'LOCALITY_LOST':
          return { depthAvailable: depthInf.length > 0, cpenPlanned: graphics('CPEN').length > 0 };
        default:
          return {};
      }
    };
    const defs = CONTINGENCIES.filter((d) => d.levels.includes(lvl) && (d.key !== 'SCREEN_CONTACT' || byRole('SCREEN').length > 0 || !!n.screenAhead));
    for (const d of defs) {
      const c = plan.contingency[d.key];
      if (!choicePlanned(c)) {
        items.push(item(`CONT_${d.key}`, g, d.title, 1.25, 0, 'Not pre-planned.', d.ref));
        continue;
      }
      const acts = choiceActions(d.key, c);
      const v = evaluateResponse(d.key, { actions: acts, text: c!.text }, ctxFor(d.key), judge(reqs.get(`CONT_${d.key}`)));
      const what = acts.length ? `${acts.length} action${acts.length === 1 ? '' : 's'}${c!.text?.trim() ? ' + own words' : ''}` : 'own words only';
      items.push(item(`CONT_${d.key}`, g, d.title, 1.25, v.score, `${v.verdict.toLowerCase()} (${what}) — ${v.rationale}`, v.ref));
    }
    const customs = (plan.customContingencies ?? []).filter((c) => c.actions.length || c.text.trim() || c.situation.trim());
    if (customs.length) {
      const vs = customs.map((c) => ({ c, v: evaluateCustom(c, {}, judge(reqs.get(`CUST_${c.id}`))) }));
      const sc = vs.reduce((m, x) => m + x.v.score, 0) / vs.length;
      items.push(item('CONT_CUSTOM', g, 'Own contingencies', Math.min(1.5, 0.5 * customs.length), sc, vs.map((x) => `“${x.c.situation.trim().slice(0, 50) || x.c.trigger}”: ${x.v.verdict.toLowerCase()}`).join('; ') + '.', REF.FUNDAMENTALS));
    }
  }

  // ================================================================ I. Time & space, resources
  {
    const g = 'Time & space';
    const wl = workload(s, plan);
    items.push(item('READY', g, 'Def ready by the given time', 3, band(wl.readiness, 1, 1, 0.15), `${Math.round(wl.required)} hrs of work vs ${Math.round(wl.available)} hrs aval (${Math.round(wl.availDay)} day / ${Math.round(wl.availNight)} ni).`, `${REF.PRIORITY_OF_WORK}; ${REF.IE_SOLN}`));
    const keyRes = s.own.resources.filter((r) => !['LP', 'RIFLE_SEC'].includes(r.templateKey) || lvl === 'PL');
    const total = keyRes.reduce((m, r) => m + r.count, 0);
    const placed = keyRes.reduce((m, r) => m + Math.min(r.count, units(r.templateKey).filter((u) => !u.splitFrom).length), 0);
    items.push(item('RES_USED', g, 'All resources employed', 2, total ? placed / total : 1, `${placed}/${total} allotted resources sited.`, REF.COY_CONSIDERATIONS));
  }

  return applyMarking(items, opts.marking);
}

/** Applies the instructor's marking configuration: disabled items, group weights, strictness exponent. */
export function applyMarking(items: ScoreItem[], m?: MarkingConfig): AssessmentResult {
  const exp = STRICT[m?.strictness ?? 'STANDARD'].exp;
  const off = new Set(m?.disabled ?? []);
  const out: ScoreItem[] = [];
  for (const it of items) {
    if (off.has(it.id)) continue;
    const gw = m?.groupWeights?.[it.group] ?? 1;
    if (it.verdict === 'NA') {
      out.push(it);
      continue;
    }
    const sc = exp === 1 ? it.score : it.score ** exp;
    const x = scoreItem(it.id, it.group, it.title, it.weight * gw, sc, it.detail, it.ref);
    if (gw <= 0) Object.assign(x, { weight: 0 });
    out.push(x);
  }
  return summarise(out);
}

/**
 * Applies instructor overrides (keyed "<prefix>:<item id>") to an assessment. The automatic
 * score is kept in `auto`, so overrides can be changed or removed later.
 */
export function applyOverrides(a: AssessmentResult, overrides: Record<string, { score: number; note?: string }> | undefined, prefix: 'plan' | 'war'): AssessmentResult {
  const items = a.items.map((it) => {
    const auto = it.auto ?? it.score;
    const o = overrides?.[`${prefix}:${it.id}`];
    if (!o) {
      if (it.auto === undefined && !it.override) return it;
      const x = scoreItem(it.id, it.group, it.title, it.weight, auto, it.detail, it.ref, it.verdict === 'NA');
      return { ...x, weight: it.weight };
    }
    const x = scoreItem(it.id, it.group, it.title, it.weight, o.score, it.detail, it.ref);
    return { ...x, weight: it.weight, auto, override: { score: clamp(o.score, 0, 1), note: o.note } };
  });
  return summarise(items);
}

export function summarise(items: ScoreItem[]): AssessmentResult {
  const scored = items.filter((i) => i.verdict !== 'NA');
  const max = scored.reduce((m, i) => m + i.weight, 0);
  const total = scored.reduce((m, i) => m + i.weight * i.score, 0);
  const groups: AssessmentResult['groups'] = [];
  for (const it of scored) {
    let gr = groups.find((x) => x.group === it.group);
    if (!gr) {
      gr = { group: it.group, pct: 0, weight: 0 };
      groups.push(gr);
    }
    gr.weight += it.weight;
    gr.pct += it.weight * it.score;
  }
  for (const gr of groups) gr.pct = gr.weight ? (100 * gr.pct) / gr.weight : 0;
  return { total, max, pct: max ? (100 * total) / max : 0, items, groups: groups.filter((g) => g.weight > 0) };
}

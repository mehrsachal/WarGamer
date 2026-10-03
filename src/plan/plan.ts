// Plan model helpers: resource slots, the DS-style automatic plan, and the
// time & space (workload) estimate used for defence readiness.

import { DOCTRINE, WORK_NORMS } from '../core/doctrine';
import {
  type Vec,
  add,
  bearing,
  centroid,
  clamp,
  dist,
  distToPolyline,
  fromBearing,
  norm,
  pointAlong,
  polylineIntersection,
  polylineLength,
  resample,
  scale,
  sub,
} from '../core/geom';
import { uid } from '../core/rng';
import { dayNightHours } from '../core/time';
import type { Approach, ContingencyPlan, Plan, PlanGraphic, PlacedUnit, Role, Scenario } from '../core/types';
import { TEMPLATES } from '../core/units';
import { defaultArea, isAreaUnit } from './area';
import { REORG_CORRECT } from './contingency';

export interface ResourceSlot {
  templateKey: string;
  index: number;
  label: string;
  status: string;
  note?: string;
}

const PL_NAMES = ['1 Pl', '2 Pl', '3 Pl', '4 Pl'];
const COY_NAMES = ['A Coy', 'B Coy', 'C Coy', 'D Coy'];
const BN_NAMES = ['1st Bn', '2nd Bn', '3rd Bn', '4th Bn'];
const SEC_NAMES = ['1 Sec', '2 Sec', '3 Sec'];

export function slotLabel(templateKey: string, i: number, count: number): string {
  const t = TEMPLATES[templateKey];
  if (templateKey === 'RIFLE_PL') return PL_NAMES[i] ?? `${i + 1} Pl`;
  if (templateKey === 'RIFLE_COY') return COY_NAMES[i] ?? `Coy ${i + 1}`;
  if (templateKey === 'INF_BN') return BN_NAMES[i] ?? `Bn ${i + 1}`;
  if (templateKey === 'RIFLE_SEC' && count === 3) return SEC_NAMES[i];
  if (templateKey === 'RIFLE_SEC') return count > 1 ? `SP ${i + 1}` : 'Standing Ptl';
  if (templateKey === 'LP') return count > 1 ? `LP ${i + 1}` : 'LP';
  return count > 1 ? `${t?.short ?? templateKey} ${i + 1}` : t?.short ?? templateKey;
}

export function resourceSlots(s: Scenario): ResourceSlot[] {
  const out: ResourceSlot[] = [];
  for (const r of s.own.resources) {
    for (let i = 0; i < r.count; i++) out.push({ templateKey: r.templateKey, index: i, label: slotLabel(r.templateKey, i, r.count), status: r.status, note: r.note });
  }
  return out;
}

export function defaultRole(templateKey: string): Role {
  switch (templateKey) {
    case 'RIFLE_PL':
    case 'RIFLE_COY':
    case 'INF_BN':
    case 'RIFLE_SEC':
      return 'FDL';
    case 'SCREEN_PL':
      return 'SCREEN';
    case 'LP':
      return 'LP';
    case 'CHQ':
    case 'BN_HQ':
    case 'BDE_HQ':
    case 'PL_HQ':
      return 'CHQ';
    case 'CP':
      return 'CP';
    case 'ARTY_OBS':
    case 'MOR_OBS':
      return 'OBS';
    case 'QC_DET':
      return 'QC';
    case 'ASLT_PNR_SEC':
      return 'ENGR';
    case 'TK_SQN':
      return 'RES';
    default:
      return 'SP_WPN';
  }
}

export function emptyPlan(): Plan {
  return {
    units: [],
    graphics: [],
    appreciation: { approachOrder: [], itgOrder: [], lineOrder: [], fdlLine: '', depthLine: '', bias: '', enMostLikelyApproach: '', priorityOfWork: [], text: {} },
    contingency: {},
    qcSorties: [],
    updatedAt: Date.now(),
  };
}

/** Recommended (DS) contingency choices — also the default "school" answers for auto mode. */
export function dsContingency(spUnitId?: string, catkUnitId?: string): ContingencyPlan {
  return {
    SCREEN_CONTACT: { option: 'ENGAGE_WITHDRAW' },
    EN_PROBE: { option: 'MIN_FIRE_ALT' },
    EN_ASSEMBLY: { option: 'DF_FAA' },
    EN_FORMING_UP: { option: 'SPOIL_FIRE', unitId: spUnitId },
    EN_ASSAULT: { option: 'SOS_READJUST' },
    POST_LOST: { option: 'LOCAL_CATK', unitId: catkUnitId, delayMin: 15 },
    LOCALITY_LOST: { option: 'CPEN_HIGHER' },
    REORG: { option: REORG_CORRECT.join(',') },
  };
}

// ---------------------------------------------------------------------------- auto plan

/** Threat bearing from a position: towards the nearest approach ~1.2 km ahead. */
export function threatBearing(s: Scenario, p: Vec): number {
  const pri = [...s.ds.approaches].sort((a, b) => a.pri - b.pri);
  let best: Vec | null = null;
  let bestD = Infinity;
  for (const a of pri) {
    for (const q of resample(a.path, 100)) {
      if (q.y < p.y + 300) continue;
      const d = Math.abs(dist(p, q) - 1200);
      const w = d + a.pri * 150;
      if (w < bestD) {
        bestD = w;
        best = q;
      }
    }
  }
  return best ? bearing(p, best) : 0;
}

function crossing(a: Approach, line: Vec[]): Vec {
  const x = polylineIntersection(a.path, line);
  if (x) return x;
  // nearest approach point to the line
  let best = a.path[0];
  let bd = Infinity;
  for (const p of resample(a.path, 50)) {
    const d = distToPolyline(p, line).d;
    if (d < bd) {
      bd = d;
      best = p;
    }
  }
  return best;
}

/** Point on the approach `d` metres ahead (north) of a reference y. */
function aheadOn(a: Approach, refY: number, d: number): Vec {
  const pts = resample(a.path, 25);
  let best = pts[0];
  let bd = Infinity;
  for (const p of pts) {
    const e = Math.abs(p.y - refY - d);
    if (e < bd) {
      bd = e;
      best = p;
    }
  }
  return best;
}

function offsetTowards(from: Vec, to: Vec, d: number): Vec {
  return add(from, scale(norm(sub(to, from)), d));
}

/**
 * Builds a sound, doctrinally reasonable plan from the DS appreciation. Used to show the
 * DS solution to instructors, for auto-play demos and to calibrate the wargame.
 */
export function autoPlan(s: Scenario): Plan {
  const plan = emptyPlan();
  const ds = s.ds;
  const lvl = s.level;
  const k = lvl === 'PL' ? 0.5 : lvl === 'COY' ? 1 : lvl === 'BN' ? 2.2 : 4;
  const fdlLine = ds.linesOfDef.find((l) => l.id === ds.recommendedFdl) ?? ds.linesOfDef[0];
  const depthLine = ds.linesOfDef.find((l) => l.id === ds.recommendedDepth);
  const pri = [...ds.approaches].sort((a, b) => a.pri - b.pri);
  const a1 = pri[0];
  const a2 = pri[1] ?? pri[0];
  const itgOn = (line: typeof fdlLine | undefined) => (line ? ds.itgs.filter((i) => line.itgIds.includes(i.id)) : []);
  const fdlItgs = itgOn(fdlLine);
  const fdlPts = fdlLine?.pts ?? [{ x: 0, y: s.terrain.height / 2 }, { x: s.terrain.width, y: s.terrain.height / 2 }];
  const fdlY = fdlPts.reduce((m, p) => m + p.y, 0) / fdlPts.length;
  const c1 = crossing(a1, fdlPts);
  const c2 = crossing(a2, fdlPts);
  const pickNear = (p: Vec, exclude: Vec[] = [], minSep = 400 * k): Vec => {
    const cands = fdlItgs.map((i) => i.pos).filter((q) => exclude.every((e) => dist(e, q) >= minSep));
    const best = cands.sort((a, b) => dist(a, p) - dist(b, p))[0];
    return best && dist(best, p) < 900 * k ? best : p;
  };
  const slots = resourceSlots(s);
  const take = (key: string) => {
    const i = slots.findIndex((x) => x.templateKey === key);
    if (i < 0) return null;
    return slots.splice(i, 1)[0];
  };
  const place = (key: string, pos: Vec, role: Role, extra: Partial<PlacedUnit> = {}): PlacedUnit | null => {
    const sl = take(key);
    if (!sl) return null;
    const p = { x: clamp(pos.x, 30, s.terrain.width - 30), y: clamp(pos.y, 30, s.terrain.height - 30) };
    const u: PlacedUnit = { id: uid('u'), templateKey: key, label: sl.label, pos: p, facing: extra.facing ?? threatBearing(s, p), role, ...extra };
    plan.units.push(u);
    return u;
  };
  const altFor = (pos: Vec, facing: number) => {
    const lateral = fromBearing(facing + (pos.x < s.terrain.width / 2 ? -90 : 90));
    return add(pos, scale(lateral, 250 * Math.max(1, k * 0.7)));
  };

  const mainKey = lvl === 'PL' ? 'RIFLE_SEC' : lvl === 'COY' ? 'RIFLE_PL' : lvl === 'BN' ? 'RIFLE_COY' : 'INF_BN';
  const fwd: PlacedUnit[] = [];
  let depth: PlacedUnit | null = null;

  if (lvl === 'PL') {
    // pl locality three secs up around the vital ground, facing the threat
    const centre = pickNear(c1);
    const f = threatBearing(s, centre);
    const fv = fromBearing(f);
    const lv = fromBearing(f - 90);
    const spots = [add(add(centre, scale(lv, 110)), scale(fv, 20)), add(centre, scale(fv, 40)), add(add(centre, scale(lv, -110)), scale(fv, 20))];
    for (const sp of spots) {
      const u = place('RIFLE_SEC', sp, 'FDL', { facing: f });
      if (u) {
        u.altPos = add(sp, scale(fv, -90));
        fwd.push(u);
      }
    }
    place('PL_HQ', add(centre, scale(fv, -70)), 'CHQ', { facing: f });
    place('MG_DET', add(centre, scale(fv, 30)), 'SP_WPN', { facing: f, parentId: fwd[1]?.id });
    place('RR_DET', add(add(centre, scale(lv, 60 * (c1.x < centre.x ? 1 : -1))), scale(fv, -20)), 'SP_WPN', { facing: f, parentId: fwd[0]?.id });
    place('LP', add(centre, scale(fv, 380)), 'LP', { facing: f, parentId: fwd[1]?.id });
    place('QC_DET', add(centre, scale(fv, -110)), 'QC', { facing: f });
    place('MOR_OBS', add(centre, scale(fv, 10)), 'OBS', { facing: f });
    depth = fwd[1] ?? null;
  } else {
    const p1 = pickNear(c1);
    let p2 = pickNear(c2, [p1]);
    if (dist(p1, p2) < 350 * k) {
      // both approaches cross close together — second locality on the other side of p1
      const dir = p1.x < (fdlPts[0].x + fdlPts[fdlPts.length - 1].x) / 2 ? 1 : -1;
      p2 = pickNear({ x: p1.x + dir * 800 * k, y: p1.y }, [p1]);
      if (dist(p1, p2) < 350 * k) p2 = { x: p1.x + dir * 800 * k, y: p1.y };
    }
    const f1 = threatBearing(s, p1);
    const f2 = threatBearing(s, p2);
    const u1 = place(mainKey, p1, 'FDL', { facing: f1, altPos: altFor(p1, f1) });
    const u2 = place(mainKey, p2, 'FDL', { facing: f2, altPos: altFor(p2, f2) });
    if (u1) fwd.push(u1);
    if (u2) fwd.push(u2);
    // depth: behind the fwd localities, biased to the pri approach
    const mid = { x: p1.x * 0.65 + p2.x * 0.35, y: Math.min(p1.y, p2.y) - 700 * k };
    let dpos = mid;
    if (depthLine) {
      const cands = itgOn(depthLine).map((i) => i.pos).filter((q) => q.y < fdlY - 250 * k);
      const best = cands.sort((a, b) => dist(a, mid) - dist(b, mid))[0];
      if (best && dist(best, mid) < 1000 * k) dpos = best;
    }
    const fd = threatBearing(s, dpos);
    depth = place(mainKey, dpos, 'DEPTH', { facing: fd, altPos: altFor(dpos, fd) });
    if (lvl === 'BN') place('RIFLE_COY', { x: p2.x * 0.6 + p1.x * 0.4, y: dpos.y - 300 * k }, 'DEPTH');
    if (lvl === 'BDE') place('TK_SQN', { x: (p1.x + p2.x) / 2, y: dpos.y - 1500 }, 'RES');

    // weapons and detachments
    const lat = (p: Vec, f: number, d: number) => add(p, scale(fromBearing(f - 90), d));
    const towardsA1 = c1.x < p1.x ? 1 : -1;
    if (lvl === 'COY') {
      place('RR_DET', lat(p1, f1, 90 * towardsA1), 'SP_WPN', { facing: f1, parentId: u1?.id });
      place('RR_DET', lat(p2, f2, -90 * towardsA1), 'SP_WPN', { facing: f2, parentId: u2?.id });
      place('BS_DET', lat(p1, f1, 200 * towardsA1 * -1), 'SP_WPN', { facing: bearing(lat(p1, f1, -200 * towardsA1), aheadOn(a1, fdlY, 900)), parentId: u1?.id });
      if (depth) place('BS_DET', add(depth.pos, { x: 120 * towardsA1, y: 60 }), 'SP_WPN', { facing: bearing(depth.pos, aheadOn(a1, fdlY, 600)), parentId: depth.id });
      place('GLHMG_DET', lat(p1, f1, -60 * towardsA1), 'SP_WPN', { facing: f1, parentId: u1?.id });
      if (depth) place('MOR60_SEC', add(depth.pos, { x: 0, y: -160 }), 'SP_WPN', { facing: fd, parentId: depth.id });
      if (depth) place('CHQ', add(depth.pos, { x: -140 * towardsA1, y: -120 }), 'CHQ');
      place('CP', add(p1, scale(fromBearing(f1), 30)), 'CP', { parentId: u1?.id });
      place('ARTY_OBS', add(p1, { x: 15, y: 10 }), 'OBS', { parentId: u1?.id });
      place('MOR_OBS', add(p2, { x: 15, y: 10 }), 'OBS', { parentId: u2?.id });
      if (depth) place('QC_DET', add(depth.pos, { x: -60, y: -200 }), 'QC');
      if (depth) place('ASLT_PNR_SEC', add(depth.pos, { x: 100, y: -220 }), 'ENGR');
    } else {
      place(lvl === 'BN' ? 'BN_HQ' : 'BDE_HQ', { x: dpos.x - 300 * k * towardsA1, y: dpos.y - 500 * k }, 'CHQ');
      place('CP', add(p1, scale(fromBearing(f1), -150 * k)), 'CP', { parentId: u1?.id });
      place('ATGM_PL', add(lat(p1, f1, 300 * towardsA1), scale(fromBearing(f1), -100 * k)), 'SP_WPN', { facing: f1 });
      if (lvl === 'BDE') place('ATGM_PL', add(depth?.pos ?? dpos, { x: 300 * towardsA1, y: 200 }), 'SP_WPN');
      if (lvl === 'BN') place('MOR81_PL', { x: dpos.x + 300 * towardsA1, y: dpos.y - 300 * k }, 'SP_WPN');
      place('ARTY_OBS', add(p1, { x: 20, y: 20 }), 'OBS', { parentId: u1?.id });
      place('ARTY_OBS', add(p2, { x: 20, y: 20 }), 'OBS', { parentId: u2?.id });
      place('ARTY_OBS', add(depth?.pos ?? dpos, { x: 20, y: 20 }), 'OBS');
      place('QC_DET', { x: dpos.x, y: dpos.y - 250 * k }, 'QC');
      place('QC_DET', { x: p2.x, y: p2.y - 300 * k }, 'QC');
      place('QC_DET', { x: p1.x, y: p1.y - 300 * k }, 'QC');
      for (let i = 0; i < 3; i++) place('ASLT_PNR_SEC', { x: dpos.x + (i - 1) * 120, y: dpos.y - 400 * k }, 'ENGR');
    }
    // screens on the ground ahead (DS screen area), standing ptl short of the most likely FUP, LPs ahead of fwd localities
    if (ds.screenArea) {
      const sp = ds.screenArea.pos;
      const scrPos = aheadOn(a1, fdlY, Math.max(900 * k, Math.min(sp.y - fdlY, 2600 * k)));
      const near = ds.itgs.filter((i) => i.pos.y > fdlY + 600 * k).sort((a, b) => dist(a.pos, scrPos) - dist(b.pos, scrPos))[0];
      const sPos = near && dist(near.pos, scrPos) < 900 * k ? near.pos : scrPos;
      place(lvl === 'BDE' ? 'RIFLE_COY' : 'SCREEN_PL', sPos, 'SCREEN', { altPos: offsetTowards(sPos, p1, 300) });
    }
    const fup1 = ds.likelyFUPs.find((f) => f.approachId === a1.id) ?? ds.likelyFUPs[0];
    if (fup1) {
      const spPos = offsetTowards(fup1.pos, p1, Math.min(350 * k, dist(fup1.pos, p1) * 0.3));
      place(lvl === 'BDE' ? 'RIFLE_PL' : 'RIFLE_SEC', spPos, 'SP_PTL', { parentId: depth?.id, facing: bearing(spPos, fup1.pos) });
      if (lvl === 'BN' || lvl === 'BDE') {
        const fup2 = ds.likelyFUPs.find((f) => f.approachId === a2.id);
        if (fup2 && fup2 !== fup1) {
          const sp2 = offsetTowards(fup2.pos, p2, Math.min(350 * k, dist(fup2.pos, p2) * 0.3));
          place(lvl === 'BDE' ? 'RIFLE_PL' : 'RIFLE_SEC', sp2, 'SP_PTL', { parentId: depth?.id, facing: bearing(sp2, fup2.pos) });
        }
      }
    }
    if (lvl === 'COY') {
      for (const u of fwd) place('LP', add(u.pos, scale(fromBearing(u.facing), 380)), 'LP', { parentId: u.id, facing: u.facing });
    }
  }

  // ---------------------------------------------------------------- graphics
  const g = (kind: PlanGraphic['kind'], pts: Vec[], props: PlanGraphic['props'] = {}) => plan.graphics.push({ id: uid('g'), kind, pts, props });
  const aorBox = s.own.aor;
  const minX = Math.min(...aorBox.map((p) => p.x)) + 20;
  const maxX = Math.max(...aorBox.map((p) => p.x)) - 20;
  if (fwd.length) {
    const xs = fwd.map((u) => u.pos.x);
    const lo = lvl === 'PL' ? Math.min(...xs) - 60 : minX;
    const hi = lvl === 'PL' ? Math.max(...xs) + 60 : maxX;
    const ys = fwd.map((u) => u.pos.y);
    g('FDL', [{ x: lo, y: ys[0] + 30 }, ...fwd.map((u) => add(u.pos, { x: 0, y: 30 })).sort((a, b) => a.x - b.x), { x: hi, y: ys[ys.length - 1] + 30 }].sort((a, b) => a.x - b.x));
  }
  const fwdAnchor = fwd[0]?.pos ?? c1;
  const ka1 = aheadOn(a1, fdlY, 330 * k);
  g('KILL_AREA', boxAround(ka1, 420 * k, 300 * k), { subtype: 'PRIMARY', label: 'KA 1' });
  if (a2 !== a1) g('KILL_AREA', boxAround(aheadOn(a2, fdlY, 330 * k), 360 * k, 260 * k), { subtype: 'SECONDARY', label: 'KA 2' });
  // obstacles
  if (lvl !== 'BDE') {
    for (const u of fwd) {
      const f = fromBearing(u.facing);
      const l = fromBearing(u.facing - 90);
      const c = add(u.pos, scale(f, 170 * Math.max(0.6, k * 0.8)));
      g('MINEFIELD', [add(c, scale(l, 180 * k)), add(c, scale(l, -180 * k))], { subtype: 'PROTECTIVE', label: 'Prot Mfd' });
      const w = add(u.pos, scale(f, 70));
      g('WIRE', [add(w, scale(l, 110 * Math.max(0.6, k))), add(w, scale(l, -110 * Math.max(0.6, k)))], { label: 'Wire' });
    }
  }
  if (lvl !== 'PL') {
    const tm = aheadOn(a1, fdlY, 450 * k);
    const l = fromBearing(bearing(fwdAnchor, tm) - 90);
    g('MINEFIELD', [add(tm, scale(l, 250 * k)), add(tm, scale(l, -250 * k))], { subtype: 'TACTICAL', label: 'Tac Mfd (A tk)' });
  }
  // DFs
  let dfNo = 0;
  let sosNo = 0;
  const df = (pos: Vec, subtype: string, label: string, sos = false) => g('DF', [pos], { subtype, label: sos ? `SOS ${++sosNo}` : `DF ${++dfNo}`, sos, radius: subtype === 'MOR60' ? 75 : 150, text: label });
  df(aheadOn(a1, fdlY, 300 * k), 'ARTY', a1.name.split(' ')[0], true);
  if (s.own.fire.mor81) df(aheadOn(a2, fdlY, 280 * k), 'MOR81', a2.name.split(' ')[0], true);
  for (const f of ds.likelyFUPs.slice(0, 3)) df(f.pos, 'ARTY', f.name);
  for (const f of ds.likelyFAAs.slice(0, 2)) df(f.pos, 'ARTY', f.name);
  for (const f of ds.likelyBOFs.slice(0, 1)) df(f.pos, s.own.fire.mor81 ? 'MOR81' : 'ARTY', f.name);
  if (lvl === 'COY' && fwd[1]) df(add(fwd[1].pos, scale(fromBearing(fwd[1].facing), 220)), 'MOR60', 'close');
  // C attk & counter penetration
  if (depth && lvl !== 'PL') {
    fwd.forEach((u, i) => {
      const sl = offsetTowards(depth!.pos, u.pos, dist(depth!.pos, u.pos) * 0.4);
      const flank = add(sl, scale(fromBearing(u.facing + (i === 0 ? -90 : 90)), 150 * k));
      g('CATK', [depth!.pos, flank, u.pos], { priority: i + 1, unitId: depth!.id, label: `C Attk ${i + 1}` });
    });
    const cp = { x: (depth.pos.x + fwdAnchor.x) / 2, y: (depth.pos.y + fwdAnchor.y) / 2 };
    g('CPEN', [cp], { unitId: depth.id, label: 'C Pen' });
  }
  // QC surveillance area over the most likely FUP/FAA
  const q1 = ds.likelyFUPs.find((f) => f.approachId === a1.id) ?? ds.likelyFUPs[0];
  if (q1) {
    g('QC_AREA', [q1.pos], { radius: 600 * Math.max(1, k * 0.7), label: `QC ${q1.name}` });
    const qa = plan.graphics[plan.graphics.length - 1];
    const ll = s.times.light.lastLight;
    plan.qcSorties = [
      { start: s.times.enCrossBorder + 60, areaId: qa.id },
      { start: Math.floor(s.times.hHour / 1440) * 1440 + ll - 45, areaId: qa.id },
      { start: Math.floor(s.times.hHour / 1440) * 1440 + ll + 60, areaId: qa.id },
    ];
  }

  // ---------------------------------------------------------------- appreciation & contingencies
  plan.appreciation = {
    approachOrder: pri.map((a) => a.id),
    itgOrder: [...ds.itgs].sort((a, b) => a.pri - b.pri).map((i) => i.id),
    lineOrder: [...ds.linesOfDef].sort((a, b) => a.pri - b.pri).map((l) => l.id),
    fdlLine: fdlLine?.id ?? '',
    depthLine: depthLine?.id ?? '',
    bias: a1.flank,
    enMostLikelyApproach: a1.id,
    priorityOfWork: [...DOCTRINE.priorityOfWork],
    text: { aim: `To take up def within the given bdrys as far fwd as tac feasible, ready by first lt D Day.` },
  };
  // goose eggs for the localities, sized from doctrine and oriented to their facing
  for (const u of plan.units) if (isAreaUnit(u)) u.area = defaultArea(u);
  const sp = plan.units.find((u) => u.role === 'SP_PTL');
  plan.contingency = dsContingency(sp?.id, depth && lvl !== 'PL' ? depth.id : fwd[1]?.id);
  plan.updatedAt = Date.now();
  return plan;
}

function boxAround(c: Vec, w: number, h: number): Vec[] {
  return [
    { x: c.x - w / 2, y: c.y - h / 2 },
    { x: c.x + w / 2, y: c.y - h / 2 },
    { x: c.x + w / 2, y: c.y + h / 2 },
    { x: c.x - w / 2, y: c.y + h / 2 },
  ];
}

// ---------------------------------------------------------------------------- time & space

export interface Workload {
  availDay: number;
  availNight: number;
  available: number;
  required: number;
  readiness: number;
  items: { label: string; hrs: number }[];
  minesM: number;
  wireM: number;
  pnrSecs: number;
}

export function workload(s: Scenario, plan: Plan): Workload {
  const { day, night } = dayNightHours(s.times.now, s.times.defReady, s.times.light);
  const minesM = plan.graphics.filter((g) => g.kind === 'MINEFIELD').reduce((m, g) => m + polylineLength(g.pts), 0);
  const wireM = plan.graphics.filter((g) => g.kind === 'WIRE').reduce((m, g) => m + polylineLength(g.pts), 0);
  const pnrSecs = Math.max(0, plan.units.filter((u) => u.templateKey === 'ASLT_PNR_SEC').length);
  const scale = s.level === 'BN' ? 1.15 : s.level === 'BDE' ? 1.3 : s.level === 'PL' ? 0.8 : 1;
  const hasAlt = plan.units.some((u) => u.altPos);
  const hasCatk = plan.graphics.some((g) => g.kind === 'CATK');
  const items = [
    { label: 'Battle procedure (all lvls)', hrs: WORK_NORMS.battleProcedureHrs * scale },
    { label: 'Mov & occupation', hrs: WORK_NORMS.occupationHrs * scale },
    { label: 'Prep of main def (digging)', hrs: WORK_NORMS.digMainDefHrs * scale },
    { label: 'Clearance of F of F', hrs: WORK_NORMS.clearFofHrs },
    { label: 'OHP, cam & clt', hrs: WORK_NORMS.ohpCamHrs },
    ...(hasAlt ? [{ label: 'Prep of altn posns', hrs: WORK_NORMS.altPosnHrs }] : []),
    ...(hasCatk ? [{ label: 'C attk rehearsals', hrs: WORK_NORMS.rehearsalHrs }] : []),
  ];
  const troops = items.reduce((m, i) => m + i.hrs, 0);
  // mines & wire are laid concurrently by the aslt pnrs (with inf working parties if no pnrs)
  const layers = Math.max(1, pnrSecs);
  const obsHrs = minesM / (WORK_NORMS.minesPerSecHr * layers) + wireM / (WORK_NORMS.wirePerSecHr * layers) + (pnrSecs === 0 && minesM + wireM > 0 ? 6 : 0);
  const pnr = WORK_NORMS.battleProcedureHrs * 0.5 + WORK_NORMS.occupationHrs + obsHrs;
  const required = Math.max(troops, pnr);
  if (obsHrs > 0) items.push({ label: `Obs (${Math.round(minesM)} m mfd, ${Math.round(wireM)} m wire)`, hrs: obsHrs });
  const available = day + night * 0.8;
  return { availDay: day, availNight: night, available, required, readiness: clamp(available / Math.max(1, required), 0, 1), items, minesM, wireM, pnrSecs };
}

export function centroidOfUnits(units: PlacedUnit[]): Vec {
  return centroid(units.map((u) => u.pos));
}

export { pointAlong };

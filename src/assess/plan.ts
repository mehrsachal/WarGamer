// Objective assessment of a defensive plan against ICIB doctrine and the DS appreciation.
// Every item is a measurable check on the marked plan (distances, LOS, counts, order),
// so two DS marking the same plan get the same result.

import { DOCTRINE, REF, WORK_ITEMS } from '../core/doctrine';
import {
  type Vec,
  angleDiff,
  bearing,
  clamp,
  dist,
  distToPolyline,
  pointInPolygon,
  polylineIntersection,
  polylineLength,
  resample,
} from '../core/geom';
import type { AssessmentResult, OpsLevel, Plan, PlacedUnit, ScoreItem, Scenario } from '../core/types';
import { TEMPLATES, WEAPONS } from '../core/units';
import { CONTINGENCIES, REORG_CORRECT } from '../plan/contingency';
import { workload } from '../plan/plan';
import { terrainFor } from '../terrain/terrain';
import { evaluateDecision, type DecisionContext } from './decisions';

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

function item(id: string, group: string, title: string, weight: number, score: number, detail: string, ref: string, na = false): ScoreItem {
  const s = clamp(score, 0, 1);
  return { id, group, title, weight: na ? 0 : weight, score: na ? 0 : s, verdict: na ? 'NA' : s >= 0.8 ? 'PASS' : s >= 0.4 ? 'PARTIAL' : 'FAIL', detail, ref };
}

/** Kendall-style agreement between two orderings (1 = identical). */
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

function band(v: number, lo: number, hi: number, soft: number): number {
  if (v >= lo && v <= hi) return 1;
  const off = v < lo ? lo - v : v - hi;
  return clamp(1 - off / soft, 0, 1);
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
    const maxY = Math.max(...locs.map((u) => u.pos.y));
    fwd = locs.filter((u) => u.pos.y > maxY - n.depth[0]);
    depth = locs.filter((u) => !fwd.includes(u));
  }
  const g = plan.graphics.find((x) => x.kind === 'FDL' && x.pts.length >= 2);
  const line = g ? [...g.pts].sort((a, b) => a.x - b.x) : fwd.map((u) => u.pos).sort((a, b) => a.x - b.x);
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

export function assessPlan(s: Scenario, plan: Plan): AssessmentResult {
  const t = terrainFor(s.id, s.terrain, s.weather.going === 'wet');
  const n = NORMS[s.level];
  const ds = s.ds;
  const lvl = s.level;
  const items: ScoreItem[] = [];
  const G = planGeometry(s, plan);
  const { fwd, depth, locs, fdlYAt } = G;
  const pri = [...ds.approaches].sort((a, b) => a.pri - b.pri);
  const a1 = pri[0];
  const ahead = (p: Vec) => p.y - fdlYAt(p.x);
  const units = (key: string) => plan.units.filter((u) => u.templateKey === key);
  const byRole = (r: string) => plan.units.filter((u) => u.role === r);
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

  // ================================================================ A. Appreciation
  {
    const g = 'Appreciation';
    const dsA = pri.map((a) => a.id);
    const ag = orderAgreement(app.approachOrder, dsA);
    items.push(item('APCH_PRI', g, 'Pri of apchs', 4, app.approachOrder.length ? ag : 0, app.approachOrder.length ? `Your order: ${app.approachOrder.map((id) => ds.approaches.find((a) => a.id === id)?.name ?? id).join(' > ')}. DS: ${pri.map((a) => a.name).join(' > ')}.` : 'Pri of apchs not recorded.', REF.COY_CONSIDERATIONS));
    const dsI = [...ds.itgs].sort((a, b) => a.pri - b.pri).map((i) => i.id);
    const top3 = dsI.slice(0, 3);
    const stTop = app.itgOrder.slice(0, 3);
    const overlap = stTop.filter((x) => top3.includes(x)).length / 3;
    const ig = app.itgOrder.length ? 0.5 * overlap + 0.5 * orderAgreement(app.itgOrder, dsI) : 0;
    items.push(item('ITG_PRI', g, 'Pri of ITGs', 3, ig, app.itgOrder.length ? `Your top 3: ${stTop.map((id) => ds.itgs.find((i) => i.id === id)?.name ?? id).join(', ')}. DS top 3: ${top3.map((id) => ds.itgs.find((i) => i.id === id)?.name).join(', ')}.` : 'Pri of ITGs not recorded.', REF.COY_CONSIDERATIONS));
    const chosen = ds.linesOfDef.find((l) => l.id === app.fdlLine);
    let ls = 0;
    let ld = 'Line of FDLs not selected in the aprc.';
    if (chosen) {
      if (chosen.id === ds.recommendedFdl) {
        ls = 1;
        ld = `${chosen.name} — as DS.`;
      } else {
        const cy = chosen.pts.reduce((m, p) => m + p.y, 0) / chosen.pts.length;
        const space = aorFront - cy;
        ls = space >= n.screenSpace * 0.7 && chosen.pri <= 2 ? 0.65 : 0.3;
        ld = `${chosen.name} (DS: ${recLine?.name ?? '-'}). ${ls > 0.5 ? 'A viable alternative if logically developed.' : 'Less suitable — see DS deductions.'}`;
      }
    }
    items.push(item('LINE_SEL', g, 'Sel of line of def', 3, ls, ld, REF.IE_SOLN));
    items.push(item('EN_MLA', g, 'En most likely apch (APs)', 2, app.enMostLikelyApproach === a1.id ? 1 : app.enMostLikelyApproach ? 0.3 : 0, app.enMostLikelyApproach ? `You assessed ${ds.approaches.find((a) => a.id === app.enMostLikelyApproach)?.name}; DS ${a1.name}.` : 'En most likely apch not recorded.', REF.FOXLAND_ATTACK));
    items.push(item('BIAS', g, 'Bias of def / A tk def', 1, app.bias === a1.flank ? 1 : app.bias ? 0.3 : 0, `Bias ${app.bias || 'not stated'}; DS ${a1.flank}.`, REF.IE_SOLN));
    const pw = app.priorityOfWork.length ? orderAgreement(app.priorityOfWork, [...DOCTRINE.priorityOfWork]) : 0;
    items.push(item('POW', g, 'Pri of work', 2, pw, app.priorityOfWork.length ? `First items: ${app.priorityOfWork.slice(0, 3).map((k) => WORK_ITEMS[k]?.label ?? k).join('; ')}.` : 'Pri of work not set.', REF.PRIORITY_OF_WORK));
  }

  // ================================================================ B. Localities
  {
    const g = 'Siting of localities';
    const placedLocs = locs.length;
    if (!placedLocs) {
      items.push(item('LOCS', g, `${n.locName.toUpperCase()} localities placed`, 20, 0, 'No localities placed.', REF.TWO_UP));
    } else {
      // far forward as tactically feasible
      const fwdY = fwd.reduce((m, u) => m + u.pos.y, 0) / Math.max(1, fwd.length);
      if (recY !== undefined) {
        const dy = fwdY - recY;
        const space = aorFront - fwdY;
        let sc: number;
        let d: string;
        if (dy >= -300 * n.k && space >= n.screenSpace * 0.8) {
          sc = 1;
          d = `FDLs ${Math.round(space)} m from the fwd edge of the AOR — as far fwd as tac feasible.`;
        } else if (dy > 0) {
          sc = space >= n.screenSpace * 0.6 ? 0.7 : 0.35;
          d = `FDLs ${Math.round(dy)} m fwd of the DS line; ${Math.round(space)} m left for screens.`;
        } else {
          sc = dy > -1000 * n.k ? 0.55 : 0.15;
          d = `FDLs ${Math.round(-dy)} m behind the DS line — gr is ceded to the en without a fight.`;
        }
        items.push(item('FWD', g, 'Def as far fwd as tac feasible', 4, sc, d, REF.BIC49));
      }
      items.push(item('SCREEN_SPACE', g, 'Space left for screens', 2, n.screenAhead ? band(aorFront - fwdY, n.screenSpace, 99999, n.screenSpace) : 1, `${Math.round(aorFront - fwdY)} m between FDLs and the fwd edge (need ≥ ${n.screenSpace} m).`, REF.SCREENS, !n.screenAhead));
      const vital = ds.itgs.find((i) => i.vital);
      if (vital) {
        const d = Math.min(...locs.map((u) => dist(u.pos, vital.pos)));
        items.push(item('VITAL', g, `Vital gr (${vital.name}) held`, 4, d <= n.vitalR ? 1 : d <= n.vitalR * 2.5 ? 0.5 : 0, d <= n.vitalR ? `${vital.name} is held by a locality.` : `Nearest locality ${Math.round(d)} m from ${vital.name}.`, REF.DEF_DEFINITIONS));
      }
      // approaches covered and not split
      let cov = 0;
      let wsum = 0;
      const covNotes: string[] = [];
      let split = 0;
      let splitN = 0;
      for (const a of pri) {
        const w = 1 / a.pri;
        wsum += w;
        const c = crossing(a);
        const ds2 = fwd.map((u) => dist(u.pos, c)).sort((x, y) => x - y);
        const near = ds2[0] ?? Infinity;
        const sc = near <= n.spacing[1] * 0.6 ? 1 : near <= n.spacing[1] ? 0.6 : 0.1;
        cov += w * sc;
        covNotes.push(`${a.name}: ${near === Infinity ? 'uncovered' : `${Math.round(near)} m`}`);
        if (ds2.length >= 2) {
          splitN++;
          const responsibilityDivided = ds2[0] > n.spacing[0] * 0.5 && Math.abs(ds2[1] - ds2[0]) < n.spacing[0] * 0.35;
          if (!responsibilityDivided) split++;
        }
      }
      items.push(item('APCH_COVER', g, 'Apchs covered by fwd localities', 3, cov / wsum, covNotes.join('; ') + '.', REF.COY_CONSIDERATIONS));
      items.push(item('APCH_SPLIT', g, 'Resp of an apch not divided b/w localities', 2, splitN ? split / splitN : 1, splitN && split < splitN ? 'An apch runs between two localities — responsibility is divided.' : 'Each apch is the clear resp of one locality.', REF.APPROACH_NOT_SPLIT, fwd.length < 2));
      // mutual support between adjacent fwd localities
      if (fwd.length >= 2) {
        const sorted = [...fwd].sort((a, b) => a.pos.x - b.pos.x);
        let ms = 0;
        const notes: string[] = [];
        for (let i = 1; i < sorted.length; i++) {
          const d = dist(sorted[i - 1].pos, sorted[i].pos);
          const los = t.los(sorted[i - 1].pos, sorted[i].pos, t.eyeHeight(sorted[i - 1].pos), 1.5) > 0.3 ? 1 : 0.6;
          const sc = band(d, n.spacing[0], n.spacing[1], n.spacing[1] * 0.6) * los;
          ms += sc;
          notes.push(`${sorted[i - 1].label}–${sorted[i].label} ${Math.round(d)} m${los < 1 ? ' (no LOS)' : ''}`);
        }
        items.push(item('MUTUAL', g, 'Mutual sp b/w localities', 4, ms / (sorted.length - 1), `${notes.join('; ')} (norm ${n.spacing[0]}-${n.spacing[1]} m).`, REF.MUTUAL_SUPPORT));
      } else items.push(item('MUTUAL', g, 'Mutual sp b/w localities', 4, 0, 'Only one fwd locality.', REF.MUTUAL_SUPPORT, lvl === 'PL' && fwd.length === 1));
      // depth
      if (lvl !== 'PL' || depth.length) {
        const best = depth
          .map((u) => {
            const behind = -ahead(u.pos);
            const lat = distToPolyline(u.pos, a1.path).d;
            return { u, sc: band(behind, n.depth[0], n.depth[1], n.depth[1] * 0.5) * (lat < n.spacing[1] ? 1 : 0.7), behind };
          })
          .sort((x, y) => y.sc - x.sc)[0];
        items.push(item('DEPTH', g, 'Depth', 4, best ? best.sc : 0, best ? `${best.u.label} ${Math.round(best.behind)} m behind the FDLs (norm ${n.depth[0]}-${n.depth[1]} m).` : 'No depth locality — the def can be overrun in one continuous attk.', REF.DEPTH));
      }
      // two up one in depth (three secs up at pl lvl)
      const total = fwd.length + depth.length;
      let tu: number;
      let tuD: string;
      if (lvl === 'PL') {
        tu = fwd.length === 3 ? 1 : fwd.length === 2 && depth.length === 1 ? 0.8 : 0.4;
        tuD = `${fwd.length} secs up, ${depth.length} in depth (pls usually deploy three secs up).`;
      } else {
        tu = fwd.length === 2 && depth.length >= 1 ? 1 : fwd.length >= 3 && total === fwd.length ? 0.6 : fwd.length === 1 && depth.length >= 1 ? 0.5 : 0.3;
        tuD = `${fwd.length} up, ${depth.length} in depth.`;
      }
      items.push(item('TWO_UP', g, lvl === 'PL' ? 'Secs up / depth' : 'Two up, one in depth', 2, tu, tuD, REF.TWO_UP));
      // frontage
      if (fwd.length >= 1) {
        const xs = fwd.map((u) => u.pos.x);
        const r = TEMPLATES[n.locKey].radius;
        const fr = Math.max(...xs) - Math.min(...xs) + 2 * r;
        items.push(item('FRONTAGE', g, 'Frontage', 1, band(fr, n.frontage[0], n.frontage[1], n.frontage[1] * 0.5), `${Math.round(fr)} m (norm ${n.frontage[0]}-${n.frontage[1]} m).`, REF.FRONTAGES));
      }
      const outside = plan.units.filter((u) => !pointInPolygon(u.pos, s.own.aor) && !['SCREEN', 'SP_PTL'].includes(u.role));
      items.push(item('IN_AOR', g, 'Within given bdrys', 2, outside.length ? clamp(1 - outside.length / 3, 0, 1) : 1, outside.length ? `Outside the AOR: ${outside.map((u) => u.label).join(', ')}.` : 'All posns within bdrys.', REF.DEF_DEFINITIONS));
      // field of fire from forward localities
      let fof = 0;
      for (const u of fwd) {
        let vis = 0;
        let tot = 0;
        for (let a = -45; a <= 45; a += 15) {
          for (const d of [150, 300, 450]) {
            const b = ((u.facing + a) * Math.PI) / 180;
            const p = { x: u.pos.x + Math.sin(b) * d * Math.max(1, n.k * 0.8), y: u.pos.y + Math.cos(b) * d * Math.max(1, n.k * 0.8) };
            tot++;
            if (t.los(u.pos, p, t.eyeHeight(u.pos), 1.2) > 0.4) vis++;
          }
        }
        fof += vis / Math.max(1, tot);
      }
      if (fwd.length) items.push(item('FOF', g, 'F of F of fwd localities', 2, clamp((fof / fwd.length) / 0.7, 0, 1), `${Math.round((100 * fof) / fwd.length)}% of the gr 150-450 m to the front is under direct fire (desired 270-500 m clear).`, REF.FIELD_OF_FIRE));
      const alt = fwd.filter((u) => u.altPos && dist(u.altPos, u.pos) >= DOCTRINE.altPosnMin * Math.min(1, n.k) && dist(u.altPos, u.pos) <= DOCTRINE.altPosnMax * Math.max(1, n.k));
      items.push(item('ALT', g, 'Altn posns (all-round def)', 2, fwd.length ? alt.length / fwd.length : 0, `${alt.length}/${fwd.length} fwd localities have altn posns ${DOCTRINE.altPosnMin}+ m away.`, `${REF.ALT_POSN}; ${REF.ALL_ROUND}`));
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
      const cov = at.filter((u) => distToPolyline(u.pos, a1.path).d <= range(u) * 0.8);
      items.push(item('AT_APCH', g, 'A tk wpns cover the most likely tk apch', 4, clamp(cov.length / Math.max(1, Math.min(2, atAvail)), 0, 1), `${cov.length} A tk wpn(s) within effective rg of the ${a1.name}.`, REF.AT_SITING));
      let obl = 0;
      for (const u of at) {
        const near = distToPolyline(u.pos, a1.path);
        const pts = resample(a1.path, 50);
        const idx = pts.findIndex((p) => dist(p, near.pt) < 60);
        const dir = idx > 0 ? bearing(pts[idx - 1], pts[idx]) : 180;
        const look = bearing(u.pos, near.pt);
        obl += angleDiff(look, (dir + 180) % 360) >= 30 ? 1 : 0.3;
      }
      items.push(item('AT_OBLIQUE', g, 'A tk fire oblique / enfilade', 2, at.length ? obl / at.length : 0, 'A tk wpns should engage the tk apch obliquely, not head-on.', REF.AT_SITING, !at.length));
      const prot = at.filter((u) => locs.some((l) => dist(l.pos, u.pos) <= 300 * Math.max(1, n.k * 0.6)) || t.coverAt(u.pos) >= 0.3);
      items.push(item('AT_PROT', g, 'A tk wpns protected / defiladed', 2, at.length ? prot.length / at.length : 0, `${prot.length}/${at.length} sited within a locality or in cover.`, REF.AT_SITING, !at.length));
      const atDepth = at.filter((u) => -ahead(u.pos) > 150 * n.k);
      items.push(item('AT_DEPTH', g, 'Depth in A tk def', 1, atDepth.length ? 1 : 0, atDepth.length ? 'A tk wpns sited in depth too.' : 'All A tk wpns on the FDLs — no depth to the A tk def.', REF.AT_SITING, at.length < 2));
    }
    const autos = plan.units.filter((u) => u.templateKey === 'GLHMG_DET' || u.templateKey === 'MG_DET');
    if (autos.length || s.own.resources.some((r) => r.templateKey === 'GLHMG_DET' || r.templateKey === 'MG_DET')) {
      const ok = autos.filter((u) => distToPolyline(u.pos, a1.path).d < (u.templateKey === 'GLHMG_DET' ? 1500 : 900) && ahead(u.pos) > -250 * n.k);
      items.push(item('MG_SITING', g, 'MG / GLHMG cover the most dangerous apch', 2, autos.length ? ok.length / autos.length : 0, autos.length ? `${ok.length}/${autos.length} sited to cover the ${a1.name}.` : 'Not placed.', `${REF.MG_SITING}; ${REF.RR_GLHMG}`));
    }
    const mors = plan.units.filter((u) => u.templateKey === 'MOR60_SEC' || u.templateKey === 'MOR81_PL');
    if (mors.length) {
      const ok = mors.filter((u) => -ahead(u.pos) >= 100 * n.k && -ahead(u.pos) <= (u.templateKey === 'MOR60_SEC' ? 900 : 3000) && (t.coverAt(u.pos) > 0.2 || t.concealAt(u.pos) > 0.3 || -ahead(u.pos) > 200));
      items.push(item('MORS', g, 'Mors in depth / defilade', 1, ok.length / mors.length, `${ok.length}/${mors.length} sited in depth within rg of the DFs.`, REF.DF_SELECTION));
    }
  }

  // ================================================================ D. Obstacles
  {
    const g = 'Obs plan';
    const mfd = plan.graphics.filter((x) => x.kind === 'MINEFIELD');
    const wire = plan.graphics.filter((x) => x.kind === 'WIRE');
    const minesAvail = s.own.fire.mines.apM + s.own.fire.mines.atM > 0;
    if (lvl !== 'BDE' || mfd.length) {
      if (!mfd.length) items.push(item('MFD', g, 'Mfds planned', 3, minesAvail ? 0 : 1, minesAvail ? 'No mfds planned although mines are aval.' : 'No mines aval.', REF.OBSTACLES));
      else {
        let covered = 0;
        for (const m of mfd) {
          const mid = m.pts[Math.floor(m.pts.length / 2)];
          const tac = m.props.subtype === 'TACTICAL' || m.props.subtype === 'DEFENSIVE';
          const coverers = tac ? plan.units.filter((u) => AT_KEYS.has(u.templateKey) || u.templateKey === n.locKey) : plan.units.filter((u) => u.templateKey === n.locKey || u.templateKey === 'MG_DET' || u.templateKey === 'GLHMG_DET');
          const maxR = tac ? 1100 * Math.max(1, n.k * 0.6) : n.mfdMax;
          const ok = coverers.some((u) => dist(u.pos, mid) <= maxR && t.los(u.pos, mid, t.eyeHeight(u.pos), 1) > 0.3);
          if (ok) covered++;
        }
        items.push(item('MFD_COVER', g, 'Mfds covered by fire', 3, covered / mfd.length, `${covered}/${mfd.length} mfds within rg & view of the wpns that must cover them (prot ≤ ${n.mfdMax} m by small arms; A tk mfd by A tk wpns).`, REF.OBSTACLES));
        const onApch = mfd.some((m) => polylineIntersection(m.pts, a1.path) || distToPolyline(m.pts[0], a1.path).d < 200 * n.k || distToPolyline(m.pts[m.pts.length - 1], a1.path).d < 200 * n.k);
        items.push(item('MFD_APCH', g, 'Obs across the most likely apch', 2, onApch ? 1 : 0.2, onApch ? `Obs sited across the ${a1.name}.` : `The ${a1.name} is not obstructed.`, REF.OBSTACLES));
        const len = mfd.reduce((m, x) => m + polylineLength(x.pts), 0);
        const budget = s.own.fire.mines.apM + s.own.fire.mines.atM;
        items.push(item('MFD_RES', g, 'Mfds within mines aval', 1, len <= budget * 1.05 ? 1 : clamp(budget / len, 0, 1), `${Math.round(len)} m planned vs ${budget} m of mines aval.`, REF.OBSTACLES));
      }
      if (wire.length) {
        let ok = 0;
        for (const w of wire) {
          const mid = w.pts[Math.floor(w.pts.length / 2)];
          const near = fwd.map((u) => dist(u.pos, mid)).sort((a, b) => a - b)[0] ?? Infinity;
          if (near >= DOCTRINE.wireMinAhead && near <= DOCTRINE.wireMaxAhead + TEMPLATES[n.locKey].radius) ok++;
        }
        items.push(item('WIRE', g, 'Wire outside grenade rg, covered by fire', 1, ok / wire.length, `${ok}/${wire.length} wire obs sited ${DOCTRINE.wireMinAhead}-${DOCTRINE.wireMaxAhead} m from the posts.`, REF.WIRE));
      }
    }
  }

  // ================================================================ E. Fire plan
  {
    const g = 'Fire plan';
    const dfs = plan.graphics.filter((x) => x.kind === 'DF');
    const sos = dfs.filter((d) => d.props.sos);
    const sosArty = sos.filter((d) => (d.props.subtype ?? 'ARTY') === 'ARTY');
    let sosScore = 0;
    let sosD = 'No DF (SOS) planned.';
    if (sosArty.length) {
      const d0 = sosArty[0].pts[0];
      const onApch = distToPolyline(d0, a1.path).d < 350 * Math.max(1, n.k * 0.6);
      const ah = ahead(d0);
      const near = Math.min(...plan.units.filter((u) => u.role === 'FDL' || u.role === 'DEPTH').map((u) => dist(u.pos, d0)));
      const posOk = ah >= DOCTRINE.dfSosMinAhead * Math.min(1, n.k) && ah <= DOCTRINE.dfSosMaxAhead * Math.max(1, n.k) && near >= 150;
      sosScore = (onApch ? 0.6 : 0.2) + (posOk ? 0.4 : 0.1) - (sosArty.length > 1 ? 0.2 : 0);
      sosD = `Arty DF (SOS) ${Math.round(ah)} m ahead of the FDLs${onApch ? ` on the ${a1.name}` : ' — not on the most vulnerable apch'}${near < 150 ? ' — DANGER CLOSE to own posn' : ''}${sosArty.length > 1 ? '; only one SOS per fire unit' : ''}.`;
    }
    items.push(item('SOS', g, 'DF (SOS) on the most vulnerable apch', 4, sosScore, sosD, REF.DF_SOS));
    const want = [...ds.likelyFUPs.filter((f) => f.approachId === a1.id), ...ds.likelyFAAs.filter((f) => f.approachId === a1.id), ...ds.likelyBOFs.filter((f) => f.approachId === a1.id), ...ds.likelyFUPs.filter((f) => f.approachId !== a1.id)];
    const hit = want.filter((w) => dfs.some((d) => dist(d.pts[0], w.pos) <= 400 * Math.max(1, n.k * 0.6)));
    items.push(item('DF_TGTS', g, 'DFs on likely FAA / FUP / BOF', 3, want.length ? hit.length / want.length : 1, `${hit.length}/${want.length} likely en depl areas picked up as DFs${want.length - hit.length ? ` (missed: ${want.filter((w) => !hit.includes(w)).map((w) => w.name).slice(0, 4).join(', ')})` : ''}.`, REF.DF_SELECTION));
    const perUnit = new Map<string, number>();
    for (const d of dfs) perUnit.set(d.props.subtype ?? 'ARTY', (perUnit.get(d.props.subtype ?? 'ARTY') ?? 0) + 1);
    const tooMany = [...perUnit.values()].some((v) => v > DOCTRINE.dfPerFireUnit + 2);
    items.push(item('DF_COUNT', g, 'No of DFs', 1, dfs.length >= 3 && !tooMany ? 1 : dfs.length ? 0.5 : 0, `${dfs.length} DFs (${[...perUnit.entries()].map(([k, v]) => `${k} ${v}`).join(', ') || 'nil'}); about ${DOCTRINE.dfPerFireUnit} per fire unit recommended.`, REF.DF_SELECTION));
    const kas = plan.graphics.filter((x) => x.kind === 'KILL_AREA');
    const prim = kas.find((k) => k.props.subtype === 'PRIMARY') ?? kas[0];
    if (!prim) items.push(item('KA', g, 'Killing areas', 3, 0, 'No killing area marked.', REF.FIRE_PLAN));
    else {
      const c = { x: prim.pts.reduce((m, p) => m + p.x, 0) / prim.pts.length, y: prim.pts.reduce((m, p) => m + p.y, 0) / prim.pts.length };
      const onApch = distToPolyline(c, a1.path).d < 400 * Math.max(1, n.k * 0.6);
      const ah = ahead(c);
      const shooters = plan.units.filter((u) => (u.templateKey === n.locKey || u.templateKey === 'MG_DET' || u.templateKey === 'GLHMG_DET' || AT_KEYS.has(u.templateKey)) && dist(u.pos, c) <= 900 * Math.max(1, n.k * 0.7) && t.los(u.pos, c, t.eyeHeight(u.pos), 1.2) > 0.3);
      const sc = (onApch ? 0.4 : 0.1) + band(ah, n.ka[0], n.ka[1], n.ka[1]) * 0.3 + Math.min(1, shooters.length / 2) * 0.3;
      items.push(item('KA', g, 'Pri killing area', 3, sc, `Pri KA ${Math.round(ah)} m ahead of FDLs${onApch ? ` on the ${a1.name}` : ' — off the most likely apch'}; covered by ${shooters.length} posns with LOS.`, REF.FIRE_PLAN));
    }
  }

  // ================================================================ F. Surveillance & security
  {
    const g = 'Surv & security';
    const fup1 = ds.likelyFUPs.find((f) => f.approachId === a1.id) ?? ds.likelyFUPs[0];
    if (n.spAhead) {
      const sps = byRole('SP_PTL');
      const best = sps
        .map((u) => {
          const ah = ahead(u.pos);
          const toFup = fup1 ? dist(u.pos, fup1.pos) : 9999;
          return { u, sc: 0.5 * band(ah, n.spAhead![0], n.spAhead![1], n.spAhead![1] * 0.5) + 0.5 * (toFup <= 700 * Math.max(1, n.k * 0.6) ? 1 : toFup <= 1400 * Math.max(1, n.k * 0.6) ? 0.5 : 0), ah, toFup };
        })
        .sort((a, b) => b.sc - a.sc)[0];
      items.push(item('SP', g, 'Standing ptl on the likely FUP / apch', 3, best ? best.sc : 0, best ? `${best.u.label} ${Math.round(best.ah)} m ahead, ${Math.round(best.toFup)} m from likely FUP ${fup1?.name ?? ''} (norm ${n.spAhead[0]}-${n.spAhead[1]} m ahead).` : 'No standing ptl — the en can form up unobserved.', `${REF.STANDING_PTL}; ${REF.SPOILING}`));
    }
    if (n.lpAhead) {
      const lps = byRole('LP');
      const ok = lps.filter((u) => band(ahead(u.pos), n.lpAhead![0], n.lpAhead![1], 200) > 0.6);
      const need = Math.max(1, lvl === 'PL' ? 1 : fwd.length);
      items.push(item('LP', g, 'LPs fwd of the localities (ni)', 2, Math.min(1, ok.length / need), `${ok.length} LP(s) ${n.lpAhead[0]}-${n.lpAhead[1]} m ahead (need ${need}).`, REF.OP_LP));
    }
    const obs = plan.units.filter((u) => u.templateKey === 'ARTY_OBS' || u.templateKey === 'MOR_OBS');
    if (obs.length || s.own.resources.some((r) => r.templateKey === 'ARTY_OBS')) {
      const dfs = plan.graphics.filter((x) => x.kind === 'DF');
      let osc = 0;
      for (const o of obs) {
        const vantage = t.elevAt(o.pos) > 3 || t.isBua(o.pos) || locs.some((l) => dist(l.pos, o.pos) < 200 && ahead(l.pos) > -100);
        const seen = dfs.filter((d) => dist(o.pos, d.pts[0]) < 3500 && t.los(o.pos, d.pts[0], t.eyeHeight(o.pos), 2) > 0.3).length;
        osc += 0.4 * (vantage ? 1 : 0) + 0.6 * (dfs.length ? seen / dfs.length : 0);
      }
      items.push(item('OBS', g, 'Obsrs on vantage pts with view of DFs', 2, obs.length ? osc / obs.length : 0, obs.length ? 'Measured: vantage point and LOS to the planned DFs.' : 'Arty / mor obsrs not sited.', REF.SURVEILLANCE));
    }
    const qcAvail = s.own.resources.some((r) => r.templateKey === 'QC_DET');
    if (qcAvail) {
      const areas = plan.graphics.filter((x) => x.kind === 'QC_AREA');
      const onFupFaa = areas.some((a) => [...ds.likelyFUPs, ...ds.likelyFAAs].some((p) => dist(a.pts[0], p.pos) <= (a.props.radius ?? 600) + 300));
      const lastLight = Math.floor(s.times.hHour / 1440) * 1440 + s.times.light.lastLight;
      const nightCover = plan.qcSorties.some((q) => q.start >= lastLight - 90 && q.start <= lastLight + 300);
      const placed = units('QC_DET').length > 0;
      const sc = (placed ? 0.3 : 0) + (onFupFaa ? 0.35 : 0) + (nightCover ? 0.35 : 0);
      items.push(item('QC', g, 'QC surv plan (FUP / FAA, timings)', 2, sc, `${placed ? 'QC det sited' : 'QC det not sited'}; ${onFupFaa ? 'surv area over likely FUP/FAA' : 'no surv area over likely FUP/FAA'}; ${nightCover ? 'sorties cover the critical evening / night' : 'no sorties planned for the critical evening / night'}.`, REF.BIC49));
    }
    if (n.screenAhead && s.own.resources.some((r) => r.templateKey === 'SCREEN_PL' || (lvl === 'BDE' && r.templateKey === 'RIFLE_COY'))) {
      const scr = byRole('SCREEN');
      const best = scr
        .map((u) => {
          const ah = ahead(u.pos);
          const onA = distToPolyline(u.pos, a1.path).d < 800 * Math.max(1, n.k * 0.6);
          const ground = ds.itgs.some((i) => dist(i.pos, u.pos) < 350 * Math.max(1, n.k * 0.6)) || t.elevAt(u.pos) > 3 || t.coverAt(u.pos) > 0.3;
          return { u, ah, sc: 0.4 * band(ah, n.screenAhead![0], n.screenAhead![1], n.screenAhead![1] * 0.5) + 0.35 * (onA ? 1 : 0.3) + 0.25 * (ground ? 1 : 0) };
        })
        .sort((a, b) => b.sc - a.sc)[0];
      items.push(item('SCREEN', g, 'Loc of screens', 3, best ? best.sc : 0, best ? `${best.u.label} ${Math.round(best.ah)} m ahead of the FDLs (DS: ${ds.screenArea?.name ?? '-'}).` : 'Loc for screens not selected (Narr 1 requires it).', REF.SCREENS));
    }
  }

  // ================================================================ G. C attk & C2
  {
    const g = 'C attk & C2';
    const catks = plan.graphics.filter((x) => x.kind === 'CATK').sort((a, b) => (a.props.priority ?? 9) - (b.props.priority ?? 9));
    if (lvl !== 'PL') {
      if (!catks.length) items.push(item('CATK', g, 'C attk plan', 4, 0, 'No C attk planned — it must be integrated from the start.', REF.CATK_PLAN));
      else {
        const c1 = crossing(a1);
        const first = catks[0];
        const obj = first.pts[first.pts.length - 1];
        const target = fwd.sort((a, b) => dist(a.pos, c1) - dist(b.pos, c1))[0];
        const priOk = target ? dist(obj, target.pos) < 300 * Math.max(1, n.k * 0.6) : false;
        items.push(item('CATK_PRI', g, 'C attk objs in order of pri', 2, priOk ? 1 : 0.4, priOk ? `Pri 1 C attk obj is ${target?.label}, the locality on the ${a1.name}.` : 'Pri 1 C attk obj is not the locality on the most likely apch.', REF.CATK_PLAN));
        const force = first.props.unitId ? plan.units.find((u) => u.id === first.props.unitId) : undefined;
        const forceOk = force && (force.role === 'DEPTH' || force.role === 'RES');
        items.push(item('CATK_FORCE', g, 'C attk force earmarked (depth)', 2, forceOk ? 1 : force ? 0.4 : 0, force ? `${force.label} (${force.role.toLowerCase()}) earmarked.` : 'No force earmarked.', REF.CATK_PLAN));
        const L = polylineLength(first.pts);
        let flank = 1;
        if (first.pts.length >= 2 && target) {
          const last = first.pts[first.pts.length - 2];
          flank = angleDiff(bearing(last, obj), (target.facing + 180) % 360) >= 40 ? 1 : 0.4;
        }
        items.push(item('CATK_ROUTE', g, 'C attk route & distance', 2, 0.5 * flank + 0.5 * band(L, 0, n.catkMax, n.catkMax), `Route ${Math.round(L)} m${flank < 1 ? ', frontal into the penetration' : ', from a flank'}; must be launchable within ${DOCTRINE.coyCatkMaxMin} min.`, REF.CATK_PLAN));
      }
      const cpen = plan.graphics.filter((x) => x.kind === 'CPEN');
      items.push(item('CPEN', g, 'C pen posn', 1, cpen.length ? 1 : 0, cpen.length ? 'C pen posn planned.' : 'No C pen posn.', REF.COUNTER_PEN));
    }
    const hqKeys = ['CHQ', 'BN_HQ', 'BDE_HQ', 'PL_HQ'];
    const hq = plan.units.find((u) => hqKeys.includes(u.templateKey));
    if (hq) {
      const behind = -ahead(hq.pos);
      const nearDepth = depth.length ? Math.min(...depth.map((d) => Math.abs(d.pos.y - hq.pos.y))) : 999;
      const covered = t.coverAt(hq.pos) > 0.25 || t.concealAt(hq.pos) > 0.3 || t.isBua(hq.pos);
      const route = t.onRoad(hq.pos) || s.terrain.features.some((f) => (f.kind === 'road' || f.kind === 'track') && distToPolyline(hq.pos, f.pts).d < 250 * Math.max(1, n.k * 0.6));
      const sc = 0.35 * band(behind, n.chqBehind[0], n.chqBehind[1], n.chqBehind[1]) + 0.25 * (lvl === 'PL' || nearDepth < 350 * n.k ? 1 : 0.3) + 0.2 * (covered ? 1 : 0) + 0.2 * (route ? 1 : 0);
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
      const inFdl = ahead(cp.pos) > -250 * n.k;
      items.push(item('CP', g, 'CP in FDLs with view', 2, 0.4 * (inFdl ? 1 : 0) + 0.6 * (tot ? vis / tot : 0), `CP ${inFdl ? 'in the FDLs' : 'not in the FDLs'}; sees ${tot ? Math.round((100 * vis) / tot) : 0}% of the apchs 200-1500 m ahead.`, REF.CP_CHQ));
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
        case 'EN_ASSEMBLY':
          return { dfNearFaa: !!faa1 && dfs.some((d) => dist(d.pts[0], faa1.pos) < 450), armourSeen: armour, ucavLeft: s.own.fire.ucavSorties, aqcAvail: units('QC_DET').length > 0 };
        case 'EN_FORMING_UP':
          return {
            spAvailable: !!sp && !!fup1 && dist(sp.pos, fup1.pos) < 1500,
            spInRange: !!sp && !!fup1 && dist(sp.pos, fup1.pos) <= 700 && t.los(sp.pos, fup1.pos, 2, 1.5) > 0.2,
            glhmgInRange: !!fup1 && plan.units.some((u) => u.templateKey === 'GLHMG_DET' && dist(u.pos, fup1.pos) <= 1750),
            depthAvailable: depthInf.length > 0,
          };
        case 'EN_ASSAULT':
          return { altPlanned: fwd.filter((u) => u.altPos).length, threatOffAxis: true, sosPlanned: dfs.some((d) => d.props.sos) };
        case 'POST_LOST': {
          const u = c?.unitId ? plan.units.find((x) => x.id === c.unitId) : undefined;
          return { elementsLost: 1, depthAvailable: depthInf.length > 0, delay: c?.delayMin ?? 15, chosenUnitIsDepth: !u || u.role === 'DEPTH' || u.role === 'RES', catkPlanned: plan.graphics.some((x) => x.kind === 'CATK') };
        }
        case 'LOCALITY_LOST':
          return { depthAvailable: depthInf.length > 0, cpenPlanned: plan.graphics.some((x) => x.kind === 'CPEN') };
        default:
          return {};
      }
    };
    const defs = CONTINGENCIES.filter((d) => d.levels.includes(lvl) && (d.key !== 'SCREEN_CONTACT' || byRole('SCREEN').length > 0 || !!n.screenAhead));
    for (const d of defs) {
      const c = plan.contingency[d.key];
      if (!c || !c.option) {
        items.push(item(`CONT_${d.key}`, g, d.title, 1.25, 0, 'Not pre-planned.', d.ref));
        continue;
      }
      const v = d.multi ? evaluateDecision(d.key, c.option, {}, c.option.split(',').filter(Boolean)) : evaluateDecision(d.key, c.option, ctxFor(d.key));
      items.push(item(`CONT_${d.key}`, g, d.title, 1.25, v.score, `${d.multi ? `${c.option.split(',').filter((o) => REORG_CORRECT.includes(o)).length} correct reorg actions` : (d.options.find((o) => o.id === c.option)?.text ?? c.option)} — ${v.rationale}`, v.ref));
    }
  }

  // ================================================================ I. Time & space, resources
  {
    const g = 'Time & space';
    const wl = workload(s, plan);
    items.push(item('READY', g, 'Def ready by the given time', 3, wl.readiness, `${Math.round(wl.required)} hrs of work vs ${Math.round(wl.available)} hrs aval (${Math.round(wl.availDay)} day / ${Math.round(wl.availNight)} ni).`, `${REF.PRIORITY_OF_WORK}; ${REF.IE_SOLN}`));
    const keyRes = s.own.resources.filter((r) => !['LP', 'RIFLE_SEC'].includes(r.templateKey) || lvl === 'PL');
    const total = keyRes.reduce((m, r) => m + r.count, 0);
    const placed = keyRes.reduce((m, r) => m + Math.min(r.count, units(r.templateKey).length), 0);
    items.push(item('RES_USED', g, 'All resources employed', 2, total ? placed / total : 1, `${placed}/${total} allotted resources sited.`, REF.COY_CONSIDERATIONS));
  }

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
  return { total, max, pct: max ? (100 * total) / max : 0, items, groups };
}


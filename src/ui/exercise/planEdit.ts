// Planner editing model (no UI): hit testing, edit handles, moves, handle drags, graphic
// re-tagging ("Marks as") and the symbol palette. Everything works in world metres with a
// metres-per-pixel tolerance, so the same tools run on the 2D and the 3D map views.

import { type Vec, add, centroid, dist, distToSegment } from '../../core/geom';
import type { GraphicKind, Plan, PlanGraphic, PlacedUnit } from '../../core/types';
import { areaCentroid, areaFrame, eggPoints, isAreaUnit, rotatePts, sampleClosed, scaleAlong, setUnitArea, translatePts, unitArea } from '../../plan/area';
import { graphicDistance } from '../../render/mapRenderer';

export interface Selection {
  units: string[];
  graphics: string[];
  group?: string;
}
export const EMPTY_SEL: Selection = { units: [], graphics: [] };

export const POINT_KINDS = new Set<GraphicKind>(['DF', 'CPEN', 'QC_AREA', 'NOTE', 'TEXT', 'TRP', 'SYMBOL']);
export const AREA_KINDS = new Set<GraphicKind>(['KILL_AREA', 'AREA']);

/** Semantic tags offered under "Marks as" (what the assessment reads). */
export const MARKS_AS: { id: GraphicKind; label: string; shape: 'point' | 'line' | 'area' }[] = [
  { id: 'FDL', label: 'Line of FDLs', shape: 'line' },
  { id: 'KILL_AREA', label: 'Killing area', shape: 'area' },
  { id: 'MINEFIELD', label: 'Minefield', shape: 'line' },
  { id: 'WIRE', label: 'Wire', shape: 'line' },
  { id: 'OBSTACLE', label: 'Obstacle (other)', shape: 'line' },
  { id: 'DF', label: 'DF / SOS', shape: 'point' },
  { id: 'CATK', label: 'C attk axis', shape: 'line' },
  { id: 'CPEN', label: 'C pen posn', shape: 'point' },
  { id: 'QC_AREA', label: 'QC surv area', shape: 'point' },
  { id: 'PTL_ROUTE', label: 'Ptl route', shape: 'line' },
  { id: 'PHASE_LINE', label: 'Phase line', shape: 'line' },
  { id: 'BOUNDARY', label: 'Boundary', shape: 'line' },
  { id: 'TRP', label: 'TRP', shape: 'point' },
  { id: 'NOTE', label: 'Note', shape: 'point' },
  { id: 'ARROW', label: 'Arrow / axis (free)', shape: 'line' },
  { id: 'AREA', label: 'Area (free)', shape: 'area' },
  { id: 'FREE', label: 'Free drawing', shape: 'line' },
  { id: 'TEXT', label: 'Text', shape: 'point' },
  { id: 'SYMBOL', label: 'Symbol', shape: 'point' },
];

export function shapeOf(g: PlanGraphic): 'point' | 'line' | 'area' {
  if (POINT_KINDS.has(g.kind)) return 'point';
  if (AREA_KINDS.has(g.kind) || (g.kind === 'FREE' && g.props.closed)) return 'area';
  return 'line';
}

/** Layer category of a graphic (planner layer toggles). */
export function layerOf(kind: GraphicKind): 'fire' | 'obstacles' | 'manoeuvre' | 'free' {
  if (kind === 'DF' || kind === 'QC_AREA' || kind === 'KILL_AREA' || kind === 'TRP') return 'fire';
  if (kind === 'MINEFIELD' || kind === 'WIRE' || kind === 'OBSTACLE') return 'obstacles';
  if (kind === 'FDL' || kind === 'CATK' || kind === 'CPEN' || kind === 'PTL_ROUTE' || kind === 'PHASE_LINE' || kind === 'BOUNDARY') return 'manoeuvre';
  return 'free';
}

function extentOf(pts: Vec[]): number {
  const c = centroid(pts);
  return pts.reduce((m, p) => Math.max(m, dist(p, c)), 0);
}

/**
 * Re-tag a graphic: changes its semantic kind and converts the geometry where the shapes differ
 * (point <-> line <-> area), keeping label and style.
 */
export function retag(g: PlanGraphic, kind: GraphicKind, n: number): PlanGraphic {
  const to = MARKS_AS.find((m) => m.id === kind)?.shape ?? 'line';
  const from = shapeOf(g);
  let pts = g.pts.map((p) => ({ ...p }));
  const props = { ...g.props };
  const r0 = g.props.radius ?? (from === 'point' ? 150 : Math.max(60, extentOf(pts)));
  if (to === 'point' && from !== 'point') {
    pts = [from === 'area' ? areaCentroid(pts) : centroid(pts)];
  } else if (to === 'line' && from === 'point') {
    const r = Math.max(60, r0);
    pts = [add(pts[0], { x: -r, y: 0 }), add(pts[0], { x: r, y: 0 })];
  } else if (to === 'area' && from === 'point') {
    pts = eggPoints(pts[0], Math.max(80, r0), Math.max(60, r0 * 0.7), 0, 8);
    props.smooth = true;
  } else if (to === 'area' && pts.length < 3) {
    const c = centroid(pts);
    const L = pts.length === 2 ? dist(pts[0], pts[1]) / 2 : 120;
    pts = eggPoints(c, Math.max(60, L), Math.max(40, L * 0.5), 0, 8);
    props.smooth = true;
  }
  if (kind === 'DF') {
    props.subtype = props.subtype && ['ARTY', 'MOR81', 'MOR60'].includes(props.subtype) ? props.subtype : 'ARTY';
    props.radius = Math.max(50, Math.min(400, from === 'point' ? r0 : extentOf(g.pts)));
    props.label = props.label ?? `DF ${n}`;
  }
  if (kind === 'QC_AREA') {
    props.radius = Math.max(300, Math.min(3000, from === 'point' ? r0 : extentOf(g.pts)));
    props.label = props.label ?? `QC area ${n}`;
  }
  if (kind === 'MINEFIELD') props.subtype = props.subtype && ['PROTECTIVE', 'TACTICAL', 'NUISANCE'].includes(props.subtype) ? props.subtype : 'PROTECTIVE';
  if (kind === 'KILL_AREA') {
    props.subtype = props.subtype === 'SECONDARY' ? 'SECONDARY' : 'PRIMARY';
    props.label = props.label ?? `KA ${n}`;
  }
  if (kind === 'OBSTACLE') props.subtype = props.subtype && ['ABATIS', 'AT_DITCH', 'ROADBLOCK', 'GENERAL'].includes(props.subtype) ? props.subtype : 'GENERAL';
  if (kind === 'BOUNDARY') props.subtype = props.subtype && ['SEC', 'PL', 'COY', 'BN', 'BDE'].includes(props.subtype) ? props.subtype : 'PL';
  if (kind === 'FDL') props.label = props.label ?? 'FDLs';
  if (kind === 'CATK') props.label = props.label ?? 'C Attk';
  if (kind === 'CPEN') props.label = props.label ?? 'C Pen';
  if ((kind === 'TEXT' || kind === 'NOTE') && !props.text) props.text = props.label ?? 'Text';
  if (kind === 'SYMBOL' && !props.sidc) props.sidc = 'GFGPGPRI-------';
  if (kind === 'FREE') props.closed = to === 'area' || from === 'area' ? true : props.closed;
  if (kind === 'AREA') props.closed = true;
  return { ...g, kind, pts, props };
}

// ---------------------------------------------------------------------------- handles

export interface Handle {
  p: Vec;
  kind: 'vertex' | 'mid' | 'resize' | 'rotate' | 'radius';
  target: 'unit' | 'graphic';
  id: string;
  /** Vertex index (vertex) or insert-after index (mid). */
  i?: number;
  /** Resize axis. */
  axis?: 'major' | 'minor';
  sign?: number;
}

/** Edit handles of a single selected unit egg or graphic. */
export function handlesFor(plan: Plan, sel: Selection, mPerPx: number): Handle[] {
  const out: Handle[] = [];
  if (sel.units.length + sel.graphics.length !== 1 || sel.group) return out;
  if (sel.units.length === 1) {
    const u = plan.units.find((x) => x.id === sel.units[0]);
    if (!u || !isAreaUnit(u)) return out;
    const a = unitArea(u);
    a.forEach((p, i) => out.push({ p, kind: 'vertex', target: 'unit', id: u.id, i }));
    a.forEach((p, i) => out.push({ p: mid(a, i, true), kind: 'mid', target: 'unit', id: u.id, i }));
    const f = areaFrame(a);
    for (const sign of [1, -1]) {
      out.push({ p: add(f.c, scaleV(f.major, f.a * sign)), kind: 'resize', target: 'unit', id: u.id, axis: 'major', sign });
      out.push({ p: add(f.c, scaleV(f.minor, f.b * sign)), kind: 'resize', target: 'unit', id: u.id, axis: 'minor', sign });
    }
    // rotate handle beyond the front (facing side) of the egg
    const fv = { x: Math.sin((u.facing * Math.PI) / 180), y: Math.cos((u.facing * Math.PI) / 180) };
    const s = f.minor.x * fv.x + f.minor.y * fv.y >= 0 ? 1 : -1;
    out.push({ p: add(f.c, scaleV(f.minor, s * (f.b + 26 * mPerPx))), kind: 'rotate', target: 'unit', id: u.id });
    return out;
  }
  const g = plan.graphics.find((x) => x.id === sel.graphics[0]);
  if (!g) return out;
  if (g.kind === 'DF' || g.kind === 'QC_AREA') {
    out.push({ p: add(g.pts[0], { x: g.props.radius ?? 150, y: 0 }), kind: 'radius', target: 'graphic', id: g.id });
    return out;
  }
  if (POINT_KINDS.has(g.kind)) return out;
  const closed = shapeOf(g) === 'area';
  g.pts.forEach((p, i) => out.push({ p, kind: 'vertex', target: 'graphic', id: g.id, i }));
  const nMid = closed ? g.pts.length : g.pts.length - 1;
  if (g.kind !== 'MINEFIELD' || g.pts.length > 1) for (let i = 0; i < nMid; i++) out.push({ p: mid(g.pts, i, closed), kind: 'mid', target: 'graphic', id: g.id, i });
  return out;
}

function mid(pts: Vec[], i: number, closed: boolean): Vec {
  const a = pts[i];
  const b = pts[closed ? (i + 1) % pts.length : i + 1];
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}
function scaleV(v: Vec, k: number): Vec {
  return { x: v.x * k, y: v.y * k };
}

/** Handle under the pointer (vertices win over insert points). */
export function handleAt(hs: Handle[], w: Vec, mPerPx: number): Handle | undefined {
  const tol = 9 * mPerPx;
  let best: Handle | undefined;
  let bd = tol;
  for (const h of hs) {
    const d = dist(h.p, w) - (h.kind === 'vertex' || h.kind === 'rotate' ? 1.5 * mPerPx : 0);
    if (d < bd) {
      bd = d;
      best = h;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------- hit testing

export type Hit = { kind: 'unit'; id: string } | { kind: 'graphic'; id: string } | { kind: 'group'; id: string };

/**
 * What is under the pointer: point units (symbols) first, then graphics outlines, then group
 * outlines, then egg interiors (the smallest egg wins), then closed graphics' interiors.
 */
export function hitTest(plan: Plan, graphics: PlanGraphic[], groups: { id: string; area: Vec[] }[], w: Vec, mPerPx: number, o: { units?: boolean; eggs?: boolean } = {}): Hit | null {
  const showUnits = o.units !== false;
  const eggs = o.eggs !== false;
  if (showUnits) {
    let best: PlacedUnit | undefined;
    let bd = 16 * mPerPx;
    for (const u of plan.units) {
      if (eggs && isAreaUnit(u)) continue;
      const d = dist(u.pos, w);
      if (d < bd) {
        bd = d;
        best = u;
      }
    }
    if (best) return { kind: 'unit', id: best.id };
  }
  // graphic outlines / points (interior hits of closed shapes come last)
  let gBest: PlanGraphic | undefined;
  let gd = 9 * mPerPx;
  for (const g of graphics) {
    const d = graphicDistance(g, w, mPerPx);
    if (d < gd && !(d === 6 * mPerPx && shapeOf(g) === 'area')) {
      gd = d;
      gBest = g;
    }
  }
  if (gBest) return { kind: 'graphic', id: gBest.id };
  if (showUnits && eggs) {
    for (const gr of groups) {
      const s = sampleClosed(gr.area, 6);
      for (let i = 0; i < s.length; i++) if (distToSegment(w, s[i], s[(i + 1) % s.length]).d < 7 * mPerPx) return { kind: 'group', id: gr.id };
    }
    let best: PlacedUnit | undefined;
    let ba = Infinity;
    for (const u of plan.units) {
      if (!isAreaUnit(u)) continue;
      const s = sampleClosed(unitArea(u), 4);
      if (!inside(w, s)) continue;
      const a = areaOf(s);
      if (a < ba) {
        ba = a;
        best = u;
      }
    }
    if (best) return { kind: 'unit', id: best.id };
  }
  for (const g of graphics) if (shapeOf(g) === 'area' && graphicDistance(g, w, mPerPx) <= 6 * mPerPx) return { kind: 'graphic', id: g.id };
  return null;
}

function inside(p: Vec, poly: Vec[]): boolean {
  let ins = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y + 1e-12) + a.x) ins = !ins;
  }
  return ins;
}
function areaOf(poly: Vec[]): number {
  let s = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) s += (poly[j].x + poly[i].x) * (poly[j].y - poly[i].y);
  return Math.abs(s / 2);
}

/** Everything inside a world rectangle (box select). */
export function boxSelect(plan: Plan, graphics: PlanGraphic[], a: Vec, b: Vec, o: { units?: boolean } = {}): Selection {
  const minX = Math.min(a.x, b.x);
  const maxX = Math.max(a.x, b.x);
  const minY = Math.min(a.y, b.y);
  const maxY = Math.max(a.y, b.y);
  const inBox = (p: Vec) => p.x >= minX && p.x <= maxX && p.y >= minY && p.y <= maxY;
  return {
    units: o.units === false ? [] : plan.units.filter((u) => inBox(u.pos)).map((u) => u.id),
    graphics: graphics.filter((g) => g.pts.length && g.pts.every(inBox)).map((g) => g.id),
  };
}

// ---------------------------------------------------------------------------- edits

/** Units affected by moving a selection (selected units plus the members of a selected group). */
export function movingUnitIds(plan: Plan, sel: Selection): Set<string> {
  const ids = new Set(sel.units);
  if (sel.group) for (const m of plan.groups?.find((g) => g.id === sel.group)?.memberIds ?? []) ids.add(m);
  return ids;
}

/** Move the selection by d from an original snapshot (no drift during a drag). */
export function moveSelection(plan: Plan, orig: Plan, sel: Selection, d: Vec): void {
  const ids = movingUnitIds(orig, sel);
  for (const u of plan.units) {
    if (!ids.has(u.id)) continue;
    const o = orig.units.find((x) => x.id === u.id);
    if (!o) continue;
    u.pos = add(o.pos, d);
    if (o.area) u.area = translatePts(unitArea(o), d);
    if (o.altPos && ids.size > 1) u.altPos = add(o.altPos, d);
  }
  const gids = new Set(sel.graphics);
  for (const g of plan.graphics) {
    if (!gids.has(g.id)) continue;
    const o = orig.graphics.find((x) => x.id === g.id);
    if (o) g.pts = o.pts.map((p) => add(p, d));
  }
  if (sel.group) {
    const g = plan.groups?.find((x) => x.id === sel.group);
    const o = orig.groups?.find((x) => x.id === sel.group);
    if (g && o?.area) g.area = translatePts(o.area, d);
  }
}

/** Apply a handle drag (from the original snapshot) to the plan. */
export function dragHandle(plan: Plan, orig: Plan, h: Handle, start: Vec, w: Vec): string | undefined {
  if (h.target === 'unit') {
    const u = plan.units.find((x) => x.id === h.id);
    const o = orig.units.find((x) => x.id === h.id);
    if (!u || !o) return;
    const a0 = unitArea(o);
    if (h.kind === 'vertex' && h.i !== undefined) {
      const a = a0.map((p) => ({ ...p }));
      a[h.i] = w;
      setUnitArea(u, a);
    } else if (h.kind === 'resize' && h.axis) {
      const f = areaFrame(a0);
      const ax = h.axis === 'major' ? f.major : f.minor;
      const half = h.axis === 'major' ? f.a : f.b;
      const now = (w.x - f.c.x) * ax.x * (h.sign ?? 1) + (w.y - f.c.y) * ax.y * (h.sign ?? 1);
      const k = Math.max(0.15, Math.min(8, now / Math.max(1, half)));
      setUnitArea(u, h.axis === 'major' ? scaleAlong(a0, f.c, f.major, k, 1) : scaleAlong(a0, f.c, f.major, 1, k));
      return `${h.axis === 'major' ? 'Frontage' : 'Depth'} ${Math.round(2 * half * k)} m`;
    } else if (h.kind === 'rotate') {
      const c = areaCentroid(a0);
      const b0 = Math.atan2(start.x - c.x, start.y - c.y);
      const b1 = Math.atan2(w.x - c.x, w.y - c.y);
      const deg = ((b1 - b0) * 180) / Math.PI;
      setUnitArea(u, rotatePts(a0, c, deg));
      u.facing = Math.round((((o.facing + deg) % 360) + 360) % 360);
      return `Facing ${u.facing}°`;
    }
    return;
  }
  const g = plan.graphics.find((x) => x.id === h.id);
  const o = orig.graphics.find((x) => x.id === h.id);
  if (!g || !o) return;
  if (h.kind === 'vertex' && h.i !== undefined) {
    g.pts = o.pts.map((p, i) => (i === h.i ? w : p));
    if (g.kind === 'MINEFIELD' || g.pts.length === 2) return `${Math.round(dist(g.pts[0], g.pts[g.pts.length - 1]))} m`;
  } else if (h.kind === 'radius') {
    g.props.radius = Math.max(25, Math.round(dist(o.pts[0], w)));
    return `Radius ${g.props.radius} m`;
  }
  return;
}

/** Insert a vertex after index i (mid handle) — returns the new vertex index. */
export function insertVertex(plan: Plan, h: Handle, w: Vec): number {
  if (h.target === 'unit') {
    const u = plan.units.find((x) => x.id === h.id);
    if (!u || h.i === undefined) return -1;
    const a = unitArea(u).slice();
    a.splice(h.i + 1, 0, w);
    setUnitArea(u, a);
    return h.i + 1;
  }
  const g = plan.graphics.find((x) => x.id === h.id);
  if (!g || h.i === undefined) return -1;
  g.pts.splice(h.i + 1, 0, w);
  return h.i + 1;
}

/** Delete a vertex (keeping the minimum for the shape). */
export function deleteVertex(plan: Plan, h: Handle): boolean {
  if (h.kind !== 'vertex' || h.i === undefined) return false;
  if (h.target === 'unit') {
    const u = plan.units.find((x) => x.id === h.id);
    if (!u) return false;
    const a = unitArea(u).slice();
    if (a.length <= 4) return false;
    a.splice(h.i, 1);
    setUnitArea(u, a);
    return true;
  }
  const g = plan.graphics.find((x) => x.id === h.id);
  if (!g) return false;
  const min = shapeOf(g) === 'area' ? 3 : 2;
  if (g.pts.length <= min) return false;
  g.pts.splice(h.i, 1);
  return true;
}

/** Remove near-duplicate consecutive points (e.g. from the clicks of a double-click). */
export function dedupe(pts: Vec[], tol: number): Vec[] {
  const out: Vec[] = [];
  for (const p of pts) if (!out.length || dist(out[out.length - 1], p) > tol) out.push(p);
  return out;
}


// ---------------------------------------------------------------------------- symbol palette

export interface PaletteItem {
  id: string;
  name: string;
  sidc: string;
  /** Graphic kind to create (SYMBOL by default, TRP for target reference points). */
  kind?: GraphicKind;
  tags: string;
}

export const SYMBOL_PALETTE: PaletteItem[] = [
  { id: 'op', name: 'OP / outpost', sidc: 'GFGPGPPO-------', tags: 'observation post op outpost' },
  { id: 'lp', name: 'LP (sensor outpost)', sidc: 'GFGPDPOS-------', tags: 'listening post lp sensor' },
  { id: 'cop', name: 'Combat outpost', sidc: 'GFGPDPOC-------', tags: 'combat outpost cop' },
  { id: 'fop', name: 'Fwd obsr posn', sidc: 'GFGPDPOF-------', tags: 'forward observer foo mfc obs' },
  { id: 'trp', name: 'TRP', sidc: 'GFGPDPT--------', kind: 'TRP', tags: 'target reference point trp' },
  { id: 'tgt', name: 'Point target', sidc: 'GFFPPTS--------', tags: 'target df point' },
  { id: 'chk', name: 'Check point', sidc: 'GFGPGPPC-------', tags: 'check point cp' },
  { id: 'dp', name: 'Decision point', sidc: 'GFGPGPPD-------', tags: 'decision point' },
  { id: 'cnt', name: 'Contact point', sidc: 'GFGPGPPK-------', tags: 'contact point' },
  { id: 'lu', name: 'Link-up point', sidc: 'GFGPGPPL-------', tags: 'link up linkup' },
  { id: 'rp', name: 'Release point', sidc: 'GFGPGPPR-------', tags: 'release point rp' },
  { id: 'sp', name: 'Start point', sidc: 'GFGPGPPS-------', tags: 'start point sp' },
  { id: 'pp', name: 'Passage point', sidc: 'GFGPGPPP-------', tags: 'passage point' },
  { id: 'amb', name: 'Ambush (point)', sidc: 'GFGPGPPA-------', tags: 'ambush' },
  { id: 'coord', name: 'Coordinating point', sidc: 'GFGPGPPE-------', tags: 'coordination coordinating point' },
  { id: 'wp', name: 'Waypoint', sidc: 'GFGPGPRW-------', tags: 'waypoint route' },
  { id: 'poi', name: 'Point of interest', sidc: 'GFGPGPRI-------', tags: 'point of interest poi' },
  { id: 'mineap', name: 'AP mine', sidc: 'GFMPOMP--------', tags: 'mine ap anti personnel obstacle' },
  { id: 'mineat', name: 'A tk mine', sidc: 'GFMPOMT--------', tags: 'mine at anti tank obstacle' },
  { id: 'mineu', name: 'Mine (unspecified)', sidc: 'GFMPOMU--------', tags: 'mine obstacle' },
  { id: 'booby', name: 'Booby trap', sidc: 'GFMPOB---------', tags: 'booby trap obstacle' },
  { id: 'erp', name: 'Engr regulating pt', sidc: 'GFMPBCP--------', tags: 'engineer pnr regulating point' },
  { id: 'cp', name: 'Command post (Pl)', sidc: 'SFGPUH-----D---', tags: 'command post cp hq headquarters' },
  { id: 'chq', name: 'Coy HQ', sidc: 'SFGPUH-----E---', tags: 'coy hq headquarters chq' },
  { id: 'aid', name: 'Aid post / med', sidc: 'GFSPPX---------', tags: 'aid post medical cap rap casevac' },
  { id: 'casevac', name: 'Cas evac pt', sidc: 'GFSPPE---------', tags: 'casualty evacuation casevac' },
  { id: 'ammo', name: 'Ammo pt', sidc: 'GFSPPSA--------', tags: 'ammunition ammo supply' },
  { id: 'supply', name: 'Supply pt', sidc: 'GFSPPSZ--------', tags: 'supply point maint' },
];

/** Linear obstacle / area presets offered next to the point symbols. */
export const SHAPE_PALETTE: { id: string; name: string; kind: GraphicKind; subtype?: string; tags: string }[] = [
  { id: 'abatis', name: 'Abatis', kind: 'OBSTACLE', subtype: 'ABATIS', tags: 'abatis obstacle trees' },
  { id: 'atditch', name: 'A tk ditch', kind: 'OBSTACLE', subtype: 'AT_DITCH', tags: 'anti tank ditch obstacle' },
  { id: 'roadblock', name: 'Road block', kind: 'OBSTACLE', subtype: 'ROADBLOCK', tags: 'road block obstacle' },
  { id: 'obsline', name: 'Obstacle line', kind: 'OBSTACLE', subtype: 'GENERAL', tags: 'obstacle general line' },
  { id: 'aa', name: 'Assembly area', kind: 'AREA', subtype: 'AA', tags: 'assembly area aa' },
  { id: 'pl', name: 'Phase line', kind: 'PHASE_LINE', tags: 'phase line pl' },
  { id: 'bdry', name: 'Boundary', kind: 'BOUNDARY', subtype: 'PL', tags: 'boundary bdry' },
];


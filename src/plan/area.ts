// Goose-egg (unit area) geometry: default eggs sized from doctrine, smooth closed curves,
// freehand fitting (smoothing + simplification) and the edit transforms used by the planner.
// All coordinates are world metres (x east, y north); bearings are degrees clockwise from north.

import { DOCTRINE } from '../core/doctrine';
import { type Vec, add, dist, distToSegment, fromBearing, polygonArea, scale, sub } from '../core/geom';
import type { PlacedUnit } from '../core/types';
import { TEMPLATES } from '../core/units';

/** Templates drawn as a goose egg (area) rather than a point symbol, when in a locality role. */
const EGG_HQ = new Set(['CHQ', 'BN_HQ', 'BDE_HQ']);
/** Roles that are always compact point symbols (detached / surveillance elements). */
const POINT_ROLES = new Set(['SP_PTL', 'LP', 'OP', 'SP_WPN', 'OBS', 'QC', 'ENGR', 'CP']);

/** True if this placed unit is drawn and simulated as an area (manoeuvre element / locality / main HQ). */
export function isAreaUnit(u: Pick<PlacedUnit, 'templateKey' | 'role'>): boolean {
  const t = TEMPLATES[u.templateKey];
  if (!t || u.templateKey === 'LP') return false;
  if (EGG_HQ.has(u.templateKey)) return true;
  if (POINT_ROLES.has(u.role)) return false;
  return (t.kind === 'INF' || t.kind === 'ARMOUR') && t.echelon !== 'TEAM';
}

/**
 * Default egg semi-axes for a template: `front` across the frontage, `depth` along the facing.
 * Sized so the egg's equivalent radius equals the template footprint radius used by the sim
 * (sqrt(front * depth) = radius) — which puts the frontages inside the doctrinal bands
 * (sec ~100 m, pl ~300 m, coy ~1100 m, bn ~3500 m; ICIB Sec 72 para 6c).
 */
export function defaultEggAxes(templateKey: string): { front: number; depth: number } {
  const t = TEMPLATES[templateKey];
  const r = t?.radius ?? 60;
  return { front: r * 1.25, depth: r * 0.8 };
}

/** Doctrinal frontage band (m) for an echelon, if one is defined. */
export function doctrineFrontage(templateKey: string): readonly [number, number] | undefined {
  const t = TEMPLATES[templateKey];
  return t ? DOCTRINE.frontage[t.echelon] : undefined;
}

/** Ellipse control points (n, default 8) with semi-axes front (lateral) and depth (along facing). */
export function eggPoints(c: Vec, front: number, depth: number, facing: number, n = 8): Vec[] {
  const f = fromBearing(facing);
  const l = fromBearing(facing + 90);
  const out: Vec[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const lx = Math.cos(a) * front;
    const fy = Math.sin(a) * depth;
    out.push({ x: c.x + l.x * lx + f.x * fy, y: c.y + l.y * lx + f.y * fy });
  }
  return out;
}

/** The default egg of a unit at its position, oriented to its facing. */
export function defaultArea(u: Pick<PlacedUnit, 'templateKey' | 'pos' | 'facing'>): Vec[] {
  const { front, depth } = defaultEggAxes(u.templateKey);
  return eggPoints(u.pos, front, depth, u.facing);
}

/** Area centroid of a closed polygon (falls back to the vertex mean when degenerate). */
export function areaCentroid(pts: Vec[]): Vec {
  if (!pts.length) return { x: 0, y: 0 };
  let a = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const cr = pts[j].x * pts[i].y - pts[i].x * pts[j].y;
    a += cr;
    cx += (pts[j].x + pts[i].x) * cr;
    cy += (pts[j].y + pts[i].y) * cr;
  }
  if (Math.abs(a) < 1e-6) {
    let x = 0;
    let y = 0;
    for (const p of pts) {
      x += p.x;
      y += p.y;
    }
    return { x: x / pts.length, y: y / pts.length };
  }
  return { x: cx / (3 * a), y: cy / (3 * a) };
}

export function translatePts(pts: Vec[], d: Vec): Vec[] {
  return pts.map((p) => ({ x: p.x + d.x, y: p.y + d.y }));
}

/**
 * The unit's area in world metres, always centred on `pos` (pos is the authority: an area that
 * has drifted from pos — e.g. a plan edited elsewhere — is translated back onto it).
 */
export function unitArea(u: Pick<PlacedUnit, 'templateKey' | 'pos' | 'facing' | 'area'>): Vec[] {
  if (!u.area || u.area.length < 3) return defaultArea(u);
  const c = areaCentroid(u.area);
  if (Math.abs(c.x - u.pos.x) < 0.01 && Math.abs(c.y - u.pos.y) < 0.01) return u.area;
  return translatePts(u.area, sub(u.pos, c));
}

/** Set a unit's area and keep pos = centroid. */
export function setUnitArea(u: PlacedUnit, area: Vec[]): void {
  u.area = area.map((p) => ({ x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10 }));
  u.pos = areaCentroid(u.area);
}

// ---------------------------------------------------------------------------- curves

/**
 * Sample a smooth closed curve (centripetal-free uniform Catmull-Rom) through the control points.
 * `per` samples per segment. Used for hit testing, area/extent and the sim.
 */
export function sampleClosed(pts: Vec[], per = 8): Vec[] {
  const n = pts.length;
  if (n < 3) return pts.slice();
  const out: Vec[] = [];
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n];
    const p1 = pts[i];
    const p2 = pts[(i + 1) % n];
    const p3 = pts[(i + 2) % n];
    for (let k = 0; k < per; k++) out.push(catmull(p0, p1, p2, p3, k / per));
  }
  return out;
}

/** Sample an open smooth curve through the points. */
export function sampleOpen(pts: Vec[], per = 8): Vec[] {
  const n = pts.length;
  if (n < 3) return pts.slice();
  const out: Vec[] = [];
  for (let i = 0; i < n - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[Math.min(n - 1, i + 2)];
    for (let k = 0; k < per; k++) out.push(catmull(p0, p1, p2, p3, k / per));
  }
  out.push(pts[n - 1]);
  return out;
}

function catmull(p0: Vec, p1: Vec, p2: Vec, p3: Vec, t: number): Vec {
  const t2 = t * t;
  const t3 = t2 * t;
  const f = (a: number, b: number, c: number, d: number) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
  return { x: f(p0.x, p1.x, p2.x, p3.x), y: f(p0.y, p1.y, p2.y, p3.y) };
}

/** Bezier control points for drawing the closed Catmull-Rom curve with bezierCurveTo. */
export function closedBeziers(pts: Vec[]): { c1: Vec; c2: Vec; to: Vec }[] {
  const n = pts.length;
  const out: { c1: Vec; c2: Vec; to: Vec }[] = [];
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n];
    const p1 = pts[i];
    const p2 = pts[(i + 1) % n];
    const p3 = pts[(i + 2) % n];
    out.push({ c1: { x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6 }, c2: { x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6 }, to: p2 });
  }
  return out;
}

/** Bezier segments for an open Catmull-Rom curve through the points (end tangents clamped). */
export function openBeziers(pts: Vec[]): { c1: Vec; c2: Vec; to: Vec }[] {
  const n = pts.length;
  const out: { c1: Vec; c2: Vec; to: Vec }[] = [];
  for (let i = 0; i < n - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[Math.min(n - 1, i + 2)];
    out.push({ c1: { x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6 }, c2: { x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6 }, to: p2 });
  }
  return out;
}

/** Ramer–Douglas–Peucker simplification of an open polyline. */
export function simplifyRdp(pts: Vec[], tol: number): Vec[] {
  if (pts.length < 3) return pts.slice();
  const keep = new Uint8Array(pts.length);
  keep[0] = 1;
  keep[pts.length - 1] = 1;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    let best = -1;
    let bd = tol;
    for (let i = a + 1; i < b; i++) {
      const d = distToSegment(pts[i], pts[a], pts[b]).d;
      if (d > bd) {
        bd = d;
        best = i;
      }
    }
    if (best >= 0) {
      keep[best] = 1;
      stack.push([a, best], [best, b]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

/** Moving-average smoothing (window 2k+1), closed or open. */
export function smoothAvg(pts: Vec[], k = 2, closed = false): Vec[] {
  const n = pts.length;
  if (n < 3 || k < 1) return pts.slice();
  return pts.map((_, i) => {
    if (!closed && (i < k || i >= n - k)) return pts[i];
    let x = 0;
    let y = 0;
    let c = 0;
    for (let j = -k; j <= k; j++) {
      const q = pts[closed ? (i + j + n) % n : i + j];
      x += q.x;
      y += q.y;
      c++;
    }
    return { x: x / c, y: y / c };
  });
}

/** Resample a polyline (closed or open) to evenly spaced points. */
export function resampleEven(pts: Vec[], n: number, closed: boolean): Vec[] {
  const ring = closed ? [...pts, pts[0]] : pts;
  let L = 0;
  for (let i = 1; i < ring.length; i++) L += dist(ring[i - 1], ring[i]);
  if (L <= 0 || n < 2) return pts.slice(0, Math.max(1, Math.min(pts.length, n)));
  const out: Vec[] = [];
  const count = closed ? n : n - 1;
  for (let k = 0; k < n; k++) {
    let d = (k / count) * L;
    for (let i = 1; i < ring.length; i++) {
      const s = dist(ring[i - 1], ring[i]);
      if (d <= s || i === ring.length - 1) {
        const t = s > 0 ? Math.min(1, d / s) : 0;
        out.push({ x: ring[i - 1].x + (ring[i].x - ring[i - 1].x) * t, y: ring[i - 1].y + (ring[i].y - ring[i - 1].y) * t });
        break;
      }
      d -= s;
    }
  }
  return out;
}

/**
 * Fit a freehand stroke: drop jitter, smooth, then simplify to between `min` and `max` control
 * points (closed curves are later drawn as smooth Catmull-Rom curves through them).
 */
export function fitFreehand(raw: Vec[], closed: boolean, min = 8, max = 16): Vec[] {
  // drop near-duplicate samples
  const pts: Vec[] = [];
  for (const p of raw) if (!pts.length || dist(pts[pts.length - 1], p) > 0.5) pts.push(p);
  if (closed && pts.length > 3 && dist(pts[0], pts[pts.length - 1]) < 1) pts.pop();
  if (pts.length < 3) return pts;
  let L = 0;
  for (let i = 1; i < pts.length; i++) L += dist(pts[i - 1], pts[i]);
  if (closed) L += dist(pts[pts.length - 1], pts[0]);
  const dense = resampleEven(pts, Math.max(24, Math.min(400, pts.length * 2)), closed);
  const sm = smoothAvg(dense, 2, closed);
  // grow the tolerance until the point budget is met
  let tol = L / 300;
  let out = sm;
  for (let it = 0; it < 40; it++) {
    out = closed ? simplifyClosed(sm, tol) : simplifyRdp(sm, tol);
    if (out.length <= max) break;
    tol *= 1.35;
  }
  if (out.length < (closed ? Math.min(min, 8) : 2)) out = resampleEven(sm, closed ? min : Math.max(2, Math.min(min, sm.length)), closed);
  return out;
}

function simplifyClosed(pts: Vec[], tol: number): Vec[] {
  // split the ring at the point farthest from the first one, simplify both halves
  let far = 0;
  let fd = -1;
  for (let i = 1; i < pts.length; i++) {
    const d = dist(pts[0], pts[i]);
    if (d > fd) {
      fd = d;
      far = i;
    }
  }
  const a = simplifyRdp(pts.slice(0, far + 1), tol);
  const b = simplifyRdp([...pts.slice(far), pts[0]], tol);
  return [...a.slice(0, -1), ...b.slice(0, -1)];
}

// ---------------------------------------------------------------------------- frame & extents

/** Principal axes of an outline: `major` unit vector (frontage) and half-extents along both axes. */
export function areaFrame(pts: Vec[]): { c: Vec; major: Vec; minor: Vec; a: number; b: number } {
  const s = sampleClosed(pts, 6);
  const c = areaCentroid(pts);
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (const p of s) {
    const dx = p.x - c.x;
    const dy = p.y - c.y;
    sxx += dx * dx;
    syy += dy * dy;
    sxy += dx * dy;
  }
  const th = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  const major = { x: Math.cos(th), y: Math.sin(th) };
  const minor = { x: -major.y, y: major.x };
  const ext = extentsAlong(s, c, major, minor);
  return { c, major, minor, a: ext.a, b: ext.b };
}

/** Half-extents of an outline along a lateral axis `l` and a forward axis `f` (unit vectors). */
export function extentsAlong(sampled: Vec[], c: Vec, l: Vec, f: Vec): { a: number; b: number } {
  let lo = Infinity;
  let hi = -Infinity;
  let lo2 = Infinity;
  let hi2 = -Infinity;
  for (const p of sampled) {
    const dx = p.x - c.x;
    const dy = p.y - c.y;
    const u = dx * l.x + dy * l.y;
    const v = dx * f.x + dy * f.y;
    if (u < lo) lo = u;
    if (u > hi) hi = u;
    if (v < lo2) lo2 = v;
    if (v > hi2) hi2 = v;
  }
  return { a: (hi - lo) / 2, b: (hi2 - lo2) / 2 };
}

/** Frontage/depth (half extents) of an area relative to a facing bearing. */
export function areaExtentFacing(pts: Vec[], facing: number): { front: number; depth: number } {
  const s = sampleClosed(pts, 6);
  const c = areaCentroid(pts);
  const e = extentsAlong(s, c, fromBearing(facing + 90), fromBearing(facing));
  return { front: e.a, depth: e.b };
}

/** Equivalent radius (m) of the area enclosed by the smooth outline. */
export function areaRadius(pts: Vec[]): number {
  return Math.sqrt(polygonArea(sampleClosed(pts, 6)) / Math.PI);
}

/** Scale an outline about `c` by `k1` along axis `ax` and `k2` along the perpendicular. */
export function scaleAlong(pts: Vec[], c: Vec, ax: Vec, k1: number, k2: number): Vec[] {
  const pr = { x: -ax.y, y: ax.x };
  return pts.map((p) => {
    const d = sub(p, c);
    const u = d.x * ax.x + d.y * ax.y;
    const v = d.x * pr.x + d.y * pr.y;
    return add(c, add(scale(ax, u * k1), scale(pr, v * k2)));
  });
}

/** Rotate a vector by `deg` degrees clockwise (bearing sense). */
export function rotateVec(d: Vec, deg: number): Vec {
  const r = (-deg * Math.PI) / 180;
  return { x: d.x * Math.cos(r) - d.y * Math.sin(r), y: d.x * Math.sin(r) + d.y * Math.cos(r) };
}

/** Rotate an outline about c by `deg` degrees clockwise (bearing sense). */
export function rotatePts(pts: Vec[], c: Vec, deg: number): Vec[] {
  return pts.map((p) => add(c, rotateVec(sub(p, c), deg)));
}

/** Convex hull (monotone chain). */
export function convexHull(pts: Vec[]): Vec[] {
  const p = [...pts].sort((a, b) => a.x - b.x || a.y - b.y);
  if (p.length < 3) return p;
  const cross = (o: Vec, a: Vec, b: Vec) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: Vec[] = [];
  for (const q of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop();
    lower.push(q);
  }
  const upper: Vec[] = [];
  for (let i = p.length - 1; i >= 0; i--) {
    const q = p[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop();
    upper.push(q);
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

/**
 * An egg enclosing a set of outlines/points with a margin (for task-org group outlines):
 * convex hull, pushed outwards by `margin`, resampled to `n` smooth control points.
 */
export function enclosingEgg(pts: Vec[], margin: number, n = 12): Vec[] {
  if (!pts.length) return [];
  const c0 = { x: pts.reduce((m, p) => m + p.x, 0) / pts.length, y: pts.reduce((m, p) => m + p.y, 0) / pts.length };
  if (pts.length < 3) return eggPoints(c0, margin * 1.4 + (pts.length === 2 ? dist(pts[0], pts[1]) / 2 : 0), margin * 1.1, pts.length === 2 ? bearingDeg(pts[0], pts[1]) - 90 : 0, n);
  const hull = convexHull(pts);
  const c = areaCentroid(hull);
  const grown = hull.map((p) => {
    const d = sub(p, c);
    const L = Math.hypot(d.x, d.y) || 1;
    return add(p, scale(d, margin / L));
  });
  return resampleEven(grown, n, true);
}

function bearingDeg(a: Vec, b: Vec): number {
  return ((Math.atan2(b.x - a.x, b.y - a.y) * 180) / Math.PI + 360) % 360;
}

/** Closest point on the smooth outline to `p` (for connectors drawn from the egg's edge). */
export function edgePointToward(pts: Vec[], p: Vec): Vec {
  const s = sampleClosed(pts, 8);
  let best = s[0];
  let bd = Infinity;
  for (let i = 0; i < s.length; i++) {
    const r = distToSegment(p, s[i], s[(i + 1) % s.length]);
    if (r.d < bd) {
      bd = r.d;
      best = r.pt;
    }
  }
  return best;
}

// Planar geometry in metres. x = east, y = north. Bearings are degrees clockwise from north.

export interface Vec {
  x: number;
  y: number;
}

export const v = (x: number, y: number): Vec => ({ x, y });
export const add = (a: Vec, b: Vec): Vec => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a: Vec, b: Vec): Vec => ({ x: a.x - b.x, y: a.y - b.y });
export const scale = (a: Vec, k: number): Vec => ({ x: a.x * k, y: a.y * k });
export const dot = (a: Vec, b: Vec): number => a.x * b.x + a.y * b.y;
export const len = (a: Vec): number => Math.hypot(a.x, a.y);
export const dist = (a: Vec, b: Vec): number => Math.hypot(a.x - b.x, a.y - b.y);
export const lerp = (a: Vec, b: Vec, t: number): Vec => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
export const clamp = (x: number, lo: number, hi: number): number => (x < lo ? lo : x > hi ? hi : x);

export function norm(a: Vec): Vec {
  const l = len(a);
  return l > 1e-9 ? { x: a.x / l, y: a.y / l } : { x: 0, y: 0 };
}

/** Bearing from a to b, degrees clockwise from north, 0..360. */
export function bearing(a: Vec, b: Vec): number {
  const deg = (Math.atan2(b.x - a.x, b.y - a.y) * 180) / Math.PI;
  return (deg + 360) % 360;
}

/** Unit vector pointing along a bearing. */
export function fromBearing(deg: number): Vec {
  const r = (deg * Math.PI) / 180;
  return { x: Math.sin(r), y: Math.cos(r) };
}

/** Smallest absolute difference between two bearings (0..180). */
export function angleDiff(a: number, b: number): number {
  const d = Math.abs(((a - b) % 360) + 360) % 360;
  return d > 180 ? 360 - d : d;
}

export function polylineLength(pts: Vec[]): number {
  let s = 0;
  for (let i = 1; i < pts.length; i++) s += dist(pts[i - 1], pts[i]);
  return s;
}

/** Point at distance d along polyline (clamped). */
export function pointAlong(pts: Vec[], d: number): Vec {
  if (pts.length === 0) return { x: 0, y: 0 };
  if (d <= 0) return { ...pts[0] };
  let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    const seg = dist(pts[i - 1], pts[i]);
    if (acc + seg >= d) return lerp(pts[i - 1], pts[i], seg > 0 ? (d - acc) / seg : 0);
    acc += seg;
  }
  return { ...pts[pts.length - 1] };
}

/** Distance from point p to segment ab, with the closest point. */
export function distToSegment(p: Vec, a: Vec, b: Vec): { d: number; t: number; pt: Vec } {
  const ab = sub(b, a);
  const l2 = dot(ab, ab);
  let t = l2 > 0 ? dot(sub(p, a), ab) / l2 : 0;
  t = clamp(t, 0, 1);
  const pt = add(a, scale(ab, t));
  return { d: dist(p, pt), t, pt };
}

export function distToPolyline(p: Vec, pts: Vec[]): { d: number; pt: Vec; along: number } {
  let best = { d: Infinity, pt: pts[0] ?? p, along: 0 };
  let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    const r = distToSegment(p, pts[i - 1], pts[i]);
    const segLen = dist(pts[i - 1], pts[i]);
    if (r.d < best.d) best = { d: r.d, pt: r.pt, along: acc + r.t * segLen };
    acc += segLen;
  }
  if (pts.length === 1) best = { d: dist(p, pts[0]), pt: pts[0], along: 0 };
  return best;
}

export function pointInPolygon(p: Vec, poly: Vec[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y + 1e-12) + a.x) inside = !inside;
  }
  return inside;
}

export function distToPolygon(p: Vec, poly: Vec[]): number {
  if (pointInPolygon(p, poly)) return 0;
  return distToPolyline(p, [...poly, poly[0]]).d;
}

export function polygonArea(poly: Vec[]): number {
  let s = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) s += (poly[j].x + poly[i].x) * (poly[j].y - poly[i].y);
  return Math.abs(s / 2);
}

export function centroid(pts: Vec[]): Vec {
  if (pts.length === 0) return { x: 0, y: 0 };
  let x = 0;
  let y = 0;
  for (const p of pts) {
    x += p.x;
    y += p.y;
  }
  return { x: x / pts.length, y: y / pts.length };
}

export function bbox(pts: Vec[]): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of pts) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY };
}

/** Rotated ellipse polygon approximation. rot in degrees (counter-clockwise from east). */
export function ellipsePoly(c: Vec, rx: number, ry: number, rot = 0, n = 28): Vec[] {
  const r = (rot * Math.PI) / 180;
  const out: Vec[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const ex = Math.cos(a) * rx;
    const ey = Math.sin(a) * ry;
    out.push({ x: c.x + ex * Math.cos(r) - ey * Math.sin(r), y: c.y + ex * Math.sin(r) + ey * Math.cos(r) });
  }
  return out;
}

/** Normalised elliptical distance (1 at the rim). */
export function ellipseNormDist(p: Vec, c: Vec, rx: number, ry: number, rot = 0): number {
  const r = (-rot * Math.PI) / 180;
  const dx = p.x - c.x;
  const dy = p.y - c.y;
  const lx = dx * Math.cos(r) - dy * Math.sin(r);
  const ly = dx * Math.sin(r) + dy * Math.cos(r);
  return Math.sqrt((lx / rx) ** 2 + (ly / ry) ** 2);
}

export function segmentsIntersect(p1: Vec, p2: Vec, p3: Vec, p4: Vec): Vec | null {
  const d = (p4.y - p3.y) * (p2.x - p1.x) - (p4.x - p3.x) * (p2.y - p1.y);
  if (Math.abs(d) < 1e-12) return null;
  const ua = ((p4.x - p3.x) * (p1.y - p3.y) - (p4.y - p3.y) * (p1.x - p3.x)) / d;
  const ub = ((p2.x - p1.x) * (p1.y - p3.y) - (p2.y - p1.y) * (p1.x - p3.x)) / d;
  if (ua < 0 || ua > 1 || ub < 0 || ub > 1) return null;
  return { x: p1.x + ua * (p2.x - p1.x), y: p1.y + ua * (p2.y - p1.y) };
}

/** First intersection of a polyline with another polyline, or null. */
export function polylineIntersection(a: Vec[], b: Vec[]): Vec | null {
  for (let i = 1; i < a.length; i++) {
    for (let j = 1; j < b.length; j++) {
      const x = segmentsIntersect(a[i - 1], a[i], b[j - 1], b[j]);
      if (x) return x;
    }
  }
  return null;
}

/** Resample polyline into points every `step` metres. */
export function resample(pts: Vec[], step: number): Vec[] {
  const L = polylineLength(pts);
  if (L === 0) return pts.slice();
  const n = Math.max(1, Math.ceil(L / step));
  const out: Vec[] = [];
  for (let i = 0; i <= n; i++) out.push(pointAlong(pts, (i / n) * L));
  return out;
}

/** Chaikin smoothing for nicer generated curves. */
export function smooth(pts: Vec[], iterations = 2): Vec[] {
  let p = pts;
  for (let k = 0; k < iterations; k++) {
    if (p.length < 3) return p;
    const out: Vec[] = [p[0]];
    for (let i = 0; i < p.length - 1; i++) {
      out.push(lerp(p[i], p[i + 1], 0.25), lerp(p[i], p[i + 1], 0.75));
    }
    out.push(p[p.length - 1]);
    p = out;
  }
  return p;
}

/** Offset a point perpendicular to the direction a->b by d (positive = left). */
export function perpOffset(a: Vec, b: Vec, d: number): Vec {
  const n = norm(sub(b, a));
  return { x: -n.y * d, y: n.x * d };
}

export function round(n: number, dp = 0): number {
  const k = 10 ** dp;
  return Math.round(n * k) / k;
}

/** Translate a point by d (returns a new point). */
export function translateVec(p: Vec, d: Vec): Vec {
  return { x: p.x + d.x, y: p.y + d.y };
}

/** Translate every point of a polyline / polygon by d (returns new points). */
export function translatePts(pts: Vec[], d: Vec): Vec[] {
  return pts.map((p) => translateVec(p, d));
}

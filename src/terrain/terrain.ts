// Terrain analysis model. Rasterises the vector sketch into elevation, obstruction,
// cover, concealment and going layers used for line of sight, movement and combat.

import {
  type Vec,
  bearing,
  centroid,
  clamp,
  dist,
  distToPolyline,
  ellipseNormDist,
  pointInPolygon,
  bbox,
} from '../core/geom';
import { Rng } from '../core/rng';
import type { Feature, TerrainData } from '../core/types';

export type MoveMode = 'FOOT' | 'TRACKED' | 'WHEELED';

// Obstruction classes for line of sight
const OB_NONE = 0;
const OB_TREES = 1;
const OB_BUA = 2;
const OB_GRASS = 3;

export interface NamedPlace {
  name: string;
  pos: Vec;
  kind: string;
  /** Rough radius used when describing a location relative to it. */
  r: number;
}

export class TerrainModel {
  readonly data: TerrainData;
  readonly cell: number;
  readonly cols: number;
  readonly rows: number;
  readonly elev: Float32Array;
  readonly obstH: Float32Array;
  readonly obstType: Uint8Array;
  readonly cover: Float32Array;
  readonly conceal: Float32Array;
  readonly goFoot: Float32Array;
  readonly goTrack: Float32Array;
  readonly goWheel: Float32Array;
  readonly road: Uint8Array;
  readonly places: NamedPlace[];
  private wet: boolean;

  constructor(data: TerrainData, opts: { wet?: boolean } = {}) {
    this.data = data;
    this.cell = data.cell;
    this.cols = Math.ceil(data.width / data.cell);
    this.rows = Math.ceil(data.height / data.cell);
    const n = this.cols * this.rows;
    this.elev = new Float32Array(n);
    this.obstH = new Float32Array(n);
    this.obstType = new Uint8Array(n);
    this.cover = new Float32Array(n);
    this.conceal = new Float32Array(n);
    this.goFoot = new Float32Array(n).fill(1);
    this.goTrack = new Float32Array(n).fill(1);
    this.goWheel = new Float32Array(n).fill(0.55);
    this.road = new Uint8Array(n);
    this.places = [];
    this.wet = !!opts.wet;
    this.build();
  }

  // ------------------------------------------------------------ indexing
  idx(c: number, r: number): number {
    return r * this.cols + c;
  }
  cellOf(p: Vec): [number, number] {
    return [clamp(Math.floor(p.x / this.cell), 0, this.cols - 1), clamp(Math.floor(p.y / this.cell), 0, this.rows - 1)];
  }
  centerOf(c: number, r: number): Vec {
    return { x: (c + 0.5) * this.cell, y: (r + 0.5) * this.cell };
  }
  inBounds(p: Vec): boolean {
    return p.x >= 0 && p.y >= 0 && p.x < this.data.width && p.y < this.data.height;
  }
  clampPt(p: Vec): Vec {
    return { x: clamp(p.x, 1, this.data.width - 1), y: clamp(p.y, 1, this.data.height - 1) };
  }

  // ------------------------------------------------------------ build
  private build(): void {
    const rng = new Rng(`terrain-${this.data.width}-${this.data.height}-${this.data.features.length}`);
    const { cols, rows } = this;
    // gentle undulation of the plains (+-1 m), more for desert
    const amp = this.data.type === 'DESERT' ? 4 : this.data.type === 'SEMI_DESERT' ? 2.5 : 0.8;
    const waves = Array.from({ length: 5 }, () => ({
      kx: rng.range(0.0004, 0.0016),
      ky: rng.range(0.0004, 0.0016),
      ph: rng.range(0, Math.PI * 2),
      a: rng.range(0.4, 1),
    }));
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const p = this.centerOf(c, r);
        let e = 0;
        for (const w of waves) e += w.a * Math.sin(p.x * w.kx + p.y * w.ky + w.ph);
        this.elev[this.idx(c, r)] = (e / waves.length) * amp;
      }
    }
    for (const f of this.data.features) this.rasterFeature(f);
    // roads/tracks/bridges last so they override water obstacles at crossings
    for (const f of this.data.features) {
      if (f.kind === 'road' || f.kind === 'track') this.rasterRoad(f.pts, f.kind === 'road' ? 2 : 1);
    }
    for (const f of this.data.features) {
      if (f.kind === 'bridge') this.stampCircle(f.pos, 30, (i) => {
        this.goFoot[i] = 1;
        this.goTrack[i] = 1;
        this.goWheel[i] = 1;
      });
    }
    if (this.wet) {
      for (let i = 0; i < this.goTrack.length; i++) {
        if (!this.road[i]) {
          this.goTrack[i] *= 0.45;
          this.goWheel[i] *= 0.2;
          this.goFoot[i] *= 0.8;
        }
      }
    }
    this.collectPlaces();
  }

  private stampPoly(poly: Vec[], fn: (i: number, p: Vec) => void): void {
    const b = bbox(poly);
    const [c0, r0] = this.cellOf({ x: b.minX, y: b.minY });
    const [c1, r1] = this.cellOf({ x: b.maxX, y: b.maxY });
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const p = this.centerOf(c, r);
        if (pointInPolygon(p, poly)) fn(this.idx(c, r), p);
      }
    }
  }

  private stampCircle(center: Vec, radius: number, fn: (i: number, d: number) => void): void {
    const [c0, r0] = this.cellOf({ x: center.x - radius, y: center.y - radius });
    const [c1, r1] = this.cellOf({ x: center.x + radius, y: center.y + radius });
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const d = dist(this.centerOf(c, r), center);
        if (d <= radius) fn(this.idx(c, r), d);
      }
    }
  }

  private stampLine(pts: Vec[], halfWidth: number, fn: (i: number, d: number) => void): void {
    if (pts.length < 2) return;
    const b = bbox(pts);
    const pad = halfWidth + this.cell;
    const [c0, r0] = this.cellOf({ x: b.minX - pad, y: b.minY - pad });
    const [c1, r1] = this.cellOf({ x: b.maxX + pad, y: b.maxY + pad });
    const reach = halfWidth + this.cell * 0.72;
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const d = distToPolyline(this.centerOf(c, r), pts).d;
        if (d <= reach) fn(this.idx(c, r), d);
      }
    }
  }

  private rasterFeature(f: Feature): void {
    switch (f.kind) {
      case 'height': {
        const reach = Math.max(f.rx, f.ry) * 2.2;
        this.stampCircle(f.c, reach, (i) => {
          const p = this.centerOf(i % this.cols, Math.floor(i / this.cols));
          const d = ellipseNormDist(p, f.c, f.rx, f.ry, f.rot);
          const bump = f.h * Math.exp(-d * d * 1.05);
          this.elev[i] += bump;
        });
        break;
      }
      case 'bua':
        this.stampPoly(f.poly, (i) => {
          this.elev[i] += 1.5;
          this.obstH[i] = Math.max(this.obstH[i], 4 + 3 * f.storeys);
          this.obstType[i] = OB_BUA;
          this.cover[i] = Math.max(this.cover[i], 0.6);
          this.conceal[i] = Math.max(this.conceal[i], 0.8);
          this.goFoot[i] = 0.7;
          this.goTrack[i] = 0.35;
          this.goWheel[i] = 0.5;
        });
        break;
      case 'trees':
        this.stampPoly(f.poly, (i) => {
          this.obstH[i] = Math.max(this.obstH[i], 9);
          if (this.obstType[i] !== OB_BUA) this.obstType[i] = OB_TREES;
          this.cover[i] = Math.max(this.cover[i], 0.25);
          this.conceal[i] = Math.max(this.conceal[i], 0.75);
          this.goFoot[i] = Math.min(this.goFoot[i], 0.8);
          this.goTrack[i] = Math.min(this.goTrack[i], 0.5);
          this.goWheel[i] = Math.min(this.goWheel[i], 0.2);
        });
        break;
      case 'grass':
        this.stampPoly(f.poly, (i) => {
          this.obstH[i] = Math.max(this.obstH[i], 1.6);
          if (this.obstType[i] === OB_NONE) this.obstType[i] = OB_GRASS;
          this.conceal[i] = Math.max(this.conceal[i], 0.55);
        });
        break;
      case 'broken':
        this.stampPoly(f.poly, (i) => {
          this.elev[i] += 1.2;
          this.cover[i] = Math.max(this.cover[i], 0.35);
          this.conceal[i] = Math.max(this.conceal[i], 0.45);
          this.goFoot[i] = Math.min(this.goFoot[i], 0.6);
          this.goTrack[i] = Math.min(this.goTrack[i], 0.3);
          this.goWheel[i] = 0;
        });
        break;
      case 'dunes':
        this.stampPoly(f.poly, (i, p) => {
          this.elev[i] += 3 + 3 * Math.sin(p.x * 0.02) * Math.cos(p.y * 0.017);
          this.cover[i] = Math.max(this.cover[i], 0.3);
          this.conceal[i] = Math.max(this.conceal[i], 0.3);
          this.goFoot[i] = Math.min(this.goFoot[i], 0.65);
          this.goTrack[i] = Math.min(this.goTrack[i], 0.55);
          this.goWheel[i] = Math.min(this.goWheel[i], 0.15);
        });
        break;
      case 'marsh':
        this.stampPoly(f.poly, (i) => {
          this.goFoot[i] = 0.3;
          this.goTrack[i] = 0.05;
          this.goWheel[i] = 0;
        });
        break;
      case 'nullah':
        this.stampLine(f.pts, (f.width ?? 20) / 2, (i) => {
          this.elev[i] -= 2;
          this.cover[i] = Math.max(this.cover[i], 0.55);
          this.conceal[i] = Math.max(this.conceal[i], 0.5);
          this.goFoot[i] = Math.min(this.goFoot[i], 0.6);
          this.goTrack[i] = Math.min(this.goTrack[i], 0.3);
          this.goWheel[i] = Math.min(this.goWheel[i], 0.1);
        });
        break;
      case 'disty':
        this.stampLine(f.pts, (f.width ?? 10) / 2, (i) => {
          this.elev[i] += 1;
          this.cover[i] = Math.max(this.cover[i], 0.4);
          this.goFoot[i] = Math.min(this.goFoot[i], 0.5);
          this.goTrack[i] = Math.min(this.goTrack[i], 0.25);
          this.goWheel[i] = Math.min(this.goWheel[i], 0.05);
        });
        break;
      case 'canal':
      case 'river':
        this.stampLine(f.pts, (f.width ?? 30) / 2, (i) => {
          this.goFoot[i] = Math.min(this.goFoot[i], 0.08);
          this.goTrack[i] = 0;
          this.goWheel[i] = 0;
        });
        break;
      case 'bund':
        this.stampLine(f.pts, 6, (i) => {
          this.elev[i] += 3;
          this.cover[i] = Math.max(this.cover[i], 0.5);
          this.goTrack[i] = Math.min(this.goTrack[i], 0.6);
        });
        break;
      case 'kbund': {
        const arc = kidneyBundPts(f.c, f.r, f.rot);
        this.stampLine(arc, 8, (i) => {
          this.elev[i] += 3;
          this.cover[i] = Math.max(this.cover[i], 0.55);
          this.conceal[i] = Math.max(this.conceal[i], 0.4);
        });
        break;
      }
      case 'bop':
        this.stampCircle(f.pos, 40, (i) => {
          this.cover[i] = Math.max(this.cover[i], 0.5);
          this.elev[i] += 1;
        });
        break;
      case 'graveyard':
        this.stampCircle(f.pos, 60, (i) => {
          this.cover[i] = Math.max(this.cover[i], 0.3);
          this.conceal[i] = Math.max(this.conceal[i], 0.35);
        });
        break;
      default:
        break;
    }
  }

  private rasterRoad(pts: Vec[], level: number): void {
    this.stampLine(pts, 4, (i) => {
      this.road[i] = Math.max(this.road[i], level);
      const g = level === 2 ? 1 : 0.9;
      // bridges handled separately; a road crossing water is a bridge only where a bridge feature exists
      if (this.goTrack[i] > 0.05 || level === 2) {
        this.goFoot[i] = Math.max(this.goFoot[i], g);
        this.goTrack[i] = Math.max(this.goTrack[i], g);
        this.goWheel[i] = Math.max(this.goWheel[i], g);
      }
    });
  }

  private collectPlaces(): void {
    for (const f of this.data.features) {
      if (!f.name) continue;
      switch (f.kind) {
        case 'bua':
          this.places.push({ name: f.name, pos: centroid(f.poly), kind: 'bua', r: 150 });
          break;
        case 'height':
          this.places.push({ name: f.name, pos: f.c, kind: 'height', r: Math.max(f.rx, f.ry) });
          break;
        case 'trees':
        case 'broken':
        case 'grass':
        case 'dunes':
        case 'marsh':
          this.places.push({ name: f.name, pos: centroid(f.poly), kind: f.kind, r: 100 });
          break;
        case 'bop':
        case 'bridge':
        case 'graveyard':
          this.places.push({ name: f.name, pos: f.pos, kind: f.kind, r: 40 });
          break;
        case 'kbund':
          this.places.push({ name: f.name, pos: f.c, kind: 'kbund', r: f.r });
          break;
        default:
          break;
      }
    }
  }

  // ------------------------------------------------------------ queries
  sample(arr: Float32Array | Uint8Array, p: Vec): number {
    const [c, r] = this.cellOf(p);
    return arr[this.idx(c, r)];
  }
  elevAt(p: Vec): number {
    return this.sample(this.elev, p);
  }
  coverAt(p: Vec): number {
    return this.sample(this.cover, p);
  }
  concealAt(p: Vec): number {
    return this.sample(this.conceal, p);
  }
  isBua(p: Vec): boolean {
    return this.sample(this.obstType, p) === OB_BUA;
  }
  isTrees(p: Vec): boolean {
    return this.sample(this.obstType, p) === OB_TREES;
  }
  goingAt(p: Vec, mode: MoveMode): number {
    const arr = mode === 'FOOT' ? this.goFoot : mode === 'TRACKED' ? this.goTrack : this.goWheel;
    return this.sample(arr, p);
  }
  onRoad(p: Vec): boolean {
    return this.sample(this.road, p) > 0;
  }

  /** Eye height above ground for an observer at p (rooftops in BUAs). */
  eyeHeight(p: Vec, base = 2): number {
    return this.isBua(p) ? base + 5 : base;
  }

  /**
   * Line of sight from a to b. Returns 0 (blocked) .. 1 (clear); vegetation thins sight progressively.
   * hA/hB are heights above ground of the observer and target.
   */
  los(a: Vec, b: Vec, hA = 2, hB = 1.5): number {
    const D = dist(a, b);
    if (D < this.cell * 1.5) return 1;
    const zA = this.elevAt(a) + hA;
    const zB = this.elevAt(b) + hB;
    const step = this.cell * 0.6;
    const n = Math.ceil(D / step);
    let treesM = 0;
    let grassM = 0;
    const [ca, ra] = this.cellOf(a);
    const [cb, rb] = this.cellOf(b);
    const ia = this.idx(ca, ra);
    const ib = this.idx(cb, rb);
    for (let k = 1; k < n; k++) {
      const t = k / n;
      const x = a.x + (b.x - a.x) * t;
      const y = a.y + (b.y - a.y) * t;
      const c = clamp(Math.floor(x / this.cell), 0, this.cols - 1);
      const r = clamp(Math.floor(y / this.cell), 0, this.rows - 1);
      const i = r * this.cols + c;
      const z = zA + (zB - zA) * t;
      const g = this.elev[i];
      if (g > z) return 0;
      const top = g + this.obstH[i];
      if (top > z) {
        const ty = this.obstType[i];
        // an observer/target inside a BUA or wood can see out of its own edge
        const nearEnd = (i === ia || i === ib) || (D * t < 60 || D * (1 - t) < 60);
        if (ty === OB_BUA && !nearEnd) return 0;
        if (ty === OB_TREES && !nearEnd) {
          treesM += step;
          if (treesM > 90) return 0;
        }
        if (ty === OB_GRASS && !nearEnd) grassM += step;
      }
    }
    let f = 1;
    if (treesM > 0) f *= clamp(1 - treesM / 100, 0.15, 1);
    if (grassM > 0) f *= clamp(1 - grassM / 250, 0.3, 1);
    return f;
  }

  /** Viewshed bitmap at a coarse resolution for fog of war rendering. */
  viewshed(observers: { pos: Vec; range: number; h?: number }[], res = 50): { cols: number; rows: number; res: number; vis: Uint8Array } {
    const cols = Math.ceil(this.data.width / res);
    const rows = Math.ceil(this.data.height / res);
    const vis = new Uint8Array(cols * rows);
    for (const o of observers) {
      const h = o.h ?? this.eyeHeight(o.pos);
      const c0 = Math.max(0, Math.floor((o.pos.x - o.range) / res));
      const c1 = Math.min(cols - 1, Math.floor((o.pos.x + o.range) / res));
      const r0 = Math.max(0, Math.floor((o.pos.y - o.range) / res));
      const r1 = Math.min(rows - 1, Math.floor((o.pos.y + o.range) / res));
      for (let r = r0; r <= r1; r++) {
        for (let c = c0; c <= c1; c++) {
          const i = r * cols + c;
          if (vis[i] === 2) continue;
          const p = { x: (c + 0.5) * res, y: (r + 0.5) * res };
          const d = dist(p, o.pos);
          if (d > o.range) continue;
          const l = this.los(o.pos, p, h, 1.5);
          if (l > 0.5) vis[i] = 2;
          else if (l > 0.1 && vis[i] < 1) vis[i] = 1;
        }
      }
    }
    return { cols, rows, res, vis };
  }

  // ------------------------------------------------------------ pathfinding
  /**
   * A* path over the going raster. `avoid` adds cost near threat points (used by the
   * enemy to prefer covered routes and by own C attk forces to come in from a flank).
   */
  findPath(from: Vec, to: Vec, mode: MoveMode, opts: { avoid?: { pos: Vec; r: number; w: number }[]; preferCover?: number; coarse?: number } = {}): Vec[] {
    const k = opts.coarse ?? (this.cols * this.rows > 90000 ? 2 : 1);
    const cs = this.cell * k;
    const cols = Math.ceil(this.cols / k);
    const rows = Math.ceil(this.rows / k);
    const go = mode === 'FOOT' ? this.goFoot : mode === 'TRACKED' ? this.goTrack : this.goWheel;
    const goAt = (c: number, r: number) => {
      const cc = Math.min(this.cols - 1, c * k + (k >> 1));
      const rr = Math.min(this.rows - 1, r * k + (k >> 1));
      return go[rr * this.cols + cc];
    };
    const coverAt = (c: number, r: number) => {
      const cc = Math.min(this.cols - 1, c * k + (k >> 1));
      const rr = Math.min(this.rows - 1, r * k + (k >> 1));
      const i = rr * this.cols + cc;
      return Math.max(this.cover[i], this.conceal[i]);
    };
    const sc = clamp(Math.floor(from.x / cs), 0, cols - 1);
    const sr = clamp(Math.floor(from.y / cs), 0, rows - 1);
    const tc = clamp(Math.floor(to.x / cs), 0, cols - 1);
    const tr = clamp(Math.floor(to.y / cs), 0, rows - 1);
    const N = cols * rows;
    const g = new Float32Array(N).fill(Infinity);
    const came = new Int32Array(N).fill(-1);
    const closed = new Uint8Array(N);
    const heap = new MinHeap();
    const start = sr * cols + sc;
    const goal = tr * cols + tc;
    g[start] = 0;
    heap.push(start, 0);
    const avoid = opts.avoid ?? [];
    const prefer = opts.preferCover ?? 0;
    const dirs = [
      [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
      [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2],
    ];
    let found = false;
    let guard = 0;
    while (heap.size > 0 && guard++ < N * 4) {
      const cur = heap.pop();
      if (cur === goal) {
        found = true;
        break;
      }
      if (closed[cur]) continue;
      closed[cur] = 1;
      const cc = cur % cols;
      const cr = (cur - cc) / cols;
      for (const [dc, dr, dd] of dirs) {
        const nc = cc + dc;
        const nr = cr + dr;
        if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue;
        const ni = nr * cols + nc;
        if (closed[ni]) continue;
        const s = goAt(nc, nr);
        if (s <= 0.02) continue;
        let cost = (dd * cs) / s;
        if (prefer > 0) cost *= 1 + prefer * (1 - coverAt(nc, nr));
        if (avoid.length) {
          const p = { x: (nc + 0.5) * cs, y: (nr + 0.5) * cs };
          for (const a of avoid) {
            const d = dist(p, a.pos);
            if (d < a.r) cost += a.w * cs * (1 - d / a.r);
          }
        }
        const ng = g[cur] + cost;
        if (ng < g[ni]) {
          g[ni] = ng;
          came[ni] = cur;
          const hx = (nc - tc) * cs;
          const hy = (nr - tr) * cs;
          heap.push(ni, ng + Math.hypot(hx, hy));
        }
      }
    }
    if (!found) return [from, to];
    const cellsPath: number[] = [];
    for (let cur = goal; cur !== -1; cur = came[cur]) cellsPath.push(cur);
    cellsPath.reverse();
    const pts: Vec[] = [from];
    // keep every few cells to produce a light polyline
    for (let i = 2; i < cellsPath.length - 1; i += 3) {
      const ci = cellsPath[i];
      pts.push({ x: ((ci % cols) + 0.5) * cs, y: (Math.floor(ci / cols) + 0.5) * cs });
    }
    pts.push(to);
    return pts;
  }

  // ------------------------------------------------------------ grid references & descriptions
  gridLabelE(x: number): number {
    return (this.data.gridOrigin.e + Math.floor(x / this.data.gridSq)) % 100;
  }
  gridLabelN(y: number): number {
    return (this.data.gridOrigin.n + Math.floor(y / this.data.gridSq)) % 100;
  }
  /** Four-figure square reference, e.g. "Sq 1574". */
  squareRef(p: Vec): string {
    const e = String(this.gridLabelE(p.x)).padStart(2, '0');
    const n = String(this.gridLabelN(p.y)).padStart(2, '0');
    return `Sq ${e}${n}`;
  }
  /** Six-figure grid reference, e.g. "GR 154 742". */
  gridRef(p: Vec): string {
    const gs = this.data.gridSq;
    const e = (this.data.gridOrigin.e * 10 + Math.floor((p.x / gs) * 10)) % 1000;
    const n = (this.data.gridOrigin.n * 10 + Math.floor((p.y / gs) * 10)) % 1000;
    return `GR ${String(e).padStart(3, '0')} ${String(n).padStart(3, '0')}`;
  }

  nearestPlace(p: Vec, kinds?: string[]): { place: NamedPlace; d: number } | null {
    let best: { place: NamedPlace; d: number } | null = null;
    for (const pl of this.places) {
      if (kinds && !kinds.includes(pl.kind)) continue;
      const d = Math.max(0, dist(p, pl.pos) - pl.r * 0.5);
      if (!best || d < best.d) best = { place: pl, d };
    }
    return best;
  }

  /** Human description: "area Clump 2" or "300 m W of 9 r". */
  describe(p: Vec): string {
    const n = this.nearestPlace(p);
    if (!n) return this.gridRef(p);
    if (n.d < Math.max(120, n.place.r)) return `area ${n.place.name}`;
    const dd = Math.round(n.d / 50) * 50;
    if (dd > 1500) return `${this.gridRef(p)}`;
    return `${dd} m ${compass(bearing(n.place.pos, p))} of ${n.place.name}`;
  }
}

export function compass(b: number): string {
  const names = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  return names[Math.round(b / 45) % 8];
}

/** Kidney bund: a semi-circular earth bank open towards `rot`. */
export function kidneyBundPts(c: Vec, r: number, rot: number): Vec[] {
  const pts: Vec[] = [];
  const open = (rot * Math.PI) / 180;
  for (let i = 0; i <= 16; i++) {
    const a = open + Math.PI * 0.5 + (i / 16) * Math.PI;
    pts.push({ x: c.x + Math.sin(a) * r, y: c.y + Math.cos(a) * r * 0.55 });
  }
  return pts;
}

class MinHeap {
  private ids: number[] = [];
  private keys: number[] = [];
  get size(): number {
    return this.ids.length;
  }
  push(id: number, key: number): void {
    this.ids.push(id);
    this.keys.push(key);
    let i = this.ids.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.keys[p] <= this.keys[i]) break;
      this.swap(i, p);
      i = p;
    }
  }
  pop(): number {
    const top = this.ids[0];
    const lastId = this.ids.pop()!;
    const lastKey = this.keys.pop()!;
    if (this.ids.length > 0) {
      this.ids[0] = lastId;
      this.keys[0] = lastKey;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < this.ids.length && this.keys[l] < this.keys[m]) m = l;
        if (r < this.ids.length && this.keys[r] < this.keys[m]) m = r;
        if (m === i) break;
        this.swap(i, m);
        i = m;
      }
    }
    return top;
  }
  private swap(a: number, b: number): void {
    [this.ids[a], this.ids[b]] = [this.ids[b], this.ids[a]];
    [this.keys[a], this.keys[b]] = [this.keys[b], this.keys[a]];
  }
}

// Cache terrain models by scenario id (building the raster takes a moment on big maps).
const cache = new Map<string, TerrainModel>();
export function terrainFor(key: string, data: TerrainData, wet = false): TerrainModel {
  const k = `${key}:${wet ? 'w' : 'd'}`;
  let t = cache.get(k);
  if (!t) {
    t = new TerrainModel(data, { wet });
    if (cache.size > 12) cache.clear();
    cache.set(k, t);
  }
  return t;
}

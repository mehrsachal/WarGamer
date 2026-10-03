// Canvas map renderer: relief + sketch-style cartography, grid, tactical graphics (APP-6
// conventions), NATO unit symbols, fog of war, fires. Designed for clarity first.

import { type Vec, add, bearing, centroid, dist, ellipsePoly, norm, perpOffset, pointAlong, polylineLength, scale, sub } from '../core/geom';
import type { DsSolution, Echelon, Feature, PlanGraphic, Scenario, Side } from '../core/types';
import { closedBeziers, openBeziers, sampleClosed, sampleOpen } from '../plan/area';
import { kidneyBundPts, type TerrainModel } from '../terrain/terrain';
import { symbolImage } from './symbols';

export interface UnitGlyph {
  id: string;
  sidc: string;
  pos: Vec;
  label: string;
  higher?: string;
  facing?: number;
  arc?: boolean;
  planned?: boolean;
  strengthPct?: number;
  selected?: boolean;
  dim?: boolean;
  side: Side | 'UNK';
  altPos?: Vec;
  parentPos?: Vec;
  conf?: number;
  stale?: boolean;
  status?: 'OK' | 'ASSAULT' | 'WITHDRAW' | 'LOST' | 'MOVE';
  radius?: number;
  /**
   * Goose egg (unit area): closed outline control points, world m, drawn as a smooth closed curve
   * with the echelon indicator on top and the designation inside — instead of the framed symbol.
   */
  area?: Vec[];
  /** Echelon shown on top of the egg. */
  echelon?: Echelon;
  /** Small type glyph inside the egg. */
  glyph?: 'INF' | 'ARMOUR' | 'HQ' | 'NONE';
  /** "Found from" connector: drawn from `from` (edge of the parent egg) to the unit, with a tag. */
  link?: { from: Vec; tag?: string };
  /** Point-symbol shape override: OP/LP triangle. */
  shape?: 'OPLP';
  /** Secondary text under a point symbol / inside an egg (e.g. strength "1+2"). */
  sub?: string;
  /** Alternate position as an area (dashed egg). */
  altArea?: Vec[];
}

export interface MissionGlyph {
  target: Vec;
  radius: number;
  side: Side;
  label: string;
}

export interface FireGlyph {
  from: Vec;
  to: Vec;
  kind: number;
}

export interface MapScene {
  units: UnitGlyph[];
  graphics: PlanGraphic[];
  selectedGraphicId?: string;
  fires?: FireGlyph[];
  missions?: MissionGlyph[];
  qcs?: { pos: Vec; kind: string }[];
  ds?: DsSolution | null;
  enemyPlan?: { faa: Vec; fup: Vec; bof: Vec; objectives: { pos: Vec; name: string; phase: number }[]; approach: Vec[]; names: { faa: string; fup: string; bof: string } } | null;
  draft?: { kind: string; pts: Vec[]; radius?: number; closed?: boolean } | null;
  cursor?: Vec | null;
  trails?: { pts: Vec[]; side: Side }[];
  fog?: { cols: number; rows: number; res: number; vis: Uint8Array } | null;
  night?: boolean;
  measure?: { a: Vec; b: Vec } | null;
  /** Task-organisation groups: larger dashed eggs enclosing their members. */
  groups?: { id: string; label: string; area: Vec[]; selected?: boolean; echelon?: Echelon }[];
  /** Additional selected graphics (multi-selection). */
  selectedGraphicIds?: string[];
  /** Edit handles of the selected item (vertex / insert / resize / rotate / radius). */
  handles?: { p: Vec; kind: 'vertex' | 'mid' | 'resize' | 'rotate' | 'radius'; hot?: boolean }[];
  /** Box-select rectangle. */
  box?: { a: Vec; b: Vec } | null;
  /** Neutral overlays (no DS priorities): candidate apchs / lines for the appreciation. */
  neutral?: { arrows: { pts: Vec[]; label: string; hi?: boolean }[]; lines: { pts: Vec[]; label: string; hi?: boolean }[] } | null;
}

export interface Layers {
  grid: boolean;
  labels: boolean;
  aor: boolean;
  arcs: boolean;
  graphics: boolean;
  relief: boolean;
  /** Scale bar, north arrow, grid numbers, frame. */
  decor: boolean;
  /**
   * Relief, background and cartographic features. false = transparent overlay of plan/battle
   * graphics only (used to drape graphics over the 3D terrain). Absent = true.
   */
  terrain?: boolean;
}

const PALETTE = {
  PLAINS: [238, 240, 226],
  CANAL: [234, 240, 224],
  DESERT: [241, 228, 196],
  SEMI_DESERT: [238, 233, 210],
} as const;

/** Free-drawing colours (PlanGraphic.props.color). */
const GCOL: Record<string, string> = { BLUE: '#0b5cad', RED: '#c62828', BLACK: '#1b2329', GREEN: '#13803a', PURPLE: '#5b2a86', AMBER: '#c77700' };
const SEL_GLOW = 'rgba(255,179,0,0.75)';

function withAlpha(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

const C = {
  bg: '#141a1f',
  road: '#d0312d',
  roadCase: '#7a1612',
  track: '#d0312d',
  water: '#2f6fc0',
  waterFill: '#9cc3ef',
  nullah: '#5a4632',
  height: '#8a5a2b',
  heightFill: 'rgba(170,120,60,0.10)',
  bua: '#c4473a',
  buaEdge: '#7e2219',
  trees: '#2f7d32',
  treesFill: 'rgba(76,150,70,0.22)',
  grid: 'rgba(40,52,60,0.30)',
  gridLabel: '#24323d',
  label: '#1b2329',
  blue: '#0b5cad',
  obstacle: '#13803a',
  fire: '#5b2a86',
  enemy: '#c62828',
  ds: '#e07b00',
  aor: 'rgba(11,92,173,0.85)',
};

export class MapRenderer {
  readonly canvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
  readonly s: Scenario;
  readonly t: TerrainModel;
  dpr = 1;
  w = 0;
  h = 0;
  /** CSS px per metre. */
  scale = 0.1;
  cx = 0;
  cy = 0;
  layers: Layers = { grid: true, labels: true, aor: true, arcs: true, graphics: true, relief: true, decor: true };
  scene: MapScene = { units: [], graphics: [] };
  private base: HTMLCanvasElement | null = null;
  private baseNight: HTMLCanvasElement | null = null;

  constructor(canvas: HTMLCanvasElement, s: Scenario, t: TerrainModel) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
    this.s = s;
    this.t = t;
    this.cx = s.terrain.width / 2;
    this.cy = s.terrain.height / 2;
  }

  // ------------------------------------------------------------------ view
  /** Resize the drawing surface (CSS px). `dpr` overrides the device pixel ratio (offscreen rendering). */
  resize(w: number, h: number, dpr?: number): void {
    this.dpr = dpr ?? Math.min(3, (typeof window !== 'undefined' && window.devicePixelRatio) || 1);
    this.w = w;
    this.h = h;
    this.canvas.width = Math.round(w * this.dpr);
    this.canvas.height = Math.round(h * this.dpr);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
  }

  fit(box?: { minX: number; minY: number; maxX: number; maxY: number }, pad = 40, cover = false): void {
    const b = box ?? { minX: 0, minY: 0, maxX: this.s.terrain.width, maxY: this.s.terrain.height };
    const bw = Math.max(50, b.maxX - b.minX);
    const bh = Math.max(50, b.maxY - b.minY);
    const sx = (this.w - pad * 2) / bw;
    const sy = (this.h - pad * 2) / bh;
    this.scale = cover ? Math.max(sx, sy) : Math.min(sx, sy);
    this.cx = (b.minX + b.maxX) / 2;
    this.cy = (b.minY + b.maxY) / 2;
  }

  toScreen(p: Vec): Vec {
    return { x: (p.x - this.cx) * this.scale + this.w / 2, y: this.h / 2 - (p.y - this.cy) * this.scale };
  }
  toWorld(sx: number, sy: number): Vec {
    return { x: (sx - this.w / 2) / this.scale + this.cx, y: (this.h / 2 - sy) / this.scale + this.cy };
  }
  zoomAt(sx: number, sy: number, factor: number): void {
    const before = this.toWorld(sx, sy);
    const maxScale = 2.5;
    const minScale = Math.min(this.w / this.s.terrain.width, this.h / this.s.terrain.height) * 0.5;
    this.scale = Math.max(minScale, Math.min(maxScale, this.scale * factor));
    const after = this.toWorld(sx, sy);
    this.cx += before.x - after.x;
    this.cy += before.y - after.y;
  }
  panBy(dx: number, dy: number): void {
    this.cx -= dx / this.scale;
    this.cy += dy / this.scale;
  }
  /** Pixels for a length in metres, clamped for legibility. */
  private px(m: number, lo = 0, hi = 9999): number {
    return Math.max(lo, Math.min(hi, m * this.scale));
  }

  // ------------------------------------------------------------------ base relief
  private buildBase(night: boolean): HTMLCanvasElement {
    const t = this.t;
    const c = document.createElement('canvas');
    c.width = t.cols;
    c.height = t.rows;
    const g = c.getContext('2d')!;
    const img = g.createImageData(t.cols, t.rows);
    const base = PALETTE[this.s.terrain.type];
    const L = norm({ x: -1, y: 1 });
    for (let r = 0; r < t.rows; r++) {
      for (let col = 0; col < t.cols; col++) {
        const i = t.idx(col, r);
        const e = t.elev[i];
        const ex = t.elev[t.idx(Math.min(t.cols - 1, col + 1), r)] - t.elev[t.idx(Math.max(0, col - 1), r)];
        const ey = t.elev[t.idx(col, Math.min(t.rows - 1, r + 1))] - t.elev[t.idx(col, Math.max(0, r - 1))];
        const k = 3.2 / t.cell;
        const shade = Math.max(-1, Math.min(1, -(ex * L.x + ey * L.y) * k));
        const hi = Math.max(0, Math.min(1, e / 20));
        let R = base[0] - hi * 18 + shade * 26;
        let G = base[1] - hi * 26 + shade * 26;
        let B = base[2] - hi * 40 + shade * 22;
        if (night) {
          R = R * 0.32 + 6;
          G = G * 0.36 + 10;
          B = B * 0.42 + 16;
        }
        const o = ((t.rows - 1 - r) * t.cols + col) * 4;
        img.data[o] = R;
        img.data[o + 1] = G;
        img.data[o + 2] = B;
        img.data[o + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
    return c;
  }

  // ------------------------------------------------------------------ draw
  draw(): void {
    const g = this.ctx;
    const sc = this.scene;
    const night = !!sc.night;
    const terrain = this.layers.terrain !== false;
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const tl = this.toScreen({ x: 0, y: this.s.terrain.height });
    const br = this.toScreen({ x: this.s.terrain.width, y: 0 });
    if (terrain) {
      g.fillStyle = C.bg;
      g.fillRect(0, 0, this.w, this.h);
      // relief
      if (night) this.baseNight = this.baseNight ?? this.buildBase(true);
      else this.base = this.base ?? this.buildBase(false);
      g.save();
      g.imageSmoothingEnabled = true;
      g.imageSmoothingQuality = 'high';
      g.drawImage((night ? this.baseNight : this.base)!, tl.x, tl.y, br.x - tl.x, br.y - tl.y);
      g.restore();
    } else g.clearRect(0, 0, this.w, this.h);
    g.save();
    g.beginPath();
    g.rect(tl.x, tl.y, br.x - tl.x, br.y - tl.y);
    g.clip();
    if (terrain) this.drawFeatures(night);
    if (this.layers.grid) this.drawGrid(night);
    if (sc.fog) this.drawFog(sc.fog);
    if (this.layers.aor) this.drawAor();
    if (sc.neutral) {
      for (const a of sc.neutral.arrows) this.arrow(a.pts, a.hi ? 'rgba(224,123,0,0.9)' : 'rgba(60,70,80,0.65)', a.hi ? 5 : 3.5, true, a.label);
      for (const l of sc.neutral.lines) {
        this.path(l.pts);
        g.strokeStyle = l.hi ? 'rgba(11,92,173,0.95)' : 'rgba(70,60,50,0.75)';
        g.lineWidth = l.hi ? 4 : 2.5;
        g.setLineDash([9, 6]);
        g.stroke();
        g.setLineDash([]);
        const s0 = this.toScreen(l.pts[0]);
        this.halo(l.label, s0.x + 6, s0.y - 12, 13, l.hi ? '#0b5cad' : '#3e2f22', 'left', 800);
      }
    }
    if (sc.ds) this.drawDs(sc.ds);
    if (sc.enemyPlan) this.drawEnemyPlan(sc.enemyPlan);
    if (this.layers.graphics) for (const gr of sc.graphics) this.drawGraphic(gr, gr.id === sc.selectedGraphicId || !!sc.selectedGraphicIds?.includes(gr.id));
    if (sc.trails) this.drawTrails(sc.trails);
    if (sc.missions) this.drawMissions(sc.missions);
    if (sc.groups) this.drawGroups(sc.groups);
    this.drawUnits(sc.units);
    if (sc.qcs) this.drawQcs(sc.qcs);
    if (sc.fires) this.drawFires(sc.fires);
    if (sc.draft) this.drawDraft(sc.draft);
    if (sc.measure) this.drawMeasure(sc.measure);
    if (sc.box) this.drawBox(sc.box);
    if (sc.handles) this.drawHandles(sc.handles);
    g.restore();
    if (this.layers.decor) this.drawFrame(tl, br);
  }

  private path(pts: Vec[], close = false): void {
    const g = this.ctx;
    g.beginPath();
    pts.forEach((p, i) => {
      const s = this.toScreen(p);
      if (i === 0) g.moveTo(s.x, s.y);
      else g.lineTo(s.x, s.y);
    });
    if (close) g.closePath();
  }

  private halo(text: string, x: number, y: number, size: number, color = C.label, align: CanvasTextAlign = 'center', weight = 600, haloColor = 'rgba(255,255,255,0.85)'): void {
    const g = this.ctx;
    g.font = `${weight} ${size}px Bahnschrift, 'Arial Narrow', Arial, sans-serif`;
    g.textAlign = align;
    g.textBaseline = 'middle';
    g.lineJoin = 'round';
    g.lineWidth = Math.max(2.5, size / 4);
    g.strokeStyle = haloColor;
    g.strokeText(text, x, y);
    g.fillStyle = color;
    g.fillText(text, x, y);
  }

  private drawFeatures(night: boolean): void {
    const g = this.ctx;
    const feats = this.s.terrain.features;
    const lw = (m: number, lo: number, hi: number) => this.px(m, lo, hi);
    const order = (f: Feature) => ({ grass: 0, dunes: 1, broken: 1, marsh: 1, trees: 2, height: 3, bua: 4, nullah: 5, disty: 6, canal: 6, river: 6, bund: 7, kbund: 7, track: 8, road: 9, railway: 9, border: 10, bridge: 11, bop: 12, graveyard: 12 })[f.kind] ?? 5;
    const sorted = [...feats].sort((a, b) => order(a) - order(b));
    for (const f of sorted) {
      switch (f.kind) {
        case 'grass':
          this.path(f.poly, true);
          g.fillStyle = night ? 'rgba(90,110,60,0.25)' : 'rgba(150,170,90,0.18)';
          g.fill();
          this.hatch(f.poly, night ? 'rgba(120,140,80,0.5)' : 'rgba(110,130,60,0.45)', 'grass');
          break;
        case 'dunes':
          this.path(f.poly, true);
          g.fillStyle = night ? 'rgba(120,100,60,0.25)' : 'rgba(205,175,110,0.32)';
          g.fill();
          this.hatch(f.poly, night ? 'rgba(160,140,90,0.6)' : 'rgba(110,80,40,0.7)', 'dunes');
          break;
        case 'broken':
          this.path(f.poly, true);
          g.fillStyle = night ? 'rgba(110,90,70,0.25)' : 'rgba(150,115,80,0.16)';
          g.fill();
          this.hatch(f.poly, night ? 'rgba(170,150,120,0.6)' : 'rgba(90,60,30,0.7)', 'broken');
          break;
        case 'marsh':
          this.path(f.poly, true);
          g.fillStyle = 'rgba(80,140,200,0.18)';
          g.fill();
          this.hatch(f.poly, 'rgba(40,90,160,0.6)', 'marsh');
          break;
        case 'trees':
          this.path(f.poly, true);
          g.fillStyle = night ? 'rgba(40,90,40,0.45)' : C.treesFill;
          g.fill();
          this.trees(f.poly, night);
          break;
        case 'height': {
          const poly = ellipsePoly(f.c, f.rx, f.ry, f.rot, 36);
          this.path(poly, true);
          g.fillStyle = night ? 'rgba(140,100,60,0.18)' : C.heightFill;
          g.fill();
          g.strokeStyle = night ? '#b07a45' : C.height;
          g.lineWidth = lw(10, 1.6, 3.5);
          g.stroke();
          // inner contour for relief
          this.path(ellipsePoly(f.c, f.rx * 0.55, f.ry * 0.55, f.rot, 28), true);
          g.lineWidth = lw(5, 0.8, 1.6);
          g.globalAlpha = 0.6;
          g.stroke();
          g.globalAlpha = 1;
          break;
        }
        case 'bua':
          this.path(f.poly, true);
          g.fillStyle = night ? '#7a2c22' : C.bua;
          g.fill();
          g.strokeStyle = C.buaEdge;
          g.lineWidth = lw(6, 1, 2);
          g.stroke();
          if (f.storeys > 1 && this.scale > 0.12) this.hatch(f.poly, 'rgba(90,20,10,0.55)', 'bua');
          break;
        case 'nullah': {
          this.path(f.pts);
          g.strokeStyle = night ? '#a98f72' : C.nullah;
          g.lineWidth = lw(14, 2, 4.5);
          g.lineCap = 'round';
          g.stroke();
          this.ticks(f.pts, night ? '#a98f72' : C.nullah, 60, 9);
          break;
        }
        case 'disty':
        case 'canal':
        case 'river': {
          const wdt = f.width ?? (f.kind === 'canal' ? 40 : 10);
          this.path(f.pts);
          g.strokeStyle = C.water;
          g.lineWidth = lw(wdt + 6, 2.2, 14);
          g.lineCap = 'round';
          g.stroke();
          if (wdt > 20) {
            this.path(f.pts);
            g.strokeStyle = C.waterFill;
            g.lineWidth = lw(wdt - 6, 1, 10);
            g.stroke();
          }
          break;
        }
        case 'bund':
          this.path(f.pts);
          g.strokeStyle = night ? '#9b7a55' : '#7c5a35';
          g.lineWidth = lw(8, 1.5, 3);
          g.setLineDash([6, 3]);
          g.stroke();
          g.setLineDash([]);
          break;
        case 'kbund': {
          const pts = kidneyBundPts(f.c, f.r, f.rot);
          this.path(pts);
          g.strokeStyle = night ? '#d8d0c0' : '#222';
          g.lineWidth = lw(14, 2.5, 5);
          g.lineCap = 'round';
          g.stroke();
          this.path(pts.map((p) => ({ x: f.c.x + (p.x - f.c.x) * 0.78, y: f.c.y + (p.y - f.c.y) * 0.78 })));
          g.lineWidth = lw(6, 1, 2);
          g.stroke();
          break;
        }
        case 'track':
          this.path(f.pts);
          g.strokeStyle = night ? '#e0645f' : C.track;
          g.lineWidth = lw(6, 1.4, 3);
          g.setLineDash([this.px(40, 5, 14), this.px(25, 3, 9)]);
          g.lineCap = 'butt';
          g.stroke();
          g.setLineDash([]);
          break;
        case 'road': {
          const major = (f.cls ?? '').includes('30');
          this.path(f.pts);
          g.strokeStyle = C.roadCase;
          g.lineWidth = lw(major ? 22 : 16, major ? 4 : 3, major ? 8 : 6);
          g.lineCap = 'round';
          g.lineJoin = 'round';
          g.stroke();
          this.path(f.pts);
          g.strokeStyle = night ? '#e8605a' : C.road;
          g.lineWidth = lw(major ? 15 : 10, major ? 2.6 : 1.8, major ? 6 : 4);
          g.stroke();
          break;
        }
        case 'border': {
          this.path(f.pts);
          g.strokeStyle = '#1e8f3c';
          g.lineWidth = lw(30, 4, 9);
          g.stroke();
          this.path(f.pts.map((p) => ({ x: p.x, y: p.y - 18 })));
          g.strokeStyle = '#d0312d';
          g.lineWidth = lw(10, 1.5, 3);
          g.stroke();
          break;
        }
        case 'bridge': {
          const s = this.toScreen(f.pos);
          const r = this.px(28, 5, 12);
          g.strokeStyle = night ? '#eee' : '#111';
          g.lineWidth = 2.2;
          g.beginPath();
          g.moveTo(s.x - r, s.y - r);
          g.lineTo(s.x - r * 0.5, s.y - r * 0.7);
          g.lineTo(s.x - r * 0.5, s.y + r * 0.7);
          g.lineTo(s.x - r, s.y + r);
          g.moveTo(s.x + r, s.y - r);
          g.lineTo(s.x + r * 0.5, s.y - r * 0.7);
          g.lineTo(s.x + r * 0.5, s.y + r * 0.7);
          g.lineTo(s.x + r, s.y + r);
          g.stroke();
          break;
        }
        case 'bop': {
          const s = this.toScreen(f.pos);
          const r = this.px(45, 5, 11);
          g.beginPath();
          g.ellipse(s.x, s.y, r * 1.4, r, 0, 0, Math.PI * 2);
          g.fillStyle = f.side === 'RED' ? '#e53935' : '#1e88e5';
          g.fill();
          g.strokeStyle = '#fff';
          g.lineWidth = 1.5;
          g.stroke();
          break;
        }
        case 'graveyard': {
          const s = this.toScreen(f.pos);
          const r = this.px(30, 4, 8);
          g.strokeStyle = night ? '#ddd' : '#333';
          g.lineWidth = 1.6;
          g.beginPath();
          g.moveTo(s.x, s.y - r);
          g.lineTo(s.x, s.y + r);
          g.moveTo(s.x - r * 0.6, s.y - r * 0.3);
          g.lineTo(s.x + r * 0.6, s.y - r * 0.3);
          g.stroke();
          break;
        }
        default:
          break;
      }
    }
    if (this.layers.labels) this.drawFeatureLabels(night);
  }

  private drawFeatureLabels(night: boolean): void {
    const fs = Math.max(10, Math.min(15, 10 + this.scale * 18));
    const col = night ? '#e8e3d8' : C.label;
    const hal = night ? 'rgba(10,14,18,0.85)' : 'rgba(255,255,255,0.85)';
    for (const f of this.s.terrain.features) {
      if (!f.name) continue;
      let p: Vec | null = null;
      let dy = 0;
      switch (f.kind) {
        case 'bua':
          p = centroid(f.poly);
          dy = -this.px(Math.max(...f.poly.map((q) => q.y)) - p.y, 6, 40) - 9;
          break;
        case 'height':
          p = f.c;
          dy = this.px(f.ry, 4, 20) + 9;
          break;
        case 'trees':
        case 'broken':
        case 'grass':
        case 'dunes':
        case 'marsh':
          p = centroid(f.poly);
          dy = this.px(120, 8, 20);
          break;
        case 'kbund':
          p = f.c;
          dy = -this.px(f.r * 0.55, 6, 24) - 9;
          break;
        case 'bop':
        case 'bridge':
        case 'graveyard':
          p = f.pos;
          dy = -12;
          break;
        case 'nullah':
        case 'disty':
        case 'canal':
        case 'river': {
          const L = polylineLength(f.pts);
          p = pointAlong(f.pts, L * 0.18);
          dy = -11;
          break;
        }
        case 'road': {
          if (!f.cls || this.scale < 0.06) break;
          const L = polylineLength(f.pts);
          const a = pointAlong(f.pts, L * 0.45);
          const b = pointAlong(f.pts, L * 0.45 + 60);
          const s = this.toScreen(a);
          const sb = this.toScreen(b);
          let ang = Math.atan2(sb.y - s.y, sb.x - s.x);
          if (ang > Math.PI / 2) ang -= Math.PI;
          if (ang < -Math.PI / 2) ang += Math.PI;
          const g = this.ctx;
          g.save();
          g.translate(s.x, s.y);
          g.rotate(ang);
          this.halo(f.cls, 0, -10, fs - 2, night ? '#ffb4a8' : '#8a1c14', 'center', 700, hal);
          g.restore();
          break;
        }
        default:
          break;
      }
      if (p) {
        const s = this.toScreen(p);
        const kind = f.kind === 'bua' ? 700 : 600;
        this.halo(f.kind === 'bua' ? f.name.toUpperCase() : f.name, s.x, s.y + dy, f.kind === 'bua' ? fs : fs - 1, col, 'center', kind, hal);
      }
    }
    // country names
    const border = this.s.terrain.features.find((f) => f.kind === 'border');
    if (border && border.kind === 'border') {
      const top = this.toScreen({ x: this.s.terrain.width * 0.08, y: Math.min(this.s.terrain.height - 80, border.pts[0].y + 250) });
      const bot = this.toScreen({ x: this.s.terrain.width * 0.08, y: border.pts[0].y - 250 });
      this.halo('FOXLAND', top.x, top.y, fs + 2, '#b71c1c', 'left', 800, hal);
      this.halo('BLUELAND', bot.x, bot.y, fs + 2, '#0d47a1', 'left', 800, hal);
    }
  }

  private hatch(poly: Vec[], color: string, style: 'grass' | 'dunes' | 'broken' | 'marsh' | 'bua'): void {
    const g = this.ctx;
    g.save();
    this.path(poly, true);
    g.clip();
    const pts = poly.map((p) => this.toScreen(p));
    const minX = Math.min(...pts.map((p) => p.x));
    const maxX = Math.max(...pts.map((p) => p.x));
    const minY = Math.min(...pts.map((p) => p.y));
    const maxY = Math.max(...pts.map((p) => p.y));
    g.strokeStyle = color;
    g.fillStyle = color;
    g.lineWidth = 1;
    const step = style === 'bua' ? 5 : 11;
    for (let y = minY; y < maxY; y += step) {
      for (let x = minX + ((y / step) % 2) * (step / 2); x < maxX; x += step) {
        g.beginPath();
        if (style === 'grass') {
          g.moveTo(x, y + 3);
          g.lineTo(x, y - 2);
          g.moveTo(x - 2, y + 3);
          g.lineTo(x - 3, y);
        } else if (style === 'dunes') {
          g.moveTo(x - 3, y + 2);
          g.lineTo(x, y - 2);
          g.lineTo(x + 3, y + 2);
        } else if (style === 'broken') {
          g.moveTo(x - 4, y);
          g.quadraticCurveTo(x - 2, y - 3, x, y);
          g.quadraticCurveTo(x + 2, y + 3, x + 4, y);
        } else if (style === 'marsh') {
          g.moveTo(x - 3, y);
          g.lineTo(x + 3, y);
          g.moveTo(x, y);
          g.lineTo(x, y - 3);
        } else {
          g.moveTo(x - 3, y + 3);
          g.lineTo(x + 3, y - 3);
        }
        g.stroke();
      }
    }
    g.restore();
  }

  private trees(poly: Vec[], night: boolean): void {
    const g = this.ctx;
    const pts = poly.map((p) => this.toScreen(p));
    const c = centroid(pts);
    const r = Math.max(...pts.map((p) => Math.hypot(p.x - c.x, p.y - c.y)));
    const size = Math.max(5, Math.min(11, r * 0.45));
    const spots = r < size * 2 ? [c] : [
      { x: c.x - size * 0.9, y: c.y + size * 0.2 },
      { x: c.x + size * 0.9, y: c.y + size * 0.2 },
      { x: c.x, y: c.y - size * 0.6 },
    ];
    for (const s of spots) {
      g.beginPath();
      g.moveTo(s.x, s.y - size);
      g.lineTo(s.x - size * 0.6, s.y + size * 0.15);
      g.lineTo(s.x - size * 0.3, s.y + size * 0.15);
      g.lineTo(s.x - size * 0.75, s.y + size * 0.75);
      g.lineTo(s.x + size * 0.75, s.y + size * 0.75);
      g.lineTo(s.x + size * 0.3, s.y + size * 0.15);
      g.lineTo(s.x + size * 0.6, s.y + size * 0.15);
      g.closePath();
      g.fillStyle = night ? '#4c8f4e' : C.trees;
      g.fill();
      g.strokeStyle = 'rgba(0,0,0,0.35)';
      g.lineWidth = 0.8;
      g.stroke();
      g.fillStyle = '#5d4037';
      g.fillRect(s.x - 1, s.y + size * 0.75, 2, size * 0.3);
    }
  }

  private ticks(pts: Vec[], color: string, everyM: number, lenPx: number): void {
    const g = this.ctx;
    const L = polylineLength(pts);
    const n = Math.floor(L / everyM);
    g.strokeStyle = color;
    g.lineWidth = 1.4;
    for (let i = 1; i < n; i++) {
      const a = pointAlong(pts, i * everyM);
      const b = pointAlong(pts, i * everyM + 5);
      const o = perpOffset(a, b, 1);
      const sa = this.toScreen(a);
      const so = this.toScreen(add(a, scale(o, lenPx / this.scale)));
      g.beginPath();
      g.moveTo(sa.x, sa.y);
      g.lineTo(so.x, so.y);
      g.stroke();
    }
  }

  private drawGrid(night: boolean): void {
    const g = this.ctx;
    const gs = this.s.terrain.gridSq;
    g.strokeStyle = night ? 'rgba(200,210,220,0.18)' : C.grid;
    g.lineWidth = 1;
    g.beginPath();
    for (let x = 0; x <= this.s.terrain.width + 1; x += gs) {
      const a = this.toScreen({ x, y: 0 });
      const b = this.toScreen({ x, y: this.s.terrain.height });
      g.moveTo(Math.round(a.x) + 0.5, a.y);
      g.lineTo(Math.round(b.x) + 0.5, b.y);
    }
    for (let y = 0; y <= this.s.terrain.height + 1; y += gs) {
      const a = this.toScreen({ x: 0, y });
      const b = this.toScreen({ x: this.s.terrain.width, y });
      g.moveTo(a.x, Math.round(a.y) + 0.5);
      g.lineTo(b.x, Math.round(b.y) + 0.5);
    }
    g.stroke();
  }

  private drawFog(f: { cols: number; rows: number; res: number; vis: Uint8Array }): void {
    const g = this.ctx;
    const c = document.createElement('canvas');
    c.width = f.cols;
    c.height = f.rows;
    const cg = c.getContext('2d')!;
    const img = cg.createImageData(f.cols, f.rows);
    for (let r = 0; r < f.rows; r++) {
      for (let col = 0; col < f.cols; col++) {
        const v = f.vis[r * f.cols + col];
        const o = ((f.rows - 1 - r) * f.cols + col) * 4;
        img.data[o] = 8;
        img.data[o + 1] = 14;
        img.data[o + 2] = 22;
        img.data[o + 3] = v === 2 ? 0 : v === 1 ? 60 : 120;
      }
    }
    cg.putImageData(img, 0, 0);
    const tl = this.toScreen({ x: 0, y: f.rows * f.res });
    const br = this.toScreen({ x: f.cols * f.res, y: 0 });
    g.save();
    g.imageSmoothingEnabled = true;
    g.drawImage(c, tl.x, tl.y, br.x - tl.x, br.y - tl.y);
    g.restore();
  }

  private drawAor(): void {
    const g = this.ctx;
    this.path(this.s.own.aor, true);
    g.strokeStyle = C.aor;
    g.lineWidth = 2;
    g.setLineDash([10, 6]);
    g.stroke();
    g.setLineDash([]);
    for (const b of this.s.own.boundaries) {
      this.path(b.pts);
      g.strokeStyle = '#111';
      g.lineWidth = this.px(20, 3, 6);
      g.stroke();
      const ech = { TEAM: '', SEC: '••', PL: '•••', COY: '|', BN: '||', BDE: 'X', DIV: 'XX' }[b.echelon];
      // boundary tag near the rear of the AOR so it stays clear of the FDLs
      const aorMinY = Math.min(...this.s.own.aor.map((p) => p.y));
      const tagY = Math.max(aorMinY + 300, Math.min(...b.pts.map((p) => p.y)) + 200);
      const s = this.toScreen({ x: b.pts[0].x, y: tagY });
      g.fillStyle = 'rgba(255,255,255,0.88)';
      g.fillRect(s.x - 30, s.y - 17, 60, 34);
      g.strokeStyle = '#111';
      g.lineWidth = 1;
      g.strokeRect(s.x - 30, s.y - 17, 60, 34);
      this.halo(ech, s.x, s.y - 7, 12, '#111', 'center', 800);
      this.halo(b.label, s.x, s.y + 8, 10, '#111', 'center', 700);
    }
  }

  private arrow(pts: Vec[], color: string, widthPx: number, dashed = false, label?: string, head = true, smooth = false): void {
    const g = this.ctx;
    if (pts.length < 2) return;
    const curved = smooth && pts.length >= 3;
    if (curved) this.smoothPath(pts);
    else this.path(pts);
    g.strokeStyle = color;
    g.lineWidth = widthPx;
    g.lineJoin = 'round';
    g.lineCap = 'round';
    if (dashed) g.setLineDash([widthPx * 2.5, widthPx * 1.6]);
    g.stroke();
    g.setLineDash([]);
    const line = curved ? sampleOpen(pts, 8) : pts;
    if (head) {
      const a = this.toScreen(line[line.length - 2]);
      const b = this.toScreen(line[line.length - 1]);
      const ang = Math.atan2(b.y - a.y, b.x - a.x);
      const hl = Math.max(10, widthPx * 3.2);
      g.beginPath();
      g.moveTo(b.x, b.y);
      g.lineTo(b.x - hl * Math.cos(ang - 0.45), b.y - hl * Math.sin(ang - 0.45));
      g.lineTo(b.x - hl * Math.cos(ang + 0.45), b.y - hl * Math.sin(ang + 0.45));
      g.closePath();
      g.fillStyle = color;
      g.fill();
    }
    if (label) {
      const m = this.toScreen(pointAlong(line, polylineLength(line) * 0.5));
      this.halo(label, m.x, m.y - 12, 12, color, 'center', 700);
    }
  }

  private drawDs(ds: DsSolution): void {
    for (const a of ds.approaches) this.arrow(a.path, 'rgba(224,123,0,0.85)', 5 - Math.min(3, a.pri - 1), true, `${a.name} (${a.pri})`);
    for (const l of ds.linesOfDef) {
      this.path(l.pts);
      this.ctx.strokeStyle = l.id === ds.recommendedFdl ? 'rgba(120,60,0,0.9)' : 'rgba(120,60,0,0.45)';
      this.ctx.lineWidth = l.id === ds.recommendedFdl ? 4 : 2;
      this.ctx.setLineDash([4, 4]);
      this.ctx.stroke();
      this.ctx.setLineDash([]);
      const s = this.toScreen(l.pts[0]);
      this.halo(l.name.split(':')[0], s.x + 4, s.y - 10, 12, '#7a3d00', 'left', 800);
    }
    for (const i of ds.itgs) {
      const s = this.toScreen(i.pos);
      this.ctx.beginPath();
      this.ctx.arc(s.x, s.y, 13, 0, Math.PI * 2);
      this.ctx.strokeStyle = i.vital ? '#b71c1c' : '#e07b00';
      this.ctx.lineWidth = i.vital ? 3 : 2;
      this.ctx.stroke();
      this.halo(`${i.pri}`, s.x, s.y, 11, i.vital ? '#b71c1c' : '#a35a00', 'center', 800);
    }
    const mark = (p: Vec, t: string) => {
      const s = this.toScreen(p);
      this.halo(t, s.x, s.y, 11, '#a35a00', 'center', 800);
    };
    ds.likelyFUPs.forEach((f) => mark(f.pos, `FUP? ${f.name}`));
    ds.likelyFAAs.forEach((f) => mark(f.pos, `FAA? ${f.name}`));
    ds.likelyBOFs.forEach((f) => mark({ x: f.pos.x, y: f.pos.y - 60 }, `BOF? ${f.name}`));
  }

  private drawEnemyPlan(p: NonNullable<MapScene['enemyPlan']>): void {
    if (p.approach.length > 1) this.arrow(p.approach, 'rgba(198,40,40,0.8)', 5, false, 'En axis');
    const zone = (c: Vec, r: number, t: string) => {
      const s = this.toScreen(c);
      const rr = this.px(r, 12, 60);
      this.ctx.beginPath();
      this.ctx.ellipse(s.x, s.y, rr * 1.3, rr, 0, 0, Math.PI * 2);
      this.ctx.strokeStyle = C.enemy;
      this.ctx.lineWidth = 2.5;
      this.ctx.setLineDash([8, 5]);
      this.ctx.stroke();
      this.ctx.setLineDash([]);
      this.halo(t, s.x, s.y, 12, C.enemy, 'center', 800);
    };
    zone(p.faa, 250, `FAA ${p.names.faa}`);
    zone(p.fup, 180, `FUP ${p.names.fup}`);
    zone(p.bof, 120, `BOF ${p.names.bof}`);
    for (const o of p.objectives) {
      const s = this.toScreen(o.pos);
      this.halo(`OBJ Ph ${o.phase}`, s.x, s.y + 22, 12, C.enemy, 'center', 800);
    }
  }

  drawGraphic(gr: PlanGraphic, selected: boolean): void {
    const g = this.ctx;
    const sel = selected ? 2 : 0;
    // declutter: secondary labels only when zoomed in (or selected)
    const showLbl = selected || this.scale > 0.16 || gr.kind === 'FDL' || (gr.kind === 'DF' && gr.props.sos);
    const halo0 = this.halo.bind(this);
    if (!showLbl) this.halo = () => undefined;
    try {
      this.drawGraphicInner(gr, sel);
    } finally {
      this.halo = halo0;
    }
    void g;
  }

  private drawGraphicInner(gr: PlanGraphic, sel: number): void {
    const g = this.ctx;
    const smooth = !!gr.props.smooth;
    const col = gr.props.color ? GCOL[gr.props.color] : undefined;
    if (!gr.pts.length) return;
    switch (gr.kind) {
      case 'FDL': {
        if (sel) this.selGlow(() => this.shapePath(gr.pts, false, smooth), 3 + sel);
        this.shapePath(gr.pts, false, smooth);
        g.strokeStyle = col ?? C.blue;
        g.lineWidth = 3 + sel;
        g.stroke();
        // teeth toward the enemy (north)
        const along = smooth ? sampleOpen(gr.pts, 8) : gr.pts;
        const L = polylineLength(along);
        g.lineWidth = 2;
        for (let d = 40; d < L; d += Math.max(60, 25 / this.scale)) {
          const a = pointAlong(along, d);
          const sA = this.toScreen(a);
          g.beginPath();
          g.moveTo(sA.x - 5, sA.y);
          g.lineTo(sA.x, sA.y - 8);
          g.lineTo(sA.x + 5, sA.y);
          g.stroke();
        }
        const s = this.toScreen(gr.pts[0]);
        this.halo(gr.props.label ?? 'FDLs', s.x + 6, s.y - 14, 13, col ?? C.blue, 'left', 800);
        break;
      }
      case 'KILL_AREA': {
        if (gr.pts.length < 3) break;
        if (sel) this.selGlow(() => this.shapePath(gr.pts, true, smooth), 2.5 + sel);
        this.shapePath(gr.pts, true, smooth);
        const prim = gr.props.subtype !== 'SECONDARY';
        g.fillStyle = prim ? 'rgba(11,92,173,0.10)' : 'rgba(11,92,173,0.06)';
        g.fill();
        g.strokeStyle = col ?? C.blue;
        g.lineWidth = (prim ? 2.5 : 1.8) + sel;
        g.setLineDash(prim ? [] : [7, 5]);
        g.stroke();
        g.setLineDash([]);
        const c = this.toScreen(centroid(gr.pts));
        this.halo(gr.props.label ?? (prim ? 'KA (Pri)' : 'KA (Sec)'), c.x, c.y, 12, col ?? C.blue, 'center', 800);
        break;
      }
      case 'MINEFIELD': {
        if (gr.pts.length < 2) break;
        const tac = gr.props.subtype === 'TACTICAL' || gr.props.subtype === 'DEFENSIVE';
        const depthM = tac ? 60 : 40;
        const line = smooth ? sampleOpen(gr.pts, 6) : gr.pts;
        if (sel) this.selGlow(() => this.path(line), depthM * this.scale + 6);
        for (let i = 1; i < line.length; i++) {
          const a = line[i - 1];
          const b = line[i];
          if (dist(a, b) < 0.5) continue;
          const o = perpOffset(a, b, depthM / 2);
          this.path([add(a, o), add(b, o), sub(b, o), sub(a, o)], true);
          g.fillStyle = 'rgba(19,128,58,0.12)';
          g.fill();
          g.strokeStyle = C.obstacle;
          g.lineWidth = 2 + sel;
          g.stroke();
        }
        const L = polylineLength(line);
        const n = Math.max(2, Math.min(24, Math.floor((L * this.scale) / 22)));
        for (let i = 0; i < n; i++) {
          const p = this.toScreen(pointAlong(line, ((i + 0.5) / n) * L));
          g.beginPath();
          g.arc(p.x, p.y, 3.5, 0, Math.PI * 2);
          g.fillStyle = tac ? C.obstacle : '#fff';
          g.fill();
          g.strokeStyle = C.obstacle;
          g.lineWidth = 1.4;
          g.stroke();
          if (!tac) {
            g.beginPath();
            g.moveTo(p.x, p.y - 3.5);
            g.lineTo(p.x, p.y - 7);
            g.stroke();
          }
        }
        const m = this.toScreen(pointAlong(line, L / 2));
        this.halo(gr.props.label ?? (tac ? 'A tk Mfd' : 'Prot Mfd'), m.x, m.y - 14, 11, C.obstacle, 'center', 800);
        break;
      }
      case 'WIRE': {
        if (sel) this.selGlow(() => this.shapePath(gr.pts, false, smooth), 2 + sel);
        this.shapePath(gr.pts, false, smooth);
        g.strokeStyle = C.obstacle;
        g.lineWidth = 1.6 + sel;
        g.stroke();
        const along = smooth ? sampleOpen(gr.pts, 8) : gr.pts;
        const L = polylineLength(along);
        const step = Math.max(12 / this.scale, 25);
        g.lineWidth = 1.4;
        for (let d = step / 2; d < L; d += step) {
          const p = this.toScreen(pointAlong(along, d));
          g.beginPath();
          g.moveTo(p.x - 4, p.y - 4);
          g.lineTo(p.x + 4, p.y + 4);
          g.moveTo(p.x + 4, p.y - 4);
          g.lineTo(p.x - 4, p.y + 4);
          g.stroke();
        }
        if (gr.props.label && gr.props.label !== 'Wire') {
          const m = this.toScreen(pointAlong(along, L / 2));
          this.halo(gr.props.label, m.x, m.y - 12, 11, C.obstacle, 'center', 800);
        }
        break;
      }
      case 'DF': {
        const p = this.toScreen(gr.pts[0]);
        const r = this.px(gr.props.radius ?? 150, 9, 80);
        g.beginPath();
        g.arc(p.x, p.y, r, 0, Math.PI * 2);
        if (sel) {
          g.strokeStyle = SEL_GLOW;
          g.lineWidth = 7;
          g.stroke();
        }
        g.strokeStyle = gr.props.sos ? '#b00020' : C.fire;
        g.lineWidth = (gr.props.sos ? 3 : 2) + sel;
        g.stroke();
        if (gr.props.sos) {
          g.fillStyle = 'rgba(176,0,32,0.10)';
          g.fill();
        }
        g.beginPath();
        g.moveTo(p.x - r * 0.6, p.y);
        g.lineTo(p.x + r * 0.6, p.y);
        g.moveTo(p.x, p.y - r * 0.6);
        g.lineTo(p.x, p.y + r * 0.6);
        g.lineWidth = 1.5;
        g.stroke();
        const sub2 = gr.props.subtype === 'MOR81' ? ' (81)' : gr.props.subtype === 'MOR60' ? ' (60)' : '';
        this.halo(`${gr.props.label ?? 'DF'}${sub2}`, p.x, p.y - r - 9, 11, gr.props.sos ? '#b00020' : C.fire, 'center', 800);
        break;
      }
      case 'CATK':
        if (sel) this.selGlow(() => this.shapePath(gr.pts, false, smooth), 3 + sel);
        this.arrow(gr.pts, col ?? C.blue, 3 + sel, true, `${gr.props.label ?? 'C ATTK'}${gr.props.priority ? ` (Pri ${gr.props.priority})` : ''}`, true, smooth);
        break;
      case 'CPEN': {
        const p = this.toScreen(gr.pts[0]);
        g.strokeStyle = sel ? '#ffb300' : C.blue;
        g.lineWidth = 2 + sel;
        g.setLineDash([5, 4]);
        g.beginPath();
        g.ellipse(p.x, p.y, 28, 14, 0, 0, Math.PI * 2);
        g.stroke();
        g.setLineDash([]);
        this.halo(gr.props.label ?? 'C PEN', p.x, p.y, 11, C.blue, 'center', 800);
        break;
      }
      case 'QC_AREA': {
        const p = this.toScreen(gr.pts[0]);
        const r = this.px(gr.props.radius ?? 600, 14, 400);
        g.beginPath();
        g.arc(p.x, p.y, r, 0, Math.PI * 2);
        if (sel) {
          g.strokeStyle = SEL_GLOW;
          g.lineWidth = 6;
          g.stroke();
        }
        g.strokeStyle = '#6a1b9a';
        g.lineWidth = 2 + sel;
        g.setLineDash([3, 5]);
        g.stroke();
        g.setLineDash([]);
        this.halo(gr.props.label ?? 'QC surv', p.x, p.y - r - 8, 11, '#6a1b9a', 'center', 800);
        break;
      }
      case 'PTL_ROUTE':
        if (sel) this.selGlow(() => this.shapePath(gr.pts, false, smooth), 2 + sel);
        this.arrow(gr.pts, col ?? '#0b5cad', 2 + sel, true, gr.props.label ?? 'Ptl', false, smooth);
        break;
      case 'NOTE': {
        const p = this.toScreen(gr.pts[0]);
        if (sel) this.textBox(gr.props.text ?? '', p.x, p.y, 12, 'left');
        this.halo(gr.props.text ?? '', p.x, p.y, 12, '#222', 'left', 700);
        break;
      }
      case 'FREE':
      case 'AREA': {
        const closed = gr.kind === 'AREA' || !!gr.props.closed;
        const sm = gr.props.smooth !== false;
        if (closed && gr.pts.length < 3) break;
        const c2 = col ?? (gr.kind === 'AREA' ? C.blue : '#1b2329');
        const w = gr.props.width ?? (gr.kind === 'AREA' ? 2.2 : 2.5);
        if (sel) this.selGlow(() => this.shapePath(gr.pts, closed, sm), w + sel);
        this.shapePath(gr.pts, closed, sm);
        if (closed && (gr.props.fill ?? gr.kind === 'AREA')) {
          g.fillStyle = withAlpha(c2, 0.1);
          g.fill();
        }
        g.strokeStyle = c2;
        g.lineWidth = w + sel;
        g.lineJoin = 'round';
        g.lineCap = 'round';
        if (gr.props.dash) g.setLineDash([w * 3.2, w * 2.2]);
        g.stroke();
        g.setLineDash([]);
        const lbl = gr.props.label ?? gr.props.text;
        if (lbl) {
          const at = closed ? this.toScreen(centroid(sm ? sampleClosed(gr.pts, 4) : gr.pts)) : this.toScreen(pointAlong(gr.pts, polylineLength(gr.pts) / 2));
          this.halo(lbl, at.x, at.y - (closed ? 0 : 12), 12, c2, 'center', 800);
        }
        break;
      }
      case 'ARROW': {
        if (gr.pts.length < 2) break;
        const c2 = col ?? C.blue;
        const w = gr.props.width ?? 3;
        if (sel) this.selGlow(() => this.shapePath(gr.pts, false, gr.props.smooth !== false), w + sel);
        this.arrow(gr.pts, c2, w + sel, !!gr.props.dash, gr.props.label, true, gr.props.smooth !== false);
        break;
      }
      case 'TEXT': {
        const p = this.toScreen(gr.pts[0]);
        const size = 10 + (gr.props.width ?? 2) * 2;
        const t = gr.props.text ?? gr.props.label ?? '';
        g.save();
        g.translate(p.x, p.y);
        if (gr.props.rot) g.rotate((gr.props.rot * Math.PI) / 180);
        if (sel) this.textBox(t, 0, 0, size, 'center');
        this.halo(t || '…', 0, 0, size, col ?? '#1b2329', 'center', 800);
        g.restore();
        break;
      }
      case 'PHASE_LINE': {
        if (gr.pts.length < 2) break;
        if (sel) this.selGlow(() => this.shapePath(gr.pts, false, smooth), 2.5 + sel);
        this.shapePath(gr.pts, false, smooth);
        g.strokeStyle = col ?? '#1b2329';
        g.lineWidth = 2.5 + sel;
        g.stroke();
        const name = `PL ${gr.props.label ?? ''}`.trim();
        const a = this.toScreen(gr.pts[0]);
        const b = this.toScreen(gr.pts[gr.pts.length - 1]);
        this.halo(name, a.x, a.y - 12, 12, col ?? '#1b2329', 'center', 800);
        this.halo(name, b.x, b.y - 12, 12, col ?? '#1b2329', 'center', 800);
        break;
      }
      case 'BOUNDARY': {
        if (gr.pts.length < 2) break;
        if (sel) this.selGlow(() => this.shapePath(gr.pts, false, smooth), 4 + sel);
        this.shapePath(gr.pts, false, smooth);
        g.strokeStyle = col ?? '#111';
        g.lineWidth = 4 + sel;
        g.stroke();
        const along = smooth ? sampleOpen(gr.pts, 6) : gr.pts;
        const m = this.toScreen(pointAlong(along, polylineLength(along) / 2));
        const e = (gr.props.subtype as Echelon | undefined) ?? 'COY';
        g.fillStyle = 'rgba(255,255,255,0.92)';
        g.fillRect(m.x - 22, m.y - 16, 44, 32);
        this.echelonMark(e, m.x, m.y - 2, col ?? '#111');
        if (gr.props.label) this.halo(gr.props.label, m.x, m.y + 9, 10, col ?? '#111', 'center', 800);
        break;
      }
      case 'OBSTACLE': {
        if (gr.pts.length < 2) {
          const p = this.toScreen(gr.pts[0]);
          this.halo(gr.props.label ?? 'Obs', p.x, p.y, 11, C.obstacle, 'center', 800);
          break;
        }
        const along = smooth ? sampleOpen(gr.pts, 6) : gr.pts;
        if (sel) this.selGlow(() => this.path(along), 6);
        this.drawObstacleLine(along, gr.props.subtype ?? 'GENERAL', col ?? C.obstacle);
        if (gr.props.label) {
          const m = this.toScreen(pointAlong(along, polylineLength(along) / 2));
          this.halo(gr.props.label, m.x, m.y - 16, 11, col ?? C.obstacle, 'center', 800);
        }
        break;
      }
      case 'TRP':
      case 'SYMBOL': {
        const p = this.toScreen(gr.pts[0]);
        const sidc = gr.kind === 'TRP' ? 'GFGPDPT--------' : gr.props.sidc ?? 'GFGPGPRI-------';
        const size = gr.kind === 'TRP' ? 26 : 28;
        const img = symbolImage(sidc, { size, label: gr.props.label, info: true });
        const d = this.dprSym();
        if (sel) {
          g.beginPath();
          g.arc(p.x, p.y, size * 0.8, 0, Math.PI * 2);
          g.strokeStyle = SEL_GLOW;
          g.lineWidth = 4;
          g.stroke();
        }
        g.save();
        g.translate(p.x, p.y);
        if (gr.props.rot) g.rotate((gr.props.rot * Math.PI) / 180);
        g.drawImage(img.canvas, -img.ax, -img.ay, img.canvas.width / d, img.canvas.height / d);
        g.restore();
        break;
      }
    }
  }

  /** Amber selection glow under a path. */
  private selGlow(path: () => void, w: number): void {
    const g = this.ctx;
    path();
    g.save();
    g.strokeStyle = SEL_GLOW;
    g.lineWidth = w + 6;
    g.lineJoin = 'round';
    g.lineCap = 'round';
    g.stroke();
    g.restore();
  }

  private textBox(t: string, x: number, y: number, size: number, align: 'left' | 'center'): void {
    const g = this.ctx;
    g.font = `800 ${size}px Bahnschrift, 'Arial Narrow', Arial, sans-serif`;
    const w = g.measureText(t || '…').width + 10;
    const x0 = align === 'left' ? x - 5 : x - w / 2;
    g.strokeStyle = '#ffb300';
    g.lineWidth = 2;
    g.setLineDash([4, 3]);
    g.strokeRect(x0, y - size * 0.75, w, size * 1.5);
    g.setLineDash([]);
  }

  /** Linear obstacles (APP-6 style): abatis, A tk ditch, road block, general obstacle line. */
  private drawObstacleLine(pts: Vec[], kind: string, color: string): void {
    const g = this.ctx;
    const L = polylineLength(pts);
    const step = Math.max(16 / this.scale, 20);
    g.strokeStyle = color;
    g.fillStyle = color;
    g.lineWidth = 2;
    g.lineJoin = 'round';
    if (kind === 'AT_DITCH') {
      // line with solid teeth toward the enemy side (left of the drawing direction)
      this.path(pts);
      g.stroke();
      for (let d = step / 2; d < L; d += step) {
        const a = pointAlong(pts, Math.max(0, d - step * 0.3));
        const b = pointAlong(pts, Math.min(L, d + step * 0.3));
        const sa = this.toScreen(a);
        const sb = this.toScreen(b);
        const m = { x: (sa.x + sb.x) / 2, y: (sa.y + sb.y) / 2 };
        const n = { x: sb.y - sa.y, y: -(sb.x - sa.x) };
        const nl = Math.hypot(n.x, n.y) || 1;
        g.beginPath();
        g.moveTo(sa.x, sa.y);
        g.lineTo(m.x + (n.x / nl) * 8, m.y + (n.y / nl) * 8);
        g.lineTo(sb.x, sb.y);
        g.closePath();
        g.fill();
      }
      return;
    }
    if (kind === 'ABATIS') {
      this.path(pts);
      g.stroke();
      for (let d = step / 2; d < L; d += step) {
        const a = this.toScreen(pointAlong(pts, d));
        const b = this.toScreen(pointAlong(pts, Math.min(L, d + 1)));
        const ang = Math.atan2(b.y - a.y, b.x - a.x);
        g.beginPath();
        g.moveTo(a.x, a.y);
        g.lineTo(a.x + Math.cos(ang - 0.9) * 10, a.y + Math.sin(ang - 0.9) * 10);
        g.moveTo(a.x, a.y);
        g.lineTo(a.x + Math.cos(ang - 2.2) * 10, a.y + Math.sin(ang - 2.2) * 10);
        g.stroke();
      }
      return;
    }
    if (kind === 'ROADBLOCK') {
      this.path(pts);
      g.lineWidth = 5;
      g.stroke();
      const a = this.toScreen(pts[0]);
      const b = this.toScreen(pts[pts.length - 1]);
      for (const p of [a, b]) {
        g.beginPath();
        g.arc(p.x, p.y, 4, 0, Math.PI * 2);
        g.fill();
      }
      return;
    }
    // general obstacle line: zig-zag
    g.beginPath();
    let first = true;
    const zs = Math.max(10 / this.scale, 12);
    for (let d = 0, i = 0; d <= L; d += zs, i++) {
      const p = pointAlong(pts, d);
      const q = pointAlong(pts, Math.min(L, d + 1));
      const sp = this.toScreen(p);
      const sq = this.toScreen(q);
      const n = { x: sq.y - sp.y, y: -(sq.x - sp.x) };
      const nl = Math.hypot(n.x, n.y) || 1;
      const k = i % 2 ? 6 : -6;
      const x = sp.x + (n.x / nl) * k;
      const y = sp.y + (n.y / nl) * k;
      if (first) g.moveTo(x, y);
      else g.lineTo(x, y);
      first = false;
    }
    g.stroke();
  }

  /** Smooth closed outline (goose egg) path in screen space. */
  private eggPath(pts: Vec[]): void {
    const g = this.ctx;
    const s = pts.map((p) => this.toScreen(p));
    g.beginPath();
    if (s.length < 3) {
      s.forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y)));
      g.closePath();
      return;
    }
    g.moveTo(s[0].x, s[0].y);
    for (const b of closedBeziers(s)) g.bezierCurveTo(b.c1.x, b.c1.y, b.c2.x, b.c2.y, b.to.x, b.to.y);
    g.closePath();
  }

  /** Smooth open curve path in screen space. */
  private smoothPath(pts: Vec[]): void {
    const g = this.ctx;
    const s = pts.map((p) => this.toScreen(p));
    g.beginPath();
    if (!s.length) return;
    g.moveTo(s[0].x, s[0].y);
    if (s.length < 3) {
      for (let i = 1; i < s.length; i++) g.lineTo(s[i].x, s[i].y);
      return;
    }
    for (const b of openBeziers(s)) g.bezierCurveTo(b.c1.x, b.c1.y, b.c2.x, b.c2.y, b.to.x, b.to.y);
  }

  /** Path for a graphic outline: straight or smooth, open or closed. */
  private shapePath(pts: Vec[], closed: boolean, smooth: boolean): void {
    if (smooth && pts.length >= 3) {
      if (closed) this.eggPath(pts);
      else this.smoothPath(pts);
    } else this.path(pts, closed);
  }

  /** Screen-space sampled outline and its extremes. */
  private eggScreen(area: Vec[]): { pts: Vec[]; top: Vec; minX: number; maxX: number; minY: number; maxY: number; c: Vec } {
    const pts = sampleClosed(area, 6).map((p) => this.toScreen(p));
    let top = pts[0];
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    let cx = 0;
    let cy = 0;
    for (const p of pts) {
      if (p.y < top.y) top = p;
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y);
      maxY = Math.max(maxY, p.y);
      cx += p.x;
      cy += p.y;
    }
    return { pts, top, minX, maxX, minY, maxY, c: { x: cx / pts.length, y: cy / pts.length } };
  }

  /** NATO echelon indicator centred on x with its base on y. */
  private echelonMark(e: Echelon | undefined, x: number, y: number, color: string): void {
    if (!e || e === 'TEAM') return;
    const g = this.ctx;
    const draw = (stroke: string, lw: number, r: number) => {
      g.strokeStyle = stroke;
      g.fillStyle = stroke;
      g.lineWidth = lw;
      g.lineCap = 'round';
      const dots = e === 'SEC' ? 2 : e === 'PL' ? 3 : 0;
      if (dots) {
        for (let i = 0; i < dots; i++) {
          g.beginPath();
          g.arc(x + (i - (dots - 1) / 2) * 7.5, y - 4, r, 0, Math.PI * 2);
          g.fill();
        }
        return;
      }
      g.beginPath();
      const bars = e === 'COY' ? 1 : e === 'BN' ? 2 : 0;
      if (bars) {
        for (let i = 0; i < bars; i++) {
          const bx = x + (i - (bars - 1) / 2) * 6;
          g.moveTo(bx, y - 11);
          g.lineTo(bx, y);
        }
      } else {
        const xs = e === 'DIV' ? [-6, 6] : [0];
        for (const dx of xs) {
          g.moveTo(x + dx - 5, y - 11);
          g.lineTo(x + dx + 5, y);
          g.moveTo(x + dx + 5, y - 11);
          g.lineTo(x + dx - 5, y);
        }
      }
      g.stroke();
    };
    draw('rgba(255,255,255,0.95)', 5.5, 4.2);
    draw(color, 2.2, 2.7);
  }

  /** Small type glyph inside an egg. */
  private eggGlyph(kind: UnitGlyph['glyph'], x: number, y: number, color: string): void {
    if (!kind || kind === 'NONE') return;
    const g = this.ctx;
    const w = 18;
    const h = 11;
    g.save();
    g.strokeStyle = color;
    g.lineWidth = 1.6;
    if (kind === 'INF') {
      g.beginPath();
      g.moveTo(x - w / 2, y - h / 2);
      g.lineTo(x + w / 2, y + h / 2);
      g.moveTo(x + w / 2, y - h / 2);
      g.lineTo(x - w / 2, y + h / 2);
      g.stroke();
    } else if (kind === 'ARMOUR') {
      g.beginPath();
      g.ellipse(x, y, w / 2, h / 2.4, 0, 0, Math.PI * 2);
      g.stroke();
    } else if (kind === 'HQ') {
      this.halo('HQ', x, y, 10, color, 'center', 800);
    }
    g.restore();
  }

  private colorOf(u: UnitGlyph): string {
    if (u.status === 'LOST') return '#6b7480';
    return u.side === 'RED' ? C.enemy : u.side === 'UNK' ? '#8a6d00' : C.blue;
  }

  private drawGroups(groups: NonNullable<MapScene['groups']>): void {
    const g = this.ctx;
    for (const gr of groups) {
      if (gr.area.length < 3) continue;
      this.eggPath(gr.area);
      g.fillStyle = 'rgba(11,92,173,0.035)';
      g.fill();
      if (gr.selected) {
        g.strokeStyle = 'rgba(255,179,0,0.9)';
        g.lineWidth = 5;
        g.stroke();
      }
      g.strokeStyle = 'rgba(11,92,173,0.85)';
      g.lineWidth = 1.8;
      g.setLineDash([10, 6]);
      g.stroke();
      g.setLineDash([]);
      const es = this.eggScreen(gr.area);
      const lx = es.top.x;
      const ly = es.top.y - 2;
      g.font = `800 12px Bahnschrift, 'Arial Narrow', Arial, sans-serif`;
      const tw = g.measureText(gr.label).width + 12;
      g.fillStyle = gr.selected ? 'rgba(255,179,0,0.95)' : 'rgba(11,92,173,0.92)';
      g.beginPath();
      g.roundRect(lx - tw / 2, ly - 9, tw, 18, 4);
      g.fill();
      g.fillStyle = gr.selected ? '#1a1300' : '#fff';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(gr.label, lx, ly + 0.5);
    }
  }

  /** True if the egg is big enough on screen to be drawn as an area. */
  private eggVisible(u: UnitGlyph): boolean {
    if (!u.area || u.area.length < 3) return false;
    return Math.sqrt(eggSize(u)) * this.scale >= 16;
  }

  private drawEgg(u: UnitGlyph): void {
    const g = this.ctx;
    const area = u.area!;
    const col = this.colorOf(u);
    const lost = u.status === 'LOST';
    const pct = u.strengthPct === undefined ? 100 : Math.max(0, Math.min(100, u.strengthPct));
    g.save();
    g.globalAlpha = u.dim && !lost ? 0.5 : u.conf !== undefined ? 0.45 + 0.55 * u.conf : 1;
    this.eggPath(area);
    if (lost) g.fillStyle = 'rgba(110,116,128,0.16)';
    else if (u.side === 'RED') g.fillStyle = 'rgba(198,40,40,0.06)';
    else g.fillStyle = `rgba(11,92,173,${(0.05 + 0.13 * (pct / 100)).toFixed(3)})`;
    g.fill();
    if (u.selected) {
      g.strokeStyle = 'rgba(255,179,0,0.95)';
      g.lineWidth = 6;
      g.stroke();
    }
    g.strokeStyle = col;
    g.lineWidth = u.selected ? 2.8 : 2.3;
    g.lineJoin = 'round';
    if (u.planned) g.setLineDash([9, 6]);
    g.stroke();
    g.setLineDash([]);
    const es = this.eggScreen(area);
    const wpx = es.maxX - es.minX;
    const hpx = es.maxY - es.minY;
    if (lost) {
      // crossed out: locality lost
      g.strokeStyle = 'rgba(80,86,96,0.85)';
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(es.c.x - wpx * 0.32, es.c.y - hpx * 0.32);
      g.lineTo(es.c.x + wpx * 0.32, es.c.y + hpx * 0.32);
      g.moveTo(es.c.x + wpx * 0.32, es.c.y - hpx * 0.32);
      g.lineTo(es.c.x - wpx * 0.32, es.c.y + hpx * 0.32);
      g.stroke();
    }
    const roomy = wpx > 56 && hpx > 30;
    if (u.side !== 'RED' && roomy && hpx > 54 && u.glyph && u.glyph !== 'NONE') this.eggGlyph(u.glyph, es.c.x, es.c.y - hpx * 0.14, col);
    g.restore();
  }

  /** Echelon mark, designation, strength and status of an egg — drawn above the point symbols. */
  private drawEggLabels(u: UnitGlyph): void {
    if (u.side === 'RED') return;
    const g = this.ctx;
    const col = this.colorOf(u);
    const lost = u.status === 'LOST';
    const pct = u.strengthPct === undefined ? 100 : Math.max(0, Math.min(100, u.strengthPct));
    const es = this.eggScreen(u.area!);
    const wpx = es.maxX - es.minX;
    const hpx = es.maxY - es.minY;
    g.save();
    g.globalAlpha = u.dim && !lost ? 0.6 : 1;
    this.echelonMark(u.echelon, es.top.x, es.top.y - 3, col);
    // designation: inside the lower part of the egg when there is room, else under it
    const roomy = wpx > 56 && hpx > 30;
    const fs = Math.max(11, Math.min(14, 10 + wpx / 60));
    const ly = roomy ? es.c.y + Math.max(8, hpx * 0.22) : es.maxY + 10;
    if (this.layers.labels || u.selected) this.halo(u.label, es.c.x, ly, fs, col, 'center', 800);
    let by = ly + fs * 0.7;
    if (u.sub && (this.layers.labels || u.selected)) {
      this.halo(u.sub, es.c.x, by + 5, 10, col, 'center', 600);
      by += 12;
    }
    if (u.strengthPct !== undefined && u.side !== 'UNK' && !lost) {
      const w = Math.min(46, Math.max(26, wpx * 0.4));
      g.fillStyle = 'rgba(0,0,0,0.5)';
      g.fillRect(es.c.x - w / 2 - 1, by + 1, w + 2, 6);
      g.fillStyle = pct > 66 ? '#43a047' : pct > 33 ? '#fbc02d' : '#e53935';
      g.fillRect(es.c.x - w / 2, by + 2, (w * pct) / 100, 4);
    }
    if (u.status === 'ASSAULT' || u.status === 'WITHDRAW') this.halo(u.status === 'ASSAULT' ? 'ASLT' : 'WDR', es.maxX + 4, es.top.y + 8, 10, col, 'left', 800);
    if (lost) this.halo('LOST', es.c.x, roomy ? es.c.y - hpx * 0.22 : es.minY - 10, 10, '#3d424a', 'center', 800);
    g.restore();
  }

  private drawOpLp(u: UnitGlyph, p: Vec, size: number): void {
    const g = this.ctx;
    const col = this.colorOf(u);
    const s = size * 0.7;
    g.save();
    g.globalAlpha = u.dim ? 0.5 : 1;
    g.beginPath();
    g.moveTo(p.x, p.y - s * 0.62);
    g.lineTo(p.x + s * 0.58, p.y + s * 0.38);
    g.lineTo(p.x - s * 0.58, p.y + s * 0.38);
    g.closePath();
    g.fillStyle = 'rgba(255,255,255,0.92)';
    g.fill();
    g.lineWidth = 4.5;
    g.strokeStyle = 'rgba(255,255,255,0.9)';
    g.stroke();
    g.lineWidth = 2;
    g.strokeStyle = col;
    if (u.planned) g.setLineDash([4, 3]);
    g.stroke();
    g.setLineDash([]);
    g.beginPath();
    g.arc(p.x, p.y + s * 0.05, 2.2, 0, Math.PI * 2);
    g.fillStyle = col;
    g.fill();
    g.restore();
    if (this.layers.labels || u.selected) this.halo(u.label, p.x + s * 0.72, p.y - 1, 11, col, 'left', 800);
  }

  private drawLink(u: UnitGlyph, p: Vec, size: number): void {
    const g = this.ctx;
    const q = this.toScreen(u.link!.from);
    const d = Math.hypot(p.x - q.x, p.y - q.y);
    if (d < 6) return;
    const stop = Math.max(0, d - size * 0.55) / d;
    const ex = q.x + (p.x - q.x) * stop;
    const ey = q.y + (p.y - q.y) * stop;
    const col = this.colorOf(u);
    g.save();
    g.strokeStyle = 'rgba(255,255,255,0.75)';
    g.lineWidth = 3.5;
    g.beginPath();
    g.moveTo(q.x, q.y);
    g.lineTo(ex, ey);
    g.stroke();
    g.strokeStyle = col;
    g.lineWidth = 1.5;
    g.setLineDash([5, 4]);
    g.stroke();
    g.setLineDash([]);
    g.beginPath();
    g.arc(q.x, q.y, 2.8, 0, Math.PI * 2);
    g.fillStyle = col;
    g.fill();
    const tag = u.link!.tag;
    if (tag && d > 46 && (this.layers.labels || u.selected)) {
      const mx = (q.x + ex) / 2;
      const my = (q.y + ey) / 2;
      g.font = `700 10px Bahnschrift, 'Arial Narrow', Arial, sans-serif`;
      const tw = g.measureText(tag).width + 12;
      g.fillStyle = 'rgba(255,255,255,0.94)';
      g.strokeStyle = col;
      g.lineWidth = 1;
      g.beginPath();
      g.roundRect(mx - tw / 2, my - 8, tw, 16, 8);
      g.fill();
      g.stroke();
      g.fillStyle = col;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(tag, mx, my + 0.5);
    }
    g.restore();
  }

  private drawUnits(units: UnitGlyph[]): void {
    const g = this.ctx;
    const size = Math.max(16, Math.min(34, 18 + this.scale * 40));
    const eggs = new Set(units.filter((u) => this.eggVisible(u)).map((u) => u.id));
    // alt posns and arcs first (under everything)
    for (const u of units) {
      const p = this.toScreen(u.pos);
      const isEgg = eggs.has(u.id);
      if (!u.link && u.parentPos) {
        const q = this.toScreen(u.parentPos);
        g.strokeStyle = 'rgba(11,92,173,0.45)';
        g.lineWidth = 1;
        g.setLineDash([3, 3]);
        g.beginPath();
        g.moveTo(p.x, p.y);
        g.lineTo(q.x, q.y);
        g.stroke();
        g.setLineDash([]);
      }
      if (u.altPos) {
        const q = this.toScreen(u.altPos);
        g.strokeStyle = 'rgba(11,92,173,0.7)';
        g.lineWidth = 1.5;
        g.setLineDash([6, 4]);
        g.beginPath();
        g.moveTo(p.x, p.y);
        g.lineTo(q.x, q.y);
        g.stroke();
        if (isEgg && u.altArea && u.altArea.length >= 3) {
          this.eggPath(u.altArea);
          g.lineWidth = 1.8;
          g.stroke();
          g.setLineDash([]);
          if (this.layers.labels || u.selected) this.halo(`ALT ${u.label}`, q.x, q.y, 10, C.blue, 'center', 800);
        } else {
          g.beginPath();
          g.arc(q.x, q.y, size * 0.5, 0, Math.PI * 2);
          g.stroke();
          g.setLineDash([]);
          this.halo('ALT', q.x, q.y, 9, C.blue, 'center', 800);
        }
      }
      if (this.layers.arcs && u.arc && u.facing !== undefined) {
        let r = Math.max(26, Math.min(140, (u.radius ?? 400) * this.scale));
        if (isEgg) {
          const es = this.eggScreen(u.area!);
          r = Math.max(36, Math.min(190, Math.max(es.maxX - es.minX, es.maxY - es.minY) * 0.95));
        }
        const a0 = ((u.facing - 30 - 90) * Math.PI) / 180;
        const a1 = ((u.facing + 30 - 90) * Math.PI) / 180;
        g.beginPath();
        g.moveTo(p.x, p.y);
        g.arc(p.x, p.y, r, a0, a1);
        g.closePath();
        g.fillStyle = u.side === 'RED' ? 'rgba(198,40,40,0.08)' : 'rgba(11,92,173,0.08)';
        g.fill();
        g.strokeStyle = u.side === 'RED' ? 'rgba(198,40,40,0.5)' : 'rgba(11,92,173,0.5)';
        g.lineWidth = 1;
        g.stroke();
      }
      if (!u.area && u.radius && this.scale * u.radius > 20 && u.side !== 'UNK') {
        g.beginPath();
        g.arc(p.x, p.y, u.radius * this.scale, 0, Math.PI * 2);
        g.strokeStyle = u.side === 'RED' ? 'rgba(198,40,40,0.25)' : 'rgba(11,92,173,0.25)';
        g.lineWidth = 1;
        g.stroke();
      }
    }
    // eggs: larger areas underneath smaller ones
    const eggUnits = units.filter((u) => eggs.has(u.id)).sort((a, b) => eggSize(b) - eggSize(a));
    for (const u of eggUnits) this.drawEgg(u);
    // "found from" connectors over the eggs, under the point symbols
    for (const u of units) if (u.link) this.drawLink(u, this.toScreen(u.pos), size);
    for (const u of units) {
      if (eggs.has(u.id) && u.side !== 'RED') continue;
      const p = this.toScreen(u.pos);
      if (u.shape === 'OPLP') {
        this.drawOpLp(u, p, size);
        if (u.selected) {
          g.strokeStyle = '#ffb300';
          g.lineWidth = 3;
          g.beginPath();
          g.arc(p.x, p.y, size * 0.72, 0, Math.PI * 2);
          g.stroke();
        }
        if (u.sub && (this.layers.labels || u.selected)) this.halo(u.sub, p.x + size * 0.5, p.y + 12, 9.5, C.blue, 'left', 600);
        if (u.strengthPct !== undefined) this.strengthBar(p.x, p.y + size * 0.5, size, u.strengthPct);
        continue;
      }
      const img = symbolImage(u.sidc, { size, label: u.label, higher: u.higher, planned: u.planned && u.side !== 'RED', mono: u.status === 'LOST' ? '#777' : undefined });
      const sx = p.x - img.ax;
      const sy = p.y - img.ay;
      g.save();
      g.globalAlpha = u.dim ? 0.45 : u.conf !== undefined ? 0.45 + 0.55 * u.conf : 1;
      g.drawImage(img.canvas, sx, sy, img.canvas.width / this.dprSym(), img.canvas.height / this.dprSym());
      g.restore();
      if (u.selected) {
        g.strokeStyle = '#ffb300';
        g.lineWidth = 3;
        g.beginPath();
        g.arc(p.x, p.y, size * 0.95, 0, Math.PI * 2);
        g.stroke();
      }
      if (u.sub && (this.layers.labels || u.selected)) this.halo(u.sub, p.x, p.y + size * 0.62 + (u.strengthPct !== undefined ? 14 : 6), 9.5, this.colorOf(u), 'center', 600);
      if (u.strengthPct !== undefined && u.side !== 'UNK') this.strengthBar(p.x, p.y + size * 0.62, size, u.strengthPct);
      if (u.status === 'ASSAULT' || u.status === 'WITHDRAW') {
        this.halo(u.status === 'ASSAULT' ? 'ASLT' : 'WDR', p.x + size * 0.8, p.y - size * 0.6, 10, u.side === 'RED' ? C.enemy : C.blue, 'left', 800);
      }
      if (u.stale) this.halo('?', p.x + size * 0.7, p.y + size * 0.1, 13, '#555', 'left', 800);
    }
    for (const u of eggUnits) this.drawEggLabels(u);
  }

  private strengthBar(x: number, y: number, size: number, strengthPct: number): void {
    const g = this.ctx;
    const w = size * 1.2;
    g.fillStyle = 'rgba(0,0,0,0.55)';
    g.fillRect(x - w / 2 - 1, y - 1, w + 2, 6);
    const pct = Math.max(0, Math.min(100, strengthPct));
    g.fillStyle = pct > 66 ? '#43a047' : pct > 33 ? '#fbc02d' : '#e53935';
    g.fillRect(x - w / 2, y, (w * pct) / 100, 4);
  }

  private drawHandles(hs: NonNullable<MapScene['handles']>): void {
    const g = this.ctx;
    for (const h of hs) {
      const p = this.toScreen(h.p);
      g.save();
      g.lineWidth = 1.6;
      g.strokeStyle = '#0d1a26';
      g.fillStyle = h.hot ? '#ffb300' : '#ffffff';
      g.beginPath();
      if (h.kind === 'vertex') g.rect(p.x - 4.5, p.y - 4.5, 9, 9);
      else if (h.kind === 'mid') g.arc(p.x, p.y, 5, 0, Math.PI * 2);
      else if (h.kind === 'resize') g.arc(p.x, p.y, 5.5, 0, Math.PI * 2);
      else if (h.kind === 'radius') {
        g.moveTo(p.x, p.y - 6);
        g.lineTo(p.x + 6, p.y);
        g.lineTo(p.x, p.y + 6);
        g.lineTo(p.x - 6, p.y);
        g.closePath();
      } else g.arc(p.x, p.y, 7, 0, Math.PI * 2);
      g.globalAlpha = h.kind === 'mid' && !h.hot ? 0.8 : 1;
      g.fill();
      g.stroke();
      g.globalAlpha = 1;
      if (h.kind === 'mid') {
        g.beginPath();
        g.moveTo(p.x - 2.6, p.y);
        g.lineTo(p.x + 2.6, p.y);
        g.moveTo(p.x, p.y - 2.6);
        g.lineTo(p.x, p.y + 2.6);
        g.stroke();
      } else if (h.kind === 'rotate') {
        g.beginPath();
        g.arc(p.x, p.y, 3.6, -Math.PI * 0.9, Math.PI * 0.4);
        g.stroke();
      } else if (h.kind === 'resize') {
        g.beginPath();
        g.arc(p.x, p.y, 1.8, 0, Math.PI * 2);
        g.fillStyle = '#0d1a26';
        g.fill();
      }
      g.restore();
    }
  }

  private drawBox(b: { a: Vec; b: Vec }): void {
    const g = this.ctx;
    const a = this.toScreen(b.a);
    const c = this.toScreen(b.b);
    const x = Math.min(a.x, c.x);
    const y = Math.min(a.y, c.y);
    g.fillStyle = 'rgba(255,179,0,0.08)';
    g.fillRect(x, y, Math.abs(c.x - a.x), Math.abs(c.y - a.y));
    g.strokeStyle = '#ffb300';
    g.lineWidth = 1.5;
    g.setLineDash([5, 4]);
    g.strokeRect(x, y, Math.abs(c.x - a.x), Math.abs(c.y - a.y));
    g.setLineDash([]);
  }

  private dprSym(): number {
    return Math.min(3, window.devicePixelRatio || 1);
  }

  private drawMissions(ms: MissionGlyph[]): void {
    const g = this.ctx;
    for (const m of ms) {
      const p = this.toScreen(m.target);
      const r = this.px(m.radius, 10, 90);
      const grad = g.createRadialGradient(p.x, p.y, 2, p.x, p.y, r);
      grad.addColorStop(0, m.side === 'BLUE' ? 'rgba(255,170,0,0.55)' : 'rgba(255,60,40,0.5)');
      grad.addColorStop(1, 'rgba(255,120,0,0)');
      g.fillStyle = grad;
      g.beginPath();
      g.arc(p.x, p.y, r, 0, Math.PI * 2);
      g.fill();
    }
  }

  private drawFires(fs: FireGlyph[]): void {
    const g = this.ctx;
    for (const f of fs) {
      const a = this.toScreen(f.from);
      const b = this.toScreen(f.to);
      if (f.kind === 3 || f.kind === 4) {
        for (let i = 0; i < 3; i++) {
          const jx = (Math.random() - 0.5) * this.px(160, 8, 40);
          const jy = (Math.random() - 0.5) * this.px(160, 8, 40);
          g.beginPath();
          g.arc(b.x + jx, b.y + jy, 3 + Math.random() * 4, 0, Math.PI * 2);
          g.fillStyle = f.kind === 3 ? 'rgba(255,200,40,0.9)' : 'rgba(255,80,40,0.9)';
          g.fill();
        }
        continue;
      }
      g.strokeStyle = f.kind === 1 ? 'rgba(30,120,255,0.75)' : 'rgba(230,40,30,0.75)';
      g.lineWidth = 1.3;
      g.beginPath();
      g.moveTo(a.x, a.y);
      g.lineTo(b.x, b.y);
      g.stroke();
    }
  }

  private drawQcs(qs: { pos: Vec; kind: string }[]): void {
    for (const q of qs) {
      const p = this.toScreen(q.pos);
      const img = symbolImage(q.kind === 'ATTACK' ? 'SFAPMFQA-------' : 'SFAPMHQ--------', { size: 20, info: false });
      const d = this.dprSym();
      this.ctx.drawImage(img.canvas, p.x - img.ax, p.y - img.ay, img.canvas.width / d, img.canvas.height / d);
    }
  }

  private drawTrails(tr: { pts: Vec[]; side: Side }[]): void {
    for (const t of tr) {
      if (t.pts.length < 2) continue;
      this.path(t.pts);
      this.ctx.strokeStyle = t.side === 'RED' ? 'rgba(198,40,40,0.45)' : 'rgba(11,92,173,0.45)';
      this.ctx.lineWidth = 2;
      this.ctx.setLineDash([2, 4]);
      this.ctx.stroke();
      this.ctx.setLineDash([]);
    }
  }

  private drawDraft(d: NonNullable<MapScene['draft']>): void {
    const g = this.ctx;
    if (!d.pts.length) return;
    if (d.kind === 'DF' || d.kind === 'QC_AREA' || d.kind === 'CPEN') {
      const p = this.toScreen(d.pts[0]);
      g.beginPath();
      g.arc(p.x, p.y, this.px(d.radius ?? 150, 8, 400), 0, Math.PI * 2);
      g.strokeStyle = '#ffb300';
      g.lineWidth = 2;
      g.setLineDash([4, 4]);
      g.stroke();
      g.setLineDash([]);
      return;
    }
    if (d.kind === 'CIRCLE') {
      if (d.pts.length < 2) return;
      const a = this.toScreen(d.pts[0]);
      const b = this.toScreen(d.pts[1]);
      g.beginPath();
      g.ellipse((a.x + b.x) / 2, (a.y + b.y) / 2, Math.abs(b.x - a.x) / 2, Math.abs(b.y - a.y) / 2, 0, 0, Math.PI * 2);
      g.fillStyle = 'rgba(255,179,0,0.08)';
      g.fill();
      g.strokeStyle = '#ffb300';
      g.lineWidth = 2.5;
      g.setLineDash([6, 4]);
      g.stroke();
      g.setLineDash([]);
      return;
    }
    const closed = d.closed ?? (d.kind === 'KILL_AREA' || d.kind === 'AREA');
    this.path(d.pts, closed);
    if (closed && d.pts.length > 2) {
      g.fillStyle = 'rgba(255,179,0,0.08)';
      g.fill();
    }
    g.strokeStyle = '#ffb300';
    g.lineWidth = 2.5;
    g.lineJoin = 'round';
    g.lineCap = 'round';
    if (d.kind !== 'FREEHAND') g.setLineDash([6, 4]);
    g.stroke();
    g.setLineDash([]);
    if (d.kind === 'FREEHAND') {
      if (closed) {
        const p = this.toScreen(d.pts[0]);
        g.beginPath();
        g.arc(p.x, p.y, 7, 0, Math.PI * 2);
        g.strokeStyle = '#ffb300';
        g.lineWidth = 2;
        g.stroke();
      }
      return;
    }
    for (const q of d.pts) {
      const p = this.toScreen(q);
      g.fillStyle = '#ffb300';
      g.fillRect(p.x - 3, p.y - 3, 6, 6);
    }
  }

  private drawMeasure(m: { a: Vec; b: Vec }): void {
    const g = this.ctx;
    const a = this.toScreen(m.a);
    const b = this.toScreen(m.b);
    g.strokeStyle = '#ffb300';
    g.lineWidth = 2;
    g.setLineDash([5, 3]);
    g.beginPath();
    g.moveTo(a.x, a.y);
    g.lineTo(b.x, b.y);
    g.stroke();
    g.setLineDash([]);
    const d = dist(m.a, m.b);
    const brg = bearing(m.a, m.b);
    this.halo(`${Math.round(d)} m  ${Math.round(brg)}°`, (a.x + b.x) / 2, (a.y + b.y) / 2 - 12, 13, '#7a4f00', 'center', 800);
  }

  private drawFrame(tl: Vec, br: Vec): void {
    const g = this.ctx;
    g.strokeStyle = '#0c1014';
    g.lineWidth = 2;
    g.strokeRect(tl.x, tl.y, br.x - tl.x, br.y - tl.y);
    if (this.layers.grid) {
      const gs = this.s.terrain.gridSq;
      const fs = 11;
      for (let x = 0; x <= this.s.terrain.width + 1; x += gs) {
        const s = this.toScreen({ x, y: 0 });
        const label = String(this.t.gridLabelE(x + 1)).padStart(2, '0');
        const y = Math.min(this.h - 8, br.y + 10);
        if (s.x > 0 && s.x < this.w) this.halo(label, s.x, y, fs, '#e9eef2', 'center', 700, 'rgba(0,0,0,0.6)');
        const yt = Math.max(8, tl.y - 10);
        if (s.x > 0 && s.x < this.w) this.halo(label, s.x, yt, fs, '#e9eef2', 'center', 700, 'rgba(0,0,0,0.6)');
      }
      for (let y = 0; y <= this.s.terrain.height + 1; y += gs) {
        const s = this.toScreen({ x: 0, y });
        const label = String(this.t.gridLabelN(y + 1)).padStart(2, '0');
        const x = Math.max(12, tl.x - 14);
        if (s.y > 0 && s.y < this.h) this.halo(label, x, s.y, fs, '#e9eef2', 'center', 700, 'rgba(0,0,0,0.6)');
      }
    }
    // scale bar
    const target = 120 / this.scale;
    const nice = [100, 200, 250, 500, 1000, 2000, 2500, 5000, 10000].find((v) => v >= target * 0.6) ?? 10000;
    const L = nice * this.scale;
    const x0 = 16;
    const y0 = this.h - 22;
    g.fillStyle = 'rgba(12,16,20,0.72)';
    g.fillRect(x0 - 8, y0 - 18, L + 76, 30);
    g.fillStyle = '#fff';
    g.fillRect(x0, y0, L, 4);
    g.fillStyle = '#111';
    g.fillRect(x0 + L / 2, y0, L / 2, 4);
    g.strokeStyle = '#fff';
    g.strokeRect(x0, y0, L, 4);
    this.halo(nice >= 1000 ? `${nice / 1000} km` : `${nice} m`, x0 + L + 8, y0 + 2, 11, '#fff', 'left', 700, 'rgba(0,0,0,0.4)');
    this.halo(`1 sq = ${this.s.terrain.gridSq} m`, x0, y0 - 9, 10, '#cfd8dc', 'left', 600, 'rgba(0,0,0,0.4)');
    // north arrow
    const nx = this.w - 30;
    const ny = 40;
    g.fillStyle = 'rgba(12,16,20,0.72)';
    g.beginPath();
    g.arc(nx, ny, 20, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#fff';
    g.beginPath();
    g.moveTo(nx, ny - 14);
    g.lineTo(nx + 7, ny + 8);
    g.lineTo(nx, ny + 3);
    g.lineTo(nx - 7, ny + 8);
    g.closePath();
    g.fill();
    this.halo('N', nx, ny - 24, 11, '#fff', 'center', 800, 'rgba(0,0,0,0.5)');
  }

  // ------------------------------------------------------------------ hit testing
  unitAt(sx: number, sy: number, units = this.scene.units): UnitGlyph | undefined {
    let best: UnitGlyph | undefined;
    let bd = 22;
    for (const u of units) {
      const p = this.toScreen(u.pos);
      const d = Math.hypot(p.x - sx, p.y - sy);
      if (d < bd) {
        bd = d;
        best = u;
      }
    }
    if (best) return best;
    // inside a goose egg: the smallest egg wins
    const w = this.toWorld(sx, sy);
    let ba = Infinity;
    for (const u of units) {
      if (!u.area || u.area.length < 3 || !this.eggVisible(u)) continue;
      const a = eggSize(u);
      if (a < ba && inPoly(w, sampleClosed(u.area, 4))) {
        ba = a;
        best = u;
      }
    }
    return best;
  }

  graphicAt(sx: number, sy: number): PlanGraphic | undefined {
    const w = this.toWorld(sx, sy);
    return graphicHit(this.scene.graphics, w, 1 / this.scale);
  }
}

const POINT_KINDS = new Set(['DF', 'QC_AREA', 'CPEN', 'NOTE', 'TEXT', 'SYMBOL', 'TRP']);

/** Distance (m) from w to a graphic, 0 inside closed areas (shared by the renderer and the planner). */
export function graphicDistance(gr: PlanGraphic, w: Vec, mPerPx: number): number {
  if (!gr.pts.length) return Infinity;
  if (POINT_KINDS.has(gr.kind) || gr.pts.length === 1) {
    const d = dist(w, gr.pts[0]);
    if (gr.kind === 'DF' || gr.kind === 'QC_AREA') {
      // ring or centre (the interior stays clickable for what lies underneath); radius as drawn
      const r = gr.kind === 'DF' ? Math.max(9 * mPerPx, Math.min(80 * mPerPx, gr.props.radius ?? 150)) : Math.max(14 * mPerPx, Math.min(400 * mPerPx, gr.props.radius ?? 600));
      return Math.abs(d - r) < 8 * mPerPx || d < 14 * mPerPx ? 0 : Math.min(Math.abs(d - r), d);
    }
    const r = gr.kind === 'CPEN' ? 28 * mPerPx : 16 * mPerPx;
    return Math.max(0, d - Math.max(r, 12 * mPerPx));
  }
  const closed = gr.kind === 'KILL_AREA' || gr.kind === 'AREA' || (gr.kind === 'FREE' && !!gr.props.closed);
  const smooth = gr.kind === 'FREE' || gr.kind === 'AREA' || gr.kind === 'ARROW' ? gr.props.smooth !== false : !!gr.props.smooth;
  const line = smooth && gr.pts.length >= 3 ? (closed ? sampleClosed(gr.pts, 6) : sampleOpen(gr.pts, 6)) : gr.pts;
  const pts = closed ? [...line, line[0]] : line;
  let d = Infinity;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const ab = sub(b, a);
    const l2 = ab.x * ab.x + ab.y * ab.y;
    const tt = l2 ? Math.max(0, Math.min(1, ((w.x - a.x) * ab.x + (w.y - a.y) * ab.y) / l2)) : 0;
    d = Math.min(d, dist(w, { x: a.x + ab.x * tt, y: a.y + ab.y * tt }));
  }
  if (closed && d > 6 * mPerPx && inPoly(w, line)) return 6 * mPerPx;
  return d;
}

function inPoly(p: Vec, poly: Vec[]): boolean {
  let ins = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y + 1e-12) + a.x) ins = !ins;
  }
  return ins;
}

/** Nearest graphic within 12 px of w. */
export function graphicHit(graphics: PlanGraphic[], w: Vec, mPerPx: number): PlanGraphic | undefined {
  let best: PlanGraphic | undefined;
  let bd = 12 * mPerPx;
  for (const gr of graphics) {
    const d = graphicDistance(gr, w, mPerPx);
    if (d < bd) {
      bd = d;
      best = gr;
    }
  }
  return best;
}

function eggSize(u: UnitGlyph): number {
  if (!u.area) return 0;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of u.area) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
  }
  return (maxX - minX) * (maxY - minY);
}

// Canvas hex-map renderer. Terrain (fill, hillshade, glyphs, grid, edges) is cached in 512-px tiles per zoom
// level so a 100 × 100 map pans at 60 fps (MAP-07); units, overlays and effects are drawn each frame.
import {
  type GhostView,
  type Hex,
  type MapModel,
  type ObjectiveView,
  type ReachNode,
  type Ruleset,
  type Side,
  type UnitView,
  directionTo,
  edgeSegment,
  hexCorners,
  hexKey,
  hexNeighbors,
  hexToPoint,
  pointToHex,
} from '@tht/engine';
import { sidcFor, symbolCanvas } from './symbols';

export interface Camera {
  /** World metres at the screen centre. */
  x: number;
  y: number;
  /** CSS px per metre. */
  zoom: number;
}

export interface Effect {
  kind: 'impact' | 'tracer' | 'miss';
  from?: Hex | null;
  to: Hex;
  t0: number;
  side: Side;
}

export interface Scene {
  viewer: Side;
  units: UnitView[];
  ghosts: GhostView[];
  objectives: ObjectiveView[];
  selectedId?: string | null;
  reach?: Map<string, ReachNode> | null;
  viewshed?: Set<string> | null;
  zone?: Set<string> | null;
  targets?: Set<string> | null;
  attackable?: Set<string> | null;
  hover?: Hex | null;
  path?: Hex[] | null;
  pendingFires?: { hex: Hex; impactTurn: number }[];
  effects?: Effect[];
  grid: boolean;
  labels: boolean;
  turn: number;
}

export const SIDE_COLORS: Record<Side, { fill: string; edge: string; text: string }> = {
  // colour-blind-safe pair (blue vs orange-red) + APP-6 frame shape (rectangle vs diamond)
  blue: { fill: '#a9d8f5', edge: '#1d5f96', text: '#0d2c46' },
  red: { fill: '#f6b5a1', edge: '#a8361b', text: '#4a1205' },
};

const TILE = 512;

export class MapRenderer {
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  cam: Camera = { x: 0, y: 0, zoom: 0.25 };
  w = 1;
  h = 1;
  dpr = 1;
  private tiles = new Map<string, HTMLCanvasElement>();
  private shade = new Map<string, number>();
  private bounds: { minX: number; minY: number; maxX: number; maxY: number };
  private spacing: number;
  private elevLo = 0;
  private elevHi = 1;
  grid = true;

  constructor(
    canvas: HTMLCanvasElement,
    readonly map: MapModel,
    readonly data: Ruleset,
  ) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
    this.spacing = map.def.hexSize_m;
    const pts = map.list.map((h) => this.centre(h));
    const r = this.spacing / Math.sqrt(3);
    this.bounds = { minX: Math.min(...pts.map((p) => p.x)) - r, minY: Math.min(...pts.map((p) => p.y)) - r, maxX: Math.max(...pts.map((p) => p.x)) + r, maxY: Math.max(...pts.map((p) => p.y)) + r };
    const els = map.list.map((h) => h.elevation_m);
    this.elevLo = Math.min(...els);
    this.elevHi = Math.max(...els);
    // hillshade: light from the north-west
    for (const h of map.list) {
      let gx = 0;
      let gy = 0;
      const c = this.centre(h);
      for (const n of hexNeighbors(h)) {
        const cell = map.get(n);
        if (!cell) continue;
        const p = this.centre(n);
        const de = cell.elevation_m - h.elevation_m;
        gx += (de * (p.x - c.x)) / this.spacing ** 2;
        gy += (de * (p.y - c.y)) / this.spacing ** 2;
      }
      // normal ~ (-gx, -gy, 1/3); light from NW (-1, -1, 1)
      const nx = -gx * 3;
      const ny = -gy * 3;
      const lam = (-nx - ny + 1) / (Math.sqrt(nx * nx + ny * ny + 1) * Math.sqrt(3));
      this.shade.set(hexKey(h), lam - 1 / Math.sqrt(3));
    }
  }

  centre(h: Hex): { x: number; y: number } {
    return hexToPoint(h, this.map.def.orientation, this.spacing);
  }

  resize(w: number, h: number): void {
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.w = Math.max(1, w);
    this.h = Math.max(1, h);
    this.canvas.width = Math.round(this.w * this.dpr);
    this.canvas.height = Math.round(this.h * this.dpr);
    this.canvas.style.width = `${this.w}px`;
    this.canvas.style.height = `${this.h}px`;
  }

  fit(pad = 24): void {
    const b = this.bounds;
    this.cam.zoom = Math.min((this.w - pad * 2) / (b.maxX - b.minX), (this.h - pad * 2) / (b.maxY - b.minY));
    this.cam.x = (b.minX + b.maxX) / 2;
    this.cam.y = (b.minY + b.maxY) / 2;
  }

  get minZoom(): number {
    const b = this.bounds;
    return Math.min(this.w / (b.maxX - b.minX), this.h / (b.maxY - b.minY)) * 0.6;
  }

  zoomAt(sx: number, sy: number, f: number): void {
    const before = this.toWorld(sx, sy);
    this.cam.zoom = Math.max(this.minZoom, Math.min(2.2, this.cam.zoom * f));
    const after = this.toWorld(sx, sy);
    this.cam.x += before.x - after.x;
    this.cam.y += before.y - after.y;
    this.clampCam();
  }

  panBy(dx: number, dy: number): void {
    this.cam.x -= dx / this.cam.zoom;
    this.cam.y -= dy / this.cam.zoom;
    this.clampCam();
  }

  centreOn(h: Hex): void {
    const c = this.centre(h);
    this.cam.x = c.x;
    this.cam.y = c.y;
    this.clampCam();
  }

  /** Keep the map filling the view (or centred when it is smaller than the view). */
  private clampCam(): void {
    const b = this.bounds;
    const hw = this.w / 2 / this.cam.zoom;
    const hh = this.h / 2 / this.cam.zoom;
    this.cam.x = b.maxX - b.minX > 2 * hw ? Math.max(b.minX + hw, Math.min(b.maxX - hw, this.cam.x)) : (b.minX + b.maxX) / 2;
    this.cam.y = b.maxY - b.minY > 2 * hh ? Math.max(b.minY + hh, Math.min(b.maxY - hh, this.cam.y)) : (b.minY + b.maxY) / 2;
  }

  /** Frame a set of hexes at a comfortable zoom (about `hexesAcross` hexes across the view). */
  frame(hexes: Hex[], hexesAcross = 22): void {
    if (!hexes.length) return this.fit();
    const pts = hexes.map((h) => this.centre(h));
    const minX = Math.min(...pts.map((p) => p.x));
    const maxX = Math.max(...pts.map((p) => p.x));
    const minY = Math.min(...pts.map((p) => p.y));
    const maxY = Math.max(...pts.map((p) => p.y));
    const want = Math.min(this.w / (this.spacing * hexesAcross), (this.w - 80) / Math.max(1, maxX - minX), (this.h - 80) / Math.max(1, maxY - minY));
    this.cam.zoom = Math.max(this.minZoom, Math.min(2.2, want));
    this.cam.x = (minX + maxX) / 2;
    this.cam.y = (minY + maxY) / 2;
    this.clampCam();
  }

  toScreen(p: { x: number; y: number }): { x: number; y: number } {
    return { x: (p.x - this.cam.x) * this.cam.zoom + this.w / 2, y: (p.y - this.cam.y) * this.cam.zoom + this.h / 2 };
  }
  toWorld(sx: number, sy: number): { x: number; y: number } {
    return { x: (sx - this.w / 2) / this.cam.zoom + this.cam.x, y: (sy - this.h / 2) / this.cam.zoom + this.cam.y };
  }
  hexAt(sx: number, sy: number): Hex | null {
    const h = pointToHex(this.toWorld(sx, sy), this.map.def.orientation, this.spacing);
    return this.map.has(h) ? h : null;
  }
  /** On-screen centre-to-centre hex spacing in CSS px. */
  get hexPx(): number {
    return this.spacing * this.cam.zoom;
  }

  // ------------------------------------------------------------ terrain tiles
  private tileFor(level: number, tx: number, ty: number): HTMLCanvasElement {
    const key = `${level}:${tx}:${ty}:${this.grid ? 1 : 0}`;
    let c = this.tiles.get(key);
    if (c) {
      this.tiles.delete(key);
      this.tiles.set(key, c); // LRU
      return c;
    }
    c = document.createElement('canvas');
    c.width = TILE;
    c.height = TILE;
    const g = c.getContext('2d')!;
    const pxPerM = 2 ** level;
    const x0 = (tx * TILE) / pxPerM;
    const y0 = (ty * TILE) / pxPerM;
    const x1 = x0 + TILE / pxPerM;
    const y1 = y0 + TILE / pxPerM;
    const r = this.spacing / Math.sqrt(3);
    const P = (p: { x: number; y: number }) => ({ x: (p.x - x0) * pxPerM, y: (p.y - y0) * pxPerM });
    const hexR = r * pxPerM;
    const inTile = this.map.list.filter((h) => {
      const p = this.centre(h);
      return p.x > x0 - r && p.x < x1 + r && p.y > y0 - r && p.y < y1 + r;
    });
    g.lineJoin = 'round';
    for (const h of inTile) {
      const corners = hexCorners(h, this.map.def.orientation, this.spacing).map(P);
      g.beginPath();
      corners.forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y)));
      g.closePath();
      g.fillStyle = h.terrain.color;
      g.fill();
      const rel = (h.elevation_m - this.elevLo) / Math.max(1, this.elevHi - this.elevLo);
      g.fillStyle = `rgba(110,80,40,${(0.32 * rel).toFixed(3)})`;
      g.fill();
      const s = this.shade.get(hexKey(h)) ?? 0;
      g.fillStyle = s >= 0 ? `rgba(255,252,240,${Math.min(0.35, s * 1.4).toFixed(3)})` : `rgba(30,25,15,${Math.min(0.45, -s * 1.6).toFixed(3)})`;
      g.fill();
      if (hexR >= 11) this.glyph(g, h.terrain.symbol, P(this.centre(h)), hexR, hexKey(h));
    }
    if (this.grid && hexR >= 7) {
      g.strokeStyle = 'rgba(30,30,25,0.28)';
      g.lineWidth = Math.max(0.5, hexR / 40);
      for (const h of inTile) {
        const corners = hexCorners(h, this.map.def.orientation, this.spacing).map(P);
        g.beginPath();
        corners.forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y)));
        g.closePath();
        g.stroke();
      }
    }
    // edges: water / obstacles along hex sides first, then roads over them, bridges last
    const edges = this.map.allEdges().filter((e) => {
      const p = this.centre(e.a);
      return p.x > x0 - 2 * r && p.x < x1 + 2 * r && p.y > y0 - 2 * r && p.y < y1 + 2 * r;
    });
    const widthPx = (w: number) => Math.max(1, (w * hexR) / 22);
    for (const pass of ['edge', 'centerline', 'bridge'] as const) {
      for (const e of edges) {
        const dir = directionTo(e.a, e.b);
        for (const f of e.features) {
          if (pass === 'bridge' ? f.id !== 'bridge' : f.id === 'bridge' || f.draw !== pass) continue;
          if (pass === 'centerline') {
            const a = P(this.centre(e.a));
            const b = P(this.centre(e.b));
            g.lineCap = 'round';
            g.strokeStyle = 'rgba(255,255,255,0.75)';
            g.lineWidth = widthPx(f.width) + 2;
            g.beginPath();
            g.moveTo(a.x, a.y);
            g.lineTo(b.x, b.y);
            g.stroke();
            g.strokeStyle = f.color;
            g.lineWidth = widthPx(f.width);
            g.setLineDash(f.id === 'track' ? [widthPx(4), widthPx(3)] : []);
            g.stroke();
            g.setLineDash([]);
          } else {
            const [p1, p2] = edgeSegment(e.a, dir, this.map.def.orientation, this.spacing).map(P);
            g.lineCap = 'round';
            if (f.id === 'bridge') {
              const mx = (p1.x + p2.x) / 2;
              const my = (p1.y + p2.y) / 2;
              g.save();
              g.translate(mx, my);
              g.rotate(Math.atan2(p2.y - p1.y, p2.x - p1.x));
              g.fillStyle = '#2b2b2b';
              g.fillRect(-hexR * 0.32, -widthPx(4), hexR * 0.64, widthPx(8));
              g.fillStyle = '#d9d2c0';
              g.fillRect(-hexR * 0.28, -widthPx(2.5), hexR * 0.56, widthPx(5));
              g.restore();
              continue;
            }
            g.strokeStyle = f.color;
            g.lineWidth = widthPx(f.width);
            g.setLineDash(f.id === 'bund' ? [widthPx(3), widthPx(2)] : f.id === 'ridgeline' ? [widthPx(6), widthPx(3)] : f.id === 'nullah' ? [widthPx(2), widthPx(2)] : []);
            g.beginPath();
            g.moveTo(p1.x, p1.y);
            g.lineTo(p2.x, p2.y);
            g.stroke();
            g.setLineDash([]);
          }
        }
      }
    }
    this.tiles.set(key, c);
    while (this.tiles.size > 48) this.tiles.delete(this.tiles.keys().next().value!);
    return c;
  }

  /** Terrain symbols (MAP-03): each terrain type has its own glyph. */
  private glyph(g: CanvasRenderingContext2D, symbol: string, c: { x: number; y: number }, r: number, seed: string): void {
    let h = 0;
    for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    const rnd = () => ((h = (h * 1103515245 + 12345) >>> 0) / 4294967296);
    const s = r / 10;
    g.save();
    g.translate(c.x, c.y);
    switch (symbol) {
      case 'woods':
        for (const [dx, dy] of [[-3, -1], [3, -2], [0, 3], [-4, 4], [4, 3]]) {
          g.fillStyle = 'rgba(40,90,40,0.75)';
          g.beginPath();
          g.arc(dx * s, dy * s, 2.4 * s, 0, Math.PI * 2);
          g.fill();
        }
        break;
      case 'orchard':
        g.fillStyle = 'rgba(50,100,45,0.7)';
        for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
          g.beginPath();
          g.arc(i * 4 * s, j * 4 * s, 1.3 * s, 0, Math.PI * 2);
          g.fill();
        }
        break;
      case 'scrub':
        g.strokeStyle = 'rgba(80,95,50,0.7)';
        g.lineWidth = Math.max(0.6, s * 0.6);
        for (let i = 0; i < 4; i++) {
          const x = (rnd() - 0.5) * 11 * s;
          const y = (rnd() - 0.5) * 9 * s;
          g.beginPath();
          g.moveTo(x - 1.5 * s, y + 1 * s);
          g.lineTo(x, y - 1.5 * s);
          g.lineTo(x + 1.5 * s, y + 1 * s);
          g.stroke();
        }
        break;
      case 'crops':
        g.strokeStyle = 'rgba(140,140,60,0.55)';
        g.lineWidth = Math.max(0.5, s * 0.45);
        for (let i = -2; i <= 2; i++) {
          g.beginPath();
          g.moveTo(-5 * s, i * 2.2 * s);
          g.lineTo(5 * s, i * 2.2 * s);
          g.stroke();
        }
        break;
      case 'built_up':
        g.fillStyle = 'rgba(90,50,35,0.8)';
        for (const [dx, dy] of [[-4, -3], [1, -4], [-2, 1], [3, 0], [-4, 4], [2, 4]]) g.fillRect(dx * s, dy * s, 2.6 * s, 2.6 * s);
        break;
      case 'village':
        g.fillStyle = 'rgba(120,80,45,0.75)';
        for (const [dx, dy] of [[-3, -2], [2, -3], [0, 2], [-4, 3]]) g.fillRect(dx * s, dy * s, 2.2 * s, 1.8 * s);
        break;
      case 'rocky':
        g.fillStyle = 'rgba(100,90,80,0.7)';
        for (let i = 0; i < 4; i++) {
          const x = (rnd() - 0.5) * 10 * s;
          const y = (rnd() - 0.5) * 9 * s;
          g.beginPath();
          g.moveTo(x, y - 1.8 * s);
          g.lineTo(x + 1.8 * s, y + 1.2 * s);
          g.lineTo(x - 1.8 * s, y + 1.2 * s);
          g.closePath();
          g.fill();
        }
        break;
      case 'scree':
        g.fillStyle = 'rgba(110,100,90,0.6)';
        for (let i = 0; i < 9; i++) g.fillRect((rnd() - 0.5) * 11 * s, (rnd() - 0.5) * 9 * s, 0.9 * s, 0.9 * s);
        break;
      case 'marsh':
        g.strokeStyle = 'rgba(40,90,120,0.7)';
        g.lineWidth = Math.max(0.6, s * 0.5);
        for (const dy of [-3, 0, 3]) {
          g.beginPath();
          g.moveTo(-4 * s, dy * s);
          g.lineTo(4 * s, dy * s);
          g.moveTo(-1 * s, dy * s);
          g.lineTo(0, (dy - 2) * s);
          g.lineTo(1 * s, dy * s);
          g.stroke();
        }
        break;
      case 'dunes':
        g.strokeStyle = 'rgba(160,120,60,0.7)';
        g.lineWidth = Math.max(0.6, s * 0.6);
        for (const dy of [-2.5, 2.5]) {
          g.beginPath();
          g.arc(0, dy * s + 3 * s, 4 * s, Math.PI * 1.15, Math.PI * 1.85);
          g.stroke();
        }
        break;
      case 'snow':
        g.fillStyle = 'rgba(160,180,200,0.7)';
        for (let i = 0; i < 4; i++) g.fillRect((rnd() - 0.5) * 10 * s, (rnd() - 0.5) * 8 * s, 1 * s, 1 * s);
        break;
    }
    g.restore();
  }

  // ------------------------------------------------------------ frame
  draw(scene: Scene, now: number): boolean {
    const g = this.ctx;
    const dpr = this.dpr;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = '#10161b';
    g.fillRect(0, 0, this.canvas.width, this.canvas.height);
    this.grid = scene.grid;
    // terrain tiles at the next power-of-two device resolution
    const devZoom = this.cam.zoom * dpr;
    const level = Math.max(-6, Math.min(2, Math.ceil(Math.log2(devZoom))));
    const pxPerM = 2 ** level;
    const scale = devZoom / pxPerM;
    const tl = this.toWorld(0, 0);
    const br = this.toWorld(this.w, this.h);
    const tMeters = TILE / pxPerM;
    g.imageSmoothingEnabled = true;
    for (let ty = Math.floor(tl.y / tMeters); ty <= Math.floor(br.y / tMeters); ty++) {
      for (let tx = Math.floor(tl.x / tMeters); tx <= Math.floor(br.x / tMeters); tx++) {
        const sx = ((tx * tMeters - this.cam.x) * this.cam.zoom + this.w / 2) * dpr;
        const sy = ((ty * tMeters - this.cam.y) * this.cam.zoom + this.h / 2) * dpr;
        g.drawImage(this.tileFor(level, tx, ty), sx, sy, TILE * scale + 0.5, TILE * scale + 0.5);
      }
    }
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const hp = this.hexPx;
    const fillHexes = (keys: Iterable<string>, style: string) => {
      g.fillStyle = style;
      g.beginPath();
      for (const k of keys) {
        const [q, r] = k.split(',').map(Number);
        const pts = hexCorners({ q, r }, this.map.def.orientation, this.spacing).map((p) => this.toScreen(p));
        pts.forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y)));
        g.closePath();
      }
      g.fill();
    };
    if (scene.zone) fillHexes(scene.zone, 'rgba(60,140,230,0.28)');
    if (scene.viewshed) fillHexes(scene.viewshed, 'rgba(255,150,40,0.22)');
    if (scene.reach) {
      const tac: string[] = [];
      const dash: string[] = [];
      for (const [k, n] of scene.reach) if (n.canStop) (n.band === 'tactical' ? tac : dash).push(k);
      fillHexes(tac, 'rgba(55,60,70,0.42)');
      fillHexes(dash, 'rgba(30,160,60,0.38)');
    }
    if (scene.targets) fillHexes(scene.targets, 'rgba(220,40,40,0.09)');
    // map labels
    if (scene.labels) {
      for (const l of this.map.def.labels) {
        const p = this.toScreen(this.centre(l));
        if (p.x < -200 || p.y < -50 || p.x > this.w + 200 || p.y > this.h + 50) continue;
        const size = l.kind === 'village' ? Math.max(10, Math.min(18, hp * 0.24)) : Math.max(9, Math.min(14, hp * 0.18));
        g.font = `${l.kind === 'water' ? 'italic ' : ''}${l.kind === 'village' ? 800 : 600} ${size}px system-ui, sans-serif`;
        g.textAlign = 'center';
        g.lineWidth = 3;
        g.strokeStyle = 'rgba(255,255,255,0.85)';
        g.fillStyle = l.kind === 'water' ? '#1f5ea8' : l.kind === 'height' ? '#5a3c18' : '#1b1b1b';
        g.strokeText(l.text, p.x, p.y - hp * 0.42);
        g.fillText(l.text, p.x, p.y - hp * 0.42);
      }
    }
    // objectives (VIC-01 flags)
    for (const o of scene.objectives) this.flag(g, o, hp);
    // pending own artillery
    for (const pf of scene.pendingFires ?? []) {
      const p = this.toScreen(this.centre(pf.hex));
      g.strokeStyle = 'rgba(200,30,30,0.9)';
      g.setLineDash([4, 3]);
      g.lineWidth = 2;
      g.beginPath();
      g.arc(p.x, p.y, hp * 0.75, 0, Math.PI * 2);
      g.stroke();
      g.setLineDash([]);
      g.fillStyle = '#b01e1e';
      g.font = `700 ${Math.max(9, hp * 0.16)}px system-ui`;
      g.fillText(`T${pf.impactTurn}`, p.x, p.y + hp * 0.75 + 10);
    }
    // move path preview
    if (scene.path && scene.path.length > 1) {
      g.strokeStyle = 'rgba(255,230,80,0.95)';
      g.lineWidth = Math.max(2, hp * 0.05);
      g.setLineDash([6, 4]);
      g.beginPath();
      scene.path.forEach((h, i) => {
        const p = this.toScreen(this.centre(h));
        if (i) g.lineTo(p.x, p.y);
        else g.moveTo(p.x, p.y);
      });
      g.stroke();
      g.setLineDash([]);
    }
    // ghosts (last-known enemy positions)
    for (const gh of scene.ghosts) this.counter(g, { typeId: gh.typeId, side: scene.viewer === 'blue' ? 'red' : 'blue' } as UnitView, gh.hex, 0, scene, { ghost: gh.turn });
    // units, stacked per hex
    const byHex = new Map<string, UnitView[]>();
    for (const u of scene.units) {
      if (!u.hex) continue;
      const k = hexKey(u.hex);
      byHex.set(k, [...(byHex.get(k) ?? []), u]);
    }
    for (const [, us] of byHex) {
      const sorted = [...us].sort((a, b) => Number(a.id === scene.selectedId) - Number(b.id === scene.selectedId));
      sorted.forEach((u, i) => this.counter(g, u, u.hex!, i - (sorted.length - 1) / 2, scene, {}));
    }
    if (scene.attackable) {
      for (const k of scene.attackable) {
        const [q, r] = k.split(',').map(Number);
        const p = this.toScreen(this.centre({ q, r }));
        g.strokeStyle = 'rgba(230,40,40,0.95)';
        g.lineWidth = 2.5;
        g.beginPath();
        g.arc(p.x, p.y, hp * 0.47, 0, Math.PI * 2);
        g.stroke();
      }
    }
    if (scene.hover) {
      const pts = hexCorners(scene.hover, this.map.def.orientation, this.spacing).map((p) => this.toScreen(p));
      g.strokeStyle = '#ffe14d';
      g.lineWidth = 2;
      g.beginPath();
      pts.forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y)));
      g.closePath();
      g.stroke();
    }
    // effects
    let animating = false;
    for (const e of scene.effects ?? []) {
      const age = (now - e.t0) / 1000;
      if (age > 1.4) continue;
      animating = true;
      const to = this.toScreen(this.centre(e.to));
      if (e.kind === 'tracer' && e.from) {
        const from = this.toScreen(this.centre(e.from));
        g.strokeStyle = `rgba(255,${e.side === 'blue' ? 220 : 120},80,${Math.max(0, 1 - age / 0.9).toFixed(2)})`;
        g.lineWidth = 2;
        g.beginPath();
        g.moveTo(from.x, from.y);
        g.lineTo(to.x, to.y);
        g.stroke();
      }
      if (e.kind === 'impact' || e.kind === 'miss') {
        const rad = hp * (0.2 + age * 0.6);
        g.fillStyle = `rgba(255,${e.kind === 'impact' ? 120 : 200},40,${Math.max(0, 0.7 - age / 1.6).toFixed(2)})`;
        g.beginPath();
        g.arc(to.x, to.y, rad, 0, Math.PI * 2);
        g.fill();
        g.strokeStyle = `rgba(80,60,40,${Math.max(0, 0.6 - age / 2).toFixed(2)})`;
        g.lineWidth = 2;
        g.stroke();
      }
    }
    return animating;
  }

  private flag(g: CanvasRenderingContext2D, o: ObjectiveView, hp: number): void {
    const p = this.toScreen(this.centre(o.hex));
    const s = Math.max(10, Math.min(28, hp * 0.32));
    const col = o.owner === 'blue' ? SIDE_COLORS.blue.edge : o.owner === 'red' ? SIDE_COLORS.red.edge : '#666';
    const x = p.x + hp * 0.22;
    const y = p.y - hp * 0.12;
    g.strokeStyle = '#222';
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(x, y + s * 0.9);
    g.lineTo(x, y - s);
    g.stroke();
    g.fillStyle = col;
    g.beginPath();
    g.moveTo(x, y - s);
    g.lineTo(x + s * 1.1, y - s * 0.6);
    g.lineTo(x, y - s * 0.2);
    g.closePath();
    g.fill();
    g.strokeStyle = '#fff';
    g.lineWidth = 1;
    g.stroke();
    g.font = `800 ${Math.max(9, s * 0.55)}px system-ui`;
    g.fillStyle = '#fff';
    g.textAlign = 'center';
    g.fillText(String(o.value), x + s * 0.42, y - s * 0.47);
    if (hp > 28) {
      g.font = `700 ${Math.max(9, Math.min(13, hp * 0.15))}px system-ui`;
      g.lineWidth = 3;
      g.strokeStyle = 'rgba(255,255,255,0.9)';
      g.fillStyle = '#111';
      g.strokeText(o.name, p.x, p.y + hp * 0.5);
      g.fillText(o.name, p.x, p.y + hp * 0.5);
    }
  }

  /** UNIT-01 counter: APP-6 symbol, strength pips, status letter; simplified at small zoom. */
  private counter(g: CanvasRenderingContext2D, u: UnitView, h: Hex, slot: number, scene: Scene, o: { ghost?: number }): void {
    const t = this.data.units.get(u.typeId);
    if (!t) return;
    const hp = this.hexPx;
    const size = Math.max(14, Math.min(58, hp * 0.6));
    const c = this.toScreen(this.centre(h));
    const x = c.x + slot * size * 0.18;
    const y = c.y + slot * size * 0.14;
    if (x < -size || y < -size || x > this.w + size || y > this.h + size) return;
    const col = SIDE_COLORS[u.side];
    const selected = u.id === scene.selectedId;
    g.save();
    if (o.ghost !== undefined) g.globalAlpha = 0.45;
    const air = t.isAir;
    // plate
    g.beginPath();
    const rr = size * 0.14;
    const bx = x - size / 2;
    const by = y - size / 2;
    g.roundRect(bx, by, size, size, rr);
    g.fillStyle = o.ghost !== undefined ? 'rgba(255,255,255,0.35)' : air ? 'rgba(255,255,255,0.88)' : '#f4f1e8';
    g.fill();
    g.lineWidth = selected ? 3 : 1.5;
    g.strokeStyle = selected ? '#ffd400' : col.edge;
    if (o.ghost !== undefined) g.setLineDash([3, 3]);
    g.stroke();
    g.setLineDash([]);
    if (size >= 22) {
      const sym = symbolCanvas(sidcFor(t.symbol, u.side, scene.viewer), size * 0.42);
      const sw = sym.width / this.dpr;
      const sh = sym.height / this.dpr;
      const fit = Math.min((size * 0.82) / sw, (size * 0.62) / sh, 1);
      g.drawImage(sym, x - (sw * fit) / 2, by + size * 0.08, sw * fit, sh * fit);
    } else {
      g.fillStyle = col.fill;
      g.fillRect(bx + 2, by + 2, size - 4, size * 0.55);
    }
    if (o.ghost !== undefined) {
      g.fillStyle = '#333';
      g.font = `700 ${Math.max(8, size * 0.24)}px system-ui`;
      g.textAlign = 'center';
      g.fillText(`T${o.ghost}`, x, by + size * 0.93);
      g.restore();
      return;
    }
    // strength pips
    const pipR = Math.max(1.6, size * 0.055);
    const total = u.maxSteps;
    for (let i = 0; i < total; i++) {
      const px = x + (i - (total - 1) / 2) * pipR * 2.7;
      const py = by + size * 0.86;
      g.beginPath();
      g.arc(px, py, pipR, 0, Math.PI * 2);
      g.fillStyle = i < u.steps ? col.edge : 'transparent';
      g.fill();
      g.strokeStyle = col.edge;
      g.lineWidth = 1;
      g.stroke();
    }
    // status letter (C / S) and posture
    const badge = Math.max(9, size * 0.3);
    g.fillStyle = u.status === 'S' ? '#d62f1f' : '#2f8a3a';
    g.beginPath();
    g.roundRect(bx + size - badge * 0.8, by - badge * 0.25, badge, badge, 3);
    g.fill();
    g.fillStyle = '#fff';
    g.font = `800 ${badge * 0.78}px system-ui`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(u.status, bx + size - badge * 0.3, by + badge * 0.26);
    const post = u.fired ? 'F' : u.posture === 'dashed' ? 'D' : u.posture === 'moved' ? 'M' : '';
    if (post && size >= 18) {
      g.fillStyle = '#263238';
      g.beginPath();
      g.roundRect(bx - badge * 0.2, by - badge * 0.25, badge, badge, 3);
      g.fill();
      g.fillStyle = '#fff';
      g.fillText(post, bx + badge * 0.3, by + badge * 0.26);
    }
    if (u.passengers?.length) {
      g.fillStyle = '#263238';
      g.beginPath();
      g.roundRect(bx + size - badge * 0.8, by + size - badge * 0.7, badge, badge, 3);
      g.fill();
      g.fillStyle = '#fff';
      g.fillText(`+${u.passengers.length}`, bx + size - badge * 0.3, by + size - badge * 0.2);
    }
    g.textBaseline = 'alphabetic';
    if (hp > 44 && size >= 30) {
      g.font = `600 ${Math.max(9, Math.min(12, size * 0.2))}px system-ui`;
      g.lineWidth = 3;
      g.strokeStyle = 'rgba(255,255,255,0.9)';
      g.fillStyle = col.text;
      const label = u.own ? u.name : t.name;
      g.strokeText(label, x, by + size + 11);
      g.fillText(label, x, by + size + 11);
    }
    g.restore();
  }

  /** Minimap image of the whole map. */
  overview(width: number): { canvas: HTMLCanvasElement; scale: number; bounds: MapRenderer['bounds'] } {
    const b = this.bounds;
    const scale = width / (b.maxX - b.minX);
    const c = document.createElement('canvas');
    c.width = Math.round(width);
    c.height = Math.round((b.maxY - b.minY) * scale);
    const g = c.getContext('2d')!;
    for (const h of this.map.list) {
      const pts = hexCorners(h, this.map.def.orientation, this.spacing).map((p) => ({ x: (p.x - b.minX) * scale, y: (p.y - b.minY) * scale }));
      g.beginPath();
      pts.forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y)));
      g.closePath();
      g.fillStyle = h.terrain.color;
      g.fill();
      const s = this.shade.get(hexKey(h)) ?? 0;
      g.fillStyle = s >= 0 ? `rgba(255,252,240,${Math.min(0.35, s * 1.4)})` : `rgba(30,25,15,${Math.min(0.45, -s * 1.6)})`;
      g.fill();
    }
    for (const e of this.map.allEdges()) {
      for (const f of e.features) {
        if (f.draw !== 'centerline' && !['canal', 'river'].includes(f.id)) continue;
        const [a, bb] = f.draw === 'centerline' ? [this.centre(e.a), this.centre(e.b)] : edgeSegment(e.a, directionTo(e.a, e.b), this.map.def.orientation, this.spacing);
        g.strokeStyle = f.color;
        g.lineWidth = f.draw === 'centerline' ? 1.2 : 2;
        g.beginPath();
        g.moveTo((a.x - b.minX) * scale, (a.y - b.minY) * scale);
        g.lineTo((bb.x - b.minX) * scale, (bb.y - b.minY) * scale);
        g.stroke();
      }
    }
    return { canvas: c, scale, bounds: b };
  }
}

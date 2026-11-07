// Generates the fictional sample maps in maps/ (deterministic). Real terrain comes from the GIS pipeline
// (MAP-05, Phase 3) and is loaded from data packs outside the repo (NFR-02).
//   npm run gen:maps
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  type GameMap,
  type Hex,
  type MapHex,
  directionTo,
  drawAt,
  hashString,
  hexKey,
  hexLine,
  hexNeighbors,
  hexToPoint,
  offsetToAxial,
} from '../packages/engine/src/index';

const OUT = fileURLToPath(new URL('../maps/', import.meta.url));

class Noise {
  private seed: number;
  constructor(seed: string) {
    this.seed = hashString(seed);
  }
  private v(ix: number, iy: number): number {
    return drawAt(this.seed, ((ix * 73856093) ^ (iy * 19349663)) >>> 0);
  }
  /** Smooth value noise in [0,1] at metre coordinates with the given feature size. */
  at(x: number, y: number, size: number): number {
    const fx = x / size;
    const fy = y / size;
    const ix = Math.floor(fx);
    const iy = Math.floor(fy);
    const tx = fx - ix;
    const ty = fy - iy;
    const s = (t: number) => t * t * (3 - 2 * t);
    const a = this.v(ix, iy);
    const b = this.v(ix + 1, iy);
    const c = this.v(ix, iy + 1);
    const d = this.v(ix + 1, iy + 1);
    return a + (b - a) * s(tx) + (c - a) * s(ty) + (a - b - c + d) * s(tx) * s(ty);
  }
  fbm(x: number, y: number, size: number): number {
    return (this.at(x, y, size) * 0.6 + this.at(x, y, size / 2) * 0.3 + this.at(x, y, size / 4) * 0.1) / 1.0;
  }
}

interface Builder {
  def: GameMap;
  cells: Map<string, MapHex>;
  pos: (h: Hex) => { x: number; y: number };
}

function builder(id: string, name: string, cols: number, rows: number, hexSize: number, origin: { easting: number; northing: number }): Builder {
  const cells = new Map<string, MapHex>();
  for (let c = 0; c < cols; c++) {
    for (let r = 0; r < rows; r++) {
      const h = offsetToAxial(c, r, 'flat');
      cells.set(hexKey(h), { q: h.q, r: h.r, elevation_m: 0, terrainId: 'open', edges: {} });
    }
  }
  const def: GameMap = { id, name, hexSize_m: hexSize, orientation: 'flat', width: cols, height: rows, hexes: [], gridRefOrigin: origin, labels: [], classification: 'UNCLASSIFIED — FICTIONAL SAMPLE' };
  return { def, cells, pos: (h) => hexToPoint(h, 'flat', hexSize) };
}

function addEdge(b: Builder, a: Hex, n: Hex, feature: string): void {
  const ca = b.cells.get(hexKey(a));
  if (!ca || !b.cells.has(hexKey(n))) return;
  const dir = directionTo(a, n);
  if (dir < 0) throw new Error('not adjacent');
  // store on the hex with the lower key so each edge is written once
  const [h, d] = hexKey(a) < hexKey(n) ? [ca, dir] : [b.cells.get(hexKey(n))!, (dir + 3) % 6];
  const list = (h.edges[String(d)] ??= []);
  if (!list.includes(feature)) list.push(feature);
}

/** Edge features along a line that divides the map: every edge whose two hexes lie on opposite sides. */
function edgeLine(b: Builder, side: (p: { x: number; y: number }) => number, feature: string, keep: (a: Hex, n: Hex) => boolean = () => true): [Hex, Hex][] {
  const out: [Hex, Hex][] = [];
  for (const c of b.cells.values()) {
    for (const n of hexNeighbors(c)) {
      if (!b.cells.has(hexKey(n)) || hexKey(c) > hexKey(n)) continue;
      if (Math.sign(side(b.pos(c))) !== Math.sign(side(b.pos(n))) && keep(c, n)) {
        addEdge(b, c, n, feature);
        out.push([c, n]);
      }
    }
  }
  return out;
}

/** A road / track through a sequence of waypoint hexes: the feature is put on every edge it crosses. */
function road(b: Builder, waypoints: Hex[], feature: string): Hex[] {
  const path: Hex[] = [];
  for (let i = 0; i + 1 < waypoints.length; i++) {
    const seg = hexLine(waypoints[i], waypoints[i + 1]);
    for (const h of i === 0 ? seg : seg.slice(1)) path.push(h);
  }
  for (let i = 0; i + 1 < path.length; i++) addEdge(b, path[i], path[i + 1], feature);
  return path;
}

function finish(b: Builder): GameMap {
  b.def.hexes = [...b.cells.values()].map((h) => ({ ...h, elevation_m: Math.round(h.elevation_m * 10) / 10 }));
  return b.def;
}

const at = (col: number, row: number) => offsetToAxial(col, row, 'flat');

// ---------------------------------------------------------------- "Ridgeline" — the Phase 1 sample sector
function ridgeline(): GameMap {
  const COLS = 44;
  const ROWS = 32;
  const b = builder('ridgeline', 'Ridgeline sector (fictional)', COLS, ROWS, 100, { easting: 431000, northing: 3524000 });
  const n = new Noise('ridgeline');
  const W = 1.5 * (100 / Math.sqrt(3)) * (COLS - 1);
  // ridge crest line (metres from the top), Pt 241 in the west, a saddle where the main road crosses
  const crestY = (x: number) => 900 + 120 * Math.sin(x / 700) + 60 * Math.sin(x / 260);
  const ridgeH = (x: number) => {
    const pt241 = 38 * Math.exp(-(((x - 1250) / 520) ** 2));
    const east = 30 * Math.exp(-(((x - 2900) / 650) ** 2));
    const saddle = -10 * Math.exp(-(((x - 1950) / 220) ** 2));
    return Math.max(8, pt241 + east + 12 + saddle);
  };
  const canalY = (x: number) => 1880 + 70 * Math.sin(x / 900 + 0.6);
  const nullahX = (y: number) => 3100 - 0.35 * (y - 1100) + 60 * Math.sin(y / 300);
  for (const c of b.cells.values()) {
    const p = b.pos(c);
    let e = 200 + 3 * n.fbm(p.x, p.y, 900);
    const dy = p.y - crestY(p.x);
    const w = dy < 0 ? 380 : 700; // steeper reverse (north) slope, long gentle forward (south) slope
    const t = Math.max(0, 1 - (dy / w) ** 2);
    e += ridgeH(p.x) * t * t * (3 - 2 * t);
    // low ground along the canal, dip of the nullah
    e -= 2.5 * Math.exp(-(((p.y - canalY(p.x)) / 160) ** 2));
    if (p.y > 1100 && p.y < 1900) e -= 3 * Math.exp(-(((p.x - nullahX(p.y)) / 90) ** 2));
    c.elevation_m = e;
    // terrain cover
    const fields = n.at(p.x + 5000, p.y, 260);
    const wood = n.fbm(p.x + 9000, p.y + 3000, 420);
    let terrain = fields > 0.42 ? 'crops' : 'open';
    if (t > 0.35 && t < 0.92 && fields > 0.55) terrain = 'scrub';
    if (t > 0.9 && n.at(p.x, p.y + 777, 180) > 0.6) terrain = 'rocky';
    if (wood > 0.66) terrain = 'woods';
    else if (wood > 0.6 && p.y > 1000) terrain = 'orchard';
    if (Math.abs(p.y - canalY(p.x)) < 140 && p.x > 2700 && p.x < 3500 && n.at(p.x, p.y, 200) > 0.35) terrain = 'marsh';
    c.terrainId = terrain;
  }
  // Kotli Sharif village behind (north of) the ridge around the main road
  const village = at(23, 4);
  const vc = b.pos(village);
  for (const c of b.cells.values()) {
    const p = b.pos(c);
    const d = Math.hypot(p.x - vc.x, (p.y - vc.y) * 1.2);
    if (d < 170) c.terrainId = 'built_up';
    else if (d < 330 && n.at(p.x, p.y, 120) > 0.2) c.terrainId = 'village';
    else if (d < 470 && n.at(p.x + 300, p.y, 150) > 0.55) c.terrainId = 'orchard';
  }
  // Dhok Haji hamlet on the near side of the canal and Bela farm on the east
  for (const [hc, rad] of [
    [at(9, 25), 130],
    [at(36, 14), 120],
  ] as const) {
    const pc = b.pos(hc);
    for (const c of b.cells.values()) {
      const p = b.pos(c);
      if (Math.hypot(p.x - pc.x, p.y - pc.y) < rad) c.terrainId = 'village';
    }
  }
  // Canal (with banks) across the sector, south of the ridge; two bridges
  edgeLine(b, (p) => p.y - canalY(p.x), 'canal');
  edgeLine(b, (p) => p.y - canalY(p.x), 'bund', (a) => {
    const p = b.pos(a);
    return p.x < 1400 || p.x > 2600; // banks raised only away from the bridges
  });
  // dry nullah from the ridge down to the canal on the east
  edgeLine(b, (p) => p.x - nullahX(p.y), 'nullah', (a) => {
    const p = b.pos(a);
    return p.y > 1150 && p.y < canalY(p.x) - 40;
  });
  // ridgeline crest (LOS crest emphasis) along the top
  edgeLine(b, (p) => p.y - crestY(p.x), 'ridgeline', (a) => {
    const p = b.pos(a);
    return ridgeH(p.x) > 22;
  });
  // Main road N-S through the saddle and the village, metalled
  const main = road(b, [at(22, 31), at(22, 24), at(23, 18), at(22, 12), at(23, 7), at(23, 0)], 'road');
  // Track from the SW (Dhok Haji) to the ridge at Pt 241, and an E-W track behind the ridge
  const track1 = road(b, [at(2, 29), at(9, 25), at(12, 19), at(14, 14), at(14, 9)], 'track');
  road(b, [at(0, 3), at(10, 5), at(23, 4), at(34, 6), at(43, 5)], 'track');
  road(b, [at(43, 26), at(36, 22), at(36, 14), at(33, 9)], 'track');
  // bridges where roads / tracks cross the canal
  for (const path of [main, track1]) {
    for (let i = 0; i + 1 < path.length; i++) {
      const pa = b.pos(path[i]);
      const pb = b.pos(path[i + 1]);
      if (Math.sign(pa.y - canalY(pa.x)) !== Math.sign(pb.y - canalY(pb.x))) addEdge(b, path[i], path[i + 1], 'bridge');
    }
  }
  // labels
  const lab = (h: Hex, text: string, kind: 'village' | 'feature' | 'height' | 'objective' | 'water') => b.def.labels.push({ q: h.q, r: h.r, text, kind });
  lab(village, 'KOTLI SHARIF', 'village');
  lab(at(9, 25), 'DHOK HAJI', 'village');
  lab(at(36, 14), 'BELA', 'village');
  let best: MapHex | undefined;
  for (const c of b.cells.values()) if (!best || c.elevation_m > best.elevation_m) best = c;
  lab(best!, `Pt ${Math.round(best!.elevation_m)}`, 'height');
  lab(at(30, 20), 'Lower Jhelum Canal', 'water');
  lab(at(33, 16), 'Dry nullah', 'feature');
  void W;
  return finish(b);
}

// ---------------------------------------------------------------- 100 × 100 performance map (MAP-07 / NFR-06)
function perf100(): GameMap {
  const b = builder('perf100', 'Performance test 100 × 100 (fictional)', 100, 100, 100, { easting: 400000, northing: 3500000 });
  const n = new Noise('perf100');
  const types = ['open', 'crops', 'scrub', 'orchard', 'woods', 'village', 'rocky', 'marsh', 'dunes'];
  for (const c of b.cells.values()) {
    const p = b.pos(c);
    c.elevation_m = 150 + 60 * n.fbm(p.x, p.y, 2500);
    c.terrainId = types[Math.floor(n.at(p.x, p.y, 500) * types.length) % types.length];
  }
  road(b, [at(0, 50), at(50, 45), at(99, 55)], 'road');
  road(b, [at(50, 0), at(45, 50), at(55, 99)], 'track');
  edgeLine(b, (p) => p.y - (3000 + 400 * Math.sin(p.x / 1500)), 'canal');
  return finish(b);
}

for (const m of [ridgeline(), perf100()]) {
  writeFileSync(`${OUT}${m.id}.json`, JSON.stringify(m));
  const counts: Record<string, number> = {};
  for (const h of m.hexes) counts[h.terrainId] = (counts[h.terrainId] ?? 0) + 1;
  const elev = m.hexes.map((h) => h.elevation_m);
  console.log(`${m.id}: ${m.width}x${m.height} hexes, elevation ${Math.min(...elev)}–${Math.max(...elev)} m`, counts, `${m.labels.length} labels`);
}

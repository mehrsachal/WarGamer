// Random scenario generator: procedural terrain (plains, canal, desert, semi-desert),
// orbat and narrative for minor (Pl/Coy) and major (Bn/Bde) defensive ops, with an
// automatically appreciated DS solution so every scenario can be objectively assessed.

import { type Vec, centroid, dist, ellipsePoly, polylineIntersection, smooth } from '../core/geom';
import { Rng, newSeed } from '../core/rng';
import { dDay } from '../core/time';
import type {
  EnemyForceItem,
  Feature,
  LinearFeature,
  OpsLevel,
  ResourceItem,
  Scenario,
  TerrainData,
  TerrainType,
} from '../core/types';
import { analyseTerrain } from '../terrain/analysis';
import { TerrainModel } from '../terrain/terrain';
import { COMDR_NAMES, foxName, unitNames, villageName } from './names';

export interface GenOptions {
  level: OpsLevel;
  terrain: TerrainType;
  seed?: number;
  enemyStrength?: 'NORMAL' | 'STRONG';
  attackAtNight?: boolean;
  weather?: 'AUTO' | 'clear' | 'rain' | 'fog' | 'haze' | 'dust';
  qc?: boolean;
  ucav?: boolean;
  title?: string;
}

interface LevelCfg {
  W: number;
  H: number;
  cell: number;
  gridSq: number;
  aorW: number;
  aorDepth: number;
  villages: number;
  heights: number;
  k: number;
}

const LEVELS: Record<OpsLevel, LevelCfg> = {
  PL: { W: 3000, H: 5000, cell: 20, gridSq: 500, aorW: 1000, aorDepth: 3000, villages: 7, heights: 6, k: 0.6 },
  COY: { W: 4500, H: 9500, cell: 25, gridSq: 500, aorW: 2500, aorDepth: 6500, villages: 15, heights: 10, k: 1 },
  BN: { W: 10000, H: 16000, cell: 50, gridSq: 1000, aorW: 5500, aorDepth: 10500, villages: 26, heights: 16, k: 2 },
  BDE: { W: 20000, H: 28000, cell: 100, gridSq: 1000, aorW: 12000, aorDepth: 19000, villages: 40, heights: 24, k: 3.5 },
};

export const LEVEL_NAMES: Record<OpsLevel, string> = {
  PL: 'Pl Def (Minor Tactics)',
  COY: 'Coy Def (Minor Tactics)',
  BN: 'Bn Def (Major Ops)',
  BDE: 'Bde Def (Major Ops)',
};

export const TERRAIN_NAMES: Record<TerrainType, string> = {
  PLAINS: 'Plains (Punjab)',
  CANAL: 'Canal / DCB obstacle',
  DESERT: 'Desert',
  SEMI_DESERT: 'Semi-desert',
};

export function generateScenario(opts: GenOptions): Scenario {
  const seed = opts.seed ?? newSeed();
  const rng = new Rng(seed);
  const cfg = LEVELS[opts.level];
  const { W, H, k } = cfg;
  const type = opts.terrain;
  const feats: Feature[] = [];
  let fid = 0;
  const id = () => `g${seed.toString(36)}_${++fid}`;
  const usedNames = new Set<string>();

  // ------------------------------------------------------------------ border
  const borderY = H * 0.86;
  const border: Vec[] = [];
  for (let x = 0; x <= W; x += W / 8) border.push({ x, y: borderY + rng.range(-40, 40) * k });
  feats.push({ id: id(), kind: 'border', name: 'Interstate Bdry', pts: border });

  // ------------------------------------------------------------------ AOR
  const aorCx = W / 2 + rng.range(-0.06, 0.06) * W;
  const ax0 = Math.max(W * 0.08, aorCx - cfg.aorW / 2);
  const ax1 = Math.min(W * 0.92, aorCx + cfg.aorW / 2);
  const ay1 = borderY;
  const ay0 = Math.max(H * 0.05, borderY - cfg.aorDepth);
  const aor: Vec[] = [{ x: ax0, y: ay0 }, { x: ax1, y: ay0 }, { x: ax1, y: ay1 }, { x: ax0, y: ay1 }];

  // ------------------------------------------------------------------ villages
  const nVill = Math.round(cfg.villages * (type === 'DESERT' ? 0.45 : type === 'SEMI_DESERT' ? 0.7 : 1));
  const minSep = Math.sqrt((W * H) / nVill) * 0.62;
  const villages: { name: string; c: Vec; fox: boolean }[] = [];
  for (let tries = 0; villages.length < nVill && tries < nVill * 60; tries++) {
    const c = { x: rng.range(0.04, 0.96) * W, y: rng.range(0.03, 0.97) * H };
    if (Math.abs(c.y - borderY) < 250 * k) continue;
    if (villages.some((v) => dist(v.c, c) < minSep)) continue;
    const fox = c.y > borderY;
    const name = fox ? foxName(rng, usedNames) : villageName(rng, usedNames);
    villages.push({ name, c, fox });
    const big = rng.chance(0.25);
    const bw = rng.range(160, big ? 420 : 260) * (k > 1.5 ? 1.4 : 1);
    const bh = rng.range(120, big ? 280 : 180) * (k > 1.5 ? 1.3 : 1);
    const storeys = big && rng.chance(0.5) ? 2 : 1;
    feats.push({ id: id(), kind: 'bua', name, storeys, poly: rectAround(c, bw, bh) });
    if (rng.chance(big ? 0.9 : 0.5)) {
      const off = { x: c.x + (rng.chance(0.5) ? 1 : -1) * bw * rng.range(0.9, 1.2), y: c.y + rng.range(-0.4, 0.4) * bh };
      feats.push({ id: id(), kind: 'bua', storeys, poly: rectAround(off, bw * rng.range(0.6, 1), bh * rng.range(0.6, 1)) });
    }
    if (!fox && rng.chance(0.25)) feats.push({ id: id(), kind: 'graveyard', name: 'Grave yard', pos: { x: c.x + rng.range(-300, 300) * k, y: c.y - rng.range(200, 400) * k } });
  }

  // ------------------------------------------------------------------ roads
  const roads: LinearFeature[] = [];
  const nMain = type === 'DESERT' ? 1 : rng.chance(0.6) ? 2 : 1;
  for (let r = 0; r < nMain; r++) {
    const x0 = W * (nMain === 1 ? rng.range(0.3, 0.7) : r === 0 ? rng.range(0.15, 0.4) : rng.range(0.6, 0.85));
    const x1 = x0 + rng.range(-0.15, 0.15) * W;
    const way: Vec[] = [{ x: x0, y: H }];
    const along = villages.filter((v) => Math.abs(v.c.x - (x0 + (x1 - x0) * (1 - v.c.y / H))) < W * 0.12).sort((a, b) => b.c.y - a.c.y);
    for (const v of along) way.push({ x: v.c.x, y: v.c.y });
    way.push({ x: x1, y: 0 });
    const pts = smooth(way, 2);
    const names = along.map((v) => titleCase(v.name));
    const f: LinearFeature = { id: id(), kind: 'road', name: names.length > 1 ? `Rd ${names.slice(0, 4).join(' - ')}` : 'Main Rd', cls: type === 'DESERT' ? 'Cl 9 A 1' : rng.chance(0.6) ? 'Cl 30 A 1' : 'Cl 9 A 1', pts };
    roads.push(f);
    feats.push(f);
  }
  if (type !== 'DESERT') {
    const ly = rng.range(0.3, 0.6) * borderY;
    const way: Vec[] = [{ x: 0, y: ly }];
    const along = villages.filter((v) => !v.fox && Math.abs(v.c.y - ly) < H * 0.08).sort((a, b) => a.c.x - b.c.x);
    for (const v of along) way.push(v.c);
    way.push({ x: W, y: ly + rng.range(-0.05, 0.05) * H });
    const names = along.map((v) => titleCase(v.name));
    const f: LinearFeature = { id: id(), kind: 'road', name: names.length > 1 ? `Rd ${names.slice(0, 4).join(' - ')}` : 'Lateral Rd', cls: 'Cl 9 A 1', pts: smooth(way, 2) };
    roads.push(f);
    feats.push(f);
  }
  // tracks: connect each village to nearest 2 neighbours
  const linked = new Set<string>();
  for (const v of villages) {
    const near = villages.filter((o) => o !== v).sort((a, b) => dist(a.c, v.c) - dist(b.c, v.c)).slice(0, 2);
    for (const o of near) {
      const key = [v.name, o.name].sort().join('|');
      if (linked.has(key)) continue;
      if (v.fox !== o.fox && rng.chance(0.6)) continue;
      linked.add(key);
      const mid = { x: (v.c.x + o.c.x) / 2 + rng.range(-120, 120) * k, y: (v.c.y + o.c.y) / 2 + rng.range(-120, 120) * k };
      feats.push({ id: id(), kind: 'track', cls: 'Cl 9 F 1', pts: smooth([v.c, mid, o.c], 2) });
    }
  }

  // ------------------------------------------------------------------ water obstacles
  const waters: LinearFeature[] = [];
  const wavy = (y: number, amp: number): Vec[] => {
    const pts: Vec[] = [];
    for (let x = 0; x <= W + 1; x += W / 10) pts.push({ x, y: y + rng.range(-amp, amp) });
    return smooth(pts, 2);
  };
  if (type === 'CANAL') {
    const cy = ay1 - cfg.aorDepth * rng.range(0.32, 0.45);
    const canal: LinearFeature = { id: id(), kind: 'canal', name: rng.pick(['BRB Link Canal', 'Upper Chenab Canal', 'Sukh Beas Link', 'Lower Bari Doab Canal']), width: 45, pts: wavy(cy, 60 * k) };
    waters.push(canal);
    feats.push(canal);
    feats.push({ id: id(), kind: 'bund', name: 'Home Bank Bund', pts: canal.pts.map((p) => ({ x: p.x, y: p.y - 45 })) });
    feats.push({ id: id(), kind: 'bund', name: 'Far Bank Bund', pts: canal.pts.map((p) => ({ x: p.x, y: p.y + 45 })) });
  }
  if (type === 'PLAINS' || type === 'SEMI_DESERT' || type === 'CANAL') {
    const ny = ay1 - cfg.aorDepth * rng.range(type === 'CANAL' ? 0.15 : 0.32, type === 'CANAL' ? 0.25 : 0.48);
    const nullah: LinearFeature = { id: id(), kind: 'nullah', name: 'Dry Nullah', width: 22, pts: wavy(ny, 80 * k) };
    waters.push(nullah);
    feats.push(nullah);
  }
  if (type === 'PLAINS' || type === 'CANAL') {
    const dy = ay1 - cfg.aorDepth * rng.range(0.62, 0.8);
    const disty: LinearFeature = { id: id(), kind: 'disty', name: `Disty No ${rng.int(2, 9)}`, width: 10, pts: wavy(dy, 40 * k) };
    waters.push(disty);
    feats.push(disty);
  }
  // bridges where roads cross water
  let br = 0;
  for (const w of waters) {
    for (const r of roads) {
      const x = polylineIntersection(r.pts, w.pts);
      if (x) feats.push({ id: id(), kind: 'bridge', name: `Br ${++br}`, pos: x, rot: 90 });
    }
  }

  // ------------------------------------------------------------------ relative heights
  const nH = Math.round(cfg.heights * (type === 'DESERT' ? 1.5 : 1));
  const hNames = new Set<string>();
  for (let tries = 0, made = 0; made < nH && tries < nH * 40; tries++) {
    const c = { x: rng.range(0.05, 0.95) * W, y: rng.range(0.04, 0.95) * H };
    if (feats.some((f) => f.kind === 'bua' && dist(centroid(f.poly), c) < 300 * Math.max(1, k * 0.6))) continue;
    if (feats.some((f) => f.kind === 'height' && dist(f.c, c) < 700 * k)) continue;
    if (waters.some((w) => w.pts.some((p) => dist(p, c) < 150 * k))) continue;
    let h = type === 'DESERT' ? rng.int(8, 30) : type === 'SEMI_DESERT' ? rng.int(5, 22) : rng.int(4, 20);
    let name = `${h} r`;
    if (hNames.has(name)) {
      h += 1;
      name = `${h} r`;
    }
    if (hNames.has(name)) continue;
    hNames.add(name);
    const raised = type !== 'DESERT' && made === 2;
    feats.push({ id: id(), kind: 'height', name: raised ? 'Raised Gr' : name, c, rx: rng.range(160, 330) * Math.max(1, k * 0.7), ry: rng.range(45, 90) * Math.max(1, k * 0.7), rot: rng.range(-15, 15), h: raised ? 6 : h });
    made++;
  }

  // ------------------------------------------------------------------ vegetation, broken gr, bunds, dunes
  let clump = 0;
  const nTrees = Math.round((type === 'DESERT' ? 3 : 9) * Math.max(1, k * 0.8));
  for (let i = 0; i < nTrees; i++) {
    const c = { x: rng.range(0.05, 0.95) * W, y: rng.range(0.05, 0.95) * H };
    if (feats.some((f) => f.kind === 'bua' && dist(centroid(f.poly), c) < 200)) continue;
    const named = rng.chance(0.55);
    feats.push({ id: id(), kind: 'trees', name: named ? `Clump ${++clump}` : undefined, poly: ellipsePoly(c, rng.range(80, 180) * Math.max(1, k * 0.6), rng.range(70, 160) * Math.max(1, k * 0.6), rng.range(0, 90), 12) });
  }
  if (type !== 'DESERT') {
    for (let i = 0; i < Math.round(2 * Math.max(1, k * 0.6)); i++) {
      const c = { x: rng.range(0.1, 0.9) * W, y: rng.range(0.15, 0.85) * H };
      feats.push({ id: id(), kind: 'grass', name: 'Tall Grass', poly: ellipsePoly(c, rng.range(150, 350) * k, rng.range(100, 220) * k, rng.range(0, 90), 12) });
    }
  }
  for (let i = 0; i < Math.round((type === 'DESERT' ? 1 : 2) * Math.max(1, k * 0.6)); i++) {
    const c = { x: rng.range(0.1, 0.9) * W, y: rng.range(0.1, 0.9) * H };
    feats.push({ id: id(), kind: 'broken', name: 'Broken Gr', poly: ellipsePoly(c, rng.range(150, 300) * k, rng.range(120, 220) * k, rng.range(0, 90), 10) });
  }
  if (type === 'CANAL' && rng.chance(0.5)) {
    const c = { x: rng.range(0.15, 0.85) * W, y: rng.range(0.15, 0.6) * H };
    feats.push({ id: id(), kind: 'marsh', name: 'Marshy Area', poly: ellipsePoly(c, rng.range(200, 400) * k, rng.range(150, 300) * k, 0, 12) });
  }
  const nKb = rng.int(1, 3);
  for (let i = 0; i < nKb; i++) {
    const c = { x: rng.range(0.15, 0.85) * W, y: rng.range(0.2, 0.82) * H };
    feats.push({ id: id(), kind: 'kbund', name: `Kidney Bund ${i + 1}`, c, r: rng.range(150, 220) * Math.max(1, k * 0.6), rot: 180 });
  }
  const nDunes = type === 'DESERT' ? Math.round(10 * k) : type === 'SEMI_DESERT' ? Math.round(5 * k) : Math.round(3 * k);
  for (let i = 0; i < nDunes; i++) {
    const c = { x: rng.range(0.05, 0.95) * W, y: rng.range(0.05, 0.95) * H };
    feats.push({ id: id(), kind: 'dunes', name: type === 'DESERT' && rng.chance(0.3) ? 'Sand Dunes' : undefined, poly: ellipsePoly(c, rng.range(150, 400) * Math.max(1, k * 0.6), rng.range(40, 110) * Math.max(1, k * 0.6), rng.range(-20, 20), 10) });
  }

  // ------------------------------------------------------------------ BOPs on the border where roads cross
  let bopNo = rng.int(1, 6) * 10;
  for (const r of roads) {
    const x = polylineIntersection(r.pts, border);
    if (!x) continue;
    bopNo++;
    feats.push({ id: id(), kind: 'bop', name: `BOP ${bopNo}`, pos: { x: x.x - 80, y: x.y - 60 }, side: 'BLUE' });
    feats.push({ id: id(), kind: 'bop', name: `BOP ${bopNo + 20}`, pos: { x: x.x + 80, y: x.y + 80 }, side: 'RED' });
  }

  const terrain: TerrainData = { width: W, height: H, cell: cfg.cell, gridSq: cfg.gridSq, gridOrigin: { e: rng.int(10, 60), n: rng.int(20, 60) }, features: feats, type };

  // ------------------------------------------------------------------ weather & time
  const wx = opts.weather && opts.weather !== 'AUTO' ? opts.weather : rng.weighted(['clear', 'haze', 'rain', 'fog', 'dust'] as const, [60, 15, 10, 10, 5]);
  const weather: Scenario['weather'] = {
    cond: wx,
    going: wx === 'rain' ? 'wet' : 'dry',
    temp: wx === 'rain' ? '18-24 °C' : type === 'DESERT' ? '32-44 °C' : '24-35 °C',
    wind: rng.pick(['Lt, NW', 'Calm', 'Mod, W', 'Lt, NE']),
    vis: wx === 'fog' ? 0.45 : wx === 'haze' || wx === 'dust' ? 0.75 : wx === 'rain' ? 0.7 : 1,
  };
  const light = { firstLight: rng.int(320, 380), lastLight: rng.int(1080, 1160), moon: rng.pick(['none', 'quarter', 'half', 'full'] as const) };
  const night = opts.attackAtNight ?? rng.chance(0.75);
  const hHour = night ? dDay(0, rng.pick([2030, 2100, 2130, 2200, 2300])) : dDay(0, rng.pick([1300, 1400, 1500]));
  const times: Scenario['times'] = {
    now: dDay(-rng.int(2, 3), rng.pick([900, 1000, 1100, 1200])),
    defReady: dDay(0, Math.floor(light.firstLight / 60) * 100 + (light.firstLight % 60)),
    enCrossBorder: dDay(0, Math.floor(light.firstLight / 60) * 100 + (light.firstLight % 60)),
    hHour,
    end: hHour + 6 * 60,
    light,
  };

  // ------------------------------------------------------------------ orbat
  const u = unitNames(rng);
  const qc = opts.qc ?? true;
  const ucav = opts.ucav ?? true;
  const strong = opts.enemyStrength === 'STRONG';
  const res = resourcesFor(opts.level, qc);
  const enemy = enemyFor(opts.level, strong);

  // ------------------------------------------------------------------ DS appreciation
  const tm = new TerrainModel(terrain, { wet: weather.going === 'wet' });
  const foxVill = villages.filter((v) => v.fox);
  const entries = (foxVill.length ? foxVill.map((v) => v.c) : [{ x: W * 0.3, y: H - 50 }, { x: W * 0.7, y: H - 50 }]).filter((p) => p.x > ax0 - 1500 * k && p.x < ax1 + 1500 * k);
  const entryPts = entries.length >= 2 ? entries : [{ x: ax0 + (ax1 - ax0) * 0.25, y: H - 60 }, { x: (ax0 + ax1) / 2, y: H - 60 }, { x: ax0 + (ax1 - ax0) * 0.75, y: H - 60 }];
  const ds = analyseTerrain(tm, aor, entryPts, opts.level);

  // ------------------------------------------------------------------ narrative
  const ownVill = villages.filter((v) => !v.fox);
  const leftAnchor = nearestVillage(ownVill, { x: ax0, y: (ay0 + ay1) / 2 })?.name ?? 'Lt bdry';
  const rightAnchor = nearestVillage(ownVill, { x: ax1, y: (ay0 + ay1) / 2 })?.name ?? 'Rt bdry';
  const foxTown = foxVill.length ? titleCase(rng.pick(foxVill).name) : 'Gandhi Nagar';
  const objTown = titleCase(villageName(rng, usedNames));
  const comd = rng.pick(COMDR_NAMES);
  const scenario: Scenario = {
    id: `gen_${seed.toString(36)}`,
    title: opts.title ?? `${LEVEL_NAMES[opts.level].split(' (')[0]} — ${TERRAIN_NAMES[type]} #${(seed % 9000) + 1000}`,
    subtitle: `${ownFormation(opts.level, u)} — generated scenario (seed ${seed})`,
    level: opts.level,
    source: 'generated',
    seed,
    createdAt: Date.now(),
    terrain,
    narrative: [],
    requirements: requirementsFor(opts.level),
    own: {
      formation: ownFormation(opts.level, u),
      higher: higherFormation(opts.level, u),
      aor,
      boundaries: [
        { pts: [{ x: ax0, y: 0 }, { x: ax0, y: ay1 }], label: boundaryLabel(opts.level, 'L', u), echelon: boundaryEchelon(opts.level) },
        { pts: [{ x: ax1, y: 0 }, { x: ax1, y: ay1 }], label: boundaryLabel(opts.level, 'R', u), echelon: boundaryEchelon(opts.level) },
      ],
      flanks: [
        { side: 'L', name: flankName(opts.level, 'L', u) },
        { side: 'R', name: flankName(opts.level, 'R', u) },
      ],
      resources: res,
      fire: {
        artyBatteries: opts.level === 'BDE' ? 9 : opts.level === 'BN' ? 3 : opts.level === 'COY' ? 3 : 1,
        artyCalibre: rng.pick(['105', '155'] as const),
        artyLabel: opts.level === 'BDE' ? `${u.fdRegt} Fd Regt (DS), Div Arty in sp` : `${String.fromCharCode(80 + rng.int(0, 3))} Bty ${u.fdRegt} Fd Regt (DS)${opts.level !== 'PL' ? ` + ${u.fdRegt} Fd Regt (in sp)` : ''}`,
        mor81: opts.level !== 'PL',
        ucavSorties: ucav ? (opts.level === 'BDE' ? 3 : opts.level === 'BN' ? 2 : 1) : 0,
        mines: { apM: Math.round(600 * k), atM: Math.round(300 * k) },
        wireM: Math.round(800 * k),
      },
    },
    enemy: {
      name: `Foxland ${opts.level === 'BDE' ? 'Div (-)' : opts.level === 'BN' ? 'Bde Gp' : opts.level === 'COY' ? 'Bn Gp' : 'Coy Gp'}`,
      force: enemy,
      entry: entryPts,
      attackAtNight: night,
      ewThreat: rng.pick(['LOW', 'MED', 'HIGH'] as const),
      airThreat: rng.pick(['MED', 'HIGH'] as const),
      artyBatteries: opts.level === 'BDE' ? 6 : opts.level === 'BN' ? 3 : opts.level === 'COY' ? 2 : 1,
    },
    times,
    weather,
    ds,
  };
  scenario.narrative = buildNarrative(scenario, rng, { u, foxTown, objTown, leftAnchor: titleCase(leftAnchor), rightAnchor: titleCase(rightAnchor), comd, qc, ucav, tm });
  return scenario;
}

function rectAround(c: Vec, w: number, h: number): Vec[] {
  return [
    { x: c.x - w / 2, y: c.y - h / 2 },
    { x: c.x + w / 2, y: c.y - h / 2 },
    { x: c.x + w / 2, y: c.y + h / 2 },
    { x: c.x - w / 2, y: c.y + h / 2 },
  ];
}

function nearestVillage(vs: { name: string; c: Vec }[], p: Vec) {
  return vs.slice().sort((a, b) => dist(a.c, p) - dist(b.c, p))[0];
}

export function titleCase(s: string): string {
  return s.toLowerCase().replace(/(^|\s)\S/g, (m) => m.toUpperCase());
}

function resourcesFor(level: OpsLevel, qc: boolean): ResourceItem[] {
  switch (level) {
    case 'PL':
      return [
        { templateKey: 'RIFLE_SEC', count: 3, status: 'ORGANIC', note: 'Nos 1, 2 & 3 Secs' },
        { templateKey: 'PL_HQ', count: 1, status: 'ORGANIC', note: '2 x RL' },
        { templateKey: 'MG_DET', count: 1, status: 'ORGANIC', note: 'MG1A3 tripod' },
        { templateKey: 'RR_DET', count: 1, status: 'UC', note: 'ex Coy wpn sec' },
        { templateKey: 'LP', count: 1, status: 'ORGANIC', note: 'Found from depth sec' },
        ...(qc ? [{ templateKey: 'QC_DET', count: 1, status: 'UC' as const, note: '1 x surv QC, 1 x A/QC' }] : []),
        { templateKey: 'MOR_OBS', count: 1, status: 'IN_SP' as const, note: 'Coy 60mm / Bn mor' },
      ];
    case 'COY':
      return [
        { templateKey: 'RIFLE_PL', count: 3, status: 'ORGANIC', note: 'Nos 1, 2 & 3 Pls' },
        { templateKey: 'CHQ', count: 1, status: 'ORGANIC' },
        { templateKey: 'CP', count: 1, status: 'ORGANIC' },
        { templateKey: 'RR_DET', count: 2, status: 'ORGANIC', note: 'Wpn sec' },
        { templateKey: 'MOR60_SEC', count: 1, status: 'ORGANIC', note: 'Wpn sec' },
        { templateKey: 'GLHMG_DET', count: 1, status: 'ORGANIC', note: 'Wpn sec' },
        { templateKey: 'RIFLE_SEC', count: 1, status: 'ORGANIC', note: 'Standing ptl (found from depth pl)' },
        { templateKey: 'LP', count: 2, status: 'ORGANIC', note: 'Found from fwd pls (ni)' },
        { templateKey: 'SCREEN_PL', count: 1, status: 'IN_SP', note: 'Bn screen ex depth coy — sel & suggest loc' },
        { templateKey: 'BS_DET', count: 2, status: 'UC' },
        { templateKey: 'ASLT_PNR_SEC', count: 1, status: 'UC' },
        ...(qc ? [{ templateKey: 'QC_DET', count: 1, status: 'UC' as const, note: '1 x surv QC, 1 x A/QC' }] : []),
        { templateKey: 'ARTY_OBS', count: 1, status: 'UC' },
        { templateKey: 'MOR_OBS', count: 1, status: 'UC' },
      ];
    case 'BN':
      return [
        { templateKey: 'RIFLE_COY', count: 4, status: 'ORGANIC', note: 'A, B, C & D Coys' },
        { templateKey: 'SCREEN_PL', count: 1, status: 'ORGANIC', note: 'Bn screen (ex depth coy)' },
        { templateKey: 'RIFLE_SEC', count: 2, status: 'ORGANIC', note: 'Standing ptls' },
        { templateKey: 'BN_HQ', count: 1, status: 'ORGANIC' },
        { templateKey: 'CP', count: 1, status: 'ORGANIC', note: 'Tac HQ' },
        { templateKey: 'MOR81_PL', count: 1, status: 'ORGANIC' },
        { templateKey: 'ATGM_PL', count: 1, status: 'ORGANIC' },
        { templateKey: 'ASLT_PNR_SEC', count: 3, status: 'ORGANIC', note: 'Aslt pnr pl' },
        ...(qc ? [{ templateKey: 'QC_DET', count: 2, status: 'UC' as const }] : []),
        { templateKey: 'ARTY_OBS', count: 2, status: 'UC' },
      ];
    case 'BDE':
      return [
        { templateKey: 'INF_BN', count: 3, status: 'ORGANIC' },
        { templateKey: 'RIFLE_COY', count: 1, status: 'ORGANIC', note: 'Bde screen / covering tps' },
        { templateKey: 'RIFLE_PL', count: 2, status: 'ORGANIC', note: 'Standing ptls / OPs' },
        { templateKey: 'TK_SQN', count: 1, status: 'UC', note: 'Bde res for C attk' },
        { templateKey: 'BDE_HQ', count: 1, status: 'ORGANIC' },
        { templateKey: 'CP', count: 1, status: 'ORGANIC', note: 'Tac HQ' },
        { templateKey: 'ATGM_PL', count: 2, status: 'UC', note: 'ex LAT' },
        { templateKey: 'ASLT_PNR_SEC', count: 3, status: 'UC', note: 'Engr' },
        ...(qc ? [{ templateKey: 'QC_DET', count: 3, status: 'UC' as const }] : []),
        { templateKey: 'ARTY_OBS', count: 3, status: 'UC' },
      ];
  }
}

function enemyFor(level: OpsLevel, strong: boolean): EnemyForceItem[] {
  switch (level) {
    case 'PL':
      return [
        { templateKey: 'EN_RECCE', count: 1 },
        { templateKey: 'EN_INF_COY', count: strong ? 2 : 1 },
        { templateKey: 'EN_SUPPORT_COY', count: 1 },
        ...(strong ? [{ templateKey: 'EN_TK_TP', count: 1 }] : []),
      ];
    case 'COY':
      return [
        { templateKey: 'EN_RECCE', count: 2 },
        { templateKey: 'EN_INF_COY', count: strong ? 5 : 4 },
        { templateKey: 'EN_SUPPORT_COY', count: 1 },
        { templateKey: 'EN_TK_TP', count: strong ? 2 : 1 },
        { templateKey: 'EN_ENGR', count: 1 },
      ];
    case 'BN':
      return [
        { templateKey: 'EN_RECCE', count: 3 },
        { templateKey: 'EN_INF_BN', count: strong ? 4 : 3 },
        { templateKey: 'EN_SUPPORT_COY', count: 2 },
        { templateKey: 'EN_TK_SQN', count: 1 },
        { templateKey: 'EN_ENGR', count: 2 },
      ];
    case 'BDE':
      return [
        { templateKey: 'EN_RECCE', count: 4 },
        { templateKey: 'EN_INF_BN', count: strong ? 8 : 6 },
        { templateKey: 'EN_SUPPORT_COY', count: 3 },
        { templateKey: 'EN_TK_SQN', count: strong ? 4 : 3 },
        { templateKey: 'EN_ENGR', count: 3 },
      ];
  }
}

type Names = ReturnType<typeof unitNames>;
function ownFormation(level: OpsLevel, u: Names): string {
  return level === 'PL' ? `2 Pl, A Coy ${u.bn}` : level === 'COY' ? `A Coy ${u.bn}` : level === 'BN' ? u.bn : `${u.bde} Bde`;
}
function higherFormation(level: OpsLevel, u: Names): string {
  return level === 'PL' ? `A Coy / ${u.bn}` : level === 'COY' ? `${u.bn} / ${u.bde} Bde` : level === 'BN' ? `${u.bde} Bde / ${u.div} Div` : `${u.div} Div`;
}
function boundaryEchelon(level: OpsLevel) {
  return level === 'PL' ? ('PL' as const) : level === 'COY' ? ('COY' as const) : level === 'BN' ? ('BN' as const) : ('BDE' as const);
}
function boundaryLabel(level: OpsLevel, side: 'L' | 'R', u: Names): string {
  if (level === 'PL') return side === 'L' ? '1 | 2' : '2 | 3';
  if (level === 'COY') return side === 'L' ? 'C | A' : 'A | B';
  if (level === 'BN') return side === 'L' ? `${u.bnNo - 2} | ${u.bnNo}` : `${u.bnNo} | ${u.bnNo + 7}`;
  return side === 'L' ? `${u.bde - 5} ✕ ${u.bde}` : `${u.bde} ✕ ${u.bde + 5}`;
}
function flankName(level: OpsLevel, side: 'L' | 'R', u: Names): string {
  if (level === 'PL') return side === 'L' ? '1 Pl' : '3 Pl';
  if (level === 'COY') return side === 'L' ? 'C Coy (Lt fwd)' : 'B Coy (Rt fwd)';
  if (level === 'BN') return side === 'L' ? `${u.bnNo - 2} Punjab` : `${u.bnNo + 7} FF`;
  return side === 'L' ? `${u.bde - 5} Bde` : `${u.bde + 5} Bde`;
}

function requirementsFor(level: OpsLevel): string[] {
  const comd = level === 'PL' ? 'Pl Comd' : level === 'COY' ? 'Coy Comd' : level === 'BN' ? 'CO' : 'Bde Comd';
  const sub = level === 'PL' ? 'secs' : level === 'COY' ? 'pls' : level === 'BN' ? 'coys' : 'bns';
  return [
    `As ${comd}, carry out a detailed aprc: aim, gr & weather, ident of lines of def (mk on sketch).`,
    `DPs incl depl of ${sub} and siting of maj wpns (A tk, MGs/GLHMG, mors).`,
    'Options aval to en (min two APs) — record the en most likely apch.',
    `Mk the plan: localities, FDLs, killing areas, obs plan, DF & DF (SOS), surv plan, C attk objs in order of pri, HQ/CP, altn posns${level === 'PL' ? '' : ', loc for screens'}.`,
    'Pre-plan contingencies for the screen battle, en assembly / forming up, assault, loss of a post / locality and reorg.',
  ];
}

function buildNarrative(
  s: Scenario,
  rng: Rng,
  x: { u: Names; foxTown: string; objTown: string; leftAnchor: string; rightAnchor: string; comd: string; qc: boolean; ucav: boolean; tm: TerrainModel },
): Scenario['narrative'] {
  const { u } = x;
  const lvl = s.level;
  const cause = rng.pick([
    `recent suicidal attk on FL's mil cantonment at ${rng.pick(['Pahlgham', 'Uri', 'Pathankot', 'Gurdaspur'])}. FL without a second thought has deemed BL resp for the incident`,
    'a series of border skirmishes resulting in hy cas to the BSF posts along the bdry',
    'violation of BL air space by FL recce aircraft and the subsequent shooting down of a FL UAV',
    'the FL decision to block the flow of the river waters in violation of the treaty',
  ]);
  const enConc = lvl === 'BDE' ? 'a Corps (-) size force with an armd bde' : lvl === 'BN' ? 'a Div (-) size force with an armd regt' : lvl === 'COY' ? 'a Bde plus size force with a sqn armr' : 'a Bde size force';
  const genIdea = `Blueland (BL) and Foxland (FL) are two neighbouring states with their interstate bdry as shown on sketch. Relations b/w the two states have remained strained due to ideological diff and long outstanding territorial disputes ever since their independence. Sit has been further aggravated by ${cause}. In order to gain the sympathies of her masses, FL has conc its forces all along the border and war seems imminent.\n\nReportedly, FL is prep to launch an attk along axis ${x.foxTown} - ${x.objTown} with a view to threaten ${x.objTown} which is an imp comm cen (loc ${rng.int(8, 20)} KMs South of sketch). Conc of ${enConc} is reported in area ${x.foxTown} (${rng.int(6, 14)} KMs North of sketch). The attk of en is expected any time after D Day.`;
  const air = rng.pick([
    'FAF enjoys air superiority however; BAF is likely to provide CS and recce sorties during critical stages of the battle.',
    'Air sit is likely to remain favourable to FL; BAF will provide limited CS sorties on demand.',
  ]);
  const met = s.weather.cond === 'clear' ? 'Clear, dry. Visibility good.' : s.weather.cond === 'rain' ? 'Intermittent rain; x-cty mov restd to rds/trs.' : s.weather.cond === 'fog' ? 'Fog likely during ni and early morning; visibility 300-500 m.' : s.weather.cond === 'haze' ? 'Hazy; visibility 1000-1500 m.' : 'Dust storms likely in the afternoon.';
  const moon = { none: 'No moon', quarter: 'Quarter moon', half: 'Half moon', full: 'Full moon' }[s.times.light.moon];
  const fl = `${String(Math.floor(s.times.light.firstLight / 60)).padStart(2, '0')}${String(s.times.light.firstLight % 60).padStart(2, '0')}`;
  const ll = `${String(Math.floor(s.times.light.lastLight / 60)).padStart(2, '0')}${String(s.times.light.lastLight % 60).padStart(2, '0')}`;

  const enThreatToUs = lvl === 'BDE' ? 'a div (-) sp by an armd bde' : lvl === 'BN' ? 'a bde plus sp by an armr sqn' : lvl === 'COY' ? 'a bn size force sp by a tp of tks' : 'a coy size force sp by MGs';
  const tasker = lvl === 'BDE' ? `GOC ${u.div} Div` : lvl === 'BN' ? `Comd ${u.bde} Bde` : lvl === 'COY' ? `CO ${u.bn}` : `Coy Comd A Coy`;
  const you = lvl === 'BDE' ? `Comd ${u.bde} Bde` : lvl === 'BN' ? `CO ${u.bn}` : lvl === 'COY' ? `Coy Comd A Coy, Capt ${x.comd}` : `Pl Comd 2 Pl, Lt ${x.comd}`;
  const screens = lvl === 'PL' ? 'Lve space for the coy LP / standing ptl fwd of your posn.' : `You must sel and suggest loc for ${lvl === 'BDE' ? 'covering tps / Bde screens' : lvl === 'BN' ? 'Bn screens' : 'Bn Screens'} and lve enough space for their emp while ensuring def to be as far fwd as tac feasible.`;
  const resourcesTxt = s.own.resources
    .filter((r) => r.status !== 'ORGANIC')
    .map((r) => `${r.count} x ${r.templateKey.replace(/_/g, ' ').toLowerCase()}${r.note ? ` (${r.note})` : ''}`)
    .join(', ');
  const narr1 = `${tasker} turned towards ${you} and said, “I have given you the ${rng.pick(['most difficult and complex', 'most crucial', 'most demanding'])} task of def of ${lvl === 'COY' || lvl === 'PL' ? 'the lt side of my' : 'the most threatened part of the'} ${lvl === 'PL' ? 'Coy' : lvl === 'COY' ? 'Bn' : lvl === 'BN' ? 'Bde' : 'Div'} AOR from excl ${x.leftAnchor} to incl ${x.rightAnchor}. As per my vis en will attk your loc with ${enThreatToUs}. You are at full liberty to sel and suggest to me suitable lines of def within given bdrys. Plan your defs in such a manner that it should prevent, resist, repulse and destroy en attk.${resourcesTxt ? ` ${resourcesTxt} are placed UC.` : ''}${x.ucav && s.own.fire.ucavSorties ? ' Moreover, UCAV strike would also be aval on justified demand.' : ''}\n\n${screens} ${s.own.flanks[1].name} will conform to the def line sel by you as FDLs. Your defs should be ready in all aspects by first lt D Day.”`;

  const roadsTxt = s.terrain.features
    .filter((f): f is LinearFeature => f.kind === 'road')
    .map((f) => `  ${f.name}  -  ${f.cls}`)
    .join('\n');
  const obsTxt: string[] = [];
  for (const f of s.terrain.features) {
    if (f.kind === 'canal') obsTxt.push(`  ${f.name}. Major obs for wh and tr vehs; crossing only at brs. Banks ${rng.int(3, 6)}-${rng.int(7, 12)} ft higher than surroundings.`);
    if (f.kind === 'nullah') obsTxt.push(`  ${f.name}. Not an obs for wh and tr vehs however impedes mov.`);
    if (f.kind === 'disty') obsTxt.push(`  ${f.name}. Not an obs for tr vehs however impedes mov; obs for wh vehs except at brs.`);
  }
  if (s.terrain.features.some((f) => f.kind === 'broken')) obsTxt.push('  Broken Gr. Complete obs for wh vehs, however, impedes mov of tr vehs.');
  if (s.terrain.features.some((f) => f.kind === 'marsh')) obsTxt.push('  Marshy Area. Obs for all vehs; restricts inf mov.');
  if (s.terrain.features.some((f) => f.kind === 'dunes')) obsTxt.push('  Sand Dunes. Impede mov of wh vehs; provide cover from obsn.');
  const typeTxt = {
    PLAINS: 'The AOO resembles the plains of Punjab. The area is gen flat, open and extensively cultivated. The soil is firm and x-cty mov is possible during dry weather, however, during rainy season, it is restd to existing rds and trs.',
    CANAL: 'The AOO is irrigated plains, dominated by a major canal which forms a defence oriented obs. Area is extensively cultivated with sugarcane / wheat. X-cty mov is good in dry weather.',
    DESERT: 'The AOO is sandy desert with sand dunes of varying hts running gen NE - SW. Going is gen bad for wh vehs and fair for tr vehs; mov restd to existing trs.',
    SEMI_DESERT: 'The AOO is semi-desert; patches of cultivation interspersed with sandy tracts and low dunes. X-cty mov is fair for tr vehs.',
  }[s.terrain.type];
  const topo = `${typeTxt} The area is criss crossed with ${s.terrain.type === 'DESERT' ? 'a few' : 'numerous'} rds / trs inter connecting various vills. F of F and obsn is aval upto ${s.terrain.type === 'DESERT' ? '1500 - 3000' : '800 - 1500'} ms.\n\nRds / Trs\n${roadsTxt || '  Nil metalled rds'}\n  All Trs  -  Cl 9 F 1\n\nObs\n${obsTxt.join('\n') || '  Nil maj obs.'}\n\nBUAs. Vills are loc gen on higher gr than surroundings.\nCover. Cover is aval in the form of scattered trees, clumps, relative hts${s.terrain.features.some((f) => f.kind === 'kbund') ? ', kidney bunds' : ''} and BUAs.`;

  const tasks = lvl === 'PL'
    ? `Msn. Coy will take up def two pls up. 2 Pl (own) Lt Fwd, 3 Pl Rt Fwd, 1 Pl Depth. Def to be ready by first lt D Day.`
    : lvl === 'COY'
      ? `Msn. Take up def posn from excl ${x.leftAnchor} to incl ${x.rightAnchor}.\n\nExec — Gen Outline. Def will be taken with two coys up:\n    Lt Fwd   -  A Coy (Own Coy)\n    Rt Fwd   -  B Coy\n    Lt Depth -  C Coy\n    Rt Depth -  D Coy`
      : lvl === 'BN'
        ? `Msn. ${u.bde} Bde will take up def two up. ${u.bn} (own) Lt Fwd; ${u.bnNo + 7} FF Rt Fwd; ${u.bnNo - 2} Punjab in depth / bde res.`
        : `Msn. ${u.div} Div will def the sector two bdes up. ${u.bde} Bde (own) Lt Fwd.`;

  return [
    { key: 'gen_idea', title: 'Gen Idea', body: genIdea },
    { key: 'narr', title: 'Narr', body: `As a sequel to these devs, ${lvl === 'BDE' ? `GOC ${u.div} Div` : `Comd ${u.bde} Bde`} has tasked ${lvl === 'BDE' ? `${u.bde} Bde` : `CO ${u.bn}`} to take up def and ensure max attrition to the en.\n\n${air}\n\nMet. ${met} ${moon}. First lt ${fl} hrs, last lt ${ll} hrs. Temp ${s.weather.temp}. Wind ${s.weather.wind}.` },
    { key: 'orders', title: 'O Gp', body: `${tasker.split(' ').slice(0, 1).join(' ')} O gp was held on ${Math.abs(Math.floor(s.times.now / 1440)) ? `D ${Math.floor(s.times.now / 1440)}` : 'D Day'} at ${String(Math.floor(((s.times.now % 1440) + 1440) % 1440 / 60)).padStart(2, '0')}00 hrs. “En is prep to attk our posns any time after first lt D Day.”\n\n${tasks}` },
    { key: 'atts', title: 'Atts and Dets / Fire Sp', body: `Fire sp: ${s.own.fire.artyLabel}.${s.own.fire.mor81 ? ' Bn 81mm mors through mor obsr.' : ''}${s.own.fire.ucavSorties ? ` UCAV: ${s.own.fire.ucavSorties} strike(s) on justified demand.` : ''}\nObs resources: mines for ~${s.own.fire.mines.apM} m (AP) / ${s.own.fire.mines.atM} m (A tk) of frontage; wire ${s.own.fire.wireM} m.\nEW threat ${s.enemy.ewThreat.toLowerCase()}; air threat ${s.enemy.airThreat.toLowerCase()}.` },
    { key: 'topo', title: 'Topo Notes', body: topo },
    { key: 'narr1', title: 'Narr 1', body: narr1 },
  ];
}

/** Generate several scenarios in one go (instructor "batch generate"). */
export function generateBatch(n: number, base: Omit<GenOptions, 'seed'> & { varyTerrain?: boolean; varyLevel?: boolean }, seed = newSeed()): Scenario[] {
  const rng = new Rng(seed);
  const out: Scenario[] = [];
  const terrains: TerrainType[] = ['PLAINS', 'CANAL', 'SEMI_DESERT', 'DESERT'];
  const levels: OpsLevel[] = ['PL', 'COY', 'BN', 'BDE'];
  for (let i = 0; i < n; i++) {
    out.push(
      generateScenario({
        ...base,
        terrain: base.varyTerrain ? rng.pick(terrains) : base.terrain,
        level: base.varyLevel ? rng.pick(levels) : base.level,
        seed: (rng.next() * 0xffffffff) >>> 0,
      }),
    );
  }
  return out;
}



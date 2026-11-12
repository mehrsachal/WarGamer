// Terrain & plan analyser (training aid). Works on any map; tuned for mountain border sectors.
// All parameters come from AnalysisParams (data/analysis-mountain.json). Deterministic, no I/O.
import type { MapModel, Ruleset } from '../data/ruleset';
import type { Scenario, Weapon } from '../data/schema';
import { type Hex, hexDistance, hexKey, hexNeighbor, hexNeighbors, hexRange, parseHexKey } from '../hex';
import { lineOfSight, viewshed } from '../los';
import { stepCost } from '../move';
import type { GameContext } from '../state';
import type { AnalysisParams, DefenceMode } from './params';

export type Rating = 'good' | 'adequate' | 'not good';
export type Force = 'section' | 'platoon' | 'company' | 'battalion';

export interface Ridge { id: string; hexes: Hex[]; length_m: number; maxElev: number; crossesBorder: boolean }
export interface Approach {
  id: string; name: string; path: Hex[]; kind: 'valley' | 'ridge' | 'slope'; length_m: number; time_min: number;
  width_m: number; capacity: Force; crossing: Hex | null; crossingGr: string; deadGroundPct: number; observedPct: number;
}
export interface Itg {
  id: string; name: string; hex: Hex; gr: string; elevation: number; value: number; extent: Hex[]; area_ha: number; frontage_m: number;
  force: Force; vital: boolean; approaches: { id: string; pct: number }[]; nullahCoverPct: number; occupied: boolean; rating: Rating; reasons: string[];
}
export interface Position {
  id: string; kind: 'platoon' | 'company_hq' | 'bn_hq' | 'reserve' | 'post'; name: string; company?: string; hex: Hex; gr: string;
  itgId?: string; distToBorder_m: number; value: number; coveragePct: number; mutualSupport: string[]; rating: Rating; reasons: string[];
}
export interface WeaponSite { id: string; weaponId: string; name: string; hex: Hex; gr: string; positionId: string; effRange_m: number; coveragePct: number; approaches: string[]; rating: Rating }
export interface MortarSite { id: string; weaponId: string; name: string; hex: Hex; gr: string; minRange_m: number; maxRange_m: number; coveragePct: number }
export interface Gap { from: Hex; to: Hex; grFrom: string; grTo: string; length_m: number }
export interface Infiltration { id: string; path: Hex[]; length_m: number; time_min: number; exposurePct: number; deadGroundPct: number; crossing: Hex | null; crossingGr: string; rating: 'most likely' | 'likely' | 'possible' }
export interface ExploitableFeature { kind: 'valley' | 'ridge' | 'nullah'; name: string; hex: Hex; gr: string; note: string }
export interface AttackOption {
  id: string; name: string; approachId: string; objectiveId: string; fup: Hex | null; fupGr: string; axis: Hex[]; time_min: number;
  exposurePct: number; deadGroundPct: number; score: number; likelihood: 'most likely' | 'likely' | 'possible'; summary: string;
}
export interface Recommendation { severity: 'info' | 'warn' | 'critical'; text: string; hex?: Hex }

export interface AnalysisReport {
  mapId: string; mode: DefenceMode; modeLabel: string; paramsSource: string; aoiHexes: number;
  terrain: {
    minElev: number; maxElev: number; meanSlopePct: number; steepPct: number; veryStepPct: number;
    slope: Record<string, number>; aspect: Record<string, string>; dominance: Record<string, number>; value: Record<string, number>;
    nullahs: string[]; ridges: Ridge[]; peaks: string[];
  };
  territory: { own: string[]; enemy: string[]; border: string[] };
  approaches: Approach[];
  itgs: Itg[];
  mutualSupport: [string, string][];
  deployment: {
    positions: Position[]; weapons: WeaponSite[]; mortars: { sites: MortarSite[]; targetHexes: number; coveredPct: number; interlockPct: number; gaps: string[]; rating: Rating };
    surveillance: { borderLength_m: number; observedPct: number; gaps: Gap[]; rating: Rating }; observed: string[];
  };
  enemy: { infiltration: Infiltration[]; exploitable: ExploitableFeature[]; options: AttackOption[] };
  summary: { overall: Rating; score: number; lines: string[] };
  recommendations: Recommendation[];
  timings: Record<string, number>;
}

export interface AnalyseInput {
  map: MapModel;
  data: Ruleset;
  params: AnalysisParams;
  mode: DefenceMode;
  /** Area of interest (hexes). Default: the whole map. */
  aoi?: Hex[];
  now?: () => number;
}

// ---------------------------------------------------------------- small utilities

class Heap {
  private a: [number, string][] = [];
  get size(): number { return this.a.length; }
  push(c: number, k: string): void {
    const a = this.a;
    a.push([c, k]);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p][0] <= a[i][0]) break;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }
  pop(): [number, string] {
    const a = this.a;
    const top = a[0];
    const last = a.pop()!;
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && a[l][0] < a[m][0]) m = l;
        if (r < a.length && a[r][0] < a[m][0]) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top;
  }
}

function dijkstra(sources: string[], cost: (a: Hex, b: Hex) => number | null, allowed: (k: string) => boolean): { dist: Map<string, number>; prev: Map<string, string> } {
  const dist = new Map<string, number>();
  const prev = new Map<string, string>();
  const h = new Heap();
  for (const s of sources) {
    dist.set(s, 0);
    h.push(0, s);
  }
  while (h.size) {
    const [d, k] = h.pop();
    if (d > (dist.get(k) ?? Infinity)) continue;
    const a = parseHexKey(k);
    for (const b of hexNeighbors(a)) {
      const bk = hexKey(b);
      if (!allowed(bk)) continue;
      const c = cost(a, b);
      if (c === null) continue;
      const nd = d + c;
      if (nd < (dist.get(bk) ?? Infinity)) {
        dist.set(bk, nd);
        prev.set(bk, k);
        h.push(nd, bk);
      }
    }
  }
  return { dist, prev };
}

function trace(prev: Map<string, string>, end: string): Hex[] {
  const out: Hex[] = [];
  let k: string | undefined = end;
  while (k) {
    out.unshift(parseHexKey(k));
    k = prev.get(k);
  }
  return out;
}

const pct = (n: number, d: number) => (d ? Math.round((1000 * n) / d) / 10 : 0);
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

function rate(score: number, p: AnalysisParams): Rating {
  return score >= p.ratings.good ? 'good' : score >= p.ratings.adequate ? 'adequate' : 'not good';
}

function forceFor(hexes: number, p: AnalysisParams): Force {
  return (p.itg.forceBySize.find((f) => hexes <= f.maxHexes) ?? p.itg.forceBySize[p.itg.forceBySize.length - 1]).force;
}

const ASPECTS = ['SE', 'NE', 'N', 'NW', 'SW', 'S'];

/** Effective range (hexes) of a weapon: last band still at or above the threshold for its main target class. */
export function effectiveRange(w: Weapon): number {
  const at = w.lethality.hard >= 0.5;
  let r = 0;
  for (const b of w.rangeBands) if ((at ? b.hardHit >= 0.5 : b.softHit >= 0.25) || (w.indirect && b.softHit > 0)) r = b.toHex;
  return Math.min(r || w.rangeBands[0].toHex, w.maxRange);
}

// ---------------------------------------------------------------- analysis

export function analyse(input: AnalyseInput): AnalysisReport {
  const { map, data, params: P, mode } = input;
  const now = input.now ?? (() => Date.now());
  const timings: Record<string, number> = {};
  let t0 = now();
  const lap = (name: string) => {
    const t = now();
    timings[name] = t - t0;
    t0 = t;
  };
  const M = P.modes[mode];
  const hexM = map.def.hexSize_m;
  const ctx = { data, map, scenario: undefined as unknown as Scenario } as GameContext;
  const aoi = new Set((input.aoi?.length ? input.aoi : map.list).filter((h) => map.has(h)).map(hexKey));
  const inAoi = (k: string) => aoi.has(k);
  const gr = (h: Hex) => map.gridRef(h);
  const elev = (h: Hex) => map.elevation(h);
  const EYE = { observerHeight_m: 1.6, targetHeight_m: 1.0 };
  const vsCache = new Map<string, Set<string>>();
  const vs = (h: Hex, range = P.terrain.observationRange) => {
    const k = `${hexKey(h)}@${range}`;
    let v = vsCache.get(k);
    if (!v) {
      v = viewshed(map, h, range, EYE);
      vsCache.set(k, v);
    }
    return v;
  };

  // ---- territory: border line splits own and enemy ground
  const borderSet = new Set((map.def.border?.hexes ?? []).map(hexKey));
  const flood = (start: Hex) => {
    const seen = new Set<string>();
    const st = [hexKey(start)];
    while (st.length) {
      const k = st.pop()!;
      if (seen.has(k) || borderSet.has(k) || !map.has(parseHexKey(k))) continue;
      seen.add(k);
      for (const n of hexNeighbors(parseHexKey(k))) st.push(hexKey(n));
    }
    return seen;
  };
  let own: Set<string>;
  let enemy: Set<string>;
  if (map.def.border) {
    own = flood(map.def.border.ownRef);
    enemy = flood(map.def.border.enemyRef);
  } else {
    // no border: the top quarter of the map is the enemy side
    const rows = map.list.map((h) => map.centre_m(h).y);
    const cut = Math.min(...rows) + (Math.max(...rows) - Math.min(...rows)) * 0.25;
    own = new Set(map.list.filter((h) => map.centre_m(h).y > cut).map(hexKey));
    enemy = new Set(map.list.filter((h) => map.centre_m(h).y <= cut).map(hexKey));
    for (const h of map.list) if (Math.abs(map.centre_m(h).y - cut) < hexM * 0.6) borderSet.add(hexKey(h));
  }
  // distance (hexes) to the border line
  const dB = new Map<string, number>();
  {
    let frontier = [...borderSet];
    for (const k of frontier) dB.set(k, 0);
    let d = 0;
    while (frontier.length) {
      d++;
      const next: string[] = [];
      for (const k of frontier)
        for (const n of hexNeighbors(parseHexKey(k))) {
          const nk = hexKey(n);
          if (!map.has(n) || dB.has(nk)) continue;
          dB.set(nk, d);
          next.push(nk);
        }
      frontier = next;
    }
  }
  const distBorder_m = (k: string) => (dB.get(k) ?? 999) * hexM;
  lap('territory');

  // ---- TA-1 slope, aspect, relief
  const slope: Record<string, number> = {};
  const aspect: Record<string, string> = {};
  let sumSlope = 0;
  let steep = 0;
  let verySteep = 0;
  for (const h of map.list) {
    const k = hexKey(h);
    let maxRise = 0;
    let downDir = -1;
    let down = 0;
    for (let d = 0; d < 6; d++) {
      const n = hexNeighbor(h, d);
      if (!map.has(n)) continue;
      const de = elev(n) - elev(h);
      maxRise = Math.max(maxRise, Math.abs(de));
      if (-de > down) {
        down = -de;
        downDir = d;
      }
    }
    slope[k] = Math.round((maxRise / hexM) * 100);
    aspect[k] = downDir >= 0 ? ASPECTS[downDir] : 'flat';
    if (inAoi(k)) {
      sumSlope += slope[k];
      if (slope[k] > 30) steep++;
      if (slope[k] > 60) verySteep++;
    }
  }
  // drainage (D6 flow accumulation) -> nullahs / valley floors
  const order = [...map.list].sort((a, b) => elev(b) - elev(a));
  const acc = new Map<string, number>();
  for (const h of order) {
    const k = hexKey(h);
    acc.set(k, (acc.get(k) ?? 0) + 1);
    let low: Hex | null = null;
    for (const n of hexNeighbors(h)) if (map.has(n) && elev(n) < (low ? elev(low) : elev(h))) low = n;
    if (low) acc.set(hexKey(low), (acc.get(hexKey(low)) ?? 0) + acc.get(k)!);
  }
  const nullah = new Set([...acc].filter(([, a]) => a >= P.terrain.nullahMinCatchment).map(([k]) => k));
  // TA-2 ridges and peaks
  const ridgeSet = new Set<string>();
  const peaks: string[] = [];
  for (const h of map.list) {
    const k = hexKey(h);
    if (nullah.has(k)) continue;
    let axes = 0;
    for (let d = 0; d < 3; d++) {
      const a = hexNeighbor(h, d);
      const b = hexNeighbor(h, d + 3);
      if (map.has(a) && map.has(b) && elev(h) - elev(a) >= P.terrain.ridgeMinRise_m && elev(h) - elev(b) >= P.terrain.ridgeMinRise_m) axes++;
    }
    if (axes >= 1) ridgeSet.add(k);
    if (hexNeighbors(h).every((n) => !map.has(n) || elev(n) < elev(h))) peaks.push(k);
  }
  const ridges: Ridge[] = [];
  {
    const seen = new Set<string>();
    for (const k of ridgeSet) {
      if (seen.has(k)) continue;
      const comp: string[] = [];
      const st = [k];
      while (st.length) {
        const x = st.pop()!;
        if (seen.has(x) || !ridgeSet.has(x)) continue;
        seen.add(x);
        comp.push(x);
        for (const n of hexNeighbors(parseHexKey(x))) st.push(hexKey(n));
      }
      if (comp.length < P.terrain.ridgeMinLength) continue;
      const hexes = comp.map(parseHexKey).sort((a, b) => elev(b) - elev(a));
      const ends = hexes.reduce((m, a) => Math.max(m, ...hexes.map((b) => hexDistance(a, b))), 0);
      ridges.push({ id: `R${ridges.length + 1}`, hexes, length_m: ends * hexM, maxElev: Math.round(elev(hexes[0])), crossesBorder: comp.some((x) => (dB.get(x) ?? 99) <= 1) });
    }
    ridges.sort((a, b) => b.hexes.length - a.hexes.length);
    ridges.forEach((r, i) => (r.id = `R${i + 1}`));
  }
  // dominance: height above the local mean
  const dominance: Record<string, number> = {};
  {
    const raw = new Map<string, number>();
    for (const h of map.list) {
      if (!inAoi(hexKey(h))) continue;
      let s = 0;
      let n = 0;
      for (const x of hexRange(h, P.terrain.dominanceRadius)) if (map.has(x)) {
        s += elev(x);
        n++;
      }
      raw.set(hexKey(h), elev(h) - s / n);
    }
    const vals = [...raw.values()];
    const lo = Math.min(...vals);
    const hi = Math.max(...vals);
    for (const [k, v] of raw) dominance[k] = Math.round((100 * (v - lo)) / Math.max(1e-6, hi - lo)) / 100;
  }
  lap('terrain');

  // ---- TA-6 approaches (least-cost corridors from the enemy rear to own depth)
  const footCost = (a: Hex, b: Hex) => stepCost(ctx, 'foot', a, b);
  const enemyD = [...enemy].map((k) => dB.get(k) ?? 0);
  const ownD = [...own].map((k) => dB.get(k) ?? 0);
  const maxE = Math.max(1, ...enemyD);
  const maxO = Math.max(1, ...ownD);
  const sources = [...enemy].filter((k) => (dB.get(k) ?? 0) >= Math.max(1, maxE - 2));
  const sinks = new Set([...own].filter((k) => (dB.get(k) ?? 0) >= Math.max(1, Math.min(maxO - 2, 25))));
  const anywhere = (k: string) => map.has(parseHexKey(k));
  const corridorPaths = (n: number, costOf: (a: Hex, b: Hex) => number | null, sep: number, pen: number): Hex[][] => {
    const used = new Map<string, number>();
    const paths: Hex[][] = [];
    for (let i = 0; i < n * 2 && paths.length < n; i++) {
      const { dist, prev } = dijkstra(sources, (a, b) => {
        const c = costOf(a, b);
        return c === null ? null : c * (1 + (used.get(hexKey(b)) ?? 0) * (pen - 1));
      }, anywhere);
      let best: string | undefined;
      for (const s of sinks) if (dist.has(s) && (!best || dist.get(s)! < dist.get(best)!)) best = s;
      if (!best) break;
      const path = trace(prev, best);
      const overlap = path.filter((h) => (used.get(hexKey(h)) ?? 0) > 0).length / path.length;
      for (const h of path) for (const x of hexRange(h, sep)) used.set(hexKey(x), 1);
      if (paths.length && overlap > 0.6) continue;
      paths.push(path);
    }
    return paths;
  };
  const approachPaths = corridorPaths(P.approaches.max, footCost, P.approaches.separation_hex, P.approaches.separationPenalty);
  const pathCost = (path: Hex[], costOf = footCost) => path.slice(1).reduce((m, h, i) => m + (costOf(path[i], h) ?? 0), 0);
  const approaches: Approach[] = approachPaths.map((path, i) => {
    let v = 0;
    let r = 0;
    let width = 0;
    for (const h of path) {
      const k = hexKey(h);
      if (nullah.has(k)) v++;
      else if (ridgeSet.has(k)) r++;
      width += 1 + hexNeighbors(h).filter((n) => map.has(n) && (footCost(h, n) ?? 99) <= 2.5).length / 3;
    }
    const kind: Approach['kind'] = v / path.length >= 0.25 ? 'valley' : r / path.length >= 0.35 ? 'ridge' : 'slope';
    const width_m = Math.round((width / path.length) * hexM);
    const crossing = path.find((h) => borderSet.has(hexKey(h))) ?? null;
    return {
      id: `A${i + 1}`,
      name: `Approach ${i + 1} (${kind})`,
      path,
      kind,
      length_m: (path.length - 1) * hexM,
      time_min: Math.round(pathCost(path) * P.approaches.minutesPerMP),
      width_m,
      capacity: width_m >= 400 ? 'battalion' : width_m >= 250 ? 'company' : 'platoon',
      crossing,
      crossingGr: crossing ? gr(crossing) : '',
      deadGroundPct: 0,
      observedPct: 0,
    };
  });
  const approachHexes = new Set(approaches.flatMap((a) => a.path.map(hexKey)));
  lap('approaches');

  // ---- TA-3 terrain value on candidate ground (own side, within reach of the border)
  const maxBand_m = Math.max(...Object.values(P.modes).map((m) => m.mainPositions_m[1])) + 500;
  const cand = [...own]
    .filter((k) => inAoi(k) && distBorder_m(k) <= maxBand_m)
    .sort((a, b) => (dominance[b] ?? 0) + (ridgeSet.has(b) ? 0.2 : 0) - ((dominance[a] ?? 0) + (ridgeSet.has(a) ? 0.2 : 0)))
    .slice(0, 130);
  const enemyWatch = [...enemy].filter((k) => (dB.get(k) ?? 99) <= 15 && nullah.has(k));
  const access = dijkstra([...sinks], (a, b) => footCost(b, a), (k) => own.has(k) || borderSet.has(k)).dist;
  const maxAccess = Math.max(1, ...cand.map((k) => access.get(k) ?? 0));
  const value: Record<string, number> = {};
  const obsApproach = new Map<string, number>();
  const w = P.terrain.valueWeights;
  const wsum = w.dominance + w.observation + w.defensibility + w.access;
  for (const k of [...aoi]) value[k] = Math.round((dominance[k] ?? 0) * 0.5 * 100) / 100;
  for (const k of cand) {
    const h = parseHexKey(k);
    const v = vs(h);
    const seenApp = [...approachHexes].filter((x) => v.has(x)).length;
    const seenNul = enemyWatch.filter((x) => v.has(x)).length;
    const obs = clamp01(0.7 * (approachHexes.size ? seenApp / approachHexes.size : 0) * 2 + 0.3 * (enemyWatch.length ? seenNul / enemyWatch.length : 0) * 2);
    obsApproach.set(k, approachHexes.size ? seenApp / approachHexes.size : 0);
    // defensibility: ground falling away toward the enemy, plus cover
    let fall = 0;
    let n = 0;
    for (const nb of hexNeighbors(h)) {
      const nk = hexKey(nb);
      if (!map.has(nb) || (dB.get(nk) ?? 99) >= (dB.get(k) ?? 99)) continue;
      fall += elev(h) - elev(nb);
      n++;
    }
    const def = clamp01((n ? fall / n / hexM : 0) * 1.5 + (1 - map.cell(h).terrain.cover) * 0.6);
    const acc01 = 1 - clamp01((access.get(k) ?? maxAccess) / maxAccess);
    const sc = (w.dominance * (dominance[k] ?? 0) + w.observation * obs + w.defensibility * def + w.access * acc01) / wsum;
    value[k] = Math.round(sc * 100) / 100;
  }
  lap('value');

  // ---- TA-4 key ground (ITGs)
  const itgs: Itg[] = [];
  const byValue = [...cand].sort((a, b) => value[b] - value[a]);
  for (const k of byValue) {
    if (itgs.length >= P.itg.maxItgs || (itgs.length >= 3 && value[k] < P.itg.minValue)) break;
    const h = parseHexKey(k);
    if (itgs.some((i) => hexDistance(i.hex, h) < P.itg.minSpacing_hex)) continue;
    // extent: connected own ground within crestDrop of the top
    const top = elev(h);
    const extent: Hex[] = [];
    const seen = new Set<string>();
    const st = [k];
    while (st.length) {
      const x = st.pop()!;
      if (seen.has(x)) continue;
      seen.add(x);
      const xh = parseHexKey(x);
      if (!own.has(x) || !map.has(xh) || elev(xh) < top - P.itg.crestDrop_m || hexDistance(xh, h) > 4) continue;
      extent.push(xh);
      for (const nb of hexNeighbors(xh)) st.push(hexKey(nb));
    }
    const span = extent.reduce((m, a) => Math.max(m, ...extent.map((b) => hexDistance(a, b))), 0);
    const label = map.def.labels.filter((l) => l.kind !== 'village' && hexDistance(l, h) <= 3).sort((a, b) => hexDistance(a, h) - hexDistance(b, h))[0];
    const v = vs(h);
    itgs.push({
      id: `K${itgs.length + 1}`,
      name: label ? label.text : `Pt ${Math.round(top)}`,
      hex: h,
      gr: gr(h),
      elevation: Math.round(top),
      value: value[k],
      extent,
      area_ha: Math.round((extent.length * (hexM * hexM * 0.866)) / 10000),
      frontage_m: (span + 1) * hexM,
      force: forceFor(extent.length, P),
      vital: false,
      approaches: approaches.map((a) => ({ id: a.id, pct: pct(a.path.filter((x) => v.has(hexKey(x))).length, a.path.length) })).filter((x) => x.pct > 0),
      nullahCoverPct: pct(enemyWatch.filter((x) => v.has(x)).length, enemyWatch.length),
      occupied: false,
      rating: rate(value[k], P),
      reasons: [],
    });
  }
  if (itgs.length) {
    const vital = [...itgs].sort((a, b) => b.approaches.reduce((m, x) => m + x.pct, 0) + b.value * 100 - (a.approaches.reduce((m, x) => m + x.pct, 0) + a.value * 100))[0];
    vital.vital = true;
  }
  for (const i of itgs) {
    i.reasons.push(`Dominance ${Math.round((dominance[hexKey(i.hex)] ?? 0) * 100)}%, value ${Math.round(i.value * 100)}%`);
    const best = [...i.approaches].sort((a, b) => b.pct - a.pct)[0];
    if (best) i.reasons.push(`Overlooks ${best.id} (${best.pct}% of its length)`);
    i.reasons.push(`Extent ${i.extent.length} hexes (${i.area_ha} ha, ~${i.frontage_m} m across): needs a ${i.force}`);
  }
  // TA-5 mutual support between ITGs
  const mutualSupport: [string, string][] = [];
  for (let a = 0; a < itgs.length; a++)
    for (let b = a + 1; b < itgs.length; b++)
      if (hexDistance(itgs[a].hex, itgs[b].hex) <= P.itg.mutualSupport_hex && lineOfSight(map, itgs[a].hex, itgs[b].hex, EYE).clear) mutualSupport.push([itgs[a].id, itgs[b].id]);
  lap('itgs');

  // ---- DEP-1..3 deployment
  const positions: Position[] = [];
  const inBand = (k: string, band: [number, number]) => {
    const d = distBorder_m(k);
    return own.has(k) && d >= band[0] && d <= band[1];
  };
  const F = P.force;
  const nPl = F.companies * F.platoonsPerCompany;
  const plSites: { hex: Hex; itg?: Itg }[] = [];
  const plFor: Record<Force, number> = { section: 1, platoon: 1, company: F.platoonsPerCompany, battalion: nPl };
  const bandItgs = itgs.filter((i) => inBand(hexKey(i.hex), M.mainPositions_m) || i.extent.some((x) => inBand(hexKey(x), M.mainPositions_m)));
  const rankItg = (i: Itg) => i.value + (M.preferRidges && ridgeSet.has(hexKey(i.hex)) ? 0.1 : 0) + i.approaches.reduce((m, x) => m + x.pct, 0) / 400;
  for (const i of [...bandItgs].sort((a, b) => rankItg(b) - rankItg(a))) {
    if (plSites.length >= nPl) break;
    const need = Math.min(plFor[i.force], nPl - plSites.length);
    const spots = i.extent.filter((x) => inBand(hexKey(x), M.mainPositions_m)).sort((a, b) => value[hexKey(b)] - value[hexKey(a)]);
    const chosen: Hex[] = [];
    for (const s of spots) {
      if (chosen.length >= need) break;
      if (chosen.some((c) => hexDistance(c, s) < 2)) continue;
      chosen.push(s);
    }
    if (!chosen.length) continue;
    for (const c of chosen) plSites.push({ hex: c, itg: i });
    i.occupied = true;
  }
  // fill remaining platoons on the best remaining ground in the band
  const bandCand = [...own].filter((k) => inAoi(k) && inBand(k, M.mainPositions_m) && (slope[k] ?? 0) <= 80).sort((a, b) => value[b] - value[a] + (M.preferRidges ? (ridgeSet.has(b) ? 0.08 : 0) - (ridgeSet.has(a) ? 0.08 : 0) : 0));
  for (const k of bandCand) {
    if (plSites.length >= nPl) break;
    const h = parseHexKey(k);
    if (plSites.some((p) => hexDistance(p.hex, h) < 4)) continue;
    plSites.push({ hex: h });
  }
  const topValue = Math.max(0.01, ...cand.map((k) => value[k]));
  // companies: group platoons left to right
  const xOf = (h: Hex) => map.centre_m(h).x;
  plSites.sort((a, b) => xOf(a.hex) - xOf(b.hex));
  const coyNames = 'ABCDEFGH';
  const coyOf = (i: number) => coyNames[Math.min(F.companies - 1, Math.floor(i / F.platoonsPerCompany))];
  const covOf = (h: Hex) => {
    const v = vs(h, 15);
    return pct([...approachHexes].filter((x) => v.has(x)).length, approachHexes.size);
  };
  plSites.forEach((s, i) => {
    const k = hexKey(s.hex);
    const coy = coyOf(i);
    const plNo = (i % F.platoonsPerCompany) + 1;
    const coverage = covOf(s.hex);
    const score = 0.55 * clamp01(value[k] / topValue) + 0.45 * clamp01(coverage / 30);
    positions.push({
      id: `${coy}${plNo}`,
      kind: 'platoon',
      name: `${coy} Coy / ${plNo} Pl`,
      company: coy,
      hex: s.hex,
      gr: gr(s.hex),
      itgId: s.itg?.id,
      distToBorder_m: distBorder_m(k),
      value: value[k],
      coveragePct: coverage,
      mutualSupport: [],
      rating: rate(score, P),
      reasons: [
        s.itg ? `On ${s.itg.name} (${s.itg.id}${s.itg.vital ? ', vital ground' : ''})` : 'Best remaining ground in the band',
        `${coverage}% of approach hexes observed within 1.5 km`,
        `${distBorder_m(k)} m from the border`,
      ],
    });
  });
  // defilade: hidden from the enemy's near side
  // enemy observation posts: the highest ground on the enemy side near the border
  const enemyOps: Hex[] = [];
  for (const k of [...enemy].filter((x) => (dB.get(x) ?? 99) <= 15).sort((a, b) => elev(parseHexKey(b)) - elev(parseHexKey(a)))) {
    const h = parseHexKey(k);
    if (enemyOps.length >= 24) break;
    if (enemyOps.some((o) => hexDistance(o, h) < 5)) continue;
    enemyOps.push(h);
  }
  const enemySeen = new Map<string, number>();
  for (const o of enemyOps) for (const k of vs(o)) enemySeen.set(k, (enemySeen.get(k) ?? 0) + 1);
  const exposure = (h: Hex) => enemySeen.get(hexKey(h)) ?? 0;
  const pickRear = (around: Hex, band_m: [number, number], radius: number): Hex | null => {
    let best: { h: Hex; s: number } | null = null;
    const base = distBorder_m(hexKey(around));
    for (const h of hexRange(around, radius)) {
      const k = hexKey(h);
      if (!own.has(k) || !map.has(h)) continue;
      const behind = distBorder_m(k) - base;
      if (behind < band_m[0] || behind > band_m[1]) continue;
      if ((slope[k] ?? 0) > 60) continue;
      const s = -exposure(h) * 2 - (access.get(k) ?? 0) / maxAccess - hexDistance(h, around) * 0.05;
      if (!best || s > best.s) best = { h, s };
    }
    return best?.h ?? null;
  };
  for (let c = 0; c < F.companies; c++) {
    const coy = coyNames[c];
    const pls = positions.filter((p) => p.company === coy && p.kind === 'platoon');
    if (!pls.length) continue;
    const cq = Math.round(pls.reduce((m, p) => m + p.hex.q, 0) / pls.length);
    const cr = Math.round(pls.reduce((m, p) => m + p.hex.r, 0) / pls.length);
    const hq = pickRear({ q: cq, r: cr }, F.coyHqDepth_m, 8) ?? pls[0].hex;
    positions.push({ id: `${coy}HQ`, kind: 'company_hq', name: `${coy} Coy HQ`, company: coy, hex: hq, gr: gr(hq), distToBorder_m: distBorder_m(hexKey(hq)), value: value[hexKey(hq)] ?? 0, coveragePct: 0, mutualSupport: [], rating: exposure(hq) === 0 ? 'good' : exposure(hq) <= 2 ? 'adequate' : 'not good', reasons: [`${exposure(hq)} enemy-side observation points can see it`, 'Behind its platoons, accessible from the rear'] });
  }
  const allPl = positions.filter((p) => p.kind === 'platoon');
  if (allPl.length) {
    const cq = Math.round(allPl.reduce((m, p) => m + p.hex.q, 0) / allPl.length);
    const cr = Math.round(allPl.reduce((m, p) => m + p.hex.r, 0) / allPl.length);
    const bn = pickRear({ q: cq, r: cr }, [M.reserveDepth_m * 0.5, M.reserveDepth_m * 1.5], 14) ?? allPl[0].hex;
    positions.push({ id: 'BNHQ', kind: 'bn_hq', name: 'Bn HQ', hex: bn, gr: gr(bn), distToBorder_m: distBorder_m(hexKey(bn)), value: 0, coveragePct: 0, mutualSupport: [], rating: exposure(bn) === 0 ? 'good' : 'adequate', reasons: [`${exposure(bn)} enemy-side observation points can see it`, 'Central, in depth'] });
    // reserve: in depth, central to the approaches' exits
    for (let rI = 0; rI < F.reserveCompanies; rI++) {
      const exits = approaches.map((a) => a.path.find((h) => distBorder_m(hexKey(h)) >= M.mainPositions_m[1] * 0.8) ?? a.path[a.path.length - 1]);
      let best: { h: Hex; s: number } | null = null;
      for (const k of own) {
        const d = distBorder_m(k);
        if (d < M.reserveDepth_m * 0.6 || d > M.reserveDepth_m * 1.4) continue;
        const h = parseHexKey(k);
        if ((slope[k] ?? 0) > 50 || positions.some((p) => hexDistance(p.hex, h) < 4)) continue;
        const s = -Math.max(0, ...exits.map((e) => hexDistance(e, h))) - exposure(h) * 0.5;
        if (!best || s > best.s) best = { h, s };
      }
      if (best) positions.push({ id: `RES${rI + 1}`, kind: 'reserve', name: `${coyNames[F.companies + rI] ?? 'R'} Coy (reserve)`, hex: best.h, gr: gr(best.h), distToBorder_m: distBorder_m(hexKey(best.h)), value: value[hexKey(best.h)] ?? 0, coveragePct: 0, mutualSupport: [], rating: 'good', reasons: [`Within ${Math.max(0, ...exits.map((e) => hexDistance(e, best!.h))) * hexM} m of every approach exit`, `${exposure(best.h)} enemy observation points can see it`] });
    }
  }
  // posts along the border
  const borderLine = (map.def.border?.hexes ?? [...borderSet].map(parseHexKey)).filter((h) => map.has(h));
  const postSites: Hex[] = [];
  const postHex = (near: Hex): Hex | null => {
    let best: { h: Hex; s: number } | null = null;
    const pool = hexRange(near, Math.ceil(M.posts_m[1] / hexM) + 1)
      .filter((h) => inBand(hexKey(h), M.posts_m))
      .sort((a, b) => elev(b) - elev(a))
      .slice(0, 10);
    for (const h of pool) {
      const v = vs(h, P.surveillance.range_hex);
      const seenB = borderLine.filter((b) => v.has(hexKey(b)) && hexDistance(b, h) <= P.surveillance.range_hex).length;
      const s = seenB + (1 - map.cell(h).terrain.cover) * 3 - hexDistance(h, near) * 0.3;
      if (!best || s > best.s) best = { h, s };
    }
    return best?.h ?? null;
  };
  const step = Math.max(1, Math.round(M.postSpacing_m / hexM));
  const crossings = M.postsAtCrossings ? approaches.map((a) => a.crossing).filter((x): x is Hex => !!x) : [];
  for (const c of crossings) {
    const h = postHex(c);
    if (h && !postSites.some((p) => hexDistance(p, h) < 2)) postSites.push(h);
  }
  for (let i = Math.floor(step / 2); i < borderLine.length; i += step) {
    const h = postHex(borderLine[i]);
    if (h && !postSites.some((p) => hexDistance(p, h) < Math.max(2, step / 2))) postSites.push(h);
  }
  postSites.sort((a, b) => xOf(a) - xOf(b));
  postSites.forEach((h, i) => {
    const atCrossing = crossings.some((c) => hexDistance(c, h) <= 3);
    const v = vs(h, P.surveillance.range_hex);
    const seen = borderLine.filter((b) => v.has(hexKey(b)) && hexDistance(b, h) <= P.surveillance.range_hex).length;
    positions.push({ id: `P${i + 1}`, kind: 'post', name: `Post ${i + 1}`, hex: h, gr: gr(h), distToBorder_m: distBorder_m(hexKey(h)), value: value[hexKey(h)] ?? 0, coveragePct: pct(seen, borderLine.length), mutualSupport: [], rating: rate(clamp01(seen / Math.max(4, step * 2)), P), reasons: [`Watches ${seen} border hexes`, atCrossing ? 'Covers an approach crossing point' : 'Spacing post on the border'] });
  });
  // mutual support between occupied positions
  const occ = positions.filter((p) => p.kind === 'platoon' || p.kind === 'post');
  for (const a of occ)
    a.mutualSupport = occ.filter((b) => b !== a && hexDistance(a.hex, b.hex) <= P.itg.mutualSupport_hex && lineOfSight(map, a.hex, b.hex, EYE).clear).map((b) => b.id);
  lap('deployment');

  // ---- DEP-6 border surveillance
  const observers = positions.filter((p) => p.kind === 'platoon' || p.kind === 'post');
  const observed = new Set<string>();
  for (const o of observers) for (const k of vs(o.hex, P.surveillance.range_hex)) observed.add(k);
  const seenBorder = borderLine.map((h) => observed.has(hexKey(h)));
  const gaps: Gap[] = [];
  for (let i = 0; i < borderLine.length; ) {
    if (seenBorder[i]) {
      i++;
      continue;
    }
    let j = i;
    while (j + 1 < borderLine.length && !seenBorder[j + 1]) j++;
    const length_m = (j - i + 1) * hexM;
    if (length_m >= P.surveillance.minGap_m) gaps.push({ from: borderLine[i], to: borderLine[j], grFrom: gr(borderLine[i]), grTo: gr(borderLine[j]), length_m });
    i = j + 1;
  }
  const observedPct = pct(seenBorder.filter(Boolean).length, borderLine.length);
  // TA-5 dead ground along approaches
  for (const a of approaches) {
    const seenByItg = a.path.filter((h) => itgs.some((i) => vs(i.hex).has(hexKey(h)))).length;
    a.deadGroundPct = Math.round(100 - pct(seenByItg, a.path.length));
    a.observedPct = pct(a.path.filter((h) => observed.has(hexKey(h))).length, a.path.length);
  }
  lap('surveillance');

  // ---- EN-1 infiltration (avoid observation, prefer cover)
  const nightSeen = new Set<string>();
  for (const o of observers) for (const k of vs(o.hex, P.infiltration.nightObservation_hex)) nightSeen.add(k);
  const infCost = (a: Hex, b: Hex) => {
    const c = footCost(a, b);
    if (c === null) return null;
    const k = hexKey(b);
    const conceal = map.cell(b).terrain.concealment;
    return c * (1 + (nightSeen.has(k) ? P.infiltration.exposurePenalty : 0) + (observed.has(k) ? 0.5 : 0)) * (1 - conceal * 0.4);
  };
  const infPaths = corridorPaths(P.infiltration.routes, infCost, 2, 3);
  const infiltration: Infiltration[] = infPaths.map((path, i) => {
    const crossing = path.find((h) => borderSet.has(hexKey(h))) ?? null;
    return {
      id: `I${i + 1}`,
      path,
      length_m: (path.length - 1) * hexM,
      time_min: Math.round(pathCost(path) * P.approaches.minutesPerMP),
      exposurePct: pct(path.filter((h) => nightSeen.has(hexKey(h))).length, path.length),
      deadGroundPct: Math.round(100 - pct(path.filter((h) => observed.has(hexKey(h))).length, path.length)),
      crossing,
      crossingGr: crossing ? gr(crossing) : '',
      rating: i === 0 ? 'most likely' : i === 1 ? 'likely' : 'possible',
    };
  });
  lap('infiltration');

  // ---- DEP-4 weapon sites
  const weapons: WeaponSite[] = [];
  const weaponTargets = new Set([...approachHexes, ...infiltration.flatMap((r) => r.path.map(hexKey))]);
  const covered = new Map<string, number>();
  const platoonPos = positions.filter((p) => p.kind === 'platoon');
  const order2 = Object.entries(F.weapons).flatMap(([wid, n]) => Array.from({ length: n }, () => wid)).filter((wid) => data.weapons.has(wid));
  order2.forEach((wid, idx) => {
    const wpn = data.weapon(wid);
    const eff = effectiveRange(wpn);
    const at = wpn.lethality.hard >= 0.5;
    const targets = [...weaponTargets].filter((k) => !at || map.cell(parseHexKey(k)).terrain.moveCost.tracked !== null);
    let best: { h: Hex; pos: Position; s: number; cov: string[] } | null = null;
    for (const p of platoonPos) {
      for (const h of hexRange(p.hex, 1)) {
        const k = hexKey(h);
        if (!own.has(k) || weapons.some((x) => hexKey(x.hex) === k)) continue;
        const v = vs(h, Math.max(eff, 3));
        const cov = targets.filter((t) => {
          const d = hexDistance(parseHexKey(t), h);
          return d >= wpn.minRange && d <= eff && v.has(t);
        });
        const s = cov.reduce((m, t) => m + ((covered.get(t) ?? 0) === 0 ? 1 : 0.3), 0) + (1 - map.cell(h).terrain.cover);
        if (!best || s > best.s) best = { h, pos: p, s, cov };
      }
    }
    if (!best) return;
    for (const t of best.cov) covered.set(t, (covered.get(t) ?? 0) + 1);
    const appIds = approaches.filter((a) => a.path.some((x) => best!.cov.includes(hexKey(x)))).map((a) => a.id);
    const cp = pct(best.cov.length, targets.length);
    weapons.push({ id: `W${idx + 1}`, weaponId: wid, name: `${wpn.name} ${idx + 1}`, hex: best.h, gr: gr(best.h), positionId: best.pos.id, effRange_m: eff * hexM, coveragePct: cp, approaches: appIds, rating: rate(clamp01(cp / 30), P) });
  });
  lap('weapons');

  // ---- DEP-5 mortars: defiladed base plates, coverage and interlocking fire
  const mortarTargets = new Set<string>([...approachHexes, ...infiltration.flatMap((r) => r.path.map(hexKey))].filter((k) => (dB.get(k) ?? 99) <= 20));
  const mCand = [...own].filter((k) => {
    const d = distBorder_m(k);
    return d >= 500 && d <= 3000 && (slope[k] ?? 99) <= 40;
  });
  const mCover = new Map<string, number>();
  const mortarSites: MortarSite[] = [];
  const mList = Object.entries(F.mortars).flatMap(([wid, n]) => Array.from({ length: n }, () => wid)).filter((wid) => data.weapons.has(wid));
  mList.forEach((wid, i) => {
    const wpn = data.weapon(wid);
    let best: { h: Hex; s: number; cov: string[] } | null = null;
    for (const k of mCand) {
      const h = parseHexKey(k);
      if (mortarSites.some((m) => hexDistance(m.hex, h) < 4)) continue;
      const cov = [...mortarTargets].filter((t) => {
        const d = hexDistance(parseHexKey(t), h);
        return d >= wpn.minRange && d <= wpn.maxRange;
      });
      const s = cov.reduce((m, t) => m + ((mCover.get(t) ?? 0) === 0 ? 1 : (mCover.get(t) ?? 0) === 1 ? 0.6 : 0.1), 0) - exposure(h) * 5;
      if (!best || s > best.s) best = { h, s, cov };
    }
    if (!best) return;
    for (const t of best.cov) mCover.set(t, (mCover.get(t) ?? 0) + 1);
    mortarSites.push({ id: `M${i + 1}`, weaponId: wid, name: `${wpn.name} sec ${i + 1}`, hex: best.h, gr: gr(best.h), minRange_m: wpn.minRange * hexM, maxRange_m: wpn.maxRange * hexM, coveragePct: pct(best.cov.length, mortarTargets.size) });
  });
  const mCovered = [...mortarTargets].filter((t) => (mCover.get(t) ?? 0) >= 1).length;
  const mInter = [...mortarTargets].filter((t) => (mCover.get(t) ?? 0) >= 2).length;
  const mGaps = [...mortarTargets].filter((t) => !(mCover.get(t) ?? 0));
  const interlockPct = pct(mInter, mortarTargets.size);
  lap('mortars');

  // ---- EN-2 exploitable features
  const exploitable: ExploitableFeature[] = [];
  for (const a of approaches) if (a.crossing) exploitable.push({ kind: a.kind === 'ridge' ? 'ridge' : 'valley', name: `${a.id} border crossing (${a.kind})`, hex: a.crossing, gr: a.crossingGr, note: `${a.capacity}-size approach, ${a.width_m} m wide, ${a.deadGroundPct}% dead ground from key ground` });
  for (const r of ridges.filter((x) => x.crossesBorder).slice(0, 4)) {
    const h = r.hexes.find((x) => (dB.get(hexKey(x)) ?? 99) <= 1)!;
    exploitable.push({ kind: 'ridge', name: `Ridgeline ${r.id}`, hex: h, gr: gr(h), note: `Spur/ridge crossing the border (${r.length_m} m, top ${r.maxElev} m): a covered line of advance along the crest` });
  }
  {
    const heads = [...nullah].filter((k) => (dB.get(k) ?? 99) <= 1 && own.has(k) === false);
    const picked: Hex[] = [];
    for (const k of heads.sort((a, b) => (acc.get(b) ?? 0) - (acc.get(a) ?? 0))) {
      const h = parseHexKey(k);
      if (picked.some((p) => hexDistance(p, h) < 6) || picked.length >= 4) continue;
      picked.push(h);
      exploitable.push({ kind: 'nullah', name: `Nullah at ${gr(h)}`, hex: h, gr: gr(h), note: `Drainage line crossing the border (catchment ${acc.get(k)} hexes): dead ground for infiltration` });
    }
  }

  // ---- EN-3 enemy attack options (3-4)
  const options: AttackOption[] = [];
  type Obj = { id: string; name: string; gr: string; hex: Hex; value: number; vital: boolean; occupied: boolean };
  const coyObjs: Obj[] = [];
  for (let c = 0; c < F.companies; c++) {
    const pls = positions.filter((p) => p.kind === 'platoon' && p.company === coyNames[c]);
    if (!pls.length) continue;
    const best = [...pls].sort((a, b) => b.value - a.value)[0];
    coyObjs.push({ id: `${coyNames[c]}COY`, name: `${coyNames[c]} Coy locality`, gr: best.gr, hex: best.hex, value: best.value, vital: false, occupied: true });
  }
  const targetsFor: Obj[] = [...itgs, ...coyObjs];
  const maxTime = Math.max(1, ...approaches.map((a) => a.time_min));
  const combos: AttackOption[] = [];
  for (const a of approaches) {
    for (const o of targetsFor) {
      const near = a.path.findIndex((h) => hexDistance(h, o.hex) <= 6);
      if (near < 0) continue;
      const axis = a.path.slice(0, near + 1);
      let fup: Hex | null = null;
      for (let j = axis.length - 1; j >= 0; j--) {
        const d = hexDistance(axis[j], o.hex);
        if (d >= 6 && d <= 14 && !observed.has(hexKey(axis[j]))) {
          fup = axis[j];
          break;
        }
      }
      const exp = pct(axis.filter((h) => observed.has(hexKey(h))).length, axis.length) / 100;
      const time = Math.round(pathCost(axis) * P.approaches.minutesPerMP);
      const score = 0.3 * o.value + 0.25 * (a.deadGroundPct / 100) + 0.2 * (1 - time / maxTime) + 0.15 * (1 - exp) + (fup ? 0.1 : 0) + (o.vital ? 0.05 : 0) + (o.occupied ? 0.05 : 0);
      combos.push({
        id: '',
        name: `${a.name} onto ${o.name}`,
        approachId: a.id,
        objectiveId: o.id,
        fup,
        fupGr: fup ? gr(fup) : '',
        axis,
        time_min: time,
        exposurePct: Math.round(exp * 100),
        deadGroundPct: a.deadGroundPct,
        score: Math.round(score * 100) / 100,
        likelihood: 'possible',
        summary: '',
      });
    }
  }
  combos.sort((x, y) => y.score - x.score);
  const perApproach = new Map<string, number>();
  for (const c of combos) {
    if (options.length >= 4) break;
    if ((perApproach.get(c.approachId) ?? 0) >= 2 || options.some((o) => o.objectiveId === c.objectiveId && o.approachId === c.approachId)) continue;
    perApproach.set(c.approachId, (perApproach.get(c.approachId) ?? 0) + 1);
    c.id = `E${options.length + 1}`;
    c.likelihood = options.length === 0 ? 'most likely' : options.length === 1 ? 'likely' : 'possible';
    const o = targetsFor.find((i) => i.id === c.objectiveId)!;
    c.summary = `Advance along ${c.approachId} (${c.time_min} min for dismounted troops), ${c.fup ? `form up in dead ground at ${c.fupGr}` : 'no covered forming-up place'}, assault ${o.name} (${o.gr}). ${c.exposurePct}% of the axis is under own observation.`;
    options.push(c);
  }
  lap('enemy');

  // ---- OUT-1 ratings and recommendations
  const rec: Recommendation[] = [];
  for (const i of itgs) {
    if (!i.occupied && i.value >= P.ratings.good) rec.push({ severity: i.vital ? 'critical' : 'warn', text: `Key ground ${i.name} (${i.gr}, value ${Math.round(i.value * 100)}%) is not occupied: occupy it or cover it by an OP and fire.`, hex: i.hex });
  }
  for (const a of approaches) {
    if (a.deadGroundPct >= 40) {
      const dg = a.path.find((h) => !observed.has(hexKey(h)) && own.has(hexKey(h)));
      rec.push({ severity: a.deadGroundPct >= 60 ? 'critical' : 'warn', text: `${a.name}: ${a.deadGroundPct}% dead ground from key ground. Site an OP / MMG to see ${dg ? `GR ${gr(dg)}` : 'it'} or plan mortar DF on the dead ground.`, hex: dg });
    }
  }
  for (const g of gaps) rec.push({ severity: g.length_m >= 600 ? 'critical' : 'warn', text: `Unobserved border ${g.grFrom} – ${g.grTo} (${g.length_m} m): add a post or patrol it.`, hex: g.from });
  for (const p of positions.filter((x) => x.kind === 'platoon' && !x.mutualSupport.length)) rec.push({ severity: 'warn', text: `${p.name} (${p.gr}) has no mutual support within ${P.itg.mutualSupport_hex * hexM} m: adjust siting or add a supporting position.`, hex: p.hex });
  if (interlockPct < 50) rec.push({ severity: 'warn', text: `Mortar interlock only ${interlockPct}% of approach / infiltration ground: move a section to cover ${mGaps.length ? `GR ${gr(parseHexKey(mGaps[0]))}` : 'the gaps'}.` });
  for (const r of infiltration.filter((x) => x.exposurePct < 20)) rec.push({ severity: 'warn', text: `Infiltration route ${r.id} is ${100 - r.exposurePct}% unobserved at night: place an LP / ambush at ${r.crossingGr || 'its border crossing'}.`, hex: r.crossing ?? undefined });
  const scoreParts = [
    clamp01(observedPct / 100),
    clamp01(1 - approaches.reduce((m, a) => m + a.deadGroundPct, 0) / Math.max(1, approaches.length) / 100),
    clamp01(interlockPct / 100 + 0.2),
    itgs.length ? clamp01(itgs.filter((i) => i.occupied).length / Math.min(itgs.length, nPl)) : 1,
  ];
  const score = Math.round((scoreParts.reduce((m, x) => m + x, 0) / scoreParts.length) * 100) / 100;
  const lines = [
    `${M.label}: ${allPl.length} platoon positions, ${positions.filter((p) => p.kind === 'post').length} posts, ${weapons.length} weapon sites, ${mortarSites.length} mortar sections.`,
    `Key ground: ${itgs.length} ITGs (${itgs.filter((i) => i.occupied).length} occupied); vital ground ${itgs.find((i) => i.vital)?.name ?? '—'}.`,
    `Border observed: ${observedPct}% (${gaps.length} gaps). Mortar coverage ${pct(mCovered, mortarTargets.size)}%, interlock ${interlockPct}%.`,
    `Enemy: ${approaches.length} approaches, ${infiltration.length} infiltration routes; most likely option ${options[0]?.name ?? '—'}.`,
  ];
  lap('ratings');

  return {
    mapId: map.def.id,
    mode,
    modeLabel: M.label,
    paramsSource: P.source,
    aoiHexes: aoi.size,
    terrain: {
      minElev: Math.round(Math.min(...[...aoi].map((k) => elev(parseHexKey(k))))),
      maxElev: Math.round(Math.max(...[...aoi].map((k) => elev(parseHexKey(k))))),
      meanSlopePct: Math.round(sumSlope / Math.max(1, aoi.size)),
      steepPct: pct(steep, aoi.size),
      veryStepPct: pct(verySteep, aoi.size),
      slope,
      aspect,
      dominance,
      value,
      nullahs: [...nullah],
      ridges,
      peaks,
    },
    territory: { own: [...own], enemy: [...enemy], border: [...borderSet] },
    approaches,
    itgs,
    mutualSupport,
    deployment: {
      positions,
      weapons,
      mortars: { sites: mortarSites, targetHexes: mortarTargets.size, coveredPct: pct(mCovered, mortarTargets.size), interlockPct, gaps: mGaps, rating: rate(clamp01(interlockPct / 100 + 0.2), P) },
      surveillance: { borderLength_m: borderLine.length * hexM, observedPct, gaps, rating: rate(observedPct / 100, P) },
      observed: [...observed],
    },
    enemy: { infiltration, exploitable, options },
    summary: { overall: rate(score, P), score, lines },
    recommendations: rec,
    timings,
  };
}

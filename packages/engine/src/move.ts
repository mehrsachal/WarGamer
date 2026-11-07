// MOV-03 / MOV-04 / MOV-05 — movement costs, move bands and reachable hexes.
// Step cost = terrain cost (destination hex, by mobility class) — or the road cost when a road crosses the
// shared edge — + edge feature modifiers (cancelled by a bridge on the same edge) + uphill slope penalty.
import { edgeCrossable } from './data/ruleset';
import type { GroundMobility, MobilityClass, UnitType } from './data/schema';
import { type Hex, hexKey, hexNeighbors } from './hex';
import type { GameContext, Status } from './state';

export interface StepCostBreakdown {
  cost: number | null;
  terrain: number | null;
  road: boolean;
  edges: number;
  slope: number;
  slopePct: number;
  reason?: 'off_map' | 'terrain' | 'edge' | 'slope';
}

/** Cost for a unit of `mobility` to move from a hex to an adjacent hex (null = impassable). */
export function stepCostDetail(ctx: GameContext, mobility: MobilityClass, from: Hex, to: Hex): StepCostBreakdown {
  const { map, data } = ctx;
  const dest = map.get(to);
  if (!dest || !map.has(from)) return { cost: null, terrain: null, road: false, edges: 0, slope: 0, slopePct: 0, reason: 'off_map' };
  if (mobility === 'air') return { cost: 1, terrain: 1, road: false, edges: 0, slope: 0, slopePct: 0 };
  const cls = mobility as GroundMobility;
  const features = map.edgeFeatures(from, to);
  if (!edgeCrossable(features, cls)) return { cost: null, terrain: null, road: false, edges: 0, slope: 0, slopePct: 0, reason: 'edge' };
  const roads = features.filter((f) => f.roadCost && f.roadCost[cls] !== null);
  const terrainCost = dest.terrain.moveCost[cls];
  let base: number | null;
  let road = false;
  if (roads.length) {
    base = Math.min(...roads.map((f) => f.roadCost![cls] as number));
    road = true;
  } else base = terrainCost;
  if (base === null) return { cost: null, terrain: null, road: false, edges: 0, slope: 0, slopePct: 0, reason: 'terrain' };
  const crossing = features.some((f) => f.providesCrossing?.includes(cls));
  let edges = 0;
  for (const f of features) {
    if (f.roadCost || f.providesCrossing) continue;
    if (crossing && !f.blocksLOS) continue; // the bridge spans the water obstacle
    const m = f.moveCostModifier[cls];
    if (m !== null) edges += m;
  }
  const rise = dest.elevation_m - map.elevation(from);
  const slopePct = rise > 0 ? (rise / map.def.hexSize_m) * 100 : 0;
  let slope = 0;
  if (slopePct > 0) {
    const bands = data.rules.move.slopeBands;
    const band = bands.find((b) => slopePct <= b.maxPct) ?? bands[bands.length - 1];
    const add = band.add[cls];
    if (add === null) return { cost: null, terrain: base, road, edges, slope: 0, slopePct, reason: 'slope' };
    slope = add;
  }
  return { cost: Math.max(0.1, base + edges + slope), terrain: base, road, edges, slope, slopePct };
}

export function stepCost(ctx: GameContext, mobility: MobilityClass, from: Hex, to: Hex): number | null {
  return stepCostDetail(ctx, mobility, from, to).cost;
}

/** The minimum a mover needs to know about a unit. */
export interface MoverLike {
  typeId: string;
  hex: Hex | null;
  mpSpent: number;
  shots: number;
  status: Status;
}

export interface Allowance {
  total: number;
  tactical: number;
  spent: number;
  /** Highest cumulative MP the unit may reach this turn (tactical only after firing). */
  limit: number;
}

export function allowance(ctx: GameContext, u: MoverLike): Allowance {
  const t = ctx.data.unitType(u.typeId);
  const total = t.movePoints * (u.status === 'S' ? ctx.data.rules.suppression.moveFactor : 1);
  const tactical = total * ctx.data.rules.move.tacticalFraction;
  const limit = u.shots > 0 ? Math.min(total, tactical) : total;
  return { total, tactical, spent: u.mpSpent, limit };
}

export interface ReachNode {
  hex: Hex;
  /** MP spent this turn on arrival (includes MP already spent before this move). */
  cost: number;
  prev?: string;
  band: 'tactical' | 'dash';
  /** False when the hex is full (stacking) — may pass through but not stop. */
  canStop: boolean;
}

export interface ReachOptions {
  /** Hexes the mover may not enter (known enemy ground units). */
  blocked?: ReadonlySet<string>;
  /** Ground units already in each hex (stacking). */
  occupancy?: ReadonlyMap<string, number>;
}

/** Dijkstra over the hexes the unit can reach this turn (MOV-03). */
export function reachable(ctx: GameContext, u: MoverLike, opts: ReachOptions = {}): Map<string, ReachNode> {
  const out = new Map<string, ReachNode>();
  if (!u.hex) return out;
  const type: UnitType = ctx.data.unitType(u.typeId);
  const a = allowance(ctx, u);
  const maxStack = ctx.data.rules.stacking.maxUnitsPerHex;
  const startKey = hexKey(u.hex);
  out.set(startKey, { hex: u.hex, cost: a.spent, band: a.spent <= a.tactical + 1e-9 ? 'tactical' : 'dash', canStop: true });
  const open: string[] = [startKey];
  while (open.length) {
    let bi = 0;
    for (let i = 1; i < open.length; i++) if (out.get(open[i])!.cost < out.get(open[bi])!.cost) bi = i;
    const k = open.splice(bi, 1)[0];
    const node = out.get(k)!;
    for (const n of hexNeighbors(node.hex)) {
      const nk = hexKey(n);
      if (!type.isAir && opts.blocked?.has(nk)) continue;
      const c = stepCost(ctx, type.mobilityClass, node.hex, n);
      if (c === null) continue;
      const cost = node.cost + c;
      if (cost > a.limit + 1e-9) continue;
      const prev = out.get(nk);
      if (prev && prev.cost <= cost + 1e-9) continue;
      const canStop = type.isAir || (opts.occupancy?.get(nk) ?? 0) < maxStack;
      out.set(nk, { hex: n, cost, prev: k, band: cost <= a.tactical + 1e-9 ? 'tactical' : 'dash', canStop });
      if (!open.includes(nk)) open.push(nk);
    }
  }
  return out;
}

/** Path (start excluded) to a reached hex. */
export function pathTo(reach: Map<string, ReachNode>, to: Hex): Hex[] | null {
  let k: string | undefined = hexKey(to);
  if (!reach.has(k)) return null;
  const path: Hex[] = [];
  while (k) {
    const n: ReachNode = reach.get(k)!;
    if (!n.prev) break;
    path.unshift(n.hex);
    k = n.prev;
  }
  return path;
}

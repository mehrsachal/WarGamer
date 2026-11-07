// VIS-01 — hex-to-hex line of sight.
// The sight line runs from observer eye (ground + eye height, or + sensor altitude for UAVs) to the target
// (ground + target height). Every INTERMEDIATE hex blocks if its ground + obstacle height (trees, buildings)
// rises above the line at that point; the observer's and target's own hexes never block. Edge features that
// block LOS (bunds, ridgelines) are tested at the midpoint between the two hexes they separate, using the
// higher of the two grounds + the feature height. A line that runs exactly along hex edges is tested with a
// tiny offset to each side; sight is clear if either side is clear (documented in docs/rules.md).
import type { MapModel } from './data/ruleset';
import { type Hex, hexDistance, hexKey, hexLine } from './hex';

export interface LosOptions {
  /** Observer height above the ground of its hex (eye height or sensor altitude). */
  observerHeight_m: number;
  /** Height of the target above the ground of its hex. */
  targetHeight_m: number;
  /** Hexes with smoke (FS-05): treated as an opaque obstacle of this height. */
  smoke?: ReadonlySet<string>;
  smokeHeight_m?: number;
}

export interface LosSample {
  /** Position along the line, 0 = observer, 1 = target. */
  t: number;
  hex: Hex;
  /** Ground elevation at this sample. */
  ground: number;
  /** Top of whatever stands there (ground + obstacle). */
  top: number;
  /** Height of the sight line at this sample. */
  line: number;
  /** Sample is on an edge between two hexes (bund, ridge) rather than a hex centre. */
  edge?: string;
  blocks: boolean;
}

export interface LosResult {
  clear: boolean;
  distance: number;
  /** First blocking sample (if blocked). */
  blockedBy?: LosSample;
  /** Terrain profile along the line actually used (VIS-06 profile chart). */
  profile: LosSample[];
}

function traceLine(map: MapModel, line: Hex[], opts: LosOptions): LosResult {
  const n = line.length - 1;
  const from = line[0];
  const to = line[n];
  const z0 = map.elevation(from) + opts.observerHeight_m;
  const z1 = map.elevation(to) + opts.targetHeight_m;
  const at = (t: number) => z0 + (z1 - z0) * t;
  const profile: LosSample[] = [];
  let blockedBy: LosSample | undefined;
  const push = (s: LosSample) => {
    profile.push(s);
    if (s.blocks && !blockedBy) blockedBy = s;
  };
  push({ t: 0, hex: from, ground: map.elevation(from), top: map.elevation(from), line: z0, blocks: false });
  for (let i = 0; i < n; i++) {
    const a = line[i];
    const b = line[i + 1];
    // edge between a and b
    const edgeBlockers = map.edgeFeatures(a, b).filter((f) => f.blocksLOS);
    if (edgeBlockers.length && map.has(a) && map.has(b)) {
      const t = (i + 0.5) / n;
      const ground = Math.max(map.elevation(a), map.elevation(b));
      const top = ground + Math.max(...edgeBlockers.map((f) => f.losHeight_m));
      const lineZ = at(t);
      push({ t, hex: a, ground, top, line: lineZ, edge: edgeBlockers.map((f) => f.id).join('+'), blocks: top > lineZ + 1e-9 });
    }
    if (i + 1 < n) {
      const c = map.get(b);
      const t = (i + 1) / n;
      const lineZ = at(t);
      if (!c) {
        push({ t, hex: b, ground: Math.min(z0, z1), top: Math.min(z0, z1), line: lineZ, blocks: false });
        continue;
      }
      let top = c.elevation_m + c.terrain.losHeight_m;
      if (opts.smoke?.has(hexKey(b))) top = Math.max(top, c.elevation_m + (opts.smokeHeight_m ?? 25));
      push({ t, hex: b, ground: c.elevation_m, top, line: lineZ, blocks: top > lineZ + 1e-9 });
    }
  }
  push({ t: 1, hex: to, ground: map.elevation(to), top: map.elevation(to), line: z1, blocks: false });
  return { clear: !blockedBy, distance: n, blockedBy, profile };
}

/** Line of sight between two on-map hexes. */
export function lineOfSight(map: MapModel, from: Hex, to: Hex, opts: LosOptions): LosResult {
  const n = hexDistance(from, to);
  if (n === 0) {
    const g = map.elevation(from);
    return { clear: true, distance: 0, profile: [{ t: 0, hex: from, ground: g, top: g, line: g + opts.observerHeight_m, blocks: false }] };
  }
  const a = traceLine(map, hexLine(from, to, 1), opts);
  if (a.clear) return a;
  const b = traceLine(map, hexLine(from, to, -1), opts);
  return b.clear ? b : a;
}

/** Every on-map hex within `range` that the observer can see (VIS-02 viewshed). */
export function viewshed(map: MapModel, from: Hex, range: number, opts: LosOptions): Set<string> {
  const out = new Set<string>([hexKey(from)]);
  for (const c of map.list) {
    const d = hexDistance(from, c);
    if (d === 0 || d > range) continue;
    if (lineOfSight(map, from, c, opts).clear) out.add(hexKey(c));
  }
  return out;
}

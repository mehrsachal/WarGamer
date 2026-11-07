// MAP-01 — hex grid maths (axial / cube coordinates, Red Blob Games model).
// Axial (q, r); cube s = -q - r. Direction 0 is "east" for pointy-top and "south-east" for flat-top;
// the numbering is the same for both layouts because it is defined on the axial lattice.

export interface Hex {
  q: number;
  r: number;
}

export type Orientation = 'flat' | 'pointy';

export const DIRECTIONS: readonly Hex[] = [
  { q: 1, r: 0 },
  { q: 1, r: -1 },
  { q: 0, r: -1 },
  { q: -1, r: 0 },
  { q: -1, r: 1 },
  { q: 0, r: 1 },
];

export function hex(q: number, r: number): Hex {
  return { q, r };
}

export function hexKey(h: Hex): string {
  return `${h.q},${h.r}`;
}

export function parseHexKey(k: string): Hex {
  const [q, r] = k.split(',').map(Number);
  return { q, r };
}

export function hexEquals(a: Hex, b: Hex): boolean {
  return a.q === b.q && a.r === b.r;
}

export function hexAdd(a: Hex, b: Hex): Hex {
  return { q: a.q + b.q, r: a.r + b.r };
}

export function hexSub(a: Hex, b: Hex): Hex {
  return { q: a.q - b.q, r: a.r - b.r };
}

export function hexNeighbor(h: Hex, dir: number): Hex {
  const d = DIRECTIONS[((dir % 6) + 6) % 6];
  return { q: h.q + d.q, r: h.r + d.r };
}

export function hexNeighbors(h: Hex): Hex[] {
  return DIRECTIONS.map((d) => ({ q: h.q + d.q, r: h.r + d.r }));
}

/** Direction index (0..5) from a to an adjacent hex b, or -1 if not adjacent. */
export function directionTo(a: Hex, b: Hex): number {
  const dq = b.q - a.q;
  const dr = b.r - a.r;
  return DIRECTIONS.findIndex((d) => d.q === dq && d.r === dr);
}

export function oppositeDir(dir: number): number {
  return (dir + 3) % 6;
}

export function hexDistance(a: Hex, b: Hex): number {
  const dq = a.q - b.q;
  const dr = a.r - b.r;
  return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
}

/** All hexes at exactly `radius` steps from `center` (radius 0 = the centre itself). */
export function hexRing(center: Hex, radius: number): Hex[] {
  if (radius === 0) return [{ ...center }];
  const out: Hex[] = [];
  let h: Hex = { q: center.q + DIRECTIONS[4].q * radius, r: center.r + DIRECTIONS[4].r * radius };
  for (let side = 0; side < 6; side++) {
    for (let step = 0; step < radius; step++) {
      out.push(h);
      h = hexNeighbor(h, side);
    }
  }
  return out;
}

/** All hexes within `radius` steps of `center` (inclusive). */
export function hexRange(center: Hex, radius: number): Hex[] {
  const out: Hex[] = [];
  for (let dq = -radius; dq <= radius; dq++) {
    for (let dr = Math.max(-radius, -dq - radius); dr <= Math.min(radius, -dq + radius); dr++) {
      out.push({ q: center.q + dq, r: center.r + dr });
    }
  }
  return out;
}

interface Cube {
  x: number;
  y: number;
  z: number;
}

function cubeRound(c: Cube): Hex {
  let rx = Math.round(c.x);
  let ry = Math.round(c.y);
  let rz = Math.round(c.z);
  const dx = Math.abs(rx - c.x);
  const dy = Math.abs(ry - c.y);
  const dz = Math.abs(rz - c.z);
  if (dx > dy && dx > dz) rx = -ry - rz;
  else if (dy > dz) ry = -rx - rz;
  else rz = -rx - ry;
  return { q: rx + 0, r: rz + 0 };
}

/** Round fractional axial coordinates to the containing hex. */
export function hexRound(q: number, r: number): Hex {
  return cubeRound({ x: q, y: -q - r, z: r });
}

/**
 * Hexes on the straight line from a to b inclusive (cube lerp + rounding).
 * `nudge` (+1 / -1 / 0) offsets the endpoints by a tiny epsilon so that lines running exactly along
 * a hex edge resolve consistently to one side; LOS checks both nudges (see los.ts).
 */
export function hexLine(a: Hex, b: Hex, nudge: 1 | -1 | 0 = 1): Hex[] {
  const n = hexDistance(a, b);
  if (n === 0) return [{ ...a }];
  const e = 1e-6 * nudge;
  const ax = a.q + e;
  const az = a.r + e;
  const ay = -ax - az + 0; // keeps x + y + z = 0 after the nudge
  const bx = b.q + e;
  const bz = b.r + e;
  const by = -bx - bz;
  const out: Hex[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    out.push(cubeRound({ x: ax + (bx - ax) * t, y: ay + (by - ay) * t, z: az + (bz - az) * t }));
  }
  return out;
}

// ---------------------------------------------------------------- layout (pixels / metres)

export interface Point {
  x: number;
  y: number;
}

/**
 * Centre of a hex in a plane where adjacent hex centres are `spacing` apart (metres or pixels).
 * y grows downwards (screen convention); map "north" is up.
 */
export function hexToPoint(h: Hex, orientation: Orientation, spacing: number): Point {
  const size = spacing / Math.sqrt(3); // centre-to-corner radius
  if (orientation === 'flat') {
    return { x: size * 1.5 * h.q, y: size * Math.sqrt(3) * (h.r + h.q / 2) };
  }
  return { x: size * Math.sqrt(3) * (h.q + h.r / 2), y: size * 1.5 * h.r };
}

export function pointToHex(p: Point, orientation: Orientation, spacing: number): Hex {
  const size = spacing / Math.sqrt(3);
  if (orientation === 'flat') {
    const q = ((2 / 3) * p.x) / size;
    const r = ((-1 / 3) * p.x + (Math.sqrt(3) / 3) * p.y) / size;
    return hexRound(q, r);
  }
  const q = ((Math.sqrt(3) / 3) * p.x - (1 / 3) * p.y) / size;
  const r = ((2 / 3) * p.y) / size;
  return hexRound(q, r);
}

/** The six corners of a hex (same plane as hexToPoint). */
export function hexCorners(h: Hex, orientation: Orientation, spacing: number): Point[] {
  const c = hexToPoint(h, orientation, spacing);
  const size = spacing / Math.sqrt(3);
  const start = orientation === 'flat' ? 0 : 30;
  return Array.from({ length: 6 }, (_, i) => {
    const a = ((start + 60 * i) * Math.PI) / 180;
    return { x: c.x + size * Math.cos(a), y: c.y + size * Math.sin(a) };
  });
}

/** Endpoints of the edge shared between a hex and its neighbour in `dir`. */
export function edgeSegment(h: Hex, dir: number, orientation: Orientation, spacing: number): [Point, Point] {
  const a = hexToPoint(h, orientation, spacing);
  const b = hexToPoint(hexNeighbor(h, dir), orientation, spacing);
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const half = spacing / Math.sqrt(3) / 2; // half the edge length
  const px = (-dy / len) * half;
  const py = (dx / len) * half;
  return [
    { x: mid.x + px, y: mid.y + py },
    { x: mid.x - px, y: mid.y - py },
  ];
}

// ---------------------------------------------------------------- rectangular maps (offset coords)

/** Offset (col,row) -> axial. Flat-top uses "odd-q", pointy-top uses "odd-r". */
export function offsetToAxial(col: number, row: number, orientation: Orientation): Hex {
  if (orientation === 'flat') return { q: col, r: row - (col - (col & 1)) / 2 };
  return { q: col - (row - (row & 1)) / 2, r: row };
}

export function axialToOffset(h: Hex, orientation: Orientation): { col: number; row: number } {
  if (orientation === 'flat') return { col: h.q, row: h.r + (h.q - (h.q & 1)) / 2 };
  return { col: h.q + (h.r - (h.r & 1)) / 2, row: h.r };
}

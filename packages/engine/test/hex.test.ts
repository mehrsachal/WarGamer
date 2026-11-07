// MAP-01 — distance and neighbour functions pass unit tests.
import { describe, expect, it } from 'vitest';
import {
  DIRECTIONS,
  axialToOffset,
  directionTo,
  edgeSegment,
  hexCorners,
  hexDistance,
  hexKey,
  hexLine,
  hexNeighbor,
  hexNeighbors,
  hexRange,
  hexRing,
  hexToPoint,
  offsetToAxial,
  oppositeDir,
  parseHexKey,
  pointToHex,
  hexAdd,
  hexSub,
  hexEquals,
  hex,
} from '../src/hex';

describe('hex math (MAP-01)', () => {
  it('distance is the cube metric', () => {
    expect(hexDistance({ q: 0, r: 0 }, { q: 0, r: 0 })).toBe(0);
    expect(hexDistance({ q: 0, r: 0 }, { q: 3, r: 0 })).toBe(3);
    expect(hexDistance({ q: 0, r: 0 }, { q: 2, r: -1 })).toBe(2);
    expect(hexDistance({ q: -2, r: 3 }, { q: 1, r: -1 })).toBe(4);
    expect(hexDistance({ q: 5, r: -2 }, { q: 1, r: 4 })).toBe(6);
  });

  it('has six neighbours at distance 1 and directions are reversible', () => {
    const c = { q: 4, r: -2 };
    const ns = hexNeighbors(c);
    expect(ns).toHaveLength(6);
    for (const [i, n] of ns.entries()) {
      expect(hexDistance(c, n)).toBe(1);
      expect(directionTo(c, n)).toBe(i);
      expect(hexNeighbor(n, oppositeDir(i))).toEqual(c);
    }
    expect(directionTo(c, { q: 9, r: 9 })).toBe(-1);
    expect(hexNeighbor(c, -1)).toEqual(hexNeighbor(c, 5));
    expect(DIRECTIONS).toHaveLength(6);
  });

  it('rings and ranges have the right sizes', () => {
    expect(hexRing({ q: 0, r: 0 }, 0)).toEqual([{ q: 0, r: 0 }]);
    for (const n of [1, 2, 5]) {
      const ring = hexRing({ q: 1, r: 1 }, n);
      expect(ring).toHaveLength(6 * n);
      expect(ring.every((h) => hexDistance(h, { q: 1, r: 1 }) === n)).toBe(true);
      expect(new Set(ring.map(hexKey)).size).toBe(6 * n);
    }
    expect(hexRange({ q: 0, r: 0 }, 3)).toHaveLength(1 + 3 * 3 * 4);
  });

  it('lines connect endpoints with distance + 1 contiguous hexes', () => {
    const a = { q: 0, r: 0 };
    const b = { q: 7, r: -3 };
    for (const nudge of [1, -1, 0] as const) {
      const line = hexLine(a, b, nudge);
      expect(line).toHaveLength(hexDistance(a, b) + 1);
      expect(line[0]).toEqual(a);
      expect(line[line.length - 1]).toEqual(b);
      for (let i = 1; i < line.length; i++) expect(hexDistance(line[i - 1], line[i])).toBe(1);
    }
    expect(hexLine(a, a)).toEqual([a]);
  });

  it('an edge-grazing line resolves to different sides with the two nudges', () => {
    // (0,0) -> (2,-1) passes exactly between (1,-1) and (1,0)
    const up = hexLine({ q: 0, r: 0 }, { q: 2, r: -1 }, 1)[1];
    const down = hexLine({ q: 0, r: 0 }, { q: 2, r: -1 }, -1)[1];
    expect(new Set([hexKey(up), hexKey(down)])).toEqual(new Set(['1,-1', '1,0']));
  });

  it('pixel / metre layout round-trips for both orientations', () => {
    for (const o of ['flat', 'pointy'] as const) {
      for (const h of [hex(0, 0), hex(3, -1), hex(-4, 7), hex(10, 10)]) {
        const p = hexToPoint(h, o, 100);
        expect(pointToHex(p, o, 100)).toEqual(h);
        expect(pointToHex({ x: p.x + 20, y: p.y - 20 }, o, 100)).toEqual(h);
      }
      // adjacent centres are `spacing` apart
      const a = hexToPoint(hex(2, 2), o, 100);
      const b = hexToPoint(hexNeighbor(hex(2, 2), 1), o, 100);
      expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeCloseTo(100, 6);
      expect(hexCorners(hex(0, 0), o, 100)).toHaveLength(6);
      const [e1, e2] = edgeSegment(hex(0, 0), 2, o, 100);
      expect(Math.hypot(e1.x - e2.x, e1.y - e2.y)).toBeCloseTo(100 / Math.sqrt(3), 6);
    }
  });

  it('offset coordinates round-trip', () => {
    for (const o of ['flat', 'pointy'] as const)
      for (let col = 0; col < 6; col++)
        for (let row = 0; row < 6; row++) expect(axialToOffset(offsetToAxial(col, row, o), o)).toEqual({ col, row });
  });

  it('small helpers', () => {
    expect(parseHexKey(hexKey({ q: -3, r: 12 }))).toEqual({ q: -3, r: 12 });
    expect(hexAdd(hex(1, 2), hex(3, -4))).toEqual(hex(4, -2));
    expect(hexSub(hex(1, 2), hex(3, -4))).toEqual(hex(-2, 6));
    expect(hexEquals(hex(1, 2), hex(1, 2))).toBe(true);
  });
});

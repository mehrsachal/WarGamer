// VIS-01 — LOS matches hand-computed cases including reverse-slope / crest cases.
import { describe, expect, it } from 'vitest';
import { lineOfSight, viewshed } from '../src/los';
import { model, testMap } from './fixtures';

const EYE = { observerHeight_m: 1.6, targetHeight_m: 1.0 };

describe('line of sight (VIS-01)', () => {
  it('is clear across open flat ground', () => {
    const m = model(testMap(8, 3));
    const r = lineOfSight(m, { q: 0, r: 0 }, { q: 6, r: 0 }, EYE);
    expect(r.clear).toBe(true);
    expect(r.distance).toBe(6);
    expect(r.profile[0].t).toBe(0);
    expect(r.profile[r.profile.length - 1].t).toBe(1);
  });

  it('is blocked by woods between observer and target on flat ground', () => {
    // line height at the woods hex ≈ 1.6 → 1.0; woods top = 12 m
    const m = model(testMap(8, 3, { '3,0': { terrainId: 'woods' } }));
    const r = lineOfSight(m, { q: 0, r: 0 }, { q: 6, r: 0 }, EYE);
    expect(r.clear).toBe(false);
    expect(r.blockedBy?.hex).toEqual({ q: 3, r: 0 });
    expect(r.blockedBy?.top).toBe(12);
  });

  it('woods in the observer or target hex never block', () => {
    const m = model(testMap(8, 3, { '0,0': { terrainId: 'woods' }, '6,0': { terrainId: 'woods' } }));
    expect(lineOfSight(m, { q: 0, r: 0 }, { q: 6, r: 0 }, EYE).clear).toBe(true);
  });

  it('high ground sees over near woods but not over woods close to the target', () => {
    // observer at 30 m: z0 = 31.6; target z1 = 1.0 at distance 4
    // woods at d=1: line = 31.6 - 30.6*0.25 = 23.95 > 12 -> clear
    // woods at d=3: line = 31.6 - 30.6*0.75 = 8.65 < 12 -> blocked
    const near = model(testMap(6, 2, { '0,0': { elevation_m: 30 }, '1,0': { terrainId: 'woods' } }));
    expect(lineOfSight(near, { q: 0, r: 0 }, { q: 4, r: 0 }, EYE).clear).toBe(true);
    const far = model(testMap(6, 2, { '0,0': { elevation_m: 30 }, '3,0': { terrainId: 'woods' } }));
    const r = lineOfSight(far, { q: 0, r: 0 }, { q: 4, r: 0 }, EYE);
    expect(r.clear).toBe(false);
    const s = r.profile.find((p) => p.hex.q === 3)!;
    expect(s.line).toBeCloseTo(8.65, 6);
  });

  it('a crest hides a target on the reverse slope (reverse-slope case)', () => {
    // ground: 0 | 10 | 20 (crest) | 12 (reverse slope) | 0
    const m = model(testMap(6, 2, { '1,0': { elevation_m: 10 }, '2,0': { elevation_m: 20 }, '3,0': { elevation_m: 12 } }));
    // observer at foot (z0 1.6) to target on reverse slope (z1 13): the forward slope already blocks
    // at t=1/3 (line 5.4 < ground 10), and the crest at t=2/3 (line 9.2 < 20)
    const r = lineOfSight(m, { q: 0, r: 0 }, { q: 3, r: 0 }, EYE);
    expect(r.clear).toBe(false);
    expect(r.blockedBy?.hex).toEqual({ q: 1, r: 0 });
    expect(r.blockedBy?.line).toBeCloseTo(1.6 + (13 - 1.6) / 3, 6);
    const crest = r.profile.find((p) => p.hex.q === 2)!;
    expect(crest.blocks).toBe(true);
    expect(crest.line).toBeCloseTo(1.6 + (13 - 1.6) * (2 / 3), 6);
    // an observer level with the crest on the far side (30 m tower at the foot) still cannot see the reverse slope
    const tower = lineOfSight(m, { q: 0, r: 0 }, { q: 3, r: 0 }, { observerHeight_m: 20, targetHeight_m: 1.0 });
    expect(tower.clear).toBe(false);
    expect(tower.blockedBy?.hex).toEqual({ q: 2, r: 0 });
    // a target standing on the crest itself is visible
    expect(lineOfSight(m, { q: 0, r: 0 }, { q: 2, r: 0 }, EYE).clear).toBe(true);
    // from the crest (z0 21.6) the foot of the reverse slope (z1 1.0) is dead ground: at (3,0) line = 11.3 < 12
    const dead = lineOfSight(m, { q: 2, r: 0 }, { q: 4, r: 0 }, EYE);
    expect(dead.clear).toBe(false);
    expect(dead.blockedBy?.line).toBeCloseTo(11.3, 6);
    // ...but an observer standing 2 m higher (e.g. on a vehicle) clears it: line = 12.3 > 12
    expect(lineOfSight(m, { q: 2, r: 0 }, { q: 4, r: 0 }, { observerHeight_m: 3.6, targetHeight_m: 1.0 }).clear).toBe(true);
  });

  it('a bund on a hex edge blocks a low sight line but not a high one', () => {
    // bund between (1,0) and (2,0): top 2.5 m at t = 1.5/3; line there = 1.6 + (1.0 - 1.6) * 0.5 = 1.3
    const flat = model(testMap(5, 2, { '1,0': { edges: { '0': ['bund'] } } }));
    const r = lineOfSight(flat, { q: 0, r: 0 }, { q: 3, r: 0 }, EYE);
    expect(r.clear).toBe(false);
    expect(r.blockedBy?.edge).toBe('bund');
    expect(r.blockedBy?.top).toBe(2.5);
    const high = model(testMap(5, 2, { '0,0': { elevation_m: 5 }, '1,0': { edges: { '0': ['bund'] } } }));
    expect(lineOfSight(high, { q: 0, r: 0 }, { q: 3, r: 0 }, EYE).clear).toBe(true);
    // the edge is mirrored: declaring it on the other hex gives the same answer
    const mirrored = model(testMap(5, 2, { '2,0': { edges: { '3': ['bund'] } } }));
    expect(lineOfSight(mirrored, { q: 0, r: 0 }, { q: 3, r: 0 }, EYE).clear).toBe(false);
  });

  it('a UAV camera at altitude sees over woods (ISR-01)', () => {
    const m = model(testMap(8, 3, { '2,0': { terrainId: 'woods' }, '3,0': { terrainId: 'built_up' } }));
    expect(lineOfSight(m, { q: 0, r: 0 }, { q: 4, r: 0 }, EYE).clear).toBe(false);
    expect(lineOfSight(m, { q: 0, r: 0 }, { q: 4, r: 0 }, { observerHeight_m: 150, targetHeight_m: 1 }).clear).toBe(true);
  });

  it('an edge-grazing line is clear if either side is clear, blocked if both are', () => {
    const oneSide = model({ ...testMap(1, 1), hexes: [
      { q: 0, r: 0, elevation_m: 0, terrainId: 'open', edges: {} },
      { q: 1, r: -1, elevation_m: 0, terrainId: 'woods', edges: {} },
      { q: 1, r: 0, elevation_m: 0, terrainId: 'open', edges: {} },
      { q: 2, r: -1, elevation_m: 0, terrainId: 'open', edges: {} },
    ] });
    expect(lineOfSight(oneSide, { q: 0, r: 0 }, { q: 2, r: -1 }, EYE).clear).toBe(true);
    const bothSides = model({ ...testMap(1, 1), hexes: [
      { q: 0, r: 0, elevation_m: 0, terrainId: 'open', edges: {} },
      { q: 1, r: -1, elevation_m: 0, terrainId: 'woods', edges: {} },
      { q: 1, r: 0, elevation_m: 0, terrainId: 'woods', edges: {} },
      { q: 2, r: -1, elevation_m: 0, terrainId: 'open', edges: {} },
    ] });
    expect(lineOfSight(bothSides, { q: 0, r: 0 }, { q: 2, r: -1 }, EYE).clear).toBe(false);
  });

  it('adjacent and same-hex sight are always clear; smoke blocks', () => {
    const m = model(testMap(5, 2, { '1,0': { terrainId: 'woods' } }));
    expect(lineOfSight(m, { q: 0, r: 0 }, { q: 1, r: 0 }, EYE).clear).toBe(true);
    expect(lineOfSight(m, { q: 0, r: 0 }, { q: 0, r: 0 }, EYE).clear).toBe(true);
    const flat = model(testMap(5, 2));
    expect(lineOfSight(flat, { q: 0, r: 0 }, { q: 3, r: 0 }, { ...EYE, smoke: new Set(['1,0']) }).clear).toBe(false);
  });

  it('viewshed covers the open map within range and excludes hexes behind woods', () => {
    const open = model(testMap(6, 6));
    const all = viewshed(open, { q: 0, r: 0 }, 20, EYE);
    expect(all.size).toBe(36);
    const wooded = model(testMap(6, 6, { '1,0': { terrainId: 'woods' } }));
    const vs = viewshed(wooded, { q: 0, r: 0 }, 20, EYE);
    expect(vs.has('1,0')).toBe(true);
    expect(vs.has('3,0')).toBe(false);
    expect(viewshed(open, { q: 0, r: 0 }, 1, EYE).size).toBeLessThan(5);
  });
});

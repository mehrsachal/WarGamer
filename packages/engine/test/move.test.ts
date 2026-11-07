// MOV-03 / MOV-04 / MOV-05 — move costs, bands and reachable hexes.
import { describe, expect, it } from 'vitest';
import { hexKey } from '../src/hex';
import { allowance, pathTo, reachable, stepCost, stepCostDetail } from '../src/move';
import { ctxFor, testMap } from './fixtures';
import { tinyScenario } from './scenario';

const mover = (typeId: string, q: number, r: number, extra: Partial<{ mpSpent: number; shots: number; status: 'C' | 'S' }> = {}) => ({ typeId, hex: { q, r }, mpSpent: 0, shots: 0, status: 'C' as const, ...extra });

describe('movement', () => {
  it('step cost = terrain cost by mobility class (+ impassable)', () => {
    const ctx = ctxFor(testMap(6, 3, { '1,0': { terrainId: 'woods' }, '2,0': { terrainId: 'marsh' } }), tinyScenario());
    expect(stepCost(ctx, 'foot', { q: 0, r: 0 }, { q: 1, r: 0 })).toBe(2);
    expect(stepCost(ctx, 'tracked', { q: 0, r: 0 }, { q: 1, r: 0 })).toBe(3);
    expect(stepCost(ctx, 'wheeled', { q: 0, r: 0 }, { q: 1, r: 0 })).toBeNull();
    expect(stepCostDetail(ctx, 'wheeled', { q: 0, r: 0 }, { q: 1, r: 0 }).reason).toBe('terrain');
    expect(stepCost(ctx, 'air', { q: 0, r: 0 }, { q: 1, r: 0 })).toBe(1);
    expect(stepCostDetail(ctx, 'foot', { q: 0, r: 0 }, { q: 40, r: 0 }).reason).toBe('off_map');
  });

  it('roads give a bonus; canals stop vehicles unless bridged; nullahs add cost (MAP-04 / MOV-05)', () => {
    const ctx = ctxFor(
      testMap(6, 3, {
        '0,0': { edges: { '0': ['road'] } },
        '1,1': { edges: { '0': ['canal'] } },
        '1,2': { edges: { '0': ['canal', 'bridge', 'road'] } },
        '3,0': { edges: { '0': ['nullah'] } },
      }),
      tinyScenario(),
    );
    expect(stepCost(ctx, 'wheeled', { q: 0, r: 0 }, { q: 1, r: 0 })).toBe(0.4);
    expect(stepCostDetail(ctx, 'wheeled', { q: 0, r: 0 }, { q: 1, r: 0 }).road).toBe(true);
    expect(stepCost(ctx, 'wheeled', { q: 1, r: 1 }, { q: 2, r: 1 })).toBeNull();
    expect(stepCostDetail(ctx, 'tracked', { q: 1, r: 1 }, { q: 2, r: 1 }).reason).toBe('edge');
    expect(stepCost(ctx, 'foot', { q: 1, r: 1 }, { q: 2, r: 1 })).toBe(1 + 3);
    expect(stepCost(ctx, 'wheeled', { q: 1, r: 2 }, { q: 2, r: 2 })).toBe(0.4);
    expect(stepCost(ctx, 'tracked', { q: 3, r: 0 }, { q: 4, r: 0 })).toBe(1 + 1.5);
  });

  it('moving up a 20% slope costs more than flat; steep slopes stop wheels (MOV-05)', () => {
    const ctx = ctxFor(testMap(6, 2, { '1,0': { elevation_m: 20 }, '2,0': { elevation_m: 60 } }), tinyScenario());
    const flat = stepCost(ctx, 'foot', { q: 3, r: 0 }, { q: 4, r: 0 })!;
    const up20 = stepCost(ctx, 'foot', { q: 0, r: 0 }, { q: 1, r: 0 })!;
    expect(up20).toBeGreaterThan(flat);
    expect(stepCostDetail(ctx, 'foot', { q: 0, r: 0 }, { q: 1, r: 0 }).slopePct).toBeCloseTo(20);
    expect(stepCost(ctx, 'wheeled', { q: 0, r: 0 }, { q: 1, r: 0 })).toBeGreaterThan(stepCost(ctx, 'foot', { q: 0, r: 0 }, { q: 1, r: 0 })!);
    expect(stepCost(ctx, 'wheeled', { q: 1, r: 0 }, { q: 2, r: 0 })).toBeNull(); // 40 %
    expect(stepCostDetail(ctx, 'wheeled', { q: 1, r: 0 }, { q: 2, r: 0 }).reason).toBe('slope');
    expect(stepCost(ctx, 'foot', { q: 1, r: 0 }, { q: 0, r: 0 })).toBe(1); // downhill: no penalty
  });

  it('reachable hexes split into tactical and dash bands (MOV-03 / MOV-04)', () => {
    const ctx = ctxFor(testMap(12, 12), tinyScenario());
    const reach = reachable(ctx, mover('rifle_section', 5, 5));
    const at = (q: number, r: number) => reach.get(hexKey({ q, r }));
    expect(at(8, 5)!.band).toBe('tactical'); // 3 MP
    expect(at(9, 5)!.band).toBe('dash'); // 4 MP
    expect(at(11, 5)!.band).toBe('dash'); // 6 MP
    expect(reach.has(hexKey({ q: 12, r: 5 }))).toBe(false);
    expect(pathTo(reach, { q: 8, r: 5 })).toHaveLength(3);
    expect(pathTo(reach, { q: 99, r: 99 })).toBeNull();
    // after firing, only the tactical band is allowed
    const fired = reachable(ctx, mover('rifle_section', 5, 5, { shots: 1 }));
    expect(fired.has(hexKey({ q: 9, r: 5 }))).toBe(false);
    // suppressed units move at half rate
    expect(allowance(ctx, mover('rifle_section', 5, 5, { status: 'S' })).total).toBe(3);
    // MP already spent this turn count
    const tired = reachable(ctx, mover('rifle_section', 5, 5, { mpSpent: 5 }));
    expect([...tired.values()].every((n) => n.cost <= 6)).toBe(true);
    expect(tired.get(hexKey({ q: 6, r: 5 }))!.band).toBe('dash');
  });

  it('known enemies block movement; full hexes can be passed but not entered; UAVs ignore both', () => {
    const ctx = ctxFor(testMap(8, 8, { '4,3': { terrainId: 'woods' } }), tinyScenario());
    const blocked = new Set([hexKey({ q: 4, r: 4 })]);
    const occupancy = new Map([[hexKey({ q: 3, r: 4 }), 3]]);
    const reach = reachable(ctx, mover('rifle_section', 2, 4), { blocked, occupancy });
    expect(reach.has(hexKey({ q: 4, r: 4 }))).toBe(false);
    expect(reach.get(hexKey({ q: 3, r: 4 }))!.canStop).toBe(false);
    const uav = reachable(ctx, mover('uav_mini', 2, 4), { blocked, occupancy });
    expect(uav.get(hexKey({ q: 4, r: 4 }))!.canStop).toBe(true);
    expect(uav.get(hexKey({ q: 4, r: 3 }))!.cost).toBe(2);
    expect(reachable(ctx, { ...mover('rifle_section', 0, 0), hex: null }).size).toBe(0);
  });
});

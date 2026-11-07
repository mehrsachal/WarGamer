// CBT-01 / CBT-02 / CBT-05 / UNIT-03 — the hit % shown equals the formula built from the data tables.
import { describe, expect, it } from 'vitest';
import { directFireCheck, envFactors, hitProbability, indirectFireCheck, indirectHit, rangeBand } from '../src/combat';
import type { Posture } from '../src/state';
import { ctxFor, data, testMap } from './fixtures';
import { tinyScenario } from './scenario';

const shooter = (typeId: string, q: number, r: number, o: Partial<{ status: 'C' | 'S'; posture: Posture; shots: number; ammo: Record<string, number | null>; carriedBy: string }> = {}) => ({
  typeId,
  hex: { q, r },
  status: 'C' as const,
  posture: 'static' as Posture,
  shots: 0,
  ammo: {} as Record<string, number | null>,
  ...o,
});
const target = (typeId: string, q: number, r: number, posture: Posture = 'static') => ({ typeId, hex: { q, r }, posture });

describe('hit probability (CBT-02)', () => {
  const ctx = ctxFor(testMap(30, 6, { '2,0': { terrainId: 'woods' }, '6,1': { terrainId: 'built_up' } }), tinyScenario());
  const w = data().weapon('section_arms');

  it('equals base × cover × posture × shooter × env from the data', () => {
    const b = hitProbability(ctx, w, 2, target('rifle_section', 2, 0), { typeId: 'rifle_section', posture: 'static' });
    expect(b.base).toBe(0.42);
    expect(b.cover).toBe(0.6);
    expect(b.p).toBeCloseTo(0.42 * 0.6, 10);
    const moved = hitProbability(ctx, w, 2, target('rifle_section', 2, 0, 'dashed'), { typeId: 'rifle_section', posture: 'moved' });
    expect(moved.p).toBeCloseTo(0.42 * 0.6 * 1.35 * 0.65, 10);
    expect(moved.raw).toBeCloseTo(moved.base * moved.cover * moved.posture * moved.shooter * moved.env, 12);
    expect(rangeBand(w, 4).toHex).toBe(4);
    expect(rangeBand(w, 99).toHex).toBe(5);
  });

  it('is clamped to 1–95 %', () => {
    const hot = { ...data().weapon('atgm'), rangeBands: [{ toHex: 30, softHit: 1, hardHit: 1, airHit: 0 }] };
    expect(hitProbability(ctx, hot, 3, target('tank', 3, 3), { typeId: 'atgm_team', posture: 'static' }).p).toBe(0.95);
    const cold = { ...w, rangeBands: [{ toHex: 5, softHit: 0.001, hardHit: 0, airHit: 0 }] };
    expect(hitProbability(ctx, cold, 3, target('rifle_section', 6, 1), { typeId: 'rifle_section', posture: 'moved' }).p).toBe(0.01);
  });

  it('small arms cannot hurt armour: 0 % and fire disabled (CBT-05)', () => {
    const b = hitProbability(ctx, w, 1, target('tank', 4, 0), { typeId: 'rifle_section', posture: 'static' });
    expect(b.p).toBe(0);
    const c = directFireCheck(ctx, shooter('rifle_section', 3, 0), 'section_arms', target('tank', 4, 0), true);
    expect(c).toMatchObject({ ok: false, reason: 'cannot_damage', p: 0 });
    expect(directFireCheck(ctx, shooter('rifle_section', 3, 0), 'rpg', target('tank', 4, 0), true).ok).toBe(true);
  });

  it('night and weather reduce the odds; thermal sights recover most of the night penalty (MAP-09)', () => {
    const night = ctxFor(testMap(10, 4), { ...tinyScenario(), timeOfDay: 'night', weather: 'fog' });
    expect(envFactors(night, 'rifle_section')).toEqual({ light: 0.5, weather: 0.6 });
    expect(envFactors(night, 'tank')).toEqual({ light: 0.9, weather: 0.6 });
    expect(envFactors(ctxFor(testMap(4, 4), { ...tinyScenario(), timeOfDay: 'dusk' }), null).light).toBe(0.8);
  });
});

describe('fire permission (CBT-01)', () => {
  const ctx = ctxFor(testMap(40, 6, { '3,1': { terrainId: 'woods' } }), tinyScenario());

  it('is disabled outside LOS or range and for unseen targets', () => {
    expect(directFireCheck(ctx, shooter('rifle_section', 0, 1), 'section_arms', target('rifle_section', 4, 1), true).reason).toBe('no_los');
    expect(directFireCheck(ctx, shooter('rifle_section', 0, 0), 'section_arms', target('rifle_section', 9, 0), true).reason).toBe('out_of_range');
    expect(directFireCheck(ctx, shooter('rifle_section', 0, 0), 'section_arms', target('rifle_section', 2, 0), false).reason).toBe('not_visible');
    expect(directFireCheck(ctx, shooter('atgm_team', 0, 0), 'atgm', target('tank', 1, 0), true).reason).toBe('too_close');
    const ok = directFireCheck(ctx, shooter('atgm_team', 0, 0), 'atgm', target('tank', 20, 0), true);
    expect(ok.ok).toBe(true);
    expect(ok.p).toBeCloseTo(0.7, 10);
  });

  it('is disabled for suppressed, dashed, mounted, spent or empty shooters', () => {
    const t = target('rifle_section', 2, 0);
    expect(directFireCheck(ctx, shooter('rifle_section', 0, 0, { status: 'S' }), 'section_arms', t, true).reason).toBe('suppressed');
    expect(directFireCheck(ctx, shooter('rifle_section', 0, 0, { posture: 'dashed' }), 'section_arms', t, true).reason).toBe('dashed');
    expect(directFireCheck(ctx, shooter('rifle_section', 0, 0, { carriedBy: 'apc' }), 'section_arms', t, true).reason).toBe('mounted');
    expect(directFireCheck(ctx, shooter('rifle_section', 0, 0, { shots: 1 }), 'section_arms', t, true).reason).toBe('no_shots');
    expect(directFireCheck(ctx, shooter('rifle_section', 0, 0, { ammo: { rpg: 0 } }), 'rpg', t, true).reason).toBe('no_ammo');
    expect(directFireCheck(ctx, shooter('rifle_section', 0, 0), 'tank_gun', t, true).reason).toBe('no_weapon');
    expect(directFireCheck(ctx, shooter('atgm_team', 0, 0, { posture: 'moved' }), 'atgm', target('tank', 9, 0), true).reason).toBe('moved_static_weapon');
    expect(directFireCheck(ctx, shooter('mortar60_sec', 0, 0), 'mortar60', t, true).reason).toBe('indirect_weapon');
  });

  it('indirect fire checks range, weapon type and map bounds', () => {
    expect(indirectFireCheck(ctx, shooter('mortar60_sec', 0, 0), 'mortar60', { q: 5, r: 0 }).ok).toBe(true);
    expect(indirectFireCheck(ctx, shooter('mortar60_sec', 0, 0), 'mortar60', { q: 0, r: 0 }).reason).toBe('too_close');
    expect(indirectFireCheck(ctx, shooter('mortar60_sec', 0, 0), 'mortar60', { q: 20, r: 0 }).reason).toBe('out_of_range');
    expect(indirectFireCheck(ctx, shooter('mortar60_sec', 0, 0), 'mortar60', { q: 99, r: 0 }).reason).toBe('off_map');
    expect(indirectFireCheck(ctx, shooter('rifle_section', 0, 0), 'section_arms', { q: 2, r: 0 }).reason).toBe('direct_weapon');
    expect(indirectFireCheck(ctx, shooter('mortar60_sec', 0, 0, { posture: 'moved' }), 'mortar60', { q: 5, r: 0 }).reason).toBe('moved_static_weapon');
    const how = data().weapon('how155');
    const direct = indirectHit(ctx, how, null, target('rifle_section', 3, 1), true, false);
    expect(direct.p).toBeCloseTo(0.55 * 0.6, 10);
    const adj = indirectHit(ctx, how, null, target('rifle_section', 4, 1), false, true);
    expect(adj.p).toBeCloseTo(0.55 * 1 * 0.4 * 0.35, 10);
    expect(indirectHit(ctx, data().weapon('mortar60'), 3, target('rifle_section', 4, 1), true, true).p).toBe(0);
  });
});

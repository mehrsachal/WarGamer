// Section 4 data model + MAP-02 / UNIT-02 / ED-04 / ED-06 validation.
import { describe, expect, it } from 'vitest';
import { DataError, MapModel, Ruleset, edgeCrossable, validateScenario } from '../src/data/ruleset';
import { data, model, rawData, testMap } from './fixtures';
import { tinyScenario } from './scenario';

describe('data files', () => {
  it('the shipped data validates and is indexed', () => {
    const d = data();
    expect(d.terrain.size).toBeGreaterThanOrEqual(12);
    for (const id of ['open', 'scrub', 'woods', 'orchard', 'built_up', 'village', 'rocky', 'scree', 'snow', 'marsh', 'dunes', 'crops']) expect(d.terrain.has(id)).toBe(true);
    for (const id of ['road', 'track', 'canal', 'nullah', 'river', 'distributary', 'bund', 'ridgeline', 'bridge']) expect(d.edges.has(id)).toBe(true);
    for (const id of ['rifle_section', 'fire_team', 'lmg_team', 'mmg_team', 'hmg_team', 'atgm_team', 'rcl_team', 'rpg_team', 'mortar60_sec', 'mortar81_sec', 'mortar120_sec', 'sniper_team', 'engineer_section', 'recce_team', 'uav_mini', 'jeep', 'apc', 'ifv', 'tank', 'coy_hq'])
      expect(d.units.has(id)).toBe(true);
    expect(d.unitType('tank').targetClass).toBe('hard');
    expect(() => d.unitType('nope')).toThrow();
    expect(() => d.weapon('nope')).toThrow();
  });

  it('a new unit type is added by editing data only (UNIT-02)', () => {
    const raw = rawData();
    (raw.units as unknown[]).push({ id: 'sapper_team', name: 'Sapper team', symbol: 'SFGPUCE----A---', category: 'engineer', mobilityClass: 'foot', movePoints: 5, steps: 2, crew: 4, weapons: ['team_arms'], sensors: ['eye'], eyeHeight_m: 1.6, height_m: 1, targetClass: 'soft' });
    const d = Ruleset.parse(raw);
    expect(d.unitType('sapper_team').steps).toBe(2);
  });

  it('invalid ranges, percentages and references are rejected with every issue listed (ED-04)', () => {
    const raw = rawData();
    const weapons = structuredClone(raw.weapons) as Record<string, unknown>[];
    weapons[0].minRange = 9; // > maxRange
    (weapons[1].rangeBands as Record<string, unknown>[])[0].softHit = 1.5; // > 100 %
    weapons[2].rangeBands = [{ toHex: 3, softHit: 0.2, hardHit: 0 }, { toHex: 2, softHit: 0.1, hardHit: 0 }];
    const units = structuredClone(raw.units) as Record<string, unknown>[];
    units[0].weapons = ['laser_gun'];
    units[1].sensors = ['crystal_ball'];
    units[2].mobilityClass = 'air';
    try {
      Ruleset.parse({ ...raw, weapons, units: [...units, units[3]] });
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(DataError);
      const msg = (e as DataError).issues.join('\n');
      expect(msg).toMatch(/1.5|too big|<=1/i);
      expect(msg).toMatch(/duplicate id/);
    }
    // cross references are checked once the lists themselves are valid
    const r2 = rawData();
    const u2 = structuredClone(r2.units) as Record<string, unknown>[];
    u2[0].weapons = ['laser_gun'];
    u2[1].sensors = ['crystal_ball'];
    u2[2].mobilityClass = 'air';
    const w2 = structuredClone(r2.weapons) as Record<string, unknown>[];
    w2[0].minRange = 9;
    w2[2].rangeBands = [{ toHex: 3, softHit: 0.2, hardHit: 0 }, { toHex: 2, softHit: 0.1, hardHit: 0 }];
    expect(() => Ruleset.parse({ ...r2, units: u2 })).toThrow(/unknown weapon "laser_gun"[\s\S]*unknown sensor "crystal_ball"[\s\S]*isAir/);
    expect(() => Ruleset.parse({ ...r2, weapons: w2 })).toThrow(/minRange > maxRange[\s\S]*ascend/);
    expect(() => Ruleset.parse({ ...r2, rules: { hit: {} } })).toThrow(/rules\./);
  });

  it('maps load with per-hex attributes and mirrored edges (MAP-02 / MAP-04)', () => {
    const m = model(testMap(4, 4, { '1,1': { terrainId: 'woods', elevation_m: 12, edges: { '0': ['canal'] } } }));
    expect(m.cell({ q: 1, r: 1 }).terrain.id).toBe('woods');
    expect(m.elevation({ q: 1, r: 1 })).toBe(12);
    expect(m.edgeFeatures({ q: 1, r: 1 }, { q: 2, r: 1 }).map((f) => f.id)).toEqual(['canal']);
    expect(m.edgeFeatures({ q: 2, r: 1 }, { q: 1, r: 1 }).map((f) => f.id)).toEqual(['canal']);
    expect(m.allEdges()).toHaveLength(1);
    expect(m.gridRef({ q: 0, r: 0 })).toBe('0000 0000');
    expect(m.gridRef({ q: 1, r: 0 })).toMatch(/^\d{4} \d{4}$/);
    expect(m.has({ q: 9, r: 9 })).toBe(false);
    expect(() => m.cell({ q: 9, r: 9 })).toThrow(/off the map/);
    expect(() => model(testMap(2, 2, { '0,0': { terrainId: 'lava' } }))).toThrow(/unknown terrain/);
    expect(() => model(testMap(2, 2, { '0,0': { edges: { '0': ['moat'] } } }))).toThrow(/unknown edge feature/);
    expect(() => MapModel.parse({ id: 'x' }, data())).toThrow(DataError);
  });

  it('a canal edge blocks vehicles unless a bridge exists (MAP-04)', () => {
    const d = data();
    const canal = d.edges.get('canal')!;
    const bridge = d.edges.get('bridge')!;
    expect(edgeCrossable([canal], 'foot')).toBe(true);
    expect(edgeCrossable([canal], 'wheeled')).toBe(false);
    expect(edgeCrossable([canal], 'tracked')).toBe(false);
    expect(edgeCrossable([canal, bridge], 'wheeled')).toBe(true);
    expect(edgeCrossable([d.edges.get('river')!], 'foot')).toBe(false);
    expect(edgeCrossable([], 'tracked')).toBe(true);
  });

  it('scenario validation lists every error (ED-06)', () => {
    const map = model(testMap(10, 8));
    const ok = validateScenario(tinyScenario(), data(), map);
    expect(ok.errors).toEqual([]);
    const bad = tinyScenario();
    bad.mapId = 'other';
    bad.sides.blue.orbat[0].hex = { q: 9, r: 7 }; // outside zone
    bad.sides.blue.orbat[1].typeId = 'unicorn';
    bad.sides.red.orbat.push({ id: 'b1', typeId: 'fire_team', name: 'dup' });
    bad.sides.red.orbat.push({ id: 'r9', typeId: 'fire_team', name: 'hitchhiker', mountedIn: 'r1' });
    bad.sides.red.fireSupport.push({ id: 'x', name: 'x', weaponId: 'rpg', missions: 1, fromTurn: 99, delay: 0 });
    bad.objectives.push({ id: 'o9', name: 'far', hex: { q: 50, r: 50 }, value: 1, initialOwner: null });
    const res = validateScenario(bad, data(), map);
    const all = res.errors.join('\n');
    expect(res.scenario).toBeUndefined();
    for (const re of [/mapId/, /outside the deployment zone/, /unknown unit type "unicorn"/, /duplicate unit id "b1"/, /cannot carry troops/, /is not indirect/, /after the last turn/, /off the map/]) expect(all).toMatch(re);
    expect(validateScenario({ id: 1 }, data(), map).errors.length).toBeGreaterThan(0);
  });
});

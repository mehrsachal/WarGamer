import { describe, expect, it } from 'vitest';
import { AnalysisParams, GameMap, MapModel, analyse, hexKey, reportToCSV, reportToGeoJSON, type AnalysisReport, type DefenceMode } from '../src';
import { data, readJson } from './fixtures';

const P = AnalysisParams.parse(readJson('data/analysis-mountain.json'));
const SECTORS = ['mtn-kafir-ridge', 'mtn-shandur-valley', 'mtn-twin-peaks'];
const maps = new Map(SECTORS.map((id) => [id, new MapModel(GameMap.parse(readJson(`maps/${id}.json`)), data())]));
const cache = new Map<string, AnalysisReport>();
const run = (id: string, mode: DefenceMode) => {
  const k = `${id}/${mode}`;
  if (!cache.has(k)) cache.set(k, analyse({ map: maps.get(id)!, data: data(), params: P, mode }));
  return cache.get(k)!;
};

describe('terrain & plan analyser (fictional mountain sectors)', () => {
  for (const id of SECTORS) {
    it(`${id}: terrain, key ground, approaches`, () => {
      const r = run(id, 'mountain');
      expect(r.terrain.ridges.length).toBeGreaterThan(0);
      expect(r.terrain.nullahs.length).toBeGreaterThan(20);
      expect(r.itgs.length).toBeGreaterThanOrEqual(3);
      expect(r.itgs.filter((i) => i.vital)).toHaveLength(1);
      for (const i of r.itgs) {
        expect(r.territory.own).toContain(hexKey(i.hex));
        expect(['section', 'platoon', 'company', 'battalion']).toContain(i.force);
        expect(i.extent.length).toBeGreaterThan(0);
      }
      expect(r.approaches.length).toBeGreaterThanOrEqual(3);
      for (const a of r.approaches) expect(a.crossing).not.toBeNull();
    }, 60_000);

    it(`${id}: deployment in all three modes`, () => {
      const res = (['forward', 'normal', 'mountain'] as const).map((m) => run(id, m));
      for (const r of res) {
        const pls = r.deployment.positions.filter((p) => p.kind === 'platoon');
        expect(pls).toHaveLength(P.force.companies * P.force.platoonsPerCompany);
        const band = P.modes[r.mode].mainPositions_m;
        for (const p of pls) expect(p.distToBorder_m).toBeLessThanOrEqual(band[1] + 100);
        for (const p of r.deployment.positions) expect(r.territory.own).toContain(hexKey(p.hex));
        expect(r.deployment.positions.filter((p) => p.kind === 'post').length).toBeGreaterThan(2);
        expect(r.deployment.positions.some((p) => p.kind === 'bn_hq')).toBe(true);
        expect(r.deployment.weapons.length).toBeGreaterThan(0);
        expect(r.deployment.mortars.sites.length).toBe(Object.values(P.force.mortars).reduce((m, n) => m + n, 0));
        expect(r.deployment.surveillance.observedPct).toBeGreaterThan(50);
        expect(['good', 'adequate', 'not good']).toContain(r.summary.overall);
      }
      // forward defence sits closer to the border than normal defence
      const mean = (r: AnalysisReport) => {
        const p = r.deployment.positions.filter((x) => x.kind === 'platoon');
        return p.reduce((m, x) => m + x.distToBorder_m, 0) / p.length;
      };
      expect(mean(res[0])).toBeLessThan(mean(res[1]));
    }, 120_000);

    it(`${id}: enemy analysis and outputs`, () => {
      const r = run(id, 'mountain');
      expect(r.enemy.infiltration.length).toBe(P.infiltration.routes);
      expect(r.enemy.options.length).toBeGreaterThanOrEqual(2);
      expect(r.enemy.options.length).toBeLessThanOrEqual(4);
      expect(r.enemy.options[0].likelihood).toBe('most likely');
      expect(r.enemy.exploitable.length).toBeGreaterThan(0);
      const gj = reportToGeoJSON(maps.get(id)!, r);
      expect(gj.features.some((f) => f.properties.layer === 'itg')).toBe(true);
      expect(gj.features.some((f) => f.properties.layer === 'enemy_option')).toBe(true);
      const csv = reportToCSV(maps.get(id)!, r);
      expect(csv.split('\n')[0]).toBe('type,id,name,grid_ref,easting,northing,rating,detail');
      expect(csv).toContain('ITG,K1,');
    }, 60_000);
  }

  it('is deterministic and honours the area of interest', () => {
    const map = maps.get('mtn-kafir-ridge')!;
    const a = analyse({ map, data: data(), params: P, mode: 'normal', now: () => 0 });
    const b = analyse({ map, data: data(), params: P, mode: 'normal', now: () => 0 });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    const aoi = map.list.filter((h) => map.centre_m(h).x < 3000);
    const c = analyse({ map, data: data(), params: P, mode: 'normal', aoi });
    expect(c.aoiHexes).toBe(aoi.length);
    const keys = new Set(aoi.map(hexKey));
    for (const i of c.itgs) expect(keys.has(hexKey(i.hex))).toBe(true);
  }, 60_000);
});

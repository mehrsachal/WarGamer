// Test fixtures: the real data files plus small hand-built maps whose LOS / move results can be computed by hand.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type DataBundle, MapModel, Ruleset, validateScenario } from '../src/data/ruleset';
import type { GameMap, MapHex, Scenario } from '../src/data/schema';
import type { GameContext } from '../src/state';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));

export function rawData(): DataBundle {
  const read = (f: string) => JSON.parse(readFileSync(join(ROOT, 'data', `${f}.json`), 'utf8'));
  return { terrain: read('terrain'), edges: read('edges'), weapons: read('weapons'), units: read('units'), sensors: read('sensors'), rules: read('rules') };
}

let cached: Ruleset | undefined;
export function data(): Ruleset {
  cached ??= Ruleset.parse(rawData());
  return cached;
}

/** A width × height flat-top map, open ground at 0 m, with per-hex overrides. */
export function testMap(width: number, height: number, overrides: Record<string, Partial<MapHex>> = {}, id = 'test'): GameMap {
  const hexes: MapHex[] = [];
  for (let q = 0; q < width; q++) {
    for (let r = 0; r < height; r++) {
      const o = overrides[`${q},${r}`] ?? {};
      hexes.push({ q, r, elevation_m: 0, terrainId: 'open', edges: {}, ...o });
    }
  }
  return { id, name: id, hexSize_m: 100, orientation: 'flat', width, height, hexes, gridRefOrigin: { easting: 100000, northing: 200000 }, labels: [], classification: 'TEST' };
}

export function model(m: GameMap): MapModel {
  return new MapModel(m, data());
}

export function readJson(rel: string): unknown {
  return JSON.parse(readFileSync(join(ROOT, rel), 'utf8'));
}

/** Load a committed map + scenario pair. */
export function context(mapId: string, scenarioId: string): GameContext {
  const d = data();
  const map = MapModel.parse(readJson(`maps/${mapId}.json`), d);
  const v = validateScenario(readJson(`scenarios/${scenarioId}.json`), d, map);
  if (!v.scenario) throw new Error(v.errors.join('\n'));
  return { data: d, map, scenario: v.scenario };
}

export function ctxFor(m: GameMap, scenario: Scenario): GameContext {
  return { data: data(), map: model(m), scenario };
}

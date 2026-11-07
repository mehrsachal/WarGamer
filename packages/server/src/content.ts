// Loads and validates game content from the content root (repo data by default; real data packs are mounted
// from outside the repo at deploy time — NFR-02).
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { type DataBundle, type GameContext, MapModel, Ruleset, type Scenario, type Side, validateScenario } from '@tht/engine';

export interface Content {
  data: Ruleset;
  maps: Map<string, MapModel>;
  scenarios: Map<string, Scenario>;
  rawMaps: Map<string, unknown>;
  context(scenarioId: string): GameContext;
}

const readJson = (p: string) => JSON.parse(readFileSync(p, 'utf8'));

export function loadContent(root: string, log: (m: string) => void = () => {}): Content {
  const d = (f: string) => readJson(join(root, 'data', `${f}.json`));
  const data = Ruleset.parse({ terrain: d('terrain'), edges: d('edges'), weapons: d('weapons'), units: d('units'), sensors: d('sensors'), rules: d('rules') } as DataBundle);
  const maps = new Map<string, MapModel>();
  const rawMaps = new Map<string, unknown>();
  for (const f of readdirSync(join(root, 'maps')).filter((x) => x.endsWith('.json')).sort()) {
    const raw = readJson(join(root, 'maps', f));
    const m = MapModel.parse(raw, data);
    maps.set(m.def.id, m);
    rawMaps.set(m.def.id, m.def);
  }
  const scenarios = new Map<string, Scenario>();
  const dir = join(root, 'scenarios');
  if (existsSync(dir)) {
    for (const f of readdirSync(dir).filter((x) => x.endsWith('.json')).sort()) {
      const raw = readJson(join(dir, f)) as { mapId?: string };
      const map = maps.get(raw.mapId ?? '');
      if (!map) {
        log(`scenario ${f}: unknown map ${raw.mapId} — skipped`);
        continue;
      }
      const v = validateScenario(raw, data, map);
      if (!v.scenario) {
        log(`scenario ${f} invalid — skipped:\n  ${v.errors.join('\n  ')}`);
        continue;
      }
      scenarios.set(v.scenario.id, v.scenario);
    }
  }
  return {
    data,
    maps,
    scenarios,
    rawMaps,
    context(id: string): GameContext {
      const scenario = scenarios.get(id);
      if (!scenario) throw new Error(`unknown scenario ${id}`);
      return { data, map: maps.get(scenario.mapId)!, scenario };
    },
  };
}

/** The scenario as one side may see it: the enemy's ORBAT, zone, fire support and private briefing removed. */
export function publicScenario(s: Scenario, side: Side | null): Scenario {
  const hidden = { name: '', deploymentZone: [], orbat: [], fireSupport: [], briefing: '' };
  return {
    ...s,
    sides: {
      blue: side === 'blue' ? s.sides.blue : { ...hidden, name: s.sides.blue.name },
      red: side === 'red' ? s.sides.red : { ...hidden, name: s.sides.red.name },
    } as Scenario['sides'],
  };
}

export function scenarioSummary(s: Scenario) {
  return {
    id: s.id,
    title: s.title,
    mapId: s.mapId,
    turns: s.turns,
    minutesPerTurn: s.minutesPerTurn,
    weather: s.weather,
    timeOfDay: s.timeOfDay,
    firstSide: s.firstSide,
    briefing: s.briefing,
    sideNames: { blue: s.sides.blue.name, red: s.sides.red.name },
    objectives: s.objectives,
    ai: s.ai ?? null,
    classification: s.classification,
  };
}

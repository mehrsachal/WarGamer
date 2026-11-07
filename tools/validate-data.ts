// Validates every data file, map and scenario (ED-04 / ED-06). Exit code 1 on any problem.
//   npm run validate:data
import { readFileSync, readdirSync } from 'node:fs';
import { type DataBundle, MapModel, Ruleset, validateScenario } from '../packages/engine/src/index';

const root = new URL('../', import.meta.url);
const read = (f: string) => JSON.parse(readFileSync(new URL(f, root), 'utf8'));
let bad = 0;
try {
  const data = Ruleset.parse({ terrain: read('data/terrain.json'), edges: read('data/edges.json'), weapons: read('data/weapons.json'), units: read('data/units.json'), sensors: read('data/sensors.json'), rules: read('data/rules.json') } as DataBundle);
  const maps = new Map<string, MapModel>();
  for (const f of readdirSync(new URL('maps/', root))) {
    if (!f.endsWith('.json')) continue;
    try {
      const m = MapModel.parse(read(`maps/${f}`), data);
      maps.set(m.def.id, m);
      console.log(`ok   map ${m.def.id} (${m.def.width}x${m.def.height})`);
    } catch (e) {
      bad++;
      console.error(`FAIL map ${f}: ${(e as Error).message}`);
    }
  }
  for (const f of readdirSync(new URL('scenarios/', root))) {
    if (!f.endsWith('.json')) continue;
    const raw = read(`scenarios/${f}`) as { mapId?: string };
    const map = maps.get(raw.mapId ?? '');
    if (!map) {
      bad++;
      console.error(`FAIL scenario ${f}: unknown map ${raw.mapId}`);
      continue;
    }
    const v = validateScenario(raw, data, map);
    if (v.errors.length) {
      bad++;
      console.error(`FAIL scenario ${f}:\n  - ${v.errors.join('\n  - ')}`);
    } else console.log(`ok   scenario ${v.scenario!.id}`);
  }
} catch (e) {
  bad++;
  console.error((e as Error).message);
}
process.exit(bad ? 1 : 0);

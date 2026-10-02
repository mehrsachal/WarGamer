import { test } from 'node:test';
import assert from 'node:assert/strict';
import { presetBic49 } from '../src/scenario/presetBic49';
import { generateScenario } from '../src/scenario/generator';
import { TerrainModel } from '../src/terrain/terrain';
import type { OpsLevel, TerrainType } from '../src/core/types';

test('BIC-49 preset builds a terrain model with sensible queries', () => {
  const s = presetBic49();
  const t = new TerrainModel(s.terrain);
  assert.equal(t.cols, 180);
  assert.equal(t.rows, 380);
  // 15 r is higher than open ground next to it
  const top = t.elevAt({ x: 1750, y: 4775 });
  const flat = t.elevAt({ x: 1750, y: 4300 });
  assert.ok(top > flat + 8, `15 r should be elevated (${top} vs ${flat})`);
  // dry nullah impedes tanks; road bridge does not
  assert.ok(t.goingAt({ x: 2100, y: 4965 }, 'TRACKED') < 0.5);
  assert.equal(t.squareRef({ x: 1600, y: 4800 }), 'Sq 1573');
  assert.match(t.describe({ x: 1000, y: 6500 }), /Clump 2/);
  // line of sight: Alipur BUA blocks view through it
  const westOfAlipur = { x: 2300, y: 4870 };
  const eastOfAlipur = { x: 3200, y: 4870 };
  assert.equal(t.los(westOfAlipur, eastOfAlipur), 0);
  // open ground: clear view along the nullah line south side
  assert.ok(t.los({ x: 1750, y: 4775 }, { x: 1750, y: 5600 }, 2, 1.5) > 0.5);
  const path = t.findPath({ x: 1150, y: 7100 }, { x: 2100, y: 4100 }, 'TRACKED');
  assert.ok(path.length > 3);
});

for (const level of ['PL', 'COY', 'BN', 'BDE'] as OpsLevel[]) {
  for (const terrain of ['PLAINS', 'CANAL', 'DESERT', 'SEMI_DESERT'] as TerrainType[]) {
    test(`generator: ${level} / ${terrain}`, () => {
      const s = generateScenario({ level, terrain, seed: 1234 });
      assert.equal(s.level, level);
      assert.ok(s.terrain.features.length > 10);
      assert.ok(s.ds.approaches.length >= 2, 'approaches computed');
      assert.ok(s.ds.itgs.length >= 2, 'itgs computed');
      assert.ok(s.ds.linesOfDef.length >= 1, 'lines of def computed');
      assert.ok(s.narrative.length >= 5);
      const again = generateScenario({ level, terrain, seed: 1234 });
      assert.deepEqual(again.terrain.features.length, s.terrain.features.length, 'deterministic');
      assert.equal(again.narrative[0].body, s.narrative[0].body);
    });
  }
}

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MapRenderer } from '../src/render/mapRenderer';
import { presetBic49 } from '../src/scenario/presetBic49';
import { generateScenario } from '../src/scenario/generator';
import { TerrainModel } from '../src/terrain/terrain';
import { bbox } from '../src/core/geom';
import type { Scenario } from '../src/core/types';

// view maths only: a stand-in canvas is enough (nothing is drawn)
const fakeCanvas = () => ({ getContext: () => ({}), style: {}, width: 0, height: 0 }) as unknown as HTMLCanvasElement;

function renderer(s: Scenario, w: number, h: number): MapRenderer {
  const r = new MapRenderer(fakeCanvas(), s, new TerrainModel(s.terrain));
  r.resize(w, h, 1);
  return r;
}

/** True when the whole view lies on the sheet (no empty strips). */
function fills(r: MapRenderer): boolean {
  const tl = r.toWorld(0, 0);
  const br = r.toWorld(r.w, r.h);
  const e = 1e-6;
  return tl.x >= -e && br.x <= r.s.terrain.width + e && br.y >= -e && tl.y <= r.s.terrain.height + e;
}

const aorBox = (s: Scenario, pad = 600) => {
  const b = bbox(s.own.aor);
  return { minX: Math.max(0, b.minX - pad), minY: Math.max(0, b.minY - pad * 0.3), maxX: Math.min(s.terrain.width, b.maxX + pad), maxY: Math.min(s.terrain.height, b.maxY + pad * 0.8) };
};

test('framed map views always fill their panel (fit, zoom out, pan, resize)', () => {
  for (const s of [presetBic49(), generateScenario({ level: 'PL', terrain: 'PLAINS', seed: 5 }), generateScenario({ level: 'BDE', terrain: 'DESERT', seed: 5 })]) {
    for (const [w, h] of [[980, 850], [1600, 700], [420, 230], [600, 900]]) {
      const r = renderer(s, w, h);
      r.fit(aorBox(s), 40, false);
      assert.ok(fills(r), `${s.id} ${w}x${h}: contain fit of the AOR fills`);
      // the AOR stays in view
      const b = bbox(s.own.aor);
      const c = r.toScreen({ x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 });
      assert.ok(c.x > 0 && c.x < w && c.y > 0 && c.y < h, 'AOR centre on screen');
      r.fit();
      assert.ok(fills(r), 'fit whole map fills');
      for (let i = 0; i < 30; i++) r.zoomAt(w / 2, h / 2, 1 / 1.4);
      assert.ok(fills(r), 'zoomed right out still fills');
      assert.ok(Math.abs(r.scale - Math.max(w / s.terrain.width, h / s.terrain.height)) < 1e-9, 'min zoom = sheet covers the view');
      r.panBy(5000, -5000);
      assert.ok(fills(r), 'panned past the NW corner');
      r.zoomAt(10, 10, 3);
      r.panBy(-1e6, 1e6);
      assert.ok(fills(r), 'panned past the SE corner when zoomed in');
      // a view restored after a resize is clamped on the next draw/clamp
      r.resize(w * 2, h * 2, 1);
      r.clampView();
      assert.ok(fills(r), 'after resize');
    }
  }
});

test('the BIC-49 briefing fit shows the AOR with flank ground, not a letter-boxed strip', () => {
  const s = presetBic49();
  const r = renderer(s, 980, 850);
  r.fit(aorBox(s), 40, false);
  const tl = r.toWorld(0, 0);
  const br = r.toWorld(r.w, r.h);
  const b = bbox(s.own.aor);
  assert.ok(tl.x < b.minX - 1000 && br.x > b.maxX + 1000, 'flanks visible either side of the AOR');
  assert.ok(tl.y >= b.maxY && br.y <= b.minY, 'AOR depth in view');
});

test('transparent overlays (3D drape) are not clamped', () => {
  const s = presetBic49();
  const r = renderer(s, 1024, 1024);
  r.layers.terrain = false;
  r.fit(undefined, 0, false);
  const contain = Math.min(1024 / s.terrain.width, 1024 / s.terrain.height);
  assert.ok(Math.abs(r.scale - contain) < 1e-9, 'overlay keeps the exact contain scale');
  r.panBy(300, 0);
  assert.notEqual(r.cx, s.terrain.width / 2, 'overlay pans freely');
  // an opaque offscreen texture of the whole sheet can opt out too
  const t = renderer(s, 2048, 1300);
  t.bounded = false;
  t.fit(undefined, 0, false);
  assert.ok(Math.abs(t.scale - Math.min(2048 / s.terrain.width, 1300 / s.terrain.height)) < 1e-9, 'unbounded keeps contain');
});

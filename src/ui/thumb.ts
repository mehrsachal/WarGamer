// Small map previews for scenario cards.
import type { Scenario } from '../core/types';
import { MapRenderer } from '../render/mapRenderer';
import { terrainFor } from '../terrain/terrain';
import { aorBox } from './scene';

const cache = new Map<string, string>();

export function scenarioThumb(s: Scenario, w = 420, h = 230): string {
  const key = `${s.id}:${w}x${h}`;
  const c = cache.get(key);
  if (c) return c;
  const canvas = document.createElement('canvas');
  const r = new MapRenderer(canvas, s, terrainFor(s.id, s.terrain, s.weather.going === 'wet'));
  r.resize(w, h);
  r.layers.grid = false;
  r.layers.labels = false;
  r.layers.aor = false;
  r.layers.decor = false;
  r.fit(aorBox(s, 300), 0, true);
  r.scene = { units: [], graphics: [] };
  r.draw();
  const url = canvas.toDataURL('image/jpeg', 0.82);
  cache.set(key, url);
  return url;
}

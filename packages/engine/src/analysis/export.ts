// OUT-3 — hand-over formats: GeoJSON (local grid metres, easting/northing from the map's grid origin) and CSV.
import type { MapModel } from '../data/ruleset';
import { type Hex, parseHexKey } from '../hex';
import type { AnalysisReport } from './analyse';

type Feature = { type: 'Feature'; geometry: { type: string; coordinates: unknown }; properties: Record<string, unknown> };

/** Local grid coordinate (metres east, metres north) of a hex centre. */
export function gridXY(map: MapModel, h: Hex): [number, number] {
  const c = map.centre_m(h);
  return [Math.round(map.def.gridRefOrigin.easting + c.x), Math.round(map.def.gridRefOrigin.northing - c.y)];
}

export function reportToGeoJSON(map: MapModel, r: AnalysisReport): { type: 'FeatureCollection'; name: string; crs_note: string; features: Feature[] } {
  const pt = (h: Hex, layer: string, props: Record<string, unknown>): Feature => ({ type: 'Feature', geometry: { type: 'Point', coordinates: gridXY(map, h) }, properties: { layer, gr: map.gridRef(h), ...props } });
  const line = (hs: Hex[], layer: string, props: Record<string, unknown>): Feature => ({ type: 'Feature', geometry: { type: 'LineString', coordinates: hs.map((h) => gridXY(map, h)) }, properties: { layer, ...props } });
  const multi = (keys: string[], layer: string, props: Record<string, unknown>): Feature => ({ type: 'Feature', geometry: { type: 'MultiPoint', coordinates: keys.map((k) => gridXY(map, parseHexKey(k))) }, properties: { layer, ...props } });
  const f: Feature[] = [];
  for (const i of r.itgs) {
    f.push(pt(i.hex, 'itg', { id: i.id, name: i.name, elevation: i.elevation, value: i.value, force: i.force, vital: i.vital, occupied: i.occupied, rating: i.rating, area_ha: i.area_ha, reasons: i.reasons.join('; ') }));
    f.push(multi(i.extent.map((h) => `${h.q},${h.r}`), 'itg_extent', { id: i.id }));
  }
  for (const x of r.terrain.ridges) f.push(line(x.hexes, 'ridge', { id: x.id, length_m: x.length_m, maxElev: x.maxElev, crossesBorder: x.crossesBorder }));
  for (const a of r.approaches) f.push(line(a.path, 'approach', { id: a.id, name: a.name, kind: a.kind, length_m: a.length_m, time_min: a.time_min, width_m: a.width_m, capacity: a.capacity, deadGroundPct: a.deadGroundPct, observedPct: a.observedPct }));
  for (const p of r.deployment.positions) f.push(pt(p.hex, 'position', { id: p.id, kind: p.kind, name: p.name, itg: p.itgId ?? '', distToBorder_m: p.distToBorder_m, coveragePct: p.coveragePct, mutualSupport: p.mutualSupport.join(' '), rating: p.rating, reasons: p.reasons.join('; ') }));
  for (const w of r.deployment.weapons) f.push(pt(w.hex, 'weapon', { id: w.id, weapon: w.weaponId, name: w.name, position: w.positionId, effRange_m: w.effRange_m, coveragePct: w.coveragePct, approaches: w.approaches.join(' '), rating: w.rating }));
  for (const m of r.deployment.mortars.sites) f.push(pt(m.hex, 'mortar', { id: m.id, weapon: m.weaponId, name: m.name, minRange_m: m.minRange_m, maxRange_m: m.maxRange_m, coveragePct: m.coveragePct }));
  for (const g of r.deployment.surveillance.gaps) f.push(line([g.from, g.to], 'surveillance_gap', { length_m: g.length_m }));
  for (const i of r.enemy.infiltration) f.push(line(i.path, 'infiltration', { id: i.id, rating: i.rating, length_m: i.length_m, time_min: i.time_min, exposurePct: i.exposurePct }));
  for (const e of r.enemy.exploitable) f.push(pt(e.hex, 'exploitable', { kind: e.kind, name: e.name, note: e.note }));
  for (const o of r.enemy.options) {
    f.push(line(o.axis, 'enemy_option', { id: o.id, name: o.name, likelihood: o.likelihood, score: o.score, time_min: o.time_min, summary: o.summary }));
    if (o.fup) f.push(pt(o.fup, 'enemy_fup', { option: o.id }));
  }
  if (map.def.border) f.push(line(map.def.border.hexes, 'border', {}));
  return {
    type: 'FeatureCollection',
    name: `${r.mapId}-${r.mode}`,
    crs_note: `Local grid metres of map ${r.mapId} (fictional training sector). Not a real coordinate system.`,
    features: f,
  };
}

const csvCell = (v: unknown) => {
  const s = Array.isArray(v) ? v.join(' ') : String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** One row per located item (ITG, position, weapon, mortar, enemy option) with grid ref, rating and reasons. */
export function reportToCSV(map: MapModel, r: AnalysisReport): string {
  const rows: unknown[][] = [['type', 'id', 'name', 'grid_ref', 'easting', 'northing', 'rating', 'detail']];
  const add = (type: string, id: string, name: string, h: Hex, rating: string, detail: string) => rows.push([type, id, name, map.gridRef(h), ...gridXY(map, h), rating, detail]);
  for (const i of r.itgs) add('ITG', i.id, i.name, i.hex, i.rating, `${i.vital ? 'VITAL; ' : ''}${i.force}; ${i.occupied ? 'occupied' : 'not occupied'}; ${i.reasons.join('; ')}`);
  for (const p of r.deployment.positions) add(p.kind, p.id, p.name, p.hex, p.rating, p.reasons.join('; '));
  for (const w of r.deployment.weapons) add('weapon', w.id, w.name, w.hex, w.rating, `eff ${w.effRange_m} m; covers ${w.coveragePct}%; ${w.approaches.join(' ')}`);
  for (const m of r.deployment.mortars.sites) add('mortar', m.id, m.name, m.hex, '', `${m.minRange_m}-${m.maxRange_m} m; covers ${m.coveragePct}%`);
  for (const a of r.approaches) add('approach', a.id, a.name, a.path[0], '', `${a.length_m} m; ${a.time_min} min; ${a.capacity}; dead ground ${a.deadGroundPct}%; crosses at ${a.crossingGr}`);
  for (const i of r.enemy.infiltration) add('infiltration', i.id, i.id, i.path[0], i.rating, `${i.length_m} m; ${i.time_min} min; crosses at ${i.crossingGr}; ${i.exposurePct}% exposed at night`);
  for (const o of r.enemy.options) add('enemy_option', o.id, o.name, o.axis[o.axis.length - 1], o.likelihood, o.summary);
  for (const rec of r.recommendations) rows.push(['recommendation', '', rec.severity, rec.hex ? map.gridRef(rec.hex) : '', '', '', '', rec.text]);
  return rows.map((row) => row.map(csvCell).join(',')).join('\n') + '\n';
}

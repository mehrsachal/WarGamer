// Debug view (Phase 0): render a map JSON to SVG with terrain colours, elevation shading, edges and labels.
//   npx tsx tools/preview-map.ts maps/ridgeline.json out.svg
import { readFileSync, writeFileSync } from 'node:fs';
import { type DataBundle, MapModel, Ruleset, hexCorners, hexToPoint, edgeSegment, directionTo } from '../packages/engine/src/index';

const root = new URL('../', import.meta.url);
const read = (f: string) => JSON.parse(readFileSync(new URL(f, root), 'utf8'));
const data = Ruleset.parse({ terrain: read('data/terrain.json'), edges: read('data/edges.json'), weapons: read('data/weapons.json'), units: read('data/units.json'), sensors: read('data/sensors.json'), rules: read('data/rules.json') } as DataBundle);
const [mapFile, out, overlay] = process.argv.slice(2);
const map = MapModel.parse(JSON.parse(readFileSync(mapFile, 'utf8')), data);
const S = 22;
const pts = map.list.map((h) => hexToPoint(h, map.def.orientation, S));
const minX = Math.min(...pts.map((p) => p.x)) - S;
const minY = Math.min(...pts.map((p) => p.y)) - S;
const maxX = Math.max(...pts.map((p) => p.x)) + S;
const maxY = Math.max(...pts.map((p) => p.y)) + S;
const els = map.list.map((h) => h.elevation_m);
const lo = Math.min(...els);
const hi = Math.max(...els);
let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${minX} ${minY} ${maxX - minX} ${maxY - minY}" width="${Math.round(maxX - minX)}" height="${Math.round(maxY - minY)}" font-family="sans-serif">`;
for (const h of map.list) {
  const c = hexCorners(h, map.def.orientation, S).map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  const shade = (h.elevation_m - lo) / Math.max(1, hi - lo);
  svg += `<polygon points="${c}" fill="${h.terrain.color}" stroke="#00000022" stroke-width="0.6"/>`;
  svg += `<polygon points="${c}" fill="rgba(90,60,30,${(shade * 0.45).toFixed(3)})"/>`;
}
for (const e of map.allEdges()) {
  const dir = directionTo(e.a, e.b);
  for (const f of e.features) {
    if (f.draw === 'centerline') {
      const a = hexToPoint(e.a, map.def.orientation, S);
      const b = hexToPoint(e.b, map.def.orientation, S);
      svg += `<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" stroke="${f.color}" stroke-width="${f.width}" stroke-linecap="round"/>`;
    } else {
      const [p1, p2] = edgeSegment(e.a, dir, map.def.orientation, S);
      svg += `<line x1="${p1.x}" y1="${p1.y}" x2="${p2.x}" y2="${p2.y}" stroke="${f.color}" stroke-width="${f.width}" stroke-linecap="round" ${f.id === 'bund' ? 'stroke-dasharray="2 2"' : ''}/>`;
    }
  }
}
for (const l of map.def.labels) {
  const p = hexToPoint(l, map.def.orientation, S);
  svg += `<text x="${p.x}" y="${p.y - 8}" font-size="11" font-weight="700" text-anchor="middle" fill="#111" stroke="#fff" stroke-width="3" paint-order="stroke">${l.text}</text>`;
}
if (overlay) svg += readFileSync(overlay, 'utf8');
svg += '</svg>';
writeFileSync(out, svg);
console.log('wrote', out);

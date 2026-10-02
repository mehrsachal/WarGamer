// Automated "Gr & Weather" appreciation used to build the DS solution for generated
// scenarios: approaches, important tactical ground, lines of def, likely FAA/FUP/BOF.
// The defender faces north (enemy enters from the top of the map).

import { type Vec, bbox, centroid, clamp, dist, distToPolyline, pointInPolygon, polylineLength, resample } from '../core/geom';
import type { Approach, DsSolution, ITG, LineOfDef, NamedPoint, OpsLevel } from '../core/types';
import type { TerrainModel } from './terrain';

interface Candidate {
  name: string;
  pos: Vec;
  kind: string;
  score: number;
  dom: number;
  obsFront: boolean;
}

const LEVEL_SCALE: Record<OpsLevel, number> = { PL: 0.5, COY: 1, BN: 2.2, BDE: 4 };

export function analyseTerrain(t: TerrainModel, aor: Vec[], entries: Vec[], level: OpsLevel): DsSolution {
  const k = LEVEL_SCALE[level];
  const box = bbox(aor);
  const width = box.maxX - box.minX;
  const nLanes = level === 'PL' ? 2 : 3;
  const flanks: ('L' | 'C' | 'R')[] = nLanes === 2 ? ['L', 'R'] : ['L', 'C', 'R'];

  // ---------------------------------------------------------------- approaches
  const approaches: (Approach & { score: number })[] = [];
  for (let i = 0; i < nLanes; i++) {
    const lx0 = box.minX + (width * i) / nLanes;
    const lx1 = box.minX + (width * (i + 1)) / nLanes;
    const cx = (lx0 + lx1) / 2;
    const entry = entries.reduce((b, e) => (Math.abs(e.x - cx) < Math.abs(b.x - cx) ? e : b), entries[0]);
    const start = t.clampPt({ x: (entry.x + cx) / 2, y: Math.min(t.data.height - 10, entry.y) });
    const goal = t.clampPt({ x: cx, y: box.minY + (box.maxY - box.minY) * 0.18 });
    // keep the path inside its lane
    const avoid: { pos: Vec; r: number; w: number }[] = [];
    for (let y = box.minY; y < box.maxY; y += 400 * k) {
      if (i > 0) avoid.push({ pos: { x: lx0 - 250 * k, y }, r: 500 * k, w: 6 });
      if (i < nLanes - 1) avoid.push({ pos: { x: lx1 + 250 * k, y }, r: 500 * k, w: 6 });
    }
    const path = t.findPath(start, goal, 'TRACKED', { avoid, preferCover: 0.6 });
    const pts = resample(path, 100);
    let going = 0, road = 0, cover = 0, water = 0;
    for (const p of pts) {
      going += t.goingAt(p, 'TRACKED');
      road += t.onRoad(p) ? 1 : 0;
      cover += t.concealAt(p);
      if (t.goingAt(p, 'TRACKED') < 0.3) water++;
    }
    const n = Math.max(1, pts.length);
    going /= n; road /= n; cover /= n;
    const depl = t.places.filter((pl) => ['bua', 'trees', 'kbund', 'dunes'].includes(pl.kind) && distToPolyline(pl.pos, path).d < 400 * k && pl.pos.y > box.minY + (box.maxY - box.minY) * 0.4);
    const score = going * 3 + road * 2.5 + cover * 2 + Math.min(3, depl.length) * 0.6 - water * 0.05 - polylineLength(path) / (10000 * k);
    const tankGoing: Approach['tankGoing'] = going > 0.8 ? 'good' : going > 0.55 ? 'fair' : 'poor';
    const fl = flanks[i];
    const flName = fl === 'L' ? 'Western (Lt)' : fl === 'R' ? 'Eastern (Rt)' : 'Central';
    const via = uniqueNames(t, path, 600 * k).slice(0, 5);
    approaches.push({
      id: `apch_${fl.toLowerCase()}`,
      name: `${flName} Apch`,
      flank: fl,
      path,
      tankGoing,
      pri: 0,
      capacity: tankGoing === 'poor' ? (level === 'BDE' ? 'Bde (-)' : level === 'BN' ? 'Bn' : 'Coy') : level === 'BDE' ? 'Bde sp by armr regt' : level === 'BN' ? 'Bde sp by armr sqn' : level === 'COY' ? 'Bn sp by a tp of tks' : 'Coy sp by tks',
      notes: [
        via.length ? `Passes through ${via.join(', ')}.` : 'Open gr with few landmarks.',
        `Tk going ${tankGoing}; ${Math.round(road * 100)}% along rds/trs (dir keeping ${road > 0.3 ? 'easy' : 'difficult'}).`,
        depl.length ? `Covered depl areas: ${depl.slice(0, 3).map((d) => d.name).join(', ')}.` : 'Lacks covered depl areas.',
      ],
      score,
    });
  }
  approaches.sort((a, b) => b.score - a.score).forEach((a, i) => (a.pri = i + 1));
  approaches.sort((a, b) => flanks.indexOf(a.flank) - flanks.indexOf(b.flank));

  // ---------------------------------------------------------------- ITGs
  const cands: Candidate[] = [];
  for (const f of t.data.features) {
    let pos: Vec | null = null;
    let base = 0;
    let kind: string = f.kind;
    if (f.kind === 'height') {
      pos = f.c;
      base = 1 + f.h / 6;
    } else if (f.kind === 'bua' && f.name) {
      pos = centroid(f.poly);
      base = 1.2 + f.storeys * 0.4;
    } else if (f.kind === 'kbund') {
      pos = f.c;
      base = 0.9;
    } else if ((f.kind === 'trees' || f.kind === 'broken') && f.name) {
      pos = centroid(f.poly);
      base = 0.5;
    }
    if (!pos || !f.name || !pointInPolygon(pos, aor)) continue;
    kind = f.kind;
    // domination: fraction of approach points (within 1.5 km) visible from here
    let seen = 0, tot = 0;
    for (const a of approaches) {
      for (const p of resample(a.path, 150 * k)) {
        if (dist(p, pos) > 1600 * k) continue;
        tot++;
        if (t.los(pos, p, t.eyeHeight(pos) + 1, 2.5) > 0.4) seen++;
      }
    }
    const dom = tot ? seen / tot : 0;
    const obsFront = t.data.features.some((w) => (w.kind === 'nullah' || w.kind === 'disty' || w.kind === 'canal' || w.kind === 'river') && (() => {
      const r = distToPolyline({ x: pos.x, y: pos.y + 250 * k }, w.pts);
      return r.d < 300 * k && r.pt.y > pos.y - 20;
    })());
    const onApch = Math.min(...approaches.map((a) => distToPolyline(pos!, a.path).d));
    const score = base + dom * 3 + (obsFront ? 1.2 : 0) + (onApch < 400 * k ? 0.8 : 0);
    cands.push({ name: f.name, pos, kind, score, dom, obsFront });
  }
  cands.sort((a, b) => b.score - a.score);
  const picked = cands.slice(0, level === 'PL' ? 5 : 8);

  // ---------------------------------------------------------------- lines of def
  const band = 450 * k;
  const lines: (LineOfDef & { score: number; y: number; obs: boolean; members: string[] })[] = [];
  const used = new Set<string>();
  const byY = [...picked].sort((a, b) => b.pos.y - a.pos.y);
  for (const c of byY) {
    if (used.has(c.name)) continue;
    const members = picked.filter((o) => !used.has(o.name) && Math.abs(o.pos.y - c.pos.y) < band).sort((a, b) => a.pos.x - b.pos.x);
    if (members.length === 0) continue;
    const span = members.length > 1 ? members[members.length - 1].pos.x - members[0].pos.x : 0;
    if (members.length < 2 && level !== 'PL') {
      // a single feature can still anchor a line if strong
      if (c.score < 3) continue;
    }
    members.forEach((m) => used.add(m.name));
    const y = members.reduce((s, m) => s + m.pos.y, 0) / members.length;
    const obs = members.some((m) => m.obsFront);
    const pts = [{ x: box.minX + 80, y }, ...members.map((m) => m.pos), { x: box.maxX - 80, y }].sort((a, b) => a.x - b.x);
    const cover = Math.min(1, (span + 600 * k) / width);
    const score = members.reduce((s, m) => s + m.score, 0) + (obs ? 2 : 0) + cover * 2;
    lines.push({ id: '', name: '', pts, itgIds: [], pri: 0, score, y, obs, members: members.map((m) => m.name) });
  }
  lines.sort((a, b) => b.y - a.y);
  const letters = ['X', 'Y', 'Z', 'W', 'V'];
  lines.slice(0, 5).forEach((l, i) => {
    l.id = `line_${letters[i].toLowerCase()}`;
  });
  const keptLines = lines.slice(0, 5);

  // recommended FDL: most forward line that leaves space for screens and scores well
  const front = box.maxY;
  const screenSpace = { PL: 700, COY: 1500, BN: 3000, BDE: 5000 }[level];
  const best = Math.max(...keptLines.map((l) => l.score), 0);
  let fdl = keptLines.find((l) => front - l.y >= screenSpace && l.score >= best * 0.6 && l.y > box.minY + (box.maxY - box.minY) * 0.2);
  if (!fdl) fdl = keptLines.find((l) => front - l.y >= screenSpace) ?? keptLines[0];
  const depth = fdl ? keptLines.find((l) => l.y < fdl!.y - 250 * k && l.y > fdl!.y - 2000 * k) : undefined;
  const sortedForPri = [...keptLines].sort((a, b) => (b === fdl ? 1 : 0) - (a === fdl ? 1 : 0) || b.score - a.score);
  sortedForPri.forEach((l, i) => (l.pri = i + 1));

  const itgs: ITG[] = picked.map((c, i) => ({
    id: `itg_${i}`,
    name: c.name,
    pos: c.pos,
    pri: 0,
    notes: `${c.kind === 'height' ? 'Relative ht' : c.kind === 'bua' ? 'BUA' : c.kind === 'kbund' ? 'Kidney bund' : 'Feature'}; dominates ${Math.round(c.dom * 100)}% of apchs in its vicinity${c.obsFront ? '; water obs in front' : ''}.`,
  }));
  // pri of ITGs: ground on the FDL line first (weighted by score), then by score
  const onFdl = (p: Vec) => (fdl ? Math.abs(p.y - fdl.y) < band : false);
  const ordered = [...itgs].sort((a, b) => {
    const ca = picked[Number(a.id.split('_')[1])];
    const cb = picked[Number(b.id.split('_')[1])];
    return (onFdl(b.pos) ? 2 : 0) + cb.score - ((onFdl(a.pos) ? 2 : 0) + ca.score);
  });
  ordered.forEach((it, i) => (it.pri = i + 1));
  if (ordered[0]) ordered[0].vital = true;
  for (const l of keptLines) {
    l.itgIds = itgs.filter((it) => l.members.includes(it.name)).map((it) => it.id);
    const names = itgs.filter((it) => l.itgIds.includes(it.id)).sort((a, b) => a.pos.x - b.pos.x).map((it) => it.name);
    l.name = `Line ${l.id.split('_')[1].toUpperCase()}: ${names.join(' – ') || 'open gr'}${l.obs ? ' (obs in front)' : ''}`;
  }

  // ---------------------------------------------------------------- likely en deployment areas
  const fdlY = fdl ? fdl.y : box.minY + (box.maxY - box.minY) * 0.45;
  const pickAlong = (a: Approach, dMin: number, dMax: number, kinds: string[], label: string): NamedPoint => {
    let bestPt: NamedPoint | null = null;
    let bestScore = -Infinity;
    for (const pl of t.places) {
      if (!kinds.includes(pl.kind)) continue;
      const ahead = pl.pos.y - fdlY;
      if (ahead < dMin || ahead > dMax) continue;
      const off = distToPolyline(pl.pos, a.path).d;
      if (off > 700 * k) continue;
      const s = -off / (300 * k) + (pl.kind === 'trees' || pl.kind === 'bua' ? 1 : 0.5);
      if (s > bestScore) {
        bestScore = s;
        bestPt = { name: pl.name, pos: pl.pos, approachId: a.id };
      }
    }
    if (bestPt) return bestPt;
    // fallback: point on the approach at the mid distance
    const mid = (dMin + dMax) / 2;
    const p = resample(a.path, 50).find((q) => q.y - fdlY <= mid) ?? a.path[0];
    return { name: `${label} ${t.squareRef(p).replace('Sq ', 'sq ')}`, pos: p, approachId: a.id };
  };
  const likelyFUPs = approaches.map((a) => pickAlong(a, 900 * k, 2200 * k, ['trees', 'bua', 'kbund', 'dunes', 'broken'], 'FUP'));
  const likelyFAAs = approaches.map((a) => pickAlong(a, 2000 * k, 4500 * k, ['bua', 'trees', 'kbund'], 'FAA'));
  const likelyBOFs = approaches.map((a) => pickAlong(a, 700 * k, 1800 * k, ['height', 'kbund', 'dunes', 'bua'], 'BOF'));

  const screenArea = fdl
    ? (() => {
        const ahead = keptLines.find((l) => l !== fdl && l.y > fdl!.y + 600 * k && l.y < front - 300 * k);
        if (ahead) return { name: ahead.name.replace(/^Line [A-Z]: /, ''), pos: centroid(ahead.pts.slice(1, -1).length ? ahead.pts.slice(1, -1) : ahead.pts) };
        return { name: 'fwd of FDLs', pos: { x: (box.minX + box.maxX) / 2, y: clamp(fdlY + 1200 * k, fdlY, front - 200) } };
      })()
    : undefined;

  const pri = [...approaches].sort((a, b) => a.pri - b.pri);
  const notes = [
    `Pri of apchs: ${pri.map((a) => a.name).join(' > ')}.`,
    `Pri of ITGs: ${ordered.map((i) => i.name).join(' > ')}.`,
    `Lines of def in order of pri: ${sortedForPri.map((l) => l.name).join(' > ')}.`,
    fdl ? `FDLs as far fwd as tac feasible: ${fdl.name}${depth ? `; depth on ${depth.name}` : ''}.` : 'No clear line of def — base def on the most dominating ground.',
    `Most likely en FUP: ${likelyFUPs.find((f) => f.approachId === pri[0].id)?.name ?? '-'}; FAA ${likelyFAAs.find((f) => f.approachId === pri[0].id)?.name ?? '-'}; BOF ${likelyBOFs.find((f) => f.approachId === pri[0].id)?.name ?? '-'}.`,
    `Bias of def and A tk def: ${pri[0].flank === 'L' ? 'Lt' : pri[0].flank === 'R' ? 'Rt' : 'Cen'}.`,
  ];

  return {
    approaches: approaches.map(({ score: _s, ...a }) => a),
    itgs,
    linesOfDef: keptLines.map(({ score: _s, y: _y, obs: _o, members: _m, ...l }) => l),
    recommendedFdl: fdl?.id ?? '',
    recommendedDepth: depth?.id,
    screenArea,
    likelyFAAs,
    likelyFUPs,
    likelyBOFs,
    notes,
  };
}

function uniqueNames(t: TerrainModel, path: Vec[], r: number): string[] {
  const out: string[] = [];
  for (const p of resample(path, 200)) {
    const n = t.nearestPlace(p);
    if (n && n.d < r && !out.includes(n.place.name)) out.push(n.place.name);
  }
  return out;
}

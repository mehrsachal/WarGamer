// Rigid translation of scenarios and of the work done on them (plans, wargame records).
// Used to widen a preset's map frame (BIC-49 v2 adds flank terrain W and E of the issued
// sketch) and to migrate saved attempts so they stay aligned with the new frame.

import { type Vec, translatePts as tp, translateVec as tv } from '../core/geom';
import type { Attempt, DsSolution, Feature, NamedPoint, Plan, Scenario, WargameRecord } from '../core/types';

const isZero = (d: Vec) => d.x === 0 && d.y === 0;

export function translateFeature(f: Feature, d: Vec): Feature {
  switch (f.kind) {
    case 'bua':
    case 'trees':
    case 'broken':
    case 'grass':
    case 'dunes':
    case 'marsh':
      return { ...f, poly: tp(f.poly, d) };
    case 'height':
    case 'kbund':
      return { ...f, c: tv(f.c, d) };
    case 'bop':
    case 'bridge':
    case 'graveyard':
      return { ...f, pos: tv(f.pos, d) };
    default:
      return { ...f, pts: tp(f.pts, d) };
  }
}

const np = (p: NamedPoint, d: Vec): NamedPoint => ({ ...p, pos: tv(p.pos, d) });

export function translateDs(ds: DsSolution, d: Vec): DsSolution {
  return {
    ...ds,
    approaches: ds.approaches.map((a) => ({ ...a, path: tp(a.path, d) })),
    itgs: ds.itgs.map((i) => ({ ...i, pos: tv(i.pos, d) })),
    linesOfDef: ds.linesOfDef.map((l) => ({ ...l, pts: tp(l.pts, d) })),
    screenArea: ds.screenArea ? np(ds.screenArea, d) : undefined,
    likelyFAAs: ds.likelyFAAs.map((p) => np(p, d)),
    likelyFUPs: ds.likelyFUPs.map((p) => np(p, d)),
    likelyBOFs: ds.likelyBOFs.map((p) => np(p, d)),
  };
}

/**
 * Translate every world coordinate of a scenario (terrain features, AOR, boundaries, enemy
 * entry points, DS solution) by d. The terrain extent and grid origin are left to the caller.
 */
export function translateScenario(s: Scenario, d: Vec): Scenario {
  return {
    ...s,
    terrain: {
      ...s.terrain,
      features: s.terrain.features.map((f) => translateFeature(f, d)),
      // the micro-relief moves with the ground
      noise: { seed: s.terrain.noise?.seed ?? `terrain-${s.terrain.width}-${s.terrain.height}-${s.terrain.features.length}`, origin: tv(s.terrain.noise?.origin ?? { x: 0, y: 0 }, d) },
    },
    own: {
      ...s.own,
      aor: tp(s.own.aor, d),
      boundaries: s.own.boundaries.map((b) => ({ ...b, pts: tp(b.pts, d) })),
    },
    enemy: { ...s.enemy, entry: tp(s.enemy.entry, d) },
    ds: translateDs(s.ds, d),
  };
}

/** Translate a student's plan (unit positions, alternate posns, goose eggs, graphics, group outlines). */
export function translatePlan(p: Plan, d: Vec): Plan {
  if (isZero(d)) return p;
  return {
    ...p,
    units: p.units.map((u) => ({
      ...u,
      pos: tv(u.pos, d),
      altPos: u.altPos ? tv(u.altPos, d) : undefined,
      area: u.area ? tp(u.area, d) : undefined,
    })),
    graphics: p.graphics.map((g) => ({ ...g, pts: tp(g.pts, d) })),
    groups: p.groups?.map((g) => ({ ...g, area: g.area ? tp(g.area, d) : undefined })),
  };
}

/** Translate a stored wargame record (AAR replay frames, fire events, en plan). */
export function translateWargame(w: WargameRecord, d: Vec): WargameRecord {
  if (isZero(d)) return w;
  const ep = w.enemyPlan;
  return {
    ...w,
    frames: w.frames.map((f) => ({
      ...f,
      u: f.u.map(([id, x, y, s, st]) => [id, x + d.x, y + d.y, s, st] as [string, number, number, number, number]),
      f: f.f.map(([fx, fy, tx, ty, k]) => [fx + d.x, fy + d.y, tx + d.x, ty + d.y, k] as [number, number, number, number, number]),
    })),
    enemyPlan: ep
      ? {
          ...ep,
          faa: tv(ep.faa, d),
          fup: tv(ep.fup, d),
          bof: tv(ep.bof, d),
          approach: tp(ep.approach, d),
          objectives: ep.objectives.map((o) => ({ ...o, pos: tv(o.pos, d) })),
        }
      : undefined,
  };
}

/** Translate everything positional in an attempt. */
export function translateAttempt(a: Attempt, d: Vec): Attempt {
  if (isZero(d)) return a;
  return { ...a, plan: translatePlan(a.plan, d), wargame: a.wargame ? translateWargame(a.wargame, d) : undefined };
}

/** A geometry change of a preset: attempts made before `to` are shifted by `shift`. */
export interface FrameMigration {
  to: number;
  shift: Vec;
}

/** Total shift to bring work made on version `from` (absent = 1) up to version `to`. */
export function shiftBetween(migrations: FrameMigration[], from: number | undefined, to: number): Vec {
  const f = from ?? 1;
  const d = { x: 0, y: 0 };
  for (const m of migrations) {
    if (m.to > f && m.to <= to) {
      d.x += m.shift.x;
      d.y += m.shift.y;
    }
  }
  return d;
}

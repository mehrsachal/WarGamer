// Builders that turn plans, live engine state and replay frames into map scenes.
import { bbox, sub, type Vec } from '../core/geom';
import type { Plan, PlacedUnit, ReplayFrame, Scenario } from '../core/types';
import { TEMPLATES } from '../core/units';
import { edgePointToward, eggPoints, enclosingEgg, isAreaUnit, sampleClosed, translatePts, unitArea } from '../plan/area';
import { isFoundElement, strengthBook, strengthText } from '../plan/taskorg';
import type { MapScene, UnitGlyph } from '../render/mapRenderer';
import { contactSidc } from '../render/symbols';
import type { Engine } from '../sim/engine';

const ARC_ROLES = new Set(['FDL', 'DEPTH', 'SP_WPN', 'SCREEN']);

function glyphKind(templateKey: string): UnitGlyph['glyph'] {
  const k = TEMPLATES[templateKey]?.kind;
  return k === 'ARMOUR' ? 'ARMOUR' : k === 'HQ' ? 'HQ' : k === 'INF' ? 'INF' : 'NONE';
}

/** Egg fields of a glyph for a placed unit drawn at `at` (planned position by default). */
function eggOf(pu: PlacedUnit, at?: Vec): Pick<UnitGlyph, 'area' | 'echelon' | 'glyph'> {
  if (!isAreaUnit(pu)) return {};
  const a = unitArea(pu);
  return { area: at ? translatePts(a, sub(at, pu.pos)) : a, echelon: TEMPLATES[pu.templateKey]?.echelon, glyph: glyphKind(pu.templateKey) };
}

/** Where a found element's connector starts: the parent egg's edge (or the parent symbol). */
function linkFrom(parent: PlacedUnit, parentAt: Vec | undefined, to: Vec): Vec {
  if (!isAreaUnit(parent)) return parentAt ?? parent.pos;
  const a = unitArea(parent);
  return edgePointToward(parentAt ? translatePts(a, sub(parentAt, parent.pos)) : a, to);
}

export function planUnits(plan: Plan, selected?: string | string[]): UnitGlyph[] {
  const sel = new Set(typeof selected === 'string' ? [selected] : selected ?? []);
  const book = strengthBook(plan);
  const byId = new Map(plan.units.map((u) => [u.id, u]));
  return plan.units.map((u) => {
    const t = TEMPLATES[u.templateKey];
    const parent = u.parentId ? byId.get(u.parentId) : undefined;
    const egg = eggOf(u);
    const e = book.get(u.id);
    const reduced = !!e && e.detached > 0;
    const found = isFoundElement(u) && parent;
    const point = !egg.area;
    return {
      id: u.id,
      sidc: t?.sidc ?? 'SFGPU----------',
      pos: u.pos,
      label: reduced ? `${u.label} (-)` : u.label,
      facing: u.facing,
      arc: ARC_ROLES.has(u.role),
      side: 'BLUE',
      selected: sel.has(u.id),
      altPos: u.altPos,
      altArea: egg.area && u.altPos ? translatePts(egg.area, sub(u.altPos, u.pos)) : undefined,
      link: found ? { from: linkFrom(parent, undefined, u.pos), tag: `from ${parent.label}` } : undefined,
      parentPos: !found && parent && (u.role === 'SP_PTL' || u.role === 'LP') ? parent.pos : undefined,
      shape: u.templateKey === 'LP' || u.role === 'LP' || u.role === 'OP' ? 'OPLP' : undefined,
      sub: point && found ? strengthText(e?.base ?? 0) : undefined,
      planned: u.role === 'RES' ? true : undefined,
      radius: point && t?.kind === 'INF' ? t.radius : undefined,
      ...egg,
    };
  });
}

/** Task-organisation group outlines (larger dashed eggs around their members). */
export function planGroups(plan: Plan, selectedGroupId?: string): NonNullable<MapScene['groups']> {
  const out: NonNullable<MapScene['groups']> = [];
  for (const g of plan.groups ?? []) {
    const members = plan.units.filter((u) => g.memberIds.includes(u.id));
    if (!members.length) continue;
    const pts: Vec[] = [];
    let ext = 0;
    for (const m of members) {
      if (isAreaUnit(m)) {
        const s = sampleClosed(unitArea(m), 3);
        pts.push(...s);
      } else pts.push(m.pos);
    }
    const b = bbox(pts);
    ext = Math.max(b.maxX - b.minX, b.maxY - b.minY);
    const margin = Math.max(45, ext * 0.1);
    const area = g.area && g.area.length >= 3 ? g.area : members.length === 1 && !isAreaUnit(members[0]) ? eggPoints(members[0].pos, margin * 1.5, margin, members[0].facing, 10) : enclosingEgg(pts, margin, 14);
    out.push({ id: g.id, label: g.label, area, selected: g.id === selectedGroupId, echelon: g.echelon });
  }
  return out;
}

export function planScene(
  s: Scenario,
  plan: Plan,
  o: { selectedUnitId?: string; selectedUnitIds?: string[]; selectedGraphicId?: string; selectedGraphicIds?: string[]; selectedGroupId?: string; ds?: boolean } = {},
): MapScene {
  const selUnits = [...(o.selectedUnitIds ?? []), ...(o.selectedUnitId ? [o.selectedUnitId] : [])];
  return {
    units: planUnits(plan, selUnits),
    graphics: plan.graphics,
    groups: planGroups(plan, o.selectedGroupId),
    selectedGraphicId: o.selectedGraphicId,
    selectedGraphicIds: o.selectedGraphicIds,
    ds: o.ds ? s.ds : null,
  };
}

export function aorBox(s: Scenario, pad = 600): { minX: number; minY: number; maxX: number; maxY: number } {
  const b = bbox(s.own.aor);
  const k = s.level === 'BDE' ? 3 : s.level === 'BN' ? 1.8 : 1;
  return { minX: Math.max(0, b.minX - pad * k), minY: Math.max(0, b.minY - pad * k * 0.3), maxX: Math.min(s.terrain.width, b.maxX + pad * k), maxY: Math.min(s.terrain.height, b.maxY + pad * k * 0.8) };
}

/** Live wargame picture: own units truthfully, en only as contacts (unless fog is OFF). */
export function simScene(e: Engine, opts: { selectedId?: string; fog?: MapScene['fog']; reveal?: boolean }): MapScene {
  const units: UnitGlyph[] = [];
  const planned = new Map(e.plan.units.map((u) => [u.id, u]));
  for (const u of e.units) {
    if (u.side !== 'BLUE' || u.state === 'OFFMAP') continue;
    if (u.role === 'LP' && u.task === 'LP (by ni)') continue;
    const lost = u.state === 'CAPTURED' || u.state === 'DESTROYED';
    const pu = planned.get(u.id);
    const parentSim = u.parentId ? e.byId.get(u.parentId) : undefined;
    const parentPu = u.parentId ? planned.get(u.parentId) : undefined;
    const found = pu && isFoundElement(pu) && parentPu && parentSim && !lost && (parentSim.state !== 'CAPTURED' && parentSim.state !== 'DESTROYED');
    units.push({
      id: u.id,
      sidc: u.sidc,
      pos: u.pos,
      label: u.label,
      side: 'BLUE',
      facing: u.facing,
      arc: false,
      strengthPct: (100 * u.strength) / Math.max(1, u.start),
      selected: u.id === opts.selectedId,
      dim: lost,
      status: lost ? 'LOST' : u.state === 'ASSAULT' ? 'ASSAULT' : u.state === 'WITHDRAW' ? 'WITHDRAW' : 'OK',
      radius: u.kind === 'INF' && !(pu && isAreaUnit(pu)) ? u.radius : undefined,
      shape: u.role === 'LP' || u.role === 'OP' ? 'OPLP' : undefined,
      link: found ? { from: linkFrom(parentPu, parentSim.pos, u.pos) } : undefined,
      ...(pu ? eggOf(pu, u.pos) : {}),
    });
  }
  if (opts.reveal || e.opts.fog === 'OFF') {
    for (const u of e.units) {
      if (u.side !== 'RED' || u.state === 'OFFMAP' || u.state === 'DESTROYED') continue;
      units.push({ id: u.id, sidc: u.sidc, pos: u.pos, label: u.label.replace('En ', ''), side: 'RED', strengthPct: (100 * u.strength) / Math.max(1, u.start), selected: u.id === opts.selectedId, status: u.state === 'ASSAULT' ? 'ASSAULT' : u.state === 'WITHDRAW' ? 'WITHDRAW' : 'OK', dim: u.state === 'CAPTURED' });
    }
  } else {
    for (const c of e.contacts.values()) {
      const stale = e.t - c.lastSeen > 10;
      const partial = e.opts.fog === 'PARTIAL';
      const u = e.byId.get(c.unitId);
      const ident = partial && u ? (u.kind === 'ARMOUR' ? 'ARMOUR' : u.role === 'RECCE' ? 'RECCE' : 'INF') : c.ident;
      // an identified, stationary coy-size en is also shown as the area it occupies (dashed red egg)
      const area = !c.moving && !stale && c.size === 'COY' && ident !== 'UNKNOWN' && c.conf > 0.5 ? eggPoints(c.pos, 200, 120, 0, 8) : undefined;
      units.push({
        id: c.id,
        sidc: contactSidc(ident, c.size, c.vehicles),
        pos: c.pos,
        label: c.vehicles ? `${c.vehicles} tks` : '',
        side: ident === 'UNKNOWN' ? 'UNK' : 'RED',
        conf: Math.max(0.15, c.conf),
        stale,
        selected: c.id === opts.selectedId,
        status: c.moving ? 'MOVE' : 'OK',
        area,
        planned: area ? true : undefined,
      });
    }
  }
  const missions = e.missions.filter((m) => e.t >= m.start && e.t < m.end).map((m) => ({ target: { x: m.target.x + m.error.x, y: m.target.y + m.error.y }, radius: m.radius, side: m.side, label: m.label }));
  return {
    units,
    graphics: e.plan.graphics,
    fires: e.fireEvents.map((f) => ({ from: f.from, to: f.to, kind: f.kind })),
    missions,
    qcs: e.qcs.filter((q) => q.airborne).map((q) => ({ pos: q.pos, kind: q.kind })),
    fog: opts.fog ?? null,
    night: e.light === 'NIGHT',
  };
}

export interface UnitMeta {
  id: string;
  sidc: string;
  label: string;
  side: 'BLUE' | 'RED';
}

export function unitMetaFromEngine(e: Engine): UnitMeta[] {
  return e.units.map((u) => ({ id: u.id, sidc: u.sidc, label: u.side === 'RED' ? u.label.replace('En ', '') : u.label, side: u.side }));
}

/** Ground-truth replay frame (AAR). Own localities are drawn as their eggs, moved with the unit. */
export function replayScene(plan: Plan, meta: UnitMeta[], frames: ReplayFrame[], idx: number, night: boolean): MapScene {
  const f = frames[Math.max(0, Math.min(frames.length - 1, idx))];
  const byId = new Map(meta.map((m) => [m.id, m]));
  const planned = new Map(plan.units.map((u) => [u.id, u]));
  const units: UnitGlyph[] = [];
  const trails = new Map<string, Vec[]>();
  for (let i = Math.max(0, idx - 40); i <= idx && i < frames.length; i++) {
    for (const [id, x, y] of frames[i].u) {
      const m = byId.get(id);
      if (!m || m.side !== 'RED') continue;
      const arr = trails.get(id) ?? [];
      arr.push({ x, y });
      trails.set(id, arr);
    }
  }
  if (f) {
    for (const [id, x, y, pct, code] of f.u) {
      const m = byId.get(id);
      if (!m) continue;
      const pu = m.side === 'BLUE' ? planned.get(id) : undefined;
      units.push({
        id,
        sidc: m.sidc,
        pos: { x, y },
        label: m.label,
        side: m.side,
        strengthPct: pct,
        dim: code === 2,
        status: code === 2 ? 'LOST' : code === 1 ? 'ASSAULT' : code === 3 ? 'WITHDRAW' : 'OK',
        shape: pu && (pu.role === 'LP' || pu.role === 'OP') ? 'OPLP' : undefined,
        ...(pu ? eggOf(pu, { x, y }) : {}),
      });
    }
  }
  const fires = f ? f.f.map(([a, b, c, d, k]) => ({ from: { x: a, y: b }, to: { x: c, y: d }, kind: k })) : [];
  return { units, graphics: plan.graphics, fires, trails: [...trails.values()].map((pts) => ({ pts, side: 'RED' as const })), night };
}

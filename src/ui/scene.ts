// Builders that turn plans, live engine state and replay frames into map scenes.
import { bbox, type Vec } from '../core/geom';
import type { Plan, ReplayFrame, Scenario } from '../core/types';
import { TEMPLATES } from '../core/units';
import type { MapScene, UnitGlyph } from '../render/mapRenderer';
import { contactSidc } from '../render/symbols';
import type { Engine } from '../sim/engine';

const ARC_ROLES = new Set(['FDL', 'DEPTH', 'SP_WPN', 'SCREEN']);

export function planUnits(plan: Plan, selectedId?: string): UnitGlyph[] {
  return plan.units.map((u) => {
    const t = TEMPLATES[u.templateKey];
    const parent = u.parentId ? plan.units.find((p) => p.id === u.parentId) : undefined;
    return {
      id: u.id,
      sidc: t?.sidc ?? 'SFGPU----------',
      pos: u.pos,
      label: u.label,
      facing: u.facing,
      arc: ARC_ROLES.has(u.role),
      side: 'BLUE',
      selected: u.id === selectedId,
      altPos: u.altPos,
      parentPos: parent && (u.role === 'SP_PTL' || u.role === 'LP') ? parent.pos : undefined,
      radius: t?.kind === 'INF' ? t.radius : undefined,
    };
  });
}

export function planScene(s: Scenario, plan: Plan, o: { selectedUnitId?: string; selectedGraphicId?: string; ds?: boolean } = {}): MapScene {
  return {
    units: planUnits(plan, o.selectedUnitId),
    graphics: plan.graphics,
    selectedGraphicId: o.selectedGraphicId,
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
  for (const u of e.units) {
    if (u.side !== 'BLUE' || u.state === 'OFFMAP') continue;
    if (u.role === 'LP' && u.task === 'LP (by ni)') continue;
    const lost = u.state === 'CAPTURED' || u.state === 'DESTROYED';
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
      radius: u.kind === 'INF' ? u.radius : undefined,
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

/** Ground-truth replay frame (AAR). */
export function replayScene(plan: Plan, meta: UnitMeta[], frames: ReplayFrame[], idx: number, night: boolean): MapScene {
  const f = frames[Math.max(0, Math.min(frames.length - 1, idx))];
  const byId = new Map(meta.map((m) => [m.id, m]));
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
      units.push({ id, sidc: m.sidc, pos: { x, y }, label: m.label, side: m.side, strengthPct: pct, dim: code === 2, status: code === 2 ? 'LOST' : code === 1 ? 'ASSAULT' : code === 3 ? 'WITHDRAW' : 'OK' });
    }
  }
  const fires = f ? f.f.map(([a, b, c, d, k]) => ({ from: { x: a, y: b }, to: { x: c, y: d }, kind: k })) : [];
  return { units, graphics: plan.graphics, fires, trails: [...trails.values()].map((pts) => ({ pts, side: 'RED' as const })), night };
}

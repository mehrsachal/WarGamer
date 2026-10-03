// Task organisation: dividing (splitting / detaching) and grouping forces, strength
// bookkeeping and the "found from" relationship of standing ptls, LPs, screens and ptls.
// The plan stores only the facts (child.splitFrom + child.strength, child.parentId); the
// reduced strength of the origin is always derived here, so it can never drift.

import { dist } from '../core/geom';
import { uid } from '../core/rng';
import type { Plan, PlanGroup, PlacedUnit, Role } from '../core/types';
import { TEMPLATES, type WeaponKey } from '../core/units';
import { areaCentroid, defaultEggAxes, eggPoints, isAreaUnit, setUnitArea, unitArea } from './area';

/** Elements that are found (detached) from a parent locality and say so on the map. */
export const FOUND_ROLES = new Set<Role>(['SP_PTL', 'LP', 'OP', 'SCREEN']);

/** Templates whose legacy placement with a parentId means "detached from that locality". */
const LEGACY_DET = new Set(['RIFLE_SEC', 'LP']);

export function baseStrength(u: PlacedUnit): number {
  return u.strength ?? TEMPLATES[u.templateKey]?.personnel ?? 0;
}

/** Template personnel of the unit as originally issued (ignores split overrides). */
function templatePersonnel(u: PlacedUnit): number {
  return TEMPLATES[u.templateKey]?.personnel ?? 0;
}

/** The unit (id) a unit's strength is deducted from, and whether it is a legacy (template) detachment. */
export function deductsFrom(u: PlacedUnit): { id: string; legacy: boolean } | null {
  if (u.splitFrom) return { id: u.splitFrom, legacy: false };
  if (u.parentId && u.strength !== undefined) return { id: u.parentId, legacy: false };
  if (u.parentId && LEGACY_DET.has(u.templateKey)) return { id: u.parentId, legacy: true };
  return null;
}

/** Weapons of an element of `templateKey` with `strength` men (template weapons scaled, rounded). */
export function scaledWeapons(templateKey: string, strength: number): Partial<Record<WeaponKey, number>> {
  const t = TEMPLATES[templateKey];
  if (!t) return {};
  const k = t.personnel > 0 ? strength / t.personnel : 1;
  const out: Partial<Record<WeaponKey, number>> = {};
  for (const [w, n] of Object.entries(t.weapons) as [WeaponKey, number][]) {
    const v = k === 1 ? n : Math.round(n * k);
    if (v > 0) out[w] = v;
  }
  return out;
}

export interface StrengthEntry {
  /** Strength as issued / set (template or override). */
  base: number;
  /** Personnel detached to children. */
  detached: number;
  /** Strength left in the unit. */
  effective: number;
  /** Weapons left in the unit. */
  weapons: Partial<Record<WeaponKey, number>>;
  /** Ids of the units that took strength from this one. */
  children: string[];
}

/**
 * Strength & weapons bookkeeping for the whole plan. Detachments with an explicit strength (split
 * elements) take exactly that many men and their share of weapons; legacy template detachments
 * (standing ptl sec / LP found by a locality) keep the v1 rule (at most half the parent).
 */
export function strengthBook(plan: Plan): Map<string, StrengthEntry> {
  const book = new Map<string, StrengthEntry>();
  const byId = new Map(plan.units.map((u) => [u.id, u]));
  for (const u of plan.units) {
    const t = TEMPLATES[u.templateKey];
    book.set(u.id, { base: baseStrength(u), detached: 0, effective: baseStrength(u), weapons: u.strength !== undefined ? scaledWeapons(u.templateKey, u.strength) : { ...(t?.weapons ?? {}) }, children: [] });
  }
  const legacyDet = new Map<string, number>();
  for (const u of plan.units) {
    const d = deductsFrom(u);
    if (!d || d.id === u.id) continue;
    const parent = book.get(d.id);
    if (!parent || !byId.has(d.id)) continue;
    const n = d.legacy ? templatePersonnel(u) : baseStrength(u);
    parent.detached += n;
    parent.children.push(u.id);
    if (d.legacy) legacyDet.set(d.id, (legacyDet.get(d.id) ?? 0) + n);
    else {
      const w = book.get(u.id)!.weapons;
      for (const [k, v] of Object.entries(w) as [WeaponKey, number][]) parent.weapons[k] = Math.max(0, (parent.weapons[k] ?? 0) - v);
    }
  }
  for (const [id, e] of book) {
    const legacy = legacyDet.get(id) ?? 0;
    const split = e.detached - legacy;
    const floor = split > 0 ? 1 : Math.round(e.base * 0.5);
    e.effective = Math.max(Math.min(e.base, floor), e.base - e.detached);
    for (const k of Object.keys(e.weapons) as WeaponKey[]) if (!e.weapons[k]) delete e.weapons[k];
  }
  return book;
}

/** "1+2" style strength for small elements; plain number for large ones. */
export function strengthText(n: number): string {
  if (n <= 1) return `${n}`;
  if (n <= 12) return `1+${n - 1}`;
  return `${n}`;
}

// ---------------------------------------------------------------------------- found from

/** Units that may "find" (provide) a detachment: localities that are not themselves detachments. */
export function localities(plan: Plan, exceptId?: string): PlacedUnit[] {
  return plan.units.filter((u) => u.id !== exceptId && isAreaUnit(u) && !FOUND_ROLES.has(u.role));
}

/** Default parent locality for an element placed at pos: LPs from the nearest fwd locality, SPs/screens preferably from depth. */
export function defaultFoundBy(plan: Plan, role: Role, pos: { x: number; y: number }, exceptId?: string): string | undefined {
  const locs = localities(plan, exceptId);
  if (!locs.length) return undefined;
  const pref = role === 'LP' || role === 'OP' ? locs.filter((u) => u.role === 'FDL') : locs.filter((u) => u.role === 'DEPTH' || u.role === 'RES');
  const pool = pref.length ? pref : locs;
  return [...pool].sort((a, b) => dist(a.pos, pos) - dist(b.pos, pos))[0]?.id;
}

/** True if this unit is shown with a "found from" connector & tag. */
export function isFoundElement(u: PlacedUnit): boolean {
  return !!u.parentId && FOUND_ROLES.has(u.role);
}

export function foundTag(plan: Plan, u: PlacedUnit): string | undefined {
  if (!u.parentId || !FOUND_ROLES.has(u.role)) return undefined;
  const p = plan.units.find((x) => x.id === u.parentId);
  return p ? `from ${p.label}` : undefined;
}

/** Short label suffix for lists ("LP 1 — from 1 Pl (1+2)"). */
export function foundLabel(plan: Plan, u: PlacedUnit): string {
  const tag = foundTag(plan, u);
  const n = baseStrength(u);
  return tag ? `${u.label} — ${tag} (${strengthText(n)})` : u.label;
}

// ---------------------------------------------------------------------------- split / merge

const CHILD_TEMPLATE: Record<string, string> = {
  RIFLE_PL: 'RIFLE_SEC',
  SCREEN_PL: 'RIFLE_SEC',
  RIFLE_COY: 'RIFLE_PL',
  INF_BN: 'RIFLE_COY',
};

const ORD = ['1', '2', '3', '4', '5', '6'];

export interface SplitOptions {
  /** Into its sub-elements (pl -> 3 secs, coy -> 3 pls, bn -> 4 coys). */
  kind: 'ELEMENTS' | 'ONE' | 'MEN' | 'WEAPON';
  /** For MEN: number of men to detach. */
  men?: number;
  /** For ONE / MEN: role of the detached element (e.g. SP_PTL), else inherits. */
  role?: Role;
}

/** Which split actions make sense for this unit. */
export function splitOptions(plan: Plan, u: PlacedUnit): { elements: boolean; one: boolean; men: boolean; weapon: boolean; childName?: string; elementsCount: number } {
  const t = TEMPLATES[u.templateKey];
  const child = CHILD_TEMPLATE[u.templateKey];
  const eff = strengthBook(plan).get(u.id)?.effective ?? 0;
  const childT = child ? TEMPLATES[child] : undefined;
  const nEl = t?.elements ?? 0;
  const alreadySplit = plan.units.filter((x) => x.splitFrom === u.id && x.templateKey === child).length;
  const primary = primaryWeapon(u.templateKey);
  const wn = primary ? strengthBook(plan).get(u.id)?.weapons[primary] ?? 0 : 0;
  return {
    elements: !!childT && alreadySplit === 0 && eff > childT.personnel * nEl,
    one: !!childT && alreadySplit < nEl && eff > childT.personnel,
    men: eff > 2,
    weapon: !!primary && wn > 1,
    childName: childT ? (t.elementName ?? childT.short) : undefined,
    elementsCount: nEl,
  };
}

/** Crew-served weapon a weapons det can be split by (one det per weapon). */
export function primaryWeapon(templateKey: string): WeaponKey | undefined {
  const t = TEMPLATES[templateKey];
  if (!t || (t.kind !== 'MORTAR' && t.kind !== 'AT' && t.kind !== 'MG')) return undefined;
  const order: WeaponKey[] = ['MOR81', 'MOR60', 'BS', 'RR106', 'GLHMG', 'MG'];
  return order.find((w) => (t.weapons[w] ?? 0) > 0);
}

/** Split / detach from unit `id`. Returns the new units (already pushed into plan.units). */
export function splitUnit(plan: Plan, id: string, o: SplitOptions): PlacedUnit[] {
  const u = plan.units.find((x) => x.id === id);
  if (!u) return [];
  const t = TEMPLATES[u.templateKey];
  const book = strengthBook(plan);
  const eff = book.get(u.id)?.effective ?? baseStrength(u);
  const out: PlacedUnit[] = [];
  const area = unitArea(u);
  const c = areaCentroid(area);
  const mk = (templateKey: string, label: string, strength: number, pos: { x: number; y: number }, role: Role, area?: boolean): PlacedUnit => {
    const n: PlacedUnit = { id: uid('u'), templateKey, label, pos: { x: Math.round(pos.x), y: Math.round(pos.y) }, facing: u.facing, role, splitFrom: u.id, strength, groupId: u.groupId };
    if (role === 'SP_PTL' || role === 'LP' || role === 'OP' || role === 'SCREEN') n.parentId = u.id;
    if (area && isAreaUnit(n)) {
      const ax = defaultEggAxes(templateKey);
      setUnitArea(n, eggPoints(n.pos, ax.front, ax.depth, u.facing));
    }
    plan.units.push(n);
    if (u.groupId) plan.groups?.find((g) => g.id === u.groupId)?.memberIds.push(n.id);
    out.push(n);
    return n;
  };
  const lat = (k: number) => {
    const r = (u.facing * Math.PI) / 180;
    return { x: Math.cos(r) * k, y: -Math.sin(r) * k };
  };
  const fwd = (k: number) => {
    const r = (u.facing * Math.PI) / 180;
    return { x: Math.sin(r) * k, y: Math.cos(r) * k };
  };
  const child = CHILD_TEMPLATE[u.templateKey];
  const childT = child ? TEMPLATES[child] : undefined;
  const ax = defaultEggAxes(u.templateKey);
  const elName = t?.elementName ?? 'Elm';
  const existing = plan.units.filter((x) => x.splitFrom === u.id && x.templateKey === child).length;
  if (o.kind === 'ELEMENTS' && child && childT) {
    const n = t.elements ?? 3;
    // local spots in fractions of the parent's half-frontage (l) and half-depth (f): two up, one back
    const spots: [number, number][] = n === 2 ? [[-0.5, 0], [0.5, 0]] : n === 3 ? [[-0.62, 0.3], [0.62, 0.3], [0, -0.5]] : [[-0.62, 0.35], [0.62, 0.35], [-0.32, -0.5], [0.32, -0.5]];
    for (let i = 0; i < n; i++) {
      const [l, f] = spots[i] ?? [0, 0];
      const sp = add(c, add(lat(l * ax.front), fwd(f * ax.depth)));
      mk(child, `${u.label} / ${ORD[i]} ${elName}`, childT.personnel, sp, u.role, true);
    }
    return out;
  }
  if (o.kind === 'ONE' && child && childT) {
    const i = existing;
    const role = o.role ?? u.role;
    const ahead = role === 'SP_PTL' ? fwd(900) : role === 'LP' ? fwd(380) : role === 'SCREEN' ? fwd(1000) : add(lat((i % 2 ? 1 : -1) * ax.front * 0.6), fwd(ax.depth * 0.2));
    mk(child, `${u.label} / ${ORD[i] ?? i + 1} ${elName}`, childT.personnel, { x: c.x + ahead.x, y: c.y + ahead.y }, role, true);
    return out;
  }
  if (o.kind === 'MEN') {
    const men = Math.max(1, Math.min(eff - 1, Math.round(o.men ?? 3)));
    const role = o.role ?? (men <= 4 ? 'LP' : u.role);
    const key = role === 'LP' || role === 'OP' ? 'LP' : men <= 12 && isAreaUnit(u) ? 'RIFLE_SEC' : u.templateKey;
    const n = plan.units.filter((x) => x.splitFrom === u.id && x.templateKey === key).length + 1;
    const lbl = key === 'LP' ? `${u.label} / ${role === 'OP' ? 'OP' : 'LP'} ${n}` : `${u.label} / Det ${n}`;
    const ahead = role === 'LP' || role === 'OP' ? fwd(380) : role === 'SP_PTL' ? fwd(900) : lat(ax.front * 0.8);
    mk(key, lbl, men, { x: c.x + ahead.x, y: c.y + ahead.y }, role, true);
    return out;
  }
  if (o.kind === 'WEAPON') {
    const w = primaryWeapon(u.templateKey);
    const left = w ? book.get(u.id)?.weapons[w] ?? 0 : 0;
    if (!w || left < 2 || !t) return out;
    const per = Math.max(1, Math.round(t.personnel / (t.weapons[w] ?? 1)));
    const n = plan.units.filter((x) => x.splitFrom === u.id).length + 1;
    mk(u.templateKey, `${u.label} / ${n}`, per, { x: c.x + lat(60 * n).x, y: c.y + lat(60 * n).y }, u.role, false);
    return out;
  }
  return out;
}

function add(a: { x: number; y: number }, b: { x: number; y: number }) {
  return { x: a.x + b.x, y: a.y + b.y };
}
/** All units split (recursively) from `id`. */
export function descendants(plan: Plan, id: string): PlacedUnit[] {
  const out: PlacedUnit[] = [];
  const walk = (pid: string) => {
    for (const u of plan.units) {
      if (u.splitFrom === pid && !out.includes(u)) {
        out.push(u);
        walk(u.id);
      }
    }
  };
  walk(id);
  return out;
}

/** Re-point every reference to `fromId` at `toId` (or clear it). */
function repoint(plan: Plan, fromIds: Set<string>, toId: string | undefined): void {
  for (const u of plan.units) {
    if (u.parentId && fromIds.has(u.parentId)) u.parentId = toId;
    if (u.splitFrom && fromIds.has(u.splitFrom)) u.splitFrom = toId;
  }
  for (const g of plan.graphics) if (g.props.unitId && fromIds.has(g.props.unitId)) g.props.unitId = toId;
  for (const c of Object.values(plan.contingency)) if (c.unitId && fromIds.has(c.unitId)) c.unitId = toId;
  for (const g of plan.groups ?? []) g.memberIds = g.memberIds.filter((m) => !fromIds.has(m));
}

/** Merge a split element (and anything split from it) back into its origin. */
export function mergeBack(plan: Plan, id: string): boolean {
  const u = plan.units.find((x) => x.id === id);
  if (!u?.splitFrom) return false;
  const origin = u.splitFrom;
  const gone = new Set([id, ...descendants(plan, id).map((d) => d.id)]);
  plan.units = plan.units.filter((x) => !gone.has(x.id));
  repoint(plan, gone, plan.units.some((x) => x.id === origin) ? origin : undefined);
  pruneGroups(plan);
  return true;
}

/** Remove units cleanly (detachments split from them are merged away too). */
export function removeUnits(plan: Plan, ids: string[]): void {
  const gone = new Set<string>();
  for (const id of ids) {
    gone.add(id);
    for (const d of descendants(plan, id)) gone.add(d.id);
  }
  plan.units = plan.units.filter((x) => !gone.has(x.id));
  repoint(plan, gone, undefined);
  pruneGroups(plan);
}

// ---------------------------------------------------------------------------- groups

export function groupUnits(plan: Plan, ids: string[], label?: string): PlanGroup | null {
  const members = plan.units.filter((u) => ids.includes(u.id));
  if (members.length < 1) return null;
  plan.groups = plan.groups ?? [];
  // a unit belongs to one group at a time
  for (const g of plan.groups) g.memberIds = g.memberIds.filter((m) => !ids.includes(m));
  const lead = [...members].sort((a, b) => baseStrength(b) - baseStrength(a))[0];
  const g: PlanGroup = { id: uid('grp'), label: label ?? `${lead.label.split(' / ')[0]} Gp`, memberIds: members.map((m) => m.id), echelon: TEMPLATES[lead.templateKey]?.echelon };
  plan.groups.push(g);
  for (const m of members) m.groupId = g.id;
  pruneGroups(plan);
  return g;
}

export function ungroup(plan: Plan, gid: string): void {
  for (const u of plan.units) if (u.groupId === gid) u.groupId = undefined;
  plan.groups = (plan.groups ?? []).filter((g) => g.id !== gid);
  pruneGroups(plan);
}

export function setGroup(plan: Plan, uid2: string, gid: string | undefined): void {
  const u = plan.units.find((x) => x.id === uid2);
  if (!u) return;
  for (const g of plan.groups ?? []) g.memberIds = g.memberIds.filter((m) => m !== uid2);
  u.groupId = undefined;
  const g = gid ? plan.groups?.find((x) => x.id === gid) : undefined;
  if (g) {
    g.memberIds.push(uid2);
    u.groupId = g.id;
  }
  pruneGroups(plan);
}

/** Keep groupId and memberIds consistent; drop empty groups. */
export function pruneGroups(plan: Plan): void {
  if (!plan.groups) return;
  const ids = new Set(plan.units.map((u) => u.id));
  for (const g of plan.groups) g.memberIds = [...new Set(g.memberIds.filter((m) => ids.has(m)))];
  plan.groups = plan.groups.filter((g) => g.memberIds.length > 0);
  const gids = new Set(plan.groups.map((g) => g.id));
  for (const u of plan.units) {
    if (u.groupId && !gids.has(u.groupId)) u.groupId = undefined;
    const g = plan.groups.find((x) => x.memberIds.includes(u.id));
    if (g) u.groupId = g.id;
  }
  if (!plan.groups.length) delete plan.groups;
}

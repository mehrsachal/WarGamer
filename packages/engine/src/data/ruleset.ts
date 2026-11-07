import { z } from 'zod';
import { type Hex, hexDistance, hexKey, hexNeighbor, hexToPoint, oppositeDir } from '../hex';
import {
  EdgeFeature,
  GameMap,
  type GroundMobility,
  type MapHex,
  Rules,
  Scenario,
  Sensor,
  TerrainType,
  UnitType,
  Weapon,
} from './schema';

/** Raw JSON content of the data folder (data/*.json). */
export interface DataBundle {
  terrain: unknown;
  edges: unknown;
  weapons: unknown;
  units: unknown;
  sensors: unknown;
  rules: unknown;
}

export class DataError extends Error {
  constructor(
    message: string,
    readonly issues: string[],
  ) {
    super(`${message}:\n  - ${issues.join('\n  - ')}`);
  }
}

function parseList<T>(name: string, schema: z.ZodType<T>, raw: unknown, issues: string[]): T[] {
  const res = z.array(schema).safeParse(raw);
  if (!res.success) {
    for (const i of res.error.issues) issues.push(`${name}${i.path.length ? '[' + i.path.join('.') + ']' : ''}: ${i.message}`);
    return [];
  }
  const ids = new Set<string>();
  for (const item of res.data as { id: string }[]) {
    if (ids.has(item.id)) issues.push(`${name}: duplicate id "${item.id}"`);
    ids.add(item.id);
  }
  return res.data;
}

function index<T extends { id: string }>(list: T[]): Map<string, T> {
  return new Map(list.map((x) => [x.id, x]));
}

/** Validated, indexed game data. */
export class Ruleset {
  readonly terrain: Map<string, TerrainType>;
  readonly edges: Map<string, EdgeFeature>;
  readonly weapons: Map<string, Weapon>;
  readonly units: Map<string, UnitType>;
  readonly sensors: Map<string, Sensor>;
  readonly rules: Rules;
  /** Validated copies, for serving to clients and documentation. */
  readonly lists: { terrain: TerrainType[]; edges: EdgeFeature[]; weapons: Weapon[]; units: UnitType[]; sensors: Sensor[] };

  private constructor(lists: Ruleset['lists'], rules: Rules) {
    this.lists = lists;
    this.terrain = index(lists.terrain);
    this.edges = index(lists.edges);
    this.weapons = index(lists.weapons);
    this.units = index(lists.units);
    this.sensors = index(lists.sensors);
    this.rules = rules;
  }

  /** Validate raw data files; throws DataError listing every problem (ED-04). */
  static parse(raw: DataBundle): Ruleset {
    const issues: string[] = [];
    const lists = {
      terrain: parseList('terrain', TerrainType, raw.terrain, issues),
      edges: parseList('edges', EdgeFeature, raw.edges, issues),
      weapons: parseList('weapons', Weapon, raw.weapons, issues),
      units: parseList('units', UnitType, raw.units, issues),
      sensors: parseList('sensors', Sensor, raw.sensors, issues),
    };
    const rulesRes = Rules.safeParse(raw.rules);
    if (!rulesRes.success) for (const i of rulesRes.error.issues) issues.push(`rules.${i.path.join('.')}: ${i.message}`);
    const weaponIds = new Set(lists.weapons.map((w) => w.id));
    const sensorIds = new Set(lists.sensors.map((s) => s.id));
    for (const u of lists.units) {
      for (const w of u.weapons) if (!weaponIds.has(w)) issues.push(`units.${u.id}: unknown weapon "${w}"`);
      for (const s of u.sensors) if (!sensorIds.has(s)) issues.push(`units.${u.id}: unknown sensor "${s}"`);
      if (u.isAir !== (u.mobilityClass === 'air')) issues.push(`units.${u.id}: isAir must match mobilityClass "air"`);
    }
    if (issues.length) throw new DataError('Invalid game data', issues);
    return new Ruleset(lists, rulesRes.data!);
  }

  unitType(id: string): UnitType {
    const u = this.units.get(id);
    if (!u) throw new Error(`Unknown unit type ${id}`);
    return u;
  }
  weapon(id: string): Weapon {
    const w = this.weapons.get(id);
    if (!w) throw new Error(`Unknown weapon ${id}`);
    return w;
  }
}

export interface IndexedHex extends MapHex {
  terrain: TerrainType;
}

const edgeKey = (a: Hex, b: Hex): string => {
  const ka = hexKey(a);
  const kb = hexKey(b);
  return ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
};

/** Indexed map with mirrored edge features (MAP-02/04). */
export class MapModel {
  readonly def: GameMap;
  private readonly cells = new Map<string, IndexedHex>();
  private readonly edgeMap = new Map<string, EdgeFeature[]>();
  readonly list: IndexedHex[];

  constructor(def: GameMap, data: Ruleset) {
    this.def = def;
    for (const h of def.hexes) {
      const terrain = data.terrain.get(h.terrainId);
      if (!terrain) throw new Error(`Map ${def.id}: unknown terrain "${h.terrainId}" at ${h.q},${h.r}`);
      this.cells.set(hexKey(h), { ...h, terrain });
    }
    this.list = [...this.cells.values()];
    for (const h of def.hexes) {
      for (const [dirS, ids] of Object.entries(h.edges ?? {})) {
        const dir = Number(dirS);
        const n = hexNeighbor(h, dir);
        const key = edgeKey(h, n);
        const cur = this.edgeMap.get(key) ?? [];
        for (const id of ids) {
          const f = data.edges.get(id);
          if (!f) throw new Error(`Map ${def.id}: unknown edge feature "${id}" at ${h.q},${h.r} dir ${dir}`);
          if (!cur.includes(f)) cur.push(f);
        }
        this.edgeMap.set(key, cur);
        void oppositeDir; // mirrored implicitly by the symmetric key
      }
    }
  }

  static parse(raw: unknown, data: Ruleset): MapModel {
    const res = GameMap.safeParse(raw);
    if (!res.success) throw new DataError('Invalid map', res.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`));
    return new MapModel(res.data, data);
  }

  has(h: Hex): boolean {
    return this.cells.has(hexKey(h));
  }
  get(h: Hex): IndexedHex | undefined {
    return this.cells.get(hexKey(h));
  }
  cell(h: Hex): IndexedHex {
    const c = this.cells.get(hexKey(h));
    if (!c) throw new Error(`Hex ${h.q},${h.r} is off the map`);
    return c;
  }
  elevation(h: Hex): number {
    return this.cell(h).elevation_m;
  }
  /** Edge features on the side shared by two adjacent hexes. */
  edgeFeatures(a: Hex, b: Hex): EdgeFeature[] {
    return this.edgeMap.get(edgeKey(a, b)) ?? [];
  }
  /** All edges carrying features, for rendering. */
  allEdges(): { a: Hex; b: Hex; features: EdgeFeature[] }[] {
    const out: { a: Hex; b: Hex; features: EdgeFeature[] }[] = [];
    for (const [k, features] of this.edgeMap) {
      const [ka, kb] = k.split('|');
      const [aq, ar] = ka.split(',').map(Number);
      const [bq, br] = kb.split(',').map(Number);
      out.push({ a: { q: aq, r: ar }, b: { q: bq, r: br }, features });
    }
    return out;
  }
  /** Centre of a hex in metres (x east, y south). */
  centre_m(h: Hex): { x: number; y: number } {
    return hexToPoint(h, this.def.orientation, this.def.hexSize_m);
  }
  /** 8-figure grid reference "EEEE NNNN" (10 m resolution) of the hex centre (MAP-07). */
  gridRef(h: Hex): string {
    const c = this.centre_m(h);
    const e = Math.round((this.def.gridRefOrigin.easting + c.x) / 10);
    const n = Math.round((this.def.gridRefOrigin.northing - c.y) / 10);
    const f = (v: number) => String(((v % 10000) + 10000) % 10000).padStart(4, '0');
    return `${f(e)} ${f(n)}`;
  }
  distance(a: Hex, b: Hex): number {
    return hexDistance(a, b);
  }
}

/** Mobility classes that can ever cross an edge carrying these features. */
export function edgeCrossable(features: EdgeFeature[], cls: GroundMobility): boolean {
  if (!features.length) return true;
  if (features.some((f) => f.providesCrossing?.includes(cls))) return true;
  return features.every((f) => f.crossableBy.includes(cls) && f.moveCostModifier[cls] !== null);
}

/** Validates a scenario against data + map (ED-06): returns a list of human-readable problems. */
export function validateScenario(rawScenario: unknown, data: Ruleset, map: MapModel): { scenario?: Scenario; errors: string[] } {
  const res = Scenario.safeParse(rawScenario);
  if (!res.success) return { errors: res.error.issues.map((i) => `scenario.${i.path.join('.')}: ${i.message}`) };
  const s = res.data;
  const errors: string[] = [];
  if (s.mapId !== map.def.id) errors.push(`scenario.mapId "${s.mapId}" does not match map "${map.def.id}"`);
  const allIds = new Set<string>();
  for (const side of ['blue', 'red'] as const) {
    const ss = s.sides[side];
    const zone = new Set(ss.deploymentZone.map(hexKey));
    for (const z of ss.deploymentZone) if (!map.has(z)) errors.push(`${side}.deploymentZone: hex ${z.q},${z.r} is off the map`);
    const ids = new Set(ss.orbat.map((o) => o.id));
    for (const o of ss.orbat) {
      if (allIds.has(o.id)) errors.push(`${side}.orbat: duplicate unit id "${o.id}"`);
      allIds.add(o.id);
      const t = data.units.get(o.typeId);
      if (!t) {
        errors.push(`${side}.orbat.${o.id}: unknown unit type "${o.typeId}"`);
        continue;
      }
      if (o.hex) {
        if (!map.has(o.hex)) errors.push(`${side}.orbat.${o.id}: start hex ${o.hex.q},${o.hex.r} is off the map`);
        else if (!o.mountedIn && !zone.has(hexKey(o.hex))) errors.push(`${side}.orbat.${o.id}: start hex ${o.hex.q},${o.hex.r} is outside the deployment zone`);
      }
      if (o.mountedIn) {
        const v = ss.orbat.find((x) => x.id === o.mountedIn);
        const vt = v && data.units.get(v.typeId);
        if (!v || !ids.has(o.mountedIn)) errors.push(`${side}.orbat.${o.id}: mountedIn "${o.mountedIn}" is not a unit of this side`);
        else if (!vt || vt.transportCapacity < 1) errors.push(`${side}.orbat.${o.id}: "${o.mountedIn}" cannot carry troops`);
        if (t.mobilityClass !== 'foot') errors.push(`${side}.orbat.${o.id}: only foot units can be mounted`);
      }
    }
    for (const o of ss.orbat) {
      const carried = ss.orbat.filter((x) => x.mountedIn === o.id).length;
      const t = data.units.get(o.typeId);
      if (t && carried > t.transportCapacity) errors.push(`${side}.orbat.${o.id}: carries ${carried} > capacity ${t.transportCapacity}`);
    }
    for (const f of ss.fireSupport) {
      const w = data.weapons.get(f.weaponId);
      if (!w) errors.push(`${side}.fireSupport.${f.id}: unknown weapon "${f.weaponId}"`);
      else if (!w.indirect) errors.push(`${side}.fireSupport.${f.id}: weapon "${f.weaponId}" is not indirect`);
      if (f.fromTurn > s.turns) errors.push(`${side}.fireSupport.${f.id}: available from turn ${f.fromTurn} after the last turn`);
    }
    if (!ss.deploymentZone.length && ss.orbat.some((o) => !o.hex && !o.mountedIn)) errors.push(`${side}: units without a start hex need a deployment zone`);
  }
  for (const o of s.objectives) if (!map.has(o.hex)) errors.push(`objective ${o.id}: hex ${o.hex.q},${o.hex.r} is off the map`);
  return { scenario: errors.length ? undefined : s, errors };
}

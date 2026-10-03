// Wargame engine. Deterministic (seeded) 1-minute ticks. The student's plan is turned
// into BLUE units; Foxland (RED) attacks per ICIB Sec 114 doctrine. Fog of war: BLUE
// sees RED only through its contacts picture; RED sees BLUE through its own intel.

import { type Vec, dist, distToPolyline, polylineLength, segmentsIntersect } from '../core/geom';
import { Rng } from '../core/rng';
import { fmtTime, lightAt, type LightState, visibilityFactor } from '../core/time';
import type {
  DecisionRecord,
  FogLevel,
  Plan,
  ReplayFrame,
  Scenario,
  WargameSummary,
} from '../core/types';
import { TEMPLATES, type WeaponKey } from '../core/units';
import { areaExtentFacing, areaRadius, isAreaUnit, unitArea } from '../plan/area';
import { workload } from '../plan/plan';
import { foundTag, strengthBook } from '../plan/taskorg';
import { terrainFor, type TerrainModel } from '../terrain/terrain';
import { runBlue } from './blue';
import { resolveCloseCombat, resolveDirectFire } from './combat';
import { resolveFires, runQc, runUcav } from './fires';
import { applyDecision, beginMapResponse, checkInjects, mapResponseInput, noteManualOrder } from './injects';
import { buildRed, runRed } from './red';
import { reportContact, runSensors } from './sensors';
import type {
  Contact,
  DecisionInput,
  EnemyPlan,
  FireEvent,
  FireMission,
  LogEntry,
  ManualOrder,
  PendingDecision,
  QcState,
  SimUnit,
} from './types';
import { executeOrder } from './orders';

export interface EngineOptions {
  seed: number;
  fog: FogLevel;
  /** Pause for decisions (true) or apply the pre-planned contingencies automatically. */
  interactive: boolean;
  difficulty: 'TRAINING' | 'STANDARD' | 'HARD';
}

export interface Obstacle {
  kind: 'MINE_PROT' | 'MINE_TAC' | 'MINE_NUIS' | 'WIRE';
  pts: Vec[];
  /** Fraction laid by H hr (time & space). */
  laid: number;
  breached: boolean;
  /** Units that have already struck it (to avoid double-counting each tick). */
  hit: Set<string>;
}

export interface DfTarget {
  id: string;
  label: string;
  pos: Vec;
  radius: number;
  asset: 'ARTY' | 'MOR81' | 'MOR60';
  sos: boolean;
  fired: number;
}

export type RedPhase =
  | 'PRE'
  | 'SECURITY'
  | 'RECCE'
  | 'ASSEMBLY'
  | 'FUP'
  | 'ASSAULT1'
  | 'REORG1'
  | 'ASSAULT2'
  | 'CONSOLIDATE'
  | 'FAILED'
  | 'OVER';

export class Engine {
  readonly s: Scenario;
  readonly plan: Plan;
  readonly opts: EngineOptions;
  readonly terrain: TerrainModel;
  rng: Rng;
  t: number;
  readonly startT: number;
  endT: number;
  units: SimUnit[] = [];
  byId = new Map<string, SimUnit>();
  contacts = new Map<string, Contact>();
  redIntel = new Map<string, { pos: Vec; conf: number; lastSeen: number }>();
  missions: FireMission[] = [];
  fireEvents: FireEvent[] = [];
  frameFire: [number, number, number, number, number][] = [];
  qcs: QcState[] = [];
  ucavLeft: number;
  ucavPending: { at: number; contactId: string; target: Vec; justified: boolean }[] = [];
  ammo = { ARTY: 0, MOR81: 0, MOR60: 0, EN_ARTY: 0 };
  log: LogEntry[] = [];
  pending: PendingDecision | null = null;
  decisions: DecisionRecord[] = [];
  orders: { time: number; text: string }[] = [];
  fired = new Set<string>();
  redPhase: RedPhase = 'PRE';
  redPlan!: EnemyPlan;
  redPlanFinal = false;
  hHour: number;
  frames: ReplayFrame[] = [];
  obstacles: Obstacle[] = [];
  dfs: DfTarget[] = [];
  readiness: number;
  over = false;
  overReason = '';
  stats = { blueStart: 0, redStart: 0, tanksStart: 0, tanksKilled: 0, blueCas: 0, redCas: 0 };
  private built = false;
  /** Casualties by cause, per side that suffered them. */
  causes: Record<'BLUE' | 'RED', Record<string, number>> = { BLUE: {}, RED: {} };
  /** Times of noteworthy events used by injects / assessment. */
  marks: Record<string, number> = {};
  flags: Record<string, unknown> = {};
  screenPolicy = 'ENGAGE_WITHDRAW';
  fireControl: 'DOCTRINE' | 'EARLY' | 'MIN' = 'DOCTRINE';
  light: LightState = 'DAY';
  vis = 1;

  constructor(s: Scenario, plan: Plan, opts: EngineOptions) {
    this.s = s;
    this.plan = plan;
    this.opts = opts;
    this.rng = new Rng(opts.seed);
    this.terrain = terrainFor(s.id, s.terrain, s.weather.going === 'wet');
    this.startT = s.times.enCrossBorder - 30;
    this.t = this.startT;
    this.endT = s.times.end;
    this.hHour = s.times.hHour;
    this.readiness = workload(s, plan).readiness;
    const fire = s.own.fire;
    this.ammo.ARTY = fire.artyBatteries * 6 * 120; // rounds allotted for the battle
    this.ammo.MOR81 = fire.mor81 ? 6 * 90 : 0;
    this.ammo.EN_ARTY = s.enemy.artyBatteries * 6 * 70;
    this.ucavLeft = fire.ucavSorties;
    this.buildBlue();
    buildRed(this);
    this.buildObstacles();
    this.stats.blueStart = this.units.filter((u) => u.side === 'BLUE').reduce((m, u) => m + u.start, 0);
    this.stats.redStart = this.units.filter((u) => u.side === 'RED').reduce((m, u) => m + u.start, 0);
    this.stats.tanksStart = this.units.filter((u) => u.side === 'RED').reduce((m, u) => m + u.startVehicles, 0);
    this.built = true;
    this.updateLight();
    this.addLog(`Wargame starts. ${s.own.formation} in def; defences ${Math.round(this.readiness * 100)}% prepared (time & space).`, 'info');
    this.recordFrame();
  }

  // ------------------------------------------------------------------ setup
  private buildBlue(): void {
    const prepared = 0.45 + 0.55 * this.readiness;
    // strength bookkeeping: split elements and detachments (SP/LP found by a locality) are
    // deducted from the unit they came from (src/plan/taskorg.ts)
    const book = strengthBook(this.plan);
    for (const pu of this.plan.units) {
      const tpl = TEMPLATES[pu.templateKey];
      if (!tpl) continue;
      const entry = book.get(pu.id);
      const strength = entry?.effective ?? tpl.personnel;
      const role = pu.role;
      const dug =
        role === 'FDL' || role === 'DEPTH' || role === 'CHQ' || role === 'CP' || role === 'SP_WPN' || role === 'OBS' || role === 'QC' || role === 'ENGR' || role === 'RES'
          ? prepared
          : role === 'SCREEN'
            ? 0.45
            : 0.3;
      const tag = foundTag(this.plan, pu);
      const label = tag ? `${pu.label} ${tag.replace(/^from /, 'fm ')}` : pu.label;
      const area = isAreaUnit(pu) ? unitArea(pu) : undefined;
      const u = this.makeUnit('BLUE', pu.templateKey, pu.id, label, pu.pos, pu.facing, role, strength, dug, area);
      // split elements / detachments carry only their share of the weapons
      if (entry && (pu.strength !== undefined || entry.detached > 0)) u.weapons = { ...entry.weapons };
      u.altPos = pu.altPos;
      u.parentId = pu.parentId;
      // LPs deploy only at night: start in their parent locality
      if (role === 'LP' && pu.parentId) {
        const p = this.plan.units.find((x) => x.id === pu.parentId);
        if (p) {
          u.home = { ...pu.pos };
          u.pos = { ...p.pos };
          u.state = 'POSN';
          u.task = 'LP (by ni)';
          u.dug = prepared;
        }
      }
    }
    // planned DF targets
    for (const g of this.plan.graphics) {
      if (g.kind !== 'DF' || !g.pts[0]) continue;
      const asset = (g.props.subtype as DfTarget['asset']) ?? 'ARTY';
      this.dfs.push({ id: g.id, label: g.props.label ?? 'DF', pos: g.pts[0], radius: g.props.radius ?? 150, asset, sos: !!g.props.sos, fired: 0 });
    }
    const mor60 = this.units.filter((u) => u.side === 'BLUE' && (u.weapons.MOR60 ?? 0) > 0).reduce((m, u) => m + (u.weapons.MOR60 ?? 0), 0);
    this.ammo.MOR60 = mor60 * 60;
  }

  makeUnit(side: 'BLUE' | 'RED', key: string, id: string, label: string, pos: Vec, facing: number, role: SimUnit['role'], strength?: number, dug = 0, area?: Vec[]): SimUnit {
    const tpl = TEMPLATES[key];
    const st = strength ?? tpl.personnel;
    const nEl = tpl.elements ?? 1;
    const elements = [];
    const f = (facing * Math.PI) / 180;
    const fx = Math.sin(f);
    const fy = Math.cos(f);
    const lx = Math.cos(f);
    const ly = -Math.sin(f);
    // footprint: the template radius, or the equivalent radius of the planned area (goose egg),
    // kept within sane bounds so exposure / close combat stay calibrated
    const radius = area && area.length >= 3 ? Math.max(tpl.radius * 0.5, Math.min(tpl.radius * 2, areaRadius(area))) : tpl.radius;
    // element spread: lateral (half-frontage) and depth (half-depth) of the area in the facing frame.
    // Defaults reproduce the v1 layout exactly (default egg: front 1.25 r, depth 0.8 r).
    let spL = tpl.radius * 0.7;
    let spF = tpl.radius * 0.7;
    if (area && area.length >= 3) {
      const ext = areaExtentFacing(area, facing);
      spL = (ext.front / 1.25) * 0.7;
      spF = (ext.depth / 0.8) * 0.7;
    }
    for (let i = 0; i < nEl; i++) {
      // two up one back (or three up for sections); offsets in metres
      let off: Vec;
      if (nEl === 1) off = { x: 0, y: 0 };
      else if (nEl === 2) off = { x: lx * spL * (i === 0 ? -0.5 : 0.5), y: ly * spL * (i === 0 ? -0.5 : 0.5) };
      else if (i < 2) off = { x: lx * spL * (i === 0 ? -0.6 : 0.6) + fx * spF * 0.3, y: ly * spL * (i === 0 ? -0.6 : 0.6) + fy * spF * 0.3 };
      else off = { x: -fx * spF * 0.5 + (i - 2) * lx * spL * 0.4, y: -fy * spF * 0.5 + (i - 2) * ly * spL * 0.4 };
      elements.push({ name: `${tpl.elementName ?? 'Elm'} ${i + 1}`, str: st / nEl, max: st / nEl, lost: false, off });
    }
    const u: SimUnit = {
      id,
      side,
      key,
      kind: tpl.kind,
      echelon: tpl.echelon,
      label,
      name: tpl.name,
      sidc: tpl.sidc,
      pos: { ...pos },
      home: { ...pos },
      facing,
      role,
      state: side === 'RED' ? 'OFFMAP' : 'POSN',
      strength: st,
      start: st,
      vehicles: tpl.vehicles ?? 0,
      startVehicles: tpl.vehicles ?? 0,
      weapons: { ...tpl.weapons },
      elements,
      ammo: 1,
      morale: 1,
      supp: 0,
      dug,
      mode: tpl.tracked ? 'TRACKED' : 'FOOT',
      speed: tpl.speed,
      path: [],
      pathIdx: 0,
      phaseCas: 0,
      phaseStart: st,
      task: '',
      firedAt: -9999,
      sig: 0,
      obsRange: tpl.obsRange,
      nvd: tpl.nvd,
      radius,
    };
    this.units.push(u);
    this.byId.set(id, u);
    // units committed after the start (e.g. higher C attk force) count towards the start strength
    if (this.built) {
      if (side === 'BLUE') this.stats.blueStart += st;
      else {
        this.stats.redStart += st;
        this.stats.tanksStart += u.startVehicles;
      }
    }
    return u;
  }

  private buildObstacles(): void {
    const minesBudget = this.s.own.fire.mines.apM + this.s.own.fire.mines.atM;
    let usedMines = 0;
    for (const g of this.plan.graphics) {
      if (g.kind === 'MINEFIELD') {
        const L = polylineLength(g.pts);
        const avail = Math.max(0, minesBudget - usedMines);
        usedMines += L;
        const laid = Math.min(1, this.readiness * 1.05) * Math.min(1, avail / Math.max(1, L));
        const kind = g.props.subtype === 'TACTICAL' || g.props.subtype === 'DEFENSIVE' ? 'MINE_TAC' : g.props.subtype === 'NUISANCE' ? 'MINE_NUIS' : 'MINE_PROT';
        this.obstacles.push({ kind, pts: g.pts, laid, breached: false, hit: new Set() });
      } else if (g.kind === 'WIRE') {
        this.obstacles.push({ kind: 'WIRE', pts: g.pts, laid: Math.min(1, this.readiness * 1.1), breached: false, hit: new Set() });
      }
    }
  }

  // ------------------------------------------------------------------ helpers
  blue(): SimUnit[] {
    return this.units.filter((u) => u.side === 'BLUE' && alive(u));
  }
  red(): SimUnit[] {
    return this.units.filter((u) => u.side === 'RED' && alive(u) && u.state !== 'OFFMAP');
  }
  allRed(): SimUnit[] {
    return this.units.filter((u) => u.side === 'RED');
  }
  addLog(text: string, level: LogEntry['level'] = 'info'): void {
    this.log.push({ time: this.t, text, level });
  }
  where(p: Vec): string {
    return this.terrain.describe(p);
  }
  isNight(): boolean {
    return this.light === 'NIGHT';
  }
  private updateLight(): void {
    this.light = lightAt(this.t, this.s.times.light);
    this.vis = visibilityFactor(this.t, this.s.times.light, this.s.weather.vis);
  }
  timeStr(t = this.t): string {
    return fmtTime(t);
  }
  dfNear(p: Vec, r: number, sosOnly = false): DfTarget | undefined {
    return this.dfs.filter((d) => (!sosOnly || d.sos) && dist(d.pos, p) <= r).sort((a, b) => dist(a.pos, p) - dist(b.pos, p))[0];
  }
  weaponCount(u: SimUnit, w: WeaponKey): number {
    const n = u.weapons[w] ?? 0;
    if (n === 0) return 0;
    const frac = u.strength / Math.max(1, u.start);
    return n * Math.min(1, frac * 1.15);
  }
  nearestBlueLocality(p: Vec, roles: string[] = ['FDL', 'DEPTH']): SimUnit | undefined {
    return this.blue()
      .filter((u) => roles.includes(u.role as string) && u.state !== 'CAPTURED')
      .sort((a, b) => dist(a.pos, p) - dist(b.pos, p))[0];
  }
  fdlDistance(p: Vec): number {
    const fdl = this.plan.graphics.find((g) => g.kind === 'FDL');
    if (fdl) return distToPolyline(p, fdl.pts).d;
    const n = this.nearestBlueLocality(p);
    return n ? dist(n.pos, p) : Infinity;
  }

  // ------------------------------------------------------------------ main loop
  step(): void {
    if (this.over || this.pending) return;
    this.t += 1;
    this.updateLight();
    this.fireEvents = [];
    for (const u of this.units) u.sig *= 0.4;
    runRed(this);
    runBlue(this);
    this.move();
    runSensors(this);
    runQc(this);
    runUcav(this);
    resolveFires(this);
    resolveDirectFire(this);
    resolveCloseCombat(this);
    this.morale();
    checkInjects(this);
    if (this.t % 3 === 0 || this.redPhase === 'ASSAULT1' || this.redPhase === 'ASSAULT2') this.recordFrame();
    if (this.t >= this.endT) this.finish('Time up');
  }

  /** Runs until a decision is pending, the battle ends or `until` is reached. */
  runUntil(until: number, maxTicks = 100000): 'DECISION' | 'END' | 'TIME' {
    let n = 0;
    while (!this.over && !this.pending && this.t < until && n++ < maxTicks) this.step();
    if (this.pending) return 'DECISION';
    if (this.over) return 'END';
    return 'TIME';
  }

  /** Runs to the end, auto-answering decisions with the pre-planned contingencies. */
  runToEnd(): void {
    let guard = 0;
    while (!this.over && guard++ < 200000) {
      if (this.pending) this.decide(this.preplannedInput(this.pending));
      else this.step();
    }
  }

  /**
   * The pre-planned response to a decision: the contingency plan (or the student's own
   * contingency) — else the sub-unit SOP (the sound quick pick), which is marked down for a
   * core situation and not marked for an inject-only one.
   */
  preplannedInput(p: PendingDecision): DecisionInput {
    if (p.preplannedActions?.length || p.preplannedText?.trim()) {
      return { option: p.preplanned ?? '', actions: p.preplannedActions ?? [], text: p.preplannedText, unitId: p.preplannedUnit, delayMin: p.preplannedDelay, dfId: p.preplannedDf, source: 'PREPLANNED' };
    }
    if (p.multi) return { option: p.preplanned ?? '', options: (p.preplanned ?? '').split(',').filter(Boolean), source: p.preplanned ? 'PREPLANNED' : 'SOP' };
    const opt = p.preplanned ?? p.options[0]?.id ?? '';
    return { option: opt, unitId: p.preplannedUnit, delayMin: p.preplannedDelay, source: p.preplanned ? 'PREPLANNED' : 'SOP' };
  }

  decide(input: DecisionInput): void {
    if (!this.pending) return;
    const p = this.pending;
    this.pending = null;
    applyDecision(this, p, input);
  }

  /** Close the decision card to act on the map; the battle stays paused until resumeFromMap(). */
  actOnMap(): void {
    beginMapResponse(this);
  }

  /** End a decision taken on the map: the orders given since actOnMap() (plus optional text) are the response. */
  resumeFromMap(text?: string): void {
    if (this.pending) this.decide(mapResponseInput(this, text));
  }

  order(o: ManualOrder): string {
    const msg = executeOrder(this, o);
    noteManualOrder(this, o);
    return msg;
  }

  // ------------------------------------------------------------------ movement
  private move(): void {
    const night = this.isNight();
    for (const u of this.units) {
      if (!alive(u) || u.state === 'OFFMAP') continue;
      if (!(u.state === 'MOVE' || u.state === 'ASSAULT' || u.state === 'WITHDRAW')) continue;
      if (u.waitUntil && this.t < u.waitUntil) continue;
      if (u.pathIdx >= u.path.length) {
        if (u.state !== 'ASSAULT') u.state = 'HALT';
        continue;
      }
      const goal = u.path[u.pathIdx];
      const going = Math.max(0.15, this.terrain.goingAt(u.pos, u.mode));
      let kph = u.speed * going;
      if (night) kph *= u.mode === 'FOOT' ? 0.6 : 0.7;
      if (u.state === 'ASSAULT') {
        // deliberate attack rate: 100 m in 4 min (night) .. 2 min (day)
        kph = Math.min(kph, night ? 1.5 : 2.6);
        if (u.kind === 'ARMOUR') kph = Math.min(kph, night ? 2 : 3.2);
      }
      kph *= 1 - 0.75 * u.supp;
      const before = { ...u.pos };
      let step = (kph * 1000) / 60;
      while (step > 0 && u.pathIdx < u.path.length) {
        const g = u.path[u.pathIdx];
        const d = dist(u.pos, g);
        if (d <= step) {
          u.pos = { ...g };
          step -= d;
          u.pathIdx++;
        } else {
          u.pos = { x: u.pos.x + ((g.x - u.pos.x) / d) * step, y: u.pos.y + ((g.y - u.pos.y) / d) * step };
          step = 0;
        }
      }
      if (u.side === 'RED') this.obstacleCheck(u, before);
      if (u.pathIdx < u.path.length) {
        const g2 = u.path[u.pathIdx];
        if (dist(u.pos, g2) > 1) u.facing = (Math.atan2(g2.x - u.pos.x, g2.y - u.pos.y) * 180) / Math.PI;
      } else if (goal) {
        if (u.state === 'MOVE' || u.state === 'WITHDRAW') u.state = 'HALT';
      }
    }
  }

  // ------------------------------------------------------------------ obstacles
  private obstacleCheck(u: SimUnit, from: Vec): void {
    for (const ob of this.obstacles) {
      if (ob.laid <= 0.05 || ob.hit.has(u.id)) continue;
      let crossed = false;
      for (let i = 1; i < ob.pts.length && !crossed; i++) crossed = !!segmentsIntersect(from, u.pos, ob.pts[i - 1], ob.pts[i]) || distToPolyline(u.pos, ob.pts).d < 18;
      if (!crossed) continue;
      ob.hit.add(u.id);
      const engr = this.red().some((x) => x.role === 'ENGR' && dist(x.pos, u.pos) < 400);
      const lane = ob.breached ? 0.25 : 1;
      const where = this.where(u.pos);
      if (ob.kind === 'WIRE') {
        u.waitUntil = this.t + Math.round((engr ? 4 : 8) * lane);
        u.breaching = true;
        if (this.isNight()) {
          const c = this.contacts.get(u.id);
          if (!c || c.conf < 0.8) reportContact(this, u, 'Trip flare', 1, 50);
        }
        this.addLog(`En held up at the wire ${where}.`, 'good');
      } else if (ob.kind === 'MINE_TAC') {
        if (u.vehicles > 0) {
          const n = u.vehicles;
          for (let k = 0; k < n; k++) if (this.rng.chance(0.3 * ob.laid * lane)) this.killTank(u, 'mines (A tk mfd)');
          u.waitUntil = this.t + Math.round(10 * lane);
        } else {
          this.inflict(u, this.rng.poisson(u.strength * 0.01 * ob.laid * lane), 'Mines');
          u.waitUntil = this.t + Math.round((engr ? 6 : 10) * lane);
        }
        u.breaching = true;
        this.addLog(`En ${u.vehicles > 0 ? 'armr' : 'inf'} has run into the A tk mfd ${where}.`, 'good');
      } else {
        if (u.vehicles > 0) {
          u.waitUntil = this.t + 3;
          continue;
        }
        const cas = this.rng.poisson(u.strength * (ob.kind === 'MINE_NUIS' ? 0.02 : 0.045) * ob.laid * lane);
        this.inflict(u, cas, 'Mines');
        u.waitUntil = this.t + Math.round((engr ? 6 : 9) * lane);
        u.breaching = true;
        this.addLog(`En inf caught in the protective mfd ${where}${cas ? ` (${cas} cas)` : ''}.`, 'good');
      }
      if (engr && !ob.breached) {
        ob.breached = true;
        this.addLog(`En breaching party clearing a lane ${where}.`, 'warn');
      }
    }
  }

  // ------------------------------------------------------------------ morale & state
  private morale(): void {
    for (const u of this.units) {
      if (u.state === 'OFFMAP' || u.state === 'DESTROYED' || u.state === 'CAPTURED') continue;
      if (u.strength < 1.5 && u.kind !== 'ARMOUR') {
        u.state = 'DESTROYED';
        u.strength = 0;
        u.path = [];
        if (u.side === 'BLUE') this.addLog(`${u.label} wiped out ${this.where(u.pos)}.`, 'crit');
        continue;
      }
      u.supp = Math.max(0, u.supp - 0.12);
      if (u.breaching && (!u.waitUntil || u.waitUntil <= this.t)) u.breaching = false;
      const frac = u.strength / Math.max(1, u.start);
      if (u.kind === 'ARMOUR') {
        if (u.vehicles <= 0) {
          u.state = 'DESTROYED';
          this.addLog(`${u.side === 'RED' ? 'En' : 'Own'} ${u.label} destroyed ${this.where(u.pos)}.`, u.side === 'RED' ? 'good' : 'crit');
        }
        continue;
      }
      if (u.strength < 1.5) {
        u.state = 'DESTROYED';
        u.strength = 0;
        if (u.side === 'BLUE') this.addLog(`${u.label} wiped out ${this.where(u.pos)}.`, 'crit');
        continue;
      }
      u.morale = Math.max(0, Math.min(1, 0.25 + frac * 0.85 - u.supp * 0.2));
    }
  }

  // ------------------------------------------------------------------ casualties bookkeeping
  inflict(u: SimUnit, cas: number, cause: string): number {
    if (cas <= 0 || !alive(u)) return 0;
    const c = Math.min(u.strength, cas);
    u.strength -= c;
    u.phaseCas += c;
    this.causes[u.side][cause] = (this.causes[u.side][cause] ?? 0) + c;
    if (u.side === 'BLUE') this.stats.blueCas += c;
    else this.stats.redCas += c;
    // distribute over elements: front-most first for localities under assault, otherwise evenly
    const live = u.elements.filter((e) => !e.lost && e.str > 0);
    if (live.length) {
      let rem = c;
      const per = rem / live.length;
      for (const e of live) {
        const d = Math.min(e.str, per);
        e.str -= d;
        rem -= d;
      }
      if (rem > 0) for (const e of live) {
        const d = Math.min(e.str, rem);
        e.str -= d;
        rem -= d;
      }
    }
    return c;
  }

  killTank(u: SimUnit, by: string): void {
    if (u.vehicles <= 0) return;
    u.vehicles -= 1;
    const crew = Math.min(u.strength, 3);
    u.strength -= crew;
    this.causes[u.side][`Tks lost (${by.includes('(') ? by.split('(')[1].replace(')', '') : by})`] = (this.causes[u.side][`Tks lost (${by.includes('(') ? by.split('(')[1].replace(')', '') : by})`] ?? 0) + 1;
    if (u.side === 'RED') {
      this.stats.tanksKilled += 1;
      this.stats.redCas += crew;
    } else this.stats.blueCas += crew;
    u.weapons.TK_GUN = u.vehicles;
    u.weapons.TK_MG = u.vehicles;
    this.addLog(`${u.side === 'RED' ? 'En tk' : 'Own tk'} knocked out by ${by} ${this.where(u.pos)} (${u.vehicles} left in ${u.label}).`, u.side === 'RED' ? 'good' : 'crit');
  }

  // ------------------------------------------------------------------ end & record
  finish(reason: string): void {
    if (this.over) return;
    this.over = true;
    this.overReason = reason;
    this.recordFrame();
    this.addLog(`Wargame ends: ${reason}.`, 'info');
  }

  recordFrame(): void {
    const u: ReplayFrame['u'] = [];
    for (const x of this.units) {
      if (x.state === 'OFFMAP') continue;
      const code = x.state === 'DESTROYED' || x.state === 'CAPTURED' ? 2 : x.state === 'ASSAULT' ? 1 : x.state === 'WITHDRAW' ? 3 : 0;
      u.push([x.id, Math.round(x.pos.x), Math.round(x.pos.y), Math.round((100 * x.strength) / Math.max(1, x.start)), code]);
    }
    this.frames.push({ t: this.t, u, f: this.frameFire.splice(0) });
    if (this.frames.length > 4000) this.frames.splice(0, this.frames.length - 4000);
  }

  summary(): WargameSummary {
    const blue = this.units.filter((u) => u.side === 'BLUE');
    const fdl = blue.filter((u) => (u.role === 'FDL' || u.role === 'DEPTH') && u.kind === 'INF');
    const lost = fdl.filter((u) => u.state === 'CAPTURED' || u.state === 'DESTROYED').length;
    const vital = this.s.ds.itgs.find((i) => i.vital);
    let vitalHeld = true;
    if (vital) {
      const holders = blue.filter((u) => alive(u) && u.kind === 'INF' && dist(u.pos, vital.pos) < 400);
      const redOn = this.red().filter((r) => r.kind === 'INF' && r.state !== 'WITHDRAW' && dist(r.pos, vital.pos) < 300 && r.strength / r.start > 0.2);
      vitalHeld = holders.length > 0 || redOn.length === 0;
    }
    const partial = fdl.some((u) => alive(u) && u.elements.some((e) => e.lost));
    const ineffective = this.stats.blueCas / Math.max(1, this.stats.blueStart) > 0.6;
    const result: WargameSummary['result'] = !vitalHeld || ineffective || lost >= Math.max(2, Math.ceil(fdl.length / 2)) ? 'LOST' : lost > 0 || partial ? 'PARTIAL' : 'HELD';
    const text =
      result === 'HELD'
        ? 'En attk repulsed; def intact.'
        : result === 'PARTIAL'
          ? `En achieved limited penetration${lost ? ` (${lost} locality lost)` : ' (posts lost)'}; def remains coherent${vitalHeld ? ' and vital gr held' : ''}.`
          : `Def penetrated — ${!vitalHeld ? 'vital gr lost' : ineffective ? 'own tps combat ineffective (>60% cas)' : `${lost} localities lost`}.`;
    return {
      seed: this.opts.seed,
      result,
      resultText: text,
      ownCas: Math.round(this.stats.blueCas),
      ownStart: this.stats.blueStart,
      enCas: Math.round(this.stats.redCas),
      enStart: this.stats.redStart,
      tanksKilled: this.stats.tanksKilled,
      tanksStart: this.stats.tanksStart,
      localitiesLost: lost,
      vitalHeld,
      endTime: this.t,
    };
  }
}

export function alive(u: SimUnit): boolean {
  return u.state !== 'DESTROYED' && u.state !== 'CAPTURED' && u.strength > 0;
}

export function seconds(): number {
  return Date.now() / 1000;
}

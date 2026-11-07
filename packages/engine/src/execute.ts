// The single code path that turns a command into state changes + log items. Live play passes live Dice;
// replay passes the draws recorded in the event, so both produce identical results (CBT-07, NFR-05).
import { type FireCheck, directFireCheck, indirectFireCheck, indirectHit } from './combat';
import type { Side, Weapon } from './data/schema';
import { CommandError, type Command, type FireEffect, type LogItem } from './events';
import { type Hex, hexDistance, hexEquals, hexKey, hexNeighbors } from './hex';
import { allowance, pathTo, reachable, stepCost } from './move';
import { type GameContext, type GameResult, type GameState, type UnitState, SIDES, onMap, otherSide, stepsOf, unitsOf } from './state';
import { hexOccupancy, sideSeesHex, updateVisibility } from './visibility';

export interface DiceLike {
  next(): number;
}

type Draft<T> = T extends LogItem ? Omit<T, 'side' | 'turn' | 'seenBy'> : never;

class Ctx {
  readonly log: LogItem[] = [];
  constructor(
    readonly g: GameContext,
    readonly s: GameState,
    readonly side: Side,
    readonly dice: DiceLike,
  ) {}
  emit(item: Draft<LogItem>, seenBy: Side[] = [this.side], side: Side = this.side): void {
    const sb = [...new Set([side, ...seenBy])];
    this.log.push({ ...(item as object), side, turn: this.s.turn, seenBy: sb } as LogItem);
  }
  roll(): number {
    return this.dice.next();
  }
}

function fail(code: string, params: Record<string, string | number> = {}): never {
  throw new CommandError(code, params);
}

function ownUnit(c: Ctx, id: string): UnitState {
  const u = c.s.units[id];
  if (!u) fail('unknown_unit', { id });
  if (u.side !== c.side) fail('not_your_unit', { id });
  if (u.eliminated) fail('unit_eliminated', { id });
  return u;
}

function inZone(c: Ctx, side: Side, h: Hex): boolean {
  return c.g.scenario.sides[side].deploymentZone.some((z) => z.q === h.q && z.r === h.r);
}

function groundUnitsAt(c: Ctx, h: Hex, exceptId?: string): UnitState[] {
  return onMap(c.s).filter((u) => u.id !== exceptId && hexEquals(u.hex!, h) && !c.g.data.unitType(u.typeId).isAir);
}

// ---------------------------------------------------------------- damage

function eliminate(c: Ctx, u: UnitState, at: Hex): void {
  u.eliminated = true;
  u.steps = 0;
  u.hex = null;
  const chance = c.g.data.rules.passengers.lossChanceOnVehicleKill;
  for (const pid of u.passengers) {
    const p = c.s.units[pid];
    p.carriedBy = undefined;
    p.hex = { ...at };
    p.status = 'S';
    const r = c.roll();
    const lost = r < chance;
    if (lost) {
      p.steps -= 1;
      if (p.steps <= 0) {
        p.eliminated = true;
        p.steps = 0;
        p.hex = null;
      }
    }
    c.emit({ k: 'passenger_loss', unitId: p.id, name: p.name, roll: Math.floor(r * 100), chance, lost }, [otherSide(c.side), p.side], p.side);
  }
  u.passengers = [];
}

/** Apply the outcome of one hit roll against a target (CBT-03). */
function resolveHit(c: Ctx, target: UnitState, p: number, w: Weapon): { hit: boolean; roll: number; effect: FireEffect; effectRoll?: number; lethality?: number } {
  const r = c.roll();
  const hit = r < p;
  if (!hit) return { hit, roll: Math.floor(r * 100), effect: 'miss' };
  const tt = c.g.data.unitType(target.typeId);
  const lethality = w.lethality[tt.targetClass];
  const er = c.roll();
  if (er < lethality) {
    target.steps -= 1;
    target.status = 'S';
    if (target.steps <= 0) {
      eliminate(c, target, target.hex!);
      return { hit, roll: Math.floor(r * 100), effect: 'eliminated', effectRoll: Math.floor(er * 100), lethality };
    }
    return { hit, roll: Math.floor(r * 100), effect: 'step', effectRoll: Math.floor(er * 100), lethality };
  }
  target.status = 'S';
  return { hit, roll: Math.floor(r * 100), effect: 'suppressed', effectRoll: Math.floor(er * 100), lethality };
}

/** Area fire on a hex (mortars, artillery): every unit there — both sides — and the adjacent ring if the weapon has an area effect. */
function areaFire(c: Ctx, source: { id: string; name: string; typeId: string | null; from: Hex | null }, w: Weapon, h: Hex, distance: number | null, observed: boolean): void {
  const hexes: { h: Hex; adjacent: boolean }[] = [{ h, adjacent: false }];
  if (w.areaEffect.adjacent > 0) for (const n of hexNeighbors(h)) if (c.g.map.has(n)) hexes.push({ h: n, adjacent: true });
  const targets: { u: UnitState; adjacent: boolean }[] = [];
  for (const x of hexes) for (const u of onMap(c.s)) if (hexEquals(u.hex!, x.h)) targets.push({ u, adjacent: x.adjacent });
  c.emit({ k: 'impact', source: source.id, sourceName: source.name, weaponId: w.id, hex: h, observed, targets: targets.length }, SIDES as Side[]);
  for (const { u, adjacent } of targets) {
    if (u.eliminated) continue;
    const at = { ...u.hex! };
    const b = indirectHit(c.g, w, distance, u, observed, adjacent);
    if (b.p <= 0) continue;
    const res = resolveHit(c, u, b.p, w);
    c.emit(
      {
        k: 'fire',
        shooterId: source.id,
        shooterName: source.name,
        shooterTypeId: source.typeId,
        from: source.from,
        shooterSeenBy: [c.side],
        weaponId: w.id,
        targetId: u.id,
        targetName: u.name,
        targetTypeId: u.typeId,
        targetSide: u.side,
        at,
        p: b.p,
        roll: res.roll,
        hit: res.hit,
        effect: res.effect,
        effectRoll: res.effectRoll,
        lethality: res.lethality,
        breakdown: b,
        indirect: true,
      },
      [u.side],
    );
  }
}

// ---------------------------------------------------------------- objectives & victory

function vpOf(c: Ctx): Record<Side, number> {
  const vp = { blue: 0, red: 0 };
  for (const o of c.g.scenario.objectives) {
    const owner = c.s.objectives[o.id];
    if (owner) vp[owner] += o.value;
  }
  return vp;
}

/** VIC-01: an objective changes hands when only one side's ground-holding units occupy it. */
function updateObjectives(c: Ctx): void {
  let changed = false;
  for (const o of c.g.scenario.objectives) {
    const present = new Set<Side>();
    for (const u of onMap(c.s)) if (hexEquals(u.hex!, o.hex) && c.g.data.unitType(u.typeId).holdsGround) present.add(u.side);
    if (present.size !== 1) continue;
    const owner = [...present][0];
    const prev = c.s.objectives[o.id];
    if (prev === owner) continue;
    c.s.objectives[o.id] = owner;
    changed = true;
    c.emit({ k: 'objective', objectiveId: o.id, name: o.name, from: prev, to: owner }, SIDES as Side[], owner);
  }
  if (changed) {
    const vp = vpOf(c);
    c.emit({ k: 'vp', blue: vp.blue, red: vp.red }, SIDES as Side[]);
  }
}

function finish(c: Ctx, winner: Side | null, reason: GameResult['reason']): void {
  const vp = vpOf(c);
  const sc = c.g.data.rules.scoring;
  const lost = { blue: c.s.startSteps.blue - stepsOf(c.s, 'blue'), red: c.s.startSteps.red - stepsOf(c.s, 'red') };
  const score = {
    blue: vp.blue * sc.objectiveWeight + lost.red * sc.killWeightPerStep - lost.blue * sc.lossWeightPerStep,
    red: vp.red * sc.objectiveWeight + lost.blue * sc.killWeightPerStep - lost.red * sc.lossWeightPerStep,
  };
  const result: GameResult = { winner, reason, turn: c.s.turn, vp, score, stepsLost: lost };
  c.s.result = result;
  c.s.phase = 'over';
  c.emit({ k: 'game_over', result }, SIDES as Side[]);
}

/** VIC-02 attrition: immediate end when a side falls below its threshold. */
function checkAttrition(c: Ctx): boolean {
  if (c.s.phase !== 'play') return false;
  const thr = c.g.scenario.victoryRules.attritionWinBelowPct;
  for (const side of SIDES) {
    const t = thr[side];
    if (t === undefined) continue;
    if (stepsOf(c.s, side) < c.s.startSteps[side] * t) {
      finish(c, otherSide(side), 'attrition');
      return true;
    }
  }
  return false;
}

function finalResult(c: Ctx): void {
  const vp = vpOf(c);
  if (vp.blue === vp.red) finish(c, c.g.scenario.victoryRules.tieWinner, 'tie');
  else finish(c, vp.blue > vp.red ? 'blue' : 'red', 'objectives');
}

// ---------------------------------------------------------------- turn sequence

function startSideTurn(c: Ctx, side: Side): void {
  const s = c.s;
  s.activeSide = side;
  c.emit({ k: 'turn_start' }, SIDES as Side[], side);
  for (const u of unitsOf(s, side)) {
    u.mpSpent = 0;
    u.shots = 0;
    u.posture = 'static';
    u.fired = false;
  }
  // CBT-04 rally rolls
  const sup = c.g.data.rules.suppression;
  for (const u of unitsOf(s, side)) {
    if (u.status !== 'S') continue;
    const cell = u.hex ? c.g.map.get(u.hex) : undefined;
    const cover = cell ? cell.terrain.cover : 1;
    const chance = Math.min(0.95, sup.recoveryChance + sup.coverBonus * (1 - cover));
    const r = c.roll();
    const ok = r < chance;
    if (ok) u.status = 'C';
    c.emit({ k: 'rally', unitId: u.id, name: u.name, chance, roll: Math.floor(r * 100), ok }, [side], side);
  }
  // UAV endurance (ISR-03)
  for (const u of unitsOf(s, side)) {
    if (u.enduranceLeft === undefined || !u.hex) continue;
    u.enduranceLeft -= 1;
    if (u.enduranceLeft <= 0) {
      u.eliminated = true;
      u.hex = null;
      c.emit({ k: 'uav_recovered', unitId: u.id, name: u.name }, [side], side);
    }
  }
  // fire support becoming available (FS-02)
  for (const f of c.g.scenario.sides[side].fireSupport) {
    if (f.fromTurn === s.turn && s.fireSupport[side][f.id] > 0) c.emit({ k: 'arty_available', assetId: f.id, name: f.name, missions: s.fireSupport[side][f.id] }, [side], side);
  }
  // delayed artillery landing now
  const due = s.pendingFires.filter((p) => p.side === side && p.impactTurn <= s.turn);
  s.pendingFires = s.pendingFires.filter((p) => !due.includes(p));
  for (const p of due) {
    const asset = c.g.scenario.sides[side].fireSupport.find((f) => f.id === p.assetId)!;
    const w = c.g.data.weapon(p.weaponId);
    const sub = new Ctx(c.g, s, side, c.dice);
    areaFire(sub, { id: asset.id, name: asset.name, typeId: null, from: null }, w, p.hex, null, p.observed);
    c.log.push(...sub.log);
  }
}

function endTurn(c: Ctx): void {
  const s = c.s;
  c.emit({ k: 'turn_end' }, SIDES as Side[]);
  updateObjectives(c);
  if (c.g.scenario.victoryRules.suddenDeathAllObjectives && c.g.scenario.objectives.every((o) => s.objectives[o.id] === c.side)) {
    finish(c, c.side, 'all_objectives');
    return;
  }
  if (checkAttrition(c)) return;
  const next = otherSide(c.side);
  if (next === c.g.scenario.firstSide) {
    if (s.turn >= c.g.scenario.turns) {
      finalResult(c);
      return;
    }
    s.turn += 1;
  }
  startSideTurn(c, next);
  updateVisibility(c.g, s);
  checkAttrition(c);
}

// ---------------------------------------------------------------- commands

function deploy(c: Ctx, unitId: string, h: Hex): void {
  const u = ownUnit(c, unitId);
  if (u.carriedBy) fail('mounted');
  if (!c.g.map.has(h)) fail('off_map');
  if (!inZone(c, c.side, h)) fail('outside_zone');
  const t = c.g.data.unitType(u.typeId);
  if (!t.isAir && groundUnitsAt(c, h, u.id).length >= c.g.data.rules.stacking.maxUnitsPerHex) fail('stacking_limit');
  if (t.mobilityClass !== 'air' && c.g.map.cell(h).terrain.moveCost[t.mobilityClass as 'foot' | 'wheeled' | 'tracked'] === null) fail('impassable');
  u.hex = { q: h.q, r: h.r };
}

function endDeployment(c: Ctx): void {
  const s = c.s;
  const unplaced = unitsOf(s, c.side).filter((u) => !u.hex && !u.carriedBy);
  if (unplaced.length) fail('units_not_deployed', { count: unplaced.length });
  s.deployed[c.side] = true;
  c.emit({ k: 'deploy_done' }, SIDES as Side[]);
  const other = otherSide(c.side);
  if (!s.deployed[other]) {
    s.activeSide = other;
    return;
  }
  s.phase = 'play';
  s.turn = 1;
  c.emit({ k: 'battle_start', firstSide: c.g.scenario.firstSide }, SIDES as Side[]);
  startSideTurn(c, c.g.scenario.firstSide);
}

function knownEnemyHexes(c: Ctx): Set<string> {
  const out = new Set<string>();
  for (const id of c.s.visible[c.side]) {
    const e = c.s.units[id];
    if (e.hex && !c.g.data.unitType(e.typeId).isAir) out.add(hexKey(e.hex));
  }
  return out;
}

function moveUnit(c: Ctx, unitId: string, to: Hex): void {
  const u = ownUnit(c, unitId);
  if (!u.hex) fail('mounted');
  const t = c.g.data.unitType(u.typeId);
  if (hexEquals(u.hex, to)) fail('same_hex');
  const reach = reachable(c.g, u, { blocked: knownEnemyHexes(c), occupancy: hexOccupancy(c.s, c.g) });
  const node = reach.get(hexKey(to));
  if (!node) fail('unreachable');
  if (!node.canStop) fail('stacking_limit');
  const path = pathTo(reach, to)!;
  const from = { ...u.hex };
  let at = u.hex;
  let spent = u.mpSpent;
  let halted = false;
  for (const step of path) {
    if (!t.isAir) {
      const enemy = onMap(c.s).find((e) => e.side !== c.side && hexEquals(e.hex!, step) && !c.g.data.unitType(e.typeId).isAir);
      if (enemy) {
        halted = true;
        c.emit({ k: 'contact', unitId: u.id, name: u.name, hex: { ...at } });
        break;
      }
    }
    spent = reach.get(hexKey(step))!.cost;
    at = step;
  }
  if (hexEquals(at, from)) {
    c.s.units[u.id].mpSpent = Math.max(u.mpSpent, spent);
    return;
  }
  const a = allowance(c.g, u);
  u.hex = { ...at };
  u.mpSpent = spent;
  const band: 'tactical' | 'dash' = spent <= a.tactical + 1e-9 ? 'tactical' : 'dash';
  u.posture = band === 'dash' ? 'dashed' : 'moved';
  const seenBefore = c.s.visible[otherSide(c.side)].includes(u.id);
  updateVisibility(c.g, c.s);
  const seenAfter = c.s.visible[otherSide(c.side)].includes(u.id);
  c.emit(
    { k: 'move', unitId: u.id, name: u.name, typeId: u.typeId, from: seenBefore || !seenAfter ? from : null, to: { ...at }, mp: Math.round((spent - (reach.get(hexKey(from))?.cost ?? 0)) * 10) / 10, band, halted },
    seenAfter ? [otherSide(c.side)] : [],
  );
}

function fire(c: Ctx, unitId: string, weaponId: string, targetId: string): void {
  const u = ownUnit(c, unitId);
  const target = c.s.units[targetId];
  if (!target || target.side === c.side || target.eliminated || !target.hex) fail('invalid_target');
  const visible = c.s.visible[c.side].includes(targetId);
  const check: FireCheck = directFireCheck(c.g, u, weaponId, target, visible);
  if (!check.ok) fail(check.reason!, { p: 0 });
  const w = c.g.data.weapon(weaponId);
  const from = { ...u.hex! };
  const at = { ...target.hex };
  const shooterSeenBy: Side[] = [c.side];
  u.shots += 1;
  u.fired = true;
  if (u.ammo[weaponId] !== null && u.ammo[weaponId] !== undefined) u.ammo[weaponId] = (u.ammo[weaponId] as number) - 1;
  const res = resolveHit(c, target, check.p, w);
  updateVisibility(c.g, c.s);
  if (c.s.visible[target.side].includes(u.id)) shooterSeenBy.push(target.side);
  c.emit(
    {
      k: 'fire',
      shooterId: u.id,
      shooterName: u.name,
      shooterTypeId: u.typeId,
      from,
      shooterSeenBy,
      weaponId,
      targetId,
      targetName: target.name,
      targetTypeId: target.typeId,
      targetSide: target.side,
      at,
      p: check.p,
      roll: res.roll,
      hit: res.hit,
      effect: res.effect,
      effectRoll: res.effectRoll,
      lethality: res.lethality,
      breakdown: check.breakdown!,
      indirect: false,
    },
    [target.side],
  );
  checkAttrition(c);
}

function indirectFire(c: Ctx, unitId: string, weaponId: string, h: Hex): void {
  const u = ownUnit(c, unitId);
  const check = indirectFireCheck(c.g, u, weaponId, h);
  if (!check.ok) fail(check.reason!);
  const observed = sideSeesHex(c.g, c.s, c.side, h);
  if (!observed && c.g.data.rules.indirect.requireObserver) fail('no_observer');
  const w = c.g.data.weapon(weaponId);
  u.shots += 1;
  u.fired = true;
  if (u.ammo[weaponId] !== null && u.ammo[weaponId] !== undefined) u.ammo[weaponId] = (u.ammo[weaponId] as number) - 1;
  areaFire(c, { id: u.id, name: u.name, typeId: u.typeId, from: { ...u.hex! } }, w, h, hexDistance(u.hex!, h), observed);
  updateVisibility(c.g, c.s);
  checkAttrition(c);
}

function callFire(c: Ctx, assetId: string, h: Hex): void {
  const asset = c.g.scenario.sides[c.side].fireSupport.find((f) => f.id === assetId);
  if (!asset) fail('unknown_asset', { id: assetId });
  if (!c.g.map.has(h)) fail('off_map');
  if (c.s.turn < asset.fromTurn) fail('fire_support_not_yet', { turn: asset.fromTurn });
  const left = c.s.fireSupport[c.side][assetId] ?? 0;
  if (left <= 0) fail('no_missions');
  const observed = sideSeesHex(c.g, c.s, c.side, h);
  if (!observed && c.g.data.rules.indirect.requireObserver) fail('no_observer');
  c.s.fireSupport[c.side][assetId] = left - 1;
  const impactTurn = c.s.turn + asset.delay;
  c.emit({ k: 'arty_called', assetId, name: asset.name, hex: { ...h }, impactTurn, missionsLeft: left - 1 });
  if (asset.delay === 0) {
    areaFire(c, { id: asset.id, name: asset.name, typeId: null, from: null }, c.g.data.weapon(asset.weaponId), h, null, observed);
    updateVisibility(c.g, c.s);
    checkAttrition(c);
  } else {
    c.s.pendingFires.push({ id: `${assetId}@${c.s.turn}:${c.s.seq}`, side: c.side, assetId, weaponId: asset.weaponId, hex: { ...h }, callTurn: c.s.turn, impactTurn, observed });
  }
}

function mount(c: Ctx, unitId: string, vehicleId: string): void {
  const u = ownUnit(c, unitId);
  const v = ownUnit(c, vehicleId);
  const ut = c.g.data.unitType(u.typeId);
  const vt = c.g.data.unitType(v.typeId);
  if (!u.hex || !v.hex) fail('mounted');
  if (ut.mobilityClass !== 'foot') fail('cannot_mount');
  if (vt.transportCapacity <= v.passengers.length) fail('vehicle_full');
  if (hexDistance(u.hex, v.hex) > 1) fail('too_far');
  const a = allowance(c.g, u);
  const cost = c.g.data.rules.move.mountCost;
  if (u.mpSpent + cost > a.limit + 1e-9) fail('not_enough_mp');
  const at = { ...v.hex };
  u.mpSpent += cost;
  u.posture = u.mpSpent > a.tactical + 1e-9 ? 'dashed' : 'moved';
  u.hex = null;
  u.carriedBy = v.id;
  v.passengers.push(u.id);
  updateVisibility(c.g, c.s);
  c.emit({ k: 'mount', unitId: u.id, name: u.name, vehicleId: v.id, vehicleName: v.name, hex: at });
}

function dismount(c: Ctx, unitId: string, h: Hex): void {
  const u = ownUnit(c, unitId);
  if (!u.carriedBy) fail('not_mounted');
  const v = c.s.units[u.carriedBy];
  if (!v.hex) fail('mounted');
  if (hexDistance(v.hex, h) > 1) fail('too_far');
  if (!hexEquals(v.hex, h) && stepCost(c.g, 'foot', v.hex, h) === null) fail('impassable');
  if (onMap(c.s).some((e) => e.side !== c.side && hexEquals(e.hex!, h))) fail('enemy_in_hex');
  if (groundUnitsAt(c, h).length >= c.g.data.rules.stacking.maxUnitsPerHex) fail('stacking_limit');
  const a = allowance(c.g, u);
  u.carriedBy = undefined;
  v.passengers = v.passengers.filter((p) => p !== u.id);
  u.hex = { ...h };
  u.mpSpent = Math.max(u.mpSpent, a.total * c.g.data.rules.move.dismountCostFraction);
  u.posture = u.mpSpent > a.tactical + 1e-9 ? 'dashed' : 'moved';
  updateVisibility(c.g, c.s);
  c.emit({ k: 'dismount', unitId: u.id, name: u.name, vehicleId: v.id, vehicleName: v.name, hex: { ...h } }, c.s.visible[otherSide(c.side)].includes(u.id) ? [otherSide(c.side)] : []);
}

/** Validate and execute one command against a (cloned) state. Throws CommandError when illegal. */
export function executeCommand(g: GameContext, state: GameState, side: Side, cmd: Command, dice: DiceLike): LogItem[] {
  const c = new Ctx(g, state, side, dice);
  if (state.phase === 'over') fail('game_over');
  if (state.activeSide !== side) fail('not_your_turn');
  const visBefore = { blue: [...state.visible.blue], red: [...state.visible.red] };
  switch (cmd.type) {
    case 'Deploy':
      if (state.phase !== 'deploy') fail('not_deployment_phase');
      deploy(c, cmd.unitId, cmd.hex);
      break;
    case 'EndDeployment':
      if (state.phase !== 'deploy') fail('not_deployment_phase');
      endDeployment(c);
      break;
    case 'EndTurn':
      if (state.phase !== 'play') fail('not_play_phase');
      endTurn(c);
      break;
    default:
      if (state.phase !== 'play') fail('not_play_phase');
      switch (cmd.type) {
        case 'MoveUnit':
          moveUnit(c, cmd.unitId, cmd.to);
          break;
        case 'Fire':
          fire(c, cmd.unitId, cmd.weaponId, cmd.targetId);
          break;
        case 'IndirectFire':
          indirectFire(c, cmd.unitId, cmd.weaponId, cmd.hex);
          break;
        case 'CallFire':
          callFire(c, cmd.assetId, cmd.hex);
          break;
        case 'Mount':
          mount(c, cmd.unitId, cmd.vehicleId);
          break;
        case 'Dismount':
          dismount(c, cmd.unitId, cmd.hex);
          break;
        default:
          fail('unknown_command');
      }
  }
  if (state.phase !== 'deploy') {
    updateVisibility(g, state);
    for (const s of SIDES) {
      for (const id of state.visible[s]) {
        if (visBefore[s].includes(id)) continue;
        const e = state.units[id];
        c.emit({ k: 'spotted', unitId: id, typeId: e.typeId, hex: { ...e.hex! } }, [s], s);
      }
    }
  }
  return c.log;
}

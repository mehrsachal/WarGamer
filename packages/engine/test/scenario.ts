// Small hand-built scenarios for rules tests (10 × 8 flat-top test map).
import type { GameMap, Scenario } from '../src/data/schema';
import { Game } from '../src/game';
import type { GameContext } from '../src/state';
import { ctxFor, testMap } from './fixtures';

const zone = (qs: number[], rs: number[]) => qs.flatMap((q) => rs.map((r) => ({ q, r })));

export function tinyScenario(): Scenario {
  return {
    id: 'tiny',
    title: 'Tiny test',
    mapId: 'test',
    turns: 4,
    minutesPerTurn: 4,
    weather: 'clear',
    timeOfDay: 'day',
    firstSide: 'blue',
    briefing: { situation: 's', mission: 'm', forces: 'f', time: 't', victory: 'v', lessons: [] },
    sides: {
      blue: {
        name: 'Blue',
        briefing: '',
        deploymentZone: zone([0, 1, 2], [0, 1, 2, 3, 4, 5]),
        orbat: [
          { id: 'b1', typeId: 'rifle_section', name: '1 Sec', hex: { q: 1, r: 1 } },
          { id: 'b2', typeId: 'mortar60_sec', name: '60 Mor', hex: { q: 0, r: 2 } },
          { id: 'b3', typeId: 'apc', name: 'APC 1', hex: { q: 1, r: 3 } },
          { id: 'b4', typeId: 'fire_team', name: '2 FT', mountedIn: 'b3' },
          { id: 'b5', typeId: 'uav_mini', name: 'UAV', hex: { q: 0, r: 0 } },
        ],
        fireSupport: [{ id: 'arty', name: 'Arty bty', weaponId: 'how155', missions: 2, fromTurn: 1, delay: 1 }],
      },
      red: {
        name: 'Red',
        briefing: '',
        deploymentZone: zone([6, 7, 8, 9], [0, 1, 2, 3, 4, 5]),
        orbat: [
          { id: 'r1', typeId: 'rifle_section', name: 'R Sec', hex: { q: 6, r: 1 } },
          { id: 'r2', typeId: 'tank', name: 'R Tank', hex: { q: 8, r: 3 } },
        ],
        fireSupport: [{ id: 'rarty', name: 'Red guns', weaponId: 'how122', missions: 1, fromTurn: 1, delay: 0 }],
      },
    },
    objectives: [
      { id: 'o1', name: 'Crossroads', hex: { q: 5, r: 2 }, value: 3, initialOwner: 'red' },
      { id: 'o2', name: 'Farm', hex: { q: 3, r: 4 }, value: 1, initialOwner: null },
    ],
    victoryRules: { objectiveMajority: true, attritionWinBelowPct: { blue: 0.2, red: 0.2 }, tieWinner: 'red', suddenDeathAllObjectives: false },
    ai: { side: 'red', posture: 'defend' },
    reinforcements: [],
    classification: 'TEST',
  };
}

export function tinyMap(): GameMap {
  return testMap(10, 8);
}

export function tinyCtx(mut?: (s: Scenario, m: GameMap) => void): GameContext {
  const s = tinyScenario();
  const m = tinyMap();
  mut?.(s, m);
  return ctxFor(m, s);
}

/** A tiny game with both sides deployed (pre-placed units), blue to move, turn 1. */
export function startedGame(seed = 42, mut?: (s: Scenario, m: GameMap) => void): Game {
  const g = new Game(tinyCtx(mut), seed);
  expect1(g.dispatch(g.state.activeSide, { type: 'EndDeployment' }));
  expect1(g.dispatch(g.state.activeSide, { type: 'EndDeployment' }));
  return g;
}

function expect1(r: ReturnType<Game['dispatch']>): void {
  if (!r.ok) throw new Error(`dispatch failed: ${r.error.code}`);
}

export function must(r: ReturnType<Game['dispatch']>) {
  if (!r.ok) throw new Error(`dispatch failed: ${r.error.code} ${JSON.stringify(r.error.params)}`);
  return r.event;
}

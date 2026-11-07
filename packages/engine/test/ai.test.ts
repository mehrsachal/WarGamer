// AI-01 / AI-02 / AI-05 and the Phase 1 gate: a full 16-turn game vs the AI on the sample map.
import { describe, expect, it } from 'vitest';
import { aiAct, aiDeploy, aiPlayTurn } from '../src/ai/runner';
import { planDeployment } from '../src/ai/deploy';
import { DEFAULT_TUNING, commandKey, nextDefenceCommand } from '../src/ai/defend';
import { knowledge, tie } from '../src/ai/perception';
import { scriptedTurn } from '../src/ai/scripted';
import { Game } from '../src/game';
import { hexDistance, hexKey } from '../src/hex';
import { context } from './fixtures';

const ctx = context('ridgeline', 'ridgeline-coy-attack');

function playOut(seed: number, blue: 'attack' | 'passive'): { g: Game; maxAiMs: number } {
  const g = new Game(ctx, seed);
  let maxAiMs = 0;
  for (let i = 0; i < 400 && g.state.phase !== 'over'; i++) {
    if (g.state.activeSide === 'red') {
      const r = aiAct(g, 'red');
      if (r) maxAiMs = Math.max(maxAiMs, r.ms);
    } else scriptedTurn(g, 'blue', blue);
  }
  return { g, maxAiMs };
}

describe('AI deployment (AI-02)', () => {
  it('places every unit inside its zone and garrisons every objective', () => {
    const g = new Game(ctx, 1);
    scriptedTurn(g, 'blue', 'passive'); // blue ends deployment with its pre-placed set-up
    const rep = aiDeploy(g, 'red');
    expect(rep.refused).toBe(0);
    expect(g.state.phase).toBe('play');
    const zone = new Set(ctx.scenario.sides.red.deploymentZone.map(hexKey));
    const red = Object.values(g.state.units).filter((u) => u.side === 'red');
    for (const u of red) expect(zone.has(hexKey(u.hex!))).toBe(true);
    for (const o of ctx.scenario.objectives) expect(red.some((u) => u.hex && hexDistance(u.hex, o.hex) === 0)).toBe(true);
    // support weapons and mortars are not all bunched on the objectives
    const mortar = red.find((u) => u.typeId === 'mortar81_sec')!;
    expect(ctx.scenario.objectives.every((o) => hexDistance(o.hex, mortar.hex!) > 0)).toBe(true);
  });

  it('is deterministic and does not depend on the hidden enemy set-up (AI-01)', () => {
    const a = new Game(ctx, 5);
    const b = new Game(ctx, 5);
    // blue re-deploys one unit differently in game b, out of red's sight (deployment is hidden)
    b.dispatch('blue', { type: 'Deploy', unitId: 'a-snp', hex: ctx.scenario.sides.blue.deploymentZone[3] });
    scriptedTurn(a, 'blue', 'passive');
    scriptedTurn(b, 'blue', 'passive');
    const k = knowledge(ctx, 'red');
    expect(planDeployment(k, a.view('red'))).toEqual(planDeployment(k, b.view('red')));
  });
});

describe('AI turns (AI-01 / AI-05)', () => {
  it('acts only through its view and finishes its turn quickly', () => {
    const g = new Game(ctx, 9);
    scriptedTurn(g, 'blue', 'passive');
    aiDeploy(g, 'red');
    scriptedTurn(g, 'blue', 'attack');
    const before = g.events.length;
    const rep = aiPlayTurn(g, 'red');
    expect(rep.ms).toBeLessThan(5000);
    expect(g.events.length).toBeGreaterThan(before);
    expect(g.state.activeSide).toBe('blue');
    expect(aiAct(g, 'red')).toBeNull(); // not red's move
    // the next action is a pure function of the view
    const k = knowledge(ctx, 'red');
    const v = g.view('red');
    expect(nextDefenceCommand(k, v, new Set())).toBeNull(); // not red's turn: nothing to do
    expect(commandKey({ type: 'EndTurn' })).toBe('EndTurn');
    expect(commandKey({ type: 'CallFire', assetId: 'x', hex: { q: 0, r: 0 } })).toBe('arty:x');
    expect(tie('a', 1)).toBe(tie('a', 1));
    expect(DEFAULT_TUNING.minOdds).toBeGreaterThan(0);
  });
});

describe('Phase 1 gate: full 16-turn game vs the AI on the sample map', () => {
  it('a passive player loses to the defensive AI (AI-02)', () => {
    const { g, maxAiMs } = playOut(1, 'passive');
    expect(g.state.result).toMatchObject({ winner: 'red', turn: 16 });
    expect(maxAiMs).toBeLessThan(5000);
  });

  it('a sound attack beats the defensive AI in most games, and every game replays exactly', () => {
    let wins = 0;
    const seeds = [3, 4, 5, 6, 10];
    for (const seed of seeds) {
      const { g, maxAiMs } = playOut(seed, 'attack');
      expect(g.state.phase).toBe('over');
      expect(maxAiMs).toBeLessThan(5000);
      if (g.state.result!.winner === 'blue') wins++;
      const replay = Game.replay(ctx, seed, g.events, { verifyLog: true });
      expect(replay.state).toEqual(g.state);
    }
    expect(wins).toBeGreaterThanOrEqual(4);
  });
});

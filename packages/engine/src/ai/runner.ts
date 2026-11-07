// Drives an AI side through the normal command path, using only Game.view(side) (AI-01).
import type { Side } from '../data/schema';
import type { Command, GameEvent } from '../events';
import type { Game } from '../game';
import { type AiTuning, DEFAULT_TUNING, commandKey, nextDefenceCommand } from './defend';
import { planDeployment } from './deploy';
import { knowledge } from './perception';

export interface AiTurnReport {
  side: Side;
  actions: number;
  refused: number;
  ms: number;
  events: GameEvent[];
}

export interface AiOptions {
  tuning?: AiTuning;
  maxActions?: number;
  /** Clock source for the timing report (injectable for determinism in tests). */
  now?: () => number;
}

/** Deploy all unplaced units and end deployment. */
export function aiDeploy(game: Game, side: Side, opts: AiOptions = {}): AiTurnReport {
  const now = opts.now ?? Date.now;
  const t0 = now();
  const k = knowledge(game.ctx, side);
  const events: GameEvent[] = [];
  let refused = 0;
  for (const cmd of planDeployment(k, game.view(side))) {
    const r = game.dispatch(side, cmd);
    if (r.ok) events.push(r.event);
    else refused++;
  }
  const end = game.dispatch(side, { type: 'EndDeployment' });
  if (end.ok) events.push(end.event);
  return { side, actions: events.length, refused, ms: now() - t0, events };
}

/** Play one full AI turn (all actions, then End Turn). */
export function aiPlayTurn(game: Game, side: Side, opts: AiOptions = {}): AiTurnReport {
  const now = opts.now ?? Date.now;
  const t0 = now();
  const k = knowledge(game.ctx, side);
  const tried = new Set<string>();
  const events: GameEvent[] = [];
  let refused = 0;
  const max = opts.maxActions ?? 120;
  for (let i = 0; i < max; i++) {
    const v = game.view(side);
    if (v.phase !== 'play' || v.activeSide !== side) break;
    const cmd: Command | null = nextDefenceCommand(k, v, tried, opts.tuning ?? DEFAULT_TUNING);
    if (!cmd) break;
    tried.add(commandKey(cmd));
    const r = game.dispatch(side, cmd);
    if (r.ok) events.push(r.event);
    else refused++;
  }
  const v = game.view(side);
  if (v.phase === 'play' && v.activeSide === side) {
    const end = game.dispatch(side, { type: 'EndTurn' });
    if (end.ok) events.push(end.event);
  }
  return { side, actions: events.length, refused, ms: now() - t0, events };
}

/** Whatever the AI should do now (deploy or play its turn); returns null if it is not the AI's move. */
export function aiAct(game: Game, side: Side, opts: AiOptions = {}): AiTurnReport | null {
  const s = game.state;
  if (s.phase === 'over' || s.activeSide !== side) return null;
  if (s.phase === 'deploy') return aiDeploy(game, side, opts);
  return aiPlayTurn(game, side, opts);
}

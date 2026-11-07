import type { Side } from './data/schema';
import { CommandError, type Command, type GameEvent, type LogItem } from './events';
import { executeCommand } from './execute';
import { Dice, RecordedDice, drawAt } from './rng';
import { type GameContext, type GameState, initialState } from './state';
import { type SideView, filterLog, sideView } from './view';

export type DispatchResult = { ok: true; event: GameEvent } | { ok: false; error: { code: string; params: Record<string, string | number> } };

/** A running game: state + append-only event log. All mutation goes through dispatch(). */
export class Game {
  state: GameState;
  readonly events: GameEvent[] = [];

  constructor(
    readonly ctx: GameContext,
    readonly seed: number,
  ) {
    this.state = initialState(ctx, seed);
  }

  /** Validate and execute a command for `side`; on success the new event is appended. */
  dispatch(side: Side, cmd: Command, ts?: number): DispatchResult {
    const next = structuredClone(this.state);
    const dice = new Dice(next.seed, next.rngCursor);
    const turn = next.turn;
    let log: LogItem[];
    try {
      log = executeCommand(this.ctx, next, side, cmd, dice);
    } catch (e) {
      if (e instanceof CommandError) return { ok: false, error: { code: e.code, params: e.params } };
      throw e;
    }
    next.rngCursor = dice.position;
    next.seq += 1;
    const event: GameEvent = { seq: next.seq, turn, side, type: cmd.type, payload: cmd, log, rngDraws: dice.draws, ts };
    this.state = next;
    this.events.push(event);
    return { ok: true, event };
  }

  /** Rebuild a game from its seed and event log (AAR-01, NFR-05). Throws if the log is inconsistent. */
  static replay(ctx: GameContext, seed: number, events: readonly GameEvent[], opts: { verifyDice?: boolean; verifyLog?: boolean } = {}): Game {
    const g = new Game(ctx, seed);
    for (const ev of events) g.applyRecorded(ev, opts);
    return g;
  }

  /** Apply an already-recorded event using its stored dice. */
  applyRecorded(ev: GameEvent, opts: { verifyDice?: boolean; verifyLog?: boolean } = {}): void {
    const s = this.state;
    if (ev.seq !== s.seq + 1) throw new Error(`Event ${ev.seq} out of order (expected ${s.seq + 1})`);
    if (opts.verifyDice !== false) {
      ev.rngDraws.forEach((v, i) => {
        if (v !== drawAt(s.seed, s.rngCursor + i)) throw new Error(`Event ${ev.seq}: dice do not match the seed (tampered log?)`);
      });
    }
    const dice = new RecordedDice(ev.rngDraws);
    let log: LogItem[];
    try {
      log = executeCommand(this.ctx, s, ev.side, ev.payload, dice);
    } catch (e) {
      if (e instanceof CommandError) throw new Error(`Event ${ev.seq} (${ev.type}) is illegal on replay: ${e.code}`);
      throw e;
    }
    if (dice.remaining) throw new Error(`Event ${ev.seq}: recorded more dice than the rules consumed`);
    if (opts.verifyLog && JSON.stringify(log) !== JSON.stringify(ev.log)) throw new Error(`Event ${ev.seq}: replayed results differ from the log`);
    s.rngCursor += ev.rngDraws.length;
    s.seq += 1;
    this.events.push(ev);
  }

  view(side: Side): SideView {
    return sideView(this.ctx, this.state, side);
  }

  /** Plain-language log items this side is allowed to see. */
  logFor(side: Side): LogItem[] {
    return filterLog(
      this.events.flatMap((e) => e.log),
      side,
      (t) => this.ctx.data.units.get(t)?.name ?? t,
    );
  }
}

// Live games: authoritative engine instances, token-based side access, server-side AI, change notification.
import { randomBytes, randomInt } from 'node:crypto';
import { type Command, Game, type LogItem, type Side, type SideView, aiAct, otherSide } from '@tht/engine';
import type { Content } from './content';
import type { GameMode, GameRow, Store } from './store';

export interface LiveGame {
  row: GameRow;
  game: Game;
  /** Serialises mutations (player commands and AI turns). */
  busy: Promise<void>;
  aiThinking: boolean;
}

export type Listener = (gameId: string) => void;

export class GameError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly params: Record<string, string | number> = {},
  ) {
    super(code);
  }
}

export interface ClientState {
  gameId: string;
  side: Side;
  mode: GameMode;
  aiSide: Side | null;
  aiThinking: boolean;
  view: SideView;
  /** Filtered log items from index `logFrom`. */
  log: LogItem[];
  logFrom: number;
  logTotal: number;
}

export class GameManager {
  private live = new Map<string, LiveGame>();
  private listeners = new Set<Listener>();

  constructor(
    private readonly content: Content,
    private readonly store: Store,
    private readonly opts: { aiDelayMs?: number; now?: () => number } = {},
  ) {}

  private now(): number {
    return (this.opts.now ?? Date.now)();
  }

  /** Rebuild every stored game from its event log (server restart loses no completed action — NFR-08). */
  restore(log: (m: string) => void = () => {}): number {
    let n = 0;
    for (const row of this.store.games()) {
      if (!this.content.scenarios.has(row.scenarioId)) {
        log(`game ${row.id}: scenario ${row.scenarioId} no longer installed — not restored`);
        continue;
      }
      const game = Game.replay(this.content.context(row.scenarioId), row.seed, this.store.events(row.id));
      this.live.set(row.id, { row, game, busy: Promise.resolve(), aiThinking: false });
      n++;
      this.kickAi(row.id);
    }
    return n;
  }

  onChange(l: Listener): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  private emit(id: string): void {
    for (const l of this.listeners) l(id);
  }

  create(scenarioId: string, mode: GameMode, humanSide: Side, seed?: number): { gameId: string; tokens: Partial<Record<Side, string>> } {
    const ctx = this.content.context(scenarioId);
    const id = randomBytes(8).toString('hex');
    const tokens: Partial<Record<Side, string>> = {};
    if (mode === 'ai') tokens[humanSide] = randomBytes(16).toString('hex');
    else {
      tokens.blue = randomBytes(16).toString('hex');
      tokens.red = randomBytes(16).toString('hex');
    }
    const row: GameRow = {
      id,
      scenarioId,
      seed: seed ?? randomInt(1, 2 ** 31 - 1),
      mode,
      aiSide: mode === 'ai' ? otherSide(humanSide) : null,
      tokens,
      status: 'active',
      result: null,
      createdAt: this.now(),
      updatedAt: this.now(),
    };
    this.store.insertGame(row);
    this.live.set(id, { row, game: new Game(ctx, row.seed), busy: Promise.resolve(), aiThinking: false });
    this.kickAi(id);
    return { gameId: id, tokens };
  }

  private get(id: string): LiveGame {
    const g = this.live.get(id);
    if (!g) throw new GameError(404, 'game_not_found');
    return g;
  }

  /** Which side a token controls (403 otherwise). */
  sideFor(id: string, token: string | undefined): Side {
    const g = this.get(id);
    for (const s of ['blue', 'red'] as Side[]) if (token && g.row.tokens[s] === token) return s;
    throw new GameError(403, 'bad_token');
  }

  state(id: string, token: string | undefined, logFrom = 0): ClientState {
    const lg = this.get(id);
    const side = this.sideFor(id, token);
    const all = lg.game.logFor(side);
    const from = Math.max(0, Math.min(logFrom, all.length));
    return {
      gameId: id,
      side,
      mode: lg.row.mode,
      aiSide: lg.row.aiSide,
      aiThinking: lg.aiThinking,
      view: lg.game.view(side),
      log: all.slice(from),
      logFrom: from,
      logTotal: all.length,
    };
  }

  /** Execute a player command; persisted before success is returned. */
  async command(id: string, token: string | undefined, cmd: Command): Promise<{ ok: true } | { ok: false; code: string; params: Record<string, string | number> }> {
    const lg = this.get(id);
    const side = this.sideFor(id, token);
    if (lg.row.aiSide === side) throw new GameError(403, 'ai_side');
    let result: { ok: true } | { ok: false; code: string; params: Record<string, string | number> } = { ok: true };
    lg.busy = lg.busy.then(() => {
      if (lg.aiThinking) {
        result = { ok: false, code: 'not_your_turn', params: {} };
        return;
      }
      const r = lg.game.dispatch(side, cmd, this.now());
      if (!r.ok) {
        result = { ok: false, code: r.error.code, params: r.error.params };
        return;
      }
      this.store.appendEvents(id, [r.event]);
      this.afterChange(lg);
    });
    await lg.busy;
    if (result.ok) this.kickAi(id);
    return result;
  }

  private afterChange(lg: LiveGame): void {
    const s = lg.game.state;
    lg.row.updatedAt = this.now();
    if (s.phase === 'over' && lg.row.status !== 'over') {
      lg.row.status = 'over';
      lg.row.result = s.result ?? null;
      this.store.updateGame(lg.row.id, 'over', lg.row.result, lg.row.updatedAt);
    }
    this.emit(lg.row.id);
  }

  /** If it is the AI's move, play it on the server (AI-05: same engine, same fog). */
  private kickAi(id: string): void {
    const lg = this.live.get(id);
    if (!lg || !lg.row.aiSide || lg.aiThinking) return;
    const s = lg.game.state;
    if (s.phase === 'over' || s.activeSide !== lg.row.aiSide) return;
    lg.aiThinking = true;
    this.emit(id);
    const delay = this.opts.aiDelayMs ?? 400;
    lg.busy = lg.busy.then(
      () =>
        new Promise<void>((resolve) => {
          setTimeout(() => {
            try {
              const before = lg.game.events.length;
              const rep = aiAct(lg.game, lg.row.aiSide!);
              const fresh = lg.game.events.slice(before).map((e) => ({ ...e, ts: e.ts ?? this.now() }));
              this.store.appendEvents(id, fresh);
              if (rep && rep.ms > 5000) console.warn(`AI turn took ${rep.ms} ms (game ${id})`);
            } finally {
              lg.aiThinking = false;
              this.afterChange(lg);
              resolve();
            }
          }, delay);
        }),
    );
    void lg.busy.then(() => this.kickAi(id));
  }

  /** Wait until pending work (AI turns) for a game is done — used by tests and graceful shutdown. */
  async idle(id: string): Promise<void> {
    const lg = this.get(id);
    let last: Promise<void> | undefined;
    while (last !== lg.busy) {
      last = lg.busy;
      await last;
    }
  }

  list(): { id: string; scenarioId: string; mode: GameMode; status: string; createdAt: number }[] {
    return [...this.live.values()].map((g) => ({ id: g.row.id, scenarioId: g.row.scenarioId, mode: g.row.mode, status: g.row.status, createdAt: g.row.createdAt }));
  }
}

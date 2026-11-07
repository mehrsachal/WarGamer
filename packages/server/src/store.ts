// Persistence: one SQLite file (node:sqlite, no native addon). games + append-only game_events (NFR-08:
// every event is written before the client is told about it; a restart replays the log).
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { GameEvent, GameResult, Side } from '@tht/engine';

export type GameMode = 'ai' | 'hotseat';

export interface GameRow {
  id: string;
  scenarioId: string;
  seed: number;
  mode: GameMode;
  aiSide: Side | null;
  tokens: Partial<Record<Side, string>>;
  status: 'active' | 'over';
  result: GameResult | null;
  createdAt: number;
  updatedAt: number;
}

export class Store {
  private db: DatabaseSync;

  constructor(file: string) {
    if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      CREATE TABLE IF NOT EXISTS games (
        id TEXT PRIMARY KEY,
        scenario_id TEXT NOT NULL,
        seed INTEGER NOT NULL,
        mode TEXT NOT NULL,
        ai_side TEXT,
        tokens TEXT NOT NULL,
        status TEXT NOT NULL,
        result TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS game_events (
        game_id TEXT NOT NULL,
        seq INTEGER NOT NULL,
        turn INTEGER NOT NULL,
        side TEXT NOT NULL,
        type TEXT NOT NULL,
        payload TEXT NOT NULL,
        log TEXT NOT NULL,
        rng_draws TEXT NOT NULL,
        ts INTEGER NOT NULL,
        PRIMARY KEY (game_id, seq)
      );
      CREATE TRIGGER IF NOT EXISTS game_events_append_only_u BEFORE UPDATE ON game_events BEGIN SELECT RAISE(ABORT, 'game_events is append-only'); END;
      CREATE TRIGGER IF NOT EXISTS game_events_append_only_d BEFORE DELETE ON game_events BEGIN SELECT RAISE(ABORT, 'game_events is append-only'); END;
    `);
  }

  insertGame(g: GameRow): void {
    this.db
      .prepare('INSERT INTO games (id, scenario_id, seed, mode, ai_side, tokens, status, result, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(g.id, g.scenarioId, g.seed, g.mode, g.aiSide, JSON.stringify(g.tokens), g.status, g.result ? JSON.stringify(g.result) : null, g.createdAt, g.updatedAt);
  }

  updateGame(id: string, status: GameRow['status'], result: GameResult | null, at: number): void {
    this.db.prepare('UPDATE games SET status = ?, result = ?, updated_at = ? WHERE id = ?').run(status, result ? JSON.stringify(result) : null, at, id);
  }

  appendEvents(gameId: string, events: GameEvent[]): void {
    if (!events.length) return;
    const stmt = this.db.prepare('INSERT INTO game_events (game_id, seq, turn, side, type, payload, log, rng_draws, ts) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
    this.db.exec('BEGIN');
    try {
      for (const e of events) stmt.run(gameId, e.seq, e.turn, e.side, e.type, JSON.stringify(e.payload), JSON.stringify(e.log), JSON.stringify(e.rngDraws), e.ts ?? Date.now());
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  games(): GameRow[] {
    const rows = this.db.prepare('SELECT * FROM games ORDER BY created_at').all() as Record<string, unknown>[];
    return rows.map((r) => ({
      id: r.id as string,
      scenarioId: r.scenario_id as string,
      seed: Number(r.seed),
      mode: r.mode as GameMode,
      aiSide: (r.ai_side as Side | null) ?? null,
      tokens: JSON.parse(r.tokens as string),
      status: r.status as GameRow['status'],
      result: r.result ? JSON.parse(r.result as string) : null,
      createdAt: Number(r.created_at),
      updatedAt: Number(r.updated_at),
    }));
  }

  events(gameId: string): GameEvent[] {
    const rows = this.db.prepare('SELECT * FROM game_events WHERE game_id = ? ORDER BY seq').all(gameId) as Record<string, unknown>[];
    return rows.map((r) => ({
      seq: Number(r.seq),
      turn: Number(r.turn),
      side: r.side as Side,
      type: r.type as GameEvent['type'],
      payload: JSON.parse(r.payload as string),
      log: JSON.parse(r.log as string),
      rngDraws: JSON.parse(r.rng_draws as string),
      ts: Number(r.ts),
    }));
  }

  close(): void {
    this.db.close();
  }
}

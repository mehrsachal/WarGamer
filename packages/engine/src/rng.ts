// CBT-07 — seeded, counter-based RNG. A draw is a pure function of (seed, cursor), so the game state only
// needs to carry the cursor; every draw is recorded in the event that consumed it and replay re-applies the
// recorded values. Same seed + same commands => same draws (NFR-05).

function fmix32(h: number): number {
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/** Uniform draw in [0, 1) for (seed, cursor). */
export function drawAt(seed: number, cursor: number): number {
  const h = fmix32((seed >>> 0) ^ fmix32((cursor + 0x9e3779b9) >>> 0) ^ Math.imul(cursor >>> 0, 0x27d4eb2d));
  return h / 4294967296;
}

/** Deterministic 32-bit hash of a string (scenario ids, tie-breaks, default seeds). */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return fmix32(h);
}

/** Draw source used while resolving one command; collects every value it hands out. */
export class Dice {
  readonly draws: number[] = [];
  constructor(
    private readonly seed: number,
    private cursor: number,
  ) {}

  /** Uniform in [0, 1). */
  next(): number {
    const v = drawAt(this.seed, this.cursor++);
    this.draws.push(v);
    return v;
  }

  /** Percentile roll 0..99 (shown to players as "rolled 37 vs 42%"). */
  percentile(): number {
    return Math.floor(this.next() * 100);
  }

  get position(): number {
    return this.cursor;
  }
}

/** Replays recorded draws in order (used by the reducer; throws if an event under-recorded its dice). */
export class RecordedDice {
  private i = 0;
  constructor(private readonly values: readonly number[]) {}
  next(): number {
    if (this.i >= this.values.length) throw new Error('RecordedDice exhausted: event did not record enough draws');
    return this.values[this.i++];
  }
  /** Draws recorded but not consumed. */
  get remaining(): number {
    return this.values.length - this.i;
  }
}

// Seeded, serialisable pseudo-random generator (sfc32). Every simulation and
// generated scenario is reproducible from its seed, which is what makes the
// assessment objective: the same plan + same decisions = the same battle.

export class Rng {
  private a: number;
  private b: number;
  private c: number;
  private d: number;

  constructor(seed: number | string) {
    const s = typeof seed === 'string' ? hashString(seed) : seed >>> 0;
    this.a = 0x9e3779b9;
    this.b = 0x243f6a88;
    this.c = 0xb7e15162;
    this.d = s ^ 0xdeadbeef;
    for (let i = 0; i < 15; i++) this.next();
  }

  /** Uniform float in [0, 1). */
  next(): number {
    this.a >>>= 0; this.b >>>= 0; this.c >>>= 0; this.d >>>= 0;
    let t = (this.a + this.b) | 0;
    this.a = this.b ^ (this.b >>> 9);
    this.b = (this.c + (this.c << 3)) | 0;
    this.c = (this.c << 21) | (this.c >>> 11);
    this.d = (this.d + 1) | 0;
    t = (t + this.d) | 0;
    this.c = (this.c + t) | 0;
    return (t >>> 0) / 4294967296;
  }

  range(min: number, max: number): number {
    return min + (max - min) * this.next();
  }

  int(min: number, maxInclusive: number): number {
    return Math.floor(this.range(min, maxInclusive + 1));
  }

  chance(p: number): boolean {
    return this.next() < p;
  }

  pick<T>(arr: readonly T[]): T {
    return arr[Math.floor(this.next() * arr.length)];
  }

  shuffle<T>(arr: T[]): T[] {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  /** Standard normal via Box-Muller. */
  normal(mean = 0, sd = 1): number {
    const u = Math.max(1e-12, this.next());
    const v = this.next();
    return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  /** Number of successes for an expected value (Poisson approximation, exact for small means). */
  poisson(mean: number): number {
    if (mean <= 0) return 0;
    if (mean > 30) return Math.max(0, Math.round(this.normal(mean, Math.sqrt(mean))));
    const L = Math.exp(-mean);
    let k = 0;
    let p = 1;
    do {
      k++;
      p *= this.next();
    } while (p > L);
    return k - 1;
  }

  /** Weighted choice; weights need not sum to 1. */
  weighted<T>(items: readonly T[], weights: readonly number[]): T {
    const total = weights.reduce((s, w) => s + Math.max(0, w), 0);
    if (total <= 0) return items[0];
    let r = this.next() * total;
    for (let i = 0; i < items.length; i++) {
      r -= Math.max(0, weights[i]);
      if (r <= 0) return items[i];
    }
    return items[items.length - 1];
  }

  state(): [number, number, number, number] {
    return [this.a, this.b, this.c, this.d];
  }

  static fromState(s: [number, number, number, number]): Rng {
    const r = new Rng(0);
    [r.a, r.b, r.c, r.d] = s;
    return r;
  }
}

export function hashString(str: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function newSeed(): number {
  return (Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0;
}

let idCounter = 0;
export function uid(prefix = 'id'): string {
  idCounter = (idCounter + 1) % 1e6;
  return `${prefix}_${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}${idCounter.toString(36)}`;
}

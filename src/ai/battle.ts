// Per-battle AI session: token meter + hard budget, the AI enemy commander (an EngineAi) and
// the record saved with the attempt (WargameRecord.ai).

import type { AiRecord } from '../core/types';
import { type EngineAi, type RedChoice, type RedChoiceRecord, type RedDecisionPoint, ruleChoice } from '../sim/aiHooks';
import type { Engine } from '../sim/engine';
import { type AiCall, type AiResult, callClaude, clampWords, estTokens } from './client';
import { encodeEnemy } from './encode';
import { ENEMY_SCHEMA, ENEMY_SYS } from './prompts';
import { type AiFeature, type AiModel, aiAvailable, getAiConfig, getApiKey, noteBudget } from './settings';

export interface BattleOptions {
  key?: string;
  model?: AiModel;
  budget?: number;
  features?: Partial<Record<AiFeature, boolean>>;
  fetch?: typeof fetch;
  /** Wall clock (ms) — injectable for tests. */
  now?: () => number;
  /** Max real time the clock is held for the enemy commander (ms). */
  holdMs?: number;
}

export class AiBattle {
  readonly model: AiModel;
  readonly budget: number;
  calls = 0;
  input = 0;
  output = 0;
  events: AiRecord['events'] = [];
  readonly features: Record<AiFeature, boolean>;
  private readonly key: string;
  private readonly fetchImpl?: typeof fetch;
  private listeners = new Set<() => void>();
  budgetHit = false;

  constructor(o: BattleOptions = {}) {
    const cfg = getAiConfig();
    this.key = o.key ?? getApiKey();
    this.model = o.model ?? cfg.model;
    this.budget = o.budget ?? cfg.budget;
    const on = (f: AiFeature) => o.features?.[f] ?? (o.key ? true : aiAvailable(f));
    this.features = { enemy: on('enemy'), radio: on('radio'), judge: on('judge'), mentor: on('mentor') };
    this.fetchImpl = o.fetch;
  }

  get used(): number {
    return this.input + this.output;
  }

  enabled(f: AiFeature): boolean {
    return !!this.key && this.features[f];
  }

  /** Hard stop: no call once the budget is spent, or when this call's input + a typical reply would overrun it. */
  canSpend(estInput: number, expectOut = 250): boolean {
    return this.used < this.budget && this.used + estInput + expectOut <= this.budget;
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  notify(): void {
    for (const fn of [...this.listeners]) fn();
  }

  async call<T>(f: AiFeature, c: AiCall<T>): Promise<AiResult<T>> {
    if (!this.enabled(f)) return { ok: false, reason: 'NO_KEY', detail: 'AI feature off', ms: 0 };
    if (!this.canSpend(estTokens(c.system + c.user))) {
      this.budgetHit = true;
      noteBudget(true);
      this.notify();
      return { ok: false, reason: 'BUDGET', detail: `Battle token budget (${this.budget}) reached`, ms: 0 };
    }
    const r = await callClaude(c, { key: this.key, model: this.model, fetch: this.fetchImpl });
    if (r.usage) {
      this.calls += 1;
      this.input += r.usage.input;
      this.output += r.usage.output;
      if (this.used >= this.budget) {
        this.budgetHit = true;
        noteBudget(true);
      }
    }
    this.notify();
    return r;
  }

  log(time: number, who: AiRecord['events'][number]['who'], text: string): void {
    this.events.push({ time, who, text });
    this.notify();
  }
}

// ------------------------------------------------------------------ enemy commander

interface Pending {
  dp: RedDecisionPoint;
  done: boolean;
  choice: RedChoice | null;
  note: string;
  ms: number;
}

const KIND_LABEL: Record<string, string> = { PLAN: 'Final attk plan', SCREEN: 'Screens contacted', PH1_FAIL: 'Ph 1 failed', REORG1: 'Ph 1 obj taken', CATK: 'Own C attk' };

/** Validates the model's picks against the menu; invalid picks fall back to the rule default per group. */
export function validateEnemy(raw: unknown, dp: RedDecisionPoint): RedChoice | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as { p?: unknown; i?: unknown };
  if (!Array.isArray(r.p) || typeof r.i !== 'string') return null;
  const picks: Record<string, string> = {};
  let valid = 0;
  dp.groups.forEach((g, k) => {
    const want = String(r.p && (r.p as unknown[])[k] !== undefined ? (r.p as unknown[])[k] : '').trim().toUpperCase();
    const o = g.options.find((x) => x.id.toUpperCase() === want);
    if (o) valid++;
    picks[g.name] = o ? o.id : g.def;
  });
  if (!valid) return null;
  return { picks, intent: clampWords(r.i, 20), src: 'AI' };
}

/** Re-checks a (possibly prefetched) choice against the menu as it stands now. */
function reconcile(dp: RedDecisionPoint, ch: RedChoice): RedChoice {
  const picks: Record<string, string> = {};
  for (const g of dp.groups) picks[g.name] = g.options.some((o) => o.id === ch.picks[g.name]) ? ch.picks[g.name] : g.def;
  return { ...ch, picks };
}

export class EnemyCommander implements EngineAi {
  private reqs = new Map<string, Pending>();
  private asked = new Set<string>();
  private committed = new Map<string, RedChoiceRecord>();
  private hold: { key: string; since: number } | null = null;
  private readonly now: () => number;
  private readonly holdMs: number;

  constructor(
    private b: AiBattle,
    o: { now?: () => number; holdMs?: number } = {},
  ) {
    this.now = o.now ?? (() => Date.now());
    this.holdMs = o.holdMs ?? 8000;
  }

  private start(e: Engine, dp: RedDecisionPoint): Pending | null {
    if (!this.b.enabled('enemy')) return null;
    const user = encodeEnemy(e, dp);
    if (!this.b.canSpend(estTokens(ENEMY_SYS + user))) {
      this.b.budgetHit = true;
      noteBudget(true);
      this.b.notify();
      return null;
    }
    const p: Pending = { dp, done: false, choice: null, note: '', ms: 0 };
    this.reqs.set(dp.key, p);
    void this.b
      .call('enemy', {
        system: ENEMY_SYS,
        user,
        schema: ENEMY_SCHEMA as never,
        validate: (raw) => validateEnemy(raw, dp),
        maxTokens: { big: 1200, haiku: 300 },
        timeoutMs: 20000,
      })
      .then((r) => {
        p.done = true;
        p.ms = r.ms;
        if (r.ok) p.choice = r.data;
        else p.note = r.detail;
        if (this.committed.has(dp.key) && r.ok) this.b.log(e.t, 'EN_CDR', `${KIND_LABEL[dp.kind] ?? dp.kind}: AI reply arrived too late (${(r.ms / 1000).toFixed(1)} s) — built-in choice stood.`);
        this.b.notify();
      });
    return p;
  }

  redPrefetch(e: Engine, dp: RedDecisionPoint): void {
    if (!this.reqs.has(dp.key) && !this.committed.has(dp.key)) this.start(e, dp);
  }

  redDecide(e: Engine, dp: RedDecisionPoint): RedChoice | 'WAIT' {
    this.asked.add(dp.key);
    const done = this.committed.get(dp.key);
    if (done) return { picks: { ...done.picks }, intent: done.intent, src: done.src };
    if (!this.b.enabled('enemy')) return this.commit(e, dp, ruleChoice(dp), '');
    const r = this.reqs.get(dp.key) ?? this.start(e, dp);
    if (!r) return this.commit(e, dp, ruleChoice(dp), this.b.budgetHit ? 'token budget reached' : 'AI unavailable');
    if (r.done) return this.commit(e, dp, r.choice ? reconcile(dp, r.choice) : ruleChoice(dp), r.choice ? '' : r.note || 'no valid answer');
    const now = this.now();
    if (!this.hold || this.hold.key !== dp.key) this.hold = { key: dp.key, since: now };
    if (now - this.hold.since >= this.holdMs) return this.commit(e, dp, ruleChoice(dp), `no answer in ${Math.round(this.holdMs / 1000)} s`);
    return 'WAIT';
  }

  /** True while the clock should be held for an answer (at most holdMs of real time). */
  holding(): boolean {
    if (!this.hold) return false;
    const r = this.reqs.get(this.hold.key);
    if (!r || r.done || this.committed.has(this.hold.key)) return false;
    return this.now() - this.hold.since < this.holdMs;
  }

  /** What the UI shows while holding. */
  holdInfo(): { label: string; secs: number } | null {
    if (!this.holding() || !this.hold) return null;
    const r = this.reqs.get(this.hold.key)!;
    return { label: KIND_LABEL[r.dp.kind] ?? r.dp.kind, secs: Math.max(0, Math.ceil((this.holdMs - (this.now() - this.hold.since)) / 1000)) };
  }

  private commit(e: Engine, dp: RedDecisionPoint, ch: RedChoice, why: string): RedChoice {
    const rec: RedChoiceRecord = { key: dp.key, t: e.t, picks: { ...ch.picks }, intent: ch.intent, src: ch.src };
    this.committed.set(dp.key, rec);
    if (this.hold?.key === dp.key) this.hold = null;
    const label = KIND_LABEL[dp.kind] ?? dp.kind;
    const chosen = dp.groups
      .map((g) => {
        const o = g.options.find((x) => x.id === ch.picks[g.name]);
        return o && !(g.name === 'h' && o.id === 'H0') && !(g.name === 'feint' && o.id === 'NONE') && !(g.name === 'obj' && o.id === 'AUTO') ? o.text.replace(/ own posns near:\d+/, '').replace(/ tk:(\w+)/, ' apch (tk going $1)') : '';
      })
      .filter(Boolean)
      .join('; ');
    if (ch.src === 'AI') this.b.log(e.t, 'EN_CDR', `${label} — ${chosen || 'as planned'}. Intent: ${ch.intent || '—'}`);
    else if (this.b.enabled('enemy') && why) this.b.log(e.t, 'EN_CDR', `${label} — built-in commander (${why}).`);
    return ch;
  }

  /** Choices for WargameRecord.ai.choices, incl. decisions asked but never applied (t = -1). */
  choices(): RedChoiceRecord[] {
    const out = [...this.committed.values()];
    for (const k of this.asked) if (!this.committed.has(k)) out.push({ key: k, t: -1, picks: {}, intent: '', src: 'RULE' });
    return out;
  }
}

// ------------------------------------------------------------------ facade used by the wargame UI

export class BattleAi {
  readonly battle: AiBattle;
  readonly cdr: EnemyCommander;
  constructor(e: Engine, o: BattleOptions = {}) {
    this.battle = new AiBattle(o);
    this.cdr = new EnemyCommander(this.battle, { now: o.now, holdMs: o.holdMs });
    if (this.battle.enabled('enemy')) e.ai = this.cdr;
  }
  holding(): boolean {
    return this.cdr.holding();
  }
  record(): AiRecord {
    const b = this.battle;
    return { model: b.model, calls: b.calls, inputTokens: b.input, outputTokens: b.output, events: [...b.events], choices: this.cdr.choices() };
  }
  meter(): string {
    const u = this.battle.used;
    return u >= 1000 ? `${(u / 1000).toFixed(1)}k` : String(u);
  }
}


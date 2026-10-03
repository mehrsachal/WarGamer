// Injectable enemy-commander interface. The rule-based Foxland planner in red.ts computes
// enumerated options at a few key decision points; an optional controller (the Claude-backed
// commander in src/ai, or a replay of recorded choices) may pick among them. With no
// controller attached the rule-based behaviour is unchanged.
//
// Determinism: a controller answers synchronously. It may answer 'WAIT' to defer the decision
// to a later tick (the UI holds the clock while the AI thinks); the tick at which a choice is
// finally applied is recorded, so a replay with the same seed and choices reproduces the battle.

import type { Vec } from '../core/geom';
import type { Engine } from './engine';

export type RedDpKind = 'PLAN' | 'SCREEN' | 'PH1_FAIL' | 'REORG1' | 'CATK';

export interface RedOption {
  /** Short id shown to the AI (e.g. "A2", "L1", "FIX"). */
  id: string;
  /** Compact description (abbreviated, a few words). */
  text: string;
  /** Internal value the engine applies (e.g. a unit or approach id); defaults to `id`. */
  val?: string;
}

export interface RedOptionGroup {
  /** Group name (e.g. "apch", "obj", "h", "feint", "act"). */
  name: string;
  options: RedOption[];
  /** Rule-based default option id ('' = leave it to the rule-based planner). */
  def: string;
}

export interface RedDecisionPoint {
  /** Unique per battle, e.g. "PLAN", "SCREEN:<blueId>", "PH1_FAIL", "REORG1", "CATK:<blueId>". */
  key: string;
  kind: RedDpKind;
  /** One line describing the situation (compact). */
  sit: string;
  groups: RedOptionGroup[];
  focus?: Vec;
}

export interface RedChoice {
  /** Picked option id per group name ('' = rule-based default). */
  picks: Record<string, string>;
  /** One-line commander's intent (<= 20 words). */
  intent: string;
  src: 'AI' | 'RULE' | 'REPLAY';
}

/** A recorded choice (stored in WargameRecord.ai.choices) for deterministic replays. */
export interface RedChoiceRecord {
  key: string;
  /** Tick at which the choice was applied (-1 = asked but never applied). */
  t: number;
  picks: Record<string, string>;
  intent: string;
  src: RedChoice['src'];
}

export interface EngineAi {
  /** Return the choice for this decision point, or 'WAIT' to defer it to a later tick. */
  redDecide(e: Engine, dp: RedDecisionPoint): RedChoice | 'WAIT';
  /** Early warning that a decision point is approaching (lets the answer be prefetched). */
  redPrefetch?(e: Engine, dp: RedDecisionPoint): void;
}

/** The rule-based choice for a decision point. */
export function ruleChoice(dp: RedDecisionPoint): RedChoice {
  const picks: Record<string, string> = {};
  for (const g of dp.groups) picks[g.name] = g.def;
  return { picks, intent: '', src: 'RULE' };
}

/** Option value picked in a group (or undefined when left to the rule-based planner). */
export function pickVal(dp: RedDecisionPoint, ch: RedChoice, group: string): string | undefined {
  const g = dp.groups.find((x) => x.name === group);
  const id = ch.picks[group];
  if (!g || !id) return undefined;
  const o = g.options.find((x) => x.id === id);
  return o ? (o.val ?? o.id) : undefined;
}

/** Replays recorded choices: each decision applies at its recorded tick. */
export function replayAi(records: RedChoiceRecord[]): EngineAi {
  const byKey = new Map(records.map((r) => [r.key, r]));
  return {
    redDecide(e, dp) {
      const r = byKey.get(dp.key);
      if (!r) return ruleChoice(dp);
      // t < 0: asked during the battle but never applied (the situation passed while waiting)
      if (r.t < 0 || e.t < r.t) return 'WAIT';
      return { picks: { ...r.picks }, intent: r.intent, src: 'REPLAY' };
    },
  };
}

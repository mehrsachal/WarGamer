// Claude-backed TextJudge: all free-text answers of one submission are marked in ONE call.
// Any item the model does not mark validly falls back to the offline keyword heuristic.

import { offlineJudgement, setTextJudge, type TextJudge, type TextJudgement, type TextJudgeRequest } from '../assess/textJudge';
import { type AiClientOptions, callClaude, clampWords } from './client';
import { encodeJudge } from './encode';
import { JUDGE_SCHEMA, JUDGE_SYS } from './prompts';
import { aiAvailable, subscribeAi } from './settings';

/** Validates the batched answer; returns per-request judgements (null = not marked by the AI). */
export function validateJudge(raw: unknown, reqs: TextJudgeRequest[]): (TextJudgement | null)[] | null {
  if (!raw || typeof raw !== 'object' || !Array.isArray((raw as { r?: unknown }).r)) return null;
  const out: (TextJudgement | null)[] = reqs.map(() => null);
  let n = 0;
  for (const it of (raw as { r: unknown[] }).r) {
    if (!it || typeof it !== 'object') continue;
    const { i, s, n: note, c } = it as { i?: unknown; s?: unknown; n?: unknown; c?: unknown };
    if (typeof i !== 'number' || !Number.isInteger(i) || i < 0 || i >= reqs.length || typeof s !== 'number' || !Number.isFinite(s) || typeof note !== 'string') continue;
    const kp = reqs[i].keyPoints.length;
    const covered = Array.isArray(c) ? [...new Set(c.filter((x): x is number => typeof x === 'number' && Number.isInteger(x) && x >= 0 && x < kp))].sort((a, b) => a - b) : [];
    out[i] = { score: Math.max(0, Math.min(1, s)), note: clampWords(note, 20), covered, source: 'AI' };
    n++;
  }
  return n ? out : null;
}

export function makeAiJudge(o: AiClientOptions = {}): TextJudge {
  return {
    async judge(reqs) {
      const idx = reqs.map((r, i) => (r.answer.trim() ? i : -1)).filter((i) => i >= 0);
      const offline = reqs.map(offlineJudgement);
      if (!idx.length) return offline;
      const sub = idx.map((i) => reqs[i]);
      const r = await callClaude(
        {
          system: JUDGE_SYS,
          user: encodeJudge(sub),
          schema: JUDGE_SCHEMA as never,
          validate: (raw) => validateJudge(raw, sub),
          maxTokens: { big: 1000 + 90 * sub.length, haiku: 150 + 90 * sub.length },
          timeoutMs: 30000,
        },
        o,
      );
      if (!r.ok) return offline;
      const out = offline.slice();
      r.data.forEach((j, k) => {
        if (j) out[idx[k]] = j;
      });
      return out;
    },
  };
}

const aiJudge = makeAiJudge();
let registered = false;

/** Registers the AI judge when a key is set and the feature is on; unregisters otherwise. */
export function syncTextJudge(): void {
  const want = aiAvailable('judge');
  if (want === registered) return;
  registered = want;
  setTextJudge(want ? aiJudge : null);
}

let started = false;
/** Called once at app start: keeps the judge registration in step with the AI settings. */
export function initAiJudge(): void {
  syncTextJudge();
  if (started) return;
  started = true;
  subscribeAi(syncTextJudge);
}

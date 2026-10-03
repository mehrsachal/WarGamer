// AI mentor debrief: a compact AAR (<= ~800 input tokens) in, <= 200 words of coaching out.
// The text is saved to WargameRecord.ai.mentor so it is never requested twice.

import type { AiRecord, Attempt, Scenario } from '../core/types';
import { type AiClientOptions, type AiResult, callClaude } from './client';
import { encodeAar } from './encode';
import { MENTOR_SYS } from './prompts';
import { getAiConfig } from './settings';

/** Keeps line breaks, caps the total at `n` words. */
export function clampWordsKeepLines(s: string, n: number): string {
  let left = n;
  const out: string[] = [];
  for (const line of String(s ?? '').split('\n')) {
    if (left <= 0) break;
    const w = line.trim().split(/\s+/).filter(Boolean);
    if (!w.length) {
      if (out.length && out[out.length - 1] !== '') out.push('');
      continue;
    }
    out.push(w.length <= left ? w.join(' ') : `${w.slice(0, left).join(' ')}…`);
    left -= w.length;
  }
  return out.join('\n').trim();
}

export function validateMentor(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const t = clampWordsKeepLines(raw.replace(/^#+\s.*$/gm, '').replace(/\*\*/g, ''), 200);
  return t.length >= 20 ? t : null;
}

export async function askMentor(s: Scenario, a: Attempt, o: AiClientOptions = {}): Promise<AiResult<string>> {
  return callClaude({ system: MENTOR_SYS, user: encodeAar(s, a), validate: validateMentor, maxTokens: { big: 1500, haiku: 500 }, timeoutMs: 30000 }, o);
}

/** Merges the mentor text and its usage into the attempt's AI record. */
export function withMentor(a: Attempt, text: string, usage: { input: number; output: number }, model = getAiConfig().model): Attempt {
  if (!a.wargame) return a;
  const prev: AiRecord = a.wargame.ai ?? { model, calls: 0, inputTokens: 0, outputTokens: 0, events: [] };
  return { ...a, wargame: { ...a.wargame, ai: { ...prev, mentor: text, calls: prev.calls + 1, inputTokens: prev.inputTokens + usage.input, outputTokens: prev.outputTokens + usage.output } } };
}

// Thin, defensive wrapper over the official Anthropic SDK. One tiny call per event; every
// failure mode (no key, refusal, max_tokens, bad JSON, timeout, auth, rate limit, network)
// becomes a typed "no answer" so the caller falls back to the built-in rule-based AI.

import Anthropic from '@anthropic-ai/sdk';
import { betaJSONSchemaOutputFormat } from '@anthropic-ai/sdk/helpers/beta/json-schema';
import { type AiModel, addAiTotals, getAiConfig, getApiKey, noteInflight, noteResult } from './settings';

type Params = Anthropic.Beta.Messages.MessageCreateParamsNonStreaming;
type Msg = Anthropic.Beta.Messages.BetaMessage;

export interface AiUsage {
  /** All input tokens incl. cache reads/writes. */
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

export type AiFailure = 'NO_KEY' | 'BUDGET' | 'REFUSAL' | 'MAX_TOKENS' | 'BAD_OUTPUT' | 'AUTH' | 'PERMISSION' | 'RATE_LIMIT' | 'TIMEOUT' | 'NETWORK' | 'BAD_REQUEST' | 'API';

export type AiResult<T> =
  | { ok: true; data: T; text: string; usage: AiUsage; ms: number; model: string }
  | { ok: false; reason: AiFailure; detail: string; usage?: AiUsage; ms: number };

export type Validator<T> = (raw: unknown) => T | null;

export interface AiCall<T> {
  /** Frozen system prompt (no timestamps or ids, so it can be cached). */
  system: string;
  /** Compact user message. */
  user: string;
  /** JSON schema for structured output; omit for plain text. */
  schema?: Record<string, unknown> & { type: 'object' };
  /** Validates the parsed JSON (or the text when no schema); null = reject. */
  validate: Validator<T>;
  /** Output cap on Opus/Sonnet (room for low-effort thinking) and on Haiku. */
  maxTokens: { big: number; haiku: number };
  /** Request timeout (ms). */
  timeoutMs?: number;
}

export interface AiClientOptions {
  key?: string;
  model?: AiModel;
  /** Injected fetch (tests / offline stubs). */
  fetch?: typeof fetch;
}

const FALLBACK_BETA = 'server-side-fallback-2026-07-01';
const STRUCTURED_BETA = 'structured-outputs-2025-12-15';

export function isBigModel(m: string): boolean {
  return m === 'claude-opus-5-5' || m === 'claude-sonnet-5-5';
}

/** Builds the request body following the per-model rules (no thinking param, low effort on
 *  Opus/Sonnet 5.5 + server-side refusal fallback; nothing extra on Haiku 4.5). */
export function buildParams(model: AiModel, c: Pick<AiCall<unknown>, 'system' | 'user' | 'schema' | 'maxTokens'>): Params {
  const big = isBigModel(model);
  const p: Params = {
    model,
    max_tokens: big ? c.maxTokens.big : c.maxTokens.haiku,
    system: c.system,
    messages: [{ role: 'user', content: c.user }],
    cache_control: { type: 'ephemeral' },
  };
  const betas: string[] = [];
  const output: NonNullable<Params['output_config']> = {};
  if (big) {
    output.effort = 'low';
    betas.push(FALLBACK_BETA);
    p.fallbacks = 'default';
  }
  if (c.schema) {
    const f = betaJSONSchemaOutputFormat(c.schema as never);
    output.format = { type: 'json_schema', schema: f.schema };
    betas.push(STRUCTURED_BETA);
  }
  if (Object.keys(output).length) p.output_config = output;
  if (betas.length) p.betas = betas;
  return p;
}

export function makeClient(key: string, fetchImpl?: typeof fetch, timeoutMs = 20000): Anthropic {
  return new Anthropic({
    apiKey: key,
    // explicit: never pick up ANTHROPIC_BASE_URL or other environment configuration
    baseURL: 'https://api.anthropic.com',
    authToken: null,
    dangerouslyAllowBrowser: true,
    maxRetries: 1,
    timeout: timeoutMs,
    ...(fetchImpl ? { fetch: fetchImpl } : {}),
  });
}

function usageOf(m: Msg): AiUsage {
  const u = m.usage;
  const cacheRead = u?.cache_read_input_tokens ?? 0;
  const cacheWrite = u?.cache_creation_input_tokens ?? 0;
  return { input: (u?.input_tokens ?? 0) + cacheRead + cacheWrite, output: u?.output_tokens ?? 0, cacheRead, cacheWrite };
}

function textOf(m: Msg): string {
  return m.content
    .filter((b): b is Anthropic.Beta.Messages.BetaTextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim();
}

/** Classifies an SDK error (most specific first). */
export function classifyError(err: unknown): { reason: AiFailure; detail: string } {
  if (err instanceof Anthropic.APIConnectionTimeoutError) return { reason: 'TIMEOUT', detail: 'Request timed out' };
  if (err instanceof Anthropic.APIConnectionError) return { reason: 'NETWORK', detail: 'No connection to api.anthropic.com' };
  if (err instanceof Anthropic.AuthenticationError) return { reason: 'AUTH', detail: 'API key rejected (401)' };
  if (err instanceof Anthropic.PermissionDeniedError) return { reason: 'PERMISSION', detail: 'Key not permitted for this model (403)' };
  if (err instanceof Anthropic.RateLimitError) return { reason: 'RATE_LIMIT', detail: 'Rate limited (429) — try again shortly' };
  if (err instanceof Anthropic.BadRequestError) return { reason: 'BAD_REQUEST', detail: `Request rejected (400): ${String((err as Error).message).slice(0, 140)}` };
  if (err instanceof Anthropic.APIError) return { reason: 'API', detail: `API error ${(err as { status?: number }).status ?? ''}`.trim() };
  return { reason: 'API', detail: String((err as Error)?.message ?? err).slice(0, 140) };
}

/** One call. Never throws. Records cumulative usage on this PC and the live status. */
export async function callClaude<T>(c: AiCall<T>, o: AiClientOptions = {}): Promise<AiResult<T>> {
  const t0 = Date.now();
  const key = o.key ?? getApiKey();
  if (!key) return { ok: false, reason: 'NO_KEY', detail: 'No API key set', ms: 0 };
  const model = o.model ?? getAiConfig().model;
  const client = makeClient(key, o.fetch, c.timeoutMs ?? 20000);
  noteInflight(1);
  try {
    const msg = (await client.beta.messages.create(buildParams(model, c))) as Msg;
    const usage = usageOf(msg);
    addAiTotals(usage.input, usage.output);
    noteResult(null);
    const ms = Date.now() - t0;
    if (msg.stop_reason === 'refusal') {
      const cat = msg.stop_details?.category;
      return { ok: false, reason: 'REFUSAL', detail: `Declined${cat ? ` (${cat})` : ''}`, usage, ms };
    }
    if (msg.stop_reason === 'max_tokens') return { ok: false, reason: 'MAX_TOKENS', detail: 'Answer cut off (max_tokens)', usage, ms };
    const text = textOf(msg);
    let raw: unknown = text;
    if (c.schema) {
      try {
        raw = JSON.parse(text);
      } catch {
        return { ok: false, reason: 'BAD_OUTPUT', detail: 'Malformed JSON', usage, ms };
      }
    }
    const data = c.validate(raw);
    if (data === null || data === undefined) return { ok: false, reason: 'BAD_OUTPUT', detail: 'Answer failed validation', usage, ms };
    return { ok: true, data, text, usage, ms, model: msg.model ?? model };
  } catch (err) {
    const { reason, detail } = classifyError(err);
    noteResult(reason, detail);
    return { ok: false, reason, detail, ms: Date.now() - t0 };
  } finally {
    noteInflight(-1);
  }
}

/** ~tokens for a string (chars / 4). */
export function estTokens(s: string): number {
  return Math.ceil(s.length / 4);
}

/** Trims to at most `n` words. */
export function clampWords(s: string, n: number): string {
  const w = String(s ?? '').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  return w.length <= n ? w.join(' ') : `${w.slice(0, n).join(' ')}…`;
}

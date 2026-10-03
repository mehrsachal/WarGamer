// Optional Claude AI — per-PC settings and live status.
//
// Privacy: the API key is stored ONLY in this browser profile's localStorage. It is never
// written to IndexedDB, the LAN server, backups, exercise packs, exports or attempts. Anyone
// using this browser profile can use the key.

export type AiModel = 'claude-opus-5-5' | 'claude-sonnet-5-5' | 'claude-haiku-4-5';
export type AiFeature = 'enemy' | 'radio' | 'judge' | 'mentor';

export const AI_MODELS: { id: AiModel; label: string; note: string }[] = [
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5', note: 'Default — strongest tactical judgement' },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5', note: 'Faster, lower cost' },
  { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5', note: 'Fastest, lowest cost' },
];

export const AI_FEATURES: { id: AiFeature; label: string; note: string }[] = [
  { id: 'enemy', label: 'AI enemy commander', note: 'Foxland cdr chooses apch, obj, H hr, feints and reacts at key moments' },
  { id: 'radio', label: 'Radio net', note: 'Free-text orders the built-in parser cannot read are interpreted by the AI' },
  { id: 'judge', label: 'AI text marking', note: 'Free-text answers marked against doctrine in one batched call per submission' },
  { id: 'mentor', label: 'AI mentor debrief', note: 'Short coaching after the battle, on request' },
];

export interface AiConfig {
  /** Master switch. */
  enabled: boolean;
  model: AiModel;
  features: Record<AiFeature, boolean>;
  /** Per-battle token budget (input + output); beyond it the built-in AI takes over. */
  budget: number;
}

export const DEFAULT_AI_CONFIG: AiConfig = {
  enabled: true,
  model: 'claude-opus-5-5',
  features: { enemy: true, radio: true, judge: true, mentor: true },
  budget: 20000,
};

export interface AiTotals {
  calls: number;
  input: number;
  output: number;
  since: number;
}

// ------------------------------------------------------------------ storage (localStorage only)

interface KV {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
  removeItem(k: string): void;
}

const K_KEY = 'wargamer.ai.key';
const K_CFG = 'wargamer.ai.config';
const K_TOT = 'wargamer.ai.usage';

function memoryKv(): KV {
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: (k) => void m.delete(k) };
}

let kv: KV | null = null;
function store(): KV {
  if (kv) return kv;
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.getItem(K_CFG);
      kv = localStorage;
      return kv;
    }
  } catch {
    /* blocked storage: fall through */
  }
  kv = memoryKv();
  return kv;
}

/** Tests: swap the storage (null = fresh in-memory store). */
export function setAiStorage(s: KV | null): void {
  kv = s ?? memoryKv();
}

function read<T>(k: string, fallback: T): T {
  try {
    const v = store().getItem(k);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
}
function write(k: string, v: unknown): void {
  try {
    store().setItem(k, JSON.stringify(v));
  } catch {
    /* quota / blocked */
  }
}

export function getApiKey(): string {
  try {
    return (store().getItem(K_KEY) ?? '').trim();
  } catch {
    return '';
  }
}

export function setApiKey(key: string): void {
  try {
    const k = key.trim();
    if (k) store().setItem(K_KEY, k);
    else store().removeItem(K_KEY);
  } catch {
    /* ignore */
  }
  live.lastError = null;
  notifyAi();
}

export function clearApiKey(): void {
  setApiKey('');
}

/** "sk-ant-…a1B2" — never show the whole key once saved. */
export function maskKey(k: string): string {
  if (!k) return '';
  return k.length <= 12 ? '••••' : `${k.slice(0, 7)}…${k.slice(-4)}`;
}

export function getAiConfig(): AiConfig {
  const c = read<Partial<AiConfig>>(K_CFG, {});
  const model = AI_MODELS.some((m) => m.id === c.model) ? (c.model as AiModel) : DEFAULT_AI_CONFIG.model;
  const budget = typeof c.budget === 'number' && c.budget >= 1000 ? Math.round(c.budget) : DEFAULT_AI_CONFIG.budget;
  return {
    enabled: c.enabled ?? DEFAULT_AI_CONFIG.enabled,
    model,
    features: { ...DEFAULT_AI_CONFIG.features, ...(c.features ?? {}) },
    budget,
  };
}

export function setAiConfig(c: AiConfig): void {
  write(K_CFG, c);
  notifyAi();
}

export function getAiTotals(): AiTotals {
  return read<AiTotals>(K_TOT, { calls: 0, input: 0, output: 0, since: Date.now() });
}

export function addAiTotals(input: number, output: number): void {
  const t = getAiTotals();
  write(K_TOT, { ...t, calls: t.calls + 1, input: t.input + input, output: t.output + output });
}

export function resetAiTotals(): void {
  write(K_TOT, { calls: 0, input: 0, output: 0, since: Date.now() });
  notifyAi();
}

/** True when a key is set, AI is switched on and (optionally) the feature is enabled. */
export function aiAvailable(feature?: AiFeature): boolean {
  const c = getAiConfig();
  if (!c.enabled || !getApiKey()) return false;
  return feature ? !!c.features[feature] : true;
}

// ------------------------------------------------------------------ live status (top-bar pill)

export type AiStatus = 'OFF' | 'READY' | 'THINKING' | 'OFFLINE' | 'BUDGET';

const live: { inflight: number; lastError: { reason: string; detail: string; at: number } | null; budgetHit: boolean } = {
  inflight: 0,
  lastError: null,
  budgetHit: false,
};
const listeners = new Set<() => void>();

export function subscribeAi(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function notifyAi(): void {
  for (const fn of [...listeners]) {
    try {
      fn();
    } catch {
      /* a listener must not break the others */
    }
  }
}

export function noteInflight(delta: number): void {
  live.inflight = Math.max(0, live.inflight + delta);
  notifyAi();
}

const OFFLINE_REASONS = new Set(['NETWORK', 'TIMEOUT', 'AUTH', 'PERMISSION']);

export function noteResult(reason: string | null, detail = ''): void {
  if (!reason) live.lastError = null;
  else if (OFFLINE_REASONS.has(reason)) live.lastError = { reason, detail, at: Date.now() };
  notifyAi();
}

export function noteBudget(hit: boolean): void {
  if (live.budgetHit === hit) return;
  live.budgetHit = hit;
  notifyAi();
}

export function aiStatus(): { status: AiStatus; detail: string } {
  if (!aiAvailable()) return { status: 'OFF', detail: getApiKey() ? 'AI switched off in settings — built-in AI only' : 'No API key — built-in AI only' };
  if (live.inflight > 0) return { status: 'THINKING', detail: 'Waiting for Claude…' };
  if (live.budgetHit) return { status: 'BUDGET', detail: 'Battle token budget reached — built-in AI for the rest of this battle' };
  if (live.lastError) {
    const why = live.lastError.reason === 'AUTH' ? 'API key rejected' : live.lastError.reason === 'PERMISSION' ? 'Key lacks permission' : 'No connection to the Claude API';
    return { status: 'OFFLINE', detail: `${why} — built-in AI in use` };
  }
  return { status: 'READY', detail: `${AI_MODELS.find((m) => m.id === getAiConfig().model)?.label ?? 'Claude'} ready` };
}

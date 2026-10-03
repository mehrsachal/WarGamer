import { useState } from 'preact/hooks';
import { Modal, toast } from '../../ui/kit';
import { callClaude } from '../client';
import {
  AI_FEATURES,
  AI_MODELS,
  type AiConfig,
  type AiModel,
  clearApiKey,
  getAiConfig,
  getAiTotals,
  getApiKey,
  maskKey,
  resetAiTotals,
  setAiConfig,
  setApiKey,
} from '../settings';
import { useAiStatus } from './hooks';

const STATUS_LABEL = { OFF: 'Off', READY: 'Ready', THINKING: 'Thinking', OFFLINE: 'Offline', BUDGET: 'Budget reached' } as const;

export function fmtTok(n: number): string {
  return n >= 10000 ? `${Math.round(n / 1000)}k` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

/** AI settings for this PC (instructor Data & settings tab, and the top-bar AI pill). */
export function AiSettingsPanel(p: { compact?: boolean }) {
  const st = useAiStatus();
  const [cfg, setCfg] = useState<AiConfig>(getAiConfig());
  const [keyIn, setKeyIn] = useState('');
  const [show, setShow] = useState(false);
  const [test, setTest] = useState<{ busy: boolean; ok?: boolean; text?: string }>({ busy: false });
  const saved = getApiKey();
  const tot = getAiTotals();
  const upd = (c: AiConfig) => {
    setCfg(c);
    setAiConfig(c);
  };
  const saveKey = () => {
    const k = keyIn.trim();
    if (!k) return;
    if (!/^sk-ant-/.test(k)) toast('That does not look like an Anthropic API key (sk-ant-…). Saved anyway.', 'err');
    setApiKey(k);
    setKeyIn('');
    setShow(false);
    setTest({ busy: false });
    toast('API key saved on this PC only.', 'ok');
  };
  const runTest = async () => {
    setTest({ busy: true });
    const r = await callClaude({ system: 'You are a connectivity check. Reply with the single word OK.', user: 'Radio check, over.', validate: (t) => (typeof t === 'string' && t.length ? t : null), maxTokens: { big: 256, haiku: 16 }, timeoutMs: 20000 });
    if (r.ok) setTest({ busy: false, ok: true, text: `Connected — ${r.model} replied in ${(r.ms / 1000).toFixed(1)} s · ${r.usage.input} in / ${r.usage.output} out tokens.` });
    else setTest({ busy: false, ok: false, text: `${r.detail}${r.usage ? ` · ${r.usage.input} in / ${r.usage.output} out tokens` : ''}` });
  };
  return (
    <div class={`ai-settings col ${p.compact ? 'compact' : ''}`}>
      <div class="row" style={{ alignItems: 'flex-start' }}>
        <div class="grow muted small" style={{ lineHeight: 1.55 }}>
          WarGamer runs fully offline with its built-in AI. Add an Anthropic API key to let <b>Claude</b> command the enemy, read free-text radio orders, mark written answers and mentor students after the battle. Calls are event-driven and tiny (typically a few thousand tokens per battle); if the AI is slow, offline or out of budget the built-in AI takes over at once.
        </div>
        <span class={`ai-pill s-${st.status}`} title={st.detail}>
          <i />
          AI · {STATUS_LABEL[st.status]}
        </span>
      </div>

      <div class="ai-box col" style={{ gap: 8 }}>
        <div class="row">
          <b>API key</b>
          <span class="dim small">{saved ? `saved: ${maskKey(saved)}` : 'not set'}</span>
          {saved && (
            <button
              class="btn small danger right"
              onClick={() => {
                clearApiKey();
                setTest({ busy: false });
                toast('API key cleared from this PC.', 'ok');
              }}
            >
              Clear key
            </button>
          )}
        </div>
        <div class="row">
          <input
            class="grow mono"
            type={show ? 'text' : 'password'}
            placeholder={saved ? 'Paste a new key to replace it' : 'sk-ant-…'}
            value={keyIn}
            autocomplete="off"
            spellcheck={false}
            onInput={(e) => setKeyIn(e.currentTarget.value)}
            onKeyDown={(e) => e.key === 'Enter' && saveKey()}
            aria-label="Anthropic API key"
          />
          <button class="btn small" onClick={() => setShow(!show)} title={show ? 'Hide key' : 'Show key'}>
            {show ? 'Hide' : 'Show'}
          </button>
          <button class="btn small primary" disabled={!keyIn.trim()} onClick={saveKey}>
            Save key
          </button>
        </div>
        <div class="ai-privacy small">
          🔒 Stored only in this browser profile on this PC (localStorage) — never in the class database, LAN server, backups, exercise packs or exports. <b>Anyone using this browser profile can use the key</b>; clear it on shared machines.
        </div>
        <div class="row wrap">
          <button class="btn small" disabled={!saved || test.busy} onClick={runTest}>
            {test.busy ? 'Testing…' : 'Test connection'}
          </button>
          {test.text && <span class={`small ${test.ok ? 'ai-ok' : 'ai-bad'}`}>{test.ok ? '✔ ' : '✖ '}{test.text}</span>}
        </div>
      </div>

      <label class="check" style={{ padding: '2px 0' }}>
        <input type="checkbox" checked={cfg.enabled} onChange={(e) => upd({ ...cfg, enabled: e.currentTarget.checked })} />
        <span>
          <b>Use Claude when a key is set</b>
          <div class="dim small">Untick to force the built-in AI without removing the key.</div>
        </span>
      </label>

      <div class={p.compact ? 'col' : 'grid2'} style={{ gap: 12 }}>
        <label class="field">
          Model
          <select value={cfg.model} onChange={(e) => upd({ ...cfg, model: e.currentTarget.value as AiModel })}>
            {AI_MODELS.map((m) => (
              <option value={m.id}>
                {m.label} — {m.note}
              </option>
            ))}
          </select>
        </label>
        <label class="field">
          Token budget per battle (in + out)
          <input type="number" min={2000} max={200000} step={1000} value={cfg.budget} onChange={(e) => upd({ ...cfg, budget: Math.max(2000, Math.min(200000, Number(e.currentTarget.value) || 20000)) })} />
        </label>
      </div>
      <div class="dim small" style={{ marginTop: -4 }}>Hard stop: once a battle has used its budget, the built-in AI plays the rest of it.</div>

      <div class={p.compact ? 'col' : 'grid2'} style={{ gap: p.compact ? 2 : '2px 12px' }}>
        {AI_FEATURES.map((f) => (
          <label class="check" style={{ padding: '3px 0' }}>
            <input type="checkbox" checked={cfg.features[f.id]} onChange={(e) => upd({ ...cfg, features: { ...cfg.features, [f.id]: e.currentTarget.checked } })} />
            <span>
              {f.label}
              <div class="dim small">{f.note}</div>
            </span>
          </label>
        ))}
      </div>

      <div class="row ai-usage small">
        <span class="muted">Usage on this PC since {new Date(tot.since).toLocaleDateString()}:</span>
        <b>{tot.calls}</b> {tot.calls === 1 ? 'call' : 'calls'} · <b>{fmtTok(tot.input)}</b> in · <b>{fmtTok(tot.output)}</b> out tokens
        <button class="btn small ghost right" onClick={resetAiTotals}>
          Reset
        </button>
      </div>
    </div>
  );
}

export function AiSettingsModal(p: { onClose: () => void }) {
  return (
    <Modal title={<span>Claude AI settings (this PC)</span>} onClose={p.onClose} footer={<button class="btn primary" onClick={p.onClose}>Done</button>}>
      <AiSettingsPanel compact />
    </Modal>
  );
}

/** Small status pill for the top bar; opens the settings. */
export function AiPill() {
  const st = useAiStatus();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button class={`ai-pill s-${st.status} clickable`} title={`${st.detail} — click for AI settings`} onClick={() => setOpen(true)}>
        <i />
        AI · {STATUS_LABEL[st.status]}
      </button>
      {open && <AiSettingsModal onClose={() => setOpen(false)} />}
    </>
  );
}

/** Instructor "Data & settings" card. */
export function AiSettingsCard() {
  return (
    <div class="card col" style={{ gridColumn: '1 / -1' }}>
      <h3>Claude AI (optional)</h3>
      <AiSettingsPanel />
    </div>
  );
}

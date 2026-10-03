import { useState } from 'preact/hooks';
import { fmtTime } from '../../core/time';
import type { Attempt, Scenario } from '../../core/types';
import { db } from '../../store/db';
import { toast } from '../../ui/kit';
import { askMentor, withMentor } from '../mentor';
import { aiAvailable } from '../settings';
import { fmtTok } from './AiSettings';
import { useAiStatus } from './hooks';

/** Debrief card: AI enemy commander's decisions (revealed in the AAR) and the AI mentor. */
export function AiDebrief(p: { s: Scenario; attempt: Attempt }) {
  useAiStatus();
  const [att, setAtt] = useState(p.attempt);
  const [busy, setBusy] = useState(false);
  const w = att.wargame;
  if (!w) return null;
  const ai = w.ai;
  const canAsk = aiAvailable('mentor');
  if (!ai && !canAsk) return null;
  const enCdr = ai?.events.filter((x) => x.who === 'EN_CDR') ?? [];
  const radio = ai?.events.filter((x) => x.who === 'RADIO') ?? [];
  const ask = async () => {
    setBusy(true);
    try {
      const r = await askMentor(p.s, att);
      if (!r.ok) {
        toast(`AI mentor unavailable: ${r.detail}`, 'err');
        return;
      }
      const fresh = (await db.get('attempts', att.id)) ?? att;
      const next = withMentor(fresh, r.data, r.usage);
      await db.put('attempts', next);
      setAtt(next);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div class="card ai-debrief" style={{ marginTop: 14 }}>
      <div class="card-h">
        <h3>AI mentor &amp; enemy commander</h3>
        {ai && (
          <span class="dim small right" title={`${ai.model}`}>
            AI used: {ai.calls} calls · {fmtTok(ai.inputTokens + ai.outputTokens)} tokens
          </span>
        )}
      </div>
      <div class="grid2">
        <div class="col" style={{ gap: 8 }}>
          <h4>Mentor’s coaching</h4>
          {ai?.mentor ? (
            <div class="ai-mentor">{ai.mentor}</div>
          ) : (
            <div class="col" style={{ gap: 8, alignItems: 'flex-start' }}>
              <div class="muted small">A senior DS view of your battle in under 200 words, tied to ICIB principles. Sent: result, key events, decisions and the biggest rubric gaps (no names).</div>
              <button class="btn olive" disabled={!canAsk || busy} onClick={ask} title={canAsk ? '' : 'Set an API key and enable the mentor in AI settings'}>
                {busy ? 'The mentor is reading your AAR…' : '🎓 Ask the AI mentor'}
              </button>
            </div>
          )}
        </div>
        <div class="col" style={{ gap: 8 }}>
          <h4>What the enemy commander decided</h4>
          {enCdr.length ? (
            <div class="log ai-events">
              {enCdr.map((x) => (
                <div class="e warn">
                  <span class="t">{fmtTime(x.time, false).replace(' hrs', '')}</span>
                  {x.text}
                </div>
              ))}
            </div>
          ) : (
            <div class="muted small">{ai ? 'The built-in commander made every enemy decision in this battle.' : 'The AI enemy commander was not used in this battle.'}</div>
          )}
          {radio.length > 0 && (
            <details>
              <summary class="small muted">Radio messages interpreted by the AI ({radio.length})</summary>
              <div class="log ai-events">
                {radio.map((x) => (
                  <div class="e">
                    <span class="t">{fmtTime(x.time, false).replace(' hrs', '')}</span>
                    {x.text}
                  </div>
                ))}
              </div>
            </details>
          )}
        </div>
      </div>
    </div>
  );
}

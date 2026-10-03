import { useEffect, useRef, useState } from 'preact/hooks';
import { fmtTime } from '../../core/time';
import type { Engine } from '../../sim/engine';
import type { BattleAi } from '../battle';
import { radioMessage } from '../radio';
import { useBattleTick } from './hooks';

interface Line {
  id: number;
  t: number;
  from: 'YOU' | 'NET';
  who: string;
  text: string;
  src?: 'LOCAL' | 'AI' | 'NONE';
}

const QUICK = ['Sitrep', 'SOS', 'Fire DF 1', '1 Pl move to altn posn'];

/** Free-text radio net: orders and queries to subordinates, supporting arms and higher HQ. */
export function RadioNet(p: { e: Engine; ai: BattleAi | null; selContactId?: string; onChange: () => void }) {
  const [lines, setLines] = useState<Line[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const seq = useRef(0);
  useBattleTick(p.ai);
  useEffect(() => {
    if (box.current) box.current.scrollTop = box.current.scrollHeight;
  }, [lines.length, busy]);

  const send = async (msg: string) => {
    const m = msg.trim();
    if (!m || busy || p.e.over) return;
    const t = p.e.t;
    setLines((l) => [...l, { id: ++seq.current, t, from: 'YOU', who: 'You', text: m }]);
    setText('');
    setBusy(true);
    try {
      const r = await radioMessage(p.e, m, { battle: p.ai?.battle, selContactId: p.selContactId });
      setLines((l) => [...l, { id: ++seq.current, t: p.e.t, from: 'NET', who: r.who, text: r.text, src: r.src }]);
    } finally {
      setBusy(false);
      p.onChange();
    }
  };

  const aiOn = !!p.ai?.battle.enabled('radio');
  return (
    <div class="sect col radio-net" style={{ gap: 6 }}>
      <div class="row">
        <h4 style={{ margin: 0 }}>Radio net</h4>
        <span class="dim small right" title={aiOn ? 'Messages the built-in parser cannot read go to Claude' : 'Built-in parser (offline)'}>
          {aiOn ? 'parser + Claude' : 'offline parser'}
        </span>
      </div>
      <div class="radio-lines" ref={box}>
        {!lines.length && <div class="dim small">Send orders in your own words, e.g. “fire DF 3”, “SOS”, “2 Pl move to altn posn”, “QC to 15 r”, “3 Pl C attk 15 r”, “sitrep 1 Pl”.</div>}
        {lines.map((l) => (
          <div class={`rl ${l.from === 'YOU' ? 'you' : 'net'}`} key={l.id}>
            <span class="t">{fmtTime(l.t, false).replace(' hrs', '')}</span>
            <b>{l.who}:</b> {l.text}
            {l.src === 'AI' && <span class="ai-tag" title="Interpreted by Claude">AI</span>}
          </div>
        ))}
        {busy && <div class="rl net dim">… stand by …</div>}
      </div>
      <form
        class="row"
        style={{ gap: 6 }}
        onSubmit={(ev) => {
          ev.preventDefault();
          void send(text);
        }}
      >
        <input class="grow" type="text" value={text} placeholder="Send on the net…" disabled={p.e.over} onInput={(ev) => setText(ev.currentTarget.value)} aria-label="Radio message" />
        <button class="btn small primary" type="submit" disabled={busy || !text.trim() || p.e.over}>
          Send
        </button>
      </form>
      <div class="row wrap" style={{ gap: 4 }}>
        {QUICK.map((q) => (
          <button class="btn small ghost chip" disabled={busy || p.e.over} onClick={() => void send(q)}>
            {q}
          </button>
        ))}
      </div>
    </div>
  );
}

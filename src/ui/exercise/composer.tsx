// Response composer: a library of actions grouped Fire / Manoeuvre / Obstacles & protection /
// C2 & reporting / Logistics & cas, with parameters where relevant, plus a free-text box for the
// student's own words. Used by the contingency plan, the student's own contingencies and the
// decision card in the wargame. Never forces a single choice.

import { ACTION_CATS, ACTIONS, type ActionCat, inferActions } from '../../plan/contingency';

export interface ComposerAction {
  id: string;
  cat: ActionCat;
  text: string;
  param?: 'UNIT' | 'DELAY' | 'DF';
}

export interface ComposerProps {
  actions: ComposerAction[];
  selected: string[];
  onChange: (sel: string[]) => void;
  readOnly?: boolean;
  /** Pre-planned actions (marked "plan" in the decision card). */
  planned?: string[];
  text?: string;
  onText?: (t: string) => void;
  textLabel?: string;
  textPlaceholder?: string;
  unitChoices?: { id: string; label: string }[];
  unitId?: string;
  onUnit?: (id: string) => void;
  unitLabel?: string;
  delay?: number;
  onDelay?: (m: number) => void;
  dfChoices?: { id: string; label: string }[];
  dfId?: string;
  onDf?: (id: string) => void;
  /** Two columns of categories (wide cards / modal). */
  columns?: 1 | 2;
}

export function actionsFor(ids: string[], textFor?: (id: string) => string): ComposerAction[] {
  return ids.filter((id) => ACTIONS[id]).map((id) => ({ id, cat: ACTIONS[id].cat, text: textFor ? textFor(id) : ACTIONS[id].text, param: ACTIONS[id].param }));
}

export function Composer(p: ComposerProps) {
  const sel = new Set(p.selected);
  const toggle = (id: string, on: boolean) => {
    const next = p.selected.filter((x) => x !== id);
    if (on) next.push(id);
    p.onChange(next);
  };
  const understood = p.text ? inferActions(p.text, p.actions.map((a) => a.id)).filter((a) => !sel.has(a)) : [];
  const cats = ACTION_CATS.filter((c) => p.actions.some((a) => a.cat === c.id));
  return (
    <div class="composer">
      <div class={`cmp-cats ${p.columns === 2 ? 'two' : ''}`}>
        {cats.map((c) => (
          <div class={`cmp-cat cat-${c.id}`} key={c.id}>
            <div class="cmp-h">
              <span class="ic">{c.icon}</span>
              {c.label}
              <span class="n">{p.actions.filter((a) => a.cat === c.id && sel.has(a.id)).length || ''}</span>
            </div>
            {p.actions
              .filter((a) => a.cat === c.id)
              .map((a) => {
                const on = sel.has(a.id);
                return (
                  <div class={`cmp-act ${on ? 'on' : ''}`} key={a.id}>
                    <label>
                      <input type="checkbox" disabled={p.readOnly} checked={on} onChange={(e) => toggle(a.id, e.currentTarget.checked)} />
                      <span class="t">{a.text}</span>
                      {p.planned?.includes(a.id) && <span class="badge b-blue pp">plan</span>}
                    </label>
                    {on && a.param === 'UNIT' && p.unitChoices && p.onUnit && (
                      <select class="cmp-param" disabled={p.readOnly} value={p.unitId ?? ''} onChange={(e) => p.onUnit!(e.currentTarget.value)}>
                        <option value="">{p.unitLabel ?? 'Force'}: auto (nearest suitable)</option>
                        {p.unitChoices.map((u) => (
                          <option value={u.id}>{u.label}</option>
                        ))}
                      </select>
                    )}
                    {on && a.param === 'UNIT' && p.onDelay && a.id === 'LOCAL_CATK' && (
                      <label class="cmp-param inline">
                        Launch in
                        <input type="number" min={0} max={120} disabled={p.readOnly} value={p.delay ?? 15} onInput={(e) => p.onDelay!(Number(e.currentTarget.value))} />
                        min
                      </label>
                    )}
                    {on && a.param === 'DF' && p.dfChoices && p.onDf && (
                      <select class="cmp-param" disabled={p.readOnly} value={p.dfId ?? ''} onChange={(e) => p.onDf!(e.currentTarget.value)}>
                        <option value="">DF: nearest pre-selected / adjusted fire</option>
                        {p.dfChoices.map((d) => (
                          <option value={d.id}>{d.label}</option>
                        ))}
                      </select>
                    )}
                  </div>
                );
              })}
          </div>
        ))}
      </div>
      {p.onText && (
        <div class="cmp-text">
          <label class="field">
            {p.textLabel ?? 'Your plan in your own words (optional)'}
            <textarea rows={3} disabled={p.readOnly} placeholder={p.textPlaceholder ?? 'e.g. Call DF on the FAA at once, keep the QC over it, warn the pls to stand to and inform Bn HQ…'} value={p.text ?? ''} onInput={(e) => p.onText!(e.currentTarget.value)} />
          </label>
          {understood.length > 0 && (
            <div class="cmp-understood">
              <span class="dim small">Also understood from your words:</span>
              {understood.map((a) => (
                <span class="chip" key={a} title={ACTIONS[a]?.text}>
                  {p.actions.find((x) => x.id === a)?.text.split(' — ')[0] ?? a}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

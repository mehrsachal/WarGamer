import { useState } from 'preact/hooks';
import { uid } from '../../core/rng';
import type { ContingencyChoice, CustomContingency } from '../../core/types';
import { CONTINGENCIES, TRIGGERS, actionText, actionsForTrigger, choiceActions, choicePlanned, findContingencyDef, setChoiceActions } from '../../plan/contingency';
import { actionsFor, Composer } from './composer';
import type { StepProps } from './flow';

export function Contingencies(p: StepProps) {
  const { s, attempt, readOnly } = p;
  const plan = attempt.plan;
  const defs = CONTINGENCIES.filter((d) => d.levels.includes(s.level));
  const [open, setOpen] = useState<string | null>(null);
  const set = (key: string, fn: (c: ContingencyChoice) => ContingencyChoice | void) =>
    p.update((a) => {
      const c = a.plan.contingency[key] ?? { option: '' };
      const n = fn(c) ?? c;
      a.plan.contingency[key] = n;
    });
  const setCustom = (id: string, fn: (c: CustomContingency) => void) =>
    p.update((a) => {
      const c = a.plan.customContingencies?.find((x) => x.id === id);
      if (c) fn(c);
    });
  const inf = plan.units.filter((u) => ['RIFLE_PL', 'RIFLE_SEC', 'RIFLE_COY', 'INF_BN', 'SCREEN_PL', 'TK_SQN'].includes(u.templateKey));
  const dfChoices = plan.graphics.filter((g) => g.kind === 'DF').map((g) => ({ id: g.id, label: `${g.props.label ?? 'DF'}${g.props.text ? ` — ${g.props.text}` : ''}${g.props.sos ? ' (SOS)' : ''}` }));
  const planned = defs.filter((d) => choicePlanned(plan.contingency[d.key])).length;
  const customs = plan.customContingencies ?? [];
  return (
    <div class="page">
      <div class="row" style={{ marginBottom: 6, alignItems: 'flex-end' }}>
        <div class="grow">
          <h1>Contingency plan</h1>
          <div class="muted">
            Decide now how you will react. Compose each response from the actions that fit — fire, manoeuvre, protection, C2 and admin — and add your own words if you like.
            Several different responses can be sound; each is marked on its doctrinal merit, with partial credit. During the wargame these situations arise as injects and your plan is pre-loaded; you may change it then.
          </div>
        </div>
        <div class="cont-progress">
          <b>{planned}</b>/{defs.length} planned
          <div class="bar" style={{ marginTop: 6 }}>
            <i style={{ width: `${(100 * planned) / Math.max(1, defs.length)}%` }} />
          </div>
        </div>
      </div>
      <div class="cont-grid" style={{ marginTop: 14 }}>
        {defs.map((d) => {
          const c = plan.contingency[d.key];
          const acts = choiceActions(d.key, c);
          const isOpen = open === d.key || (open === null && !choicePlanned(c) && defs.find((x) => !choicePlanned(plan.contingency[x.key]))?.key === d.key);
          return (
            <div class={`card cont-card ${isOpen ? 'open' : ''}`} key={d.key}>
              <div class="card-h clickable" onClick={() => setOpen(isOpen ? '' : d.key)}>
                <span class={`cont-dot ${choicePlanned(c) ? 'ok' : ''}`} />
                <h3>{d.title}</h3>
                <span class="right dim small">{d.ref}</span>
                <span class="chev">{isOpen ? '▾' : '▸'}</span>
              </div>
              <div class="muted">{d.situation}</div>
              {!isOpen && (
                <div class="cont-summary">
                  {acts.length ? acts.map((a) => <span class="chip">{actionText(a, d.key).split(' — ')[0].split(' (')[0]}</span>) : c?.text?.trim() ? <span class="dim small">“{c.text.trim().slice(0, 120)}”</span> : <span class="dim small">Not planned yet — click to compose.</span>}
                </div>
              )}
              {isOpen && (
                <>
                  {d.options.length > 0 && !d.multi && !readOnly && (
                    <div class="row wrap quick" style={{ gap: 6, margin: '10px 0 4px' }}>
                      <span class="dim small">Start from:</span>
                      {d.options.map((o) => (
                        <button class="btn small ghost" title={o.text} onClick={() => set(d.key, (x) => setChoiceActions(d.key, x, d.legacy[o.id] ?? []))}>
                          {o.text.split(/[;,(]/)[0].slice(0, 46)}
                        </button>
                      ))}
                    </div>
                  )}
                  <Composer
                    actions={actionsFor(d.actions, (id) => actionText(id, d.key))}
                    selected={acts}
                    readOnly={readOnly}
                    columns={2}
                    onChange={(sel) => set(d.key, (x) => setChoiceActions(d.key, x, sel))}
                    text={c?.text ?? ''}
                    onText={(t) => set(d.key, (x) => void (x.text = t))}
                    unitChoices={d.needsUnit ? inf.map((u) => ({ id: u.id, label: `${u.label} (${u.role.toLowerCase()})` })) : undefined}
                    unitLabel={d.needsUnit === 'CATK_FORCE' ? 'C attk force' : 'Spoiling force'}
                    unitId={c?.unitId}
                    onUnit={(id) => set(d.key, (x) => void (x.unitId = id || undefined))}
                    delay={c?.delayMin ?? 15}
                    onDelay={d.needsDelay ? (m) => set(d.key, (x) => void (x.delayMin = m)) : undefined}
                    dfChoices={dfChoices}
                    dfId={c?.dfId}
                    onDf={(id) => set(d.key, (x) => void (x.dfId = id || undefined))}
                  />
                  {d.multi && <div class="dim small" style={{ marginTop: 6 }}>Select all that apply — some listed actions are unsound.</div>}
                </>
              )}
            </div>
          );
        })}
      </div>

      <div class="row" style={{ marginTop: 22, alignItems: 'flex-end' }}>
        <div class="grow">
          <h2 style={{ margin: 0 }}>Your own contingencies</h2>
          <div class="muted small">
            Anticipate other situations (en arty on a locality, comms lost, a gap on a flank, CHQ hit, cas evac, amn, EW, UAV, civilians … or anything else). If one of them arises in the battle, your plan is pre-loaded. Marked on relevance and soundness (modest weight).
          </div>
        </div>
        {!readOnly && (
          <button
            class="btn"
            onClick={() => {
              const id = uid('cc');
              p.update((a) => {
                a.plan.customContingencies = [...(a.plan.customContingencies ?? []), { id, trigger: 'EN_ARTY', situation: '', actions: [], text: '' }];
              });
              setOpen(id);
            }}
          >
            + Add a contingency
          </button>
        )}
      </div>
      <div class="cont-grid" style={{ marginTop: 12 }}>
        {customs.map((c) => {
          const d = findContingencyDef(c.trigger);
          const isOpen = open === c.id;
          return (
            <div class={`card cont-card custom ${isOpen ? 'open' : ''}`} key={c.id}>
              <div class="card-h clickable" onClick={() => setOpen(isOpen ? '' : c.id)}>
                <span class={`cont-dot ${c.actions.length || c.text.trim() ? 'ok' : ''}`} />
                <h3>{d?.title ?? 'Own situation'}</h3>
                <span class="right chev">{isOpen ? '▾' : '▸'}</span>
                {!readOnly && (
                  <button
                    class="btn small ghost"
                    title="Remove"
                    onClick={(e) => {
                      e.stopPropagation();
                      p.update((a) => (a.plan.customContingencies = (a.plan.customContingencies ?? []).filter((x) => x.id !== c.id)));
                    }}
                  >
                    ✕
                  </button>
                )}
              </div>
              {!isOpen ? (
                <div class="cont-summary">
                  <span class="dim small">{c.situation.trim() ? `“${c.situation.trim().slice(0, 110)}”` : d?.situation}</span>
                  {c.actions.map((a) => (
                    <span class="chip">{actionText(a, c.trigger).split(' — ')[0].split(' (')[0]}</span>
                  ))}
                </div>
              ) : (
                <>
                  <div class="grid2" style={{ marginTop: 8 }}>
                    <label class="field">
                      Trigger
                      <select disabled={readOnly} value={c.trigger} onChange={(e) => setCustom(c.id, (x) => ((x.trigger = e.currentTarget.value), (x.actions = x.actions.filter((a) => actionsForTrigger(x.trigger).includes(a)))))}>
                        {TRIGGERS.map((t) => (
                          <option value={t.key}>
                            {t.title}
                            {CONTINGENCIES.some((k) => k.key === t.key) ? ' (also in the plan above)' : ''}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label class="field">
                      Situation (your words)
                      <input type="text" disabled={readOnly} placeholder={d?.situation ?? 'What happens, where, when?'} value={c.situation} onInput={(e) => setCustom(c.id, (x) => (x.situation = e.currentTarget.value))} />
                    </label>
                  </div>
                  <div style={{ marginTop: 10 }}>
                    <Composer
                      actions={actionsFor(actionsForTrigger(c.trigger), (id) => actionText(id, c.trigger))}
                      selected={c.actions}
                      readOnly={readOnly}
                      columns={2}
                      onChange={(sel) => setCustom(c.id, (x) => (x.actions = sel))}
                      text={c.text}
                      onText={(t) => setCustom(c.id, (x) => (x.text = t))}
                    />
                  </div>
                </>
              )}
            </div>
          );
        })}
        {!customs.length && <div class="muted small" style={{ padding: '6px 2px' }}>None yet — optional.</div>}
      </div>

      <div class="row" style={{ marginTop: 16 }}>
        <button class="btn" onClick={() => p.go('plan')}>
          ← Plan
        </button>
        <button class="btn primary right" onClick={() => p.go('submit')}>
          Review &amp; submit →
        </button>
      </div>
    </div>
  );
}

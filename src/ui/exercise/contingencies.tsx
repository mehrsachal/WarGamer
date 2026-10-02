import type { ContingencyChoice } from '../../core/types';
import { CONTINGENCIES, REORG_CORRECT } from '../../plan/contingency';
import type { StepProps } from './flow';

export function Contingencies(p: StepProps) {
  const { s, attempt, readOnly } = p;
  const plan = attempt.plan;
  const defs = CONTINGENCIES.filter((d) => d.levels.includes(s.level));
  const set = (key: string, fn: (c: ContingencyChoice) => void) =>
    p.update((a) => {
      const c = a.plan.contingency[key] ?? { option: '' };
      fn(c);
      a.plan.contingency[key] = c;
    });
  const inf = plan.units.filter((u) => ['RIFLE_PL', 'RIFLE_SEC', 'RIFLE_COY', 'INF_BN', 'SCREEN_PL', 'TK_SQN'].includes(u.templateKey));
  return (
    <div class="page">
      <div class="row" style={{ marginBottom: 6 }}>
        <div>
          <h1>Contingency plan</h1>
          <div class="muted">
            Decide now how you will react. During the wargame these situations arise as injects; your choice here is pre-selected and you may confirm or change it.
            Both your pre-planned and your actual decisions are marked against the situation.
          </div>
        </div>
      </div>
      <div class="grid2" style={{ marginTop: 14 }}>
        {defs.map((d) => {
          const c = plan.contingency[d.key];
          const multi = d.multi;
          const sel = multi ? (c?.option ?? '').split(',').filter(Boolean) : [c?.option ?? ''];
          return (
            <div class="card" key={d.key}>
              <div class="card-h">
                <h3>{d.title}</h3>
                <span class="right dim small">{d.ref}</span>
              </div>
              <div class="muted" style={{ marginBottom: 10 }}>
                {d.situation}
              </div>
              {d.options.map((o) => (
                <label class="check" key={o.id}>
                  <input
                    type={multi ? 'checkbox' : 'radio'}
                    name={d.key}
                    disabled={readOnly}
                    checked={sel.includes(o.id)}
                    onChange={(e) =>
                      set(d.key, (x) => {
                        if (multi) {
                          const cur = new Set((x.option ?? '').split(',').filter(Boolean));
                          if (e.currentTarget.checked) cur.add(o.id);
                          else cur.delete(o.id);
                          x.option = [...cur].join(',');
                        } else x.option = o.id;
                      })
                    }
                  />
                  <span>{o.text}</span>
                </label>
              ))}
              {d.needsUnit && (
                <label class="field" style={{ marginTop: 8 }}>
                  {d.needsUnit === 'CATK_FORCE' ? 'C attk force' : 'Spoiling force'}
                  <select disabled={readOnly} value={c?.unitId ?? ''} onChange={(e) => set(d.key, (x) => (x.unitId = e.currentTarget.value || undefined))}>
                    <option value="">— auto (nearest suitable) —</option>
                    {inf.map((u) => (
                      <option value={u.id}>
                        {u.label} ({u.role.toLowerCase()})
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {d.needsDelay && (
                <label class="field" style={{ marginTop: 8 }}>
                  Time to launch the C attk after the loss (min)
                  <input disabled={readOnly} type="number" min={0} max={120} value={c?.delayMin ?? 15} onInput={(e) => set(d.key, (x) => (x.delayMin = Number(e.currentTarget.value)))} />
                </label>
              )}
              {multi && <div class="dim small" style={{ marginTop: 6 }}>Select all that apply ({REORG_CORRECT.length} sound actions exist; some options are wrong).</div>}
            </div>
          );
        })}
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

import { useMemo, useState } from 'preact/hooks';
import { DOCTRINE, WORK_ITEMS } from '../../core/doctrine';
import { centroid, pointInPolygon } from '../../core/geom';
import { hashString } from '../../core/rng';
import type { Appreciation as Aprc } from '../../core/types';
import { workload } from '../../plan/plan';
import { MapView } from '../mapView';
import { aorBox, planUnits } from '../scene';
import type { StepProps } from './flow';

const TEXT_FIELDS: { key: string; label: string; ph: string }[] = [
  { key: 'aim', label: 'Aim', ph: 'To take up def within the given bdrys with fol limitations …' },
  { key: 'ground', label: 'Gr & weather — deductions', ph: 'Apchs (definition, length, dominating features, tfc, obs, capacity, mutual sp, dir keeping, depl areas, F of F, cover, significance)…' },
  { key: 'enemy', label: 'En sit — options aval to en (APs)', ph: 'AP-1: En will cross the bdry at first lt … attk in two phs after last lt using the … apch, FAA …, FUP …, BOF …' },
  { key: 'own', label: 'Own sit — str related to en, tps to task', ph: 'Inf (pls) 3 : 12 (1:4) … Almt of tps to task …' },
  { key: 'timeSpace', label: 'Time & space — deductions', ph: 'Pri of work; activities done concurrently; essential timings …' },
  { key: 'courses', label: 'Courses (A / B) — analysis', ph: 'Course A: … En reactions and own ctr actions … Advantages / disadvantages …' },
  { key: 'plan', label: 'Plan (outline)', ph: 'Def will be taken with two pls up …' },
];

function moveIn<T>(arr: T[], i: number, d: number): T[] {
  const a = [...arr];
  const j = i + d;
  if (j < 0 || j >= a.length) return a;
  [a[i], a[j]] = [a[j], a[i]];
  return a;
}

function OrderList(p: { items: { id: string; label: string }[]; order: string[]; onChange: (o: string[]) => void; readOnly: boolean; pick?: boolean; max?: number }) {
  const chosen = p.order.filter((id) => p.items.some((i) => i.id === id));
  const rest = p.items.filter((i) => !chosen.includes(i.id));
  const label = (id: string) => p.items.find((i) => i.id === id)?.label ?? id;
  return (
    <div class="col" style={{ gap: 8 }}>
      <div class="pill-list">
        {chosen.map((id, i) => (
          <div class="it" key={id}>
            <span class="num">{i + 1}</span>
            <span class="grow">{label(id)}</span>
            {!p.readOnly && (
              <>
                <button class="btn small ghost" title="Up" onClick={() => p.onChange(moveIn(chosen, i, -1))}>
                  ▲
                </button>
                <button class="btn small ghost" title="Down" onClick={() => p.onChange(moveIn(chosen, i, 1))}>
                  ▼
                </button>
                {p.pick && (
                  <button class="btn small ghost" title="Remove" onClick={() => p.onChange(chosen.filter((x) => x !== id))}>
                    ✕
                  </button>
                )}
              </>
            )}
          </div>
        ))}
        {!chosen.length && <div class="muted small">Nothing selected yet.</div>}
      </div>
      {p.pick && !p.readOnly && rest.length > 0 && (!p.max || chosen.length < p.max) && (
        <div class="row wrap" style={{ gap: 6 }}>
          {rest.map((r) => (
            <button key={r.id} class="btn small" onClick={() => p.onChange([...chosen, r.id])}>
              + {r.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function Appreciation(p: StepProps) {
  const { s, attempt, readOnly } = p;
  const a = attempt.plan.appreciation;
  const set = (fn: (x: Aprc) => void) => p.update((at) => fn(at.plan.appreciation));
  const [hi, setHi] = useState<string>('');

  const apchItems = s.ds.approaches.map((x) => ({ id: x.id, label: x.name }));
  // initialise approach and line lists (unordered, neutral) so the student orders them
  const lineItems = s.ds.linesOfDef.map((l) => ({ id: l.id, label: l.name }));
  const itgItems = useMemo(() => {
    const ds = s.ds.itgs.map((i) => ({ id: i.id, label: i.name }));
    const extra: { id: string; label: string }[] = [];
    for (const f of s.terrain.features) {
      if (!f.name || ds.some((d) => d.label === f.name)) continue;
      const pos = f.kind === 'height' || f.kind === 'kbund' ? f.c : f.kind === 'bua' || f.kind === 'trees' || f.kind === 'broken' ? centroid(f.poly) : null;
      if (pos && pointInPolygon(pos, s.own.aor) && !extra.some((e) => e.label === f.name)) extra.push({ id: `feat:${f.id}`, label: f.name });
    }
    return [...ds, ...extra].sort((x, y) => x.label.localeCompare(y.label));
  }, [s.id]);
  const powItems = Object.entries(WORK_ITEMS).map(([id, w]) => ({ id, label: w.label }));
  const powOrder = a.priorityOfWork.length ? a.priorityOfWork : [...DOCTRINE.priorityOfWork].sort((x, y) => (hashString(attempt.id + x) % 97) - (hashString(attempt.id + y) % 97));
  const apOrder = a.approachOrder.length ? a.approachOrder : [];
  const wl = workload(s, attempt.plan);

  const neutral = {
    arrows: s.ds.approaches.map((x) => ({ pts: x.path, label: x.name, hi: hi === x.id })),
    lines: s.ds.linesOfDef.map((l) => ({ pts: l.pts, label: l.name.split(':')[0], hi: hi === l.id || a.fdlLine === l.id })),
  };
  return (
    <div class="workspace" style={{ height: '100%' }}>
      <div class="side" style={{ width: 'min(640px, 50vw)' }}>
        <div class="sect">
          <h2>Appreciation of the situation</h2>
          <div class="muted small">Record your deductions. The ordered selections are marked objectively against the DS; the written parts are for your instructor.</div>
        </div>
        <div class="sect">
          <h3>Pri of apchs</h3>
          <div class="muted small" style={{ marginBottom: 8 }}>
            Order all apchs (most likely first). Hover/click on a name to see it on the map.
          </div>
          <OrderList items={apchItems} order={apOrder} pick readOnly={readOnly} onChange={(o) => set((x) => (x.approachOrder = o))} />
          <div class="row wrap" style={{ marginTop: 8 }}>
            {apchItems.map((it) => (
              <button class={`btn small ${hi === it.id ? 'active' : ''}`} onMouseEnter={() => setHi(it.id)} onClick={() => setHi(it.id)}>
                👁 {it.label}
              </button>
            ))}
          </div>
          <div class="grid2" style={{ marginTop: 10 }}>
            <label class="field">
              En most likely apch (AP-1)
              <select disabled={readOnly} value={a.enMostLikelyApproach} onChange={(e) => set((x) => (x.enMostLikelyApproach = e.currentTarget.value))}>
                <option value="">—</option>
                {apchItems.map((i) => (
                  <option value={i.id}>{i.label}</option>
                ))}
              </select>
            </label>
            <label class="field">
              Bias of def / A tk def
              <select disabled={readOnly} value={a.bias} onChange={(e) => set((x) => (x.bias = e.currentTarget.value as Aprc['bias']))}>
                <option value="">—</option>
                <option value="L">Left</option>
                <option value="C">Centre</option>
                <option value="R">Right</option>
              </select>
            </label>
          </div>
        </div>
        <div class="sect">
          <h3>Pri of ITGs</h3>
          <div class="muted small" style={{ marginBottom: 8 }}>
            Select and order the important tactical gr (at least the top 3).
          </div>
          <OrderList items={itgItems} order={a.itgOrder} pick max={8} readOnly={readOnly} onChange={(o) => set((x) => (x.itgOrder = o))} />
        </div>
        <div class="sect">
          <h3>Lines of def</h3>
          <OrderList items={lineItems} order={a.lineOrder} pick readOnly={readOnly} onChange={(o) => set((x) => (x.lineOrder = o))} />
          <div class="grid2" style={{ marginTop: 10 }}>
            <label class="field">
              FDLs on
              <select disabled={readOnly} value={a.fdlLine} onChange={(e) => set((x) => (x.fdlLine = e.currentTarget.value))}>
                <option value="">—</option>
                {lineItems.map((i) => (
                  <option value={i.id}>{i.label}</option>
                ))}
              </select>
            </label>
            <label class="field">
              Depth on
              <select disabled={readOnly} value={a.depthLine} onChange={(e) => set((x) => (x.depthLine = e.currentTarget.value))}>
                <option value="">—</option>
                {lineItems.map((i) => (
                  <option value={i.id}>{i.label}</option>
                ))}
              </select>
            </label>
          </div>
        </div>
        <div class="sect">
          <h3>Pri of work</h3>
          <OrderList items={powItems} order={powOrder} readOnly={readOnly} onChange={(o) => set((x) => (x.priorityOfWork = o))} />
          {!a.priorityOfWork.length && !readOnly && (
            <button class="btn small" style={{ marginTop: 8 }} onClick={() => set((x) => (x.priorityOfWork = powOrder))}>
              Confirm this order
            </button>
          )}
        </div>
        <div class="sect">
          <h3>Time &amp; space (from your plan)</h3>
          <table class="tbl">
            <tbody>
              {wl.items.map((i) => (
                <tr>
                  <td>{i.label}</td>
                  <td style={{ textAlign: 'right' }}>{i.hrs.toFixed(1)} hrs</td>
                </tr>
              ))}
              <tr>
                <td>
                  <b>Required (critical path)</b>
                </td>
                <td style={{ textAlign: 'right' }}>
                  <b>{wl.required.toFixed(1)} hrs</b>
                </td>
              </tr>
              <tr>
                <td>Aval ({Math.round(wl.availDay)} day + {Math.round(wl.availNight)} ni)</td>
                <td style={{ textAlign: 'right' }}>{wl.available.toFixed(1)} hrs</td>
              </tr>
            </tbody>
          </table>
          <div class={`bar ${wl.readiness >= 1 ? 'g' : wl.readiness > 0.8 ? 'a' : 'r'}`} style={{ marginTop: 8 }}>
            <i style={{ width: `${Math.round(wl.readiness * 100)}%` }} />
          </div>
          <div class="muted small" style={{ marginTop: 4 }}>
            Def {Math.round(wl.readiness * 100)}% ready by {`the given time`} — affects how well dug-in your tps are in the wargame.
          </div>
        </div>
        {TEXT_FIELDS.map((f) => (
          <div class="sect" key={f.key}>
            <h4>{f.label}</h4>
            <textarea disabled={readOnly} rows={f.key === 'aim' ? 2 : 4} placeholder={f.ph} value={a.text[f.key] ?? ''} onInput={(e) => set((x) => (x.text[f.key] = e.currentTarget.value))} />
          </div>
        ))}
        <div class="sect row">
          <button class="btn" onClick={() => p.go('brief')}>
            ← Briefing
          </button>
          <button class="btn primary right" onClick={() => p.go('plan')}>
            Next: Mark the plan →
          </button>
        </div>
      </div>
      <MapView scenario={s} scene={{ units: planUnits(attempt.plan), graphics: attempt.plan.graphics, neutral }} fit={aorBox(s)} />
    </div>
  );
}

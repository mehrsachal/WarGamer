import { useEffect, useState } from 'preact/hooks';
import { assessPlan } from '../../assess/plan';
import type { Scenario } from '../../core/types';
import { autoPlan } from '../../plan/plan';
import { LEVEL_NAMES, TERRAIN_NAMES } from '../../scenario/generator';
import { db } from '../../store/db';
import { cacheScenario, getScenario, startAttempt } from '../data';
import { Badge, nav, toast } from '../kit';
import { MapView } from '../mapView';
import { aorBox, planScene } from '../scene';

export function ScenarioView(p: { id: string }) {
  const [s, setS] = useState<Scenario>();
  const [ds, setDs] = useState(true);
  const [showPlan, setShowPlan] = useState(false);
  const [edit, setEdit] = useState(false);
  useEffect(() => void getScenario(p.id).then(setS), [p.id]);
  if (!s) return <div class="page muted">Loading scenario…</div>;
  const plan = showPlan ? autoPlan(s) : null;
  const save = async (next: Scenario) => {
    await db.put('scenarios', next);
    cacheScenario(next);
    setS(next);
    toast('Scenario saved.', 'ok');
  };
  const demo = async () => {
    const all = await db.all('attempts');
    const ex = all.find((a) => a.exerciseId === `demo_${s.id}` && a.status !== 'COMPLETE');
    const a = ex ?? (await startAttempt(`demo_${s.id}`, s.id, 'instructor'));
    nav(`ex/${a.id}/brief`);
  };
  return (
    <div class="workspace" style={{ height: '100%' }}>
      <div class="side" style={{ width: 'min(560px, 44vw)' }}>
        <div class="sect">
          <button class="btn small" onClick={() => nav('instructor/scenarios')}>
            ← Scenarios
          </button>
          <h1 style={{ marginTop: 10 }}>{s.title}</h1>
          <div class="muted">{s.subtitle}</div>
          <div class="row wrap" style={{ marginTop: 8 }}>
            <Badge kind="blue">{LEVEL_NAMES[s.level]}</Badge>
            <Badge>{TERRAIN_NAMES[s.terrain.type]}</Badge>
            <Badge>seed {s.seed}</Badge>
          </div>
          <div class="row wrap" style={{ marginTop: 12 }}>
            <button class="btn primary" onClick={demo}>
              ▶ Try (demo run)
            </button>
            <button class="btn" onClick={() => setEdit(!edit)}>
              {edit ? 'Done editing' : '✎ Edit narrative'}
            </button>
            <button class="btn" onClick={() => nav('instructor/exercises')}>
              Use in an exercise →
            </button>
          </div>
        </div>
        <div class="sect">
          <h3>DS solution (hidden from students until the debrief)</h3>
          <ul style={{ paddingLeft: 18, lineHeight: 1.55 }}>
            {s.ds.notes.map((n) => (
              <li>{n}</li>
            ))}
          </ul>
          <label class="check">
            <input type="checkbox" checked={ds} onChange={(e) => setDs(e.currentTarget.checked)} /> Show DS overlay (apchs, ITGs, lines of def, likely FAA / FUP / BOF)
          </label>
          <label class="check">
            <input type="checkbox" checked={showPlan} onChange={(e) => setShowPlan(e.currentTarget.checked)} /> Show auto DS plan {plan ? `(scores ${Math.round(assessPlan(s, plan).pct)}%)` : ''}
          </label>
        </div>
        {s.narrative.map((n, i) => (
          <div class="sect" key={n.key}>
            {edit ? (
              <>
                <input type="text" value={n.title} style={{ width: '100%', marginBottom: 6 }} onChange={(e) => save({ ...s, narrative: s.narrative.map((x, j) => (j === i ? { ...x, title: e.currentTarget.value } : x)) })} />
                <textarea rows={8} value={n.body} onChange={(e) => save({ ...s, narrative: s.narrative.map((x, j) => (j === i ? { ...x, body: e.currentTarget.value } : x)) })} />
              </>
            ) : (
              <>
                <div class="narr-h">{n.title}</div>
                <div class="narr">{n.body}</div>
              </>
            )}
          </div>
        ))}
        <div class="sect">
          <div class="narr-h">Requirement</div>
          {edit ? (
            <textarea rows={6} value={s.requirements.join('\n')} onChange={(e) => save({ ...s, requirements: e.currentTarget.value.split('\n').filter(Boolean) })} />
          ) : (
            <ol class="req">
              {s.requirements.map((r) => (
                <li>{r}</li>
              ))}
            </ol>
          )}
          {edit && (
            <input type="text" style={{ width: '100%', marginTop: 8 }} value={s.title} onChange={(e) => save({ ...s, title: e.currentTarget.value })} />
          )}
        </div>
      </div>
      <MapView scenario={s} scene={plan ? planScene(s, plan, { ds }) : { units: [], graphics: [], ds: ds ? s.ds : null }} fit={aorBox(s)} />
    </div>
  );
}

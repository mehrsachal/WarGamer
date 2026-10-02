// Instructor review of a student's attempt (and the student's read-only view of a completed attempt).
import { useEffect, useState } from 'preact/hooks';
import { finalScore } from '../../assess/wargame';
import type { Attempt, Exercise, Scenario, Student } from '../../core/types';
import { db } from '../../store/db';
import { exerciseOf, getScenario } from '../data';
import { nav, type Session, statusBadge, toast } from '../kit';
import { MapView } from '../mapView';
import { aorBox, planScene } from '../scene';
import { DebriefView, Rubric } from './debrief';

export function AttemptReview(p: { id: string; session: Session }) {
  const [a, setA] = useState<Attempt>();
  const [ex, setEx] = useState<Exercise>();
  const [s, setS] = useState<Scenario>();
  const [st, setSt] = useState<Student>();
  const [remarks, setRemarks] = useState('');
  const [adj, setAdj] = useState(0);
  const [ds, setDs] = useState(false);
  useEffect(() => {
    (async () => {
      const at = await db.get('attempts', p.id);
      if (!at) return;
      setA(at);
      setRemarks(at.remarks ?? '');
      setAdj(at.instructorAdj ?? 0);
      setEx(await exerciseOf(at));
      setS(await getScenario(at.scenarioId));
      setSt(await db.get('students', at.studentId));
    })();
  }, [p.id]);
  if (!a || !ex || !s) return <div class="page muted">Loading…</div>;
  if (p.session.role !== 'INSTRUCTOR' && a.studentId !== p.session.studentId) return <div class="page">Not permitted.</div>;
  const instructor = p.session.role === 'INSTRUCTOR';
  const save = async () => {
    const next = { ...a, remarks, instructorAdj: adj };
    if (a.planAssessment && a.wargame) {
      const f = finalScore(a.planAssessment.pct, a.wargame.assessment.pct, ex.settings.planWeight, adj);
      next.finalPct = f.pct;
      next.grade = f.grade;
    }
    await db.put('attempts', next);
    setA(next);
    toast('Remarks saved.', 'ok');
  };
  const reopen = async () => {
    if (!confirm('Re-open this attempt for planning? The current results will be cleared.')) return;
    const next: Attempt = { ...a, status: 'PLANNING', submittedAt: undefined, completedAt: undefined, wargame: undefined, planAssessment: undefined, finalPct: undefined, grade: undefined };
    await db.put('attempts', next);
    setA(next);
    toast('Attempt re-opened.', 'ok');
  };
  const header = (
    <div class="card noprint" style={{ marginTop: 14 }}>
      <div class="row wrap">
        <div>
          <h2 style={{ margin: 0 }}>{st ? `${st.rank} ${st.name}` : 'Instructor'} </h2>
          <div class="muted">
            {ex.title} · {s.title} · {statusBadge(a.status)}
          </div>
        </div>
        <div class="right row">
          <button class="btn" onClick={() => nav(`ex/${a.id}/plan`)}>
            Open plan
          </button>
          {instructor && (
            <button class="btn danger" onClick={reopen}>
              Re-open
            </button>
          )}
          <button class="btn" onClick={() => history.back()}>
            ← Back
          </button>
        </div>
      </div>
      {instructor && (
        <div class="grid2" style={{ marginTop: 12 }}>
          <label class="field">
            DS remarks (visible to the student)
            <textarea rows={4} value={remarks} onInput={(e) => setRemarks(e.currentTarget.value)} />
          </label>
          <div class="col">
            <label class="field">
              Instructor adjustment to final % (−20 … +20), e.g. for the written aprc
              <input type="number" min={-20} max={20} value={adj} onInput={(e) => setAdj(Number(e.currentTarget.value))} />
            </label>
            <button class="btn primary" onClick={save}>
              Save remarks
            </button>
          </div>
        </div>
      )}
    </div>
  );
  if (a.status !== 'COMPLETE') {
    return (
      <div class="page">
        {header}
        <div class="card" style={{ marginTop: 14, height: 560, display: 'flex', flexDirection: 'column' }}>
          <div class="row" style={{ marginBottom: 8 }}>
            <h3 style={{ margin: 0 }}>Plan as marked</h3>
            {instructor && (
              <label class="check right">
                <input type="checkbox" checked={ds} onChange={(e) => setDs(e.currentTarget.checked)} /> DS overlay
              </label>
            )}
          </div>
          <div style={{ flex: 1, display: 'flex', borderRadius: 10, overflow: 'hidden' }}>
            <MapView scenario={s} scene={planScene(s, a.plan, { ds })} fit={aorBox(s)} />
          </div>
        </div>
        {a.planAssessment && instructor && <Rubric title="Plan — detailed marking" a={a.planAssessment} />}
        <AppreciationText a={a} />
      </div>
    );
  }
  return (
    <div>
      <div class="page" style={{ paddingBottom: 0 }}>{header}</div>
      <DebriefView s={s} attempt={a} ex={ex} extra={<AppreciationText a={a} />} />
    </div>
  );
}

function AppreciationText(p: { a: Attempt }) {
  const t = p.a.plan.appreciation.text;
  const keys = Object.keys(t).filter((k) => t[k]?.trim());
  if (!keys.length) return null;
  const labels: Record<string, string> = { aim: 'Aim', ground: 'Gr & weather', enemy: 'En sit / APs', own: 'Own sit', timeSpace: 'Time & space', courses: 'Courses', plan: 'Plan' };
  return (
    <div class="card" style={{ marginTop: 14 }}>
      <h3>Written appreciation</h3>
      {keys.map((k) => (
        <div style={{ marginBottom: 10 }}>
          <h4>{labels[k] ?? k}</h4>
          <div style={{ whiteSpace: 'pre-wrap' }}>{t[k]}</div>
        </div>
      ))}
    </div>
  );
}

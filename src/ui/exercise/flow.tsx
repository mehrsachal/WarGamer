import { useEffect, useRef, useState } from 'preact/hooks';
import type { Attempt, Exercise, Scenario } from '../../core/types';
import { assessPlan } from '../../assess/plan';
import { autoPlan } from '../../plan/plan';
import { db } from '../../store/db';
import { exerciseOf, getScenario } from '../data';
import { nav, type Session, toast } from '../kit';
import { Appreciation } from './appreciation';
import { Briefing } from './briefing';
import { Contingencies } from './contingencies';
import { Debrief } from './debrief';
import { Planner } from './planner';
import { SubmitStep } from './submit';
import { Wargame } from './wargame';

export interface StepProps {
  s: Scenario;
  attempt: Attempt;
  ex: Exercise;
  update: (fn: (a: Attempt) => void) => void;
  readOnly: boolean;
  session: Session;
  go: (step: string) => void;
}

const STEPS = [
  { id: 'brief', label: 'Briefing' },
  { id: 'aprc', label: 'Appreciation' },
  { id: 'plan', label: 'Plan' },
  { id: 'cont', label: 'Contingencies' },
  { id: 'submit', label: 'Submit' },
  { id: 'war', label: 'Wargame' },
  { id: 'debrief', label: 'Debrief' },
];

export function ExerciseFlow(p: { attemptId: string; step?: string; session: Session }) {
  const [att, setAtt] = useState<Attempt>();
  const [ex, setEx] = useState<Exercise>();
  const [s, setS] = useState<Scenario>();
  const saveT = useRef<number>();
  const latest = useRef<Attempt>();
  useEffect(() => {
    (async () => {
      const a = await db.get('attempts', p.attemptId);
      if (!a) {
        toast('Exercise not found.', 'err');
        return nav('');
      }
      const [e, sc] = await Promise.all([exerciseOf(a), getScenario(a.scenarioId)]);
      if (!sc) {
        toast('Scenario missing from this machine — import the exercise pack.', 'err');
        return nav('');
      }
      latest.current = a;
      setAtt(a);
      setEx(e);
      setS(sc);
    })();
  }, [p.attemptId]);
  useEffect(
    () => () => {
      if (saveT.current && latest.current) {
        clearTimeout(saveT.current);
        void db.put('attempts', latest.current);
      }
    },
    [],
  );
  if (!att || !ex || !s) return <div class="page muted">Loading exercise…</div>;
  const owner = p.session.role === 'INSTRUCTOR' || att.studentId === p.session.studentId;
  const readOnly = !owner || att.status !== 'PLANNING';
  const step = p.step ?? (att.status === 'COMPLETE' ? 'debrief' : att.status === 'SUBMITTED' ? 'war' : 'brief');
  const update = (fn: (a: Attempt) => void) => {
    const next: Attempt = JSON.parse(JSON.stringify(latest.current));
    fn(next);
    next.plan.updatedAt = Date.now();
    latest.current = next;
    setAtt(next);
    clearTimeout(saveT.current);
    saveT.current = window.setTimeout(() => void db.put('attempts', next), 500);
  };
  const go = (st: string) => nav(`ex/${att.id}/${st}`);
  const allowed = (id: string) => {
    if (id === 'war') return att.status !== 'PLANNING';
    if (id === 'debrief') return att.status === 'COMPLETE';
    return true;
  };
  const sp: StepProps = { s, attempt: att, ex, update, readOnly, session: p.session, go };
  const demo = att.exerciseId.startsWith('demo_');
  return (
    <>
      <div class="steps">
        <button class="step" title="Back to dashboard" onClick={() => nav(p.session.role === 'INSTRUCTOR' ? (demo ? `scenario/${s.id}` : 'instructor') : 'student')}>
          ←
        </button>
        {STEPS.map((st, i) => {
          const done = (st.id === 'submit' && att.status !== 'PLANNING') || (st.id === 'war' && att.status === 'COMPLETE');
          return (
            <button key={st.id} class={`step ${st.id === step ? 'on' : ''} ${done ? 'done' : ''}`} disabled={!allowed(st.id)} onClick={() => go(st.id)}>
              <span class="n">{done ? '✓' : i + 1}</span>
              {st.label}
            </button>
          );
        })}
        <div class="right row" style={{ padding: '0 8px', gap: 8 }}>
          <span class="muted small" style={{ whiteSpace: 'nowrap' }}>
            {s.title} · {ex.title}
          </span>
          {demo && att.status === 'PLANNING' && (
            <button
              class="btn small olive"
              title="Fill in the DS solution (appreciation, plan and contingencies)"
              onClick={() => {
                update((a) => {
                  a.plan = autoPlan(s);
                });
                toast(`DS solution loaded (plan score ${Math.round(assessPlan(s, autoPlan(s)).pct)}%).`, 'ok');
              }}
            >
              Load DS solution
            </button>
          )}
          {readOnly && att.status === 'PLANNING' && <span class="badge b-grey">Read only</span>}
        </div>
      </div>
      <div style={{ flex: 1, minHeight: 0, overflow: step === 'plan' || step === 'war' ? 'hidden' : 'auto' }}>
        {step === 'brief' && <Briefing {...sp} />}
        {step === 'aprc' && <Appreciation {...sp} />}
        {step === 'plan' && <Planner {...sp} />}
        {step === 'cont' && <Contingencies {...sp} />}
        {step === 'submit' && <SubmitStep {...sp} />}
        {step === 'war' && <Wargame {...sp} />}
        {step === 'debrief' && <Debrief {...sp} />}
      </div>
    </>
  );
}

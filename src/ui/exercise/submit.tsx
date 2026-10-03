import { useMemo, useState } from 'preact/hooks';
import { applyOverrides, assessPlan, assessPlanAsync } from '../../assess/plan';
import { workload } from '../../plan/plan';
import { CONTINGENCIES, choicePlanned } from '../../plan/contingency';
import { db } from '../../store/db';
import { HBars, ScoreRing, toast } from '../kit';
import { BandSummary, Rubric } from './debrief';
import type { StepProps } from './flow';

export function SubmitStep(p: StepProps) {
  const { s, attempt, ex } = p;
  const plan = attempt.plan;
  const wl = workload(s, plan);
  // nothing is mandatory: unanswered items are simply not credited
  const missing: string[] = [];
  if (!plan.appreciation.approachOrder.length) missing.push('Pri of apchs (Appreciation)');
  if (!plan.appreciation.fdlLine) missing.push('Line of FDLs selection (Appreciation)');
  if (!plan.units.some((u) => u.role === 'FDL')) missing.push('Fwd localities');
  if (!plan.graphics.some((g) => g.kind === 'DF' && g.props.sos)) missing.push('DF (SOS)');
  const cont = CONTINGENCIES.filter((d) => d.levels.includes(s.level) && !choicePlanned(plan.contingency[d.key]));
  if (cont.length) missing.push(`${cont.length} contingency response(s)`);
  const reveal = ex.settings.revealPlanScore === 'IMMEDIATE' || attempt.status === 'COMPLETE';
  const pa = attempt.planAssessment;
  const [busy, setBusy] = useState(false);
  const preview = useMemo(() => (attempt.status === 'PLANNING' && p.session.role === 'INSTRUCTOR' ? assessPlan(s, plan, { marking: ex.settings.marking }) : null), [attempt.status, plan.updatedAt]);
  const submit = async () => {
    if (!plan.units.length && !confirm('No forces have been placed on the map. Submit anyway?')) return;
    setBusy(true);
    // free text is marked by the registered judge (the AI judge when configured)
    const res = applyOverrides(await assessPlanAsync(s, plan, { marking: ex.settings.marking }), attempt.itemOverrides, 'plan');
    setBusy(false);
    p.update((a) => {
      a.status = 'SUBMITTED';
      a.submittedAt = Date.now();
      a.planAssessment = res;
    });
    const fresh = await db.get('attempts', attempt.id);
    if (fresh) await db.put('attempts', { ...fresh, status: 'SUBMITTED', submittedAt: Date.now(), planAssessment: res, plan });
    toast('Plan submitted. The wargame is now open.', 'ok');
    p.go('war');
  };
  const counts = {
    units: plan.units.length,
    dfs: plan.graphics.filter((g) => g.kind === 'DF').length,
    obs: plan.graphics.filter((g) => g.kind === 'MINEFIELD' || g.kind === 'WIRE').length,
    catk: plan.graphics.filter((g) => g.kind === 'CATK').length,
  };
  const shown = pa ?? preview;
  return (
    <div class="page">
      <h1>Review &amp; submit</h1>
      <div class="grid4" style={{ marginTop: 10 }}>
        <div class="card kpi">
          <span class="v">{counts.units}</span>
          <span class="l">Units sited</span>
        </div>
        <div class="card kpi">
          <span class="v">{counts.dfs}</span>
          <span class="l">DFs planned</span>
        </div>
        <div class="card kpi">
          <span class="v">{counts.obs}</span>
          <span class="l">Obs planned</span>
        </div>
        <div class="card kpi">
          <span class="v">{Math.round(wl.readiness * 100)}%</span>
          <span class="l">Def ready by {`deadline`}</span>
        </div>
      </div>
      {missing.length > 0 && attempt.status === 'PLANNING' && (
        <div class="card" style={{ marginTop: 14, borderColor: '#5c4a1c' }}>
          <h3>Not done yet (optional — not credited until done)</h3>
          <ul>
            {missing.map((m) => (
              <li>{m}</li>
            ))}
          </ul>
        </div>
      )}
      {attempt.status === 'PLANNING' ? (
        <div class="card" style={{ marginTop: 14 }}>
          <p>
            Once submitted, the plan is locked and marked objectively. You then fight it in the wargame
            {ex.settings.injects ? ', taking decisions as the situation develops' : ' (your contingency plan is executed automatically)'}.
          </p>
          <div class="row">
            <button class="btn" onClick={() => p.go('cont')}>
              ← Contingencies
            </button>
            <button class="btn primary right" onClick={submit} disabled={p.readOnly || busy}>
              {busy ? 'Marking…' : 'Submit plan & open wargame'}
            </button>
          </div>
        </div>
      ) : (
        <div class="card" style={{ marginTop: 14 }}>
          <div class="row">
            <span class="badge b-green">Submitted</span>
            <button class="btn primary right" onClick={() => p.go(attempt.status === 'COMPLETE' ? 'debrief' : 'war')}>
              {attempt.status === 'COMPLETE' ? 'View debrief →' : 'Go to wargame →'}
            </button>
          </div>
        </div>
      )}
      {shown && (reveal || preview) && (
        <div class="card" style={{ marginTop: 14 }}>
          <div class="card-h">
            <h2>{preview && !pa ? 'Live DS preview (instructor only)' : 'Plan assessment'}</h2>
          </div>
          <div class="row" style={{ alignItems: 'flex-start', gap: 24 }}>
            <ScoreRing pct={shown.pct} label="plan" />
            <div class="grow">
              <HBars items={shown.groups.map((g) => ({ label: g.group, value: g.pct }))} max={100} unit="%" />
            </div>
          </div>
          <BandSummary a={shown} />
        </div>
      )}
      {shown && (reveal || preview) && <Rubric title={preview && !pa ? 'Live marking (instructor only)' : 'Plan — detailed marking'} a={shown} />}
      {pa && !reveal && <div class="muted" style={{ marginTop: 12 }}>Your plan score will be shown in the debrief.</div>}
    </div>
  );
}

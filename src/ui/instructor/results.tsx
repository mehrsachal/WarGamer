import { useState } from 'preact/hooks';
import type { Attempt } from '../../core/types';
import { Badge, download, Empty, fmtDate, nav, rampColor, statusBadge } from '../kit';
import type { Db } from './home';

export function Results(p: { d: Db; query?: string }) {
  const { d } = p;
  const exs = [...d.exercises].sort((a, b) => b.createdAt - a.createdAt);
  const q = new URLSearchParams(p.query ?? '');
  const [exId, setExId] = useState(q.get('ex') ?? exs[0]?.id ?? '');
  const ex = d.exercises.find((e) => e.id === exId);
  if (!exs.length) return <Empty>No exercises yet.</Empty>;
  const roster = ex ? (ex.studentIds.length ? d.students.filter((s) => ex.studentIds.includes(s.id)) : d.students.filter((s) => s.classId === ex.classId)) : [];
  const best = (sid: string): Attempt | undefined =>
    d.attempts
      .filter((a) => a.exerciseId === exId && a.studentId === sid)
      .sort((a, b) => (b.status === 'COMPLETE' ? 1 : 0) - (a.status === 'COMPLETE' ? 1 : 0) || (b.finalPct ?? 0) - (a.finalPct ?? 0))[0];
  const rows = roster.map((s) => ({ s, a: best(s.id) })).sort((x, y) => (y.a?.finalPct ?? -1) - (x.a?.finalPct ?? -1));
  const groups = [...new Set(rows.flatMap((r) => r.a?.planAssessment?.groups.map((g) => g.group) ?? []))];
  const csv = () => {
    const head = ['Rank', 'Name', 'P No', 'Unit', 'Syndicate', 'Status', 'Plan %', 'Battle %', 'Final %', 'Grade', 'Result', 'Own cas', 'En cas', ...groups.map((g) => `Plan: ${g}`), 'Completed'];
    const lines = rows.map(({ s, a }) => [
      s.rank, s.name, s.number, s.unit, s.syndicate, a?.status ?? 'NOT_STARTED',
      a?.planAssessment ? a.planAssessment.pct.toFixed(1) : '', a?.wargame ? a.wargame.assessment.pct.toFixed(1) : '', a?.finalPct?.toFixed(1) ?? '', a?.grade ?? '',
      a?.wargame?.summary.result ?? '', a?.wargame?.summary.ownCas ?? '', a?.wargame?.summary.enCas ?? '',
      ...groups.map((g) => a?.planAssessment?.groups.find((x) => x.group === g)?.pct.toFixed(0) ?? ''),
      a?.completedAt ? new Date(a.completedAt).toISOString() : '',
    ]);
    download(`results_${(ex?.title ?? 'exercise').replace(/\W+/g, '_')}.csv`, [head, ...lines].map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n'));
  };
  const done = rows.filter((r) => r.a?.status === 'COMPLETE');
  const avg = done.length ? done.reduce((m, r) => m + (r.a!.finalPct ?? 0), 0) / done.length : 0;
  return (
    <div class="col" style={{ gap: 14 }}>
      <div class="row wrap">
        <select value={exId} onChange={(e) => setExId(e.currentTarget.value)} style={{ minWidth: 320 }}>
          {exs.map((e) => (
            <option value={e.id}>
              {e.title} — {d.classes.find((c) => c.id === e.classId)?.name ?? ''}
            </option>
          ))}
        </select>
        <span class="muted">
          {done.length}/{rows.length} complete{done.length ? ` · avg ${Math.round(avg)}%` : ''}
        </span>
        <button class="btn right" onClick={csv}>
          ⬇ Export CSV
        </button>
      </div>
      <div class="card">
        <table class="tbl">
          <thead>
            <tr>
              <th title="Merit order among completed attempts">Rank</th>
              <th>Student</th>
              <th>Status</th>
              <th>Plan</th>
              <th>Battle</th>
              <th>Final</th>
              <th>Result</th>
              <th>Updated</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ s, a }, i) => (
              <tr class={a ? 'clickable' : ''} onClick={() => a && nav(`attempt/${a.id}`)}>
                <td class="dim">{a?.status === 'COMPLETE' ? i + 1 : ''}</td>
                <td>
                  <b>
                    {s.rank} {s.name}
                  </b>
                  <div class="dim small">
                    {s.number} {s.syndicate ? `· Syn ${s.syndicate}` : ''}
                  </div>
                </td>
                <td>{statusBadge(a?.status ?? 'NOT_STARTED')}</td>
                <td>{a?.planAssessment ? `${Math.round(a.planAssessment.pct)}%` : '—'}</td>
                <td>{a?.wargame ? `${Math.round(a.wargame.assessment.pct)}%` : '—'}</td>
                <td>{a?.finalPct !== undefined ? <Badge kind={a.finalPct >= 75 ? 'green' : a.finalPct >= 50 ? 'amber' : 'red'}>{Math.round(a.finalPct)}% · {a.grade}</Badge> : '—'}</td>
                <td class="small">{a?.wargame ? a.wargame.summary.result : ''}</td>
                <td class="dim small">{a ? fmtDate(a.completedAt ?? a.submittedAt ?? a.plan.updatedAt) : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {groups.length > 0 && (
        <div class="card">
          <h3>Plan marking heatmap</h3>
          <div class="muted small" style={{ marginBottom: 8 }}>
            Percent of marks earned per rubric group. Brighter = stronger. Hover a cell for detail.
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table class="tbl" style={{ minWidth: 700 }}>
              <thead>
                <tr>
                  <th>Student</th>
                  {groups.map((g) => (
                    <th style={{ textAlign: 'center' }}>{g}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows
                  .filter((r) => r.a?.planAssessment)
                  .map(({ s, a }) => (
                    <tr>
                      <td>
                        {s.rank} {s.name}
                      </td>
                      {groups.map((g) => {
                        const v = a!.planAssessment!.groups.find((x) => x.group === g)?.pct;
                        return (
                          <td title={`${s.name} — ${g}: ${v === undefined ? 'n/a' : `${Math.round(v)}%`}`} style={{ textAlign: 'center', background: v === undefined ? 'transparent' : rampColor(v), color: '#fff', fontWeight: 700, border: '2px solid #1a232b' }}>
                            {v === undefined ? '—' : Math.round(v)}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                <tr>
                  <td class="muted">Class average</td>
                  {groups.map((g) => {
                    const vals = rows.map((r) => r.a?.planAssessment?.groups.find((x) => x.group === g)?.pct).filter((v): v is number => v !== undefined);
                    const v = vals.length ? vals.reduce((m, x) => m + x, 0) / vals.length : undefined;
                    return <td style={{ textAlign: 'center', fontWeight: 700 }}>{v === undefined ? '—' : Math.round(v)}</td>;
                  })}
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

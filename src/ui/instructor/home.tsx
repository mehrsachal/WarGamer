import { useEffect, useState } from 'preact/hooks';
import type { AppSettings, Attempt, ClassGroup, Exercise, Scenario, Student } from '../../core/types';
import { db } from '../../store/db';
import { Badge, fmtDate, HBars, nav, Tabs } from '../kit';
import { Classes } from './classes';
import { DataTab } from './dataTab';
import { Exercises } from './exercises';
import { Results } from './results';
import { Scenarios } from './scenarios';

export interface Db {
  classes: ClassGroup[];
  students: Student[];
  scenarios: Scenario[];
  exercises: Exercise[];
  attempts: Attempt[];
}

export async function loadAll(): Promise<Db> {
  const [classes, students, scenarios, exercises, attempts] = await Promise.all([db.all('classes'), db.all('students'), db.all('scenarios'), db.all('exercises'), db.all('attempts')]);
  return { classes, students, scenarios, exercises, attempts };
}

type TabId = 'overview' | 'classes' | 'scenarios' | 'exercises' | 'results' | 'data';

export function InstructorHome(p: { tab?: string; settings: AppSettings; onSettings: (s: AppSettings) => void }) {
  const [tabRaw, query] = (p.tab ?? '').split('?');
  const tab = (tabRaw as TabId) || 'overview';
  const [d, setD] = useState<Db>();
  const reload = () => loadAll().then(setD);
  useEffect(() => void reload(), []);
  const tabs: { id: TabId; label: string }[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'classes', label: 'Classes & students' },
    { id: 'scenarios', label: 'Scenarios' },
    { id: 'exercises', label: 'Exercises' },
    { id: 'results', label: 'Results' },
    { id: 'data', label: 'Data & settings' },
  ];
  return (
    <div class="page">
      <Tabs tabs={tabs} value={tab} onChange={(t) => nav(`instructor/${t}`)} />
      {!d ? (
        <div class="muted">Loading…</div>
      ) : tab === 'overview' ? (
        <Overview d={d} />
      ) : tab === 'classes' ? (
        <Classes d={d} reload={reload} />
      ) : tab === 'scenarios' ? (
        <Scenarios d={d} reload={reload} />
      ) : tab === 'exercises' ? (
        <Exercises d={d} reload={reload} />
      ) : tab === 'results' ? (
        <Results d={d} query={query} />
      ) : (
        <DataTab d={d} reload={reload} settings={p.settings} onSettings={p.onSettings} />
      )}
    </div>
  );
}

function Overview(p: { d: Db }) {
  const { d } = p;
  const real = d.attempts.filter((a) => !a.exerciseId.startsWith('demo_'));
  const complete = real.filter((a) => a.status === 'COMPLETE');
  const avg = complete.length ? complete.reduce((m, a) => m + (a.finalPct ?? 0), 0) / complete.length : 0;
  const recent = [...real].sort((a, b) => (b.completedAt ?? b.submittedAt ?? b.startedAt) - (a.completedAt ?? a.submittedAt ?? a.startedAt)).slice(0, 8);
  const stName = (id: string) => {
    const s = d.students.find((x) => x.id === id);
    return s ? `${s.rank} ${s.name}` : '—';
  };
  // average of rubric groups across all completed attempts (class weaknesses)
  const groups = new Map<string, { sum: number; n: number }>();
  for (const a of complete) for (const g of a.planAssessment?.groups ?? []) {
    const x = groups.get(g.group) ?? { sum: 0, n: 0 };
    x.sum += g.pct;
    x.n++;
    groups.set(g.group, x);
  }
  return (
    <div class="col" style={{ gap: 14 }}>
      <div class="grid4">
        <div class="card kpi">
          <span class="v">{d.classes.filter((c) => !c.archived).length}</span>
          <span class="l">Active classes</span>
        </div>
        <div class="card kpi">
          <span class="v">{d.students.length}</span>
          <span class="l">Students</span>
        </div>
        <div class="card kpi">
          <span class="v">{d.exercises.filter((e) => !e.closed).length}</span>
          <span class="l">Open exercises</span>
        </div>
        <div class="card kpi">
          <span class="v">{complete.length ? `${Math.round(avg)}%` : '—'}</span>
          <span class="l">Avg final score ({complete.length} complete)</span>
        </div>
      </div>
      <div class="grid2">
        <div class="card">
          <div class="card-h">
            <h3>Recent activity</h3>
          </div>
          {recent.length ? (
            <table class="tbl">
              <tbody>
                {recent.map((a) => (
                  <tr class="clickable" onClick={() => nav(`attempt/${a.id}`)}>
                    <td>{stName(a.studentId)}</td>
                    <td class="muted small">{d.exercises.find((e) => e.id === a.exerciseId)?.title ?? 'Practice'}</td>
                    <td>{a.status === 'COMPLETE' ? <Badge kind={(a.finalPct ?? 0) >= 75 ? 'green' : (a.finalPct ?? 0) >= 50 ? 'amber' : 'red'}>{Math.round(a.finalPct ?? 0)}% {a.grade}</Badge> : <Badge kind="blue">{a.status.toLowerCase()}</Badge>}</td>
                    <td class="dim small">{fmtDate(a.completedAt ?? a.submittedAt ?? a.startedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div class="muted">No student activity yet.</div>
          )}
        </div>
        <div class="card">
          <div class="card-h">
            <h3>Where students lose marks (plan)</h3>
          </div>
          {groups.size ? (
            <HBars items={[...groups.entries()].map(([g, x]) => ({ label: g, value: x.sum / x.n })).sort((a, b) => a.value - b.value)} max={100} unit="%" />
          ) : (
            <div class="muted">Appears once exercises are completed.</div>
          )}
        </div>
      </div>
      <div class="card">
        <h3>Getting started</h3>
        <ol style={{ lineHeight: 1.8 }}>
          <li>
            <a href="#/instructor/classes">Create a class</a> and add students (paste a list).
          </li>
          <li>
            Pick or <a href="#/instructor/scenarios">generate scenarios</a> — the BIC-49 TE Def preset is included. Use <b>Try (demo)</b> to walk through it with the DS solution.
          </li>
          <li>
            <a href="#/instructor/exercises">Create an exercise</a>: scenario + class + settings (fog of war, injects, difficulty, weightage).
          </li>
          <li>Students log in, read the narrative, appreciate, mark the plan, pre-plan contingencies and fight the wargame.</li>
          <li>
            Review the objective marking under <a href="#/instructor/results">Results</a>; add DS remarks; export CSV.
          </li>
        </ol>
      </div>
    </div>
  );
}

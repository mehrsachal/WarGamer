import { useState } from 'preact/hooks';
import { uid } from '../../core/rng';
import type { Exercise, ExerciseSettings } from '../../core/types';
import { LEVEL_NAMES } from '../../scenario/generator';
import { db } from '../../store/db';
import { DEFAULT_SETTINGS } from '../data';
import { Badge, Empty, Field, fmtDate, Modal, nav, toast } from '../kit';
import type { Db } from './home';

export function Exercises(p: { d: Db; reload: () => void }) {
  const { d } = p;
  const [edit, setEdit] = useState<Exercise | null>(null);
  const list = [...d.exercises].sort((a, b) => b.createdAt - a.createdAt);
  const blank = (): Exercise => ({ id: uid('ex'), title: '', scenarioId: d.scenarios[0]?.id ?? '', classId: d.classes.find((c) => !c.archived)?.id ?? '', studentIds: [], settings: { ...DEFAULT_SETTINGS }, createdAt: Date.now() });
  return (
    <div class="col" style={{ gap: 14 }}>
      <div class="row">
        <div class="muted">An exercise assigns a scenario to a class (or selected students) with its own wargame settings.</div>
        <button class="btn primary right" onClick={() => setEdit(blank())} disabled={!d.classes.length}>
          + New exercise
        </button>
      </div>
      {!d.classes.length && <Empty>Create a class first.</Empty>}
      {list.length ? (
        <div class="card">
          <table class="tbl">
            <thead>
              <tr>
                <th>Exercise</th>
                <th>Scenario</th>
                <th>Class</th>
                <th>Settings</th>
                <th>Progress</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {list.map((e) => {
                const sc = d.scenarios.find((s) => s.id === e.scenarioId);
                const cl = d.classes.find((c) => c.id === e.classId);
                const roster = e.studentIds.length ? e.studentIds : d.students.filter((s) => s.classId === e.classId).map((s) => s.id);
                const att = d.attempts.filter((a) => a.exerciseId === e.id);
                const done = new Set(att.filter((a) => a.status === 'COMPLETE').map((a) => a.studentId)).size;
                const sub = new Set(att.filter((a) => a.status !== 'PLANNING').map((a) => a.studentId)).size;
                return (
                  <tr>
                    <td>
                      <b>{e.title}</b>
                      <div class="dim small">
                        {fmtDate(e.createdAt)}
                        {e.dueAt ? ` · due ${fmtDate(e.dueAt)}` : ''}
                      </div>
                      {e.closed && <Badge kind="grey">closed</Badge>}
                    </td>
                    <td class="small">
                      {sc?.title ?? <span class="muted">missing</span>}
                      <div class="dim">{sc ? LEVEL_NAMES[sc.level] : ''}</div>
                    </td>
                    <td class="small">{cl?.name ?? '—'}</td>
                    <td class="small">
                      Fog {e.settings.fog.toLowerCase()} · {e.settings.injects ? 'injects' : 'auto'} · {e.settings.difficulty.toLowerCase()} · plan {Math.round(e.settings.planWeight * 100)}%
                    </td>
                    <td class="small">
                      {sub}/{roster.length} submitted · {done} complete
                    </td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <button class="btn small" onClick={() => nav(`instructor/results?ex=${e.id}`)}>
                        Results
                      </button>
                      <button class="btn small ghost" onClick={() => setEdit(JSON.parse(JSON.stringify(e)))}>
                        Edit
                      </button>
                      <button
                        class="btn small ghost"
                        onClick={async () => {
                          await db.put('exercises', { ...e, closed: !e.closed });
                          p.reload();
                        }}
                      >
                        {e.closed ? 'Reopen' : 'Close'}
                      </button>
                      <button
                        class="btn small ghost"
                        onClick={async () => {
                          if (!confirm(`Delete exercise "${e.title}"? Student attempts are kept.`)) return;
                          await db.del('exercises', e.id);
                          p.reload();
                        }}
                      >
                        ✕
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        d.classes.length > 0 && <Empty>No exercises yet.</Empty>
      )}
      {edit && <ExerciseModal d={d} ex={edit} onClose={() => setEdit(null)} onSaved={() => (setEdit(null), p.reload())} />}
    </div>
  );
}

function ExerciseModal(p: { d: Db; ex: Exercise; onClose: () => void; onSaved: () => void }) {
  const [e, setE] = useState<Exercise>(p.ex);
  const set = (fn: (x: Exercise) => void) => {
    const n = JSON.parse(JSON.stringify(e)) as Exercise;
    fn(n);
    setE(n);
  };
  const st = <K extends keyof ExerciseSettings>(k: K, v: ExerciseSettings[K]) => set((x) => (x.settings[k] = v));
  const studs = p.d.students.filter((s) => s.classId === e.classId);
  const save = async () => {
    if (!e.title.trim()) return toast('Title required.', 'err');
    if (!e.scenarioId) return toast('Choose a scenario.', 'err');
    if (!e.classId) return toast('Choose a class.', 'err');
    await db.put('exercises', e);
    toast('Exercise saved — it now appears on the students’ dashboards.', 'ok');
    p.onSaved();
  };
  return (
    <Modal
      title={p.d.exercises.some((x) => x.id === e.id) ? 'Edit exercise' : 'New exercise'}
      wide
      onClose={p.onClose}
      footer={
        <button class="btn primary" onClick={save}>
          Save exercise
        </button>
      }
    >
      <div class="grid2">
        <Field label="Title">
          <input type="text" value={e.title} placeholder="TE Def — Coy (week 3)" onInput={(ev) => set((x) => (x.title = ev.currentTarget.value))} />
        </Field>
        <Field label="Scenario">
          <select value={e.scenarioId} onChange={(ev) => set((x) => (x.scenarioId = ev.currentTarget.value))}>
            {p.d.scenarios.map((s) => (
              <option value={s.id}>
                {s.title} — {LEVEL_NAMES[s.level]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Class">
          <select value={e.classId} onChange={(ev) => set((x) => ((x.classId = ev.currentTarget.value), (x.studentIds = [])))}>
            {p.d.classes
              .filter((c) => !c.archived)
              .map((c) => (
                <option value={c.id}>{c.name}</option>
              ))}
          </select>
        </Field>
        <Field label="Due (optional)">
          <input type="datetime-local" value={e.dueAt ? new Date(e.dueAt - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16) : ''} onInput={(ev) => set((x) => (x.dueAt = ev.currentTarget.value ? new Date(ev.currentTarget.value).getTime() : undefined))} />
        </Field>
        <Field label="Fog of war">
          <select value={e.settings.fog} onChange={(ev) => st('fog', ev.currentTarget.value as ExerciseSettings['fog'])}>
            <option value="FULL">Full — en seen only when detected</option>
            <option value="PARTIAL">Partial — detected en always identified</option>
            <option value="OFF">Off — training: whole en visible</option>
          </select>
        </Field>
        <Field label="Difficulty (en)">
          <select value={e.settings.difficulty} onChange={(ev) => st('difficulty', ev.currentTarget.value as ExerciseSettings['difficulty'])}>
            <option value="TRAINING">Training — weaker, predictable en</option>
            <option value="STANDARD">Standard</option>
            <option value="HARD">Hard — en exploits every weakness</option>
          </select>
        </Field>
        <Field label="Decisions during the wargame">
          <select value={e.settings.injects ? 'Y' : 'N'} onChange={(ev) => st('injects', ev.currentTarget.value === 'Y')}>
            <option value="Y">Injects — pause and ask the student</option>
            <option value="N">Auto — execute the contingency plan</option>
          </select>
        </Field>
        <Field label="Show plan score">
          <select value={e.settings.revealPlanScore} onChange={(ev) => st('revealPlanScore', ev.currentTarget.value as ExerciseSettings['revealPlanScore'])}>
            <option value="IMMEDIATE">Immediately on submission</option>
            <option value="AFTER_WARGAME">After the wargame (debrief)</option>
          </select>
        </Field>
        <Field label={`Weight of plan vs conduct of battle: ${Math.round(e.settings.planWeight * 100)} / ${Math.round((1 - e.settings.planWeight) * 100)}`}>
          <input type="range" min={0.2} max={0.8} step={0.05} value={e.settings.planWeight} onInput={(ev) => st('planWeight', Number(ev.currentTarget.value))} />
        </Field>
        <div class="col" style={{ paddingTop: 16 }}>
          <label class="check">
            <input type="checkbox" checked={e.settings.hints} onChange={(ev) => st('hints', ev.currentTarget.checked)} /> Show completeness checklist while planning
          </label>
        </div>
      </div>
      <div class="sep" />
      <h4>Students ({e.studentIds.length ? `${e.studentIds.length} selected` : `whole class — ${studs.length}`})</h4>
      <div class="row wrap" style={{ gap: 4 }}>
        {studs.map((s) => (
          <label class="check" style={{ padding: '2px 8px' }}>
            <input type="checkbox" checked={e.studentIds.includes(s.id)} onChange={(ev) => set((x) => (x.studentIds = ev.currentTarget.checked ? [...x.studentIds, s.id] : x.studentIds.filter((i) => i !== s.id)))} />
            {s.rank} {s.name}
          </label>
        ))}
        {!studs.length && <span class="muted small">This class has no students yet.</span>}
      </div>
      <div class="dim small">Leave all unticked to assign the exercise to the whole class.</div>
    </Modal>
  );
}

import { useEffect, useState } from 'preact/hooks';
import type { Attempt, ClassGroup, Exercise, Scenario, Student } from '../../core/types';
import { generateScenario, LEVEL_NAMES, TERRAIN_NAMES } from '../../scenario/generator';
import type { OpsLevel, TerrainType } from '../../core/types';
import { db, downloadJson, exportBundle } from '../../store/db';
import { cacheScenario, startAttempt } from '../data';
import { Badge, Empty, fmtDate, HBars, LineChart, nav, type Session, SERIES, statusBadge, toast } from '../kit';
import { scenarioThumb } from '../thumb';

export function StudentHome(p: { session: Session; tab?: string }) {
  const [st, setSt] = useState<Student>();
  const [cls, setCls] = useState<ClassGroup>();
  const [exs, setExs] = useState<Exercise[]>([]);
  const [atts, setAtts] = useState<Attempt[]>([]);
  const [scen, setScen] = useState<Scenario[]>([]);
  const load = async () => {
    const me = await db.get('students', p.session.studentId ?? '');
    setSt(me);
    if (!me) return;
    setCls(await db.get('classes', me.classId));
    const all = await db.all('exercises');
    setExs(all.filter((e) => e.classId === me.classId && (!e.studentIds.length || e.studentIds.includes(me.id))).sort((a, b) => b.createdAt - a.createdAt));
    setAtts((await db.all('attempts')).filter((a) => a.studentId === me.id));
    setScen(await db.all('scenarios'));
  };
  useEffect(() => void load(), []);
  if (!st) return <div class="page muted">Loading…</div>;
  const open = async (e: Exercise) => {
    const mine = atts.filter((a) => a.exerciseId === e.id).sort((a, b) => b.startedAt - a.startedAt)[0];
    if (mine) return nav(`ex/${mine.id}`);
    if (e.closed) return toast('This exercise is closed.', 'err');
    const a = await startAttempt(e.id, e.scenarioId, st.id);
    nav(`ex/${a.id}/brief`);
  };
  const complete = atts.filter((a) => a.status === 'COMPLETE').sort((a, b) => (a.completedAt ?? 0) - (b.completedAt ?? 0));
  const groups = new Map<string, { s: number; n: number }>();
  for (const a of complete) for (const g of a.planAssessment?.groups ?? []) {
    const x = groups.get(g.group) ?? { s: 0, n: 0 };
    x.s += g.pct;
    x.n++;
    groups.set(g.group, x);
  }
  return (
    <div class="page">
      <div class="row" style={{ marginBottom: 14 }}>
        <div>
          <h1 style={{ margin: 0 }}>
            {st.rank} {st.name}
          </h1>
          <div class="muted">
            {cls?.name} {st.syndicate ? `· Syn ${st.syndicate}` : ''} {st.unit ? `· ${st.unit}` : ''}
          </div>
        </div>
        <button
          class="btn right"
          title="For PCs without the LAN server: hand this file to your instructor"
          onClick={async () => downloadJson(`submission_${st.name.replace(/\W+/g, '_')}_${new Date().toISOString().slice(0, 10)}.json`, await exportBundle('SUBMISSION', { attempts: (a) => a.studentId === st.id }))}
        >
          ⬇ Export my submissions
        </button>
      </div>
      <h3>My exercises</h3>
      {exs.length ? (
        <div class="grid3">
          {exs.map((e) => {
            const s = scen.find((x) => x.id === e.scenarioId);
            const a = atts.filter((x) => x.exerciseId === e.id).sort((x, y) => y.startedAt - x.startedAt)[0];
            return (
              <div class="card" style={{ padding: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                {s && <Thumb s={s} />}
                <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 6, flex: 1 }}>
                  <b style={{ fontSize: 15 }}>{e.title}</b>
                  <div class="muted small">{s ? `${s.title} · ${LEVEL_NAMES[s.level]}` : 'Scenario not on this PC — import the pack'}</div>
                  <div class="row wrap" style={{ gap: 6 }}>
                    {statusBadge(a?.status ?? 'NOT_STARTED')}
                    {a?.finalPct !== undefined && <Badge kind={a.finalPct >= 75 ? 'green' : a.finalPct >= 50 ? 'amber' : 'red'}>{Math.round(a.finalPct)}% · {a.grade}</Badge>}
                    {e.dueAt && <Badge>due {fmtDate(e.dueAt)}</Badge>}
                    {e.closed && <Badge>closed</Badge>}
                  </div>
                  <div class="row" style={{ marginTop: 'auto' }}>
                    <button class="btn primary small" disabled={!s} onClick={() => open(e)}>
                      {!a ? 'Start' : a.status === 'COMPLETE' ? 'Debrief' : 'Continue'}
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <Empty>No exercises assigned yet.</Empty>
      )}
      <div class="grid2" style={{ marginTop: 18 }}>
        <div class="card">
          <h3>My progress</h3>
          {complete.length >= 1 ? (
            <LineChart series={[{ name: 'Final %', color: SERIES.own, pts: complete.map((a, i) => ({ x: i + 1, y: a.finalPct ?? 0 })) }]} yMax={100} xFmt={(x) => `#${Math.round(x)}`} yFmt={(y) => `${Math.round(y)}%`} height={180} />
          ) : (
            <div class="muted">Complete an exercise to see your trend.</div>
          )}
        </div>
        <div class="card">
          <h3>Strengths &amp; weaknesses (plan)</h3>
          {groups.size ? <HBars items={[...groups.entries()].map(([g, x]) => ({ label: g, value: x.s / x.n })).sort((a, b) => b.value - a.value)} max={100} unit="%" /> : <div class="muted">Appears after your first debrief.</div>}
        </div>
      </div>
      <Practice studentId={st.id} attempts={atts} scen={scen} onStart={load} />
    </div>
  );
}

function Thumb(p: { s: Scenario }) {
  const [img, setImg] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setImg(scenarioThumb(p.s)), 30);
    return () => clearTimeout(t);
  }, [p.s.id]);
  return img ? <img class="scen-thumb" style={{ borderRadius: 0 }} src={img} alt="" /> : <div class="scen-thumb" />;
}

function Practice(p: { studentId: string; attempts: Attempt[]; scen: Scenario[]; onStart: () => void }) {
  const [level, setLevel] = useState<OpsLevel>('COY');
  const [terrain, setTerrain] = useState<TerrainType>('PLAINS');
  const practice = p.attempts.filter((a) => a.exerciseId.startsWith('practice_')).sort((a, b) => b.startedAt - a.startedAt);
  const go = async () => {
    const s = generateScenario({ level, terrain });
    await db.put('scenarios', s);
    cacheScenario(s);
    const a = await startAttempt(`practice_${s.id}`, s.id, p.studentId);
    nav(`ex/${a.id}/brief`);
  };
  return (
    <div class="card" style={{ marginTop: 18 }}>
      <div class="card-h">
        <h3>Free practice</h3>
        <span class="muted small">Generate a fresh random scenario and train on your own. Practice runs are visible to your instructor.</span>
      </div>
      <div class="row wrap">
        <select value={level} onChange={(e) => setLevel(e.currentTarget.value as OpsLevel)}>
          {(['PL', 'COY', 'BN', 'BDE'] as OpsLevel[]).map((l) => (
            <option value={l}>{LEVEL_NAMES[l]}</option>
          ))}
        </select>
        <select value={terrain} onChange={(e) => setTerrain(e.currentTarget.value as TerrainType)}>
          {(Object.keys(TERRAIN_NAMES) as TerrainType[]).map((t) => (
            <option value={t}>{TERRAIN_NAMES[t]}</option>
          ))}
        </select>
        <button class="btn olive" onClick={go}>
          🎲 New practice scenario
        </button>
      </div>
      {practice.length > 0 && (
        <table class="tbl" style={{ marginTop: 10 }}>
          <tbody>
            {practice.slice(0, 8).map((a) => (
              <tr class="clickable" onClick={() => nav(`ex/${a.id}`)}>
                <td>{p.scen.find((s) => s.id === a.scenarioId)?.title ?? a.scenarioId}</td>
                <td>{statusBadge(a.status)}</td>
                <td>{a.finalPct !== undefined ? `${Math.round(a.finalPct)}% ${a.grade}` : ''}</td>
                <td class="dim small">{fmtDate(a.startedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

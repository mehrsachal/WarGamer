import { useEffect, useMemo, useState } from 'preact/hooks';
import { fmtTime } from '../../core/time';
import type { AssessmentResult, Attempt, Exercise, Scenario, ScoreItem, WargameRecord } from '../../core/types';
import { BAND_LABEL, bandOf, type Band } from '../../assess/plan';
import { ACTIONS, actionText, choiceActions } from '../../plan/contingency';
import { gradeFor } from '../../core/doctrine';
import type { MapScene } from '../../render/mapRenderer';
import { Badge, HBars, LineChart, ScoreRing, SERIES } from '../kit';
import { MapView } from '../mapView';
import { aorBox, replayScene, type UnitMeta } from '../scene';
import type { StepProps } from './flow';

export function Debrief(p: StepProps) {
  return <DebriefView s={p.s} attempt={p.attempt} ex={p.ex} />;
}

export function DebriefView(p: { s: Scenario; attempt: Attempt; ex: Exercise; extra?: preact.ComponentChildren; overrides?: Record<string, { score: number; note?: string }>; onOverride?: (id: string, v: { score: number; note?: string } | null) => void }) {
  const { s, attempt } = p;
  const w = attempt.wargame;
  const pa = attempt.planAssessment;
  if (!w || !pa) return <div class="page muted">The debrief is available once the wargame is complete.</div>;
  const g = gradeFor(attempt.finalPct ?? 0);
  const sm = w.summary;
  const resKind = sm.result === 'HELD' ? 'green' : sm.result === 'PARTIAL' ? 'amber' : 'red';
  return (
    <div class="page">
      <div class="card" style={{ background: 'linear-gradient(120deg,#1d2c39,#1a232b)' }}>
        <div class="row" style={{ gap: 26, alignItems: 'center' }}>
          <ScoreRing pct={attempt.finalPct ?? 0} label={`Grade ${attempt.grade ?? g.grade}`} size={130} />
          <div class="grow">
            <div class="row wrap">
              <Badge kind={resKind}>{sm.result === 'HELD' ? 'DEF HELD' : sm.result === 'PARTIAL' ? 'LIMITED PENETRATION' : 'DEF PENETRATED'}</Badge>
              <span class="muted">{g.text}</span>
              <BandChip band={bandOf((attempt.finalPct ?? 0) / 100)} />
            </div>
            <h1 style={{ marginTop: 8 }}>{sm.resultText}</h1>
            <div class="grid4" style={{ marginTop: 10 }}>
              <div class="kpi">
                <span class="v">{Math.round(pa.pct)}%</span>
                <span class="l">Plan ({Math.round(p.ex.settings.planWeight * 100)}% wt)</span>
              </div>
              <div class="kpi">
                <span class="v">{Math.round(w.assessment.pct)}%</span>
                <span class="l">Conduct of battle</span>
              </div>
              <div class="kpi">
                <span class="v">
                  {sm.ownCas}/{sm.ownStart}
                </span>
                <span class="l">Own cas</span>
              </div>
              <div class="kpi">
                <span class="v">
                  {sm.enCas}/{sm.enStart}
                </span>
                <span class="l">En cas{sm.tanksStart ? ` · ${sm.tanksKilled}/${sm.tanksStart} tks` : ''}</span>
              </div>
            </div>
          </div>
          <button class="btn noprint" onClick={() => window.print()}>
            🖨 Print report
          </button>
        </div>
        {attempt.remarks && (
          <div class="card tight" style={{ marginTop: 14, borderColor: '#5a6f3a' }}>
            <h4>DS remarks</h4>
            <div style={{ whiteSpace: 'pre-wrap' }}>{attempt.remarks}</div>
            {attempt.instructorAdj ? <div class="muted small">Instructor adjustment: {attempt.instructorAdj > 0 ? '+' : ''}{attempt.instructorAdj}</div> : null}
          </div>
        )}
      </div>
      {p.extra}
      <Replay s={s} attempt={attempt} />
      <div class="grid2" style={{ marginTop: 14 }}>
        <div class="card">
          <h3>Cumulative casualties</h3>
          <StrengthChart attempt={attempt} />
        </div>
        <div class="card">
          <h3>Casualties by cause</h3>
          <CauseCharts attempt={attempt} />
        </div>
      </div>
      <div class="card" style={{ marginTop: 14 }}>
        <h3>Decisions during the battle</h3>
        <DecisionsTable w={w} />
      </div>
      <div class="grid2" style={{ marginTop: 14 }}>
        <div class="card">
          <h3>Plan assessment</h3>
          <HBars items={pa.groups.map((x) => ({ label: x.group, value: x.pct }))} max={100} unit="%" />
          <BandSummary a={pa} />
        </div>
        <div class="card">
          <h3>Conduct of battle</h3>
          <HBars items={w.assessment.groups.map((x) => ({ label: x.group, value: x.pct }))} max={100} unit="%" />
          <BandSummary a={w.assessment} />
        </div>
      </div>
      <Rubric title="Plan — detailed marking" a={pa} prefix="plan" overrides={p.overrides} onOverride={p.onOverride} />
      <Rubric title="Conduct of battle — detailed marking" a={w.assessment} prefix="war" overrides={p.overrides} onOverride={p.onOverride} />
      <div class="grid2" style={{ marginTop: 14 }}>
        <div class="card">
          <h3>What the en did</h3>
          <ul>
            {w.enemyPlanText.map((t) => (
              <li style={{ marginBottom: 6 }}>{t}</li>
            ))}
          </ul>
        </div>
        <div class="card">
          <h3>DS solution (guideline)</h3>
          <div class="muted small" style={{ marginBottom: 8 }}>
            Any viable plan fulfilling the msn essentials, developed logically and supported by sound reasoning, can be taken as correct.
          </div>
          <ul>
            {s.ds.notes.map((n) => (
              <li style={{ marginBottom: 6 }}>{n}</li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

const BAND_KIND: Record<Band, 'green' | 'blue' | 'amber' | 'red'> = { EXCELLENT: 'green', GOOD: 'blue', ADEQUATE: 'amber', NEEDS_WORK: 'red' };

function itemBand(i: ScoreItem): Band {
  return i.band ?? bandOf(i.score);
}

export function BandChip(p: { band: Band; small?: boolean }) {
  return <span class={`band band-${p.band} ${p.small ? 'sm' : ''}`}>{BAND_LABEL[p.band]}</span>;
}

/** Overall band, band counts and the top strengths / improvements of an assessment. */
export function BandSummary(p: { a: AssessmentResult }) {
  const items = p.a.items.filter((i) => i.verdict !== 'NA' && i.weight > 0);
  const counts = (['EXCELLENT', 'GOOD', 'ADEQUATE', 'NEEDS_WORK'] as Band[]).map((b) => ({ b, n: items.filter((i) => itemBand(i) === b).length }));
  const good = [...items].filter((i) => i.score >= 0.85).sort((a, b) => b.weight - a.weight).slice(0, 4);
  const improve = [...items].filter((i) => i.score < 0.65).sort((a, b) => b.weight * (1 - b.score) - a.weight * (1 - a.score)).slice(0, 4);
  return (
    <div class="band-summary">
      <div class="row wrap" style={{ gap: 8 }}>
        <span class="dim small">Overall</span>
        <BandChip band={bandOf(p.a.pct / 100)} />
        <span class="sepv" />
        {counts.map((c) => (
          <span class="band-count" key={c.b}>
            <BandChip band={c.b} small /> <b>{c.n}</b>
          </span>
        ))}
      </div>
      <div class="grid2" style={{ marginTop: 10 }}>
        <div class="fb good">
          <h4>What was good</h4>
          {good.length ? (
            <ul>
              {good.map((i) => (
                <li>
                  <b>{i.title}.</b> {i.detail.split('. ')[0].replace(/\.$/, '')}.
                </li>
              ))}
            </ul>
          ) : (
            <div class="dim small">Nothing excellent yet.</div>
          )}
        </div>
        <div class="fb improve">
          <h4>What to improve</h4>
          {improve.length ? (
            <ul>
              {improve.map((i) => (
                <li>
                  <b>{i.title}:</b> {i.tip ?? i.detail} <span class="dim">({i.ref.split(';')[0]})</span>
                </li>
              ))}
            </ul>
          ) : (
            <div class="dim small">No significant weaknesses.</div>
          )}
        </div>
      </div>
    </div>
  );
}

export function Rubric(p: { title: string; a: AssessmentResult; prefix?: 'plan' | 'war'; overrides?: Record<string, { score: number; note?: string }>; onOverride?: (id: string, v: { score: number; note?: string } | null) => void }) {
  const [open, setOpen] = useState<string | null>(null);
  const edit = !!p.onOverride;
  return (
    <div class="card" style={{ marginTop: 14 }}>
      <div class="card-h">
        <h3>{p.title}</h3>
        {edit && <span class="right dim small">Instructor: override any item with the slider; the final score is recomputed when you save.</span>}
      </div>
      <table class="tbl rubric">
        <thead>
          <tr>
            <th>Group</th>
            <th>Band</th>
            <th>Score</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {p.a.groups.map((g) => {
            const gb = bandOf(g.pct / 100);
            const isOpen = open === g.group || typeof window === 'undefined' || edit;
            return (
              <>
                <tr class="clickable" onClick={() => setOpen(open === g.group ? null : g.group)}>
                  <td>
                    <b>
                      {isOpen ? '▾' : '▸'} {g.group}
                    </b>
                  </td>
                  <td style={{ width: 120 }}>
                    <BandChip band={gb} small />
                  </td>
                  <td style={{ width: 240 }}>
                    <div class={`bar band-bar band-${gb}`}>
                      <i style={{ width: `${g.pct}%` }} />
                    </div>
                  </td>
                  <td style={{ width: 60 }}>{Math.round(g.pct)}%</td>
                </tr>
                {isOpen &&
                  p.a.items
                    .filter((i) => i.group === g.group)
                    .map((i) => {
                      const b = itemBand(i);
                      const key = `${p.prefix ?? 'plan'}:${i.id}`;
                      const o = p.overrides?.[key];
                      return (
                        <tr class="rub-item">
                          <td colSpan={4} style={{ paddingLeft: 24 }}>
                            <div class="row" style={{ alignItems: 'flex-start' }}>
                              <span style={{ width: 96, flex: 'none' }}>{i.verdict === 'NA' ? <span class="dim small">— n/a</span> : <BandChip band={b} small />}</span>
                              <div class="grow">
                                <b>{i.title}</b> <span class="dim small">(wt {Math.round(i.weight * 100) / 100})</span>
                                {i.override && <span class="badge b-purple" style={{ marginLeft: 6 }} title={i.override.note}>DS override (auto {Math.round((i.auto ?? 0) * 100)}%)</span>}
                                <div class="small">{i.detail}</div>
                                {i.override?.note && <div class="small" style={{ color: '#e1a6f0' }}>DS: {i.override.note}</div>}
                                {i.tip && i.score < 0.85 && <div class="small tip">↗ {i.tip}</div>}
                                <div class="dim small">{i.ref}</div>
                                {edit && i.verdict !== 'NA' && (
                                  <div class="ovr row">
                                    <input type="range" min={0} max={100} step={5} value={Math.round((o?.score ?? i.auto ?? i.score) * 100)} onInput={(e) => p.onOverride!(key, { score: Number(e.currentTarget.value) / 100, note: o?.note })} />
                                    <span class="mono small" style={{ width: 40 }}>{Math.round((o?.score ?? i.auto ?? i.score) * 100)}%</span>
                                    <input type="text" class="grow" placeholder="Note to the student (optional)" value={o?.note ?? ''} onInput={(e) => p.onOverride!(key, { score: o?.score ?? i.auto ?? i.score, note: e.currentTarget.value })} />
                                    {o && (
                                      <button class="btn small ghost" title="Back to the automatic mark" onClick={() => p.onOverride!(key, null)}>
                                        ↺ auto
                                      </button>
                                    )}
                                  </div>
                                )}
                              </div>
                              <span class="small" style={{ width: 40, textAlign: 'right' }}>{i.verdict === 'NA' ? '' : `${Math.round(i.score * 100)}%`}</span>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
              </>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function DecisionsTable(p: { w: WargameRecord }) {
  const ds = p.w.decisions;
  if (!ds.length) return <div class="muted">No injects arose — your surveillance did not detect the situations that trigger decisions, or the battle ended early.</div>;
  return (
    <table class="tbl decisions">
      <thead>
        <tr>
          <th>Time</th>
          <th>Inject</th>
          <th>Your response</th>
          <th>Verdict</th>
          <th>Why (doctrine)</th>
        </tr>
      </thead>
      <tbody>
        {ds.map((d) => {
          const acts = d.actions ?? choiceActions(d.key, { option: d.option });
          return (
            <tr class={d.unmarked ? 'unmarked' : ''}>
              <td class="mono small">{fmtTime(d.time)}</td>
              <td>
                <b>{d.title}</b>
                <div class="small dim">{d.source === 'MAP' ? 'Orders on the map' : d.source === 'PREPLANNED' ? 'Contingency plan (auto)' : d.source === 'SOP' ? 'SOP — not pre-planned' : d.source === 'AI' ? 'AI' : 'Decision card'}</div>
                {d.changed && <div class="small" style={{ color: '#ffd36a' }}>changed from your contingency plan</div>}
              </td>
              <td class="small">
                {acts.length ? (
                  <div class="chips">
                    {acts.map((a) => (
                      <span class={`chip ${d.gaps?.some((g) => g.includes(ACTIONS[a]?.text ?? '§')) ? 'bad' : ''}`}>{actionText(a, d.key).split(' — ')[0].split(' (')[0]}</span>
                    ))}
                    {(d.understood ?? []).map((a) => (
                      <span class="chip und" title="Understood from your own words">{actionText(a, d.key).split(' — ')[0].split(' (')[0]}</span>
                    ))}
                  </div>
                ) : !d.text ? (
                  <span class="dim">No action</span>
                ) : null}
                {d.text && <div class="quote">“{d.text}”</div>}
              </td>
              <td>
                {d.unmarked ? (
                  <span class="dim small">not marked</span>
                ) : (
                  <>
                    <b class={`verdict-${d.verdict}`}>{d.verdict}</b>
                    <div class="dim small">{Math.round(d.score * 100)}%</div>
                  </>
                )}
              </td>
              <td class="small">
                {d.strengths?.length || d.gaps?.length ? (
                  <>
                    {(d.strengths ?? []).slice(0, 3).map((x) => (
                      <div class="fbl good">✔ {x}</div>
                    ))}
                    {(d.gaps ?? []).slice(0, 3).map((x) => (
                      <div class="fbl gap">✖ {x}</div>
                    ))}
                  </>
                ) : (
                  d.rationale
                )}
                {d.aiNote && <div class="small" style={{ color: '#e1a6f0' }}>Umpire: {d.aiNote}</div>}
                <div class="dim">{d.ref}</div>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function Replay(p: { s: Scenario; attempt: Attempt }) {
  const w = p.attempt.wargame!;
  const frames = w.frames;
  const [i, setI] = useState(frames.length - 1);
  const [play, setPlay] = useState(false);
  const [showEn, setShowEn] = useState(true);
  const [showDs, setShowDs] = useState(false);
  useEffect(() => {
    if (!play) return;
    const id = setInterval(() => setI((x) => (x >= frames.length - 1 ? (setPlay(false), x) : x + 1)), 60);
    return () => clearInterval(id);
  }, [play]);
  const meta: UnitMeta[] = w.units.map((u) => ({ id: u.id, sidc: u.sidc, label: u.label, side: u.side }));
  const f = frames[i];
  const minOfDay = f ? ((f.t % 1440) + 1440) % 1440 : 720;
  const night = minOfDay < p.s.times.light.firstLight - 20 || minOfDay > p.s.times.light.lastLight + 20;
  const scene: MapScene = useMemo(() => replayScene(p.attempt.plan, meta, frames, i, night), [i]);
  scene.ds = showDs ? p.s.ds : null;
  const ep = w.enemyPlan;
  scene.enemyPlan = showEn && ep ? { faa: ep.faa, fup: ep.fup, bof: ep.bof, objectives: ep.objectives, approach: ep.approach, names: { faa: ep.faaName, fup: ep.fupName, bof: ep.bofName } } : null;
  return (
    <div class="card" style={{ marginTop: 14 }}>
      <div class="card-h">
        <h3>After-action replay (ground truth)</h3>
        <span class="right row">
          <label class="check">
            <input type="checkbox" checked={showEn} onChange={(e) => setShowEn(e.currentTarget.checked)} /> En plan
          </label>
          <label class="check">
            <input type="checkbox" checked={showDs} onChange={(e) => setShowDs(e.currentTarget.checked)} /> DS overlay
          </label>
        </span>
      </div>
      <div style={{ height: 520, borderRadius: 10, overflow: 'hidden', display: 'flex' }}>
        <MapView scenario={p.s} scene={scene} fit={aorBox(p.s, 900)} cover />
      </div>
      <div class="row noprint" style={{ marginTop: 10 }}>
        <button class="btn small" onClick={() => setPlay(!play)}>
          {play ? '❚❚' : '▶'}
        </button>
        <input type="range" class="grow" min={0} max={Math.max(0, frames.length - 1)} value={i} onInput={(e) => setI(Number(e.currentTarget.value))} style={{ accentColor: '#f2b84b' }} />
        <span class="mono" style={{ width: 130, textAlign: 'right' }}>
          {f ? fmtTime(f.t) : ''}
        </span>
      </div>
    </div>
  );
}

function StrengthChart(p: { attempt: Attempt }) {
  // cumulative casualties per side: monotonic and unaffected by units entering or reinforcements arriving
  const w = p.attempt.wargame!;
  const starts = new Map(w.units.map((u) => [u.id, u]));
  const step = Math.max(1, Math.floor(w.frames.length / 160));
  const own: { x: number; y: number }[] = [];
  const en: { x: number; y: number }[] = [];
  for (let i = 0; i < w.frames.length; i += step) {
    const f = w.frames[i];
    let b = 0;
    let r = 0;
    for (const [id, , , pct] of f.u) {
      const u = starts.get(id);
      if (!u) continue;
      const cas = u.start * (1 - Math.max(0, Math.min(100, pct)) / 100);
      if (u.side === 'BLUE') b += cas;
      else r += cas;
    }
    own.push({ x: f.t, y: b });
    en.push({ x: f.t, y: r });
  }
  return (
    <LineChart
      series={[
        { name: 'Own cas', color: SERIES.own, pts: own },
        { name: 'En cas', color: SERIES.enemy, pts: en },
      ]}
      xFmt={(x) => fmtTime(x)}
      yFmt={(y) => `${Math.round(y)}`}
    />
  );
}

function CauseCharts(p: { attempt: Attempt }) {
  const c = p.attempt.wargame!.causes;
  const items = (side: 'BLUE' | 'RED') =>
    Object.entries(c[side] ?? {})
      .filter(([k]) => !k.startsWith('Tks lost'))
      .map(([k, v]) => ({ label: k.length > 26 ? `${k.slice(0, 25)}…` : k, value: v, detail: k }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 8);
  const tanks = Object.entries(c.RED ?? {}).filter(([k]) => k.startsWith('Tks lost'));
  return (
    <div class="col">
      <h4>Inflicted on the en</h4>
      <HBars items={items('RED')} color={SERIES.enemy} />
      {tanks.length > 0 && <div class="small muted">Tks: {tanks.map(([k, v]) => `${v} by ${k.replace('Tks lost (', '').replace(')', '')}`).join(', ')}</div>}
      <h4 style={{ marginTop: 8 }}>Own cas</h4>
      <HBars items={items('BLUE')} color={SERIES.own} />
    </div>
  );
}

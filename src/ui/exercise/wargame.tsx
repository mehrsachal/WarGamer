import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { assessPlan } from '../../assess/plan';
import { finalScore, wargameRecord } from '../../assess/wargame';
import type { Vec } from '../../core/geom';
import { hashString } from '../../core/rng';
import { fmtTime } from '../../core/time';
import type { MapScene } from '../../render/mapRenderer';
import { Engine } from '../../sim/engine';
import type { DecisionInput, PendingDecision, SimUnit } from '../../sim/types';
import { db } from '../../store/db';
import { Modal, toast } from '../kit';
import { MapView } from '../mapView';
import { aorBox, simScene } from '../scene';
import type { StepProps } from './flow';
import { useBattleAi } from '../../ai/ui/hooks';
import { AiWarHud } from '../../ai/ui/AiWarHud';
import { RadioNet } from '../../ai/ui/RadioNet';

const SPEEDS = [1, 3, 10, 30, 60];

export function Wargame(p: StepProps) {
  const { s, attempt, ex } = p;
  const done = attempt.status === 'COMPLETE';
  const engine = useMemo(() => {
    if (done) return null;
    return new Engine(s, attempt.plan, {
      seed: hashString(attempt.id) % 1_000_000,
      fog: ex.settings.fog,
      interactive: ex.settings.injects,
      difficulty: ex.settings.difficulty,
    });
  }, [attempt.id, done]);
  const ai = useBattleAi(engine);
  const [, tick] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(10);
  const [sel, setSel] = useState<string>();
  const [mode, setMode] = useState<'none' | 'catk' | 'qc'>('none');
  const [fog, setFog] = useState<MapScene['fog']>(null);
  const fogAt = useRef(-999);
  const acc = useRef(0);
  const saving = useRef(false);

  // simulation loop
  useEffect(() => {
    if (!engine) return;
    const id = window.setInterval(() => {
      if (!playing || engine.pending || engine.over) return;
      acc.current += speed / 10;
      let n = Math.floor(acc.current);
      acc.current -= n;
      while (n-- > 0 && !engine.pending && !engine.over && !ai?.holding()) engine.step();
      if (engine.pending) setPlaying(false);
      tick((x) => x + 1);
    }, 100);
    return () => clearInterval(id);
  }, [engine, playing, speed]);

  // fog of war viewshed (throttled)
  useEffect(() => {
    if (!engine || ex.settings.fog === 'OFF') return;
    if (Math.abs(engine.t - fogAt.current) < 10 && fog) return;
    fogAt.current = engine.t;
    const night = engine.light !== 'DAY';
    const obs = engine
      .blue()
      .filter((u) => !(u.role === 'LP' && u.task === 'LP (by ni)'))
      .map((u) => ({ pos: u.pos, range: Math.min(2500 * (s.level === 'BDE' ? 2 : 1), u.obsRange * (night ? (u.nvd ? 0.42 : 0.15) : engine.vis)) }));
    for (const q of engine.qcs.filter((x) => x.airborne)) obs.push({ pos: q.pos, range: night ? 450 : 650 });
    const res = Math.max(50, s.terrain.gridSq / 8);
    setFog(engine.terrain.viewshed(obs, res));
  });

  // finish
  useEffect(() => {
    if (!engine || !engine.over || saving.current) return;
    saving.current = true;
    (async () => {
      const rec = wargameRecord(engine);
      if (ai) rec.ai = ai.record();
      const pa = attempt.planAssessment ?? assessPlan(s, attempt.plan);
      const f = finalScore(pa.pct, rec.assessment.pct, ex.settings.planWeight, attempt.instructorAdj ?? 0);
      p.update((a) => {
        a.status = 'COMPLETE';
        a.completedAt = Date.now();
        a.planAssessment = pa;
        a.wargame = rec;
        a.finalPct = f.pct;
        a.grade = f.grade;
      });
      const fresh = await db.get('attempts', attempt.id);
      if (fresh) await db.put('attempts', { ...fresh, status: 'COMPLETE', completedAt: Date.now(), planAssessment: pa, wargame: rec, finalPct: f.pct, grade: f.grade });
      toast(`Wargame complete — ${rec.summary.resultText}`, 'ok');
      setTimeout(() => p.go('debrief'), 900);
    })();
  });

  if (done || !engine) {
    return (
      <div class="page">
        <div class="card">
          <h2>Wargame complete</h2>
          <button class="btn primary" onClick={() => p.go('debrief')}>
            Open debrief →
          </button>
        </div>
      </div>
    );
  }

  const e = engine;
  const blue = e.units.filter((u) => u.side === 'BLUE' && u.state !== 'OFFMAP');
  const selUnit = sel ? e.byId.get(sel) : undefined;
  const selContact = sel ? [...e.contacts.values()].find((c) => c.id === sel) : undefined;
  const scene = simScene(e, { selectedId: sel, fog: ex.settings.fog === 'OFF' ? null : fog });
  const lightLbl = e.light === 'DAY' ? '☀ Day' : e.light === 'TWILIGHT' ? '◐ Twilight' : '☾ Night';
  const order = (o: Parameters<Engine['order']>[0]) => {
    const msg = e.order(o);
    toast(msg);
    tick((x) => x + 1);
  };
  const skipToEvent = () => {
    const n0 = e.log.length;
    for (let i = 0; i < 600 && !e.pending && !e.over && !ai?.holding(); i++) {
      e.step();
      if (e.log.slice(n0).some((l) => l.level === 'warn' || l.level === 'crit')) break;
    }
    tick((x) => x + 1);
  };
  const onClick = (w: Vec, hit: { unit?: { id: string } }) => {
    if (mode === 'catk' && selUnit) {
      order({ type: 'CATK', unitId: selUnit.id, target: w });
      setMode('none');
      return;
    }
    if (mode === 'qc') {
      order({ type: 'QC_SURV', target: w });
      setMode('none');
      return;
    }
    setSel(hit.unit?.id);
  };

  return (
    <div class="workspace" style={{ height: '100%' }}>
      <div class="side" style={{ width: 300 }}>
        <div class="sect">
          <h4>Own forces</h4>
          <div class="col" style={{ gap: 4 }}>
            {blue.map((u) => (
              <UnitRow key={u.id} u={u} on={u.id === sel} onClick={() => setSel(u.id)} />
            ))}
          </div>
        </div>
        {selUnit && selUnit.side === 'BLUE' && (
          <div class="sect col" style={{ gap: 6 }}>
            <h4>Orders — {selUnit.label}</h4>
            <div class="muted small">{selUnit.task || selUnit.state}</div>
            <div class="row wrap">
              <button class="btn small" disabled={!selUnit.altPos} onClick={() => order({ type: 'MOVE_ALT', unitId: selUnit.id })}>
                To altn posn
              </button>
              <button class="btn small" onClick={() => order({ type: 'WITHDRAW', unitId: selUnit.id })}>
                Withdraw
              </button>
              <button class={`btn small ${mode === 'catk' ? 'active' : ''}`} onClick={() => setMode(mode === 'catk' ? 'none' : 'catk')}>
                C attk…
              </button>
              <button class="btn small" onClick={() => order({ type: 'CPEN', unitId: selUnit.id })}>
                Occupy C pen
              </button>
              <button class="btn small" onClick={() => order({ type: 'HOLD', unitId: selUnit.id })}>
                Hold
              </button>
            </div>
          </div>
        )}
      </div>
      <MapView scenario={s} scene={scene} fit={aorBox(s, 900)} cover cursor={mode !== 'none' ? 'crosshair' : 'grab'} events={{ onClick }}>
        {mode === 'catk' && <div class="hint">Click the en penetration to counter-attack</div>}
        {mode === 'qc' && <div class="hint">Click the area for the surv QC</div>}
        <div class="maphud">
          <div class="hudchip big">{fmtTime(e.t)}</div>
          <div class="hudchip">{lightLbl}</div>
          <div class="hudchip" title="Fog of war">
            Fog: {ex.settings.fog.toLowerCase()}
          </div>
          <AiWarHud ai={ai} />
          <div class="hudchip">
            Cas own {Math.round(e.stats.blueCas)} · en {ex.settings.fog === 'OFF' ? Math.round(e.stats.redCas) : 'unknown'}
          </div>
        </div>
        <div style={{ position: 'absolute', left: 10, bottom: 40, display: 'flex', gap: 6, zIndex: 5 }} class="noprint">
          <button class={`btn ${playing ? '' : 'primary'}`} onClick={() => setPlaying(!playing)} disabled={!!e.pending || e.over}>
            {playing ? '❚❚ Pause' : '▶ Play'}
          </button>
          {SPEEDS.map((sp) => (
            <button class={`btn small ${speed === sp ? 'active' : ''}`} onClick={() => setSpeed(sp)} title={`${sp} min of battle per second`}>
              {sp}×
            </button>
          ))}
          <button class="btn small" onClick={skipToEvent} disabled={!!e.pending || e.over} title="Run until something happens">
            ⏭ Next event
          </button>
        </div>
      </MapView>
      <div class="side right" style={{ width: 340 }}>
        <FireSupport e={e} sel={sel} selContact={selContact} order={order} setMode={setMode} />
        <RadioNet e={e} ai={ai} selContactId={selContact?.unitId} onChange={() => tick((x) => x + 1)} />
        <div class="sect" style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
          <h4>Radio log</h4>
          <div class="log" style={{ overflow: 'auto', flex: 1 }}>
            {[...e.log].reverse().slice(0, 160).map((l, i) => (
              <div class={`e ${l.level}`} key={e.log.length - i}>
                <span class="t">{fmtTime(l.time, false).replace(' hrs', '')}</span>
                {l.text}
              </div>
            ))}
          </div>
        </div>
      </div>
      {e.pending && <DecisionModal d={e.pending} e={e} onDecide={(inp) => (e.decide(inp), tick((x) => x + 1), setPlaying(true))} />}
    </div>
  );
}

function UnitRow(p: { u: SimUnit; on: boolean; onClick: () => void }) {
  const pct = Math.round((100 * p.u.strength) / Math.max(1, p.u.start));
  const lost = p.u.state === 'CAPTURED' || p.u.state === 'DESTROYED';
  return (
    <div class={`row`} style={{ padding: '4px 6px', borderRadius: 6, cursor: 'pointer', background: p.on ? '#22384c' : 'transparent', opacity: lost ? 0.5 : 1 }} onClick={p.onClick}>
      <div style={{ width: 70, fontWeight: 700 }}>{p.u.label}</div>
      <div class="grow">
        <div class={`bar ${pct > 66 ? 'g' : pct > 33 ? 'a' : 'r'}`}>
          <i style={{ width: `${pct}%` }} />
        </div>
        <div class="dim small" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{lost ? (p.u.state === 'CAPTURED' ? 'Overrun' : 'Destroyed') : p.u.task || String(p.u.role).toLowerCase()}</div>
      </div>
      <div class="small" style={{ width: 34, textAlign: 'right' }}>
        {pct}%
      </div>
    </div>
  );
}

function FireSupport(p: { e: Engine; sel?: string; selContact?: { id: string; unitId: string; ident: string; size: string; pos: Vec; vehicles: number }; order: (o: Parameters<Engine['order']>[0]) => void; setMode: (m: 'none' | 'catk' | 'qc') => void }) {
  const { e } = p;
  const [just, setJust] = useState<string[]>([]);
  const sos = e.dfs.filter((d) => d.sos);
  const dfs = e.dfs.filter((d) => !d.sos);
  const surv = e.qcs.find((q) => q.kind === 'SURV' && !q.lost);
  const aqc = e.qcs.find((q) => q.kind === 'ATTACK' && !q.lost && q.usedStrikes === 0);
  const c = p.selContact;
  return (
    <div class="sect col" style={{ gap: 8 }}>
      <h4>Fire support</h4>
      <div class="row wrap" style={{ gap: 6 }}>
        {sos.map((d) => (
          <button class="btn small danger" onClick={() => p.order({ type: 'DF', dfId: d.id })} title="Fire DF (SOS)">
            🔥 {d.label}
          </button>
        ))}
        {!sos.length && <span class="muted small">No DF (SOS) planned.</span>}
      </div>
      <div class="row wrap" style={{ gap: 6 }}>
        {dfs.map((d) => (
          <button class="btn small" onClick={() => p.order({ type: 'DF', dfId: d.id })} title={`Fire ${d.label} (${d.asset})`}>
            {d.label}
            {d.fired ? ` ×${d.fired}` : ''}
          </button>
        ))}
      </div>
      <div class="dim small">
        Amn: arty {e.ammo.ARTY} rds{e.s.own.fire.mor81 ? ` · 81mm ${e.ammo.MOR81}` : ''} · 60mm {e.ammo.MOR60}
      </div>
      {e.s.own.resources.some((r) => r.templateKey === 'QC_DET') && (
        <div class="row wrap" style={{ gap: 6 }}>
          <button class="btn small" disabled={!surv} onClick={() => p.setMode('qc')}>
            🛸 Surv QC {surv ? (surv.airborne ? '(airborne)' : surv.readyAt > e.t ? `(ready ${fmtTime(surv.readyAt, false)})` : '(ready)') : '(lost)'}
          </button>
          <button class="btn small" disabled={!aqc || !c} onClick={() => c && p.order({ type: 'AQC', contactId: c.unitId })} title="Select an en contact first">
            💥 A/QC strike
          </button>
        </div>
      )}
      {c ? (
        <div class="card tight col" style={{ gap: 6 }}>
          <b>
            Contact: {c.ident === 'UNKNOWN' ? 'unidentified' : c.ident.toLowerCase()} {c.size !== 'UNKNOWN' ? `(${c.size.toLowerCase()})` : ''} {c.vehicles ? `· ${c.vehicles} tks` : ''}
          </b>
          <div class="muted small">{e.where(c.pos)}</div>
          <div class="row wrap" style={{ gap: 6 }}>
            <button class="btn small" onClick={() => p.order({ type: 'FIRE_CONTACT', contactId: c.unitId, asset: 'ARTY' })}>
              Arty
            </button>
            {e.s.own.fire.mor81 && (
              <button class="btn small" onClick={() => p.order({ type: 'FIRE_CONTACT', contactId: c.unitId, asset: 'MOR81' })}>
                81mm
              </button>
            )}
            <button class="btn small" onClick={() => p.order({ type: 'FIRE_CONTACT', contactId: c.unitId, asset: 'MOR60' })}>
              60mm
            </button>
          </div>
          {e.s.own.fire.ucavSorties > 0 && (
            <div class="col" style={{ gap: 2 }}>
              <div class="small muted">UCAV demand ({e.ucavLeft} left) — justification:</div>
              {[
                ['armour', 'Armr / high-value tgt'],
                ['confirmed', 'Tgt confirmed & current'],
                ['outofdf', 'Beyond effective DF'],
              ].map(([k, t]) => (
                <label class="check" style={{ padding: '2px 4px' }}>
                  <input type="checkbox" checked={just.includes(k)} onChange={(ev) => setJust(ev.currentTarget.checked ? [...just, k] : just.filter((x) => x !== k))} />
                  <span class="small">{t}</span>
                </label>
              ))}
              <button class="btn small olive" disabled={e.ucavLeft <= 0} onClick={() => p.order({ type: 'UCAV', contactId: c.unitId, justification: just })}>
                ✈ Demand UCAV strike
              </button>
            </div>
          )}
        </div>
      ) : (
        <div class="dim small">Select an en contact on the map to engage it.</div>
      )}
    </div>
  );
}

function DecisionModal(p: { d: PendingDecision; e: Engine; onDecide: (i: DecisionInput) => void }) {
  const { d } = p;
  const [opt, setOpt] = useState(d.preplanned && !d.multi ? d.preplanned : '');
  const [multi, setMulti] = useState<string[]>(d.multi ? (d.preplanned ?? '').split(',').filter(Boolean) : []);
  const [unit, setUnit] = useState(d.preplannedUnit ?? '');
  const [delay, setDelay] = useState(d.preplannedDelay ?? 15);
  const cur = d.options.find((o) => o.id === opt);
  const ok = d.multi ? multi.length > 0 : !!opt;
  return (
    <Modal
      title={<span>⚠ {d.title}</span>}
      wide
      footer={
        <>
          <span class="muted small" style={{ marginRight: 'auto' }}>
            Your decision is recorded and assessed. Time is frozen while you decide.
          </span>
          <button class="btn primary" disabled={!ok} onClick={() => p.onDecide(d.multi ? { option: multi.join(','), options: multi } : { option: opt, unitId: unit || undefined, delayMin: delay })}>
            Confirm decision
          </button>
        </>
      }
    >
      <div class="decision">
        <div class="situ">{d.prompt}</div>
        {d.options.map((o) =>
          d.multi ? (
            <label class={`opt ${multi.includes(o.id) ? 'on' : ''}`} key={o.id}>
              <input type="checkbox" checked={multi.includes(o.id)} onChange={(ev) => setMulti(ev.currentTarget.checked ? [...multi, o.id] : multi.filter((x) => x !== o.id))} style={{ marginRight: 8 }} />
              {o.text}
            </label>
          ) : (
            <button class={`opt ${opt === o.id ? 'on' : ''}`} key={o.id} onClick={() => setOpt(o.id)}>
              {d.preplanned === o.id && <span class="pp badge b-blue">Your contingency plan</span>}
              {o.text}
            </button>
          ),
        )}
        {cur?.needsUnit && d.unitChoices && (
          <label class="field" style={{ marginTop: 6 }}>
            Force
            <select value={unit} onChange={(ev) => setUnit(ev.currentTarget.value)}>
              <option value="">— auto (nearest suitable) —</option>
              {d.unitChoices.map((u) => (
                <option value={u.id}>{u.label}</option>
              ))}
            </select>
          </label>
        )}
        {cur?.needsDelay && (
          <label class="field" style={{ marginTop: 6 }}>
            Launch in (min) — battle procedure, SL, route, fire sp
            <input type="number" min={0} max={120} value={delay} onInput={(ev) => setDelay(Number(ev.currentTarget.value))} />
          </label>
        )}
        {d.focus && <div class="dim small" style={{ marginTop: 8 }}>Location: {p.e.where(d.focus)} · {p.e.terrain.gridRef(d.focus)}</div>}
      </div>
    </Modal>
  );
}



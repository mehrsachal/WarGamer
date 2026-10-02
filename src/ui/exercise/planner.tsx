import { useEffect, useMemo, useState } from 'preact/hooks';
import { type Vec, bearing, dist } from '../../core/geom';
import { uid } from '../../core/rng';
import { dDay, fmtTime, splitTime } from '../../core/time';
import type { GraphicKind, Plan, PlanGraphic, PlacedUnit, Role } from '../../core/types';
import { TEMPLATES } from '../../core/units';
import { defaultRole, resourceSlots, threatBearing, workload } from '../../plan/plan';
import { symbolSvg } from '../../render/symbols';
import { MapView } from '../mapView';
import { aorBox, planScene } from '../scene';
import { toast } from '../kit';
import type { StepProps } from './flow';

// show the "mark FDLs" tip once per session, not on every placement
let fdlTipShown = false;

type Tool = 'select' | 'place' | 'measure' | 'alt' | 'face' | GraphicKind;

const TOOLS: { id: Tool; label: string; icon: string; tip: string }[] = [
  { id: 'select', label: 'Select', icon: 'M5 3l12 9-5 1 3 6-2 1-3-6-4 4z', tip: 'Select / drag to move' },
  { id: 'FDL', label: 'FDLs', icon: 'M2 14h20M5 14l2-4 2 4M13 14l2-4 2 4', tip: 'Line of FDLs (click points, double-click to finish)' },
  { id: 'KILL_AREA', label: 'Kill area', icon: 'M4 6l14-2 3 10-12 6-6-6z', tip: 'Killing area polygon (double-click to finish)' },
  { id: 'MINEFIELD', label: 'Mfd', icon: 'M3 9h18v6H3zM7 12h.01M12 12h.01M17 12h.01', tip: 'Minefield (2 clicks)' },
  { id: 'WIRE', label: 'Wire', icon: 'M2 12h20M5 9l3 6M8 9l-3 6M14 9l3 6M17 9l-3 6', tip: 'Wire obstacle (double-click to finish)' },
  { id: 'DF', label: 'DF / SOS', icon: 'M12 4a8 8 0 100 16 8 8 0 000-16zM12 7v10M7 12h10', tip: 'DF target (click)' },
  { id: 'CATK', label: 'C attk', icon: 'M3 18c4-8 9-10 15-11M15 4l4 3-4 3', tip: 'C attk axis from force to obj (double-click)' },
  { id: 'CPEN', label: 'C pen', icon: 'M4 8h16v8H4z', tip: 'Counter-penetration posn (click)' },
  { id: 'QC_AREA', label: 'QC area', icon: 'M12 3a9 9 0 100 18 9 9 0 000-18zM8 12h8', tip: 'QC surveillance area (click)' },
  { id: 'PTL_ROUTE', label: 'Ptl route', icon: 'M3 17l5-6 4 3 4-6 5 4', tip: 'Ptl / link ptl route' },
  { id: 'NOTE', label: 'Note', icon: 'M5 5h14v10H9l-4 4z', tip: 'Text note on the map' },
  { id: 'measure', label: 'Measure', icon: 'M3 17L17 3M6 14l2 2M10 10l2 2M14 6l2 2', tip: 'Measure distance & bearing' },
];

const ROLES: { id: Role; label: string }[] = [
  { id: 'FDL', label: 'FDL (fwd locality)' },
  { id: 'DEPTH', label: 'Depth' },
  { id: 'RES', label: 'Reserve / C attk force' },
  { id: 'SCREEN', label: 'Screen' },
  { id: 'SP_PTL', label: 'Standing ptl' },
  { id: 'LP', label: 'LP' },
  { id: 'OP', label: 'OP' },
  { id: 'SP_WPN', label: 'Sp wpn' },
  { id: 'OBS', label: 'Obsr' },
  { id: 'CHQ', label: 'HQ' },
  { id: 'CP', label: 'CP' },
  { id: 'QC', label: 'QC det' },
  { id: 'ENGR', label: 'Engr / pnr' },
];

function Icon(p: { d: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d={p.d} />
    </svg>
  );
}

export function Planner(p: StepProps) {
  const { s, attempt, readOnly } = p;
  const plan = attempt.plan;
  const [tool, setTool] = useState<Tool>('select');
  const [slot, setSlot] = useState<{ key: string; label: string } | null>(null);
  const [sel, setSel] = useState<{ unit?: string; graphic?: string }>({});
  const [draft, setDraft] = useState<Vec[]>([]);
  const [cursor, setCursor] = useState<Vec | null>(null);
  const [opt, setOpt] = useState({ mfd: 'PROTECTIVE', ka: 'PRIMARY', df: 'ARTY', sos: false, qcR: 600 });
  const [showDs, setShowDs] = useState(false);
  const [layers, setLayers] = useState({ grid: true, labels: true, arcs: true });
  const slots = useMemo(() => resourceSlots(s), [s.id]);
  const isDemo = attempt.exerciseId.startsWith('demo_') || p.session.role === 'INSTRUCTOR';
  const edit = (fn: (pl: Plan) => void) => {
    if (readOnly) return;
    p.update((a) => fn(a.plan));
  };
  const used = (label: string, key: string) => plan.units.some((u) => u.templateKey === key && u.label === label);
  const selUnit = plan.units.find((u) => u.id === sel.unit);
  const selGr = plan.graphics.find((g) => g.id === sel.graphic);
  const k = s.level === 'BDE' ? 3.5 : s.level === 'BN' ? 2 : s.level === 'PL' ? 0.6 : 1;

  const finishDraft = (pts = draft) => {
    const kind = tool as GraphicKind;
    const min = kind === 'KILL_AREA' ? 3 : 2;
    if (pts.length < min) {
      setDraft([]);
      return;
    }
    const props: PlanGraphic['props'] = {};
    if (kind === 'KILL_AREA') {
      props.subtype = opt.ka;
      props.label = `KA ${plan.graphics.filter((g) => g.kind === 'KILL_AREA').length + 1} (${opt.ka === 'PRIMARY' ? 'Pri' : 'Sec'})`;
    }
    if (kind === 'MINEFIELD') {
      props.subtype = opt.mfd;
      props.label = opt.mfd === 'PROTECTIVE' ? 'Prot Mfd' : opt.mfd === 'TACTICAL' ? 'A tk Mfd' : 'Nuisance Mfd';
    }
    if (kind === 'CATK') {
      const n = plan.graphics.filter((g) => g.kind === 'CATK').length + 1;
      const force = plan.units.filter((u) => u.role === 'DEPTH' || u.role === 'RES').sort((a, b) => dist(a.pos, pts[0]) - dist(b.pos, pts[0]))[0];
      props.priority = n;
      props.label = `C Attk ${n}`;
      props.unitId = force?.id;
    }
    if (kind === 'FDL') props.label = 'FDLs';
    if (kind === 'PTL_ROUTE') props.label = 'Ptl';
    const g: PlanGraphic = { id: uid('g'), kind, pts: kind === 'MINEFIELD' ? [pts[0], pts[pts.length - 1]] : pts, props };
    edit((pl) => {
      if (kind === 'FDL') pl.graphics = pl.graphics.filter((x) => x.kind !== 'FDL');
      pl.graphics.push(g);
    });
    setDraft([]);
    setSel({ graphic: g.id });
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === 'INPUT' || (e.target as HTMLElement).tagName === 'TEXTAREA' || (e.target as HTMLElement).tagName === 'SELECT') return;
      if (e.key === 'Escape') {
        setDraft([]);
        setTool('select');
        setSlot(null);
      } else if (e.key === 'Enter') finishDraft();
      else if ((e.key === 'Delete' || e.key === 'Backspace') && !readOnly) {
        if (sel.unit) edit((pl) => (pl.units = pl.units.filter((u) => u.id !== sel.unit)));
        if (sel.graphic) edit((pl) => (pl.graphics = pl.graphics.filter((g) => g.id !== sel.graphic)));
        setSel({});
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const onClick = (w: Vec, hit: { unit?: { id: string }; graphic?: PlanGraphic }) => {
    if (tool === 'select') {
      if (hit.unit) setSel({ unit: hit.unit.id });
      else if (hit.graphic) setSel({ graphic: hit.graphic.id });
      else setSel({});
      return;
    }
    if (readOnly) return;
    if (tool === 'place' && slot) {
      const key = slot.key;
      const role = defaultRole(key);
      const pos = w;
      let parentId: string | undefined;
      const tpl = TEMPLATES[key];
      if ((key === 'RIFLE_SEC' && s.level !== 'PL') || key === 'LP') {
        const locKey = s.level === 'BN' ? 'RIFLE_COY' : s.level === 'BDE' ? 'INF_BN' : 'RIFLE_PL';
        const cand = plan.units.filter((u) => u.templateKey === locKey);
        parentId = (key === 'LP' ? cand.filter((u) => u.role === 'FDL') : cand.filter((u) => u.role === 'DEPTH' || u.role === 'RES')).concat(cand).sort((a, b) => dist(a.pos, pos) - dist(b.pos, pos))[0]?.id;
      }
      const u: PlacedUnit = { id: uid('u'), templateKey: key, label: slot.label, pos, facing: threatBearing(s, pos), role: key === 'RIFLE_SEC' && s.level !== 'PL' ? 'SP_PTL' : role, parentId };
      edit((pl) => pl.units.push(u));
      setSel({ unit: u.id });
      // next free slot of the same type, else back to select
      const next = slots.find((x) => x.templateKey === key && x.label !== slot.label && !used(x.label, key));
      if (next) setSlot({ key, label: next.label });
      else {
        setSlot(null);
        setTool('select');
      }
      if (tpl.kind === 'INF' && !fdlTipShown && !plan.graphics.some((g) => g.kind === 'FDL')) {
        fdlTipShown = true;
        toast('Tip: mark the line of FDLs too (FDLs tool).');
      }
      return;
    }
    if (tool === 'alt' && selUnit) {
      edit((pl) => {
        const u = pl.units.find((x) => x.id === selUnit.id)!;
        u.altPos = w;
      });
      setTool('select');
      return;
    }
    if (tool === 'face' && selUnit) {
      edit((pl) => {
        const u = pl.units.find((x) => x.id === selUnit.id)!;
        u.facing = Math.round(bearing(u.pos, w));
      });
      setTool('select');
      return;
    }
    if (tool === 'measure') {
      setDraft(draft.length >= 2 ? [w] : [...draft, w]);
      return;
    }
    if (tool === 'DF' || tool === 'CPEN' || tool === 'QC_AREA' || tool === 'NOTE') {
      const props: PlanGraphic['props'] = {};
      if (tool === 'DF') {
        const n = plan.graphics.filter((g) => g.kind === 'DF' && !g.props.sos).length + 1;
        props.subtype = opt.df;
        props.sos = opt.sos;
        props.radius = opt.df === 'MOR60' ? 75 : opt.df === 'MOR81' ? 120 : 150;
        props.label = opt.sos ? `SOS ${opt.df === 'ARTY' ? 'Arty' : opt.df === 'MOR81' ? '81' : '60'}` : `DF ${n}`;
      }
      if (tool === 'CPEN') {
        props.label = 'C Pen';
        props.unitId = plan.units.find((u) => u.role === 'DEPTH')?.id;
      }
      if (tool === 'QC_AREA') {
        props.radius = opt.qcR * k;
        props.label = `QC area ${plan.graphics.filter((g) => g.kind === 'QC_AREA').length + 1}`;
      }
      if (tool === 'NOTE') {
        const t = prompt('Note text');
        if (!t) return;
        props.text = t;
      }
      const g: PlanGraphic = { id: uid('g'), kind: tool, pts: [w], props };
      edit((pl) => pl.graphics.push(g));
      setSel({ graphic: g.id });
      return;
    }
    // polyline tools
    const nd = [...draft, w];
    setDraft(nd);
    if (tool === 'MINEFIELD' && nd.length === 2) finishDraft(nd);
  };

  const scene = planScene(s, plan, { selectedUnitId: sel.unit, selectedGraphicId: sel.graphic, ds: showDs });
  const draftKind = tool === 'measure' ? null : (tool as string);
  if (draft.length && draftKind && tool !== 'select' && tool !== 'place') scene.draft = { kind: draftKind, pts: cursor ? [...draft, cursor] : draft };
  if (tool === 'measure' && draft.length) scene.measure = { a: draft[0], b: draft[1] ?? cursor ?? draft[0] };
  if ((tool === 'DF' || tool === 'QC_AREA') && cursor) scene.draft = { kind: tool, pts: [cursor], radius: tool === 'QC_AREA' ? opt.qcR * k : opt.df === 'MOR60' ? 75 : 150 };

  const wl = workload(s, plan);
  const hint =
    tool === 'place' && slot
      ? `Click on the map to site ${slot.label}`
      : tool === 'alt'
        ? `Click the altn posn for ${selUnit?.label}`
        : tool === 'face'
          ? `Click where ${selUnit?.label}'s primary arc should point`
          : tool !== 'select' && tool !== 'measure' && draft.length
            ? 'Double-click or Enter to finish · Esc to cancel'
            : '';

  return (
    <div class="workspace" style={{ height: '100%' }}>
      <div class="side">
        <div class="sect">
          <h4>Tools</h4>
          <div class="toolgrid">
            {TOOLS.map((t) => (
              <button
                key={t.id}
                class={tool === t.id ? 'on' : ''}
                title={t.tip}
                disabled={readOnly && t.id !== 'select' && t.id !== 'measure'}
                onClick={() => {
                  setTool(t.id);
                  setDraft([]);
                  setSlot(null);
                }}
              >
                <Icon d={t.icon} />
                {t.label}
              </button>
            ))}
          </div>
          {tool === 'MINEFIELD' && (
            <div class="row wrap" style={{ marginTop: 8 }}>
              {['PROTECTIVE', 'TACTICAL', 'NUISANCE'].map((m) => (
                <button class={`btn small ${opt.mfd === m ? 'active' : ''}`} onClick={() => setOpt({ ...opt, mfd: m })}>
                  {m === 'PROTECTIVE' ? 'Protective (AP)' : m === 'TACTICAL' ? 'A tk / tac' : 'Nuisance'}
                </button>
              ))}
            </div>
          )}
          {tool === 'KILL_AREA' && (
            <div class="row" style={{ marginTop: 8 }}>
              {['PRIMARY', 'SECONDARY'].map((m) => (
                <button class={`btn small ${opt.ka === m ? 'active' : ''}`} onClick={() => setOpt({ ...opt, ka: m })}>
                  {m === 'PRIMARY' ? 'Primary' : 'Secondary'}
                </button>
              ))}
            </div>
          )}
          {tool === 'DF' && (
            <div class="col" style={{ marginTop: 8, gap: 6 }}>
              <div class="row wrap">
                {(['ARTY', 'MOR81', 'MOR60'] as const).filter((m) => m !== 'MOR81' || s.own.fire.mor81).map((m) => (
                  <button class={`btn small ${opt.df === m ? 'active' : ''}`} onClick={() => setOpt({ ...opt, df: m })}>
                    {m === 'ARTY' ? 'Arty' : m === 'MOR81' ? '81mm' : '60mm'}
                  </button>
                ))}
              </div>
              <label class="check">
                <input type="checkbox" checked={opt.sos} onChange={(e) => setOpt({ ...opt, sos: e.currentTarget.checked })} />
                DF (SOS) — the most vulnerable apch, close to own posn
              </label>
            </div>
          )}
          {tool === 'QC_AREA' && (
            <label class="field" style={{ marginTop: 8 }}>
              Radius ({Math.round(opt.qcR * k)} m)
              <input type="range" min={300} max={1200} step={50} value={opt.qcR} onInput={(e) => setOpt({ ...opt, qcR: Number(e.currentTarget.value) })} />
            </label>
          )}
        </div>
        <div class="sect">
          <h4>Resources — click, then click the map</h4>
          <div class="palette">
            {slots.map((sl) => {
              const t = TEMPLATES[sl.templateKey];
              const u = used(sl.label, sl.templateKey);
              const on = tool === 'place' && slot?.label === sl.label && slot.key === sl.templateKey;
              return (
                <button
                  key={`${sl.templateKey}${sl.index}`}
                  class={`${on ? 'on' : ''} ${u ? 'used' : ''}`}
                  disabled={readOnly || u}
                  title={`${t.name}${sl.note ? ` — ${sl.note}` : ''}\n${t.description}`}
                  onClick={() => {
                    setTool('place');
                    setSlot({ key: sl.templateKey, label: sl.label });
                  }}
                >
                  <img src={symbolSvg(t.sidc, 20)} alt="" />
                  <span>
                    <b>{sl.label}</b>
                    <br />
                    <span class="dim">{t.short}{u ? ' · sited' : ''}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
        <div class="sect">
          <h4>Layers</h4>
          <div class="row wrap">
            {(['grid', 'labels', 'arcs'] as const).map((l) => (
              <label class="check" style={{ padding: '2px 6px' }}>
                <input type="checkbox" checked={layers[l]} onChange={(e) => setLayers({ ...layers, [l]: e.currentTarget.checked })} />
                {l}
              </label>
            ))}
            {isDemo && (
              <label class="check" style={{ padding: '2px 6px' }}>
                <input type="checkbox" checked={showDs} onChange={(e) => setShowDs(e.currentTarget.checked)} />
                DS overlay
              </label>
            )}
          </div>
        </div>
      </div>
      <MapView
        scenario={s}
        scene={scene}
        layers={layers}
        fit={aorBox(s)}
        cover
        cursor={tool === 'select' ? 'grab' : 'crosshair'}
        events={{
          onClick,
          onDblClick: () => {
            if (tool !== 'select' && tool !== 'place' && tool !== 'measure') finishDraft(draft.slice(0, -1).length >= 2 ? draft : draft);
          },
          onMove: setCursor,
          canDrag: (u) => tool === 'select' && !readOnly && plan.units.some((x) => x.id === u.id),
          onDrag: (id, w) =>
            edit((pl) => {
              const u = pl.units.find((x) => x.id === id);
              if (u) u.pos = w;
            }),
          onDragEnd: (id) => setSel({ unit: id }),
        }}
      >
        {hint && <div class="hint">{hint}</div>}
        <div class="maphud">
          <div class="hudchip" title="Time & space: how complete your defences will be by the given time">
            Def ready {Math.round(wl.readiness * 100)}%
          </div>
          <div class="hudchip">{plan.units.length} units · {plan.graphics.length} graphics</div>
        </div>
      </MapView>
      <div class="side right">
        {selUnit ? (
          <UnitProps u={selUnit} p={p} edit={edit} setTool={setTool} onDelete={() => (edit((pl) => (pl.units = pl.units.filter((u) => u.id !== selUnit.id))), setSel({}))} />
        ) : selGr ? (
          <GraphicProps g={selGr} p={p} edit={edit} onDelete={() => (edit((pl) => (pl.graphics = pl.graphics.filter((g) => g.id !== selGr.id))), setSel({}))} />
        ) : (
          <div class="sect muted small">Select a unit or graphic to edit it. Drag units to move them. <span class="kbd">Del</span> deletes, <span class="kbd">Esc</span> cancels.</div>
        )}
        <QcSorties p={p} edit={edit} />
        {p.ex.settings.hints && <Checklist p={p} />}
        <div class="sect row">
          <button class="btn" onClick={() => p.go('aprc')}>
            ← Aprc
          </button>
          <button class="btn primary right" onClick={() => p.go('cont')}>
            Contingencies →
          </button>
        </div>
      </div>
    </div>
  );
}

function UnitProps(x: { u: PlacedUnit; p: StepProps; edit: (fn: (pl: Plan) => void) => void; setTool: (t: Tool) => void; onDelete: () => void }) {
  const { u, p } = x;
  const t = TEMPLATES[u.templateKey];
  const ro = p.readOnly;
  const set = (fn: (v: PlacedUnit) => void) =>
    x.edit((pl) => {
      const v = pl.units.find((y) => y.id === u.id);
      if (v) fn(v);
    });
  const locs = p.attempt.plan.units.filter((y) => y.id !== u.id && TEMPLATES[y.templateKey]?.kind === 'INF' && y.templateKey !== 'RIFLE_SEC' && y.templateKey !== 'LP');
  return (
    <div class="sect col">
      <div class="row">
        <img src={symbolSvg(t.sidc, 26, u.label)} alt="" style={{ height: 40 }} />
        <div>
          <b>{u.label}</b>
          <div class="muted small">{t.name}</div>
        </div>
      </div>
      <div class="muted small">{t.description}</div>
      <label class="field">
        Role
        <select disabled={ro} value={u.role} onChange={(e) => set((v) => (v.role = e.currentTarget.value as Role))}>
          {ROLES.map((r) => (
            <option value={r.id}>{r.label}</option>
          ))}
        </select>
      </label>
      <label class="field">
        Primary arc (bearing {Math.round(u.facing)}°)
        <input disabled={ro} type="range" min={0} max={359} value={Math.round(u.facing)} onInput={(e) => set((v) => (v.facing = Number(e.currentTarget.value)))} />
      </label>
      <div class="row wrap">
        <button class="btn small" disabled={ro} onClick={() => x.setTool('face')}>
          🎯 Aim arc on map
        </button>
        <button class="btn small" disabled={ro} onClick={() => x.setTool('alt')}>
          ⇢ Set altn posn
        </button>
        {u.altPos && (
          <button class="btn small" disabled={ro} onClick={() => set((v) => (v.altPos = undefined))}>
            Clear altn ({Math.round(dist(u.pos, u.altPos))} m)
          </button>
        )}
      </div>
      {(u.templateKey === 'RIFLE_SEC' || u.templateKey === 'LP' || TEMPLATES[u.templateKey].kind !== 'INF') && (
        <label class="field">
          Found from / grouped with
          <select disabled={ro} value={u.parentId ?? ''} onChange={(e) => set((v) => (v.parentId = e.currentTarget.value || undefined))}>
            <option value="">—</option>
            {locs.map((l) => (
              <option value={l.id}>{l.label}</option>
            ))}
          </select>
        </label>
      )}
      <label class="field">
        Remarks
        <input disabled={ro} type="text" value={u.notes ?? ''} onInput={(e) => set((v) => (v.notes = e.currentTarget.value))} />
      </label>
      <div class="muted small mono">{p.s.terrain && `${Math.round(u.pos.x)}, ${Math.round(u.pos.y)}`}</div>
      {!ro && (
        <button class="btn danger small" onClick={x.onDelete}>
          Remove
        </button>
      )}
    </div>
  );
}

function GraphicProps(x: { g: PlanGraphic; p: StepProps; edit: (fn: (pl: Plan) => void) => void; onDelete: () => void }) {
  const { g, p } = x;
  const ro = p.readOnly;
  const set = (fn: (v: PlanGraphic) => void) =>
    x.edit((pl) => {
      const v = pl.graphics.find((y) => y.id === g.id);
      if (v) fn(v);
    });
  const forces = p.attempt.plan.units.filter((u) => TEMPLATES[u.templateKey]?.kind === 'INF' || TEMPLATES[u.templateKey]?.kind === 'ARMOUR');
  return (
    <div class="sect col">
      <b>{g.kind.replace('_', ' ')}</b>
      <label class="field">
        Label
        <input disabled={ro} type="text" value={g.props.label ?? g.props.text ?? ''} onInput={(e) => set((v) => (g.kind === 'NOTE' ? (v.props.text = e.currentTarget.value) : (v.props.label = e.currentTarget.value)))} />
      </label>
      {g.kind === 'DF' && (
        <>
          <label class="field">
            Fire unit
            <select disabled={ro} value={g.props.subtype ?? 'ARTY'} onChange={(e) => set((v) => (v.props.subtype = e.currentTarget.value))}>
              <option value="ARTY">Arty</option>
              {p.s.own.fire.mor81 && <option value="MOR81">81mm mor</option>}
              <option value="MOR60">60mm mor</option>
            </select>
          </label>
          <label class="check">
            <input disabled={ro} type="checkbox" checked={!!g.props.sos} onChange={(e) => set((v) => (v.props.sos = e.currentTarget.checked))} /> DF (SOS)
          </label>
        </>
      )}
      {g.kind === 'MINEFIELD' && (
        <label class="field">
          Type
          <select disabled={ro} value={g.props.subtype ?? 'PROTECTIVE'} onChange={(e) => set((v) => (v.props.subtype = e.currentTarget.value))}>
            <option value="PROTECTIVE">Protective (AP)</option>
            <option value="TACTICAL">A tk / tactical</option>
            <option value="NUISANCE">Nuisance</option>
          </select>
        </label>
      )}
      {g.kind === 'KILL_AREA' && (
        <label class="field">
          Type
          <select disabled={ro} value={g.props.subtype ?? 'PRIMARY'} onChange={(e) => set((v) => (v.props.subtype = e.currentTarget.value))}>
            <option value="PRIMARY">Primary</option>
            <option value="SECONDARY">Secondary</option>
          </select>
        </label>
      )}
      {(g.kind === 'CATK' || g.kind === 'CPEN') && (
        <label class="field">
          Force
          <select disabled={ro} value={g.props.unitId ?? ''} onChange={(e) => set((v) => (v.props.unitId = e.currentTarget.value || undefined))}>
            <option value="">—</option>
            {forces.map((f) => (
              <option value={f.id}>
                {f.label} ({f.role.toLowerCase()})
              </option>
            ))}
          </select>
        </label>
      )}
      {g.kind === 'CATK' && (
        <label class="field">
          Priority
          <input disabled={ro} type="number" min={1} max={5} value={g.props.priority ?? 1} onInput={(e) => set((v) => (v.props.priority = Number(e.currentTarget.value)))} />
        </label>
      )}
      {(g.kind === 'QC_AREA' || g.kind === 'DF') && (
        <label class="field">
          Radius {Math.round(g.props.radius ?? 150)} m
          <input disabled={ro} type="range" min={50} max={g.kind === 'QC_AREA' ? 3000 : 400} step={25} value={g.props.radius ?? 150} onInput={(e) => set((v) => (v.props.radius = Number(e.currentTarget.value)))} />
        </label>
      )}
      <div class="muted small">{p.s.terrain && g.pts[0] ? `Starts ${Math.round(g.pts[0].x)}, ${Math.round(g.pts[0].y)} · ${g.pts.length} pts` : ''}</div>
      {!ro && (
        <button class="btn danger small" onClick={x.onDelete}>
          Remove
        </button>
      )}
    </div>
  );
}

function QcSorties(x: { p: StepProps; edit: (fn: (pl: Plan) => void) => void }) {
  const { p } = x;
  const plan = p.attempt.plan;
  if (!p.s.own.resources.some((r) => r.templateKey === 'QC_DET')) return null;
  const areas = plan.graphics.filter((g) => g.kind === 'QC_AREA');
  const dDayN = Math.floor(p.s.times.hHour / 1440);
  const toInput = (t: number) => {
    const { hh, mm } = splitTime(t);
    return `${String(hh).padStart(2, '0')}${String(mm).padStart(2, '0')}`;
  };
  return (
    <div class="sect col" style={{ gap: 8 }}>
      <h4>QC sorties (D Day, ~35 min each)</h4>
      {plan.qcSorties.map((q, i) => (
        <div class="row" key={i}>
          <input
            type="text"
            style={{ width: 70 }}
            disabled={p.readOnly}
            value={toInput(q.start)}
            title="HHMM on D Day"
            onChange={(e) => {
              const v = Number(e.currentTarget.value.replace(/\D/g, '').padStart(4, '0').slice(0, 4));
              x.edit((pl) => (pl.qcSorties[i].start = dDay(dDayN, v)));
            }}
          />
          <select disabled={p.readOnly} value={q.areaId} onChange={(e) => x.edit((pl) => (pl.qcSorties[i].areaId = e.currentTarget.value))}>
            {areas.map((a) => (
              <option value={a.id}>{a.props.label ?? 'QC area'}</option>
            ))}
          </select>
          {!p.readOnly && (
            <button class="btn small ghost" onClick={() => x.edit((pl) => pl.qcSorties.splice(i, 1))}>
              ✕
            </button>
          )}
        </div>
      ))}
      {!areas.length && <div class="muted small">Mark a QC area on the map first.</div>}
      {areas.length > 0 && !p.readOnly && (
        <button class="btn small" onClick={() => x.edit((pl) => pl.qcSorties.push({ start: dDay(dDayN, 1800), areaId: areas[0].id }))}>
          + Add sortie
        </button>
      )}
      <div class="dim small">Times in {fmtTime(dDay(dDayN, 0)).split(' ').slice(0, 2).join(' ')} hrs (HHMM).</div>
    </div>
  );
}

function Checklist(x: { p: StepProps }) {
  const { p } = x;
  const pl = p.attempt.plan;
  const has = (k: GraphicKind, f?: (g: PlanGraphic) => boolean) => pl.graphics.some((g) => g.kind === k && (!f || f(g)));
  const role = (r: string) => pl.units.some((u) => u.role === r);
  const lvl = p.s.level;
  const items: [string, boolean][] = [
    ['Line of FDLs marked', has('FDL')],
    ['Fwd & depth localities sited', role('FDL') && (lvl === 'PL' || role('DEPTH') || role('RES'))],
    ['Pri killing area', has('KILL_AREA')],
    ['DF (SOS)', has('DF', (g) => !!g.props.sos)],
    ['DFs on likely FAA/FUP/BOF', pl.graphics.filter((g) => g.kind === 'DF' && !g.props.sos).length >= 3],
    ['Obs (mfd / wire)', has('MINEFIELD') || has('WIRE')],
    ...(lvl !== 'PL' ? ([['Standing ptl', role('SP_PTL')], ['C attk planned', has('CATK')], ['C pen posn', has('CPEN')]] as [string, boolean][]) : []),
    ...(lvl === 'COY' || lvl === 'PL' ? ([['LP(s)', role('LP')]] as [string, boolean][]) : []),
    ...(lvl !== 'PL' ? ([['Loc for screens', role('SCREEN')]] as [string, boolean][]) : []),
    ['Altn posns', pl.units.some((u) => u.altPos)],
    ['HQ / CP sited', role('CHQ')],
    ...(p.s.own.resources.some((r) => r.templateKey === 'QC_DET') ? ([['QC area & sorties', has('QC_AREA') && pl.qcSorties.length > 0]] as [string, boolean][]) : []),
  ];
  const done = items.filter((i) => i[1]).length;
  return (
    <div class="sect">
      <h4>
        Completeness {done}/{items.length}
      </h4>
      <div class="muted small" style={{ marginBottom: 6 }}>
        Checks that items exist — not whether they are well sited. That is assessed after submission.
      </div>
      {items.map(([t, ok]) => (
        <div class="small" style={{ padding: '2px 0', color: ok ? '#8fdd92' : '#94a3af' }}>
          {ok ? '✔' : '○'} {t}
        </div>
      ))}
    </div>
  );
}

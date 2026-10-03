import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { type Vec, add, bearing, centroid, dist, sub } from '../../core/geom';
import { uid } from '../../core/rng';
import type { GraphicKind, Plan, PlanGraphic, PlacedUnit, Role } from '../../core/types';
import { TEMPLATES } from '../../core/units';
import { defaultArea, eggPoints, fitFreehand, isAreaUnit, setUnitArea } from '../../plan/area';
import { defaultRole, resourceSlots, threatBearing, workload } from '../../plan/plan';
import { FOUND_ROLES, defaultFoundBy, foundLabel, groupUnits, localities, removeUnits, ungroup } from '../../plan/taskorg';
import { symbolSvg } from '../../render/symbols';
import { toast } from '../kit';
import { type MapPointer, MapView } from '../mapView';
import { aorBox, planScene } from '../scene';
import type { StepProps } from './flow';
import { Checklist, COLORS, GraphicProps, GroupProps, MultiProps, QcSorties, SymbolPicker, TaskOrg, UnitProps } from './planPanels';
import {
  EMPTY_SEL,
  type Handle,
  type Hit,
  type PaletteItem,
  type Selection,
  boxSelect,
  dedupe,
  deleteVertex,
  dragHandle,
  handleAt,
  handlesFor,
  hitTest,
  insertVertex,
  layerOf,
  moveSelection,
} from './planEdit';

// show the "mark FDLs" tip once per session, not on every placement
let fdlTipShown = false;
/** Graphics clipboard (Ctrl+C / Ctrl+V), shared across planner instances. */
let clipboard: PlanGraphic[] = [];

type Preset = 'FDL' | 'KILL_AREA' | 'MINEFIELD' | 'WIRE' | 'DF' | 'CATK' | 'CPEN' | 'QC_AREA' | 'PTL_ROUTE' | 'NOTE';
type DrawTool = 'pen' | 'line' | 'poly' | 'arrow' | 'circle' | 'text' | 'symbol' | 'shape' | 'measure';
type Tool = 'select' | 'place' | 'alt' | 'face' | 'drawArea' | DrawTool | Preset;

/** Tools that build a polyline/polygon by clicking points (double-click / Enter to finish). */
const CLICK_PTS = new Set<Tool>(['line', 'poly', 'arrow', 'shape', 'FDL', 'KILL_AREA', 'MINEFIELD', 'WIRE', 'CATK', 'PTL_ROUTE']);

const DRAW_TOOLS: { id: DrawTool | 'select'; label: string; icon: string; tip: string }[] = [
  { id: 'select', label: 'Select', icon: 'M5 3l12 9-5 1 3 6-2 1-3-6-4 4z', tip: 'Select & edit (V) — click, Shift-click to add, Shift-drag to box-select; drag to move' },
  { id: 'pen', label: 'Pen', icon: 'M4 20c3-1 4-4 6-7s5-6 10-9M14 4l6 6', tip: 'Freehand (P) — drag to draw; release near the start to close an area' },
  { id: 'line', label: 'Line', icon: 'M4 18L10 8l5 6 5-9', tip: 'Line (L) — click points, double-click / Enter to finish, Backspace removes the last point' },
  { id: 'poly', label: 'Polygon', icon: 'M5 7l9-3 6 7-5 9-10-3z', tip: 'Polygon area — click points, double-click / Enter to close' },
  { id: 'arrow', label: 'Arrow', icon: 'M4 18c5-1 9-5 12-11M12 5l5 1-1 5', tip: 'Arrow / axis (A) — click points, double-click to finish' },
  { id: 'circle', label: 'Ellipse', icon: 'M12 5c5 0 9 3 9 7s-4 7-9 7-9-3-9-7 4-7 9-7z', tip: 'Circle / ellipse area — drag a box (Shift = circle)' },
  { id: 'text', label: 'Text', icon: 'M5 6h14M12 6v13', tip: 'Text (T) — click and type' },
  { id: 'symbol', label: 'Symbol', icon: 'M12 3l3 6 6 1-4 4 1 7-6-3-6 3 1-7-4-4 6-1z', tip: 'Stamp a NATO point symbol / obstacle from the palette' },
  { id: 'measure', label: 'Measure', icon: 'M3 17L17 3M6 14l2 2M10 10l2 2M14 6l2 2', tip: 'Measure distance & bearing (M)' },
];

const PRESETS: { id: Preset; label: string; icon: string; tip: string }[] = [
  { id: 'FDL', label: 'FDLs', icon: 'M2 14h20M5 14l2-4 2 4M13 14l2-4 2 4', tip: 'Line of FDLs (click points, double-click to finish)' },
  { id: 'KILL_AREA', label: 'Kill area', icon: 'M4 6l14-2 3 10-12 6-6-6z', tip: 'Killing area polygon (double-click to finish)' },
  { id: 'MINEFIELD', label: 'Mfd', icon: 'M3 9h18v6H3zM7 12h.01M12 12h.01M17 12h.01', tip: 'Minefield (2 clicks, or more points + double-click)' },
  { id: 'WIRE', label: 'Wire', icon: 'M2 12h20M5 9l3 6M8 9l-3 6M14 9l3 6M17 9l-3 6', tip: 'Wire obstacle (double-click to finish)' },
  { id: 'DF', label: 'DF / SOS', icon: 'M12 4a8 8 0 100 16 8 8 0 000-16zM12 7v10M7 12h10', tip: 'DF target (click)' },
  { id: 'CATK', label: 'C attk', icon: 'M3 18c4-8 9-10 15-11M15 4l4 3-4 3', tip: 'C attk axis from force to obj (double-click)' },
  { id: 'CPEN', label: 'C pen', icon: 'M4 12c0-3 4-5 8-5s8 2 8 5-4 5-8 5-8-2-8-5z', tip: 'Counter-penetration posn (click)' },
  { id: 'QC_AREA', label: 'QC area', icon: 'M12 3a9 9 0 100 18 9 9 0 000-18zM8 12h8', tip: 'QC surveillance area (click)' },
  { id: 'PTL_ROUTE', label: 'Ptl route', icon: 'M3 17l5-6 4 3 4-6 5 4', tip: 'Ptl / link ptl route' },
  { id: 'NOTE', label: 'Note', icon: 'M5 5h14v10H9l-4 4z', tip: 'Text note on the map' },
];

type LayerKey = 'grid' | 'labels' | 'arcs' | 'units' | 'eggs' | 'fire' | 'obstacles' | 'manoeuvre' | 'free';
const LAYER_LABELS: [LayerKey, string][] = [
  ['units', 'Units'],
  ['eggs', 'Eggs'],
  ['arcs', 'Arcs'],
  ['fire', 'Fire plan'],
  ['obstacles', 'Obstacles'],
  ['manoeuvre', 'Manoeuvre'],
  ['free', 'Free drawing'],
  ['labels', 'Labels'],
  ['grid', 'Grid'],
];

function Icon(p: { d: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d={p.d} />
    </svg>
  );
}

type Snap = Pick<Plan, 'units' | 'graphics' | 'groups' | 'qcSorties'>;
const snapOf = (pl: Plan): string => JSON.stringify({ units: pl.units, graphics: pl.graphics, groups: pl.groups, qcSorties: pl.qcSorties } as Snap);
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));

interface Gesture {
  kind: 'move' | 'handle' | 'box' | 'pen' | 'circle' | 'none';
  start: Vec;
  sx: number;
  sy: number;
  moved: boolean;
  orig?: Plan;
  before?: string;
  handle?: Handle;
  sel?: Selection;
  pts?: Vec[];
  additive?: Selection;
  toggle?: Hit;
}

export function Planner(p: StepProps) {
  const { s, attempt, readOnly } = p;
  const plan = attempt.plan;
  const [tool, setToolRaw] = useState<Tool>('select');
  const [slot, setSlot] = useState<{ key: string; label: string } | null>(null);
  const [foundBy, setFoundBy] = useState('');
  const [sel, setSel] = useState<Selection>(EMPTY_SEL);
  const [draft, setDraft] = useState<Vec[]>([]);
  const [cursor, setCursor] = useState<Vec | null>(null);
  const [box, setBox] = useState<{ a: Vec; b: Vec } | null>(null);
  const [hud, setHud] = useState<string | null>(null);
  const [hot, setHot] = useState<Handle | undefined>(undefined);
  const [hoverHit, setHoverHit] = useState(false);
  const [opt, setOpt] = useState({ mfd: 'PROTECTIVE', ka: 'PRIMARY', df: 'ARTY', sos: false, qcR: 600 });
  const [style, setStyle] = useState<{ color: NonNullable<PlanGraphic['props']['color']>; width: number; dash: boolean }>({ color: 'BLUE', width: 2.5, dash: false });
  const [symItem, setSymItem] = useState<PaletteItem | null>(null);
  const [shapeItem, setShapeItem] = useState<{ id: string; name: string; kind: GraphicKind; subtype?: string } | null>(null);
  const [showDs, setShowDs] = useState(false);
  const [tab, setTab] = useState<'edit' | 'org' | 'checks'>('edit');
  const [layers, setLayers] = useState<Record<LayerKey, boolean>>({ grid: true, labels: true, arcs: true, units: true, eggs: true, fire: true, obstacles: true, manoeuvre: true, free: true });
  const [textEdit, setTextEdit] = useState<{ id: string; sx: number; sy: number; value: string; isNew: boolean } | null>(null);
  const [, setHistTick] = useState(0);
  const hist = useRef<{ past: string[]; future: string[] }>({ past: [], future: [] });
  const gesture = useRef<Gesture | null>(null);
  const mpp = useRef(1);
  const lastPx = useRef({ sx: 0, sy: 0 });
  const planRef = useRef(plan);
  planRef.current = plan;
  const slots = useMemo(() => resourceSlots(s), [s.id]);
  const isDemo = attempt.exerciseId.startsWith('demo_') || p.session.role === 'INSTRUCTOR';
  const k = s.level === 'BDE' ? 3.5 : s.level === 'BN' ? 2 : s.level === 'PL' ? 0.6 : 1;

  // ------------------------------------------------------------------ edits & history
  const edit = (fn: (pl: Plan) => void) => {
    if (readOnly) return;
    p.update((a) => fn(a.plan));
  };
  const pushHistory = (snap: string) => {
    const h = hist.current;
    if (h.past[h.past.length - 1] === snap) return;
    h.past.push(snap);
    if (h.past.length > 100) h.past.shift();
    h.future = [];
    setHistTick((x) => x + 1);
  };
  const commit = (fn: (pl: Plan) => void) => {
    if (readOnly) return;
    pushHistory(snapOf(planRef.current));
    edit(fn);
  };
  const restore = (snap: string) => {
    const v = JSON.parse(snap) as Snap;
    edit((pl) => {
      pl.units = v.units;
      pl.graphics = v.graphics;
      pl.qcSorties = v.qcSorties;
      if (v.groups) pl.groups = v.groups;
      else delete pl.groups;
    });
    // keep whatever is still there selected (undoing a reshape keeps the item in hand)
    const uids = new Set(v.units.map((u) => u.id));
    const gids = new Set(v.graphics.map((g) => g.id));
    setSel((cur) => ({
      units: cur.units.filter((id) => uids.has(id)),
      graphics: cur.graphics.filter((id) => gids.has(id)),
      group: cur.group && v.groups?.some((g) => g.id === cur.group) ? cur.group : undefined,
    }));
  };
  const undo = () => {
    const h = hist.current;
    const prev = h.past.pop();
    if (!prev || readOnly) return;
    h.future.push(snapOf(planRef.current));
    restore(prev);
    setHistTick((x) => x + 1);
  };
  const redo = () => {
    const h = hist.current;
    const next = h.future.pop();
    if (!next || readOnly) return;
    h.past.push(snapOf(planRef.current));
    restore(next);
    setHistTick((x) => x + 1);
  };

  const setTool = (t: Tool) => {
    setToolRaw(t);
    setDraft([]);
    setHud(null);
    if (t !== 'place') setSlot(null);
  };

  // ------------------------------------------------------------------ derived
  const used = (label: string, key: string) => plan.units.find((u) => u.templateKey === key && u.label === label);
  const selUnit = sel.units.length === 1 && !sel.graphics.length && !sel.group ? plan.units.find((u) => u.id === sel.units[0]) : undefined;
  const selGr = sel.graphics.length === 1 && !sel.units.length && !sel.group ? plan.graphics.find((g) => g.id === sel.graphics[0]) : undefined;
  const visGraphics = plan.graphics.filter((g) => layers[layerOf(g.kind)]);
  const scene = planScene(s, { ...plan, graphics: visGraphics }, { selectedUnitIds: sel.units, selectedGraphicIds: sel.graphics, selectedGroupId: sel.group, ds: showDs });
  if (!layers.units) {
    scene.units = [];
    scene.groups = [];
  } else if (!layers.eggs) {
    scene.units = scene.units.map((u) => ({ ...u, area: undefined, altArea: undefined }));
    scene.groups = [];
  }
  const editable = !readOnly && tool === 'select';
  const handles = editable && (layers.units || !sel.units.length) ? handlesFor(plan, sel, mpp.current) : [];
  scene.handles = handles.map((h) => ({ p: h.p, kind: h.kind, hot: !!hot && hot.kind === h.kind && hot.i === h.i && hot.id === h.id && hot.axis === h.axis && hot.sign === h.sign }));
  scene.box = box;
  const closedDraft = tool === 'poly' || tool === 'KILL_AREA' || (tool === 'shape' && shapeItem?.kind === 'AREA');
  if (draft.length && CLICK_PTS.has(tool)) scene.draft = { kind: tool === 'shape' ? 'AREA' : tool, pts: cursor ? [...draft, cursor] : draft, closed: closedDraft };
  if ((tool === 'pen' || tool === 'drawArea') && draft.length) {
    const closing = tool === 'drawArea' || (draft.length > 6 && dist(draft[0], draft[draft.length - 1]) < 18 * mpp.current);
    scene.draft = { kind: 'FREEHAND', pts: draft, closed: closing };
  }
  if (tool === 'circle' && draft.length === 2) scene.draft = { kind: 'CIRCLE', pts: draft };
  if (tool === 'measure' && draft.length) scene.measure = { a: draft[0], b: draft[1] ?? cursor ?? draft[0] };
  if ((tool === 'DF' || tool === 'QC_AREA') && cursor) scene.draft = { kind: tool, pts: [cursor], radius: tool === 'QC_AREA' ? opt.qcR * k : opt.df === 'MOR60' ? 75 : 150 };
  const hitOpts = { units: layers.units, eggs: layers.eggs };
  const hitAt = (w: Vec, m: number) => hitTest(plan, visGraphics, scene.groups ?? [], w, m, hitOpts);

  // ------------------------------------------------------------------ creation helpers
  const nOf = (kind: GraphicKind) => plan.graphics.filter((g) => g.kind === kind).length + 1;
  const addGraphic = (g: PlanGraphic) => {
    commit((pl) => {
      if (g.kind === 'FDL') pl.graphics = pl.graphics.filter((x) => x.kind !== 'FDL');
      pl.graphics.push(g);
    });
    setSel({ units: [], graphics: [g.id] });
    setTab('edit');
  };
  const finishDraft = (pts0 = draft) => {
    const pts = dedupe(pts0, 3 * mpp.current);
    setDraft([]);
    if (!CLICK_PTS.has(tool)) return;
    const props: PlanGraphic['props'] = {};
    let kind: GraphicKind;
    if (tool === 'line') {
      kind = 'FREE';
      Object.assign(props, { color: style.color, width: style.width, dash: style.dash || undefined, smooth: false });
    } else if (tool === 'poly') {
      kind = 'AREA';
      Object.assign(props, { color: style.color, width: Math.min(style.width, 2.5), dash: style.dash || undefined, smooth: false, fill: true, closed: true });
    } else if (tool === 'arrow') {
      kind = 'ARROW';
      Object.assign(props, { color: style.color, width: Math.max(2.5, style.width), dash: style.dash || undefined, smooth: true });
    } else if (tool === 'shape' && shapeItem) {
      kind = shapeItem.kind;
      props.subtype = shapeItem.subtype;
      if (shapeItem.kind === 'AREA') Object.assign(props, { label: shapeItem.subtype === 'AA' ? 'AA' : undefined, closed: true, fill: true, smooth: true, color: 'BLUE' });
      if (shapeItem.kind === 'PHASE_LINE') props.label = `${nOf('PHASE_LINE')}`;
    } else kind = tool as GraphicKind;
    const min = kind === 'KILL_AREA' || kind === 'AREA' ? 3 : 2;
    if (pts.length < min) return;
    if (kind === 'KILL_AREA') {
      props.subtype = opt.ka;
      props.label = `KA ${nOf('KILL_AREA')} (${opt.ka === 'PRIMARY' ? 'Pri' : 'Sec'})`;
    }
    if (kind === 'MINEFIELD') {
      props.subtype = opt.mfd;
      props.label = opt.mfd === 'PROTECTIVE' ? 'Prot Mfd' : opt.mfd === 'TACTICAL' ? 'A tk Mfd' : 'Nuisance Mfd';
    }
    if (kind === 'CATK') {
      const n = nOf('CATK');
      const force = plan.units.filter((u) => u.role === 'DEPTH' || u.role === 'RES').sort((a, b) => dist(a.pos, pts[0]) - dist(b.pos, pts[0]))[0];
      props.priority = n;
      props.label = `C Attk ${n}`;
      props.unitId = force?.id;
    }
    if (kind === 'FDL') props.label = 'FDLs';
    if (kind === 'PTL_ROUTE') props.label = 'Ptl';
    addGraphic({ id: uid('g'), kind, pts, props });
  };

  const placeUnit = (w: Vec) => {
    if (!slot) return;
    const key = slot.key;
    const tpl = TEMPLATES[key];
    const role: Role = key === 'RIFLE_SEC' && s.level !== 'PL' ? 'SP_PTL' : defaultRole(key);
    const isFound = FOUND_ROLES.has(role);
    // an explicit "Found by" choice wins (if that locality still exists), else the nearest suitable one
    const chosen = foundBy && plan.units.some((x) => x.id === foundBy) ? foundBy : '';
    const parentId = isFound ? chosen || (role === 'SCREEN' ? undefined : defaultFoundBy(plan, role, w)) : undefined;
    const u: PlacedUnit = { id: uid('u'), templateKey: key, label: slot.label, pos: w, facing: threatBearing(s, w), role, parentId };
    if (isAreaUnit(u)) u.area = defaultArea(u);
    commit((pl) => pl.units.push(u));
    setSel({ units: [u.id], graphics: [] });
    setTab('edit');
    const next = slots.find((x) => x.templateKey === key && x.label !== slot.label && !used(x.label, key));
    if (next) setSlot({ key, label: next.label });
    else setTool('select');
    if (isFound && parentId) toast(`${slot.label} found by ${plan.units.find((x) => x.id === parentId)?.label} — change it under “Found by”.`);
    if (tpl.kind === 'INF' && !fdlTipShown && !plan.graphics.some((g) => g.kind === 'FDL')) {
      fdlTipShown = true;
      toast('Tip: mark the line of FDLs too (FDLs tool).');
    }
  };

  const deleteSelection = () => {
    if (readOnly) return;
    const s0 = sel;
    if (!s0.units.length && !s0.graphics.length && !s0.group) return;
    commit((pl) => {
      if (s0.units.length) removeUnits(pl, s0.units);
      if (s0.graphics.length) {
        pl.graphics = pl.graphics.filter((g) => !s0.graphics.includes(g.id));
        pl.qcSorties = pl.qcSorties.filter((q) => !s0.graphics.includes(q.areaId));
      }
      if (s0.group) ungroup(pl, s0.group);
    });
    setSel(EMPTY_SEL);
  };
  const duplicate = (src: PlanGraphic[], off: Vec) => {
    if (!src.length) return;
    const copies = src.map((g) => ({ ...clone(g), id: uid('g'), pts: g.pts.map((q) => add(q, off)) }));
    commit((pl) => {
      for (const c of copies) if (c.kind !== 'FDL') pl.graphics.push(c);
    });
    setSel({ units: [], graphics: copies.filter((c) => c.kind !== 'FDL').map((c) => c.id) });
  };

  const commitText = (te = textEdit, cancel = false) => {
    if (!te) return;
    setTextEdit(null);
    if (cancel || !te.value.trim()) {
      if (te.isNew) {
        edit((pl) => (pl.graphics = pl.graphics.filter((g) => g.id !== te.id)));
        hist.current.past.pop();
        setSel(EMPTY_SEL);
      }
      return;
    }
    edit((pl) => {
      const g = pl.graphics.find((x) => x.id === te.id);
      if (g) g.props.text = te.value;
    });
  };

  // ------------------------------------------------------------------ keyboard
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      const ctrl = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      if (ctrl && key === 'z' && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if (ctrl && (key === 'y' || (key === 'z' && e.shiftKey))) {
        e.preventDefault();
        redo();
      } else if (ctrl && key === 'd') {
        e.preventDefault();
        duplicate(plan.graphics.filter((g) => sel.graphics.includes(g.id)), { x: 30 * mpp.current, y: -30 * mpp.current });
      } else if (ctrl && key === 'c') {
        clipboard = clone(plan.graphics.filter((g) => sel.graphics.includes(g.id)));
        if (clipboard.length) toast(`${clipboard.length} graphic${clipboard.length > 1 ? 's' : ''} copied`);
      } else if (ctrl && key === 'v') {
        if (!clipboard.length || readOnly) return;
        const c = centroid(clipboard.flatMap((g) => g.pts));
        duplicate(clipboard, cursor ? sub(cursor, c) : { x: 40 * mpp.current, y: -40 * mpp.current });
      } else if (e.key === 'Escape') {
        if (draft.length) setDraft([]);
        else if (tool !== 'select') setTool('select');
        else setSel(EMPTY_SEL);
      } else if (e.key === 'Enter') finishDraft();
      else if (e.key === 'Backspace' && draft.length) {
        e.preventDefault();
        setDraft(draft.slice(0, -1));
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        deleteSelection();
      } else if (!ctrl && !e.altKey) {
        const map: Record<string, Tool> = { v: 'select', p: 'pen', l: 'line', a: 'arrow', t: 'text', m: 'measure' };
        if (map[key] && !readOnly) setTool(map[key]);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // ------------------------------------------------------------------ pointer gestures
  const onPointerDown = (pt: MapPointer): boolean => {
    mpp.current = pt.mPerPx;
    if (pt.button !== 0) return false;
    if (textEdit) commitText();
    const g0: Gesture = { kind: 'none', start: pt.w, sx: pt.sx, sy: pt.sy, moved: false };
    if (readOnly) return false;
    if (tool === 'select') {
      const h = handleAt(handles, pt.w, pt.mPerPx);
      if (h) {
        if (pt.alt && h.kind === 'vertex') {
          commit((pl) => deleteVertex(pl, h));
          gesture.current = g0;
          return true;
        }
        const before = snapOf(plan);
        let hh = h;
        const orig = clone(plan);
        if (h.kind === 'mid') {
          const idx = insertVertex(orig, h, pt.w);
          hh = { ...h, kind: 'vertex', i: idx };
          edit((pl) => {
            pl.units = clone(orig.units);
            pl.graphics = clone(orig.graphics);
          });
        }
        gesture.current = { ...g0, kind: 'handle', handle: hh, orig, before };
        return true;
      }
      const hit = hitAt(pt.w, pt.mPerPx);
      // Shift: click toggles the item under the pointer; Shift-drag box-selects (even from inside an area)
      if (pt.shift && hit?.kind !== 'group') {
        gesture.current = { ...g0, kind: 'box', additive: sel, toggle: hit ?? undefined };
        return true;
      }
      if (!hit) return false;
      const inSel = hit.kind === 'unit' ? sel.units.includes(hit.id) : hit.kind === 'graphic' ? sel.graphics.includes(hit.id) : sel.group === hit.id;
      const ns: Selection = inSel ? sel : hit.kind === 'unit' ? { units: [hit.id], graphics: [] } : hit.kind === 'graphic' ? { units: [], graphics: [hit.id] } : { units: [], graphics: [], group: hit.id };
      setSel(ns);
      setTab('edit');
      gesture.current = { ...g0, kind: 'move', orig: clone(plan), before: snapOf(plan), sel: ns };
      return true;
    }
    if (tool === 'pen' || tool === 'drawArea') {
      gesture.current = { ...g0, kind: 'pen', pts: [pt.w] };
      setDraft([pt.w]);
      return true;
    }
    if (tool === 'circle') {
      gesture.current = { ...g0, kind: 'circle' };
      setDraft([pt.w, pt.w]);
      return true;
    }
    if (tool === 'text') {
      const g: PlanGraphic = { id: uid('g'), kind: 'TEXT', pts: [pt.w], props: { text: '', color: style.color === 'BLUE' ? 'BLACK' : style.color, width: 2 } };
      commit((pl) => pl.graphics.push(g));
      setSel({ units: [], graphics: [g.id] });
      setTextEdit({ id: g.id, sx: pt.sx, sy: pt.sy, value: '', isNew: true });
      gesture.current = g0;
      return true;
    }
    return false;
  };

  const onPointerMove = (pt: MapPointer) => {
    const g = gesture.current;
    if (!g) return;
    const px = Math.hypot(pt.sx - g.sx, pt.sy - g.sy);
    if (g.kind === 'move' && g.orig && g.sel) {
      if (!g.moved && px < 3) return;
      g.moved = true;
      const d = sub(pt.w, g.start);
      edit((pl) => moveSelection(pl, g.orig!, g.sel!, d));
      setHud(`${Math.round(Math.hypot(d.x, d.y))} m  ${Math.round(bearing(g.start, pt.w))}°`);
    } else if (g.kind === 'handle' && g.orig && g.handle) {
      g.moved = true;
      let msg: string | undefined;
      edit((pl) => (msg = dragHandle(pl, g.orig!, g.handle!, g.start, pt.w)));
      setHud(msg ?? null);
    } else if (g.kind === 'box') {
      if (!g.moved && px < 4) return;
      g.moved = true;
      setBox({ a: g.start, b: pt.w });
    } else if (g.kind === 'pen' && g.pts) {
      const last = g.pts[g.pts.length - 1];
      if (dist(last, pt.w) > 2 * pt.mPerPx) {
        g.pts.push(pt.w);
        setDraft([...g.pts]);
      }
    } else if (g.kind === 'circle') {
      let b = pt.w;
      if (pt.shift) {
        const r = Math.max(Math.abs(pt.w.x - g.start.x), Math.abs(pt.w.y - g.start.y));
        b = { x: g.start.x + Math.sign(pt.w.x - g.start.x || 1) * r, y: g.start.y + Math.sign(pt.w.y - g.start.y || 1) * r };
      }
      setDraft([g.start, b]);
      setHud(`${Math.round(Math.abs(b.x - g.start.x))} × ${Math.round(Math.abs(b.y - g.start.y))} m`);
    }
  };

  const onPointerUp = (pt: MapPointer) => {
    const g = gesture.current;
    gesture.current = null;
    setHud(null);
    if (!g) return;
    if ((g.kind === 'move' || g.kind === 'handle') && g.moved && g.before) pushHistory(g.before);
    else if (g.kind === 'handle' && !g.moved && g.before && g.handle && g.orig) {
      // a click on an insert point still inserts a vertex
      if (snapOf(planRef.current) !== g.before) pushHistory(g.before);
    } else if (g.kind === 'box') {
      setBox(null);
      const base = g.additive ?? EMPTY_SEL;
      if (!g.moved) {
        const t = g.toggle;
        if (!t || t.kind === 'group') return;
        const ns: Selection = { units: [...base.units], graphics: [...base.graphics] };
        const arr = t.kind === 'unit' ? ns.units : ns.graphics;
        const i = arr.indexOf(t.id);
        if (i >= 0) arr.splice(i, 1);
        else arr.push(t.id);
        setSel(ns);
        setTab('edit');
        return;
      }
      const b = boxSelect(plan, visGraphics, g.start, pt.w, { units: layers.units });
      setSel({ units: [...new Set([...base.units, ...b.units])], graphics: [...new Set([...base.graphics, ...b.graphics])] });
      setTab('edit');
    } else if (g.kind === 'pen' && g.pts) {
      setDraft([]);
      const raw = g.pts;
      if (raw.length < 3) return;
      if (tool === 'drawArea' && selUnit) {
        const fitted = fitFreehand(raw, true, 8, 14);
        if (fitted.length >= 3) commit((pl) => {
          const u = pl.units.find((x) => x.id === selUnit.id);
          if (u) setUnitArea(u, fitted);
        });
        setTool('select');
        return;
      }
      const closed = raw.length > 6 && dist(raw[0], raw[raw.length - 1]) < 18 * pt.mPerPx;
      const fitted = fitFreehand(raw, closed, closed ? 8 : 2, 16);
      if (fitted.length < 2) return;
      addGraphic({ id: uid('g'), kind: 'FREE', pts: fitted, props: { color: style.color, width: style.width, dash: style.dash || undefined, smooth: true, closed: closed || undefined, fill: closed || undefined } });
    } else if (g.kind === 'circle') {
      setDraft([]);
      const a = g.start;
      const b = draft[1] ?? pt.w;
      const rx = Math.abs(b.x - a.x) / 2;
      const ry = Math.abs(b.y - a.y) / 2;
      if (rx < 6 * pt.mPerPx && ry < 6 * pt.mPerPx) return;
      const c = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      addGraphic({ id: uid('g'), kind: 'AREA', pts: eggPoints(c, Math.max(rx, 5), Math.max(ry, 5), 0, 8), props: { color: style.color, width: Math.min(2.5, style.width), dash: style.dash || undefined, smooth: true, fill: true, closed: true } });
    }
  };

  const onClick = (w: Vec) => {
    if (tool === 'select') {
      if (readOnly) {
        const hit = hitAt(w, mpp.current);
        setSel(!hit ? EMPTY_SEL : hit.kind === 'unit' ? { units: [hit.id], graphics: [] } : hit.kind === 'graphic' ? { units: [], graphics: [hit.id] } : { units: [], graphics: [], group: hit.id });
      } else setSel(EMPTY_SEL);
      return;
    }
    if (tool === 'measure') {
      setDraft(draft.length >= 2 ? [w] : [...draft, w]);
      return;
    }
    if (readOnly) return;
    if (tool === 'place' && slot) return placeUnit(w);
    if (tool === 'alt' && selUnit) {
      commit((pl) => {
        const u = pl.units.find((x) => x.id === selUnit.id);
        if (u) u.altPos = w;
      });
      setTool('select');
      return;
    }
    if (tool === 'face' && selUnit) {
      commit((pl) => {
        const u = pl.units.find((x) => x.id === selUnit.id);
        if (u) u.facing = Math.round(bearing(u.pos, w));
      });
      setTool('select');
      return;
    }
    if (tool === 'symbol' && symItem) {
      const kind: GraphicKind = symItem.kind ?? 'SYMBOL';
      addGraphic({ id: uid('g'), kind, pts: [w], props: kind === 'TRP' ? { label: `TRP ${nOf('TRP')}` } : { sidc: symItem.sidc, label: undefined } });
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
        props.label = `QC area ${nOf('QC_AREA')}`;
      }
      if (tool === 'NOTE') {
        const g: PlanGraphic = { id: uid('g'), kind: 'NOTE', pts: [w], props: { text: '' } };
        commit((pl) => pl.graphics.push(g));
        setSel({ units: [], graphics: [g.id] });
        setTextEdit({ id: g.id, sx: lastPx.current.sx, sy: lastPx.current.sy, value: '', isNew: true });
        return;
      }
      addGraphic({ id: uid('g'), kind: tool, pts: [w], props });
      return;
    }
    if (CLICK_PTS.has(tool)) {
      const nd = [...draft, w];
      setDraft(nd);
      if (tool === 'MINEFIELD' && nd.length === 2) finishDraft(nd);
    }
  };

  const onDblClick = (w: Vec) => {
    if (CLICK_PTS.has(tool)) return finishDraft();
    if (tool !== 'select' || readOnly) return;
    const hit = hitAt(w, mpp.current);
    const g = hit?.kind === 'graphic' ? plan.graphics.find((x) => x.id === hit.id) : undefined;
    if (g && (g.kind === 'TEXT' || g.kind === 'NOTE')) setTextEdit({ id: g.id, sx: lastPx.current.sx, sy: lastPx.current.sy, value: g.props.text ?? '', isNew: false });
  };

  const onContext = (w: Vec) => {
    if (tool !== 'select' || readOnly) {
      if (draft.length) setDraft(draft.slice(0, -1));
      return;
    }
    const h = handleAt(handles, w, mpp.current);
    if (h?.kind === 'vertex') commit((pl) => deleteVertex(pl, h));
  };

  const onHover = (pt: MapPointer) => {
    mpp.current = pt.mPerPx;
    lastPx.current = { sx: pt.sx, sy: pt.sy };
    setCursor(pt.w);
    if (tool === 'select' && !gesture.current) {
      const h = handleAt(handles, pt.w, pt.mPerPx);
      setHot(h);
      setHoverHit(!h && !readOnly && !!hitAt(pt.w, pt.mPerPx));
    }
  };

  // ------------------------------------------------------------------ view
  const wl = workload(s, plan);
  const hint =
    tool === 'place' && slot
      ? `Click on the map to site ${slot.label}`
      : tool === 'alt'
        ? `Click the altn posn for ${selUnit?.label}`
        : tool === 'face'
          ? `Click where ${selUnit?.label}'s primary arc should point`
          : tool === 'drawArea'
            ? `Draw the outline of ${selUnit?.label}'s locality (drag a closed loop)`
            : tool === 'pen'
              ? 'Drag to draw · release near the start to close an area'
              : tool === 'circle'
                ? 'Drag a box for the ellipse · Shift = circle'
                : tool === 'symbol'
                  ? symItem
                    ? `Click to place ${symItem.name}`
                    : 'Pick a symbol in the palette'
                  : tool === 'text'
                    ? 'Click where the text goes'
                    : CLICK_PTS.has(tool) && draft.length
                      ? 'Double-click or Enter to finish · Backspace removes the last point · Esc cancels'
                      : CLICK_PTS.has(tool)
                        ? 'Click points on the map'
                        : '';
  const placingFound = tool === 'place' && slot ? FOUND_ROLES.has(slot.key === 'RIFLE_SEC' && s.level !== 'PL' ? 'SP_PTL' : defaultRole(slot.key)) : false;
  const cursorCss = tool === 'select' ? (hot ? (hot.kind === 'rotate' ? 'grab' : 'pointer') : hoverHit ? 'move' : 'default') : tool === 'text' ? 'text' : 'crosshair';
  const canUndo = hist.current.past.length > 0 && !readOnly;
  const canRedo = hist.current.future.length > 0 && !readOnly;
  const pickTool = (t: Tool) => () => {
    setTool(t);
    if (t !== 'symbol' && t !== 'shape') {
      setSymItem(null);
      setShapeItem(null);
    }
  };

  return (
    <div class="workspace s2-planner" style={{ height: '100%' }}>
      <div class="side">
        <div class="sect">
          <h4>Draw & edit</h4>
          <div class="toolgrid s2-tools">
            {DRAW_TOOLS.map((t) => (
              <button key={t.id} class={tool === t.id || (t.id === 'symbol' && tool === 'shape') ? 'on' : ''} title={t.tip} disabled={readOnly && t.id !== 'select' && t.id !== 'measure'} onClick={pickTool(t.id)}>
                <Icon d={t.icon} />
                {t.label}
              </button>
            ))}
          </div>
          {(tool === 'pen' || tool === 'line' || tool === 'poly' || tool === 'arrow' || tool === 'circle' || tool === 'text') && (
            <div class="s2-stylebar">
              <div class="s2-swatches">
                {COLORS.map((c) => (
                  <button title={c.label} class={style.color === c.id ? 'on' : ''} style={{ background: c.hex }} onClick={() => setStyle({ ...style, color: c.id })} />
                ))}
              </div>
              <label class="check" style={{ padding: '2px 4px' }}>
                <input type="checkbox" checked={style.dash} onChange={(e) => setStyle({ ...style, dash: e.currentTarget.checked })} /> dashed
              </label>
              <input title="Line width" type="range" min={1} max={6} step={0.5} value={style.width} onInput={(e) => setStyle({ ...style, width: Number(e.currentTarget.value) })} />
            </div>
          )}
          {(tool === 'symbol' || tool === 'shape') && (
            <SymbolPicker
              value={tool === 'shape' ? shapeItem?.id ?? null : symItem?.id ?? null}
              onPick={(it) => {
                if ('sidc' in it) {
                  setSymItem(it);
                  setShapeItem(null);
                  setTool('symbol');
                } else {
                  setShapeItem(it);
                  setSymItem(null);
                  setTool('shape');
                }
              }}
            />
          )}
          <h4 style={{ marginTop: 12 }}>Quick marks</h4>
          <div class="toolgrid s2-presets">
            {PRESETS.map((t) => (
              <button key={t.id} class={tool === t.id ? 'on' : ''} title={t.tip} disabled={readOnly} onClick={pickTool(t.id)}>
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
                {(['ARTY', 'MOR81', 'MOR60'] as const)
                  .filter((m) => m !== 'MOR81' || s.own.fire.mor81)
                  .map((m) => (
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
          {placingFound && (
            <label class="field s2-foundby">
              Found by
              <select value={foundBy} onChange={(e) => setFoundBy(e.currentTarget.value)}>
                <option value="">{slot && (slot.key === 'SCREEN_PL' || defaultRole(slot.key) === 'SCREEN') ? '— provided by higher —' : 'Auto — nearest suitable locality'}</option>
                {localities(plan).map((l) => (
                  <option value={l.id}>{l.label}</option>
                ))}
              </select>
            </label>
          )}
          <div class="palette">
            {slots.map((sl) => {
              const t = TEMPLATES[sl.templateKey];
              const u = used(sl.label, sl.templateKey);
              const on = tool === 'place' && slot?.label === sl.label && slot.key === sl.templateKey;
              const fl = u ? foundLabel(plan, u) : '';
              return (
                <button
                  key={`${sl.templateKey}${sl.index}`}
                  class={`${on ? 'on' : ''} ${u ? 'used' : ''}`}
                  disabled={readOnly && !u}
                  title={`${t.name}${sl.note ? ` — ${sl.note}` : ''}\n${t.description}${u ? '\n(sited — click to select it)' : ''}`}
                  onClick={() => {
                    if (u) {
                      setTool('select');
                      setSel({ units: [u.id], graphics: [] });
                      setTab('edit');
                      return;
                    }
                    setTool('place');
                    setSlot({ key: sl.templateKey, label: sl.label });
                  }}
                >
                  <img src={symbolSvg(t.sidc, 20)} alt="" />
                  <span>
                    <b>{sl.label}</b>
                    <br />
                    <span class="dim">{u ? (fl !== u.label ? fl.replace(`${u.label} — `, '') : `${t.short} · sited`) : t.short}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
        <div class="sect">
          <h4>Layers</h4>
          <div class="s2-layers">
            {LAYER_LABELS.map(([l, label]) => (
              <label class={`s2-layer ${layers[l] ? 'on' : ''}`}>
                <input type="checkbox" checked={layers[l]} onChange={(e) => setLayers({ ...layers, [l]: e.currentTarget.checked })} />
                {label}
              </label>
            ))}
            {isDemo && (
              <label class={`s2-layer ${showDs ? 'on' : ''}`}>
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
        layers={{ grid: layers.grid, labels: layers.labels, arcs: layers.arcs }}
        fit={aorBox(s)}
        cover
        cursor={cursorCss}
        events={{
          onClick,
          onDblClick,
          onMove: setCursor,
          canDrag: () => false,
          onPointerDown,
          onPointerMove,
          onPointerUp,
          onHover,
          onContext,
        }}
      >
        {hint && <div class="hint">{hint}</div>}
        <div class="s2-mapbar">
          <button class="btn iconbtn" title="Undo (Ctrl+Z)" disabled={!canUndo} onClick={undo}>
            ↶
          </button>
          <button class="btn iconbtn" title="Redo (Ctrl+Y / Ctrl+Shift+Z)" disabled={!canRedo} onClick={redo}>
            ↷
          </button>
          {(sel.units.length > 0 || sel.graphics.length > 0 || sel.group) && !readOnly && (
            <button class="btn iconbtn" title="Delete selection (Del)" onClick={deleteSelection}>
              🗑
            </button>
          )}
        </div>
        {hud && <div class="s2-hud">{hud}</div>}
        {textEdit && (
          <input
            class="s2-textedit"
            style={{ left: textEdit.sx - 6, top: textEdit.sy - 15 }}
            value={textEdit.value}
            placeholder="Type, Enter to finish"
            ref={(el) => {
              if (el && document.activeElement !== el) setTimeout(() => el.focus(), 0);
            }}
            onInput={(e) => setTextEdit({ ...textEdit, value: e.currentTarget.value })}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitText();
              else if (e.key === 'Escape') commitText(textEdit, true);
              e.stopPropagation();
            }}
            onBlur={() => commitText()}
          />
        )}
        <div class="maphud">
          <div class="hudchip" title="Time & space: how complete your defences will be by the given time">
            Def ready {Math.round(wl.readiness * 100)}%
          </div>
          <div class="hudchip">
            {plan.units.length} units · {plan.graphics.length} graphics{plan.groups?.length ? ` · ${plan.groups.length} gp` : ''}
          </div>
        </div>
      </MapView>
      <div class="side right">
        <div class="s2-tabs" role="tablist">
          {(
            [
              ['edit', 'Selection'],
              ['org', 'Task org'],
              ['checks', 'Checks & QC'],
            ] as const
          ).map(([id, label]) => (
            <button role="tab" aria-selected={tab === id} class={tab === id ? 'on' : ''} onClick={() => setTab(id)}>
              {label}
            </button>
          ))}
        </div>
        {tab === 'edit' &&
          (selUnit ? (
            <UnitProps
              u={selUnit}
              p={p}
              edit={edit}
              commit={commit}
              onTool={(t) => setTool(t)}
              onSelect={(id) => setSel({ units: [id], graphics: [] })}
              onDelete={deleteSelection}
            />
          ) : selGr ? (
            <GraphicProps g={selGr} p={p} edit={edit} commit={commit} onDelete={deleteSelection} onDuplicate={() => duplicate([selGr], { x: 30 * mpp.current, y: -30 * mpp.current })} />
          ) : sel.group ? (
            <GroupProps gid={sel.group} p={p} edit={edit} commit={commit} onSelect={setSel} />
          ) : sel.units.length + sel.graphics.length > 1 ? (
            <MultiProps
              sel={sel}
              p={p}
              onSelect={setSel}
              onDelete={deleteSelection}
              onGroup={() => {
                let gid = '';
                commit((pl) => (gid = groupUnits(pl, sel.units)?.id ?? ''));
                setSel({ units: [], graphics: [], group: gid || undefined });
              }}
            />
          ) : (
            <div class="sect muted small s2-help">
              <p>
                <b>Select</b> a locality (click inside its goose egg) or a graphic to edit it. Drag to move; drag the white handles to reshape, resize or rotate.
              </p>
              <p>
                <span class="kbd">Shift</span>-click or <span class="kbd">Shift</span>-drag to select several, then <b>Group</b>. Split a pl / coy into its sub-units from its properties.
              </p>
              <p>
                <span class="kbd">Ctrl+Z</span> undo · <span class="kbd">Ctrl+Y</span> redo · <span class="kbd">Del</span> delete · <span class="kbd">Ctrl+D</span> duplicate · <span class="kbd">Ctrl+C/V</span> copy/paste · <span class="kbd">Esc</span> cancel.
              </p>
            </div>
          ))}
        {tab === 'org' && <TaskOrg p={p} sel={sel} commit={commit} onSelect={(x) => (setSel(x), setTool('select'))} />}
        {tab === 'checks' && (
          <>
            <QcSorties p={p} commit={commit} />
            {p.ex.settings.hints && <Checklist p={p} />}
          </>
        )}
        <div class="sect row" style={{ marginTop: 'auto' }}>
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

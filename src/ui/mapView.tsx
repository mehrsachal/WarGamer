import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import type { Vec } from '../core/geom';
import type { PlanGraphic, Scenario } from '../core/types';
import { type Layers, type MapScene, MapRenderer, type UnitGlyph } from '../render/mapRenderer';
import { terrainFor } from '../terrain/terrain';

/** A pointer sample in world and screen space, shared by the 2D and 3D map views. */
export interface MapPointer {
  /** World position (m). */
  w: Vec;
  /** Screen position relative to the map element (CSS px). */
  sx: number;
  sy: number;
  /** Metres per CSS pixel at this point (for hit tolerances such as vertex handles). */
  mPerPx: number;
  button: number;
  shift: boolean;
  ctrl: boolean;
  alt: boolean;
}

export interface MapHit {
  unit?: UnitGlyph;
  graphic?: PlanGraphic;
}

export interface MapEvents {
  onClick?: (w: Vec, hit: MapHit, e: PointerEvent) => void;
  onDblClick?: (w: Vec) => void;
  onMove?: (w: Vec) => void;
  /** Return true to start dragging this unit. */
  canDrag?: (u: UnitGlyph) => boolean;
  onDrag?: (id: string, w: Vec) => void;
  onDragEnd?: (id: string, w: Vec) => void;
  onContext?: (w: Vec) => void;
  /**
   * Low-level gesture stream for drawing/editing tools (freehand, vertex drag, resize handles).
   * Return true to capture the gesture: the view then sends onPointerMove/onPointerUp for it and
   * does not pan, unit-drag or fire onClick.
   */
  onPointerDown?: (p: MapPointer, hit: MapHit) => boolean | void;
  /** Captured gesture moves (only after onPointerDown returned true). */
  onPointerMove?: (p: MapPointer) => void;
  /** End of a captured gesture. */
  onPointerUp?: (p: MapPointer) => void;
  /** Hover samples (always sent, captured or not). */
  onHover?: (p: MapPointer) => void;
}

export function MapView(p: {
  scenario: Scenario;
  scene: MapScene;
  layers?: Partial<Layers>;
  events?: MapEvents;
  fit?: { minX: number; minY: number; maxX: number; maxY: number } | null;
  /** Fill the view (crop) rather than letter-box. */
  cover?: boolean;
  cursor?: string;
  children?: ComponentChildren;
  onReady?: (r: MapRenderer) => void;
  coords?: boolean;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const cv = useRef<HTMLCanvasElement>(null);
  const rRef = useRef<MapRenderer | null>(null);
  const raf = useRef(0);
  const [coord, setCoord] = useState('');
  const ev = useRef(p.events);
  ev.current = p.events;
  const sceneRef = useRef(p.scene);
  sceneRef.current = p.scene;

  const redraw = () => {
    cancelAnimationFrame(raf.current);
    raf.current = requestAnimationFrame(() => {
      const r = rRef.current;
      if (!r) return;
      r.scene = sceneRef.current;
      r.draw();
    });
  };

  // create renderer per scenario
  useEffect(() => {
    const t = terrainFor(p.scenario.id, p.scenario.terrain, p.scenario.weather.going === 'wet');
    const r = new MapRenderer(cv.current!, p.scenario, t);
    rRef.current = r;
    const el = wrap.current!;
    const size = () => {
      const b = el.getBoundingClientRect();
      r.resize(Math.max(100, b.width), Math.max(100, b.height));
    };
    size();
    if (p.fit) r.fit(p.fit, 40, !!p.cover);
    else r.fit();
    const ro = new ResizeObserver(() => {
      const keep = { cx: r.cx, cy: r.cy, scale: r.scale };
      size();
      Object.assign(r, keep);
      redraw();
    });
    ro.observe(el);
    p.onReady?.(r);
    redraw();
    return () => ro.disconnect();
  }, [p.scenario.id]);

  useEffect(() => {
    const r = rRef.current;
    if (r && p.layers) Object.assign(r.layers, p.layers);
    redraw();
  });

  useEffect(() => {
    const r = rRef.current;
    if (r && p.fit) {
      r.fit(p.fit, 40, !!p.cover);
      redraw();
    }
  }, [p.fit ? `${p.fit.minX},${p.fit.minY},${p.fit.maxX},${p.fit.maxY}` : '']);

  // pointer handling
  useEffect(() => {
    const c = cv.current!;
    let down: { x: number; y: number; id: number; moved: boolean; drag?: string; pan: boolean; captured?: boolean } | null = null;
    const local = (e: PointerEvent | WheelEvent | MouseEvent) => {
      const b = c.getBoundingClientRect();
      return { x: e.clientX - b.left, y: e.clientY - b.top };
    };
    const sample = (e: PointerEvent): MapPointer => {
      const r = rRef.current!;
      const l = local(e);
      return { w: r.toWorld(l.x, l.y), sx: l.x, sy: l.y, mPerPx: 1 / r.scale, button: e.button, shift: e.shiftKey, ctrl: e.ctrlKey || e.metaKey, alt: e.altKey };
    };
    const onDown = (e: PointerEvent) => {
      const r = rRef.current!;
      const l = local(e);
      if (e.button === 2) return;
      const u = r.unitAt(l.x, l.y);
      if (ev.current?.onPointerDown) {
        const graphic = u ? undefined : r.graphicAt(l.x, l.y);
        if (ev.current.onPointerDown(sample(e), { unit: u, graphic }) === true) {
          down = { x: l.x, y: l.y, id: e.pointerId, moved: false, pan: false, captured: true };
          c.setPointerCapture(e.pointerId);
          return;
        }
      }
      const drag = u && ev.current?.canDrag?.(u) ? u.id : undefined;
      down = { x: l.x, y: l.y, id: e.pointerId, moved: false, drag, pan: !drag };
      c.setPointerCapture(e.pointerId);
    };
    const onMove = (e: PointerEvent) => {
      const r = rRef.current!;
      const l = local(e);
      const w = r.toWorld(l.x, l.y);
      if (p.coords !== false && r.t.inBounds(w)) setCoord(`${r.t.gridRef(w)} · ${r.t.squareRef(w)} · ${r.t.describe(w)} · ${Math.round(r.t.elevAt(w))} m`);
      ev.current?.onMove?.(w);
      ev.current?.onHover?.(sample(e));
      if (!down) return;
      if (down.captured) {
        down.moved = true;
        ev.current?.onPointerMove?.(sample(e));
        return;
      }
      const dx = l.x - down.x;
      const dy = l.y - down.y;
      if (!down.moved && Math.hypot(dx, dy) < 4) return;
      down.moved = true;
      if (down.drag) {
        ev.current?.onDrag?.(down.drag, w);
      } else if (down.pan) {
        r.panBy(dx, dy);
        down.x = l.x;
        down.y = l.y;
        redraw();
      }
    };
    const onUp = (e: PointerEvent) => {
      const r = rRef.current!;
      const l = local(e);
      const w = r.toWorld(l.x, l.y);
      if (down?.captured) {
        down = null;
        ev.current?.onPointerUp?.(sample(e));
        return;
      }
      if (down && !down.moved) {
        const unit = r.unitAt(l.x, l.y);
        const graphic = unit ? undefined : r.graphicAt(l.x, l.y);
        ev.current?.onClick?.(w, { unit, graphic }, e);
      } else if (down?.drag) ev.current?.onDragEnd?.(down.drag, w);
      down = null;
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const l = local(e);
      rRef.current!.zoomAt(l.x, l.y, e.deltaY < 0 ? 1.18 : 1 / 1.18);
      redraw();
    };
    const onDbl = (e: MouseEvent) => {
      const l = local(e);
      ev.current?.onDblClick?.(rRef.current!.toWorld(l.x, l.y));
    };
    const onCtx = (e: MouseEvent) => {
      e.preventDefault();
      const l = local(e);
      ev.current?.onContext?.(rRef.current!.toWorld(l.x, l.y));
    };
    c.addEventListener('pointerdown', onDown);
    c.addEventListener('pointermove', onMove);
    c.addEventListener('pointerup', onUp);
    c.addEventListener('wheel', onWheel, { passive: false });
    c.addEventListener('dblclick', onDbl);
    c.addEventListener('contextmenu', onCtx);
    return () => {
      c.removeEventListener('pointerdown', onDown);
      c.removeEventListener('pointermove', onMove);
      c.removeEventListener('pointerup', onUp);
      c.removeEventListener('wheel', onWheel);
      c.removeEventListener('dblclick', onDbl);
      c.removeEventListener('contextmenu', onCtx);
    };
  }, [p.scenario.id]);

  const zoom = (f: number) => {
    const r = rRef.current;
    if (!r) return;
    r.zoomAt(r.w / 2, r.h / 2, f);
    redraw();
  };

  return (
    <div class="mapwrap" ref={wrap} style={{ cursor: p.cursor ?? 'grab' }}>
      <canvas ref={cv} />
      <div class="maptools" style={{ left: 'auto', right: 10, top: 70 }}>
        <button class="btn iconbtn" title="Zoom in" onClick={() => zoom(1.4)}>
          +
        </button>
        <button class="btn iconbtn" title="Zoom out" onClick={() => zoom(1 / 1.4)}>
          −
        </button>
        <button
          class="btn iconbtn"
          title="Fit map"
          onClick={() => {
            rRef.current?.fit(p.fit ?? undefined, 40, !!p.cover);
            redraw();
          }}
        >
          ⤢
        </button>
      </div>
      {p.children}
      {p.coords !== false && coord && <div class="coordbar">{coord}</div>}
    </div>
  );
}

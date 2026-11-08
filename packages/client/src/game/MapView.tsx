import { type Hex, type MapModel, type Ruleset } from '@tht/engine';
import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { MapRenderer, type Scene } from './render';

export interface MapViewHandle {
  renderer(): MapRenderer | null;
  centreOn(h: Hex): void;
  zoom(f: number): void;
  fit(): void;
  redraw(): void;
}

interface Props {
  map: MapModel;
  data: Ruleset;
  scene: Scene;
  onHexClick(h: Hex, button: number, ev: { x: number; y: number; shift: boolean }): void;
  onHover(h: Hex | null, sx: number, sy: number): void;
  onCamera?(): void;
  /** Hexes to frame when the map first opens (e.g. own units). */
  initialFrame?: Hex[];
}

/** Canvas map with pan (drag), zoom (wheel / buttons), click and right-click (MAP-07). */
export const MapView = forwardRef<MapViewHandle, Props>(function MapView(p, ref) {
  const wrap = useRef<HTMLDivElement>(null);
  const cv = useRef<HTMLCanvasElement>(null);
  const r = useRef<MapRenderer | null>(null);
  const scene = useRef(p.scene);
  scene.current = p.scene;
  const cb = useRef(p);
  cb.current = p;
  const raf = useRef(0);

  const frame = () => {
    cancelAnimationFrame(raf.current);
    raf.current = requestAnimationFrame(function loop(ts) {
      const rr = r.current;
      if (!rr) return;
      const animating = rr.draw(scene.current, performance.timeOrigin + ts);
      if (animating) raf.current = requestAnimationFrame(loop);
    });
  };

  useImperativeHandle(ref, () => ({
    renderer: () => r.current,
    centreOn: (h) => {
      r.current?.centreOn(h);
      frame();
      cb.current.onCamera?.();
    },
    zoom: (f) => {
      const rr = r.current;
      if (!rr) return;
      rr.zoomAt(rr.w / 2, rr.h / 2, f);
      frame();
      cb.current.onCamera?.();
    },
    fit: () => {
      r.current?.fit();
      frame();
      cb.current.onCamera?.();
    },
    redraw: frame,
  }));

  useEffect(() => {
    const rr = new MapRenderer(cv.current!, p.map, p.data);
    r.current = rr;
    const el = wrap.current!;
    const size = () => {
      const b = el.getBoundingClientRect();
      const first = rr.w <= 1;
      rr.resize(b.width, b.height);
      if (first) {
        if (cb.current.initialFrame?.length) rr.frame(cb.current.initialFrame);
        else rr.fit();
      }
      frame();
      cb.current.onCamera?.();
    };
    size();
    const ro = new ResizeObserver(size);
    ro.observe(el);
    const c = cv.current!;
    let down: { x: number; y: number; moved: boolean; button: number } | null = null;
    const local = (e: MouseEvent) => {
      const b = c.getBoundingClientRect();
      return { x: e.clientX - b.left, y: e.clientY - b.top };
    };
    const onDown = (e: PointerEvent) => {
      const l = local(e);
      down = { ...l, moved: false, button: e.button };
      c.setPointerCapture(e.pointerId);
    };
    const onMove = (e: PointerEvent) => {
      const l = local(e);
      if (down) {
        const dx = l.x - down.x;
        const dy = l.y - down.y;
        if (down.moved || Math.hypot(dx, dy) > 5) {
          down.moved = true;
          rr.panBy(dx, dy);
          down.x = l.x;
          down.y = l.y;
          frame();
          cb.current.onCamera?.();
          return;
        }
      }
      cb.current.onHover(rr.hexAt(l.x, l.y), l.x, l.y);
    };
    const onUp = (e: PointerEvent) => {
      const l = local(e);
      if (down && !down.moved && down.button !== 2) {
        const h = rr.hexAt(l.x, l.y);
        if (h) cb.current.onHexClick(h, down.button, { x: l.x, y: l.y, shift: e.shiftKey });
      }
      down = null;
    };
    const onCtx = (e: MouseEvent) => {
      e.preventDefault();
      const l = local(e);
      const h = rr.hexAt(l.x, l.y);
      if (h) cb.current.onHexClick(h, 2, { x: l.x, y: l.y, shift: e.shiftKey });
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const l = local(e);
      rr.zoomAt(l.x, l.y, e.deltaY < 0 ? 1.15 : 1 / 1.15);
      frame();
      cb.current.onCamera?.();
    };
    const onLeave = () => cb.current.onHover(null, 0, 0);
    c.addEventListener('pointerdown', onDown);
    c.addEventListener('pointermove', onMove);
    c.addEventListener('pointerup', onUp);
    c.addEventListener('contextmenu', onCtx);
    c.addEventListener('wheel', onWheel, { passive: false });
    c.addEventListener('pointerleave', onLeave);
    return () => {
      ro.disconnect();
      cancelAnimationFrame(raf.current);
      c.removeEventListener('pointerdown', onDown);
      c.removeEventListener('pointermove', onMove);
      c.removeEventListener('pointerup', onUp);
      c.removeEventListener('contextmenu', onCtx);
      c.removeEventListener('wheel', onWheel);
      c.removeEventListener('pointerleave', onLeave);
      r.current = null;
    };
  }, [p.map, p.data]);

  useEffect(() => {
    frame();
  });

  return (
    <div className="mapwrap" ref={wrap}>
      <canvas ref={cv} data-testid="map" />
    </div>
  );
});

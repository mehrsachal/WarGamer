// Shared UI primitives: routing, session, toasts, modal, charts.
import type { ComponentChildren, JSX } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';

// ------------------------------------------------------------------ routing
export function useRoute(): string[] {
  const read = () => (location.hash.replace(/^#\/?/, '') || '').split('/').filter(Boolean).map(decodeURIComponent);
  const [r, setR] = useState(read());
  useEffect(() => {
    const on = () => setR(read());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return r;
}
export function nav(path: string): void {
  location.hash = `#/${path}`;
}

// ------------------------------------------------------------------ session
export interface Session {
  role: 'INSTRUCTOR' | 'STUDENT';
  studentId?: string;
  name: string;
}
export function getSession(): Session | null {
  try {
    const s = sessionStorage.getItem('wg_session');
    return s ? (JSON.parse(s) as Session) : null;
  } catch {
    return null;
  }
}
export function setSession(s: Session | null): void {
  try {
    if (s) sessionStorage.setItem('wg_session', JSON.stringify(s));
    else sessionStorage.removeItem('wg_session');
  } catch {
    /* private mode */
  }
}

// ------------------------------------------------------------------ toasts
type Toast = { id: number; text: string; kind: 'info' | 'ok' | 'err' };
let toastId = 0;
const listeners = new Set<(t: Toast[]) => void>();
let toasts: Toast[] = [];
export function toast(text: string, kind: Toast['kind'] = 'info'): void {
  const t = { id: ++toastId, text, kind };
  toasts = [...toasts, t];
  listeners.forEach((l) => l(toasts));
  setTimeout(() => {
    toasts = toasts.filter((x) => x.id !== t.id);
    listeners.forEach((l) => l(toasts));
  }, kind === 'err' ? 6000 : 3500);
}
export function Toasts() {
  const [ts, setTs] = useState<Toast[]>(toasts);
  useEffect(() => {
    listeners.add(setTs);
    return () => void listeners.delete(setTs);
  }, []);
  return (
    <div class="toasts">
      {ts.map((t) => (
        <div key={t.id} class={`toast ${t.kind}`}>
          {t.text}
        </div>
      ))}
    </div>
  );
}

// ------------------------------------------------------------------ modal
export function Modal(p: { title: ComponentChildren; onClose?: () => void; children: ComponentChildren; footer?: ComponentChildren; wide?: boolean }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && p.onClose?.();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [p.onClose]);
  return (
    <div class="overlay" onMouseDown={(e) => e.target === e.currentTarget && p.onClose?.()}>
      <div class={`modal ${p.wide ? 'wide' : ''}`}>
        <div class="mh">
          <h2 style={{ margin: 0 }}>{p.title}</h2>
          {p.onClose && (
            <button class="btn ghost right" onClick={p.onClose} aria-label="Close">
              ✕
            </button>
          )}
        </div>
        <div class="mb">{p.children}</div>
        {p.footer && <div class="mf">{p.footer}</div>}
      </div>
    </div>
  );
}

export function Tabs<T extends string>(p: { tabs: { id: T; label: string }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div class="tabs" role="tablist">
      {p.tabs.map((t) => (
        <button key={t.id} role="tab" aria-selected={t.id === p.value} class={`tab ${t.id === p.value ? 'on' : ''}`} onClick={() => p.onChange(t.id)}>
          {t.label}
        </button>
      ))}
    </div>
  );
}

export function Badge(p: { kind?: 'blue' | 'green' | 'amber' | 'red' | 'grey' | 'purple'; children: ComponentChildren; title?: string }) {
  return (
    <span class={`badge b-${p.kind ?? 'grey'}`} title={p.title}>
      {p.children}
    </span>
  );
}

export function Field(p: { label: string; children: ComponentChildren; style?: JSX.CSSProperties }) {
  return (
    <label class="field" style={p.style}>
      {p.label}
      {p.children}
    </label>
  );
}

export function Empty(p: { children: ComponentChildren }) {
  return <div class="empty">{p.children}</div>;
}

export function pctKind(p: number): 'green' | 'amber' | 'red' {
  return p >= 75 ? 'green' : p >= 50 ? 'amber' : 'red';
}

export function statusBadge(s: string) {
  const map: Record<string, ['blue' | 'green' | 'amber' | 'red' | 'grey', string]> = {
    NOT_STARTED: ['grey', 'Not started'],
    PLANNING: ['blue', 'Planning'],
    SUBMITTED: ['amber', 'Plan submitted'],
    COMPLETE: ['green', 'Complete'],
  };
  const [k, t] = map[s] ?? ['grey', s];
  return <Badge kind={k}>{t}</Badge>;
}

export function fmtDate(t?: number): string {
  if (!t) return '-';
  const d = new Date(t);
  return `${d.getDate().toString().padStart(2, '0')} ${d.toLocaleString('en-GB', { month: 'short' })} ${d.getFullYear()} ${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
}

// ------------------------------------------------------------------ charts (SVG)
// Palette validated for the dark surface (#1a232b): own #3987e5, enemy #e66767.
export const SERIES = { own: '#3987e5', enemy: '#e66767', neutral: '#94a3af' };

export function ScoreRing(p: { pct: number; label?: string; size?: number }) {
  const s = p.size ?? 120;
  const r = s / 2 - 9;
  const c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(100, p.pct));
  const col = pct >= 75 ? '#4caf50' : pct >= 50 ? '#ffb300' : '#ef5350';
  return (
    <div class="score-ring" style={{ width: s, height: s }} role="img" aria-label={`${Math.round(pct)} percent`}>
      <svg width={s} height={s}>
        <circle cx={s / 2} cy={s / 2} r={r} stroke="#26323c" stroke-width="9" fill="none" />
        <circle cx={s / 2} cy={s / 2} r={r} stroke={col} stroke-width="9" fill="none" stroke-linecap="round" stroke-dasharray={`${(c * pct) / 100} ${c}`} transform={`rotate(-90 ${s / 2} ${s / 2})`} />
      </svg>
      <div class="lbl">
        <div>
          <b>{Math.round(pct)}%</b>
          <span class="muted small">{p.label ?? ''}</span>
        </div>
      </div>
    </div>
  );
}

export function useWidth(min = 280, fallback = 520): [preact.RefObject<HTMLDivElement>, number] {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(fallback);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(Math.max(min, Math.floor(el.getBoundingClientRect().width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

/** Horizontal bars, single series (magnitude). Values labelled directly; hover shows detail. */
export function HBars(p: { items: { label: string; value: number; detail?: string }[]; max?: number; unit?: string; color?: string; width?: number }) {
  const [ref, mw] = useWidth();
  const W = p.width ?? mw;
  const lw = Math.min(190, Math.max(120, W * 0.32));
  const bh = 16;
  const gap = 10;
  const max = p.max ?? Math.max(1, ...p.items.map((i) => i.value));
  const H = p.items.length * (bh + gap) + 8;
  const plotW = W - lw - 56;
  return (
    <div class="chartbox" ref={ref}>
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Bar chart" style={{ width: W, height: H }}>
        {[0.25, 0.5, 0.75, 1].map((f) => (
          <line x1={lw + plotW * f} x2={lw + plotW * f} y1={0} y2={H - 4} stroke="#2c3a46" stroke-width="1" />
        ))}
        {p.items.map((it, i) => {
          const y = 4 + i * (bh + gap);
          const w = Math.max(2, (plotW * Math.max(0, it.value)) / max);
          return (
            <g key={it.label}>
              <title>{`${it.label}: ${Math.round(it.value)}${p.unit ?? ''}${it.detail ? ` — ${it.detail}` : ''}`}</title>
              <text x={lw - 8} y={y + bh / 2 + 4} text-anchor="end" fill="#c9d3da" font-size="12">
                {it.label}
              </text>
              <rect x={lw} y={y - 3} width={plotW} height={bh + 6} fill="transparent" />
              <path d={`M${lw},${y} h${Math.max(0, w - 4)} a4,4 0 0 1 4,4 v${bh - 8} a4,4 0 0 1 -4,4 h${-Math.max(0, w - 4)} z`} fill={p.color ?? SERIES.own} />
              <text x={lw + w + 6} y={y + bh / 2 + 4} fill="#e6ebef" font-size="12" font-weight="600">
                {Math.round(it.value)}
                {p.unit ?? ''}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

/** Line chart with crosshair tooltip. One y-axis. Legend + end labels for >= 2 series. */
export function LineChart(p: { series: { name: string; color: string; pts: { x: number; y: number }[] }[]; yMax?: number; xFmt?: (x: number) => string; yFmt?: (y: number) => string; height?: number }) {
  const [wrap, W] = useWidth(300, 620);
  const H = p.height ?? 220;
  const m = { l: 44, r: 70, t: 12, b: 26 };
  const xs = p.series.flatMap((s) => s.pts.map((q) => q.x));
  const x0 = Math.min(...xs);
  const x1 = Math.max(...xs);
  const yMax = p.yMax ?? Math.max(1, ...p.series.flatMap((s) => s.pts.map((q) => q.y)));
  const sx = (x: number) => m.l + ((x - x0) / Math.max(1e-9, x1 - x0)) * (W - m.l - m.r);
  const sy = (y: number) => H - m.b - (y / yMax) * (H - m.t - m.b);
  const [hx, setHx] = useState<number | null>(null);
  const ref = useRef<SVGSVGElement>(null);
  const fx = p.xFmt ?? ((x: number) => String(Math.round(x)));
  const fy = p.yFmt ?? ((y: number) => String(Math.round(y)));
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => yMax * f);
  const near = (s: { pts: { x: number; y: number }[] }, x: number) => s.pts.reduce((b, q) => (Math.abs(q.x - x) < Math.abs(b.x - x) ? q : b), s.pts[0]);
  if (!xs.length) return <div class="muted small">No data.</div>;
  return (
    <div class="chartbox" style={{ position: 'relative' }} ref={wrap}>
      {p.series.length >= 2 && (
        <div class="legend" style={{ marginBottom: 6 }}>
          {p.series.map((s) => (
            <span key={s.name}>
              <i style={{ background: s.color }} />
              {s.name}
            </span>
          ))}
        </div>
      )}
      <svg
        ref={ref}
        viewBox={`0 0 ${W} ${H}`}
        width={W}
        height={H}
        style={{ width: W, height: H }}
        role="img"
        aria-label="Line chart"
        onMouseMove={(e) => {
          const r = ref.current!.getBoundingClientRect();
          const px = ((e.clientX - r.left) / r.width) * W;
          const x = x0 + ((px - m.l) / (W - m.l - m.r)) * (x1 - x0);
          setHx(Math.max(x0, Math.min(x1, x)));
        }}
        onMouseLeave={() => setHx(null)}
      >
        {ticks.map((v) => (
          <g key={v}>
            <line x1={m.l} x2={W - m.r} y1={sy(v)} y2={sy(v)} stroke="#2c3a46" stroke-width="1" />
            <text x={m.l - 6} y={sy(v) + 4} text-anchor="end" fill="#94a3af" font-size="11">
              {fy(v)}
            </text>
          </g>
        ))}
        <text x={m.l} y={H - 6} fill="#94a3af" font-size="11">
          {fx(x0)}
        </text>
        <text x={W - m.r} y={H - 6} fill="#94a3af" font-size="11" text-anchor="end">
          {fx(x1)}
        </text>
        {p.series.map((s) => (
          <g key={s.name}>
            <polyline fill="none" stroke={s.color} stroke-width="2" stroke-linejoin="round" points={s.pts.map((q) => `${sx(q.x)},${sy(q.y)}`).join(' ')} />
            {s.pts.length <= 30 && s.pts.map((q) => <circle cx={sx(q.x)} cy={sy(q.y)} r="4" fill={s.color} stroke="#1a232b" stroke-width="2" />)}
            {p.series.length >= 2 && s.pts.length > 0 && (
              <text x={sx(s.pts[s.pts.length - 1].x) + 6} y={sy(s.pts[s.pts.length - 1].y) + 4} fill="#e6ebef" font-size="11">
                {s.name}
              </text>
            )}
          </g>
        ))}
        {hx !== null && (
          <g>
            <line x1={sx(hx)} x2={sx(hx)} y1={m.t} y2={H - m.b} stroke="#94a3af" stroke-dasharray="3 3" />
            {p.series.map((s) => {
              const q = near(s, hx);
              return q ? <circle cx={sx(q.x)} cy={sy(q.y)} r="5" fill={s.color} stroke="#fff" stroke-width="1.5" /> : null;
            })}
          </g>
        )}
      </svg>
      {hx !== null && (
        <div style={{ position: 'absolute', top: 30, left: `${Math.min(70, (100 * (sx(hx) - m.l)) / W + 8)}%`, background: '#0f161c', border: '1px solid #3a4b59', borderRadius: 8, padding: '6px 10px', fontSize: 12, pointerEvents: 'none' }}>
          <div class="muted">{fx(hx)}</div>
          {p.series.map((s) => {
            const q = near(s, hx);
            return (
              <div key={s.name}>
                <span style={{ display: 'inline-block', width: 10, height: 3, background: s.color, marginRight: 6, verticalAlign: 'middle' }} />
                {s.name}: <b>{q ? fy(q.y) : '-'}</b>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** Sequential blue ramp (dark surface): low recedes, high brightens. */
export function rampColor(pct: number): string {
  const steps = ['#184f95', '#1c5cab', '#256abf', '#2a78d6', '#3987e5', '#5598e7', '#6da7ec', '#86b6ef'];
  const i = Math.max(0, Math.min(steps.length - 1, Math.floor((pct / 100) * steps.length)));
  return steps[i];
}

export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]): [T | undefined, () => void] {
  const [v, setV] = useState<T>();
  const [n, setN] = useState(0);
  useEffect(() => {
    let alive = true;
    fn().then((x) => alive && setV(x));
    return () => {
      alive = false;
    };
  }, [...deps, n]);
  return [v, () => setN((x) => x + 1)];
}

export function useMemoOnce<T>(fn: () => T): T {
  return useMemo(fn, []);
}

export function download(name: string, text: string, type = 'text/csv'): void {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => a.remove(), 300);
}

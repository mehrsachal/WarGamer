// UI-01 panels: unit card, combat log, victory points, End Turn, Menu, Data, Help, Objectives, Prev/Next unit.
import {
  type FireCheck,
  type GameContext,
  type Hex,
  type HitBreakdown,
  type LogItem,
  type ObjectiveView,
  type Side,
  type SideView,
  type UnitView,
  allowance,
  stepCostDetail,
} from '@tht/engine';
import { type ReactNode, useEffect, useRef } from 'react';
import { t } from '../i18n';
import { logClass, logText } from './logText';
import type { MapRenderer } from './render';
import { SIDE_COLORS } from './render';
import { sidcFor, symbolDataUrl } from './symbols';

const pct = (x: number) => `${Math.round(x * 100)}%`;
const sideName = (s: Side) => t(`side.${s}`);

export function TopBar(p: { view: SideView; side: Side; title: string; aiThinking: boolean; classification: string }) {
  const v = p.view;
  const phase = v.phase === 'deploy' ? t('phase.deploy') : v.phase === 'over' ? t('phase.over') : t('phase.play', { turn: v.turn, turns: v.turns });
  return (
    <div className="topbar">
      <div className="tb-title">
        <b>{p.title}</b>
        <span className="tb-class">{p.classification}</span>
      </div>
      <div className="tb-turn" data-testid="turn">
        <span className="pill">{phase}</span>
        {v.phase !== 'over' && <span className={`pill side-${v.activeSide}`} data-testid="active-side">
          {p.aiThinking ? t('top.waitAi') : t('top.active', { side: sideName(v.activeSide) })}
        </span>}
        <span className="pill">{v.minutesPerTurn} min/turn · {v.timeOfDay} · {v.weather}</span>
      </div>
      <div className="tb-vp" data-testid="vp" title={t('obj.total', { blue: v.vp.blue, red: v.vp.red })}>
        <span className="vp vp-blue">
          {sideName('blue')} {v.vp.blue}
        </span>
        <span className="vp-sep">/</span>
        <span className="vp vp-red">
          {sideName('red')} {v.vp.red}
        </span>
      </div>
    </div>
  );
}

export function CombatLog(p: { items: LogItem[]; ctx: GameContext; side: Side; onClose?: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [p.items.length]);
  const items = p.items.filter((i) => i.k !== 'turn_end');
  return (
    <div className="panel log" data-testid="combat-log">
      <div className="panel-h">{t('log.title')}</div>
      <div className="log-body" ref={ref}>
        {!items.length && <div className="muted">{t('log.empty')}</div>}
        {items.slice(-300).map((it, i) => (
          <div key={i} className={`log-line ${logClass(it, p.side)}`}>
            {logText(it, p.ctx.data, p.ctx.map, p.side)}
          </div>
        ))}
      </div>
    </div>
  );
}

function Maths(p: { b: HitBreakdown; weapon: string; ctx: GameContext }) {
  const h = p.ctx.data.rules.hit;
  const row = (label: string, v: number, isBase = false) => (
    <tr>
      <td>{label}</td>
      <td className="num">{isBase ? pct(v) : `× ${v.toFixed(2)}`}</td>
    </tr>
  );
  return (
    <table className="maths">
      <tbody>
        {row(t('hit.base', { weapon: p.weapon, band: p.b.bandToHex, cls: p.b.targetClass }), p.b.base, true)}
        {row(t('hit.cover'), p.b.cover)}
        {row(t('hit.posture'), p.b.posture)}
        {row(t('hit.shooter'), p.b.shooter)}
        {row(t('hit.env'), p.b.env)}
        {p.b.area !== 1 && row(t('hit.area'), p.b.area)}
        <tr className="sum">
          <td>= {pct(p.b.raw)} → {t('hit.clamp', { min: Math.round(h.min * 100), max: Math.round(h.max * 100) })}</td>
          <td className="num">{pct(p.b.p)}</td>
        </tr>
      </tbody>
    </table>
  );
}

export function UnitCard(p: {
  unit: UnitView | null;
  view: SideView;
  ctx: GameContext;
  checks: { weaponId: string; check: FireCheck }[] | null;
  weaponId: string | null;
  myTurn: boolean;
  onWeapon(id: string): void;
  onIndirect(weaponId: string): void;
  onAction(kind: 'mount' | 'dismount', id: string): void;
  showMaths: boolean;
  onToggleMaths(): void;
}) {
  const u = p.unit;
  if (!u) return <div className="panel card" data-testid="unit-card"><div className="muted">{t('card.none')}</div></div>;
  const d = p.ctx.data;
  const ty = d.unitType(u.typeId);
  const a = allowance(p.ctx, u);
  const sensors = ty.sensors.map((s) => d.sensors.get(s)?.name ?? s).join(', ');
  const posture = u.fired ? t('posture.fired') : t(`posture.${u.posture}`);
  const carrier = u.carriedBy ? p.view.units.find((x) => x.id === u.carriedBy) : undefined;
  const vehiclesNear = u.own && u.hex && ty.mobilityClass === 'foot' ? p.view.units.filter((v) => v.own && v.hex && d.unitType(v.typeId).transportCapacity > v.passengers.length && Math.abs(v.hex.q - u.hex!.q) + Math.abs(v.hex.r - u.hex!.r) + Math.abs(v.hex.q + v.hex.r - u.hex!.q - u.hex!.r) <= 2) : [];
  return (
    <div className="panel card" data-testid="unit-card">
      <div className="card-head" style={{ borderColor: SIDE_COLORS[u.side].edge }}>
        <img alt="" src={symbolDataUrl(sidcFor(ty.symbol, u.side, p.view.side), 30)} />
        <div>
          <div className="card-name">{u.own ? u.name : `${t('card.enemy')}: ${ty.name}`}</div>
          <div className="muted small">
            {ty.name} · {t('card.crew', { n: ty.crew })} · {t('card.steps', { n: u.steps, max: u.maxSteps })}
          </div>
        </div>
        <span className={`status status-${u.status}`} title={t(`status.${u.status}`)}>
          {u.status}
        </span>
      </div>
      <div className="small">
        {t(`status.${u.status}`)} · {posture}
      </div>
      {u.own && u.hex && <div className="small">{t('card.mp', { left: Math.max(0, +(a.limit - a.spent).toFixed(1)), total: a.total, tac: a.tactical })}</div>}
      {carrier && <div className="small">{t('card.carriedBy', { name: carrier.name })}</div>}
      {u.enduranceLeft !== undefined && u.own && <div className="small">{t('card.endurance', { n: u.enduranceLeft })}</div>}
      <div className="small muted">
        {t('card.sensors')}: {sensors}
      </div>
      <table className="weapons">
        <thead>
          <tr>
            <th>{t('card.weapons')}</th>
            <th>{t('card.range')}</th>
            <th>{t('card.ammo')}</th>
            <th>{t('card.hit')}</th>
          </tr>
        </thead>
        <tbody>
          {ty.weapons.map((wid) => {
            const w = d.weapon(wid);
            const ammo = u.own ? u.ammo[wid] : undefined;
            const c = p.checks?.find((x) => x.weaponId === wid)?.check;
            const sel = p.weaponId === wid;
            return (
              <tr key={wid} className={sel ? 'sel' : ''} onClick={() => u.own && !w.indirect && p.onWeapon(wid)}>
                <td>
                  {u.own && !w.indirect && <input type="radio" readOnly checked={sel} aria-label={w.name} />} {w.name}
                </td>
                <td className="num">
                  {w.minRange}–{w.maxRange}
                </td>
                <td className="num">{ammo === null || ammo === undefined ? t('card.unlimited') : ammo}</td>
                <td className="num">
                  {w.indirect && u.own ? (
                    <button className="btn tiny" disabled={!p.myTurn} onClick={() => p.onIndirect(wid)}>
                      {t('card.indirect')}
                    </button>
                  ) : c ? (
                    c.ok ? <b>{pct(c.p)}</b> : <span className="muted">0%</span>
                  ) : (
                    ''
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {u.own && u.passengers.length > 0 && (
        <div className="small">
          {t('card.passengers')}:{' '}
          {u.passengers.map((pid) => {
            const pu = p.view.units.find((x) => x.id === pid);
            return (
              <button key={pid} className="btn tiny" disabled={!p.myTurn} onClick={() => p.onAction('dismount', pid)}>
                {t('ctx.dismount', { name: pu?.name ?? pid })}
              </button>
            );
          })}
        </div>
      )}
      {vehiclesNear.length > 0 && (
        <div className="small">
          {vehiclesNear.map((v) => (
            <button key={v.id} className="btn tiny" disabled={!p.myTurn} onClick={() => p.onAction('mount', v.id)}>
              {t('ctx.mount', { vehicle: v.name })}
            </button>
          ))}
        </div>
      )}
      {p.checks && p.checks.some((c) => c.check.breakdown) && (
        <div className="small">
          <button className="btn tiny" onClick={p.onToggleMaths}>
            {t('hit.maths')}
          </button>
          {p.showMaths &&
            p.checks
              .filter((c) => c.check.breakdown && (!p.weaponId || c.weaponId === p.weaponId))
              .slice(0, 1)
              .map((c) => <Maths key={c.weaponId} b={c.check.breakdown!} weapon={d.weapon(c.weaponId).name} ctx={p.ctx} />)}
        </div>
      )}
    </div>
  );
}

export function HoverReadout(p: { hex: Hex | null; ctx: GameContext }) {
  if (!p.hex) return <div className="readout muted">—</div>;
  const c = p.ctx.map.get(p.hex);
  if (!c) return null;
  const cost = (cls: 'foot' | 'wheeled' | 'tracked') => {
    const v = c.terrain.moveCost[cls];
    return v === null ? t('hover.impassable') : String(v);
  };
  void stepCostDetail;
  return (
    <div className="readout" data-testid="hex-readout">
      <b>{t('hover.hex', { q: p.hex.q, r: p.hex.r, gr: p.ctx.map.gridRef(p.hex) })}</b> · {t('hover.terrain', { terrain: c.terrain.name, elev: Math.round(c.elevation_m), cover: c.terrain.cover, conceal: Math.round(c.terrain.concealment * 100) })} ·{' '}
      {t('hover.move', { foot: cost('foot'), wheeled: cost('wheeled'), tracked: cost('tracked') })}
    </div>
  );
}

export function HitTip(p: { x: number; y: number; check: FireCheck; weapon: string }) {
  return (
    <div className="hittip" style={{ left: p.x + 16, top: p.y + 12 }} data-testid="hit-tip">
      {p.check.ok ? (
        <>
          <b>{t('hit.title', { p: Math.round(p.check.p * 100) })}</b>
          <div className="small">
            {p.weapon} · {t('hit.click')}
          </div>
        </>
      ) : (
        <span>{t(`err.${p.check.reason}`)}</span>
      )}
    </div>
  );
}

export function Minimap(p: { renderer: MapRenderer | null; view: SideView; tick: number; onJump(x: number, y: number): void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const base = useRef<ReturnType<MapRenderer['overview']> | null>(null);
  useEffect(() => {
    const r = p.renderer;
    const c = ref.current;
    if (!r || !c) return;
    base.current ??= r.overview(200);
    const b = base.current;
    c.width = b.canvas.width;
    c.height = b.canvas.height;
    const g = c.getContext('2d')!;
    g.drawImage(b.canvas, 0, 0);
    for (const u of p.view.units) {
      if (!u.hex) continue;
      const pt = r.centre(u.hex);
      g.fillStyle = SIDE_COLORS[u.side].edge;
      g.fillRect((pt.x - b.bounds.minX) * b.scale - 2, (pt.y - b.bounds.minY) * b.scale - 2, 4, 4);
    }
    for (const o of p.view.objectives) {
      const pt = r.centre(o.hex);
      g.fillStyle = o.owner ? SIDE_COLORS[o.owner].edge : '#555';
      g.beginPath();
      g.arc((pt.x - b.bounds.minX) * b.scale, (pt.y - b.bounds.minY) * b.scale, 4, 0, Math.PI * 2);
      g.fill();
    }
    const tl = r.toWorld(0, 0);
    const br = r.toWorld(r.w, r.h);
    g.strokeStyle = '#ffd400';
    g.lineWidth = 1.5;
    g.strokeRect((tl.x - b.bounds.minX) * b.scale, (tl.y - b.bounds.minY) * b.scale, (br.x - tl.x) * b.scale, (br.y - tl.y) * b.scale);
  });
  return (
    <canvas
      ref={ref}
      className="minimap"
      data-testid="minimap"
      onClick={(e) => {
        const b = base.current;
        if (!b) return;
        const rect = (e.target as HTMLCanvasElement).getBoundingClientRect();
        p.onJump((e.clientX - rect.left) / b.scale + b.bounds.minX, (e.clientY - rect.top) / b.scale + b.bounds.minY);
      }}
    />
  );
}

export function Modal(p: { title: string; onClose?: () => void; children: ReactNode; wide?: boolean; testId?: string }) {
  return (
    <div className="overlay" onClick={p.onClose}>
      <div className={`modal${p.wide ? ' wide' : ''}`} onClick={(e) => e.stopPropagation()} data-testid={p.testId}>
        <div className="modal-h">
          <b>{p.title}</b>
          {p.onClose && (
            <button className="btn ghost" onClick={p.onClose} aria-label={t('data.close')}>
              ✕
            </button>
          )}
        </div>
        <div className="modal-b">{p.children}</div>
      </div>
    </div>
  );
}

export function ObjectivesPanel(p: { objectives: ObjectiveView[]; vp: Record<Side, number>; onClose(): void; onJump(h: Hex): void }) {
  return (
    <Modal title={t('obj.title')} onClose={p.onClose} testId="objectives">
      <table className="tbl">
        <tbody>
          {p.objectives.map((o) => (
            <tr key={o.id} className="clickable" onClick={() => p.onJump(o.hex)}>
              <td>⚑ {o.name}</td>
              <td>{t('obj.value', { v: o.value })}</td>
              <td className={o.owner ? `own-${o.owner}` : 'muted'}>{o.owner ? sideName(o.owner) : t('obj.none')}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p>
        <b>{t('obj.total', { blue: p.vp.blue, red: p.vp.red })}</b>
      </p>
    </Modal>
  );
}

export function DataPanel(p: { ctx: GameContext; onClose(): void }) {
  const d = p.ctx.data;
  return (
    <Modal title={t('data.title')} onClose={p.onClose} wide testId="data-panel">
      <h4>{t('data.units')}</h4>
      <table className="tbl small">
        <thead>
          <tr>
            <th>Unit</th>
            <th>Mobility</th>
            <th>MP</th>
            <th>Steps</th>
            <th>Crew</th>
            <th>Weapons</th>
            <th>Sensors</th>
            <th>Carry</th>
          </tr>
        </thead>
        <tbody>
          {d.lists.units.map((u) => (
            <tr key={u.id}>
              <td>{u.name}</td>
              <td>{u.mobilityClass}</td>
              <td className="num">{u.movePoints}</td>
              <td className="num">{u.steps}</td>
              <td className="num">{u.crew}</td>
              <td>{u.weapons.map((w) => d.weapon(w).name).join(', ')}</td>
              <td>{u.sensors.join(', ')}</td>
              <td className="num">{u.transportCapacity || ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <h4>{t('data.weapons')}</h4>
      <table className="tbl small">
        <thead>
          <tr>
            <th>Weapon</th>
            <th>Range</th>
            <th>Soft / hard / air hit % by band (≤ hexes)</th>
            <th>Lethality</th>
            <th>Ammo</th>
          </tr>
        </thead>
        <tbody>
          {d.lists.weapons.map((w) => (
            <tr key={w.id}>
              <td>
                {w.name}
                {w.indirect ? ' (indirect)' : ''}
              </td>
              <td className="num">
                {w.minRange}–{w.maxRange}
              </td>
              <td>{w.rangeBands.map((b) => `≤${b.toHex}: ${pct(b.softHit)}/${pct(b.hardHit)}/${pct(b.airHit)}`).join('  ·  ')}</td>
              <td>
                {pct(w.lethality.soft)}/{pct(w.lethality.hard)}
              </td>
              <td className="num">{w.ammo === 'unlimited' ? '∞' : w.ammo}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <h4>{t('data.terrain')}</h4>
      <table className="tbl small">
        <thead>
          <tr>
            <th>Terrain</th>
            <th>Cover ×</th>
            <th>Concealment</th>
            <th>Move foot / wheeled / tracked</th>
            <th>LOS height</th>
          </tr>
        </thead>
        <tbody>
          {d.lists.terrain.map((x) => (
            <tr key={x.id}>
              <td>
                <span className="swatch" style={{ background: x.color }} /> {x.name}
              </td>
              <td className="num">{x.cover}</td>
              <td className="num">{pct(x.concealment)}</td>
              <td>
                {x.moveCost.foot ?? '—'} / {x.moveCost.wheeled ?? '—'} / {x.moveCost.tracked ?? '—'}
              </td>
              <td className="num">{x.losHeight_m} m</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Modal>
  );
}

export function HelpPanel(p: { onClose(): void }) {
  return (
    <Modal title={t('help.title')} onClose={p.onClose} wide testId="help-panel">
      <div className="help">
        <p>
          <b>Turns.</b> Sides alternate (IGOUGO). In your turn select a unit, move it, fire, then press <b>End turn</b>. A unit may fire once per turn.
        </p>
        <p>
          <b>Move bands.</b> Grey hexes keep the unit <i>tactical</i>: it can still fire this turn (with a penalty). Green hexes are a <i>dash</i>: further, but the unit cannot fire this turn and is easier to hit. A unit that has fired can only move in the tactical band.
        </p>
        <p>
          <b>Seeing.</b> You see only what your units can see. Terrain conceals static troops (woods, built-up areas, crops); moving and firing units are much easier to spot. Faded counters are the last known enemy positions. <b>Viewshed</b> (V) shades what the selected unit can see.
        </p>
        <p>
          <b>Fire.</b> Hover over a spotted enemy with a unit selected to see the hit chance; click to fire. A hit suppresses (status <b>S</b>) or removes a step. Suppressed units cannot fire and move at half rate; they try to rally at the start of their turn. Hitting a suppressed unit again is more likely to cause losses. Small arms cannot hurt armour.
        </p>
        <p>
          <b>Indirect fire.</b> Mortars fire on any hex in range that one of your units can see (observer rule). <b>Artillery strike</b> calls off-map guns: limited missions, available from a given turn, often landing a turn later.
        </p>
        <p>
          <b>Vehicles.</b> Foot units mount a vehicle in or next to their hex (card button). Dismounting uses the troops' move for the turn.
        </p>
        <p>
          <b>Objectives.</b> ⚑ flags change hands when only one side's ground troops occupy the hex. The side with the greater objective value at the end wins; a side that falls below its breaking point loses at once.
        </p>
        <h4>Keyboard</h4>
        <table className="tbl small">
          <tbody>
            {[
              ['N / Tab', 'Next unit'],
              ['P', 'Previous unit'],
              ['E', 'End turn (asks first)'],
              ['V', 'Toggle viewshed'],
              ['G', 'Toggle grid'],
              ['L', 'Toggle labels'],
              ['A', 'Artillery strike'],
              ['O / D / H', 'Objectives / Data / Help'],
              ['+ / − / F', 'Zoom in / out / fit map'],
              ['Arrow keys', 'Pan the map'],
              ['Esc', 'Cancel / close'],
            ].map(([k, v]) => (
              <tr key={k}>
                <td>
                  <kbd>{k}</kbd>
                </td>
                <td>{v}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Modal>
  );
}

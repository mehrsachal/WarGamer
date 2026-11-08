import {
  type Command,
  type FireCheck,
  type GameContext,
  type Hex,
  type LogItem,
  type Side,
  type UnitView,
  directFireCheck,
  hexDistance,
  hexEquals,
  hexKey,
  indirectFireCheck,
  indirectHit,
  knowledge,
  otherSide,
  pathTo,
  planDeployment,
  reachable,
  unitViewshed,
} from '@tht/engine';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { type GameState, api, clientContext, savedGame } from '../api';
import { t } from '../i18n';
import { MapView, type MapViewHandle } from './MapView';
import { CombatLog, DataPanel, HelpPanel, HitTip, HoverReadout, Minimap, Modal, ObjectivesPanel, TopBar, UnitCard } from './panels';
import type { Effect, Scene } from './render';

type Mode = { kind: 'normal' } | { kind: 'indirect'; unitId: string; weaponId: string } | { kind: 'artillery'; assetId: string };

export function GameScreen(p: { gameId: string; onExit(): void }) {
  const saved = savedGame(p.gameId);
  const [token, setToken] = useState<string | null>(() => (saved ? saved.tokens[saved.side] ?? Object.values(saved.tokens)[0] ?? null : null));
  const [cs, setCs] = useState<GameState | null>(null);
  const [log, setLog] = useState<LogItem[]>([]);
  const [ctx, setCtx] = useState<GameContext | null>(null);
  const [scenarioMeta, setScenarioMeta] = useState<{ title: string; classification: string } | null>(null);
  const [selId, setSelId] = useState<string | null>(null);
  const [weaponId, setWeaponId] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>({ kind: 'normal' });
  const [hover, setHover] = useState<{ hex: Hex | null; x: number; y: number }>({ hex: null, x: 0, y: 0 });
  const [showViewshed, setShowViewshed] = useState(false);
  const [grid, setGrid] = useState(true);
  const [labels, setLabels] = useState(true);
  const [panel, setPanel] = useState<null | 'menu' | 'data' | 'help' | 'objectives' | 'artillery' | 'confirmEnd'>(null);
  const [showMaths, setShowMaths] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [handover, setHandover] = useState<Side | null>(null);
  const [effects, setEffects] = useState<Effect[]>([]);
  const [conn, setConn] = useState(true);
  const [resultOpen, setResultOpen] = useState(true);
  const [camTick, setCamTick] = useState(0);
  const mapRef = useRef<MapViewHandle>(null);
  const logLen = useRef(0);
  const busy = useRef(false);

  const flash = (msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast((m) => (m === msg ? null : m)), 3500);
  };

  /** New log items -> tracers / impact flashes. */
  const animate = useCallback((items: LogItem[]) => {
    const now = Date.now();
    const fx: Effect[] = [];
    for (const it of items) {
      if (it.k === 'fire') {
        if (it.from && !it.indirect) fx.push({ kind: 'tracer', from: it.from, to: it.at, t0: now, side: it.side });
        fx.push({ kind: it.hit ? 'impact' : 'miss', to: it.at, t0: now, side: it.side });
      }
      if (it.k === 'impact') fx.push({ kind: 'impact', to: it.hex, t0: now, side: it.side });
    }
    if (fx.length) setEffects((e) => [...e.filter((x) => now - x.t0 < 1500), ...fx]);
  }, []);

  const apply = useCallback(
    (st: GameState) => {
      setCs(st);
      if (st.logFrom === 0) {
        setLog(st.log);
        logLen.current = st.log.length;
      } else if (st.logFrom === logLen.current) {
        setLog((l) => [...l, ...st.log]);
        logLen.current += st.log.length;
        animate(st.log);
      }
    },
    [animate],
  );

  const refresh = useCallback(async () => {
    if (!token) return;
    try {
      const st = await api.state(p.gameId, token, logLen.current);
      apply(st);
      setConn(true);
    } catch {
      setConn(false);
    }
  }, [p.gameId, token, apply]);

  // initial load + context
  useEffect(() => {
    if (!token) return;
    let stop = false;
    (async () => {
      const st = await api.state(p.gameId, token, 0);
      if (stop) return;
      logLen.current = 0;
      apply(st);
      setScenarioMeta({ title: st.scenario!.title, classification: st.scenario!.classification });
      setCtx(await clientContext(st.scenario!));
    })().catch(() => setConn(false));
    return () => {
      stop = true;
    };
  }, [p.gameId, token, apply]);

  // live updates (AI moves, opponent moves)
  useEffect(() => {
    if (!token) return;
    let ws: WebSocket | null = null;
    let closed = false;
    let retry = 0;
    const open = () => {
      ws = api.socket(p.gameId, token);
      ws.onopen = () => {
        setConn(true);
        retry = 0;
        ws?.send(JSON.stringify({ type: 'resync', logFrom: logLen.current }));
      };
      ws.onmessage = (m) => {
        const msg = JSON.parse(m.data);
        if (msg.type !== 'state') return;
        if (msg.logFrom !== logLen.current) ws?.send(JSON.stringify({ type: 'resync', logFrom: logLen.current }));
        else apply(msg as GameState);
      };
      ws.onclose = () => {
        if (closed) return;
        setConn(false);
        window.setTimeout(open, Math.min(8000, 500 * 2 ** retry++));
      };
    };
    open();
    return () => {
      closed = true;
      ws?.close();
    };
  }, [p.gameId, token, apply]);

  // hot-seat: hand over when the other side is to move
  useEffect(() => {
    if (!cs || cs.mode !== 'hotseat' || !saved) return;
    const v = cs.view;
    if (v.phase !== 'over' && v.activeSide !== cs.side && !handover) setHandover(v.activeSide);
  }, [cs, saved, handover]);

  const view = cs?.view;
  const side = cs?.side ?? 'blue';
  const myTurn = !!view && !!cs && view.activeSide === side && !cs.aiThinking && view.phase !== 'over';
  const units = view?.units ?? [];
  const own = units.filter((u) => u.own);
  const ownOnMap = own.filter((u) => u.hex);
  const enemies = units.filter((u) => !u.own && u.hex);
  const selected = units.find((u) => u.id === selId) ?? null;

  const reach = useMemo(() => {
    if (!ctx || !view || !selected?.own || !selected.hex || view.phase !== 'play' || !myTurn || mode.kind !== 'normal') return null;
    const blocked = new Set(enemies.filter((e) => !ctx.data.unitType(e.typeId).isAir).map((e) => hexKey(e.hex!)));
    const occ = new Map<string, number>();
    for (const u of units) if (u.hex && !ctx.data.unitType(u.typeId).isAir) occ.set(hexKey(u.hex), (occ.get(hexKey(u.hex)) ?? 0) + 1);
    return reachable(ctx, selected, { blocked, occupancy: occ });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx, view?.seq, selId, myTurn, mode.kind]);

  const observed = useMemo(() => {
    if (!ctx || !view || mode.kind === 'normal') return null;
    const out = new Set<string>();
    for (const u of ownOnMap) for (const k of unitViewshed(ctx, u)) out.add(k);
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx, view?.seq, mode.kind]);

  const targets = useMemo(() => {
    if (!ctx || !observed || mode.kind === 'normal') return null;
    if (mode.kind === 'artillery') return observed;
    const u = units.find((x) => x.id === mode.unitId);
    if (!u) return null;
    return new Set([...observed].filter((k) => {
      const [q, r] = k.split(',').map(Number);
      return indirectFireCheck(ctx, u, mode.weaponId, { q, r }).ok;
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx, observed, mode]);

  const viewshed = useMemo(() => (ctx && showViewshed && selected?.hex ? unitViewshed(ctx, selected) : null), [ctx, showViewshed, selected?.id, selected?.hex?.q, selected?.hex?.r]);

  const fireChecks = useCallback(
    (shooter: UnitView, target: UnitView): { weaponId: string; check: FireCheck }[] => {
      if (!ctx) return [];
      return ctx.data
        .unitType(shooter.typeId)
        .weapons.filter((w) => !ctx.data.weapon(w).indirect)
        .map((w) => ({ weaponId: w, check: directFireCheck(ctx, shooter, w, target, true) }));
    },
    [ctx],
  );

  const attackable = useMemo(() => {
    if (!ctx || !selected?.own || !myTurn || view?.phase !== 'play') return null;
    const s = new Set<string>();
    for (const e of enemies) if (fireChecks(selected, e).some((c) => c.check.ok)) s.add(hexKey(e.hex!));
    return s;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx, view?.seq, selId, myTurn]);

  const hoverEnemy = hover.hex ? enemies.find((e) => hexEquals(e.hex!, hover.hex!)) : undefined;
  const hoverChecks = selected?.own && hoverEnemy ? fireChecks(selected, hoverEnemy) : null;
  const bestCheck = (checks: { weaponId: string; check: FireCheck }[] | null) => {
    if (!checks?.length) return null;
    const pref = weaponId ? checks.find((c) => c.weaponId === weaponId && c.check.ok) : undefined;
    return pref ?? [...checks].sort((a, b) => b.check.p - a.check.p)[0];
  };

  const send = useCallback(
    async (cmd: Command): Promise<boolean> => {
      if (!token || busy.current) return false;
      busy.current = true;
      try {
        const r = await api.command(p.gameId, token, cmd);
        if (!r.ok) {
          flash(t(`err.${r.code}`, r.params) === `err.${r.code}` ? t('err.generic', { code: r.code }) : t(`err.${r.code}`, r.params));
          return false;
        }
        await refresh();
        return true;
      } catch {
        flash(t('err.network'));
        return false;
      } finally {
        busy.current = false;
      }
    },
    [token, p.gameId, refresh],
  );

  const ownOrder = own.filter((u) => u.hex || u.carriedBy);
  const cycle = (d: 1 | -1) => {
    if (!ownOrder.length) return;
    const i = ownOrder.findIndex((u) => u.id === selId);
    const n = ownOrder[(i + d + ownOrder.length) % ownOrder.length];
    setSelId(n.id);
    setWeaponId(null);
    const at = n.hex ?? units.find((x) => x.id === n.carriedBy)?.hex;
    if (at) mapRef.current?.centreOn(at);
  };

  const onHexClick = async (h: Hex, button: number) => {
    if (!view || !ctx) return;
    const here = units.filter((u) => u.hex && hexEquals(u.hex, h));
    const mineHere = here.filter((u) => u.own);
    if (button === 2) {
      setMode({ kind: 'normal' });
      if (mineHere.length) setSelId(mineHere[0].id);
      return;
    }
    if (view.phase === 'deploy') {
      if (mineHere.length && (!selected || mineHere.some((u) => u.id === selId) || !myTurn)) {
        const i = mineHere.findIndex((u) => u.id === selId);
        setSelId(mineHere[(i + 1) % mineHere.length].id);
        return;
      }
      if (selected?.own && myTurn && !selected.carriedBy) await send({ type: 'Deploy', unitId: selected.id, hex: h });
      return;
    }
    if (mode.kind === 'artillery') {
      if (await send({ type: 'CallFire', assetId: mode.assetId, hex: h })) setMode({ kind: 'normal' });
      return;
    }
    if (mode.kind === 'indirect') {
      if (await send({ type: 'IndirectFire', unitId: mode.unitId, weaponId: mode.weaponId, hex: h })) setMode({ kind: 'normal' });
      return;
    }
    const enemyHere = here.find((u) => !u.own);
    if (enemyHere && selected?.own && myTurn) {
      const b = bestCheck(fireChecks(selected, enemyHere));
      if (b?.check.ok) {
        await send({ type: 'Fire', unitId: selected.id, weaponId: b.weaponId, targetId: enemyHere.id });
        return;
      }
      if (b) flash(t(`err.${b.check.reason}`));
    }
    if (mineHere.length) {
      const i = mineHere.findIndex((u) => u.id === selId);
      setSelId(mineHere[(i + 1) % mineHere.length].id);
      setWeaponId(null);
      return;
    }
    if (selected?.own && myTurn && reach?.get(hexKey(h))?.canStop && !hexEquals(selected.hex!, h)) {
      await send({ type: 'MoveUnit', unitId: selected.id, to: h });
      return;
    }
    if (enemyHere) setSelId(enemyHere.id);
  };

  const autoDeploy = async () => {
    if (!ctx || !view) return;
    for (const c of planDeployment(knowledge(ctx, side), view)) await send(c);
  };

  const endTurn = async () => {
    setPanel(null);
    setMode({ kind: 'normal' });
    await send(view?.phase === 'deploy' ? { type: 'EndDeployment' } : { type: 'EndTurn' });
  };

  // Read-only automation hook for UI tests: screen position of a hex and this side's own view (no hidden data).
  useEffect(() => {
    (window as unknown as { __tht?: unknown }).__tht = {
      view,
      side,
      myTurn,
      reach: reach ? [...reach.entries()].filter(([, n]) => n.canStop).map(([k, n]) => ({ key: k, band: n.band, cost: n.cost })) : [],
      screenOf(h: Hex) {
        const r = mapRef.current?.renderer();
        if (!r) return null;
        const rect = r.canvas.getBoundingClientRect();
        const pt = r.toScreen(r.centre(h));
        return { x: rect.left + pt.x, y: rect.top + pt.y };
      },
      centreOn(h: Hex) {
        mapRef.current?.centreOn(h);
      },
    };
  });

  // keyboard (UI-03)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
      const m = mapRef.current;
      const k = e.key.toLowerCase();
      if (k === 'escape') {
        setMode({ kind: 'normal' });
        setPanel(null);
        return;
      }
      if (panel) return;
      if (k === 'n' || k === 'tab') {
        e.preventDefault();
        cycle(1);
      } else if (k === 'p') cycle(-1);
      else if (k === 'e' && myTurn) setPanel('confirmEnd');
      else if (k === 'v') setShowViewshed((x) => !x);
      else if (k === 'g') setGrid((x) => !x);
      else if (k === 'l') setLabels((x) => !x);
      else if (k === 'a' && myTurn) setPanel('artillery');
      else if (k === 'o') setPanel('objectives');
      else if (k === 'd') setPanel('data');
      else if (k === 'h' || k === '?') setPanel('help');
      else if (k === '+' || k === '=') m?.zoom(1.25);
      else if (k === '-') m?.zoom(0.8);
      else if (k === 'f') m?.fit();
      else if (k.startsWith('arrow')) {
        const r = m?.renderer();
        if (!r) return;
        e.preventDefault();
        r.panBy(k === 'arrowleft' ? 120 : k === 'arrowright' ? -120 : 0, k === 'arrowup' ? 120 : k === 'arrowdown' ? -120 : 0);
        m?.redraw();
        setCamTick((x) => x + 1);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (!saved || !token) {
    return (
      <div className="page">
        <p>This game is not saved on this computer.</p>
        <button className="btn" onClick={p.onExit}>
          {t('result.back')}
        </button>
      </div>
    );
  }
  if (!cs || !ctx || !view || !scenarioMeta) return <div className="page muted">Loading…</div>;

  const scenario = scenarioMeta;
  const zone = view.phase === 'deploy' && myTurn ? new Set(view.deploymentZone.map(hexKey)) : null;
  const path = reach && hover.hex && reach.get(hexKey(hover.hex))?.canStop ? pathTo(reach, hover.hex) : null;
  const scene: Scene = {
    viewer: side,
    units,
    ghosts: view.ghosts,
    objectives: view.objectives,
    selectedId: selId,
    reach,
    viewshed,
    zone,
    targets,
    attackable,
    hover: hover.hex,
    path: path && selected?.hex ? [selected.hex, ...path] : null,
    pendingFires: view.pendingFires.map((f) => ({ hex: f.hex, impactTurn: f.impactTurn })),
    effects,
    grid,
    labels,
    turn: view.turn,
  };
  const unplaced = view.phase === 'deploy' ? own.filter((u) => !u.hex && !u.carriedBy) : [];
  const artyTargetOdds =
    mode.kind !== 'normal' && hover.hex
      ? units
          .filter((u) => u.hex && hexDistance(u.hex, hover.hex!) <= 1)
          .map((u) => {
            const w = ctx.data.weapon(mode.kind === 'artillery' ? view.fireSupport.find((f) => f.id === mode.assetId)!.weaponId : mode.weaponId);
            const from = mode.kind === 'indirect' ? units.find((x) => x.id === mode.unitId)?.hex : null;
            const b = indirectHit(ctx, w, from ? hexDistance(from, hover.hex!) : null, u, true, !hexEquals(u.hex!, hover.hex!));
            return { u, p: b.p };
          })
          .filter((x) => x.p > 0)
      : [];

  return (
    <div className="game" data-testid="game">
      <TopBar view={view} side={side} title={scenario.title} aiThinking={cs.aiThinking} classification={scenario.classification} />
      <div className="mapzone">
        {handover ? (
          <div className="handover" data-testid="handover">
            <h2>{t('handover.title', { side: t(`side.${handover}`) })}</h2>
            <p>{t('handover.text', { side: t(`side.${handover}`) })}</p>
            <button
              className="btn primary"
              onClick={() => {
                setSelId(null);
                setHandover(null);
                setToken(saved.tokens[handover]!);
              }}
            >
              {t('handover.ready', { side: t(`side.${handover}`) })}
            </button>
          </div>
        ) : (
          <MapView
            ref={mapRef}
            map={ctx.map}
            data={ctx.data}
            scene={scene}
            onHexClick={onHexClick}
            onHover={(hex, x, y) => setHover((cur) => (cur.hex && hex && hexEquals(cur.hex, hex) ? cur : { hex, x, y }))}
            onCamera={() => setCamTick((x) => x + 1)}
            initialFrame={[...ownOnMap.map((u) => u.hex!), ...view.deploymentZone].slice(0, 400)}
          />
        )}
        {!handover && (
          <>
            <div className="left-col">
              {view.phase === 'deploy' ? (
                <div className="panel deploy" data-testid="deploy-tray">
                  <div className="panel-h">{t('deploy.title')}</div>
                  <div className="small">{myTurn ? t('deploy.help') : t('deploy.waiting')}</div>
                  {unplaced.length > 0 && <div className="small muted">{t('deploy.unplaced')}:</div>}
                  {own
                    .filter((u) => !u.carriedBy)
                    .map((u) => (
                      <button key={u.id} className={`chip${u.id === selId ? ' on' : ''}${u.hex ? '' : ' warn'}`} onClick={() => (setSelId(u.id), u.hex && mapRef.current?.centreOn(u.hex))}>
                        {u.name}
                      </button>
                    ))}
                </div>
              ) : (
                <CombatLog items={log} ctx={ctx} side={side} />
              )}
            </div>
            <div className="right-col">
              <UnitCard
                unit={selected}
                view={view}
                ctx={ctx}
                checks={hoverChecks}
                weaponId={weaponId}
                myTurn={myTurn && view.phase === 'play'}
                onWeapon={setWeaponId}
                onIndirect={(w) => setMode({ kind: 'indirect', unitId: selected!.id, weaponId: w })}
                onAction={(kind, id) =>
                  kind === 'mount'
                    ? send({ type: 'Mount', unitId: selected!.id, vehicleId: id })
                    : send({ type: 'Dismount', unitId: id, hex: units.find((u) => u.id === selected!.id)?.hex ?? selected!.hex! })
                }
                showMaths={showMaths}
                onToggleMaths={() => setShowMaths((x) => !x)}
              />
            </div>
            {mode.kind !== 'normal' && (
              <div className="banner" data-testid="target-banner">
                {mode.kind === 'artillery' ? t('arty.pick') : t('mortar.pick')}
                {artyTargetOdds.length > 0 && (
                  <span>
                    {' '}
                    · {t('arty.odds')}: {artyTargetOdds.map((x) => `${x.u.own ? x.u.name : ctx.data.unitType(x.u.typeId).name} ${Math.round(x.p * 100)}%`).join(', ')}
                  </span>
                )}{' '}
                <button className="btn tiny" onClick={() => setMode({ kind: 'normal' })}>
                  {t('arty.cancel')}
                </button>
              </div>
            )}
            {hover.hex && hoverEnemy && selected?.own && mode.kind === 'normal' && hoverChecks && bestCheck(hoverChecks) && (
              <HitTip x={hover.x + 0} y={hover.y + 50} check={bestCheck(hoverChecks)!.check} weapon={ctx.data.weapon(bestCheck(hoverChecks)!.weaponId).name} />
            )}
            <Minimap renderer={mapRef.current?.renderer() ?? null} view={view} tick={camTick} onJump={(x, y) => {
              const r = mapRef.current?.renderer();
              if (!r) return;
              r.cam.x = x;
              r.cam.y = y;
              mapRef.current?.redraw();
              setCamTick((n) => n + 1);
            }} />
          </>
        )}
        {toast && <div className="toast" data-testid="toast">{toast}</div>}
        {!conn && <div className="toast warn">{t('conn.lost')}</div>}
      </div>
      <div className="bottombar">
        <HoverReadout hex={hover.hex} ctx={ctx} />
        <div className="bb-buttons">
          <button className="btn" onClick={() => setPanel('menu')}>
            {t('bar.menu')}
          </button>
          <button className="btn" onClick={() => setPanel('data')}>
            {t('bar.data')}
          </button>
          <button className="btn" onClick={() => setPanel('help')}>
            {t('bar.help')}
          </button>
          <button className="btn" onClick={() => setPanel('objectives')} data-testid="btn-objectives">
            {t('bar.objectives')}
          </button>
          <button className="btn" onClick={() => cycle(-1)}>
            {t('bar.prev')}
          </button>
          <button className="btn" onClick={() => cycle(1)} data-testid="btn-next">
            {t('bar.next')}
          </button>
          <button className={`btn${showViewshed ? ' on' : ''}`} onClick={() => setShowViewshed((x) => !x)} data-testid="btn-viewshed">
            {t('bar.viewshed')}
          </button>
          <button className="btn" onClick={() => mapRef.current?.zoom(1.25)} title={t('bar.zoomIn')}>
            +
          </button>
          <button className="btn" onClick={() => mapRef.current?.zoom(0.8)} title={t('bar.zoomOut')}>
            −
          </button>
          <button className="btn" onClick={() => mapRef.current?.fit()} title={t('bar.fit')}>
            ⤢
          </button>
          {view.phase === 'play' && (
            <button className="btn" disabled={!myTurn || !view.fireSupport.length} onClick={() => setPanel('artillery')} data-testid="btn-artillery">
              {t('bar.artillery')} ({view.fireSupport.reduce((m, f) => m + f.missionsLeft, 0)})
            </button>
          )}
          {view.phase === 'deploy' && myTurn && unplaced.length > 0 && (
            <button className="btn" onClick={autoDeploy}>
              {t('bar.autoDeploy')}
            </button>
          )}
          <button className="btn primary" disabled={!myTurn} onClick={() => (view.phase === 'deploy' ? endTurn() : setPanel('confirmEnd'))} data-testid="btn-end">
            {view.phase === 'deploy' ? t('bar.endDeploy') : t('bar.endTurn')}
          </button>
        </div>
      </div>
      {panel === 'confirmEnd' && (
        <Modal title={t('bar.endTurn')} onClose={() => setPanel(null)} testId="confirm-end">
          <p>
            {t('phase.play', { turn: view.turn, turns: view.turns })} — {t('bar.endTurn')}?
          </p>
          <button className="btn primary" onClick={endTurn} data-testid="btn-confirm-end">
            {t('bar.endTurn')}
          </button>
        </Modal>
      )}
      {panel === 'objectives' && <ObjectivesPanel objectives={view.objectives} vp={view.vp} onClose={() => setPanel(null)} onJump={(h) => (setPanel(null), mapRef.current?.centreOn(h))} />}
      {panel === 'data' && <DataPanel ctx={ctx} onClose={() => setPanel(null)} />}
      {panel === 'help' && <HelpPanel onClose={() => setPanel(null)} />}
      {panel === 'menu' && (
        <Modal title={t('menu.title')} onClose={() => setPanel(null)} testId="menu">
          <p className="small">{t('menu.about')}</p>
          <label className="check">
            <input type="checkbox" checked={grid} onChange={() => setGrid((x) => !x)} /> {t('menu.grid')}
          </label>
          <label className="check">
            <input type="checkbox" checked={labels} onChange={() => setLabels((x) => !x)} /> {t('menu.labels')}
          </label>
          <p>
            <button className="btn" onClick={p.onExit}>
              {t('menu.exit')}
            </button>
          </p>
        </Modal>
      )}
      {panel === 'artillery' && (
        <Modal title={t('arty.title')} onClose={() => setPanel(null)} testId="artillery">
          {!view.fireSupport.length && <p>{t('arty.none')}</p>}
          {view.fireSupport.map((f) => (
            <div key={f.id} className="arty-row">
              <div>
                <b>{f.name}</b> — {ctx.data.weapon(f.weaponId).name}
                <div className="small muted">
                  {t('arty.missions', { n: f.missionsLeft })} · {t('arty.from', { turn: f.fromTurn })} · {f.delay ? t('arty.delay', { n: f.delay }) : t('arty.now')}
                </div>
              </div>
              <button
                className="btn primary"
                disabled={!f.available || !myTurn}
                onClick={() => {
                  setMode({ kind: 'artillery', assetId: f.id });
                  setPanel(null);
                }}
              >
                {t('bar.artillery')}
              </button>
            </div>
          ))}
        </Modal>
      )}
      {view.phase === 'over' && view.result && resultOpen && (
        <Modal title={t('result.title')} onClose={() => setResultOpen(false)} testId="result">
          <h2 className={view.result.winner ? `own-${view.result.winner}` : ''}>
            {view.result.winner ? t('result.winner', { side: t(`side.${view.result.winner}`) }) : t('result.draw')} {t(`result.reason.${view.result.reason}`)}
          </h2>
          <table className="tbl">
            <tbody>
              <tr>
                <td>{t('result.vp')}</td>
                <td className="own-blue">{view.result.vp.blue}</td>
                <td className="own-red">{view.result.vp.red}</td>
              </tr>
              <tr>
                <td>{t('result.losses')}</td>
                <td className="own-blue">{view.result.stepsLost.blue}</td>
                <td className="own-red">{view.result.stepsLost.red}</td>
              </tr>
              <tr>
                <td>{t('result.score')}</td>
                <td className="own-blue">{view.result.score.blue}</td>
                <td className="own-red">{view.result.score.red}</td>
              </tr>
            </tbody>
          </table>
          <p>
            <button className="btn" onClick={() => setResultOpen(false)}>
              {t('result.review')}
            </button>{' '}
            <button className="btn primary" onClick={p.onExit}>
              {t('result.back')}
            </button>
          </p>
        </Modal>
      )}
    </div>
  );
}

export { otherSide };

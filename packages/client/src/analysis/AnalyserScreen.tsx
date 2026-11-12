// Terrain & plan analyser — training aid on fictional sectors (IN/TA/DEP/EN/OUT features).
import {
  type AnalysisParams,
  type AnalysisReport,
  type DataBundle,
  type DefenceMode,
  type GameMap,
  type Hex,
  type MapModel,
  type Rating,
  type Ruleset,
  hexKey,
  hexToPoint,
  reportToCSV,
  reportToGeoJSON,
  viewshed,
} from '@tht/engine';
import { useEffect, useMemo, useRef, useState } from 'react';
import { api, mapModel, ruleset } from '../api';
import { MapView, type MapViewHandle } from '../game/MapView';
import type { Overlay, Scene } from '../game/render';
import type { AnalyseRequest } from './worker';

interface MapInfo { id: string; name: string; terrainClass: string; hasBorder: boolean; classification: string }

const LAYERS = [
  ['territory', 'Border & own / enemy ground'],
  ['ridges', 'Ridgelines'],
  ['nullahs', 'Nullahs / drainage'],
  ['itgs', 'Key ground (ITGs)'],
  ['approaches', 'Approaches'],
  ['positions', 'Own deployment'],
  ['weapons', 'Weapon sites + ranges'],
  ['mortars', 'Mortars + coverage'],
  ['surveillance', 'Border observation & gaps'],
  ['infiltration', 'Infiltration routes'],
  ['options', 'Enemy attack options'],
  ['exploitable', 'Exploitable features'],
] as const;
type LayerId = (typeof LAYERS)[number][0];
type Heat = 'none' | 'value' | 'dominance' | 'slope';
type Tab = 'summary' | 'ground' | 'deploy' | 'enemy';

const RATING_COLOR: Record<Rating, string> = { good: '#3fae5a', adequate: '#e0a526', 'not good': '#e2513b' };
const POS_COLOR = { platoon: '#3b82c9', company_hq: '#1d5f96', bn_hq: '#0d2c46', reserve: '#6b8fb5', post: '#2aa198' } as const;
const APP_COLORS = ['#c2185b', '#7b1fa2', '#5d4037', '#d84315', '#455a64', '#00838f'];

function download(name: string, text: string, type: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function insidePolygon(p: { x: number; y: number }, poly: { x: number; y: number }[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

function Badge({ r }: { r: Rating | string }) {
  const c = RATING_COLOR[r as Rating] ?? '#6b7a86';
  return (
    <span className="rbadge" style={{ background: c }}>
      {r}
    </span>
  );
}

export function AnalyserScreen(p: { onExit(): void }) {
  const [maps, setMaps] = useState<MapInfo[]>([]);
  const [mapId, setMapId] = useState('');
  const [map, setMap] = useState<MapModel | null>(null);
  const [data, setData] = useState<Ruleset | null>(null);
  const [paramSets, setParamSets] = useState<Record<string, AnalysisParams>>({});
  const [paramId, setParamId] = useState('');
  const [mode, setMode] = useState<DefenceMode>('mountain');
  const [poly, setPoly] = useState<Hex[]>([]);
  const [drawing, setDrawing] = useState(false);
  const [report, setReport] = useState<AnalysisReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [heat, setHeat] = useState<Heat>('value');
  const [layers, setLayers] = useState<Record<LayerId, boolean>>({ territory: true, ridges: true, nullahs: false, itgs: true, approaches: true, positions: true, weapons: false, mortars: false, surveillance: false, infiltration: false, options: true, exploitable: false });
  const [tab, setTab] = useState<Tab>('summary');
  const [focus, setFocus] = useState<{ hex: Hex; range?: number; label: string } | null>(null);
  const [hover, setHover] = useState<Hex | null>(null);
  const view = useRef<MapViewHandle>(null);
  const worker = useRef<Worker | null>(null);
  const reqId = useRef(0);

  useEffect(() => {
    fetch('/api/maps')
      .then((r) => r.json() as Promise<MapInfo[]>)
      .then((list) => {
        const usable = list.filter((m) => m.hasBorder);
        setMaps(usable);
        setMapId((cur) => cur || usable[0]?.id || '');
      });
    fetch('/api/analysis-params')
      .then((r) => r.json() as Promise<Record<string, AnalysisParams>>)
      .then((ps) => {
        setParamSets(ps);
        setParamId(Object.keys(ps)[0] ?? '');
      });
    ruleset().then(setData);
    return () => worker.current?.terminate();
  }, []);

  useEffect(() => {
    if (!mapId) return;
    setReport(null);
    setPoly([]);
    setFocus(null);
    mapModel(mapId).then(setMap);
  }, [mapId]);

  const params = paramSets[paramId];

  const aoiHexes = useMemo(() => {
    if (!map || poly.length < 3) return null;
    const pts = poly.map((h) => hexToPoint(h, map.def.orientation, map.def.hexSize_m));
    return map.list.filter((h) => insidePolygon(hexToPoint(h, map.def.orientation, map.def.hexSize_m), pts)).map((h) => ({ q: h.q, r: h.r }));
  }, [map, poly]);

  const run = async () => {
    if (!map || !params || !data) return;
    setBusy(true);
    setError('');
    worker.current ??= new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    const id = ++reqId.current;
    const raw = (await api.data()) as unknown as DataBundle;
    const msg: AnalyseRequest = { id, map: map.def as GameMap, data: raw, params, mode, aoi: aoiHexes ?? undefined };
    worker.current.onmessage = (e: MessageEvent<{ id: number; report?: AnalysisReport; error?: string }>) => {
      if (e.data.id !== reqId.current) return;
      setBusy(false);
      if (e.data.error) setError(e.data.error);
      else setReport(e.data.report!);
    };
    worker.current.postMessage(msg);
  };

  const focusVs = useMemo(() => {
    if (!map || !focus || !params) return null;
    return viewshed(map, focus.hex, focus.range ?? params.terrain.observationRange, { observerHeight_m: 1.6, targetHeight_m: 1 });
  }, [map, focus, params]);

  const overlay: Overlay = useMemo(() => {
    const o: Overlay = { fills: [], lines: [], markers: [], polygon: poly };
    if (!report) return o;
    const T = report.terrain;
    if (heat === 'value') o.heat = { values: T.value, ramp: 'value' };
    else if (heat === 'dominance') o.heat = { values: T.dominance, ramp: 'value' };
    else if (heat === 'slope') o.heat = { values: Object.fromEntries(Object.entries(T.slope).map(([k, v]) => [k, Math.min(1, v / 100)])), ramp: 'slope' };
    if (layers.territory) {
      o.fills!.push({ keys: report.territory.enemy, style: 'rgba(200,60,40,0.10)' });
      o.fills!.push({ keys: report.territory.border, style: 'rgba(200,30,30,0.55)' });
    }
    if (layers.nullahs) o.fills!.push({ keys: T.nullahs, style: 'rgba(40,110,220,0.45)' });
    if (layers.surveillance) {
      o.fills!.push({ keys: report.deployment.observed, style: 'rgba(60,180,90,0.16)' });
      for (const g of report.deployment.surveillance.gaps) o.lines!.push({ hexes: [g.from, g.to], color: '#ff1744', width: 6, label: `gap ${g.length_m} m` });
    }
    if (focusVs) o.fills!.push({ keys: focusVs, style: 'rgba(255,150,40,0.28)' });
    if (layers.ridges) for (const r of T.ridges) o.lines!.push({ hexes: [...r.hexes].sort((a, b) => a.q - b.q || a.r - b.r), color: '#6d4c41', width: 2, dash: [2, 3] });
    if (layers.ridges) for (const r of T.ridges) for (const h of r.hexes) o.markers!.push({ hex: h, label: '', color: '#6d4c41', shape: 'circle', size: 0.25 });
    if (layers.approaches)
      report.approaches.forEach((a, i) => o.lines!.push({ hexes: a.path, color: APP_COLORS[i % APP_COLORS.length], width: 4, label: a.id, arrow: true }));
    if (layers.infiltration) for (const r of report.enemy.infiltration) o.lines!.push({ hexes: r.path, color: '#ff6f00', width: 2.5, dash: [6, 4], label: r.id, arrow: true });
    if (layers.options)
      for (const x of report.enemy.options) {
        o.lines!.push({ hexes: x.axis, color: '#d50000', width: x.likelihood === 'most likely' ? 7 : 4, label: `${x.id} ${x.likelihood}`, arrow: true });
        if (x.fup) o.markers!.push({ hex: x.fup, label: `FUP ${x.id}`, color: '#d50000', shape: 'diamond', size: 0.8 });
      }
    if (layers.itgs) {
      for (const i of report.itgs) o.fills!.push({ keys: i.extent.map(hexKey), style: i.vital ? 'rgba(255,212,0,0.35)' : 'rgba(255,212,0,0.18)' });
      for (const i of report.itgs) o.markers!.push({ hex: i.hex, label: `${i.id} ${i.name}${i.vital ? ' ★' : ''}`, color: RATING_COLOR[i.rating], shape: 'triangle', size: 1.2 });
    }
    if (layers.exploitable) for (const e of report.enemy.exploitable) o.markers!.push({ hex: e.hex, label: e.kind, color: '#ff6f00', shape: 'diamond', size: 0.7 });
    if (layers.mortars) for (const m of report.deployment.mortars.sites) o.markers!.push({ hex: m.hex, label: m.id, color: '#6a1b9a', shape: 'circle', ring: m.maxRange_m / (map?.def.hexSize_m ?? 100) });
    if (layers.weapons) for (const w of report.deployment.weapons) o.markers!.push({ hex: w.hex, label: w.id, color: '#00897b', shape: 'circle', size: 0.6, ring: w.effRange_m / (map?.def.hexSize_m ?? 100) });
    if (layers.positions)
      for (const x of report.deployment.positions) o.markers!.push({ hex: x.hex, label: x.id, color: POS_COLOR[x.kind], shape: x.kind === 'post' ? 'circle' : 'square', size: x.kind === 'post' ? 0.7 : 1 });
    return o;
  }, [report, heat, layers, poly, focusVs, map]);

  const scene: Scene = { viewer: 'blue', units: [], ghosts: [], objectives: [], grid: false, labels: true, turn: 0, overlay, hover };

  const clickHex = (h: Hex) => {
    if (drawing) setPoly((ps) => [...ps, h]);
    else setFocus({ hex: h, label: map?.gridRef(h) ?? '' });
  };
  const goto = (h: Hex, label: string, range?: number) => {
    setFocus({ hex: h, label, range });
    view.current?.centreOn(h);
  };

  const hk = hover ? hexKey(hover) : '';
  const info = maps.find((m) => m.id === mapId);

  return (
    <div className="game analyser">
      <div className="topbar">
        <button className="btn" onClick={p.onExit}>
          ← Home
        </button>
        <div className="tb-title">
          <b>Terrain &amp; Plan Analyser</b>
          <span className="tb-class">{info?.classification ?? ''} · training aid</span>
        </div>
        <select className="input sel" value={mapId} onChange={(e) => setMapId(e.target.value)} data-testid="an-map">
          {maps.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
        <select className="input sel" value={mode} onChange={(e) => setMode(e.target.value as DefenceMode)} data-testid="an-mode">
          {params && (Object.keys(params.modes) as DefenceMode[]).map((m) => (
            <option key={m} value={m}>
              {params.modes[m].label}
            </option>
          ))}
        </select>
        {Object.keys(paramSets).length > 1 && (
          <select className="input sel" value={paramId} onChange={(e) => setParamId(e.target.value)}>
            {Object.keys(paramSets).map((k) => (
              <option key={k}>{k}</option>
            ))}
          </select>
        )}
        <button className={`btn ${drawing ? 'primary' : ''}`} onClick={() => setDrawing((d) => !d)} title="Click map hexes to mark the corners of the area of interest">
          {drawing ? 'Finish AOI' : 'Draw AOI'}
        </button>
        {poly.length > 0 && (
          <button className="btn" onClick={() => setPoly([])}>
            Clear AOI
          </button>
        )}
        <button className="btn primary" disabled={busy || !map || !params} onClick={run} data-testid="an-run">
          {busy ? 'Analysing…' : 'Analyse'}
        </button>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
          <button className="btn" disabled={!report || !map} onClick={() => download(`${report!.mapId}-${report!.mode}.geojson`, JSON.stringify(reportToGeoJSON(map!, report!), null, 1), 'application/geo+json')} data-testid="an-geojson">
            GeoJSON
          </button>
          <button className="btn" disabled={!report || !map} onClick={() => download(`${report!.mapId}-${report!.mode}.csv`, reportToCSV(map!, report!), 'text/csv')}>
            CSV
          </button>
        </div>
      </div>
      <div className="mapzone">
        {map && data && <MapView ref={view} map={map} data={data} scene={scene} onHexClick={clickHex} onHover={(h) => setHover(h)} />}
        <div className="left-col">
          <div className="panel" style={{ pointerEvents: 'auto' }}>
            <div className="panel-h">Layers</div>
            <div className="small" style={{ marginBottom: 4 }}>
              Shading:{' '}
              {(['none', 'value', 'dominance', 'slope'] as Heat[]).map((h) => (
                <label key={h} style={{ marginRight: 8 }}>
                  <input type="radio" checked={heat === h} onChange={() => setHeat(h)} /> {h}
                </label>
              ))}
            </div>
            {LAYERS.map(([id, label]) => (
              <label key={id} className="check small">
                <input type="checkbox" checked={layers[id]} onChange={(e) => setLayers({ ...layers, [id]: e.target.checked })} /> {label}
              </label>
            ))}
            <div className="small muted" style={{ marginTop: 6 }}>
              {drawing ? `Drawing AOI: ${poly.length} corners — click hexes, then Finish.` : aoiHexes ? `AOI: ${aoiHexes.length} hexes` : 'AOI: whole sector'}
            </div>
            {focus && (
              <div className="small" style={{ marginTop: 4 }}>
                Viewshed from <b>{focus.label}</b>{' '}
                <button className="chip" onClick={() => setFocus(null)}>
                  clear
                </button>
              </div>
            )}
          </div>
          {params && (
            <div className="panel small muted" style={{ pointerEvents: 'auto', marginTop: 6 }}>
              Parameters: {params.source}
            </div>
          )}
        </div>
        <div className="right-col an-right" style={{ maxHeight: 'calc(100% - 16px)' }}>
          <div className="panel" style={{ pointerEvents: 'auto' }}>
            {!report && !busy && <p className="small muted">Choose a sector and a defence mode, optionally draw an area of interest, then press Analyse.</p>}
            {busy && <p className="small">Analysing terrain, deployment and enemy options…</p>}
            {error && <p className="small" style={{ color: 'var(--bad)' }}>{error}</p>}
            {report && (
              <>
                <div className="tabs">
                  {(['summary', 'ground', 'deploy', 'enemy'] as Tab[]).map((x) => (
                    <button key={x} className={`chip ${tab === x ? 'on' : ''}`} onClick={() => setTab(x)} data-testid={`an-tab-${x}`}>
                      {{ summary: 'Summary', ground: 'Key ground', deploy: 'Deployment', enemy: 'Enemy' }[x]}
                    </button>
                  ))}
                </div>
                {tab === 'summary' && <Summary r={report} goto={goto} />}
                {tab === 'ground' && <Ground r={report} goto={goto} obsRange={params?.terrain.observationRange} />}
                {tab === 'deploy' && <Deploy r={report} goto={goto} survRange={params?.surveillance.range_hex} />}
                {tab === 'enemy' && <Enemy r={report} goto={goto} />}
              </>
            )}
          </div>
        </div>
      </div>
      <div className="bottombar">
        <div className="readout" data-testid="an-readout">
          {hover && map?.has(hover)
            ? `GR ${map.gridRef(hover)} · ${Math.round(map.elevation(hover))} m · ${map.cell(hover).terrain.name}` +
              (report ? ` · slope ${report.terrain.slope[hk] ?? '–'}% ${report.terrain.aspect[hk] ?? ''} · value ${Math.round((report.terrain.value[hk] ?? 0) * 100)}%` : '')
            : 'Hover the map for grid reference, height, slope and terrain value. Click a hex for its viewshed.'}
        </div>
        {report && <span className="small muted">{Object.values(report.timings).reduce((m, x) => m + x, 0).toFixed(0)} ms</span>}
      </div>
    </div>
  );
}

type Goto = (h: Hex, label: string, range?: number) => void;

function Summary({ r, goto }: { r: AnalysisReport; goto: Goto }) {
  return (
    <div className="small">
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '6px 0' }}>
        <b style={{ fontSize: 14 }}>{r.modeLabel}</b>
        <Badge r={r.summary.overall} />
        <span className="muted">score {Math.round(r.summary.score * 100)}%</span>
      </div>
      <table className="tbl stats">
        <tbody>
          <tr><td>Height range</td><td className="num">{r.terrain.minElev}–{r.terrain.maxElev} m</td></tr>
          <tr><td>Mean slope / ground over 30 %</td><td className="num">{r.terrain.meanSlopePct}% / {r.terrain.steepPct}%</td></tr>
          <tr><td>Ridgelines / nullah hexes</td><td className="num">{r.terrain.ridges.length} / {r.terrain.nullahs.length}</td></tr>
          <tr><td>Key ground (ITGs)</td><td className="num">{r.itgs.length}</td></tr>
          <tr><td>Border observed</td><td className="num">{r.deployment.surveillance.observedPct}%</td></tr>
          <tr><td>Mortar cover / interlock</td><td className="num">{r.deployment.mortars.coveredPct}% / {r.deployment.mortars.interlockPct}%</td></tr>
        </tbody>
      </table>
      {r.summary.lines.map((l, i) => (
        <p key={i} style={{ margin: '4px 0' }}>{l}</p>
      ))}
      <div className="panel-h" style={{ marginTop: 8 }}>Recommendations ({r.recommendations.length})</div>
      {r.recommendations.map((x, i) => (
        <div key={i} className={`rec rec-${x.severity} ${x.hex ? 'clickable' : ''}`} onClick={() => x.hex && goto(x.hex, 'recommendation')}>
          {x.text}
        </div>
      ))}
      {!r.recommendations.length && <p className="muted">No significant weaknesses found.</p>}
    </div>
  );
}

function Ground({ r, goto, obsRange }: { r: AnalysisReport; goto: Goto; obsRange?: number }) {
  return (
    <div className="small">
      <div className="panel-h" style={{ marginTop: 6 }}>Key ground</div>
      {r.itgs.map((i) => (
        <div key={i.id} className="item clickable" onClick={() => goto(i.hex, i.name, obsRange)} data-testid="an-itg">
          <div className="item-h">
            <b>{i.id} {i.name}</b> {i.vital && <span className="tag">vital</span>} <Badge r={i.rating} />
          </div>
          <div className="muted">GR {i.gr} · {i.elevation} m · {i.area_ha} ha · needs a <b>{i.force}</b> · {i.occupied ? 'occupied' : 'not occupied'}</div>
          <div>{i.reasons.join(' · ')}</div>
          {i.approaches.length > 0 && <div className="muted">Sees {i.approaches.map((a) => `${a.id} ${a.pct}%`).join(', ')} · nullahs {i.nullahCoverPct}%</div>}
        </div>
      ))}
      {r.mutualSupport.length > 0 && <p className="muted">Mutually supporting: {r.mutualSupport.map((x) => x.join('–')).join(', ')}</p>}
      <div className="panel-h" style={{ marginTop: 8 }}>Ridgelines</div>
      {r.terrain.ridges.slice(0, 8).map((x) => (
        <div key={x.id} className="item clickable" onClick={() => goto(x.hexes[0], x.id)}>
          <b>{x.id}</b> {x.length_m} m long, top {x.maxElev} m{x.crossesBorder ? ' · crosses the border' : ''}
        </div>
      ))}
    </div>
  );
}

function Deploy({ r, goto, survRange }: { r: AnalysisReport; goto: Goto; survRange?: number }) {
  const d = r.deployment;
  return (
    <div className="small">
      <div className="panel-h" style={{ marginTop: 6 }}>Positions</div>
      <table className="tbl">
        <tbody>
          {d.positions.map((x) => (
            <tr key={x.id} className="clickable" onClick={() => goto(x.hex, x.name, x.kind === 'post' ? survRange : 15)} title={x.reasons.join('\n')}>
              <td><b>{x.id}</b></td>
              <td>{x.name}</td>
              <td className="muted">{x.gr}</td>
              <td className="num">{x.distToBorder_m} m</td>
              <td><Badge r={x.rating} /></td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="panel-h" style={{ marginTop: 8 }}>Weapon sites</div>
      <table className="tbl">
        <tbody>
          {d.weapons.map((w) => (
            <tr key={w.id} className="clickable" onClick={() => goto(w.hex, w.name, Math.round(w.effRange_m / 100))}>
              <td><b>{w.id}</b></td>
              <td>{w.name}</td>
              <td className="muted">{w.positionId}</td>
              <td className="num">{w.effRange_m} m</td>
              <td className="num">{w.coveragePct}%</td>
              <td><Badge r={w.rating} /></td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="panel-h" style={{ marginTop: 8 }}>Mortars <Badge r={d.mortars.rating} /></div>
      <p className="muted">Targets: {d.mortars.targetHexes} hexes of approach / infiltration ground. Covered {d.mortars.coveredPct}%, interlocking (≥ 2 sections) {d.mortars.interlockPct}%.</p>
      {d.mortars.sites.map((m) => (
        <div key={m.id} className="item clickable" onClick={() => goto(m.hex, m.name)}>
          <b>{m.id}</b> {m.name} · GR {m.gr} · {m.minRange_m}–{m.maxRange_m} m · covers {m.coveragePct}%
        </div>
      ))}
      <div className="panel-h" style={{ marginTop: 8 }}>Border surveillance <Badge r={d.surveillance.rating} /></div>
      <p className="muted">{d.surveillance.observedPct}% of {d.surveillance.borderLength_m} m observed by posts and platoons.</p>
      {d.surveillance.gaps.map((g, i) => (
        <div key={i} className="item clickable" onClick={() => goto(g.from, 'gap')}>
          Gap {g.grFrom} – {g.grTo} ({g.length_m} m)
        </div>
      ))}
    </div>
  );
}

function Enemy({ r, goto }: { r: AnalysisReport; goto: Goto }) {
  return (
    <div className="small">
      <div className="panel-h" style={{ marginTop: 6 }}>Enemy attack options</div>
      {r.enemy.options.map((o) => (
        <div key={o.id} className="item clickable" onClick={() => goto(o.axis[o.axis.length - 1], o.id)} data-testid="an-option">
          <div className="item-h">
            <b>{o.id}</b> {o.name} <span className="tag">{o.likelihood}</span>
          </div>
          <div>{o.summary}</div>
        </div>
      ))}
      <div className="panel-h" style={{ marginTop: 8 }}>Approaches</div>
      <table className="tbl">
        <tbody>
          {r.approaches.map((a) => (
            <tr key={a.id} className="clickable" onClick={() => a.crossing && goto(a.crossing, a.name)}>
              <td><b>{a.id}</b></td>
              <td>{a.kind}</td>
              <td className="num">{(a.length_m / 1000).toFixed(1)} km</td>
              <td className="num">{a.time_min} min</td>
              <td>{a.capacity}</td>
              <td className="num" title="dead ground from key ground">{a.deadGroundPct}% dg</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="panel-h" style={{ marginTop: 8 }}>Infiltration routes</div>
      {r.enemy.infiltration.map((x) => (
        <div key={x.id} className="item clickable" onClick={() => x.crossing && goto(x.crossing, x.id)}>
          <b>{x.id}</b> <span className="tag">{x.rating}</span> crosses at {x.crossingGr || '—'} · {(x.length_m / 1000).toFixed(1)} km, {x.time_min} min · {x.exposurePct}% within night observation
        </div>
      ))}
      <div className="panel-h" style={{ marginTop: 8 }}>Exploitable ridgelines, valleys, nullahs</div>
      {r.enemy.exploitable.map((e, i) => (
        <div key={i} className="item clickable" onClick={() => goto(e.hex, e.name)}>
          <b>{e.kind}</b> {e.name} — {e.note}
        </div>
      ))}
    </div>
  );
}

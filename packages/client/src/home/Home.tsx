import type { Scenario, Side } from '@tht/engine';
import { useEffect, useState } from 'react';
import { type ScenarioSummary, api, ruleset, saveGame, savedGames } from '../api';
import { sidcFor, symbolDataUrl } from '../game/symbols';
import { t } from '../i18n';

export function Home(p: { onOpen(id: string): void; onResume(gameId: string): void }) {
  const [list, setList] = useState<ScenarioSummary[] | null>(null);
  const [err, setErr] = useState(false);
  useEffect(() => {
    api.scenarios().then(setList, () => setErr(true));
  }, []);
  const games = savedGames();
  return (
    <div className="page home">
      <header className="hero">
        <h1>{t('app.name')}</h1>
        <p className="muted">{t('app.tagline')}</p>
      </header>
      {err && <p className="toast warn static">{t('err.network')}</p>}
      <h2>{t('home.scenarios')}</h2>
      <div className="cards">
        {(list ?? []).map((s) => (
          <button key={s.id} className="scard" onClick={() => p.onOpen(s.id)} data-testid={`scenario-${s.id}`}>
            <div className="scard-title">{s.title}</div>
            <div className="muted small">
              {t('home.turns', { turns: s.turns, min: s.minutesPerTurn })} · {s.timeOfDay} · {s.weather}
            </div>
            <p className="small">{s.briefing.mission}</p>
            <div className="small tag">{s.classification}</div>
            <span className="btn primary">{t('home.open')}</span>
          </button>
        ))}
      </div>
      <h2>Terrain &amp; plan analyser</h2>
      <button className="rrow" onClick={() => (location.hash = '/analyser')} data-testid="open-analyser">
        <b>Mountain border sectors (fictional)</b>
        <span className="muted small">Ridgelines, key ground, approaches, deployment in three modes, weapon and mortar siting, border surveillance, enemy infiltration and attack options — rated, with GeoJSON / CSV export.</span>
        <span className="btn">Open</span>
      </button>
      <h2>{t('home.resume')}</h2>
      {!games.length && <p className="muted">{t('home.noGames')}</p>}
      <div className="resume">
        {games.map((g) => (
          <button key={g.gameId} className="rrow" onClick={() => p.onResume(g.gameId)} data-testid="resume-game">
            <b>{g.title}</b>
            <span className="muted small">
              {g.mode === 'ai' ? t('home.vs', { side: t(`side.${g.side}`) }) : t('home.hotseat')} · {new Date(g.createdAt).toLocaleString()}
            </span>
            <span className="btn">{t('home.continue')}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

export function Briefing(p: { id: string; onBack(): void; onStarted(gameId: string): void }) {
  const [side, setSide] = useState<Side>('blue');
  const [mode, setMode] = useState<'ai' | 'hotseat'>('ai');
  const [seed, setSeed] = useState('');
  const [info, setInfo] = useState<{ summary: ScenarioSummary; scenario: Scenario } | null>(null);
  const [units, setUnits] = useState<Record<string, { name: string; symbol: string }>>({});
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api.scenario(p.id, side).then(setInfo);
    ruleset().then((d) => setUnits(Object.fromEntries(d.lists.units.map((u) => [u.id, { name: u.name, symbol: u.symbol }]))));
  }, [p.id, side]);
  useEffect(() => {
    if (info?.summary.ai) setSide(info.summary.ai.side === 'red' ? 'blue' : 'red');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [info?.summary.id]);
  if (!info) return <div className="page muted">Loading…</div>;
  const s = info.summary;
  const own = info.scenario.sides[side];
  const start = async () => {
    setBusy(true);
    try {
      const r = await api.createGame({ scenarioId: s.id, mode, side, seed: seed ? Number(seed) : undefined });
      saveGame({ gameId: r.gameId, scenarioId: s.id, title: s.title, mode, side, tokens: r.tokens, createdAt: Date.now() });
      p.onStarted(r.gameId);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="page brief" data-testid="briefing">
      <button className="btn ghost" onClick={p.onBack}>
        {t('brief.back')}
      </button>
      <h1>{s.title}</h1>
      <div className="small tag">{s.classification}</div>
      <div className="brief-grid">
        <section>
          <h3>{t('brief.situation')}</h3>
          <p>{s.briefing.situation}</p>
          <h3>{t('brief.mission')}</h3>
          <p>
            <b>{s.briefing.mission}</b>
          </p>
          <h3>{t('brief.forces')}</h3>
          <p>{s.briefing.forces}</p>
          <h3>{t('brief.time')}</h3>
          <p>{s.briefing.time}</p>
          <h3>{t('brief.victory')}</h3>
          <p>{s.briefing.victory}</p>
          {s.briefing.lessons.length > 0 && (
            <>
              <h3>{t('brief.lessons')}</h3>
              <ul>
                {s.briefing.lessons.map((l) => (
                  <li key={l}>{l}</li>
                ))}
              </ul>
            </>
          )}
        </section>
        <aside>
          <div className="panel">
            <h3>{t('brief.mode')}</h3>
            <label className="check">
              <input type="radio" name="mode" checked={mode === 'ai'} onChange={() => setMode('ai')} /> {t('brief.modeAi')}
            </label>
            <label className="check">
              <input type="radio" name="mode" checked={mode === 'hotseat'} onChange={() => setMode('hotseat')} /> {t('brief.modeHotseat')}
            </label>
            {mode === 'ai' && (
              <>
                <h3>{t('brief.side')}</h3>
                {(['blue', 'red'] as Side[]).map((x) => (
                  <label key={x} className="check">
                    <input type="radio" name="side" checked={side === x} onChange={() => setSide(x)} /> {t(`side.${x}`)} — {s.sideNames[x]}
                  </label>
                ))}
              </>
            )}
            <h3>{t('brief.seed')}</h3>
            <input className="input" inputMode="numeric" value={seed} onChange={(e) => setSeed(e.target.value.replace(/\D/g, ''))} placeholder="random" />
            <p>
              <button className="btn primary big" disabled={busy} onClick={start} data-testid="start-game">
                {t('brief.start')}
              </button>
            </p>
          </div>
          <div className="panel">
            <h3>{t('brief.objectives')}</h3>
            <ul>
              {s.objectives.map((o) => (
                <li key={o.id}>
                  ⚑ {o.name} — {o.value} VP
                </li>
              ))}
            </ul>
            <h3>{t('brief.ownForces')}</h3>
            <div className="orbat">
              {own.orbat.map((o) => (
                <div key={o.id} className="orbat-row">
                  {units[o.typeId] && <img alt="" src={symbolDataUrl(sidcFor(units[o.typeId].symbol, side, side), 22)} />}
                  <span>{o.name}</span>
                  <span className="muted small">{units[o.typeId]?.name}</span>
                </div>
              ))}
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}

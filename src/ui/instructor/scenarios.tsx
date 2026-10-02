import { useEffect, useState } from 'preact/hooks';
import type { OpsLevel, Scenario, TerrainType } from '../../core/types';
import { generateBatch, generateScenario, LEVEL_NAMES, TERRAIN_NAMES } from '../../scenario/generator';
import { db, downloadJson, pickJsonFile } from '../../store/db';
import { cacheScenario, forgetScenario } from '../data';
import { Badge, Field, fmtDate, Modal, nav, toast } from '../kit';
import { scenarioThumb } from '../thumb';
import type { Db } from './home';

export function Scenarios(p: { d: Db; reload: () => void }) {
  const [gen, setGen] = useState(false);
  const [filter, setFilter] = useState<'ALL' | OpsLevel>('ALL');
  const list = [...p.d.scenarios].filter((s) => filter === 'ALL' || s.level === filter).sort((a, b) => (a.source === 'preset' ? -1 : b.source === 'preset' ? 1 : b.createdAt - a.createdAt));
  return (
    <div class="col" style={{ gap: 14 }}>
      <div class="row wrap">
        <div class="row wrap" style={{ gap: 6 }}>
          {(['ALL', 'PL', 'COY', 'BN', 'BDE'] as const).map((l) => (
            <button class={`btn small ${filter === l ? 'active' : ''}`} onClick={() => setFilter(l)}>
              {l === 'ALL' ? 'All' : LEVEL_NAMES[l]}
            </button>
          ))}
        </div>
        <div class="right row">
          <button
            class="btn"
            onClick={async () => {
              try {
                const j = (await pickJsonFile()) as Scenario;
                if (!j?.terrain || !j?.ds) throw new Error('Not a scenario file');
                await db.put('scenarios', j);
                toast(`Imported "${j.title}".`, 'ok');
                p.reload();
              } catch (e) {
                toast(String(e), 'err');
              }
            }}
          >
            Import scenario
          </button>
          <button class="btn primary" onClick={() => setGen(true)}>
            🎲 Generate random scenario(s)
          </button>
        </div>
      </div>
      <div class="grid3">
        {list.map((s) => (
          <ScenarioCard key={s.id} s={s} used={p.d.exercises.filter((e) => e.scenarioId === s.id).length} reload={p.reload} />
        ))}
      </div>
      {gen && <GenModal onClose={() => setGen(false)} onDone={() => (setGen(false), p.reload())} />}
    </div>
  );
}

function ScenarioCard(p: { s: Scenario; used: number; reload: () => void }) {
  const { s } = p;
  const [img, setImg] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setImg(scenarioThumb(s)), 30);
    return () => clearTimeout(t);
  }, [s.id]);
  return (
    <div class="card" style={{ padding: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      {img ? <img class="scen-thumb" src={img} alt="" style={{ borderRadius: 0, cursor: 'pointer' }} onClick={() => nav(`scenario/${s.id}`)} /> : <div class="scen-thumb" />}
      <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 6, flex: 1 }}>
        <div class="row">
          <b style={{ fontSize: 15 }}>{s.title}</b>
        </div>
        <div class="muted small">{s.subtitle}</div>
        <div class="row wrap" style={{ gap: 6 }}>
          <Badge kind="blue">{LEVEL_NAMES[s.level]}</Badge>
          <Badge>{TERRAIN_NAMES[s.terrain.type]}</Badge>
          {s.source === 'preset' && <Badge kind="purple">Preset</Badge>}
          {p.used > 0 && <Badge kind="green">{p.used} exercise(s)</Badge>}
          <Badge>{s.enemy.attackAtNight ? 'Night attk' : 'Day attk'}</Badge>
          <Badge>{s.weather.cond}</Badge>
        </div>
        <div class="dim small">{fmtDate(s.createdAt)}</div>
        <div class="row" style={{ marginTop: 'auto' }}>
          <button class="btn small primary" onClick={() => nav(`scenario/${s.id}`)}>
            Open
          </button>
          <button class="btn small" onClick={() => downloadJson(`${s.title.replace(/[^\w-]+/g, '_')}.wgx.json`, s)}>
            Export
          </button>
          {s.source !== 'preset' && (
            <button
              class="btn small ghost right"
              onClick={async () => {
                if (p.used && !confirm('This scenario is used by exercises. Delete anyway?')) return;
                if (!p.used && !confirm(`Delete "${s.title}"?`)) return;
                await db.del('scenarios', s.id);
                forgetScenario(s.id);
                p.reload();
              }}
            >
              Delete
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function GenModal(p: { onClose: () => void; onDone: () => void }) {
  const [level, setLevel] = useState<OpsLevel>('COY');
  const [terrain, setTerrain] = useState<TerrainType>('PLAINS');
  const [strong, setStrong] = useState(false);
  const [night, setNight] = useState<'AUTO' | 'NIGHT' | 'DAY'>('AUTO');
  const [weather, setWeather] = useState<'AUTO' | 'clear' | 'rain' | 'fog' | 'haze' | 'dust'>('AUTO');
  const [qc, setQc] = useState(true);
  const [ucav, setUcav] = useState(true);
  const [count, setCount] = useState(1);
  const [vary, setVary] = useState(false);
  const [seed, setSeed] = useState('');
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true);
    await new Promise((r) => setTimeout(r, 30));
    try {
      const base = { level, terrain, enemyStrength: strong ? ('STRONG' as const) : ('NORMAL' as const), attackAtNight: night === 'AUTO' ? undefined : night === 'NIGHT', weather, qc, ucav };
      const list = count === 1 ? [generateScenario({ ...base, seed: seed ? Number(seed) >>> 0 : undefined })] : generateBatch(count, { ...base, varyTerrain: vary }, seed ? Number(seed) >>> 0 : undefined);
      for (const s of list) {
        await db.put('scenarios', s);
        cacheScenario(s);
      }
      toast(`${list.length} scenario(s) generated.`, 'ok');
      p.onDone();
    } catch (e) {
      toast(`Generation failed: ${e}`, 'err');
    }
    setBusy(false);
  };
  return (
    <Modal
      title="Generate random scenario(s)"
      onClose={p.onClose}
      footer={
        <button class="btn primary" disabled={busy} onClick={go}>
          {busy ? 'Generating…' : `Generate ${count}`}
        </button>
      }
    >
      <div class="grid2">
        <Field label="Level of command">
          <select value={level} onChange={(e) => setLevel(e.currentTarget.value as OpsLevel)}>
            {(['PL', 'COY', 'BN', 'BDE'] as OpsLevel[]).map((l) => (
              <option value={l}>{LEVEL_NAMES[l]}</option>
            ))}
          </select>
        </Field>
        <Field label="Terrain">
          <select value={terrain} onChange={(e) => setTerrain(e.currentTarget.value as TerrainType)}>
            {(Object.keys(TERRAIN_NAMES) as TerrainType[]).map((t) => (
              <option value={t}>{TERRAIN_NAMES[t]}</option>
            ))}
          </select>
        </Field>
        <Field label="Enemy">
          <select value={strong ? 'S' : 'N'} onChange={(e) => setStrong(e.currentTarget.value === 'S')}>
            <option value="N">Normal (doctrinal 3:1)</option>
            <option value="S">Strong (more inf / armr)</option>
          </select>
        </Field>
        <Field label="Attack timing">
          <select value={night} onChange={(e) => setNight(e.currentTarget.value as 'AUTO')}>
            <option value="AUTO">Random</option>
            <option value="NIGHT">Night attack</option>
            <option value="DAY">Day attack</option>
          </select>
        </Field>
        <Field label="Weather">
          <select value={weather} onChange={(e) => setWeather(e.currentTarget.value as 'AUTO')}>
            <option value="AUTO">Random</option>
            <option value="clear">Clear</option>
            <option value="haze">Haze</option>
            <option value="rain">Rain (wet going)</option>
            <option value="fog">Fog</option>
            <option value="dust">Dust</option>
          </select>
        </Field>
        <Field label="Seed (optional, reproducible)">
          <input type="text" value={seed} placeholder="random" onInput={(e) => setSeed(e.currentTarget.value.replace(/\D/g, ''))} />
        </Field>
        <Field label="How many">
          <input type="number" min={1} max={20} value={count} onInput={(e) => setCount(Math.max(1, Math.min(20, Number(e.currentTarget.value))))} />
        </Field>
        <div class="col" style={{ gap: 2, paddingTop: 16 }}>
          <label class="check">
            <input type="checkbox" checked={qc} onChange={(e) => setQc(e.currentTarget.checked)} /> Intg QC det
          </label>
          <label class="check">
            <input type="checkbox" checked={ucav} onChange={(e) => setUcav(e.currentTarget.checked)} /> UCAV on justified demand
          </label>
          {count > 1 && (
            <label class="check">
              <input type="checkbox" checked={vary} onChange={(e) => setVary(e.currentTarget.checked)} /> Vary terrain across the batch
            </label>
          )}
        </div>
      </div>
      <div class="muted small" style={{ marginTop: 10 }}>
        Each scenario gets procedural terrain, a Blueland/Foxland narrative, orbat, fire sp and an automatically appreciated DS solution (apchs, ITGs, lines of def, likely FAA/FUP/BOF) used for objective marking. You can edit the narrative afterwards.
      </div>
    </Modal>
  );
}

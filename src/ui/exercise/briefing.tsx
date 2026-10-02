import { useState } from 'preact/hooks';
import { fmtTime, dayNightHours, hhmm } from '../../core/time';
import { TEMPLATES } from '../../core/units';
import { symbolSvg } from '../../render/symbols';
import { LEVEL_NAMES, TERRAIN_NAMES } from '../../scenario/generator';
import { MapView } from '../mapView';
import { aorBox } from '../scene';
import type { StepProps } from './flow';

export function Briefing(p: StepProps) {
  const { s } = p;
  const [sec, setSec] = useState(s.narrative[0]?.key ?? '');
  const cur = s.narrative.find((n) => n.key === sec) ?? s.narrative[0];
  const avail = dayNightHours(s.times.now, s.times.defReady, s.times.light);
  return (
    <div class="workspace" style={{ height: '100%' }}>
      <div class="side" style={{ width: 'min(620px, 48vw)' }}>
        <div class="sect">
          <h1 style={{ marginBottom: 4 }}>{s.title}</h1>
          <div class="muted">{s.subtitle}</div>
          <div class="row wrap" style={{ marginTop: 8 }}>
            <span class="badge b-blue">{LEVEL_NAMES[s.level]}</span>
            <span class="badge b-grey">{TERRAIN_NAMES[s.terrain.type]}</span>
            <span class="badge b-amber">{s.own.formation}</span>
          </div>
        </div>
        <div class="sect">
          <div class="row wrap" style={{ gap: 6 }}>
            {s.narrative.map((n) => (
              <button key={n.key} class={`btn small ${n.key === cur?.key ? 'active' : ''}`} onClick={() => setSec(n.key)}>
                {n.title}
              </button>
            ))}
            <button class={`btn small ${sec === '__req' ? 'active' : ''}`} onClick={() => setSec('__req')}>
              Reqs
            </button>
            <button class={`btn small ${sec === '__res' ? 'active' : ''}`} onClick={() => setSec('__res')}>
              Resources &amp; Time
            </button>
          </div>
        </div>
        <div class="sect" style={{ flex: 1 }}>
          {sec === '__req' ? (
            <>
              <div class="narr-h">Requirement</div>
              <div class="narr" style={{ whiteSpace: 'normal' }}>
                <ol class="req">
                  {s.requirements.map((r) => (
                    <li>{r}</li>
                  ))}
                </ol>
              </div>
            </>
          ) : sec === '__res' ? (
            <Resources {...p} avail={avail} />
          ) : cur ? (
            <>
              <div class="narr-h">{cur.title}</div>
              <div class="narr">{cur.body}</div>
            </>
          ) : null}
          <div class="row" style={{ marginTop: 14 }}>
            <button class="btn primary right" onClick={() => p.go('aprc')}>
              Next: Appreciation →
            </button>
          </div>
        </div>
      </div>
      <MapView scenario={s} scene={{ units: [], graphics: [] }} fit={aorBox(s)} />
    </div>
  );
}

function Resources(p: StepProps & { avail: { day: number; night: number } }) {
  const { s } = p;
  const st = { ORGANIC: 'Integral', UC: 'UC', DS: 'DS', IN_SP: 'In sp', ON_DEMAND: 'On demand' } as const;
  return (
    <div class="col">
      <div class="narr-h">Grouping &amp; Resources</div>
      <table class="tbl">
        <tbody>
          {s.own.resources.map((r) => {
            const t = TEMPLATES[r.templateKey];
            return (
              <tr>
                <td style={{ width: 44 }}>
                  <img src={symbolSvg(t.sidc, 22)} alt="" style={{ height: 28 }} />
                </td>
                <td>
                  <b>
                    {r.count} x {t.name}
                  </b>
                  <div class="muted small">{r.note ?? t.description}</div>
                </td>
                <td>
                  <span class="badge b-grey">{st[r.status]}</span>
                </td>
              </tr>
            );
          })}
          <tr>
            <td />
            <td>
              <b>Fire sp</b>
              <div class="muted small">
                {s.own.fire.artyLabel} ({s.own.fire.artyBatteries} bty, {s.own.fire.artyCalibre}mm){s.own.fire.mor81 ? ' · Bn 81mm mors' : ''}
                {s.own.fire.ucavSorties ? ` · UCAV ${s.own.fire.ucavSorties} strike(s) on justified demand` : ''}
              </div>
            </td>
            <td />
          </tr>
          <tr>
            <td />
            <td>
              <b>Obs stores</b>
              <div class="muted small">
                Mines for {s.own.fire.mines.apM} m (AP) + {s.own.fire.mines.atM} m (A tk) of frontage · wire {s.own.fire.wireM} m
              </div>
            </td>
            <td />
          </tr>
        </tbody>
      </table>
      <div class="narr-h" style={{ marginTop: 10 }}>
        Time &amp; Light
      </div>
      <div class="grid2">
        <div class="card tight">
          <div class="muted small">Time now</div>
          <b>{fmtTime(s.times.now)}</b>
        </div>
        <div class="card tight">
          <div class="muted small">Def to be ready by</div>
          <b>{fmtTime(s.times.defReady)}</b>
        </div>
        <div class="card tight">
          <div class="muted small">Hrs aval (day / ni)</div>
          <b>
            {Math.round(p.avail.day)} / {Math.round(p.avail.night)}
          </b>
        </div>
        <div class="card tight">
          <div class="muted small">First lt / last lt · moon</div>
          <b>
            {hhmm(s.times.light.firstLight)} / {hhmm(s.times.light.lastLight)} · {s.times.light.moon}
          </b>
        </div>
        <div class="card tight">
          <div class="muted small">Weather</div>
          <b>
            {s.weather.cond}, going {s.weather.going} · {s.weather.temp}
          </b>
        </div>
        <div class="card tight">
          <div class="muted small">Threats</div>
          <b>
            EW {s.enemy.ewThreat.toLowerCase()} · air {s.enemy.airThreat.toLowerCase()}
          </b>
        </div>
      </div>
    </div>
  );
}

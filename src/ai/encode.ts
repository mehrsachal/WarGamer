// Compact state encoders. Token-lean by design: abbreviated keys, rounded numbers, short ids
// (U1, D1, C1, P1, O1 ...) instead of internal ids or coordinates, and only what the decision
// needs. Each encoder returns the user message plus the id maps used to validate the answer.

import type { TextJudgeRequest } from '../assess/textJudge';
import { dist, type Vec } from '../core/geom';
import type { Attempt, Scenario } from '../core/types';
import { fmtTime } from '../core/time';
import type { RedDecisionPoint } from '../sim/aiHooks';
import { alive, type Engine } from '../sim/engine';
import { shortWhere } from '../sim/red';
import type { Contact, SimUnit } from '../sim/types';

export function clock(e: Engine): string {
  return fmtTime(e.t).replace(/ hrs$/, '');
}

function light(e: Engine): string {
  return e.light === 'DAY' ? 'day' : e.light === 'TWILIGHT' ? 'twilight' : 'night';
}

function clip(s: string, n: number): string {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim();
  return t.length <= n ? t : `${t.slice(0, n - 1)}…`;
}

// ------------------------------------------------------------------ enemy commander

export function encodeEnemy(e: Engine, dp: RedDecisionPoint): string {
  const lines = [`T ${clock(e)} ${light(e)}. ${dp.sit}`];
  for (const g of dp.groups) lines.push(`${g.name}: ${g.options.map((o) => `${o.id}=${o.text}`).join(' | ')}`);
  lines.push(`p order: ${dp.groups.map((g) => g.name).join(',')}`);
  return lines.join('\n');
}

// ------------------------------------------------------------------ radio net

const ROLE: Record<string, string> = { FDL: 'fdl', DEPTH: 'depth', SCREEN: 'scn', SP_PTL: 'SP', LP: 'LP', RES: 'res', SP_WPN: 'sp wpn', CHQ: 'coy HQ', CP: 'CP', OBS: 'obs', QC: 'QC det', ENGR: 'pnr' };

export interface RadioMaps {
  units: Map<string, string>;
  dfs: Map<string, string>;
  contacts: Map<string, string>;
  places: Map<string, Vec>;
  options: Map<string, string>;
}

/** Own units the radio can task: manoeuvre elements first, then key supports. */
export function radioUnits(e: Engine): SimUnit[] {
  const order = ['FDL', 'DEPTH', 'RES', 'SCREEN', 'SP_PTL', 'LP', 'SP_WPN', 'OBS', 'CHQ', 'QC', 'ENGR', 'CP'];
  return e.units
    .filter((u) => u.side === 'BLUE' && u.state !== 'OFFMAP')
    .sort((a, b) => order.indexOf(a.role as string) - order.indexOf(b.role as string))
    .slice(0, 14);
}

/** Contacts held, most threatening (closest to the FDLs) first. */
export function radioContacts(e: Engine): Contact[] {
  return [...e.contacts.values()]
    .filter((c) => c.conf >= 0.3 && e.t - c.lastSeen < 60)
    .sort((a, b) => e.fdlDistance(a.pos) - e.fdlDistance(b.pos))
    .slice(0, 6);
}

export function contactText(e: Engine, c: Contact): string {
  const what = c.ident === 'ARMOUR' ? `${c.vehicles || ''} tks`.trim() : c.ident === 'UNKNOWN' ? 'en' : `${c.ident.toLowerCase()} ${c.size === 'UNKNOWN' ? '' : c.size.toLowerCase()}`.trim();
  return `${what}@${shortWhere(e, c.pos)}${c.moving ? ' mov' : ''} c.${Math.min(9, Math.round(c.conf * 10))}`;
}

export function unitState(u: SimUnit): string {
  if (u.state === 'CAPTURED') return 'overrun';
  if (u.state === 'DESTROYED') return 'destroyed';
  if (u.catk) return 'C attk';
  const st: Partial<Record<SimUnit['state'], string>> = { POSN: 'in posn', HALT: 'halted', MOVE: 'moving', WITHDRAW: 'withdrawing', ASSAULT: 'assaulting', CONSOLIDATE: 'reorg', BROKEN: 'broken' };
  return st[u.state] ?? u.state.toLowerCase();
}

export function encodeRadio(e: Engine, text: string): { user: string; maps: RadioMaps } {
  const maps: RadioMaps = { units: new Map(), dfs: new Map(), contacts: new Map(), places: new Map(), options: new Map() };
  const L: string[] = [`T ${clock(e)} ${light(e)}. Own cas ${Math.round(e.stats.blueCas)}.`];
  const us = radioUnits(e).map((u, i) => {
    maps.units.set(`U${i + 1}`, u.id);
    return `U${i + 1}=${u.label} ${ROLE[u.role as string] ?? ''} ${Math.round((100 * u.strength) / Math.max(1, u.start))}% ${unitState(u)}${u.altPos ? ' alt' : ''}`;
  });
  L.push(`U: ${us.join(' | ')}`);
  if (e.dfs.length) {
    L.push(
      `D: ${e.dfs
        .slice(0, 12)
        .map((d, i) => {
          maps.dfs.set(`D${i + 1}`, d.id);
          return `D${i + 1}=${d.label}${d.sos ? ' SOS' : ''} ${d.asset === 'ARTY' ? 'arty' : d.asset === 'MOR81' ? '81mm' : '60mm'}@${shortWhere(e, d.pos)}`;
        })
        .join(' | ')}`,
    );
  }
  const cs = radioContacts(e);
  L.push(
    cs.length
      ? `C: ${cs
          .map((c, i) => {
            maps.contacts.set(`C${i + 1}`, c.unitId);
            return `C${i + 1}=${contactText(e, c)}`;
          })
          .join(' | ')}`
      : 'C: none held',
  );
  const places = [...e.s.ds.itgs].slice(0, 6);
  L.push(
    `P: ${places
      .map((p, i) => {
        maps.places.set(`P${i + 1}`, p.pos);
        return `P${i + 1}=${p.name}${p.vital ? ' (vital)' : ''}`;
      })
      .join(' | ')}`,
  );
  const fire = e.s.own.fire;
  L.push(`Fire: arty ${e.ammo.ARTY} rds${fire.mor81 ? `, 81mm ${e.ammo.MOR81}` : ''}, 60mm ${e.ammo.MOR60}; UCAV ${e.ucavLeft}; QC ${e.qcs.filter((q) => !q.lost).map((q) => `${q.kind === 'SURV' ? 'surv' : 'attk'}${q.airborne ? ' up' : ''}`).join(',') || 'nil'}.`);
  if (e.pending) {
    const p = e.pending;
    L.push(`DEC pending${p.multi ? ' (several ids, comma-sep)' : ''}: ${clip(p.title, 60)} — ${p.options
      .slice(0, 14)
      .map((o, i) => {
        maps.options.set(`O${i + 1}`, o.id);
        return `O${i + 1}=${clip(o.text, 55)}`;
      })
      .join(' | ')}`);
  }
  L.push(`MSG: "${clip(text, 300)}"`);
  return { user: L.join('\n'), maps };
}

// ------------------------------------------------------------------ text judge

export function encodeJudge(reqs: TextJudgeRequest[]): string {
  return reqs
    .map((r, i) => [`#${i} ${clip(r.task, 160)}`, r.situation ? `SIT: ${clip(r.situation, 300)}` : '', `KEY: ${r.keyPoints.map((k, j) => `${j}) ${clip(k, 140)}`).join(' ')}`, `ANS: ${clip(r.answer, 1500)}`].filter(Boolean).join('\n'))
    .join('\n\n');
}

// ------------------------------------------------------------------ mentor AAR

export function encodeAar(s: Scenario, a: Attempt): string {
  const w = a.wargame;
  if (!w) return '';
  const sm = w.summary;
  const L: string[] = [];
  L.push(`Scenario: ${clip(s.title, 60)} (${s.level}). Result: ${sm.result} — ${clip(sm.resultText, 120)}`);
  L.push(`Own cas ${sm.ownCas}/${sm.ownStart}; en cas ${sm.enCas}/${sm.enStart}${sm.tanksStart ? `; tks ${sm.tanksKilled}/${sm.tanksStart}` : ''}; vital gr ${sm.vitalHeld ? 'held' : 'lost'}. Plan ${Math.round(a.planAssessment?.pct ?? 0)}%, battle ${Math.round(w.assessment.pct)}%, final ${Math.round(a.finalPct ?? 0)}% (${a.grade ?? '-'}).`);
  const ev = w.log.filter((l) => l.level === 'crit' || l.level === 'warn').slice(0, 9);
  if (ev.length) L.push(`Key events: ${ev.map((l) => `${fmtTime(l.time, false).replace(' hrs', '')} ${clip(l.text, 80)}`).join(' / ')}`);
  if (w.decisions.length) L.push(`Decisions: ${w.decisions.slice(0, 8).map((d) => `${clip(d.title, 40)}: ${clip(d.optionText, 60)} = ${d.verdict}`).join(' / ')}`);
  const gaps = [...(a.planAssessment?.items ?? []), ...w.assessment.items]
    .filter((i) => i.verdict === 'FAIL' || i.verdict === 'PARTIAL')
    .sort((x, y) => (1 - y.score) * y.weight - (1 - x.score) * x.weight)
    .slice(0, 6);
  if (gaps.length) L.push(`Rubric gaps: ${gaps.map((g) => `${clip(g.title, 50)} (${Math.round(g.score * 100)}%): ${clip(g.detail, 90)}`).join(' / ')}`);
  if (w.enemyPlanText.length) L.push(`En did: ${w.enemyPlanText.slice(0, 4).map((t) => clip(t, 110)).join(' ')}`);
  return L.join('\n');
}

/** Nearest contact to a point (for "fire on the en near X"). */
export function nearestContact(e: Engine, p: Vec, maxD = 1500): Contact | undefined {
  return radioContacts(e)
    .filter((c) => dist(c.pos, p) <= maxD)
    .sort((a, b) => dist(a.pos, p) - dist(b.pos, p))[0];
}

export function aliveUnit(e: Engine, id: string): SimUnit | undefined {
  const u = e.byId.get(id);
  return u && alive(u) ? u : undefined;
}

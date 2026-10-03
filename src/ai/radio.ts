// Radio net: the student types free-text orders and queries. A deterministic offline parser
// handles the common orders and all sitreps locally (no tokens); only messages it cannot read
// go to Claude (when enabled), which maps them onto the same ManualOrder / DecisionInput set.

import { bearing, dist, type Vec } from '../core/geom';
import { alive, type Engine } from '../sim/engine';
import type { Contact, DecisionInput, ManualOrder, SimUnit } from '../sim/types';
import { compass } from '../terrain/terrain';
import type { AiBattle } from './battle';
import { clampWords } from './client';
import { clock, contactText, encodeRadio, radioContacts, type RadioMaps, unitState } from './encode';
import { RADIO_SCHEMA, RADIO_SYS } from './prompts';

export interface RadioReply {
  /** Who answers on the net ("1 Pl", "FOO", "Bn", "Net"). */
  who: string;
  text: string;
  /** Order confirmations actually executed. */
  executed: string[];
  src: 'LOCAL' | 'AI' | 'NONE';
}

export type Parsed =
  | { kind: 'SITREP'; unitId?: string }
  | { kind: 'ORDERS'; orders: ManualOrder[]; who: string }
  | { kind: 'DECISION'; input: DecisionInput; who: string }
  | { kind: 'REPLY'; who: string; text: string }
  | { kind: 'UNKNOWN' };

// ------------------------------------------------------------------ text helpers

const NUMW: Record<string, string> = { one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7', eight: '8', nine: '9', first: '1', second: '2', third: '3' };

export function normalise(text: string): string {
  return ` ${String(text ?? '')
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/[^a-z0-9/ ]+/g, ' ')
    .replace(/\b(one|two|three|four|five|six|seven|eight|nine|first|second|third)\b/g, (w) => NUMW[w])
    .replace(/\s+/g, ' ')
    .trim()} `;
}

const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/** Aliases a unit answers to on the net. */
function aliases(u: SimUnit): string[] {
  const a = new Set([squash(u.label)]);
  const role = u.role as string;
  if (role === 'SCREEN') ['screen', 'screens', 'scn'].forEach((x) => a.add(x));
  if (role === 'SP_PTL') ['sp', 'standingptl', 'standingpatrol', 'stdptl'].forEach((x) => a.add(x));
  if (role === 'CHQ') ['coyhq', 'hq', 'chq'].forEach((x) => a.add(x));
  if (role === 'QC') ['qcdet'].forEach((x) => a.add(x));
  if (u.key === 'ARTY_OBS') ['foo', 'arty', 'gunners'].forEach((x) => a.add(x));
  if (u.key === 'MOR_OBS') ['mfc', 'mortars', 'mor'].forEach((x) => a.add(x));
  const m = /^(\d+)\s*pl$/i.exec(u.label.trim());
  if (m) ['platoon', 'pltn'].forEach((p) => a.add(`${m[1]}${p}`));
  return [...a].filter(Boolean);
}

/** First own unit mentioned in the message (windows of 1-3 words). */
export function findUnit(e: Engine, norm: string, skip: string[] = []): SimUnit | undefined {
  const words = norm.trim().split(' ');
  const blue = e.units.filter((u) => u.side === 'BLUE' && u.state !== 'OFFMAP' && !skip.includes(u.id));
  const table = blue.map((u) => ({ u, al: aliases(u) }));
  for (let i = 0; i < words.length; i++) {
    for (const n of [3, 2, 1]) {
      if (i + n > words.length) continue;
      const w = words.slice(i, i + n).join('');
      const hit = table.filter((t) => t.al.includes(w)).sort((p, q) => Number(alive(q.u)) - Number(alive(p.u)))[0];
      if (hit) return hit.u;
    }
  }
  return undefined;
}

/** Place named in the message: grid ref, square, ITG / feature name, DF label or unit. */
export function findPlace(e: Engine, norm: string): Vec | undefined {
  const t = e.terrain;
  const gs = e.s.terrain.gridSq;
  const og = e.s.terrain.gridOrigin;
  const six = /\b(?:gr )?(\d{3}) ?(\d{3})\b/.exec(norm);
  if (six) {
    const ex = Number(six[1]);
    const ny = Number(six[2]);
    const x = ((((ex - og.e * 10) % 1000) + 1000) % 1000) * (gs / 10) + gs / 20;
    const y = ((((ny - og.n * 10) % 1000) + 1000) % 1000) * (gs / 10) + gs / 20;
    if (x <= e.s.terrain.width && y <= e.s.terrain.height) return { x, y };
  }
  const four = /\b(?:sq |square )(\d{2})(\d{2})\b/.exec(norm) ?? /\b(\d{2})(\d{2})\b/.exec(norm);
  if (four) {
    const ex = Number(four[1]);
    const ny = Number(four[2]);
    const x = ((((ex - og.e) % 100) + 100) % 100) * gs + gs / 2;
    const y = ((((ny - og.n) % 100) + 100) % 100) * gs + gs / 2;
    if (x <= e.s.terrain.width && y <= e.s.terrain.height) return { x, y };
  }
  const sq = squash(norm);
  const named = [
    ...e.s.ds.itgs.map((i) => ({ n: i.name, p: i.pos })),
    ...t.places.map((p) => ({ n: p.name, p: p.pos })),
    ...e.dfs.map((d) => ({ n: d.label, p: d.pos })),
  ]
    .filter((x) => squash(x.n).length >= 2 && sq.includes(squash(x.n)))
    .sort((a, b) => squash(b.n).length - squash(a.n).length)[0];
  if (named) return named.p;
  return undefined;
}

function contactFor(e: Engine, norm: string, selContactId?: string): Contact | undefined {
  const cs = radioContacts(e);
  if (!cs.length) return undefined;
  if (/\b(tks?|tanks?|armr|armour|armor)\b/.test(norm)) {
    const a = cs.find((c) => c.ident === 'ARMOUR');
    if (a) return a;
  }
  const p = findPlace(e, norm);
  if (p) {
    const near = cs.filter((c) => dist(c.pos, p) < 1200).sort((a, b) => dist(a.pos, p) - dist(b.pos, p))[0];
    if (near) return near;
  }
  if (selContactId) {
    const s = cs.find((c) => c.unitId === selContactId || c.id === selContactId);
    if (s) return s;
  }
  return cs[0];
}

function depthForce(e: Engine, exclude?: string): SimUnit | undefined {
  return e
    .blue()
    .filter((u) => u.kind === 'INF' && u.id !== exclude && (u.role === 'DEPTH' || u.role === 'RES') && !u.catk)
    .sort((a, b) => b.strength - a.strength)[0];
}

function callsign(e: Engine, key: 'ARTY_OBS' | 'MOR_OBS', fallback: string): string {
  return e.units.find((u) => u.side === 'BLUE' && u.key === key)?.label ?? fallback;
}

// ------------------------------------------------------------------ offline parser

const RX = {
  sitrep: /\b(sitrep|sit rep|situation report|report status|status report|send sitrep)\b/,
  df: /\b(df|sos)\s*(?:no |number )?(\d{1,2})\b/,
  sos: /\bsos\b/,
  aqc: /\b(a\/qc|aqc|a qc|attack qc|attk qc|attack drone|kamikaze|loitering)\b/,
  ucav: /\bucav\b/,
  qcRecall: /\b(qc|quadcopter|drone)\b.*\b(recall|return|land|recover)\b|\b(recall|return|land|recover)\b.*\b(qc|quadcopter|drone)\b/,
  qc: /\b(qc|quadcopter|drone)\b/,
  alt: /\b(alt|altn|alternate|alternative)\b/,
  wd: /\b(withdraw|pull back|fall back|break contact|thin out)\b/,
  cpen: /\b(c ?pen|counter ?penetrat\w*|block(ing)? posn)\b/,
  catk: /\b(c ?attk|c ?attack|counter ?attack|catk|counterattack)\b/,
  hold: /\b(hold|stand fast|hold fast|stay put|hold on)\b/,
  fire: /\b(fire|engage|shoot|bring down|neutrali[sz]e|hit|stonk|shell)\b/,
  arty: /\b(arty|artillery|guns|gunners|fd regt|bty)\b/,
  mor: /\b(mor|mortar|mortars|81|81mm|60|60mm)\b/,
  higher: /\b(bn|bde|higher|co|battalion|brigade)\b/,
  request: /\b(request|req|ask|need|require)\b/,
};

export function parseRadio(e: Engine, text: string, selContactId?: string): Parsed {
  const n = normalise(text);
  if (!n.trim()) return { kind: 'UNKNOWN' };
  const unit = findUnit(e, n);
  if (RX.sitrep.test(n) || /^ (sitrep|status|report) /.test(n)) return { kind: 'SITREP', unitId: unit?.id };

  // ---- planned fire (DF n / SOS n / SOS)
  const df = RX.df.exec(n);
  if (df) {
    const want = `${df[1]}${Number(df[2])}`;
    const d = e.dfs.find((x) => squash(x.label) === want) ?? e.dfs.find((x) => squash(x.label).endsWith(String(Number(df[2]))) && (df[1] === 'sos') === x.sos);
    if (!d) return { kind: 'REPLY', who: callsign(e, 'ARTY_OBS', 'FOO'), text: `${df[1].toUpperCase()} ${Number(df[2])} not in the fire plan. Say again tgt, over.` };
    return { kind: 'ORDERS', orders: [{ type: 'DF', dfId: d.id }], who: d.asset === 'ARTY' ? callsign(e, 'ARTY_OBS', 'FOO') : callsign(e, 'MOR_OBS', 'MFC') };
  }
  if (RX.sos.test(n) && !RX.aqc.test(n)) {
    const sos = e.dfs.filter((d) => d.sos);
    if (!sos.length) return { kind: 'REPLY', who: callsign(e, 'ARTY_OBS', 'FOO'), text: 'No DF (SOS) recorded in the fire plan, over.' };
    const threat = radioContacts(e)[0];
    const d = threat ? [...sos].sort((a, b) => dist(a.pos, threat.pos) - dist(b.pos, threat.pos))[0] : sos[0];
    return { kind: 'ORDERS', orders: [{ type: 'DF', dfId: d.id }], who: d.asset === 'ARTY' ? callsign(e, 'ARTY_OBS', 'FOO') : callsign(e, 'MOR_OBS', 'MFC') };
  }

  // ---- QC / A/QC / UCAV
  if (RX.aqc.test(n)) {
    const c = contactFor(e, n, selContactId);
    if (!c) return { kind: 'REPLY', who: 'QC', text: 'No en tgt held for A/QC, over.' };
    return { kind: 'ORDERS', orders: [{ type: 'AQC', contactId: c.unitId }], who: 'QC' };
  }
  if (RX.ucav.test(n)) {
    const c = contactFor(e, n, selContactId);
    if (!c) return { kind: 'REPLY', who: 'Bn', text: 'No tgt held for UCAV. Send tgt details, over.' };
    const j: string[] = [];
    if (/\b(tks?|tanks?|armr|armour|armor|high value|hvt)\b/.test(n) || c.ident === 'ARMOUR') j.push('armour');
    if (/\b(confirmed|current|seen now|observed)\b/.test(n)) j.push('confirmed');
    if (/\b(beyond|out of df|outside df|depth|out of range)\b/.test(n)) j.push('outofdf');
    return { kind: 'ORDERS', orders: [{ type: 'UCAV', contactId: c.unitId, justification: j }], who: 'Bn' };
  }
  if (RX.qcRecall.test(n)) return { kind: 'ORDERS', orders: [{ type: 'QC_RECALL' }], who: 'QC' };
  if (RX.qc.test(n) && !(unit && RX.alt.test(n))) {
    const p = findPlace(e, n) ?? contactFor(e, n, selContactId)?.pos;
    if (!p) return { kind: 'REPLY', who: 'QC', text: 'Say again area for surv, over.' };
    return { kind: 'ORDERS', orders: [{ type: 'QC_SURV', target: p }], who: 'QC' };
  }

  // ---- C attk: own force, or a request to higher HQ
  if (RX.catk.test(n)) {
    const toHigher = RX.request.test(n) || (RX.higher.test(n) && !unit);
    if (toHigher) {
      const p = e.pending;
      const opt = p?.options.find((o) => o.id === 'HIGHER_CATK' || o.id === 'CPEN_HIGHER');
      if (p && opt) return { kind: 'DECISION', input: { option: opt.id, source: 'AI', text }, who: 'Bn' };
      return { kind: 'REPLY', who: 'Bn', text: 'Noted. Bn res is held for C attk on a pen that is contained — hold, contain and report, over.' };
    }
    const force = unit && unit.kind === 'INF' && alive(unit) ? unit : depthForce(e);
    if (!force) return { kind: 'REPLY', who: 'Net', text: 'No force aval for C attk. Say again force, over.' };
    const lost = e.units.filter((u) => u.side === 'BLUE' && (u.state === 'CAPTURED' || u.elements.some((el) => el.lost)) && u.id !== force.id);
    const place = findPlace(e, n);
    const target = place ?? lost.sort((a, b) => dist(a.pos, force.pos) - dist(b.pos, force.pos))[0]?.pos ?? radioContacts(e)[0]?.pos;
    if (!target) return { kind: 'REPLY', who: force.label, text: 'No en pen located. Say again obj for C attk, over.' };
    return { kind: 'ORDERS', orders: [{ type: 'CATK', unitId: force.id, target }], who: force.label };
  }
  if (RX.cpen.test(n)) {
    const force = unit && unit.kind === 'INF' ? unit : depthForce(e);
    if (!force) return { kind: 'REPLY', who: 'Net', text: 'Say again force for C pen, over.' };
    return { kind: 'ORDERS', orders: [{ type: 'CPEN', unitId: force.id }], who: force.label };
  }

  // ---- unit movement
  if (RX.alt.test(n)) {
    if (!unit) return { kind: 'REPLY', who: 'Net', text: 'Say again which call sign to altn posn, over.' };
    return { kind: 'ORDERS', orders: [{ type: 'MOVE_ALT', unitId: unit.id }], who: unit.label };
  }
  if (RX.wd.test(n)) {
    if (!unit) return { kind: 'REPLY', who: 'Net', text: 'Say again which call sign to withdraw, over.' };
    return { kind: 'ORDERS', orders: [{ type: 'WITHDRAW', unitId: unit.id }], who: unit.label };
  }

  // ---- fire on a contact by asset
  if (RX.fire.test(n) && (RX.arty.test(n) || RX.mor.test(n))) {
    const c = contactFor(e, n, selContactId);
    const arty = RX.arty.test(n);
    const asset: 'ARTY' | 'MOR81' | 'MOR60' = arty ? 'ARTY' : /\b(60|60mm)\b/.test(n) || !e.s.own.fire.mor81 ? 'MOR60' : 'MOR81';
    const who = asset === 'ARTY' ? callsign(e, 'ARTY_OBS', 'FOO') : callsign(e, 'MOR_OBS', 'MFC');
    if (!c) return { kind: 'REPLY', who, text: 'No en tgt held. Send tgt location, over.' };
    return { kind: 'ORDERS', orders: [{ type: 'FIRE_CONTACT', contactId: c.unitId, asset }], who };
  }

  if (RX.hold.test(n) && unit) return { kind: 'ORDERS', orders: [{ type: 'HOLD', unitId: unit.id }], who: unit.label };
  return { kind: 'UNKNOWN' };
}

// ------------------------------------------------------------------ sitreps (local, no tokens)

export function sitrep(e: Engine, unitId?: string): { who: string; text: string } {
  const u = unitId ? e.byId.get(unitId) : undefined;
  if (u) {
    if (!alive(u)) return { who: 'Net', text: `No reply from ${u.label} (${u.state === 'CAPTURED' ? 'overrun' : 'destroyed'}).` };
    const pct = Math.round((100 * u.strength) / Math.max(1, u.start));
    const seen = radioContacts(e).filter((c) => dist(c.pos, u.pos) <= Math.max(1500, u.obsRange));
    const near = seen.sort((a, b) => dist(a.pos, u.pos) - dist(b.pos, u.pos))[0];
    const en = near ? `${seen.length} en gp${seen.length > 1 ? 's' : ''}, nearest ${near.ident === 'ARMOUR' ? 'tks' : 'en'} ${Math.round(dist(near.pos, u.pos) / 50) * 50} m ${compass(bearing(u.pos, near.pos))}` : 'No en seen';
    const lostEl = u.elements.filter((x) => x.lost).length;
    return {
      who: u.label,
      text: `${Math.round(u.strength)}/${u.start} (${pct}%), ${unitState(u)}${u.task ? ` — ${u.task.toLowerCase()}` : ''}${lostEl ? `, ${lostEl} post(s) lost` : ''}. ${en}. ${u.supp > 0.3 ? 'Under fire. ' : ''}Over.`,
    };
  }
  const blue = e.units.filter((x) => x.side === 'BLUE' && x.state !== 'OFFMAP');
  const locs = blue.filter((x) => x.role === 'FDL' || x.role === 'DEPTH');
  const lost = locs.filter((x) => !alive(x)).length;
  const cs = radioContacts(e);
  const threat = cs[0];
  return {
    who: 'Coy HQ',
    text: `${clock(e)}: own cas ${Math.round(e.stats.blueCas)}; ${locs.length - lost}/${locs.length} localities held. ${cs.length ? `${cs.length} en gp(s) held, most threatening ${contactText(e, threat)}` : 'No en contact held'}. Arty ${e.ammo.ARTY} rds. Over.`,
  };
}

// ------------------------------------------------------------------ AI mapping

interface AiOrder {
  t: string;
  u?: string;
  d?: string;
  c?: string;
  g?: string;
  a?: 'ARTY' | 'MOR81' | 'MOR60';
  j?: string[];
  x?: string;
}

export interface RadioAiAnswer {
  orders: ManualOrder[];
  decision?: DecisionInput;
  reply: string;
}

/** Maps the model's JSON onto engine orders using the id maps; drops anything invalid. */
export function validateRadio(raw: unknown, e: Engine, maps: RadioMaps, text: string): RadioAiAnswer | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as { o?: unknown; r?: unknown };
  if (!Array.isArray(r.o) || typeof r.r !== 'string') return null;
  const orders: ManualOrder[] = [];
  let decision: DecisionInput | undefined;
  for (const o of r.o.slice(0, 3) as AiOrder[]) {
    if (!o || typeof o !== 'object') continue;
    const u = o.u ? maps.units.get(o.u.toUpperCase()) : undefined;
    const c = o.c ? maps.contacts.get(o.c.toUpperCase()) : undefined;
    const g = o.g ? maps.places.get(o.g.toUpperCase()) : undefined;
    const d = o.d ? maps.dfs.get(o.d.toUpperCase()) : undefined;
    const cPos = c ? e.contacts.get(c)?.pos : undefined;
    switch (o.t) {
      case 'DF':
        if (d) orders.push({ type: 'DF', dfId: d });
        break;
      case 'FIRE':
        if (c) orders.push({ type: 'FIRE_CONTACT', contactId: c, asset: o.a === 'MOR81' || o.a === 'MOR60' ? o.a : 'ARTY' });
        break;
      case 'QC':
        if (g ?? cPos) orders.push({ type: 'QC_SURV', target: (g ?? cPos)! });
        break;
      case 'QCREC':
        orders.push({ type: 'QC_RECALL' });
        break;
      case 'AQC':
        if (c) orders.push({ type: 'AQC', contactId: c });
        break;
      case 'UCAV':
        if (c) orders.push({ type: 'UCAV', contactId: c, justification: (o.j ?? []).filter((x) => ['armour', 'confirmed', 'outofdf'].includes(x)) });
        break;
      case 'ALT':
        if (u) orders.push({ type: 'MOVE_ALT', unitId: u });
        break;
      case 'WD':
        if (u) orders.push({ type: 'WITHDRAW', unitId: u });
        break;
      case 'CATK':
        if (u && (g ?? cPos)) orders.push({ type: 'CATK', unitId: u, target: (g ?? cPos)! });
        break;
      case 'CPEN':
        if (u) orders.push({ type: 'CPEN', unitId: u });
        break;
      case 'HOLD':
        if (u) orders.push({ type: 'HOLD', unitId: u });
        break;
      case 'DEC': {
        const p = e.pending;
        if (!p || !o.x) break;
        const ids = o.x
          .split(',')
          .map((x) => maps.options.get(x.trim().toUpperCase()))
          .filter((x): x is string => !!x);
        if (!ids.length) break;
        decision = p.multi ? { option: ids.join(','), options: ids, source: 'AI', text } : { option: ids[0], unitId: u, source: 'AI', text };
        break;
      }
    }
  }
  const reply = clampWords(r.r, 20);
  if (!orders.length && !decision && !reply) return null;
  return { orders, decision, reply };
}

function execute(e: Engine, orders: ManualOrder[], decision?: DecisionInput): string[] {
  const out: string[] = [];
  for (const o of orders) out.push(e.order(o));
  if (decision && e.pending) {
    const p = e.pending;
    e.decide(decision);
    out.push(`Decision: ${p.options.filter((o) => (decision.options ?? [decision.option]).includes(o.id)).map((o) => o.text).join('; ')}`);
  }
  return out;
}

function ack(executed: string[]): string {
  if (!executed.length) return 'Roger, out.';
  const m = executed.join(' ');
  return /\b(no|not|unknown|lost|nil)\b/i.test(m) ? `${m} Over.` : `Wilco. ${m} Out.`;
}

/** Handles one radio message end-to-end. Never throws. */
export async function radioMessage(e: Engine, text: string, o: { battle?: AiBattle; selContactId?: string } = {}): Promise<RadioReply> {
  const p = parseRadio(e, text, o.selContactId);
  if (p.kind === 'SITREP') {
    const s = sitrep(e, p.unitId);
    return { who: s.who, text: s.text, executed: [], src: 'LOCAL' };
  }
  if (p.kind === 'ORDERS') {
    const ex = execute(e, p.orders);
    return { who: p.who, text: ack(ex), executed: ex, src: 'LOCAL' };
  }
  if (p.kind === 'DECISION') {
    const ex = execute(e, [], p.input);
    return { who: p.who, text: `Wilco. ${ex.join(' ')} Out.`, executed: ex, src: 'LOCAL' };
  }
  if (p.kind === 'REPLY') return { who: p.who, text: p.text, executed: [], src: 'LOCAL' };

  // ---- not understood locally: ask Claude (if enabled and within budget)
  const b = o.battle;
  if (b && b.enabled('radio')) {
    const { user, maps } = encodeRadio(e, text);
    const r = await b.call('radio', {
      system: RADIO_SYS,
      user,
      schema: RADIO_SCHEMA as never,
      validate: (raw) => validateRadio(raw, e, maps, text),
      maxTokens: { big: 1024, haiku: 300 },
      timeoutMs: 15000,
    });
    if (r.ok) {
      const ex = execute(e, r.data.orders, r.data.decision);
      const first = r.data.orders[0];
      const who =
        first && 'unitId' in first ? (e.byId.get(first.unitId)?.label ?? 'Net') : first && (first.type === 'DF' || first.type === 'FIRE_CONTACT') ? callsign(e, 'ARTY_OBS', 'FOO') : first && (first.type === 'AQC' || first.type === 'QC_SURV' || first.type === 'QC_RECALL') ? 'QC' : r.data.decision ? 'Bn' : 'Net';
      b.log(e.t, 'RADIO', `"${clampWords(text, 20)}" → ${ex.length ? ex.join(' ') : 'no action'} | ${r.data.reply}`);
      return { who, text: r.data.reply || ack(ex), executed: ex, src: 'AI' };
    }
    return { who: 'Net', text: `Say again, over. (${r.reason === 'BUDGET' ? 'AI token budget reached' : 'AI unavailable'} — try e.g. "fire DF 3", "2 Pl move to altn posn", "sitrep 1 Pl")`, executed: [], src: 'NONE' };
  }
  return { who: 'Net', text: 'Say again, over. Try e.g. "fire DF 3", "SOS", "2 Pl move to altn posn", "QC to 15 r", "3 Pl C attk 15 r", "sitrep".', executed: [], src: 'NONE' };
}

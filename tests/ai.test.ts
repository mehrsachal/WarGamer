// Optional Claude AI (src/ai): no real API calls — the SDK runs against a fake fetch.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { presetBic49 } from '../src/scenario/presetBic49';
import { autoPlan } from '../src/plan/plan';
import { Engine } from '../src/sim/engine';
import { type EngineAi, type RedDecisionPoint, replayAi, ruleChoice } from '../src/sim/aiHooks';
import { AiBattle, BattleAi, validateEnemy } from '../src/ai/battle';
import { buildParams, callClaude, estTokens } from '../src/ai/client';
import { encodeAar, encodeEnemy, encodeJudge, encodeRadio } from '../src/ai/encode';
import { ENEMY_SYS, JUDGE_SYS, MENTOR_SYS, RADIO_SYS } from '../src/ai/prompts';
import { normalise, parseRadio, radioMessage, sitrep, stripCallsign, validateRadio } from '../src/ai/radio';
import { makeAiJudge, validateJudge } from '../src/ai/judge';
import { clampWordsKeepLines, validateMentor } from '../src/ai/mentor';
import { aiAvailable, getAiConfig, getApiKey, setAiConfig, setAiStorage, setApiKey } from '../src/ai/settings';
import { db, exportBundle } from '../src/store/db';
import { wargameRecord } from '../src/assess/wargame';
import { assessPlan } from '../src/assess/plan';
import type { Attempt } from '../src/core/types';
import type { TextJudgeRequest } from '../src/assess/textJudge';

setAiStorage(null);

// ------------------------------------------------------------------ fakes

type Reply = { status?: number; json?: unknown; text?: string; headers?: Record<string, string>; hang?: boolean; throws?: boolean; delayMs?: number };

function fakeFetch(handler: (body: Record<string, unknown>, n: number) => Reply) {
  const calls: { url: string; body: Record<string, unknown>; headers: Headers }[] = [];
  const f = (async (url: string, init: RequestInit & { signal?: AbortSignal }) => {
    const body = JSON.parse(String(init.body));
    calls.push({ url: String(url), body, headers: new Headers(init.headers as HeadersInit) });
    const r = handler(body, calls.length - 1);
    if (r.throws) throw new TypeError('fetch failed');
    if (r.hang) {
      return new Promise<Response>((_, rej) => {
        init.signal?.addEventListener('abort', () => rej(Object.assign(new Error('The operation was aborted'), { name: 'AbortError' })));
      });
    }
    if (r.delayMs) await new Promise((res) => setTimeout(res, r.delayMs));
    return new Response(r.text ?? JSON.stringify(r.json ?? {}), { status: r.status ?? 200, headers: { 'content-type': 'application/json', ...(r.headers ?? {}) } });
  }) as unknown as typeof fetch;
  return { f, calls };
}

function message(text: string, o: { stop?: string; inTok?: number; outTok?: number; details?: unknown } = {}) {
  return {
    id: 'msg_test',
    type: 'message',
    role: 'assistant',
    model: 'claude-opus-5-5',
    content: [{ type: 'text', text }],
    stop_reason: o.stop ?? 'end_turn',
    stop_sequence: null,
    stop_details: o.details ?? null,
    usage: { input_tokens: o.inTok ?? 300, output_tokens: o.outTok ?? 60, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
  };
}

/** Picks a deterministic non-default option per group from the enemy prompt's menu. */
function enemyResponder(body: Record<string, unknown>): Reply {
  const user = String((body.messages as { content: string }[])[0].content);
  const order = /p order: (.*)$/m.exec(user)?.[1].split(',') ?? [];
  const p = order.map((g) => {
    const line = new RegExp(`^${g.replace(/[+]/g, '\\+')}: (.*)$`, 'm').exec(user)?.[1] ?? '';
    const ids = [...line.matchAll(/(?:^|\| )([A-Za-z0-9_+-]+)=/g)].map((m) => m[1]);
    return ids[Math.min(1, ids.length - 1)] ?? '';
  });
  return { json: message(JSON.stringify({ p, i: 'Fix the fwd posns by fire, strike the flank in the dark.' }), { inTok: 420, outTok: 90 }) };
}

// one scenario + plan for all runs: unit ids (and so decision keys) must match between a battle and its replay
const SCEN = presetBic49();
const PLAN = autoPlan(SCEN);
const seedEngine = (seed = 5, interactive = false) => new Engine(SCEN, PLAN, { seed, fog: 'FULL', interactive, difficulty: 'STANDARD' });

const flush = () => new Promise((r) => setImmediate(r));

async function runLive(e: Engine, ai: BattleAi): Promise<void> {
  let guard = 0;
  while (!e.over && guard++ < 50000) {
    if (e.pending) e.decide(e.preplannedInput(e.pending));
    else if (ai.holding()) await flush();
    else e.step();
  }
}

// ------------------------------------------------------------------ encoders & size budget

test('enemy-commander prompts stay small at every decision point', () => {
  const sizes: Record<string, number> = {};
  const probe: EngineAi = {
    redDecide(e, dp) {
      const n = estTokens(ENEMY_SYS + encodeEnemy(e, dp));
      sizes[dp.kind] = Math.max(sizes[dp.kind] ?? 0, n);
      return ruleChoice(dp);
    },
  };
  for (const seed of [1, 2, 3, 4, 5]) {
    const e = seedEngine(seed);
    e.ai = probe;
    e.runToEnd();
  }
  assert.ok(sizes.PLAN, 'plan decision point reached');
  assert.ok(sizes.SCREEN, 'screen decision point reached');
  for (const [k, n] of Object.entries(sizes)) assert.ok(n < 700, `${k} prompt ~${n} tokens (< 700)`);
});

test('radio, judge and mentor prompts stay within budget', () => {
  const e = seedEngine(3, true);
  let g = 0;
  while (!e.over && e.t < e.hHour + 60 && g++ < 5000) {
    if (e.pending) e.decide(e.preplannedInput(e.pending));
    else e.step();
  }
  const r = encodeRadio(e, '2 Pl, en massing near the nala to your front, engage them and be ready to move to your alternate');
  assert.ok(estTokens(RADIO_SYS + r.user) < 700, `radio ~${estTokens(RADIO_SYS + r.user)} tokens`);
  assert.ok(r.maps.units.size >= 5 && r.maps.dfs.size >= 3);

  const reqs: TextJudgeRequest[] = Array.from({ length: 6 }, (_, i) => ({
    id: `Q${i}`,
    task: 'Deduce the likely en apch and its implications for siting the FDLs.',
    situation: 'Coy def on 15 r against a Foxland inf bn gp with a tk tp.',
    keyPoints: ['Western apch is good tk going', 'Vital gr is 15 r', 'Site A tk wpns to cover the apch', 'Plan DF (SOS) on the FUP'],
    answer: 'En will most likely come along the western apch because the going is good for tks; we must hold 15 r as vital gr and site RR/BS to cover it, with DF on likely FUPs.'.repeat(2),
  }));
  const jt = estTokens(JUDGE_SYS + encodeJudge(reqs));
  assert.ok(jt < 1600, `judge batch of 6 ~${jt} tokens`);

  const done = seedEngine(4);
  done.runToEnd();
  const s = presetBic49();
  const att = { id: 'a1', exerciseId: 'x', studentId: 's', scenarioId: s.id, status: 'COMPLETE', plan: done.plan, startedAt: 0, planAssessment: assessPlan(s, done.plan), wargame: wargameRecord(done), finalPct: 71, grade: 'B' } as Attempt;
  const aar = encodeAar(s, att);
  assert.ok(estTokens(aar) <= 800, `AAR ~${estTokens(aar)} tokens`);
  assert.ok(estTokens(MENTOR_SYS + aar) < 1000);
  assert.match(aar, /Result: /);
});

// ------------------------------------------------------------------ offline radio parser

test('offline radio parser covers the common orders without tokens', () => {
  const e = seedEngine(2, false);
  e.runUntil(e.hHour - 30);
  const kind = (t: string) => parseRadio(e, t);
  const ord = (t: string) => {
    const p = kind(t);
    assert.equal(p.kind, 'ORDERS', `"${t}" → ${p.kind}`);
    return (p as Extract<typeof p, { kind: 'ORDERS' }>).orders[0];
  };
  const label = (id: string) => e.byId.get(id)?.label;
  const dfLabel = (id: string) => e.dfs.find((d) => d.id === id)?.label;

  let o = ord('fire DF 1');
  assert.equal(o.type, 'DF');
  assert.equal(dfLabel((o as { dfId: string }).dfId), 'DF 1');
  o = ord('Fire SOS 2');
  assert.equal(dfLabel((o as { dfId: string }).dfId), 'SOS 2');
  o = ord('SOS SOS SOS');
  assert.equal(o.type, 'DF');
  assert.ok(e.dfs.find((d) => d.id === (o as { dfId: string }).dfId)?.sos);
  o = ord('1 Pl move to alt posn');
  assert.deepEqual([o.type, label((o as { unitId: string }).unitId)], ['MOVE_ALT', '1 Pl']);
  o = ord('two platoon, occupy your alternate position');
  assert.deepEqual([o.type, label((o as { unitId: string }).unitId)], ['MOVE_ALT', '2 Pl']);
  o = ord('Screen withdraw now');
  assert.equal(o.type, 'WITHDRAW');
  o = ord('3 Pl C attk 15 r');
  assert.equal(o.type, 'CATK');
  assert.equal(label((o as { unitId: string }).unitId), '3 Pl');
  o = ord('3 Pl occupy C pen');
  assert.equal(o.type, 'CPEN');
  o = ord('1 Pl hold fast');
  assert.equal(o.type, 'HOLD');
  o = ord('QC to 15 r');
  assert.equal(o.type, 'QC_SURV');
  const itg = e.s.ds.itgs.find((i) => i.name === '15 r')!;
  assert.deepEqual((o as { target: unknown }).target, itg.pos);
  o = ord('QC to GR 155 735');
  assert.equal(o.type, 'QC_SURV');
  assert.equal(e.terrain.gridRef((o as { target: { x: number; y: number } }).target), 'GR 155 735');
  assert.equal(ord('recall the QC').type, 'QC_RECALL');
  if (e.contacts.size) {
    assert.equal(ord('A/QC strike on the tks').type, 'AQC');
    assert.equal(ord('mortars engage the en').type, 'FIRE_CONTACT');
    const u = ord('UCAV on the tks, confirmed, beyond DF') as { type: string; justification: string[] };
    assert.equal(u.type, 'UCAV');
    assert.ok(u.justification.includes('confirmed') && u.justification.includes('outofdf'));
  }
  assert.equal(kind('sitrep 1 Pl').kind, 'SITREP');
  assert.equal(kind('Sitrep').kind, 'SITREP');
  assert.equal(kind('Bn, request C attk on 15 r').kind, 'REPLY');
  assert.equal(kind('fire DF 42').kind, 'REPLY');
  assert.equal(kind('what a lovely evening').kind, 'UNKNOWN');
  assert.equal(normalise(' One  PL! '), ' 1 pl ');
  const sr = sitrep(e, e.units.find((u) => u.label === '1 Pl')!.id);
  assert.equal(sr.who, '1 Pl');
  assert.match(sr.text, /%/);
  assert.match(sitrep(e).text, /localities held/);
});

test('radio messages execute locally and fall back without a key', async () => {
  const e = seedEngine(2, false);
  e.runUntil(e.hHour - 60);
  const n0 = e.orders.length;
  const r1 = await radioMessage(e, 'fire DF 1');
  assert.equal(r1.src, 'LOCAL');
  assert.equal(e.orders.length, n0 + 1);
  const r2 = await radioMessage(e, '1 Pl move to alt posn');
  assert.equal(r2.who, '1 Pl');
  assert.match(r2.text, /altn posn/);
  const r3 = await radioMessage(e, 'gentlemen, a brief word about morale');
  assert.equal(r3.src, 'NONE');
  assert.match(r3.text, /Say again/);
});

test('radio: AI maps free text to engine orders via enumerated ids', async () => {
  const e = seedEngine(2, false);
  e.runUntil(e.hHour - 60);
  const { f, calls } = fakeFetch(() => ({ json: message(JSON.stringify({ o: [{ t: 'ALT', u: 'U2' }, { t: 'DF', d: 'D3' }, { t: 'WD', u: 'U99' }], r: '2 Pl: Wilco, moving to altn posn now. DF 1 on the way. Out.' })) }));
  const ai = new BattleAi(e, { key: 'sk-ant-test', fetch: f, features: { enemy: false } });
  const before = e.orders.length;
  const r = await radioMessage(e, 'Two Platoon, get out of there to where we rehearsed and drop the fire on the track junction', { battle: ai.battle });
  assert.equal(calls.length, 1);
  assert.equal(r.src, 'AI');
  assert.equal(e.orders.length, before + 2, 'two valid orders executed, the unknown id dropped');
  assert.match(r.text, /^Wilco/, 'the echoed "2 Pl:" call sign is dropped (the panel shows who speaks)');
  assert.equal(stripCallsign(e, 'ETA: 5 min, out.', 'Bn'), 'ETA: 5 min, out.', 'only known call signs are stripped');
  assert.equal(stripCallsign(e, 'FOO - Shot, over.', 'FOO'), 'Shot, over.');
  assert.equal(ai.battle.calls, 1);
  assert.ok(ai.record().events.some((x) => x.who === 'RADIO'));
  // malformed answers are rejected
  const { maps } = encodeRadio(e, 'x');
  assert.equal(validateRadio({ o: 'nope', r: 1 }, e, maps, 'x'), null);
  assert.equal(validateRadio({ o: [{ t: 'ALT', u: 'U77' }], r: '' }, e, maps, 'x'), null);
});

// ------------------------------------------------------------------ client: params, validation & fallback

test('request params follow the per-model rules', () => {
  const spec = { system: 'S', user: 'U', maxTokens: { big: 1200, haiku: 300 }, schema: { type: 'object' as const, properties: { a: { type: 'string' } }, required: ['a'], additionalProperties: false } };
  const opus = buildParams('claude-opus-5-5', spec) as unknown as Record<string, unknown>;
  assert.equal(opus.model, 'claude-opus-5-5');
  assert.equal(opus.max_tokens, 1200);
  assert.equal((opus.output_config as { effort: string }).effort, 'low');
  assert.equal(opus.fallbacks, 'default');
  assert.ok((opus.betas as string[]).includes('server-side-fallback-2026-07-01'));
  assert.deepEqual(opus.cache_control, { type: 'ephemeral' });
  assert.equal((opus.output_config as { format: { type: string } }).format.type, 'json_schema');
  for (const k of ['thinking', 'temperature', 'top_p']) assert.ok(!(k in opus), `no ${k}`);
  const sonnet = buildParams('claude-sonnet-5-5', spec) as unknown as Record<string, unknown>;
  assert.equal(sonnet.fallbacks, 'default');
  const haiku = buildParams('claude-haiku-4-5', { ...spec, schema: undefined }) as unknown as Record<string, unknown>;
  assert.equal(haiku.max_tokens, 300);
  for (const k of ['thinking', 'fallbacks', 'betas', 'output_config', 'temperature']) assert.ok(!(k in haiku), `haiku: no ${k}`);
});

test('client: good answers parse; refusal, max_tokens, bad JSON, errors and timeouts fall back', async () => {
  const spec = { system: 'S', user: 'U', schema: { type: 'object' as const, properties: { a: { type: 'string' } }, required: ['a'], additionalProperties: false }, validate: (r: unknown) => ((r as { a?: unknown })?.a === 'ok' ? 'ok' : null), maxTokens: { big: 512, haiku: 128 } };
  const run = (rep: Reply, timeoutMs?: number) => {
    const { f, calls } = fakeFetch(() => rep);
    return callClaude({ ...spec, timeoutMs }, { key: 'sk-ant-test', model: 'claude-opus-5-5', fetch: f }).then((r) => ({ r, calls }));
  };
  const good = await run({ json: message('{"a":"ok"}') });
  assert.ok(good.r.ok);
  assert.equal(good.calls[0].url, 'https://api.anthropic.com/v1/messages?beta=true');
  assert.equal(good.calls[0].headers.get('x-api-key'), 'sk-ant-test');
  assert.match(good.calls[0].headers.get('anthropic-beta') ?? '', /server-side-fallback-2026-07-01/);
  if (good.r.ok) assert.equal(good.r.usage.input, 300);

  const cases: [Reply, string][] = [
    [{ json: message('', { stop: 'refusal', details: { type: 'refusal', category: 'cyber', explanation: 'x' } }) }, 'REFUSAL'],
    [{ json: message('{"a":"o', { stop: 'max_tokens' }) }, 'MAX_TOKENS'],
    [{ json: message('not json at all') }, 'BAD_OUTPUT'],
    [{ json: message('{"a":"wrong"}') }, 'BAD_OUTPUT'],
    [{ status: 401, json: { type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } } }, 'AUTH'],
    [{ status: 403, json: { type: 'error', error: { type: 'permission_error', message: 'no' } } }, 'PERMISSION'],
    [{ status: 400, json: { type: 'error', error: { type: 'invalid_request_error', message: 'bad' } } }, 'BAD_REQUEST'],
    [{ status: 429, headers: { 'retry-after-ms': '1' }, json: { type: 'error', error: { type: 'rate_limit_error', message: 'slow' } } }, 'RATE_LIMIT'],
    [{ throws: true }, 'NETWORK'],
  ];
  for (const [rep, want] of cases) {
    const { r } = await run(rep);
    assert.equal(r.ok, false, want);
    if (!r.ok) assert.equal(r.reason, want, `${want}: ${r.detail}`);
  }
  const t = await run({ hang: true }, 60);
  assert.equal(t.r.ok, false);
  if (!t.r.ok) assert.equal(t.r.reason, 'TIMEOUT');
  const nokey = await callClaude(spec, { key: '', fetch: fakeFetch(() => ({})).f });
  assert.equal(nokey.ok, false);
});

test('enemy answers are validated against the menu', () => {
  const dp: RedDecisionPoint = {
    key: 'X',
    kind: 'PLAN',
    sit: '',
    groups: [
      { name: 'apch', def: '', options: [{ id: 'A1', text: '' }, { id: 'A2', text: '' }] },
      { name: 'h', def: 'H0', options: [{ id: 'H0', text: '' }, { id: 'H+15', text: '' }] },
    ],
  };
  assert.deepEqual(validateEnemy({ p: ['a2', 'H+15'], i: 'go' }, dp)?.picks, { apch: 'A2', h: 'H+15' });
  assert.deepEqual(validateEnemy({ p: ['A9', 'H+15'], i: 'go' }, dp)?.picks, { apch: '', h: 'H+15' }, 'invalid pick → rule default');
  assert.equal(validateEnemy({ p: ['A9', 'Z'], i: 'go' }, dp), null, 'nothing valid → reject');
  assert.equal(validateEnemy({ p: 'A1', i: 'go' }, dp), null);
  assert.equal(validateEnemy('A1', dp), null);
  const long = validateEnemy({ p: ['A1'], i: Array.from({ length: 40 }, () => 'word').join(' ') }, dp)!;
  assert.ok(long.intent.split(' ').length <= 20);
});

// ------------------------------------------------------------------ enemy commander: live, fallback, determinism

test('AI enemy commander decides, is recorded, and replays deterministically', async () => {
  const { f, calls } = fakeFetch((body) => enemyResponder(body));
  const e = seedEngine(6);
  const ai = new BattleAi(e, { key: 'sk-ant-test', fetch: f, budget: 50000 });
  await runLive(e, ai);
  assert.ok(e.over);
  const rec = ai.record();
  assert.ok(calls.length >= 2, `calls ${calls.length}`);
  assert.ok(rec.choices && rec.choices.some((c) => c.key === 'PLAN' && c.src === 'AI'));
  assert.ok(rec.events.some((x) => x.who === 'EN_CDR' && /Intent:/.test(x.text)));
  assert.equal(rec.inputTokens, calls.length * 420);
  for (const c of calls) {
    const sys = c.body.system as string;
    assert.equal(sys, ENEMY_SYS, 'frozen system prompt');
    assert.ok(estTokens(sys + (c.body.messages as { content: string }[])[0].content) < 700);
  }
  // replay with the recorded choices reproduces the battle exactly
  const r = seedEngine(6);
  r.ai = replayAi(rec.choices!);
  r.runToEnd();
  assert.deepEqual(r.summary(), e.summary());
  assert.deepEqual(r.log, e.log);
  assert.deepEqual(r.frames, e.frames);
  // and the AI's choices really changed the battle compared with the built-in commander
  const base = seedEngine(6);
  base.runToEnd();
  assert.notDeepEqual(base.log, e.log);
});

test('enemy commander holds the clock at most holdMs, then the built-in commander decides', async () => {
  let clock = 0;
  // replies arrive (in real time) only after the simulated 8 s hold has expired
  const { f } = fakeFetch((body) => ({ ...enemyResponder(body), delayMs: 40 }));
  const e = seedEngine(6);
  const ai = new BattleAi(e, { key: 'sk-ant-test', fetch: f, now: () => clock, holdMs: 8000 });
  const holds: number[] = [];
  let run = 0;
  let guard = 0;
  while (!e.redPlanFinal && guard++ < 20000) {
    if (ai.holding()) {
      run++;
      clock += 1000;
      await flush();
    } else {
      if (run) holds.push(run);
      run = 0;
      e.step();
    }
  }
  assert.ok(e.redPlanFinal);
  const choices = ai.record().choices!;
  assert.equal(holds.length, choices.length, 'one hold per decision point');
  for (const h of holds) assert.equal(h, 8, 'clock held for 8 s of real time, no more');
  assert.equal(choices.find((c) => c.key === 'PLAN')!.src, 'RULE');
  assert.ok(choices.every((c) => c.src === 'RULE'));
  assert.ok(ai.record().events.some((x) => /built-in commander \(no answer in 8 s\)/.test(x.text)));
  await new Promise((r) => setTimeout(r, 80));
  assert.ok(ai.record().events.some((x) => /too late/.test(x.text)), 'late reply noted, not applied');
  assert.ok(ai.record().choices!.every((c) => c.src === 'RULE'));
});

test('budget hard stop: no calls beyond the per-battle budget', async () => {
  const { f, calls } = fakeFetch(() => ({ json: message('{"a":"ok"}', { inTok: 600, outTok: 300 }) }));
  const b = new AiBattle({ key: 'sk-ant-test', fetch: f, budget: 1000 });
  const spec = { system: 'S', user: 'U', schema: { type: 'object' as const, properties: { a: { type: 'string' } }, required: ['a'], additionalProperties: false }, validate: (r: unknown) => r, maxTokens: { big: 256, haiku: 64 } };
  assert.ok((await b.call('radio', spec)).ok);
  assert.equal(b.used, 900);
  const second = await b.call('radio', spec);
  assert.equal(second.ok, false);
  if (!second.ok) assert.equal(second.reason, 'BUDGET');
  assert.equal(calls.length, 1, 'no request sent once the budget would be exceeded');
  assert.ok(b.budgetHit);
  // the enemy commander falls back immediately when out of budget (no hold)
  const e = seedEngine(6);
  const ai = new BattleAi(e, { key: 'sk-ant-test', fetch: f, budget: 100 });
  e.runUntil(e.hHour - 200);
  assert.ok(e.redPlanFinal);
  assert.equal(ai.holding(), false);
  assert.equal(ai.record().choices!.find((c) => c.key === 'PLAN')!.src, 'RULE');
});

// ------------------------------------------------------------------ text judge & mentor

test('AI text judge batches one submission into one call and falls back per item', async () => {
  const reqs: TextJudgeRequest[] = [
    { id: 'A', task: 't', situation: 's', keyPoints: ['k0', 'k1'], answer: 'answer a' },
    { id: 'B', task: 't', situation: 's', keyPoints: ['k0'], answer: '' },
    { id: 'C', task: 't', situation: 's', keyPoints: ['alpha bravo', 'charlie'], answer: 'alpha bravo' },
  ];
  const { f, calls } = fakeFetch(() => ({ json: message(JSON.stringify({ r: [{ i: 0, s: 1.4, n: 'Good.', c: [0, 1, 7] }] })) }));
  const out = await makeAiJudge({ key: 'sk-ant-test', fetch: f }).judge(reqs);
  assert.equal(calls.length, 1);
  assert.equal(out[0]?.source, 'AI');
  assert.equal(out[0]?.score, 1, 'score clamped');
  assert.deepEqual(out[0]?.covered, [0, 1], 'out-of-range index dropped');
  assert.equal(out[1], null, 'empty answer not judged');
  assert.equal(out[2]?.source, 'OFFLINE', 'unmarked item falls back to the offline heuristic');
  const bad = await makeAiJudge({ key: 'sk-ant-test', fetch: fakeFetch(() => ({ status: 500, json: {} })).f }).judge(reqs);
  assert.ok(bad.every((x) => !x || x.source === 'OFFLINE'));
  assert.equal(validateJudge({ r: [{ i: 9, s: 0.5, n: 'x', c: [] }] }, reqs), null);
});

test('mentor output is validated and capped at 200 words', () => {
  assert.equal(validateMentor('ok'), null);
  const long = Array.from({ length: 300 }, (_, i) => `w${i}`).join(' ');
  const v = validateMentor(`- one\n- two\n${long}`)!;
  assert.ok(v.split(/\s+/).length <= 201);
  assert.equal(clampWordsKeepLines('a b\n\nc d e', 3), 'a b\n\nc…');
});

// ------------------------------------------------------------------ privacy

test('API key stays in local storage only — never in IndexedDB data, backups, packs or records', async () => {
  const SECRET = 'sk-ant-api03-SECRET-KEY-DO-NOT-LEAK';
  setApiKey(SECRET);
  setAiConfig({ ...getAiConfig(), enabled: true });
  assert.equal(getApiKey(), SECRET);
  assert.ok(aiAvailable('enemy'));
  assert.ok(!JSON.stringify(getAiConfig()).includes(SECRET), 'config stored separately from the key');
  const { f } = fakeFetch((body) => enemyResponder(body));
  const e = seedEngine(6);
  const ai = new BattleAi(e, { fetch: f }); // key taken from settings
  await runLive(e, ai);
  const rec = wargameRecord(e);
  rec.ai = ai.record();
  assert.ok(rec.ai.calls > 0);
  const s = presetBic49();
  await db.put('settings', { id: 'settings', institution: 'SI&T', instructorHash: 'h', instructorName: 'DS', createdAt: 1 });
  await db.put('scenarios', s);
  await db.put('attempts', { id: 'att1', exerciseId: 'ex1', studentId: 'st1', scenarioId: s.id, status: 'COMPLETE', plan: e.plan, startedAt: 1, wargame: rec } as Attempt);
  for (const kind of ['BACKUP', 'PACK', 'SUBMISSION'] as const) {
    const b = await exportBundle(kind, kind === 'BACKUP' ? undefined : { attempts: () => true, scenarios: () => true });
    assert.ok(!JSON.stringify(b).includes(SECRET), `${kind} export is key-free`);
    assert.ok(!JSON.stringify(b).includes('SECRET-KEY'), `${kind} export is key-free`);
  }
  for (const store of ['settings', 'attempts', 'scenarios'] as const) assert.ok(!JSON.stringify(await db.all(store)).includes(SECRET), `${store} store is key-free`);
  setApiKey('');
  assert.equal(getApiKey(), '');
  assert.equal(aiAvailable(), false);
});

// Server: SET-01/02, SET-05 / NFR-04 (no hidden enemy data on the wire), NFR-08 (restart loses nothing),
// AI-05 (AI plays server-side through the same engine).
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp, parseCommand } from '../src/app';
import { loadContent } from '../src/content';
import { Store } from '../src/store';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const content = loadContent(ROOT);
const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  while (cleanup.length) await cleanup.pop()!();
});

async function server(store = new Store(':memory:')) {
  const { app, games } = await buildApp({ content, store, aiDelayMs: 0 });
  cleanup.push(async () => {
    await app.close();
  });
  return { app, games, store };
}

describe('content API (SET-01)', () => {
  it('lists scenarios with briefings and serves maps and data', async () => {
    const { app } = await server();
    const list = (await app.inject('/api/scenarios')).json();
    expect(list.map((s: { id: string }) => s.id)).toContain('ridgeline-coy-attack');
    const s = list.find((x: { id: string }) => x.id === 'ridgeline-coy-attack');
    expect(s.briefing.mission).toMatch(/Kotli Sharif/);
    expect((await app.inject('/api/maps/ridgeline')).json().hexes.length).toBe(44 * 32);
    expect((await app.inject('/api/data')).json().units.length).toBeGreaterThan(10);
    expect((await app.inject('/api/maps/nope')).statusCode).toBe(404);
    const mapList = (await app.inject('/api/maps')).json() as { id: string; hasBorder: boolean }[];
    expect(mapList.find((m) => m.id === 'mtn-kafir-ridge')?.hasBorder).toBe(true);
    expect((await app.inject('/api/analysis-params')).json().mountain.modes.mountain).toBeTruthy();
    // the pre-game scenario for blue does not contain red's ORBAT
    const pub = (await app.inject('/api/scenarios/ridgeline-coy-attack?side=blue')).json();
    expect(pub.scenario.sides.red.orbat).toEqual([]);
    expect(JSON.stringify(pub)).not.toContain('r-atgm');
    expect((await app.inject('/api/meta')).json().name).toBe('Tactical Hex Trainer');
    expect((await app.inject('/api/scenarios/nope')).statusCode).toBe(404);
  });
});

describe('games over HTTP', () => {
  it('creates a game vs AI, deploys, and the AI answers server-side', async () => {
    const { app, games } = await server();
    const res = (await app.inject({ method: 'POST', url: '/api/games', payload: { scenarioId: 'canal-bridge-raid', mode: 'ai', side: 'blue', seed: 7 } })).json();
    expect(res.tokens.blue).toMatch(/^[0-9a-f]{32}$/);
    expect(res.tokens.red).toBeUndefined();
    const url = `/api/games/${res.gameId}`;
    const st = (await app.inject(`${url}?token=${res.tokens.blue}`)).json();
    expect(st.view.phase).toBe('deploy');
    expect(st.side).toBe('blue');
    // SET-05: nothing about red's units before they are spotted
    expect(JSON.stringify(st)).not.toMatch(/"o-1"|"o-mmg"|Red Sec/);
    expect((await app.inject(`${url}?token=bad`)).statusCode).toBe(403);
    const end = await app.inject({ method: 'POST', url: `${url}/commands`, payload: { token: res.tokens.blue, command: { type: 'EndDeployment' } } });
    expect(end.json()).toEqual({ ok: true });
    await games.idle(res.gameId);
    const after = (await app.inject(`${url}?token=${res.tokens.blue}`)).json();
    expect(after.view.phase).toBe('play');
    expect(after.view.turn).toBe(1);
    expect(after.view.activeSide).toBe('blue');
    // illegal commands are refused with a code, malformed ones with 400
    const bad = (await app.inject({ method: 'POST', url: `${url}/commands`, payload: { token: res.tokens.blue, command: { type: 'MoveUnit', unitId: 'p1-1', to: { q: 0, r: 0 } } } })).json();
    expect(bad).toMatchObject({ ok: false, code: 'unreachable' });
    expect((await app.inject({ method: 'POST', url: `${url}/commands`, payload: { token: res.tokens.blue, command: { type: 'Nuke' } } })).statusCode).toBe(400);
    // end turn: the AI plays red and it is blue's turn 2
    await app.inject({ method: 'POST', url: `${url}/commands`, payload: { token: res.tokens.blue, command: { type: 'EndTurn' } } });
    await games.idle(res.gameId);
    const t2 = (await app.inject(`${url}?token=${res.tokens.blue}&logFrom=0`)).json();
    expect(t2.view.turn).toBe(2);
    expect(t2.view.activeSide).toBe('blue');
    expect(t2.logTotal).toBeGreaterThan(0);
    // the AI side cannot be driven by a player
    expect((await app.inject({ method: 'POST', url: '/api/games', payload: { scenarioId: 'nope' } })).statusCode).toBe(400);
  });

  it('hot-seat gives both sides a token; each sees only its own picture', async () => {
    const { app } = await server();
    const res = (await app.inject({ method: 'POST', url: '/api/games', payload: { scenarioId: 'canal-bridge-raid', mode: 'hotseat', seed: 3 } })).json();
    expect(res.tokens.blue && res.tokens.red).toBeTruthy();
    const red = (await app.inject(`/api/games/${res.gameId}?token=${res.tokens.red}`)).json();
    expect(red.side).toBe('red');
    expect(JSON.stringify(red.view)).not.toContain('p1-1');
    const wrongTurn = (await app.inject({ method: 'POST', url: `/api/games/${res.gameId}/commands`, payload: { token: res.tokens.red, command: { type: 'EndDeployment' } } })).json();
    expect(wrongTurn).toMatchObject({ ok: false, code: 'not_your_turn' });
  });

  it('a restarted server rebuilds every game from the event log (NFR-08)', async () => {
    const store = new Store(':memory:');
    const a = await server(store);
    const res = (await a.app.inject({ method: 'POST', url: '/api/games', payload: { scenarioId: 'canal-bridge-raid', mode: 'ai', side: 'blue', seed: 11 } })).json();
    const url = `/api/games/${res.gameId}`;
    await a.app.inject({ method: 'POST', url: `${url}/commands`, payload: { token: res.tokens.blue, command: { type: 'EndDeployment' } } });
    await a.games.idle(res.gameId);
    await a.app.inject({ method: 'POST', url: `${url}/commands`, payload: { token: res.tokens.blue, command: { type: 'MoveUnit', unitId: 'p1-1', to: a.games.state(res.gameId, res.tokens.blue).view.units.find((u) => u.id === 'p1-1')!.hex! } } });
    await a.app.inject({ method: 'POST', url: `${url}/commands`, payload: { token: res.tokens.blue, command: { type: 'EndTurn' } } });
    await a.games.idle(res.gameId);
    const before = a.games.state(res.gameId, res.tokens.blue);
    const b = await server(store);
    expect(b.games.restore()).toBe(1);
    const after = b.games.state(res.gameId, res.tokens.blue);
    expect(after.view).toEqual(before.view);
    expect(after.logTotal).toBe(before.logTotal);
    expect(store.events(res.gameId).length).toBeGreaterThan(2);
  });
});

describe('command parsing', () => {
  it('accepts well-formed commands only', () => {
    expect(parseCommand({ type: 'EndTurn' })).toEqual({ type: 'EndTurn' });
    expect(parseCommand({ type: 'Fire', unitId: 'a', weaponId: 'b', targetId: 'c', extra: 1 })).toEqual({ type: 'Fire', unitId: 'a', weaponId: 'b', targetId: 'c' });
    expect(parseCommand({ type: 'MoveUnit', unitId: 'a', to: { q: 1.5, r: 0 } })).toBeNull();
    expect(parseCommand({ type: 'Deploy', unitId: 'a', hex: { q: 1, r: 2 } })).toEqual({ type: 'Deploy', unitId: 'a', hex: { q: 1, r: 2 } });
    expect(parseCommand({ type: 'IndirectFire', unitId: 'a', weaponId: 'w', hex: { q: 1, r: 2 } })).toBeTruthy();
    expect(parseCommand({ type: 'CallFire', assetId: 'x', hex: { q: 1, r: 2 } })).toBeTruthy();
    expect(parseCommand({ type: 'Mount', unitId: 'a', vehicleId: 'v' })).toBeTruthy();
    expect(parseCommand({ type: 'Dismount', unitId: 'a', hex: { q: 0, r: 0 } })).toBeTruthy();
    expect(parseCommand({ type: 'EndDeployment' })).toEqual({ type: 'EndDeployment' });
    expect(parseCommand(null)).toBeNull();
    expect(parseCommand({ type: 'Fire', unitId: 'x'.repeat(200), weaponId: 'b', targetId: 'c' })).toBeNull();
  });
});

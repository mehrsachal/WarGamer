// Thin client for the THT server. The client never receives hidden enemy data: views and logs are filtered
// server-side; the engine bundled here is used only to preview move ranges and hit odds (no round trip).
import { type Command, type DataBundle, type GameContext, type GameMap, type LogItem, MapModel, Ruleset, type Scenario, type Side, type SideView } from '@tht/engine';

export interface ScenarioSummary {
  id: string;
  title: string;
  mapId: string;
  turns: number;
  minutesPerTurn: number;
  weather: string;
  timeOfDay: string;
  firstSide: Side;
  briefing: Scenario['briefing'];
  sideNames: Record<Side, string>;
  objectives: Scenario['objectives'];
  ai: Scenario['ai'] | null;
  classification: string;
}

export interface GameState {
  gameId: string;
  side: Side;
  mode: 'ai' | 'hotseat';
  aiSide: Side | null;
  aiThinking: boolean;
  view: SideView;
  log: LogItem[];
  logFrom: number;
  logTotal: number;
  scenario?: Scenario;
}

async function json<T>(r: Response): Promise<T> {
  if (!r.ok) {
    const body = await r.json().catch(() => ({}));
    throw Object.assign(new Error((body as { error?: string }).error ?? `HTTP ${r.status}`), { status: r.status });
  }
  return r.json() as Promise<T>;
}

export const api = {
  scenarios: () => fetch('/api/scenarios').then((r) => json<ScenarioSummary[]>(r)),
  scenario: (id: string, side?: Side) => fetch(`/api/scenarios/${id}${side ? `?side=${side}` : ''}`).then((r) => json<{ summary: ScenarioSummary; scenario: Scenario }>(r)),
  map: (id: string) => fetch(`/api/maps/${id}`).then((r) => json<GameMap>(r)),
  data: () => fetch('/api/data').then((r) => json<Record<string, unknown>>(r)),
  createGame: (body: { scenarioId: string; mode: 'ai' | 'hotseat'; side: Side; seed?: number }) =>
    fetch('/api/games', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then((r) => json<{ gameId: string; tokens: Partial<Record<Side, string>> }>(r)),
  state: (gameId: string, token: string, logFrom = 0) => fetch(`/api/games/${gameId}?token=${token}&logFrom=${logFrom}`).then((r) => json<GameState>(r)),
  command: (gameId: string, token: string, command: Command) =>
    fetch(`/api/games/${gameId}/commands`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token, command }) }).then((r) =>
      json<{ ok: true } | { ok: false; code: string; params: Record<string, string | number> }>(r),
    ),
  socket(gameId: string, token: string): WebSocket {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    return new WebSocket(`${proto}://${location.host}/api/games/${gameId}/ws?token=${token}`);
  },
};

let dataCache: Promise<Ruleset> | undefined;
const mapCache = new Map<string, Promise<MapModel>>();

export function ruleset(): Promise<Ruleset> {
  dataCache ??= api.data().then((d) => Ruleset.parse({ terrain: d.terrain, edges: d.edges, weapons: d.weapons, units: d.units, sensors: d.sensors, rules: d.rules } as DataBundle));
  return dataCache;
}

export async function mapModel(id: string): Promise<MapModel> {
  let p = mapCache.get(id);
  if (!p) {
    p = Promise.all([api.map(id), ruleset()]).then(([m, d]) => new MapModel(m, d));
    mapCache.set(id, p);
  }
  return p;
}

/** Engine context for client-side previews, built from the side's public scenario. */
export async function clientContext(scenario: Scenario): Promise<GameContext> {
  const [data, map] = await Promise.all([ruleset(), mapModel(scenario.mapId)]);
  return { data, map, scenario };
}

// ---------------------------------------------------------------- saved games on this computer
export interface SavedGame {
  gameId: string;
  scenarioId: string;
  title: string;
  mode: 'ai' | 'hotseat';
  side: Side;
  tokens: Partial<Record<Side, string>>;
  createdAt: number;
}

const KEY = 'tht.games';

export function savedGames(): SavedGame[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '[]');
  } catch {
    return [];
  }
}

export function saveGame(g: SavedGame): void {
  try {
    const all = savedGames().filter((x) => x.gameId !== g.gameId);
    all.unshift(g);
    localStorage.setItem(KEY, JSON.stringify(all.slice(0, 30)));
  } catch {
    /* private window: games can still be played, just not resumed from this list */
  }
}

export function savedGame(id: string): SavedGame | undefined {
  return savedGames().find((g) => g.gameId === id);
}

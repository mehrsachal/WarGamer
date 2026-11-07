// HTTP + WebSocket API. Clients only ever receive their own side's view and redacted log (SET-05 / NFR-04).
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import fastifyStatic from '@fastify/static';
import websocket from '@fastify/websocket';
import { type Command, type Side, hexKey } from '@tht/engine';
import Fastify, { type FastifyInstance } from 'fastify';
import { type Content, publicScenario, scenarioSummary } from './content';
import { GameError, GameManager } from './games';
import type { Store } from './store';

export interface AppOptions {
  content: Content;
  store: Store;
  clientDir?: string;
  aiDelayMs?: number;
  logger?: boolean;
  version?: string;
}

const COMMANDS = new Set(['Deploy', 'EndDeployment', 'MoveUnit', 'Fire', 'IndirectFire', 'CallFire', 'Mount', 'Dismount', 'EndTurn']);

function isHex(x: unknown): boolean {
  return !!x && typeof x === 'object' && Number.isInteger((x as { q: unknown }).q) && Number.isInteger((x as { r: unknown }).r);
}

/** Shallow structural check of a client command before it reaches the engine. */
export function parseCommand(raw: unknown): Command | null {
  if (!raw || typeof raw !== 'object') return null;
  const c = raw as Record<string, unknown>;
  if (typeof c.type !== 'string' || !COMMANDS.has(c.type)) return null;
  const str = (k: string) => typeof c[k] === 'string' && (c[k] as string).length < 100;
  switch (c.type) {
    case 'Deploy':
      return str('unitId') && isHex(c.hex) ? { type: 'Deploy', unitId: c.unitId as string, hex: { q: (c.hex as { q: number }).q, r: (c.hex as { r: number }).r } } : null;
    case 'MoveUnit':
      return str('unitId') && isHex(c.to) ? { type: 'MoveUnit', unitId: c.unitId as string, to: { q: (c.to as { q: number }).q, r: (c.to as { r: number }).r } } : null;
    case 'Fire':
      return str('unitId') && str('weaponId') && str('targetId') ? { type: 'Fire', unitId: c.unitId as string, weaponId: c.weaponId as string, targetId: c.targetId as string } : null;
    case 'IndirectFire':
      return str('unitId') && str('weaponId') && isHex(c.hex) ? { type: 'IndirectFire', unitId: c.unitId as string, weaponId: c.weaponId as string, hex: { q: (c.hex as { q: number }).q, r: (c.hex as { r: number }).r } } : null;
    case 'CallFire':
      return str('assetId') && isHex(c.hex) ? { type: 'CallFire', assetId: c.assetId as string, hex: { q: (c.hex as { q: number }).q, r: (c.hex as { r: number }).r } } : null;
    case 'Mount':
      return str('unitId') && str('vehicleId') ? { type: 'Mount', unitId: c.unitId as string, vehicleId: c.vehicleId as string } : null;
    case 'Dismount':
      return str('unitId') && isHex(c.hex) ? { type: 'Dismount', unitId: c.unitId as string, hex: { q: (c.hex as { q: number }).q, r: (c.hex as { r: number }).r } } : null;
    case 'EndDeployment':
      return { type: 'EndDeployment' };
    case 'EndTurn':
      return { type: 'EndTurn' };
  }
  return null;
}

export async function buildApp(opts: AppOptions): Promise<{ app: FastifyInstance; games: GameManager }> {
  const app = Fastify({ logger: opts.logger ?? false, bodyLimit: 64 * 1024 });
  const games = new GameManager(opts.content, opts.store, { aiDelayMs: opts.aiDelayMs });
  const { content } = opts;

  app.addHook('onSend', async (_req, reply, payload) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Referrer-Policy', 'no-referrer');
    reply.header('Content-Security-Policy', "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; connect-src 'self' ws: wss:; object-src 'none'; base-uri 'none'");
    return payload;
  });

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof GameError) return reply.status(err.status).send({ error: err.code, params: err.params });
    const status = (err as { statusCode?: number }).statusCode ?? 500;
    if (status >= 500) app.log.error(err);
    return reply.status(status).send({ error: status >= 500 ? 'server_error' : 'bad_request' });
  });

  await app.register(websocket);

  // ------------------------------------------------------------ content (public)
  app.get('/api/meta', async () => ({ name: 'Tactical Hex Trainer', version: opts.version ?? '0.1.0', scenarios: content.scenarios.size }));

  app.get('/api/data', async () => ({ ...content.data.lists, rules: content.data.rules }));

  app.get('/api/scenarios', async () => [...content.scenarios.values()].map(scenarioSummary));

  app.get<{ Params: { id: string }; Querystring: { side?: string } }>('/api/scenarios/:id', async (req) => {
    const s = content.scenarios.get(req.params.id);
    if (!s) throw new GameError(404, 'scenario_not_found');
    const side = req.query.side === 'blue' || req.query.side === 'red' ? req.query.side : null;
    // before a game the player may read the briefing and own forces only (SET-01)
    return { summary: scenarioSummary(s), scenario: publicScenario(s, side) };
  });

  app.get<{ Params: { id: string } }>('/api/maps/:id', async (req, reply) => {
    const m = content.rawMaps.get(req.params.id);
    if (!m) throw new GameError(404, 'map_not_found');
    reply.header('Cache-Control', 'max-age=3600');
    return m;
  });

  // ------------------------------------------------------------ games
  app.post<{ Body: { scenarioId?: string; mode?: string; side?: string; seed?: number } }>('/api/games', async (req) => {
    const b = req.body ?? {};
    if (!b.scenarioId || !content.scenarios.has(b.scenarioId)) throw new GameError(400, 'scenario_not_found');
    const mode = b.mode === 'hotseat' ? 'hotseat' : 'ai';
    const side: Side = b.side === 'red' ? 'red' : 'blue';
    const seed = Number.isInteger(b.seed) && (b.seed as number) > 0 ? (b.seed as number) : undefined;
    return games.create(b.scenarioId, mode, side, seed);
  });

  app.get<{ Params: { id: string }; Querystring: { token?: string; logFrom?: string } }>('/api/games/:id', async (req) => {
    const st = games.state(req.params.id, req.query.token, Number(req.query.logFrom ?? 0) || 0);
    const s = content.scenarios.get(games.list().find((g) => g.id === req.params.id)!.scenarioId)!;
    return { ...st, scenario: publicScenario(s, st.side) };
  });

  app.post<{ Params: { id: string }; Body: { token?: string; command?: unknown } }>('/api/games/:id/commands', async (req) => {
    const cmd = parseCommand(req.body?.command);
    if (!cmd) throw new GameError(400, 'bad_command');
    return games.command(req.params.id, req.body?.token, cmd);
  });

  app.get<{ Params: { id: string }; Querystring: { token?: string } }>('/api/games/:id/ws', { websocket: true }, (socket, req) => {
    let side: Side;
    try {
      side = games.sideFor(req.params.id, req.query.token);
    } catch {
      socket.close(4403, 'bad_token');
      return;
    }
    const id = req.params.id;
    const token = req.query.token!;
    let sentLog = 0;
    const push = () => {
      try {
        const st = games.state(id, token, sentLog);
        sentLog = st.logTotal;
        socket.send(JSON.stringify({ type: 'state', ...st }));
      } catch {
        /* game gone */
      }
    };
    const off = games.onChange((gid) => gid === id && push());
    socket.on('message', (raw: Buffer) => {
      try {
        const m = JSON.parse(String(raw));
        if (m?.type === 'resync') {
          sentLog = Number(m.logFrom) || 0;
          push();
        }
      } catch {
        /* ignore */
      }
    });
    socket.on('close', off);
    void side;
    push();
  });

  // ------------------------------------------------------------ client (static, offline bundle)
  const dir = opts.clientDir;
  if (dir && existsSync(join(dir, 'index.html'))) {
    await app.register(fastifyStatic, { root: dir, prefix: '/', index: ['index.html'] });
    app.setNotFoundHandler((req, reply) => {
      if (req.method === 'GET' && !req.url.startsWith('/api/')) return reply.type('text/html').sendFile('index.html');
      return reply.status(404).send({ error: 'not_found' });
    });
  }

  void hexKey;
  return { app, games };
}

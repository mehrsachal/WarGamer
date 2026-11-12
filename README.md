# Tactical Hex Trainer (THT)

A turn-based, hex-grid tactical wargame for company-level officer training, built to the
*Tactical Hex Wargame — Feature Spec* (Nov 2026). Terrain-driven line of sight, fog of war, suppression,
probability-based fire and scarce fire support. It runs **offline on a closed LAN**: one Node server, any
Chrome/Edge browser as a client, no internet at runtime.

> This repository holds only **fictional sample data** (NFR-02). Real terrain and ORBAT packs are loaded by the
> institution at deploy time and are never committed.

## Status — build phases (spec §6)

| Phase | Scope | Gate | Status |
|---|---|---|---|
| 0 · Engine foundations | Hex maths, data schemas, seeded RNG, event log, LOS, move costs, debug view | LOS + replay tests pass, engine coverage ≥ 90 % | **Passed** (≈ 94 % statements, 97 % lines) |
| 1 · Playable MVP vs AI (P0) | Deploy, move, viewshed, fog of war, fire, suppression, mortars, artillery, UAVs, objectives, defensive AI, combat log | Full 16-turn game vs AI on a sample map | **Passed** (engine test + browser E2E) |
| 2 · Course-ready | Accounts, LAN 1v1, DS god view and injects, replay and AAR, spotting, opportunity fire, smoke, engineers and obstacles | Trial with one syndicate, DS sign-off | Not started |
| 3 · Real terrain and editor | GIS pipeline, scenario editor, validation, signed packs, offensive AI, tournaments | Instructor builds a scenario unaided | Not started |
| 4 · Extensions (P2) | Simultaneous orders, team play, EW, gap crossing, ratings, Urdu UI, written orders | As the course asks | Not started |

Already in place ahead of Phase 2: hot-seat mode, scenario validation (`npm run validate:data`), the Data and Help
panels, "show the maths" for hit chances, UAV endurance, area effect for indirect fire, keyboard shortcuts.

## Quick start (single laptop or LAN server)

```bash
npm install
npm run build        # client bundle + server bundle
npm start            # http://localhost:8080  (prints the LAN address too)
```

Open the address in Chrome or Edge, pick a scenario, read the briefing, choose **Play against the AI** (or
**Hot-seat**) and start. Games are saved on the server after every action (`var/tht.sqlite`); resume from the
home screen.

Environment: `THT_PORT` (8080), `THT_HOST` (0.0.0.0), `THT_DB`, `THT_CONTENT` (folder with `data/`, `maps/`,
`scenarios/` — point it at a data pack), `THT_CLIENT`.

### Docker (institution server)

```bash
docker compose up -d
```

Mount real data packs over `/app/data`, `/app/maps`, `/app/scenarios` (see `docker-compose.yml`). The database
lives in the `tht-db` volume.

## How to play (short)

- **Deployment** — place units inside your shaded zone (or *Auto-deploy*), then *End deployment*. The enemy never
  sees your set-up until a unit is spotted (SET-05).
- **Moving** — select a unit: grey hexes keep it *tactical* (can still fire), green hexes are a *dash* (cannot fire).
- **Firing** — hover a spotted enemy to see the hit %, open *Show the maths* in the unit card, click to fire.
- **Indirect fire** — mortars: *Fire mission…* in the unit card; off-map guns: *Artillery strike*. Both need an
  observer who can see the target hex.
- **Objectives** — flags change hands when only one side occupies them; VP are shown top-right.
- Keyboard: N/P next/previous unit, E end turn, V viewshed, G grid, A artillery, O/D/H panels, +/−/F zoom.

Full rules, with every table generated from the data files: [`docs/rules.md`](docs/rules.md).

## Terrain & plan analyser (training aid)

From the home page, **Terrain & plan analyser** runs an automatic appreciation of a fictional mountain border
sector: ridgelines, nullahs, key ground (ITGs) with the force each needs, approaches and dead ground, own
deployment in three modes (forward / normal / normal defence in mountains) with posts, weapon and mortar sites,
border surveillance gaps, enemy infiltration routes and 3–4 attack options — each rated *good / adequate /
not good* with recommendations, shown as map layers and exportable as GeoJSON / CSV. Three sample sectors:
`mtn-kafir-ridge`, `mtn-shandur-valley`, `mtn-twin-peaks`. Parameters live in `data/analysis-mountain.json`
and are placeholders for the institution's own figures. Details: [`docs/analyser.md`](docs/analyser.md).

## Architecture (spec §2)

```
packages/engine   @tht/engine — pure TypeScript rules engine, no I/O, deterministic (shared by server, client, AI, tests)
  src/hex.ts            axial/cube hex maths (MAP-01)
  src/data/             zod schemas + validation for terrain, edges, weapons, units, sensors, rules, maps, scenarios
  src/los.ts            line of sight and viewshed (VIS-01/02)
  src/move.ts           move costs, bands, reachable hexes (MOV-03/04/05)
  src/visibility.ts     spotting and fog of war (VIS-03/04/05)
  src/combat.ts         fire permission and the hit formula (CBT-01..05)
  src/execute.ts        the single path from command to state change + log (live play and replay)
  src/game.ts           Game: dispatch, replay, dice verification
  src/view.ts           per-side filtered view and redacted log (SET-05, NFR-04)
  src/ai/               defensive AI (AI-01/02/05) and scripted test players
  src/analysis/         terrain & plan analyser (params schema, analysis, GeoJSON/CSV export)
packages/server   Node + Fastify + WebSocket + SQLite (node:sqlite); authoritative; AI runs server-side
packages/client   React + Canvas renderer (tiled terrain cache), milsymbol APP-6 counters, i18n strings
data/ maps/ scenarios/   sample content (fictional)
tools/            map generator, scenario builder, data validator, rules-doc generator, licence list
e2e/run.mjs       browser end-to-end check (Playwright)
```

Every action is an event (`MoveUnit`, `Fire`, `EndTurn`, …) appended to an append-only table with the random draws
it used; game state is the replay of the events from the seed, so replays, AAR and anti-cheat come for free. The
server never sends a client an enemy unit it cannot currently see.

## Development

```bash
npm test                 # engine + server tests (Vitest)
npm run test:coverage    # engine coverage (gate: ≥ 90 %)
npm run typecheck
npm run validate:data    # check data, maps and scenarios
npm run gen:maps         # regenerate the fictional sample maps
npx tsx tools/make-scenarios.ts   # regenerate the sample scenarios
npm run gen:docs         # regenerate docs/rules.md
npm run dev:server & npm run dev:client   # live-reload development (client on :5173)
node e2e/run.mjs http://localhost:8080 [screenshots-dir]   # browser E2E (needs Playwright + Chromium)
```

## Decisions taken where the spec left a choice (spec §7)

The spec lists decisions to confirm. Until told otherwise the build uses its stated defaults:

- Command level: section / platoon counters under a company commander (HexWar style).
- Deployment: one Node server on the LAN, also runs on a single laptop. SQLite now; PostgreSQL later.
- Modes first: vs AI and hot-seat (networked 1v1 is Phase 2). Alternating turns.
- Present-day setting with small UAVs; English UI with all strings in `packages/client/src/i18n/en.json`.
- APP-6 / NATO symbology; Blue = own forces, Red = OPFOR (fictional "Red Land").
- 1 hex = 100 m, 16 turns of ~4 minutes. All numbers are approximate, open-source-style values in `data/`, for
  instructors to retune.

Licences of shipped dependencies: [`THIRD_PARTY_LICENSES.md`](THIRD_PARTY_LICENSES.md).

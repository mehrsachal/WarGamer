# WarGamer — Offline Tactical Wargaming Trainer

A tactical wargaming trainer for young officers that runs fully offline. Students read a narrative, carry out
the appreciation, place their forces and mark their plan with NATO (APP-6 / MIL-STD-2525) symbols and graphics,
pre-plan their contingencies, and then fight it out against a thinking enemy under fog of war. Every plan and
every decision is marked objectively against doctrine, and instructors get a class dashboard.

The doctrinal reference ("bible") is **The Rifle Company, Platoon and Section in Battle (ICIB, amdt Feb 2015)**.
Every marking item and decision verdict cites the relevant ICIB section and paragraph. The built-in
preset recreates **TE Def BIC-49** (Blueland vs Foxland, A Coy 139 Baloch) and its DS solution.

---

## Quick start (no installation)

1. Copy **`dist/WarGamer.html`** to any PC (USB stick is fine).
2. Double-click it. It opens in Chrome / Edge / Firefox from `file://`. No internet, server or install is needed.
3. On first run, set the instructor password. Three sample scenarios and the BIC-49 preset are seeded.
4. **Instructor:** create a class → add students (paste a list) → pick or generate a scenario → create an exercise.
5. **Students:** log in with their name and PIN → work through the exercise.

Data is kept in the browser's IndexedDB on that PC. To move data between PCs, use **Data & settings**: full
backup/restore, scenario packs, and student submission files that the instructor imports.

### Classroom LAN mode (optional, shared database)

If you have a Node.js runtime on one PC, all PCs on the LAN can share one database:

```bash
node server/lan-server.mjs            # --port 8080  --data ./server/data
```

Students browse to the address it prints (e.g. `http://192.168.1.10:8080`). The page detects the server and
stores everything centrally in `server/data/db.json`. It has no dependencies and needs no internet.

---

## What it does

### Exercise flow (student)
| Step | What happens |
|---|---|
| **Brief** | Narrative, requirements, own/enemy forces, times, weather and light. Map with the AOR, boundaries and grid. |
| **Appreciation** | Order the enemy's approaches and the ITGs, select the line of defence, fill a time & space table and write deductions. |
| **Plan** | Place localities, support wpns, screens, SP/LPs, obsrs, QC; mark FDLs, kill areas, minefields, wire, DFs/SOS, C attk and C pen routes, QC areas and ptl routes. Arcs, alternate posns, work readiness and a checklist are shown live. |
| **Contingencies** | Pre-select responses to the set injects: screen contact, probe, assembly in FAA, forming up (spoiling attk), assault, loss of a post (local C attk), loss of a locality (higher C attk, C pen), reorg/cas evac/ammo. |
| **Submit** | Plan is frozen and marked. Depending on exercise settings the student sees the plan score immediately or after the battle. |
| **Wargame** | Minute-by-minute simulation at 1×–60× speed. Live orders (DF, fire on contact, A/QC strike, UCAV on justified demand, move to alternate posn, withdraw, C attk, occupy C pen, hold). Injects pause the battle for a decision. |
| **Debrief** | Final score and grade, rubric with ICIB references, decision verdicts, replay with timeline scrubber, casualties over time, casualties by cause, enemy's plan revealed. |

### Simulation
- **Enemy AI (Foxland)** follows ICIB Sec 114. It sends recce and an adv guard that clears the security zone and
  breaks contact, probes at dusk, and builds its attack plan from what it has actually seen. It then moves through
  FAA → FUP → H hr with a base of fire, tanks in close support, engineer breaching, prep fire lifting at safety
  distance, Ph 2, a second wave when the first fails, and breaks off on heavy casualties.
- **Fog of war:** contacts come from what own sensors can see, scaled by range, light, signature and line of sight
  (vegetation and built-up areas mask it). NVDs, LPs/SPs hearing armour, QC footprints, EW jamming, and firing
  revealing posns all count. Fog can be set to full, partial or off.
- **Fires:** arty and mortar DFs, SOS, adjusted missions, ammunition limits, danger close, auto-lift; enemy
  arty. **QC:** surveillance and armed (A/QC) sorties, retasking, EW and air defence threat.
  **UCAV** on justified demand with approval/abort.
- **Obstacles:** wire, protective and A tk minefields, trip flares, breaching.
- **Combat:** direct fire with fire discipline, close combat post by post, local and higher C attks, C pen,
  reorg.
- Deterministic per attempt (seeded), so an instructor's replay matches the student's battle.

### Objective assessment
- **Plan (~45 checks in 9 groups):** appreciation, siting of localities, siting of weapons, observation plan,
  fire plan, surveillance & security, C attk & C2, contingency plan, time & space. Norms scale for Pl / Coy /
  Bn / Bde.
- **Decisions:** the same doctrinal evaluator marks the pre-planned contingency and the live decision
  (Best / Acceptable / Poor / Wrong, with rationale and reference).
- **Battle:** outcome (held / partial / lost, vital ground, attrition, own casualties, tanks), decisions at injects,
  conduct and fire discipline (wasted DFs, SOS timing, speed of C attk, screen withdrawal, UCAV justification).
- **Final = plan weight × plan + (1 − weight) × battle + instructor adjustment.** The weight is set per exercise
  (default 50/50). Grades: A+ ≥ 85, A ≥ 75, B ≥ 60, C ≥ 50, D below.

### Scenarios
- **Preset:** TE Def BIC-49 with the full sketch, narrative, resources, enemy Bn Gp and the DS solution
  (approaches, ITGs, lines of def, FAA/FUP/BOF).
- **Generator:** random scenarios at **Pl, Coy, Bn and Bde** level on plains, canal, desert or semi-desert terrain.
  Enemy strength, night attack, weather, QC and UCAV are selectable, and you can generate a batch at once. Each
  scenario gets an automatic terrain analysis and DS solution, which instructors can view and overlay.
- The instructor can edit the narrative and try any scenario in demo mode with the DS solution loaded.

### Dashboards
- **Instructor:** overview (where students lose marks), classes & students (bulk add, reset PIN), scenarios
  (generate / view DS / try), exercises (fog, injects, hints, difficulty, plan weight, time limit, score reveal),
  results (merit list, rubric heatmap, CSV export, per-attempt review with remarks, mark adjustment and
  re-open), data & settings.
- **Student:** assigned exercises, progress over time, strengths and weaknesses, free practice on generated
  scenarios, export of submissions for offline hand-in.

### Optional Claude AI (needs an API key and internet; everything else stays offline)
Set an Anthropic API key under **Data & settings → Claude AI** or from the **AI** pill in the top bar. The
key is kept only in this browser profile's localStorage — never in the class database, LAN server, backups,
packs or exports (anyone using that browser profile can use it). Choose the model (Claude Opus 5.5 by default,
Sonnet 5.5 or Haiku 4.5), switch features on/off and set a per-battle token budget (default 20,000; hard stop).
- **Enemy commander:** at key moments (final attk plan, screens contacted, Ph 1 taken/failed, own C attk) Claude
  picks from the options the built-in planner enumerates. The clock is held at most 8 s, then the built-in
  commander decides. Choices are recorded with the battle (deterministic replays) and revealed in the AAR.
- **Radio net:** free-text orders in the wargame ("fire DF 3", "2 Pl move to altn posn", "sitrep 1 Pl"). A
  built-in parser handles common orders and all sitreps without tokens; only unreadable messages go to Claude.
- **Text marking:** free-text answers of one submission are marked in one batched call.
- **Mentor:** "Ask the AI mentor" in the debrief gives <= 200 words of coaching against ICIB principles.

Calls are event-driven with compact prompts (typically a few hundred tokens each). With no key, no network
or no budget the built-in AI does everything.

---

## Development

```bash
npm install
npm run build        # → dist/WarGamer.html (single self-contained file)
npm run dev          # rebuild on change
npm test             # unit tests (terrain, generator, marking, decisions, simulation)
npm run typecheck
```

Stack: TypeScript, Preact, [milsymbol](https://github.com/spatialillusions/milsymbol) (MIT) for APP-6 symbols,
and esbuild, which inlines everything into one HTML file. The app has no runtime network dependencies.

```
src/core       types, doctrine constants & ICIB references, unit/weapon templates, RNG, geometry, time & light
src/terrain    terrain raster, line of sight, viewshed, path finding, terrain analysis (DS generation)
src/scenario   BIC-49 preset, random scenario generator, place names
src/plan       resource slots, auto (DS) plan, contingency catalogue, time & space
src/sim        engine, enemy AI, own-troop behaviour, sensors/fog, fires/QC/UCAV, combat, injects, orders
src/assess     plan rubric, decision evaluator, wargame assessment & final score
src/ai         optional Claude AI: settings, client, enemy cdr, radio net, text judge, mentor
src/render     map renderer (canvas) and NATO symbols
src/store      IndexedDB / LAN / memory store, PIN & password hashing
src/ui         instructor and student dashboards, exercise flow
server/        optional zero-dependency LAN server
tests/         node:test suites
```

Passwords and PINs only separate roles on a shared training PC. They are not a security boundary, and the
app is not meant for classified data.

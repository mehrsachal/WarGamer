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

## Install & run

WarGamer is one app that runs four ways. All of them work with **no internet connection**; pick whatever suits
the classroom.

### 1. Desktop app (Windows, macOS, Linux)

Download the installer for your computer from the project's **GitHub Releases** page:

| Computer | File | Notes |
|---|---|---|
| Windows 10 / 11 | `WarGamer-<ver>-setup-x64.exe` | Installer (Start menu + desktop shortcut). |
| Windows, no install | `WarGamer-<ver>-portable-x64.exe` | Runs straight from a USB stick. |
| macOS (Apple silicon / Intel) | `WarGamer-<ver>-mac-arm64.dmg` / `WarGamer-<ver>-mac-x64.dmg` | Drag to Applications. |
| Linux | `WarGamer-<ver>-linux-x86_64.AppImage` / `WarGamer-<ver>-linux-amd64.deb` | `chmod +x` the AppImage and run it, or `sudo apt install ./WarGamer-*.deb`. |

The builds are not code-signed. On Windows choose **More info → Run anyway** the first time. On macOS
right-click the app → **Open** (or run `xattr -dr com.apple.quarantine /Applications/WarGamer.app`).

The desktop app is the same WarGamer in its own window. Its data is kept in the app's data folder and survives
updates: `%APPDATA%\WarGamer` (Windows), `~/Library/Application Support/WarGamer` (macOS) or
`~/.config/WarGamer` (Linux). Use **Help → Open data folder** to find it, and take backups from
**Data & settings** as usual. Menus: **View** (zoom, full screen **F11**), **Classroom** (see below),
**Help** (user guide **F1**, about).

### 2. Single file (portable)

`dist/WarGamer.html` (also attached to every release) is the whole app in one file. Copy it anywhere and
double-click it; it runs from `file://` in Chrome, Edge or Firefox. See *Quick start* above.

### 3. Classroom on the LAN (shared database)

- **From the desktop app:** **Classroom → Host classroom on LAN…** starts the built-in server on this computer
  (port 8080, or the next free port). Your local classes, students, scenarios and exercises are copied into
  the classroom database (records already there are kept), and the app shows the address students type into
  Chrome or Edge, e.g. `http://192.168.1.10:8080`. Allow WarGamer through the firewall when asked.
  While hosting, the instructor window uses the classroom database. **Stop hosting** returns to local data.
  The classroom database (`<data folder>/classroom/db.json`) is kept and is used again the next time you host.
- **Without the desktop app:** run `node server/lan-server.mjs` on any PC that has Node.js 18 or later
  (see *Classroom LAN mode* above).

### 4. Install as a web app (PWA)

When WarGamer is opened over `http(s)://` (the LAN server or any static web host), Chrome and Edge can install
it as an app with its own window and icon. Use the install icon in the address bar, or **Data & settings →
App & version → Install as app**. A service worker keeps the app available offline and picks up a new
version on the next reload after the server is updated. Browsers only allow installation from `https://`
addresses or from `http://localhost`, so install it on the server PC itself; student PCs that reach the server
by plain `http://<ip>` simply use it in a browser tab, or use the desktop app. If an installed copy is opened
while the server is unreachable, it uses the data stored on that PC.

### Building the apps from source

```bash
npm ci
npm run build        # dist/WarGamer.html + PWA files (manifest.webmanifest, sw.js, icons/)
npm run app          # run the desktop app from the source tree
npm run dist:linux   # → release/*.AppImage, release/*.deb
npm run dist:win     # → release/*-setup-x64.exe, release/*-portable-x64.exe
npm run dist:mac     # → release/*.dmg, release/*.zip (x64 + arm64; needs macOS)
npm run dist:all     # all of the above (needs macOS for the mac targets)
```

Build each platform on its own OS. On Linux the Windows *portable* target builds without Wine
(`npx electron-builder --win portable -c.win.signAndEditExecutable=false`), but the NSIS installer needs Wine.
The GitHub Actions workflow `.github/workflows/release.yml` builds all installers on Windows, macOS and Linux
runners. Run it from the Actions tab to get them as build artifacts, or push a tag such as `v1.1.0` to publish
a GitHub Release with every installer and the single-file app attached.

Desktop app sources: `electron/` (main process, preload, user-guide renderer), `server/lan-core.cjs`
(classroom server shared by the CLI and the desktop app), and `build/` (app icon: `icon.svg`, rendered to
PNG by `build/render-icons.mjs`).

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
src/render     map renderer (canvas) and NATO symbols
src/store      IndexedDB / LAN / memory store, PIN & password hashing
src/ui         instructor and student dashboards, exercise flow
server/        optional zero-dependency LAN server
tests/         node:test suites
```

Passwords and PINs only separate roles on a shared training PC. They are not a security boundary, and the
app is not meant for classified data.

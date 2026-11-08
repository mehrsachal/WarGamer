// Generates docs/rules.md: the rules in prose plus every table straight from data/*.json (NFR-09).
//   npm run gen:docs
import { readFileSync, writeFileSync } from 'node:fs';
import { type DataBundle, Ruleset } from '../packages/engine/src/index';

const root = new URL('../', import.meta.url);
const read = (f: string) => JSON.parse(readFileSync(new URL(f, root), 'utf8'));
const d = Ruleset.parse({ terrain: read('data/terrain.json'), edges: read('data/edges.json'), weapons: read('data/weapons.json'), units: read('data/units.json'), sensors: read('data/sensors.json'), rules: read('data/rules.json') } as DataBundle);
const r = d.rules;
const pct = (x: number) => `${Math.round(x * 100)}%`;
const row = (cells: (string | number)[]) => `| ${cells.join(' | ')} |`;
const table = (head: string[], rows: (string | number)[][]) => [row(head), row(head.map(() => '---')), ...rows.map(row)].join('\n');
const mc = (x: number | null) => (x === null ? '—' : String(x));

const md = `# Tactical Hex Trainer — rules

> Generated from \`data/*.json\` by \`npm run gen:docs\`. Edit the data, not this file. All values are generic,
> fictional defaults for the sample data pack; institutions load their own packs (NFR-02).

## Turn sequence (MOV-01)
Sides alternate (IGOUGO). After both sides deploy (each only inside its own zone, hidden from the enemy — SET-04/05),
turn 1 starts with the scenario's first side. At the start of a side's turn its units' move points, shots and
posture reset, suppressed units roll to rally, UAV endurance counts down, and delayed artillery lands. At the end
of a side's turn objective ownership is updated. The game ends after the last turn, or at once when a side falls
below its breaking point.

## Movement (MOV-03/04/05)
Step cost = terrain cost of the hex entered (by mobility class) — or the road cost when a road/track crosses the
shared hex side — + edge modifiers (cancelled by a bridge on the same side) + an uphill slope penalty.
The first **${pct(r.move.tacticalFraction)}** of a unit's move points is the *tactical* band (grey): it may still fire,
with the "moved" shooter penalty. Beyond that the unit *dashes* (green): it cannot fire that turn and is easier to hit.
A unit that has fired may only move within the tactical band. Suppressed units have ×${r.suppression.moveFactor} move points.
Known enemy hexes cannot be entered; moving into a hidden enemy stops the move in contact. At most
${r.stacking.maxUnitsPerHex} ground units may share a hex (UAVs do not count). Mounting costs ${r.move.mountCost} MP;
dismounting uses ${pct(r.move.dismountCostFraction)} of the troops' move allowance.

${table(['Uphill slope ≤', 'foot', 'wheeled', 'tracked'], r.move.slopeBands.map((b) => [`${b.maxPct}%`, mc(b.add.foot), mc(b.add.wheeled), mc(b.add.tracked)]))}

## Line of sight (VIS-01)
The sight line runs from the observer's eye (ground + eye height, or + camera altitude for a UAV) to the target
(ground + target height). Every *intermediate* hex blocks if its ground + obstacle height rises above the line;
the observer's and target's own hexes never block. Edge obstacles (bunds, ridgelines) are tested at the midpoint
between the two hexes they separate, on the higher ground. Lines running exactly along hex edges are tested
with a tiny offset to each side; sight is clear if either side is clear. Viewsheds (VIS-02) use a target height
of ${r.los.hexTargetHeight_m} m.

## Seeing units (VIS-03/04/05)
A side sees an enemy unit if one of its units has LOS and the unit is within the observer's effective range:
sensor range (day / night; dusk at ${pct(r.visibility.duskRange)} between) × weather × (1 − concealment).
Concealment = terrain concealment × unit stealth (capped at 95%), ×${r.visibility.movingConcealment} if the target moved, and
${r.visibility.firingReveals ? 'zero if it fired in its last turn' : 'unchanged by firing'}. Units within ${r.visibility.autoSpotRange} hex are seen
whenever LOS is clear. Enemies you cannot currently see are shown as faded ghosts at their last known position.

${table(['Weather', 'Observation range ×', 'Hit chance ×'], (['clear', 'dust', 'rain', 'fog', 'snow'] as const).map((w) => [w, r.visibility.weatherRange[w], r.hit.weather[w]]))}

## Fire (CBT-01..05)
Direct fire needs LOS, a spotted target and range. Each unit may make ${r.fire.shotsPerTurn} fire action(s) per turn.

**P(hit) = clamp( B_weapon(range band, target class) × C_terrain × M_posture × M_shooter × M_env , ${pct(r.hit.min)}, ${pct(r.hit.max)} )**

- M_posture (target): static ${r.hit.targetPosture.static}, moved ${r.hit.targetPosture.moved}, dashed ${r.hit.targetPosture.dashed}
- M_shooter: static ${r.hit.shooter.static}, moved ${r.hit.shooter.moved} (suppressed or dashed units cannot fire)
- M_env = light × weather; light: day ${r.hit.light.day}, dusk ${r.hit.light.dusk}, night ${r.hit.light.night} (${r.hit.light.nightThermal} with a thermal sight)

On a hit, a second roll against the weapon's lethality for the target class decides between a step loss (the
unit is also suppressed) and suppression only. Against a target that is already suppressed lethality is increased
by ${pct(r.suppression.repeatHitLethality)}. Units are eliminated at 0 steps; passengers of a destroyed vehicle bail out
suppressed and lose a step on ${pct(r.passengers.lossChanceOnVehicleKill)}. A weapon with 0% against a target class cannot be fired at it.

**Rally (CBT-04):** chance = ${pct(r.suppression.recoveryChance)} + ${pct(r.suppression.coverBonus)} × (1 − cover).

## Indirect fire (FS-01..03)
Mortars fire at any hex in range that ${r.indirect.requireObserver ? 'one of your units can see (observer rule)' : 'is in range'};
they must not have moved that turn. Off-map artillery has limited missions, becomes available from a set turn and
lands immediately or 1–2 turns later. Indirect fire attacks every unit in the impact hex — both sides — and, if
the weapon has an area effect, the adjacent hexes at reduced effect. Base chance uses the weapon's band against
the target class, × cover × posture × M_env.

## Objectives and victory (VIC-01..03)
An objective changes hands when only one side's ground-holding units occupy it (UAVs cannot hold ground). At the
end the side owning the greater objective value wins (the scenario names the winner of a tie). Score =
objectives × ${r.scoring.objectiveWeight} + enemy steps destroyed × ${r.scoring.killWeightPerStep} − own steps lost × ${r.scoring.lossWeightPerStep}.

## Determinism (CBT-07, NFR-05)
Every random draw is a function of the game seed and a draw counter and is stored in the event that used it.
Replaying the event log re-runs the same rules with the recorded draws and must reproduce every result; logs whose
draws do not match the seed are refused.

## Terrain (MAP-03)
${table(['Terrain', 'Cover ×', 'Concealment', 'Move foot', 'wheeled', 'tracked', 'LOS height'], d.lists.terrain.map((x) => [x.name, x.cover, pct(x.concealment), mc(x.moveCost.foot), mc(x.moveCost.wheeled), mc(x.moveCost.tracked), `${x.losHeight_m} m`]))}

## Hex-side features (MAP-04)
${table(['Feature', 'Crossable by', 'Modifier foot/wheeled/tracked', 'Road cost', 'Blocks LOS'], d.lists.edges.map((e) => [e.name, e.crossableBy.join(', ') || 'none', `${mc(e.moveCostModifier.foot)} / ${mc(e.moveCostModifier.wheeled)} / ${mc(e.moveCostModifier.tracked)}`, e.roadCost ? `${e.roadCost.foot}/${e.roadCost.wheeled}/${e.roadCost.tracked}` : e.providesCrossing ? 'crossing' : '', e.blocksLOS ? `yes (${e.losHeight_m} m)` : 'no']))}

## Sensors (VIS-05)
${table(['Sensor', 'Day range', 'Night range', 'Altitude', 'Concealment ×', 'Thermal'], d.lists.sensors.map((s) => [s.name, s.dayRange, s.nightRange, `${s.altitude_m} m`, s.concealmentFactor, s.thermal ? 'yes' : '']))}

## Weapons (UNIT-03)
${table(['Weapon', 'Range', 'Hit % soft / hard / air by band (≤ hexes)', 'Lethality soft/hard', 'Ammo', 'Notes'], d.lists.weapons.map((w) => [w.name, `${w.minRange}–${w.maxRange}`, w.rangeBands.map((b) => `≤${b.toHex}: ${pct(b.softHit)}/${pct(b.hardHit)}/${pct(b.airHit)}`).join('; '), `${pct(w.lethality.soft)}/${pct(w.lethality.hard)}`, w.ammo === 'unlimited' ? '∞' : w.ammo, [w.indirect ? 'indirect' : '', w.requiresStatic ? 'static only' : '', w.areaEffect.adjacent ? `adjacent ×${w.areaEffect.adjacent}` : '', w.offMap ? 'off-map' : ''].filter(Boolean).join(', ')]))}

## Units (UNIT-02)
${table(['Unit', 'Mobility', 'MP', 'Steps', 'Crew', 'Weapons', 'Sensors', 'Carries', 'Target'], d.lists.units.map((u) => [u.name, u.mobilityClass, u.movePoints, u.steps, u.crew, u.weapons.map((w) => d.weapon(w).name).join(', '), u.sensors.join(', '), u.transportCapacity || '', u.targetClass]))}
`;
writeFileSync(new URL('docs/rules.md', root), md);
console.log('wrote docs/rules.md');

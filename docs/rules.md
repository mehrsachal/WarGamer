# Tactical Hex Trainer — rules

> Generated from `data/*.json` by `npm run gen:docs`. Edit the data, not this file. All values are generic,
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
The first **50%** of a unit's move points is the *tactical* band (grey): it may still fire,
with the "moved" shooter penalty. Beyond that the unit *dashes* (green): it cannot fire that turn and is easier to hit.
A unit that has fired may only move within the tactical band. Suppressed units have ×0.5 move points.
Known enemy hexes cannot be entered; moving into a hidden enemy stops the move in contact. At most
3 ground units may share a hex (UAVs do not count). Mounting costs 2 MP;
dismounting uses 100% of the troops' move allowance.

| Uphill slope ≤ | foot | wheeled | tracked |
| --- | --- | --- | --- |
| 4% | 0 | 0 | 0 |
| 10% | 0.5 | 1 | 0.5 |
| 20% | 1 | 2.5 | 1.5 |
| 35% | 2 | — | 3 |
| 1000% | 3 | — | — |

## Line of sight (VIS-01)
The sight line runs from the observer's eye (ground + eye height, or + camera altitude for a UAV) to the target
(ground + target height). Every *intermediate* hex blocks if its ground + obstacle height rises above the line;
the observer's and target's own hexes never block. Edge obstacles (bunds, ridgelines) are tested at the midpoint
between the two hexes they separate, on the higher ground. Lines running exactly along hex edges are tested
with a tiny offset to each side; sight is clear if either side is clear. Viewsheds (VIS-02) use a target height
of 1 m.

## Seeing units (VIS-03/04/05)
A side sees an enemy unit if one of its units has LOS and the unit is within the observer's effective range:
sensor range (day / night; dusk at 50% between) × weather × (1 − concealment).
Concealment = terrain concealment × unit stealth (capped at 95%), ×0.4 if the target moved, and
zero if it fired in its last turn. Units within 1 hex are seen
whenever LOS is clear. Enemies you cannot currently see are shown as faded ghosts at their last known position.

| Weather | Observation range × | Hit chance × |
| --- | --- | --- |
| clear | 1 | 1 |
| dust | 0.6 | 0.8 |
| rain | 0.8 | 0.85 |
| fog | 0.35 | 0.6 |
| snow | 0.7 | 0.8 |

## Fire (CBT-01..05)
Direct fire needs LOS, a spotted target and range. Each unit may make 1 fire action(s) per turn.

**P(hit) = clamp( B_weapon(range band, target class) × C_terrain × M_posture × M_shooter × M_env , 1%, 95% )**

- M_posture (target): static 1, moved 1.15, dashed 1.35
- M_shooter: static 1, moved 0.65 (suppressed or dashed units cannot fire)
- M_env = light × weather; light: day 1, dusk 0.8, night 0.5 (0.9 with a thermal sight)

On a hit, a second roll against the weapon's lethality for the target class decides between a step loss (the
unit is also suppressed) and suppression only. Against a target that is already suppressed lethality is increased
by 30%. Units are eliminated at 0 steps; passengers of a destroyed vehicle bail out
suppressed and lose a step on 50%. A weapon with 0% against a target class cannot be fired at it.

**Rally (CBT-04):** chance = 45% + 30% × (1 − cover).

## Indirect fire (FS-01..03)
Mortars fire at any hex in range that one of your units can see (observer rule);
they must not have moved that turn. Off-map artillery has limited missions, becomes available from a set turn and
lands immediately or 1–2 turns later. Indirect fire attacks every unit in the impact hex — both sides — and, if
the weapon has an area effect, the adjacent hexes at reduced effect. Base chance uses the weapon's band against
the target class, × cover × posture × M_env.

## Objectives and victory (VIC-01..03)
An objective changes hands when only one side's ground-holding units occupy it (UAVs cannot hold ground). At the
end the side owning the greater objective value wins (the scenario names the winner of a tie). Score =
objectives × 1 + enemy steps destroyed × 1 − own steps lost × 1.

## Determinism (CBT-07, NFR-05)
Every random draw is a function of the game seed and a draw counter and is stored in the event that used it.
Replaying the event log re-runs the same rules with the recorded draws and must reproduce every result; logs whose
draws do not match the seed are refused.

## Terrain (MAP-03)
| Terrain | Cover × | Concealment | Move foot | wheeled | tracked | LOS height |
| --- | --- | --- | --- | --- | --- | --- |
| Open ground | 1 | 20% | 1 | 1 | 1 | 0 m |
| Crops (seasonal) | 0.95 | 60% | 1.2 | 1.5 | 1.2 | 1.5 m |
| Scrub | 0.85 | 55% | 1.5 | 2 | 1.5 | 1.5 m |
| Orchard | 0.75 | 70% | 1.5 | 3 | 2 | 5 m |
| Woods | 0.6 | 85% | 2 | — | 3 | 12 m |
| Built-up area | 0.45 | 85% | 1.5 | 1.5 | 2 | 10 m |
| Village (kacha houses) | 0.55 | 75% | 1.5 | 2 | 2 | 4 m |
| Rocky ground | 0.7 | 50% | 2 | 4 | 3 | 1 m |
| Scree | 0.8 | 30% | 3 | — | 5 | 0.5 m |
| Snow | 1 | 10% | 2 | 3 | 2 | 0 m |
| Marsh | 0.9 | 40% | 3 | — | 6 | 1 m |
| Sand dunes | 0.85 | 45% | 2 | 4 | 2.5 | 3 m |

## Hex-side features (MAP-04)
| Feature | Crossable by | Modifier foot/wheeled/tracked | Road cost | Blocks LOS |
| --- | --- | --- | --- | --- |
| Metalled road | foot, wheeled, tracked | 0 / 0 / 0 | 0.75/0.4/0.6 | no |
| Unmetalled track | foot, wheeled, tracked | 0 / 0 / 0 | 0.85/0.7/0.8 | no |
| Canal | foot | 3 / — / — |  | no |
| Distributary | foot, tracked | 1 / — / 2 |  | no |
| River | none | — / — / — |  | no |
| Dry nullah | foot, wheeled, tracked | 1 / 3 / 1.5 |  | no |
| Bund / embankment | foot, wheeled, tracked | 0.5 / 2 / 1 |  | yes (2.5 m) |
| Ridgeline (crest) | foot, wheeled, tracked | 0 / 0 / 0 |  | yes (1 m) |
| Bridge | foot, wheeled, tracked | 0 / 0 / 0 | crossing | no |

## Sensors (VIS-05)
| Sensor | Day range | Night range | Altitude | Concealment × | Thermal |
| --- | --- | --- | --- | --- | --- |
| Unaided eye | 12 | 2 | 0 m | 1 |  |
| Binoculars | 20 | 3 | 0 m | 1 |  |
| Night vision goggles | 12 | 6 | 0 m | 1 |  |
| Thermal sight | 25 | 20 | 0 m | 0.6 | yes |
| UAV camera (EO/IR) | 18 | 12 | 150 m | 0.8 | yes |

## Weapons (UNIT-03)
| Weapon | Range | Hit % soft / hard / air by band (≤ hexes) | Lethality soft/hard | Ammo | Notes |
| --- | --- | --- | --- | --- | --- |
| Section small arms (rifles + LMG) | 0–5 | ≤1: 55%/0%/10%; ≤2: 42%/0%/7%; ≤3: 30%/0%/4%; ≤4: 20%/0%/0%; ≤5: 12%/0%/0% | 35%/0% | ∞ |  |
| Team small arms | 0–4 | ≤1: 45%/0%/7%; ≤2: 33%/0%/5%; ≤3: 22%/0%/2%; ≤4: 12%/0%/0% | 30%/0% | ∞ |  |
| Light machine gun | 0–6 | ≤1: 50%/0%/8%; ≤2: 40%/0%/6%; ≤4: 26%/0%/3%; ≤6: 14%/0%/0% | 35%/0% | ∞ |  |
| Medium machine gun (7.62 mm GPMG) | 0–8 | ≤1: 58%/0%/10%; ≤3: 45%/0%/8%; ≤5: 32%/0%/5%; ≤8: 18%/0%/0% | 40%/0% | ∞ |  |
| Heavy machine gun (12.7 mm) | 0–12 | ≤2: 55%/15%/20%; ≤5: 42%/8%/15%; ≤8: 30%/4%/10%; ≤12: 16%/0%/5% | 45%/20% | ∞ |  |
| Sniper rifle | 0–8 | ≤2: 65%/0%/0%; ≤5: 50%/0%/0%; ≤8: 35%/0%/0% | 60%/0% | ∞ |  |
| RPG (unguided rocket launcher) | 0–3 | ≤1: 35%/55%/0%; ≤2: 28%/42%/0%; ≤3: 22%/28%/0% | 35%/55% | 6 |  |
| Recoilless rifle | 0–7 | ≤2: 30%/60%/0%; ≤4: 26%/48%/0%; ≤7: 20%/32%/0% | 40%/60% | 8 | static only |
| ATGM (2nd-generation, wire-guided) | 2–30 | ≤5: 30%/70%/0%; ≤15: 30%/75%/0%; ≤25: 25%/70%/0%; ≤30: 20%/60%/0% | 50%/75% | 4 | static only |
| 30 mm autocannon | 0–20 | ≤5: 50%/35%/30%; ≤10: 38%/25%/22%; ≤20: 22%/12%/10% | 50%/35% | ∞ |  |
| Tank main gun (125 mm) | 0–30 | ≤10: 45%/70%/0%; ≤20: 32%/55%/0%; ≤30: 20%/40%/0% | 55%/70% | 30 |  |
| 60 mm mortar | 1–15 | ≤15: 32%/3%/0% | 45%/10% | 20 | indirect, static only |
| 81 mm mortar | 2–45 | ≤45: 40%/6%/0% | 55%/15% | 16 | indirect, static only, adjacent ×0.25 |
| 120 mm mortar | 4–70 | ≤70: 50%/10%/0% | 65%/25% | 12 | indirect, static only, adjacent ×0.35 |
| 155 mm howitzer battery (off-map) | 0–999 | ≤999: 55%/15%/0% | 70%/40% | ∞ | indirect, adjacent ×0.35, off-map |
| 122 mm howitzer battery (off-map) | 0–999 | ≤999: 50%/12%/0% | 65%/35% | ∞ | indirect, adjacent ×0.3, off-map |

## Units (UNIT-02)
| Unit | Mobility | MP | Steps | Crew | Weapons | Sensors | Carries | Target |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Rifle section | foot | 6 | 3 | 9 | Section small arms (rifles + LMG), RPG (unguided rocket launcher) | eye, binos |  | soft |
| Fire team | foot | 6 | 2 | 4 | Team small arms | eye |  | soft |
| LMG team | foot | 6 | 2 | 2 | Light machine gun | eye |  | soft |
| MMG team | foot | 5 | 2 | 3 | Medium machine gun (7.62 mm GPMG) | eye, binos |  | soft |
| HMG team | foot | 4 | 2 | 3 | Heavy machine gun (12.7 mm) | eye, binos |  | soft |
| ATGM team | foot | 4 | 2 | 3 | ATGM (2nd-generation, wire-guided) | eye, thermal |  | soft |
| RCL team | foot | 4 | 2 | 3 | Recoilless rifle | eye, binos |  | soft |
| RPG team | foot | 6 | 2 | 3 | RPG (unguided rocket launcher), Team small arms | eye |  | soft |
| 60 mm mortar section | foot | 4 | 2 | 4 | 60 mm mortar | eye |  | soft |
| 81 mm mortar section | foot | 3 | 2 | 6 | 81 mm mortar | eye |  | soft |
| 120 mm mortar section (towed) | wheeled | 8 | 2 | 6 | 120 mm mortar | eye |  | soft |
| Sniper team | foot | 6 | 1 | 2 | Sniper rifle | eye, binos |  | soft |
| Engineer section | foot | 5 | 3 | 9 | Section small arms (rifles + LMG) | eye |  | soft |
| Recce team | foot | 7 | 2 | 4 | Team small arms | eye, binos, thermal |  | soft |
| Mini UAV | air | 20 | 1 | 0 |  | uav_cam |  | air |
| Jeep (MG) | wheeled | 14 | 1 | 3 | Medium machine gun (7.62 mm GPMG) | eye, binos | 1 | soft |
| APC | tracked | 12 | 2 | 3 | Heavy machine gun (12.7 mm) | eye, binos | 2 | hard |
| IFV | tracked | 12 | 2 | 3 | 30 mm autocannon, Medium machine gun (7.62 mm GPMG) | eye, thermal | 1 | hard |
| Main battle tank | tracked | 10 | 3 | 3 | Tank main gun (125 mm), Medium machine gun (7.62 mm GPMG) | eye, thermal |  | hard |
| Company HQ (dismounted) | foot | 6 | 2 | 8 | Team small arms | eye, binos |  | soft |

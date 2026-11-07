// Builds the sample scenarios in scenarios/ from the sample map (deterministic). Instructors normally edit the
// JSON or use the scenario editor (Phase 3); this script only keeps the samples in sync with maps/ridgeline.json.
//   npx tsx tools/make-scenarios.ts
import { readFileSync, writeFileSync } from 'node:fs';
import { type GameMap, type Hex, type Scenario, axialToOffset, hexToPoint, offsetToAxial } from '../packages/engine/src/index';

const root = new URL('../', import.meta.url);
const map: GameMap = JSON.parse(readFileSync(new URL('maps/ridgeline.json', root), 'utf8'));
const at = (col: number, row: number): Hex => offsetToAxial(col, row, 'flat');
const cells = map.hexes;
const off = (h: Hex) => axialToOffset(h, 'flat');

// canal: the hexes whose south (dir 5) or south-east/west edges carry the canal mark the northern bank
const bankRow = new Map<number, number>();
for (const h of cells) {
  for (const [d, fs] of Object.entries(h.edges)) {
    if (!fs.includes('canal')) continue;
    const o = off(h);
    const north = ['5', '0', '4'].includes(d) ? o.row : o.row - 1; // edge stored on either hex
    bankRow.set(o.col, Math.max(bankRow.get(o.col) ?? 0, north));
  }
}
const northOfCanal = (h: Hex) => off(h).row <= (bankRow.get(off(h).col) ?? 18) - 1;
const zone = (pred: (h: Hex) => boolean) => cells.filter(pred).map((h) => ({ q: h.q, r: h.r }));
const byLabel = (text: string) => {
  const l = map.labels.find((x) => x.text.startsWith(text))!;
  return { q: l.q, r: l.r };
};
// the hex at the north end of the main road bridge
let bridgeNorth: Hex = at(22, 17);
for (const h of cells) for (const [d, fs] of Object.entries(h.edges)) if (fs.includes('bridge') && fs.includes('road')) {
  const p = hexToPoint(h, 'flat', 100);
  void d;
  const o = off(h);
  bridgeNorth = northOfCanal(h) ? h : at(o.col, o.row - 1);
  void p;
}

const blueZone = zone((h) => off(h).row >= 27);
const BLUE_NAMES = [] as string[];
void BLUE_NAMES;
const place = (col: number, row: number) => at(col, row);

const briefing = {
  situation:
    'Red Land forces have occupied the ridge north of the Lower Jhelum Canal with an infantry company (-) reinforced with an IFV, machine guns and anti-tank weapons. Their positions are dug in on Pt 252 and around the village of Kotli Sharif. A small outpost watches the main road bridge over the canal. Red is expected to defend in place and counter-attack locally. Red artillery (122 mm) is likely to be available from about turn 3.',
  mission: 'A Coy (reinforced) is to capture Kotli Sharif and Pt 252 by the end of turn 16, in order to secure the line of the ridge for the battalion advance.',
  forces:
    'Own: A Coy — Coy HQ, 1 Pl and 2 Pl (three rifle sections each), 3 Pl (mechanised: two sections in APCs), MMG and ATGM teams, 60 mm and 81 mm mortar sections, sniper and recce teams, a mini UAV and a troop of two tanks. In support: one 155 mm battery, 4 missions from turn 2 (one-turn delay). Enemy: infantry company (-) with an IFV, MMGs, HMG, ATGM, RCL and RPG teams and an 81 mm mortar section, supported by a 122 mm battery.',
  time: '16 turns of about 4 minutes each, by day, weather clear. Blue moves first.',
  victory:
    'Objectives: Kotli Sharif (5 VP), Pt 252 (3 VP), Canal bridge (1 VP) — all held by Red at the start. At the end of turn 16 the side holding the greater objective value wins (Red wins a tie). Red wins at once if A Coy falls below 35 % of its strength; A Coy wins at once if Red falls below 30 %.',
  lessons: ['Use the woods south of the ridge as a covered approach', 'Suppress before you move: fire and manoeuvre', 'Do not let vehicles cross open ground in view of ATGMs', 'Use the observer rule: mortars and guns need eyes on the target', 'Reverse slopes protect the defender from long-range fire'],
};

const coyAttack: Scenario = {
  id: 'ridgeline-coy-attack',
  title: 'Op RIDGELINE — company attack (sample)',
  mapId: 'ridgeline',
  turns: 16,
  minutesPerTurn: 4,
  weather: 'clear',
  timeOfDay: 'day',
  firstSide: 'blue',
  briefing,
  sides: {
    blue: {
      name: 'A Coy (Blue)',
      briefing: 'You command A Coy. Read the situation, decide your scheme of manoeuvre, deploy in the assembly area (south) and attack.',
      deploymentZone: blueZone,
      orbat: [
        { id: 'a-hq', typeId: 'coy_hq', name: 'A Coy HQ', hex: place(22, 29) },
        { id: 'a1-1', typeId: 'rifle_section', name: '1 Pl / 1 Sec', hex: place(14, 28) },
        { id: 'a1-2', typeId: 'rifle_section', name: '1 Pl / 2 Sec', hex: place(15, 28) },
        { id: 'a1-3', typeId: 'rifle_section', name: '1 Pl / 3 Sec', hex: place(16, 28) },
        { id: 'a2-1', typeId: 'rifle_section', name: '2 Pl / 1 Sec', hex: place(26, 28) },
        { id: 'a2-2', typeId: 'rifle_section', name: '2 Pl / 2 Sec', hex: place(27, 28) },
        { id: 'a2-3', typeId: 'rifle_section', name: '2 Pl / 3 Sec', hex: place(28, 28) },
        { id: 'a3-v1', typeId: 'apc', name: '3 Pl / APC 1', hex: place(20, 28) },
        { id: 'a3-v2', typeId: 'apc', name: '3 Pl / APC 2', hex: place(21, 28) },
        { id: 'a3-1', typeId: 'rifle_section', name: '3 Pl / 1 Sec', mountedIn: 'a3-v1' },
        { id: 'a3-2', typeId: 'rifle_section', name: '3 Pl / 2 Sec', mountedIn: 'a3-v2' },
        { id: 'a-mmg', typeId: 'mmg_team', name: 'MMG Det', hex: place(18, 28) },
        { id: 'a-atgm', typeId: 'atgm_team', name: 'ATGM Det', hex: place(24, 28) },
        { id: 'a-m60', typeId: 'mortar60_sec', name: '60 mm Mor', hex: place(19, 30) },
        { id: 'a-m81', typeId: 'mortar81_sec', name: '81 mm Mor', hex: place(23, 30) },
        { id: 'a-snp', typeId: 'sniper_team', name: 'Sniper', hex: place(12, 27) },
        { id: 'a-rec', typeId: 'recce_team', name: 'Recce Det', hex: place(30, 27) },
        { id: 'a-uav', typeId: 'uav_mini', name: 'Mini UAV', hex: place(22, 30) },
        { id: 'a-tk1', typeId: 'tank', name: 'Tk Tp / Tk 1', hex: place(17, 29) },
        { id: 'a-tk2', typeId: 'tank', name: 'Tk Tp / Tk 2', hex: place(25, 29) },
      ],
      fireSupport: [{ id: 'bty155', name: '155 mm battery (DS)', weaponId: 'how155', missions: 4, fromTurn: 2, delay: 1 }],
    },
    red: {
      name: 'Red Coy (-)',
      briefing: 'You hold the ridge. Keep Kotli Sharif and Pt 252 until the end of turn 16. Use reverse slopes, hold fire until the enemy is close, and reinforce threatened positions.',
      deploymentZone: zone(northOfCanal).concat(zone((h) => Math.abs(h.q - bridgeNorth.q) + Math.abs(h.r - bridgeNorth.r) <= 0)),
      orbat: [
        { id: 'r-hq', typeId: 'coy_hq', name: 'Red Coy HQ' },
        { id: 'r-1', typeId: 'rifle_section', name: 'Red 1 Sec' },
        { id: 'r-2', typeId: 'rifle_section', name: 'Red 2 Sec' },
        { id: 'r-3', typeId: 'rifle_section', name: 'Red 3 Sec' },
        { id: 'r-5', typeId: 'fire_team', name: 'Red Outpost' },
        { id: 'r-mmg1', typeId: 'mmg_team', name: 'Red MMG 1' },
        { id: 'r-mmg2', typeId: 'mmg_team', name: 'Red MMG 2' },
        { id: 'r-hmg', typeId: 'hmg_team', name: 'Red HMG' },
        { id: 'r-atgm', typeId: 'atgm_team', name: 'Red ATGM' },
        { id: 'r-rcl', typeId: 'rcl_team', name: 'Red RCL' },
        { id: 'r-rpg', typeId: 'rpg_team', name: 'Red RPG' },
        { id: 'r-m81', typeId: 'mortar81_sec', name: 'Red 81 mm Mor' },
        { id: 'r-ifv', typeId: 'ifv', name: 'Red IFV' },
      ],
      fireSupport: [{ id: 'bty122', name: '122 mm battery', weaponId: 'how122', missions: 3, fromTurn: 3, delay: 0 }],
    },
  },
  objectives: [
    { id: 'obj-kotli', name: 'Kotli Sharif', hex: byLabel('KOTLI'), value: 5, initialOwner: 'red' },
    { id: 'obj-pt', name: map.labels.find((l) => l.kind === 'height')!.text, hex: byLabel('Pt '), value: 3, initialOwner: 'red' },
    { id: 'obj-bridge', name: 'Canal bridge', hex: { q: bridgeNorth.q, r: bridgeNorth.r }, value: 1, initialOwner: 'red' },
  ],
  victoryRules: { objectiveMajority: true, attritionWinBelowPct: { blue: 0.35, red: 0.3 }, tieWinner: 'red', suddenDeathAllObjectives: false },
  ai: { side: 'red', posture: 'defend' },
  reinforcements: [],
  classification: 'UNCLASSIFIED — FICTIONAL SAMPLE',
};

// a short platoon-level skirmish on the same map: seize the canal bridge
const bridgeRaid: Scenario = {
  ...coyAttack,
  id: 'canal-bridge-raid',
  title: 'Canal bridge — platoon attack (short sample)',
  turns: 10,
  briefing: {
    situation: 'A Red section with a machine gun holds the main road bridge over the Lower Jhelum Canal as an outpost for the company on the ridge.',
    mission: '1 Pl is to seize the canal bridge by the end of turn 10.',
    forces: 'Own: 1 Pl — three rifle sections, an MMG team and the 60 mm mortar section; one 155 mm mission from turn 2. Enemy: a rifle section, a fire team and an MMG team near the bridge, with an 81 mm mortar behind the ridge.',
    time: '10 turns, by day, weather clear. Blue moves first.',
    victory: 'Hold the Canal bridge (1 VP) at the end of turn 10. Red wins a tie. Red wins at once if 1 Pl falls below 35 % strength; Blue wins at once if Red falls below 25 %.',
    lessons: ['Fix with fire, move with cover', 'Use the mortar on what you can see'],
  },
  sides: {
    blue: {
      name: '1 Pl (Blue)',
      briefing: 'You command 1 Pl. Seize the bridge.',
      deploymentZone: zone((h) => off(h).row >= 25 && off(h).col >= 14 && off(h).col <= 30),
      orbat: [
        { id: 'p1-1', typeId: 'rifle_section', name: '1 Sec', hex: place(19, 26) },
        { id: 'p1-2', typeId: 'rifle_section', name: '2 Sec', hex: place(22, 26) },
        { id: 'p1-3', typeId: 'rifle_section', name: '3 Sec', hex: place(25, 26) },
        { id: 'p1-mmg', typeId: 'mmg_team', name: 'MMG', hex: place(21, 27) },
        { id: 'p1-m60', typeId: 'mortar60_sec', name: '60 mm Mor', hex: place(22, 28) },
      ],
      fireSupport: [{ id: 'bty155', name: '155 mm battery', weaponId: 'how155', missions: 1, fromTurn: 2, delay: 1 }],
    },
    red: {
      name: 'Red outpost',
      briefing: 'Hold the bridge.',
      deploymentZone: zone((h) => northOfCanal(h) && Math.abs(h.q - bridgeNorth.q) <= 5 && off(h).row >= off(bridgeNorth).row - 5),
      orbat: [
        { id: 'o-1', typeId: 'rifle_section', name: 'Red Sec' },
        { id: 'o-2', typeId: 'fire_team', name: 'Red FT' },
        { id: 'o-mmg', typeId: 'mmg_team', name: 'Red MMG' },
        { id: 'o-m81', typeId: 'mortar81_sec', name: 'Red 81 mm Mor', hex: { q: bridgeNorth.q + 1, r: bridgeNorth.r - 5 } },
      ],
      fireSupport: [],
    },
  },
  objectives: [{ id: 'obj-bridge', name: 'Canal bridge', hex: { q: bridgeNorth.q, r: bridgeNorth.r }, value: 1, initialOwner: 'red' }],
};
bridgeRaid.sides.red.deploymentZone.push({ q: bridgeRaid.sides.red.orbat[3].hex!.q, r: bridgeRaid.sides.red.orbat[3].hex!.r });

for (const s of [coyAttack, bridgeRaid]) {
  writeFileSync(new URL(`scenarios/${s.id}.json`, root), JSON.stringify(s, null, 1));
  console.log(s.id, 'blue zone', s.sides.blue.deploymentZone.length, 'red zone', s.sides.red.deploymentZone.length, 'objectives', s.objectives.map((o) => `${o.name}@${o.hex.q},${o.hex.r}`).join(' '));
}

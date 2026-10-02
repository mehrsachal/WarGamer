// Weapon and unit templates for Blueland (own, BLUE) and Foxland (enemy, RED).
// Unit symbols are NATO APP-6 / MIL-STD-2525 SIDCs rendered by milsymbol.

import type { Echelon, Side } from './types';

export type WeaponKey =
  | 'RIFLE'
  | 'LMG'
  | 'MG'
  | 'GLHMG'
  | 'RL'
  | 'RR106'
  | 'BS'
  | 'MOR60'
  | 'MOR81'
  | 'EN_RIFLE'
  | 'EN_LMG'
  | 'EN_MMG'
  | 'EN_RL'
  | 'EN_AGL'
  | 'EN_ATGM'
  | 'TK_GUN'
  | 'TK_MG';

export interface WeaponDef {
  key: WeaponKey;
  name: string;
  /** Maximum effective range (m). */
  range: number;
  minRange?: number;
  /** Expected casualties per weapon-minute vs troops moving in the open, by day, at effective range. */
  ap: number;
  /** Probability per minute of killing a tank in range (anti-armour weapons only). */
  at: number;
  /** Indirect fire weapon (needs an observer or a pre-recorded DF). */
  indirect?: boolean;
  /** Long-range weapon that opens fire early under the fire plan. */
  longRange?: boolean;
  /** Fire signature: how much firing reveals the position (0..1). */
  signature: number;
}

export const WEAPONS: Record<WeaponKey, WeaponDef> = {
  RIFLE: { key: 'RIFLE', name: 'Rifle G3', range: 400, ap: 0.012, at: 0, signature: 0.2 },
  LMG: { key: 'LMG', name: 'LMG MG1A3', range: 600, ap: 0.09, at: 0, signature: 0.5 },
  MG: { key: 'MG', name: 'MG1A3 (tripod)', range: 1100, ap: 0.16, at: 0, longRange: true, signature: 0.7 },
  GLHMG: { key: 'GLHMG', name: '40mm GLHMG', range: 1750, ap: 0.22, at: 0.01, longRange: true, signature: 0.8 },
  RL: { key: 'RL', name: 'RL (RPG-7)', range: 300, ap: 0.02, at: 0.16, signature: 0.6 },
  RR106: { key: 'RR106', name: '106mm RR', range: 1200, ap: 0.05, at: 0.24, longRange: true, signature: 1 },
  BS: { key: 'BS', name: 'Bakhtar Shikan ATGM', range: 3000, minRange: 100, ap: 0.01, at: 0.38, longRange: true, signature: 0.9 },
  MOR60: { key: 'MOR60', name: '60mm mor', range: 1800, ap: 0.18, at: 0, indirect: true, signature: 0.3 },
  MOR81: { key: 'MOR81', name: '81mm mor', range: 5000, ap: 0.35, at: 0, indirect: true, signature: 0.3 },
  EN_RIFLE: { key: 'EN_RIFLE', name: 'Rifle INSAS', range: 400, ap: 0.011, at: 0, signature: 0.2 },
  EN_LMG: { key: 'EN_LMG', name: 'LMG', range: 600, ap: 0.085, at: 0, signature: 0.5 },
  EN_MMG: { key: 'EN_MMG', name: 'MMG', range: 1100, ap: 0.15, at: 0, longRange: true, signature: 0.7 },
  EN_RL: { key: 'EN_RL', name: '84mm RL', range: 400, ap: 0.03, at: 0.12, signature: 0.6 },
  EN_AGL: { key: 'EN_AGL', name: '30mm AGL', range: 1500, ap: 0.18, at: 0, longRange: true, signature: 0.8 },
  EN_ATGM: { key: 'EN_ATGM', name: 'ATGM (Milan)', range: 2000, minRange: 200, ap: 0.03, at: 0.3, longRange: true, signature: 0.9 },
  TK_GUN: { key: 'TK_GUN', name: '125mm tank gun', range: 2500, ap: 0.12, at: 0.25, longRange: true, signature: 1 },
  TK_MG: { key: 'TK_MG', name: 'Tank coax/MG', range: 1100, ap: 0.12, at: 0, longRange: true, signature: 0.6 },
};

export type UnitKind = 'INF' | 'ARMOUR' | 'AT' | 'MG' | 'MORTAR' | 'OBS' | 'HQ' | 'ENGR' | 'UAS' | 'RECCE' | 'MED';

export interface UnitTemplate {
  key: string;
  side: Side;
  name: string;
  short: string;
  sidc: string;
  echelon: Echelon;
  kind: UnitKind;
  personnel: number;
  vehicles?: number;
  weapons: Partial<Record<WeaponKey, number>>;
  /** Number of sub-elements (sections of a platoon, platoons of a coy, coys of a bn). */
  elements?: number;
  elementName?: string;
  /** Foot / vehicle speed in kph (cross-country, day). */
  speed: number;
  tracked?: boolean;
  /** Observation: daylight detection range (m) and whether equipped with NVDs. */
  obsRange: number;
  nvd: boolean;
  /** Footprint radius (m) when in position. */
  radius: number;
  description: string;
}

const T = (t: UnitTemplate) => t;

export const TEMPLATES: Record<string, UnitTemplate> = {
  // ------------------------------------------------------------ BLUE (own)
  RIFLE_SEC: T({ key: 'RIFLE_SEC', side: 'BLUE', name: 'Rifle Section', short: 'Sec', sidc: 'SFGPUCI----C---', echelon: 'SEC', kind: 'INF', personnel: 10, weapons: { RIFLE: 8, LMG: 2 }, speed: 4, obsRange: 1500, nvd: true, radius: 40, description: 'Hav + Nk + 8 sepoys, 2 x LMG. Used for standing patrols, screens and spoiling attacks.' }),
  RIFLE_PL: T({ key: 'RIFLE_PL', side: 'BLUE', name: 'Rifle Platoon', short: 'Pl', sidc: 'SFGPUCI----D---', echelon: 'PL', kind: 'INF', personnel: 35, weapons: { RIFLE: 25, LMG: 6, MG: 1, RL: 2 }, elements: 3, elementName: 'Sec', speed: 4, obsRange: 1500, nvd: true, radius: 120, description: '3 rifle secs (2 x LMG each), Pl HQ with 2 x RL; 1 x MG1A3 tripod per pl.' }),
  SCREEN_PL: T({ key: 'SCREEN_PL', side: 'BLUE', name: 'Screen Pl', short: 'Scn', sidc: 'SFGPUCI----D---', echelon: 'PL', kind: 'INF', personnel: 35, weapons: { RIFLE: 25, LMG: 6, MG: 1, RL: 2 }, elements: 3, elementName: 'Sec', speed: 4, obsRange: 2000, nvd: true, radius: 120, description: 'Pl size screen (ex depth coy). Deny close obsn of main posn, provide info, inflict cas; withdraw on orders along covered route (ICIB Sec 73 paras 10-18).' }),
  PL_HQ: T({ key: 'PL_HQ', side: 'BLUE', name: 'Pl HQ', short: 'Pl HQ', sidc: 'SFGPUH-----D---', echelon: 'PL', kind: 'HQ', personnel: 6, weapons: { RIFLE: 4, RL: 2 }, speed: 4, obsRange: 1500, nvd: true, radius: 20, description: 'Pl comd, Pl 2IC (JCO), 2 x RL, wireless operator. Site for control of all secs and easy cas evac / ammo replenishment.' }),
  MG_DET: T({ key: 'MG_DET', side: 'BLUE', name: 'MG Det (tripod)', short: 'MG', sidc: 'SFGPEWRH-------', echelon: 'TEAM', kind: 'MG', personnel: 3, weapons: { MG: 1, RIFLE: 2 }, speed: 4, obsRange: 1500, nvd: true, radius: 10, description: 'MG1A3 on tripod. Site in defilade to cover the most dangerous inf apch; lay on fixed line at night (ICIB Sec 74 para 10a).' }),
  LP: T({ key: 'LP', side: 'BLUE', name: 'Listening Post', short: 'LP', sidc: 'SFGPUCI----A---', echelon: 'TEAM', kind: 'INF', personnel: 3, weapons: { RIFLE: 3 }, speed: 4, obsRange: 600, nvd: true, radius: 15, description: '2-4 men, mounted at night 350-400 m ahead of own posn to give early warning (ICIB Sec 43 para 6).' }),
  CHQ: T({ key: 'CHQ', side: 'BLUE', name: 'Coy HQ / CAP', short: 'CHQ', sidc: 'SFGPUH-----E---', echelon: 'COY', kind: 'HQ', personnel: 20, weapons: { RIFLE: 14 }, speed: 4, obsRange: 800, nvd: false, radius: 60, description: 'Coy HQ incl Coy Aid Post, stretcher bearers, signallers. Normally in line with depth pl, defiladed, near main route.' }),
  CP: T({ key: 'CP', side: 'BLUE', name: 'Command Post', short: 'CP', sidc: 'SFGPUH-----D---', echelon: 'PL', kind: 'HQ', personnel: 5, weapons: { RIFLE: 5 }, speed: 4, obsRange: 2000, nvd: true, radius: 20, description: 'Coy comd battle location in the FDLs, affording best view of defences and approaches.' }),
  RR_DET: T({ key: 'RR_DET', side: 'BLUE', name: '106mm RR Det', short: 'RR', sidc: 'SFGPUCAA---A---', echelon: 'TEAM', kind: 'AT', personnel: 4, weapons: { RR106: 1, RIFLE: 3 }, speed: 15, obsRange: 2000, nvd: true, radius: 15, description: 'Effective 1100-1300 m. Destroy assaulting armour, separate armour from infantry, cover obstacles (ICIB Sec 77 para 3).' }),
  BS_DET: T({ key: 'BS_DET', side: 'BLUE', name: 'Bakhtar Shikan Det', short: 'BS', sidc: 'SFGPUCAAA--A---', echelon: 'TEAM', kind: 'AT', personnel: 4, weapons: { BS: 1, RIFLE: 3 }, speed: 15, obsRange: 3000, nvd: true, radius: 15, description: 'ATGM, effective to 3000 m. Long-range A tk framework; site for oblique fire on the tank approach.' }),
  GLHMG_DET: T({ key: 'GLHMG_DET', side: 'BLUE', name: '40mm GLHMG Det', short: 'GL', sidc: 'SFGPEWGH-------', echelon: 'TEAM', kind: 'MG', personnel: 4, weapons: { GLHMG: 1, RIFLE: 3 }, speed: 4, obsRange: 2000, nvd: true, radius: 15, description: 'Destroys troops/vehicles up to 1750 m; disrupts forming up; ideal for spoiling attack (ICIB Sec 77 para 4).' }),
  MOR60_SEC: T({ key: 'MOR60_SEC', side: 'BLUE', name: '60mm Mor Sec', short: '60 Mor', sidc: 'SFGPUCFM---C---', echelon: 'SEC', kind: 'MORTAR', personnel: 6, weapons: { MOR60: 2, RIFLE: 4 }, speed: 4, obsRange: 600, nvd: false, radius: 25, description: '2 x 60mm mor, range ~1800 m. Ideal for engaging enemy close to own troops; site in defilade/reverse slope.' }),
  ARTY_OBS: T({ key: 'ARTY_OBS', side: 'BLUE', name: 'Arty Obsr (FOO)', short: 'FOO', sidc: 'SFGPUCFO---A---', echelon: 'TEAM', kind: 'OBS', personnel: 4, weapons: { RIFLE: 4 }, speed: 4, obsRange: 3000, nvd: true, radius: 10, description: 'Controls DS/in sp arty by observation. Site on a vantage point with view over DFs and killing areas.' }),
  MOR_OBS: T({ key: 'MOR_OBS', side: 'BLUE', name: 'Mor Obsr (MFC)', short: 'MFC', sidc: 'SFGPUCFO---A---', echelon: 'TEAM', kind: 'OBS', personnel: 3, weapons: { RIFLE: 3 }, speed: 4, obsRange: 2500, nvd: true, radius: 10, description: 'Controls bn 81mm mortars by observation.' }),
  QC_DET: T({ key: 'QC_DET', side: 'BLUE', name: 'Intg QC Det', short: 'QC', sidc: 'SFGPUUS----A---', echelon: 'TEAM', kind: 'UAS', personnel: 5, weapons: { RIFLE: 5 }, speed: 4, obsRange: 800, nvd: false, radius: 15, description: '5 pers, 1 x surveillance QC and 1 x attack QC. Endurance ~35 min per sortie; vulnerable to EW.' }),
  ASLT_PNR_SEC: T({ key: 'ASLT_PNR_SEC', side: 'BLUE', name: 'Aslt Pnr Sec', short: 'Pnr', sidc: 'SFGPUCEC---C---', echelon: 'SEC', kind: 'ENGR', personnel: 7, weapons: { RIFLE: 7 }, speed: 4, obsRange: 800, nvd: false, radius: 20, description: 'Lays mines/wire, minor demolitions. Allot to obstacle tasks (time & space).' }),
  RIFLE_COY: T({ key: 'RIFLE_COY', side: 'BLUE', name: 'Rifle Company', short: 'Coy', sidc: 'SFGPUCI----E---', echelon: 'COY', kind: 'INF', personnel: 146, weapons: { RIFLE: 85, LMG: 18, MG: 3, RL: 6, RR106: 2, MOR60: 2, GLHMG: 1 }, elements: 3, elementName: 'Pl', speed: 4, obsRange: 1800, nvd: true, radius: 450, description: '3 rifle pls + wpn sec (2 x RR, 2 x 60mm mor, GLHMG). Coy frontage ~1100-1400 m.' }),
  MOR81_PL: T({ key: 'MOR81_PL', side: 'BLUE', name: '81mm Mor Pl', short: '81 Mor', sidc: 'SFGPUCFM---D---', echelon: 'PL', kind: 'MORTAR', personnel: 36, weapons: { MOR81: 6, RIFLE: 20 }, speed: 15, obsRange: 600, nvd: false, radius: 80, description: '6 x 81mm mor in 2 secs. Bn comd\'s own indirect fire; site centrally in defilade.' }),
  ATGM_PL: T({ key: 'ATGM_PL', side: 'BLUE', name: 'ATGM Pl (BS)', short: 'ATGM', sidc: 'SFGPUCAAA--D---', echelon: 'PL', kind: 'AT', personnel: 20, weapons: { BS: 4, RIFLE: 12 }, elements: 2, elementName: 'Sec', speed: 15, obsRange: 3000, nvd: true, radius: 150, description: 'Framework of bn A tk def; cover gaps between coys.' }),
  BN_HQ: T({ key: 'BN_HQ', side: 'BLUE', name: 'Bn HQ', short: 'Bn HQ', sidc: 'SFGPUH-----F---', echelon: 'BN', kind: 'HQ', personnel: 40, weapons: { RIFLE: 30 }, speed: 15, obsRange: 800, nvd: false, radius: 120, description: 'Bn HQ & RAP. Central, concealed, near main axis of maint.' }),
  INF_BN: T({ key: 'INF_BN', side: 'BLUE', name: 'Infantry Battalion', short: 'Bn', sidc: 'SFGPUCI----F---', echelon: 'BN', kind: 'INF', personnel: 620, weapons: { RIFLE: 360, LMG: 72, MG: 12, RL: 24, RR106: 8, MOR60: 8, GLHMG: 4, MOR81: 6, BS: 4 }, elements: 4, elementName: 'Coy', speed: 4, obsRange: 2000, nvd: true, radius: 1400, description: '4 rifle coys + sp coy. Bn frontage ~3-5 km.' }),
  BDE_HQ: T({ key: 'BDE_HQ', side: 'BLUE', name: 'Bde HQ', short: 'Bde HQ', sidc: 'SFGPUH-----H---', echelon: 'BDE', kind: 'HQ', personnel: 80, weapons: { RIFLE: 50 }, speed: 20, obsRange: 800, nvd: false, radius: 200, description: 'Bde HQ. Well in depth, concealed.' }),
  TK_SQN: T({ key: 'TK_SQN', side: 'BLUE', name: 'Armd Sqn (res)', short: 'Sqn', sidc: 'SFGPUCA----E---', echelon: 'COY', kind: 'ARMOUR', personnel: 42, vehicles: 14, weapons: { TK_GUN: 14, TK_MG: 14 }, elements: 3, elementName: 'Tp', speed: 20, tracked: true, obsRange: 2500, nvd: true, radius: 300, description: 'Armour reserve for counter-attack. Hold centralised in depth.' }),

  // ------------------------------------------------------------ RED (Foxland)
  EN_RECCE: T({ key: 'EN_RECCE', side: 'RED', name: 'En Recce Ptl', short: 'Recce', sidc: 'SHGPUCR----C---', echelon: 'SEC', kind: 'RECCE', personnel: 9, weapons: { EN_RIFLE: 7, EN_LMG: 2 }, speed: 4, obsRange: 1500, nvd: true, radius: 30, description: 'Recce / probing patrol.' }),
  EN_INF_COY: T({ key: 'EN_INF_COY', side: 'RED', name: 'En Inf Coy', short: 'Coy', sidc: 'SHGPUCI----E---', echelon: 'COY', kind: 'INF', personnel: 120, weapons: { EN_RIFLE: 85, EN_LMG: 9, EN_MMG: 2, EN_RL: 3 }, elements: 3, elementName: 'Pl', speed: 4, obsRange: 1500, nvd: true, radius: 100, description: 'Foxland rifle coy.' }),
  EN_SUPPORT_COY: T({ key: 'EN_SUPPORT_COY', side: 'RED', name: 'En Sp Elm (BOF)', short: 'BOF', sidc: 'SHGPUCI----D---', echelon: 'PL', kind: 'MG', personnel: 40, weapons: { EN_MMG: 6, EN_AGL: 2, EN_ATGM: 2, EN_RIFLE: 20 }, speed: 4, obsRange: 2000, nvd: true, radius: 80, description: 'MMGs, AGLs and ATGMs forming the base of fire.' }),
  EN_TK_TP: T({ key: 'EN_TK_TP', side: 'RED', name: 'En Tk Tp', short: 'Tp', sidc: 'SHGPUCA----D---', echelon: 'PL', kind: 'ARMOUR', personnel: 9, vehicles: 3, weapons: { TK_GUN: 3, TK_MG: 3 }, speed: 18, tracked: true, obsRange: 2500, nvd: true, radius: 60, description: 'Troop of 3 x T-72, used in close support of the assaulting infantry.' }),
  EN_TK_SQN: T({ key: 'EN_TK_SQN', side: 'RED', name: 'En Armd Sqn', short: 'Sqn', sidc: 'SHGPUCA----E---', echelon: 'COY', kind: 'ARMOUR', personnel: 42, vehicles: 14, weapons: { TK_GUN: 14, TK_MG: 14 }, elements: 3, elementName: 'Tp', speed: 18, tracked: true, obsRange: 2500, nvd: true, radius: 250, description: 'Armour squadron (14 tanks).' }),
  EN_INF_BN: T({ key: 'EN_INF_BN', side: 'RED', name: 'En Inf Bn', short: 'Bn', sidc: 'SHGPUCI----F---', echelon: 'BN', kind: 'INF', personnel: 620, weapons: { EN_RIFLE: 420, EN_LMG: 45, EN_MMG: 14, EN_RL: 15, EN_AGL: 4, EN_ATGM: 4 }, elements: 4, elementName: 'Coy', speed: 4, obsRange: 2000, nvd: true, radius: 400, description: 'Foxland infantry battalion.' }),
  EN_ENGR: T({ key: 'EN_ENGR', side: 'RED', name: 'En Engr (breach)', short: 'Engr', sidc: 'SHGPUCE----C---', echelon: 'SEC', kind: 'ENGR', personnel: 12, weapons: { EN_RIFLE: 10 }, speed: 4, obsRange: 800, nvd: false, radius: 25, description: 'Breaching party for minefield lanes.' }),
};

export function template(key: string): UnitTemplate {
  const t = TEMPLATES[key];
  if (!t) throw new Error(`Unknown unit template ${key}`);
  return t;
}

export const ECHELON_ORDER: Echelon[] = ['TEAM', 'SEC', 'PL', 'COY', 'BN', 'BDE', 'DIV'];

/** Replace the affiliation letter of a 2525C SIDC (F friend, H hostile, U unknown, S suspect). */
export function sidcWithAffiliation(sidc: string, aff: 'F' | 'H' | 'U' | 'S'): string {
  return sidc[0] + aff + sidc.slice(2);
}

/** Planned status (dashed frame) for alternate positions. */
export function sidcPlanned(sidc: string): string {
  return sidc.slice(0, 3) + 'A' + sidc.slice(4);
}

/** Echelon letter at position 12 of a unit SIDC. */
export function sidcWithEchelon(sidc: string, e: Echelon): string {
  if (sidc[4] !== 'U') return sidc;
  const map: Record<Echelon, string> = { TEAM: 'A', SEC: 'C', PL: 'D', COY: 'E', BN: 'F', BDE: 'H', DIV: 'I' };
  return sidc.slice(0, 11) + map[e] + sidc.slice(12);
}

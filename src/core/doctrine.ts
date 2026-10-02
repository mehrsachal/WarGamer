// Doctrinal norms used by the planner hints, the enemy AI and the objective assessment.
// Source ("the bible"): The Rifle Company, Platoon and Section in Battle (ICIB, Amdt 2015),
// plus the School of Infantry & Tactics practice IE solution (Def Aprc) and TE Def BIC-49.
// Every rule cites the section/para so a DS can trace each mark to the pamphlet.

export const REF = {
  DEF_DEFINITIONS: 'ICIB Sec 72 para 4',
  FUNDAMENTALS: 'ICIB Sec 72 para 6',
  FIELD_OF_FIRE: 'ICIB Sec 72 para 6b',
  FRONTAGES: 'ICIB Sec 72 para 6c',
  MUTUAL_SUPPORT: 'ICIB Sec 72 para 4l & 6d',
  ALL_ROUND: 'ICIB Sec 72 para 6e',
  DEPTH: 'ICIB Sec 72 para 6f',
  SECURITY: 'ICIB Sec 72 para 6h',
  SURVEILLANCE: 'ICIB Sec 72 para 6j; Sec 74 para 8',
  SCREENS: 'ICIB Sec 73 paras 10-18',
  SCREEN_WITHDRAWAL: 'ICIB Sec 73 paras 17-18',
  PLANNING_SEQ: 'ICIB Sec 74 para 2',
  COY_CONSIDERATIONS: 'ICIB Sec 74 para 4a',
  APPROACH_NOT_SPLIT: 'ICIB Sec 74 para 4a(1)',
  PRIORITY_OF_WORK: 'ICIB Sec 74 para 4c',
  OP_LP: 'ICIB Sec 74 para 8a-b; Sec 43 para 6',
  MG_SITING: 'ICIB Sec 74 para 10a',
  AT_SITING: 'ICIB Sec 74 para 10b',
  DF_SELECTION: 'ICIB Sec 74 para 10d-e; Sec 77 para 6',
  TWO_UP: 'ICIB Sec 74 para 11',
  FIRE_PLAN: 'ICIB Sec 74 para 15; Sec 77',
  OBSTACLES: 'ICIB Sec 74 paras 17-21',
  CATK_PLAN: 'ICIB Sec 74 paras 24-26',
  CP_CHQ: 'ICIB Sec 74 para 27',
  ADMIN: 'ICIB Sec 74 para 29',
  ASSAULT_PHASE: 'ICIB Sec 76 paras 10-12',
  CATK_DECISION: 'ICIB Sec 76 paras 13-14',
  CATK_GUIDELINES: 'ICIB Sec 76 para 21',
  COUNTER_PEN: 'ICIB Sec 76 paras 22-29',
  AFTER_BATTLE: 'ICIB Sec 76 para 30',
  RR_GLHMG: 'ICIB Sec 77 paras 3-4',
  DF_SOS: 'ICIB Sec 72 para 4z; Sec 77 para 6b',
  SPOILING: 'ICIB Sec 79',
  STANDING_PTL: 'ICIB Sec 43 paras 1-4',
  FOXLAND_ATTACK: 'ICIB Sec 114 paras 33-36',
  FOXLAND_FRONTAGES: 'ICIB Sec 114 para 7',
  ALT_POSN: 'ICIB Sec 72 para 4e',
  WIRE: 'ICIB Sec 74 para 21',
  SAFETY_DIST: 'ICIB Sec 67 para e(1); Sec 106 para 7',
  IE_SOLN: 'SI&T Prac IE Def Aprc soln',
  BIC49: 'TE Def BIC-49 (Narr 1, Reqs 1-5)',
} as const;

export const DOCTRINE = {
  // Fields of fire
  minFieldOfFire: 100,
  desiredFieldOfFire: [270, 500] as const,
  platoonFieldOfFire: 400,
  // Frontages (Foxland norms with 2 x LMG per sec; used as yardstick for own localities too)
  frontage: { SEC: [70, 90], PL: [300, 350], COY: [1100, 1400], BN: [3000, 5000], BDE: [7000, 10000] } as Record<string, readonly [number, number]>,
  // Mutual support: gaps between localities must be covered by direct fire.
  mutualSupport: { PL: 600, COY: 1500, BN: 3500, BDE: 7000 } as Record<string, number>,
  // Alternate positions at least 200-300 m from original
  altPosnMin: 200,
  altPosnMax: 600,
  // Standing patrol 1000-1500 m ahead of main position; LP 350-400 m ahead
  standingPtlRange: [800, 1600] as const,
  lpRange: [250, 500] as const,
  // Screens: as far forward as necessary to deny obsn of main posn; e.g. knoll ~600 m away
  screenMinAhead: 600,
  screenWithdrawCasPct: 0.5,
  // Wire must check the enemy outside grenade range
  wireMinAhead: 35,
  wireMaxAhead: 150,
  // Protective minefield covered by small arms; defensive mfd by A tk + MG
  protMfdMaxAhead: 400,
  // DF
  dfPerFireUnit: 6,
  dfSosMinAhead: 150,
  dfSosMaxAhead: 600,
  // Counter-attack timing
  coyCatkMaxMin: 30,
  coyCatkIdealMin: 20,
  bnCatkMaxMin: 60,
  // Enemy (Foxland) attack norms
  fupStayMin: [15, 30] as const,
  faaDistFromContact: [2000, 3000] as const,
  rateDeliberatePer100m: 4,
  rateFavourablePer100m: 2,
  infSpeedKphDay: 4.5,
  bnReactMin: [30, 45] as const,
  // Arty / mor safety distances (m) when supporting own troops
  safety: { FIELD: 180, MEDIUM: 360, MOR81: 275, MOR120: 450, MOR60: 100 },
  // Normal priority of work in defence (ICIB Sec 74 para 4c)
  priorityOfWork: [
    'PROTECTION_SURV',
    'SITE_RR_MG',
    'CLEAR_FOF',
    'DIG_TRENCHES',
    'LINE_COMMS',
    'OBSTACLES_MINES',
    'OHP_CAM',
    'ALT_POSNS',
    'COMM_TRENCHES',
    'ADMIN_AREAS',
  ],
} as const;

export const WORK_ITEMS: Record<string, { label: string; ref: string }> = {
  PROTECTION_SURV: { label: 'Organise protection & surveillance (OPs, outposts, ptls)', ref: REF.PRIORITY_OF_WORK },
  SITE_RR_MG: { label: 'Position RRs and MGs', ref: REF.PRIORITY_OF_WORK },
  CLEAR_FOF: { label: 'Clear fields of fire, determine ranges', ref: REF.PRIORITY_OF_WORK },
  DIG_TRENCHES: { label: 'Prepare weapon emplacements and fire trenches', ref: REF.PRIORITY_OF_WORK },
  LINE_COMMS: { label: 'Establish line communication', ref: REF.PRIORITY_OF_WORK },
  OBSTACLES_MINES: { label: 'Emplace obstacles and lay mines', ref: REF.PRIORITY_OF_WORK },
  OHP_CAM: { label: 'Overhead protection, camouflage & concealment', ref: REF.PRIORITY_OF_WORK },
  ALT_POSNS: { label: 'Prepare alternative & counter-penetration positions', ref: REF.PRIORITY_OF_WORK },
  COMM_TRENCHES: { label: 'Prepare communication trenches', ref: REF.PRIORITY_OF_WORK },
  ADMIN_AREAS: { label: 'Latrines and rest areas', ref: REF.PRIORITY_OF_WORK },
};

/** Man-hours style estimate (in hours of the sub-unit's time) used for time & space. */
export const WORK_NORMS = {
  battleProcedureHrs: 6,
  occupationHrs: 3,
  digMainDefHrs: 12,
  ohpCamHrs: 8,
  altPosnHrs: 6,
  clearFofHrs: 4,
  /** Metres of mine-field one aslt pnr section lays per hour (AP+AT mixed, night factor applied separately). */
  minesPerSecHr: 60,
  wirePerSecHr: 100,
  rehearsalHrs: 3,
};

export const GRADES: { min: number; grade: string; text: string }[] = [
  { min: 85, grade: 'A+', text: 'Outstanding' },
  { min: 75, grade: 'A', text: 'Above average' },
  { min: 60, grade: 'B', text: 'Average' },
  { min: 50, grade: 'C', text: 'Below average' },
  { min: 0, grade: 'D', text: 'Fail — re-attempt' },
];

export function gradeFor(pct: number): { grade: string; text: string } {
  for (const g of GRADES) if (pct >= g.min) return g;
  return GRADES[GRADES.length - 1];
}

// Contingency decision points. The same definitions drive (1) the pre-planned
// contingency form in the planner and (2) the decision injects during the wargame.
// Correctness of each option is judged by the assessment module against the
// actual situation (see assess/decisions.ts), not by a fixed answer key.

import { REF } from '../core/doctrine';

export interface ContOption {
  id: string;
  text: string;
}

export interface ContingencyDef {
  key: string;
  title: string;
  situation: string;
  ref: string;
  options: ContOption[];
  needsUnit?: 'CATK_FORCE' | 'SPOIL_FORCE';
  needsDelay?: boolean;
  multi?: boolean;
  /** Echelons where this decision point applies. */
  levels: ('PL' | 'COY' | 'BN' | 'BDE')[];
}

export const CONTINGENCIES: ContingencyDef[] = [
  {
    key: 'SCREEN_CONTACT',
    title: 'Screen battle',
    situation: 'En adv guard contacts the screens after crossing the bdry.',
    ref: REF.SCREEN_WITHDRAWAL,
    levels: ['COY', 'BN', 'BDE'],
    options: [
      { id: 'ENGAGE_WITHDRAW', text: 'Engage at long rg, call arty/mor, force en to deploy; seek permission and withdraw along covered route before getting inextricably involved' },
      { id: 'WITHDRAW_NOW', text: 'Withdraw the screens to the main posn immediately on contact' },
      { id: 'HOLD_ALL_COSTS', text: 'Screens to hold their gr at all costs' },
      { id: 'REINFORCE', text: 'Reinforce the screens with the depth sub-unit' },
    ],
  },
  {
    key: 'EN_PROBE',
    title: 'En recce / probing',
    situation: 'En recce ptls / probing elms approach the FDLs to locate wpns, gaps and mfd lanes.',
    ref: REF.ASSAULT_PHASE,
    levels: ['PL', 'COY', 'BN', 'BDE'],
    options: [
      { id: 'MIN_FIRE_ALT', text: 'Frustrate with min wpns (MG/GLHMG) from altn posns; aggressive ptls, strict fire discipline, cam & no unnec mov' },
      { id: 'ALL_WPNS', text: 'Engage with all wpns to destroy the ptl' },
      { id: 'DF_ON_PTL', text: 'Call for arty DF on the ptl' },
      { id: 'IGNORE', text: 'Hold fire and let the ptl go' },
    ],
  },
  {
    key: 'EN_ASSEMBLY',
    title: 'En assembly (FAA)',
    situation: 'Positive info of en assembly in the FAA (inf with tks).',
    ref: `${REF.ASSAULT_PHASE}; ${REF.DF_SELECTION}`,
    levels: ['PL', 'COY', 'BN', 'BDE'],
    options: [
      { id: 'DF_FAA', text: 'Call for DF on the FAA (pre-selected DF)' },
      { id: 'UCAV_FAA', text: 'Demand UCAV strike on the armr / conc in the FAA (with justification)' },
      { id: 'AQC_FAA', text: 'Launch the A/QC on the conc' },
      { id: 'NOTHING', text: 'No action — conserve fire till the assault' },
    ],
  },
  {
    key: 'EN_FORMING_UP',
    title: 'En forming up (FUP)',
    situation: 'Standing ptl / QC reports en tps and tks forming up for attk.',
    ref: REF.SPOILING,
    levels: ['PL', 'COY', 'BN', 'BDE'],
    needsUnit: 'SPOIL_FORCE',
    options: [
      { id: 'SPOIL_FIRE', text: 'Spoiling attk by fire (standing ptl / sec with auto wpns, GLHMG) on the FUP + DF on FUP; no physical assault' },
      { id: 'DF_FUP', text: 'Call for DF (arty + mors) on the FUP; standing ptl continues to observe' },
      { id: 'SPOIL_ASSAULT', text: 'Spoiling attk with the depth sub-unit physically assaulting the FUP' },
      { id: 'SOS_NOW', text: 'Call DF (SOS) now' },
      { id: 'WAIT', text: 'Wait till en crosses the SL' },
    ],
  },
  {
    key: 'EN_ASSAULT',
    title: 'En assault (crosses SL)',
    situation: 'En crosses the SL; BOF opens fire on the fwd localities.',
    ref: `${REF.ASSAULT_PHASE}; ${REF.DF_SOS}`,
    levels: ['PL', 'COY', 'BN', 'BDE'],
    options: [
      { id: 'SOS_READJUST', text: 'Call DF (SOS); readjust secs / wpns to altn posns facing the threat; hold small arms fire till the killing area; inform higher HQ' },
      { id: 'SOS_HOLD', text: 'Call DF (SOS) and fight from present posns' },
      { id: 'ALL_FIRE', text: 'Open fire with all wpns immediately at max rg' },
      { id: 'DEPTH_FWD', text: 'Move the depth sub-unit fwd to thicken the FDLs' },
    ],
  },
  {
    key: 'POST_LOST',
    title: 'Loss of a post (LMG bkr / sec)',
    situation: 'Fwd pl reports en has captured a LMG bkr / sec and is pressing on.',
    ref: `${REF.CATK_DECISION}; ${REF.CATK_GUIDELINES}`,
    levels: ['PL', 'COY', 'BN', 'BDE'],
    needsUnit: 'CATK_FORCE',
    needsDelay: true,
    options: [
      { id: 'LOCAL_CATK', text: 'Immediate local C attk by the depth sub-unit (planned SL/route, fire sp from adjacent locality, DF on en follow-up tps)' },
      { id: 'REINFORCE_CONTAIN', text: 'Reinforce the threatened locality; contain the penetration by fire and readjustment' },
      { id: 'CPEN', text: 'Occupy counter-penetration posns' },
      { id: 'HIGHER_CATK', text: 'Request C attk by the next higher comd' },
      { id: 'WITHDRAW', text: 'Withdraw the threatened locality to depth' },
    ],
  },
  {
    key: 'LOCALITY_LOST',
    title: 'Loss of a locality',
    situation: 'An entire fwd locality has been captured.',
    ref: `${REF.CATK_GUIDELINES}; ${REF.COUNTER_PEN}`,
    levels: ['PL', 'COY', 'BN', 'BDE'],
    options: [
      { id: 'CPEN_HIGHER', text: 'Adjacent localities hold fast; occupy counter-penetration posn; request C attk by higher comd and coord SL, route, fire sp, guides, codewords' },
      { id: 'OWN_CATK', text: 'C attk with whatever own tps remain' },
      { id: 'DF_HOLD', text: 'Call DF on the lost locality and hold present posns' },
      { id: 'WITHDRAW_ALL', text: 'Withdraw the remaining tps' },
    ],
  },
  {
    key: 'REORG',
    title: 'Reorg after the battle',
    situation: 'En attk has been beaten off / position restored. Hy cas suffered.',
    ref: `${REF.AFTER_BATTLE}; ${REF.ADMIN}; ${REF.BIC49}`,
    levels: ['PL', 'COY', 'BN', 'BDE'],
    multi: true,
    options: [
      { id: 'CASEVAC_CHAIN', text: 'Cas evac by stretcher bearers to Coy Aid Post (CHQ) → Bn RAP → ADS → CMH / Base Hosp' },
      { id: 'BUDDY_AID', text: 'On-site treatment: buddy aid, tourniquets, combat medic triage of the wounded' },
      { id: 'AMMO_REDIST', text: 'Redistribute ammo: riflemen hand over to LMG nos; strip the dead / POWs of ammo' },
      { id: 'AMMO_REPLEN', text: 'Replenish ammo from F ech through CHM, using returning stretcher bearers / ration parties' },
      { id: 'REPLACE_WPNS', text: 'Replace knocked-out LMGs from the depth sec; demand replacements from Bn' },
      { id: 'RESITE_WPNS', text: 'Shift located RR / MG to altn posns (RR with CO’s permission)' },
      { id: 'MANPOWER', text: 'Readjust manpower between secs; re-org sec and pl comds' },
      { id: 'RE_SURV', text: 'Re-establish LP / standing ptl, close mfd gaps and re-lay trip flares' },
      { id: 'SITREP', text: 'Send SITREP & cas report to Bn HQ; POWs escorted to CHQ for evac' },
      { id: 'MORALE', text: 'Comds go round the posns; collect the dead (shaheeds as amanats); look after morale' },
      { id: 'EVAC_DEAD_FIRST', text: 'Evacuate the dead before the wounded' },
      { id: 'ALL_SB_FWD', text: 'Send all stretcher bearers and CHQ pers fwd, leaving the CAP unmanned' },
      { id: 'STAND_DOWN', text: 'Stand the tps down to rest immediately after the battle' },
      { id: 'MOVE_RR_FREE', text: 'Move RRs to new posns without reference to Bn HQ' },
    ],
  },
];

export const REORG_CORRECT = ['CASEVAC_CHAIN', 'BUDDY_AID', 'AMMO_REDIST', 'AMMO_REPLEN', 'REPLACE_WPNS', 'RESITE_WPNS', 'MANPOWER', 'RE_SURV', 'SITREP', 'MORALE'];
export const REORG_WRONG = ['EVAC_DEAD_FIRST', 'ALL_SB_FWD', 'STAND_DOWN', 'MOVE_RR_FREE'];

export function contingencyDef(key: string): ContingencyDef {
  const d = CONTINGENCIES.find((c) => c.key === key);
  if (!d) throw new Error(`unknown contingency ${key}`);
  return d;
}

export function optionText(key: string, id: string): string {
  return CONTINGENCIES.find((c) => c.key === key)?.options.find((o) => o.id === id)?.text ?? id;
}

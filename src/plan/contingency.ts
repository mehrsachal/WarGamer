// Contingency decision points. The same definitions drive (1) the pre-planned
// contingency composer in the planner, (2) the decision injects during the wargame and
// (3) the marking. A response is COMPOSED from a library of actions (fire, manoeuvre,
// obstacles & protection, C2 & reporting, logistics & cas) plus free text in the student's
// own words. Each situation also keeps a few named "quick picks" (the v1 single options),
// which map onto action sets so old plans ({option}) stay valid.
// Correctness is judged by assess/decisions.ts against the actual situation.

import { REF } from '../core/doctrine';
import type { ContingencyChoice, CustomContingency, OpsLevel } from '../core/types';

export type ActionCat = 'FIRE' | 'MAN' | 'OBS' | 'C2' | 'LOG';

export const ACTION_CATS: { id: ActionCat; label: string; icon: string }[] = [
  { id: 'FIRE', label: 'Fire', icon: '✸' },
  { id: 'MAN', label: 'Manoeuvre', icon: '➤' },
  { id: 'OBS', label: 'Obstacles & protection', icon: '▦' },
  { id: 'C2', label: 'C2 & reporting', icon: '☏' },
  { id: 'LOG', label: 'Logistics & cas', icon: '✚' },
];

export interface ContAction {
  id: string;
  cat: ActionCat;
  text: string;
  /** Parameter the action takes in the composer. */
  param?: 'UNIT' | 'DELAY' | 'DF';
  /** Keywords that let a free-text order be understood as this action. */
  kw?: RegExp;
}

const A = (id: string, cat: ActionCat, text: string, kw?: RegExp, param?: ContAction['param']): ContAction => ({ id, cat, text, kw, param });

/** The action library (shared by all situations and by the student's own contingencies). */
export const ACTIONS: Record<string, ContAction> = Object.fromEntries(
  [
    // ---------------------------------------------------------------- fire
    A('ENGAGE_LONG', 'FIRE', 'Engage at long rg to force the en to deploy early', /\blong ?(rg|range)\b|force (the )?en(emy)? to deploy|deploy early/),
    A('DF_SCREEN', 'FIRE', 'Arty / mor DF on the en adv elms in sp of the screens', /\b(df|arty|artillery|mor|mortar)s?\b.*\b(adv|advance|screen)|\bsp of (the )?screen/),
    A('MIN_WPNS', 'FIRE', 'Frustrate with min wpns (MG / GLHMG) from altn posns', /\bmin(imum)? (wpns|weapons|fire(power)?)\b|\bmg\b.*\baltn?\b|from alt(ernate|n)? posn/),
    A('ALL_WPNS', 'FIRE', 'Open fire with all wpns at max rg', /\ball (wpns|weapons)\b|\bmax(imum)? (rg|range)\b|open fire (now|immediately)/),
    A('DF_TGT', 'FIRE', 'Call arty / mor DF on the reported en', /\b(call|bring down|fire)\b.*\b(df|arty|artillery|mortars?)\b(?!.*\b(sos|faa|fup)\b)/),
    A('HOLD_FIRE', 'FIRE', 'Hold fire — no engagement for now', /\bhold (your )?fire\b(?! (till|until))|\bdo not engage\b|\bconserve (fire|amn|ammo)\b|\bwait\b/),
    A('DF_FAA', 'FIRE', 'Call DF on the FAA (pre-selected DF)', /\b(df|arty|artillery|fire)\b.*\bfaa\b|\bfaa\b.*\b(df|arty|fire)\b/, 'DF'),
    A('UCAV', 'FIRE', 'Demand a UCAV strike on the armr / conc (with justification)', /\bucav\b|\bdrone strike\b/),
    A('AQC', 'FIRE', 'Launch the A/QC on the conc', /\ba\/?qc\b|attack qc|attack quad/),
    A('DF_FUP', 'FIRE', 'Call DF (arty + mors) on the FUP', /\b(df|arty|artillery|mortars?|fire)\b.*\bfup\b|\bfup\b.*\b(df|arty|fire)\b/, 'DF'),
    A('SPOIL_FIRE', 'FIRE', 'Spoiling attk by fire on the FUP (SP / sec with auto wpns, GLHMG) — no physical assault', /\bspoil(ing)?\b(?!.*\bassault\b)/, 'UNIT'),
    A('SOS', 'FIRE', 'Call DF (SOS)', /\bsos\b|\bdf ?\(sos\)/),
    A('HOLD_FIRE_KA', 'FIRE', 'Hold small-arms fire till the en enters the killing area', /\b(hold|withhold) (small[- ]arms )?fire (till|until)\b|\bkill(ing)? (area|zone)\b/),
    A('AT_ENGAGE', 'FIRE', 'A tk wpns engage the tks in the KA from flanking posns', /\b(a ?tk|anti[- ]tank|rr|bs|atgm)\b.*\b(engage|tks|tanks)\b/),
    A('DF_PEN', 'FIRE', 'DF / 60 mm on the penetration and on en follow-up tps', /\b(df|mortars?|60 ?mm|arty)\b.*\b(penetration|follow[- ]up|depth)\b/),
    A('FIRE_SP_ADJ', 'FIRE', 'Fire sp from the adjacent locality', /\b(fire sp|fire support|covering fire)\b.*\badj(acent)?\b|\badj(acent)? (locality|pl|platoon)\b.*\bfire\b/),
    A('DF_LOST_LOC', 'FIRE', 'DF on the lost locality to stop the en reorganising', /\b(df|arty|fire)\b.*\b(lost|overrun|captured) (locality|posn|position)\b/),
    A('CB_REQ', 'FIRE', 'Shelrep and request counter-bty (CB) fire through Bn HQ', /\b(cb|counter[- ]?(bty|battery))\b|\bshelrep\b/),
    A('DF_GAP', 'FIRE', 'Register DF / MG fire to cover the gap', /\b(df|mg|fire)\b.*\bgap\b|\bcover the gap\b/),
    A('ENGAGE_UAV', 'FIRE', 'Engage the UAV with small arms / MGs', /\b(engage|shoot( down)?|fire at)\b.*\b(uav|drone)\b/),
    A('AD_REQ', 'FIRE', 'Request AD / C-UAS engagement through Bn HQ', /\b(ad|air def(ence)?|c-?uas|counter[- ]uas)\b/),
    A('FIRE_DISC', 'FIRE', 'Tighten fire discipline — aimed fire at the KA only', /\bfire (discipline|control)\b|\baimed fire\b/),
    A('SMOKE_COVER', 'FIRE', 'Smoke / covering fire for the evac', /\bsmoke\b/),
    A('NO_FIRE_CIV', 'FIRE', 'Hold fire on the civilians (LOAC)', /\b(no|hold|do not) fire\b.*\bciv|\bloac\b/),
    A('WARNING_SHOTS', 'FIRE', 'Fire warning shots to stop them', /\bwarning shots?\b/),
    // ---------------------------------------------------------------- manoeuvre
    A('WD_ON_ORDER', 'MAN', 'Withdraw on permission along the planned covered route before getting inextricably involved', /\bwithdraw\b.*\b(permission|order|covered route|before)\b|\bon permission\b/),
    A('WITHDRAW_NOW', 'MAN', 'Withdraw the screens to the main posn immediately', /\bwithdraw (immediately|now|at once)\b/),
    A('HOLD_ALL_COSTS', 'MAN', 'Hold the gr at all costs', /\bat all costs?\b/),
    A('REINFORCE_SCREEN', 'MAN', 'Reinforce the screens from depth', /\breinforce (the )?screens?\b/),
    A('AGGR_PTL', 'MAN', 'Aggressive ptls to intercept / dominate', /\b(aggressive )?(ptls?|patrols?)\b.*\b(intercept|dominate|aggressive)\b|\baggressive (ptl|patrol)/),
    A('SPOIL_ASSAULT', 'MAN', 'Spoiling attk — depth sub-unit physically assaults the FUP', /\b(assault|attack)\b.*\bfup\b|\bphysical assault\b/, 'UNIT'),
    A('READJUST_ALT', 'MAN', 'Readjust secs / wpns to altn posns facing the threat', /\breadjust\b|\b(alt(ernate|n)?) posns?\b.*\bthreat\b/),
    A('DEPTH_FWD', 'MAN', 'Move the depth sub-unit fwd to thicken the FDLs', /\bdepth\b.*\b(fwd|forward)\b.*\bthicken\b|\bthicken (the )?fdls?\b/),
    A('LOCAL_CATK', 'MAN', 'Immediate local C attk by the depth sub-unit (planned SL / route)', /\b(c ?attk|counter[- ]?attack)\b(?!.*\b(higher|bn|brigade|bde)\b)/, 'UNIT'),
    A('REINFORCE_LOC', 'MAN', 'Reinforce the threatened locality', /\breinforce\b(?!.*screen)/),
    A('CPEN', 'MAN', 'Occupy counter-penetration posns', /\b(c ?pen|counter[- ]?penetration)\b/),
    A('HOLD_FAST', 'MAN', 'Adjacent localities hold fast and contain', /\bhold (fast|firm|present posn|your posn|ground)\b|\bcontain\b/),
    A('WITHDRAW_LOC', 'MAN', 'Withdraw the threatened locality to depth', /\bwithdraw (the )?(threatened |affected )?(locality|pl|platoon|post)\b/),
    A('OWN_CATK', 'MAN', 'C attk with whatever own tps remain', /\bwhatever (own )?tps\b|\bc ?attk with (remaining|whatever)/),
    A('WITHDRAW_ALL', 'MAN', 'Withdraw the remaining tps (without orders)', /\bwithdraw (all|everyone|the (whole|remaining|coy|company))\b|\bfall back\b|\bconform\b/),
    A('MOVE_ALT_POSN', 'MAN', 'Move the affected tps to their altn posn', /\b(move|shift)\b.*\b(alt(ernate|n)?) posn\b/),
    A('STAND_BY_LIFT', 'MAN', 'Be ready to man the posns as soon as the fire lifts (assault may follow)', /\b(fire )?lifts?\b|\bman (the )?posns?\b/),
    A('REFUSE_FLANK', 'MAN', 'Refuse the flank: flank locality / wpns to altn posns facing the gap', /\brefuse (the )?flank\b|\bface the gap\b/),
    A('PTL_GAP', 'MAN', 'Ptl / OP to watch the gap', /\b(ptl|patrol|op)\b.*\bgap\b/),
    A('DEPTH_FILL', 'MAN', 'Commit the depth sub-unit to fill the gap', /\bdepth\b.*\b(fill|plug)\b|\b(fill|plug) the gap\b.*\bdepth\b/),
    A('MOVE_CHQ_ALT', 'MAN', 'Move CHQ to its alt loc', /\b(chq|hq)\b.*\balt(ernate|n)?\b/),
    A('DISPERSE', 'MAN', 'Disperse vehs / tps in the open', /\bdispers(e|al)\b/),
    A('PREP_ALT', 'MAN', 'Be prepared to move to altn posns — arty may follow', /\bprep(ared|are)? to move\b|\bbe ready to move\b/),
    A('ROUTE_CIV', 'MAN', 'Route them off the axis, clear of the posn and mfds (police / civ admin)', /\broute (them|civ)|\b(police|civ(il)? admin)\b|\boff the axis\b/),
    A('LET_THROUGH', 'MAN', 'Let them through the posn along the road', /\blet (them )?(through|pass)\b/),
    A('STOP_FIGHT_EVAC', 'MAN', 'Pull riflemen out of the fight to carry the cas back', /\bpull (riflemen|men|tps) out\b/),
    A('RESITE_WPNS', 'MAN', 'Shift located RR / MG to altn posns (RR with CO’s permission)', /\b(shift|resite)\b.*\b(rr|mg)\b/),
    A('MANPOWER', 'MAN', 'Readjust manpower between secs; re-org sec and pl comds', /\bmanpower\b|\bre-?org(anise)? (secs?|comds?)\b/),
    A('STAND_DOWN', 'MAN', 'Stand the tps down to rest immediately after the battle', /\bstand (the tps )?down\b/),
    A('MOVE_RR_FREE', 'MAN', 'Move RRs to new posns without reference to Bn HQ', /\bwithout reference\b/),
    // ---------------------------------------------------------------- obstacles & protection
    A('STAND_TO', 'OBS', 'Warn the localities — stand to; cam, noise & lt discipline', /\bstand ?to\b|\bwarn (the )?(localities|pls|fdls)\b/),
    A('CLOSE_LANES', 'OBS', 'Close the mfd lanes / gaps; re-lay trip flares', /\bclose\b.*\b(lanes?|gaps?)\b|\btrip flares?\b/),
    A('CAM_DISC', 'OBS', 'Strict fire discipline, cam & concealment, no unnec mov', /\bcam(ouflage)?\b|\bconceal(ment)?\b|\bno (unnec(essary)? )?mov(ement)?\b|\bfreeze\b/),
    A('CHECK_OBS', 'OBS', 'Check mfd lanes / gaps closed and obs covered by fire', /\bcheck\b.*\b(mfd|obs|obstacles?|lanes?)\b/),
    A('TAKE_COVER', 'OBS', 'Take cover in trenches / under OHP; sentries only', /\b(take|in) cover\b|\bohp\b|\btrenches\b/),
    A('RE_SURV', 'OBS', 'Re-establish LP / standing ptl, close mfd gaps and re-lay trip flares', /\bre-?establish\b.*\b(lp|ptl|surv)\b/),
    A('SCREEN_INFIL', 'OBS', 'Search / screen them for en infiltrators', /\binfiltrat|\bsearch\b|\bscreen them\b/),
    // ---------------------------------------------------------------- C2 & reporting
    A('REPORT', 'C2', 'Report to higher HQ (contact report / sitrep)', /\b(report|inform|sitrep|tell)\b.*\b(bn|hq|higher|co|coy comd)\b|\b(contact report|sitrep|salute)\b/),
    A('SP_OBSERVE', 'C2', 'Standing ptl / obsrs continue to observe and report', /\b(sp|standing ptl|standing patrol|obsrs?|observers?)\b.*\b(observe|watch|report)\b/),
    A('QC_SURV', 'C2', 'Task the surv QC / obsrs to confirm and track the conc', /\b(surv(eillance)? )?qc\b.*\b(confirm|track|observe|over)\b|\bquadcopter\b/),
    A('RECALL_LP', 'C2', 'Recall LPs / SP before the SOS comes down', /\brecall\b.*\b(lps?|sp|ptl)\b|\b(lps?|ptl)\b.*\b(in|back|recall)\b/),
    A('REQ_HIGHER_CATK', 'C2', 'Request C attk by the next higher comd', /\b(request|ask)\b.*\b(c ?attk|counter[- ]?attack)\b|\b(bn|bde|higher) c ?attk\b/),
    A('COORD_CATK', 'C2', 'Coord SL, route, fire sp, guides & codewords for the higher C attk', /\b(guides?|codewords?|sl and route|coord(inate)?)\b/),
    A('ALT_FREQ', 'C2', 'Switch to the alternate freq / check the sets', /\balt(ernate)? freq|\bswitch freq|\bcheck (the )?sets?\b/),
    A('LINE_COMMS', 'C2', 'Use line (fd tel) to the pl', /\bline\b|\bfd tel\b|\bfield tel/),
    A('RUNNER', 'C2', 'Send a runner / LO by a covered route', /\brunner\b|\bliaison\b|\blo\b/),
    A('PRE_ARRANGED', 'C2', 'Act on pre-arranged signals (Very lts / codewords) and the last orders', /\bpre-?arranged\b|\bvery (lt|light)s?\b|\bcodewords?\b/),
    A('COORD_FLANK', 'C2', 'Liaise with the flank sub-unit; agree the new bdry / RV', /\b(liaise|coord(inate)?)\b.*\bflank\b|\bflank (coy|unit|sub-unit)\b/),
    A('TWO_IC_COMD', 'C2', '2IC assumes comd; alt CHQ / CP opened', /\b2 ?i ?c\b|\bsecond[- ]in[- ]comd\b|\bassumes? comd\b/),
    A('CONTINUE_PLAN', 'C2', 'Pls continue the battle per the plan & standing orders', /\bcontinue\b.*\b(plan|battle|orders)\b|\bper (the )?plan\b/),
    A('WAIT_FOR_ORDERS', 'C2', 'Pls await new orders before acting', /\bawait (new )?orders\b/),
    A('EMCON', 'C2', 'EMCON: min transmissions, short and authenticated', /\bemcon\b|\bmin(imum)? (transmissions?|radio)\b|\bradio silence\b/),
    A('TRANSMIT_CLEAR', 'C2', 'Keep transmitting in clear on the jammed net', /\bin clear\b/),
    A('SITREP', 'C2', 'Send SITREP & cas report to Bn HQ; POWs escorted to CHQ for evac', /\bsitrep\b.*\bcas\b|\bpows?\b/),
    A('MORALE', 'C2', 'Comds go round the posns; collect the dead (shaheeds as amanats); look after morale', /\bmorale\b|\bgo round\b/),
    // ---------------------------------------------------------------- logistics & cas
    A('CASEVAC_CHAIN', 'LOG', 'Cas evac by stretcher bearers to Coy Aid Post (CHQ) → Bn RAP → ADS → CMH / Base Hosp', /\b(rap|ads|cmh|aid post|cap)\b/),
    A('BUDDY_AID', 'LOG', 'On-site treatment: buddy aid, tourniquets, combat medic triage of the wounded', /\bbuddy aid\b|\btourniquets?\b|\btriage\b|\bfirst aid\b/),
    A('AMMO_REDIST', 'LOG', 'Redistribute amn: riflemen hand over to LMG nos; strip the dead / POWs of amn', /\bredistribut/),
    A('AMMO_REPLEN', 'LOG', 'Replenish amn from F ech through CHM by carrying party on a covered route', /\breplen(ish)?\b|\bf ech\b|\bchm\b|\bcarrying party\b/),
    A('AMMO_PRIORITY', 'LOG', 'Pri of amn to the locality in contact and the MGs', /\bpri(ority)? (of )?(amn|ammo)\b/),
    A('REPLACE_WPNS', 'LOG', 'Replace knocked-out LMGs from the depth sec; demand replacements from Bn', /\breplace\b.*\b(lmg|wpns|weapons)\b/),
    A('CASEVAC_WHEN_PERMITS', 'LOG', 'Evacuate cas by stretcher bearers to the CAP by a covered route when fire permits', /\b(when|once) (the )?fire (permits|lifts)\b|\bstretcher\b/),
    A('REQ_AMB', 'LOG', 'Request amb / evac from the Bn RAP to the CAP', /\bamb(ulance)?\b/),
    A('EVAC_DEAD_FIRST', 'LOG', 'Evacuate the dead before the wounded', /\bdead (first|before)\b/),
    A('ALL_SB_FWD', 'LOG', 'Send all stretcher bearers and CHQ pers fwd, leaving the CAP unmanned', /\ball (the )?(stretcher bearers|sbs?)\b/),
  ].map((a) => [a.id, a]),
);

export interface ContOption {
  id: string;
  text: string;
}

export interface ContingencyDef {
  key: string;
  title: string;
  situation: string;
  ref: string;
  /** Named quick picks (the v1 options) — each maps to an action set via `legacy`. */
  options: ContOption[];
  /** Actions offered for this situation (ids in ACTIONS), in display order. */
  actions: string[];
  /** Situation-specific wording of an action. */
  actionText?: Record<string, string>;
  /** Quick pick / legacy option id -> action set. */
  legacy: Record<string, string[]>;
  /** Doctrinal key points of a good answer (for the text judge). */
  keyPoints: string[];
  needsUnit?: 'CATK_FORCE' | 'SPOIL_FORCE';
  needsDelay?: boolean;
  /** Select-all style (reorg) — the response is a list of actions. */
  multi?: boolean;
  /** Echelons where this decision point applies. */
  levels: OpsLevel[];
  /** Core situations are pre-planned and marked at plan time; the others arise only as injects. */
  core: boolean;
}

const ALL: OpsLevel[] = ['PL', 'COY', 'BN', 'BDE'];

export const CONTINGENCIES: ContingencyDef[] = [
  {
    key: 'SCREEN_CONTACT',
    title: 'Screen battle',
    situation: 'En adv guard contacts the screens after crossing the bdry.',
    ref: REF.SCREEN_WITHDRAWAL,
    levels: ['COY', 'BN', 'BDE'],
    core: true,
    actions: ['ENGAGE_LONG', 'DF_SCREEN', 'WD_ON_ORDER', 'WITHDRAW_NOW', 'HOLD_ALL_COSTS', 'REINFORCE_SCREEN', 'STAND_TO', 'CLOSE_LANES', 'REPORT'],
    actionText: { CLOSE_LANES: 'Close the mfd lanes behind the screens once they are through' },
    options: [
      { id: 'ENGAGE_WITHDRAW', text: 'Engage at long rg, call arty/mor, force en to deploy; seek permission and withdraw along covered route before getting inextricably involved' },
      { id: 'WITHDRAW_NOW', text: 'Withdraw the screens to the main posn immediately on contact' },
      { id: 'HOLD_ALL_COSTS', text: 'Screens to hold their gr at all costs' },
      { id: 'REINFORCE', text: 'Reinforce the screens with the depth sub-unit' },
    ],
    legacy: { ENGAGE_WITHDRAW: ['ENGAGE_LONG', 'DF_SCREEN', 'WD_ON_ORDER'], WITHDRAW_NOW: ['WITHDRAW_NOW'], HOLD_ALL_COSTS: ['HOLD_ALL_COSTS'], REINFORCE: ['REINFORCE_SCREEN'] },
    keyPoints: ['engage the en at long range to force him to deploy early', 'call arty / mortar fire in support of the screens', 'withdraw on permission along a covered route', 'do not get inextricably involved', 'report contact to higher HQ'],
  },
  {
    key: 'EN_PROBE',
    title: 'En recce / probing',
    situation: 'En recce ptls / probing elms approach the FDLs to locate wpns, gaps and mfd lanes.',
    ref: REF.ASSAULT_PHASE,
    levels: ALL,
    core: true,
    actions: ['MIN_WPNS', 'ALL_WPNS', 'DF_TGT', 'HOLD_FIRE', 'AGGR_PTL', 'CAM_DISC', 'CHECK_OBS', 'REPORT'],
    actionText: { DF_TGT: 'Call arty DF on the ptl', HOLD_FIRE: 'Hold fire and let the ptl go', AGGR_PTL: 'Aggressive ptls / standing ptl to intercept the en ptl' },
    options: [
      { id: 'MIN_FIRE_ALT', text: 'Frustrate with min wpns (MG/GLHMG) from altn posns; aggressive ptls, strict fire discipline, cam & no unnec mov' },
      { id: 'ALL_WPNS', text: 'Engage with all wpns to destroy the ptl' },
      { id: 'DF_ON_PTL', text: 'Call for arty DF on the ptl' },
      { id: 'IGNORE', text: 'Hold fire and let the ptl go' },
    ],
    legacy: { MIN_FIRE_ALT: ['MIN_WPNS', 'AGGR_PTL', 'CAM_DISC'], ALL_WPNS: ['ALL_WPNS'], DF_ON_PTL: ['DF_TGT'], IGNORE: ['HOLD_FIRE'] },
    keyPoints: ['frustrate the probe firmly with minimum weapons', 'fire from alternate positions so main weapons are not located', 'aggressive patrols to intercept', 'strict fire discipline, camouflage and no unnecessary movement', 'check minefield lanes and gaps'],
  },
  {
    key: 'EN_ASSEMBLY',
    title: 'En assembly (FAA)',
    situation: 'Positive info of en assembly in the FAA (inf with tks).',
    ref: `${REF.ASSAULT_PHASE}; ${REF.DF_SELECTION}`,
    levels: ALL,
    core: true,
    actions: ['DF_FAA', 'UCAV', 'AQC', 'HOLD_FIRE', 'QC_SURV', 'STAND_TO', 'REPORT'],
    actionText: { HOLD_FIRE: 'No action — conserve fire till the assault', STAND_TO: 'Warn the localities: assault likely; stand to' },
    options: [
      { id: 'DF_FAA', text: 'Call for DF on the FAA (pre-selected DF)' },
      { id: 'UCAV_FAA', text: 'Demand UCAV strike on the armr / conc in the FAA (with justification)' },
      { id: 'AQC_FAA', text: 'Launch the A/QC on the conc' },
      { id: 'NOTHING', text: 'No action — conserve fire till the assault' },
    ],
    legacy: { DF_FAA: ['DF_FAA', 'QC_SURV', 'STAND_TO', 'REPORT'], UCAV_FAA: ['UCAV', 'QC_SURV', 'REPORT'], AQC_FAA: ['AQC', 'QC_SURV', 'REPORT'], NOTHING: ['HOLD_FIRE'] },
    keyPoints: ['call DF at once on the pre-selected DF covering the FAA', 'UCAV only on a confirmed armour concentration (justified)', 'keep the concentration under surveillance', 'warn the localities and report to higher HQ'],
  },
  {
    key: 'EN_FORMING_UP',
    title: 'En forming up (FUP)',
    situation: 'Standing ptl / QC reports en tps and tks forming up for attk.',
    ref: REF.SPOILING,
    levels: ALL,
    core: true,
    needsUnit: 'SPOIL_FORCE',
    actions: ['SPOIL_FIRE', 'DF_FUP', 'SOS', 'AQC', 'HOLD_FIRE', 'SPOIL_ASSAULT', 'SP_OBSERVE', 'STAND_TO', 'REPORT'],
    actionText: { SOS: 'Call DF (SOS) now', HOLD_FIRE: 'Wait till the en crosses the SL', STAND_TO: 'Stand to; LPs warned to come in before the SOS' },
    options: [
      { id: 'SPOIL_FIRE', text: 'Spoiling attk by fire (standing ptl / sec with auto wpns, GLHMG) on the FUP + DF on FUP; no physical assault' },
      { id: 'DF_FUP', text: 'Call for DF (arty + mors) on the FUP; standing ptl continues to observe' },
      { id: 'SPOIL_ASSAULT', text: 'Spoiling attk with the depth sub-unit physically assaulting the FUP' },
      { id: 'SOS_NOW', text: 'Call DF (SOS) now' },
      { id: 'WAIT', text: 'Wait till en crosses the SL' },
    ],
    legacy: { SPOIL_FIRE: ['SPOIL_FIRE', 'DF_FUP', 'SP_OBSERVE'], DF_FUP: ['DF_FUP', 'SP_OBSERVE', 'REPORT'], SPOIL_ASSAULT: ['SPOIL_ASSAULT'], SOS_NOW: ['SOS'], WAIT: ['HOLD_FIRE'] },
    keyPoints: ['spoiling attack by fire on the FUP with pre-positioned troops and automatic weapons', 'DF on the FUP', 'no physical assault — keep the depth sub-unit for the counter-attack', 'save the SOS for the assault', 'standing patrol keeps observing and reporting'],
  },
  {
    key: 'EN_ASSAULT',
    title: 'En assault (crosses SL)',
    situation: 'En crosses the SL; BOF opens fire on the fwd localities.',
    ref: `${REF.ASSAULT_PHASE}; ${REF.DF_SOS}`,
    levels: ALL,
    core: true,
    actions: ['SOS', 'HOLD_FIRE_KA', 'AT_ENGAGE', 'ALL_WPNS', 'READJUST_ALT', 'DEPTH_FWD', 'RECALL_LP', 'REPORT'],
    options: [
      { id: 'SOS_READJUST', text: 'Call DF (SOS); readjust secs / wpns to altn posns facing the threat; hold small arms fire till the killing area; inform higher HQ' },
      { id: 'SOS_HOLD', text: 'Call DF (SOS) and fight from present posns' },
      { id: 'ALL_FIRE', text: 'Open fire with all wpns immediately at max rg' },
      { id: 'DEPTH_FWD', text: 'Move the depth sub-unit fwd to thicken the FDLs' },
    ],
    legacy: { SOS_READJUST: ['SOS', 'READJUST_ALT', 'HOLD_FIRE_KA', 'RECALL_LP', 'REPORT'], SOS_HOLD: ['SOS', 'HOLD_FIRE_KA', 'REPORT'], ALL_FIRE: ['ALL_WPNS'], DEPTH_FWD: ['DEPTH_FWD'] },
    keyPoints: ['call DF (SOS) on the assault', 'readjust to alternate positions facing the actual threat', 'hold small arms fire till the enemy enters the killing area', 'recall LPs before the SOS', 'inform higher HQ', 'keep the depth sub-unit for the counter-attack'],
  },
  {
    key: 'POST_LOST',
    title: 'Loss of a post (LMG bkr / sec)',
    situation: 'Fwd pl reports en has captured a LMG bkr / sec and is pressing on.',
    ref: `${REF.CATK_DECISION}; ${REF.CATK_GUIDELINES}`,
    levels: ALL,
    core: true,
    needsUnit: 'CATK_FORCE',
    needsDelay: true,
    actions: ['LOCAL_CATK', 'DF_PEN', 'FIRE_SP_ADJ', 'HOLD_FAST', 'REINFORCE_LOC', 'CPEN', 'REQ_HIGHER_CATK', 'WITHDRAW_LOC', 'REPORT'],
    options: [
      { id: 'LOCAL_CATK', text: 'Immediate local C attk by the depth sub-unit (planned SL/route, fire sp from adjacent locality, DF on en follow-up tps)' },
      { id: 'REINFORCE_CONTAIN', text: 'Reinforce the threatened locality; contain the penetration by fire and readjustment' },
      { id: 'CPEN', text: 'Occupy counter-penetration posns' },
      { id: 'HIGHER_CATK', text: 'Request C attk by the next higher comd' },
      { id: 'WITHDRAW', text: 'Withdraw the threatened locality to depth' },
    ],
    legacy: {
      LOCAL_CATK: ['LOCAL_CATK', 'DF_PEN', 'FIRE_SP_ADJ', 'HOLD_FAST', 'REPORT'],
      REINFORCE_CONTAIN: ['REINFORCE_LOC', 'DF_PEN', 'FIRE_SP_ADJ', 'HOLD_FAST'],
      CPEN: ['CPEN', 'HOLD_FAST'],
      HIGHER_CATK: ['REQ_HIGHER_CATK', 'HOLD_FAST', 'REPORT'],
      WITHDRAW: ['WITHDRAW_LOC'],
    },
    keyPoints: ['immediate local counter-attack by the depth sub-unit before the enemy reorganises', 'launch within 20-30 minutes', 'fire support from the adjacent locality and DF on enemy follow-up troops', 'adjacent posts hold fast and contain', 'report to higher HQ'],
  },
  {
    key: 'LOCALITY_LOST',
    title: 'Loss of a locality',
    situation: 'An entire fwd locality has been captured.',
    ref: `${REF.CATK_GUIDELINES}; ${REF.COUNTER_PEN}`,
    levels: ALL,
    core: true,
    actions: ['HOLD_FAST', 'CPEN', 'REQ_HIGHER_CATK', 'COORD_CATK', 'DF_LOST_LOC', 'OWN_CATK', 'WITHDRAW_ALL', 'REPORT'],
    options: [
      { id: 'CPEN_HIGHER', text: 'Adjacent localities hold fast; occupy counter-penetration posn; request C attk by higher comd and coord SL, route, fire sp, guides, codewords' },
      { id: 'OWN_CATK', text: 'C attk with whatever own tps remain' },
      { id: 'DF_HOLD', text: 'Call DF on the lost locality and hold present posns' },
      { id: 'WITHDRAW_ALL', text: 'Withdraw the remaining tps' },
    ],
    legacy: { CPEN_HIGHER: ['HOLD_FAST', 'CPEN', 'REQ_HIGHER_CATK', 'COORD_CATK', 'REPORT'], OWN_CATK: ['OWN_CATK'], DF_HOLD: ['DF_LOST_LOC', 'HOLD_FAST'], WITHDRAW_ALL: ['WITHDRAW_ALL'] },
    keyPoints: ['adjacent localities hold fast', 'occupy the counter-penetration position to check the penetration', 'request a counter-attack by the next higher commander', 'coordinate start line, route, fire support, guides and codewords', 'DF on the lost locality to stop the enemy reorganising'],
  },
  {
    key: 'REORG',
    title: 'Reorg after the battle',
    situation: 'En attk has been beaten off / position restored. Hy cas suffered.',
    ref: `${REF.AFTER_BATTLE}; ${REF.ADMIN}; ${REF.BIC49}`,
    levels: ALL,
    core: true,
    multi: true,
    actions: ['CASEVAC_CHAIN', 'BUDDY_AID', 'AMMO_REDIST', 'AMMO_REPLEN', 'REPLACE_WPNS', 'RESITE_WPNS', 'MANPOWER', 'RE_SURV', 'SITREP', 'MORALE', 'EVAC_DEAD_FIRST', 'ALL_SB_FWD', 'STAND_DOWN', 'MOVE_RR_FREE'],
    options: [],
    legacy: {},
    keyPoints: ['casualty evacuation through the CAP and Bn RAP', 'buddy aid and triage', 'redistribute and replenish ammunition', 'replace and resite weapons', 'readjust manpower and commanders', 're-establish surveillance, close minefield gaps', 'sitrep and casualty report', 'commanders go round; morale'],
  },
];

// Options of the reorg (kept as the "quick pick" list of the multi-select).
{
  const reorg = CONTINGENCIES.find((c) => c.key === 'REORG')!;
  reorg.options = reorg.actions.map((id) => ({ id, text: ACTIONS[id].text }));
}

export const REORG_CORRECT = ['CASEVAC_CHAIN', 'BUDDY_AID', 'AMMO_REDIST', 'AMMO_REPLEN', 'REPLACE_WPNS', 'RESITE_WPNS', 'MANPOWER', 'RE_SURV', 'SITREP', 'MORALE'];
export const REORG_WRONG = ['EVAC_DEAD_FIRST', 'ALL_SB_FWD', 'STAND_DOWN', 'MOVE_RR_FREE'];

/**
 * Situations that arise only as wargame injects (seeded per battle). Students may pre-plan
 * them as their own contingencies; they are not required at plan time.
 */
export const EXTRA_SITUATIONS: ContingencyDef[] = [
  {
    key: 'EN_ARTY',
    title: 'En arty / mor on a locality',
    situation: 'A locality is under heavy en arty / mor fire.',
    ref: `${REF.PRIORITY_OF_WORK}; ${REF.ALT_POSN}`,
    levels: ALL,
    core: false,
    actions: ['TAKE_COVER', 'STAND_BY_LIFT', 'MOVE_ALT_POSN', 'CB_REQ', 'BUDDY_AID', 'WITHDRAW_LOC', 'REPORT'],
    actionText: { BUDDY_AID: 'Buddy aid in the trenches; evacuate cas when the fire lifts', REPORT: 'Shelrep / sitrep: cas, direction, crater analysis' },
    options: [
      { id: 'COVER_CB', text: 'Take cover under OHP; shelrep and request CB; ready to man posns as the fire lifts' },
      { id: 'MOVE_ALT', text: 'Move the locality to its altn posn' },
      { id: 'WITHDRAW', text: 'Withdraw the locality out of the fire' },
    ],
    legacy: { COVER_CB: ['TAKE_COVER', 'CB_REQ', 'STAND_BY_LIFT', 'REPORT'], MOVE_ALT: ['MOVE_ALT_POSN'], WITHDRAW: ['WITHDRAW_LOC'] },
    keyPoints: ['take cover in trenches and under overhead protection', 'send a shelrep and request counter-battery fire', 'be ready to man the posns as soon as the fire lifts — the assault may follow', 'buddy aid; evacuate casualties when the fire lifts', 'do not move in the open under fire unless the posn is located'],
  },
  {
    key: 'COMMS_LOST',
    title: 'Comms lost with a pl',
    situation: 'Radio comms with a fwd pl have been lost.',
    ref: `${REF.CP_CHQ}; ${REF.PRIORITY_OF_WORK}`,
    levels: ['COY', 'BN', 'BDE'],
    core: false,
    actions: ['ALT_FREQ', 'LINE_COMMS', 'RUNNER', 'PRE_ARRANGED', 'CONTINUE_PLAN', 'WITHDRAW_LOC', 'REPORT'],
    actionText: { CONTINUE_PLAN: 'Pl continues the battle on the last orders and the fire plan' },
    options: [
      { id: 'RESTORE', text: 'Alt freq; line to the pl; runner by a covered route; pl acts on pre-arranged signals' },
      { id: 'RUNNER_ONLY', text: 'Send a runner and wait' },
    ],
    legacy: { RESTORE: ['ALT_FREQ', 'LINE_COMMS', 'RUNNER', 'PRE_ARRANGED'], RUNNER_ONLY: ['RUNNER'] },
    keyPoints: ['switch to the alternate frequency', 'use line (field telephone) laid in the priority of work', 'send a runner by a covered route', 'pre-arranged signals and codewords; the pl fights on its last orders', 'report to higher HQ'],
  },
  {
    key: 'FLANK_GAP',
    title: 'Gap on a flank',
    situation: 'The flank sub-unit is falling back — a gap is opening on your flank.',
    ref: `${REF.ALL_ROUND}; ${REF.MUTUAL_SUPPORT}`,
    levels: ['COY', 'BN', 'BDE'],
    core: false,
    actions: ['REFUSE_FLANK', 'DF_GAP', 'PTL_GAP', 'HOLD_FAST', 'DEPTH_FILL', 'WITHDRAW_ALL', 'COORD_FLANK', 'REPORT'],
    actionText: { WITHDRAW_ALL: 'Conform — fall back with the flank sub-unit without orders', HOLD_FAST: 'Hold present posns' },
    options: [
      { id: 'REFUSE', text: 'Refuse the flank, cover the gap by fire and obsn, hold fast; inform Bn HQ and liaise with the flank' },
      { id: 'DEPTH', text: 'Commit the depth sub-unit to fill the gap' },
      { id: 'CONFORM', text: 'Conform — fall back with the flank sub-unit' },
    ],
    legacy: { REFUSE: ['REFUSE_FLANK', 'DF_GAP', 'PTL_GAP', 'HOLD_FAST', 'REPORT', 'COORD_FLANK'], DEPTH: ['DEPTH_FILL'], CONFORM: ['WITHDRAW_ALL'] },
    keyPoints: ['refuse the flank — readjust the flank locality to face the gap', 'cover the gap by observation and fire (DF, MG)', 'hold fast; do not withdraw without orders', 'inform Bn HQ and liaise with the flank sub-unit', 'do not commit the depth piecemeal without the higher comd'],
  },
  {
    key: 'CHQ_HIT',
    title: 'CHQ hit — comd cas',
    situation: 'CHQ has been hit; the comd is a cas.',
    ref: REF.CP_CHQ,
    levels: ['COY', 'BN', 'BDE'],
    core: false,
    actions: ['TWO_IC_COMD', 'CONTINUE_PLAN', 'MOVE_CHQ_ALT', 'WAIT_FOR_ORDERS', 'BUDDY_AID', 'REPORT'],
    actionText: { REPORT: 'Inform Bn HQ and all pls of the change of comd', BUDDY_AID: 'Treat and evacuate the CHQ cas' },
    options: [
      { id: 'TWO_IC', text: '2IC assumes comd; alt CHQ; pls continue per the plan; inform Bn HQ' },
      { id: 'WAIT', text: 'Pls await new orders' },
    ],
    legacy: { TWO_IC: ['TWO_IC_COMD', 'CONTINUE_PLAN', 'MOVE_CHQ_ALT', 'REPORT'], WAIT: ['WAIT_FOR_ORDERS'] },
    keyPoints: ['the 2IC assumes command at once', 'open the alternate CHQ / CP', 'platoons continue the battle per the plan', 'inform Bn HQ and all platoons of the change of command', 'evacuate the casualties'],
  },
  {
    key: 'CASEVAC',
    title: 'Cas evac under fire',
    situation: 'A fwd locality reports hy cas and requests cas evac while still under fire.',
    ref: REF.ADMIN,
    levels: ALL,
    core: false,
    actions: ['BUDDY_AID', 'CASEVAC_WHEN_PERMITS', 'SMOKE_COVER', 'REQ_AMB', 'STOP_FIGHT_EVAC', 'ALL_SB_FWD', 'REPORT'],
    actionText: { REPORT: 'Cas report to CHQ / Bn' },
    options: [
      { id: 'SOUND', text: 'Buddy aid in place; evacuate by stretcher bearers to the CAP when fire permits; request amb from the RAP' },
      { id: 'PULL_OUT', text: 'Pull riflemen out of the fight to carry the cas back' },
    ],
    legacy: { SOUND: ['BUDDY_AID', 'CASEVAC_WHEN_PERMITS', 'REQ_AMB', 'REPORT'], PULL_OUT: ['STOP_FIGHT_EVAC'] },
    keyPoints: ['buddy aid and medic triage in place', 'evacuate by stretcher bearers to the CAP by a covered route when fire permits', 'do not take riflemen out of the fight', 'request ambulance / evacuation from the Bn RAP', 'casualty report'],
  },
  {
    key: 'AMMO_LOW',
    title: 'Amn running low',
    situation: 'A locality in contact reports amn running low.',
    ref: REF.ADMIN,
    levels: ALL,
    core: false,
    actions: ['AMMO_REDIST', 'AMMO_REPLEN', 'AMMO_PRIORITY', 'FIRE_DISC', 'WITHDRAW_LOC', 'REPORT'],
    actionText: { AMMO_REDIST: 'Redistribute amn within the locality (riflemen to LMG nos)' },
    options: [
      { id: 'REPLEN', text: 'Redistribute within the locality, replenish from F ech by carrying party, tighten fire discipline' },
      { id: 'WITHDRAW', text: 'Withdraw the locality' },
    ],
    legacy: { REPLEN: ['AMMO_REDIST', 'AMMO_REPLEN', 'FIRE_DISC', 'REPORT'], WITHDRAW: ['WITHDRAW_LOC'] },
    keyPoints: ['redistribute ammunition within the locality, riflemen to the LMG numbers', 'replenish from the F echelon through the CHM by a carrying party on a covered route', 'tighten fire discipline — aimed fire at the killing area', 'priority of ammunition to the locality in contact', 'report state of ammunition'],
  },
  {
    key: 'EW_JAM',
    title: 'En EW — jamming',
    situation: 'The coy net is being jammed.',
    ref: `${REF.CP_CHQ}; comms SOPs`,
    levels: ALL,
    core: false,
    actions: ['ALT_FREQ', 'EMCON', 'LINE_COMMS', 'RUNNER', 'PRE_ARRANGED', 'TRANSMIT_CLEAR', 'REPORT'],
    actionText: { REPORT: 'Report the jamming to Bn HQ by alt means' },
    options: [
      { id: 'DRILLS', text: 'Anti-jamming drills: alt freq, EMCON, line and runners; report by alt means' },
      { id: 'PUSH', text: 'Keep transmitting in clear' },
    ],
    legacy: { DRILLS: ['ALT_FREQ', 'EMCON', 'LINE_COMMS', 'REPORT'], PUSH: ['TRANSMIT_CLEAR'] },
    keyPoints: ['anti-jamming drills — switch to the alternate frequency', 'EMCON: minimum, short, authenticated transmissions', 'use line and runners', 'report the jamming by alternate means', 'never transmit in clear'],
  },
  {
    key: 'EN_UAV',
    title: 'En UAV overhead',
    situation: 'An en UAV is circling over the posns.',
    ref: `${REF.SECURITY}; ${REF.FUNDAMENTALS}`,
    levels: ALL,
    core: false,
    actions: ['CAM_DISC', 'DISPERSE', 'ENGAGE_UAV', 'AD_REQ', 'PREP_ALT', 'REPORT'],
    actionText: { CAM_DISC: 'Freeze: strict cam & concealment, no mov', REPORT: 'Report the UAV (time, dir, ht) to Bn HQ' },
    options: [
      { id: 'CONCEAL', text: 'Freeze under cam, disperse, report; request AD; prepare to move to altn posns' },
      { id: 'ENGAGE', text: 'Engage the UAV with small arms' },
    ],
    legacy: { CONCEAL: ['CAM_DISC', 'DISPERSE', 'REPORT', 'AD_REQ', 'PREP_ALT'], ENGAGE: ['ENGAGE_UAV'] },
    keyPoints: ['freeze — strict camouflage and concealment, no movement', 'do not give away the positions by engaging with small arms', 'report the UAV and request air defence', 'be prepared to move to alternate positions — artillery may follow', 'disperse'],
  },
  {
    key: 'CIVILIANS',
    title: 'Civilians on the axis',
    situation: 'Refugees / civilians are moving along the axis towards the posn.',
    ref: 'LOAC; unit SOPs',
    levels: ALL,
    core: false,
    actions: ['NO_FIRE_CIV', 'ROUTE_CIV', 'SCREEN_INFIL', 'CLOSE_LANES', 'WARNING_SHOTS', 'LET_THROUGH', 'REPORT'],
    actionText: { REPORT: 'Report to Bn HQ (civ admin / police)', CLOSE_LANES: 'Keep the mfd lanes closed; do not let them through the posn' },
    options: [
      { id: 'CONTROL', text: 'Hold fire; route them off the axis clear of the posn via police / civ admin; screen for infiltrators; report' },
      { id: 'LET', text: 'Let them through the posn along the road' },
    ],
    legacy: { CONTROL: ['NO_FIRE_CIV', 'ROUTE_CIV', 'SCREEN_INFIL', 'CLOSE_LANES', 'REPORT'], LET: ['LET_THROUGH'] },
    keyPoints: ['do not fire on civilians (LOAC)', 'route them off the axis, clear of the position and minefields, through police / civil administration', 'screen them for enemy infiltrators', 'keep the minefield lanes closed', 'report to Bn HQ'],
  },
];

export const ALL_SITUATIONS: ContingencyDef[] = [...CONTINGENCIES, ...EXTRA_SITUATIONS];

/** Trigger catalogue for the student's own contingencies (all situations + OTHER). */
export const TRIGGERS: { key: string; title: string }[] = [...ALL_SITUATIONS.map((d) => ({ key: d.key, title: d.title })), { key: 'OTHER', title: 'Other (describe the situation)' }];

/** Actions offered for a student's own contingency on a trigger (OTHER = whole library). */
export function actionsForTrigger(trigger: string): string[] {
  const d = ALL_SITUATIONS.find((x) => x.key === trigger);
  return d ? d.actions : Object.keys(ACTIONS);
}

export function contingencyDef(key: string): ContingencyDef {
  const d = ALL_SITUATIONS.find((c) => c.key === key);
  if (!d) throw new Error(`unknown contingency ${key}`);
  return d;
}

export function findContingencyDef(key: string): ContingencyDef | undefined {
  return ALL_SITUATIONS.find((c) => c.key === key);
}

export function actionText(id: string, key?: string): string {
  const d = key ? findContingencyDef(key) : undefined;
  return d?.actionText?.[id] ?? ACTIONS[id]?.text ?? id;
}

export function optionText(key: string, id: string): string {
  const d = findContingencyDef(key);
  return d?.options.find((o) => o.id === id)?.text ?? (ACTIONS[id] ? actionText(id, key) : id);
}

/**
 * The actions of a stored choice: the explicit action list, else the legacy option(s) mapped
 * onto actions (a comma-joined reorg list is already a list of action ids).
 */
export function choiceActions(key: string, c: Pick<ContingencyChoice, 'option' | 'actions'> | undefined): string[] {
  if (!c) return [];
  if (c.actions) return [...c.actions];
  if (!c.option) return [];
  const d = findContingencyDef(key);
  const out: string[] = [];
  for (const o of c.option.split(',').filter(Boolean)) {
    const mapped = d?.legacy[o] ?? (ACTIONS[o] ? [o] : []);
    for (const a of mapped) if (!out.includes(a)) out.push(a);
  }
  return out;
}

/** A choice is "planned" when it has actions, a legacy option or free text. */
export function choicePlanned(c: ContingencyChoice | undefined): boolean {
  return !!c && (!!c.option || !!c.actions?.length || !!c.text?.trim());
}

/** Normalise a composer edit into a stored choice (option kept for backward compatibility). */
export function setChoiceActions(key: string, c: ContingencyChoice, actions: string[]): ContingencyChoice {
  const d = findContingencyDef(key);
  const next: ContingencyChoice = { ...c, actions: [...actions] };
  next.option = d?.multi ? actions.join(',') : quickPickFor(key, actions) ?? actions[0] ?? '';
  return next;
}

/** The quick pick whose action set equals the given actions (if any). */
export function quickPickFor(key: string, actions: string[]): string | undefined {
  const d = findContingencyDef(key);
  if (!d) return undefined;
  const set = new Set(actions);
  for (const [id, acts] of Object.entries(d.legacy)) if (acts.length === set.size && acts.every((a) => set.has(a))) return id;
  return undefined;
}

const NEG = /\b(no|not|don'?t|do not|never|without|avoid|nor)\b[\w\s/()-]{0,18}$/;

/**
 * Actions understood from a free-text order ("Call SOS, hold fire till the KA, inform Bn").
 * A keyword preceded closely by a negation ("do not withdraw") is ignored.
 */
export function inferActions(text: string | undefined, allowed?: string[]): string[] {
  if (!text?.trim()) return [];
  const t = ` ${text.toLowerCase().replace(/[’']/g, "'")} `;
  const out: string[] = [];
  for (const a of Object.values(ACTIONS)) {
    if (!a.kw || (allowed && !allowed.includes(a.id))) continue;
    const re = new RegExp(a.kw.source, 'g');
    let m: RegExpExecArray | null;
    while ((m = re.exec(t))) {
      const before = t.slice(Math.max(0, m.index - 24), m.index);
      if (!NEG.test(before)) {
        out.push(a.id);
        break;
      }
      if (re.lastIndex === m.index) re.lastIndex++;
    }
  }
  return out;
}

/** The custom contingency of the student that pre-plans a given situation, if any. */
export function customFor(list: CustomContingency[] | undefined, key: string): CustomContingency | undefined {
  return list?.find((c) => c.trigger === key && (c.actions.length || c.text.trim()));
}

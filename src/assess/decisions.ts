// Objective evaluation of contingency responses against the situation (or, at plan time,
// against what the plan makes possible). Same rules for pre-planned and live decisions.
//
// A response is a SET of actions (plus optional free text). Each action carries an additive
// doctrinal value for the situation (negative = harmful); combinations earn synergy bonuses
// (e.g. SOS + readjust + hold fire till the KA) and contradictory orders cost a penalty
// (e.g. "withdraw all" with "hold fast"). Missing the essential action of a situation caps
// the score. The total is normalised to 0..1 against what a complete sound response earns,
// so several different sound combinations reach BEST and a partial response gets partial
// credit. Free text adds a modest bonus (via the text judge) and is never penalised.

import { DOCTRINE, REF } from '../core/doctrine';
import type { CustomContingency, DecisionRecord } from '../core/types';
import { ACTIONS, actionText, choiceActions, findContingencyDef, inferActions } from '../plan/contingency';
import { getTextJudge, offlineJudge, offlineJudgement, type TextJudgement, type TextJudgeRequest } from './textJudge';

export interface DecisionContext {
  [k: string]: unknown;
  screens?: number;
  dfNearFaa?: boolean;
  armourSeen?: boolean;
  ucavLeft?: number;
  aqcAvail?: boolean;
  spAvailable?: boolean;
  spInRange?: boolean;
  glhmgInRange?: boolean;
  dfNearFup?: boolean;
  altPlanned?: number;
  threatOffAxis?: boolean;
  sosPlanned?: boolean;
  elementsLost?: number;
  depthAvailable?: boolean;
  catkPlanned?: boolean;
  cpenPlanned?: boolean;
  /** Minutes between the loss and the C attk launch (live) or the planned delay. */
  delay?: number;
  chosenUnitIsDepth?: boolean;
  /** EN_ARTY: the shelled locality has been located (registered) by the en. */
  located?: boolean;
  /** EN_ARTY / FLANK_GAP: an altn posn exists for the affected locality. */
  altAvailable?: boolean;
}

export interface Verdict {
  score: number;
  verdict: DecisionRecord['verdict'];
  rationale: string;
  ref: string;
  /** What was sound in the response. */
  strengths?: string[];
  /** What was missing or unsound. */
  gaps?: string[];
  /** Actions understood from the free text (not ticked). */
  understood?: string[];
  /** Judge note on the free text. */
  textNote?: string;
  /** Judge score (0..1) of the free text, if judged. */
  textScore?: number;
  /** The response had actions (text bonus) rather than text only. */
  hasActions?: boolean;
}

export function verdictOf(score: number): DecisionRecord['verdict'] {
  return score >= 0.85 ? 'BEST' : score >= 0.55 ? 'ACCEPTABLE' : score >= 0.25 ? 'POOR' : 'WRONG';
}

const V = (score: number, rationale: string, ref: string, extra: Partial<Verdict> = {}): Verdict => ({ score, verdict: verdictOf(score), rationale, ref, ...extra });

type Val = number | ((c: DecisionContext) => number | [number, string]);

interface Spec {
  values: Record<string, Val>;
  /** Why an action is sound (positive value) or unsound (negative value). */
  why: Record<string, string>;
  synergies?: { all: string[]; bonus: number; why: string; when?: (c: DecisionContext) => boolean }[];
  conflicts?: { a: string[]; b: string[]; penalty: number; why: string }[];
  /** If none of `any` is in the response, the score is capped. */
  core?: { any: string[]; cap: number; why: string }[];
  /** Value of a complete sound response (normalisation). */
  ideal?: number | ((c: DecisionContext) => number);
  /** Situation-specific adjustment (e.g. timing of a C attk). */
  post?: (score: number, sel: Set<string>, c: DecisionContext) => [number, string] | null;
  /** Per-action reference (otherwise the situation's). */
  refs?: Record<string, string>;
}

/** A partly sound action: credited, but its caveat is shown as a gap, not a strength. */
const mixed = (v: number, caveat: string): Val => Object.assign((): [number, string] => [v, caveat], { mixed: true });
const isMixed = (v: Val | undefined) => typeof v === 'function' && 'mixed' in v;

const catkTf = (c: DecisionContext) => {
  const delay = c.delay ?? 15;
  return delay <= DOCTRINE.coyCatkIdealMin ? 1 : delay <= DOCTRINE.coyCatkMaxMin ? 0.85 : delay <= 45 ? 0.5 : 0.3;
};

const SPECS: Record<string, Spec> = {
  SCREEN_CONTACT: {
    values: { ENGAGE_LONG: 0.35, DF_SCREEN: 0.2, WD_ON_ORDER: 0.3, REPORT: 0.1, STAND_TO: 0.05, CLOSE_LANES: 0.1, WITHDRAW_NOW: mixed(0.3, 'Withdrawing on first contact saves the screens but gives the en early, close obsn of the main posn without forcing him to deploy.'), HOLD_ALL_COSTS: -0.6, REINFORCE_SCREEN: -0.4 },
    why: {
      ENGAGE_LONG: 'Screens engage at long rg and force the en to deploy early.',
      DF_SCREEN: 'Arty / mor in sp of the screens adds delay and cas.',
      WD_ON_ORDER: 'Withdrawal on permission along a covered route before getting inextricably involved.',
      REPORT: 'Contact reported to higher HQ.',
      STAND_TO: 'Main posn warned.',
      CLOSE_LANES: 'Lanes closed behind the screens.',
      WITHDRAW_NOW: 'Withdrawing on first contact saves the screens but gives the en early, close obsn of the main posn without forcing him to deploy.',
      HOLD_ALL_COSTS: 'Screens must not get inextricably involved; they withdraw on orders, on 50% cas or when their time is up.',
      REINFORCE_SCREEN: 'Reinforcing screens from depth is piecemeal and weakens the main posn; screens are kept as small as possible.',
    },
    synergies: [{ all: ['ENGAGE_LONG', 'WD_ON_ORDER'], bonus: 0.1, why: 'Engage, then withdraw on permission — exactly the screen’s task.' }],
    conflicts: [
      { a: ['HOLD_ALL_COSTS'], b: ['WD_ON_ORDER', 'WITHDRAW_NOW'], penalty: 0.2, why: 'Contradictory orders: hold at all costs and withdraw.' },
      { a: ['WITHDRAW_NOW'], b: ['ENGAGE_LONG', 'DF_SCREEN'], penalty: 0.3, why: 'An immediate withdrawal contradicts engaging the en to make him deploy.' },
    ],
    core: [{ any: ['ENGAGE_LONG', 'DF_SCREEN', 'WITHDRAW_NOW'], cap: 0.45, why: 'The screens must force the en to deploy (or at least be saved for the main battle).' }],
    refs: { ENGAGE_LONG: REF.SCREEN_WITHDRAWAL, WD_ON_ORDER: REF.SCREEN_WITHDRAWAL, WITHDRAW_NOW: REF.SCREENS, REINFORCE_SCREEN: REF.SCREENS },
  },
  EN_PROBE: {
    values: { MIN_WPNS: 0.45, AGGR_PTL: 0.2, CAM_DISC: 0.2, CHECK_OBS: 0.1, REPORT: 0.1, ALL_WPNS: -0.3, DF_TGT: -0.15, HOLD_FIRE: mixed(0.3, 'Letting the ptl go unchallenged keeps the wpns hidden but allows it to locate gaps and lanes.') },
    why: {
      MIN_WPNS: 'Probing is frustrated firmly with minimum firepower from altn posns; the main wpns stay hidden.',
      AGGR_PTL: 'Aggressive ptls intercept the en ptl.',
      CAM_DISC: 'Strict fire control, cam and no unnec mov deny the en the location of wpns.',
      CHECK_OBS: 'Lanes and gaps checked.',
      REPORT: 'Reported to higher HQ.',
      ALL_WPNS: 'Engaging a ptl with all wpns gives away the whole fire plan to the en.',
      DF_TGT: 'DF should not be called if the en sighted is in small numbers.',
      HOLD_FIRE: 'Letting the ptl go unchallenged keeps the wpns hidden but allows it to locate gaps and lanes.',
    },
    synergies: [{ all: ['MIN_WPNS', 'CAM_DISC'], bonus: 0.05, why: 'Min wpns with strict discipline — the probe learns nothing.' }],
    conflicts: [
      { a: ['ALL_WPNS'], b: ['MIN_WPNS', 'CAM_DISC'], penalty: 0.1, why: 'All wpns contradicts min wpns / fire discipline.' },
      { a: ['HOLD_FIRE'], b: ['MIN_WPNS', 'AGGR_PTL'], penalty: 0.1, why: 'Hold fire contradicts engaging the ptl.' },
    ],
    core: [{ any: ['MIN_WPNS', 'AGGR_PTL'], cap: 0.35, why: 'The probe must be frustrated firmly.' }],
    refs: { DF_TGT: 'ICIB Sec 76 para 11a' },
  },
  EN_ASSEMBLY: {
    values: {
      DF_FAA: (c) => (c.dfNearFaa === false ? [0.45, 'Correct to engage the assembly, but the FAA was not picked up as a DF — fire is slower and less accurate.'] : 0.6),
      UCAV: (c) => ((c.ucavLeft ?? 1) <= 0 ? [-0.1, 'No UCAV sortie was available.'] : c.armourSeen === false ? [0.05, 'UCAV demand weakly justified — armr not confirmed; DF on the FAA was the primary means.'] : 0.45),
      AQC: (c) => (c.aqcAvail === false ? [-0.05, 'No A/QC was available.'] : 0.3),
      QC_SURV: 0.1,
      STAND_TO: 0.1,
      REPORT: 0.1,
      HOLD_FIRE: -0.2,
    },
    why: {
      DF_FAA: 'Positive info of assembly: DF called at once on a pre-selected DF covering the FAA.',
      UCAV: 'Justified demand: armr conc confirmed in the FAA, a high-value tgt worth the UCAV.',
      AQC: 'A/QC can harass the conc, though it has little effect on a dispersed assembly.',
      QC_SURV: 'The conc is kept under surv.',
      STAND_TO: 'Localities warned of the coming assault.',
      REPORT: 'Reported to higher HQ.',
      HOLD_FIRE: 'DF must be called as soon as positive info of en assembly is aval.',
    },
    synergies: [{ all: ['DF_FAA', 'UCAV'], bonus: 0.1, why: 'DF on the inf and UCAV on the armr — complementary.', when: (c) => c.armourSeen !== false && (c.ucavLeft ?? 1) > 0 }],
    conflicts: [{ a: ['HOLD_FIRE'], b: ['DF_FAA', 'UCAV', 'AQC'], penalty: 0.1, why: 'No action contradicts the fire ordered.' }],
    core: [{ any: ['DF_FAA', 'UCAV'], cap: 0.4, why: 'DF must be called as soon as positive info of en assembly is aval.' }],
    refs: { DF_FAA: `${REF.ASSAULT_PHASE}; ${REF.DF_SELECTION}`, UCAV: REF.BIC49, AQC: REF.BIC49, HOLD_FIRE: 'ICIB Sec 76 para 11a' },
  },
  EN_FORMING_UP: {
    values: {
      SPOIL_FIRE: (c) =>
        c.spInRange || c.glhmgInRange || (c.spInRange === undefined && c.glhmgInRange === undefined && c.spAvailable === undefined)
          ? 0.45
          : c.spAvailable
            ? [0.25, 'Right idea, but the spoiling force is not within effective rg of the FUP and has to close up first.']
            : [0, 'No tps were kept in proximity of the likely FUP — a spoiling attk must be pre-planned and rehearsed.'],
      DF_FUP: 0.4,
      SP_OBSERVE: 0.1,
      STAND_TO: 0.1,
      REPORT: 0.1,
      AQC: (c) => (c.aqcAvail === false ? 0 : 0.1),
      SOS: -0.25,
      SPOIL_ASSAULT: -0.5,
      HOLD_FIRE: -0.3,
    },
    why: {
      SPOIL_FIRE: 'Spoiling attk by fire on the FUP with pre-positioned tps and auto wpns: destroys part of the force, throws him off balance and gains time.',
      DF_FUP: 'DF (arty + mors) on the FUP.',
      SP_OBSERVE: 'The standing ptl keeps observing and reporting.',
      STAND_TO: 'Localities stood to; LPs warned.',
      REPORT: 'Reported to higher HQ.',
      AQC: 'A/QC adds to the disruption of the FUP.',
      SOS: 'DF (SOS) covers the most vulnerable apch close to the posn during the assault — firing it now wastes it.',
      SPOIL_ASSAULT: 'No physical assault is envisaged in a spoiling attk; committing the depth sub-unit risks its piecemeal loss and the C attk capability.',
      HOLD_FIRE: 'Waiting surrenders the best opportunity to disrupt the attk before it is launched.',
    },
    synergies: [{ all: ['SPOIL_FIRE', 'DF_FUP'], bonus: 0.1, why: 'Spoiling attk by fire coordinated with DF on the FUP.', when: (c) => !!(c.spInRange || c.glhmgInRange || c.spAvailable) || (c.spInRange === undefined && c.spAvailable === undefined) }],
    conflicts: [{ a: ['HOLD_FIRE'], b: ['SPOIL_FIRE', 'DF_FUP', 'SOS'], penalty: 0.1, why: 'Waiting contradicts the fire ordered.' }],
    core: [{ any: ['SPOIL_FIRE', 'DF_FUP'], cap: 0.3, why: 'The forming up must be disrupted by fire.' }],
    ideal: (c) => (c.spInRange || c.glhmgInRange || c.spAvailable || (c.spInRange === undefined && c.spAvailable === undefined) ? 1 : 0.75),
    refs: { SPOIL_ASSAULT: 'ICIB Sec 79 para 2a, 2c', SOS: REF.DF_SOS },
  },
  EN_ASSAULT: {
    values: {
      SOS: (c) => (c.sosPlanned === false ? [0.3, 'No DF (SOS) was planned — the emergency DF is slower and less accurate.'] : 0.4),
      READJUST_ALT: (c) => (c.threatOffAxis === false ? [0.05, 'The threat came on the primary arcs; readjustment was hardly needed.'] : (c.altPlanned ?? 1) > 0 ? 0.25 : [0, 'No altn posns were prepared — readjustment into unprepared posns under fire.']),
      HOLD_FIRE_KA: 0.15,
      AT_ENGAGE: 0.1,
      RECALL_LP: 0.05,
      REPORT: 0.1,
      ALL_WPNS: -0.3,
      DEPTH_FWD: -0.45,
    },
    why: {
      SOS: 'DF (SOS) brought down on the assault.',
      READJUST_ALT: 'Secs / wpns readjusted to prepared altn posns facing the actual threat.',
      HOLD_FIRE_KA: 'Small-arms fire held till the en enters the killing area.',
      AT_ENGAGE: 'A tk wpns engage the tks in the KA from flanking posns.',
      RECALL_LP: 'LPs recalled before the SOS.',
      REPORT: 'Higher HQ informed.',
      ALL_WPNS: 'Fire should be held till the en comes into the killing zone; opening at max rg wastes amn and gives the posn away.',
      DEPTH_FWD: 'Moving the depth sub-unit fwd commits the C attk force prematurely and destroys depth.',
    },
    synergies: [{ all: ['SOS', 'READJUST_ALT', 'HOLD_FIRE_KA'], bonus: 0.1, why: 'SOS, readjustment and fire held till the KA — the drill.', when: (c) => c.threatOffAxis !== false && (c.altPlanned ?? 1) > 0 }],
    conflicts: [{ a: ['ALL_WPNS'], b: ['HOLD_FIRE_KA'], penalty: 0.15, why: 'Opening fire at max rg contradicts holding fire till the KA.' }],
    core: [{ any: ['SOS'], cap: 0.45, why: 'DF (SOS) must be brought down on the assault.' }],
    ideal: (c) => (c.threatOffAxis === false ? 0.85 : 1),
    refs: { READJUST_ALT: REF.ALT_POSN, ALL_WPNS: REF.FIRE_PLAN, DEPTH_FWD: REF.DEPTH, SOS: REF.DF_SOS },
  },
  POST_LOST: {
    values: {
      LOCAL_CATK: (c) =>
        !c.depthAvailable && c.depthAvailable !== undefined
          ? [0.1, 'No uncommitted force was aval for a local C attk — reinforce and contain instead.']
          : (c.elementsLost ?? 1) > 2
            ? [0.2, 'Loss is beyond a sec or two — a local C attk by the depth sub-unit is unlikely to succeed; contain and request higher C attk.']
            : c.chosenUnitIsDepth === false
              ? [0.3 * catkTf(c), 'C attk ordered with a sub-unit already committed to holding gr — the depth sub-unit should be used.']
              : 0.55 * catkTf(c),
      REINFORCE_LOC: (c) => (c.depthAvailable === false ? 0.35 : 0.25),
      CPEN: mixed(0.2, 'C pen posns occupied — it limits the penetration, but is premature at the loss of a sec.'),
      REQ_HIGHER_CATK: (c) => ((c.elementsLost ?? 1) > 2 ? 0.3 : 0.05),
      DF_PEN: 0.15,
      FIRE_SP_ADJ: 0.1,
      HOLD_FAST: 0.1,
      REPORT: 0.1,
      WITHDRAW_LOC: -0.5,
    },
    why: {
      LOCAL_CATK: 'Loss of a sec or two is restored by an immediate local C attk with the depth sub-unit.',
      REINFORCE_LOC: 'The threatened locality is reinforced and the penetration contained.',
      CPEN: 'C pen posns occupied (premature at the loss of a sec, but it limits the penetration).',
      REQ_HIGHER_CATK: 'Higher C attk requested.',
      DF_PEN: 'DF on the penetration and the en follow-up tps.',
      FIRE_SP_ADJ: 'Fire sp from the adjacent locality.',
      HOLD_FAST: 'Adjacent posts hold fast and contain.',
      REPORT: 'Higher HQ informed.',
      WITHDRAW_LOC: 'A locality is not withdrawn; adjacent posts hold fast and contain the penetration.',
    },
    synergies: [{ all: ['LOCAL_CATK', 'DF_PEN'], bonus: 0.05, why: 'C attk supported by DF on the en follow-up tps.' }],
    conflicts: [
      { a: ['LOCAL_CATK'], b: ['REINFORCE_LOC'], penalty: 0.1, why: 'The depth sub-unit cannot both reinforce and C attk — piecemeal.' },
      { a: ['WITHDRAW_LOC'], b: ['HOLD_FAST', 'LOCAL_CATK'], penalty: 0.2, why: 'Withdrawing contradicts holding / restoring the posn.' },
    ],
    core: [{ any: ['LOCAL_CATK', 'REINFORCE_LOC', 'REQ_HIGHER_CATK', 'CPEN'], cap: 0.4, why: 'The posn must be restored or the penetration contained.' }],
    ideal: (c) => (c.depthAvailable === false ? 0.7 : 1),
    post: (score, sel, c) => {
      if (!sel.has('LOCAL_CATK')) return null;
      const delay = c.delay ?? 15;
      if (c.depthAvailable === false) return [Math.min(score, 0.35), ''];
      if ((c.elementsLost ?? 1) > 2) return [Math.min(score, 0.5), ''];
      if (c.chosenUnitIsDepth === false) return [Math.min(score, 0.55), ''];
      const tf = catkTf(c);
      if (tf >= 0.85) return [score, delay <= DOCTRINE.coyCatkIdealMin ? 'C attk launched fast, before the en could reorganise.' : 'C attk launched within 30 min.'];
      return [Math.min(score, tf >= 0.5 ? 0.6 : 0.4), `C attk after ${delay} min is too slow — the en will have reorganised (≤ ${DOCTRINE.coyCatkMaxMin} min).`];
    },
    refs: { LOCAL_CATK: `${REF.CATK_GUIDELINES}; ${REF.CATK_DECISION}`, CPEN: REF.COUNTER_PEN, WITHDRAW_LOC: REF.ASSAULT_PHASE, REQ_HIGHER_CATK: REF.CATK_GUIDELINES },
  },
  LOCALITY_LOST: {
    values: {
      HOLD_FAST: 0.2,
      CPEN: (c) => (c.cpenPlanned === false ? [0.15, 'No C pen posn was planned — it has to be improvised.'] : 0.25),
      REQ_HIGHER_CATK: 0.25,
      COORD_CATK: 0.1,
      DF_LOST_LOC: 0.2,
      REPORT: 0.1,
      OWN_CATK: (c) => (c.depthAvailable === false ? 0.1 : 0.3),
      WITHDRAW_ALL: -0.8,
    },
    why: {
      HOLD_FAST: 'Adjacent localities hold fast.',
      CPEN: 'The penetration is checked from the C pen posn.',
      REQ_HIGHER_CATK: 'C attk by the next higher comd requested.',
      COORD_CATK: 'SL, route, fire sp, guides and codewords coordinated for the higher C attk.',
      DF_LOST_LOC: 'DF on the lost locality stops the en reorganising.',
      REPORT: 'Higher HQ informed.',
      OWN_CATK: 'A C attk by the local comd against the loss of an entire locality is a difficult proposition.',
      WITHDRAW_ALL: 'Withdrawal without orders unhinges the def of the higher comd.',
    },
    synergies: [{ all: ['CPEN', 'REQ_HIGHER_CATK'], bonus: 0.05, why: 'Check the penetration and facilitate the higher C attk.' }],
    conflicts: [{ a: ['WITHDRAW_ALL'], b: ['HOLD_FAST', 'CPEN', 'REQ_HIGHER_CATK'], penalty: 0.2, why: 'Withdrawing contradicts holding / the higher C attk.' }],
    core: [{ any: ['CPEN', 'REQ_HIGHER_CATK'], cap: 0.55, why: 'Against the loss of an entire locality the comd checks the penetration and facilitates the C attk by the next higher comd.' }],
    refs: { CPEN: REF.COUNTER_PEN, REQ_HIGHER_CATK: REF.CATK_GUIDELINES, WITHDRAW_ALL: REF.FUNDAMENTALS },
  },
  REORG: {
    values: {
      CASEVAC_CHAIN: 0.1, BUDDY_AID: 0.1, AMMO_REDIST: 0.1, AMMO_REPLEN: 0.1, REPLACE_WPNS: 0.1, RESITE_WPNS: 0.1, MANPOWER: 0.1, RE_SURV: 0.1, SITREP: 0.1, MORALE: 0.1,
      EVAC_DEAD_FIRST: -0.15, ALL_SB_FWD: -0.15, STAND_DOWN: -0.15, MOVE_RR_FREE: -0.15,
    },
    why: {
      CASEVAC_CHAIN: 'Cas evac chain CAP → RAP → ADS.',
      BUDDY_AID: 'Buddy aid & triage.',
      AMMO_REDIST: 'Amn redistributed.',
      AMMO_REPLEN: 'Amn replenished from F ech.',
      REPLACE_WPNS: 'Knocked-out wpns replaced.',
      RESITE_WPNS: 'Located wpns resited.',
      MANPOWER: 'Manpower and comds readjusted.',
      RE_SURV: 'Surv re-established, gaps closed.',
      SITREP: 'Sitrep & cas report.',
      MORALE: 'Comds go round; morale.',
      EVAC_DEAD_FIRST: 'The wounded are evacuated before the dead.',
      ALL_SB_FWD: 'The CAP must not be left unmanned.',
      STAND_DOWN: 'Tps are not stood down before the posn is reorganised — the en may attack again.',
      MOVE_RR_FREE: 'RRs are moved only with the CO’s permission.',
    },
    ideal: 1,
  },
  // ------------------------------------------------------------------ inject-only situations
  EN_ARTY: {
    values: {
      TAKE_COVER: 0.3,
      CB_REQ: 0.2,
      REPORT: 0.15,
      STAND_BY_LIFT: 0.2,
      BUDDY_AID: 0.1,
      MOVE_ALT_POSN: (c) => (c.altAvailable === false ? [0, 'No altn posn was prepared.'] : c.located ? 0.15 : [0.05, 'Moving in the open under fire exposes the tps; worth it only if the posn has been located.']),
      WITHDRAW_LOC: -0.5,
    },
    why: {
      TAKE_COVER: 'Tps take cover in trenches / under OHP.',
      CB_REQ: 'Shelrep sent and CB fire requested.',
      REPORT: 'Shelrep / sitrep to higher HQ.',
      STAND_BY_LIFT: 'Ready to man the posns as soon as the fire lifts — the assault may follow the bombardment.',
      BUDDY_AID: 'Cas treated in place and evacuated when the fire lifts.',
      MOVE_ALT_POSN: 'Located locality moved to its prepared altn posn.',
      WITHDRAW_LOC: 'A locality is not abandoned under fire — that is what the bombardment is meant to achieve.',
    },
    conflicts: [{ a: ['WITHDRAW_LOC'], b: ['STAND_BY_LIFT', 'TAKE_COVER'], penalty: 0.1, why: 'Withdrawing contradicts holding the posn.' }],
    core: [{ any: ['TAKE_COVER', 'MOVE_ALT_POSN'], cap: 0.5, why: 'Tps in the open under arty suffer hy cas — they must take cover.' }],
  },
  COMMS_LOST: {
    values: { ALT_FREQ: 0.25, LINE_COMMS: 0.25, RUNNER: 0.2, PRE_ARRANGED: 0.15, CONTINUE_PLAN: 0.1, REPORT: 0.1, WITHDRAW_LOC: -0.5 },
    why: {
      ALT_FREQ: 'Alt freq tried at once.',
      LINE_COMMS: 'Line laid in the pri of work used as the back-up.',
      RUNNER: 'Runner sent by a covered route.',
      PRE_ARRANGED: 'Pre-arranged signals / codewords keep the pl in the fire plan.',
      CONTINUE_PLAN: 'The pl fights on its last orders.',
      REPORT: 'Higher HQ informed.',
      WITHDRAW_LOC: 'Loss of comms is no reason to withdraw a locality.',
    },
    core: [{ any: ['ALT_FREQ', 'LINE_COMMS', 'RUNNER'], cap: 0.4, why: 'Comms must be restored by alt means.' }],
  },
  FLANK_GAP: {
    values: { REFUSE_FLANK: 0.25, DF_GAP: 0.2, PTL_GAP: 0.15, HOLD_FAST: 0.15, COORD_FLANK: 0.15, REPORT: 0.2, DEPTH_FILL: -0.15, WITHDRAW_ALL: -0.7 },
    why: {
      REFUSE_FLANK: 'Flank refused — the flank locality / wpns face the gap from altn posns.',
      DF_GAP: 'The gap is covered by DF / MG fire.',
      PTL_GAP: 'The gap is watched.',
      HOLD_FAST: 'Posns held.',
      COORD_FLANK: 'Liaison with the flank sub-unit.',
      REPORT: 'Bn HQ informed and orders sought.',
      DEPTH_FILL: 'Committing the depth sub-unit piecemeal destroys the C attk capability; it is the higher comd’s decision.',
      WITHDRAW_ALL: 'Withdrawal without orders unhinges the def of the higher comd.',
    },
    conflicts: [{ a: ['WITHDRAW_ALL'], b: ['HOLD_FAST', 'REFUSE_FLANK'], penalty: 0.2, why: 'Withdrawing contradicts holding the posn.' }],
    core: [{ any: ['REFUSE_FLANK', 'DF_GAP', 'PTL_GAP'], cap: 0.45, why: 'The gap must be covered by obsn and fire (all-round def).' }],
    refs: { WITHDRAW_ALL: REF.FUNDAMENTALS, DEPTH_FILL: REF.DEPTH },
  },
  CHQ_HIT: {
    values: { TWO_IC_COMD: 0.35, CONTINUE_PLAN: 0.2, MOVE_CHQ_ALT: 0.15, REPORT: 0.15, BUDDY_AID: 0.1, WAIT_FOR_ORDERS: -0.3 },
    why: {
      TWO_IC_COMD: 'The 2IC assumes comd at once.',
      CONTINUE_PLAN: 'Pls continue the battle per the plan.',
      MOVE_CHQ_ALT: 'Alt CHQ opened.',
      REPORT: 'Bn HQ and pls told of the change of comd.',
      BUDDY_AID: 'CHQ cas treated and evacuated.',
      WAIT_FOR_ORDERS: 'Pls waiting for orders lose the initiative at the critical moment.',
    },
    core: [{ any: ['TWO_IC_COMD'], cap: 0.4, why: 'Comd must be re-established at once.' }],
  },
  CASEVAC: {
    values: { BUDDY_AID: 0.3, CASEVAC_WHEN_PERMITS: 0.3, REQ_AMB: 0.15, REPORT: 0.15, SMOKE_COVER: 0.1, ALL_SB_FWD: -0.25, STOP_FIGHT_EVAC: -0.35 },
    why: {
      BUDDY_AID: 'Buddy aid and triage in place.',
      CASEVAC_WHEN_PERMITS: 'Stretcher bearers evacuate to the CAP by a covered route when fire permits.',
      REQ_AMB: 'Evac from the RAP requested.',
      REPORT: 'Cas report sent.',
      SMOKE_COVER: 'Evac covered by smoke / fire.',
      ALL_SB_FWD: 'The CAP must not be left unmanned.',
      STOP_FIGHT_EVAC: 'Riflemen are not taken out of the fight to carry cas.',
    },
    core: [{ any: ['BUDDY_AID', 'CASEVAC_WHEN_PERMITS'], cap: 0.4, why: 'The wounded must be treated and evacuated.' }],
  },
  AMMO_LOW: {
    values: { AMMO_REDIST: 0.25, AMMO_REPLEN: 0.3, AMMO_PRIORITY: 0.15, FIRE_DISC: 0.2, REPORT: 0.1, WITHDRAW_LOC: -0.5 },
    why: {
      AMMO_REDIST: 'Amn redistributed within the locality.',
      AMMO_REPLEN: 'Replenished from F ech by carrying party.',
      AMMO_PRIORITY: 'Pri of amn to the locality in contact.',
      FIRE_DISC: 'Fire discipline tightened.',
      REPORT: 'State of amn reported.',
      WITHDRAW_LOC: 'Shortage of amn is met by replenishment, not by giving up the gr.',
    },
    core: [{ any: ['AMMO_REPLEN', 'AMMO_REDIST'], cap: 0.4, why: 'Amn must be redistributed / replenished.' }],
  },
  EW_JAM: {
    values: { ALT_FREQ: 0.2, EMCON: 0.25, LINE_COMMS: 0.25, RUNNER: 0.1, PRE_ARRANGED: 0.1, REPORT: 0.15, TRANSMIT_CLEAR: -0.4 },
    why: {
      ALT_FREQ: 'Alt freq.',
      EMCON: 'EMCON — min, short, authenticated transmissions.',
      LINE_COMMS: 'Line used.',
      RUNNER: 'Runners.',
      PRE_ARRANGED: 'Pre-arranged signals.',
      REPORT: 'Jamming reported by alt means.',
      TRANSMIT_CLEAR: 'Transmitting in clear on a jammed net gives the en DF and intelligence.',
    },
    core: [{ any: ['ALT_FREQ', 'LINE_COMMS', 'EMCON'], cap: 0.4, why: 'Anti-jamming drills are required.' }],
  },
  EN_UAV: {
    values: { CAM_DISC: 0.35, REPORT: 0.15, AD_REQ: 0.15, PREP_ALT: 0.15, DISPERSE: 0.1, ENGAGE_UAV: -0.25 },
    why: {
      CAM_DISC: 'Tps freeze under cam — the UAV sees nothing.',
      REPORT: 'UAV reported.',
      AD_REQ: 'AD / C-UAS requested.',
      PREP_ALT: 'Ready to move to altn posns if located.',
      DISPERSE: 'Dispersal reduces the tgt.',
      ENGAGE_UAV: 'Small arms rarely bring a UAV down and give the posns away.',
    },
    conflicts: [{ a: ['ENGAGE_UAV'], b: ['CAM_DISC'], penalty: 0.1, why: 'Engaging contradicts concealment.' }],
    core: [{ any: ['CAM_DISC'], cap: 0.45, why: 'Concealment is the first defence against obsn.' }],
  },
  CIVILIANS: {
    values: { NO_FIRE_CIV: 0.2, ROUTE_CIV: 0.3, SCREEN_INFIL: 0.2, CLOSE_LANES: 0.15, REPORT: 0.15, WARNING_SHOTS: -0.15, LET_THROUGH: -0.3 },
    why: {
      NO_FIRE_CIV: 'No fire on civilians (LOAC).',
      ROUTE_CIV: 'Routed off the axis, clear of the posn, through police / civ admin.',
      SCREEN_INFIL: 'Screened for en infiltrators.',
      CLOSE_LANES: 'Lanes kept closed.',
      REPORT: 'Reported to Bn HQ.',
      WARNING_SHOTS: 'Warning shots cause panic and reveal the posn.',
      LET_THROUGH: 'Letting them through the posn compromises it and may let infiltrators in.',
    },
    core: [{ any: ['ROUTE_CIV'], cap: 0.5, why: 'The civilians must be controlled and moved off the axis.' }],
  },
};

/** Generic values for a student's own contingency on an OTHER trigger. */
const GENERIC: Record<string, number> = {
  REPORT: 0.15, HOLD_FAST: 0.15, STAND_TO: 0.1, CAM_DISC: 0.1, TAKE_COVER: 0.1, DF_TGT: 0.1, SOS: 0.05, COORD_FLANK: 0.1, BUDDY_AID: 0.1, CASEVAC_WHEN_PERMITS: 0.1,
  AMMO_REPLEN: 0.05, ALT_FREQ: 0.05, LINE_COMMS: 0.05, RUNNER: 0.05, PRE_ARRANGED: 0.05, MOVE_ALT_POSN: 0.05, READJUST_ALT: 0.05, FIRE_DISC: 0.05, PTL_GAP: 0.05, AGGR_PTL: 0.05,
  WITHDRAW_ALL: -0.4, WITHDRAW_LOC: -0.2, HOLD_ALL_COSTS: -0.1, STAND_DOWN: -0.2, ALL_WPNS: -0.1, TRANSMIT_CLEAR: -0.3, EVAC_DEAD_FIRST: -0.2, ALL_SB_FWD: -0.2, LET_THROUGH: -0.2, WAIT_FOR_ORDERS: -0.2,
};

/** Action wording without its trailing explanation, for compact rationales. */
function shortAction(a: string, key: string): string {
  return actionText(a, key).split(' — ')[0].split('; ')[0];
}

const valOf = (v: Val | undefined, c: DecisionContext): [number, string | undefined] => {
  if (v === undefined) return [0, undefined];
  if (typeof v === 'number') return [v, undefined];
  const r = v(c);
  return Array.isArray(r) ? [r[0], r[1]] : [r, undefined];
};

export interface ResponseInput {
  actions?: string[];
  option?: string;
  options?: string[];
  text?: string;
}

/** The actions of a response: explicit actions, else the legacy option(s) mapped to actions. */
export function responseActions(key: string, r: ResponseInput): string[] {
  if (r.actions) return [...new Set(r.actions)];
  if (r.options?.length) return choiceActions(key, { option: r.options.join(',') });
  return choiceActions(key, { option: r.option ?? '' });
}

/** Text-judge request for the free text of a response. */
export function textRequest(id: string, key: string, text: string, situation?: string): TextJudgeRequest {
  const d = findContingencyDef(key);
  return {
    id,
    task: `Your orders / course of action: ${d?.title ?? key}`,
    situation: situation ?? d?.situation ?? '',
    keyPoints: d?.keyPoints ?? ['report to higher HQ', 'hold the posn and keep it covered by fire', 'keep the depth for the C attk', 'look after the cas and amn'],
    answer: text,
  };
}

/**
 * Evaluates a composed response. `judgement` is the text judge's view of the free text
 * (computed offline when omitted).
 */
export function evaluateResponse(key: string, r: ResponseInput, ctx: DecisionContext = {}, judgement?: TextJudgement | null): Verdict {
  const spec = SPECS[key];
  const d = findContingencyDef(key);
  const baseRef = d?.ref ?? '';
  if (!spec) return V(0.5, 'Not assessed.', baseRef);
  const ticked = responseActions(key, r).filter((a) => a in spec.values || ACTIONS[a]);
  const text = r.text?.trim() ?? '';
  const understood = inferActions(text, Object.keys(spec.values)).filter((a) => !ticked.includes(a));
  const sel = new Set([...ticked, ...understood]);
  const strengths: string[] = [];
  const gaps: string[] = [];
  const refs = new Set<string>();
  let total = 0;
  const contrib: { a: string; v: number }[] = [];
  for (const a of sel) {
    const [v, note] = valOf(spec.values[a], ctx);
    const w = understood.includes(a) ? (v > 0 ? 0.8 : 0.5) : 1;
    total += v * w;
    contrib.push({ a, v: v * w });
    const why = note ?? spec.why[a];
    if (v > 0.001 && !note) strengths.push(why ?? actionText(a, key));
    else if (v > 0.001 && note) gaps.push(note);
    else if (v < 0) gaps.push(why ?? `${actionText(a, key)} — unsound here.`);
    else if (note) gaps.push(note);
    if (v !== 0 && spec.refs?.[a]) refs.add(spec.refs[a]);
  }
  for (const s of spec.synergies ?? []) {
    if (s.all.every((a) => sel.has(a)) && (!s.when || s.when(ctx))) {
      total += s.bonus;
      strengths.push(s.why);
    }
  }
  for (const c of spec.conflicts ?? []) {
    if (c.a.some((a) => sel.has(a)) && c.b.some((b) => sel.has(b))) {
      total -= c.penalty;
      gaps.push(c.why);
    }
  }
  const ideal = typeof spec.ideal === 'function' ? spec.ideal(ctx) : spec.ideal ?? 1;
  let score = Math.max(0, Math.min(1, total / ideal));
  for (const c of spec.core ?? []) {
    if (!c.any.some((a) => sel.has(a))) {
      if (sel.size) score = Math.min(score, c.cap);
      gaps.unshift(c.why);
    }
  }
  if (spec.post) {
    const p = spec.post(score, sel, ctx);
    if (p) {
      if (p[1]) (p[0] < score - 1e-9 ? gaps : strengths).push(p[1]);
      score = p[0];
    }
  }
  // what a fuller answer would have included
  // (never suggest an action that would contradict what was chosen, or a merely partly sound one)
  const clashes = (a: string) => (spec.conflicts ?? []).some((c) => (c.a.includes(a) && c.b.some((b) => sel.has(b))) || (c.b.includes(a) && c.a.some((x) => sel.has(x))));
  const missing = Object.keys(spec.values)
    .filter((a) => !sel.has(a) && !clashes(a) && !isMixed(spec.values[a]))
    .map((a) => ({ a, v: valOf(spec.values[a], ctx)[0] }))
    .filter((x) => x.v >= 0.15)
    .sort((x, y) => y.v - x.v)
    .slice(0, key === 'REORG' ? 4 : 2);
  // free text: a modest bonus, never a penalty
  let textNote: string | undefined;
  let textScore: number | undefined;
  if (text) {
    const j = judgement === undefined ? offlineJudgement(textRequest(key, key, text)) : judgement;
    if (j) {
      textNote = j.note;
      textScore = j.score;
      if (sel.size) score = Math.min(1, score + 0.1 * j.score);
      else score = Math.max(score, 0.55 * j.score);
      if (j.score >= 0.5) strengths.push(`Your own words cover the key points (${j.source === 'AI' ? 'AI judge' : 'keyword check'}).`);
    }
  }
  if (!sel.size && !text) {
    return V(0, 'No action taken — the situation was left to develop.', baseRef, { strengths: [], gaps: ['No action taken.', ...missing.map((m) => `Consider: ${actionText(m.a, key)}`)] });
  }
  score = Math.max(0, Math.min(1, score));
  const parts: string[] = [];
  if (strengths.length) parts.push([...new Set(strengths)].slice(0, 3).join(' '));
  if (gaps.length) parts.push([...new Set(gaps)].slice(0, 3).join(' '));
  if (missing.length && score < 0.95) parts.push(`Consider also: ${missing.map((m) => shortAction(m.a, key)).join('; ')}.`);
  if (key === 'REORG') {
    const good = [...sel].filter((a) => (spec.values[a] as number) > 0).length;
    parts.unshift(`${good}/${Object.values(spec.values).filter((v) => (v as number) > 0).length} reorg actions correct.`);
  }
  const ref = [...new Set([baseRef, ...refs].flatMap((x) => x.split('; ')).filter(Boolean))].join('; ');
  return V(score, parts.join(' '), ref, { strengths: [...new Set(strengths)], gaps: [...new Set([...gaps, ...missing.map((m) => `Consider: ${actionText(m.a, key)}`)])], understood, textNote, textScore, hasActions: sel.size > 0 });
}

/**
 * Legacy single-option API (kept for v1 plans, the AI and tests): the option (or reorg list)
 * is mapped onto its action set and evaluated.
 */
export function evaluateDecision(key: string, option: string, ctx: DecisionContext, options: string[] = []): Verdict {
  if (!SPECS[key]) return V(0.5, 'Not assessed.', '');
  return evaluateResponse(key, options.length ? { options } : { option }, ctx, null);
}

/** Marks a student's own contingency: relevance and soundness of the response (modest weight). */
export function evaluateCustom(c: CustomContingency, ctx: DecisionContext = {}, judgement?: TextJudgement | null): Verdict {
  const text = `${c.situation ?? ''}\n${c.text ?? ''}`.trim();
  if (c.trigger !== 'OTHER' && SPECS[c.trigger]) {
    const v = evaluateResponse(c.trigger, { actions: c.actions, text: c.text }, ctx, judgement);
    return v;
  }
  // OTHER: soundness of the actions in general, relevance by the free text
  const acts = [...new Set([...c.actions, ...inferActions(c.text)])];
  let v = 0.2;
  const good: string[] = [];
  const bad: string[] = [];
  for (const a of acts) {
    const g = GENERIC[a] ?? 0.03;
    v += g;
    if (g > 0.04) good.push(actionText(a));
    if (g < 0) bad.push(actionText(a));
  }
  const j = text ? (judgement === undefined ? offlineJudgement({ id: c.id, task: 'Own contingency', situation: c.situation, keyPoints: ['report to higher HQ', 'covered by fire / obsn', 'keep the depth sub-unit for the C attk', 'hold the posn', 'cas evac and amn', 'warn the localities'], answer: text }) : judgement) : null;
  if (!c.situation.trim()) v -= 0.15;
  if (j) v = 0.6 * v + 0.4 * Math.max(v, j.score);
  const score = Math.max(0, Math.min(1, v));
  const r = `${c.situation.trim() ? 'Relevant situation described.' : 'Situation not described.'} ${good.length ? `Sound: ${good.slice(0, 3).join('; ')}.` : ''} ${bad.length ? `Unsound: ${bad.join('; ')}.` : ''}${j ? ` ${j.note}` : ''}`.trim();
  return V(score, r, REF.FUNDAMENTALS, { strengths: good, gaps: bad, textNote: j?.note });
}

/** Short description of a response for tables and the AAR. */
export function describeResponse(key: string, r: ResponseInput): string {
  const acts = responseActions(key, r);
  const t = acts.map((a) => actionText(a, key)).join(' | ');
  return t || (r.text?.trim() ? `“${r.text.trim()}”` : 'No action');
}

/**
 * Re-marks the free text of live decisions with the registered text judge (the AI judge when
 * configured): the text bonus computed offline at the time is replaced by the judge's. Mutates
 * the records. A no-op with the offline judge.
 */
export async function rejudgeDecisions(records: DecisionRecord[]): Promise<void> {
  const judge = getTextJudge();
  if (judge === offlineJudge) return;
  const todo = records.filter((r) => r.text?.trim() && !r.unmarked);
  if (!todo.length) return;
  let res: (TextJudgement | null)[] = [];
  try {
    res = await judge.judge(todo.map((r, i) => textRequest(`DEC_${r.key}_${i}`, r.key, r.text!)));
  } catch {
    return;
  }
  todo.forEach((r, i) => {
    const j = res[i];
    if (!j) return;
    const old = r.textScore ?? 0;
    const acts = (r.actions?.length ?? 0) + (r.understood?.length ?? 0) > 0;
    r.score = Math.max(0, Math.min(1, acts ? r.score + 0.1 * (j.score - old) : Math.max(0.55 * j.score, r.score - 0.55 * old + 0.55 * j.score)));
    r.verdict = verdictOf(r.score);
    r.textScore = j.score;
    r.textNote = j.note;
    if (j.source === 'AI') r.aiNote = j.note;
  });
}

// Objective evaluation of contingency options against the situation (or, at plan time,
// against what the plan makes possible). Same rules for pre-planned and live decisions.

import { DOCTRINE, REF } from '../core/doctrine';
import type { DecisionRecord } from '../core/types';
import { REORG_CORRECT, REORG_WRONG, contingencyDef, optionText } from '../plan/contingency';

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
}

export interface Verdict {
  score: number;
  verdict: DecisionRecord['verdict'];
  rationale: string;
  ref: string;
}

const V = (score: number, rationale: string, ref: string): Verdict => ({
  score,
  verdict: score >= 0.85 ? 'BEST' : score >= 0.55 ? 'ACCEPTABLE' : score >= 0.25 ? 'POOR' : 'WRONG',
  rationale,
  ref,
});

export function evaluateDecision(key: string, option: string, ctx: DecisionContext, options: string[] = []): Verdict {
  switch (key) {
    case 'SCREEN_CONTACT':
      if (option === 'ENGAGE_WITHDRAW') return V(1, 'Screens engage at long rg, force early deployment and withdraw on permission along a covered route before getting inextricably involved.', REF.SCREEN_WITHDRAWAL);
      if (option === 'WITHDRAW_NOW') return V(0.3, 'Withdrawing on first contact gives the en early, close obsn of the main posn without forcing him to deploy.', REF.SCREENS);
      if (option === 'HOLD_ALL_COSTS') return V(0, 'Screens must not get inextricably involved; they withdraw on orders, on 50% cas or when their time is up.', REF.SCREEN_WITHDRAWAL);
      return V(0.1, 'Reinforcing screens from depth is piecemeal and weakens the main posn; screens are kept as small as possible.', REF.SCREENS);
    case 'EN_PROBE':
      if (option === 'MIN_FIRE_ALT') return V(1, 'Probing is frustrated firmly with minimum firepower from altn posns; strict fire control denies the en the location of wpns.', REF.ASSAULT_PHASE);
      if (option === 'ALL_WPNS') return V(0.2, 'Engaging a ptl with all wpns gives away the whole fire plan to the en.', REF.ASSAULT_PHASE);
      if (option === 'DF_ON_PTL') return V(0.2, 'DF should not be called if the en sighted is in small numbers.', 'ICIB Sec 76 para 11a');
      return V(0.3, 'Letting the ptl go unchallenged allows it to locate wpns, gaps and lanes.', REF.ASSAULT_PHASE);
    case 'EN_ASSEMBLY':
      if (option === 'DF_FAA') return ctx.dfNearFaa ? V(1, 'Positive info of assembly: DF called at once on a pre-selected DF covering the FAA.', `${REF.ASSAULT_PHASE}; ${REF.DF_SELECTION}`) : V(0.75, 'Correct to engage the assembly, but the FAA was not picked up as a DF — fire is slower and less accurate.', REF.DF_SELECTION);
      if (option === 'UCAV_FAA') {
        if ((ctx.ucavLeft ?? 0) <= 0) return V(0, 'No UCAV sortie was available.', REF.BIC49);
        return ctx.armourSeen ? V(1, 'Justified demand: armr conc confirmed in the FAA, a high-value tgt worth the UCAV.', REF.BIC49) : V(0.5, 'UCAV demand weakly justified — armr not confirmed; DF on the FAA was the primary means.', REF.BIC49);
      }
      if (option === 'AQC_FAA') return ctx.aqcAvail ? V(0.6, 'A/QC can harass the conc but has little effect on a dispersed assembly; DF is the primary response.', REF.BIC49) : V(0.1, 'No A/QC was available.', REF.BIC49);
      return V(0.2, 'DF must be called as soon as positive info of en assembly is aval.', 'ICIB Sec 76 para 11a');
    case 'EN_FORMING_UP':
      if (option === 'SPOIL_FIRE') {
        if (ctx.spInRange || ctx.glhmgInRange) return V(1, 'Spoiling attk by fire on the FUP with pre-positioned tps and auto wpns + DF: destroys part of the force, throws him off balance and gains time. No physical assault.', REF.SPOILING);
        if (ctx.spAvailable) return V(0.6, 'Right idea, but the spoiling force is not within effective rg of the FUP and has to close up first.', REF.SPOILING);
        return V(0.3, 'No tps were kept in proximity of the likely FUP — a spoiling attk must be pre-planned and rehearsed.', 'ICIB Sec 79 paras 2b, 4');
      }
      if (option === 'DF_FUP') return ctx.spAvailable || ctx.glhmgInRange ? V(0.7, 'DF on the FUP is correct but the pre-positioned force could have added a spoiling attk by fire.', REF.SPOILING) : V(0.85, 'With no spoiling force in range, DF on the FUP is the best aval response.', REF.SPOILING);
      if (option === 'SPOIL_ASSAULT') return V(0.05, 'No physical assault is envisaged in a spoiling attk; committing the depth sub-unit risks its piecemeal loss and the C attk capability.', 'ICIB Sec 79 para 2a, 2c');
      if (option === 'SOS_NOW') return V(0.25, 'DF (SOS) covers the most vulnerable apch close to the posn during the assault — firing it now wastes it.', REF.DF_SOS);
      return V(0.1, 'Waiting surrenders the best opportunity to disrupt the attk before it is launched.', REF.SPOILING);
    case 'EN_ASSAULT':
      if (option === 'SOS_READJUST') {
        if ((ctx.altPlanned ?? 0) === 0) return V(0.6, 'DF (SOS) correct, but no altn posns were prepared — readjustment into unprepared posns under fire.', REF.ALT_POSN);
        return ctx.threatOffAxis ? V(1, 'DF (SOS) called; secs/wpns readjusted to prepared altn posns facing the actual threat; fire held till the killing area.', `${REF.ASSAULT_PHASE}; ${REF.ALT_POSN}`) : V(0.8, 'Sound, though the threat came on the primary arcs and readjustment was not needed.', REF.ASSAULT_PHASE);
      }
      if (option === 'SOS_HOLD') return ctx.threatOffAxis ? V(0.7, 'DF (SOS) correct, but the threat came from a flank and wpns should have shifted to altn posns.', REF.ALT_POSN) : V(1, 'DF (SOS) called and the posn fought from primary arcs facing the threat.', REF.DF_SOS);
      if (option === 'ALL_FIRE') return V(0.2, 'Fire should be held till the en comes into the killing zone; opening at max rg wastes amn and gives the posn away.', REF.FIRE_PLAN);
      return V(0.1, 'Moving the depth sub-unit fwd commits the C attk force prematurely and destroys depth.', REF.DEPTH);
    case 'POST_LOST': {
      const delay = ctx.delay ?? 15;
      const tf = delay <= DOCTRINE.coyCatkIdealMin ? 1 : delay <= DOCTRINE.coyCatkMaxMin ? 0.85 : delay <= 45 ? 0.5 : 0.3;
      if (option === 'LOCAL_CATK') {
        if (!ctx.depthAvailable) return V(0.3, 'No uncommitted force was aval for a local C attk — reinforce and contain instead.', REF.CATK_DECISION);
        if ((ctx.elementsLost ?? 1) > 2) return V(0.45, 'Loss is beyond a sec or two — a local C attk by the depth sub-unit is unlikely to succeed; contain and request higher C attk.', REF.CATK_GUIDELINES);
        if (ctx.chosenUnitIsDepth === false) return V(0.5 * tf, 'C attk ordered with a sub-unit already committed to holding gr — the depth sub-unit should be used.', REF.CATK_PLAN);
        return V(tf, `Loss of a sec or two is restored by an immediate local C attk with the depth sub-unit${delay <= DOCTRINE.coyCatkIdealMin ? ' — launched fast, before the en could reorganise' : delay <= DOCTRINE.coyCatkMaxMin ? ' within 30 min' : ` but ${delay} min is too slow — the en will have reorganised`}.`, `${REF.CATK_GUIDELINES}; ${REF.CATK_DECISION}`);
      }
      if (option === 'REINFORCE_CONTAIN') return V(ctx.depthAvailable ? 0.6 : 0.85, ctx.depthAvailable ? 'Containing is sound but the opportunity for a quick local C attk was not taken.' : 'With no uncommitted force, reinforcing and containing is the correct course.', REF.ASSAULT_PHASE);
      if (option === 'CPEN') return V(0.35, 'Counter-penetration is for a penetration beyond the capability of a local C attk — premature at the loss of a sec.', REF.COUNTER_PEN);
      if (option === 'HIGHER_CATK') return V(0.3, 'Loss of a sec or two should be restored by the local comd with his own depth tps.', REF.CATK_GUIDELINES);
      return V(0, 'A locality is not withdrawn; adjacent posts hold fast and contain the penetration.', REF.ASSAULT_PHASE);
    }
    case 'LOCALITY_LOST':
      if (option === 'CPEN_HIGHER') return V(1, 'Against the loss of an entire locality the comd checks the penetration (C pen / readjustment) and facilitates the C attk by the next higher comd, with full coord.', `${REF.CATK_GUIDELINES}; ${REF.COUNTER_PEN}`);
      if (option === 'OWN_CATK') return V(ctx.depthAvailable ? 0.35 : 0.15, 'A C attk by the local comd against the loss of an entire locality is a difficult proposition.', REF.CATK_GUIDELINES);
      if (option === 'DF_HOLD') return V(0.55, 'DF on the lost locality and holding is sound but does not restore the posn; higher C attk should be requested.', REF.COUNTER_PEN);
      return V(0, 'Withdrawal without orders unhinges the def of the higher comd.', REF.FUNDAMENTALS);
    case 'REORG': {
      const sel = options.length ? options : option.split(',').filter(Boolean);
      const good = sel.filter((o) => REORG_CORRECT.includes(o)).length;
      const bad = sel.filter((o) => REORG_WRONG.includes(o));
      const score = Math.max(0, Math.min(1, (good - 1.5 * bad.length) / REORG_CORRECT.length));
      const missed = REORG_CORRECT.filter((o) => !sel.includes(o)).map((o) => optionText('REORG', o).split(':')[0].split(' by')[0]);
      return V(score, `${good}/${REORG_CORRECT.length} reorg actions correct${bad.length ? `; wrong: ${bad.map((b) => optionText('REORG', b)).join('; ')}` : ''}${missed.length ? `. Missed: ${missed.slice(0, 4).join('; ')}` : ''}.`, contingencyDef('REORG').ref);
    }
    default:
      return V(0.5, 'Not assessed.', '');
  }
}

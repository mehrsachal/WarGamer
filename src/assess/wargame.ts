// Assessment of the conduct of battle: outcome, decisions at the injects, and
// fire discipline / use of resources. Combined with the plan score into the final grade.

import { DOCTRINE, REF, gradeFor } from '../core/doctrine';
import type { AssessmentResult, ScoreItem, WargameRecord } from '../core/types';
import { findContingencyDef } from '../plan/contingency';
import type { Engine } from '../sim/engine';
import { redPlanTextFinal } from '../sim/red';
import { scoreItem, summarise } from './plan';

function item(id: string, group: string, title: string, weight: number, score: number, detail: string, ref: string): ScoreItem {
  return scoreItem(id, group, title, weight, score, detail, ref);
}

export function assessWargame(e: Engine): AssessmentResult {
  const sm = e.summary();
  const items: ScoreItem[] = [];
  // ---------------------------------------------------------------- outcome
  const g1 = 'Outcome';
  const res = sm.result === 'HELD' ? 1 : sm.result === 'PARTIAL' ? 0.65 : 0.2;
  items.push(item('RESULT', g1, 'Msn accomplished (def held)', 8, res, sm.resultText, REF.DEF_DEFINITIONS));
  const ownPct = sm.ownCas / Math.max(1, sm.ownStart);
  const enPct = sm.enCas / Math.max(1, sm.enStart);
  items.push(item('ATTRITION', g1, 'Max attrition on the en', 4, enPct / 0.5, `${sm.enCas} en cas (${Math.round(enPct * 100)}% of the attacking force).`, REF.DEF_DEFINITIONS));
  items.push(item('OWN_CAS', g1, 'Own cas kept low', 3, 1 - ownPct / 0.6, `${sm.ownCas} own cas (${Math.round(ownPct * 100)}%).`, REF.FUNDAMENTALS));
  if (sm.tanksStart) items.push(item('TANKS', g1, 'En armr destroyed', 2, sm.tanksKilled / sm.tanksStart, `${sm.tanksKilled}/${sm.tanksStart} tks destroyed.`, REF.AT_SITING));
  items.push(item('VITAL', g1, 'Vital gr held', 3, sm.vitalHeld ? 1 : 0, sm.vitalHeld ? 'Vital gr in own hands at the end.' : 'Vital gr lost.', REF.DEF_DEFINITIONS));
  // ---------------------------------------------------------------- decisions
  const g2 = 'Decisions at injects';
  for (const d of e.decisions) {
    // inject-only situations handled by SOPs in auto mode are not marked
    if (d.unmarked) continue;
    const pre = d.changed ? ' (changed from your contingency plan)' : '';
    const how = d.source === 'MAP' ? ' [orders on the map]' : d.source === 'PREPLANNED' ? ' [contingency plan]' : d.source === 'SOP' ? ' [SOP — not pre-planned]' : '';
    const core = findContingencyDef(d.key)?.core !== false;
    const id = e.decisions.filter((x) => x.key === d.key).length > 1 ? `DEC_${d.key}_${d.time}` : `DEC_${d.key}`;
    items.push(item(id, g2, d.title, d.key === 'REORG' ? 2 : core ? 3 : 2, d.score, `${e.timeStr(d.time)} — ${d.optionText}${d.text && !d.optionText.includes(d.text) ? ` · “${d.text}”` : ''}${pre}${how}. ${d.rationale}`, d.ref));
  }
  // ---------------------------------------------------------------- conduct
  const g3 = 'Conduct & fire discipline';
  const wasted = (e.flags.wastedDf as number) ?? 0;
  items.push(item('DF_DISC', g3, 'DF not wasted on small numbers', 2, 1 - wasted * 0.34, wasted ? `${wasted} DF / fire mission(s) called on small or no tgts.` : 'Fire called only on worthwhile tgts.', 'ICIB Sec 76 para 11a'));
  if (e.marks.h1) items.push(item('SOS_CALLED', g3, 'DF (SOS) brought down on the assault', 2, e.marks.sosCalled ? 1 : 0, e.marks.sosCalled ? `DF (SOS) called ${e.timeStr(e.marks.sosCalled)}.` : 'DF (SOS) never called during the assault.', REF.DF_SOS));
  if (e.marks.hDelayed) items.push(item('DISRUPT', g3, 'En attk disrupted before H hr', 2, Math.min(1, e.marks.hDelayed / 20), `H hr delayed by ${e.marks.hDelayed} min.`, REF.SPOILING));
  const unj = (e.flags.ucavUnjustified as number) ?? 0;
  const just = (e.flags.ucavJustified as number) ?? 0;
  if (unj || just) items.push(item('UCAV', g3, 'UCAV demanded only when justified', 1, unj ? 0.3 : 1, `${just} justified, ${unj} rejected demand(s).`, REF.BIC49));
  if (e.marks.firstElementLost && e.marks.catkLaunched) {
    const dt = e.marks.catkLaunched - e.marks.firstElementLost;
    items.push(item('CATK_TIME', g3, 'Speed of local C attk', 2, dt <= DOCTRINE.coyCatkIdealMin ? 1 : dt <= DOCTRINE.coyCatkMaxMin ? 0.75 : 0.3, `C attk launched ${dt} min after the loss (within ${DOCTRINE.coyCatkMaxMin} min required).`, REF.CATK_GUIDELINES));
  }
  if (e.marks.screenWithdrawn !== undefined) {
    const cas = (e.flags.screenWithdrawCas as number) ?? 0;
    const early = e.marks.screenAttacked === undefined && e.screenPolicy === 'WITHDRAW_NOW';
    items.push(item('SCREEN_WD', g3, 'Screens withdrew in time', 1, cas >= 0.5 ? 0.3 : early ? 0.4 : 1, `Screens withdrew ${e.timeStr(e.marks.screenWithdrawn)} with ${Math.round(cas * 100)}% cas.`, REF.SCREEN_WITHDRAWAL));
  }
  return summarise(items);
}

export function finalScore(planPct: number, wargamePct: number, planWeight: number, adj = 0): { pct: number; grade: string; text: string } {
  const pct = Math.max(0, Math.min(100, planWeight * planPct + (1 - planWeight) * wargamePct + adj));
  const g = gradeFor(pct);
  return { pct, grade: g.grade, text: g.text };
}

export function wargameRecord(e: Engine): WargameRecord {
  return {
    summary: e.summary(),
    decisions: e.decisions,
    orders: e.orders,
    log: e.log,
    assessment: assessWargame(e),
    frames: e.frames,
    enemyPlanText: redPlanTextFinal(e),
    units: e.units.filter((u) => u.state !== 'OFFMAP' || u.side === 'BLUE').map((u) => ({ id: u.id, sidc: u.sidc, label: u.side === 'RED' ? u.label.replace('En ', '') : u.label, side: u.side, start: u.start })),
    causes: e.causes,
    enemyPlan: {
      faa: e.redPlan.faa,
      fup: e.redPlan.fup,
      bof: e.redPlan.bof,
      faaName: e.redPlan.faaName,
      fupName: e.redPlan.fupName,
      bofName: e.redPlan.bofName,
      approach: e.s.ds.approaches.find((a) => a.id === e.redPlan.approachId)?.path ?? [],
      objectives: e.redPlan.objectives.map((o) => ({ pos: o.pos, name: o.name, phase: o.phase })),
    },
  };
}

// Manual orders the student can give at any time during the wargame.

import { dist } from '../core/geom';
import { launchCatk, moveTo, withdrawToMain } from './blue';
import { alive, type Engine } from './engine';
import { fireDf, fireOnPoint, launchAttackQc, requestUcav, retaskSurvQc } from './fires';
import type { ManualOrder } from './types';

export function executeOrder(e: Engine, o: ManualOrder): string {
  let msg = '';
  switch (o.type) {
    case 'DF': {
      const df = e.dfs.find((d) => d.id === o.dfId);
      if (!df) return 'Unknown DF.';
      const near = [...e.contacts.values()].filter((c) => c.conf > 0.3 && dist(c.pos, df.pos) < df.radius + 250);
      const strength = near.reduce((m, c) => m + (e.byId.get(c.unitId)?.strength ?? 0), 0);
      if (near.length === 0 || strength < 12) {
        e.flags.wastedDf = ((e.flags.wastedDf as number) ?? 0) + 1;
      } else e.flags.goodDf = ((e.flags.goodDf as number) ?? 0) + 1;
      if (df.sos) e.marks.sosCalled = e.marks.sosCalled ?? e.t;
      msg = fireDf(e, df, df.sos ? 6 : 5);
      break;
    }
    case 'FIRE_CONTACT': {
      const c = e.contacts.get(o.contactId);
      if (!c) return 'Tgt no longer held.';
      const u = e.byId.get(c.unitId);
      if (!u || u.strength < 12) e.flags.wastedDf = ((e.flags.wastedDf as number) ?? 0) + 1;
      else e.flags.goodDf = ((e.flags.goodDf as number) ?? 0) + 1;
      msg = fireOnPoint(e, c.pos, o.asset, o.asset === 'MOR60' ? 3 : 5, `fire on ${c.ident === 'ARMOUR' ? 'tks' : 'en'} ${e.terrain.squareRef(c.pos)}`);
      break;
    }
    case 'QC_SURV':
      msg = retaskSurvQc(e, o.target);
      break;
    case 'QC_RECALL': {
      const q = e.qcs.find((x) => x.kind === 'SURV' && x.airborne);
      if (q) {
        q.airborne = false;
        q.readyAt = e.t + Math.round((e.t - q.launchedAt) * 0.8);
        msg = 'Surv QC recalled.';
      } else msg = 'No QC airborne.';
      break;
    }
    case 'AQC':
      msg = launchAttackQc(e, o.contactId);
      break;
    case 'UCAV': {
      const r = requestUcav(e, o.contactId, o.justification);
      e.flags[r.justified ? 'ucavJustified' : 'ucavUnjustified'] = ((e.flags[r.justified ? 'ucavJustified' : 'ucavUnjustified'] as number) ?? 0) + 1;
      msg = r.msg;
      break;
    }
    case 'MOVE_ALT': {
      const u = e.byId.get(o.unitId);
      if (!u || !alive(u)) return 'Unit not aval.';
      if (!u.altPos) return `${u.label} has no altn posn planned.`;
      moveTo(e, u, u.altPos, 'MOVE', false);
      u.task = 'Readjusting to altn posn';
      msg = `${u.label} moving to altn posn.`;
      break;
    }
    case 'WITHDRAW': {
      const u = e.byId.get(o.unitId);
      if (!u || !alive(u)) return 'Unit not aval.';
      withdrawToMain(e, u, 'ordered');
      msg = `${u.label} ordered to withdraw.`;
      break;
    }
    case 'CATK': {
      const u = e.byId.get(o.unitId);
      if (!u || !alive(u)) return 'Unit not aval.';
      const loc = e.units.filter((x) => x.side === 'BLUE' && (x.state === 'CAPTURED' || x.elements.some((el) => el.lost))).sort((a, b) => dist(a.pos, o.target) - dist(b.pos, o.target))[0];
      msg = launchCatk(e, u, loc && dist(loc.pos, o.target) < 600 ? loc : undefined, 5);
      if (!loc) {
        const tgt = e.red().filter((r) => dist(r.pos, o.target) < 500).sort((a, b) => dist(a.pos, o.target) - dist(b.pos, o.target))[0];
        u.targetId = tgt?.id;
      }
      break;
    }
    case 'CPEN': {
      const u = e.byId.get(o.unitId);
      if (!u || !alive(u)) return 'Unit not aval.';
      const cp = e.plan.graphics.find((g) => g.kind === 'CPEN' && (!g.props.unitId || g.props.unitId === u.id)) ?? e.plan.graphics.find((g) => g.kind === 'CPEN');
      if (!cp) return 'No C pen posn planned.';
      moveTo(e, u, cp.pts[0], 'MOVE');
      u.task = 'Occupy C pen posn';
      msg = `${u.label} occupying C pen posn.`;
      break;
    }
    case 'HOLD': {
      const u = e.byId.get(o.unitId);
      if (!u) return 'Unit not aval.';
      u.path = [];
      u.state = 'POSN';
      u.catk = false;
      msg = `${u.label} holding.`;
      break;
    }
  }
  e.orders.push({ time: e.t, text: msg });
  e.addLog(`ORDER: ${msg}`, 'info');
  return msg;
}

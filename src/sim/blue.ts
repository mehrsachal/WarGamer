// Autonomous behaviour of own (BLUE) sub-units between the commander's decisions.

import { type Vec, add, bearing, dist, distToPolyline } from '../core/geom';
import { TEMPLATES } from '../core/units';
import { alive, type Engine } from './engine';
import { fireOnPoint } from './fires';
import type { SimUnit } from './types';

function knownRedNear(e: Engine, p: Vec, r: number, minStr = 0): SimUnit[] {
  const out: SimUnit[] = [];
  for (const [id, c] of e.contacts) {
    if (c.conf < 0.3) continue;
    const u = e.byId.get(id);
    if (!u || !alive(u) || u.strength < minStr) continue;
    if (dist(c.pos, p) <= r) out.push(u);
  }
  return out;
}

export function moveTo(e: Engine, u: SimUnit, to: Vec, state: SimUnit['state'] = 'MOVE', avoidRed = true): void {
  const avoid = avoidRed
    ? [...e.contacts.values()].filter((c) => c.conf > 0.3).map((c) => ({ pos: c.pos, r: 600, w: 8 }))
    : [];
  u.path = e.terrain.findPath(u.pos, e.terrain.clampPt(to), u.mode, { avoid, preferCover: 0.6 });
  u.pathIdx = 0;
  u.state = state;
}

function parentOf(e: Engine, u: SimUnit): SimUnit | undefined {
  const p = u.parentId ? e.byId.get(u.parentId) : undefined;
  if (p && alive(p)) return p;
  return e.nearestBlueLocality(u.pos);
}

export function withdrawToMain(e: Engine, u: SimUnit, why: string): void {
  if (u.state === 'WITHDRAW') return;
  const home = u.role === 'SCREEN' ? e.nearestBlueLocality(u.pos, ['DEPTH', 'FDL']) : parentOf(e, u);
  // screens fall back into depth (re-tasked as res); detachments rejoin their parent
  const dest = home ? add(home.pos, u.role === 'SCREEN' ? { x: 120, y: home.role === 'DEPTH' ? -150 : -450 } : { x: 60, y: -120 }) : add(u.pos, { x: 0, y: -800 });
  moveTo(e, u, dest, 'WITHDRAW');
  u.task = `Withdrawing — ${why}`;
  e.marks[`withdraw_${u.id}`] = e.t;
  if (u.role === 'SCREEN') {
    e.marks.screenWithdrawn = e.marks.screenWithdrawn ?? e.t;
    e.flags.screenWithdrawCas = 1 - u.strength / Math.max(1, u.start);
  }
  e.addLog(`${u.label} withdrawing to the main posn (${why}).`, 'info');
}

export function recallLps(e: Engine): void {
  for (const lp of e.blue().filter((u) => u.role === 'LP' && (u.task === 'LP' || u.task === 'LP — moving out'))) {
    withdrawToMain(e, lp, 'recalled before DF (SOS)');
    e.flags[`lpIn_${lp.id}`] = e.t;
  }
}

export function launchCatk(e: Engine, force: SimUnit, locality: SimUnit | undefined, delay: number, bonus = 1): string {
  if (!alive(force)) return `${force.label} not aval.`;
  const target = locality
    ? e.red().filter((r) => r.kind !== 'ARMOUR' && dist(r.pos, locality.pos) < 450).sort((a, b) => dist(a.pos, locality.pos) - dist(b.pos, locality.pos))[0]
    : undefined;
  force.catk = true;
  force.restoreId = locality?.id;
  force.targetId = target?.id;
  force.bonus = bonus;
  force.waitUntil = e.t + Math.max(1, delay);
  force.task = `C attk on ${locality ? e.where(locality.pos) : 'penetration'} — H+${delay}`;
  e.marks.catkOrdered = e.t;
  e.marks.catkLaunch = e.t + delay;
  return `C attk by ${force.label} ordered; launching in ${delay} min.`;
}

export function runBlue(e: Engine): void {
  const t = e.t;
  const night = e.light !== 'DAY';
  for (const u of e.blue()) {
    // ---------------------------------------------------------------- LPs
    if (u.role === 'LP') {
      if (u.task === 'LP (by ni)' && night && e.light === 'NIGHT' && u.state === 'POSN' && !e.flags[`lpIn_${u.id}`]) {
        const { minOfDay } = { minOfDay: ((t % 1440) + 1440) % 1440 };
        const fl = e.s.times.light.firstLight;
        if (minOfDay < fl && fl - minOfDay < 90) continue; // not worth mounting just before first lt
        moveTo(e, u, u.home, 'MOVE', false);
        u.task = 'LP — moving out';
      } else if (u.task === 'LP — moving out' && u.pathIdx >= u.path.length) {
        u.state = 'POSN';
        u.task = 'LP';
        u.dug = 0.2;
      } else if (u.task === 'LP' && (!night || knownRedNear(e, u.pos, 320, 15).length || (e.redPhase === 'ASSAULT1' && knownRedNear(e, u.pos, 700, 20).length))) {
        withdrawToMain(e, u, night ? 'en closing in' : 'first lt');
        e.flags[`lpIn_${u.id}`] = night ? t : 0;
      } else if (u.state === 'WITHDRAW' && u.pathIdx >= u.path.length) {
        u.state = 'POSN';
        u.task = 'LP (by ni)';
        u.dug = 0.7;
      }
      continue;
    }
    // ---------------------------------------------------------------- standing patrol
    if (u.role === 'SP_PTL') {
      const spoiling = e.flags.spoilBy === u.id && (e.marks.spoilUntil ?? 0) >= t;
      if (spoiling) {
        const fup = e.redPlan.fup;
        if (dist(u.pos, fup) > 550 && dist(u.pos, fup) < 1300 && u.state !== 'MOVE') {
          const dir = { x: u.pos.x - fup.x, y: u.pos.y - fup.y };
          const L = Math.hypot(dir.x, dir.y) || 1;
          moveTo(e, u, { x: fup.x + (dir.x / L) * 450, y: fup.y + (dir.y / L) * 450 }, 'MOVE', false);
          u.task = 'Spoiling attk — closing to fire posn';
        } else if (u.state === 'MOVE' && u.pathIdx >= u.path.length) {
          u.state = 'POSN';
          u.task = 'Spoiling attk by fire';
        }
        continue;
      }
      if (e.flags.spoilBy === u.id && (e.marks.spoilUntil ?? 0) < t && u.state !== 'WITHDRAW' && !e.marks[`withdraw_${u.id}`]) {
        withdrawToMain(e, u, 'spoiling attk complete');
        continue;
      }
      // a standing ptl stays concealed; by day it is recalled before a strong en reaches it and is
      // re-established at last lt to watch the likely FUP (ICIB Sec 43 paras 1-4)
      const compromised = (e.redIntel.get(u.id)?.conf ?? 0) > 0.5 && knownRedNear(e, u.pos, 400, 30).length > 0;
      const dayThreat = e.light === 'DAY' && knownRedNear(e, u.pos, 1200, 60).length > 0;
      if (u.state === 'POSN' && u.task !== 'SP (recalled)' && (compromised || dayThreat || u.supp > 0.35 || (e.redPhase === 'ASSAULT1' && knownRedNear(e, u.pos, 700, 30).length) || u.strength / u.start < 0.6)) {
        withdrawToMain(e, u, compromised ? 'compromised — en closing in' : dayThreat ? 'recalled by day, en adv' : 'en too strong');
        if (dayThreat && u.strength / u.start >= 0.6) e.flags[`spRedeploy_${u.id}`] = true;
      }
      if (u.state === 'WITHDRAW' && u.pathIdx >= u.path.length) {
        u.state = 'POSN';
        if (e.flags[`spRedeploy_${u.id}`]) {
          u.task = 'SP (recalled)';
          u.dug = 0.5;
        } else {
          u.role = 'RES';
          u.task = 'Back in main posn';
          u.dug = 0.3;
        }
      }
      // re-establish at last lt if the area is clear of known en
      if (u.task === 'SP (recalled)' && e.light !== 'DAY' && e.redPhase !== 'ASSAULT1' && e.redPhase !== 'ASSAULT2' && !knownRedNear(e, u.home, 600, 20).length) {
        e.flags[`spRedeploy_${u.id}`] = false;
        moveTo(e, u, u.home, 'MOVE', true);
        u.task = 'SP — re-establishing at last lt';
        e.addLog(`${u.label} moving out to re-establish ${e.where(u.home)}.`, 'info');
      }
      if (u.task === 'SP — re-establishing at last lt' && u.pathIdx >= u.path.length && u.state !== 'WITHDRAW') {
        u.state = 'POSN';
        u.task = 'Standing ptl';
        u.dug = 0.3;
        e.marks[`withdraw_${u.id}`] = 0;
      }
      continue;
    }
    // ---------------------------------------------------------------- screens
    if (u.role === 'SCREEN') {
      if (u.state === 'WITHDRAW' && u.pathIdx >= u.path.length) {
        u.state = 'POSN';
        u.role = 'RES';
        u.task = 'Screen — back in main posn';
        u.dug = 0.3;
        continue;
      }
      if (u.state !== 'POSN' || !e.fired.has('SCREEN_CONTACT')) continue;
      const pol = e.screenPolicy;
      if (pol === 'HOLD_ALL_COSTS') continue;
      const loss = 1 - u.strength / Math.max(1, u.start);
      const strong = knownRedNear(e, u.pos, 800, 60).length > 0;
      const assaulted = e.red().some((r) => r.state === 'ASSAULT' && r.targetId === u.id && dist(r.pos, u.pos) < 450);
      if (loss >= 0.3 || strong || assaulted || (e.redPhase === 'ASSAULT1' && knownRedNear(e, u.pos, 1500, 30).length)) withdrawToMain(e, u, loss >= 0.3 ? `${Math.round(loss * 100)}% cas` : 'en deploying for attk');
      continue;
    }
    // ---------------------------------------------------------------- counter-attack launch
    if (u.catk && u.state !== 'ASSAULT' && u.waitUntil !== undefined && t >= u.waitUntil) {
      u.waitUntil = undefined;
      const loc = u.restoreId ? e.byId.get(u.restoreId) : undefined;
      let tgt = u.targetId ? e.byId.get(u.targetId) : undefined;
      if (!tgt || !alive(tgt)) {
        tgt = loc ? e.red().filter((r) => r.kind !== 'ARMOUR' && dist(r.pos, loc.pos) < 500).sort((a, b) => dist(a.pos, loc.pos) - dist(b.pos, loc.pos))[0] : undefined;
        u.targetId = tgt?.id;
      }
      if (!tgt) {
        u.catk = false;
        u.task = 'C attk cancelled — no en in the area';
        e.addLog(`${u.label}: C attk cancelled, no en found on the obj.`, 'info');
        continue;
      }
      // planned C attk route (flank) if one was marked for this locality
      const route = e.plan.graphics.find((g) => g.kind === 'CATK' && loc && dist(g.pts[g.pts.length - 1], loc.pos) < 300);
      const pts = route ? [...route.pts.slice(1, -1), tgt.pos] : e.terrain.findPath(u.pos, tgt.pos, 'FOOT', { preferCover: 0.6 });
      u.path = pts;
      u.pathIdx = 0;
      u.state = 'ASSAULT';
      u.speed = TEMPLATES[u.key].speed * 1.2;
      u.dug = 0;
      u.task = `C attk on ${e.where(tgt.pos)}${route ? ' (planned route)' : ''}`;
      e.marks.catkLaunched = e.marks.catkLaunched ?? t;
      e.addLog(`${u.label} launches C attk ${route ? 'along the planned route ' : ''}on ${e.where(tgt.pos)}.`, 'warn');
      continue;
    }
    // ---------------------------------------------------------------- readjustment / C pen moves complete
    if ((u.state === 'MOVE' || u.state === 'HALT') && !u.catk && u.task.startsWith('Readjust')) {
      if (u.pathIdx >= u.path.length) {
        u.state = 'POSN';
        u.dug = e.readiness > 0.75 ? Math.min(u.dug, 0.65) : 0.3;
        u.task = 'In altn posn';
        const threat = e.redPlan.fup;
        u.facing = bearing(u.pos, threat);
        u.elements.forEach((el) => void el);
      }
    } else if ((u.state === 'MOVE' || u.state === 'HALT') && !u.catk && u.task.startsWith('Occupy')) {
      if (u.pathIdx >= u.path.length) {
        u.state = 'POSN';
        u.dug = 0.3;
        u.task = 'In C pen posn';
      }
    } else if (u.state === 'HALT' && !u.catk) {
      u.state = 'POSN';
    }
  }

  // ---------------------------------------------------------------- higher (Bn / Bde) counter-attack
  const hc = e.flags.higherCatk as { at: number; locId: string; bonus: number } | undefined;
  if (hc && t >= hc.at) {
    e.flags.higherCatk = undefined;
    const loc = e.byId.get(hc.locId);
    if (loc) {
      const key = e.s.level === 'BN' || e.s.level === 'BDE' ? 'INF_BN' : e.s.level === 'PL' ? 'RIFLE_PL' : 'RIFLE_COY';
      const aorYs = e.s.own.aor.map((p) => p.y);
      const start = { x: loc.pos.x + 200, y: Math.max(Math.min(...aorYs) + 100, loc.pos.y - 1600) };
      const label = e.s.level === 'PL' ? 'Depth Pl (Coy C attk)' : e.s.level === 'COY' ? 'D Coy (Bn C attk)' : 'Res (higher C attk)';
      const f = e.makeUnit('BLUE', key, `blue_hc_${t}`, label, start, 0, 'RES', undefined, 0);
      f.state = 'POSN';
      e.addLog(`${label} has arrived for the C attk; SL secured.`, 'info');
      launchCatk(e, f, loc, 5, hc.bonus);
    }
  }

  // ---------------------------------------------------------------- fire support continues during the assault
  const sos = e.marks.sosCalled;
  if (sos && t - sos >= 8 && t - sos <= 90 && (t - sos) % 10 === 0) {
    const assault = [...e.contacts.values()].filter((c) => c.conf > 0.4 && e.fdlDistance(c.pos) < 900 && e.byId.get(c.unitId)?.state === 'ASSAULT');
    const big = assault.sort((a, b) => e.fdlDistance(a.pos) - e.fdlDistance(b.pos))[0];
    if (big) {
      const last = e.flags.lastAdjust as { x: number; y: number } | undefined;
      if (!last || dist(last, big.pos) > 150) {
        e.flags.lastAdjust = big.pos;
        const msg = fireOnPoint(e, big.pos, 'ARTY', 4, 'FOO adjusting fire on the assault');
        if (!msg.includes('not aval')) e.addLog(msg, 'info');
      }
      if (e.s.own.fire.mor81 && e.ammo.MOR81 > 0) fireOnPoint(e, big.pos, 'MOR81', 4, '81mm on assaulting en');
    }
  }
  // coy 60mm mors on en closing in on the FDLs
  if (e.ammo.MOR60 > 0 && t % 6 === 0) {
    const close = [...e.contacts.values()].filter((c) => c.conf > 0.5 && c.moving && e.fdlDistance(c.pos) < 600 && e.fdlDistance(c.pos) > 120);
    if (close.length && (e.redPhase === 'ASSAULT1' || e.redPhase === 'ASSAULT2')) fireOnPoint(e, close[0].pos, 'MOR60', 3, '60mm on en closing in');
  }
  void distToPolyline;
}

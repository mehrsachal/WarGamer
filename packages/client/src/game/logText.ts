// CBT-08: every log item in plain words.
import type { LogItem, MapModel, Ruleset, Side } from '@tht/engine';
import { t } from '../i18n';

const sideName = (s: Side | null) => (s ? t(`side.${s}`) : t('obj.none'));

export function logText(it: LogItem, data: Ruleset, map: MapModel, viewer: Side): string {
  const gr = (h: { q: number; r: number } | null) => (h && map.has(h) ? map.gridRef(h) : '?');
  const weapon = (id: string) => data.weapons.get(id)?.name ?? id;
  switch (it.k) {
    case 'turn_start':
      return t('log.turnStart', { turn: it.turn, side: sideName(it.side) });
    case 'turn_end':
      return t('log.turnEnd', { side: sideName(it.side) });
    case 'battle_start':
      return t('log.battleStart');
    case 'deploy_done':
      return t('log.deployDone', { side: sideName(it.side) });
    case 'move':
      return it.side === viewer ? t('log.move', { name: it.name, mp: it.mp, band: t(it.band === 'dash' ? 'posture.dashed' : 'posture.moved') }) : t('log.moveEnemy', { name: it.name });
    case 'contact':
      return t('log.contact', { name: it.name });
    case 'spotted':
      return t('log.spotted', { type: data.units.get(it.typeId)?.name ?? it.typeId, gr: gr(it.hex) });
    case 'fire': {
      const result = t(`result.${it.effect}`);
      const p = Math.round(it.p * 100);
      if (!it.shooterName) return t('log.fireHidden', { target: it.targetName, result });
      return t(it.indirect ? 'log.fireIndirect' : 'log.fire', { shooter: it.shooterName, weapon: weapon(it.weaponId), target: it.targetName, p, roll: it.roll, result });
    }
    case 'impact':
      return it.sourceName ? t('log.impact', { source: it.sourceName, gr: gr(it.hex), observed: it.observed ? '' : t('log.unobserved') }) : t('log.impactEnemy', { gr: gr(it.hex) });
    case 'arty_called':
      return t('log.armed', { name: it.name, turn: it.impactTurn, gr: gr(it.hex), left: it.missionsLeft });
    case 'arty_available':
      return t('log.available', { name: it.name, n: it.missions });
    case 'rally':
      return t('log.rally', { name: it.name, chance: Math.round(it.chance * 100), roll: it.roll, ok: t(it.ok ? 'log.rallyOk' : 'log.rallyFail') });
    case 'mount':
      return t('log.mount', { name: it.name || '?', vehicle: it.vehicleName });
    case 'dismount':
      return t('log.dismount', { name: it.name || '?', vehicle: it.vehicleName });
    case 'passenger_loss':
      return t('log.passenger', { name: it.name || '?', lost: t(it.lost ? 'log.passengerLost' : 'log.passengerOk') });
    case 'uav_recovered':
      return t('log.uav', { name: it.name });
    case 'objective':
      return t('log.objective', { name: it.name, side: sideName(it.to) });
    case 'vp':
      return t('log.vp', { blue: it.blue, red: it.red });
    case 'game_over':
      return t('log.gameOver', { result: it.result.winner ? t('result.winner', { side: sideName(it.result.winner) }) : t('result.draw') });
  }
}

export function logClass(it: LogItem, viewer: Side): string {
  if (it.k === 'turn_start' || it.k === 'battle_start') return 'log-turn';
  if (it.k === 'fire') {
    if (it.effect === 'miss') return 'log-miss';
    return it.targetSide === viewer ? 'log-bad' : 'log-good';
  }
  if (it.k === 'objective') return it.to === viewer ? 'log-good' : 'log-bad';
  if (it.k === 'spotted') return 'log-spot';
  if (it.k === 'game_over') return 'log-turn';
  return '';
}

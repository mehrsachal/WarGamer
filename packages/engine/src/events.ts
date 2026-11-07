// Every game action is a command; executing it appends one GameEvent (with every RNG draw it used and the
// plain-language log items it produced). Game state = replay of events from the seed.
import type { Side } from './data/schema';
import type { HitBreakdown } from './combat';
import type { Hex } from './hex';
import type { GameResult } from './state';

export type Command =
  | { type: 'Deploy'; unitId: string; hex: Hex }
  | { type: 'EndDeployment' }
  | { type: 'MoveUnit'; unitId: string; to: Hex }
  | { type: 'Fire'; unitId: string; weaponId: string; targetId: string }
  | { type: 'IndirectFire'; unitId: string; weaponId: string; hex: Hex }
  | { type: 'CallFire'; assetId: string; hex: Hex }
  | { type: 'Mount'; unitId: string; vehicleId: string }
  | { type: 'Dismount'; unitId: string; hex: Hex }
  | { type: 'EndTurn' };

export type CommandType = Command['type'];

export type FireEffect = 'miss' | 'suppressed' | 'step' | 'eliminated';

interface LogBase {
  /** Side whose action produced the item. */
  side: Side;
  turn: number;
  /** Sides allowed to see this item (the acting side always can). */
  seenBy: Side[];
}

export type LogItem = LogBase &
  (
    | { k: 'deploy_done' }
    | { k: 'battle_start'; firstSide: Side }
    | { k: 'turn_start' }
    | { k: 'turn_end' }
    | { k: 'rally'; unitId: string; name: string; chance: number; roll: number; ok: boolean }
    | { k: 'move'; unitId: string; name: string; typeId: string; from: Hex | null; to: Hex; mp: number; band: 'tactical' | 'dash'; halted: boolean }
    | { k: 'contact'; unitId: string; name: string; hex: Hex }
    | { k: 'spotted'; unitId: string; typeId: string; hex: Hex }
    | {
        k: 'fire';
        shooterId: string;
        shooterName: string;
        shooterTypeId: string | null;
        from: Hex | null;
        /** Sides that could see the shooter when it fired (others get a redacted entry). */
        shooterSeenBy: Side[];
        weaponId: string;
        targetId: string;
        targetName: string;
        targetTypeId: string;
        targetSide: Side;
        at: Hex;
        p: number;
        roll: number;
        hit: boolean;
        effect: FireEffect;
        effectRoll?: number;
        lethality?: number;
        breakdown: HitBreakdown;
        indirect: boolean;
      }
    | { k: 'impact'; source: string; sourceName: string; weaponId: string; hex: Hex; observed: boolean; targets: number }
    | { k: 'arty_called'; assetId: string; name: string; hex: Hex; impactTurn: number; missionsLeft: number }
    | { k: 'arty_available'; assetId: string; name: string; missions: number }
    | { k: 'mount'; unitId: string; name: string; vehicleId: string; vehicleName: string; hex: Hex }
    | { k: 'dismount'; unitId: string; name: string; vehicleId: string; vehicleName: string; hex: Hex }
    | { k: 'passenger_loss'; unitId: string; name: string; roll: number; chance: number; lost: boolean }
    | { k: 'uav_recovered'; unitId: string; name: string }
    | { k: 'objective'; objectiveId: string; name: string; from: Side | null; to: Side | null }
    | { k: 'vp'; blue: number; red: number }
    | { k: 'game_over'; result: GameResult }
  );

export type LogKind = LogItem['k'];

export interface GameEvent {
  seq: number;
  /** Turn when the command was issued (0 = deployment). */
  turn: number;
  side: Side;
  type: CommandType;
  payload: Command;
  log: LogItem[];
  /** Every random draw consumed, in order (CBT-07). */
  rngDraws: number[];
  /** Wall-clock time stamped by the server (not part of determinism). */
  ts?: number;
}

export class CommandError extends Error {
  constructor(
    readonly code: string,
    readonly params: Record<string, string | number> = {},
  ) {
    super(code);
  }
}

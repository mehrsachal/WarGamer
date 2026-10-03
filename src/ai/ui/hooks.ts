import { useEffect, useMemo, useState } from 'preact/hooks';
import type { Engine } from '../../sim/engine';
import { BattleAi } from '../battle';
import { aiAvailable, aiStatus, noteBudget, subscribeAi } from '../settings';

/** Re-renders on any AI settings / status change. */
export function useAiStatus(): ReturnType<typeof aiStatus> {
  const [, force] = useState(0);
  useEffect(() => subscribeAi(() => force((x) => x + 1)), []);
  return aiStatus();
}

/** One AI session per battle engine (null when no key / AI off: built-in AI only). */
export function useBattleAi(engine: Engine | null): BattleAi | null {
  const ai = useMemo(() => (engine && (aiAvailable('enemy') || aiAvailable('radio')) ? new BattleAi(engine) : null), [engine]);
  // the "Budget reached" status belongs to this battle only
  useEffect(() => () => noteBudget(false), [ai]);
  return ai;
}

/** Re-renders when the battle's AI session changes (calls, tokens, events). */
export function useBattleTick(ai: BattleAi | null): void {
  const [, force] = useState(0);
  useEffect(() => (ai ? ai.battle.subscribe(() => force((x) => x + 1)) : undefined), [ai]);
}

import type { BattleAi } from '../battle';
import { fmtTok } from './AiSettings';
import { useBattleTick } from './hooks';

/** Wargame header chips: live token meter and "Enemy commander deciding…" while the clock is held. */
export function AiWarHud(p: { ai: BattleAi | null }) {
  useBattleTick(p.ai);
  if (!p.ai) return null;
  const b = p.ai.battle;
  const hold = p.ai.cdr.holdInfo();
  return (
    <>
      {hold && (
        <div class="hudchip ai-hold" title="The clock is held while the AI enemy commander decides (max 8 s, then the built-in commander decides)">
          ⏳ Enemy commander deciding… {hold.secs}s
        </div>
      )}
      <div class={`hudchip ai-meter ${b.budgetHit ? 'over' : ''}`} title={`${b.model} · ${b.calls} calls · ${b.input} in / ${b.output} out tokens · budget ${b.budget}${b.budgetHit ? ' — reached, built-in AI in use' : ''}`}>
        AI {fmtTok(b.used)} tok
      </div>
    </>
  );
}

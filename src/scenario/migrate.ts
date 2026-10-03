// Migration of saved work when a preset's map frame changes (Scenario.version).
// Pure functions; ui/data.ts ensureSeed applies them to the store.

import type { Attempt, Scenario } from '../core/types';
import { BIC49_ID, BIC49_MIGRATIONS } from './presetBic49';
import { type FrameMigration, shiftBetween, translateAttempt } from './transform';

/** Frame migrations per preset scenario id. */
export const PRESET_MIGRATIONS: Record<string, FrameMigration[]> = {
  [BIC49_ID]: BIC49_MIGRATIONS,
};

/**
 * Bring an attempt made on an older version of `current` up to date (plan and AAR coordinates
 * translated, scenarioVersion stamped). Returns null when nothing needs doing, so it is idempotent.
 */
export function migrateAttempt(a: Attempt, current: Scenario): Attempt | null {
  if (a.scenarioId !== current.id || current.version === undefined) return null;
  const to = current.version;
  if ((a.scenarioVersion ?? 1) >= to) return null;
  const d = shiftBetween(PRESET_MIGRATIONS[current.id] ?? [], a.scenarioVersion, to);
  return { ...translateAttempt(a, d), scenarioVersion: to };
}

// App-level data helpers on top of the store.
import { uid } from '../core/rng';
import type { Attempt, Exercise, ExerciseSettings, Scenario } from '../core/types';
import { emptyPlan } from '../plan/plan';
import { type GenOptions, generateScenario } from '../scenario/generator';
import { migrateAttempt } from '../scenario/migrate';
import { presetBic49 } from '../scenario/presetBic49';
import { db } from '../store/db';

export const DEFAULT_SETTINGS: ExerciseSettings = {
  fog: 'FULL',
  injects: true,
  hints: true,
  revealPlanScore: 'AFTER_WARGAME',
  difficulty: 'STANDARD',
  planWeight: 0.5,
  timeLimitMin: 0,
};

/** Sample generated scenarios seeded into an empty store. */
const SAMPLES: GenOptions[] = [
  { level: 'PL', terrain: 'PLAINS', seed: 1101, title: 'Pl Def — Plains (sample)' },
  { level: 'COY', terrain: 'CANAL', seed: 2202, title: 'Coy Def — Canal (sample)' },
  { level: 'BN', terrain: 'SEMI_DESERT', seed: 3303, title: 'Bn Def — Semi-desert (sample)' },
];

export async function ensureSeed(): Promise<void> {
  const sc = await db.all('scenarios');
  const preset = presetBic49();
  // Saved work on an older map frame of the preset is translated onto the current one. Keyed on
  // each attempt's own scenarioVersion, so it is idempotent and also catches imported old attempts.
  const attempts = await db.all('attempts');
  for (const a of attempts) {
    const m = migrateAttempt(a, preset);
    if (m) await db.put('attempts', m);
  }
  const stored = sc.find((s) => s.id === preset.id);
  if (!stored || stored.version !== preset.version) {
    await db.put('scenarios', preset);
    forgetScenario(preset.id);
  }
  if (sc.length === 0) {
    for (const o of SAMPLES) await db.put('scenarios', generateScenario(o));
    return;
  }
  // v1 samples were portrait strips: regenerate them as landscape sheets if nobody has used them yet
  const exercises = await db.all('exercises');
  const used = new Set([...attempts.map((a) => a.scenarioId), ...exercises.map((e) => e.scenarioId)]);
  for (const o of SAMPLES) {
    const old = sc.find((s) => s.source === 'generated' && s.seed === o.seed && s.title === o.title);
    if (old && old.terrain.height > old.terrain.width && !used.has(old.id)) {
      const fresh = generateScenario(o);
      await db.put('scenarios', { ...fresh, id: old.id, createdAt: old.createdAt });
      forgetScenario(old.id);
    }
  }
}

const scCache = new Map<string, Scenario>();
export async function getScenario(id: string): Promise<Scenario | undefined> {
  if (scCache.has(id)) return scCache.get(id);
  const s = await db.get('scenarios', id);
  if (s) scCache.set(id, s);
  return s;
}
export function cacheScenario(s: Scenario): void {
  scCache.set(s.id, s);
}
export function forgetScenario(id: string): void {
  scCache.delete(id);
}

export async function attemptFor(exercise: Exercise, studentId: string): Promise<Attempt | undefined> {
  const all = await db.all('attempts');
  return all.filter((a) => a.exerciseId === exercise.id && a.studentId === studentId).sort((a, b) => b.startedAt - a.startedAt)[0];
}

export async function startAttempt(exerciseId: string, scenarioId: string, studentId: string): Promise<Attempt> {
  const scenarioVersion = (await getScenario(scenarioId))?.version;
  const a: Attempt = { id: uid('att'), exerciseId, studentId, scenarioId, scenarioVersion, status: 'PLANNING', plan: emptyPlan(), startedAt: Date.now() };
  await db.put('attempts', a);
  return a;
}

/** Synthetic exercise objects for demo / practice runs. */
export function syntheticExercise(kind: 'demo' | 'practice', scenarioId: string): Exercise {
  return {
    id: `${kind}_${scenarioId}`,
    title: kind === 'demo' ? 'Instructor demo' : 'Free practice',
    scenarioId,
    classId: '',
    studentIds: [],
    settings: { ...DEFAULT_SETTINGS, revealPlanScore: 'IMMEDIATE' },
    createdAt: 0,
  };
}

export async function exerciseOf(a: Attempt): Promise<Exercise> {
  if (a.exerciseId.startsWith('demo_') || a.exerciseId.startsWith('practice_')) return syntheticExercise(a.exerciseId.startsWith('demo_') ? 'demo' : 'practice', a.scenarioId);
  return (await db.get('exercises', a.exerciseId)) ?? syntheticExercise('practice', a.scenarioId);
}

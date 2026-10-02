// App-level data helpers on top of the store.
import { uid } from '../core/rng';
import type { Attempt, Exercise, ExerciseSettings, Scenario } from '../core/types';
import { emptyPlan } from '../plan/plan';
import { generateScenario } from '../scenario/generator';
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

export async function ensureSeed(): Promise<void> {
  const sc = await db.all('scenarios');
  if (!sc.some((s) => s.id === 'preset_bic49_te_def')) await db.put('scenarios', presetBic49());
  if (sc.length === 0) {
    await db.put('scenarios', generateScenario({ level: 'PL', terrain: 'PLAINS', seed: 1101, title: 'Pl Def — Plains (sample)' }));
    await db.put('scenarios', generateScenario({ level: 'COY', terrain: 'CANAL', seed: 2202, title: 'Coy Def — Canal (sample)' }));
    await db.put('scenarios', generateScenario({ level: 'BN', terrain: 'SEMI_DESERT', seed: 3303, title: 'Bn Def — Semi-desert (sample)' }));
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
  const a: Attempt = { id: uid('att'), exerciseId, studentId, scenarioId, status: 'PLANNING', plan: emptyPlan(), startedAt: Date.now() };
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

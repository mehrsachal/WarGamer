// Exercise time is kept in minutes relative to D Day 0000 hrs (negative = before D Day).

export const MIN_PER_DAY = 1440;

export interface LightTable {
  firstLight: number; // minutes after midnight, e.g. 345 = 0545
  lastLight: number; // e.g. 1125 = 1845
  moon: 'none' | 'quarter' | 'half' | 'full';
}

export function dDay(day: number, hhmm: number): number {
  const hh = Math.floor(hhmm / 100);
  const mm = hhmm % 100;
  return day * MIN_PER_DAY + hh * 60 + mm;
}

export function splitTime(t: number): { day: number; hh: number; mm: number; minOfDay: number } {
  const day = Math.floor(t / MIN_PER_DAY);
  const minOfDay = ((t % MIN_PER_DAY) + MIN_PER_DAY) % MIN_PER_DAY;
  return { day, hh: Math.floor(minOfDay / 60), mm: Math.floor(minOfDay % 60), minOfDay };
}

export function dayLabel(day: number): string {
  if (day === 0) return 'D Day';
  return day < 0 ? `D${day}` : `D+${day}`;
}

export function hhmm(t: number): string {
  const { hh, mm } = splitTime(t);
  return `${String(hh).padStart(2, '0')}${String(mm).padStart(2, '0')}`;
}

/** "D Day 2100 hrs", "D-3 1000 hrs". */
export function fmtTime(t: number, withDay = true): string {
  const { day } = splitTime(t);
  return withDay ? `${dayLabel(day)} ${hhmm(t)} hrs` : `${hhmm(t)} hrs`;
}

export function fmtDuration(min: number): string {
  const m = Math.round(Math.abs(min));
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (h === 0) return `${r} min`;
  return r === 0 ? `${h} hr${h > 1 ? 's' : ''}` : `${h} hr ${r} min`;
}

export type LightState = 'DAY' | 'TWILIGHT' | 'NIGHT';

export function lightAt(t: number, lt: LightTable): LightState {
  const { minOfDay } = splitTime(t);
  if (minOfDay >= lt.firstLight + 20 && minOfDay <= lt.lastLight - 20) return 'DAY';
  if (minOfDay >= lt.firstLight - 25 && minOfDay <= lt.lastLight + 25) return 'TWILIGHT';
  return 'NIGHT';
}

/** Visual range multiplier for unaided eyes. */
export function visibilityFactor(t: number, lt: LightTable, weatherVis = 1): number {
  const s = lightAt(t, lt);
  const moonBoost = lt.moon === 'full' ? 0.22 : lt.moon === 'half' ? 0.14 : lt.moon === 'quarter' ? 0.1 : 0.06;
  const base = s === 'DAY' ? 1 : s === 'TWILIGHT' ? 0.5 : moonBoost;
  return base * weatherVis;
}

/** Day and night hours available between two times (for the time & space appreciation). */
export function dayNightHours(from: number, to: number, lt: LightTable): { day: number; night: number } {
  let day = 0;
  let night = 0;
  for (let t = from; t < to; t += 15) {
    const s = lightAt(t, lt);
    if (s === 'NIGHT') night += 0.25;
    else day += 0.25;
  }
  return { day, night };
}

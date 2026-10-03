// Pluggable judge for free-text answers (appreciation deductions, contingency rationales,
// free-text orders at injects). Offline the keyword heuristic below is used; when the optional
// AI is configured, src/ai registers an LLM-backed judge with setTextJudge().

export interface TextJudgeRequest {
  /** Stable id of the item being marked (e.g. "APRC_DEDUCTIONS", "CONT_POST_LOST"). */
  id: string;
  /** What the student was asked. */
  task: string;
  /** Situation / context in a sentence or two. */
  situation: string;
  /** Doctrinal key points a good answer covers (DS solution, ICIB). */
  keyPoints: string[];
  /** The student's answer. */
  answer: string;
}

export interface TextJudgement {
  /** 0..1 */
  score: number;
  /** One-line feedback for the student. */
  note: string;
  /** Key points the answer covered (indices into keyPoints). */
  covered: number[];
  source: 'OFFLINE' | 'AI';
}

export interface TextJudge {
  /** Mark several answers at once (lets an LLM judge batch them into one call). Null entries = not judged. */
  judge(reqs: TextJudgeRequest[]): Promise<(TextJudgement | null)[]>;
}

const STOP = new Set(['the', 'a', 'an', 'of', 'to', 'and', 'or', 'in', 'on', 'at', 'by', 'for', 'with', 'from', 'is', 'be', 'are', 'as', 'en', 'own', 'will', 'should', 'must']);

function words(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9/ ]+/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 1 && !STOP.has(w));
}

/** Offline heuristic: share of key points whose significant words mostly appear in the answer. */
export function offlineJudgement(r: TextJudgeRequest): TextJudgement | null {
  const ans = new Set(words(r.answer));
  if (!ans.size || !r.keyPoints.length) return null;
  const covered: number[] = [];
  r.keyPoints.forEach((kp, i) => {
    const kw = words(kp);
    if (!kw.length) return;
    const hit = kw.filter((w) => ans.has(w) || [...ans].some((a) => a.length > 4 && (a.startsWith(w.slice(0, 5)) || w.startsWith(a.slice(0, 5))))).length;
    if (hit / kw.length >= 0.5) covered.push(i);
  });
  const score = Math.min(1, covered.length / Math.max(1, Math.min(r.keyPoints.length, 4)));
  const missing = r.keyPoints.filter((_, i) => !covered.includes(i)).slice(0, 2);
  const note = covered.length ? `Covers ${covered.length}/${r.keyPoints.length} key points${missing.length ? `; consider: ${missing.join('; ')}` : ''}.` : `Key points to consider: ${missing.join('; ')}.`;
  return { score, note, covered, source: 'OFFLINE' };
}

export const offlineJudge: TextJudge = {
  async judge(reqs) {
    return reqs.map(offlineJudgement);
  },
};

let current: TextJudge = offlineJudge;

export function setTextJudge(j: TextJudge | null): void {
  current = j ?? offlineJudge;
}

export function getTextJudge(): TextJudge {
  return current;
}

// Pure state machine for the typing drill (plan §3.3): answering →
// feedback-correct | corrective → … → done. Deliberately separate from the
// flashcards' session.ts: reinsertAgain's +6 offset ≠ the drill's
// requeue-at-END, and combo/corrective/hint semantics don't belong in the
// flashcard flow. Every function is pure — callers keep the returned state,
// inputs are never mutated (the component holds the state in a $state rune).
import type { DrillItem } from './drill-modes.ts';
import type { DrillOutcome } from './drill-srs.ts';

export type DrillPhase = 'answering' | 'feedback-correct' | 'corrective' | 'done';

/** Max times ONE item (by id) re-enters the end of the queue after misses. */
export const DRILL_MAX_REQUEUES = 2;

const DEFAULT_SIZE = 20;

export interface DrillState {
  queue: DrillItem[];
  idx: number;
  phase: DrillPhase;
  combo: number;
  bestCombo: number;
  /** Scored attempts; accuracy = firstTryCorrect / answered. */
  answered: number;
  firstTryCorrect: number;
  /** Unique, in first-miss order — the end screen's missed-words list. */
  missedIds: string[];
  requeues: Record<string, number>;
  /** "Visa ordet" used on the current item — any submit now scores as a hint-miss. */
  revealed: boolean;
  /** ms epoch from the injected clock; total time = now − startedAt. */
  startedAt: number;
}

export function createDrill(items: DrillItem[], opts: { size?: number; now: number }): DrillState {
  const queue = items.slice(0, opts.size ?? DEFAULT_SIZE);
  return {
    queue,
    idx: 0,
    phase: queue.length === 0 ? 'done' : 'answering',
    combo: 0,
    bestCombo: 0,
    answered: 0,
    firstTryCorrect: 0,
    missedIds: [],
    requeues: {},
    revealed: false,
    startedAt: opts.now,
  };
}

/** The hint: reveal the answer + glossary info. Only meaningful while
 *  answering (the reveal makes the coming submit a scored miss); a no-op in
 *  every other phase. */
export function reveal(s: DrillState): DrillState {
  return s.phase === 'answering' ? { ...s, revealed: true } : s;
}

/** Score an Enter-press. In `answering`, a clean correct answer celebrates;
 *  anything else (wrong, or correct only after the reveal hint) drops to the
 *  corrective phase and requeues a COPY of the item at the END of the run
 *  (capped per id). In `corrective` a correct retype advances UNGRADED —
 *  same attempt, no stat changes. No-op in the remaining phases. */
export function submit(s: DrillState, correct: boolean): DrillState {
  if (s.phase === 'answering') {
    if (correct && !s.revealed) {
      const combo = s.combo + 1;
      return {
        ...s,
        phase: 'feedback-correct',
        combo,
        bestCombo: Math.max(s.bestCombo, combo),
        answered: s.answered + 1,
        firstTryCorrect: s.firstTryCorrect + 1,
      };
    }
    const item = s.queue[s.idx];
    if (!item) return s; // defensive: nothing at idx, nothing to score
    const prior = s.requeues[item.id] ?? 0;
    const requeue = prior < DRILL_MAX_REQUEUES;
    return {
      ...s,
      phase: 'corrective',
      combo: 0,
      answered: s.answered + 1,
      missedIds: s.missedIds.includes(item.id) ? s.missedIds : [...s.missedIds, item.id],
      queue: requeue ? [...s.queue, { ...item }] : s.queue,
      requeues: requeue ? { ...s.requeues, [item.id]: prior + 1 } : s.requeues,
    };
  }
  if (s.phase === 'corrective' && correct) return advance(s);
  return s;
}

/** Move to the next item, or to `done` past the last. Resets the per-item
 *  reveal flag. The component calls this after the 650 ms correct-feedback
 *  timer; a corrective retype advances via submit(). */
export function advance(s: DrillState): DrillState {
  if (s.phase === 'done') return s;
  const idx = s.idx + 1;
  return {
    ...s,
    idx,
    phase: idx >= s.queue.length ? 'done' : 'answering',
    revealed: false,
  };
}

/** SRS outcome of the CURRENT scored attempt — call BEFORE submit(), while
 *  the state still knows whether the hint was used: a reveal is always a
 *  hint-miss, even when the learner then types the revealed word correctly. */
export function outcomeOf(s: DrillState, correct: boolean): DrillOutcome {
  return s.revealed ? 'hint' : correct ? 'correct' : 'wrong';
}

/** True for a blank (empty/whitespace-only) submit. The component must DROP
 *  blank un-revealed `answering` submits instead of grading them: the
 *  corrective retype advances synchronously with the input cleared, so a
 *  double-tapped or key-repeated Enter would otherwise land on the NEXT,
 *  never-seen card and write an SRS Again for it. Reveal→Enter stays the
 *  explicit give-up path (still scored as a hint-miss). */
export function isBlankAttempt(typed: string): boolean {
  return typed.trim().length === 0;
}

// Adapter between the typing drill and the flashcards' SRS store: every scored
// drill attempt reschedules the SAME (vocabId, direction) record the flashcard
// reviewer reads — no parallel dueness. v1 has no self-assessment, so anything
// short of a clean first-try answer ("Visa ordet" hint included) is Again.
import { Rating, type ReviewGrade } from './srs.ts';
import type { Direction, SrsRecord, WriteResult } from './storage.ts';

export type DrillOutcome = 'correct' | 'hint' | 'wrong';

/** correct → Good; hint and wrong are both a miss → Again. No Hard/Easy in v1. */
export function gradeForOutcome(o: DrillOutcome): ReviewGrade {
  return o === 'correct' ? Rating.Good : Rating.Again;
}

/** Structural slice of Store.grade — injectable so tests observe the exact write. */
export interface SrsSink {
  grade(
    vocabId: string,
    direction: Direction,
    grade: ReviewGrade,
    now: Date,
  ): { record: SrsRecord; result: WriteResult };
}

/** One scored attempt → one SRS write. Returns the store's WriteResult so the
 *  caller can surface quota failures (role="alert" save-error message). */
export function recordOutcome(
  sink: SrsSink,
  vocabId: string,
  direction: Direction,
  outcome: DrillOutcome,
  now: Date,
): WriteResult {
  return sink.grade(vocabId, direction, gradeForOutcome(outcome), now).result;
}

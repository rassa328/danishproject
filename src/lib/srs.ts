// Thin wrapper over ts-fsrs (FSRS-6). Verified against ts-fsrs@5.4.1:
//  - Rating: Manual=0, Again=1, Hard=2, Good=3, Easy=4
//  - State:  New=0, Learning=1, Review=2, Relearning=3
//  - Card fields: due, stability, difficulty, elapsed_days, scheduled_days,
//                 learning_steps, reps, lapses, state, last_review
//  - next(card, now, grade) -> { card, log }  (single-outcome; preferred over repeat())
// `now` is always injected so behaviour is deterministic in tests.
import {
  fsrs,
  generatorParameters,
  createEmptyCard,
  Rating,
  State,
  type Card as FsrsCard,
  type Grade,
  type FSRS,
} from 'ts-fsrs';

export { Rating, State };
export type { FsrsCard };
/** A real review grade — Again|Hard|Good|Easy (excludes Manual). */
export type ReviewGrade = Grade;

// One scheduler per request_retention value (cheap to build, cached so we don't
// rebuild on every grade). Fuzz on => human-friendly interval spread.
const schedulers = new Map<number, FSRS>();
function scheduler(requestRetention = 0.9): FSRS {
  let s = schedulers.get(requestRetention);
  if (!s) {
    s = fsrs(
      generatorParameters({
        request_retention: requestRetention,
        enable_fuzz: true,
        enable_short_term: true,
      }),
    );
    schedulers.set(requestRetention, s);
  }
  return s;
}

export function newCard(now: Date = new Date()): FsrsCard {
  return createEmptyCard(now);
}

/** Apply a grade and return the next card state. */
export function review(
  card: FsrsCard,
  grade: ReviewGrade,
  now: Date = new Date(),
  requestRetention = 0.9,
): FsrsCard {
  return scheduler(requestRetention).next(card, now, grade).card;
}

export function isDue(card: FsrsCard, now: Date = new Date()): boolean {
  return card.state === State.New || new Date(card.due) <= now;
}

/** A wrong typed answer can never count as "remembered" — floor it to Again. */
export function clampForCorrectness(grade: ReviewGrade, correct: boolean): ReviewGrade {
  return correct ? grade : Rating.Again;
}

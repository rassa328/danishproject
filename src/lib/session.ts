// Pure review-session logic for FlashcardReviewer.svelte: queue assembly,
// recognize-mode distractors, typed-answer grading and Again re-entry.
// No Svelte, no DOM, no localStorage — the SRS store view, clock and randomness
// are all injected, so every scheduling branch is unit-testable (session.test.ts).
import { acceptedAnswers, clozeSentence, normalizeAnswer, type Card } from './vocab.ts';
import { matchesGroup, type GroupMatch } from './deck-groups.ts';
import type { Direction, SrsRecord } from './storage.ts';

export type Rng = () => number;

/** Fisher–Yates in place. `rng` is injected so tests can pin the permutation
 *  (an rng returning ≈1 makes it the identity). */
function shuffle<T>(a: T[], rng: Rng): T[] {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j] as T, a[i] as T];
  }
  return a;
}

// ---- typed-answer grading ----

// Edge punctuation a typed answer may harmlessly include or omit: "løbe." for
// "løbe", or "hvad så" for a stored "hvad så?", is not a memory lapse. Applied
// symmetrically to BOTH sides, so stored phrases ending in ?/! still match.
// INTERNAL punctuation stays significant.
const EDGE_PUNCT = /^[\s.,!?…;:'"«»“”‘’]+|[\s.,!?…;:'"«»“”‘’]+$/gu;

// Swedish-keyboard spellings accepted for the Danish letters (user decision
// 2026-07-11, docs/plans/done/swedish-letter-folding.md — reverses the earlier
// no-fold rule): ä→æ, ö→ø, digraph ae→æ; å is shared. Folds the TYPED side
// only, and only as a second chance after the exact comparison, so stored
// answers that legitimately contain "ae" still match unfolded. Plain o/a and
// other accents (á…) never fold — those remain real spelling mistakes.
const foldSwedish = (s: string): string =>
  s.replaceAll('ä', 'æ').replaceAll('ö', 'ø').replaceAll('ae', 'æ');

/** normalizeAnswer (NFC, trim, lowercase, collapse spaces — never folds æ/ø/å)
 *  plus leading/trailing punctuation stripped. For TYPED answers only; stored
 *  data keeps its punctuation. */
export const normalizeTyped = (s: string): string => normalizeAnswer(s).replace(EDGE_PUNCT, '');

/** True if the learner's typed answer matches any accepted Danish form of the
 *  card, tolerating edge punctuation on either side and Swedish-keyboard
 *  spellings of æ/ø (see foldSwedish). */
export function matchTyped(typed: string, card: Pick<Card, 'danish' | 'accepted'>): boolean {
  const t = normalizeTyped(typed);
  if (t.length === 0) return false;
  const accepted = acceptedAnswers(card).map((a) => normalizeTyped(a));
  if (accepted.includes(t)) return true;
  const folded = foldSwedish(t);
  return folded !== t && accepted.includes(folded);
}

/** Cloze grading: the typed answer must be the exact in-context surface form
 *  that was blanked (not just any accepted lemma), modulo case/edge punctuation
 *  and Swedish-keyboard spellings of æ/ø. */
export function matchCloze(typed: string, answer: string): boolean {
  const t = normalizeTyped(typed);
  if (t.length === 0) return false;
  const a = normalizeTyped(answer);
  return t === a || foldSwedish(t) === a;
}

// ---- session queue assembly ----

/** Why a filtered direction produced an empty queue from a non-empty pool:
 *  'cloze' (no example contains an accepted form) or 'listen' (no committed
 *  sentence audio) — drives a clear done-screen message. */
export type FilteredReason = 'none' | 'cloze' | 'listen';

/** The slice of the Store the queue builder needs. `Store` satisfies this
 *  structurally; tests inject fakes. */
export interface SrsView {
  getRecord(vocabId: string, direction: Direction): SrsRecord | null;
  /** New cards already introduced today — shared across ALL directions, so
   *  multiple sessions/directions can't silently pile up review debt. */
  newCardsToday(now: Date): number;
}

export interface QueueLimits {
  /** True DAILY budget of new-card introductions (shared across directions). */
  newPerDay: number;
  /** Per-session cap on the due backlog. */
  reviewPerDay: number;
}

export interface SessionQueue {
  /** Cards to review, in presentation order (shuffled). */
  queue: Card[];
  /** The raw active pool BEFORE direction filters — the distractor source,
   *  cached by the component so the 5000+ card union isn't re-filtered per card. */
  pool: Card[];
  filteredReason: FilteredReason;
}

/** The subset of a pool a direction can actually present: cloze needs an
 *  accepted form present in the example, listen-sentence needs committed
 *  sentence audio + text; every other direction takes the pool as-is. Also
 *  used by the reviewer to gate mode radios per group (cheap pure call). */
export function eligibleForDirection(pool: Card[], direction: Direction): Card[] {
  if (direction === 'cloze') return pool.filter((c) => clozeSentence(c) !== null);
  if (direction === 'listen-sentence')
    return pool.filter((c) => !!c.audioExample && !!c.exampleDa);
  return pool;
}

/** Assemble a review session:
 *  - pool = tag match (wins when set) else group match, else empty;
 *  - direction eligibility via eligibleForDirection();
 *  - free practice returns everything eligible, shuffled (no SRS filtering) —
 *    this wins even for the 'all' group (free roaming over the whole union);
 *  - a group match of kind 'all' (the "Att repetera (alla)" picker entry) is
 *    DUE-ONLY: no new cards, and the queue is presented most-overdue-first
 *    (unshuffled) so the cross-deck backlog drains oldest-first;
 *  - scheduled: due records (not suspended) capped MOST-OVERDUE first so badly
 *    overdue cards aren't starved, plus fresh cards under the shared daily new
 *    budget, introduced most-useful-first (rank, then B1 before B2). */
export function buildQueue(opts: {
  cards: Card[];
  /** Train-a-tag deep link; wins over `match` when set. */
  tag?: string | null;
  /** The selected study group's descriptor. No tag and no match → empty pool. */
  match?: GroupMatch | null;
  direction: Direction;
  free?: boolean;
  srs: SrsView;
  now: Date;
  limits: QueueLimits;
  rng?: Rng;
}): SessionQueue {
  const { cards, tag, match, direction, free = false, srs, now, limits, rng = Math.random } = opts;
  const pool = tag
    ? cards.filter((c) => c.tags.includes(tag))
    : match
      ? cards.filter((c) => matchesGroup(c, match))
      : [];
  const dc = eligibleForDirection(pool, direction);
  const filteredReason: FilteredReason =
    dc.length === 0 && pool.length > 0
      ? direction === 'cloze'
        ? 'cloze'
        : direction === 'listen-sentence'
          ? 'listen'
          : 'none'
      : 'none';
  if (free) return { queue: shuffle([...dc], rng), pool, filteredReason };

  const due: { c: Card; due: number }[] = [];
  const fresh: Card[] = [];
  for (const c of dc) {
    const r = srs.getRecord(c.id, direction);
    if (!r) fresh.push(c);
    else if (!r.suspended && new Date(r.due) <= now)
      due.push({ c, due: new Date(r.due).getTime() });
  }
  // Cap the due backlog MOST-OVERDUE first (not deck order).
  due.sort((a, b) => a.due - b.due);
  const dueCards = due.slice(0, limits.reviewPerDay).map((x) => x.c);
  // The 'all' group is a pure backlog-clearing session: only due records, kept
  // in most-overdue-first order (a tag deep-link restores normal scheduling).
  if (!tag && match?.kind === 'all') return { queue: dueCards, pool, filteredReason };
  // Introduce new cards most-useful-first: by frequency rank when present, else
  // by level (B1 before B2 — a coarse frequency proxy). The queue is shuffled
  // below, so this changes WHICH fresh cards enter, not their order.
  fresh.sort((a, b) => {
    const ra = a.rank ?? Infinity;
    const rb = b.rank ?? Infinity;
    if (ra !== rb) return ra - rb;
    return a.cefr === b.cefr ? 0 : a.cefr === 'b1' ? -1 : 1;
  });
  const newBudget = Math.max(0, limits.newPerDay - srs.newCardsToday(now));
  return { queue: shuffle([...dueCards, ...fresh.slice(0, newBudget)], rng), pool, filteredReason };
}

/** Per-direction due counts over a pool (suspended and direction-ineligible
 *  cards excluded), in the given direction order, zero-count entries dropped.
 *  Drives the done screen's "3 kvar i Lyssna (mening)" next-step links. */
export function dueByDirection(opts: {
  pool: Card[];
  directions: readonly Direction[];
  srs: SrsView;
  now: Date;
}): { direction: Direction; count: number }[] {
  const { pool, directions, srs, now } = opts;
  const out: { direction: Direction; count: number }[] = [];
  for (const d of directions) {
    let count = 0;
    for (const c of eligibleForDirection(pool, d)) {
      const r = srs.getRecord(c.id, d);
      if (r && !r.suspended && new Date(r.due) <= now) count++;
    }
    if (count > 0) out.push({ direction: d, count });
  }
  return out;
}

// ---- recognize-mode distractors ----

const DISTRACTOR_COUNT = 3;
/** Below this pool size we fall back to the whole card set so options fill. */
const MIN_POOL_FOR_LOCAL = 8;

/** Multiple-choice options for 'recognize': the answer + up to 3 distractors.
 *  Distractors come from the ACTIVE pool so they stay in-domain (a 5000-word
 *  "all" pool would otherwise pair an emotion word with a cycling-part); same
 *  part-of-speech is preferred for plausibility. A distractor must be a
 *  genuinely WRONG answer, so candidates are excluded when their Danish form is
 *  itself accepted for this card OR their normalized Swedish gloss equals this
 *  card's — either would be an alternative correct answer graded as wrong. */
export function buildChoices(opts: {
  card: Card;
  pool: Card[];
  allCards: Card[];
  rng?: Rng;
}): string[] {
  const { card, pool, allCards, rng = Math.random } = opts;
  const correct = card.danish;
  const accepted = new Set(acceptedAnswers(card).map(normalizeTyped));
  const gloss = normalizeTyped(card.swedish);
  const uniq = (cs: Card[]) => [
    ...new Set(
      cs
        .filter(
          (c) =>
            c.danish !== correct &&
            !accepted.has(normalizeTyped(c.danish)) &&
            normalizeTyped(c.swedish) !== gloss,
        )
        .map((c) => c.danish),
    ),
  ];
  const base = pool.length >= MIN_POOL_FOR_LOCAL ? pool : allCards;
  const samePos = shuffle(uniq(base.filter((c) => c.pos === card.pos)), rng);
  const anyPos = shuffle(uniq(base), rng);
  const distractors = [...new Set([...samePos, ...anyPos])].slice(0, DISTRACTOR_COUNT);
  return shuffle([correct, ...distractors], rng);
}

// ---- Again re-entry ----

/** How far ahead a card graded Again re-enters the current queue… */
export const AGAIN_REENTRY_OFFSET = 6;
/** …and how many times per card per session (avoids an endless Again loop). */
export const AGAIN_MAX_REENTRIES = 2;

/** After queue[idx] is graded Again, return a NEW queue with that card
 *  re-inserted `offset` positions ahead (clamped to the queue end), so FSRS's
 *  minutes-scale relearning step gets an actual same-session attempt. Returns
 *  null — caller keeps its queue — when the card has already re-entered `max`
 *  times this session or idx is out of range. Never mutates the input. */
export function reinsertAgain(
  queue: readonly Card[],
  idx: number,
  priorReentries: number,
  opts: { offset?: number; max?: number } = {},
): Card[] | null {
  const { offset = AGAIN_REENTRY_OFFSET, max = AGAIN_MAX_REENTRIES } = opts;
  const card = queue[idx];
  if (!card || priorReentries >= max) return null;
  const at = Math.min(idx + offset, queue.length);
  return [...queue.slice(0, at), card, ...queue.slice(at)];
}

// Lenient sentence grading for the Zen drill's Meningar items (user decision
// 2026-07-11: "give the users some wiggleroom but still making it aware when
// they are wrong"). A sentence has one stored reference answer (the card's
// exampleDa or exampleSv), so exact-only grading would punish harmless slips;
// instead small errors grade as 'near' — scored correct, but the component
// pauses to show the diff and the correct sentence.
import { normalizeTyped } from './session.ts';
import { diffLetters } from './letter-diff.ts';

export type SentenceVerdict = 'exact' | 'near' | 'wrong';

// Swedish-keyboard second chance for Danish targets, same folding as
// session.ts matchTyped (ä→æ, ö→ø, ae→æ; typed side only, after the exact
// comparison). Swedish targets are unaffected: their unfolded compare wins
// first, and a fold that changes the string simply won't match them.
const foldSwedish = (s: string): string =>
  s.replaceAll('ä', 'æ').replaceAll('ö', 'ø').replaceAll('ae', 'æ');

/** Error budget for 'near': one slip is always forgiven, longer sentences get
 *  one more per ~12 characters. A single constant so the wiggle room is easy
 *  to tune. */
export const NEAR_ERRORS_PER_CHARS = 12;

/** Grade a typed sentence against the stored reference. 'exact' = matches
 *  after normalizeTyped (case, edge punctuation, space collapse) or with the
 *  Swedish-keyboard fold; 'near' = within the error budget (counted over the
 *  diffLetters trace, so internal punctuation slips spend budget rather than
 *  failing outright); 'wrong' = everything else, including a blank attempt. */
export function sentenceVerdict(expected: string, typed: string): SentenceVerdict {
  const t = normalizeTyped(typed);
  if (t.length === 0) return 'wrong';
  const e = normalizeTyped(expected);
  if (t === e || foldSwedish(t) === e) return 'exact';
  const errors = diffLetters(expected, typed).filter((d) => d.kind !== 'match').length;
  const budget = Math.max(1, Math.floor(e.length / NEAR_ERRORS_PER_CHARS));
  return errors <= budget ? 'near' : 'wrong';
}

// Per-letter feedback for the drill's corrective phase: a Levenshtein
// backtrace over the normalizeTyped forms of both inputs, so case and edge
// punctuation never show up as letter errors. normalizeTyped does NOT fold
// ä→æ / ö→ø (that folding lives in matchTyped only, and the drill remaps
// input live via char-map), so a Swedish spelling IS flagged here — by design.
import { normalizeTyped } from './session.ts';

export type LetterDiffKind = 'match' | 'wrong' | 'missing' | 'extra';

/** One cell of the rendered diff. `ch` is the EXPECTED character for
 *  match/wrong/missing and the TYPED character for extra. */
export interface LetterDiff {
  ch: string;
  kind: LetterDiffKind;
}

/** Character-level diff of `typed` against `expected`, both normalized first
 *  (NFC, trim, lowercase, space-collapse, edge punctuation stripped).
 *  Tie-break order among equal-cost traces, applied at every backtrace step:
 *  match > substitution ('wrong') > deletion ('missing') > insertion ('extra')
 *  — so the same pair of strings always renders the same way. */
export function diffLetters(expected: string, typed: string): LetterDiff[] {
  // Array.from splits on code points, not UTF-16 units (safe for any glyph).
  const e = Array.from(normalizeTyped(expected));
  const t = Array.from(normalizeTyped(typed));
  const m = e.length;
  const n = t.length;

  // dp[i * w + j] = edit distance e[0..i) → t[0..j), flat row-major.
  const w = n + 1;
  const dp = new Array<number>((m + 1) * w);
  for (let j = 0; j <= n; j++) dp[j] = j;
  for (let i = 1; i <= m; i++) {
    dp[i * w] = i;
    for (let j = 1; j <= n; j++) {
      const diag = (dp[(i - 1) * w + (j - 1)] as number) + (e[i - 1] === t[j - 1] ? 0 : 1);
      const del = (dp[(i - 1) * w + j] as number) + 1;
      const ins = (dp[i * w + (j - 1)] as number) + 1;
      dp[i * w + j] = Math.min(diag, del, ins);
    }
  }

  // Walk back from (m, n); each step tries the moves in tie-break order.
  const out: LetterDiff[] = [];
  let i = m;
  let j = n;
  while (i > 0 || j > 0) {
    const here = dp[i * w + j] as number;
    if (i > 0 && j > 0 && e[i - 1] === t[j - 1] && here === (dp[(i - 1) * w + (j - 1)] as number)) {
      out.push({ ch: e[i - 1] as string, kind: 'match' });
      i--;
      j--;
    } else if (i > 0 && j > 0 && here === (dp[(i - 1) * w + (j - 1)] as number) + 1) {
      out.push({ ch: e[i - 1] as string, kind: 'wrong' });
      i--;
      j--;
    } else if (i > 0 && here === (dp[(i - 1) * w + j] as number) + 1) {
      out.push({ ch: e[i - 1] as string, kind: 'missing' });
      i--;
    } else {
      // Only reachable with j > 0: at j === 0 the deletion branch always holds.
      out.push({ ch: t[j - 1] as string, kind: 'extra' });
      j--;
    }
  }
  return out.reverse();
}

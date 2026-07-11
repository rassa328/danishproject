// Danish number words for the /tal dictation drill. Linguistic source:
// src/content/lessons/03-tal.md (teacher-verified) — vigesimal tens
// (halvtreds 50 … halvfems 90) and ental-first compounds (27 = syvogtyve).
//
// Token contract: every token emitted by numberToTokens/yearToTokens/
// priceToTokens is a member of the CLOSED set NUMBER_ATOMS (105 entries).
// Atoms are the clip granularity — a compound like 'syvoghalvfems' is ONE
// atom/clip, never spliced from 'syv'+'og'+'halvfems'. The number-audio
// manifest is generated from NUMBER_ATOMS, so widening any output here
// without extending the atom set breaks clip playback (the closure test
// guards this).

import type { Rng } from './session.ts';

// Standalone 1 is the counting form 'en' (also the unit inside compounds:
// enogtyve, … og en). 'et' appears only before hundrede/tusind.
const ONES = [
  'nul', 'en', 'to', 'tre', 'fire', 'fem', 'seks', 'syv', 'otte', 'ni', 'ti',
  'elleve', 'tolv', 'tretten', 'fjorten', 'femten', 'seksten', 'sytten',
  'atten', 'nitten', 'tyve',
] as const;

const TENS_VALUES: readonly number[] = [20, 30, 40, 50, 60, 70, 80, 90];
const TENS_WORDS = [
  'tyve', 'tredive', 'fyrre', 'halvtreds', 'tres', 'halvfjerds', 'firs', 'halvfems',
] as const;

/** Guarded index access (noUncheckedIndexedAccess); unreachable after assertRange. */
const at = (words: readonly string[], i: number): string => {
  const w = words[i];
  if (w === undefined) throw new RangeError(`no word at index ${i}`);
  return w;
};

function assertRange(n: number): void {
  if (!Number.isInteger(n) || n < 0 || n > 9999) {
    throw new RangeError(`number out of supported range 0–9999: ${n}`);
  }
}

/** 'et' before hundrede/tusind; otherwise the plain digit word. */
const scaleDigit = (d: number): string => (d === 1 ? 'et' : at(ONES, d));

/** 0–99 as spoken atoms — always exactly one token (compounds are single atoms). */
function under100(n: number): string[] {
  if (n <= 20) return [at(ONES, n)];
  const unit = n % 10;
  const tensWord = at(TENS_WORDS, TENS_VALUES.indexOf(n - unit));
  return unit === 0 ? [tensWord] : [`${at(ONES, unit)}og${tensWord}`];
}

/** Spoken atoms for n. 'og' joins only a final <100 part:
 *  342 → tre hundrede og toogfyrre · 2100 → to tusind et hundrede. */
export function numberToTokens(n: number): string[] {
  assertRange(n);
  if (n < 100) return under100(n);
  const tokens: string[] = [];
  let rest = n;
  if (rest >= 1000) {
    tokens.push(scaleDigit(Math.floor(rest / 1000)), 'tusind');
    rest %= 1000;
  }
  if (rest >= 100) {
    tokens.push(scaleDigit(Math.floor(rest / 100)), 'hundrede');
    rest %= 100;
  }
  if (rest > 0) tokens.push('og', ...under100(rest));
  return tokens;
}

/** Display form: the space-joined token reading. For 0–99 this is the
 *  orthographic one-word compound ('syvoghalvfems'). */
export function numberToDanish(n: number): string {
  return numberToTokens(n).join(' ');
}

/** Formal year reading: 1100–1999 read as pair-of-digits hundreds
 *  ('nitten hundrede og fireoghalvfems'); everything else (incl. 2000s)
 *  reads as a plain number. Colloquial Danish drops 'hundrede og' —
 *  deliberately NOT implemented (plan §3.5; pending teacher verification). */
export function yearToTokens(y: number): string[] {
  assertRange(y);
  if (y >= 1100 && y <= 1999) {
    const rest = y % 100;
    const head = [at(ONES, Math.floor(y / 100)), 'hundrede'];
    return rest === 0 ? head : [...head, 'og', ...under100(rest)];
  }
  return numberToTokens(y);
}

/** Whole kroner only in v1 (no øre/komma). Always the plural 'kroner' — the
 *  stora-tal generator never draws 1 (singular 'krone' has no atom/clip). */
export function priceToTokens(kroner: number): string[] {
  return [...numberToTokens(kroner), 'kroner'];
}

/** Digit input normalization: strip every whitespace kind Swedes use as a
 *  thousands separator ('1 994', thin space, nbsp) → '1994'. */
export function normalizeDigits(typed: string): string {
  return typed.replace(/\s+/gu, '');
}

// The closed atom set = recording checklist: 0–20 incl. both en/et (22),
// tredive–halvfems (7), all 72 ental+tiotal compounds, hundrede/tusind/og/kroner.
const compounds: string[] = [];
for (const tens of TENS_WORDS) {
  for (let unit = 1; unit <= 9; unit++) compounds.push(`${at(ONES, unit)}og${tens}`);
}
export const NUMBER_ATOMS: readonly string[] = Object.freeze([
  ...ONES.slice(0, 2), 'et', ...ONES.slice(2),
  ...TENS_WORDS.slice(1),
  ...compounds,
  'hundrede', 'tusind', 'og', 'kroner',
]);

export type NumberLevelId = '0-20' | 'tiotal' | '0-99' | 'stora-tal';
export type NumberKind = 'number' | 'year' | 'price';

export interface NumberLevel {
  id: NumberLevelId;
  label: string;
  gen(rng: Rng): { value: number; tokens: string[]; kind: NumberKind };
}

/** Inclusive uniform pick; rng ∈ [0, 1) per the session.ts contract. */
const randInt = (rng: Rng, lo: number, hi: number): number =>
  lo + Math.floor(rng() * (hi - lo + 1));

const plain = (value: number) =>
  ({ value, tokens: numberToTokens(value), kind: 'number' as const });

export const NUMBER_LEVELS: NumberLevel[] = [
  { id: '0-20', label: '0–20', gen: (rng) => plain(randInt(rng, 0, 20)) },
  {
    id: 'tiotal',
    label: 'Tiotal (20–90)',
    gen: (rng) => {
      const tens = TENS_VALUES[randInt(rng, 0, TENS_VALUES.length - 1)];
      return plain(tens ?? 20);
    },
  },
  { id: '0-99', label: '0–99', gen: (rng) => plain(randInt(rng, 0, 99)) },
  {
    id: 'stora-tal',
    label: 'Stora tal · årtal · priser',
    // One rng draw picks the kind, the next the value — deterministic under
    // an injected sequence rng in tests.
    gen: (rng) => {
      const r = rng();
      if (r < 1 / 3) return plain(randInt(rng, 100, 999));
      if (r < 2 / 3) {
        const value = randInt(rng, 1900, 2099);
        return { value, tokens: yearToTokens(value), kind: 'year' as const };
      }
      // Prices start at 2: priceToTokens always appends plural 'kroner', and
      // 1 would compose the ungrammatical 'en kroner' (singular is 'en krone',
      // and 'krone' is not in the closed atom set).
      const value = randInt(rng, 2, 999);
      return { value, tokens: priceToTokens(value), kind: 'price' as const };
    },
  },
];

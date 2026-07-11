import { describe, it, expect } from 'vitest';
import { diffLetters, type LetterDiff } from './letter-diff.ts';

const kinds = (d: LetterDiff[]) => d.map((x) => x.kind);
const chars = (d: LetterDiff[]) => d.map((x) => x.ch).join('');

describe('diffLetters: exact match', () => {
  it('marks every letter match when typed equals expected', () => {
    const d = diffLetters('læse', 'læse');
    expect(kinds(d)).toEqual(['match', 'match', 'match', 'match']);
    expect(chars(d)).toBe('læse');
  });

  it('returns [] for two empty strings', () => {
    expect(diffLetters('', '')).toEqual([]);
  });
});

describe('diffLetters: substitution', () => {
  it('flags exactly the æ position when ä was typed (normalizeTyped never folds ä→æ)', () => {
    // Regression guard: the matchTyped-level Swedish folding must NOT leak in
    // here — the corrective diff has to show the Swedish letter as wrong.
    const d = diffLetters('læse', 'läse');
    expect(kinds(d)).toEqual(['match', 'wrong', 'match', 'match']);
    // 'wrong' carries the EXPECTED character, ready to render flagged.
    expect(d[1]).toEqual({ ch: 'æ', kind: 'wrong' });
  });
});

describe('diffLetters: missing and extra', () => {
  it('marks a dropped expected character as missing', () => {
    const d = diffLetters('læse', 'læe');
    expect(d).toEqual([
      { ch: 'l', kind: 'match' },
      { ch: 'æ', kind: 'match' },
      { ch: 's', kind: 'missing' },
      { ch: 'e', kind: 'match' },
    ]);
  });

  it('marks a surplus typed character as extra, carrying the TYPED character', () => {
    const d = diffLetters('hus', 'huxs');
    expect(d).toEqual([
      { ch: 'h', kind: 'match' },
      { ch: 'u', kind: 'match' },
      { ch: 'x', kind: 'extra' },
      { ch: 's', kind: 'match' },
    ]);
  });

  it('empty typed → every expected letter missing, in order', () => {
    const d = diffLetters('hej', '');
    expect(kinds(d)).toEqual(['missing', 'missing', 'missing']);
    expect(chars(d)).toBe('hej');
  });

  it('empty expected → every typed letter extra, in order', () => {
    const d = diffLetters('', 'ab');
    expect(kinds(d)).toEqual(['extra', 'extra']);
    expect(chars(d)).toBe('ab');
  });
});

describe('diffLetters: normalization before diffing', () => {
  it('case and edge punctuation differences produce all-match', () => {
    const d = diffLetters('Hvad så?', '  hvad så');
    expect(kinds(d)).toEqual(Array<string>(7).fill('match'));
    expect(chars(d)).toBe('hvad så'); // internal space survives collapse
  });
});

describe('diffLetters: deterministic tie-breaking', () => {
  it('prefers substitution over a delete+insert pair of the same cost', () => {
    // 'ab' vs 'ba' also admits [missing a, match b, extra a]; the documented
    // order (match > wrong > missing > extra) picks two substitutions.
    expect(diffLetters('ab', 'ba')).toEqual([
      { ch: 'a', kind: 'wrong' },
      { ch: 'b', kind: 'wrong' },
    ]);
  });

  it('marks the FIRST of a doubled letter missing (match preferred at backtrace end)', () => {
    expect(diffLetters('aa', 'a')).toEqual([
      { ch: 'a', kind: 'missing' },
      { ch: 'a', kind: 'match' },
    ]);
  });
});

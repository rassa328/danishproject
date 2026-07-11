import { describe, it, expect } from 'vitest';
import {
  numberToDanish,
  numberToTokens,
  yearToTokens,
  priceToTokens,
  normalizeDigits,
  NUMBER_ATOMS,
  NUMBER_LEVELS,
  type NumberLevelId,
} from './danish-numbers.ts';

// Same convention as session.test.ts: pinned rng makes random picks deterministic.
const noShuffle = () => 0.999999;
const zeroRng = () => 0;

/** Rng that replays a fixed sequence (last value repeats). */
const seqRng = (...vals: number[]) => {
  let i = 0;
  return () => {
    const v = vals[Math.min(i, vals.length - 1)] ?? 0;
    i++;
    return v;
  };
};

const level = (id: NumberLevelId) => {
  const l = NUMBER_LEVELS.find((x) => x.id === id);
  if (!l) throw new Error(`missing level ${id}`);
  return l;
};

describe('numberToTokens 0–20', () => {
  it('matches the lesson-03 word list exactly', () => {
    const words = [
      'nul', 'en', 'to', 'tre', 'fire', 'fem', 'seks', 'syv', 'otte', 'ni',
      'ti', 'elleve', 'tolv', 'tretten', 'fjorten', 'femten', 'seksten',
      'sytten', 'atten', 'nitten', 'tyve',
    ];
    for (let n = 0; n <= 20; n++) {
      expect(numberToTokens(n)).toEqual([words[n]]);
      expect(numberToDanish(n)).toBe(words[n]);
    }
  });
});

describe('vigesimal tens', () => {
  it('uses the short forms halvtreds/tres/halvfjerds/firs/halvfems', () => {
    const tens: Array<[number, string]> = [
      [20, 'tyve'], [30, 'tredive'], [40, 'fyrre'], [50, 'halvtreds'],
      [60, 'tres'], [70, 'halvfjerds'], [80, 'firs'], [90, 'halvfems'],
    ];
    for (const [n, word] of tens) expect(numberToTokens(n)).toEqual([word]);
  });
});

describe('ental-first compounds 21–99', () => {
  it('produces ONE token per compound (the lesson-03 examples)', () => {
    expect(numberToTokens(27)).toEqual(['syvogtyve']);
    expect(numberToTokens(42)).toEqual(['toogfyrre']);
    expect(numberToTokens(68)).toEqual(['otteogtres']);
    expect(numberToTokens(99)).toEqual(['nioghalvfems']);
  });

  it('uses en (not et) as the unit', () => {
    expect(numberToTokens(21)).toEqual(['enogtyve']);
    expect(numberToTokens(91)).toEqual(['enoghalvfems']);
  });
});

describe('hundreds and thousands', () => {
  it('100 / 101 / 342 — og only before a final <100 part', () => {
    expect(numberToTokens(100)).toEqual(['et', 'hundrede']);
    expect(numberToTokens(101)).toEqual(['et', 'hundrede', 'og', 'en']);
    expect(numberToTokens(342)).toEqual(['tre', 'hundrede', 'og', 'toogfyrre']);
    expect(numberToTokens(300)).toEqual(['tre', 'hundrede']);
    expect(numberToDanish(342)).toBe('tre hundrede og toogfyrre');
  });

  it('1000 / 2024 / 9999', () => {
    expect(numberToTokens(1000)).toEqual(['et', 'tusind']);
    expect(numberToTokens(2024)).toEqual(['to', 'tusind', 'og', 'fireogtyve']);
    expect(numberToTokens(9999)).toEqual(['ni', 'tusind', 'ni', 'hundrede', 'og', 'nioghalvfems']);
  });

  it('no og between tusind and a hundreds part', () => {
    expect(numberToTokens(2100)).toEqual(['to', 'tusind', 'et', 'hundrede']);
    expect(numberToTokens(2124)).toEqual(['to', 'tusind', 'et', 'hundrede', 'og', 'fireogtyve']);
  });
});

describe('yearToTokens', () => {
  it('reads 1100–1999 as pairs of digits (formal)', () => {
    expect(yearToTokens(1994)).toEqual(['nitten', 'hundrede', 'og', 'fireoghalvfems']);
    expect(yearToTokens(1900)).toEqual(['nitten', 'hundrede']);
    expect(yearToTokens(1789)).toEqual(['sytten', 'hundrede', 'og', 'niogfirs']);
  });

  it('reads 2000s as plain thousands', () => {
    expect(yearToTokens(2024)).toEqual(['to', 'tusind', 'og', 'fireogtyve']);
    expect(yearToTokens(2000)).toEqual(['to', 'tusind']);
  });
});

describe('priceToTokens', () => {
  it('appends kroner (the lesson-03 price example)', () => {
    expect(priceToTokens(77)).toEqual(['syvoghalvfjerds', 'kroner']);
    expect(priceToTokens(342)).toEqual(['tre', 'hundrede', 'og', 'toogfyrre', 'kroner']);
  });
});

describe('normalizeDigits', () => {
  it('strips regular, thin and no-break spaces', () => {
    expect(normalizeDigits('1 994')).toBe('1994');
    expect(normalizeDigits('1\u2009994')).toBe('1994'); // thin space
    expect(normalizeDigits('1\u00A0994')).toBe('1994'); // nbsp
    expect(normalizeDigits('1\u202F994')).toBe('1994'); // narrow nbsp
    expect(normalizeDigits(' 42 ')).toBe('42');
    expect(normalizeDigits('1994')).toBe('1994');
  });
});

describe('range enforcement', () => {
  it('throws for -1, 10000 and non-integers', () => {
    expect(() => numberToTokens(-1)).toThrow(RangeError);
    expect(() => numberToTokens(10000)).toThrow(RangeError);
    expect(() => numberToTokens(1.5)).toThrow(RangeError);
    expect(() => numberToDanish(-1)).toThrow(RangeError);
    expect(() => yearToTokens(10000)).toThrow(RangeError);
    expect(() => priceToTokens(-1)).toThrow(RangeError);
  });
});

describe('NUMBER_ATOMS closure', () => {
  const atoms = new Set(NUMBER_ATOMS);

  it('is the closed 105-atom set without duplicates', () => {
    expect(NUMBER_ATOMS).toHaveLength(105);
    expect(atoms.size).toBe(105);
    expect(atoms.has('et')).toBe(true);
    expect(atoms.has('syvoghalvfems')).toBe(true);
    expect(atoms.has('kroner')).toBe(true);
  });

  it('covers every token of every n in 0..9999', () => {
    for (let n = 0; n <= 9999; n++) {
      for (const t of numberToTokens(n)) {
        if (!atoms.has(t)) throw new Error(`atom missing for ${n}: ${t}`);
      }
    }
  });

  it('covers every year token in 1000..2099 and price samples', () => {
    for (let y = 1000; y <= 2099; y++) {
      for (const t of yearToTokens(y)) {
        if (!atoms.has(t)) throw new Error(`atom missing for year ${y}: ${t}`);
      }
    }
    for (const kr of [1, 77, 99, 100, 342, 999, 1250, 9999]) {
      for (const t of priceToTokens(kr)) expect(atoms.has(t)).toBe(true);
    }
  });
});

describe('NUMBER_LEVELS.gen', () => {
  it('0-20 spans its full range', () => {
    expect(level('0-20').gen(zeroRng)).toEqual({ value: 0, tokens: ['nul'], kind: 'number' });
    expect(level('0-20').gen(noShuffle)).toEqual({ value: 20, tokens: ['tyve'], kind: 'number' });
  });

  it('tiotal only yields whole tens 20–90', () => {
    expect(level('tiotal').gen(zeroRng)).toEqual({ value: 20, tokens: ['tyve'], kind: 'number' });
    expect(level('tiotal').gen(noShuffle)).toEqual({ value: 90, tokens: ['halvfems'], kind: 'number' });
  });

  it('0-99 spans its full range', () => {
    expect(level('0-99').gen(zeroRng).value).toBe(0);
    const top = level('0-99').gen(noShuffle);
    expect(top.value).toBe(99);
    expect(top.tokens).toEqual(['nioghalvfems']);
  });

  it('stora-tal picks number/year/price by the first draw', () => {
    const num = level('stora-tal').gen(seqRng(0, 0));
    expect(num).toEqual({ value: 100, tokens: ['et', 'hundrede'], kind: 'number' });

    const year = level('stora-tal').gen(seqRng(0.5, 0));
    expect(year).toEqual({ value: 1900, tokens: ['nitten', 'hundrede'], kind: 'year' });

    const price = level('stora-tal').gen(noShuffle);
    expect(price.kind).toBe('price');
    expect(price.value).toBe(999);
    expect(price.tokens.at(-1)).toBe('kroner');
  });

  it('every generated token is a NUMBER_ATOMS member', () => {
    const atoms = new Set(NUMBER_ATOMS);
    // Deterministic sweep over each tier with a coarse grid of rng values.
    for (const l of NUMBER_LEVELS) {
      for (let i = 0; i < 40; i++) {
        const r = i / 40;
        for (const t of l.gen(seqRng(r, (i * 7) % 40 / 40)).tokens) {
          expect(atoms.has(t)).toBe(true);
        }
      }
    }
  });
});

import { describe, it, expect } from 'vitest';
import { sentenceVerdict, NEAR_ERRORS_PER_CHARS } from './sentence-match.ts';

const DA = 'Hun har en blid stemme.';
const SV = 'Ibland tar jag cykeln till jobbet.';

describe('sentenceVerdict', () => {
  it('exact: case, edge punctuation and spacing are never errors', () => {
    expect(sentenceVerdict(DA, 'hun har en blid stemme')).toBe('exact');
    expect(sentenceVerdict(DA, '  Hun har  en blid stemme. ')).toBe('exact');
  });

  it('exact: Swedish-keyboard spellings fold for Danish targets', () => {
    expect(sentenceVerdict('Jeg kan godt lide grød.', 'jeg kan godt lide gröd')).toBe('exact');
  });

  it('exact: Swedish targets match their own letters unfolded', () => {
    expect(sentenceVerdict(SV, 'ibland tar jag cykeln till jobbet')).toBe('exact');
  });

  it('near: a single typo is forgiven but flagged', () => {
    expect(sentenceVerdict(DA, 'Hun har en blid stemma')).toBe('near');
  });

  it('near: internal punctuation slips spend budget instead of failing', () => {
    expect(sentenceVerdict('Tak, i lige måde.', 'Tak i lige måde')).toBe('near');
  });

  it(`budget scales: one extra error per ~${NEAR_ERRORS_PER_CHARS} chars`, () => {
    // SV normalizes to 33 chars → budget 2: two errors near, three wrong.
    expect(sentenceVerdict(SV, 'Ibland tar jag cykln till jobbat')).toBe('near');
    expect(sentenceVerdict(SV, 'Ibland tar jog cykln till jobbat')).toBe('wrong');
  });

  it('short sentences still get one forgiven error, never zero', () => {
    expect(sentenceVerdict('Tak for i dag', 'Tak for i dax')).toBe('near');
  });

  it('wrong: a different sentence, and blank attempts', () => {
    expect(sentenceVerdict(DA, 'Han købte en ny bil i går')).toBe('wrong');
    expect(sentenceVerdict(DA, '   ')).toBe('wrong');
  });
});

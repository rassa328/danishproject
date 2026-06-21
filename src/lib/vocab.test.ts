import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parse, deriveId, matchAnswer, acceptedAnswers, normalizeAnswer, clozeSentence } from './vocab.ts';
import { allCards, deckNames, getByTag } from './decks.ts';

const csv = readFileSync(new URL('../data/vocab/starter-deck.csv', import.meta.url), 'utf8');

describe('vocab.parse (real seed deck)', () => {
  it('parses with zero errors', () => {
    const { errors } = parse(csv);
    expect(errors).toEqual([]);
  });

  it('every card has required fields + a valid derived id', () => {
    const { cards } = parse(csv);
    for (const c of cards) {
      expect(c.danish).toBeTruthy();
      expect(c.swedish).toBeTruthy();
      expect(c.id).toMatch(/^da-[0-9a-f]+$/);
      expect(['b1', 'b2']).toContain(c.cefr);
    }
  });

  it('ids are unique across the deck', () => {
    const { cards } = parse(csv);
    expect(new Set(cards.map((c) => c.id)).size).toBe(cards.length);
  });
});

describe('clozeSentence', () => {
  const c = (over: Partial<Parameters<typeof clozeSentence>[0]>) =>
    ({ danish: 'løbe', accepted: [], exampleDa: '', ...over }) as Parameters<typeof clozeSentence>[0];

  it('blanks the exact headword form in the example', () => {
    expect(clozeSentence(c({ danish: 'løbe', exampleDa: 'Jeg kan lide at løbe.' }))).toBe('Jeg kan lide at ____.');
  });

  it('matches case-insensitively and keeps æ/ø/å boundaries', () => {
    expect(clozeSentence(c({ danish: 'øl', exampleDa: 'Øl smager godt.' }))).toBe('____ smager godt.');
  });

  it('blanks a multi-word phrase (longest form wins)', () => {
    const r = clozeSentence(c({ danish: 'ved siden af', exampleDa: 'Han sad ved siden af mig.' }));
    expect(r).toBe('Han sad ____ mig.');
  });

  it('matches an accepted inflected form when listed', () => {
    const r = clozeSentence(c({ danish: 'løbe', accepted: ['løber'], exampleDa: 'Jeg løber hver dag.' }));
    expect(r).toBe('Jeg ____ hver dag.');
  });

  it('returns null with no example, or when no form occurs as a whole word', () => {
    expect(clozeSentence(c({ exampleDa: '' }))).toBeNull();
    expect(clozeSentence(c({ danish: 'hund', exampleDa: 'Katten sover.' }))).toBeNull();
    // inflected-only occurrence with no accepted form → not cloze-able
    expect(clozeSentence(c({ danish: 'løbe', exampleDa: 'Jeg løber.' }))).toBeNull();
  });
});

describe('matchAnswer', () => {
  const card = (danish: string, accepted: string[] = []) => ({ danish, accepted });

  it('accepts the exact stored form (case/space/diacritic-insensitive trim)', () => {
    expect(matchAnswer('  Læse ', card('læse'))).toBe(true);
    expect(matchAnswer('hund', card('hund'))).toBe(true);
  });

  it('rejects a Swedish-letter spelling (never folds æ/ø/å)', () => {
    expect(matchAnswer('läse', card('læse'))).toBe(false);
    expect(matchAnswer(' books', card('bøger'))).toBe(false);
    expect(matchAnswer('bocker', card('bøger'))).toBe(false);
  });

  it('accepts any "/"-separated variant of the stored form', () => {
    const c = card('midlertidig / midlertidigt');
    expect(matchAnswer('midlertidig', c)).toBe(true);
    expect(matchAnswer('midlertidigt', c)).toBe(true);
  });

  it('accepts explicit synonyms/inflections from the accepted list', () => {
    const c = card('hoppe', ['springe']);
    expect(matchAnswer('hoppe', c)).toBe(true);
    expect(matchAnswer('springe', c)).toBe(true);
    expect(matchAnswer('løbe', c)).toBe(false);
  });

  it('rejects empty input', () => {
    expect(matchAnswer('', card('hund'))).toBe(false);
    expect(matchAnswer('   ', card('hund'))).toBe(false);
  });

  it('acceptedAnswers de-dupes and normalizes', () => {
    expect(acceptedAnswers(card('Hund / hund', ['HUND'])).sort()).toEqual(['hund']);
  });

  it('normalizeAnswer collapses whitespace and lowercases without folding', () => {
    expect(normalizeAnswer('  GÅ   nu ')).toBe('gå nu');
  });
});

describe('deriveId', () => {
  it('is deterministic', () => {
    expect(deriveId('blød', 'adj')).toBe(deriveId('blød', 'adj'));
  });
  it('is NFC-stable (å decomposed vs precomposed give the same id)', () => {
    expect(deriveId('måske'.normalize('NFC'), 'adv')).toBe(
      deriveId('måske'.normalize('NFD'), 'adv'),
    );
  });
});

describe('decks.ts (CSV loaded via ?raw at build)', () => {
  it('loads cards and themed decks', () => {
    expect(allCards.length).toBeGreaterThan(50);
    expect(deckNames()).toContain('falske-venner-b1');
    expect(getByTag('falsk-ven').length).toBeGreaterThan(10);
  });
});

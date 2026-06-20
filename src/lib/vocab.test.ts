import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parse, deriveId } from './vocab.ts';
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

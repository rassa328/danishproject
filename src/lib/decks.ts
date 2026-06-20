// Build-time vocab loader. Vite's `?raw` import inlines the CSV text at build,
// so there's no runtime fetch and the data ships as part of island props.
// strict:true => a malformed/duplicate row fails the build loudly.
import rawCsv from '../data/vocab/starter-deck.csv?raw';
import { parse, type Card } from './vocab.ts';

const result = parse(rawCsv, { strict: true });

export const allCards: Card[] = result.cards;
export const cardCount = allCards.length;

export const deckNames = (): string[] =>
  [...new Set(allCards.map((c) => c.deck))].sort();

export const getDeck = (name: string): Card[] =>
  allCards.filter((c) => c.deck === name);

export const getByTag = (tag: string): Card[] =>
  allCards.filter((c) => c.tags.includes(tag));

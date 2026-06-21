// Build-time loader for the large 5000-word practice deck. Kept SEPARATE from
// decks.ts (the curated starter deck) so the starter pages don't pay for it, and
// so this can be lazily hydrated (flashcards.astro uses client:idle). Vite `?raw`
// inlines the CSV at build; strict:true => a malformed/duplicate row fails loud.
import rawCsv from '../data/vocab/praksis-deck.csv?raw';
import { parse, type Card } from './vocab.ts';

const result = parse(rawCsv, { strict: true });

export const praksisCards: Card[] = result.cards;
export const praksisCount = praksisCards.length;

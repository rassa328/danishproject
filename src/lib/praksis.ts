// Build-time loader for the large 5000-word practice deck. Kept SEPARATE from
// decks.ts (the curated starter deck) so the starter pages don't pay for it.
// Vite `?raw` inlines the CSV at build; strict:true => a malformed/duplicate row
// fails loud. NOT for the browser: clients fetch the deck lazily as JSON from
// the praksis-cards.json endpoint (see lib/praksis-client.ts).
import rawCsv from '../data/vocab/praksis-deck.csv?raw';
import { allCards } from './decks.ts';
import { parse, type Card } from './vocab.ts';

const result = parse(rawCsv, { strict: true });

export const praksisCards: Card[] = result.cards;
export const praksisCount = praksisCards.length;

// Both CSVs contain some of the same (danish, pos) words, so ~100 praksis rows
// share their derived id — and therefore their SRS record — with a starter
// card. The starter copy is the richer twin (example, note, audio); the study
// union and all "N av M ord" totals use this de-duplicated view so every id is
// reachable exactly once.
const starterIds = new Set(allCards.map((c) => c.id));
export const praksisUnique: Card[] = praksisCards.filter((c) => !starterIds.has(c.id));
export const praksisUniqueCount = praksisUnique.length;

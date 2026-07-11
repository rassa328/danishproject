// Browser-side loader for the praksis deck: fetches the build-emitted
// praksis-cards.json exactly once and caches it in module state, shared by
// every island on the page (FlashcardReviewer, OrdlistaSearch). papaparse-free —
// the endpoint did the CSV parsing at build; this only JSON-parses.
// SSR-safe: nothing runs until someone calls fetchPraksis() in the browser.
import { withBase } from './url.ts';
import type { Card } from './vocab.ts';

let cache: Card[] | null = null;
let inflight: Promise<Card[]> | null = null;

/** The already-fetched deck, or null — lets callers skip await/loading UI. */
export const praksisCache = (): Card[] | null => cache;

/** Fetch the praksis deck (once). Rejects on network/HTTP failure — callers
 *  degrade to starter-only with a notice — but clears the in-flight promise
 *  first, so a later call can retry instead of caching the failure forever. */
export function fetchPraksis(): Promise<Card[]> {
  if (cache) return Promise.resolve(cache);
  inflight ??= fetch(withBase('praksis-cards.json'))
    .then((res) => {
      if (!res.ok) throw new Error(`praksis-cards.json: HTTP ${res.status}`);
      return res.json() as Promise<Card[]>;
    })
    .then((cards) => {
      cache = cards;
      return cards;
    })
    .catch((err: unknown) => {
      inflight = null;
      throw err;
    });
  return inflight;
}

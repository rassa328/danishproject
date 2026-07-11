// Static JSON endpoint: the 5000-word praksis deck, emitted at build as
// dist/praksis-cards.json. The flashcard reviewer and the ordlista search fetch
// it lazily (via withBase + lib/praksis-client.ts) instead of shipping every
// card in island props — that kept /flashcards HTML at ~1.8MB. papaparse runs
// only here (at build, through lib/praksis.ts); the browser just JSON-parses.
// Served pre-deduplicated against the starter deck (see praksisUnique) so
// clients never see a second copy of a card id.
import type { APIRoute } from 'astro';
import { praksisUnique } from '../lib/praksis.ts';

export const GET: APIRoute = () =>
  new Response(JSON.stringify(praksisUnique), {
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });

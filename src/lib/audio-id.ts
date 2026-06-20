// Isomorphic, dependency-free id/hashing helpers. Kept separate from vocab.ts
// (which imports papaparse) so the browser — notably the LessonAudio island —
// can import these WITHOUT pulling papaparse into the page bundle. The same
// functions run at build time (generator) and in the browser, so an id computed
// in either place always matches.

/** Unicode NFC-normalize + trim. NFC matters so macOS NFD vs spreadsheet NFC
 *  for å/æ/ø don't hash to two different ids for the same word. */
export const nfc = (s: string | undefined): string => (s ?? '').normalize('NFC').trim();

/** cyrb53 (bryc) — compact, well-distributed 53-bit hash, PURE JS so the same
 *  id is produced at build time AND in the browser import path. (SHA-256 isn't
 *  synchronous in browsers; an isomorphic sync hash is what id-stability needs.
 *  This is not a cryptographic use.) */
function cyrb53(str: string, seed = 0): number {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

/** Stable id from (danish, pos). Re-importing an edited list reconnects SRS
 *  state as long as danish+pos are unchanged. */
export function deriveId(danish: string, pos: string): string {
  const key = `${nfc(danish).toLowerCase()}|${nfc(pos).toLowerCase()}`;
  return 'da-' + cyrb53(key).toString(16).padStart(14, '0');
}

/** Canonicalize a lesson's `<span lang="da">` text into a stable audio key.
 *  Applied IDENTICALLY by the TTS generator (reading the raw .md source) and by
 *  the in-browser LessonAudio island (reading DOM textContent), so the clip
 *  filename always matches. Robust to Astro's markdown turning straight quotes
 *  into curly ones and to incidental whitespace differences. */
export const audioKey = (s: string): string =>
  nfc(s)
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, ' ')
    .trim();

/** Stable clip id for a piece of lesson text (word or whole sentence). Pos-less
 *  (`''`) so lesson prose needs no part-of-speech; isomorphic like deriveId. */
export const lessonAudioId = (text: string): string => deriveId(audioKey(text), '');

/** A span may override its pronunciation when the visible text alone is
 *  ambiguous (stød minimal pairs like `anden`/`anden`). The override is encoded
 *  as a token so two identically-spelled spans get different clip ids:
 *   - `ipa` → synthesized via SSML <phoneme alphabet="ipa">
 *   - `say` → synthesized as a different carrier phrase (fallback)
 *  Control char separator can't appear in span text or attribute values. */
export const spanOverrideToken = (a: { ipa?: string; say?: string }): string | undefined =>
  a.ipa ? 'ipa:' + a.ipa.trim() : a.say ? 'say:' + audioKey(a.say) : undefined;

/** Clip id for a lesson span. With no override this equals lessonAudioId(text),
 *  so every existing clip keeps its id; an override yields a distinct id. Used
 *  identically by the generator and the browser island. */
export const spanAudioId = (text: string, a: { ipa?: string; say?: string } = {}): string => {
  const tok = spanOverrideToken(a);
  return tok ? deriveId(audioKey(text) + '' + tok, '') : lessonAudioId(text);
};

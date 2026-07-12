// Input-side LIVE remap of Swedish letters as the user types in a Danish
// field. Not the same layer as session.ts's foldSwedish, which is a
// grading-time second chance on the already-typed answer.

const CHAR_MAP: Record<string, string> = {
  'ä': 'æ',
  'Ä': 'Æ',
  'ö': 'ø',
  'Ö': 'Ø',
};

/** ä→æ, Ä→Æ, ö→ø, Ö→Ø. Strictly 1:1 per codepoint — å/Å and everything else
 *  pass through, so length and character indices never change. */
export const mapToDanishChars = (s: string): string =>
  s.replace(/[äÄöÖ]/g, (ch) => CHAR_MAP[ch] ?? ch);

/** Fold the Swedish/Danish letter pairs to one canonical form for cross-language
 *  search: ä/æ → æ and ö/ø → ø (å is shared by both). Applied to both the query
 *  and the searched fields, so "smör" finds "smør" and vice versa. NFC +
 *  lowercase first. */
export const foldNordic = (s: string): string => mapToDanishChars(s.normalize('NFC').toLowerCase());

/** Remap an input's value while keeping the caret where the user left it.
 *  The 1:1 mapping guarantees the index itself is still valid; it is clamped
 *  to the string bounds only as a guard against bogus selectionStart values. */
export const remapWithCaret = (
  value: string,
  caret: number,
): { value: string; caret: number } => {
  const mapped = mapToDanishChars(value);
  return { value: mapped, caret: Math.min(Math.max(caret, 0), mapped.length) };
};

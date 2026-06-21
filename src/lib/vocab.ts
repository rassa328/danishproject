import Papa from 'papaparse';
import { nfc, deriveId, audioKey, lessonAudioId, spanAudioId } from './audio-id.ts';

// The isomorphic id/audio-key helpers live in audio-id.ts (papaparse-free so the
// browser can import them). Re-export so existing importers keep using vocab.ts.
export { nfc, deriveId, audioKey, lessonAudioId, spanAudioId };

export type Pos = 'noun' | 'verb' | 'adj' | 'adv' | 'num' | 'phrase' | 'other';
export type Cefr = 'b1' | 'b2';

export interface Card {
  id: string;
  danish: string;
  swedish: string;
  pos: Pos;
  exampleDa?: string;
  exampleSv?: string;
  note?: string;
  deck: string;
  cefr: Cefr;
  tags: string[];
  /** Extra Danish spellings accepted as correct (synonyms, inflections). The
   *  stored `danish` form and its `/`-separated variants are always accepted on
   *  top of these — see acceptedAnswers(). */
  accepted: string[];
  audio?: string;
  audioExample?: string;
  /** Optional frequency rank (1 = most frequent). Used to introduce new cards
   *  most-useful-first; absent on decks without a frequency list (sort last). */
  rank?: number;
}

export interface RowError {
  row: number;
  message: string;
  raw?: Record<string, string>;
}
export interface ParseResult {
  cards: Card[];
  errors: RowError[];
}

const POS = new Set<Pos>(['noun', 'verb', 'adj', 'adv', 'num', 'phrase', 'other']);
const CEFR = new Set<Cefr>(['b1', 'b2']);

// ---- answer matching ----
// trim + lowercase + collapse spaces, NFC only — never fold æ/ø/å. A Swedish
// spelling like "läse" (Danish "læse") must count as WRONG, so diacritics and
// the Nordic letters are significant.
export const normalizeAnswer = (s: string): string =>
  nfc(s).trim().toLowerCase().replace(/\s+/g, ' ');

/** Every Danish form accepted as correct for a card: the stored `danish` value,
 *  each `/`-separated variant of it (e.g. "midlertidig / midlertidigt"), and any
 *  explicit `accepted` synonyms/inflections — all normalized & de-duped. */
export function acceptedAnswers(card: Pick<Card, 'danish' | 'accepted'>): string[] {
  const variants = card.danish.split('/').map((s) => s.trim());
  const all = [...variants, ...(card.accepted ?? [])].map(normalizeAnswer).filter(Boolean);
  return [...new Set(all)];
}

/** True if the learner's typed answer matches any accepted Danish form. */
export function matchAnswer(typed: string, card: Pick<Card, 'danish' | 'accepted'>): boolean {
  const t = normalizeAnswer(typed);
  return t.length > 0 && acceptedAnswers(card).includes(t);
}

const escapeRegex = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** A fill-in-the-blank version of the card's Danish example: the first occurrence
 *  of the headword (or an accepted form, longest first so phrases win) replaced
 *  with "____". Returns null if there's no example or no form is found in it —
 *  the caller then excludes the card from cloze practice. \p{L} boundaries keep
 *  æ/ø/å intact; matching is case-insensitive against the original sentence. */
export function clozeSentence(card: Pick<Card, 'danish' | 'accepted' | 'exampleDa'>): string | null {
  const ex = card.exampleDa;
  if (!ex) return null;
  const forms = [...new Set(acceptedAnswers(card))].filter(Boolean).sort((a, b) => b.length - a.length);
  for (const f of forms) {
    const re = new RegExp(`(^|[^\\p{L}])(${escapeRegex(f)})(?![\\p{L}])`, 'iu');
    const m = re.exec(ex);
    if (m) {
      const start = m.index + (m[1] as string).length;
      return ex.slice(0, start) + '____' + ex.slice(start + (m[2] as string).length);
    }
  }
  return null;
}

const splitTags = (s: string | undefined): string[] =>
  nfc(s)
    .split(/[|,]/)
    .map((t) => t.trim())
    .filter(Boolean);

function toCard(raw: Record<string, string>): { card?: Card; error?: string } {
  const danish = nfc(raw.danish);
  const swedish = nfc(raw.swedish);
  if (!danish) return { error: 'missing danish' };
  if (!swedish) return { error: 'missing swedish' };

  const pos = (nfc(raw.pos).toLowerCase() || 'other') as Pos;
  if (!POS.has(pos)) return { error: `invalid pos "${raw.pos}"` };

  const cefr = (nfc(raw.cefr).toLowerCase() || 'b1') as Cefr;
  if (!CEFR.has(cefr)) return { error: `invalid cefr "${raw.cefr}"` };

  const card: Card = {
    id: nfc(raw.id) || deriveId(danish, pos),
    danish,
    swedish,
    pos,
    deck: nfc(raw.deck) || 'allmänt-b1',
    cefr,
    tags: splitTags(raw.tags),
    accepted: splitTags(raw.accepted),
  };
  const exDa = nfc(raw.example_da);
  if (exDa) card.exampleDa = exDa;
  const exSv = nfc(raw.example_sv);
  if (exSv) card.exampleSv = exSv;
  const note = nfc(raw.note);
  if (note) card.note = note;
  const audio = nfc(raw.audio);
  if (audio) card.audio = audio;
  const audioEx = nfc(raw.audio_example);
  if (audioEx) card.audioExample = audioEx;
  const rank = Number(nfc(raw.rank));
  if (Number.isFinite(rank) && rank > 0) card.rank = rank;
  return { card };
}

/** Parse CSV text into typed cards. Shared by the build loader (strict: fail
 *  loud) and the browser ImportWizard (lenient: skip bad rows). */
export function parse(csv: string, opts: { strict?: boolean } = {}): ParseResult {
  const parsed = Papa.parse<Record<string, string>>(csv, {
    header: true,
    skipEmptyLines: true,
  });
  const cards: Card[] = [];
  const errors: RowError[] = [];
  const seen = new Map<string, number>();

  parsed.data.forEach((raw, i) => {
    const rowNum = i + 2; // +1 header line, +1 for 1-based
    const { card, error } = toCard(raw);
    if (error || !card) {
      errors.push({ row: rowNum, message: error ?? 'invalid row', raw });
      return;
    }
    const prev = seen.get(card.id);
    if (prev !== undefined) {
      errors.push({
        row: rowNum,
        message: `duplicate id ${card.id} (same danish+pos as row ${prev}, or a hash collision) — drop the dupe or set an explicit id`,
        raw,
      });
      return;
    }
    seen.set(card.id, rowNum);
    cards.push(card);
  });

  if (opts.strict && errors.length) {
    throw new Error(
      `vocab parse failed (${errors.length} error(s)): ` +
        errors.map((e) => `row ${e.row}: ${e.message}`).join('; '),
    );
  }
  return { cards, errors };
}

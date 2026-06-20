import Papa from 'papaparse';

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
  audio?: string;
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
  };
  const exDa = nfc(raw.example_da);
  if (exDa) card.exampleDa = exDa;
  const exSv = nfc(raw.example_sv);
  if (exSv) card.exampleSv = exSv;
  const note = nfc(raw.note);
  if (note) card.note = note;
  const audio = nfc(raw.audio);
  if (audio) card.audio = audio;
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

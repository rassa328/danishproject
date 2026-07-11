// Pure logic for /zen — the full-screen "Fokus" practice presentation
// (designs: Tal Fokus v2 = dark, Tal Fokus - Morgendis v2 = light), one quiet
// loop generalized over BOTH subjects: ord (the vocabulary, via the
// DRILL_MODES registry + SRS store) and tal (the number generators + composed
// real clips). The Svelte island (Zen.svelte) only wires DOM, audio and
// timers — every decision that can be unit-tested lives here (the same split
// as drill-engine/drill-modes).
//
// Nothing is duplicated: number logic comes from danish-numbers.ts, word
// items/grading from drill-modes.ts, queueing from session.ts buildQueue
// (due-only 'repetera' via match {kind:'all'}, shuffled-everything 'blandat'
// via the free flag).

import {
  NUMBER_LEVELS,
  normalizeDigits,
  numberToTokens,
  type NumberKind,
  type NumberLevelId,
} from './danish-numbers.ts';
import {
  DRILL_MODES,
  type DrillItem,
  type DrillModeId,
} from './drill-modes.ts';
import type { QueueLimits, Rng, SrsView } from './session.ts';
import type { Card } from './vocab.ts';
import type { Direction } from './storage.ts';
import { UI } from './strings.ts';

const T = UI.zen;

export type ZenSubject = 'ord' | 'tal';
export type ZenMode = 'lyssna' | 'översätt';
export type ZenLang = 'danska' | 'svenska';
export type WordSourceId = 'repetera' | 'blandat';
export type ZenStep = 'subject' | 'mode' | 'lang' | 'source' | 'begin';

export const SUBJECT_IDS: readonly ZenSubject[] = ['ord', 'tal'];
export const MODE_IDS: readonly ZenMode[] = ['lyssna', 'översätt'];
export const LANG_IDS: readonly ZenLang[] = ['danska', 'svenska'];
export const LEVEL_IDS: readonly NumberLevelId[] = NUMBER_LEVELS.map((l) => l.id);
export const WORD_SOURCE_IDS: readonly WordSourceId[] = ['repetera', 'blandat'];

/** Runtime gates on the source step: which lyssna number levels have FULL
 *  clip coverage (a partial level would go silent mid-session — real
 *  recordings only, never TTS), and whether anything is due for the chosen
 *  word direction ('repetera' is pointless when the answer is no). */
export interface ZenGates {
  coverage: Record<NumberLevelId, boolean>;
  hasDue: boolean;
}

/** The start flow: one step on screen at a time. Earlier picks are kept —
 *  per subject for the source — so stepping back (and next session's
 *  restored prefs) highlights them. */
export interface ZenFlow {
  step: ZenStep;
  subject: ZenSubject | null;
  mode: ZenMode | null;
  dispLang: ZenLang | null;
  /** tal's source pick. */
  level: NumberLevelId | null;
  /** ord's source pick. */
  wordSource: WordSourceId | null;
}

export const initialFlow = (): ZenFlow => ({
  step: 'subject',
  subject: null,
  mode: null,
  dispLang: null,
  level: null,
  wordSource: null,
});

/** The ids the highlight can land on for the current step (arrow keys).
 *  Gated options are excluded — they render disabled but can't be picked. */
export function stepOptions(flow: ZenFlow, gates: ZenGates): string[] {
  switch (flow.step) {
    case 'subject':
      return [...SUBJECT_IDS];
    case 'mode':
      return [...MODE_IDS];
    case 'lang':
      return [...LANG_IDS];
    case 'source':
      if (flow.subject === 'tal') {
        return LEVEL_IDS.filter((id) => !(flow.mode === 'lyssna' && !gates.coverage[id]));
      }
      return WORD_SOURCE_IDS.filter((id) => !(id === 'repetera' && !gates.hasDue));
    case 'begin':
      return [];
  }
}

/** Apply a pick on the current step. Returns the SAME object when the pick
 *  is invalid (unknown id, gated option) so callers can cheaply no-op. */
export function pick(flow: ZenFlow, gates: ZenGates, id: string): ZenFlow {
  switch (flow.step) {
    case 'subject': {
      if (!(SUBJECT_IDS as readonly string[]).includes(id)) return flow;
      return { ...flow, subject: id as ZenSubject, step: 'mode' };
    }
    case 'mode': {
      if (!(MODE_IDS as readonly string[]).includes(id)) return flow;
      const mode = id as ZenMode;
      const next: ZenFlow = { ...flow, mode, step: mode === 'översätt' ? 'lang' : 'source' };
      // A remembered source the new mode can't serve must not survive the pick.
      if (mode === 'lyssna' && flow.subject === 'tal' && flow.level && !gates.coverage[flow.level]) {
        next.level = null;
      }
      return next;
    }
    case 'lang': {
      if (!(LANG_IDS as readonly string[]).includes(id)) return flow;
      return { ...flow, dispLang: id as ZenLang, step: 'source' };
    }
    case 'source': {
      if (!stepOptions(flow, gates).includes(id)) return flow;
      return flow.subject === 'tal'
        ? { ...flow, level: id as NumberLevelId, step: 'begin' }
        : { ...flow, wordSource: id as WordSourceId, step: 'begin' };
    }
    case 'begin':
      return flow;
  }
}

/** Esc / "tillbaka": one step up, skipping 'lang' in lyssna (it was never
 *  shown). Picks are kept. No-op (same object) on the first step. */
export function back(flow: ZenFlow): ZenFlow {
  switch (flow.step) {
    case 'begin':
      return { ...flow, step: 'source' };
    case 'source':
      return { ...flow, step: flow.mode === 'översätt' ? 'lang' : 'mode' };
    case 'lang':
      return { ...flow, step: 'mode' };
    case 'mode':
      return { ...flow, step: 'subject' };
    case 'subject':
      return flow;
  }
}

/** Where the highlight starts on a step: the option already picked (restored
 *  prefs / stepping back), else the first. */
export function highlightIndex(flow: ZenFlow, gates: ZenGates): number {
  const selected =
    flow.step === 'subject'
      ? flow.subject
      : flow.step === 'mode'
        ? flow.mode
        : flow.step === 'lang'
          ? flow.dispLang
          : flow.subject === 'tal'
            ? flow.level
            : flow.wordSource;
  const i = selected === null ? -1 : stepOptions(flow, gates).indexOf(selected);
  return i >= 0 ? i : 0;
}

/** Cyclic arrow-key movement (…3, 0, 1… for n=4). */
export function wrapIndex(i: number, delta: number, n: number): number {
  return (((i + delta) % n) + n) % n;
}

export interface ReadyZenFlow extends ZenFlow {
  subject: ZenSubject;
  mode: ZenMode;
}

/** Begynd is allowed once every step the picks need has one. */
export function isReady(flow: ZenFlow): flow is ReadyZenFlow {
  if (flow.subject === null || flow.mode === null) return false;
  if (flow.mode === 'översätt' && flow.dispLang === null) return false;
  return flow.subject === 'tal' ? flow.level !== null : flow.wordSource !== null;
}

// ---------------------------------------------------------------------------
// Flow → session shape

/** What the answer input takes. digits: numeric keypad; danish: lang=da with
 *  live ä/ö→æ/ø; swedish: plain text (översätt-from-danska for ord). */
export type ZenInputKind = 'digits' | 'danish' | 'swedish';

export function inputKind(flow: ZenFlow): ZenInputKind {
  if (flow.subject === 'tal') {
    return flow.mode === 'lyssna' || flow.dispLang === 'danska' ? 'digits' : 'danish';
  }
  if (flow.mode === 'lyssna') return 'danish';
  return flow.dispLang === 'danska' ? 'swedish' : 'danish';
}

/** ord flows map 1:1 onto the existing word drill modes — items, grading and
 *  audio come from the registry verbatim. */
export function wordModeId(flow: ZenFlow): DrillModeId | null {
  if (flow.subject !== 'ord' || flow.mode === null) return null;
  if (flow.mode === 'lyssna') return 'da-dictation';
  if (flow.dispLang === null) return null;
  return flow.dispLang === 'danska' ? 'da-sv' : 'sv-da';
}

/** The SRS direction a word flow trains — shared with the flashcards, so zen
 *  'repetera' drains the same dueness. */
export function wordDirection(flow: ZenFlow): Direction | null {
  const modeId = wordModeId(flow);
  const mode = modeId ? DRILL_MODES[modeId] : null;
  return mode?.srs?.direction ?? null;
}

/** Anything due (not suspended) for this direction right now? Mirrors
 *  buildQueue's dueness test; gates the 'repetera' source option. */
export function anyDue(cards: Card[], srs: SrsView, direction: Direction, now: Date): boolean {
  return cards.some((c) => {
    const r = srs.getRecord(c.id, direction);
    return r !== null && !r.suspended && new Date(r.due) <= now;
  });
}

// ---------------------------------------------------------------------------
// Session items

export type ZenItem =
  | { type: 'tal'; value: number; tokens: string[]; kind: NumberKind }
  | { type: 'ord'; item: DrillItem };

/** n draws from the number level's generator, rerolling up to 8× so the same
 *  value never lands twice in a row (small pools like tiotal may still
 *  repeat later in the session — design parity). */
export function buildNumberSession(level: NumberLevelId, n: number, rng: Rng): ZenItem[] {
  const lvl = NUMBER_LEVELS.find((l) => l.id === level);
  if (!lvl) throw new RangeError(`unknown number level: ${level}`);
  const items: ZenItem[] = [];
  let prev: number | null = null;
  for (let i = 0; i < n; i++) {
    let item = lvl.gen(rng);
    for (let tries = 0; tries < 8 && prev !== null && item.value === prev; tries++) {
      item = lvl.gen(rng);
    }
    prev = item.value;
    items.push({ type: 'tal', ...item });
  }
  return items;
}

/** Word session via the registry: 'repetera' = due-only most-overdue-first
 *  (match {kind:'all'}), 'blandat' = everything eligible shuffled (free). */
export function buildWordSession(opts: {
  modeId: DrillModeId;
  source: WordSourceId;
  cards: Card[];
  srs: SrsView;
  now: Date;
  limits: QueueLimits;
  size: number;
  rng?: Rng;
}): ZenItem[] {
  const items = DRILL_MODES[opts.modeId].buildItems({
    cards: opts.cards,
    srs: opts.srs,
    now: opts.now,
    limits: opts.limits,
    match: { kind: 'all' },
    free: opts.source === 'blandat',
    size: opts.size,
    ...(opts.rng !== undefined ? { rng: opts.rng } : {}),
  });
  return items.map((item) => ({ type: 'ord' as const, item }));
}

// ---------------------------------------------------------------------------
// Grading

/** Grading-time folding for Danish number readings: case/whitespace-
 *  insensitive, ä/ö read as æ/ø (the Swedish-keyboard second chance — the
 *  input-side live remap already does this; the fold keeps pasted text
 *  honest). Danish number words never contain å, so it needs no rule. */
const fold = (s: string): string =>
  s
    .toLowerCase()
    .trim()
    .replace(/\s+/gu, ' ')
    .replace(/[äö]/gu, (ch) => (ch === 'ä' ? 'æ' : 'ø'));

/** Spacing between number tokens is never graded: 'syv og tyve' ≡ 'syvogtyve'. */
const squash = (s: string): string => s.replaceAll(' ', '');

export type TalItem = Extract<ZenItem, { type: 'tal' }>;

/** Digit answers: thousands spaces stripped, then an exact value match. */
export function gradeDigits(typed: string, item: TalItem): boolean {
  const digits = normalizeDigits(typed);
  return digits !== '' && Number(digits) === item.value;
}

/** Danish number readings. Accepted: the item's token reading; for prices
 *  also the bare cardinal (utan 'kroner'); for years also the plain-number
 *  reading ('et tusind ni hundrede …'). */
export function gradeDanishNumber(typed: string, item: TalItem): boolean {
  const t = squash(fold(typed));
  if (t === '') return false;
  const candidates = [item.tokens.join(' ')];
  if (item.kind === 'price' || item.kind === 'year') {
    candidates.push(numberToTokens(item.value).join(' '));
  }
  return candidates.some((c) => squash(fold(c)) === t);
}

/** One grading entry point for the island: numbers by input kind, words by
 *  the registry mode's matcher (Swedish folding, accepted alternatives …). */
export function gradeZen(typed: string, zi: ZenItem, flow: ZenFlow): boolean {
  if (zi.type === 'tal') {
    return inputKind(flow) === 'digits' ? gradeDigits(typed, zi) : gradeDanishNumber(typed, zi);
  }
  const modeId = wordModeId(flow);
  return modeId !== null && DRILL_MODES[modeId].matches(typed, zi.item);
}

// ---------------------------------------------------------------------------
// Display

/** The visible prompt for translate flows; null = audio prompt (lyssna). */
export function zenPrompt(zi: ZenItem, flow: ZenFlow): { text: string; lang: 'da' | null } | null {
  if (flow.mode === 'lyssna') return null;
  if (zi.type === 'tal') {
    if (flow.dispLang === 'danska') return { text: zi.tokens.join(' '), lang: 'da' };
    const text =
      zi.kind === 'year'
        ? T.year(zi.value)
        : zi.kind === 'price'
          ? T.kronor(zi.value)
          : String(zi.value);
    return { text, lang: null };
  }
  // ord översätt: the item prompt is Danish when it shows danska (da-sv).
  return { text: zi.item.prompt, lang: flow.dispLang === 'danska' ? 'da' : null };
}

export interface ZenReveal {
  correct: boolean;
  /** The big line — ALWAYS the Danish form (the learning object). */
  word: string;
  /** The quiet line: the other side (digits / Swedish gloss), plus what the
   *  learner wrote on a miss. */
  sub: string;
}

/** The digits shown on a tal reveal ('42', '1994', '42 kr'). */
export function digitsLabel(item: TalItem): string {
  return String(item.value) + (item.kind === 'price' ? ' kr' : '');
}

export function zenReveal(zi: ZenItem, typed: string, correct: boolean): ZenReveal {
  const word = zi.type === 'tal' ? zi.tokens.join(' ') : (zi.item.card?.danish ?? zi.item.answer);
  const base = zi.type === 'tal' ? digitsLabel(zi) : (zi.item.card?.swedish ?? zi.item.prompt);
  const sub = correct ? base : `${base}  ·  ${T.youWrote} ${typed.trim()}`;
  return { correct, word, sub };
}

// ---------------------------------------------------------------------------
// Prefs

export const PREFS_KEY = 'zen.prefs.v1';

export interface ZenPrefs {
  subject: ZenSubject | null;
  mode: ZenMode | null;
  dispLang: ZenLang | null;
  level: NumberLevelId | null;
  wordSource: WordSourceId | null;
}

/** Parse a stored prefs blob; anything unknown or malformed becomes null so
 *  a stale/foreign value can never preselect an invalid option. */
export function parsePrefs(raw: string | null): ZenPrefs {
  const none: ZenPrefs = { subject: null, mode: null, dispLang: null, level: null, wordSource: null };
  if (raw === null) return none;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return none;
  }
  if (typeof data !== 'object' || data === null) return none;
  const o = data as Record<string, unknown>;
  const valid = <T extends string>(ids: readonly T[], v: unknown): T | null =>
    typeof v === 'string' && (ids as readonly string[]).includes(v) ? (v as T) : null;
  return {
    subject: valid(SUBJECT_IDS, o.subject),
    mode: valid(MODE_IDS, o.mode),
    dispLang: valid(LANG_IDS, o.dispLang),
    level: valid(LEVEL_IDS, o.level),
    wordSource: valid(WORD_SOURCE_IDS, o.wordSource),
  };
}

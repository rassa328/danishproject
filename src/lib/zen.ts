// Pure logic for /zen — the full-screen "Fokus" practice presentation
// (designs: Tal Fokus v2 = dark, Tal Fokus - Morgendis v2 = light). One quiet
// loop; the start flow (user feedback 2026-07-11) is mode → riktning
// (översätt only) → källa (repetera · blandat · tal · the flashcard sets) →
// Begynd. tal has no levels (round 4): one pool of 0–100. The Svelte island (Zen.svelte) only wires DOM,
// audio and timers — every decision that can be unit-tested lives here (the
// same split as drill-engine/drill-modes).
//
// Nothing is duplicated: number logic comes from danish-numbers.ts, word
// items/grading from drill-modes.ts (sessions build items, per-item
// SUB_CONFIGS grade them), set descriptors from deck-groups, queueing from
// session.ts buildQueue (due-only 'repetera' via match {kind:'all'}, free
// 'blandat', scheduled set sessions via the set's own match).

import { normalizeDigits, numberToTokens, type NumberKind } from './danish-numbers.ts';
import { planClips, type NumberAudioManifest } from './number-audio.ts';
import {
  DRILL_SESSIONS,
  subConfigOf,
  type DrillItem,
  type DrillSessionId,
} from './drill-modes.ts';
import type { GroupMatch, StudyGroup } from './deck-groups.ts';
import type { QueueLimits, Rng, SrsView } from './session.ts';
import type { Card } from './vocab.ts';
import type { Direction } from './storage.ts';
import { UI } from './strings.ts';

const T = UI.zen;

export type ZenMode = 'lyssna' | 'översätt';
/** Riktning (översätt only): which side is SHOWN → which side is typed.
 *  For tal, sv-da means "ser siffror · skriver danska" and vice versa. */
export type ZenDirection = 'sv-da' | 'da-sv';
export type ZenStep = 'mode' | 'direction' | 'source' | 'begin';

export const MODE_IDS: readonly ZenMode[] = ['lyssna', 'översätt'];
export const DIRECTION_IDS: readonly ZenDirection[] = ['sv-da', 'da-sv'];
/** tal is ONE pool: 0–100 (user decision round 4 — no levels, no stora tal). */
export const TAL_MAX = 100;
export const ALL_TAL: readonly number[] = Object.freeze(
  Array.from({ length: TAL_MAX + 1 }, (_, v) => v),
);

/** The 0–100 values every clip of which is committed — lyssna's pool. Grows
 *  automatically as recordings land (real recordings only, never TTS; a
 *  value with any missing atom is never drawn, so nothing goes silent). */
export function playableTal(manifest: NumberAudioManifest | null): number[] {
  if (!manifest) return [];
  return ALL_TAL.filter((v) => planClips(numberToTokens(v), manifest) !== null);
}
/** Fixed källa ids; sets are appended as `set:<group.id>`. */
export const SOURCE_REPETERA = 'repetera';
export const SOURCE_BLANDAT = 'blandat';
export const SOURCE_TAL = 'tal';

/** A pickable flashcard set (from the flashcards' study groups). */
export interface ZenSet {
  id: string;
  label: string;
  match: GroupMatch;
}

/** The due-all synthetic group IS zen's 'repetera' — everything else becomes
 *  a källa option. */
export function zenSets(groups: StudyGroup[]): ZenSet[] {
  return groups
    .filter((g) => g.match.kind !== 'all')
    .map((g) => ({ id: g.id, label: g.label, match: g.match }));
}

export const setSourceId = (set: ZenSet): string => `set:${set.id}`;

export function setForSource(source: string | null, sets: ZenSet[]): ZenSet | null {
  if (source === null || !source.startsWith('set:')) return null;
  const id = source.slice(4);
  return sets.find((s) => s.id === id) ?? null;
}

/** Everything the source step gates on at runtime. */
export interface ZenContext {
  /** The 0–100 values lyssna can compose from committed clips (playableTal).
   *  Empty → tal is hidden in lyssna; översätt never needs clips. */
  talPlayable: readonly number[];
  /** Anything due for the flow's direction — gates 'repetera'. */
  hasDue: boolean;
  sets: ZenSet[];
}

/** The start flow: one step on screen at a time. Earlier picks are kept so
 *  stepping back (and next session's restored prefs) highlights them. */
export interface ZenFlow {
  step: ZenStep;
  mode: ZenMode | null;
  direction: ZenDirection | null;
  /** 'repetera' | 'blandat' | 'tal' | `set:<id>`. */
  source: string | null;
}

export const initialFlow = (): ZenFlow => ({
  step: 'mode',
  mode: null,
  direction: null,
  source: null,
});

/** tal is offered in lyssna only while at least one number is fully clip-
 *  covered; in översätt it is always available. */
export function talAvailable(flow: ZenFlow, ctx: ZenContext): boolean {
  if (flow.mode !== 'lyssna') return true;
  return ctx.talPlayable.length > 0;
}

/** The ids the highlight can land on for the current step (arrow keys).
 *  Gated options are excluded — they render disabled but can't be picked. */
export function stepOptions(flow: ZenFlow, ctx: ZenContext): string[] {
  switch (flow.step) {
    case 'mode':
      return [...MODE_IDS];
    case 'direction':
      return [...DIRECTION_IDS];
    case 'source': {
      const ids: string[] = [];
      if (ctx.hasDue) ids.push(SOURCE_REPETERA);
      ids.push(SOURCE_BLANDAT);
      if (talAvailable(flow, ctx)) ids.push(SOURCE_TAL);
      ids.push(...ctx.sets.map(setSourceId));
      return ids;
    }
    case 'begin':
      return [];
  }
}

/** Apply a pick on the current step. Returns the SAME object when the pick
 *  is invalid (unknown id, gated option) so callers can cheaply no-op. */
export function pick(flow: ZenFlow, ctx: ZenContext, id: string): ZenFlow {
  switch (flow.step) {
    case 'mode': {
      if (!(MODE_IDS as readonly string[]).includes(id)) return flow;
      const mode = id as ZenMode;
      // Riktning only exists for översätt; lyssna is always Danish → you.
      return { ...flow, mode, step: mode === 'översätt' ? 'direction' : 'source' };
    }
    case 'direction': {
      if (!(DIRECTION_IDS as readonly string[]).includes(id)) return flow;
      return { ...flow, direction: id as ZenDirection, step: 'source' };
    }
    case 'source': {
      if (!stepOptions(flow, ctx).includes(id)) return flow;
      return { ...flow, source: id, step: 'begin' };
    }
    case 'begin':
      return flow;
  }
}

/** Esc / "tillbaka": one step up, entering only the steps that were shown.
 *  No-op (same object) on the first step — the island exits zen instead. */
export function back(flow: ZenFlow): ZenFlow {
  switch (flow.step) {
    case 'begin':
      return { ...flow, step: 'source' };
    case 'source':
      return { ...flow, step: flow.mode === 'översätt' ? 'direction' : 'mode' };
    case 'direction':
      return { ...flow, step: 'mode' };
    case 'mode':
      return flow;
  }
}

/** Where the highlight starts on a step: the option already picked (restored
 *  prefs / stepping back), else the first. */
export function highlightIndex(flow: ZenFlow, ctx: ZenContext): number {
  const selected =
    flow.step === 'mode'
      ? flow.mode
      : flow.step === 'direction'
        ? flow.direction
        : flow.source;
  const i = selected === null ? -1 : stepOptions(flow, ctx).indexOf(selected);
  return i >= 0 ? i : 0;
}

/** Cyclic arrow-key movement (…3, 0, 1… for n=4). */
export function wrapIndex(i: number, delta: number, n: number): number {
  return (((i + delta) % n) + n) % n;
}

export interface ReadyZenFlow extends ZenFlow {
  mode: ZenMode;
  source: string;
}

/** Begynd is allowed once every step the picks need has one. */
export function isReady(flow: ZenFlow): flow is ReadyZenFlow {
  if (flow.mode === null || flow.source === null) return false;
  return !(flow.mode === 'översätt' && flow.direction === null);
}

/** repetera and set sessions grade (one dueness per card+skill, shared with
 *  the flashcards); blandat is free practice; numbers have no SRS in v1. */
export function sourceIsGraded(source: string | null): boolean {
  return source === SOURCE_REPETERA || (source !== null && source.startsWith('set:'));
}

// ---------------------------------------------------------------------------
// Flow → session shape

/** What the answer input takes. digits: numeric keypad; danish: lang=da with
 *  live ä/ö→æ/ø; swedish: plain text. Per ITEM — the sub knows its side. */
export type ZenInputKind = 'digits' | 'danish' | 'swedish';

export function itemInputKind(zi: ZenItem, flow: ZenFlow): ZenInputKind {
  if (zi.type === 'tal') {
    // lyssna and 'danska → svenska' answer in digits; 'svenska → danska'
    // writes the Danish reading.
    return flow.mode === 'översätt' && flow.direction === 'sv-da' ? 'danish' : 'digits';
  }
  return subConfigOf(zi.item).input.lang === 'da' ? 'danish' : 'swedish';
}

/** Word flows map onto the drill session builders. null = a tal flow. */
export function wordSessionId(flow: ZenFlow): DrillSessionId | null {
  if (flow.source === SOURCE_TAL || flow.mode === null) return null;
  if (flow.mode === 'lyssna') return 'listen';
  if (flow.direction === null) return null;
  return flow.direction === 'sv-da' ? 'translate-sv-da' : 'translate-da-sv';
}

/** The SRS directions a word flow trains — shared with the flashcards, so
 *  zen 'repetera' drains the same dueness. */
export function wordDirections(flow: ZenFlow): Direction[] {
  if (flow.mode === 'lyssna') return ['listen'];
  if (flow.mode === 'översätt' && flow.direction !== null) {
    return [flow.direction === 'sv-da' ? 'produce' : 'recognize'];
  }
  return [];
}

/** The direction one graded item writes to (null = ungraded item). */
export function itemDirection(zi: ZenItem): Direction | null {
  if (zi.type === 'tal') return null;
  return subConfigOf(zi.item).srs?.direction ?? null;
}

/** Anything due (not suspended) in ANY of these directions right now?
 *  Mirrors buildQueue's dueness test; gates the 'repetera' source option. */
export function anyDue(cards: Card[], srs: SrsView, directions: Direction[], now: Date): boolean {
  return cards.some((c) =>
    directions.some((direction) => {
      const r = srs.getRecord(c.id, direction);
      return r !== null && !r.suspended && new Date(r.due) <= now;
    }),
  );
}

// ---------------------------------------------------------------------------
// Session items

export type ZenItem =
  | { type: 'tal'; value: number; tokens: string[]; kind: NumberKind }
  | { type: 'ord'; item: DrillItem };

export type TalItem = Extract<ZenItem, { type: 'tal' }>;

/** n uniform draws from the given value pool (ALL_TAL for översätt, the
 *  clip-playable subset for lyssna), rerolling up to 8× so the same value
 *  never lands twice in a row (tiny pools may still repeat later). */
export function buildNumberSession(pool: readonly number[], n: number, rng: Rng): ZenItem[] {
  if (pool.length === 0) throw new RangeError('empty tal pool');
  const draw = (): number => pool[Math.floor(rng() * pool.length)] ?? 0;
  const items: ZenItem[] = [];
  let prev: number | null = null;
  for (let i = 0; i < n; i++) {
    let value = draw();
    for (let tries = 0; tries < 8 && prev !== null && value === prev; tries++) {
      value = draw();
    }
    prev = value;
    items.push({ type: 'tal', value, tokens: numberToTokens(value), kind: 'number' });
  }
  return items;
}

/** The queue descriptor a word källa builds with: repetera = due-only over
 *  everything; blandat = free roam over everything; a set = its own match,
 *  scheduled like the flashcards (due first, then new under the budget). */
export function sourceQueue(
  source: string,
  sets: ZenSet[],
): { match: GroupMatch; free: boolean } | null {
  if (source === SOURCE_REPETERA) return { match: { kind: 'all' }, free: false };
  if (source === SOURCE_BLANDAT) return { match: { kind: 'all' }, free: true };
  const set = setForSource(source, sets);
  return set ? { match: set.match, free: false } : null;
}

/** Word session via the drill session registry. */
export function buildWordSession(opts: {
  sessionId: DrillSessionId;
  match: GroupMatch;
  free: boolean;
  cards: Card[];
  srs: SrsView;
  now: Date;
  limits: QueueLimits;
  size: number;
  rng?: Rng;
}): ZenItem[] {
  const items = DRILL_SESSIONS[opts.sessionId].buildItems({
    cards: opts.cards,
    srs: opts.srs,
    now: opts.now,
    limits: opts.limits,
    match: opts.match,
    free: opts.free,
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
 *  the item sub's matcher (Swedish folding, accepted alternatives …). */
export function gradeZen(typed: string, zi: ZenItem, flow: ZenFlow): boolean {
  if (zi.type === 'tal') {
    return itemInputKind(zi, flow) === 'digits'
      ? gradeDigits(typed, zi)
      : gradeDanishNumber(typed, zi);
  }
  return subConfigOf(zi.item).matches(typed, zi.item);
}

// ---------------------------------------------------------------------------
// Display

/** The visible prompt for translate flows; null = audio prompt (lyssna). */
export function zenPrompt(zi: ZenItem, flow: ZenFlow): { text: string; lang: 'da' | null } | null {
  if (flow.mode === 'lyssna') return null;
  if (zi.type === 'tal') {
    if (flow.direction === 'da-sv') return { text: zi.tokens.join(' '), lang: 'da' };
    const text =
      zi.kind === 'year'
        ? T.year(zi.value)
        : zi.kind === 'price'
          ? T.kronor(zi.value)
          : String(zi.value);
    return { text, lang: null };
  }
  // ord: each item shows its own side — the sub knows.
  return { text: zi.item.prompt, lang: subConfigOf(zi.item).prompt.lang === 'da' ? 'da' : null };
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

/** v2: the 2026-07-11 flow rework (mode → riktning → källa → nivå). */
export const PREFS_KEY = 'zen.prefs.v2';

export interface ZenPrefs {
  mode: ZenMode | null;
  direction: ZenDirection | null;
  source: string | null;
}

/** Parse a stored prefs blob; anything unknown or malformed becomes null so
 *  a stale/foreign value can never preselect an invalid option. Set sources
 *  are shape-checked here and existence-checked against the live set list at
 *  pick time (stepOptions filters them). */
export function parsePrefs(raw: string | null): ZenPrefs {
  const none: ZenPrefs = { mode: null, direction: null, source: null };
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
  const source =
    typeof o.source === 'string' &&
    ([SOURCE_REPETERA, SOURCE_BLANDAT, SOURCE_TAL].includes(o.source) || /^set:.+/.test(o.source))
      ? o.source
      : null;
  return {
    mode: valid(MODE_IDS, o.mode),
    direction: valid(DIRECTION_IDS, o.direction),
    source,
  };
}

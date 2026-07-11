// Mode registry for the /skriv word drill and /tal number dictation. One
// DrillModeConfig per mode drives the shared DrillEngine island: prompt shape,
// input attributes, SRS mapping, item building and answer matching. Astro
// island props must be serializable, so pages pass a `kind` string and the
// island resolves the full config (with functions) from this client-side
// registry (plan §3.2). Queue assembly is NOT reimplemented — word modes
// delegate to session.ts buildQueue verbatim and slice to the session size.
import {
  buildQueue,
  matchTyped,
  normalizeTyped,
  type QueueLimits,
  type Rng,
  type SrsView,
} from './session.ts';
import type { Card } from './vocab.ts';
import { gradeForOutcome, type DrillOutcome } from './drill-srs.ts';
import type { ReviewGrade } from './srs.ts';
import type { Direction } from './storage.ts';
import { NUMBER_LEVELS, normalizeDigits, type NumberLevelId } from './danish-numbers.ts';
import { levelAvailable, type NumberAudioManifest } from './number-audio.ts';
import type { GroupMatch } from './deck-groups.ts';

export type DrillModeId = 'sv-da' | 'da-dictation' | 'da-sv' | 'number-dictation';

/** How an item sounds: word clips go through speak() (TTS fallback tolerated
 *  for words); numbers compose committed clips via NumberAudioPlayer — ONLY
 *  clips, never TTS. `url` is the card's repo-relative clip path; the
 *  component wraps it in withBase() before speak(), like the flashcards do. */
export type DrillAudio =
  | { kind: 'clip'; text: string; url?: string }
  | { kind: 'number'; tokens: string[] };

export interface DrillItem {
  /** Card.id or `num:<value>` — stable within a session (requeue/missed keys). */
  id: string;
  /** Swedish gloss / Danish word / number transcript (shown on reveal). */
  prompt: string;
  /** Canonical display answer: danish, swedish gloss, or digit string. */
  answer: string;
  audio?: DrillAudio;
  /** Present ⇒ SRS-backed: recordOutcome() writes to this card id. */
  sourceCardId?: string;
  /** Glossary info for the feedback panel (meaning, example, falsk vän-note). */
  card?: Card;
}

export interface DrillModeConfig {
  id: DrillModeId;
  prompt: { kind: 'text' | 'audio'; lang: 'sv' | 'da'; replayable: boolean };
  input: {
    lang: 'da' | 'sv';
    inputmode: 'text' | 'numeric';
    liveRemap: boolean;
    charHelper: boolean;
    label: string;
    placeholder: string;
  };
  /** null = ungraded mode (numbers, v1). Word modes map onto the EXISTING
   *  flashcard directions so both surfaces share one dueness per (card, skill). */
  srs: null | { direction: Direction; gradeFor(o: DrillOutcome): ReviewGrade };
  buildItems(deps: DrillBuildDeps): DrillItem[];
  audioFor(item: DrillItem): DrillAudio | null;
  matches(typed: string, item: DrillItem): boolean;
}

export interface DrillBuildDeps {
  cards: Card[];
  srs: SrsView;
  now: Date;
  limits: QueueLimits;
  rng?: Rng;
  /** Lesson deep-link; wins over `match` (buildQueue semantics). */
  tag?: string | null;
  /** Study-group descriptor; {kind:'all'} = due-only, most-overdue-first. */
  match?: GroupMatch | null;
  size: number;
  numberLevel?: NumberLevelId;
  /** When given, an unplayable number level yields no items (UI gates too). */
  manifest?: NumberAudioManifest;
}

// ---- da→sv accepted answers ----

// Alternatives hide inside parentheticals only when introduced by 'även:' or
// 'el.' — '(även: brista, sprängas)' → brista + sprängas. Any other
// parenthetical is commentary ('(vardagligt)') and is dropped whole.
const PAREN = /\(([^)]*)\)/g;
const ALT_INTRO = /^(?:även:|el\.)\s*/iu;

/** Swedish answers accepted for da→sv typing. The curated `acceptedSv` column
 *  wins when present; otherwise a heuristic parse of the free-text gloss:
 *  split on '/', strip parentheticals (harvesting 'även:'/'el.' alternatives),
 *  normalizeTyped each, dedupe, drop empties. */
export function acceptedSwedish(card: Card): string[] {
  const raw: string[] = [];
  if (card.acceptedSv?.length) {
    raw.push(...card.acceptedSv);
  } else {
    for (const part of card.swedish.split('/')) {
      const alts: string[] = [];
      const main = part.replace(PAREN, (_m, inner: string) => {
        const intro = ALT_INTRO.exec(inner.trim());
        if (intro) alts.push(...inner.trim().slice(intro[0].length).split(/[,;]/));
        return ' ';
      });
      raw.push(main, ...alts);
    }
  }
  return [...new Set(raw.map(normalizeTyped).filter((s) => s.length > 0))];
}

// ---- word-mode item building ----

type ClipAudio = { kind: 'clip'; text: string; url?: string };

function clipAudio(card: Card): ClipAudio {
  const audio: ClipAudio = { kind: 'clip', text: card.danish };
  if (card.audio) audio.url = card.audio;
  return audio;
}

function wordItem(card: Card, prompt: string, answer: string): DrillItem {
  return { id: card.id, prompt, answer, audio: clipAudio(card), sourceCardId: card.id, card };
}

/** buildQueue verbatim (due-first scheduling, budgets, due-all special case),
 *  then slice to the session size. Dictation pre-filters to clip-backed cards
 *  HERE (drill-side) so session.ts and the flashcards stay untouched. */
function buildWordCards(
  deps: DrillBuildDeps,
  direction: Direction,
  opts: { requireClip?: boolean } = {},
): Card[] {
  const pool = opts.requireClip ? deps.cards.filter((c) => !!c.audio) : deps.cards;
  const { queue } = buildQueue({
    cards: pool,
    tag: deps.tag ?? null,
    match: deps.match ?? null,
    direction,
    srs: deps.srs,
    now: deps.now,
    limits: deps.limits,
    ...(deps.rng !== undefined ? { rng: deps.rng } : {}),
  });
  return queue.slice(0, deps.size);
}

const wordMatches = (typed: string, item: DrillItem): boolean =>
  matchTyped(typed, item.card ?? { danish: item.answer, accepted: [] });

const itemAudio = (item: DrillItem): DrillAudio | null => item.audio ?? null;

// ---- number-mode item building ----

function buildNumberItems(deps: DrillBuildDeps): DrillItem[] {
  const level = NUMBER_LEVELS.find((l) => l.id === deps.numberLevel);
  if (!level) return [];
  if (deps.manifest && !levelAvailable(level.id, deps.manifest)) return [];
  const rng = deps.rng ?? Math.random;
  const seen = new Set<number>();
  const items: DrillItem[] = [];
  // Dedupe by value so ids stay unique (requeue/missed bookkeeping is
  // id-keyed); attempts are bounded so small levels (0–20) can't spin forever
  // when size exceeds the value space.
  for (let attempts = deps.size * 20; attempts > 0 && items.length < deps.size; attempts--) {
    const { value, tokens } = level.gen(rng);
    if (seen.has(value)) continue;
    seen.add(value);
    items.push({
      id: `num:${value}`,
      prompt: tokens.join(' '),
      answer: String(value),
      audio: { kind: 'number', tokens },
    });
  }
  return items;
}

// ---- the registry ----

// Input labels/placeholders are per-mode DATA (part of the §3.2 config shape),
// not page chrome — chrome copy lives in strings.ts UI.drill.
export const DRILL_MODES: Record<DrillModeId, DrillModeConfig> = {
  'sv-da': {
    id: 'sv-da',
    prompt: { kind: 'text', lang: 'sv', replayable: false },
    input: {
      lang: 'da',
      inputmode: 'text',
      liveRemap: true,
      charHelper: true,
      label: 'Skriv på danska',
      placeholder: 'Skriv på danska…',
    },
    srs: { direction: 'produce', gradeFor: gradeForOutcome },
    buildItems: (deps) =>
      buildWordCards(deps, 'produce').map((c) => wordItem(c, c.swedish, c.danish)),
    audioFor: itemAudio,
    matches: wordMatches,
  },
  'da-dictation': {
    id: 'da-dictation',
    prompt: { kind: 'audio', lang: 'da', replayable: true },
    input: {
      lang: 'da',
      inputmode: 'text',
      liveRemap: true,
      charHelper: true,
      label: 'Skriv ordet du hör',
      placeholder: 'Skriv på danska…',
    },
    srs: { direction: 'listen', gradeFor: gradeForOutcome },
    buildItems: (deps) =>
      buildWordCards(deps, 'listen', { requireClip: true }).map((c) =>
        wordItem(c, c.danish, c.danish),
      ),
    audioFor: itemAudio,
    matches: wordMatches,
  },
  'da-sv': {
    id: 'da-sv',
    prompt: { kind: 'text', lang: 'da', replayable: true },
    input: {
      lang: 'sv',
      inputmode: 'text',
      liveRemap: false,
      charHelper: false,
      label: 'Skriv betydelsen på svenska',
      placeholder: 'Skriv på svenska…',
    },
    srs: { direction: 'recognize', gradeFor: gradeForOutcome },
    buildItems: (deps) =>
      buildWordCards(deps, 'recognize').map((c) => wordItem(c, c.danish, c.swedish)),
    audioFor: itemAudio,
    matches: (typed, item) => {
      const t = normalizeTyped(typed);
      if (t.length === 0) return false;
      return item.card ? acceptedSwedish(item.card).includes(t) : t === normalizeTyped(item.answer);
    },
  },
  'number-dictation': {
    id: 'number-dictation',
    prompt: { kind: 'audio', lang: 'da', replayable: true },
    input: {
      lang: 'sv',
      inputmode: 'numeric',
      liveRemap: false,
      charHelper: false,
      label: 'Skriv talet med siffror',
      placeholder: 't.ex. 42',
    },
    srs: null, // no SRS for numbers in v1 (plan §3.1)
    buildItems: buildNumberItems,
    audioFor: itemAudio,
    matches: (typed, item) => {
      const t = normalizeDigits(typed);
      return t.length > 0 && t === item.answer;
    },
  },
};

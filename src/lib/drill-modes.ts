// Mode registry for the /zen practice flow and /tal number dictation. Two
// layers drive the shared DrillEngine island:
//  - DRILL_SESSIONS: what a run drills (translate/listen × words/sentences,
//    plus number dictation) — each entry is a queue builder.
//  - SUB_CONFIGS: how ONE item behaves (prompt shape, input attributes, SRS
//    mapping, answer matching). Translate runs mix sv→da and da→sv items in a
//    single queue ("back and forth", user decision 2026-07-11), so this config
//    is per ITEM (DrillItem.sub), not per session.
// Astro island props must be serializable, so pages pass a `kind` string and
// the island resolves configs (with functions) from this client-side registry
// (plan §3.2). Queue assembly is NOT reimplemented — word builders delegate to
// session.ts buildQueue verbatim and slice to the session size.
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
import { sentenceVerdict, type SentenceVerdict } from './sentence-match.ts';
import { UI } from './strings.ts';

export type DrillSessionId =
  | 'translate'
  | 'translate-sv-da'
  | 'translate-da-sv'
  | 'listen'
  | 'translate-sent'
  | 'listen-sent'
  | 'number-dictation';

/** Per-item behavior key. Word subs are the historical mode ids; sentence subs
 *  grade leniently (sentence-match.ts); 'number' composes clip audio. */
export type DrillSub =
  | 'sv-da'
  | 'da-sv'
  | 'da-dictation'
  | 'sent-sv-da'
  | 'sent-da-sv'
  | 'sent-listen'
  | 'number';

/** How an item sounds: word/sentence clips go through speak() (TTS fallback
 *  tolerated for words); numbers compose committed clips via NumberAudioPlayer
 *  — ONLY clips, never TTS. `url` is the card's repo-relative clip path; the
 *  component wraps it in withBase() before speak(), like the flashcards do. */
export type DrillAudio =
  | { kind: 'clip'; text: string; url?: string }
  | { kind: 'number'; tokens: string[] };

export interface DrillItem {
  /** Card.id / `sent:<card.id>` / `num:<value>` — stable within a session
   *  (requeue/missed keys). */
  id: string;
  sub: DrillSub;
  /** Swedish gloss / Danish word / example sentence / number transcript. */
  prompt: string;
  /** Canonical display answer: danish, swedish gloss, sentence or digits. */
  answer: string;
  audio?: DrillAudio;
  /** Present ⇒ SRS-backed: recordOutcome() writes to this card id. */
  sourceCardId?: string;
  /** Glossary info for the feedback panel (meaning, example, falsk vän-note). */
  card?: Card;
}

export interface SubConfig {
  prompt: { kind: 'text' | 'audio'; lang: 'sv' | 'da'; replayable: boolean };
  input: {
    lang: 'da' | 'sv';
    inputmode: 'text' | 'numeric';
    liveRemap: boolean;
    charHelper: boolean;
    label: string;
    placeholder: string;
  };
  /** null = ungraded (numbers, all sentence subs, v1). Word subs map onto the
   *  EXISTING flashcard directions so both surfaces share one dueness per
   *  (card, skill). The component additionally skips writes in free-roam runs. */
  srs: null | { direction: Direction; gradeFor(o: DrillOutcome): ReviewGrade };
  /** Lenient tri-state grading (sentence subs only): 'near' scores correct but
   *  the component pauses on a diff panel instead of auto-advancing. */
  verdict?(typed: string, item: DrillItem): SentenceVerdict;
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
  /** Source descriptor: {kind:'all'} = due-only; {kind:'union'} = picked sets. */
  match?: GroupMatch | null;
  /** Free roam: everything eligible, shuffled, no SRS scheduling (buildQueue's
   *  free path — wins even over the 'all' match). */
  free?: boolean;
  size: number;
  numberLevel?: NumberLevelId;
  /** When given, an unplayable number level yields no items (UI gates too). */
  manifest?: NumberAudioManifest;
}

export interface DrillSessionConfig {
  id: DrillSessionId;
  buildItems(deps: DrillBuildDeps): DrillItem[];
}

// ---- da→sv accepted answers ----

// Alternatives hide inside parentheticals only when introduced by 'även:' or
// 'el.' — '(även: brista, sprängas)' → brista + sprängas. Any other
// parenthetical is commentary ('(vardagligt)') and is dropped whole.
const PAREN = /\(([^)]*)\)/g;
const ALT_INTRO = /^(?:även:|el\.)\s*/iu;

/** Swedish answers accepted for da→sv typing. The curated `acceptedSv` column
 *  wins when present; otherwise a heuristic parse of the free-text gloss:
 *  strip parentheticals (harvesting 'även:'/'el.' alternatives) over the WHOLE
 *  gloss FIRST, then split the remainder on '/', normalizeTyped each, dedupe,
 *  drop empties. Parens must go before the split: a '/' inside a parenthetical
 *  ('byta (tåg/buss)') would otherwise break the paren match and leak garbage
 *  fragments like 'byta (tåg' as the only accepted answers. */
export function acceptedSwedish(card: Card): string[] {
  const raw: string[] = [];
  if (card.acceptedSv?.length) {
    raw.push(...card.acceptedSv);
  } else {
    const alts: string[] = [];
    const main = card.swedish.replace(PAREN, (_m, inner: string) => {
      const intro = ALT_INTRO.exec(inner.trim());
      if (intro) alts.push(...inner.trim().slice(intro[0].length).split(/[,;]/));
      return ' ';
    });
    raw.push(...main.split('/'), ...alts);
  }
  return [...new Set(raw.map(normalizeTyped).filter((s) => s.length > 0))];
}

// ---- word-item building ----

type ClipAudio = { kind: 'clip'; text: string; url?: string };

function clipAudio(card: Card): ClipAudio {
  const audio: ClipAudio = { kind: 'clip', text: card.danish };
  if (card.audio) audio.url = card.audio;
  return audio;
}

function wordItem(card: Card, sub: DrillSub, prompt: string, answer: string): DrillItem {
  return { id: card.id, sub, prompt, answer, audio: clipAudio(card), sourceCardId: card.id, card };
}

/** buildQueue verbatim (due-first scheduling, budgets, due-all special case,
 *  free roam), then slice to the session size. Dictation pre-filters to
 *  clip-backed cards HERE (drill-side) so session.ts and the flashcards stay
 *  untouched. */
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
    free: deps.free ?? false,
    srs: deps.srs,
    now: deps.now,
    limits: deps.limits,
    ...(deps.rng !== undefined ? { rng: deps.rng } : {}),
  });
  return queue.slice(0, deps.size);
}

const svDaItem = (c: Card): DrillItem => wordItem(c, 'sv-da', c.swedish, c.danish);
const daSvItem = (c: Card): DrillItem => wordItem(c, 'da-sv', c.danish, c.swedish);

/** Translate = back and forth in ONE run. Due source: per-direction dueness
 *  decides each card's direction (due in both → the more overdue one wins),
 *  merged most-overdue-first — one item per card. Set/free/tag sources: one
 *  scheduled/free build, directions alternated over the presented order. */
function buildTranslateItems(deps: DrillBuildDeps): DrillItem[] {
  const dueSource = !deps.tag && !deps.free && deps.match?.kind === 'all';
  if (dueSource) {
    const entries = new Map<string, { c: Card; dir: 'produce' | 'recognize'; due: number }>();
    for (const dir of ['produce', 'recognize'] as const) {
      for (const c of buildWordCards(deps, dir)) {
        // Due-all queues contain only cards WITH due records, so the record
        // exists; Infinity is a defensive fallback, never a real sort key.
        const r = deps.srs.getRecord(c.id, dir);
        const due = r ? new Date(r.due).getTime() : Infinity;
        const prev = entries.get(c.id);
        if (!prev || due < prev.due) entries.set(c.id, { c, dir, due });
      }
    }
    return [...entries.values()]
      .sort((a, b) => a.due - b.due)
      .slice(0, deps.size)
      .map((e) => (e.dir === 'produce' ? svDaItem(e.c) : daSvItem(e.c)));
  }
  return buildWordCards(deps, 'produce').map((c, i) => (i % 2 === 0 ? svDaItem(c) : daSvItem(c)));
}

// ---- sentence-item building ----

/** Cards that can carry a sentence item, source-filtered and shuffled via
 *  buildQueue's free path (sentences are ungraded — no SRS scheduling — so
 *  free semantics apply to every source; the component steers the due source
 *  away from sentences in the UI). */
function sentenceCards(deps: DrillBuildDeps, opts: { requireClip: boolean }): Card[] {
  const pool = deps.cards.filter(
    (c) => !!c.exampleDa && !!c.exampleSv && (!opts.requireClip || !!c.audioExample),
  );
  const { queue } = buildQueue({
    cards: pool,
    tag: deps.tag ?? null,
    match: deps.match ?? null,
    direction: 'produce',
    free: true,
    srs: deps.srs,
    now: deps.now,
    limits: deps.limits,
    ...(deps.rng !== undefined ? { rng: deps.rng } : {}),
  });
  return queue.slice(0, deps.size);
}

/** Sentence audio is the card's recorded EXAMPLE clip; `text` is the sentence
 *  so speak()'s TTS fallback reads the right thing when no clip exists. */
function sentenceAudio(card: Card): ClipAudio {
  const audio: ClipAudio = { kind: 'clip', text: card.exampleDa ?? '' };
  if (card.audioExample) audio.url = card.audioExample;
  return audio;
}

function sentenceItem(card: Card, sub: DrillSub, prompt: string, answer: string): DrillItem {
  // No sourceCardId: sentence items never write SRS (no per-sentence records).
  return { id: `sent:${card.id}`, sub, prompt, answer, audio: sentenceAudio(card), card };
}

function buildTranslateSentItems(deps: DrillBuildDeps): DrillItem[] {
  return sentenceCards(deps, { requireClip: false }).map((c, i) =>
    i % 2 === 0
      ? sentenceItem(c, 'sent-sv-da', c.exampleSv as string, c.exampleDa as string)
      : sentenceItem(c, 'sent-da-sv', c.exampleDa as string, c.exampleSv as string),
  );
}

/** Listening sentences: hear the Danish clip, type the SWEDISH meaning
 *  (user decision 2026-07-11: "only da->sv when listening" — comprehension,
 *  not dictation). Requires the recorded example clip. */
function buildListenSentItems(deps: DrillBuildDeps): DrillItem[] {
  return sentenceCards(deps, { requireClip: true }).map((c) =>
    sentenceItem(c, 'sent-listen', c.exampleDa as string, c.exampleSv as string),
  );
}

// ---- answer matching ----

/** The miss panel displays item.answer verbatim ('Rätt svar: …') — so a
 *  verbatim retype of the DISPLAYED string must always pass, even when it is
 *  a multi-variant form ('midlertidig / midlertidigt') or a gloss with
 *  parentheticals that the accepted-set parse would otherwise reject. */
const matchesDisplayAnswer = (typed: string, item: DrillItem): boolean => {
  const t = normalizeTyped(typed);
  return t.length > 0 && t === normalizeTyped(item.answer);
};

const wordMatches = (typed: string, item: DrillItem): boolean =>
  matchTyped(typed, item.card ?? { danish: item.answer, accepted: [] }) ||
  matchesDisplayAnswer(typed, item);

const daSvMatches = (typed: string, item: DrillItem): boolean => {
  const t = normalizeTyped(typed);
  if (t.length === 0) return false;
  if (matchesDisplayAnswer(typed, item)) return true; // the full gloss as shown
  return item.card ? acceptedSwedish(item.card).includes(t) : false;
};

const sentVerdict = (typed: string, item: DrillItem): SentenceVerdict =>
  sentenceVerdict(item.answer, typed);
const sentMatches = (typed: string, item: DrillItem): boolean =>
  sentVerdict(typed, item) !== 'wrong';

// ---- number-item building ----

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
      sub: 'number',
      prompt: tokens.join(' '),
      answer: String(value),
      audio: { kind: 'number', tokens },
    });
  }
  return items;
}

// ---- the registries ----

// Input labels/placeholders come from strings.ts (UI.drill.input, per sub) —
// ALL user-facing Swedish copy is centralized there (plan §2.7).
const DA_TYPING = { lang: 'da', inputmode: 'text', liveRemap: true, charHelper: true } as const;
const SV_TYPING = { lang: 'sv', inputmode: 'text', liveRemap: false, charHelper: false } as const;

export const SUB_CONFIGS: Record<DrillSub, SubConfig> = {
  'sv-da': {
    prompt: { kind: 'text', lang: 'sv', replayable: false },
    input: { ...DA_TYPING, ...UI.drill.input['sv-da'] },
    srs: { direction: 'produce', gradeFor: gradeForOutcome },
    matches: wordMatches,
  },
  'da-sv': {
    prompt: { kind: 'text', lang: 'da', replayable: true },
    input: { ...SV_TYPING, ...UI.drill.input['da-sv'] },
    srs: { direction: 'recognize', gradeFor: gradeForOutcome },
    matches: daSvMatches,
  },
  'da-dictation': {
    prompt: { kind: 'audio', lang: 'da', replayable: true },
    input: { ...DA_TYPING, ...UI.drill.input['da-dictation'] },
    srs: { direction: 'listen', gradeFor: gradeForOutcome },
    matches: wordMatches,
  },
  'sent-sv-da': {
    prompt: { kind: 'text', lang: 'sv', replayable: false },
    input: { ...DA_TYPING, ...UI.drill.input['sent-sv-da'] },
    srs: null,
    verdict: sentVerdict,
    matches: sentMatches,
  },
  'sent-da-sv': {
    prompt: { kind: 'text', lang: 'da', replayable: true },
    input: { ...SV_TYPING, ...UI.drill.input['sent-da-sv'] },
    srs: null,
    verdict: sentVerdict,
    matches: sentMatches,
  },
  'sent-listen': {
    prompt: { kind: 'audio', lang: 'da', replayable: true },
    input: { ...SV_TYPING, ...UI.drill.input['sent-listen'] },
    srs: null,
    verdict: sentVerdict,
    matches: sentMatches,
  },
  number: {
    prompt: { kind: 'audio', lang: 'da', replayable: true },
    input: {
      lang: 'sv',
      inputmode: 'numeric',
      liveRemap: false,
      charHelper: false,
      ...UI.drill.input['number-dictation'],
    },
    srs: null, // no SRS for numbers in v1 (plan §3.1)
    matches: (typed, item) => {
      const t = normalizeDigits(typed);
      return t.length > 0 && t === item.answer;
    },
  },
};

export const subConfigOf = (item: DrillItem): SubConfig => SUB_CONFIGS[item.sub];

export const DRILL_SESSIONS: Record<DrillSessionId, DrillSessionConfig> = {
  translate: { id: 'translate', buildItems: buildTranslateItems },
  // Single-direction translate (zen's riktning step picks a side; the mixed
  // 'translate' above stays for surfaces that want back-and-forth).
  'translate-sv-da': {
    id: 'translate-sv-da',
    buildItems: (deps) => buildWordCards(deps, 'produce').map(svDaItem),
  },
  'translate-da-sv': {
    id: 'translate-da-sv',
    buildItems: (deps) => buildWordCards(deps, 'recognize').map(daSvItem),
  },
  listen: {
    id: 'listen',
    buildItems: (deps) =>
      buildWordCards(deps, 'listen', { requireClip: true }).map((c) =>
        wordItem(c, 'da-dictation', c.danish, c.danish),
      ),
  },
  'translate-sent': { id: 'translate-sent', buildItems: buildTranslateSentItems },
  'listen-sent': { id: 'listen-sent', buildItems: buildListenSentItems },
  'number-dictation': { id: 'number-dictation', buildItems: buildNumberItems },
};

/** Exact card count a session's setup can offer ("Alla (N)", Starta gating):
 *  every word/sentence builder ends in a size slice, so probing with an
 *  unbounded size returns the true total. The number generator instead LOOPS
 *  `size * 20` attempts — unbounded size would spin forever, and its space is
 *  effectively infinite anyway, so probing it is a programming error. */
export function availableCount(
  session: DrillSessionConfig,
  deps: Omit<DrillBuildDeps, 'size'>,
): number {
  if (session.id === 'number-dictation') {
    throw new Error('availableCount is undefined for number dictation (unbounded generator)');
  }
  return session.buildItems({ ...deps, size: Number.MAX_SAFE_INTEGER }).length;
}

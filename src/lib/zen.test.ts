import { describe, expect, it } from 'vitest';
import {
  ALL_TAL,
  anyDue,
  back,
  buildNumberSession,
  buildWordSession,
  digitsLabel,
  gradeDanishNumber,
  gradeDigits,
  gradeZen,
  highlightIndex,
  initialFlow,
  isReady,
  itemDirection,
  itemInputKind,
  parsePrefs,
  pick,
  setForSource,
  sourceIsGraded,
  sourceQueue,
  playableTal,
  stepOptions,
  wordDirections,
  wordSessionId,
  wrapIndex,
  zenPrompt,
  zenReveal,
  zenSets,
  type TalItem,
  type ZenContext,
  type ZenFlow,
  type ZenItem,
  type ZenSet,
} from './zen.ts';
import { numberToTokens, priceToTokens, yearToTokens } from './danish-numbers.ts';
import type { Card } from './vocab.ts';
import type { Rng, SrsView } from './session.ts';
import type { SrsRecord } from './storage.ts';
import type { StudyGroup } from './deck-groups.ts';

const SETS: ZenSet[] = [
  { id: 'vardag', label: 'Vardag', match: { kind: 'decks', decks: ['vardag'] } },
  { id: 'falska', label: 'Falska vänner', match: { kind: 'decks', decks: ['falska-venner'] } },
];

/** Today's real shape: a handful of 0–100 values fully recorded. */
const ctx = (over: Partial<ZenContext> = {}): ZenContext => ({
  talPlayable: [20, 27, 30, 42],
  hasDue: true,
  sets: SETS,
  ...over,
});
const flow = (over: Partial<ZenFlow>): ZenFlow => ({ ...initialFlow(), ...over });

/** Deterministic rng cycling the given values. */
const seqRng = (...values: number[]): Rng => {
  let i = 0;
  return () => values[i++ % values.length] ?? 0;
};

const card = (over: Partial<Card> & Pick<Card, 'id' | 'danish' | 'swedish'>): Card => ({
  pos: 'noun',
  deck: 'starter',
  cefr: 'b1',
  tags: [],
  accepted: [],
  ...over,
});

const record = (over: Partial<SrsRecord>): SrsRecord => ({
  due: '2026-01-01T00:00:00.000Z',
  stability: 1,
  difficulty: 5,
  elapsed_days: 0,
  scheduled_days: 1,
  learning_steps: 0,
  reps: 1,
  lapses: 0,
  state: 2,
  last_review: null,
  ...over,
});

const noSrs: SrsView = { getRecord: () => null, newCardsToday: () => 0 };
const limits = { newPerDay: 5, reviewPerDay: 100 };
const NOW = new Date('2026-07-11T12:00:00Z');

// ---------------------------------------------------------------------------

describe('start flow', () => {
  it('walks mode → källa for lyssna, inserting riktning for översätt', () => {
    let f = pick(initialFlow(), ctx(), 'lyssna');
    expect(f.step).toBe('source');
    f = pick(f, ctx(), 'blandat');
    expect(f).toMatchObject({ step: 'begin', mode: 'lyssna', source: 'blandat' });

    let g = pick(initialFlow(), ctx(), 'översätt');
    expect(g.step).toBe('direction');
    g = pick(g, ctx(), 'da-sv');
    expect(g.step).toBe('source');
    g = pick(g, ctx(), 'set:vardag');
    expect(g).toMatchObject({ step: 'begin', direction: 'da-sv', source: 'set:vardag' });
  });

  it('tal goes straight to Begynd — no level step', () => {
    let f = pick(initialFlow(), ctx(), 'översätt');
    f = pick(f, ctx(), 'sv-da');
    f = pick(f, ctx(), 'tal');
    expect(f).toMatchObject({ step: 'begin', source: 'tal' });
  });

  it('offers källa in order — repetera gated on dueness, tal on lyssna coverage', () => {
    expect(stepOptions(flow({ step: 'source', mode: 'översätt' }), ctx())).toEqual([
      'repetera',
      'blandat',
      'tal',
      'set:vardag',
      'set:falska',
    ]);
    expect(stepOptions(flow({ step: 'source', mode: 'lyssna' }), ctx({ hasDue: false }))).toEqual([
      'blandat',
      'tal',
      'set:vardag',
      'set:falska',
    ]);
    // No playable number at all → lyssna hides tal; översätt keeps it.
    const noClips = ctx({ talPlayable: [] });
    expect(stepOptions(flow({ step: 'source', mode: 'lyssna' }), noClips)).not.toContain('tal');
    expect(stepOptions(flow({ step: 'source', mode: 'översätt' }), noClips)).toContain('tal');
  });

  it('ignores unknown ids and gated picks (same object back)', () => {
    const start = initialFlow();
    expect(pick(start, ctx(), 'nope')).toBe(start);
    const atSource = flow({ step: 'source', mode: 'lyssna' });
    expect(pick(atSource, ctx({ hasDue: false }), 'repetera')).toBe(atSource);
    expect(pick(atSource, ctx(), 'set:okänd')).toBe(atSource);
  });

  it('backs up one step, entering only the steps that were shown', () => {
    expect(back(flow({ step: 'begin', source: 'tal' })).step).toBe('source');
    expect(back(flow({ step: 'begin', source: 'blandat' })).step).toBe('source');
    expect(back(flow({ step: 'source', mode: 'översätt' })).step).toBe('direction');
    expect(back(flow({ step: 'source', mode: 'lyssna' })).step).toBe('mode');
    expect(back(flow({ step: 'direction' })).step).toBe('mode');
    const first = initialFlow();
    expect(back(first)).toBe(first); // the island exits zen instead
  });

  it('highlights the already-picked option, else the first', () => {
    expect(highlightIndex(initialFlow(), ctx())).toBe(0);
    expect(highlightIndex(flow({ mode: 'översätt' }), ctx())).toBe(1);
    expect(highlightIndex(flow({ step: 'direction', direction: 'da-sv' }), ctx())).toBe(1);
    expect(
      highlightIndex(flow({ step: 'source', mode: 'översätt', source: 'set:falska' }), ctx()),
    ).toBe(4);
    // A selection filtered out by the gates falls back to 0.
    expect(
      highlightIndex(flow({ step: 'source', mode: 'lyssna', source: 'repetera' }), ctx({ hasDue: false })),
    ).toBe(0);
  });

  it('wraps arrow-key movement in both directions', () => {
    expect(wrapIndex(0, -1, 4)).toBe(3);
    expect(wrapIndex(3, 1, 4)).toBe(0);
    expect(wrapIndex(1, 1, 4)).toBe(2);
  });

  it('is ready only when every step the picks need has one', () => {
    expect(isReady(flow({ mode: 'lyssna', source: 'blandat' }))).toBe(true);
    expect(isReady(flow({ mode: 'lyssna' }))).toBe(false);
    expect(isReady(flow({ mode: 'översätt', source: 'blandat' }))).toBe(false);
    expect(isReady(flow({ mode: 'översätt', direction: 'sv-da', source: 'blandat' }))).toBe(true);
    expect(isReady(flow({ mode: 'lyssna', source: 'tal' }))).toBe(true);
  });

  it('grades repetera and set sessions, never blandat or tal', () => {
    expect(sourceIsGraded('repetera')).toBe(true);
    expect(sourceIsGraded('set:vardag')).toBe(true);
    expect(sourceIsGraded('blandat')).toBe(false);
    expect(sourceIsGraded('tal')).toBe(false);
    expect(sourceIsGraded(null)).toBe(false);
  });

  it('derives sets from the flashcard groups, dropping the due-all synthetic', () => {
    const groups: StudyGroup[] = [
      { id: 'due-all', label: 'Att repetera (alla)', optgroup: '', match: { kind: 'all' } },
      { id: 'vardag', label: 'Vardag', optgroup: 'Utvalda', match: { kind: 'decks', decks: ['vardag'] } },
    ];
    expect(zenSets(groups)).toEqual([
      { id: 'vardag', label: 'Vardag', match: { kind: 'decks', decks: ['vardag'] } },
    ]);
    expect(setForSource('set:vardag', SETS)?.label).toBe('Vardag');
    expect(setForSource('set:missing', SETS)).toBeNull();
    expect(setForSource('blandat', SETS)).toBeNull();
  });
});

describe('flow → session shape', () => {
  const svDaItem: ZenItem = {
    type: 'ord',
    item: {
      id: 'a',
      sub: 'sv-da',
      prompt: 'sjö',
      answer: 'sø',
      card: card({ id: 'a', danish: 'sø', swedish: 'sjö' }),
      sourceCardId: 'a',
    },
  };
  const daSvItem: ZenItem = {
    type: 'ord',
    item: {
      id: 'a',
      sub: 'da-sv',
      prompt: 'sø',
      answer: 'sjö',
      card: card({ id: 'a', danish: 'sø', swedish: 'sjö' }),
      sourceCardId: 'a',
    },
  };
  const dictItem: ZenItem = {
    type: 'ord',
    item: {
      id: 'a',
      sub: 'da-dictation',
      prompt: 'sø',
      answer: 'sø',
      card: card({ id: 'a', danish: 'sø', swedish: 'sjö' }),
      sourceCardId: 'a',
    },
  };
  const n7: TalItem = { type: 'tal', value: 7, tokens: numberToTokens(7), kind: 'number' };

  it('the input follows the item side; tal follows mode and riktning', () => {
    const anyOrd = flow({ mode: 'översätt', direction: 'sv-da' });
    expect(itemInputKind(svDaItem, anyOrd)).toBe('danish');
    expect(itemInputKind(daSvItem, flow({ mode: 'översätt', direction: 'da-sv' }))).toBe('swedish');
    expect(itemInputKind(dictItem, flow({ mode: 'lyssna' }))).toBe('danish');
    expect(itemInputKind(n7, flow({ mode: 'lyssna', source: 'tal' }))).toBe('digits');
    // danska → svenska: ser danska, skriver siffror.
    expect(itemInputKind(n7, flow({ mode: 'översätt', direction: 'da-sv', source: 'tal' }))).toBe(
      'digits',
    );
    // svenska → danska: ser siffror, skriver danska.
    expect(itemInputKind(n7, flow({ mode: 'översätt', direction: 'sv-da', source: 'tal' }))).toBe(
      'danish',
    );
  });

  it('maps word flows onto directional drill sessions and SRS directions', () => {
    expect(wordSessionId(flow({ mode: 'lyssna', source: 'blandat' }))).toBe('listen');
    expect(
      wordSessionId(flow({ mode: 'översätt', direction: 'sv-da', source: 'set:vardag' })),
    ).toBe('translate-sv-da');
    expect(wordSessionId(flow({ mode: 'översätt', direction: 'da-sv', source: 'repetera' }))).toBe(
      'translate-da-sv',
    );
    expect(wordSessionId(flow({ mode: 'lyssna', source: 'tal' }))).toBeNull();

    expect(wordDirections(flow({ mode: 'lyssna' }))).toEqual(['listen']);
    expect(wordDirections(flow({ mode: 'översätt', direction: 'sv-da' }))).toEqual(['produce']);
    expect(wordDirections(flow({ mode: 'översätt', direction: 'da-sv' }))).toEqual(['recognize']);
    expect(wordDirections(flow({ mode: 'översätt' }))).toEqual([]);

    expect(itemDirection(svDaItem)).toBe('produce');
    expect(itemDirection(daSvItem)).toBe('recognize');
    expect(itemDirection(dictItem)).toBe('listen');
    expect(itemDirection(n7)).toBeNull();
  });

  it('maps källa to queue descriptors', () => {
    expect(sourceQueue('repetera', SETS)).toEqual({ match: { kind: 'all' }, free: false });
    expect(sourceQueue('blandat', SETS)).toEqual({ match: { kind: 'all' }, free: true });
    expect(sourceQueue('set:vardag', SETS)).toEqual({
      match: { kind: 'decks', decks: ['vardag'] },
      free: false,
    });
    expect(sourceQueue('set:missing', SETS)).toBeNull();
    expect(sourceQueue('tal', SETS)).toBeNull();
  });

  it('anyDue mirrors buildQueue dueness across the given directions', () => {
    const cards = [card({ id: 'a', danish: 'hund', swedish: 'hund' })];
    const view = (r: SrsRecord | null, dir?: string): SrsView => ({
      getRecord: (_id, direction) => (dir === undefined || direction === dir ? r : null),
      newCardsToday: () => 0,
    });
    expect(anyDue(cards, view(record({})), ['produce'], NOW)).toBe(true);
    expect(anyDue(cards, view(null), ['produce'], NOW)).toBe(false);
    expect(anyDue(cards, view(record({ suspended: true })), ['produce'], NOW)).toBe(false);
    expect(
      anyDue(cards, view(record({ due: '2027-01-01T00:00:00.000Z' })), ['produce'], NOW),
    ).toBe(false);
    expect(anyDue(cards, view(record({}), 'recognize'), ['produce'], NOW)).toBe(false);
  });
});

describe('sessions', () => {
  it('builds n number items from the 0–100 pool, no adjacent repeats', () => {
    const items = buildNumberSession(ALL_TAL, 20, seqRng(0.5, 0.5, 0.9, 0.1, 0.5));
    expect(items).toHaveLength(20);
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      expect(it?.type).toBe('tal');
      if (it?.type === 'tal') {
        expect(it.value).toBeGreaterThanOrEqual(0);
        expect(it.value).toBeLessThanOrEqual(100);
        expect(it.tokens).toEqual(numberToTokens(it.value));
      }
      if (i > 0 && it?.type === 'tal' && items[i - 1]?.type === 'tal') {
        expect(it.value).not.toBe((items[i - 1] as { value: number }).value);
      }
    }
    // A restricted pool (lyssna's playable subset) only draws its own values.
    const restricted = buildNumberSession([20, 42], 10, seqRng(0.1, 0.7, 0.3, 0.9));
    expect(restricted.every((z) => z.type === 'tal' && [20, 42].includes(z.value))).toBe(true);
    expect(() => buildNumberSession([], 5, seqRng(0.5))).toThrow(RangeError);
  });

  it('derives the playable pool from the manifest (never TTS)', () => {
    expect(playableTal(null)).toEqual([]);
    const manifest = {
      atoms: {
        tyve: { id: 'x-tyve', file: 'f', present: true },
        toogfyrre: { id: 'x-42', file: 'f', present: true },
        fyrre: { id: 'x-40', file: 'f', present: false },
      },
    };
    expect(playableTal(manifest)).toEqual([20, 42]); // 40 lacks its clip
  });

  it('builds directional word sessions per källa', () => {
    const cards = [
      card({ id: 'a', danish: 'hund', swedish: 'hund', audio: 'audio/a.mp3', deck: 'vardag' }),
      card({ id: 'b', danish: 'kat', swedish: 'katt', audio: 'audio/b.mp3', deck: 'vardag' }),
      card({ id: 'c', danish: 'hest', swedish: 'häst', audio: 'audio/c.mp3', deck: 'djur' }),
    ];
    // Only 'a' is due (in produce).
    const srs: SrsView = {
      getRecord: (id, direction) => (id === 'a' && direction === 'produce' ? record({}) : null),
      newCardsToday: () => 0,
    };
    const due = buildWordSession({
      sessionId: 'translate-sv-da',
      match: { kind: 'all' },
      free: false,
      cards,
      srs,
      now: NOW,
      limits,
      size: 10,
    });
    expect(due).toHaveLength(1);
    expect(due[0]?.type === 'ord' && due[0].item.id).toBe('a');
    expect(due[0]?.type === 'ord' && due[0].item.sub).toBe('sv-da');
    expect(due[0]?.type === 'ord' && due[0].item.prompt).toBe('hund');

    // The opposite direction shows Danish, answers Swedish.
    const daSv = buildWordSession({
      sessionId: 'translate-da-sv',
      match: { kind: 'all' },
      free: true,
      cards,
      srs: noSrs,
      now: NOW,
      limits,
      size: 10,
      rng: seqRng(0.999), // identity shuffle
    });
    expect(daSv).toHaveLength(3);
    expect(daSv.every((z) => z.type === 'ord' && z.item.sub === 'da-sv')).toBe(true);

    // A set källa trains only its own deck (scheduled build: new-card budget).
    const setSession = buildWordSession({
      sessionId: 'translate-sv-da',
      match: { kind: 'decks', decks: ['vardag'] },
      free: false,
      cards,
      srs: noSrs,
      now: NOW,
      limits,
      size: 10,
      rng: seqRng(0.999),
    });
    expect(setSession.map((z) => (z.type === 'ord' ? z.item.id : '')).sort()).toEqual(['a', 'b']);

    // Dictation requires a clip — a card without audio never enters lyssna.
    const noClip = [...cards, card({ id: 'd', danish: 'ø', swedish: 'ö' })];
    const dictation = buildWordSession({
      sessionId: 'listen',
      match: { kind: 'all' },
      free: true,
      cards: noClip,
      srs: noSrs,
      now: NOW,
      limits,
      size: 10,
      rng: seqRng(0.999),
    });
    expect(dictation.map((z) => (z.type === 'ord' ? z.item.id : '')).sort()).toEqual([
      'a',
      'b',
      'c',
    ]);
    expect(dictation.every((z) => z.type === 'ord' && z.item.sub === 'da-dictation')).toBe(true);
  });
});

describe('grading', () => {
  const n27: TalItem = { type: 'tal', value: 27, tokens: numberToTokens(27), kind: 'number' };
  const y1994: TalItem = { type: 'tal', value: 1994, tokens: yearToTokens(1994), kind: 'year' };
  const kr42: TalItem = { type: 'tal', value: 42, tokens: priceToTokens(42), kind: 'price' };
  const talListen = flow({ mode: 'lyssna', source: 'tal' });
  const talWrite = flow({ mode: 'översätt', direction: 'sv-da', source: 'tal' });

  it('grades digits on exact value, ignoring thousands spaces', () => {
    expect(gradeDigits('27', n27)).toBe(true);
    expect(gradeDigits(' 2 7 ', n27)).toBe(true);
    expect(gradeDigits('1 994', y1994)).toBe(true);
    expect(gradeDigits('28', n27)).toBe(false);
    expect(gradeDigits('', n27)).toBe(false);
    expect(gradeDigits('   ', n27)).toBe(false);
  });

  it('grades Danish number readings ignoring case and ALL spacing', () => {
    expect(gradeDanishNumber('syvogtyve', n27)).toBe(true);
    expect(gradeDanishNumber('  Syv og Tyve ', n27)).toBe(true);
    expect(gradeDanishNumber('seksogtyve', n27)).toBe(false);
    expect(gradeDanishNumber('', n27)).toBe(false);
  });

  it('accepts both year readings and bare-cardinal prices', () => {
    expect(gradeZen('nitten hundrede og fireoghalvfems', y1994, talWrite)).toBe(true);
    expect(gradeZen('et tusind ni hundrede og fireoghalvfems', y1994, talWrite)).toBe(true);
    expect(gradeZen('toogfyrre kroner', kr42, talWrite)).toBe(true);
    expect(gradeZen('toogfyrre', kr42, talWrite)).toBe(true);
    expect(gradeZen('treogfyrre kroner', kr42, talWrite)).toBe(false);
    expect(gradeZen('27', n27, talListen)).toBe(true);
  });

  it('delegates ord grading to the item sub matcher (folding, alternatives)', () => {
    const c = card({ id: 'a', danish: 'sø', swedish: 'sjö', accepted: [] });
    const zi: ZenItem = {
      type: 'ord',
      item: { id: 'a', sub: 'sv-da', prompt: 'sjö', answer: 'sø', card: c, sourceCardId: 'a' },
    };
    const anyOrd = flow({ mode: 'översätt', direction: 'sv-da' });
    expect(gradeZen('sø', zi, anyOrd)).toBe(true);
    expect(gradeZen('sö', zi, anyOrd)).toBe(true); // Swedish-keyboard fold
    expect(gradeZen('so', zi, anyOrd)).toBe(false);
    expect(gradeZen('', zi, anyOrd)).toBe(false);
    const rev: ZenItem = {
      type: 'ord',
      item: { id: 'a', sub: 'da-sv', prompt: 'sø', answer: 'sjö', card: c, sourceCardId: 'a' },
    };
    expect(gradeZen('sjö', rev, flow({ mode: 'översätt', direction: 'da-sv' }))).toBe(true);
    expect(gradeZen('hav', rev, flow({ mode: 'översätt', direction: 'da-sv' }))).toBe(false);
  });
});

describe('display', () => {
  const y1994: TalItem = { type: 'tal', value: 1994, tokens: yearToTokens(1994), kind: 'year' };
  const kr42: TalItem = { type: 'tal', value: 42, tokens: priceToTokens(42), kind: 'price' };
  const n7: TalItem = { type: 'tal', value: 7, tokens: numberToTokens(7), kind: 'number' };
  const c = card({ id: 'a', danish: 'hund', swedish: 'hund (djuret)' });
  const svDa: ZenItem = {
    type: 'ord',
    item: { id: 'a', sub: 'sv-da', prompt: 'hund (djuret)', answer: 'hund', card: c },
  };
  const daSv: ZenItem = {
    type: 'ord',
    item: { id: 'a', sub: 'da-sv', prompt: 'hund', answer: 'hund (djuret)', card: c },
  };

  it('prompts tal per riktning: Danish reading or the Swedish-side value', () => {
    const daShown = flow({ mode: 'översätt', direction: 'da-sv', source: 'tal' });
    const svShown = flow({ mode: 'översätt', direction: 'sv-da', source: 'tal' });
    expect(zenPrompt(n7, daShown)).toEqual({ text: 'syv', lang: 'da' });
    expect(zenPrompt(n7, svShown)).toEqual({ text: '7', lang: null });
    expect(zenPrompt(y1994, svShown)).toEqual({ text: 'år 1994', lang: null });
    expect(zenPrompt(kr42, svShown)).toEqual({ text: '42 kronor', lang: null });
    expect(zenPrompt(n7, flow({ mode: 'lyssna', source: 'tal' }))).toBeNull();
  });

  it('prompts each ord item on its own side, lang from the sub', () => {
    expect(zenPrompt(svDa, flow({ mode: 'översätt', direction: 'sv-da' }))).toEqual({
      text: 'hund (djuret)',
      lang: null,
    });
    expect(zenPrompt(daSv, flow({ mode: 'översätt', direction: 'da-sv' }))).toEqual({
      text: 'hund',
      lang: 'da',
    });
    expect(zenPrompt(svDa, flow({ mode: 'lyssna' }))).toBeNull();
  });

  it('reveals the Danish form big with the other side under it', () => {
    expect(zenReveal(n7, '7', true)).toEqual({ correct: true, word: 'syv', sub: '7' });
    expect(zenReveal(kr42, '41', false)).toEqual({
      correct: false,
      word: 'toogfyrre kroner',
      sub: '42 kr  ·  du skrev 41',
    });
    expect(zenReveal(svDa, 'hund', true)).toEqual({
      correct: true,
      word: 'hund',
      sub: 'hund (djuret)',
    });
    expect(zenReveal(daSv, ' hunt ', false).sub).toBe('hund (djuret)  ·  du skrev hunt');
  });

  it('labels reveal digits, with kr only for prices', () => {
    expect(digitsLabel(n7)).toBe('7');
    expect(digitsLabel(y1994)).toBe('1994');
    expect(digitsLabel(kr42)).toBe('42 kr');
  });
});

describe('parsePrefs', () => {
  it('round-trips valid prefs and nulls everything else', () => {
    const raw = JSON.stringify({
      mode: 'översätt',
      direction: 'da-sv',
      source: 'set:vardag',
    });
    expect(parsePrefs(raw)).toEqual({
      mode: 'översätt',
      direction: 'da-sv',
      source: 'set:vardag',
    });
    const none = { mode: null, direction: null, source: null };
    expect(parsePrefs(null)).toEqual(none);
    expect(parsePrefs('not json')).toEqual(none);
    expect(parsePrefs('"str"')).toEqual(none);
    expect(parsePrefs(JSON.stringify({ mode: 'skriv', source: 'okänd' }))).toEqual(none);
    expect(parsePrefs(JSON.stringify({ mode: 'lyssna', source: 'tal' }))).toEqual({
      ...none,
      mode: 'lyssna',
      source: 'tal',
    });
    expect(parsePrefs(JSON.stringify({ source: 'set:' }))).toEqual(none); // empty set id
  });
});

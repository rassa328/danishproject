import { describe, expect, it } from 'vitest';
import {
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
  inputKind,
  isReady,
  LEVEL_IDS,
  parsePrefs,
  pick,
  stepOptions,
  wordDirection,
  wordModeId,
  wrapIndex,
  zenPrompt,
  zenReveal,
  type ZenFlow,
  type ZenGates,
  type ZenItem,
} from './zen.ts';
import { numberToTokens, priceToTokens, yearToTokens } from './danish-numbers.ts';
import type { Card } from './vocab.ts';
import type { Rng, SrsView } from './session.ts';
import type { SrsRecord } from './storage.ts';

/** Today's real coverage shape: only tiotal fully recorded. */
const gates = (over: Partial<ZenGates> = {}): ZenGates => ({
  coverage: { '0-20': false, 'tiotal': true, '0-99': false, 'stora-tal': false },
  hasDue: true,
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
const limits = { newPerDay: 0, reviewPerDay: 100 };
const NOW = new Date('2026-07-11T12:00:00Z');

// ---------------------------------------------------------------------------

describe('start flow', () => {
  it('walks subject → mode → source for lyssna, inserting lang for översätt', () => {
    let f = pick(initialFlow(), gates(), 'tal');
    expect(f.step).toBe('mode');
    f = pick(f, gates(), 'lyssna');
    expect(f.step).toBe('source');
    f = pick(f, gates(), 'tiotal');
    expect(f).toMatchObject({ step: 'begin', subject: 'tal', mode: 'lyssna', level: 'tiotal' });

    let g = pick(initialFlow(), gates(), 'ord');
    g = pick(g, gates(), 'översätt');
    expect(g.step).toBe('lang');
    g = pick(g, gates(), 'svenska');
    expect(g.step).toBe('source');
    g = pick(g, gates(), 'blandat');
    expect(g).toMatchObject({ step: 'begin', dispLang: 'svenska', wordSource: 'blandat' });
  });

  it('gates source options: tal-lyssna on coverage, ord on dueness', () => {
    expect(stepOptions(flow({ step: 'source', subject: 'tal', mode: 'lyssna' }), gates())).toEqual([
      'tiotal',
    ]);
    expect(
      stepOptions(flow({ step: 'source', subject: 'tal', mode: 'översätt' }), gates()),
    ).toEqual([...LEVEL_IDS]);
    expect(stepOptions(flow({ step: 'source', subject: 'ord', mode: 'lyssna' }), gates())).toEqual([
      'repetera',
      'blandat',
    ]);
    expect(
      stepOptions(flow({ step: 'source', subject: 'ord' }), gates({ hasDue: false })),
    ).toEqual(['blandat']);
  });

  it('ignores unknown ids and gated picks (same object back)', () => {
    const start = initialFlow();
    expect(pick(start, gates(), 'nope')).toBe(start);
    const atTalSource = flow({ step: 'source', subject: 'tal', mode: 'lyssna' });
    expect(pick(atTalSource, gates(), '0-99')).toBe(atTalSource);
    const atOrdSource = flow({ step: 'source', subject: 'ord', mode: 'lyssna' });
    expect(pick(atOrdSource, gates({ hasDue: false }), 'repetera')).toBe(atOrdSource);
  });

  it('drops a remembered tal level that lyssna cannot play', () => {
    const remembered = flow({ step: 'mode', subject: 'tal', level: '0-99' });
    expect(pick(remembered, gates(), 'lyssna').level).toBeNull();
    expect(pick(remembered, gates(), 'översätt').level).toBe('0-99');
    const covered = flow({ step: 'mode', subject: 'tal', level: 'tiotal' });
    expect(pick(covered, gates(), 'lyssna').level).toBe('tiotal');
  });

  it('backs up one step, skipping lang in lyssna', () => {
    expect(back(flow({ step: 'begin' })).step).toBe('source');
    expect(back(flow({ step: 'source', mode: 'översätt' })).step).toBe('lang');
    expect(back(flow({ step: 'source', mode: 'lyssna' })).step).toBe('mode');
    expect(back(flow({ step: 'lang' })).step).toBe('mode');
    expect(back(flow({ step: 'mode' })).step).toBe('subject');
    const first = initialFlow();
    expect(back(first)).toBe(first);
  });

  it('highlights the already-picked option per subject, else the first', () => {
    expect(highlightIndex(initialFlow(), gates())).toBe(0);
    expect(highlightIndex(flow({ subject: 'tal' }), gates())).toBe(1);
    expect(
      highlightIndex(
        flow({ step: 'source', subject: 'tal', mode: 'översätt', level: '0-99' }),
        gates(),
      ),
    ).toBe(2);
    expect(
      highlightIndex(flow({ step: 'source', subject: 'ord', wordSource: 'blandat' }), gates()),
    ).toBe(1);
    // A selection filtered out by the gates falls back to 0.
    expect(
      highlightIndex(
        flow({ step: 'source', subject: 'tal', mode: 'lyssna', level: '0-99' }),
        gates(),
      ),
    ).toBe(0);
  });

  it('wraps arrow-key movement in both directions', () => {
    expect(wrapIndex(0, -1, 4)).toBe(3);
    expect(wrapIndex(3, 1, 4)).toBe(0);
    expect(wrapIndex(1, 1, 4)).toBe(2);
  });

  it('is ready only when every step the picks need has one', () => {
    expect(isReady(flow({ subject: 'tal', mode: 'lyssna', level: 'tiotal' }))).toBe(true);
    expect(isReady(flow({ subject: 'tal', mode: 'lyssna' }))).toBe(false);
    expect(isReady(flow({ subject: 'tal', mode: 'översätt', level: '0-99' }))).toBe(false);
    expect(
      isReady(flow({ subject: 'ord', mode: 'översätt', dispLang: 'danska', wordSource: 'blandat' })),
    ).toBe(true);
    expect(isReady(flow({ subject: 'ord', mode: 'lyssna', level: 'tiotal' }))).toBe(false);
  });
});

describe('flow → session shape', () => {
  it('maps flows to input kinds', () => {
    expect(inputKind(flow({ subject: 'tal', mode: 'lyssna' }))).toBe('digits');
    expect(inputKind(flow({ subject: 'tal', mode: 'översätt', dispLang: 'danska' }))).toBe('digits');
    expect(inputKind(flow({ subject: 'tal', mode: 'översätt', dispLang: 'svenska' }))).toBe('danish');
    expect(inputKind(flow({ subject: 'ord', mode: 'lyssna' }))).toBe('danish');
    expect(inputKind(flow({ subject: 'ord', mode: 'översätt', dispLang: 'danska' }))).toBe('swedish');
    expect(inputKind(flow({ subject: 'ord', mode: 'översätt', dispLang: 'svenska' }))).toBe('danish');
  });

  it('maps ord flows onto the word drill modes and their SRS directions', () => {
    expect(wordModeId(flow({ subject: 'ord', mode: 'lyssna' }))).toBe('da-dictation');
    expect(wordModeId(flow({ subject: 'ord', mode: 'översätt', dispLang: 'danska' }))).toBe('da-sv');
    expect(wordModeId(flow({ subject: 'ord', mode: 'översätt', dispLang: 'svenska' }))).toBe('sv-da');
    expect(wordModeId(flow({ subject: 'tal', mode: 'lyssna' }))).toBeNull();
    expect(wordModeId(flow({ subject: 'ord', mode: 'översätt' }))).toBeNull();

    expect(wordDirection(flow({ subject: 'ord', mode: 'lyssna' }))).toBe('listen');
    expect(wordDirection(flow({ subject: 'ord', mode: 'översätt', dispLang: 'danska' }))).toBe(
      'recognize',
    );
    expect(wordDirection(flow({ subject: 'ord', mode: 'översätt', dispLang: 'svenska' }))).toBe(
      'produce',
    );
  });

  it('anyDue mirrors buildQueue dueness (suspended and future excluded)', () => {
    const cards = [card({ id: 'a', danish: 'hund', swedish: 'hund' })];
    const view = (r: SrsRecord | null): SrsView => ({ getRecord: () => r, newCardsToday: () => 0 });
    expect(anyDue(cards, view(record({})), 'produce', NOW)).toBe(true);
    expect(anyDue(cards, view(null), 'produce', NOW)).toBe(false);
    expect(anyDue(cards, view(record({ suspended: true })), 'produce', NOW)).toBe(false);
    expect(anyDue(cards, view(record({ due: '2027-01-01T00:00:00.000Z' })), 'produce', NOW)).toBe(
      false,
    );
  });
});

describe('sessions', () => {
  it('builds n number items from the level generator, no adjacent repeats', () => {
    const items = buildNumberSession('0-99', 20, seqRng(0.5, 0.5, 0.9, 0.1, 0.5));
    expect(items).toHaveLength(20);
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      expect(it?.type).toBe('tal');
      if (it?.type === 'tal') expect(it.tokens).toEqual(numberToTokens(it.value));
      if (i > 0 && it?.type === 'tal' && items[i - 1]?.type === 'tal') {
        expect(it.value).not.toBe((items[i - 1] as { value: number }).value);
      }
    }
    expect(() => buildNumberSession('nope' as never, 5, seqRng(0.5))).toThrow(RangeError);
  });

  it('builds due-only word sessions for repetera and shuffled-everything for blandat', () => {
    const cards = [
      card({ id: 'a', danish: 'hund', swedish: 'hund', audio: 'audio/a.mp3' }),
      card({ id: 'b', danish: 'kat', swedish: 'katt', audio: 'audio/b.mp3' }),
      card({ id: 'c', danish: 'hest', swedish: 'häst', audio: 'audio/c.mp3' }),
    ];
    // Only 'a' is due.
    const srs: SrsView = {
      getRecord: (id) => (id === 'a' ? record({}) : null),
      newCardsToday: () => 0,
    };
    const due = buildWordSession({
      modeId: 'sv-da',
      source: 'repetera',
      cards,
      srs,
      now: NOW,
      limits,
      size: 10,
    });
    expect(due.map((z) => (z.type === 'ord' ? z.item.id : ''))).toEqual(['a']);
    expect(due[0]?.type === 'ord' && due[0].item.prompt).toBe('hund');
    expect(due[0]?.type === 'ord' && due[0].item.answer).toBe('hund');

    const mixed = buildWordSession({
      modeId: 'sv-da',
      source: 'blandat',
      cards,
      srs: noSrs,
      now: NOW,
      limits,
      size: 10,
      rng: seqRng(0.999), // identity shuffle
    });
    expect(mixed).toHaveLength(3);

    // Dictation requires a clip — a card without audio never enters lyssna.
    const noClip = [...cards, card({ id: 'd', danish: 'ø', swedish: 'ö' })];
    const dictation = buildWordSession({
      modeId: 'da-dictation',
      source: 'blandat',
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
  });
});

describe('grading', () => {
  const n27: ZenItem = { type: 'tal', value: 27, tokens: numberToTokens(27), kind: 'number' };
  const y1994: ZenItem = { type: 'tal', value: 1994, tokens: yearToTokens(1994), kind: 'year' };
  const kr42: ZenItem = { type: 'tal', value: 42, tokens: priceToTokens(42), kind: 'price' };
  const talListen = flow({ subject: 'tal', mode: 'lyssna' });
  const talWrite = flow({ subject: 'tal', mode: 'översätt', dispLang: 'svenska' });

  it('grades digits on exact value, ignoring thousands spaces', () => {
    expect(gradeDigits('27', n27 as never)).toBe(true);
    expect(gradeDigits(' 2 7 ', n27 as never)).toBe(true);
    expect(gradeDigits('1 994', y1994 as never)).toBe(true);
    expect(gradeDigits('28', n27 as never)).toBe(false);
    expect(gradeDigits('', n27 as never)).toBe(false);
    expect(gradeDigits('   ', n27 as never)).toBe(false);
  });

  it('grades Danish number readings ignoring case and ALL spacing', () => {
    expect(gradeDanishNumber('syvogtyve', n27 as never)).toBe(true);
    expect(gradeDanishNumber('  Syv og Tyve ', n27 as never)).toBe(true);
    expect(gradeDanishNumber('seksogtyve', n27 as never)).toBe(false);
    expect(gradeDanishNumber('', n27 as never)).toBe(false);
  });

  it('accepts both year readings and bare-cardinal prices', () => {
    expect(gradeZen('nitten hundrede og fireoghalvfems', y1994, talWrite)).toBe(true);
    expect(gradeZen('et tusind ni hundrede og fireoghalvfems', y1994, talWrite)).toBe(true);
    expect(gradeZen('toogfyrre kroner', kr42, talWrite)).toBe(true);
    expect(gradeZen('toogfyrre', kr42, talWrite)).toBe(true);
    expect(gradeZen('treogfyrre kroner', kr42, talWrite)).toBe(false);
    expect(gradeZen('27', n27, talListen)).toBe(true);
  });

  it('delegates ord grading to the registry matcher (folding, alternatives)', () => {
    const c = card({ id: 'a', danish: 'sø', swedish: 'sjö', accepted: [] });
    const zi: ZenItem = {
      type: 'ord',
      item: { id: 'a', prompt: 'sjö', answer: 'sø', card: c, sourceCardId: 'a' },
    };
    const svDa = flow({ subject: 'ord', mode: 'översätt', dispLang: 'svenska' });
    expect(gradeZen('sø', zi, svDa)).toBe(true);
    expect(gradeZen('sö', zi, svDa)).toBe(true); // Swedish-keyboard fold
    expect(gradeZen('so', zi, svDa)).toBe(false);
    expect(gradeZen('', zi, svDa)).toBe(false);
  });
});

describe('display', () => {
  const y1994: ZenItem = { type: 'tal', value: 1994, tokens: yearToTokens(1994), kind: 'year' };
  const kr42: ZenItem = { type: 'tal', value: 42, tokens: priceToTokens(42), kind: 'price' };
  const n7: ZenItem = { type: 'tal', value: 7, tokens: numberToTokens(7), kind: 'number' };
  const ordItem: ZenItem = {
    type: 'ord',
    item: {
      id: 'a',
      prompt: 'hund (djuret)',
      answer: 'hund',
      card: card({ id: 'a', danish: 'hund', swedish: 'hund (djuret)' }),
    },
  };

  it('prompts the Danish reading or the Swedish-side value for tal', () => {
    const daSide = flow({ subject: 'tal', mode: 'översätt', dispLang: 'danska' });
    const svSide = flow({ subject: 'tal', mode: 'översätt', dispLang: 'svenska' });
    expect(zenPrompt(n7, daSide)).toEqual({ text: 'syv', lang: 'da' });
    expect(zenPrompt(n7, svSide)).toEqual({ text: '7', lang: null });
    expect(zenPrompt(y1994, svSide)).toEqual({ text: 'år 1994', lang: null });
    expect(zenPrompt(kr42, svSide)).toEqual({ text: '42 kronor', lang: null });
    expect(zenPrompt(n7, flow({ subject: 'tal', mode: 'lyssna' }))).toBeNull();
  });

  it('prompts the item text for ord translate flows, lang by shown side', () => {
    const daShown = flow({ subject: 'ord', mode: 'översätt', dispLang: 'danska' });
    const svShown = flow({ subject: 'ord', mode: 'översätt', dispLang: 'svenska' });
    expect(zenPrompt(ordItem, daShown)).toEqual({ text: 'hund (djuret)', lang: 'da' });
    expect(zenPrompt(ordItem, svShown)).toEqual({ text: 'hund (djuret)', lang: null });
    expect(zenPrompt(ordItem, flow({ subject: 'ord', mode: 'lyssna' }))).toBeNull();
  });

  it('reveals the Danish form big with the other side under it', () => {
    expect(zenReveal(n7, '7', true)).toEqual({ correct: true, word: 'syv', sub: '7' });
    expect(zenReveal(kr42, '41', false)).toEqual({
      correct: false,
      word: 'toogfyrre kroner',
      sub: '42 kr  ·  du skrev 41',
    });
    expect(zenReveal(ordItem, 'hund', true)).toEqual({
      correct: true,
      word: 'hund',
      sub: 'hund (djuret)',
    });
    expect(zenReveal(ordItem, ' hunt ', false).sub).toBe('hund (djuret)  ·  du skrev hunt');
  });

  it('labels reveal digits, with kr only for prices', () => {
    expect(digitsLabel(n7 as never)).toBe('7');
    expect(digitsLabel(y1994 as never)).toBe('1994');
    expect(digitsLabel(kr42 as never)).toBe('42 kr');
  });
});

describe('parsePrefs', () => {
  it('round-trips valid prefs and nulls everything else', () => {
    const raw = JSON.stringify({
      subject: 'ord',
      mode: 'översätt',
      dispLang: 'svenska',
      level: 'stora-tal',
      wordSource: 'blandat',
    });
    expect(parsePrefs(raw)).toEqual({
      subject: 'ord',
      mode: 'översätt',
      dispLang: 'svenska',
      level: 'stora-tal',
      wordSource: 'blandat',
    });
    const none = { subject: null, mode: null, dispLang: null, level: null, wordSource: null };
    expect(parsePrefs(null)).toEqual(none);
    expect(parsePrefs('not json')).toEqual(none);
    expect(parsePrefs('"str"')).toEqual(none);
    expect(parsePrefs(JSON.stringify({ subject: 'siffror', level: 42 }))).toEqual(none);
    expect(parsePrefs(JSON.stringify({ mode: 'lyssna' }))).toEqual({ ...none, mode: 'lyssna' });
  });
});

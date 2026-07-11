import { describe, it, expect } from 'vitest';
import {
  buildQueue,
  buildChoices,
  matchTyped,
  matchCloze,
  normalizeTyped,
  reinsertAgain,
  eligibleForDirection,
  dueByDirection,
  AGAIN_MAX_REENTRIES,
  type SrsView,
} from './session.ts';
import type { Card } from './vocab.ts';
import type { SrsRecord } from './storage.ts';

const T0 = new Date('2026-07-01T08:00:00Z');
const daysAgo = (n: number) => new Date(T0.getTime() - n * 86_400_000);

// An rng pinned just under 1 makes Fisher–Yates the identity permutation, so
// tests assert the REAL selection/ordering logic, not shuffle luck.
const noShuffle = () => 0.999999;

const card = (id: string, over: Partial<Card> = {}): Card => ({
  id,
  danish: id,
  swedish: `sv-${id}`,
  pos: 'other',
  deck: 'd1',
  cefr: 'b1',
  tags: [],
  accepted: [],
  ...over,
});

const rec = (due: Date, over: Partial<SrsRecord> = {}): SrsRecord => ({
  due: due.toISOString(),
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

/** Fake store view: records keyed `${id}::${direction}` + a fixed daily count. */
const srsView = (records: Record<string, SrsRecord> = {}, newToday = 0): SrsView => ({
  getRecord: (id, dir) => records[`${id}::${dir}`] ?? null,
  newCardsToday: () => newToday,
});

type QueueOpts = Parameters<typeof buildQueue>[0];
const build = (cards: Card[], over: Partial<QueueOpts> = {}) =>
  buildQueue({
    cards,
    match: { kind: 'decks', decks: ['d1'] },
    direction: 'produce',
    srs: srsView(),
    now: T0,
    limits: { newPerDay: 10, reviewPerDay: 200 },
    rng: noShuffle,
    ...over,
  });

const ids = (cs: Card[]) => cs.map((c) => c.id);

describe('buildQueue: due backlog', () => {
  it('caps due cards MOST-OVERDUE first and skips not-yet-due records', () => {
    const cards = ['c1', 'c2', 'c3', 'c4'].map((id) => card(id));
    const srs = srsView({
      'c1::produce': rec(daysAgo(1)),
      'c2::produce': rec(daysAgo(3)),
      'c3::produce': rec(daysAgo(2)),
      'c4::produce': rec(new Date(T0.getTime() + 3_600_000)), // due in 1h
    });
    const { queue } = build(cards, { srs, limits: { newPerDay: 0, reviewPerDay: 2 } });
    expect(ids(queue)).toEqual(['c2', 'c3']); // 3d then 2d overdue; 1d capped out
  });

  it('excludes suspended records from scheduled review but not from free practice', () => {
    const cards = [card('c1'), card('c2')];
    const srs = srsView({
      'c1::produce': rec(daysAgo(5), { suspended: true }),
      'c2::produce': rec(daysAgo(1)),
    });
    expect(ids(build(cards, { srs }).queue)).toEqual(['c2']);
    expect(ids(build(cards, { srs, free: true }).queue)).toEqual(['c1', 'c2']);
  });
});

describe('buildQueue: new-card budget', () => {
  it('is a DAILY budget shared across directions (newCardsToday is subtracted)', () => {
    const cards = ['f1', 'f2', 'f3', 'f4', 'f5'].map((id) => card(id));
    const limits = { newPerDay: 4, reviewPerDay: 200 };
    expect(build(cards, { limits }).queue).toHaveLength(4);
    // 3 already introduced today (e.g. in another direction) -> only 1 left.
    expect(build(cards, { srs: srsView({}, 3), limits }).queue).toHaveLength(1);
    // Over-budget day never goes negative.
    expect(build(cards, { srs: srsView({}, 9), limits }).queue).toHaveLength(0);
  });

  it('introduces fresh cards by rank, then B1 before B2 when unranked', () => {
    const cards = [
      card('r3', { rank: 3 }),
      card('u-b2', { cefr: 'b2' }),
      card('r1', { rank: 1 }),
      card('u-b1', { cefr: 'b1' }),
      card('r2', { rank: 2 }),
    ];
    const { queue } = build(cards, { limits: { newPerDay: 4, reviewPerDay: 200 } });
    expect(ids(queue)).toEqual(['r1', 'r2', 'r3', 'u-b1']);
  });

  it('composes a session as capped-due first, then budgeted fresh', () => {
    const cards = ['d1c', 'd2c', 'd3c', 'f1', 'f2'].map((id) => card(id));
    const srs = srsView({
      'd1c::produce': rec(daysAgo(2)),
      'd2c::produce': rec(daysAgo(1)),
      'd3c::produce': rec(daysAgo(3)),
    });
    const { queue } = build(cards, { srs, limits: { newPerDay: 1, reviewPerDay: 2 } });
    expect(ids(queue)).toEqual(['d3c', 'd1c', 'f1']);
  });
});

describe('buildQueue: pool selection + direction filters', () => {
  it('a tag deep-link wins over the group match; no selection means empty pool', () => {
    const cards = [card('t1', { deck: 'other', tags: ['greet'] }), card('g1')];
    const tagged = build(cards, { tag: 'greet' });
    expect(ids(tagged.pool)).toEqual(['t1']);
    expect(ids(tagged.queue)).toEqual(['t1']);
    const none = build(cards, { match: null });
    expect(none.pool).toEqual([]);
    expect(none.queue).toEqual([]);
    expect(none.filteredReason).toBe('none');
  });

  it('cloze keeps only cards whose example contains the headword or an accepted form', () => {
    const cards = [
      card('cz1', { danish: 'løbe', exampleDa: 'Jeg kan lide at løbe.' }),
      card('cz2', { danish: 'hund', exampleDa: 'Katten sover.' }), // form absent
      card('cz3', { danish: 'kat' }), // no example at all
      card('cz4', { danish: 'gå', accepted: ['går'], exampleDa: 'Jeg går nu.' }),
    ];
    const r = build(cards, { direction: 'cloze' });
    expect(ids(r.queue)).toEqual(['cz1', 'cz4']);
    expect(r.pool).toHaveLength(4); // pool stays unfiltered (distractor source)
    expect(r.filteredReason).toBe('none');
  });

  it('reports filteredReason "cloze" when a non-empty pool has no cloze-able card', () => {
    const r = build([card('cz2', { danish: 'hund', exampleDa: 'Katten sover.' })], {
      direction: 'cloze',
    });
    expect(r.queue).toEqual([]);
    expect(r.filteredReason).toBe('cloze');
  });

  it('listen-sentence needs BOTH committed sentence audio and the sentence text', () => {
    const cards = [
      card('ls1', { exampleDa: 'Han løber.', audioExample: 'audio/x.mp3' }),
      card('ls2', { exampleDa: 'Hun ser.' }), // no audio
      card('ls3', { audioExample: 'audio/y.mp3' }), // no text
    ];
    const r = build(cards, { direction: 'listen-sentence' });
    expect(ids(r.queue)).toEqual(['ls1']);
    const empty = build([cards[1] as Card, cards[2] as Card], { direction: 'listen-sentence' });
    expect(empty.queue).toEqual([]);
    expect(empty.filteredReason).toBe('listen');
  });
});

describe('buildQueue: due-all group (match kind "all")', () => {
  // Cards across DIFFERENT decks — the 'all' match spans starter ∪ praksis.
  const cards = [
    card('s1', { deck: 'hverdag-b1' }),
    card('s2', { deck: 'verber-b1' }),
    card('p1', { deck: 'praksis-verber-b1' }),
    card('p2', { deck: 'praksis-substantiver-b2' }),
  ];

  it('collects ONLY due records across all decks — never new cards', () => {
    const srs = srsView({
      's1::produce': rec(daysAgo(1)),
      'p1::produce': rec(daysAgo(2)),
      // s2, p2 are fresh — must NOT enter despite the new-card budget.
    });
    const { queue, pool } = build(cards, { match: { kind: 'all' }, srs });
    expect(ids(pool)).toEqual(['s1', 's2', 'p1', 'p2']); // pool = everything
    expect(ids(queue)).toEqual(['p1', 's1']); // due only, most-overdue first
  });

  it('presents the backlog most-overdue-first (unshuffled) and honors the due cap', () => {
    const srs = srsView({
      's1::produce': rec(daysAgo(1)),
      's2::produce': rec(daysAgo(4)),
      'p1::produce': rec(daysAgo(3)),
      'p2::produce': rec(daysAgo(2)),
    });
    // rng () => 0 WOULD visibly permute via Fisher–Yates if a shuffle ran, so
    // this asserts the due-all queue really is presented in overdue order.
    const { queue } = build(cards, {
      match: { kind: 'all' },
      srs,
      rng: () => 0,
      limits: { newPerDay: 10, reviewPerDay: 3 },
    });
    expect(ids(queue)).toEqual(['s2', 'p1', 'p2']); // 4d, 3d, 2d; 1d capped out
  });

  it('skips suspended and not-yet-due records, and respects direction filters', () => {
    const srs = srsView({
      's1::produce': rec(daysAgo(2), { suspended: true }),
      's2::produce': rec(new Date(T0.getTime() + 3_600_000)), // due in 1h
      'p1::produce': rec(daysAgo(1)),
      'p1::listen': rec(daysAgo(5)), // other direction — must not leak in
    });
    expect(ids(build(cards, { match: { kind: 'all' }, srs }).queue)).toEqual(['p1']);
  });

  it('free practice wins over due-only (roam the whole union, shuffled)', () => {
    const srs = srsView({ 's1::produce': rec(daysAgo(1)) });
    const { queue } = build(cards, { match: { kind: 'all' }, srs, free: true });
    expect(ids(queue).sort()).toEqual(['p1', 'p2', 's1', 's2']);
  });

  it('a tag deep-link restores normal scheduling (new cards allowed again)', () => {
    const tagged = [card('t1', { tags: ['greet'] }), card('t2', { tags: ['greet'] })];
    const { queue } = build(tagged, { match: { kind: 'all' }, tag: 'greet' });
    expect(queue).toHaveLength(2); // fresh cards enter under the daily budget
  });
});

describe('eligibleForDirection', () => {
  const cards = [
    card('c1', { danish: 'løbe', exampleDa: 'Jeg kan lide at løbe.', audioExample: 'audio/a.mp3' }),
    card('c2', { danish: 'hund', exampleDa: 'Katten sover.' }), // headword absent, no audio
    card('c3', { danish: 'kat' }), // bare card
  ];

  it('filters per direction and passes everything else through', () => {
    expect(ids(eligibleForDirection(cards, 'cloze'))).toEqual(['c1']);
    expect(ids(eligibleForDirection(cards, 'listen-sentence'))).toEqual(['c1']);
    for (const d of ['produce', 'recognize', 'listen', 'speak'] as const) {
      expect(eligibleForDirection(cards, d)).toHaveLength(3);
    }
  });
});

describe('dueByDirection: done-screen split', () => {
  it('counts due records per direction over the pool, dropping zero entries', () => {
    const pool = [
      card('c1', { exampleDa: 'c1 er her.', audioExample: 'audio/c1.mp3' }),
      card('c2'),
    ];
    const srs = srsView({
      'c1::produce': rec(daysAgo(1)),
      'c2::produce': rec(daysAgo(2)),
      'c1::listen-sentence': rec(daysAgo(1)),
      'c2::listen-sentence': rec(daysAgo(1)), // ineligible (no example audio) — dropped
      'c1::speak': rec(new Date(T0.getTime() + 3_600_000)), // not yet due
      'c2::listen': rec(daysAgo(3), { suspended: true }), // suspended — dropped
    });
    const split = dueByDirection({
      pool,
      directions: ['produce', 'recognize', 'listen', 'listen-sentence', 'speak', 'cloze'],
      srs,
      now: T0,
    });
    expect(split).toEqual([
      { direction: 'produce', count: 2 },
      { direction: 'listen-sentence', count: 1 },
    ]);
  });

  it('only counts cards inside the pool', () => {
    const srs = srsView({ 'in::produce': rec(daysAgo(1)), 'out::produce': rec(daysAgo(1)) });
    const split = dueByDirection({ pool: [card('in')], directions: ['produce'], srs, now: T0 });
    expect(split).toEqual([{ direction: 'produce', count: 1 }]);
  });
});

describe('buildChoices: recognize distractors', () => {
  it('prefers same-POS, in-domain distractors from a big-enough pool', () => {
    const cur = card('v0', { pos: 'verb' });
    const pool = [
      cur,
      ...['v1', 'v2', 'v3', 'v4'].map((id) => card(id, { pos: 'verb' })),
      ...['n1', 'n2', 'n3', 'n4'].map((id) => card(id, { pos: 'noun' })),
    ];
    const out = buildChoices({ card: cur, pool, allCards: pool, rng: noShuffle });
    expect(out).toEqual(['v0', 'v1', 'v2', 'v3']); // correct + first 3 same-POS
  });

  it('falls back to the whole card set when the pool is tiny (<8)', () => {
    const cur = card('a');
    const all = [cur, ...['x1', 'x2', 'x3', 'x4', 'x5'].map((id) => card(id))];
    const out = buildChoices({ card: cur, pool: [cur], allCards: all, rng: noShuffle });
    expect(out).toHaveLength(4);
    expect(out).toContain('a');
    for (const d of out) expect(ids(all)).toContain(d); // danish === id here
  });

  it('fix B: never offers an alternative CORRECT answer as a distractor', () => {
    // 'springe' is an accepted synonym; 'hoppe op' shares the Swedish gloss
    // (modulo case/edge punctuation) — both would be correct answers to the
    // prompt "hoppa" and must not appear as "wrong" choices.
    const cur = card('hoppe', { swedish: 'hoppa', accepted: ['springe'], pos: 'verb' });
    const pool = [
      cur,
      card('springe', { swedish: 'springa; hoppa', pos: 'verb' }),
      card('hoppe op', { swedish: ' Hoppa. ', pos: 'verb' }),
      ...['løbe', 'gå', 'se', 'tale', 'spise', 'drikke'].map((d) =>
        card(d, { swedish: `sv-${d}`, pos: 'verb' }),
      ),
    ];
    for (let i = 0; i < 25; i++) {
      const out = buildChoices({ card: cur, pool, allCards: pool });
      expect(out).toContain('hoppe');
      expect(out).not.toContain('springe');
      expect(out).not.toContain('hoppe op');
      expect(new Set(out).size).toBe(out.length); // no duplicate options
    }
  });

  it('degrades gracefully when fewer than 3 valid distractors exist', () => {
    const cur = card('a', { swedish: 'ordet' });
    const all = [cur, card('b', { swedish: 'annat' }), card('c', { swedish: 'ordet' })];
    const out = buildChoices({ card: cur, pool: all, allCards: all, rng: noShuffle });
    expect(out).toEqual(['a', 'b']); // 'c' shares the gloss -> excluded
  });
});

describe('matchTyped/matchCloze: punctuation tolerance (fix A)', () => {
  const c = (danish: string, accepted: string[] = []) => ({ danish, accepted });

  it('strips leading/trailing punctuation and collapses whitespace', () => {
    expect(matchTyped('løbe.', c('løbe'))).toBe(true);
    expect(matchTyped('  løbe !', c('løbe'))).toBe(true);
    expect(matchTyped('i  går', c('i går'))).toBe(true);
    expect(matchTyped('"hej"', c('hej'))).toBe(true);
    expect(normalizeTyped('  GÅ   nu! ')).toBe('gå nu');
  });

  it('tolerates punctuation on the STORED side too (phrases ending in ?/!)', () => {
    expect(matchTyped('hvad så', c('hvad så?'))).toBe(true);
    expect(matchTyped('hvad så?', c('hvad så?'))).toBe(true);
  });

  it('still accepts explicit accepted forms, with edge punctuation', () => {
    expect(matchTyped('springe.', c('hoppe', ['springe']))).toBe(true);
    expect(matchTyped('løbe', c('hoppe', ['springe']))).toBe(false);
  });

  it('keeps æ/ø/å significant — Swedish-letter spellings stay WRONG', () => {
    expect(matchTyped('läse.', c('læse'))).toBe(false);
    expect(matchTyped('bocker', c('bøger'))).toBe(false);
    expect(matchTyped('gá', c('gå'))).toBe(false);
  });

  it('keeps INTERNAL punctuation significant and rejects punctuation-only input', () => {
    expect(matchTyped('i.går', c('i går'))).toBe(false);
    expect(matchTyped('...', c('løbe'))).toBe(false);
    expect(matchTyped('   ', c('løbe'))).toBe(false);
  });

  it('matchCloze compares the exact blanked surface form, case/edge-punct tolerant', () => {
    expect(matchCloze('øl.', 'Øl')).toBe(true);
    expect(matchCloze('løber', 'løber')).toBe(true);
    expect(matchCloze('løbe', 'løber')).toBe(false); // lemma is NOT enough
    expect(matchCloze('', 'løber')).toBe(false);
  });
});

describe('reinsertAgain: same-session re-entry (fix C)', () => {
  const queue = Array.from({ length: 10 }, (_, i) => card(`q${i}`));

  it('re-inserts the failed card ~6 positions ahead', () => {
    const next = reinsertAgain(queue, 0, 0);
    expect(next).not.toBeNull();
    expect(next).toHaveLength(11);
    expect(ids(next as Card[])).toEqual([
      'q0', 'q1', 'q2', 'q3', 'q4', 'q5', 'q0', 'q6', 'q7', 'q8', 'q9',
    ]);
  });

  it('clamps the insertion to the queue end', () => {
    const short = queue.slice(0, 4);
    const next = reinsertAgain(short, 2, 0);
    expect(ids(next as Card[])).toEqual(['q0', 'q1', 'q2', 'q3', 'q2']);
  });

  it('caps re-insertions per card per session', () => {
    expect(reinsertAgain(queue, 0, AGAIN_MAX_REENTRIES - 1)).not.toBeNull();
    expect(reinsertAgain(queue, 0, AGAIN_MAX_REENTRIES)).toBeNull();
    expect(reinsertAgain(queue, 0, 0, { max: 0 })).toBeNull();
  });

  it('is pure (input untouched) and rejects an out-of-range index', () => {
    const before = ids(queue);
    reinsertAgain(queue, 0, 0);
    expect(ids(queue)).toEqual(before);
    expect(reinsertAgain(queue, 99, 0)).toBeNull();
  });
});

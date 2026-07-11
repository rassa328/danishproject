import { describe, it, expect } from 'vitest';
import {
  DRILL_SESSIONS,
  SUB_CONFIGS,
  acceptedSwedish,
  availableCount,
  subConfigOf,
  type DrillBuildDeps,
  type DrillItem,
  type DrillSub,
} from './drill-modes.ts';
import type { Rng, SrsView } from './session.ts';
import type { Card } from './vocab.ts';
import type { SrsRecord } from './storage.ts';
import { Rating } from './srs.ts';
import { atomsForLevel, type NumberAudioManifest } from './number-audio.ts';

const T0 = new Date('2026-07-01T08:00:00Z');
const daysAgo = (n: number) => new Date(T0.getTime() - n * 86_400_000);

// An rng pinned just under 1 makes Fisher–Yates the identity permutation.
const noShuffle = () => 0.999999;

/** Replays a fixed draw sequence — pins the number generators exactly. */
const seqRng = (vals: number[]): Rng => {
  let i = 0;
  return () => vals[i++ % vals.length] ?? 0;
};

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

const deps = (cards: Card[], over: Partial<DrillBuildDeps> = {}): DrillBuildDeps => ({
  cards,
  srs: srsView(),
  now: T0,
  limits: { newPerDay: 10, reviewPerDay: 200 },
  rng: noShuffle,
  size: 20,
  match: { kind: 'decks', decks: ['d1'] },
  ...over,
});

const ids = (items: DrillItem[]) => items.map((i) => i.id);
const subs = (items: DrillItem[]) => items.map((i) => i.sub);

describe('acceptedSwedish', () => {
  it('harvests "även:"-alternatives from the parenthetical (plan §6 example)', () => {
    const c = card('hoppe', { swedish: 'hoppa (även: brista, sprängas)' });
    expect(acceptedSwedish(c)).toEqual(['hoppa', 'brista', 'sprängas']);
  });

  it('splits the gloss on "/" (plan §6 example)', () => {
    const c = card('midlertidig', { swedish: 'temporär / temporärt' });
    expect(acceptedSwedish(c)).toEqual(['temporär', 'temporärt']);
  });

  it('harvests "el."-alternatives too', () => {
    const c = card('ked', { swedish: 'ledsen (el. sorgsen)' });
    expect(acceptedSwedish(c)).toEqual(['ledsen', 'sorgsen']);
  });

  it('drops plain commentary parentheticals whole', () => {
    const c = card('sky', { swedish: 'moln (på himlen)' });
    expect(acceptedSwedish(c)).toEqual(['moln']);
  });

  it('strips parentheticals BEFORE splitting, so "/" inside parens cannot leak garbage', () => {
    // Regression: split-first turned 'byta (tåg/buss)' into the unanswerable
    // ['byta (tåg', 'buss)'] — soft-locking the miss recovery (31 committed
    // cards, incl. starter "skifte").
    const c = card('skifte', { swedish: 'byta (tåg/buss)' });
    expect(acceptedSwedish(c)).toEqual(['byta']);
  });

  it('still splits on "/" outside parens when the gloss also has parentheticals', () => {
    const c = card('lav', { swedish: 'kort (om person/låg) / lag' });
    expect(acceptedSwedish(c)).toEqual(['kort', 'lag']);
  });

  it('normalizes, dedupes and drops empties', () => {
    const c = card('x', { swedish: '  Hoppa / hoppa. / (vardagligt) ' });
    expect(acceptedSwedish(c)).toEqual(['hoppa']);
  });

  it('the curated acceptedSv column overrides the heuristic entirely', () => {
    const c = card('hoppe', {
      swedish: 'hoppa (även: brista, sprängas)',
      acceptedSv: ['Hoppa', 'spricka'],
    });
    expect(acceptedSwedish(c)).toEqual(['hoppa', 'spricka']); // no brista/sprängas
  });
});

describe('translate buildItems: back-and-forth direction mixing', () => {
  it('due source: per-direction dueness decides, merged most-overdue-first', () => {
    const cards = [card('c1'), card('c2'), card('c3')];
    const srs = srsView({
      'c1::produce': rec(daysAgo(1)),
      'c2::recognize': rec(daysAgo(4)),
      // c3 fresh in both — must not enter the due-only source.
    });
    const out = DRILL_SESSIONS.translate.buildItems(deps(cards, { srs, match: { kind: 'all' } }));
    expect(ids(out)).toEqual(['c2', 'c1']); // c2 four days overdue beats c1
    expect(subs(out)).toEqual(['da-sv', 'sv-da']); // each drilled in its due skill
  });

  it('due source: due in BOTH directions → one item, the more overdue skill wins', () => {
    const cards = [card('c1')];
    const srs = srsView({
      'c1::produce': rec(daysAgo(1)),
      'c1::recognize': rec(daysAgo(5)),
    });
    const out = DRILL_SESSIONS.translate.buildItems(deps(cards, { srs, match: { kind: 'all' } }));
    expect(out).toHaveLength(1);
    expect(out[0]?.sub).toBe('da-sv');
  });

  it('set sources alternate sv→da / da→sv over the presented order', () => {
    const cards = ['f1', 'f2', 'f3', 'f4'].map((id) => card(id));
    const out = DRILL_SESSIONS.translate.buildItems(deps(cards));
    expect(out).toHaveLength(4);
    expect(subs(out)).toEqual(['sv-da', 'da-sv', 'sv-da', 'da-sv']);
    // Direction decides the prompt/answer orientation.
    expect(out[0]).toMatchObject({ prompt: 'sv-f1', answer: 'f1' });
    expect(out[1]).toMatchObject({ prompt: 'f2', answer: 'sv-f2' });
  });

  it('a lesson tag restores normal scheduling: due + budgeted new cards', () => {
    const cards = [card('t1', { tags: ['mad'] }), card('t2', { tags: ['mad'] }), card('x1')];
    const srs = srsView({ 't2::produce': rec(daysAgo(1)) });
    const out = DRILL_SESSIONS.translate.buildItems(deps(cards, { srs, tag: 'mad', match: null }));
    expect(ids(out)).toEqual(['t2', 't1']); // due first, then fresh; x1 untagged
  });

  it('free roam returns the whole pool (no SRS filtering, no new-card budget)', () => {
    const cards = ['f1', 'f2', 'f3'].map((id) => card(id));
    const out = DRILL_SESSIONS.translate.buildItems(
      deps(cards, { free: true, srs: srsView({}, 10), match: { kind: 'all' } }),
    );
    expect(out).toHaveLength(3); // budget exhausted, but free ignores it
  });

  it('respects the shared daily new-card budget via the injected SrsView', () => {
    const cards = ['f1', 'f2', 'f3'].map((id) => card(id));
    const out = DRILL_SESSIONS.translate.buildItems(
      deps(cards, { srs: srsView({}, 9), limits: { newPerDay: 10, reviewPerDay: 200 } }),
    );
    expect(out).toHaveLength(1); // 10 − 9 already introduced today
  });

  it('slices the assembled queue to the session size', () => {
    const cards = ['f1', 'f2', 'f3', 'f4', 'f5'].map((id) => card(id));
    const out = DRILL_SESSIONS.translate.buildItems(deps(cards, { size: 3 }));
    expect(out).toHaveLength(3);
  });
});

describe('listen buildItems (word dictation)', () => {
  it('filters clip-less cards BEFORE building (their due records never count)', () => {
    const cards = [card('a1', { audio: 'audio/da-a1.mp3' }), card('a2')];
    const srs = srsView({
      'a1::listen': rec(daysAgo(1)),
      'a2::listen': rec(daysAgo(5)), // more overdue, but no clip
    });
    const out = DRILL_SESSIONS.listen.buildItems(deps(cards, { srs, match: { kind: 'all' } }));
    expect(ids(out)).toEqual(['a1']);
    expect(out[0]?.sub).toBe('da-dictation');
  });

  it('prompts AND answers the Danish word (audio-only prompt)', () => {
    const hoppe = card('hoppe', { swedish: 'hoppa', audio: 'audio/da-hoppe.mp3' });
    const [item] = DRILL_SESSIONS.listen.buildItems(deps([hoppe]));
    expect(item).toMatchObject({
      prompt: 'hoppe',
      answer: 'hoppe',
      sourceCardId: 'hoppe',
      audio: { kind: 'clip', text: 'hoppe', url: 'audio/da-hoppe.mp3' },
    });
  });
});

describe('word item shapes', () => {
  const hoppe = card('hoppe', { danish: 'hoppe', swedish: 'hoppa', audio: 'audio/da-hoppe.mp3' });

  it('sv→da prompts the Swedish gloss and answers the Danish word', () => {
    const [item] = DRILL_SESSIONS.translate.buildItems(deps([hoppe]));
    expect(item).toMatchObject({
      id: 'hoppe',
      sub: 'sv-da',
      prompt: 'hoppa',
      answer: 'hoppe',
      sourceCardId: 'hoppe',
      audio: { kind: 'clip', text: 'hoppe', url: 'audio/da-hoppe.mp3' },
    });
    expect(item?.card).toBe(hoppe); // glossary panel gets the full card
  });

  it('omits the clip url (not the audio) for clip-less cards', () => {
    const [item] = DRILL_SESSIONS.translate.buildItems(deps([card('bare')]));
    expect(item?.audio).toStrictEqual({ kind: 'clip', text: 'bare' }); // no url key at all
  });
});

describe('sentence buildItems', () => {
  const withEx = (id: string, over: Partial<Card> = {}) =>
    card(id, { exampleDa: `Da-mening ${id}.`, exampleSv: `Sv-mening ${id}.`, ...over });

  it('translate-sent needs BOTH examples and alternates sv→da / da→sv', () => {
    const cards = [withEx('e1'), withEx('e2'), card('bare'), withEx('e3')];
    const out = DRILL_SESSIONS['translate-sent'].buildItems(deps(cards));
    expect(ids(out)).toEqual(['sent:e1', 'sent:e2', 'sent:e3']); // 'bare' has no examples
    expect(subs(out)).toEqual(['sent-sv-da', 'sent-da-sv', 'sent-sv-da']);
    expect(out[0]).toMatchObject({ prompt: 'Sv-mening e1.', answer: 'Da-mening e1.' });
    expect(out[1]).toMatchObject({ prompt: 'Da-mening e2.', answer: 'Sv-mening e2.' });
  });

  it('listen-sent additionally requires the recorded clip and answers in Swedish', () => {
    const cards = [withEx('e1', { audioExample: 'audio/da-e1-ex.mp3' }), withEx('e2')];
    const out = DRILL_SESSIONS['listen-sent'].buildItems(deps(cards));
    expect(ids(out)).toEqual(['sent:e1']); // e2 has no clip
    expect(out[0]).toMatchObject({
      sub: 'sent-listen',
      prompt: 'Da-mening e1.',
      answer: 'Sv-mening e1.',
      audio: { kind: 'clip', text: 'Da-mening e1.', url: 'audio/da-e1-ex.mp3' },
    });
  });

  it('sentence items are ungraded: no sourceCardId, srs null on every sentence sub', () => {
    const [item] = DRILL_SESSIONS['translate-sent'].buildItems(deps([withEx('e1')]));
    expect(item?.sourceCardId).toBeUndefined();
    for (const sub of ['sent-sv-da', 'sent-da-sv', 'sent-listen'] as const) {
      expect(SUB_CONFIGS[sub].srs).toBeNull();
    }
  });

  it('sentence sources ignore SRS scheduling entirely (free semantics)', () => {
    // Everything with examples is offered even when the new-card budget is spent.
    const out = DRILL_SESSIONS['translate-sent'].buildItems(
      deps([withEx('e1'), withEx('e2')], { srs: srsView({}, 10), match: { kind: 'all' } }),
    );
    expect(out).toHaveLength(2);
  });
});

describe('per-sub matches()', () => {
  const laese = card('læse', { danish: 'læse', accepted: ['læser'] });
  const itemFor = (sub: DrillSub, c: Card, prompt: string, answer: string): DrillItem => ({
    id: c.id,
    sub,
    prompt,
    answer,
    card: c,
  });

  it('sv→da and dictation grade via matchTyped (accepted forms, ä→æ fold, edge punct)', () => {
    for (const sub of ['sv-da', 'da-dictation'] as const) {
      const item = itemFor(sub, laese, 'läsa', 'læse');
      const m = SUB_CONFIGS[sub].matches;
      expect(m('læse', item)).toBe(true);
      expect(m('läse.', item)).toBe(true); // Swedish-keyboard fold + edge punct
      expect(m('læser', item)).toBe(true); // accepted form
      expect(m('lase', item)).toBe(false); // plain a is a real mistake
      expect(m('', item)).toBe(false);
    }
  });

  it('da→sv accepts any acceptedSwedish() member, normalized', () => {
    const c = card('hoppe', { swedish: 'hoppa (även: brista, sprängas)' });
    const item = itemFor('da-sv', c, 'hoppe', c.swedish);
    const m = SUB_CONFIGS['da-sv'].matches;
    expect(m('hoppa', item)).toBe(true);
    expect(m('  Brista! ', item)).toBe(true);
    expect(m('sprängas', item)).toBe(true);
    expect(m('springa', item)).toBe(false);
    expect(m('   ', item)).toBe(false);
  });

  it('every word sub also accepts the FULL displayed answer verbatim', () => {
    // Regression: the miss panel shows item.answer — retyping the shown string
    // must never be rejected (it was, for multi-variant danish fields and
    // glosses with '/'/parentheticals).
    const multi = card('midlertidig', {
      danish: 'midlertidig / midlertidigt',
      swedish: 'temporär / temporärt',
      audio: 'audio/x.mp3',
    });
    for (const sub of ['sv-da', 'da-dictation'] as const) {
      const item = itemFor(sub, multi, 'temporär', multi.danish);
      expect(SUB_CONFIGS[sub].matches('midlertidig / midlertidigt', item)).toBe(true);
      expect(SUB_CONFIGS[sub].matches('midlertidigt', item)).toBe(true); // variants still work
    }
    const gloss = card('hoppe', { swedish: 'hoppa (även: brista, sprängas)' });
    const daSv = SUB_CONFIGS['da-sv'].matches;
    expect(daSv('hoppa (även: brista, sprängas)', itemFor('da-sv', gloss, 'hoppe', gloss.swedish))).toBe(true);
    // …but the old garbage fragments stay rejected.
    const skifte = card('skifte', { swedish: 'byta (tåg/buss)' });
    const slash = itemFor('da-sv', skifte, 'skifte', skifte.swedish);
    expect(daSv('byta', slash)).toBe(true);
    expect(daSv('byta (tåg/buss)', slash)).toBe(true); // the displayed gloss
    expect(daSv('byta (tåg', slash)).toBe(false);
    expect(daSv('buss)', slash)).toBe(false);
  });

  it('sentence subs grade leniently via sentenceVerdict (near counts as a match)', () => {
    const c = card('blid', { exampleDa: 'Hun har en blid stemme.', exampleSv: 'Hon har en mild röst.' });
    const item = itemFor('sent-sv-da', c, c.exampleSv as string, c.exampleDa as string);
    const cfg = SUB_CONFIGS['sent-sv-da'];
    expect(cfg.matches('hun har en blid stemme', item)).toBe(true);
    expect(cfg.matches('Hun har en blid stemma', item)).toBe(true); // near
    expect(cfg.verdict?.('Hun har en blid stemma', item)).toBe('near');
    expect(cfg.matches('Han købte en bil', item)).toBe(false);
    expect(cfg.verdict?.('Han købte en bil', item)).toBe('wrong');
  });

  it('number dictation compares normalized digits', () => {
    const item: DrillItem = {
      id: 'num:1994',
      sub: 'number',
      prompt: 'nitten hundrede og fireoghalvfems',
      answer: '1994',
      audio: { kind: 'number', tokens: ['nitten', 'hundrede', 'og', 'fireoghalvfems'] },
    };
    const m = SUB_CONFIGS.number.matches;
    expect(m('1994', item)).toBe(true);
    expect(m('1 994', item)).toBe(true); // Swedish thousands space stripped
    expect(m('1995', item)).toBe(false);
    expect(m('', item)).toBe(false);
  });
});

describe('SRS mapping (plan §3.1 table)', () => {
  it('maps each word sub onto its existing flashcard direction', () => {
    expect(SUB_CONFIGS['sv-da'].srs?.direction).toBe('produce');
    expect(SUB_CONFIGS['da-dictation'].srs?.direction).toBe('listen');
    expect(SUB_CONFIGS['da-sv'].srs?.direction).toBe('recognize');
  });

  it('grades Good on correct, Again on wrong AND hint', () => {
    const grade = SUB_CONFIGS['sv-da'].srs?.gradeFor;
    expect(grade?.('correct')).toBe(Rating.Good);
    expect(grade?.('wrong')).toBe(Rating.Again);
    expect(grade?.('hint')).toBe(Rating.Again);
  });

  it('numbers are ungraded in v1', () => {
    expect(SUB_CONFIGS.number.srs).toBeNull();
  });

  it('session registry keys match config ids; subConfigOf resolves by item.sub', () => {
    for (const [key, config] of Object.entries(DRILL_SESSIONS)) {
      expect(config.id).toBe(key);
    }
    const item: DrillItem = { id: 'x', sub: 'da-sv', prompt: 'p', answer: 'a' };
    expect(subConfigOf(item)).toBe(SUB_CONFIGS['da-sv']);
  });
});

describe('availableCount', () => {
  it('reports the true due count for the due source', () => {
    const cards = [card('c1'), card('c2'), card('c3')];
    const srs = srsView({
      'c1::produce': rec(daysAgo(1)),
      'c2::recognize': rec(daysAgo(2)),
    });
    const { size: _s, ...rest } = deps(cards, { srs, match: { kind: 'all' } });
    expect(availableCount(DRILL_SESSIONS.translate, rest)).toBe(2);
  });

  it('respects the dictation clip filter and the daily new-card budget', () => {
    const cards = [card('a1', { audio: 'x.mp3' }), card('a2')];
    const { size: _s, ...rest } = deps(cards);
    expect(availableCount(DRILL_SESSIONS.listen, rest)).toBe(1); // a2 clip-less
    const { size: _s2, ...budget } = deps([card('f1'), card('f2')], { srs: srsView({}, 9) });
    expect(availableCount(DRILL_SESSIONS.translate, budget)).toBe(1); // 10 − 9
  });

  it('counts sentence eligibility (examples, clip for listening)', () => {
    const cards = [
      card('e1', { exampleDa: 'Da.', exampleSv: 'Sv.', audioExample: 'x.mp3' }),
      card('e2', { exampleDa: 'Da.', exampleSv: 'Sv.' }),
      card('e3'),
    ];
    const { size: _s, ...rest } = deps(cards);
    expect(availableCount(DRILL_SESSIONS['translate-sent'], rest)).toBe(2);
    expect(availableCount(DRILL_SESSIONS['listen-sent'], rest)).toBe(1);
  });

  it('throws for the number mode (unbounded generator — a programming error)', () => {
    const { size: _s, ...rest } = deps([], { match: null, numberLevel: '0-20' });
    expect(() => availableCount(DRILL_SESSIONS['number-dictation'], rest)).toThrow(/number/);
  });
});

describe('number buildItems', () => {
  /** Manifest fixture with every atom the level needs marked present. */
  const manifestFor = (level: Parameters<typeof atomsForLevel>[0]): NumberAudioManifest => ({
    atoms: Object.fromEntries(
      atomsForLevel(level).map((w) => [w, { id: `id-${w}`, file: `${w}.mp3`, present: true }]),
    ),
  });

  const numberDeps = (over: Partial<DrillBuildDeps>): DrillBuildDeps =>
    deps([], { match: null, numberLevel: '0-20', ...over });

  it('generates deterministic, SRS-less items from the level generator', () => {
    // 0–20 draws floor(r·21): 0 → 0, 0.5 → 10, 0.999999 → 20.
    const out = DRILL_SESSIONS['number-dictation'].buildItems(
      numberDeps({ rng: seqRng([0, 0.5, 0.999999]), size: 3, manifest: manifestFor('0-20') }),
    );
    expect(out).toEqual([
      { id: 'num:0', sub: 'number', prompt: 'nul', answer: '0', audio: { kind: 'number', tokens: ['nul'] } },
      { id: 'num:10', sub: 'number', prompt: 'ti', answer: '10', audio: { kind: 'number', tokens: ['ti'] } },
      { id: 'num:20', sub: 'number', prompt: 'tyve', answer: '20', audio: { kind: 'number', tokens: ['tyve'] } },
    ]);
    expect(out[0]?.sourceCardId).toBeUndefined(); // not SRS-backed
  });

  it('dedupes repeated values instead of colliding ids (bounded attempts)', () => {
    const out = DRILL_SESSIONS['number-dictation'].buildItems(
      numberDeps({ rng: noShuffle, size: 5 }), // every draw yields 20
    );
    expect(ids(out)).toEqual(['num:20']);
  });

  it('yields nothing when the manifest says the level is unplayable', () => {
    const m = manifestFor('0-20');
    const nul = m.atoms['nul'];
    if (nul) nul.present = false;
    const out = DRILL_SESSIONS['number-dictation'].buildItems(
      numberDeps({ rng: seqRng([0, 0.5]), size: 2, manifest: m }),
    );
    expect(out).toEqual([]);
  });

  it('builds without a manifest (the UI gates availability separately)', () => {
    const out = DRILL_SESSIONS['number-dictation'].buildItems(
      numberDeps({ rng: seqRng([0.5]), size: 1 }),
    );
    expect(ids(out)).toEqual(['num:10']);
  });

  it('yields nothing without a numberLevel', () => {
    const out = DRILL_SESSIONS['number-dictation'].buildItems(deps([], { match: null }));
    expect(out).toEqual([]);
  });
});

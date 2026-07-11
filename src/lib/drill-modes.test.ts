import { describe, it, expect } from 'vitest';
import {
  DRILL_MODES,
  acceptedSwedish,
  type DrillBuildDeps,
  type DrillItem,
  type DrillModeId,
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
    // ['byta (tåg', 'buss)'] — soft-locking the corrective phase (31 committed
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

describe('word buildItems: buildQueue delegation', () => {
  it('the due-all source is due-only, most-overdue-first (fresh cards excluded)', () => {
    const cards = [card('c1'), card('c2'), card('c3')];
    const srs = srsView({
      'c1::produce': rec(daysAgo(1)),
      'c3::produce': rec(daysAgo(3)),
      // c2 fresh — must not enter despite the new-card budget.
    });
    const out = DRILL_MODES['sv-da'].buildItems(deps(cards, { srs, match: { kind: 'all' } }));
    expect(ids(out)).toEqual(['c3', 'c1']);
  });

  it('a lesson tag restores normal scheduling: due + budgeted new cards', () => {
    const cards = [card('t1', { tags: ['mad'] }), card('t2', { tags: ['mad'] }), card('x1')];
    const srs = srsView({ 't2::produce': rec(daysAgo(1)) });
    const out = DRILL_MODES['sv-da'].buildItems(deps(cards, { srs, tag: 'mad', match: null }));
    expect(ids(out)).toEqual(['t2', 't1']); // due first, then fresh; x1 untagged
  });

  it('respects the shared daily new-card budget via the injected SrsView', () => {
    const cards = ['f1', 'f2', 'f3'].map((id) => card(id));
    const out = DRILL_MODES['sv-da'].buildItems(
      deps(cards, { srs: srsView({}, 9), limits: { newPerDay: 10, reviewPerDay: 200 } }),
    );
    expect(out).toHaveLength(1); // 10 − 9 already introduced today
  });

  it('slices the assembled queue to the session size', () => {
    const cards = ['f1', 'f2', 'f3', 'f4', 'f5'].map((id) => card(id));
    const out = DRILL_MODES['sv-da'].buildItems(deps(cards, { size: 3 }));
    expect(out).toHaveLength(3);
  });

  it('each word mode reads its own direction records', () => {
    const cards = [card('c1')];
    const srs = srsView({ 'c1::produce': rec(daysAgo(1)) });
    const d = deps(cards, { srs, match: { kind: 'all' } });
    expect(DRILL_MODES['sv-da'].buildItems(d)).toHaveLength(1);
    expect(DRILL_MODES['da-sv'].buildItems(d)).toHaveLength(0); // no ::recognize record
  });

  it('dictation filters clip-less cards BEFORE building (their due records never count)', () => {
    const cards = [card('a1', { audio: 'audio/da-a1.mp3' }), card('a2')];
    const srs = srsView({
      'a1::listen': rec(daysAgo(1)),
      'a2::listen': rec(daysAgo(5)), // more overdue, but no clip
    });
    const out = DRILL_MODES['da-dictation'].buildItems(
      deps(cards, { srs, match: { kind: 'all' } }),
    );
    expect(ids(out)).toEqual(['a1']);
  });
});

describe('word buildItems: item shapes', () => {
  const hoppe = card('hoppe', {
    danish: 'hoppe',
    swedish: 'hoppa',
    audio: 'audio/da-hoppe.mp3',
  });

  it('sv→da prompts the Swedish gloss and answers the Danish word', () => {
    const [item] = DRILL_MODES['sv-da'].buildItems(deps([hoppe]));
    expect(item).toMatchObject({
      id: 'hoppe',
      prompt: 'hoppa',
      answer: 'hoppe',
      sourceCardId: 'hoppe',
      audio: { kind: 'clip', text: 'hoppe', url: 'audio/da-hoppe.mp3' },
    });
    expect(item?.card).toBe(hoppe); // glossary panel gets the full card
  });

  it('dictation prompts AND answers the Danish word (audio-only prompt)', () => {
    const [item] = DRILL_MODES['da-dictation'].buildItems(deps([hoppe]));
    expect(item).toMatchObject({ prompt: 'hoppe', answer: 'hoppe' });
  });

  it('da→sv prompts the Danish word and answers the Swedish gloss', () => {
    const [item] = DRILL_MODES['da-sv'].buildItems(deps([hoppe]));
    expect(item).toMatchObject({ prompt: 'hoppe', answer: 'hoppa' });
  });

  it('omits the clip url (not the audio) for clip-less cards', () => {
    const [item] = DRILL_MODES['sv-da'].buildItems(deps([card('bare')]));
    expect(item?.audio).toStrictEqual({ kind: 'clip', text: 'bare' }); // no url key at all
  });
});

describe('per-mode matches()', () => {
  const laese = card('læse', { danish: 'læse', accepted: ['læser'] });
  const toItem = (mode: DrillModeId, c: Card): DrillItem => {
    const item = DRILL_MODES[mode].buildItems(deps([c]))[0];
    if (!item) throw new Error('no item built');
    return item;
  };

  it('sv→da and dictation grade via matchTyped (accepted forms, ä→æ fold, edge punct)', () => {
    for (const mode of ['sv-da', 'da-dictation'] as const) {
      const item = toItem(mode, mode === 'da-dictation' ? { ...laese, audio: 'audio/x.mp3' } : laese);
      const m = DRILL_MODES[mode].matches;
      expect(m('læse', item)).toBe(true);
      expect(m('läse.', item)).toBe(true); // Swedish-keyboard fold + edge punct
      expect(m('læser', item)).toBe(true); // accepted form
      expect(m('lase', item)).toBe(false); // plain a is a real mistake
      expect(m('', item)).toBe(false);
    }
  });

  it('da→sv accepts any acceptedSwedish() member, normalized', () => {
    const c = card('hoppe', { swedish: 'hoppa (även: brista, sprängas)' });
    const item = toItem('da-sv', c);
    const m = DRILL_MODES['da-sv'].matches;
    expect(m('hoppa', item)).toBe(true);
    expect(m('  Brista! ', item)).toBe(true);
    expect(m('sprängas', item)).toBe(true);
    expect(m('springa', item)).toBe(false);
    expect(m('   ', item)).toBe(false);
  });

  it('every word mode also accepts the FULL displayed answer verbatim', () => {
    // Regression: the corrective phase shows item.answer and gates advancing
    // on matches() — retyping the shown string must never be rejected (it was,
    // for multi-variant danish fields and glosses with '/'/parentheticals).
    const multi = card('midlertidig', {
      danish: 'midlertidig / midlertidigt',
      swedish: 'temporär / temporärt',
      audio: 'audio/x.mp3',
    });
    for (const mode of ['sv-da', 'da-dictation'] as const) {
      const item = toItem(mode, multi);
      expect(DRILL_MODES[mode].matches('midlertidig / midlertidigt', item)).toBe(true);
      expect(DRILL_MODES[mode].matches('midlertidigt', item)).toBe(true); // variants still work
    }
    const gloss = card('hoppe', { swedish: 'hoppa (även: brista, sprängas)' });
    const daSv = DRILL_MODES['da-sv'].matches;
    expect(daSv('hoppa (även: brista, sprängas)', toItem('da-sv', gloss))).toBe(true);
    // …but the old garbage fragments stay rejected.
    const slash = toItem('da-sv', card('skifte', { swedish: 'byta (tåg/buss)' }));
    expect(daSv('byta', slash)).toBe(true);
    expect(daSv('byta (tåg/buss)', slash)).toBe(true); // the displayed gloss
    expect(daSv('byta (tåg', slash)).toBe(false);
    expect(daSv('buss)', slash)).toBe(false);
  });

  it('number dictation compares normalized digits', () => {
    const item: DrillItem = {
      id: 'num:1994',
      prompt: 'nitten hundrede og fireoghalvfems',
      answer: '1994',
      audio: { kind: 'number', tokens: ['nitten', 'hundrede', 'og', 'fireoghalvfems'] },
    };
    const m = DRILL_MODES['number-dictation'].matches;
    expect(m('1994', item)).toBe(true);
    expect(m('1 994', item)).toBe(true); // Swedish thousands space stripped
    expect(m('1995', item)).toBe(false);
    expect(m('', item)).toBe(false);
  });
});

describe('audioFor', () => {
  it('returns the item audio, or null when a hand-built item has none', () => {
    const c = card('hoppe', { audio: 'audio/da-hoppe.mp3' });
    const [item] = DRILL_MODES['sv-da'].buildItems(deps([c]));
    expect(item && DRILL_MODES['sv-da'].audioFor(item)).toEqual({
      kind: 'clip',
      text: 'hoppe',
      url: 'audio/da-hoppe.mp3',
    });
    const bare: DrillItem = { id: 'x', prompt: 'p', answer: 'a' };
    expect(DRILL_MODES['sv-da'].audioFor(bare)).toBeNull();
  });
});

describe('SRS mapping (plan §3.1 table)', () => {
  it('maps each word mode onto its existing flashcard direction', () => {
    expect(DRILL_MODES['sv-da'].srs?.direction).toBe('produce');
    expect(DRILL_MODES['da-dictation'].srs?.direction).toBe('listen');
    expect(DRILL_MODES['da-sv'].srs?.direction).toBe('recognize');
  });

  it('grades Good on correct, Again on wrong AND hint', () => {
    const grade = DRILL_MODES['sv-da'].srs?.gradeFor;
    expect(grade?.('correct')).toBe(Rating.Good);
    expect(grade?.('wrong')).toBe(Rating.Again);
    expect(grade?.('hint')).toBe(Rating.Again);
  });

  it('numbers are ungraded in v1', () => {
    expect(DRILL_MODES['number-dictation'].srs).toBeNull();
  });

  it('registry keys match config ids', () => {
    for (const [key, config] of Object.entries(DRILL_MODES)) {
      expect(config.id).toBe(key);
    }
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
    const out = DRILL_MODES['number-dictation'].buildItems(
      numberDeps({ rng: seqRng([0, 0.5, 0.999999]), size: 3, manifest: manifestFor('0-20') }),
    );
    expect(out).toEqual([
      { id: 'num:0', prompt: 'nul', answer: '0', audio: { kind: 'number', tokens: ['nul'] } },
      { id: 'num:10', prompt: 'ti', answer: '10', audio: { kind: 'number', tokens: ['ti'] } },
      { id: 'num:20', prompt: 'tyve', answer: '20', audio: { kind: 'number', tokens: ['tyve'] } },
    ]);
    expect(out[0]?.sourceCardId).toBeUndefined(); // not SRS-backed
  });

  it('dedupes repeated values instead of colliding ids (bounded attempts)', () => {
    const out = DRILL_MODES['number-dictation'].buildItems(
      numberDeps({ rng: noShuffle, size: 5 }), // every draw yields 20
    );
    expect(ids(out)).toEqual(['num:20']);
  });

  it('yields nothing when the manifest says the level is unplayable', () => {
    const m = manifestFor('0-20');
    const nul = m.atoms['nul'];
    if (nul) nul.present = false;
    const out = DRILL_MODES['number-dictation'].buildItems(
      numberDeps({ rng: seqRng([0, 0.5]), size: 2, manifest: m }),
    );
    expect(out).toEqual([]);
  });

  it('builds without a manifest (the UI gates availability separately)', () => {
    const out = DRILL_MODES['number-dictation'].buildItems(
      numberDeps({ rng: seqRng([0.5]), size: 1 }),
    );
    expect(ids(out)).toEqual(['num:10']);
  });

  it('yields nothing without a numberLevel', () => {
    const out = DRILL_MODES['number-dictation'].buildItems(deps([], { match: null }));
    expect(out).toEqual([]);
  });
});

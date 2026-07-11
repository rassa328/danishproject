import { describe, it, expect } from 'vitest';
import { Store, memoryKV, DEFAULT_SETTINGS, DIRECTIONS, MIGRATIONS, type KV } from './storage.ts';
import { Rating } from './srs.ts';
import type { Card } from './vocab.ts';

const T0 = new Date('2026-06-20T08:00:00Z');
const card = (id: string, deck = 'd1'): Card => ({
  id,
  danish: 'x',
  swedish: 'y',
  pos: 'other',
  deck,
  cefr: 'b1',
  tags: [],
  accepted: [],
});

describe('Store: settings + grading', () => {
  it('returns defaults then persists across instances', () => {
    const kv = memoryKV();
    expect(new Store(kv).getSettings()).toEqual(DEFAULT_SETTINGS);
    new Store(kv).setSettings({ newPerDay: 20 });
    expect(new Store(kv).getSettings().newPerDay).toBe(20);
  });

  it('grade creates a record and persists it (write-through)', () => {
    const kv = memoryKV();
    const s = new Store(kv);
    expect(s.getRecord('v1', 'produce')).toBeNull();
    const { record, result } = s.grade('v1', 'produce', Rating.Good, T0);
    expect(result.ok).toBe(true);
    expect(record.reps).toBe(1);
    expect(new Store(kv).getRecord('v1', 'produce')?.reps).toBe(1);
  });

  it('grades speak independently from produce (per-direction SRS)', () => {
    const kv = memoryKV();
    const s = new Store(kv);
    s.grade('v1', 'produce', Rating.Good, T0);
    expect(s.getRecord('v1', 'speak')).toBeNull();
    s.grade('v1', 'speak', Rating.Easy, T0);
    expect(s.getRecord('v1', 'speak')?.reps).toBe(1);
    expect(s.getRecord('v1', 'produce')?.reps).toBe(1); // untouched
  });

  it('dueCount only counts records that are due and not suspended', () => {
    const kv = memoryKV();
    const s = new Store(kv);
    s.grade('v1', 'produce', Rating.Again, T0); // due ~+1min
    expect(s.dueCount(T0)).toBe(0);
    expect(s.dueCount(new Date(T0.getTime() + 5 * 60_000))).toBe(1);
  });

  // Local-date construction (new Date(y, m, d, h)) so the streak's local-day
  // logic is TZ-independent in CI.
  const day = (y: number, m: number, d: number, h = 8) => new Date(y, m, d, h);

  it('streak: starts at 1, increments on consecutive days, no double-count same day', () => {
    const kv = memoryKV();
    const s = new Store(kv);
    s.grade('v1', 'produce', Rating.Good, day(2026, 5, 20, 8));
    expect(s.getStreak(day(2026, 5, 20, 20))).toBe(1);
    s.grade('v1', 'produce', Rating.Good, day(2026, 5, 21, 8));
    expect(s.getStreak(day(2026, 5, 21, 9))).toBe(2);
    s.grade('v2', 'produce', Rating.Good, day(2026, 5, 21, 18)); // same local day
    expect(s.getStreak(day(2026, 5, 21, 19))).toBe(2);
  });

  it('streak: a 2+ day gap resets to 1, and reads as broken when stale', () => {
    const kv = memoryKV();
    const s = new Store(kv);
    s.grade('v1', 'produce', Rating.Good, day(2026, 5, 20));
    expect(s.getStreak(day(2026, 5, 25))).toBe(0); // stale -> broken
    s.grade('v1', 'produce', Rating.Good, day(2026, 5, 24)); // gap from last
    expect(s.getStreak(day(2026, 5, 24, 9))).toBe(1);
  });

  it('newCardsToday counts first introductions per local day, shared across directions', () => {
    const kv = memoryKV();
    const s = new Store(kv);
    expect(s.newCardsToday(day(2026, 5, 21))).toBe(0);
    s.grade('v1', 'produce', Rating.Good, day(2026, 5, 21, 9)); // new -> 1
    s.grade('v1', 'produce', Rating.Good, day(2026, 5, 21, 10)); // same record, not new -> 1
    s.grade('v1', 'speak', Rating.Good, day(2026, 5, 21, 11)); // new (other direction) -> 2
    s.grade('v2', 'produce', Rating.Again, day(2026, 5, 21, 12)); // new -> 3
    expect(s.newCardsToday(day(2026, 5, 21, 13))).toBe(3);
    expect(s.newCardsToday(day(2026, 5, 22, 8))).toBe(0); // next day resets
  });

  it('DIRECTIONS lists all six review directions incl. listen-sentence', () => {
    expect(DIRECTIONS).toContain('listen-sentence');
    expect(DIRECTIONS.length).toBe(6);
  });

  it('selectedGroupId persists, and older blobs without it read as "" (unset)', () => {
    const kv = memoryKV();
    new Store(kv).setSettings({ selectedGroupId: 'due-all' });
    expect(new Store(kv).getSettings().selectedGroupId).toBe('due-all');
    // A pre-existing blob saved before the field existed:
    const old = memoryKV();
    old.setItem(
      'dansk4svensk:srs:v1',
      JSON.stringify({ schemaVersion: 1, srs: {}, settings: { newPerDay: 5 } }),
    );
    const s = new Store(old).getSettings();
    expect(s.selectedGroupId).toBe('');
    expect(s.newPerDay).toBe(5); // rest of the settings untouched
  });
});

describe('Store: leech suspension lifecycle', () => {
  // leechThreshold 0 makes the FIRST Again grade suspend — no need to simulate
  // eight real lapses.
  const suspend = (s: Store, id: string, dir: 'produce' | 'listen' = 'produce') => {
    s.setSettings({ leechThreshold: 0 });
    s.grade(id, dir, Rating.Again, T0);
  };

  it('suspends + flags at the threshold, and Good RESUMES the card (leech kept)', () => {
    const kv = memoryKV();
    const s = new Store(kv);
    suspend(s, 'v1');
    expect(s.getRecord('v1', 'produce')?.suspended).toBe(true);
    expect(s.getRecord('v1', 'produce')?.leech).toBe(true);
    s.grade('v1', 'produce', Rating.Good, new Date(T0.getTime() + 60_000));
    const rec = new Store(kv).getRecord('v1', 'produce'); // persisted, not just in-memory
    expect(rec?.suspended).toBeUndefined();
    expect(rec?.leech).toBe(true); // history stays
  });

  it('Easy also resumes; Hard and Again do NOT', () => {
    const s = new Store(memoryKV());
    suspend(s, 'v1');
    s.grade('v1', 'produce', Rating.Hard, T0);
    expect(s.getRecord('v1', 'produce')?.suspended).toBe(true);
    s.grade('v1', 'produce', Rating.Easy, T0);
    expect(s.getRecord('v1', 'produce')?.suspended).toBeUndefined();

    const s2 = new Store(memoryKV());
    suspend(s2, 'v2');
    s2.setSettings({ leechThreshold: 99 }); // an Again must not resume either
    s2.grade('v2', 'produce', Rating.Again, T0);
    expect(s2.getRecord('v2', 'produce')?.suspended).toBe(true);
  });

  it('suspendedCount counts distinct WORDS; resumeAllSuspended lifts every suspension', () => {
    const kv = memoryKV();
    const s = new Store(kv);
    suspend(s, 'v1', 'produce');
    suspend(s, 'v1', 'listen'); // same word, second direction — still 1 word
    suspend(s, 'v2', 'produce');
    expect(s.suspendedCount()).toBe(2);
    expect(s.resumeAllSuspended().ok).toBe(true);
    expect(s.suspendedCount()).toBe(0);
    const rec = new Store(kv).getRecord('v1', 'listen');
    expect(rec?.suspended).toBeUndefined();
    expect(rec?.leech).toBe(true); // resume-all also keeps history
  });
});

describe('Store: resilience', () => {
  it('corrupt JSON falls back to defaults without throwing, stashing a pre-reset copy', () => {
    const kv = memoryKV();
    kv.setItem('dansk4svensk:srs:v1', '{not json');
    expect(() => new Store(kv).getSettings()).not.toThrow();
    expect(new Store(kv).getSettings()).toEqual(DEFAULT_SETTINGS);
    // The unreadable blob is preserved for manual recovery, never just erased.
    expect(kv.getItem('dansk4svensk:srs:v1:pre-reset')).toBe('{not json');
  });

  it('an older schemaVersion with NO registered migration resets cleanly + stashes', () => {
    const kv = memoryKV();
    const old = JSON.stringify({ schemaVersion: 0, settings: { newPerDay: 999 } });
    kv.setItem('dansk4svensk:srs:v1', old);
    expect(new Store(kv).getSettings()).toEqual(DEFAULT_SETTINGS);
    expect(kv.getItem('dansk4svensk:srs:v1:pre-reset')).toBe(old);
  });

  it('an older blob with a registered migration is preserved and upgraded, not wiped', () => {
    const kv = memoryKV();
    const rec = {
      due: '2026-06-21T08:00:00.000Z',
      stability: 3,
      difficulty: 5,
      elapsed_days: 0,
      scheduled_days: 1,
      learning_steps: 0,
      reps: 4,
      lapses: 0,
      state: 2,
      last_review: '2026-06-20T08:00:00.000Z',
    };
    // Synthetic v(N-1) shape: records lived under `cards` instead of `srs`.
    kv.setItem(
      'dansk4svensk:srs:v1',
      JSON.stringify({
        schemaVersion: 0,
        cards: { 'v1::produce': rec },
        settings: { newPerDay: 42 },
      }),
    );
    MIGRATIONS[0] = (old) => {
      const o = old as Record<string, unknown>;
      return { ...o, srs: o['cards'] ?? {} };
    };
    try {
      const s = new Store(kv);
      expect(s.getRecord('v1', 'produce')?.reps).toBe(4); // review history preserved
      expect(s.getSettings().newPerDay).toBe(42); // settings preserved
      // Upgraded blob is stamped current; no reset (and thus no stash) happened.
      expect(JSON.parse(s.exportBackup()).srs.schemaVersion).toBe(1);
      expect(kv.getItem('dansk4svensk:srs:v1:pre-reset')).toBeNull();
    } finally {
      delete MIGRATIONS[0];
    }
  });

  it('getSettings heals a null-poisoned numeric setting back to its default', () => {
    const kv = memoryKV();
    kv.setItem(
      'dansk4svensk:srs:v1',
      JSON.stringify({ schemaVersion: 1, srs: {}, settings: { newPerDay: null, reviewPerDay: null } }),
    );
    const s = new Store(kv).getSettings();
    expect(s.newPerDay).toBe(DEFAULT_SETTINGS.newPerDay);
    expect(s.reviewPerDay).toBe(DEFAULT_SETTINGS.reviewPerDay);
  });

  it('getInputLog backfills ids on legacy entries (unique keys; remove targets one)', () => {
    const kv = memoryKV();
    kv.setItem(
      'dansk4svensk:srs:v1',
      JSON.stringify({
        schemaVersion: 1,
        srs: {},
        settings: {},
        inputLog: [
          { at: 1, source: 'tv', note: 'a' },
          { at: 2, source: 'tv', note: 'b' },
        ],
      }),
    );
    const s = new Store(kv);
    const log = s.getInputLog();
    expect(log.every((e) => !!e.id)).toBe(true);
    expect(new Set(log.map((e) => e.id)).size).toBe(2);
    s.removeInputEntry(log[0]!.id);
    expect(s.getInputLog().map((e) => e.note)).toEqual(['b']); // only one removed
  });

  it('QuotaExceededError surfaces via WriteResult, never throws', () => {
    const kv: KV = {
      getItem: () => null,
      setItem: () => {
        const e = new Error('quota');
        e.name = 'QuotaExceededError';
        throw e;
      },
      removeItem: () => {},
    };
    const { result } = new Store(kv).grade('v1', 'produce', Rating.Good, T0);
    expect(result.ok).toBe(false);
    expect(result.quotaExceeded).toBe(true);
  });
});

describe('Store: non-destructive deck merge (the data-integrity contract)', () => {
  it('re-import updates content but leaves SRS state untouched', () => {
    const kv = memoryKV();
    const s = new Store(kv);
    s.mergeDeck('mine', [card('a'), card('b')]);
    const graded = s.grade('a', 'produce', Rating.Good, T0).record;

    const edited: Card = { ...card('a'), swedish: 'EDITED' };
    const res = s.mergeDeck('mine', [edited, card('b'), card('c')]);

    expect(res.added).toBe(1); // c
    expect(res.updated).toBe(2); // a, b
    expect(s.getImportedDeck('mine').find((c) => c.id === 'a')?.swedish).toBe('EDITED');
    expect(s.getRecord('a', 'produce')).toEqual(graded); // SRS preserved
  });

  it('prune=false keeps orphaned cards; their SRS survives', () => {
    const kv = memoryKV();
    const s = new Store(kv);
    s.mergeDeck('mine', [card('a'), card('b')]);
    s.grade('a', 'produce', Rating.Good, T0);
    s.mergeDeck('mine', [card('b')], false); // 'a' missing, no prune
    expect(s.getImportedDeck('mine').some((c) => c.id === 'a')).toBe(true);
    expect(s.getRecord('a', 'produce')).not.toBeNull();
  });

  it('startedCount counts distinct vocab ids across directions', () => {
    const kv = memoryKV();
    const s = new Store(kv);
    expect(s.startedCount()).toBe(0);
    s.grade('v1', 'produce', Rating.Good, T0);
    s.grade('v1', 'listen', Rating.Good, T0); // same card, other direction
    s.grade('v2', 'produce', Rating.Again, T0);
    expect(s.startedCount()).toBe(2);
  });

  it('missions + input log: persist, prepend, cap-remove, tolerate old data', () => {
    const kv = memoryKV();
    const s = new Store(kv);
    // missions
    expect(s.isMissionDone('2026-06-21')).toBe(false);
    s.setMissionDone('2026-06-21');
    expect(new Store(kv).isMissionDone('2026-06-21')).toBe(true);
    s.setMissionDone('2026-06-21', false);
    expect(s.isMissionDone('2026-06-21')).toBe(false);
    // input log (newest first, persists, remove by id)
    s.addInputEntry({ id: 'x', at: 1, source: 'tv', note: 'a' });
    s.addInputEntry({ id: 'y', at: 2, source: 'podcast', note: 'b' });
    expect(s.getInputLog().map((e) => e.note)).toEqual(['b', 'a']);
    expect(new Store(kv).getInputLog().length).toBe(2);
    s.removeInputEntry('x');
    expect(s.getInputLog().map((e) => e.note)).toEqual(['b']);
  });

  it('Phase 6 accessors tolerate older saved data without the new fields', () => {
    const kv = memoryKV();
    kv.setItem('dansk4svensk:srs:v1', JSON.stringify({ schemaVersion: 1, srs: {}, settings: {} }));
    const s = new Store(kv);
    expect(s.getInputLog()).toEqual([]);
    expect(s.isMissionDone('2026-06-21')).toBe(false);
    expect(() => s.addInputEntry({ id: 'a', at: 1, source: 'tv', note: 'x' })).not.toThrow();
    expect(s.getInputLog().length).toBe(1);
  });

  it('export/import backup round-trips', () => {
    const kv = memoryKV();
    const s = new Store(kv);
    s.grade('v1', 'produce', Rating.Good, T0);
    s.mergeDeck('mine', [card('a')]);
    const blob = s.exportBackup();

    const s2 = new Store(memoryKV());
    expect(s2.importBackup(blob).ok).toBe(true);
    expect(s2.getRecord('v1', 'produce')?.reps).toBe(1);
    expect(s2.getImportedDeck('mine').length).toBe(1);
  });
});

import { describe, it, expect } from 'vitest';
import { Store, memoryKV, DEFAULT_SETTINGS, type KV } from './storage.ts';
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

  it('dueCount only counts records that are due and not suspended', () => {
    const kv = memoryKV();
    const s = new Store(kv);
    s.grade('v1', 'produce', Rating.Again, T0); // due ~+1min
    expect(s.dueCount(T0)).toBe(0);
    expect(s.dueCount(new Date(T0.getTime() + 5 * 60_000))).toBe(1);
  });
});

describe('Store: resilience', () => {
  it('corrupt JSON falls back to defaults without throwing', () => {
    const kv = memoryKV();
    kv.setItem('dansk4svensk:srs:v1', '{not json');
    expect(() => new Store(kv).getSettings()).not.toThrow();
    expect(new Store(kv).getSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it('an older schemaVersion resets cleanly', () => {
    const kv = memoryKV();
    kv.setItem(
      'dansk4svensk:srs:v1',
      JSON.stringify({ schemaVersion: 0, settings: { newPerDay: 999 } }),
    );
    expect(new Store(kv).getSettings()).toEqual(DEFAULT_SETTINGS);
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

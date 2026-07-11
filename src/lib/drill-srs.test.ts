import { describe, it, expect } from 'vitest';
import { gradeForOutcome, recordOutcome, type SrsSink } from './drill-srs.ts';
import { Rating, State, type ReviewGrade } from './srs.ts';
import {
  Store,
  memoryKV,
  type Direction,
  type KV,
  type SrsRecord,
  type WriteResult,
} from './storage.ts';

const T0 = new Date('2026-07-11T08:00:00Z');

// Minimal well-formed record for the fake sink (contents irrelevant to the adapter).
const stubRecord: SrsRecord = {
  due: T0.toISOString(),
  stability: 1,
  difficulty: 5,
  elapsed_days: 0,
  scheduled_days: 0,
  learning_steps: 1,
  reps: 1,
  lapses: 0,
  state: 1,
  last_review: T0.toISOString(),
};

function fakeSink(result: WriteResult = { ok: true }) {
  const calls: { vocabId: string; direction: Direction; grade: ReviewGrade; now: Date }[] = [];
  const sink: SrsSink = {
    grade(vocabId, direction, grade, now) {
      calls.push({ vocabId, direction, grade, now });
      return { record: stubRecord, result };
    },
  };
  return { sink, calls };
}

describe('gradeForOutcome', () => {
  it('correct maps to Good (3)', () => {
    expect(gradeForOutcome('correct')).toBe(Rating.Good);
    expect(gradeForOutcome('correct')).toBe(3);
  });

  it('wrong and hint both map to Again (1)', () => {
    expect(gradeForOutcome('wrong')).toBe(Rating.Again);
    expect(gradeForOutcome('wrong')).toBe(1);
    expect(gradeForOutcome('hint')).toBe(Rating.Again);
    expect(gradeForOutcome('hint')).toBe(1);
  });
});

describe('recordOutcome: forwarding to the sink', () => {
  it('forwards (vocabId, direction, grade, now) verbatim — one write per attempt', () => {
    const { sink, calls } = fakeSink();
    recordOutcome(sink, 'v1', 'produce', 'correct', T0);
    expect(calls).toEqual([{ vocabId: 'v1', direction: 'produce', grade: Rating.Good, now: T0 }]);
    expect(calls[0]?.now).toBe(T0); // same Date instance, not a copy
  });

  it('a hint writes Again for the given direction', () => {
    const { sink, calls } = fakeSink();
    recordOutcome(sink, 'v2', 'listen', 'hint', T0);
    expect(calls).toEqual([{ vocabId: 'v2', direction: 'listen', grade: Rating.Again, now: T0 }]);
  });
});

describe('recordOutcome: WriteResult propagation', () => {
  it('returns the sink write result untouched', () => {
    const ok: WriteResult = { ok: true };
    const { sink } = fakeSink(ok);
    expect(recordOutcome(sink, 'v1', 'produce', 'correct', T0)).toBe(ok);
  });

  it('propagates quotaExceeded failures', () => {
    const { sink } = fakeSink({ ok: false, quotaExceeded: true });
    const r = recordOutcome(sink, 'v1', 'produce', 'wrong', T0);
    expect(r.ok).toBe(false);
    expect(r.quotaExceeded).toBe(true);
  });

  it('surfaces quota errors from a real Store whose backend throws', () => {
    const kv: KV = {
      getItem: () => null,
      setItem: () => {
        const e = new Error('quota');
        e.name = 'QuotaExceededError';
        throw e;
      },
      removeItem: () => {},
    };
    const r = recordOutcome(new Store(kv), 'v1', 'produce', 'correct', T0);
    expect(r.ok).toBe(false);
    expect(r.quotaExceeded).toBe(true);
  });
});

describe('recordOutcome: integration with the real Store', () => {
  it('correct on a fresh card creates + persists the record and leaves New state', () => {
    const kv = memoryKV();
    const store = new Store(kv);
    expect(store.getRecord('v1', 'produce')).toBeNull();
    expect(recordOutcome(store, 'v1', 'produce', 'correct', T0).ok).toBe(true);
    const rec = store.getRecord('v1', 'produce');
    expect(rec?.reps).toBe(1);
    expect(rec?.state).not.toBe(State.New); // Good moves a fresh card out of New
    expect(store.getRecord('v1', 'listen')).toBeNull(); // per-direction record, as flashcards read it
    expect(new Store(kv).getRecord('v1', 'produce')?.reps).toBe(1); // write-through
  });

  it('wrong reaches the store as Again: near-term due + lapse/leech path', () => {
    const store = new Store(memoryKV());
    // leechThreshold 0 => the FIRST Again suspends — proves Again (not Good) was written.
    store.setSettings({ leechThreshold: 0 });
    expect(recordOutcome(store, 'v1', 'produce', 'wrong', T0).ok).toBe(true);
    const rec = store.getRecord('v1', 'produce');
    expect(rec?.suspended).toBe(true);
    expect(rec?.leech).toBe(true);
    // Again on a fresh card = short-term relearning step, due within minutes.
    expect(new Date(rec!.due).getTime() - T0.getTime()).toBeLessThanOrEqual(5 * 60_000);
  });

  it('hint takes the same Again path as wrong', () => {
    const store = new Store(memoryKV());
    store.setSettings({ leechThreshold: 0 });
    recordOutcome(store, 'v1', 'listen', 'hint', T0);
    expect(store.getRecord('v1', 'listen')?.suspended).toBe(true);
  });

  it('correct never trips the leech path, even at threshold 0', () => {
    const store = new Store(memoryKV());
    store.setSettings({ leechThreshold: 0 });
    recordOutcome(store, 'v1', 'recognize', 'correct', T0);
    const rec = store.getRecord('v1', 'recognize');
    expect(rec?.suspended).toBeUndefined();
    expect(rec?.leech).toBeUndefined();
  });
});

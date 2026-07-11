import { describe, it, expect } from 'vitest';
import {
  DRILL_MAX_REQUEUES,
  advance,
  createDrill,
  extendQueue,
  isBlankAttempt,
  outcomeOf,
  reveal,
  submit,
  type DrillState,
} from './drill-engine.ts';
import type { DrillItem } from './drill-modes.ts';

const T0 = 1_750_000_000_000; // injected clock (ms epoch)

const item = (id: string): DrillItem => ({
  id,
  sub: 'sv-da',
  prompt: `sv-${id}`,
  answer: `da-${id}`,
});
const items = (n: number): DrillItem[] => Array.from({ length: n }, (_, i) => item(`i${i}`));
const drill = (n = 3, size?: number): DrillState =>
  createDrill(items(n), size === undefined ? { now: T0 } : { now: T0, size });

const queueIds = (s: DrillState): string[] => s.queue.map((i) => i.id);

/** Frozen inputs make any accidental mutation throw (strict-mode modules). */
const deepFreeze = <T>(v: T): T => {
  if (v !== null && typeof v === 'object' && !Object.isFrozen(v)) {
    Object.freeze(v);
    for (const k of Object.getOwnPropertyNames(v)) {
      deepFreeze((v as Record<string, unknown>)[k]);
    }
  }
  return v;
};

describe('createDrill', () => {
  it('slices to the default session size of 20', () => {
    const s = createDrill(items(25), { now: T0 });
    expect(s.queue).toHaveLength(20);
    expect(s.idx).toBe(0);
    expect(s.phase).toBe('answering');
    expect(s.startedAt).toBe(T0);
  });

  it('honors an explicit size and never pads a short item list', () => {
    expect(drill(25, 5).queue).toHaveLength(5);
    expect(drill(3, 40).queue).toHaveLength(3);
  });

  it('an empty item list is immediately done', () => {
    const s = createDrill([], { now: T0 });
    expect(s.phase).toBe('done');
    expect(s.answered).toBe(0);
  });

  it('copies the item list — later caller mutations cannot leak in', () => {
    const src = items(3);
    const s = createDrill(src, { now: T0 });
    src.push(item('late'));
    expect(s.queue).toHaveLength(3);
    expect(s.queue).not.toBe(src);
  });
});

describe('correct flow: combo and stats', () => {
  it('increments combo, bestCombo and firstTryCorrect on clean correct answers', () => {
    let s = drill(3);
    s = submit(s, true);
    expect(s.phase).toBe('feedback-correct');
    expect(s.combo).toBe(1);
    expect(s.bestCombo).toBe(1);
    expect(s.answered).toBe(1);
    expect(s.firstTryCorrect).toBe(1);
    s = advance(s);
    expect(s.phase).toBe('answering');
    expect(s.idx).toBe(1);
    s = submit(s, true);
    expect(s.combo).toBe(2);
    expect(s.bestCombo).toBe(2);
  });

  it('a wrong answer resets combo but keeps bestCombo', () => {
    let s = drill(3);
    s = advance(submit(s, true));
    s = advance(submit(s, true));
    s = submit(s, false);
    expect(s.combo).toBe(0);
    expect(s.bestCombo).toBe(2);
    expect(s.firstTryCorrect).toBe(2);
    expect(s.answered).toBe(3);
  });

  it('submit is a no-op during feedback-correct (the component waits for the timer)', () => {
    const s = submit(drill(2), true);
    expect(submit(s, true)).toBe(s);
    expect(submit(s, false)).toBe(s);
  });
});

describe('wrong flow: feedback-miss phase and requeue', () => {
  it('drops to feedback-miss and requeues a COPY of the item at the END', () => {
    const s = submit(drill(3), false);
    expect(s.phase).toBe('feedback-miss');
    expect(queueIds(s)).toEqual(['i0', 'i1', 'i2', 'i0']);
    expect(s.queue[3]).toEqual(s.queue[0]);
    expect(s.queue[3]).not.toBe(s.queue[0]); // a copy, not the same object
    expect(s.requeues).toEqual({ i0: 1 });
    expect(s.missedIds).toEqual(['i0']);
    expect(s.answered).toBe(1);
    expect(s.firstTryCorrect).toBe(0);
  });

  it('has no retype gate: submit is a no-op, advance() leaves the panel', () => {
    const s = submit(drill(3), false);
    expect(submit(s, false)).toBe(s); // typing anything never rescores…
    expect(submit(s, true)).toBe(s); // …not even the correct word
    const next = advance(s); // Enter/"Vidare" → the component advances
    expect(next.phase).toBe('answering');
    expect(next.idx).toBe(1);
    expect(next.answered).toBe(1); // the panel visit is NOT a scored attempt
    expect(next.firstTryCorrect).toBe(0);
  });

  it(`caps requeues at ${DRILL_MAX_REQUEUES} per id`, () => {
    // Single-item run missed on every encounter: 1 original + 2 requeued copies.
    let s = createDrill([item('a')], { now: T0 });
    for (let i = 0; i < 3; i++) {
      s = advance(submit(s, false)); // miss → continue past the panel
    }
    expect(queueIds(s)).toEqual(['a', 'a', 'a']);
    expect(s.requeues).toEqual({ a: DRILL_MAX_REQUEUES });
    expect(s.phase).toBe('done');
    expect(s.answered).toBe(3);
    expect(s.missedIds).toEqual(['a']); // unique despite three misses
  });

  it('keeps missedIds unique and in first-miss order', () => {
    let s = drill(2);
    s = advance(submit(s, false)); // miss i0
    s = advance(submit(s, false)); // miss i1
    s = advance(submit(s, false)); // miss the requeued i0 copy
    expect(s.missedIds).toEqual(['i0', 'i1']);
  });
});

describe('hint (reveal)', () => {
  it('reveals only while answering; a no-op in other phases', () => {
    const s = reveal(drill(2));
    expect(s.revealed).toBe(true);
    const missed = submit(drill(2), false);
    expect(reveal(missed)).toBe(missed);
    const feedback = submit(drill(2), true);
    expect(reveal(feedback)).toBe(feedback);
  });

  it('a correct answer AFTER a reveal still scores as a miss', () => {
    const s = submit(reveal(drill(2)), true);
    expect(s.phase).toBe('feedback-miss');
    expect(s.combo).toBe(0);
    expect(s.missedIds).toEqual(['i0']);
    expect(s.requeues).toEqual({ i0: 1 });
    expect(s.firstTryCorrect).toBe(0);
    expect(s.answered).toBe(1);
  });

  it('advance resets the reveal flag for the next item', () => {
    const s = advance(submit(reveal(drill(2)), true)); // hint-miss → continue
    expect(s.idx).toBe(1);
    expect(s.revealed).toBe(false);
  });
});

describe('outcomeOf', () => {
  it('maps reveal → hint (regardless of correctness), else correct/wrong', () => {
    const s = drill(2);
    expect(outcomeOf(s, true)).toBe('correct');
    expect(outcomeOf(s, false)).toBe('wrong');
    const revealed = reveal(s);
    expect(outcomeOf(revealed, true)).toBe('hint');
    expect(outcomeOf(revealed, false)).toBe('hint');
  });
});

describe('advance and completion', () => {
  it('walks the queue and lands on done past the last item', () => {
    let s = drill(2);
    s = advance(submit(s, true));
    expect(s.phase).toBe('answering');
    s = advance(submit(s, true));
    expect(s.phase).toBe('done');
    expect(s.idx).toBe(2);
  });

  it('done is terminal: submit/advance/reveal are no-ops', () => {
    let s = drill(1);
    s = advance(submit(s, true));
    expect(s.phase).toBe('done');
    expect(submit(s, true)).toBe(s);
    expect(advance(s)).toBe(s);
    expect(reveal(s)).toBe(s);
  });

  it('a full mixed run yields the end-screen stats (accuracy inputs, time base)', () => {
    // 2 items: i0 clean, i1 missed then its requeued copy answered clean.
    let s = drill(2);
    s = advance(submit(s, true)); // i0 correct
    s = advance(submit(s, false)); // i1 miss → continue past the panel
    s = advance(submit(s, true)); // requeued i1 copy correct
    expect(s.phase).toBe('done');
    expect(s.answered).toBe(3);
    expect(s.firstTryCorrect).toBe(2); // accuracy = 2/3
    expect(s.bestCombo).toBe(1);
    expect(s.missedIds).toEqual(['i1']);
    expect(s.startedAt).toBe(T0);
  });
});

describe('extendQueue (the Flöde top-up)', () => {
  it('appends items without touching idx, phase or stats', () => {
    let s = advance(submit(drill(2), true)); // answering i1
    s = extendQueue(s, items(2).map((i) => ({ ...i, id: `x-${i.id}` })));
    expect(queueIds(s)).toEqual(['i0', 'i1', 'x-i0', 'x-i1']);
    expect(s.idx).toBe(1);
    expect(s.phase).toBe('answering');
    expect(s.answered).toBe(1);
  });

  it('keeps done out of reach while top-ups arrive before the queue drains', () => {
    let s = drill(1, 1);
    s = extendQueue(s, [item('b')]); // topped up while answering the last item
    s = advance(submit(s, true));
    expect(s.phase).toBe('answering'); // not done — the appended item is next
    expect(s.queue).toHaveLength(2);
  });

  it('is a no-op on done and for empty batches, and never mutates its input', () => {
    const done = advance(submit(drill(1), true));
    expect(extendQueue(done, [item('b')])).toBe(done);
    const s = deepFreeze(drill(2));
    expect(extendQueue(s, [])).toBe(s);
    const grown = extendQueue(s, [item('c')]);
    expect(grown.queue).toHaveLength(3);
    expect(s.queue).toHaveLength(2);
  });
});

describe('isBlankAttempt', () => {
  it('flags empty and whitespace-only submits (the double-Enter guard)', () => {
    // The component drops blank un-revealed answering submits via this
    // predicate — otherwise a key-repeated Enter after continuing past the
    // miss panel would grade the NEXT, unseen card as an SRS miss.
    expect(isBlankAttempt('')).toBe(true);
    expect(isBlankAttempt('   ')).toBe(true);
    expect(isBlankAttempt('\t\n')).toBe(true);
  });

  it('never flags a real attempt, however wrong or padded', () => {
    expect(isBlankAttempt('hoppe')).toBe(false);
    expect(isBlankAttempt(' 42 ')).toBe(false);
    expect(isBlankAttempt('.')).toBe(false); // punctuation-only is a scored (wrong) attempt
  });
});

describe('immutability', () => {
  it('submit/reveal/advance never mutate the input state (frozen inputs)', () => {
    const s0 = deepFreeze(drill(3));
    const s1 = submit(s0, false); // the requeue branch touches the most state
    expect(s1).not.toBe(s0);
    expect(s0.queue).toHaveLength(3);
    expect(s0.missedIds).toEqual([]);
    expect(s0.requeues).toEqual({});
    expect(s1.queue).toHaveLength(4);

    const s2 = deepFreeze(reveal(deepFreeze(drill(2))));
    expect(submit(s2, true).missedIds).toEqual(['i0']);
    expect(s2.missedIds).toEqual([]);

    const s3 = deepFreeze(submit(deepFreeze(drill(2)), true));
    expect(advance(s3).idx).toBe(1);
    expect(s3.idx).toBe(0);
  });
});

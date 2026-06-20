import { describe, it, expect } from 'vitest';
import { newCard, review, isDue, clampForCorrectness, Rating, State } from './srs.ts';

const T0 = new Date('2026-06-20T08:00:00Z');

describe('srs (FSRS-6 wrapper)', () => {
  it('a new card is New and due', () => {
    const c = newCard(T0);
    expect(c.state).toBe(State.New);
    expect(c.reps).toBe(0);
    expect(isDue(c, T0)).toBe(true);
  });

  it('Good advances reps and schedules into the future', () => {
    const n = review(newCard(T0), Rating.Good, T0);
    expect(n.reps).toBe(1);
    expect(n.last_review).toBeTruthy();
    expect(new Date(n.due).getTime()).toBeGreaterThan(T0.getTime());
  });

  it('Easy is scheduled no sooner than Good', () => {
    const good = review(newCard(T0), Rating.Good, T0);
    const easy = review(newCard(T0), Rating.Easy, T0);
    expect(new Date(easy.due).getTime()).toBeGreaterThanOrEqual(new Date(good.due).getTime());
  });

  it('a second Good grows the interval', () => {
    const first = review(newCard(T0), Rating.Good, T0);
    const t1 = new Date(first.due);
    const second = review(first, Rating.Good, t1);
    const gap1 = new Date(first.due).getTime() - T0.getTime();
    const gap2 = new Date(second.due).getTime() - t1.getTime();
    expect(gap2).toBeGreaterThan(gap1);
  });

  it('Again stays much shorter than Good', () => {
    const again = review(newCard(T0), Rating.Again, T0);
    const good = review(newCard(T0), Rating.Good, T0);
    expect(new Date(again.due).getTime()).toBeGreaterThan(T0.getTime());
    expect(new Date(again.due).getTime()).toBeLessThan(new Date(good.due).getTime());
  });

  it('clampForCorrectness floors a wrong answer to Again', () => {
    expect(clampForCorrectness(Rating.Good, false)).toBe(Rating.Again);
    expect(clampForCorrectness(Rating.Good, true)).toBe(Rating.Good);
  });
});

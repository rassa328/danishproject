import { describe, it, expect } from 'vitest';
import { localDayIso, daysBetween, dayNumber } from './day.ts';

describe('day helpers (local-calendar)', () => {
  it('localDayIso uses the local date, not UTC', () => {
    // 23:30 local on June 21 stays June 21 regardless of the runner timezone.
    expect(localDayIso(new Date(2026, 5, 21, 23, 30))).toBe('2026-06-21');
    expect(localDayIso(new Date(2026, 0, 5, 0, 15))).toBe('2026-01-05');
  });

  it('daysBetween counts whole calendar days', () => {
    expect(daysBetween('2026-06-21', '2026-06-21')).toBe(0);
    expect(daysBetween('2026-06-20', '2026-06-21')).toBe(1);
    expect(daysBetween('2026-06-20', '2026-06-24')).toBe(4);
    expect(daysBetween('2026-06-24', '2026-06-20')).toBe(-4);
  });

  it('dayNumber advances by exactly 1 per local day', () => {
    const a = dayNumber(new Date(2026, 5, 21, 1, 0));
    const b = dayNumber(new Date(2026, 5, 22, 23, 0));
    expect(b - a).toBe(1);
  });
});

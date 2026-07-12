import { describe, it, expect } from 'vitest';
import {
  UNLIMITED,
  NEW_PER_DAY,
  MAX_REVIEWS,
  stepUp,
  stepDown,
  stepperDisplay,
  clampRetention,
  retentionToPct,
  pctToRetention,
  RETENTION_MIN,
  RETENTION_MAX,
} from './fc-settings.ts';

describe('fc-settings steppers', () => {
  it('increments by step and crosses into ∞ past max', () => {
    expect(stepUp(10, NEW_PER_DAY)).toBe(15);
    expect(stepUp(195, NEW_PER_DAY)).toBe(200);
    // 200 + 5 > 200 → ∞
    expect(stepUp(200, NEW_PER_DAY)).toBe(UNLIMITED);
    // ∞ stays ∞
    expect(stepUp(UNLIMITED, NEW_PER_DAY)).toBe(UNLIMITED);
  });

  it('decrements, and ∞ drops back to max', () => {
    expect(stepDown(15, NEW_PER_DAY)).toBe(10);
    expect(stepDown(UNLIMITED, NEW_PER_DAY)).toBe(200);
    expect(stepDown(UNLIMITED, MAX_REVIEWS)).toBe(500);
  });

  it('clamps at the floor without underflowing', () => {
    expect(stepDown(0, NEW_PER_DAY)).toBe(0);
    expect(stepDown(10, MAX_REVIEWS)).toBe(10); // min is 10 for reviews
  });

  it('uses the reviews step/range independently', () => {
    expect(stepUp(200, MAX_REVIEWS)).toBe(210);
    expect(stepUp(500, MAX_REVIEWS)).toBe(UNLIMITED);
    expect(stepUp(495, MAX_REVIEWS)).toBe(UNLIMITED); // 505 > 500
  });

  it('renders ∞ for the unlimited sentinel, numbers otherwise', () => {
    expect(stepperDisplay(UNLIMITED)).toBe('∞');
    expect(stepperDisplay(0)).toBe('0');
    expect(stepperDisplay(200)).toBe('200');
  });
});

describe('fc-settings retention', () => {
  it('maps between fraction and percent', () => {
    expect(retentionToPct(0.9)).toBe(90);
    expect(retentionToPct(0.85)).toBe(85);
    expect(pctToRetention(95)).toBe(0.95);
  });

  it('clamps manual retention into range', () => {
    expect(clampRetention(90)).toBe(90);
    expect(clampRetention(70)).toBe(RETENTION_MIN);
    expect(clampRetention(120)).toBe(RETENTION_MAX);
    expect(clampRetention(88.6)).toBe(89); // rounds
  });
});

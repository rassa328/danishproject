import { describe, it, expect } from 'vitest';
import {
  computeDrop,
  flagY,
  flagSquash,
  hairlineDip,
  MAX_BOUNCES,
  G,
} from './flag-physics.ts';

const H = 120;
const spec = computeDrop(H);

/** Sample times densely across the whole animation. */
const samples = (n = 2000) =>
  Array.from({ length: n + 1 }, (_, i) => (i / n) * (spec.settleTime + 0.3));

describe('computeDrop', () => {
  it('caps at MAX_BOUNCES impacts with strictly increasing times', () => {
    expect(spec.impacts.length).toBeLessThanOrEqual(MAX_BOUNCES);
    for (let i = 1; i < spec.impacts.length; i += 1) {
      expect(spec.impacts[i]!).toBeGreaterThan(spec.impacts[i - 1]!);
    }
    expect(spec.settleTime).toBe(spec.impacts[spec.impacts.length - 1]);
  });

  it('impact speeds strictly decrease', () => {
    for (let i = 1; i < spec.impactSpeeds.length; i += 1) {
      expect(spec.impactSpeeds[i]!).toBeLessThan(spec.impactSpeeds[i - 1]!);
    }
  });

  it('first impact matches free-fall time', () => {
    expect(spec.impacts[0]).toBeCloseTo(Math.sqrt((2 * H) / G), 10);
  });

  it('settles within 1100ms at h=120', () => {
    expect(spec.settleTime).toBeLessThanOrEqual(1.1);
  });

  it('is deterministic', () => {
    expect(computeDrop(H)).toEqual(computeDrop(H));
  });
});

describe('flagY', () => {
  it('starts at -dropHeight and rests at 0 after settle', () => {
    expect(flagY(0, spec)).toBe(-H);
    expect(flagY(spec.settleTime, spec)).toBe(0);
    expect(flagY(spec.settleTime + 5, spec)).toBe(0);
  });

  it('never passes through the floor', () => {
    for (const t of samples()) {
      expect(flagY(t, spec)).toBeLessThanOrEqual(0);
    }
  });

  it('bounce peaks strictly decrease', () => {
    const peaks = spec.arcs.map((arc) => -flagY(arc.start + arc.u / G, spec));
    for (let i = 1; i < peaks.length; i += 1) {
      expect(peaks[i]!).toBeLessThan(peaks[i - 1]!);
    }
    // and every peak is lower than the drop height itself
    expect(peaks[0]!).toBeLessThan(H);
  });
});

describe('flagSquash', () => {
  it('squashes (sy<1) only inside impact windows and returns to 1', () => {
    for (const t of samples()) {
      const { sy } = flagSquash(t, spec);
      const inWindow = spec.impacts.some((imp) => t >= imp && t < imp + 0.09);
      if (inWindow) expect(sy).toBeLessThanOrEqual(1);
      else expect(sy).toBe(1);
    }
    // mid-pulse of the first impact is a real squash
    expect(flagSquash((spec.impacts[0] ?? 0) + 0.045, spec).sy).toBeLessThan(1);
    // long after settle: identity
    expect(flagSquash(spec.settleTime + 1, spec)).toEqual({ sx: 1, sy: 1 });
  });

  it('preserves volume: sx * sy ≈ 1', () => {
    for (const t of samples()) {
      const { sx, sy } = flagSquash(t, spec);
      expect(sx * sy).toBeCloseTo(1, 10);
    }
  });

  it('later impacts pulse weaker', () => {
    const at = (i: number) => 1 - flagSquash((spec.impacts[i] ?? 0) + 0.045, spec).sy;
    // Impact windows late in the bounce chain overlap (latest wins), so only
    // compare the first two — their windows are cleanly separated.
    expect(at(1)).toBeLessThan(at(0));
    expect(at(1)).toBeGreaterThan(0);
  });
});

describe('hairlineDip', () => {
  it('stays within ±2px and is 0 outside impact windows', () => {
    for (const t of samples()) {
      const d = hairlineDip(t, spec);
      expect(Math.abs(d)).toBeLessThanOrEqual(2);
      const inWindow = spec.impacts.some((imp) => t >= imp && t < imp + 0.16);
      if (!inWindow) expect(d).toBe(0);
    }
  });

  it('moves on impact', () => {
    expect(Math.abs(hairlineDip((spec.impacts[0] ?? 0) + 0.03, spec))).toBeGreaterThan(0.1);
  });
});

import { describe, it, expect } from 'vitest';
import { waveformSpec, VIEW_H, type WaveformSize } from './waveform.ts';

const EXPECTED: { size: WaveformSize; count: number; gapLength: number }[] = [
  { size: 'icon', count: 12, gapLength: 2 },
  { size: 'hero', count: 24, gapLength: 3 },
  { size: 'divider', count: 36, gapLength: 3 },
];

describe('waveformSpec', () => {
  it('emits the expected bar count per size', () => {
    for (const { size, count } of EXPECTED) {
      expect(waveformSpec(size).bars).toHaveLength(count);
    }
  });

  it('marks exactly gapLength gap bars, contiguous and centered', () => {
    for (const { size, count, gapLength } of EXPECTED) {
      const spec = waveformSpec(size);
      const gapIdx = spec.bars.flatMap((b, i) => (b.gap ? [i] : []));
      expect(gapIdx).toHaveLength(gapLength);
      expect(spec.gapLength).toBe(gapLength);
      // contiguous run starting at gapStart
      for (let k = 0; k < gapIdx.length; k += 1) {
        expect(gapIdx[k]).toBe(spec.gapStart + k);
      }
      // centered: midpoint of the gap within one bar of the waveform midpoint
      const mid = spec.gapStart + gapLength / 2;
      expect(Math.abs(mid - count / 2)).toBeLessThanOrEqual(1);
    }
  });

  it('keeps every gap bar shorter than every non-gap bar', () => {
    for (const { size } of EXPECTED) {
      const spec = waveformSpec(size);
      const gapMax = Math.max(...spec.bars.filter((b) => b.gap).map((b) => b.height));
      const mainMin = Math.min(...spec.bars.filter((b) => !b.gap).map((b) => b.height));
      expect(gapMax).toBeLessThan(mainMin);
    }
  });

  it('is deterministic', () => {
    expect(waveformSpec('hero')).toEqual(waveformSpec('hero'));
  });

  it('places bars at uniform pitch and inside the width', () => {
    for (const { size } of EXPECTED) {
      const spec = waveformSpec(size);
      const first = spec.bars[0];
      const second = spec.bars[1];
      expect(first?.x).toBe(0);
      const pitch = (second?.x ?? 0) - (first?.x ?? 0);
      spec.bars.forEach((b, i) => {
        expect(b.x).toBeCloseTo(i * pitch, 10);
        expect(b.x + spec.barWidth).toBeLessThanOrEqual(spec.width);
      });
    }
  });

  it('leaves pulse headroom: height * 1.6 never exceeds the viewBox', () => {
    for (const { size } of EXPECTED) {
      for (const bar of waveformSpec(size).bars) {
        expect(bar.height * 1.6).toBeLessThanOrEqual(VIEW_H);
        // center-anchored
        expect(bar.y).toBeCloseTo((VIEW_H - bar.height) / 2, 10);
      }
    }
  });

  it('viewBox string matches width and height', () => {
    for (const { size } of EXPECTED) {
      const spec = waveformSpec(size);
      expect(spec.height).toBe(VIEW_H);
      expect(spec.viewBox).toBe(`0 0 ${spec.width} ${spec.height}`);
    }
  });
});

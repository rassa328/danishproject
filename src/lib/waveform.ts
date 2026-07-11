// Deterministic waveform geometry — the site's one typographic "sound" motif.
// Pure data so it can be unit-tested and rendered by Waveform.svelte both with
// and without client JS. The short accent-colored bars in the middle are the
// visual stød: a dip in the signal.
//
// No RNG: a fixed cyclic height table keeps SSR and client markup identical
// and makes snapshots meaningful.

export type WaveformSize = 'icon' | 'hero' | 'divider';

export interface WaveformBar {
  x: number;
  y: number;
  height: number;
  /** True for the short mid-waveform "stød gap" bars (tinted accent). */
  gap: boolean;
}

export interface WaveformSpec {
  bars: WaveformBar[];
  barWidth: number;
  width: number;
  height: number;
  viewBox: string;
  gapStart: number;
  gapLength: number;
}

const HEIGHTS = [0.45, 0.7, 0.55, 0.95, 0.65, 0.85, 0.5, 0.75, 0.6, 0.9];
const GAP_HEIGHT = 0.18;
export const VIEW_H = 32;
// scaleY(1.6) during the pulse peaks at 0.95 * 20 * 1.6 = 30.4 < 32 — the
// sweep never clips the viewBox.
const BAR_MAX = 20;
const BAR_W = 2;
const PITCH = 3.5;

const SIZES: Record<WaveformSize, { count: number; gapLength: number }> = {
  icon: { count: 12, gapLength: 2 },
  hero: { count: 24, gapLength: 3 },
  divider: { count: 36, gapLength: 3 },
};

export function waveformSpec(size: WaveformSize): WaveformSpec {
  const { count, gapLength } = SIZES[size];
  const gapStart = Math.floor((count - gapLength) / 2);
  const bars: WaveformBar[] = [];
  for (let i = 0; i < count; i += 1) {
    const gap = i >= gapStart && i < gapStart + gapLength;
    const unit = gap ? GAP_HEIGHT : (HEIGHTS[i % HEIGHTS.length] ?? GAP_HEIGHT);
    const height = unit * BAR_MAX;
    bars.push({ x: i * PITCH, y: (VIEW_H - height) / 2, height, gap });
  }
  const width = (count - 1) * PITCH + BAR_W;
  return {
    bars,
    barWidth: BAR_W,
    width,
    height: VIEW_H,
    viewBox: `0 0 ${width} ${VIEW_H}`,
    gapStart,
    gapLength,
  };
}

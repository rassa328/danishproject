// Extract real amplitude envelopes from the hero's word clips so the home-page
// waveforms match the actual audio (bar heights = the word's true shape).
//
// USAGE:
//   node --experimental-strip-types scripts/waveform-data.ts
//
// Decodes public/audio/<lessonAudioId(word)>.mp3 for each WORD below, trims the
// silence Azure pads around the speech (~1.1s of tail on a ~0.45s word), buckets
// the speech region into 35ms peak-amplitude bars, and writes the committed
// manifest src/data/hero-waveform.json. Re-run only if the clips are re-voiced.
//
// mpg123-decoder is a devDependency used ONLY by this script (WASM decoder,
// never part of the client bundle). NOT part of the build.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { MPEGDecoder } from 'mpg123-decoder';
import { lessonAudioId } from '../src/lib/audio-id.ts';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const OUT_PATH = resolve(root, 'src/data/hero-waveform.json');

const WORDS = ['hun', 'hund'];
/** Words whose interior amplitude dip should be marked (the stød cue). */
const DIP_WORDS = new Set(['hund']);
/** Manual escape hatch: pin [start, len] when the detected dip looks wrong. */
const DIP_OVERRIDE: Record<string, [number, number]> = {};

const BUCKET_SEC = 0.035;
const TRIM_THRESHOLD = 0.03; // of global peak
const MAX_BARS = 16;
const PEAK_NORM = 0.95; // keeps the pulse-headroom invariant (0.95 * 20 * 1.6 < 32)
const MIN_BAR = 0.08;

interface WordWaveform {
  heights: number[];
  dip?: [number, number];
}

function envelope(samples: Float32Array, sampleRate: number): number[] {
  let bucketSec = BUCKET_SEC;
  // First pass buckets at 35ms; if the trimmed speech would exceed MAX_BARS,
  // widen the bucket and redo (keeps proportional width without overflowing).
  for (;;) {
    const per = Math.max(1, Math.round(sampleRate * bucketSec));
    const peaks: number[] = [];
    for (let i = 0; i < samples.length; i += per) {
      let max = 0;
      const end = Math.min(samples.length, i + per);
      for (let j = i; j < end; j += 1) {
        const a = Math.abs(samples[j] ?? 0);
        if (a > max) max = a;
      }
      peaks.push(max);
    }
    const global = Math.max(...peaks);
    if (global === 0) throw new Error('silent clip');
    const cut = global * TRIM_THRESHOLD;
    let first = peaks.findIndex((p) => p > cut);
    let last = peaks.length - 1;
    while (last > first && (peaks[last] ?? 0) <= cut) last -= 1;
    first = Math.max(0, first - 1); // ±1 bucket of padding
    last = Math.min(peaks.length - 1, last + 1);
    const speech = peaks.slice(first, last + 1);
    if (speech.length > MAX_BARS) {
      bucketSec *= speech.length / MAX_BARS;
      continue;
    }
    const norm = PEAK_NORM / Math.max(...speech);
    return speech.map((p) => Math.max(MIN_BAR, Math.round(p * norm * 100) / 100));
  }
}

/** Lowest-mean contiguous window (width 2) away from the edges — the stød dip. */
function findDip(heights: number[]): [number, number] | null {
  const EDGE = 2;
  const WIN = 2;
  let best: [number, number] | null = null;
  let bestMean = Infinity;
  for (let s = EDGE; s + WIN <= heights.length - EDGE; s += 1) {
    const mean = heights.slice(s, s + WIN).reduce((a, b) => a + b, 0) / WIN;
    if (mean < bestMean) {
      bestMean = mean;
      best = [s, WIN];
    }
  }
  return best;
}

const out: Record<string, WordWaveform> = {};
for (const word of WORDS) {
  // Fresh decoder per file: reset() is async and stale state garbles the
  // next decode — a new instance per clip is cheap and unambiguous.
  const decoder = new MPEGDecoder();
  await decoder.ready;
  const id = lessonAudioId(word);
  const path = resolve(root, `public/audio/${id}.mp3`);
  const bytes = new Uint8Array(readFileSync(path));
  const { channelData, sampleRate, samplesDecoded } = decoder.decode(bytes);
  decoder.free();
  if (!samplesDecoded || channelData.length === 0) throw new Error(`decode failed: ${path}`);
  // mono mix
  const mono = new Float32Array(samplesDecoded);
  for (const ch of channelData) {
    for (let i = 0; i < samplesDecoded; i += 1) mono[i]! += (ch[i] ?? 0) / channelData.length;
  }
  const heights = envelope(mono, sampleRate);
  const entry: WordWaveform = { heights };
  if (DIP_WORDS.has(word)) {
    const dip = DIP_OVERRIDE[word] ?? findDip(heights);
    if (dip) entry.dip = dip;
  }
  out[word] = entry;
  console.log(
    `${word} (${id}): ${heights.length} bars [${heights.join(', ')}]${entry.dip ? ` dip=[${entry.dip}]` : ''}`,
  );
}

writeFileSync(OUT_PATH, JSON.stringify(out, null, 2) + '\n');
console.log(`wrote ${OUT_PATH}`);

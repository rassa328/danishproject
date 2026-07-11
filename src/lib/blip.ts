// Tiny synthesized feedback blips for the typing drill. These are UI sounds
// (like a key click), not Danish speech, so the clips-only product invariant
// doesn't apply. Fire-and-forget: never throws, silently no-ops without an
// AudioContext (SSR, unsupported browser, construction blocked). No unit
// tests (repo policy: DOM/WebAudio code is covered by the manual pass).

import { getAudioContext } from './webaudio.ts';

export type BlipKind = 'correct' | 'combo';

const NOTE_S = 0.08; // ~80 ms per note
const PEAK_GAIN = 0.12; // quiet — feedback, not fanfare

// One sine note with a gain envelope (fast attack, exponential decay) —
// a raw start/stop without the ramp would click audibly.
function note(ctx: AudioContext, freq: number, at: number): void {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.exponentialRampToValueAtTime(PEAK_GAIN, at + 0.005);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + NOTE_S);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(at);
  osc.stop(at + NOTE_S + 0.01);
}

/** 'correct' = one short note; 'combo' (every 5th consecutive correct) = a
 *  rising two-note. */
export function blip(kind: BlipKind): void {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;
    if (ctx.state === 'suspended') {
      // Blips fire from an Enter keydown (a user gesture), so resume()
      // succeeds and the nodes scheduled below play once it does.
      void ctx.resume().catch(() => undefined);
    }
    const t = ctx.currentTime + 0.01;
    if (kind === 'combo') {
      note(ctx, 660, t);
      note(ctx, 880, t + NOTE_S + 0.02);
    } else {
      note(ctx, 880, t);
    }
  } catch {
    /* fire-and-forget — audio must never break the drill */
  }
}

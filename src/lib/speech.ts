// Client-only da-DK speech. Safe to import during SSR: every function checks
// for the API and no-ops/returns 'none' when it's unavailable. Strategy:
// play a curated clip if given (best fidelity for stød/numbers), else Web
// Speech da-DK, else report 'none' so callers can show a fallback.

let cachedVoice: SpeechSynthesisVoice | null | undefined; // undefined = not yet resolved

function synth(): SpeechSynthesis | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.speechSynthesis ?? null;
  } catch {
    return null;
  }
}

function pickDanish(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | null {
  const danish = voices.filter((v) => v.lang?.toLowerCase().startsWith('da'));
  if (danish.length === 0) return null;
  // Prefer higher-fidelity voices: cloud (non-localService) and named engines
  // (Microsoft/Google) beat the generic local eSpeak fallback. This only
  // affects the rare Web Speech fallback path; committed clips are unaffected.
  const score = (v: SpeechSynthesisVoice): number => {
    let s = 0;
    if (v.lang === 'da-DK') s += 4;
    if (!v.localService) s += 2;
    if (/microsoft|google/i.test(v.name)) s += 1;
    return s;
  };
  return danish.reduce((best, v) => (score(v) > score(best) ? v : best));
}

/** Resolve a Danish voice, handling Chrome's async getVoices() (empty on first
 *  call until 'voiceschanged' fires). Resolves null if none after `timeoutMs`. */
export function resolveDanishVoice(timeoutMs = 1000): Promise<SpeechSynthesisVoice | null> {
  const s = synth();
  if (!s) return Promise.resolve(null);
  if (cachedVoice !== undefined) return Promise.resolve(cachedVoice);

  return new Promise((resolve) => {
    const finish = (v: SpeechSynthesisVoice | null) => {
      cachedVoice = v;
      clearTimeout(timer);
      s.removeEventListener('voiceschanged', onChange);
      resolve(v);
    };
    const onChange = () => {
      const v = pickDanish(s.getVoices());
      if (v) finish(v);
    };
    const timer = setTimeout(() => finish(pickDanish(s.getVoices())), timeoutMs);

    const immediate = pickDanish(s.getVoices());
    if (immediate) finish(immediate);
    else s.addEventListener('voiceschanged', onChange);
  });
}

export async function hasDanishVoice(): Promise<boolean> {
  return (await resolveDanishVoice()) !== null;
}

export type SpeakOutcome = 'audio' | 'tts' | 'blocked' | 'cancelled' | 'none';

// The one clip playing right now. Every speak() call stops it (and cancels any
// ongoing Web Speech) before starting, so audio never overlaps.
let currentAudio: HTMLAudioElement | null = null;

// Monotonic call id: lets an in-flight speak() detect it was superseded by a
// newer call (whose stopCurrent() aborted its play()) and bail out silently
// instead of speaking stale text over the newer playback.
let speakSeq = 0;

function stopCurrent(): void {
  if (currentAudio) {
    try {
      currentAudio.pause();
    } catch {
      /* already stopped/detached — nothing to do */
    }
    currentAudio = null;
  }
  const s = synth();
  if (s) {
    try {
      s.cancel();
    } catch {
      /* ignore */
    }
  }
}

/** Speak Danish text. Clip-first: if `audioUrl` plays, use it; else da-DK TTS;
 *  else 'none' (caller shows a fallback). Starting a new speak() stops any
 *  previous playback. `rate` scales speed (1 = normal, 0.75 = slow replay):
 *  it sets the clip's playbackRate, or scales the Web Speech base rate 0.95.
 *  Returns 'blocked' if the browser refused autoplay (no user gesture yet) —
 *  callers should then offer an explicit play button instead of assuming the
 *  clip was heard. Returns 'cancelled' if a newer speak() superseded this one
 *  before it produced sound (callers can ignore that outcome). Never throws. */
export async function speak(
  text: string,
  opts: { audioUrl?: string; rate?: number } = {}
): Promise<SpeakOutcome> {
  const seq = ++speakSeq;
  stopCurrent();
  if (opts.audioUrl) {
    let audio: HTMLAudioElement | null = null;
    try {
      audio = new Audio(opts.audioUrl);
      if (opts.rate !== undefined) audio.playbackRate = opts.rate;
      currentAudio = audio;
      await audio.play();
      return 'audio';
    } catch (err) {
      // Only clear our own element: a newer speak() may already have replaced
      // currentAudio with its own (its pause() is what rejected our play()).
      if (audio && currentAudio === audio) currentAudio = null;
      if (seq !== speakSeq) return 'cancelled';
      if (err instanceof DOMException && err.name === 'NotAllowedError') {
        // Autoplay blocked: the page has no user gesture yet, so Web Speech
        // would be equally blocked (or jarringly delayed). Don't fall through.
        return 'blocked';
      }
      console.warn('[speech] clip failed, falling back to Web Speech:', opts.audioUrl, err);
    }
  }
  const s = synth();
  if (!s) return 'none';
  const voice = await resolveDanishVoice();
  // A newer speak() may have started while we awaited voice resolution;
  // speaking now would overlap (or cancel) its playback.
  if (seq !== speakSeq) return 'cancelled';
  if (!voice) return 'none';
  try {
    s.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.voice = voice;
    u.lang = voice.lang || 'da-DK';
    u.rate = 0.95 * (opts.rate ?? 1);
    s.speak(u);
    return 'tts';
  } catch {
    return 'none';
  }
}

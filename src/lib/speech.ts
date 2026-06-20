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
  return (
    voices.find((v) => v.lang === 'da-DK') ??
    voices.find((v) => v.lang?.toLowerCase().startsWith('da')) ??
    null
  );
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

export type SpeakOutcome = 'audio' | 'tts' | 'none';

/** Speak Danish text. Clip-first: if `audioUrl` plays, use it; else da-DK TTS;
 *  else 'none' (caller shows a fallback). Never throws. */
export async function speak(text: string, opts: { audioUrl?: string } = {}): Promise<SpeakOutcome> {
  if (opts.audioUrl) {
    try {
      await new Audio(opts.audioUrl).play();
      return 'audio';
    } catch {
      /* fall through to TTS */
    }
  }
  const s = synth();
  if (!s) return 'none';
  const voice = await resolveDanishVoice();
  if (!voice) return 'none';
  try {
    s.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.voice = voice;
    u.lang = voice.lang || 'da-DK';
    u.rate = 0.95;
    s.speak(u);
    return 'tts';
  } catch {
    return 'none';
  }
}

// Shared lazy AudioContext for all app sound (number-clip composition in
// number-audio.ts, feedback blips in blip.ts). ONE context per page keeps
// browser context limits and autoplay unlocking simple: a user gesture that
// resumes it unlocks every consumer at once. Safe to import during SSR —
// getAudioContext() returns null when window is unavailable. No unit tests
// (repo policy: DOM/WebAudio code is covered by the manual pass).

let sharedCtx: AudioContext | null | undefined; // undefined = not yet attempted

export function getAudioContext(): AudioContext | null {
  if (sharedCtx !== undefined) return sharedCtx;
  sharedCtx = null;
  if (typeof window !== 'undefined') {
    const w = window as Window & { webkitAudioContext?: typeof AudioContext };
    const Ctor = window.AudioContext ?? w.webkitAudioContext;
    if (Ctor) {
      try {
        sharedCtx = new Ctor();
      } catch {
        /* stays null — callers no-op or report 'blocked' */
      }
    }
  }
  return sharedCtx;
}

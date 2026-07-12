// Shared click-to-hear enhancement for Danish words that carry a committed clip.
// Two entry points over the SAME behavior + single-highlight state:
//   - enhanceAudio(el, text, audio): imperative, for islands that scan static
//     DOM on mount (WordAudio over the ordlista table).
//   - audioClick: a Svelte action for reactively-rendered rows (OrdlistaSearch),
//     whose markup is owned by Svelte and can't be pre-rendered with data-audio.
// A module-scoped `playing` keeps exactly one word flashing .is-playing at a
// time across both entry points.
import { speak } from './speech.ts';
import { withBase } from './url.ts';

let playing: HTMLElement | null = null;

// Same fallback marker as SpeakButton: when a clip fails and Web Speech is used
// instead, show a muted 'talsyntes' hint so the learner can tell the curated
// native clip from the robot voice. Inserted as a sibling (never inside `el`,
// whose textContent is the spoken text) and styled inline — this runs against
// markup whose scoped styles can't reach an injected node.
export function setTtsHint(el: HTMLElement, show: boolean): void {
  const next = el.nextElementSibling;
  const existing = next instanceof HTMLElement && next.classList.contains('tts-hint') ? next : null;
  if (!show) {
    existing?.remove();
    return;
  }
  if (existing) return;
  const hint = document.createElement('span');
  hint.className = 'tts-hint';
  hint.textContent = 'talsyntes';
  hint.title = 'Spelades med webbläsarens talsyntes — inspelat klipp saknas eller kunde inte spelas';
  hint.style.color = 'var(--muted)';
  hint.style.fontSize = 'var(--step--1)';
  hint.style.fontStyle = 'italic';
  hint.style.marginLeft = '0.35em';
  hint.style.cursor = 'help';
  el.insertAdjacentElement('afterend', hint);
}

// Turn `el` into a click/keyboard control that plays `audio` (a committed clip
// path, base-prefixed here) with `text` as the TTS fallback. Adds the shared
// .da-clickable affordance class + ARIA and returns a teardown that removes the
// listeners, class/ARIA, and any tts-hint (used by the action's destroy()).
export function enhanceAudio(el: HTMLElement, text: string, audio: string): () => void {
  el.classList.add('da-clickable');
  el.setAttribute('role', 'button');
  el.setAttribute('tabindex', '0');
  el.setAttribute('aria-label', `Lyssna: ${text}`);

  const play = async () => {
    if (playing && playing !== el) playing.classList.remove('is-playing');
    playing = el;
    el.classList.add('is-playing');
    window.setTimeout(() => el.classList.remove('is-playing'), 700);
    const outcome = await speak(text, { audioUrl: withBase(audio) });
    setTtsHint(el, outcome === 'tts');
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      play();
    }
  };

  el.addEventListener('click', play);
  el.addEventListener('keydown', onKey);

  return () => {
    el.removeEventListener('click', play);
    el.removeEventListener('keydown', onKey);
    el.classList.remove('da-clickable', 'is-playing');
    el.removeAttribute('role');
    el.removeAttribute('tabindex');
    el.removeAttribute('aria-label');
    setTtsHint(el, false);
    if (playing === el) playing = null;
  };
}

export interface AudioClickParams {
  text: string;
  audio: string;
}

// Svelte action for reactively-rendered rows. `params` is undefined for words
// without a clip, so they render as plain, non-interactive text — matching the
// normal wordlist, where a missing data-audio leaves the word un-enhanced.
export function audioClick(node: HTMLElement, params?: AudioClickParams) {
  let teardown = params ? enhanceAudio(node, params.text, params.audio) : null;
  return {
    update(next?: AudioClickParams) {
      // Keyed rows keep a stable (text, audio) per id, so this rarely fires;
      // re-enhance defensively in case a node is ever reused for another word.
      teardown?.();
      teardown = next ? enhanceAudio(node, next.text, next.audio) : null;
    },
    destroy() {
      teardown?.();
    },
  };
}

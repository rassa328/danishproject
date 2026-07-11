<script lang="ts">
  // Progressive enhancement for the Ordlista page: makes every Danish word and
  // example that carries a committed clip (data-audio) click-to-hear. One island
  // enhances the whole table (instead of a SpeakButton per row). Simpler than
  // LessonAudio — the clip path is known at build time, so it's read straight off
  // data-audio rather than computed from the lesson manifest.
  import { onMount } from 'svelte';
  import { speak } from '../lib/speech.ts';
  import { withBase } from '../lib/url.ts';

  // Same fallback marker as SpeakButton: when a clip fails and Web Speech is
  // used instead, show a muted 'talsyntes' hint so the learner can tell the
  // curated native clip from the robot voice. Inserted as a sibling (never
  // inside `el`, whose textContent is the spoken text) and styled inline —
  // this island injects into ordlista markup, so scoped styles can't reach it.
  function setTtsHint(el: HTMLElement, show: boolean) {
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

  onMount(() => {
    const els = document.querySelectorAll<HTMLElement>('[data-audio]');
    let playing: HTMLElement | null = null;

    for (const el of els) {
      const audio = el.dataset.audio;
      if (!audio) continue;
      const text = el.textContent ?? '';

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

      el.addEventListener('click', play);
      el.addEventListener('keydown', (e: KeyboardEvent) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          play();
        }
      });
    }
  });
</script>

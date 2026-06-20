<script lang="ts">
  // Progressive enhancement for the Ordlista page: makes every Danish word and
  // example that carries a committed clip (data-audio) click-to-hear. One island
  // enhances the whole table (instead of a SpeakButton per row). Simpler than
  // LessonAudio — the clip path is known at build time, so it's read straight off
  // data-audio rather than computed from the lesson manifest.
  import { onMount } from 'svelte';
  import { speak } from '../lib/speech.ts';
  import { withBase } from '../lib/url.ts';

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
        await speak(text, { audioUrl: withBase(audio) });
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

<script lang="ts">
  // Progressive enhancement: makes every <span lang="da"> in the lesson prose
  // click-to-hear. One island enhances all of them (instead of a component per
  // word). A span's clip id is computed from its text the same way the generator
  // names the file, so a word plays its word clip and a whole sentence span plays
  // the whole-sentence clip. Falls back to Web Speech only when there's no clip.
  import { onMount } from 'svelte';
  import { speak, hasDanishVoice } from '../lib/speech.ts';
  import { withBase } from '../lib/url.ts';
  import { spanAudioId } from '../lib/audio-id.ts';

  let { clips = [] }: { clips?: string[] } = $props();

  onMount(async () => {
    const have = new Set(clips);
    const spans = document.querySelectorAll<HTMLElement>('article.prose [lang="da"]');
    if (spans.length === 0) return;

    // Spans without a committed clip can only use Web Speech, which needs a
    // da-DK voice. Resolve once so voiceless browsers leave those spans as plain
    // text (no dead clicks) while clip-backed spans stay clickable everywhere.
    const voiceFallback = await hasDanishVoice();
    let playing: HTMLElement | null = null;

    for (const el of spans) {
      // Skip Danish words that are already interactive controls (e.g. the
      // MinimalPairs component's play buttons) — they own their own audio.
      if (el.closest('button')) continue;
      const text = el.textContent ?? '';
      // A span may override its pronunciation (stød pairs) via data-ipa/data-say;
      // the same override yields the same clip id the generator wrote.
      const id = spanAudioId(text, { ipa: el.dataset.ipa, say: el.dataset.say });
      const hasClip = have.has(id);
      if (!hasClip && !voiceFallback) continue;

      el.classList.add('da-clickable');
      el.setAttribute('role', 'button');
      el.setAttribute('tabindex', '0');
      el.setAttribute('aria-label', `Lyssna: ${text}`);

      const play = async () => {
        if (playing && playing !== el) playing.classList.remove('is-playing');
        playing = el;
        el.classList.add('is-playing');
        window.setTimeout(() => el.classList.remove('is-playing'), 700);
        const outcome = await speak(text, hasClip ? { audioUrl: withBase(`audio/${id}.mp3`) } : {});
        if (outcome === 'none') {
          // Lost the voice (or clip failed and no voice) — stop pretending it's clickable.
          el.classList.remove('da-clickable', 'is-playing');
          el.removeAttribute('role');
          el.removeAttribute('tabindex');
          el.removeAttribute('aria-label');
        }
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

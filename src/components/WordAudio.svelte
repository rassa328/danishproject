<script lang="ts">
  // Progressive enhancement for the Ordlista page: makes every Danish word and
  // example that carries a committed clip (data-audio) click-to-hear. One island
  // enhances the whole static table; the search island reuses the same helper
  // (enhanceAudio) via a Svelte action on its reactive rows.
  import { onMount } from 'svelte';
  import { enhanceAudio } from '../lib/word-audio.ts';

  onMount(() => {
    const teardowns: Array<() => void> = [];
    for (const el of document.querySelectorAll<HTMLElement>('[data-audio]')) {
      const audio = el.dataset.audio;
      if (!audio) continue;
      teardowns.push(enhanceAudio(el, el.textContent ?? '', audio));
    }
    return () => teardowns.forEach((t) => t());
  });
</script>

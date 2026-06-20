<script lang="ts">
  // Marks a lesson read once the learner reaches the end of its content (the
  // #lesson-end sentinel scrolls into view), then shows a quiet badge. A short
  // lesson whose end is already on screen counts as read on open. Client-only.
  import { onMount } from 'svelte';
  import { Store } from '../lib/storage.ts';
  import { UI } from '../lib/strings.ts';

  let { lessonId }: { lessonId: string } = $props();
  let read = $state(false);

  onMount(() => {
    const store = new Store();
    if (store.isLessonComplete(lessonId)) {
      read = true;
      return;
    }
    const markRead = () => {
      store.markLessonComplete(lessonId, Date.now());
      read = true;
    };
    const sentinel = document.getElementById('lesson-end');
    if (!sentinel) {
      markRead(); // defensive: no sentinel present, fall back to marking on mount
      return;
    }
    const obs = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        markRead();
        obs.disconnect();
      }
    });
    obs.observe(sentinel);
    return () => obs.disconnect();
  });
</script>

{#if read}
  <span class="read-badge">{UI.lessons.readBadge}</span>
{/if}

<style>
  .read-badge {
    color: var(--correct);
    font-size: var(--step--1);
    font-weight: 600;
  }
</style>

<script lang="ts">
  // Marks a lesson as read once it's been opened, and shows a quiet badge. The
  // completion flag feeds the lessons-index progress count. Client-only.
  import { onMount } from 'svelte';
  import { Store } from '../lib/storage.ts';
  import { UI } from '../lib/strings.ts';

  let { lessonId }: { lessonId: string } = $props();
  let read = $state(false);

  onMount(() => {
    const store = new Store();
    if (!store.isLessonComplete(lessonId)) store.markLessonComplete(lessonId, Date.now());
    read = true;
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

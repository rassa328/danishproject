<script lang="ts">
  // "Du har läst X av Y lektioner." — quiet progress line on the lessons index.
  // Client-only; reads the completion flags written by LessonProgress.
  import { onMount } from 'svelte';
  import { Store } from '../lib/storage.ts';
  import { UI } from '../lib/strings.ts';

  let { ids }: { ids: string[] } = $props();
  let done = $state(0);
  let ready = $state(false);

  onMount(() => {
    const store = new Store();
    done = ids.filter((id) => store.isLessonComplete(id)).length;
    ready = true;
  });
</script>

{#if ready && done > 0}
  <p class="lessons-progress">{UI.lessons.progress(done, ids.length)}</p>
{/if}

<style>
  .lessons-progress {
    color: var(--muted);
    font-size: var(--step--1);
    margin: var(--sp-2) 0 0;
  }
</style>

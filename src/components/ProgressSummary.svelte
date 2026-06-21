<script lang="ts">
  // Light, client-only progress line. Reads localStorage on mount (SSR-safe via
  // the Store's memoryKV fallback) and shows how far the learner has come. No
  // gamification — just a quiet sense of progress.
  import { onMount } from 'svelte';
  import { Store } from '../lib/storage.ts';
  import { UI } from '../lib/strings.ts';

  let { total }: { total: number } = $props();

  let started = $state(0);
  let due = $state(0);
  let streak = $state(0);
  let ready = $state(false);

  onMount(() => {
    const store = new Store();
    started = store.startedCount();
    due = store.dueCount();
    streak = store.getStreak();
    ready = true;
  });
</script>

{#if ready && started > 0}
  <p class="progress-summary">
    {UI.progress.words(started, total)}
    <span class="sep">·</span>
    {due > 0 ? UI.progress.due(due) : UI.progress.dueNone}
    {#if streak > 0}<span class="sep">·</span>{UI.progress.streak(streak)}{/if}
  </p>
{/if}

<style>
  .progress-summary {
    color: var(--muted);
    font-size: var(--step--1);
    margin: var(--sp-4) 0 0;
  }
  .sep { opacity: 0.5; margin: 0 0.25em; }
</style>

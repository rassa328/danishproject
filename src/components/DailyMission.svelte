<script lang="ts">
  // A daily speaking task — the one thing that actually builds production fluency.
  // The prompt (and optional focus words) are chosen deterministically by date so
  // they're stable through the day and rotate tomorrow; completion is persisted.
  import { onMount } from 'svelte';
  import { Store } from '../lib/storage.ts';
  import { UI } from '../lib/strings.ts';

  // A pool of Danish headwords to optionally weave into the task.
  let { pool = [] }: { pool?: string[] } = $props();
  const T = UI.practice;

  let store: Store;
  let today = $state('');
  let mission = $state('');
  let words = $state<string[]>([]);
  let done = $state(false);

  const pick = <X,>(arr: X[], seed: number, n = 1): X[] => {
    const out: X[] = [];
    for (let i = 0; i < n && i < arr.length; i++) out.push(arr[(seed + i * 7) % arr.length] as X);
    return out;
  };

  onMount(() => {
    store = new Store();
    const now = new Date();
    today = now.toISOString().slice(0, 10);
    const dayNum = Math.floor(Date.parse(today) / 86_400_000);
    mission = pick(T.missions as unknown as string[], dayNum, 1)[0] ?? '';
    if (pool.length) words = pick([...new Set(pool)], dayNum * 3, 3);
    done = store.isMissionDone(today);
  });

  function toggle() {
    done = !done;
    store.setMissionDone(today, done);
  }
</script>

{#if mission}
  <div class="mission" class:is-done={done}>
    <h3>{T.missionTitle}</h3>
    <p class="task">{mission}</p>
    {#if words.length}
      <p class="focus">{T.focusWords} <span lang="da">{words.join(', ')}</span></p>
    {/if}
    <button type="button" onclick={toggle} aria-pressed={done}>
      {done ? T.missionDone : T.missionMarkDone}
    </button>
  </div>
{/if}

<style>
  .mission {
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--surface);
    padding: var(--sp-4) var(--sp-6);
  }
  .mission.is-done { border-color: var(--correct); }
  .mission h3 { margin: 0 0 var(--sp-2); color: var(--accent); font-size: var(--step-0); }
  .task { margin: 0 0 var(--sp-2); font-size: var(--step-1); }
  .focus { margin: 0 0 var(--sp-3); color: var(--muted); font-size: var(--step--1); }
  .focus span[lang='da'] { color: var(--text); font-weight: 600; }
</style>

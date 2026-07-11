<script lang="ts">
  // A daily speaking task — the one thing that actually builds production fluency.
  // The prompt (and optional focus words) are chosen deterministically by date so
  // they're stable through the day and rotate tomorrow; completion is persisted.
  import { onMount } from 'svelte';
  import Waveform from './Waveform.svelte';
  import { Store } from '../lib/storage.ts';
  import { localDayIso, dayNumber } from '../lib/day.ts';
  import { speak } from '../lib/speech.ts';
  import { withBase } from '../lib/url.ts';
  import { UI } from '../lib/strings.ts';

  // Danish headwords (with their clip when one exists) to optionally weave into
  // the task. Click-to-hear, so the speaking task never starts from silent text.
  interface FocusWord {
    danish: string;
    audio?: string;
  }
  let { pool = [] }: { pool?: FocusWord[] } = $props();
  const T = UI.practice;

  let store: Store;
  let today = $state('');
  let mission = $state('');
  let words = $state<FocusWord[]>([]);
  let done = $state(false);
  // Per-word waveform sweep counters (keyed by the Danish form).
  let pulses = $state<Record<string, number>>({});

  const pick = <X,>(arr: X[], seed: number, n = 1): X[] => {
    const out: X[] = [];
    for (let i = 0; i < n && i < arr.length; i++) out.push(arr[(seed + i * 7) % arr.length] as X);
    return out;
  };

  onMount(() => {
    store = new Store();
    const now = new Date();
    today = localDayIso(now);
    const dayNum = dayNumber(now);
    mission = pick(T.missions as unknown as string[], dayNum, 1)[0] ?? '';
    if (pool.length) {
      // De-dupe by the Danish form (same policy as the old string pool).
      const uniq = [...new Map(pool.map((w) => [w.danish, w])).values()];
      words = pick(uniq, dayNum * 3, 3);
    }
    done = store.isMissionDone(today);
  });

  async function hear(w: FocusWord) {
    // Clip when committed, Web Speech da-DK otherwise (speech.ts degrades).
    const outcome = await speak(w.danish, w.audio ? { audioUrl: withBase(w.audio) } : {});
    if (outcome === 'audio' || outcome === 'tts') {
      pulses = { ...pulses, [w.danish]: (pulses[w.danish] ?? 0) + 1 };
    }
  }

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
      <p class="focus">
        {T.focusWords}
        {#each words as w, i (w.danish)}
          {#if i > 0}<span aria-hidden="true">, </span>{/if}
          <button
            type="button"
            class="word"
            lang="da"
            onclick={() => hear(w)}
            title={T.hearWord(w.danish)}
          >{w.danish} <span class="icon"><Waveform size="icon" pulse={pulses[w.danish] ?? 0} /></span></button>
        {/each}
      </p>
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
  /* Compact click-to-hear: the word itself is the control (same dotted-underline
     affordance as the lesson/ordlista click-to-hear pattern). */
  .word {
    background: none;
    border: none;
    padding: 0;
    font: inherit;
    color: var(--text);
    font-weight: 600;
    cursor: pointer;
    text-decoration: underline dotted;
    text-underline-offset: 0.2em;
    text-decoration-color: var(--muted);
    border-radius: 3px;
  }
  .word:hover,
  .word:focus-visible { text-decoration-color: var(--accent); }
  .word:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  .word .icon { font-size: 0.8em; }
</style>

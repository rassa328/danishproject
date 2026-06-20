<script lang="ts">
  // End-of-lesson self-check: a couple of multiple-choice questions. Pure
  // client interaction (no persistence) — a quick "did it stick?" before the
  // learner moves on to flashcards.
  import { UI } from '../lib/strings.ts';

  type Q = { q: string; options: string[]; answer: number };
  let { items }: { items: Q[] } = $props();

  // picks[i] = chosen option index for question i, or -1 if unanswered.
  let picks = $state<number[]>(items.map(() => -1));

  const allCorrect = $derived(items.length > 0 && items.every((it, i) => picks[i] === it.answer));
  const allAnswered = $derived(picks.every((p) => p !== -1));

  function pick(qi: number, oi: number) {
    if (picks[qi] !== -1) return; // lock after first answer
    picks[qi] = oi;
  }
  function reset() {
    picks = items.map(() => -1);
  }
</script>

{#if items.length > 0}
  <section class="checkpoint" aria-label={UI.checkpoint.heading}>
    <h2>{UI.checkpoint.heading}</h2>
    <p class="intro">{UI.checkpoint.intro}</p>

    {#each items as it, qi}
      <fieldset>
        <legend>{it.q}</legend>
        <div class="opts">
          {#each it.options as opt, oi}
            <button
              type="button"
              class:correct={picks[qi] !== -1 && oi === it.answer}
              class:wrong={picks[qi] === oi && oi !== it.answer}
              disabled={picks[qi] !== -1}
              onclick={() => pick(qi, oi)}
            >
              {opt}
            </button>
          {/each}
        </div>
        {#if picks[qi] !== -1}
          <p class={picks[qi] === it.answer ? 'fb ok' : 'fb no'}>
            {picks[qi] === it.answer ? UI.checkpoint.correct : UI.checkpoint.wrong}
          </p>
        {/if}
      </fieldset>
    {/each}

    {#if allAnswered}
      {#if allCorrect}
        <p class="done">{UI.checkpoint.done}</p>
      {:else}
        <button type="button" class="reset" onclick={reset}>{UI.checkpoint.reset}</button>
      {/if}
    {/if}
  </section>
{/if}

<style>
  .checkpoint { margin-top: var(--sp-8); padding: var(--sp-4) var(--sp-6); border: 1px solid var(--border); border-radius: var(--radius); background: var(--surface); }
  .checkpoint h2 { margin-top: 0; }
  .intro { color: var(--muted); font-size: var(--step--1); margin-top: 0; }
  fieldset { border: 0; padding: 0; margin: var(--sp-4) 0 0; }
  legend { font-weight: 600; padding: 0; }
  .opts { display: grid; gap: var(--sp-2); margin-top: var(--sp-2); }
  .opts button { text-align: left; min-height: var(--min-tap); }
  .opts button.correct { border-color: var(--correct); color: var(--correct); font-weight: 600; }
  .opts button.wrong { border-color: var(--accent); color: var(--accent); }
  .fb { font-size: var(--step--1); margin: var(--sp-2) 0 0; }
  .fb.ok { color: var(--correct); }
  .fb.no { color: var(--accent); }
  .done { margin-top: var(--sp-4); color: var(--correct); font-weight: 600; }
  .reset { margin-top: var(--sp-4); }
</style>

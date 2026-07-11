<script lang="ts">
  import Waveform from './Waveform.svelte';
  import { speak } from '../lib/speech.ts';
  import { lessonAudioId } from '../lib/audio-id.ts';
  import { withBase } from '../lib/url.ts';
  import { UI } from '../lib/strings.ts';

  // Clip ids are derived at runtime, never hardcoded — same contract as the
  // lesson audio spans. Both clips are committed (voiced for lesson 01).
  const clipUrl = (word: string) => withBase(`audio/${lessonAudioId(word)}.mp3`);

  let pulse = $state(0);
  let playing = $state(false);
  let noAudio = $state(false);

  async function play() {
    if (playing) return;
    playing = true;
    noAudio = false;
    // The click IS the user gesture, so pulse at once — playback starts with it.
    pulse += 1;
    const first = await speak('hun', { audioUrl: clipUrl('hun'), awaitEnd: true });
    if (first === 'blocked' || first === 'none') {
      // 'blocked' shouldn't happen from a click; either way the button itself
      // is the retry affordance. 'none' additionally gets a text note.
      noAudio = first === 'none';
      playing = false;
      return;
    }
    if (first === 'cancelled') {
      playing = false;
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 350));
    pulse += 1;
    await speak('hund', { audioUrl: clipUrl('hund'), awaitEnd: true });
    playing = false;
  }
</script>

<figure class="sample">
  <Waveform size="hero" {pulse} />
  <div class="row">
    <button type="button" onclick={play} disabled={playing} aria-label={UI.home.sampleAria}>
      {UI.home.samplePlay}
    </button>
    <figcaption>
      <span lang="da">{UI.home.sampleWordsDa}</span> — {UI.home.sampleCaption}
    </figcaption>
  </div>
  {#if noAudio}
    <p class="novoice" role="status">{UI.flashcards.noAudio}</p>
  {/if}
</figure>

<style>
  /* Fixed-shape block: identical SSR and hydrated markup + reserved heights,
     so the client:idle hydration causes zero layout shift. */
  .sample {
    margin: var(--sp-6) 0 0;
    min-height: 8rem;
  }
  .row {
    display: flex;
    align-items: center;
    gap: var(--sp-4);
    flex-wrap: wrap;
    margin-top: var(--sp-3);
  }
  button {
    min-height: var(--min-tap);
    white-space: nowrap;
  }
  figcaption {
    color: var(--muted);
    font-size: var(--step--1);
  }
  .novoice {
    color: var(--muted);
    font-size: var(--step--1);
    margin: var(--sp-2) 0 0;
  }
</style>

<script lang="ts">
  import Waveform from './Waveform.svelte';
  import { speak } from '../lib/speech.ts';
  import { lessonAudioId } from '../lib/audio-id.ts';
  import { withBase } from '../lib/url.ts';
  import { UI } from '../lib/strings.ts';
  // Real per-word envelopes extracted from the committed clips by
  // scripts/waveform-data.ts — the bars ARE the words' actual audio shapes
  // (hund's accent bars mark its real stød dip). Baked at build: SSR renders
  // the exact waveforms, so hydration shifts nothing.
  import heroWaveform from '../data/hero-waveform.json';

  // Clip ids are derived at runtime, never hardcoded — same contract as the
  // lesson audio spans. Both clips are committed (voiced for lesson 01).
  const clipUrl = (word: string) => withBase(`audio/${lessonAudioId(word)}.mp3`);

  // Each word's waveform sweeps only while ITS word plays.
  let pulseA = $state(0);
  let pulseB = $state(0);
  let playing = $state(false);
  let noAudio = $state(false);

  async function play() {
    if (playing) return;
    playing = true;
    noAudio = false;
    // The click IS the user gesture, so pulse at once — playback starts with it.
    pulseA += 1;
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
    pulseB += 1;
    await speak('hund', { audioUrl: clipUrl('hund'), awaitEnd: true });
    playing = false;
  }
</script>

<figure class="sample">
  <div class="pair" aria-hidden="true">
    <span class="word-wf">
      <Waveform size="word" data={heroWaveform.hun} pulse={pulseA} />
      <span class="label" lang="da">{UI.home.sampleWordA}</span>
    </span>
    <span class="word-wf">
      <Waveform size="word" data={heroWaveform.hund} pulse={pulseB} />
      <span class="label" lang="da">{UI.home.sampleWordB}</span>
    </span>
  </div>
  <div class="row">
    <button type="button" onclick={play} disabled={playing} aria-label={UI.home.sampleAria}>
      {UI.home.samplePlay}
    </button>
    <figcaption>
      <span lang="da">{UI.home.sampleWordA} · {UI.home.sampleWordB}</span> — {UI.home.sampleCaption}
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
    min-height: 13rem;
  }
  .pair {
    display: flex;
    align-items: flex-end;
    gap: var(--sp-6);
    flex-wrap: wrap;
  }
  .word-wf {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--sp-1);
  }
  .label {
    color: var(--muted);
    font-size: var(--step--1);
    font-weight: 600;
  }
  .row {
    display: flex;
    align-items: center;
    gap: var(--sp-4);
    flex-wrap: wrap;
    margin-top: var(--sp-4);
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

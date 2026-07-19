<script lang="ts">
  import { speak } from '../lib/speech.ts';
  import { lessonAudioId } from '../lib/audio-id.ts';
  import { withBase } from '../lib/url.ts';
  import { UI } from '../lib/strings.ts';
  // Real per-word envelopes extracted from the committed clips by
  // scripts/waveform-data.ts — the bars ARE the words' actual audio shapes
  // (hund's dip bars mark its real stød dip). Baked at build so SSR renders the
  // exact waveform and hydration shifts nothing.
  import heroWaveform from '../data/hero-waveform.json';

  interface Props {
    lessonHref: string;
  }
  const { lessonHref }: Props = $props();

  // Redesign waveform geometry: div bars, 7px wide, each height = max(6, h*92)px
  // inside a 96px track; hund's dip bars render red.
  const SCALE = 92;
  const FLOOR = 6;
  type Wave = { heights: number[]; dip?: [number, number] };
  const toBars = (w: Wave) =>
    w.heights.map((h, i) => ({
      i,
      h: Math.round(Math.max(FLOOR, h * SCALE)),
      dip: !!(w.dip && i >= w.dip[0] && i < w.dip[0] + w.dip[1]),
    }));
  const hunBars = toBars(heroWaveform.hun as Wave);
  const hundBars = toBars(heroWaveform.hund as Wave);

  // Clip ids are derived at runtime, never hardcoded — same contract as the
  // lesson audio spans. Both clips are committed (voiced for lesson 01).
  const clipUrl = (word: string) => withBase(`audio/${lessonAudioId(word)}.mp3`);

  // phase: 0 idle · 1 playing "hun" · 2 playing "hund". pulseA/pulseB remount
  // each word's bar row so the CSS sweep restarts on every replay.
  let phase = $state(0);
  let pulseA = $state(0);
  let pulseB = $state(0);
  let noAudio = $state(false);

  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

  async function play() {
    if (phase) return;
    noAudio = false;
    // The click IS the user gesture, so start the "hun" sweep with it.
    phase = 1;
    pulseA += 1;
    const first = await Promise.all([speak('hun', { audioUrl: clipUrl('hun'), awaitEnd: true }), wait(1000)]).then(
      ([o]) => o,
    );
    if (first === 'blocked' || first === 'none') {
      noAudio = first === 'none';
      phase = 0;
      return;
    }
    if (first === 'cancelled') {
      phase = 0;
      return;
    }
    await wait(250);
    phase = 2;
    pulseB += 1;
    await Promise.all([speak('hund', { audioUrl: clipUrl('hund'), awaitEnd: true }), wait(1000)]);
    phase = 0;
  }
</script>

<div class="stod">
  <div class="text">
    <span class="eyebrow">{UI.nav.lessons}</span>
    <h2 class="title">Stød</h2>
    <p class="copy">
      <span lang="da" class="pair">hun · hund</span> — samma bokstäver, olika ord. Stødet är hela skillnaden.
    </p>
    <a class="to-lesson" href={lessonHref}>Till lektionen →</a>
  </div>

  <div class="player">
    <button
      type="button"
      class="play"
      class:playing={phase !== 0}
      onclick={play}
      aria-label={UI.home.sampleAria}
    >
      <span class="waves" aria-hidden="true">
        <span class="group">
          {#key pulseA}
            <span class="bars" class:active={phase === 1}>
              {#each hunBars as bar}
                <span class="bar" class:dip={bar.dip} style={`height:${bar.h}px;animation-delay:${bar.i * 45}ms`}
                ></span>
              {/each}
            </span>
          {/key}
          <span class="label" lang="da">{UI.home.sampleWordA}</span>
        </span>
        <span class="group">
          {#key pulseB}
            <span class="bars" class:active={phase === 2}>
              {#each hundBars as bar}
                <span class="bar" class:dip={bar.dip} style={`height:${bar.h}px;animation-delay:${bar.i * 45}ms`}
                ></span>
              {/each}
            </span>
          {/key}
          <span class="label" lang="da">{UI.home.sampleWordB}</span>
        </span>
      </span>
      <span class="play-circle" aria-hidden="true">▶</span>
    </button>
    {#if noAudio}
      <p class="novoice" role="status">{UI.flashcards.noAudio}</p>
    {/if}
  </div>
</div>

<style>
  .stod {
    grid-column: 1 / -1;
    display: flex;
    align-items: center;
    gap: 36px;
    flex-wrap: wrap;
    background: var(--card);
    border: 1px solid var(--bd1);
    border-radius: 20px;
    padding: 28px clamp(20px, 5vw, 36px);
    box-sizing: border-box;
    box-shadow:
      0 1px 2px var(--sh1),
      0 16px 40px var(--sh2);
  }

  .text {
    flex: 1 1 220px;
    min-width: 220px;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 6px;
  }
  .eyebrow {
    font-size: 13.5px;
    font-weight: 600;
    color: var(--ink);
  }
  .title {
    font-family: var(--font-serif);
    font-size: 27px;
    font-weight: 600;
    letter-spacing: -0.01em;
    margin: 0;
    line-height: 1.1;
    color: var(--ink);
  }
  .copy {
    margin: 4px 0 0;
    font-size: 13.5px;
    line-height: 1.55;
    color: var(--mut1);
    max-width: 280px;
  }
  .copy .pair {
    font-weight: 600;
    color: var(--ink);
  }
  .to-lesson {
    /* Touch hit area ~45px tall: padding grows the box, the negative vertical
       margins keep the visual position exactly where the bare link sat. */
    margin: -4px 0 -12px;
    padding: 12px 16px 12px 0;
    font-size: 13px;
    color: var(--mut1);
    text-decoration: none;
    transition: color 120ms ease;
  }
  .to-lesson:hover,
  .to-lesson:focus-visible {
    color: var(--red);
  }

  .player {
    flex: 1 1 300px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
  }
  /* Chromeless single accessible control: wraps both waveform groups and the ▶
     affordance (the reference used a duplicate aria-hidden click target). */
  .play {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 14px;
    width: 100%;
    margin: 0;
    padding: 0;
    background: none;
    border: none;
    cursor: pointer;
    font: inherit;
  }
  .play.playing {
    cursor: default;
  }
  .play:hover {
    border: none;
  }
  .waves {
    display: flex;
    align-items: flex-end;
    justify-content: center;
    gap: clamp(28px, 8vw, 52px);
    width: 100%;
  }
  .group {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
  }
  .bars {
    display: flex;
    align-items: center;
    gap: 5px;
    height: 96px;
  }
  .bar {
    flex: none;
    width: 7px;
    border-radius: 4px;
    background: var(--bars);
    transform-origin: center;
  }
  .bar.dip {
    background: var(--red);
  }
  @media (prefers-reduced-motion: no-preference) {
    .bars.active .bar {
      animation: wfPulse 600ms ease-in-out both;
    }
  }
  .label {
    font-size: 13px;
    font-weight: 600;
    color: var(--mut1);
  }
  .play-circle {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 36px;
    height: 36px;
    border-radius: 999px;
    border: 1px solid var(--bd4);
    background: var(--card);
    color: var(--mut1);
    font-size: 11px;
    padding-left: 2px;
    box-sizing: border-box;
    transition:
      border-color 120ms ease,
      color 120ms ease;
  }
  .play:hover .play-circle,
  .play:focus-visible .play-circle {
    border-color: var(--red);
    color: var(--red);
  }
  .novoice {
    color: var(--mut1);
    font-size: 12.5px;
    margin: 8px 0 0;
    text-align: center;
  }
</style>

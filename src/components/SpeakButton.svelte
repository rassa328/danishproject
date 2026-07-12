<script lang="ts">
  import { onMount } from 'svelte';
  import Waveform from './Waveform.svelte';
  import { speak, hasDanishVoice } from '../lib/speech.ts';
  import { withBase } from '../lib/url.ts';

  let {
    text,
    audio,
    label = 'Lyssna',
    ariaLabel,
    showLabel = true,
    bars,
    barWidth = 3.5,
    barGap = 3,
  }: {
    text: string;
    audio?: string;
    label?: string;
    /** Answer-safe accessible label. The default aria-label includes the Danish
     *  text; listening exercises pass e.g. 'Lyssna på ordet' so the answer
     *  isn't leaked to screen readers or tooltip surfaces. */
    ariaLabel?: string;
    /** When false, render only the waveform glyph (no visible text) — the
     *  accessible name stays on the aria-label. */
    showLabel?: boolean;
    /** Bar heights (px). When set, the glyph is the listen-mode voice graph —
     *  pure-gray span bars on a boxless button — instead of the boxed SVG
     *  waveform (template §speaker, at inline scale). */
    bars?: number[];
    barWidth?: number;
    barGap?: number;
  } = $props();

  let available = $state(true);
  let fellBack = $state(false); // last playback used Web Speech, not a curated clip
  let pulse = $state(0); // waveform sweep counter — bump only when sound starts

  onMount(async () => {
    available = !!audio || (await hasDanishVoice());
  });

  async function play() {
    const outcome = await speak(text, audio ? { audioUrl: withBase(audio) } : {});
    if (outcome === 'none') available = false;
    fellBack = outcome === 'tts';
    if (outcome === 'audio' || outcome === 'tts') pulse += 1;
  }

  /** Pulse the waveform once, as if pressed — for playback the parent triggered
   *  externally (e.g. the flashcards reveal auto-speech), so the glyph animates
   *  in sync with sound this button didn't itself start. */
  export function flash() {
    pulse += 1;
  }
</script>

{#if available}
  <button type="button" class="speak" class:bars={!!bars} onclick={play} aria-label={ariaLabel ?? `${label} på danska: ${text}`}>
    {#if bars}<span class="wave" class:animate={pulse > 0} aria-hidden="true" style={`gap:${barGap}px`}>
        {#key pulse}
          {#each bars as h, i (i)}
            <span class="bar" style={`width:${barWidth}px;height:${h}px;animation-delay:${i * 55}ms`}></span>
          {/each}
        {/key}
      </span>{:else}<Waveform size="icon" {pulse} />{/if}{#if showLabel} {label}{/if}
  </button>{#if fellBack}<span
      class="tts-hint"
      title="Spelades med webbläsarens talsyntes — inspelat klipp saknas eller kunde inte spelas"
      >talsyntes</span
    >{/if}
{:else}
  <span class="novoice" title="Ingen dansk talsyntes i den här webbläsaren"
    ><span aria-hidden="true">🔇</span> Ingen dansk röst</span
  >
{/if}

<style>
  .speak {
    display: inline-flex;
    align-items: center;
    gap: 0.3em;
    font-size: var(--step--1);
    min-height: var(--min-tap);
  }
  /* Voice-graph variant: no box — the bars ARE the control. Padding + equal
     negative margin keeps a finger-sized hit area without visually widening
     the gap the flex parent set. */
  .speak.bars {
    background: none;
    border: none;
    padding: 10px;
    margin: -10px;
    min-height: 0;
  }
  .wave { display: inline-flex; align-items: center; }
  .bar {
    flex: none;
    border-radius: 2px;
    background: var(--bars);
    transform-origin: center;
  }
  .speak.bars:hover .bar,
  .speak.bars:focus-visible .bar { background: var(--ink); }
  @media (prefers-reduced-motion: no-preference) {
    .wave.animate .bar { animation: bar-pulse 500ms ease-in-out both; }
  }
  @keyframes bar-pulse {
    0% { transform: scaleY(1); }
    50% { transform: scaleY(1.35); }
    100% { transform: scaleY(1); }
  }
  .novoice {
    color: var(--muted);
    font-size: var(--step--1);
  }
  .tts-hint {
    color: var(--muted);
    font-size: var(--step--1);
    font-style: italic;
    margin-left: 0.35em;
    cursor: help;
  }
</style>

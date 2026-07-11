<script lang="ts">
  import { onMount } from 'svelte';
  import { speak, hasDanishVoice } from '../lib/speech.ts';
  import { withBase } from '../lib/url.ts';

  let {
    text,
    audio,
    label = 'Lyssna',
    ariaLabel,
  }: {
    text: string;
    audio?: string;
    label?: string;
    /** Answer-safe accessible label. The default aria-label includes the Danish
     *  text; listening exercises pass e.g. 'Lyssna på ordet' so the answer
     *  isn't leaked to screen readers or tooltip surfaces. */
    ariaLabel?: string;
  } = $props();

  let available = $state(true);
  let fellBack = $state(false); // last playback used Web Speech, not a curated clip

  onMount(async () => {
    available = !!audio || (await hasDanishVoice());
  });

  async function play() {
    const outcome = await speak(text, audio ? { audioUrl: withBase(audio) } : {});
    if (outcome === 'none') available = false;
    fellBack = outcome === 'tts';
  }
</script>

{#if available}
  <button type="button" class="speak" onclick={play} aria-label={ariaLabel ?? `${label} på danska: ${text}`}>
    <span aria-hidden="true">🔊</span> {label}
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

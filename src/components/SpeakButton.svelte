<script lang="ts">
  import { onMount } from 'svelte';
  import { speak, hasDanishVoice } from '../lib/speech.ts';
  import { withBase } from '../lib/url.ts';

  let {
    text,
    audio,
    label = 'Lyssna',
  }: { text: string; audio?: string; label?: string } = $props();

  let available = $state(true);

  onMount(async () => {
    available = !!audio || (await hasDanishVoice());
  });

  async function play() {
    const outcome = await speak(text, audio ? { audioUrl: withBase(audio) } : {});
    if (outcome === 'none') available = false;
  }
</script>

{#if available}
  <button type="button" class="speak" onclick={play} aria-label={`${label} på danska: ${text}`}>
    🔊 {label}
  </button>
{:else}
  <span class="novoice" title="Ingen dansk talsyntes i den här webbläsaren">🔇 Ingen dansk röst</span>
{/if}

<style>
  .speak {
    display: inline-flex;
    align-items: center;
    gap: 0.3em;
    font-size: var(--step--1);
  }
  .novoice {
    color: var(--muted);
    font-size: var(--step--1);
  }
</style>

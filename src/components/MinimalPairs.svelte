<script lang="ts">
  // Minimal-pair reference table (lesson prose), rendered as the handoff
  // template's grid: each Danish word is a play button with an audio bar glyph
  // (utan-stød = 3 grey bars; med-stød = 4 bars with a red 3rd — the visual
  // stød dip), the italic note stays inline with its word, and the sense sits
  // in the third column. Playback reuses the committed-clip pipeline
  // (spanAudioId + speak) — never TTS-first; `ipa` disambiguates stød homographs.
  import { speak } from '../lib/speech.ts';
  import { spanAudioId } from '../lib/audio-id.ts';
  import { withBase } from '../lib/url.ts';

  interface Pair {
    a: string;
    aIpa?: string;
    aNote?: string;
    b: string;
    bIpa?: string;
    bNote?: string;
    sense: string;
  }
  interface Props {
    pairs: Pair[];
    caption?: string;
  }
  const { pairs, caption }: Props = $props();

  // Glyph geometry (template §8c/§8d): utan-stød 3 bars 6/12/8 grey; med-stød
  // 4 bars 6/12/4/9 with the 3rd red.
  const UTAN = [
    { h: 6, dip: false },
    { h: 12, dip: false },
    { h: 8, dip: false },
  ];
  const MED = [
    { h: 6, dip: false },
    { h: 12, dip: false },
    { h: 4, dip: true },
    { h: 9, dip: false },
  ];

  // Which cell is currently animating, and a monotonic counter to restart the
  // CSS sweep on repeat plays of the same cell.
  let playingKey = $state('');
  let pulse = $state(0);

  const clipUrl = (word: string, ipa?: string) =>
    withBase(`audio/${spanAudioId(word, ipa ? { ipa } : {})}.mp3`);

  async function play(key: string, word: string, ipa: string | undefined) {
    playingKey = key;
    pulse += 1;
    await speak(word, { audioUrl: clipUrl(word, ipa) });
    if (playingKey === key) playingKey = '';
  }
</script>

<div class="minimal-pairs">
  {#if caption}<p class="mp-caption">{caption}</p>{/if}
  <div class="mp-grid">
    <div class="mp-row mp-head" aria-hidden="true">
      <span>Utan stød</span>
      <span>Med stød</span>
      <span>Betydelse</span>
    </div>
    {#each pairs as pair, i (i)}
      {@const keyA = `${i}-a`}
      {@const keyB = `${i}-b`}
      <div class="mp-row">
        <span class="mp-cell">
          <button
            type="button"
            class="mp-word"
            lang="da"
            aria-label={`Spela ${pair.a} — utan stød`}
            onclick={() => play(keyA, pair.a, pair.aIpa)}
          >
            {pair.a}
            <span class="glyph" class:playing={playingKey === keyA} aria-hidden="true">
              {#key playingKey === keyA ? pulse : 0}
                {#each UTAN as bar, j (j)}
                  <span class="bar" style={`height:${bar.h}px;animation-delay:${j * 55}ms`}></span>
                {/each}
              {/key}
            </span>
          </button>
          {#if pair.aNote}<span class="mp-note">{pair.aNote}</span>{/if}
        </span>
        <span class="mp-cell">
          <button
            type="button"
            class="mp-word"
            lang="da"
            aria-label={`Spela ${pair.b} — med stød`}
            onclick={() => play(keyB, pair.b, pair.bIpa)}
          >
            {pair.b}
            <span class="glyph" class:playing={playingKey === keyB} aria-hidden="true">
              {#key playingKey === keyB ? pulse : 0}
                {#each MED as bar, j (j)}
                  <span class="bar" class:dip={bar.dip} style={`height:${bar.h}px;animation-delay:${j * 55}ms`}
                  ></span>
                {/each}
              {/key}
            </span>
          </button>
          {#if pair.bNote}<span class="mp-note">{pair.bNote}</span>{/if}
        </span>
        <span class="mp-sense">{pair.sense}</span>
      </div>
    {/each}
  </div>
</div>

<style>
  .minimal-pairs {
    margin: 8px 0 0;
  }
  .mp-caption {
    margin: 8px 0 0;
    font-size: 13px;
    color: var(--mut3);
  }
  .mp-grid {
    display: flex;
    flex-direction: column;
    margin-top: 18px;
  }
  .mp-row {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
    gap: 14px 20px;
    padding: 13px 2px;
    border-bottom: 1px solid var(--bd2);
    align-items: baseline;
  }
  .mp-head {
    padding: 8px 2px;
    border-bottom: 1px solid var(--bd3);
  }
  .mp-head span {
    font-family: var(--font-mono);
    font-size: 10.5px;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--mut3);
  }
  /* Word + its inline note. The word/glyph button never breaks; the note may
     wrap below it but stays with its own word. */
  .mp-cell {
    min-width: 0;
    display: inline-flex;
    align-items: baseline;
    gap: 8px;
    flex-wrap: wrap;
  }
  .mp-word {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    white-space: nowrap;
    font: inherit;
    font-size: 15px;
    font-weight: 600;
    color: var(--ink);
    background: none;
    border: none;
    padding: 0;
    cursor: pointer;
    transition: color 120ms ease;
  }
  .mp-word:hover,
  .mp-word:focus-visible {
    color: var(--red);
  }
  .mp-word:focus-visible {
    outline: 2px solid var(--red);
    outline-offset: 3px;
    border-radius: 3px;
  }
  .glyph {
    display: inline-flex;
    align-items: center;
    gap: 2px;
  }
  .bar {
    flex: none;
    width: 2.5px;
    border-radius: 2px;
    background: var(--mut4);
    transform-origin: center;
  }
  .bar.dip {
    background: var(--red);
  }
  @media (prefers-reduced-motion: no-preference) {
    .glyph.playing .bar {
      animation: wfPulse 500ms ease-in-out both;
    }
  }
  .mp-note {
    font-size: 12.5px;
    color: var(--mut3);
    font-style: italic;
  }
  .mp-sense {
    min-width: 0;
    font-size: 13px;
    line-height: 1.5;
    color: var(--mut2);
  }
</style>

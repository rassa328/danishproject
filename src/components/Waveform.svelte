<script lang="ts">
  import { waveformSpec, waveformSpecFromHeights, type WaveformSize, type RealWaveform } from '../lib/waveform.ts';

  let {
    size = 'icon',
    pulse = 0,
    data,
  }: {
    /** 'word' is a CSS-only variant (hero word-waveforms): height-based sizing
     *  so svgs with different bar counts share one scale. Always pass `data`
     *  with it — waveformSpec() has no 'word' pattern. */
    size?: WaveformSize | 'word';
    /** Monotonic counter: increment on every playback start ('audio'|'tts'
     *  outcomes). Each increment remounts the bars ({#key}) and replays the
     *  left-to-right sweep. 0 = never pulsed = fully static markup, which is
     *  what SSR renders — the same component works in .astro files with no
     *  client: directive at all. Do not replace with a `playing` boolean:
     *  speak() resolves at playback START, so there is no reliable "end". */
    pulse?: number;
    /** Real per-word envelope (from src/data/hero-waveform.json). When set,
     *  the bars are the word's actual audio shape instead of the stylized
     *  pattern; `dip` bars render accent (the word's real stød dip). */
    data?: RealWaveform;
  } = $props();

  const spec = $derived(data ? waveformSpecFromHeights(data) : waveformSpec(size === 'word' ? 'icon' : size));
</script>

<svg
  class={`wf wf-${size}`}
  class:animate={pulse > 0}
  viewBox={spec.viewBox}
  aria-hidden="true"
  focusable="false"
>
  {#key pulse}
    <g>
      {#each spec.bars as bar, i (i)}
        <rect
          x={bar.x}
          y={bar.y}
          width={spec.barWidth}
          height={bar.height}
          rx={spec.barWidth / 2}
          class:gap={bar.gap}
          style={`--i:${i}`}
        />
      {/each}
    </g>
  {/key}
</svg>

<style>
  svg {
    display: inline-block;
    vertical-align: middle;
  }
  .wf-icon {
    height: 0.9em;
    width: auto;
  }
  .wf-hero {
    width: min(100%, 22rem);
    height: auto;
    color: var(--muted);
  }
  .wf-divider {
    width: min(100%, 16rem);
    height: auto;
    color: var(--border);
  }
  /* Height-based: two side-by-side word-waveforms with different bar counts
     get the same px-per-viewBox-unit scale, so widths stay proportional to
     each word's real duration. Real envelopes have only ~10-12 bars, so they
     need a much larger scale than the 24-bar stylized hero to carry the same
     visual weight. */
  .wf-word {
    height: clamp(5rem, 18vw, 7rem);
    width: auto;
    color: var(--muted);
  }
  rect {
    fill: currentColor;
  }
  rect.gap {
    fill: var(--accent);
  }
  @media (prefers-reduced-motion: no-preference) {
    .animate rect {
      animation: wf-pulse 600ms ease-in-out both;
      animation-delay: calc(var(--i) * 45ms);
      transform-box: fill-box;
      transform-origin: center;
    }
  }
  @keyframes wf-pulse {
    0% {
      transform: scaleY(1);
    }
    50% {
      transform: scaleY(1.6);
    }
    100% {
      transform: scaleY(1);
    }
  }
</style>

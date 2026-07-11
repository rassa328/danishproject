<script lang="ts">
  import { waveformSpec, type WaveformSize } from '../lib/waveform.ts';

  let {
    size = 'icon',
    pulse = 0,
  }: {
    size?: WaveformSize;
    /** Monotonic counter: increment on every playback start ('audio'|'tts'
     *  outcomes). Each increment remounts the bars ({#key}) and replays the
     *  left-to-right sweep. 0 = never pulsed = fully static markup, which is
     *  what SSR renders — the same component works in .astro files with no
     *  client: directive at all. Do not replace with a `playing` boolean:
     *  speak() resolves at playback START, so there is no reliable "end". */
    pulse?: number;
  } = $props();

  const spec = $derived(waveformSpec(size));
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

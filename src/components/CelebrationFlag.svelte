<script lang="ts">
  // The site's ONE animated moment: a little Dannebrog table-flag drops in,
  // bounces to rest, then the cloth waves once. Self-contained on purpose (no
  // store/strings imports): the CONSUMER owns "earned" semantics by choosing
  // when to mount it — FlashcardReviewer mounts it only when a session was
  // completed by grading (and any future drill end screen can reuse it the
  // same way). Purely decorative: aria-hidden throughout; the surrounding
  // done screen carries the textual announcement.
  import { onMount } from 'svelte';
  import { computeDrop, flagY, flagSquash, hairlineDip } from '../lib/flag-physics.ts';

  let { confetti = true, dropHeight = 120 }: { confetti?: boolean; dropHeight?: number } = $props();

  const TOTAL_MS = 2000; // hard cap: every animated node is gone by here

  const spec = computeDrop(dropHeight);

  let y = $state(-dropHeight);
  let sx = $state(1);
  let sy = $state(1);
  let dip = $state(0);
  let wave = $state(false);
  let finished = $state(false); // ≥ TOTAL_MS: confetti removed, flag static

  interface Piece {
    vx: number; // px/s
    vy: number; // px/s upward launch
    om: number; // deg/s spin
    red: boolean;
  }
  let pieces: Piece[] = [];
  let piecePos = $state<{ x: number; y: number; r: number; o: number }[]>([]);

  onMount(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      // Render the settled flag immediately: no drop, no confetti, no rAF.
      y = 0;
      finished = true;
      return;
    }
    if (confetti) {
      pieces = Array.from({ length: 24 }, (_, i) => ({
        vx: -150 + Math.random() * 300,
        vy: 160 + Math.random() * 260,
        om: -720 + Math.random() * 1440,
        red: i % 2 === 0,
      }));
    }
    const launch = spec.impacts[0] ?? 0; // confetti pops on first impact
    let raf = 0;
    const t0 = performance.now();
    const frame = (nowMs: number) => {
      const t = (nowMs - t0) / 1000;
      y = flagY(t, spec);
      const s = flagSquash(t, spec);
      sx = s.sx;
      sy = s.sy;
      dip = hairlineDip(t, spec);
      if (!wave && t >= spec.settleTime) wave = true;
      if (confetti && t >= launch) {
        const tau = t - launch;
        piecePos = pieces.map((p) => ({
          x: p.vx * tau,
          y: -(p.vy * tau - 0.5 * 900 * tau * tau),
          r: p.om * tau,
          o: Math.max(0, 1 - tau / 1.2),
        }));
      }
      if (nowMs - t0 < TOTAL_MS) {
        raf = requestAnimationFrame(frame);
      } else {
        finished = true;
        piecePos = [];
      }
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  });
</script>

<div class="celebration" aria-hidden="true">
  <div class="stage">
    <div class="flag" style={`transform: translateY(${y}px) scale(${sx}, ${sy})`}>
      <svg viewBox="0 0 60 92" width="60" height="92" focusable="false">
        <!-- pole: knob, shaft, foot -->
        <circle cx="8" cy="4" r="3" fill="var(--muted)" />
        <rect x="6.5" y="5" width="3" height="83" fill="var(--muted)" />
        <path d="M 0 92 L 16 92 L 8 84 Z" fill="var(--muted)" />
        <!-- Dannebrog cloth 42×30: offset white cross, vertical arm at x=12
             from the hoist (like the real flag) -->
        <g class="cloth" class:wave>
          <rect x="10" y="8" width="42" height="30" fill="var(--accent)" />
          <rect x="10" y="20" width="42" height="6" fill="var(--flag-cross)" />
          <rect x="22" y="8" width="6" height="30" fill="var(--flag-cross)" />
        </g>
      </svg>
    </div>
    <div class="hairline" style={`transform: translateY(${dip}px)`}></div>
    {#if piecePos.length > 0 && !finished}
      <div class="confetti">
        {#each piecePos as pp, i (i)}
          <div
            class="piece"
            style={`transform: translate(${pp.x}px, ${pp.y}px) rotate(${pp.r}deg); opacity: ${pp.o}; background: ${pieces[i]?.red ? 'var(--accent)' : 'var(--flag-cross)'}`}
          ></div>
        {/each}
      </div>
    {/if}
  </div>
</div>

<style>
  .celebration {
    display: flex;
    justify-content: center;
    margin: var(--sp-4) 0;
  }
  /* Clips the drop: the flag starts above this box and appears to fall in. */
  .stage {
    position: relative;
    overflow: hidden;
    width: 9rem;
    padding-top: 6px; /* headroom so the top bounce squash never clips */
    display: flex;
    flex-direction: column;
    align-items: center;
  }
  .flag {
    transform-origin: 50% 100%; /* squash from the base, where it lands */
    will-change: transform;
  }
  .flag svg {
    display: block;
  }
  .cloth.wave {
    transform-box: fill-box;
    transform-origin: left center; /* the hoist edge, where cloth meets pole */
    animation: cloth-wave 900ms ease-in-out 1;
  }
  @keyframes cloth-wave {
    0% { transform: skewX(0deg); }
    30% { transform: skewX(-6deg); }
    60% { transform: skewX(4deg); }
    85% { transform: skewX(-2deg); }
    100% { transform: skewX(0deg); }
  }
  .hairline {
    width: 100%;
    border-top: 1px solid var(--border);
  }
  .confetti {
    position: absolute;
    left: 50%;
    bottom: 10px; /* the flag's base — pieces launch from the landing point */
    width: 0;
    height: 0;
  }
  .piece {
    position: absolute;
    width: 5px;
    height: 4px;
    border-radius: 1px;
  }
</style>

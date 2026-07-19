<script lang="ts">
  import { speak } from '../lib/speech.ts';
  import { withBase } from '../lib/url.ts';
  import { UI } from '../lib/strings.ts';
  import type { Direction } from '../lib/storage.ts';

  const T = UI.flashcards;

  let {
    /** Other modes that still have due cards, in tab order, zero-count dropped.
     *  Empty ⇒ variant B (everything cleared); non-empty ⇒ variant A (chips). */
    dueModes,
    /** The cleared mode — names the variant-A explainer ("Lyssna repeteras igen…"). */
    activeMode,
    /** When this mode/pool is due again (variant A) or soonest anywhere (variant B). */
    nextDueDate,
    streakDays,
    /** Distinct words in the learning/review pool (no "/5077" denominator). */
    wordsLearning,
    /** Jump to another mode's due queue. */
    onSwitchMode,
    /** Start free practice in the current mode (must not touch the SRS schedule). */
    onPracticeFree,
  }: {
    dueModes: { direction: Direction; count: number }[];
    activeMode: Direction;
    nextDueDate: Date | null;
    streakDays: number;
    wordsLearning: number;
    onSwitchMode: (d: Direction) => void;
    onPracticeFree: () => void;
  } = $props();

  // færdig — a committed human-recording clip from the praksis deck. The empty
  // state teaches this one fixed word, so its audio is a fixed asset; play it
  // through the site's normal word-audio pipeline (speak → clip, TTS fallback).
  const FAERDIG_AUDIO = 'audio/da-169869a22cc9fc.mp3';

  const MODE_LABEL: Record<Direction, string> = {
    produce: T.write,
    recognize: T.recognize,
    listen: T.listen,
    'listen-sentence': T.listenSentence,
    speak: T.speak,
    cloze: T.cloze,
  };

  let pulse = $state(0); // waveform sweep counter — bumps only when sound starts

  const hasChips = $derived(dueModes.length > 0);
  const nextDue = $derived(T.nextDueLabel(daysUntilDue(nextDueDate)));
  const explainer = $derived(
    hasChips
      ? T.empty.explainerA(MODE_LABEL[activeMode], nextDue)
      : T.empty.explainerB(nextDue),
  );
  const freePre = $derived(hasChips ? T.empty.freePreA : T.empty.freePreB);

  /** Calendar-day difference (local midnight to local midnight): 0 = due today,
   *  1 = tomorrow. null (nothing scheduled ahead) reads as "senare idag". */
  function daysUntilDue(due: Date | null): number {
    if (!due) return 0;
    const now = new Date();
    const a = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const b = new Date(due.getFullYear(), due.getMonth(), due.getDate()).getTime();
    return Math.round((b - a) / 86_400_000);
  }

  async function playWord() {
    const outcome = await speak(T.empty.word, { audioUrl: withBase(FAERDIG_AUDIO) });
    if (outcome === 'audio' || outcome === 'tts') pulse += 1;
  }
</script>

<div class="empty-card">
  <div class="eyebrow">{T.empty.eyebrow}</div>

  <button type="button" class="word-row" onclick={playWord} aria-label={T.empty.wordAria}>
    <span class="word" lang="da">{T.empty.word}</span>
    <span class="wave" class:animate={pulse > 0} aria-hidden="true">
      {#key pulse}
        {#each [6, 12, 8, 14] as h, i (i)}
          <span class="bar" style={`height:${h}px;animation-delay:${i * 55}ms`}></span>
        {/each}
      {/key}
    </span>
  </button>

  <div class="accent" aria-hidden="true"></div>
  <p class="example" lang="da">{T.empty.example}</p>
  <p class="explainer">{explainer}</p>

  <div class="stats">
    <div class="stat">
      <div class="num">{streakDays}</div>
      <div class="stat-label">{T.empty.statStreak}</div>
    </div>
    <div class="divider" aria-hidden="true"></div>
    <div class="stat">
      <div class="num">{wordsLearning}</div>
      <div class="stat-label">{T.empty.statLearning}</div>
    </div>
  </div>

  {#if hasChips}
    <div class="chips">
      {#each dueModes as m (m.direction)}
        <button type="button" class="chip" onclick={() => onSwitchMode(m.direction)}>
          {MODE_LABEL[m.direction]}<span class="count">{m.count}</span>
        </button>
      {/each}
    </div>
  {/if}

  <p class="free" class:after-chips={hasChips}>
    {freePre}<button type="button" class="free-link" onclick={onPracticeFree}
      >{T.empty.freeLink}</button
    >{T.empty.freePost}
  </p>
</div>

<style>
  /* The panel mirrors a live flashcard's .card so the empty state reads as one
     more Danish vocab card (its whole design conceit) — same surface, border,
     radius and shadow the reviewer uses, just roomier padding. */
  .empty-card {
    width: 100%;
    box-sizing: border-box;
    background: var(--card);
    border: 1px solid var(--bd1);
    border-radius: 20px;
    padding: clamp(32px, 5vw, 44px) clamp(22px, 6vw, 56px);
    box-shadow: 0 1px 2px var(--sh1), 0 16px 40px var(--sh2);
    text-align: center;
  }

  .eyebrow {
    font-family: var(--font-mono);
    font-size: 10px;
    letter-spacing: 3px;
    text-transform: uppercase;
    color: var(--mut3);
    margin-bottom: 36px;
    text-align: left;
  }

  /* Headword + waveform — one audio affordance, like a real card's word. */
  .word-row {
    display: inline-flex;
    align-items: baseline;
    gap: 12px;
    background: none;
    border: none;
    padding: 0;
    cursor: pointer;
  }
  .word {
    font-family: var(--font-serif);
    font-size: 46px;
    font-weight: 600;
    color: var(--ink);
    line-height: 1.1;
  }
  .wave {
    display: inline-flex;
    align-items: flex-end;
    gap: 2px;
  }
  .bar {
    width: 2px;
    border-radius: 1px;
    background: var(--bars);
    transform-origin: bottom;
  }
  .word-row:hover .bar,
  .word-row:focus-visible .bar {
    background: var(--ink);
  }
  @media (prefers-reduced-motion: no-preference) {
    .wave.animate .bar {
      animation: bar-pulse 500ms ease-in-out both;
    }
  }
  @keyframes bar-pulse {
    0% {
      transform: scaleY(1);
    }
    50% {
      transform: scaleY(1.35);
    }
    100% {
      transform: scaleY(1);
    }
  }

  .accent {
    width: 40px;
    height: 2px;
    background: var(--ok);
    border-radius: 2px;
    margin: 12px auto 8px;
  }
  .example {
    margin: 0 0 30px;
    font-size: 14px;
    color: var(--mut2);
  }
  .explainer {
    max-width: 440px;
    margin: 0 auto 30px;
    font-size: 13px;
    line-height: 1.6;
    color: var(--mut2);
  }

  .stats {
    display: flex;
    justify-content: center;
    gap: 26px;
  }
  .num {
    font-family: var(--font-serif);
    font-size: 26px;
    color: var(--ink);
    line-height: 1.1;
  }
  .stat-label {
    font-family: var(--font-mono);
    font-size: 10px;
    letter-spacing: 1.5px;
    text-transform: uppercase;
    color: var(--mut3);
    margin-top: 4px;
  }
  .divider {
    width: 1px;
    background: var(--bd3);
  }

  /* Mode chips — mirrors the reviewer's grade-pill treatment (border → --ink
     on hover) so the empty state uses the same interactive vocabulary. */
  .chips {
    display: flex;
    justify-content: center;
    flex-wrap: wrap;
    gap: 12px;
    margin-top: 34px;
  }
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    font: inherit;
    font-size: 13px;
    color: var(--soft);
    background: none;
    border: 1px solid var(--bd4);
    border-radius: 999px;
    padding: 9px 18px;
    cursor: pointer;
  }
  .chip:hover,
  .chip:focus-visible {
    border-color: var(--ink);
    color: var(--ink);
  }
  .chip .count {
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--mut4);
  }

  .free {
    margin: 34px 0 0;
    font-size: 12.5px;
    color: var(--mut3);
  }
  .free.after-chips {
    margin-top: 20px;
  }
  .free-link {
    font: inherit;
    background: none;
    border: none;
    /* Touch hit area ~44px; negative margin keeps the inline text position. */
    padding: 12px 6px;
    margin: -12px -6px;
    color: var(--soft);
    cursor: pointer;
    text-decoration: underline;
    text-underline-offset: 3px;
    text-decoration-color: var(--bd4);
  }
  .free-link:hover,
  .free-link:focus-visible {
    color: var(--ink);
  }

  @media (prefers-reduced-motion: no-preference) {
    .empty-card {
      animation: fade-in 150ms ease-out both;
    }
    @keyframes fade-in {
      from {
        opacity: 0;
      }
      to {
        opacity: 1;
      }
    }
  }
</style>

<script lang="ts">
  // Forced-choice stød discrimination drill (embedded under lesson 01): play
  // one clip, pick which word of a minimal pair you heard, immediate feedback,
  // ~10 rounds, no persistence. This trains PERCEPTION — the click-to-hear
  // table above it only trains exposure (you always know what you clicked).
  //
  // Pair data mirrors the lesson's minimal-pair table. Clip ids are derived
  // with the SAME isomorphic helpers (and the same data-ipa strings) as the
  // lesson's audio spans, so the drill reuses the committed lesson clips —
  // including the forced with/without-stød variants for the homographs. Clips
  // are still being generated for some words, so availability is probed at
  // runtime and unavailable pairs are skipped (never a robot-voice fallback
  // pretending to demonstrate stød).
  import { onMount } from 'svelte';
  import Waveform from './Waveform.svelte';
  import { speak } from '../lib/speech.ts';
  import { withBase } from '../lib/url.ts';
  import { lessonAudioId, spanAudioId } from '../lib/audio-id.ts';
  import { UI } from '../lib/strings.ts';

  const T = UI.minimalPairs;
  const ROUNDS = 10;

  interface Variant {
    /** The Danish text spoken on the clip (also the speak() fallback text). */
    text: string;
    /** Swedish gloss incl. the med/utan stød cue — the discrimination target. */
    gloss: string;
    clip: string;
  }
  interface Pair {
    a: Variant;
    b: Variant;
  }

  const word = (text: string, gloss: string): Variant => ({
    text,
    gloss,
    clip: `audio/${lessonAudioId(text)}.mp3`,
  });
  // Homographs need the lesson's exact data-ipa override to get the right clip.
  const ipa = (text: string, ipaStr: string, gloss: string): Variant => ({
    text,
    gloss,
    clip: `audio/${spanAudioId(text, { ipa: ipaStr })}.mp3`,
  });

  // a = utan stød, b = med stød (same order as the lesson table).
  const PAIRS: Pair[] = [
    { a: word('hun', 'hon — utan stød'), b: word('hund', 'hund — med stød') },
    { a: word('mor', 'mamma — utan stød'), b: word('mord', 'mord — med stød') },
    { a: word('bønner', 'bönor/böner — utan stød'), b: word('bønder', 'bönder — med stød') },
    {
      a: ipa('læser', 'ˈlɛːsɐ', 'en läsare — utan stød'),
      b: ipa('læser', 'ˈlɛːʔsɐ', 'läser, verb — med stød'),
    },
    {
      a: ipa('hænder', 'ˈhɛnɐ', 'händer/sker — utan stød'),
      b: ipa('hænder', 'ˈhɛnʔɐ', 'händer, kroppsdelar — med stød'),
    },
    {
      a: ipa('anden', 'ˈanən', 'den andra — utan stød'),
      b: ipa('anden', 'ˈanʔən', 'anden, fågeln — med stød'),
    },
  ];

  let pairs = $state<Pair[]>([]);
  let checking = $state(true);
  let round = $state(1);
  let score = $state(0);
  let played = $state(false);
  /** null = not answered yet; else whether the pick was right. */
  let answered = $state<boolean | null>(null);
  let pair = $state<Pair | null>(null);
  let side = $state<0 | 1>(0);
  let finished = $state(false);
  let pulse = $state(0);
  let lastPair: Pair | null = null;

  const playing = $derived(pair ? [pair.a, pair.b][side]! : null);

  /** Does the clip exist? Metadata preload needs no user gesture; a real 404
   *  errors fast. A slow network times out to "available" rather than hiding
   *  the drill (worst case: speak() plays it slightly later on demand). */
  function probe(url: string): Promise<boolean> {
    return new Promise((resolve) => {
      const a = new Audio();
      a.addEventListener('loadedmetadata', () => resolve(true), { once: true });
      a.addEventListener('error', () => resolve(false), { once: true });
      setTimeout(() => resolve(true), 4000);
      a.preload = 'metadata';
      a.src = withBase(url);
    });
  }

  onMount(async () => {
    const ok = await Promise.all(
      PAIRS.map(async (p) => (await Promise.all([probe(p.a.clip), probe(p.b.clip)])).every(Boolean)),
    );
    pairs = PAIRS.filter((_, i) => ok[i]);
    checking = false;
    if (pairs.length) nextRound();
  });

  function nextRound() {
    // Never the same pair twice in a row (when there's a choice).
    let p: Pair;
    do {
      p = pairs[Math.floor(Math.random() * pairs.length)]!;
    } while (pairs.length > 1 && p === lastPair);
    lastPair = p;
    pair = p;
    side = Math.random() < 0.5 ? 0 : 1;
    played = false;
    answered = null;
  }

  async function play() {
    if (!playing) return;
    // Unlock the answer buttons at the CLICK, not at playback start — awaiting
    // speak() first would let a fast double-click race the gating.
    played = true;
    const outcome = await speak(playing.text, { audioUrl: withBase(playing.clip) });
    if (outcome === 'audio' || outcome === 'tts') pulse += 1;
  }

  function answer(i: 0 | 1) {
    if (!played || answered !== null) return;
    answered = i === side;
    if (answered) score++;
  }

  function next() {
    if (round >= ROUNDS) {
      finished = true;
      return;
    }
    round++;
    nextRound();
  }

  function restart() {
    round = 1;
    score = 0;
    finished = false;
    nextRound();
  }
</script>

{#if !checking && pairs.length > 0}
  <section class="drill" aria-label={T.heading}>
    <h2>{T.heading}</h2>
    <p class="intro">{T.intro}</p>

    {#if finished}
      <p class="result">{T.result(score, ROUNDS)}</p>
      <button type="button" onclick={restart}>{T.retry}</button>
    {:else if pair}
      <p class="round">{T.round(round, ROUNDS)}</p>
      <p>
        <button type="button" class="play" onclick={play}><Waveform size="icon" {pulse} /> {played ? T.playAgain : T.play}</button>
      </p>
      <div class="choices">
        {#each [pair.a, pair.b] as v, i (v.clip)}
          <button
            type="button"
            class="choice"
            class:is-answer={answered !== null && i === side}
            disabled={!played || answered !== null}
            onclick={() => answer(i as 0 | 1)}
          >
            <span class="word" lang="da">{v.text}</span>
            <span class="gloss">{v.gloss}</span>
          </button>
        {/each}
      </div>
      {#if answered === null}
        {#if !played}<p class="hint">{T.listenFirst}</p>{/if}
      {:else}
        <p class="verdict" class:ok={answered} class:no={!answered} role="status">
          {answered ? T.correct : T.wrong(playing?.text ?? '', playing?.gloss ?? '')}
        </p>
        <button type="button" onclick={next}>{round >= ROUNDS ? T.showResult : T.next}</button>
      {/if}
    {/if}
  </section>
{/if}

<style>
  .drill {
    margin-top: var(--sp-8);
    padding: var(--sp-4) var(--sp-6);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--surface);
  }
  .drill h2 {
    margin: 0 0 var(--sp-1);
  }
  .intro {
    color: var(--muted);
    font-size: var(--step--1);
    margin: 0 0 var(--sp-3);
  }
  .round {
    color: var(--muted);
    font-size: var(--step--1);
    margin: 0 0 var(--sp-2);
  }
  .choices {
    display: grid;
    gap: var(--sp-2);
    grid-template-columns: repeat(auto-fit, minmax(12rem, 1fr));
    margin: var(--sp-3) 0;
  }
  .choice {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: var(--sp-1);
    text-align: left;
    padding: var(--sp-3) var(--sp-4);
    min-height: var(--min-tap);
  }
  .choice.is-answer {
    outline: 2px solid var(--correct);
    outline-offset: 1px;
  }
  .word {
    font-weight: 700;
    font-size: var(--step-0);
  }
  .gloss {
    color: var(--muted);
    font-size: var(--step--1);
  }
  .hint {
    color: var(--muted);
    font-size: var(--step--1);
    margin: var(--sp-2) 0 0;
  }
  .verdict {
    font-weight: 700;
    margin: var(--sp-2) 0;
  }
  .verdict.ok {
    color: var(--correct);
  }
  .verdict.no {
    color: var(--accent);
  }
  .result {
    font-weight: 600;
    margin: 0 0 var(--sp-3);
  }
</style>

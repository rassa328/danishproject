<script lang="ts">
  // The ONE shared drill island (plan §3.2): /skriv mounts it with kind="words"
  // (three word modes writing into the flashcards' SRS store), /tal with
  // kind="numbers" (clip-composed number dictation, no SRS in v1). All loop
  // decisions live in pure libs — drill-engine (phases), drill-modes (registry),
  // drill-srs (grading) — this component only wires DOM, audio and focus.
  //
  // Like FlashcardReviewer, only the small starter deck arrives as props; the
  // 5000-word praksis deck is fetched lazily the first time a session needs it
  // (praksis-client), degrading visibly to starter-only on failure.
  import { onDestroy, onMount, tick } from 'svelte';
  import { Store, DIRECTIONS } from '../lib/storage.ts';
  import { preloadClip, speak } from '../lib/speech.ts';
  import { withBase } from '../lib/url.ts';
  import SpeakButton from './SpeakButton.svelte';
  import type { Card } from '../lib/vocab.ts';
  import type { GroupMatch, StudyGroup } from '../lib/deck-groups.ts';
  import { fetchPraksis, praksisCache } from '../lib/praksis-client.ts';
  import {
    DRILL_MODES,
    type DrillBuildDeps,
    type DrillItem,
    type DrillModeId,
  } from '../lib/drill-modes.ts';
  import {
    advance,
    createDrill,
    outcomeOf,
    reveal,
    submit,
    type DrillState,
  } from '../lib/drill-engine.ts';
  import { recordOutcome } from '../lib/drill-srs.ts';
  import { remapWithCaret } from '../lib/char-map.ts';
  import { diffLetters } from '../lib/letter-diff.ts';
  import { blip } from '../lib/blip.ts';
  import { NUMBER_LEVELS, type NumberLevelId } from '../lib/danish-numbers.ts';
  import {
    createNumberAudioPlayer,
    levelAvailable,
    type NumberAudioManifest,
    type NumberAudioPlayer,
  } from '../lib/number-audio.ts';
  import type { SrsView } from '../lib/session.ts';
  import { UI } from '../lib/strings.ts';

  const T = UI.drill;
  const F = UI.flashcards;

  interface LessonRef {
    id: string;
    title: string;
    tag: string;
  }

  let {
    kind,
    cards = [],
    groups = [],
    lessons = [],
    manifest = null,
  }: {
    kind: 'words' | 'numbers';
    /** Curated starter deck only — praksis is lazily fetched (page-weight fix). */
    cards?: Card[];
    /** Study-group descriptors; only the due-all match is consumed here. */
    groups?: StudyGroup[];
    /** Lessons with a word list, for the "Från lektion" source picker. */
    lessons?: LessonRef[];
    /** Number-clip manifest (kind="numbers" only). */
    manifest?: NumberAudioManifest | null;
  } = $props();

  const WORD_MODES: DrillModeId[] = ['sv-da', 'da-dictation', 'da-sv'];
  const SIZES = [10, 20, 40];
  /** Numbers have no SRS (mode.srs === null) — a null-object SrsView keeps
   *  buildItems' deps uniform without touching localStorage. */
  const noSrs: SrsView = { getRecord: () => null, newCardsToday: () => 0 };
  /** The due-only cross-deck match ({kind:'all'} = buildQueue's due-only case). */
  const dueMatch: GroupMatch = groups.find((g) => g.match.kind === 'all')?.match ?? {
    kind: 'all',
  };
  const now = () => new Date();

  let store: Store | undefined;
  let player: NumberAudioPlayer | undefined;
  let advanceTimer: ReturnType<typeof setTimeout> | null = null;

  let ready = $state(false);
  let fromLesson = $state<string | null>(null);
  // A ?tag deep-link that matches no lesson still works — buildQueue trains the
  // raw tag directly (parity with the flashcards' tag banner).
  let rawTag = $state<string | null>(null);
  let modeId = $state<DrillModeId>(kind === 'numbers' ? 'number-dictation' : 'sv-da');
  let sourceId = $state('due'); // 'due' | a lesson id
  let size = $state(20);
  let levelId = $state<NumberLevelId>('0-20');

  // Starter props ∪ the lazily fetched praksis deck (merged in start()).
  let knownCards = $state<Card[]>(cards);
  let loadingDeck = $state(false);
  let praksisNotice = $state(false);

  let drill = $state<DrillState | null>(null);
  let typed = $state('');
  // The wrong attempt frozen for the corrective diff (typed is cleared for the retype).
  let lastTyped = $state('');
  let saveWarning = $state('');
  let emptyMsg = $state('');
  let finishedAt = $state<number | null>(null);
  // Prompt-audio outcome in the audio modes: 'blocked' swaps in an explicit
  // ▶-button (autoplay denied), 'none'/'missing' show a Swedish notice.
  let promptAudioState = $state<'ok' | 'tts' | 'none' | 'blocked' | 'missing'>('ok');
  let input = $state<HTMLInputElement>();
  let doneHeading = $state<HTMLElement>();

  const mode = $derived(DRILL_MODES[modeId]);
  const running = $derived(drill !== null && drill.phase !== 'done');
  const current = $derived(drill && drill.phase !== 'done' ? drill.queue[drill.idx] : undefined);
  const isCorrective = $derived(drill?.phase === 'corrective');
  const diff = $derived(isCorrective && current ? diffLetters(current.answer, lastTyped) : []);
  const danishInput = $derived(mode.input.lang === 'da');
  // Number levels are offered only with complete clip coverage — partial
  // coverage would go silent mid-session (real recordings only, never TTS).
  const levelStates = $derived(
    NUMBER_LEVELS.map((l) => ({
      id: l.id,
      available: manifest ? levelAvailable(l.id, manifest) : false,
    })),
  );
  const anyLevelAvailable = $derived(levelStates.some((l) => l.available));
  const accuracy = $derived(
    drill && drill.answered > 0 ? Math.round((100 * drill.firstTryCorrect) / drill.answered) : 100,
  );
  const totalTime = $derived.by(() => {
    if (!drill || finishedAt === null) return '0:00';
    const secs = Math.max(0, Math.round((finishedAt - drill.startedAt) / 1000));
    return `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
  });
  const missedItems = $derived.by(() => {
    const d = drill;
    if (!d || d.phase !== 'done') return [] as DrillItem[];
    return d.missedIds.flatMap((id) => {
      const item = d.queue.find((q) => q.id === id);
      return item ? [item] : [];
    });
  });

  function clearAdvanceTimer() {
    if (advanceTimer !== null) {
      clearTimeout(advanceTimer);
      advanceTimer = null;
    }
  }

  /** The tag the session trains, if any: a raw ?tag deep-link or the picked lesson. */
  function activeTag(): string | null {
    if (kind !== 'words') return null;
    if (rawTag) return rawTag;
    if (sourceId === 'due') return null;
    return lessons.find((l) => l.id === sourceId)?.tag ?? null;
  }

  /** startedCount() counts distinct record ids — any surplus over the starter
   *  ids with records means praksis (or imported) records exist and the due
   *  source must include that deck (same probe as FlashcardReviewer). */
  function hasNonStarterRecords(): boolean {
    const s = store;
    if (!s) return false;
    let starterStarted = 0;
    for (const c of cards) {
      if (DIRECTIONS.some((d) => s.getRecord(c.id, d) !== null)) starterStarted++;
    }
    return s.startedCount() > starterStarted;
  }

  /** Tag sessions always need praksis (praksis rows carry tags too); the due
   *  source only when non-starter records exist. */
  function needsPraksis(): boolean {
    if (kind !== 'words') return false;
    if (activeTag()) return true;
    return hasNonStarterRecords();
  }

  // Guards overlapping start() calls while one awaits the praksis fetch.
  let startToken = 0;

  async function start() {
    clearAdvanceTimer();
    player?.stop();
    emptyMsg = '';
    saveWarning = '';
    drill = null;
    finishedAt = null;
    if (kind === 'words') {
      const token = ++startToken;
      if (!praksisCache() && needsPraksis()) {
        loadingDeck = true;
        try {
          const praksis = await fetchPraksis();
          if (token !== startToken) return; // superseded by a newer start()
          knownCards = [...cards, ...praksis];
          praksisNotice = false;
        } catch {
          if (token !== startToken) return;
          praksisNotice = true; // degrade to starter-only, visibly
        } finally {
          if (token === startToken) loadingDeck = false;
        }
      } else if (praksisCache() && knownCards.length === cards.length) {
        // Another island already fetched the deck — merge without re-awaiting.
        knownCards = [...cards, ...(praksisCache() as Card[])];
      }
    }
    const tag = activeTag();
    const s = store;
    const deps: DrillBuildDeps = {
      cards: knownCards,
      srs: s ?? noSrs,
      now: now(),
      limits: s ? s.getSettings() : { newPerDay: 0, reviewPerDay: 0 },
      tag,
      match: tag ? null : dueMatch,
      size,
    };
    if (kind === 'numbers') {
      deps.numberLevel = levelId;
      if (manifest) deps.manifest = manifest;
    }
    const items = mode.buildItems(deps);
    if (items.length === 0) {
      emptyMsg =
        kind === 'numbers'
          ? T.noCards
          : !tag
            ? T.noDue
            : modeId === 'da-dictation'
              ? T.noDictationCards
              : T.noCards;
      return;
    }
    drill = createDrill(items, { size, now: Date.now() });
    beginItem();
  }

  function beginItem() {
    typed = '';
    lastTyped = '';
    promptAudioState = 'ok';
    preloadNext();
    tick().then(() => {
      input?.focus();
      if (mode.prompt.kind === 'audio') void playPrompt();
    });
  }

  /** Warm the NEXT item's audio while the current one is on screen. */
  function preloadNext() {
    const d = drill;
    const nxt = d?.queue[d.idx + 1];
    const a = nxt?.audio;
    if (!a) return;
    if (a.kind === 'clip') {
      if (a.url) preloadClip(withBase(a.url));
    } else if (player) {
      void player.preload(a.tokens);
    }
  }

  /** Play the PROMPT audio (dictation modes) and capture the outcome so
   *  silence is never mute-with-no-message. 'cancelled' (superseded) is ignored. */
  async function playPrompt() {
    const item = current;
    if (!item) return;
    const a = mode.audioFor(item);
    if (!a) return;
    if (a.kind === 'number') {
      if (!player) return;
      const out = await player.play(a.tokens);
      if (out === 'cancelled') return;
      promptAudioState = out === 'played' ? 'ok' : out;
    } else {
      const out = await speak(a.text, a.url ? { audioUrl: withBase(a.url) } : {});
      if (out === 'cancelled') return;
      promptAudioState = out === 'audio' ? 'ok' : out;
    }
  }

  /** The item's own audio, fire-and-forget: the word clip on correct/corrective,
   *  the composed number in the corrective phase and end-screen replays. */
  function playItemAudio(item: DrillItem) {
    const a = item.audio;
    if (!a) return;
    if (a.kind === 'clip') {
      void speak(a.text, a.url ? { audioUrl: withBase(a.url) } : {});
    } else if (player) {
      void player.play(a.tokens);
    }
  }

  function submitAnswer() {
    const d = drill;
    const item = current;
    if (!d || !item) return;
    if (d.phase === 'answering') {
      const correct = mode.matches(typed, item);
      // Outcome BEFORE submit(): a reveal makes even a correct retype a hint-miss.
      const outcome = outcomeOf(d, correct);
      const s = store;
      if (mode.srs && item.sourceCardId && s) {
        // One SRS write per SCORED attempt — the corrective retype never grades.
        const result = recordOutcome(s, item.sourceCardId, mode.srs.direction, outcome, now());
        if (!result.ok) saveWarning = F.saveError;
      }
      const next = submit(d, correct);
      drill = next;
      if (next.phase === 'feedback-correct') {
        // Every 5th consecutive correct gets the rising combo blip instead.
        blip(next.combo % 5 === 0 ? 'combo' : 'correct');
        if (item.audio?.kind === 'clip') playItemAudio(item);
        advanceTimer = setTimeout(() => {
          advanceTimer = null;
          advanceNow();
        }, 650);
      } else {
        // corrective: play the item, freeze the wrong attempt for the diff,
        // clear the input for the required retype.
        lastTyped = typed;
        typed = '';
        playItemAudio(item);
        tick().then(() => input?.focus());
      }
    } else if (d.phase === 'corrective') {
      if (mode.matches(typed, item)) {
        drill = submit(d, true); // ungraded retype advances
        afterAdvance();
      } else {
        lastTyped = typed;
        typed = '';
        tick().then(() => input?.focus());
      }
    }
  }

  function advanceNow() {
    const d = drill;
    if (!d || d.phase !== 'feedback-correct') return;
    drill = advance(d);
    afterAdvance();
  }

  function afterAdvance() {
    const d = drill;
    if (!d) return;
    if (d.phase === 'done') {
      finishedAt = Date.now();
      tick().then(() => doneHeading?.focus());
      return;
    }
    beginItem();
  }

  function doReveal() {
    const d = drill;
    if (!d || d.phase !== 'answering') return;
    drill = reveal(d);
    tick().then(() => input?.focus());
  }

  /** Live ä/ö→æ/ø remap with the caret preserved (Danish inputs only). */
  function onInput(e: Event) {
    const el = e.currentTarget as HTMLInputElement;
    if (mode.input.liveRemap) {
      const caret = el.selectionStart ?? el.value.length;
      const mapped = remapWithCaret(el.value, caret);
      if (mapped.value !== el.value) {
        el.value = mapped.value;
        el.setSelectionRange(mapped.caret, mapped.caret);
      }
      typed = mapped.value;
    } else {
      typed = el.value;
    }
  }

  // Insert a Danish letter at the caret — Swedish keyboards lack æ/ø.
  function insertChar(ch: string) {
    const el = input;
    if (!el) {
      typed += ch;
      return;
    }
    const s = el.selectionStart ?? typed.length;
    const e = el.selectionEnd ?? typed.length;
    typed = typed.slice(0, s) + ch + typed.slice(e);
    tick().then(() => {
      el.focus();
      const pos = s + ch.length;
      el.setSelectionRange(pos, pos);
    });
  }

  function onContainerKey(e: KeyboardEvent) {
    // Never hijack typing — the input handles its own keys (Enter via the form).
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
    if (running && mode.prompt.replayable && e.key.toLowerCase() === 'r') {
      e.preventDefault();
      void playPrompt();
    }
  }

  onMount(() => {
    if (kind === 'words') {
      store = new Store();
      const params = new URLSearchParams(location.search);
      fromLesson = params.get('from');
      const urlMode = params.get('mode');
      if (urlMode && (WORD_MODES as string[]).includes(urlMode)) modeId = urlMode as DrillModeId;
      const urlTag = params.get('tag');
      if (urlTag) {
        const lesson = lessons.find((l) => l.tag === urlTag);
        if (lesson) sourceId = lesson.id;
        else rawTag = urlTag;
      }
    } else {
      player = createNumberAudioPlayer(manifest ?? { atoms: {} });
      const first = levelStates.find((l) => l.available);
      if (first) levelId = first.id;
    }
    ready = true;
  });

  onDestroy(() => {
    clearAdvanceTimer();
    player?.stop();
  });
</script>

{#snippet glossary(item: DrillItem)}
  {#if item.card}
    <!-- In da→sv the answer line already IS the Swedish gloss — don't repeat it. -->
    {#if item.card.swedish !== item.answer}<p class="sv">{item.card.swedish}</p>{/if}
    {#if item.card.exampleDa}
      <p class="ex" lang="da">
        {item.card.exampleDa}
        <SpeakButton text={item.card.exampleDa} audio={item.card.audioExample} label={F.hear} />
      </p>
    {/if}
    {#if item.card.exampleSv}<p class="ex">{item.card.exampleSv}</p>{/if}
    {#if item.card.note}<p class="callout">{item.card.note}</p>{/if}
  {/if}
{/snippet}

{#snippet answerLine(item: DrillItem)}
  <p class="da" lang={danishInput || mode.prompt.lang === 'da' ? 'da' : undefined}>
    {item.answer}
    {#if item.audio?.kind === 'clip'}
      <SpeakButton text={item.audio.text} audio={item.audio.url} />
    {:else if item.audio?.kind === 'number'}
      <button type="button" class="replay" onclick={() => playItemAudio(item)}>{F.replay}</button>
    {/if}
  </p>
  {#if item.audio?.kind === 'number'}<p class="ex" lang="da">{item.prompt}</p>{/if}
{/snippet}

{#if !ready}
  <!-- Skeleton (§3.6): block placeholders until client:idle hydration. -->
  <div class="skeleton" aria-hidden="true">
    <div class="ph ph-prompt"></div>
    <div class="ph ph-input"></div>
    <div class="ph ph-buttons"></div>
  </div>
  <p class="vh" role="status">{T.loading}</p>
{:else}
  {#if fromLesson}
    <p class="from-lesson">
      <a href={withBase(`lektioner/${fromLesson}`)}>{UI.lessons.backToLesson}</a>
    </p>
  {/if}
  {#if praksisNotice}<p class="warning" role="alert">{F.praksisFailed}</p>{/if}

  {#if drill && drill.phase === 'done'}
    <section class="card done">
      <h2 tabindex="-1" bind:this={doneHeading}>{T.doneTitle}</h2>
      <dl class="stats">
        <div><dt>{T.accuracy}</dt><dd>{accuracy} %</dd></div>
        <div><dt>{T.totalTime}</dt><dd>{totalTime}</dd></div>
        <div><dt>{T.bestCombo}</dt><dd>{drill.bestCombo}</dd></div>
      </dl>
      {#if missedItems.length > 0}
        <h3>{T.missedHeading}</h3>
        <ul class="missed">
          {#each missedItems as item (item.id)}
            <li>
              {#if item.audio?.kind === 'number'}
                <strong>{item.answer}</strong> — <span lang="da">{item.prompt}</span>
                <button type="button" class="replay" onclick={() => playItemAudio(item)}>{F.replay}</button>
              {:else}
                <strong lang="da">{item.card?.danish ?? item.answer}</strong>
                {#if item.card} — {item.card.swedish}{/if}
                {#if item.audio?.kind === 'clip'}
                  <SpeakButton text={item.audio.text} audio={item.audio.url} />
                {/if}
              {/if}
            </li>
          {/each}
        </ul>
      {:else}
        <p>{T.noMisses}</p>
      {/if}
      <button type="button" class="cta" onclick={() => void start()}>{T.runAgain}</button>
    </section>
  {/if}

  {#if !running}
    <!-- Session setup. The Starta click is the user gesture that unlocks audio. -->
    <section class="card setup">
      {#if kind === 'numbers' && !anyLevelAvailable}
        <p class="callout">{T.numbers.noLevels}</p>
      {:else}
        {#if kind === 'words'}
          <fieldset class="modes">
            <legend>{T.modeLegend}</legend>
            {#each WORD_MODES as m (m)}
              <label>
                <input type="radio" name="drill-mode" value={m} bind:group={modeId} />
                {T.modes[m as keyof typeof T.modes]}
              </label>
            {/each}
          </fieldset>
          {#if rawTag}
            <p class="tagline">
              {F.trainingTagPrefix} <strong>#{rawTag}</strong>
              <button type="button" onclick={() => (rawTag = null)}>{F.showAllDecks}</button>
            </p>
          {:else}
            <label class="pick">
              {T.sourceLegend}
              <select bind:value={sourceId}>
                <option value="due">{T.sourceDue}</option>
                <optgroup label={T.sourceLesson}>
                  {#each lessons as l (l.id)}<option value={l.id}>{l.title}</option>{/each}
                </optgroup>
              </select>
            </label>
          {/if}
        {:else}
          <label class="pick">
            {T.numbers.levelLegend}
            <select bind:value={levelId}>
              {#each levelStates as l (l.id)}
                <option value={l.id} disabled={!l.available} title={l.available ? undefined : T.numbers.missingAudio}>
                  {T.numbers.levels[l.id]}
                </option>
              {/each}
            </select>
          </label>
          <p class="hint">{T.numbers.levelHints[levelId]}</p>
          {#if levelStates.some((l) => !l.available)}
            <p class="hint">{T.numbers.missingAudio}</p>
          {/if}
        {/if}
        <label class="pick">
          {T.cardCount}
          <select bind:value={size}>
            {#each SIZES as n (n)}<option value={n}>{n}</option>{/each}
          </select>
        </label>
        <button type="button" class="cta" onclick={() => void start()}>{T.start}</button>
        {#if loadingDeck}<p class="hint" role="status">{F.loadingDeck}</p>{/if}
        {#if emptyMsg}<p class="hint" role="status">{emptyMsg}</p>{/if}
      {/if}
    </section>
  {/if}

  {#if running && drill && current}
    <section
      class="card run"
      class:flash={drill.phase === 'feedback-correct'}
      role="group"
      aria-label={kind === 'numbers' ? T.numbers.title : T.title}
      tabindex="-1"
      onkeydown={onContainerKey}
    >
      <p class="progress" aria-live="polite">
        {T.progress(drill.idx + 1, drill.queue.length)}{#if drill.combo >= 2}
          &nbsp;· {T.comboLabel}: {drill.combo} 🔥{/if}
      </p>

      <!-- The prompt -->
      {#if mode.prompt.kind === 'audio'}
        <p class="prompt-listen">{kind === 'numbers' ? T.numbers.listenPrompt : F.listenPrompt}</p>
        {#if promptAudioState === 'blocked'}
          <!-- Autoplay denied (no user gesture yet): an explicit play button. -->
          <button type="button" class="replay" onclick={() => void playPrompt()}>▶ {F.play}</button>
        {:else if promptAudioState === 'none'}
          <p class="hint" role="status">{F.noPromptAudio}</p>
        {:else if promptAudioState === 'missing'}
          <p class="hint" role="status">{T.numbers.missingAudio}</p>
        {:else}
          <!-- Plain replay, answer-safe label: never the Danish text or digits. -->
          <button
            type="button"
            class="replay"
            onclick={() => void playPrompt()}
            aria-label={F.replay}
            title={F.replayKeyTitle}
          >{F.replay}</button>
          {#if promptAudioState === 'tts'}<span class="tts-hint" title={F.ttsHintTitle}>{F.ttsHint}</span>{/if}
        {/if}
        {#if kind === 'numbers'}<p class="hint">{T.numbers.digitsHint}</p>{/if}
      {:else}
        <p class="prompt" lang={mode.prompt.lang === 'da' ? 'da' : undefined}>
          {current.prompt}
          {#if mode.prompt.replayable && current.audio?.kind === 'clip'}
            <SpeakButton text={current.audio.text} audio={current.audio.url} label={F.hear} />
          {/if}
        </p>
        {#if modeId === 'sv-da' && current.card?.exampleSv}
          <p class="hint">{current.card.exampleSv}</p>
        {/if}
      {/if}

      <!-- Verdict + plain-text summary for AT (the colored diff is aria-hidden). -->
      <div class="feedback" aria-live="polite">
        {#if drill.phase === 'feedback-correct'}
          <p class="verdict ok">{F.correct}</p>
        {:else if isCorrective}
          <p class="verdict no">{F.incorrect}</p>
          <p class="summary">
            {T.answerLabel} <strong lang={danishInput ? 'da' : undefined}>{current.answer}</strong>
            {#if lastTyped}&nbsp;· {T.youWrote} {lastTyped}{/if}
          </p>
        {/if}
      </div>

      {#if isCorrective}
        {#if diff.length > 0}
          <p class="diff" lang={danishInput ? 'da' : undefined} aria-hidden="true">
            {#each diff as d, i (i)}<span class={`d-${d.kind}`}>{d.ch}</span>{/each}
          </p>
        {/if}
        {@render answerLine(current)}
        {@render glossary(current)}
        <p class="hint">{T.typeItOnce}</p>
        {#if drill.queue.slice(drill.idx + 1).some((q) => q.id === current.id)}
          <p class="hint">{T.requeued}</p>
        {/if}
      {:else if drill.phase === 'answering' && drill.revealed}
        <!-- "Visa ordet": the answer + glossary are on screen; the coming
             submit scores as a hint-miss (outcomeOf handles it). -->
        {@render answerLine(current)}
        {@render glossary(current)}
      {/if}

      <form onsubmit={(e) => { e.preventDefault(); submitAnswer(); }}>
        <label class="vh" for="drill-answer">{mode.input.label}</label>
        <input
          id="drill-answer"
          type="text"
          value={typed}
          oninput={onInput}
          bind:this={input}
          lang={danishInput ? 'da' : undefined}
          inputmode={mode.input.inputmode === 'numeric' ? 'numeric' : undefined}
          pattern={mode.input.inputmode === 'numeric' ? '[0-9]*' : undefined}
          autocomplete="off"
          autocapitalize="off"
          autocorrect="off"
          spellcheck={false}
          placeholder={mode.input.placeholder}
        />
        <button type="submit">{T.submit}</button>
        {#if drill.phase === 'answering' && !drill.revealed}
          <button type="button" class="hint-btn" onclick={doReveal}>{T.hint}</button>
        {/if}
      </form>
      <p class="hint">{T.enterHint}</p>
      {#if mode.input.charHelper}
        <p class="charbar">
          <span>{F.charHelper}</span>
          {#each ['æ', 'ø', 'å'] as ch (ch)}
            <button type="button" class="char" onclick={() => insertChar(ch)} aria-label={`Infoga ${ch}`}>{ch}</button>
          {/each}
        </p>
      {/if}

      {#if saveWarning}<p class="warning" role="alert">{saveWarning}</p>{/if}
    </section>
  {/if}
{/if}

<style>
  .from-lesson { font-size: var(--step--1); margin: 0 0 var(--sp-3); }
  .card {
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--surface);
    padding: var(--sp-4) var(--sp-6);
  }
  .card + .card { margin-top: var(--sp-4); }
  .run { min-height: 16rem; padding: var(--sp-6); }
  .run:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

  /* Setup */
  .setup { display: flex; flex-wrap: wrap; align-items: center; gap: var(--sp-4); }
  .setup .hint { flex-basis: 100%; }
  .modes { border: 1px solid var(--border); border-radius: var(--radius); padding: var(--sp-1) var(--sp-3); display: flex; gap: var(--sp-3); flex-wrap: wrap; margin: 0; }
  .modes legend { font-size: var(--step--1); color: var(--muted); }
  .modes label { display: inline-flex; align-items: center; gap: 0.3em; font-size: var(--step--1); min-height: var(--min-tap); }
  .pick { display: inline-flex; align-items: center; gap: var(--sp-2); font-size: var(--step--1); }
  select { font: inherit; padding: var(--sp-1) var(--sp-2); border-radius: var(--radius); border: 1px solid var(--border); background: var(--surface); color: var(--text); min-height: var(--min-tap); }
  .cta { border: none; cursor: pointer; font-size: var(--step-0); }
  .tagline { margin: 0; font-size: var(--step--1); }

  /* Run */
  .progress { color: var(--muted); font-size: var(--step--1); margin: 0 0 var(--sp-3); }
  .prompt { font-size: var(--step-2); font-weight: 600; margin: 0 0 var(--sp-2); display: flex; align-items: baseline; gap: var(--sp-3); flex-wrap: wrap; }
  .prompt-listen { font-size: var(--step-1); margin: 0 0 var(--sp-2); }
  .hint { color: var(--muted); font-size: var(--step--1); margin: var(--sp-1) 0; }
  form { display: flex; gap: var(--sp-2); flex-wrap: wrap; margin-top: var(--sp-4); }
  form input { flex: 1 1 12rem; }
  form button { min-height: var(--min-tap); }
  .hint-btn { font-size: var(--step--1); }
  .charbar { display: flex; align-items: center; gap: var(--sp-2); flex-wrap: wrap; margin: var(--sp-2) 0 0; color: var(--muted); font-size: var(--step--1); }
  .char { min-width: 2.2em; min-height: 2.2em; font-size: var(--step-0); }
  .verdict { font-weight: 700; margin: var(--sp-2) 0; }
  .verdict.ok { color: var(--correct); }
  .verdict.no { color: var(--accent); }
  .summary { margin: 0 0 var(--sp-2); }
  .da { font-size: var(--step-2); font-weight: 700; margin: 0 0 var(--sp-1); display: flex; align-items: baseline; gap: var(--sp-3); flex-wrap: wrap; }
  .sv { margin: 0 0 var(--sp-1); }
  .ex { color: var(--muted); margin: 0 0 var(--sp-2); }
  .warning { color: var(--accent); margin-top: var(--sp-4); }
  .replay { min-height: var(--min-tap); }
  .tts-hint { color: var(--muted); font-size: var(--step--1); font-style: italic; margin-left: 0.35em; cursor: help; }

  /* Per-letter diff (aria-hidden; the aria-live summary is the AT version). */
  .diff { font-size: var(--step-2); letter-spacing: 0.06em; margin: 0 0 var(--sp-2); }
  .d-match { color: var(--correct); }
  .d-wrong { color: var(--accent); text-decoration: underline; }
  .d-missing { color: var(--accent); opacity: 0.6; text-decoration: underline dotted; }
  .d-extra { color: var(--accent); text-decoration: line-through; }

  /* Done */
  .done h2 { margin-top: 0; }
  .stats { display: flex; gap: var(--sp-6); flex-wrap: wrap; margin: var(--sp-4) 0; }
  .stats div { margin: 0; }
  .stats dt { color: var(--muted); font-size: var(--step--1); }
  .stats dd { margin: 0; font-size: var(--step-2); font-weight: 700; }
  .missed { list-style: none; margin: 0 0 var(--sp-4); padding: 0; display: grid; gap: var(--sp-2); }

  /* Skeleton */
  .skeleton { display: grid; gap: var(--sp-4); border: 1px solid var(--border); border-radius: var(--radius); background: var(--surface); padding: var(--sp-6); }
  .ph { border-radius: var(--radius); background: color-mix(in oklab, var(--text) 8%, transparent); }
  .ph-prompt { height: 2.2rem; width: 60%; }
  .ph-input { height: var(--min-tap); }
  .ph-buttons { height: var(--min-tap); width: 40%; }

  .vh { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }

  @media (prefers-reduced-motion: no-preference) {
    .ph { animation: pulse 1.2s ease-in-out infinite alternate; }
    @keyframes pulse { from { opacity: 0.55; } to { opacity: 1; } }
    .run.flash { animation: flash 650ms ease-out; }
    @keyframes flash {
      from { box-shadow: inset 0 0 0 3px var(--correct); }
      to { box-shadow: inset 0 0 0 0 transparent; }
    }
    .feedback .verdict { animation: fade 120ms ease-out; }
    @keyframes fade { from { opacity: 0; } to { opacity: 1; } }
  }
</style>

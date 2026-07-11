<script lang="ts">
  // /zen — the full-screen "Fokus" practice island (designs: Tal Fokus v2 =
  // dark, Tal Fokus - Morgendis v2 = light, auto by prefers-color-scheme).
  // Every decision lives in zen.ts (pure, tested); this file wires DOM, audio
  // and timers. tal plays composed COMMITTED clips only (product invariant:
  // never TTS for numbers); ord items/grading/audio come from the DRILL_MODES
  // registry, and 'repetera' sessions write the same SRS records the
  // flashcards read — 'blandat' is free practice and never grades.
  //
  // Transition rule (review-hardened): while a stage fade is running
  // (stageOpacity === 0) every user intent — keys, option clicks, Begynd —
  // is ignored. That single gate makes begin/advance/quit non-reentrant and
  // keeps the flow from being edited under a pending phase swap.
  import { onDestroy, onMount, tick } from 'svelte';
  import { Store } from '../lib/storage.ts';
  import { preloadClip, speak, stopSpeech } from '../lib/speech.ts';
  import { withBase } from '../lib/url.ts';
  import type { Card } from '../lib/vocab.ts';
  import type { SrsView } from '../lib/session.ts';
  import { fetchPraksis, praksisCache } from '../lib/praksis-client.ts';
  import { recordOutcome } from '../lib/drill-srs.ts';
  import { remapWithCaret } from '../lib/char-map.ts';
  import { getAudioContext } from '../lib/webaudio.ts';
  import {
    anyDue,
    back as flowBack,
    buildNumberSession,
    buildWordSession,
    gradeZen,
    highlightIndex,
    initialFlow,
    inputKind,
    isReady,
    LEVEL_IDS,
    parsePrefs,
    pick as flowPick,
    PREFS_KEY,
    stepOptions,
    wordDirection,
    wordModeId,
    WORD_SOURCE_IDS,
    wrapIndex,
    zenPrompt,
    zenReveal,
    type ZenFlow,
    type ZenGates,
    type ZenItem,
    type ZenReveal,
  } from '../lib/zen.ts';
  import {
    createNumberAudioPlayer,
    levelAvailable,
    type NumberAudioManifest,
    type NumberAudioPlayer,
  } from '../lib/number-audio.ts';
  import { UI } from '../lib/strings.ts';

  const T = UI.zen;

  let {
    cards = [],
    manifest = null,
    dannebrogCross = false,
    holdMs = 1400,
    sessionLength = 10,
  }: {
    /** Curated starter deck only — praksis is fetched lazily when 'ord' is picked. */
    cards?: Card[];
    /** Number-clip manifest — gates which tal-lyssna levels are offered. */
    manifest?: NumberAudioManifest | null;
    /** Faint off-center Dannebrog cross over the whole screen. */
    dannebrogCross?: boolean;
    /** How long the reveal stays before auto-advancing (on top of the fade). */
    holdMs?: number;
    /** Items per session (word sessions may build shorter — small due backlog). */
    sessionLength?: number;
  } = $props();

  const coverage = Object.fromEntries(
    LEVEL_IDS.map((id) => [id, manifest ? levelAvailable(id, manifest) : false]),
  ) as ZenGates['coverage'];
  const noSrs: SrsView = { getRecord: () => null, newCardsToday: () => 0 };

  let phase = $state<'start' | 'run' | 'done'>('start');
  let flow = $state<ZenFlow>(initialFlow());
  /** The flow that BUILT the running session — the run loop reads this, never
   *  the live flow, so no start-screen state can leak into grading. */
  let sessionFlow = $state<ZenFlow | null>(null);
  /** Highlight, tracked BY ID: async gate changes (the praksis fetch enabling
   *  'repetera') may insert/remove options, and an index would silently
   *  retarget the selection under the user's Enter. */
  let hot = $state<string | null>(null);
  let paused = $state(false);
  let items = $state<ZenItem[]>([]);
  let idx = $state(0);
  let typed = $state('');
  let reveal = $state<ZenReveal | null>(null);
  let stageOpacity = $state(1);
  // Playback needed a gesture ('blocked'), a clip failed ('missing') or no
  // voice/clip could sound at all ('none'); all recover the same way —
  // clicking the glow retries inside a fresh gesture.
  let audioNeedsClick = $state(false);
  // A word prompt fell back to talsyntes — disclose it (repo convention).
  let ttsHeard = $state(false);
  let saveWarning = $state(false);
  let deckFailed = $state(false);
  let ready = $state(false);
  let store = $state<Store | undefined>();
  let knownCards = $state<Card[]>(cards);
  let rootEl = $state<HTMLElement>();
  let inputEl = $state<HTMLInputElement>();
  let resumeBtn = $state<HTMLButtonElement>();
  let doneBackBtn = $state<HTMLButtonElement>();

  /** Live flow on the start screen, the session snapshot everywhere else. */
  const activeFlow = $derived(phase === 'start' ? flow : (sessionFlow ?? flow));
  const isListen = $derived(activeFlow.mode === 'lyssna');
  const kind = $derived(inputKind(activeFlow));
  const current = $derived(phase === 'run' ? items[idx] : undefined);
  const gates = $derived.by<ZenGates>(() => {
    const dir = ready ? wordDirection(flow) : null;
    const s = store;
    // Dictation only ever queues clip-backed cards — dueness must look at the
    // same pool, or 'repetera' could gate open onto an empty session.
    const pool =
      wordModeId(flow) === 'da-dictation' ? knownCards.filter((c) => !!c.audio) : knownCards;
    return {
      coverage,
      hasDue: dir !== null && s !== undefined && anyDue(pool, s, dir, new Date()),
    };
  });
  const options = $derived(stepOptions(flow, gates));
  /** hot, validated against the CURRENT options — never silently remapped. */
  const hotId = $derived(hot !== null && options.includes(hot) ? hot : null);
  const sourceRows = $derived.by(() => {
    if (flow.subject === 'tal') {
      return LEVEL_IDS.map((id) => ({
        id: id as string,
        label: T.levels[id],
        disabled: flow.mode === 'lyssna' && !coverage[id],
        note: flow.mode === 'lyssna' && !coverage[id] ? T.missingNote : '',
      }));
    }
    return WORD_SOURCE_IDS.map((id) => ({
      id: id as string,
      label: T.wordSources[id],
      disabled: id === 'repetera' && !gates.hasDue,
      note:
        id === 'repetera' && !gates.hasDue
          ? T.noDueNote
          : id === 'blandat'
            ? deckFailed
              ? T.starterOnlyNote
              : T.freeNote
            : '',
    }));
  });
  const summaryText = $derived(
    [
      flow.subject ? T.subjects[flow.subject].label : null,
      flow.mode ? T.modes[flow.mode] : null,
      flow.mode === 'översätt' && flow.dispLang ? T.langs[flow.dispLang] : null,
      flow.subject === 'tal'
        ? flow.level && T.levels[flow.level]
        : flow.wordSource && T.wordSources[flow.wordSource],
    ]
      .filter(Boolean)
      .join(' · '),
  );
  const prompt = $derived(current ? zenPrompt(current, activeFlow) : null);
  const runHint = $derived.by(() => {
    if (saveWarning) return T.saveError;
    if (audioNeedsClick && isListen && !reveal) return T.audioBlockedHint;
    const base = isListen
      ? activeFlow.subject === 'tal'
        ? T.runHintListen
        : T.runHintListenOrd
      : T.runHint;
    return ttsHeard && isListen ? `${T.ttsNote} · ${base}` : base;
  });

  let player: NumberAudioPlayer | undefined;
  let timers: ReturnType<typeof setTimeout>[] = [];
  // One deck fetch per page; reset on failure so the next Begynd retries.
  let deckPromise: Promise<void> | null = null;

  function delay(fn: () => void, ms: number) {
    timers.push(setTimeout(fn, ms));
  }
  function clearTimers() {
    timers.forEach(clearTimeout);
    timers = [];
  }
  /** A stage fade is in flight — user intents are ignored until it lands. */
  const inTransition = () => stageOpacity === 0;

  function focusInput() {
    inputEl?.focus();
  }
  /** Move DOM focus to the highlighted option (or Begynd on the last step)
   *  so keyboard focus, the visual highlight and the screen reader all track
   *  ONE cursor. */
  function focusHot() {
    void tick().then(() => {
      const target =
        rootEl?.querySelector<HTMLButtonElement>('button.hot') ??
        rootEl?.querySelector<HTMLButtonElement>('button.begin');
      target?.focus();
    });
  }

  // ---- start flow ----------------------------------------------------------
  function syncHot() {
    hot = stepOptions(flow, gates)[highlightIndex(flow, gates)] ?? null;
  }
  function moveHi(delta: number) {
    if (options.length === 0) return;
    const at = hotId !== null ? options.indexOf(hotId) : -1;
    hot = options[at === -1 ? 0 : wrapIndex(at, delta, options.length)] ?? null;
    focusHot();
  }
  function pickId(id: string) {
    if (inTransition()) return;
    const next = flowPick(flow, gates, id);
    if (next === flow) return;
    flow = next;
    syncHot();
    focusHot();
    // Picking 'ord' signals intent — warm the praksis deck while the user
    // walks the remaining steps (cached; begin() awaits the same promise).
    if (id === 'ord') void ensureWordDeck();
  }
  function stepBack() {
    if (inTransition()) return;
    const prev = flowBack(flow);
    if (prev === flow) return;
    flow = prev;
    syncHot();
    focusHot();
  }
  function stepForward() {
    if (flow.step === 'begin') {
      void begin();
      return;
    }
    if (hotId !== null) pickId(hotId);
  }

  function savePrefs() {
    try {
      localStorage.setItem(
        PREFS_KEY,
        JSON.stringify({
          subject: flow.subject,
          mode: flow.mode,
          dispLang: flow.dispLang,
          level: flow.level,
          wordSource: flow.wordSource,
        }),
      );
    } catch {
      /* storage full/blocked — prefs are a nicety */
    }
  }

  // ---- deck ----------------------------------------------------------------
  function ensureWordDeck(): Promise<void> {
    deckPromise ??= (async () => {
      const cached = praksisCache();
      if (cached) {
        if (knownCards.length === cards.length) knownCards = [...cards, ...cached];
        deckFailed = false;
        return;
      }
      try {
        const praksis = await fetchPraksis();
        knownCards = [...cards, ...praksis];
        deckFailed = false;
      } catch {
        // Starter-only: say so on the source step, and let a later Begynd retry.
        deckFailed = true;
        deckPromise = null;
      }
    })();
    return deckPromise;
  }

  // ---- session -------------------------------------------------------------
  async function begin() {
    if (inTransition() || !isReady(flow)) return;
    // Resume the shared AudioContext inside the Begynd gesture — one resume
    // unlocks every composed clip that follows.
    void getAudioContext()
      ?.resume()
      .catch(() => undefined);
    savePrefs();
    const built = { ...flow };
    const fadeStart = Date.now();
    stageOpacity = 0; // the fade masks a praksis fetch still in flight
    let session: ZenItem[] = [];
    if (built.subject === 'tal' && built.level) {
      session = buildNumberSession(built.level, sessionLength, Math.random);
    } else if (built.wordSource) {
      await ensureWordDeck();
      const modeId = wordModeId(built);
      const s = store;
      if (modeId) {
        session = buildWordSession({
          modeId,
          source: built.wordSource,
          cards: knownCards,
          srs: s ?? noSrs,
          now: new Date(),
          limits: s ? s.getSettings() : { newPerDay: 0, reviewPerDay: 0 },
          size: sessionLength,
        });
      }
    }
    if (session.length === 0) {
      // 'repetera' raced to empty (graded elsewhere meanwhile) — surface the
      // source step again; the gates now reflect reality.
      flow = { ...flow, step: 'source', wordSource: null };
      syncHot();
      stageOpacity = 1;
      return;
    }
    sessionFlow = built;
    preloadItem(session[0]);
    const swapIn = Math.max(0, 500 - (Date.now() - fadeStart));
    delay(() => {
      items = session;
      idx = 0;
      typed = '';
      reveal = null;
      saveWarning = false;
      ttsHeard = false;
      phase = 'run';
      delay(() => (stageOpacity = 1), 40);
      delay(focusInput, 120);
      if (built.mode === 'lyssna') delay(() => void playCurrent(), 650);
    }, swapIn);
  }

  // ---- audio ---------------------------------------------------------------
  function preloadItem(zi: ZenItem | undefined) {
    if (!zi || !isListen) return;
    if (zi.type === 'tal') {
      void player?.preload(zi.tokens);
    } else if (zi.item.audio?.kind === 'clip' && zi.item.audio.url) {
      preloadClip(withBase(zi.item.audio.url));
    }
  }

  async function playCurrent() {
    const zi = items[idx];
    if (!zi || !isListen || reveal) return;
    if (zi.type === 'tal') {
      if (!player) return;
      const out = await player.play(zi.tokens);
      if (out === 'cancelled') return;
      audioNeedsClick = out !== 'played';
    } else if (zi.item.audio?.kind === 'clip') {
      const a = zi.item.audio;
      const out = await speak(a.text, a.url ? { audioUrl: withBase(a.url) } : {});
      if (out === 'cancelled') return;
      audioNeedsClick = out === 'blocked' || out === 'none';
      ttsHeard = out === 'tts';
    }
  }
  function replay() {
    if (inTransition()) return;
    if (!reveal) void playCurrent();
  }

  /** The revealed word's real pronunciation (ord only — tal reveals stay
   *  silent per the design; hearing the word you just saw or wrote is the
   *  app's core promise). Fire-and-forget. */
  function playRevealAudio(zi: ZenItem) {
    if (zi.type !== 'ord' || zi.item.audio?.kind !== 'clip') return;
    // In lyssna the prompt WAS the word — replaying it reinforces; keep it.
    const a = zi.item.audio;
    void speak(a.text, a.url ? { audioUrl: withBase(a.url) } : {});
  }
  function stopAllAudio() {
    player?.stop();
    stopSpeech();
  }

  // ---- run loop --------------------------------------------------------------
  function submitOrAdvance() {
    if (phase !== 'run' || inTransition()) return;
    if (reveal) {
      advance();
      return;
    }
    const zi = items[idx];
    if (!zi) return;
    if (typed.trim() === '') {
      // Blank Enter never grades; in lyssna it replays instead.
      if (isListen) replay();
      return;
    }
    stopAllAudio();
    const correct = gradeZen(typed, zi, activeFlow);
    // One SRS write per graded attempt — 'repetera' only ('blandat' is free
    // practice, same contract as the flashcards' "Öva fritt"). Reads the
    // session snapshot: the live flow cannot re-label a free session.
    const dir = wordDirection(activeFlow);
    const s = store;
    if (
      zi.type === 'ord' &&
      activeFlow.wordSource === 'repetera' &&
      zi.item.sourceCardId &&
      dir &&
      s
    ) {
      const result = recordOutcome(
        s,
        zi.item.sourceCardId,
        dir,
        correct ? 'correct' : 'wrong',
        new Date(),
      );
      if (!result.ok) saveWarning = true;
    }
    reveal = zenReveal(zi, typed, correct);
    playRevealAudio(zi);
    preloadItem(items[idx + 1]);
    delay(() => {
      if (reveal) advance();
    }, 500 + holdMs);
  }

  function advance() {
    if (!reveal || inTransition()) return;
    clearTimers();
    stopSpeech(); // a reveal clip must not trail into the next item
    stageOpacity = 0;
    if (idx >= items.length - 1) {
      delay(() => {
        phase = 'done';
        reveal = null;
        delay(() => (stageOpacity = 1), 40);
        void tick().then(() => doneBackBtn?.focus());
      }, 550);
      return;
    }
    delay(() => {
      idx += 1;
      typed = '';
      reveal = null;
      ttsHeard = false;
      delay(() => (stageOpacity = 1), 40);
      delay(focusInput, 120);
      if (isListen) delay(() => void playCurrent(), 500);
    }, 500);
  }

  function pause() {
    stopAllAudio();
    clearTimers();
    paused = true;
    void tick().then(() => resumeBtn?.focus());
  }
  function resume() {
    paused = false;
    delay(focusInput, 60);
    if (reveal) {
      delay(() => {
        if (reveal) advance();
      }, holdMs);
    } else if (isListen) {
      delay(() => void playCurrent(), 350);
    }
  }
  function quit() {
    stopAllAudio();
    clearTimers();
    paused = false;
    stageOpacity = 0;
    delay(() => {
      phase = 'start'; // flow stays on Begynd — Enter restarts, Esc adjusts
      sessionFlow = null;
      reveal = null;
      typed = '';
      items = [];
      idx = 0;
      delay(() => (stageOpacity = 1), 40);
      focusHot();
    }, 400);
  }
  function backToStart() {
    if (inTransition()) return;
    stageOpacity = 0;
    delay(() => {
      phase = 'start';
      sessionFlow = null;
      reveal = null;
      typed = '';
      items = [];
      idx = 0;
      delay(() => (stageOpacity = 1), 40);
      focusHot();
    }, 550);
  }

  // ---- input ---------------------------------------------------------------
  function onInput(e: Event) {
    const el = e.currentTarget as HTMLInputElement;
    if (kind === 'digits') {
      // Never rewrite mid-IME-composition — that breaks the composition.
      if ((e as InputEvent).isComposing) {
        typed = el.value;
        return;
      }
      const cleaned = el.value.replace(/[^0-9\s]/gu, '');
      if (cleaned !== el.value) el.value = cleaned;
      typed = cleaned;
    } else if (kind === 'danish') {
      // Live ä/ö→æ/ø with the caret preserved (Swedish keyboards lack æ/ø).
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

  // ---- keys ----------------------------------------------------------------
  function onKey(e: KeyboardEvent) {
    // Never swallow browser/OS shortcuts (Cmd/Ctrl+R must stay a reload),
    // IME composition commits, or Enter meant for a FOCUSED button (Tab
    // users: the button's own activation must win over the global handler).
    if (e.metaKey || e.ctrlKey || e.altKey || e.isComposing) return;
    if (e.key === 'Enter' && (e.target as HTMLElement | null)?.tagName === 'BUTTON') return;
    if (paused) {
      if (e.key === 'Enter') {
        e.preventDefault();
        resume();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        quit();
      }
      return;
    }
    if (inTransition()) return; // a fade is landing — ignore intents
    if (phase === 'start') {
      if (e.key === 'Enter') {
        e.preventDefault();
        stepForward();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        stepBack();
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        e.preventDefault();
        moveHi(-1);
      } else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        e.preventDefault();
        moveHi(1);
      }
      return;
    }
    if (phase === 'run') {
      if (e.key === 'Escape') {
        e.preventDefault();
        pause();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        submitOrAdvance();
      } else if ((e.key === 'r' || e.key === 'R') && kind === 'digits' && isListen && !reveal) {
        // Only when the input is digits-only (tal lyssna) — in ord dictation
        // the learner types Danish words, where r is just a letter.
        e.preventDefault();
        replay();
      }
      return;
    }
    if (phase === 'done' && (e.key === 'Enter' || e.key === 'Escape')) {
      e.preventDefault();
      backToStart();
    }
  }

  /** Click anywhere on the run screen re-focuses the answer input. */
  function onRootClick() {
    if (phase === 'run' && !paused && !inTransition()) focusInput();
  }

  onMount(() => {
    store = new Store();
    player = createNumberAudioPlayer(manifest ?? { atoms: {} });
    // Restore last session's picks so the start flow pre-highlights them
    // (Morgendis v2 behavior).
    let raw: string | null = null;
    try {
      raw = localStorage.getItem(PREFS_KEY);
    } catch {
      /* private mode etc. */
    }
    const prefs = parsePrefs(raw);
    flow = { ...flow, ...prefs };
    ready = true;
    syncHot();
    if (prefs.subject === 'ord') void ensureWordDeck();
  });

  onDestroy(() => {
    clearTimers();
    player?.stop();
    stopSpeech();
  });
</script>

<svelte:window onkeydown={onKey} onclick={onRootClick} />

<div class="zen" bind:this={rootEl}>
  {#if dannebrogCross}
    <div class="cross-v" aria-hidden="true"></div>
    <div class="cross-h" aria-hidden="true"></div>
  {/if}

  {#if phase === 'start'}
    <div class="stage" style:opacity={stageOpacity}>
      {#if flow.step === 'subject'}
        <div class="opt-row rise">
          {#each ['ord', 'tal'] as const as id (id)}
            <button
              type="button"
              class="opt"
              class:hot={hotId === id}
              onclick={() => pickId(id)}
              onfocus={() => (hot = id)}
            >
              <span class="opt-label">{T.subjects[id].label}</span>
              <span class="opt-sub">{T.subjects[id].sub}</span>
            </button>
          {/each}
        </div>
      {:else if flow.step === 'mode'}
        <div class="opt-row rise">
          {#each ['lyssna', 'översätt'] as const as id (id)}
            <button
              type="button"
              class="opt"
              class:hot={hotId === id}
              onclick={() => pickId(id)}
              onfocus={() => (hot = id)}
            >
              <span class="opt-label">{T.modes[id]}</span>
              <span class="opt-sub">{flow.subject ? T.modeSubs[flow.subject][id] : ''}</span>
            </button>
          {/each}
        </div>
      {:else if flow.step === 'lang'}
        <div class="lang-step rise">
          <div class="step-heading">{T.langHeading}</div>
          <div class="opt-row tight">
            {#each ['danska', 'svenska'] as const as id (id)}
              <button
                type="button"
                class="opt small"
                class:hot={hotId === id}
                onclick={() => pickId(id)}
                onfocus={() => (hot = id)}
              >
                <span class="opt-label">{T.langs[id]}</span>
                <span class="opt-sub">{flow.subject ? T.langSubs[flow.subject][id] : ''}</span>
              </button>
            {/each}
          </div>
        </div>
      {:else if flow.step === 'source'}
        <div class="source-col rise">
          {#each sourceRows as row (row.id)}
            <button
              type="button"
              class="src"
              class:hot={!row.disabled && hotId === row.id}
              disabled={row.disabled}
              onclick={() => pickId(row.id)}
              onfocus={() => (hot = row.id)}
            >
              <span>{row.label}</span>
              {#if row.note}<span class="src-note">{row.note}</span>{/if}
            </button>
          {/each}
        </div>
      {:else}
        <div class="begin-step rise-slow">
          <div class="summary">{summaryText}</div>
          <button type="button" class="begin" onclick={() => void begin()}>
            <span class="begin-word" lang="da">{T.begin}</span>
            <span class="key">{T.enterKey}</span>
          </button>
        </div>
      {/if}

      <div class="footer">
        {#if flow.step !== 'subject'}
          <button type="button" class="back rise" onclick={stepBack}>
            <span class="back-word">{T.back}</span>
            <span class="key">{T.escKey}</span>
          </button>
        {/if}
        <span class="key">{flow.step === 'begin' ? T.keyHintBegin : T.keyHintPick}</span>
      </div>
    </div>
  {/if}

  {#if phase === 'run'}
    <div class="stage run" style:opacity={stageOpacity} inert={paused}>
      <div class="prompt-wrap">
        <div
          class="layer"
          inert={reveal !== null}
          style:opacity={reveal ? 0 : 1}
        >
          {#if current && prompt === null}
            <button
              type="button"
              class="glow"
              title={T.replayTitle}
              aria-label={T.replayTitle}
              onclick={replay}
            ></button>
          {:else if current && prompt}
            <div class="prompt-text" lang={prompt.lang ?? undefined} aria-live="polite">
              {prompt.text}
            </div>
          {/if}
        </div>
        <div class="layer reveal-layer" style:opacity={reveal ? 1 : 0} aria-live="polite">
          {#if reveal}
            <div class="reveal-word" class:ok={reveal.correct} lang="da">{reveal.word}</div>
            <div class="reveal-sub">{reveal.sub}</div>
          {/if}
        </div>
      </div>

      <input
        bind:this={inputEl}
        value={typed}
        oninput={onInput}
        lang={kind === 'danish' ? 'da' : undefined}
        inputmode={kind === 'digits' ? 'numeric' : 'text'}
        pattern={kind === 'digits' ? '[0-9]*' : undefined}
        autocomplete="off"
        autocapitalize="none"
        autocorrect="off"
        spellcheck="false"
        aria-label={kind === 'digits' ? T.inputDigits : kind === 'danish' ? T.inputDanish : T.inputSwedish}
        class="answer"
        class:wide={kind !== 'digits'}
        style:opacity={reveal ? 0.18 : 1}
      />

      <!-- Touch affordances: iOS numeric keypads lack a return key, and touch
           users have no Esc — quiet buttons, coarse pointers only. -->
      <div class="touch-row">
        <button type="button" class="touch-btn" onclick={submitOrAdvance}>{T.submit}</button>
        <button type="button" class="touch-btn" onclick={pause}>{T.pauseShort}</button>
      </div>

      <div class="footer"><span class="key" role="status">{runHint}</span></div>
    </div>
  {/if}

  {#if phase === 'done'}
    <div class="stage done" style:opacity={stageOpacity}>
      <div class="done-text" role="status">
        {T.done(items.length, activeFlow.subject ? T.subjects[activeFlow.subject].label : '')}
      </div>
      <button type="button" class="back" onclick={backToStart} bind:this={doneBackBtn}>
        <span class="back-word">{T.back}</span>
      </button>
    </div>
  {/if}

  {#if paused}
    <div class="pause">
      <button type="button" class="pause-opt" onclick={resume} bind:this={resumeBtn}>
        <span class="pause-label">{T.resume}</span>
        <span class="key">{T.enterKey}</span>
      </button>
      <span class="pause-dot">·</span>
      <button type="button" class="pause-opt" onclick={quit}>
        <span class="pause-label quiet">{T.quit}</span>
        <span class="key">{T.escKey}</span>
      </button>
    </div>
  {/if}
</div>

<style>
  /* Two design-fixed palettes, keyed to the viewer's scheme like the rest of
     the site: light = Tal Fokus - Morgendis v2 (warm paper, Dannebrog glow),
     dark = Tal Fokus v2 (near-black, gold glow). --z-dim/--z-sub are lifted
     from the .dc values just enough to clear contrast floors (dim ≥3:1 for
     option labels, sub ≥4.5:1 for answer-carrying text) — a deliberate,
     minimal a11y deviation; the decorative key hints keep the design tones. */
  .zen {
    --z-bg: #f7f5f1;
    --z-text: #26211b;
    --z-dim: #89816f;
    --z-key: #c4bdb0;
    --z-faint: #d0cabe;
    --z-sub: #746c5e;
    --z-ok: #41724b;
    --z-glow: #c8102e;
    --z-glow-box: 0 0 22px 6px rgba(200, 16, 46, 0.25);
    --z-hot-line: rgba(38, 33, 27, 0.35);
    --z-input-line: rgba(38, 33, 27, 0.28);
    --z-input-line-focus: rgba(38, 33, 27, 0.45);
    --z-back-line: rgba(38, 33, 27, 0.2);
    --z-focus-ring: rgba(38, 33, 27, 0.5);
    position: fixed;
    inset: 0;
    background: var(--z-bg);
    color: var(--z-text);
    overflow: hidden;
    font-family: var(--font-sans);
    line-height: 1.4;
  }
  @media (prefers-color-scheme: dark) {
    .zen {
      --z-bg: #18140f;
      --z-text: #ece5d8;
      --z-dim: #80775f;
      --z-key: #4c4536;
      --z-faint: #3a3428;
      --z-sub: #948a72;
      --z-ok: #a9c8a2;
      --z-glow: #c9a86a;
      --z-glow-box: 0 0 18px 4px rgba(201, 168, 106, 0.18);
      --z-hot-line: rgba(236, 229, 216, 0.35);
      --z-input-line: rgba(236, 229, 216, 0.22);
      --z-input-line-focus: rgba(236, 229, 216, 0.4);
      --z-back-line: rgba(236, 229, 216, 0.15);
      --z-focus-ring: rgba(236, 229, 216, 0.5);
    }
  }

  .zen button {
    background: none;
    border: none;
    padding: 0;
    margin: 0;
    font: inherit;
    color: inherit;
    cursor: pointer;
    user-select: none;
  }
  .zen button:focus-visible {
    outline: 1px solid var(--z-focus-ring);
    outline-offset: 5px;
    border-radius: 2px;
  }

  .cross-v,
  .cross-h {
    position: absolute;
    background: rgba(200, 16, 46, 0.07);
    pointer-events: none;
  }
  .cross-v { left: 38%; top: 0; bottom: 0; width: 1px; }
  .cross-h { top: 50%; left: 0; right: 0; height: 1px; }

  .stage {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 48px;
    transition: opacity 500ms ease;
  }

  /* ---- start ---- */
  .opt-row { display: flex; gap: 64px; }
  .opt-row.tight { gap: 48px; }
  .opt { text-align: center; }
  .opt-label {
    display: inline-block;
    font-size: 21px;
    font-weight: 300;
    letter-spacing: 0.05em;
    color: var(--z-dim);
    border-bottom: 1px solid transparent;
    padding-bottom: 5px;
    transition: color 400ms ease, border-color 400ms ease;
  }
  .opt-sub {
    display: block;
    font-size: 11px;
    margin-top: 7px;
    color: var(--z-faint);
    letter-spacing: 0.03em;
    transition: color 400ms ease;
  }
  .opt.hot .opt-label { color: var(--z-text); border-bottom-color: var(--z-hot-line); }
  .opt.hot .opt-sub { color: var(--z-sub); }
  .opt.small .opt-label { font-size: 18px; letter-spacing: 0.04em; padding-bottom: 4px; }
  .opt.small .opt-sub { font-size: 10px; margin-top: 6px; }

  .lang-step { display: flex; flex-direction: column; align-items: center; gap: 24px; }
  .step-heading { font-size: 11px; letter-spacing: 0.1em; color: var(--z-key); }

  .source-col { display: flex; flex-direction: column; align-items: center; gap: 14px; }
  .src {
    font-size: 16px;
    letter-spacing: 0.04em;
    color: var(--z-dim);
    transition: color 400ms ease;
    display: flex;
    align-items: baseline;
    gap: 10px;
  }
  .src.hot { color: var(--z-text); }
  .src:disabled { color: var(--z-faint); cursor: default; }
  .src-note { font-size: 10px; color: var(--z-sub); }
  .src:disabled .src-note { color: var(--z-sub); }

  .begin-step { display: flex; flex-direction: column; align-items: center; gap: 20px; }
  .summary { font-size: 12px; letter-spacing: 0.06em; color: var(--z-sub); }
  .begin { display: flex; align-items: baseline; gap: 14px; }
  .begin-word { font-size: 34px; font-weight: 200; letter-spacing: 0.07em; }

  .footer {
    position: absolute;
    bottom: 26px;
    display: flex;
    align-items: baseline;
    gap: 32px;
  }
  .key { font-size: 10px; letter-spacing: 0.14em; color: var(--z-key); }
  .back { display: flex; align-items: baseline; gap: 10px; }
  .back-word {
    font-size: 12px;
    letter-spacing: 0.06em;
    color: var(--z-dim);
    border-bottom: 1px solid var(--z-back-line);
    padding-bottom: 2px;
  }

  /* ---- run ---- */
  .stage.run { gap: 44px; }
  .prompt-wrap { position: relative; height: 170px; width: 100%; }
  .layer {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 16px;
    transition: opacity 500ms ease;
  }
  .reveal-layer { gap: 14px; pointer-events: none; }

  .glow {
    width: 14px;
    height: 14px;
    border-radius: 50%;
    background: var(--z-glow);
    box-shadow: var(--z-glow-box);
  }
  .prompt-text {
    font-size: clamp(2.5rem, 6vw, 4rem);
    font-weight: 200;
    letter-spacing: 0.04em;
    font-variant-numeric: tabular-nums;
    text-align: center;
    padding: 0 24px;
  }
  .reveal-word {
    font-size: clamp(2.2rem, 5.5vw, 3.6rem);
    font-weight: 200;
    letter-spacing: 0.02em;
    transition: color 400ms ease;
    text-align: center;
    padding: 0 24px;
  }
  .reveal-word.ok { color: var(--z-ok); }
  .reveal-sub { font-size: 15px; font-weight: 300; color: var(--z-sub); }

  .answer {
    background: transparent;
    border: none;
    border-bottom: 1px solid var(--z-input-line);
    outline: none;
    color: var(--z-text);
    caret-color: var(--z-text);
    font-family: inherit;
    font-size: clamp(1.4rem, 2.6vw, 1.9rem);
    font-weight: 200;
    letter-spacing: 0.04em;
    text-align: center;
    width: min(60vw, 200px);
    padding: 0 10px 9px;
    transition: opacity 500ms ease, border-color 400ms ease;
  }
  .answer.wide { width: min(60vw, 440px); }
  .answer:focus { border-bottom-color: var(--z-input-line-focus); }

  /* Touch-only controls (no Esc, iOS numeric keypad has no return key). */
  .touch-row { display: none; }
  @media (pointer: coarse) {
    .touch-row { display: flex; gap: 32px; }
    .touch-btn {
      font-size: 12px;
      letter-spacing: 0.06em;
      color: var(--z-dim);
      border-bottom: 1px solid var(--z-back-line);
      padding: 6px 2px;
      min-height: var(--min-tap);
    }
  }

  /* ---- done ---- */
  .stage.done { gap: 30px; transition-duration: 600ms; }
  .done-text { font-size: clamp(1.3rem, 2.4vw, 1.7rem); font-weight: 300; letter-spacing: 0.02em; }
  .done .back-word { padding-bottom: 3px; }

  /* ---- pause ---- */
  .pause {
    position: absolute;
    inset: 0;
    background: var(--z-bg);
    z-index: 5;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 44px;
  }
  .pause-opt { text-align: center; }
  .pause-label {
    display: block;
    font-size: 22px;
    font-weight: 300;
    letter-spacing: 0.05em;
  }
  .pause-label.quiet { color: var(--z-sub); }
  .pause-opt .key { display: block; margin-top: 6px; }
  .pause-dot { color: var(--z-faint); }

  @media (prefers-reduced-motion: no-preference) {
    .rise { animation: riseIn 500ms ease both; }
    .rise-slow { animation: riseIn 700ms ease both; }
    /* Morgendis breathes faster and deeper than the dark gold dot. */
    .glow { animation: breatheLight 4s ease-in-out infinite; }
    @media (prefers-color-scheme: dark) {
      .glow { animation: breatheDark 6s ease-in-out infinite; }
    }
  }
  @keyframes breatheLight {
    0%, 100% { opacity: 0.35; transform: scale(0.8); }
    50% { opacity: 1; transform: scale(1); }
  }
  @keyframes breatheDark {
    0%, 100% { opacity: 0.5; transform: scale(0.9); }
    50% { opacity: 0.9; transform: scale(1); }
  }
  @keyframes riseIn {
    from { opacity: 0; transform: translateY(8px); }
    to { opacity: 1; transform: none; }
  }
</style>

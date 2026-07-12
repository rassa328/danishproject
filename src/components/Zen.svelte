<script lang="ts">
  // /zen — the full-screen "Fokus" practice island. Colors come from the shared
  // data-theme tokens (dark default; the ◐ toggle applies here too, top-right).
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
  import type { StudyGroup } from '../lib/deck-groups.ts';
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
    isReady,
    itemDirection,
    itemInputKind,
    parsePrefs,
    pick as flowPick,
    PREFS_KEY,
    setForSource,
    SOURCE_BLANDAT,
    SOURCE_REPETERA,
    SOURCE_TAL,
    sourceIsGraded,
    sourceQueue,
    stepOptions,
    talAvailable,
    ALL_TAL,
    playableTal,
    wordDirections,
    wordSessionId,
    wrapIndex,
    zenPrompt,
    zenReveal,
    zenSets,
    type ZenContext,
    type ZenFlow,
    type ZenItem,
    type ZenReveal,
  } from '../lib/zen.ts';
  import {
    createNumberAudioPlayer,
    type NumberAudioManifest,
    type NumberAudioPlayer,
  } from '../lib/number-audio.ts';
  import { UI } from '../lib/strings.ts';

  const T = UI.zen;

  let {
    cards = [],
    groups = [],
    manifest = null,
    dannebrogCross = false,
    holdMs = 1400,
    sessionLength = 10,
  }: {
    /** Curated starter deck only — praksis is fetched lazily once a mode is picked. */
    cards?: Card[];
    /** The flashcards' study groups — zen's källa sets (due-all excluded). */
    groups?: StudyGroup[];
    /** Number-clip manifest — decides which numbers lyssna can draw. */
    manifest?: NumberAudioManifest | null;
    /** Faint off-center Dannebrog cross over the whole screen. */
    dannebrogCross?: boolean;
    /** How long the reveal stays before auto-advancing (on top of the fade). */
    holdMs?: number;
    /** Items per session (word sessions may build shorter — small due backlog). */
    sessionLength?: number;
  } = $props();

  /** 0–100 values lyssna can compose from committed clips (never TTS). */
  const talPlayable = playableTal(manifest);
  const sets = zenSets(groups);
  const noSrs: SrsView = { getRecord: () => null, newCardsToday: () => 0 };
  // Deck screen (source step) category grid: how many sets show before "fler…",
  // the grid column count (must match the CSS grid), and the "fler…" sentinel.
  const CURATED_SETS = 6;
  const DECK_COLS = 3;
  const FLER = 'fler';

  let phase = $state<'start' | 'run' | 'done'>('start');
  let flow = $state<ZenFlow>(initialFlow());
  /** The flow that BUILT the running session — the run loop reads this, never
   *  the live flow, so no start-screen state can leak into grading. */
  let sessionFlow = $state<ZenFlow | null>(null);
  /** Highlight, tracked BY ID: async gate changes (the praksis fetch enabling
   *  'repetera') may insert/remove options, and an index would silently
   *  retarget the selection under the user's Enter. */
  let hot = $state<string | null>(null);
  // Deck screen: whether the "fler…" grid is expanded, and whether the "fler…"
  // cell itself is the focused grid cell (it isn't a stepOptions id).
  let moreCats = $state(false);
  let flerFocused = $state(false);
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
  // This session was built without the praksis deck (fetch failed or timed
  // out) — the learner should know they're on the starter words only.
  let sessionStarterOnly = $state(false);
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
  const current = $derived(phase === 'run' ? items[idx] : undefined);
  /** The input's shape follows the ITEM (mixed översätt alternates sides). */
  const kind = $derived(current ? itemInputKind(current, activeFlow) : 'danish');
  const ctx = $derived.by<ZenContext>(() => {
    const dirs = ready ? wordDirections(flow) : [];
    const s = store;
    // Dictation only ever queues clip-backed cards — dueness must look at the
    // same pool, or 'repetera' could gate open onto an empty session.
    const pool = flow.mode === 'lyssna' ? knownCards.filter((c) => !!c.audio) : knownCards;
    return {
      talPlayable,
      hasDue: dirs.length > 0 && s !== undefined && anyDue(pool, s, dirs, new Date()),
      sets,
    };
  });
  const options = $derived(stepOptions(flow, ctx));
  /** hot, validated against the CURRENT options — never silently remapped. */
  const hotId = $derived(hot !== null && options.includes(hot) ? hot : null);
  const talOk = $derived(talAvailable(flow, ctx));
  const sourceRows = $derived([
    {
      id: SOURCE_REPETERA,
      label: T.sources.repetera,
      disabled: !ctx.hasDue,
      note: ctx.hasDue ? '' : T.noDueNote,
    },
    {
      id: SOURCE_BLANDAT,
      label: T.sources.blandat,
      disabled: false,
      note: deckFailed ? T.starterOnlyNote : T.freeNote,
    },
    {
      id: SOURCE_TAL,
      label: T.sources.tal,
      disabled: !talOk,
      note: talOk ? T.talNote : T.missingNote,
    },
  ]);
  // Deck-screen category grid model. The two schema options (repetera·blandat)
  // form the top row; the cloud below is tal + a curated set slice (+ the rest
  // behind "fler…"), laid out in DECK_COLS columns. `deckCells` is the flat,
  // in-DOM-order list the 2-D arrow nav walks; `FLER` is the toggle cell.
  const visibleSets = $derived(moreCats ? sets : sets.slice(0, CURATED_SETS));
  const bigCells = $derived(
    sourceRows.filter((r) => r.id !== SOURCE_TAL && !r.disabled).map((r) => r.id),
  );
  const talCell = $derived(
    sourceRows.find((r) => r.id === SOURCE_TAL && !r.disabled) ? [SOURCE_TAL] : [],
  );
  const cloudCells = $derived([
    ...talCell,
    ...visibleSets.map((s) => `set:${s.id}`),
    FLER,
  ]);
  const deckCells = $derived([...bigCells, ...cloudCells]);
  const sourceLabel = $derived.by(() => {
    if (flow.source === null) return null;
    if (flow.source === SOURCE_REPETERA) return T.sources.repetera;
    if (flow.source === SOURCE_BLANDAT) return T.sources.blandat;
    if (flow.source === SOURCE_TAL) return T.sources.tal;
    return setForSource(flow.source, sets)?.label ?? null;
  });
  const summaryText = $derived(
    [
      flow.mode ? T.modes[flow.mode].label : null,
      flow.mode === 'översätt' && flow.direction ? T.directions[flow.direction].label : null,
      sourceLabel,
    ]
      .filter(Boolean)
      .join(' · '),
  );
  const prompt = $derived(current ? zenPrompt(current, activeFlow) : null);
  const runHint = $derived.by(() => {
    if (saveWarning) return T.saveError;
    if (audioNeedsClick && isListen && !reveal) return T.audioBlockedHint;
    let base: string = isListen
      ? activeFlow.source === SOURCE_TAL
        ? T.runHintListen
        : T.runHintListenOrd
      : T.runHint;
    if (ttsHeard) base = `${T.ttsNote} · ${base}`;
    if (sessionStarterOnly) base = `${T.starterOnlyNote} · ${base}`;
    return base;
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
    hot = stepOptions(flow, ctx)[highlightIndex(flow, ctx)] ?? null;
    flerFocused = false;
  }
  function moveHi(delta: number) {
    if (options.length === 0) return;
    const at = hotId !== null ? options.indexOf(hotId) : -1;
    hot = options[at === -1 ? 0 : wrapIndex(at, delta, options.length)] ?? null;
    focusHot();
  }

  // Click semantics: a first click SELECTS (shows the red underline); a second
  // click on the already-selected option CONFIRMS (advances). Enter confirms
  // the selection. Mirrors the arrows ("pilar väljer · enter").
  function selectOrConfirm(id: string) {
    if (inTransition()) return;
    if (hotId === id && !flerFocused) pickId(id);
    else {
      hot = id;
      flerFocused = false;
      focusHot();
    }
  }
  function toggleMore() {
    if (inTransition()) return;
    moreCats = !moreCats;
    flerFocused = true;
    hot = null;
    focusHot();
  }
  /** Focus a deck-grid cell by id ('fler' is the toggle, not a stepOptions id). */
  function setCell(cellId: string) {
    if (cellId === FLER) {
      flerFocused = true;
      hot = null;
    } else {
      flerFocused = false;
      hot = cellId;
    }
    focusHot();
  }
  /** 2-D arrow nav over the deck screen: row 0 = the two schema options, rows
   *  below = the DECK_COLS-wide category grid (tal + sets + "fler…"). ←/→ walk
   *  the flat cell list clamped; ↑/↓ jump rows, crossing between the option row
   *  and the cloud. */
  function gridMove(dir: 'left' | 'right' | 'up' | 'down') {
    const cells = deckCells;
    if (cells.length === 0) return;
    const bigLen = bigCells.length;
    const cur = flerFocused ? FLER : hotId;
    const at = cur !== null ? cells.indexOf(cur) : -1;
    if (at === -1) {
      setCell(cells[0]!);
      return;
    }
    const max = cells.length - 1;
    let next = at;
    if (dir === 'left') next = Math.max(0, at - 1);
    else if (dir === 'right') next = Math.min(max, at + 1);
    else if (dir === 'down')
      next = at < bigLen ? Math.min(max, bigLen + at) : Math.min(max, at + DECK_COLS);
    else
      next =
        at >= bigLen + DECK_COLS
          ? at - DECK_COLS
          : at >= bigLen
            ? Math.min(bigLen - 1, at - bigLen)
            : at;
    setCell(cells[next]!);
  }
  function pickId(id: string) {
    if (inTransition()) return;
    const next = flowPick(flow, ctx, id);
    if (next === flow) return;
    flow = next;
    syncHot();
    focusHot();
    // A picked mode signals intent — warm the praksis deck while the user
    // walks the remaining steps (cached; begin() awaits the same promise);
    // the source step's dueness gate also wants the full deck.
    if (flow.step !== 'mode') void ensureWordDeck();
  }
  /** Esc/tillbaka on the FIRST step leaves zen for the site's start page. */
  function exitZen() {
    window.location.assign(withBase(''));
  }
  function stepBack() {
    if (inTransition()) return;
    const prev = flowBack(flow);
    if (prev === flow) {
      exitZen();
      return;
    }
    flow = prev;
    syncHot();
    focusHot();
  }
  function stepForward() {
    if (flow.step === 'begin') {
      void begin();
      return;
    }
    // Enter on the "fler…" cell reveals/hides the rest of the grid, it doesn't
    // start a session.
    if (flow.step === 'source' && flerFocused) {
      toggleMore();
      return;
    }
    if (hotId !== null) pickId(hotId);
  }

  function savePrefs() {
    try {
      localStorage.setItem(
        PREFS_KEY,
        JSON.stringify({
          mode: flow.mode,
          direction: flow.direction,
          source: flow.source,
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
    let starterOnly = false;
    if (built.source === SOURCE_TAL) {
      // lyssna draws only clip-complete values; översätt uses the whole pool.
      const pool = built.mode === 'lyssna' ? talPlayable : ALL_TAL;
      if (pool.length > 0) session = buildNumberSession(pool, sessionLength, Math.random);
    } else if (built.source !== null) {
      // Bounded wait: a praksis fetch that hangs must not park the fade at
      // opacity 0 forever — after the race the session builds from whatever
      // knownCards holds (starter-only at worst, disclosed via runHint).
      await Promise.race([
        ensureWordDeck(),
        new Promise<void>((resolve) => setTimeout(resolve, 8000)),
      ]);
      starterOnly = praksisCache() === null;
      const sessionId = wordSessionId(built);
      const queue = sourceQueue(built.source, sets);
      const s = store;
      if (sessionId && queue) {
        session = buildWordSession({
          sessionId,
          match: queue.match,
          free: queue.free,
          cards: knownCards,
          srs: s ?? noSrs,
          now: new Date(),
          limits: s ? s.getSettings() : { newPerDay: 0, reviewPerDay: 0 },
          size: sessionLength,
        });
      }
    }
    if (session.length === 0) {
      // The källa raced to empty (repetera graded elsewhere, an exhausted
      // set) — surface the source step again; the gates now reflect reality.
      flow = { ...flow, step: 'source', source: null };
      syncHot();
      focusHot();
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
      audioNeedsClick = false;
      sessionStarterOnly = starterOnly;
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
    const shown = reveal;
    void speak(a.text, a.url ? { audioUrl: withBase(a.url) } : {}).then((out) => {
      // Disclose a talsyntes fallback while ITS reveal is still on screen.
      if (out === 'tts' && reveal === shown) ttsHeard = true;
    });
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
    // One SRS write per graded attempt — repetera and set sessions grade
    // ('blandat' is free practice, the flashcards' "Öva fritt" contract).
    // The direction is the ITEM's own, and the source comes from the session
    // snapshot: the live flow cannot re-label a free session.
    const dir = itemDirection(zi);
    const s = store;
    if (
      zi.type === 'ord' &&
      sourceIsGraded(activeFlow.source) &&
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
      audioNeedsClick = false;
      delay(() => (stageOpacity = 1), 40);
      delay(focusInput, 120);
      if (isListen) delay(() => void playCurrent(), 500);
    }, 500);
  }

  function pause() {
    if (inTransition()) return;
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
      } else if (
        e.key === 'ArrowLeft' ||
        e.key === 'ArrowRight' ||
        e.key === 'ArrowUp' ||
        e.key === 'ArrowDown'
      ) {
        e.preventDefault();
        // The source step is a 2-D grid; the two-option mode/direction steps
        // stay linear (Left/Up = −1, Right/Down = +1).
        if (flow.step === 'source') {
          gridMove(
            e.key === 'ArrowLeft'
              ? 'left'
              : e.key === 'ArrowRight'
                ? 'right'
                : e.key === 'ArrowUp'
                  ? 'up'
                  : 'down',
          );
        } else {
          moveHi(e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 1);
        }
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
    if (prefs.mode !== null) void ensureWordDeck();
  });

  onDestroy(() => {
    clearTimers();
    player?.stop();
    stopSpeech();
  });

  // The faint top-left ‹ arrow mirrors Escape for the current phase (the design
  // shows it on every screen). Behaviour is unchanged — it just calls the same
  // handlers the keyboard does.
  function topBack() {
    if (paused) {
      quit();
      return;
    }
    if (inTransition()) return;
    if (phase === 'run') pause();
    else if (phase === 'done') backToStart();
    else stepBack();
  }
</script>

<svelte:window onkeydown={onKey} onclick={onRootClick} />

<div class="zen" bind:this={rootEl}>
  {#if dannebrogCross}
    <div class="cross-v" aria-hidden="true"></div>
    <div class="cross-h" aria-hidden="true"></div>
  {/if}

  <!-- Persistent chrome: faint back arrow (top-left) + theme toggle (top-right). -->
  <button type="button" class="top-back" onclick={topBack} aria-label={T.back}>←</button>
  <button
    type="button"
    class="theme-toggle"
    data-theme-toggle="true"
    aria-label={UI.themeToggle}
    title={UI.themeToggle}>◐</button
  >

  {#if phase === 'start'}
    <div class="stage" style:opacity={stageOpacity}>
      {#if flow.step === 'mode'}
        <div class="opt-row rise">
          {#each ['lyssna', 'översätt'] as const as id (id)}
            <button
              type="button"
              class="opt"
              class:hot={hotId === id}
              onclick={() => selectOrConfirm(id)}
              onfocus={() => {
                hot = id;
                flerFocused = false;
              }}
            >
              <span class="opt-label">{T.modes[id].label}</span>
              <span class="opt-sub">{T.modes[id].sub}</span>
            </button>
          {/each}
        </div>
      {:else if flow.step === 'direction'}
        <div class="lang-step rise">
          <div class="step-heading">{T.directionHeading}</div>
          <div class="opt-row tight">
            {#each ['sv-da', 'da-sv'] as const as id (id)}
              <button
                type="button"
                class="opt small"
                class:hot={hotId === id}
                onclick={() => selectOrConfirm(id)}
                onfocus={() => {
                  hot = id;
                  flerFocused = false;
                }}
              >
                <span class="opt-label">{T.directions[id].label}</span>
                <span class="opt-sub">{T.directions[id].sub}</span>
              </button>
            {/each}
          </div>
        </div>
      {:else if flow.step === 'source'}
        {@const bigSources = sourceRows.filter((r) => r.id !== SOURCE_TAL)}
        {@const talRow = sourceRows.find((r) => r.id === SOURCE_TAL)}
        <div class="source-step rise">
          <!-- The two schema choices as big options (repetera · blandat). -->
          <div class="opt-row deck-opts">
            {#each bigSources as row (row.id)}
              {@const sub = row.id === SOURCE_REPETERA && !row.disabled ? T.repeteraSub : row.note}
              <button
                type="button"
                class="opt"
                class:hot={!row.disabled && hotId === row.id}
                disabled={row.disabled}
                onclick={() => selectOrConfirm(row.id)}
                onfocus={() => {
                  hot = row.id;
                  flerFocused = false;
                }}
              >
                <span class="opt-label">{row.label}</span>
                {#if sub}<span class="opt-sub">{sub}</span>{/if}
              </button>
            {/each}
          </div>
          <!-- …or a category: tal + a curated set slice, in a 2-D grid; "fler…"
               reveals the rest. -->
          <div class="cloud-whisper">{T.categoryWhisper}</div>
          <div class="cat-grid">
            {#if talRow}
              <button
                type="button"
                class="cat"
                class:hot={!talRow.disabled && hotId === talRow.id}
                disabled={talRow.disabled}
                onclick={() => selectOrConfirm(talRow.id)}
                onfocus={() => {
                  hot = talRow.id;
                  flerFocused = false;
                }}
              >
                {talRow.label}{#if talRow.note}&nbsp;<span class="cat-note">{talRow.note}</span>{/if}
              </button>
            {/if}
            {#each visibleSets as set (set.id)}
              <button
                type="button"
                class="cat"
                class:hot={hotId === `set:${set.id}`}
                onclick={() => selectOrConfirm(`set:${set.id}`)}
                onfocus={() => {
                  hot = `set:${set.id}`;
                  flerFocused = false;
                }}
              >
                {set.label}
              </button>
            {/each}
            <button
              type="button"
              class="cat fler"
              class:hot={flerFocused}
              onclick={toggleMore}
              onfocus={() => {
                flerFocused = true;
                hot = null;
              }}
            >
              {moreCats ? T.farre : T.fler}
            </button>
          </div>
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
        {#if flow.step === 'mode'}
          <a class="back" href={withBase('')}>
            <span class="back-word">{T.exit}</span>
            <span class="key">{T.escKey}</span>
          </a>
        {:else}
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
            >
              <span class="wf-bars" aria-hidden="true">
                {#each [9, 16, 24, 31, 34, 30, 23, 15, 10] as h (h)}
                  <span style={`height:${h}px`}></span>
                {/each}
              </span>
            </button>
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
        {T.done(items.length, activeFlow.source === SOURCE_TAL ? 'tal' : 'ord')}
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
  /* Redesign Zen: chromeless typographic practice. Colors come from the shared
     data-theme tokens (dark default) so the ◐ toggle applies here too. The
     500ms .stage/.layer/.answer opacity transitions are coordinated with JS
     timers (the inTransition() gate) — do not change their durations. */
  .zen {
    position: fixed;
    inset: 0;
    background: var(--bg);
    color: var(--ink);
    overflow: hidden;
    font-family: var(--font-sans);
    line-height: 1.4;
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
    outline: 1px solid var(--mut3);
    outline-offset: 5px;
    border-radius: 2px;
  }
  /* The flow options / category cells ARE the focused element (focus tracks the
     highlight), so the red .hot underline / begin word is the focus indicator —
     no boxed outline (both :focus and :focus-visible, since focus is moved
     programmatically). */
  .opt:focus,
  .opt:focus-visible,
  .cat:focus,
  .cat:focus-visible,
  .begin:focus,
  .begin:focus-visible {
    outline: none;
  }

  /* Persistent chrome: faint back arrow (top-left) + ◐ theme toggle (top-right). */
  .top-back {
    position: absolute;
    top: 26px;
    left: clamp(18px, 5vw, 40px);
    z-index: 6;
    font-size: 17px;
    line-height: 1;
    color: var(--mut6);
    transition: color 160ms ease;
  }
  .top-back:hover,
  .top-back:focus-visible {
    color: var(--mut2);
  }
  .theme-toggle {
    position: absolute;
    top: 26px;
    right: clamp(18px, 5vw, 40px);
    z-index: 6;
    font-size: 14px;
    line-height: 1;
    color: var(--mut4);
    transition: color 160ms ease;
  }
  .theme-toggle:hover,
  .theme-toggle:focus-visible {
    color: var(--ink);
  }

  .cross-v,
  .cross-h {
    position: absolute;
    background: rgba(200, 16, 46, 0.07);
    pointer-events: none;
  }
  .cross-v {
    left: 38%;
    top: 0;
    bottom: 0;
    width: 1px;
  }
  .cross-h {
    top: 50%;
    left: 0;
    right: 0;
    height: 1px;
  }

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

  /* ---- start: mode / direction ---- */
  .opt-row {
    display: flex;
    gap: clamp(40px, 9vw, 96px);
    flex-wrap: wrap;
    justify-content: center;
  }
  .opt-row.tight {
    gap: clamp(36px, 8vw, 72px);
  }
  .opt {
    text-align: center;
  }
  .opt-label {
    display: inline-block;
    font-size: 29px;
    font-weight: 300;
    color: var(--mut3);
    border-bottom: 1px solid transparent;
    padding-bottom: 6px;
    transition:
      color 400ms ease,
      border-color 400ms ease;
  }
  .opt-sub {
    display: block;
    font-size: 11.5px;
    margin-top: 10px;
    color: var(--mut5);
    letter-spacing: 0.02em;
    transition: color 400ms ease;
  }
  .opt.hot .opt-label {
    color: var(--ink);
    border-bottom-color: var(--red);
  }
  .opt.hot .opt-sub {
    color: var(--mut2);
  }
  .opt:disabled {
    cursor: default;
  }
  .opt:disabled .opt-label {
    color: var(--mut5);
  }
  .opt.small .opt-label {
    font-size: 26px;
  }

  .lang-step {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 22px;
  }
  .step-heading {
    font-size: 11.5px;
    letter-spacing: 0.02em;
    color: var(--mut5);
  }

  /* ---- start: source (two deck options + category cloud) ---- */
  .source-step {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 22px;
    max-width: min(90vw, 640px);
  }
  .deck-opts {
    margin-bottom: 6px;
  }
  .cloud-whisper {
    font-size: 11.5px;
    color: var(--mut5);
  }
  /* Wider, arrow-friendly grid of category cells (fixed DECK_COLS columns so
     the 2-D nav stride is correct). Highlight = red underline only, no box. */
  .cat-grid {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 10px 14px;
    width: min(92vw, 520px);
    margin-top: 2px;
  }
  .cat {
    font-size: 13.5px;
    font-weight: 300;
    color: var(--mut2);
    background: none;
    border: none;
    border-bottom: 1px solid transparent;
    padding: 6px 10px;
    cursor: pointer;
    text-align: center;
    line-height: 1.3;
    transition:
      color 200ms ease,
      border-color 200ms ease;
  }
  .cat:hover {
    color: var(--ink);
  }
  .cat.hot {
    color: var(--ink);
    border-bottom-color: var(--red);
  }
  .cat.fler {
    font-style: italic;
    color: var(--mut4);
  }
  .cat.fler:hover {
    color: var(--mut2);
  }
  .cat:disabled {
    color: var(--mut5);
    cursor: default;
  }
  .cat:disabled:hover {
    color: var(--mut5);
  }
  .cat-note {
    font-size: 11px;
    color: var(--mut4);
  }

  /* ---- start: begin ---- */
  .begin-step {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 20px;
  }
  .summary {
    font-size: 11.5px;
    letter-spacing: 0.02em;
    color: var(--mut5);
  }
  .begin {
    display: flex;
    align-items: baseline;
    gap: 14px;
  }
  .begin-word {
    font-size: 44px;
    font-weight: 300;
    color: var(--soft);
  }

  /* ---- footer hints ---- */
  .footer {
    position: absolute;
    bottom: 28px;
    display: flex;
    align-items: baseline;
    justify-content: center;
    flex-wrap: wrap;
    gap: 8px 28px;
    padding: 0 24px;
  }
  .key {
    font-size: 12px;
    letter-spacing: 0.1em;
    color: var(--mut4);
  }
  .back {
    display: inline-flex;
    align-items: baseline;
    gap: 8px;
    text-decoration: none;
    color: inherit;
  }
  .back-word {
    font-size: 12px;
    letter-spacing: 0.1em;
    color: var(--mut4);
    border-bottom: 1px solid var(--bd3);
    padding-bottom: 2px;
    transition: color 160ms ease;
  }
  .back:hover .back-word,
  .back:focus-visible .back-word {
    color: var(--ink);
  }

  /* ---- run ---- */
  .stage.run {
    gap: 44px;
  }
  .prompt-wrap {
    position: relative;
    height: 170px;
    width: 100%;
  }
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
  .reveal-layer {
    gap: 14px;
    pointer-events: none;
  }

  /* lyssna prompt: a neutral waveform button (replays on click). */
  .glow {
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }
  .wf-bars {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    height: 40px;
  }
  .wf-bars span {
    flex: none;
    width: 3px;
    border-radius: 2px;
    background: var(--bars);
  }

  .prompt-text {
    font-size: clamp(2rem, 5.2vw, 46px);
    font-weight: 300;
    color: var(--soft);
    font-variant-numeric: tabular-nums;
    text-align: center;
    padding: 0 24px;
  }
  .reveal-word {
    font-size: clamp(2rem, 5.2vw, 46px);
    font-weight: 300;
    color: var(--ink);
    transition: color 400ms ease;
    text-align: center;
    padding: 0 24px;
  }
  .reveal-word.ok {
    color: var(--ok);
  }
  .reveal-sub {
    font-size: 15px;
    font-weight: 300;
    color: var(--mut2);
    text-align: center;
    padding: 0 24px;
  }

  .answer {
    background: transparent;
    border: none;
    border-bottom: 1px solid var(--bd3);
    outline: none;
    color: var(--ink);
    caret-color: var(--ink);
    font-family: inherit;
    font-size: 24px;
    font-weight: 300;
    text-align: center;
    width: min(60vw, 200px);
    padding: 0 10px 9px;
    transition:
      opacity 500ms ease,
      border-color 300ms ease;
  }
  .answer.wide {
    width: min(70vw, 440px);
  }
  .answer:focus {
    border-bottom-color: var(--mut2);
  }

  /* Touch-only controls (no Esc, iOS numeric keypad has no return key). */
  .touch-row {
    display: none;
  }
  @media (pointer: coarse) {
    .touch-row {
      display: flex;
      gap: 32px;
    }
    .touch-btn {
      font-size: 12px;
      letter-spacing: 0.06em;
      color: var(--mut2);
      border-bottom: 1px solid var(--bd3);
      padding: 6px 2px;
      min-height: var(--min-tap);
    }
  }

  /* ---- done ---- */
  .stage.done {
    gap: 30px;
    transition-duration: 600ms;
  }
  .done-text {
    font-family: var(--font-serif);
    font-size: clamp(1.6rem, 3vw, 28px);
    font-weight: 500;
    text-align: center;
    padding: 0 24px;
  }

  /* ---- pause ---- */
  .pause {
    position: absolute;
    inset: 0;
    background: var(--bg);
    z-index: 5;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: clamp(36px, 8vw, 64px);
  }
  .pause-opt {
    text-align: center;
  }
  .pause-label {
    display: block;
    font-size: 29px;
    font-weight: 300;
    color: var(--ink);
  }
  .pause-label.quiet {
    color: var(--mut3);
  }
  .pause-opt .key {
    display: block;
    margin-top: 8px;
  }
  .pause-dot {
    color: var(--mut5);
  }

  @media (prefers-reduced-motion: no-preference) {
    .rise {
      animation: riseIn 500ms ease both;
    }
    .rise-slow {
      animation: riseIn 700ms ease both;
    }
  }
  @keyframes riseIn {
    from {
      opacity: 0;
      transform: translateY(8px);
    }
    to {
      opacity: 1;
      transform: none;
    }
  }
</style>

<script lang="ts">
  // The ONE shared drill island (plan §3.2): /zen mounts it with kind="words"
  // (translate/listen × words/sentences, word items writing into the
  // flashcards' SRS store), /tal with kind="numbers" (clip-composed number
  // dictation, no SRS in v1). All loop decisions live in pure libs —
  // drill-engine (phases), drill-modes (sessions + per-item sub-configs),
  // sentence-match (lenient grading), drill-srs (grading) — this component
  // only wires DOM, audio and focus. A design pass will reskin the interface
  // soon: keep markup semantic, CSS token-only, and behavior OUT of here.
  //
  // Like FlashcardReviewer, only the small starter deck arrives as props; the
  // 5000-word praksis deck is fetched lazily the first time a session needs it
  // (praksis-client), degrading visibly to starter-only on failure.
  import { onDestroy, onMount, tick } from 'svelte';
  import { Store, DIRECTIONS } from '../lib/storage.ts';
  import { preloadClip, speak } from '../lib/speech.ts';
  import { withBase } from '../lib/url.ts';
  import SpeakButton from './SpeakButton.svelte';
  import CelebrationFlag from './CelebrationFlag.svelte';
  import type { Card } from '../lib/vocab.ts';
  import type { GroupMatch, StudyGroup } from '../lib/deck-groups.ts';
  import { fetchPraksis, praksisCache } from '../lib/praksis-client.ts';
  import {
    DRILL_SESSIONS,
    availableCount,
    subConfigOf,
    type DrillBuildDeps,
    type DrillItem,
    type DrillSessionId,
  } from '../lib/drill-modes.ts';
  import {
    advance,
    createDrill,
    extendQueue,
    isBlankAttempt,
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
    /** Study-group descriptors: the due-all match + the pickable themed sets. */
    groups?: StudyGroup[];
    /** Lessons with a word list, for the multi-select set picker. */
    lessons?: LessonRef[];
    /** Number-clip manifest (kind="numbers" only). */
    manifest?: NumberAudioManifest | null;
  } = $props();

  const SIZES = [10, 20, 40];
  /** Flöde pacing: first chunk, top-up batch, and the remaining-cards level
   *  that triggers a top-up. */
  const FLOW_CHUNK = 20;
  const FLOW_TOPUP = 10;
  const FLOW_LOW_WATER = 3;
  /** Enter is ignored this long after a miss/near panel appears, so a held or
   *  double-tapped Enter can't skip it unseen (user decision 2026-07-11). */
  const MISS_GUARD_MS = 300;
  /** Numbers have no SRS (sub srs === null) — a null-object SrsView keeps
   *  buildItems' deps uniform without touching localStorage. */
  const noSrs: SrsView = { getRecord: () => null, newCardsToday: () => 0 };
  /** The due-only cross-deck match ({kind:'all'} = buildQueue's due-only case). */
  const dueMatch: GroupMatch = groups.find((g) => g.match.kind === 'all')?.match ?? {
    kind: 'all',
  };
  /** Pickable sets = every group except the synthetic due-all entry. */
  const setGroups = groups.filter((g) => g.match.kind !== 'all');
  const setOptgroups = [...new Set(setGroups.map((g) => g.optgroup))];
  const now = () => new Date();

  let store: Store | undefined;
  let player: NumberAudioPlayer | undefined;
  let advanceTimer: ReturnType<typeof setTimeout> | null = null;

  let ready = $state(false);
  let fromLesson = $state<string | null>(null);
  // A ?tag deep-link that matches no lesson still works — buildQueue trains the
  // raw tag directly (parity with the flashcards' tag banner).
  let rawTag = $state<string | null>(null);
  let wordMode = $state<'translate' | 'listen'>('translate');
  let contentKind = $state<'words' | 'sentences'>('words');
  let sourceId = $state<'due' | 'free' | 'sets'>('due');
  let selectedSets = $state<string[]>([]);
  let size = $state<number | 'flow' | 'all'>(kind === 'numbers' ? 20 : 'flow');
  let levelId = $state<NumberLevelId>('0-20');

  // Starter props ∪ the lazily fetched praksis deck (merged by ensureDeck()).
  let knownCards = $state<Card[]>(cards);
  let loadingDeck = $state(false);
  let praksisNotice = $state(false);
  /** Probe result for the current setup (words only): drives "Alla (N)" and
   *  the Starta gate. null until the first probe lands. */
  let available = $state<number | null>(null);

  let drill = $state<DrillState | null>(null);
  let typed = $state('');
  // The graded attempt frozen for the miss/near diff (typed is cleared).
  let lastTyped = $state('');
  let saveWarning = $state('');
  let emptyMsg = $state('');
  let finishedAt = $state<number | null>(null);
  /** performance.now() when the miss/near panel appeared — the Enter guard. */
  let missShownAt = 0;
  /** A lenient sentence attempt graded 'near': scored correct, but the panel
   *  holds (no auto-advance) so the diff is actually seen. */
  let nearShown = $state(false);
  /** The round ended by completing it (advance to done, or Avsluta with
   *  answers) — earns the flag. Backing out of a bounded run does not. */
  let completedRun = $state(false);
  // Prompt-audio outcome in the audio modes: 'blocked' swaps in an explicit
  // ▶-button (autoplay denied), 'none'/'missing' show a Swedish notice.
  let promptAudioState = $state<'ok' | 'tts' | 'none' | 'blocked' | 'missing'>('ok');
  let input = $state<HTMLInputElement>();
  let doneHeading = $state<HTMLElement>();
  let emptyMsgEl = $state<HTMLElement>();
  let startBtn = $state<HTMLButtonElement>();

  // Flöde bookkeeping: the full built item list + the top-up cursor.
  let fullList: DrillItem[] = [];
  let flowPos = 0;

  const sessionId = $derived<DrillSessionId>(
    kind === 'numbers'
      ? 'number-dictation'
      : contentKind === 'sentences'
        ? wordMode === 'listen'
          ? 'listen-sent'
          : 'translate-sent'
        : wordMode === 'listen'
          ? 'listen'
          : 'translate',
  );
  const session = $derived(DRILL_SESSIONS[sessionId]);
  const isFlow = $derived(kind === 'words' && size === 'flow');
  const running = $derived(drill !== null && drill.phase !== 'done');
  const current = $derived(drill && drill.phase !== 'done' ? drill.queue[drill.idx] : undefined);
  // Per-ITEM behavior: translate runs mix sv→da and da→sv items, so prompt
  // shape, input attributes and matching all follow the current item's sub.
  const sub = $derived(current ? subConfigOf(current) : null);
  const isMiss = $derived(drill?.phase === 'feedback-miss');
  const showDiff = $derived(
    (isMiss || nearShown) && current && current.sub !== 'number'
      ? diffLetters(current.answer, lastTyped)
      : [],
  );
  const danishInput = $derived(sub?.input.lang === 'da');
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
  /** Why Starta is disabled — shown inline the moment the probe says 0. */
  const emptyReason = $derived(
    kind !== 'words' || available !== 0
      ? ''
      : sourceId === 'due' && !rawTag
        ? T.noDue
        : sessionId === 'listen'
          ? T.noDictationCards
          : sessionId === 'translate-sent' || sessionId === 'listen-sent'
            ? T.noSentenceCards
            : T.noCards,
  );

  function clearAdvanceTimer() {
    if (advanceTimer !== null) {
      clearTimeout(advanceTimer);
      advanceTimer = null;
    }
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

  /** Tag/set/free sessions always need praksis (praksis rows carry tags and
   *  make up most themed sets); the due source only when non-starter records
   *  exist. */
  function needsPraksis(): boolean {
    if (kind !== 'words') return false;
    if (rawTag || sourceId === 'free' || sourceId === 'sets') return true;
    return hasNonStarterRecords();
  }

  // One shared fetch for start() AND the availability probe; a failure resets
  // so a later attempt can retry (praksisNotice keeps the degradation visible).
  let deckPromise: Promise<void> | null = null;
  function ensureDeck(): Promise<void> {
    if (kind !== 'words' || knownCards.length > cards.length) return Promise.resolve();
    const cached = praksisCache();
    if (cached) {
      // Another island already fetched the deck — merge without re-awaiting.
      knownCards = [...cards, ...cached];
      return Promise.resolve();
    }
    if (!deckPromise) {
      loadingDeck = true;
      deckPromise = fetchPraksis()
        .then((praksis) => {
          knownCards = [...cards, ...praksis];
          praksisNotice = false;
        })
        .catch(() => {
          praksisNotice = true; // degrade to starter-only, visibly
          deckPromise = null;
        })
        .finally(() => {
          loadingDeck = false;
        });
    }
    return deckPromise;
  }

  /** The picked sets as ONE union descriptor: lesson picks contribute their
   *  vocab tag, themed picks their group match (deck-groups 'union' kind). */
  function setsMatch(): GroupMatch {
    const tags: string[] = [];
    const matches: GroupMatch[] = [];
    for (const id of selectedSets) {
      const lesson = lessons.find((l) => l.id === id);
      if (lesson) {
        tags.push(lesson.tag);
        continue;
      }
      const g = setGroups.find((x) => x.id === id);
      if (g) matches.push(g.match);
    }
    return { kind: 'union', tags, matches };
  }

  function buildDeps(size: number): DrillBuildDeps {
    const s = store;
    const deps: DrillBuildDeps = {
      cards: knownCards,
      srs: s ?? noSrs,
      now: now(),
      limits: s ? s.getSettings() : { newPerDay: 0, reviewPerDay: 0 },
      tag: rawTag,
      match: rawTag ? null : sourceId === 'sets' ? setsMatch() : dueMatch,
      free: sourceId === 'free',
      size,
    };
    if (kind === 'numbers') {
      deps.numberLevel = levelId;
      if (manifest) deps.manifest = manifest;
    }
    return deps;
  }

  // ---- setup effects ----

  // Sentences have no dueness (ungraded), so the due source cannot feed them —
  // steer to free roam instead of silently building from everything.
  $effect(() => {
    if (contentKind === 'sentences' && sourceId === 'due') sourceId = 'free';
  });

  // A bounded pick that no longer fits the real pool falls back to "Alla (N)".
  $effect(() => {
    if (kind === 'words' && typeof size === 'number' && available !== null && size >= available) {
      size = 'all';
    }
  });

  // Recompute the real available count whenever the setup changes (words only).
  // Token-guarded: a slow praksis fetch must not land a stale count.
  let probeToken = 0;
  $effect(() => {
    if (!ready || kind !== 'words') return;
    // Reactive reads the probe depends on:
    void sessionId;
    void sourceId;
    void selectedSets.join(',');
    void rawTag;
    void knownCards;
    const token = ++probeToken;
    const run = () => {
      if (token !== probeToken) return;
      const { size: _unused, ...deps } = buildDeps(0);
      available = availableCount(DRILL_SESSIONS[sessionId], deps);
    };
    if (needsPraksis() && !praksisCache()) void ensureDeck().then(run);
    else run();
  });

  // ---- session lifecycle ----

  // Guards overlapping start() calls while one awaits the praksis fetch.
  let startToken = 0;

  async function start() {
    clearAdvanceTimer();
    player?.stop();
    emptyMsg = '';
    saveWarning = '';
    drill = null;
    finishedAt = null;
    completedRun = false;
    nearShown = false;
    if (kind === 'words' && needsPraksis()) {
      const token = ++startToken;
      await ensureDeck();
      if (token !== startToken) return; // superseded by a newer start()
    }
    let items: DrillItem[];
    if (isFlow) {
      fullList = session.buildItems(buildDeps(Number.MAX_SAFE_INTEGER));
      items = fullList.slice(0, FLOW_CHUNK);
      flowPos = items.length;
    } else {
      const n =
        size === 'all' || size === 'flow' ? Number.MAX_SAFE_INTEGER : size;
      items = session.buildItems(buildDeps(n));
    }
    if (items.length === 0) {
      emptyMsg = emptyReason || (kind === 'numbers' ? T.noCards : T.noCards);
      // Starting into an emptied pool commonly lands here with the done
      // section — and the focused button — unmounted; without an explicit
      // target, keyboard/SR focus falls to <body>.
      tick().then(() => emptyMsgEl?.focus());
      return;
    }
    drill = createDrill(items, { size: items.length, now: Date.now() });
    beginItem();
  }

  function beginItem() {
    typed = '';
    lastTyped = '';
    nearShown = false;
    promptAudioState = 'ok';
    preloadNext();
    tick().then(() => {
      input?.focus();
      if (sub?.prompt.kind === 'audio') void playPrompt();
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

  /** Play the PROMPT audio (listening modes) and capture the outcome so
   *  silence is never mute-with-no-message. 'cancelled' (superseded) is ignored. */
  async function playPrompt() {
    const item = current;
    const a = item?.audio;
    if (!item || !a) return;
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

  /** The item's own audio, fire-and-forget: the clip on correct/miss feedback,
   *  the composed number in the miss panel and end-screen replays. */
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
    const cfg = sub;
    if (!d || !item || !cfg) return;
    if (d.phase !== 'answering') return;
    // A blank Enter never grades: a key-repeated Enter after continuing past
    // the miss panel (typed is cleared) would otherwise write Rating.Again to
    // a card the user never saw. After "Visa svaret", Enter stays the explicit
    // give-up (scored hint-miss).
    if (!d.revealed && isBlankAttempt(typed)) return;
    // Sentence subs grade leniently: 'near' scores correct but pauses on the
    // diff panel ("aware when they are wrong" without punishing a slip).
    const verdict = cfg.verdict?.(typed, item);
    const correct = verdict ? verdict !== 'wrong' : cfg.matches(typed, item);
    // Outcome BEFORE submit(): a reveal makes even a correct answer a hint-miss.
    const outcome = outcomeOf(d, correct);
    const s = store;
    // One SRS write per scored attempt — but never in free roam: an endless
    // auto-scored flow over 5000 words must not flood the review schedule.
    if (cfg.srs && item.sourceCardId && s && sourceId !== 'free') {
      const result = recordOutcome(s, item.sourceCardId, cfg.srs.direction, outcome, now());
      if (!result.ok) saveWarning = F.saveError;
    }
    const next = submit(d, correct);
    drill = next;
    if (next.phase === 'feedback-correct') {
      // Every 5th consecutive correct gets the rising combo blip instead.
      blip(next.combo % 5 === 0 ? 'combo' : 'correct');
      if (item.audio?.kind === 'clip') playItemAudio(item);
      if (verdict === 'near') {
        // Hold the panel: no auto-advance, Enter/"Vidare" continues.
        nearShown = true;
        lastTyped = typed;
        typed = '';
        missShownAt = performance.now();
        tick().then(() => input?.focus());
      } else {
        advanceTimer = setTimeout(() => {
          advanceTimer = null;
          advanceNow();
        }, 650);
      }
    } else {
      // feedback-miss: play the item, freeze the attempt for the diff. The
      // input stays mounted and focused; Enter continues (no retype gate).
      lastTyped = typed;
      typed = '';
      missShownAt = performance.now();
      playItemAudio(item);
      tick().then(() => input?.focus());
    }
  }

  /** Leave the miss/near panel (Enter or the "Vidare" button). Guarded for
   *  MISS_GUARD_MS after the panel appeared so a held Enter can't skip it. */
  function continueFromMiss() {
    const d = drill;
    if (!d) return;
    const holding = d.phase === 'feedback-miss' || (d.phase === 'feedback-correct' && nearShown);
    if (!holding) return;
    if (performance.now() - missShownAt < MISS_GUARD_MS) return;
    clearAdvanceTimer();
    nearShown = false;
    drill = advance(d);
    afterAdvance();
  }

  function onSubmit() {
    const d = drill;
    if (!d) return;
    if (d.phase === 'answering') submitAnswer();
    else continueFromMiss();
  }

  function advanceNow() {
    const d = drill;
    if (!d || d.phase !== 'feedback-correct' || nearShown) return;
    drill = advance(d);
    afterAdvance();
  }

  function afterAdvance() {
    const d = drill;
    if (!d) return;
    if (d.phase === 'done') {
      finishedAt = Date.now();
      completedRun = true; // the round was finished, not abandoned
      tick().then(() => doneHeading?.focus());
      return;
    }
    topUpFlow();
    beginItem();
  }

  /** Flöde: keep the queue ahead of the player. Set/free sources recycle the
   *  built list when it runs dry (a small lesson repeats — that's practice);
   *  the due source just ends: its backlog is genuinely drained. */
  function topUpFlow() {
    const d = drill;
    if (!isFlow || !d || d.phase === 'done') return;
    if (d.queue.length - d.idx > FLOW_LOW_WATER) return;
    if (flowPos >= fullList.length) {
      if (sourceId === 'due' && !rawTag) return; // backlog drained → let it end
      flowPos = 0;
    }
    const chunk = fullList.slice(flowPos, flowPos + FLOW_TOPUP);
    flowPos += chunk.length;
    if (chunk.length > 0) drill = extendQueue(d, chunk);
  }

  function doReveal() {
    const d = drill;
    if (!d || d.phase !== 'answering') return;
    drill = reveal(d);
    tick().then(() => input?.focus());
  }

  /** "‹ Tillbaka" (bounded: confirm + back to setup) / "Avsluta" (Flöde:
   *  finish the round → stats + flag). Escape mirrors both. */
  function leaveRun() {
    const d = drill;
    if (!d || d.phase === 'done') return;
    clearAdvanceTimer();
    player?.stop();
    if (isFlow && d.answered > 0) {
      // Ending a flow is completing it, not abandoning it.
      finishedAt = Date.now();
      completedRun = true;
      nearShown = false;
      drill = { ...d, phase: 'done', idx: d.queue.length };
      tick().then(() => doneHeading?.focus());
      return;
    }
    if (d.answered > 0 && !confirm(T.confirmBack)) return;
    drill = null;
    tick().then(() => startBtn?.focus());
  }

  /** Live ä/ö→æ/ø remap with the caret preserved (Danish inputs only). */
  function onInput(e: Event) {
    const el = e.currentTarget as HTMLInputElement;
    if (sub?.input.liveRemap) {
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
    if (e.metaKey || e.ctrlKey || e.altKey) return; // never swallow shortcuts
    // Escape leaves the run from ANYWHERE, including the answer input.
    if (e.key === 'Escape' && running) {
      e.preventDefault();
      leaveRun();
      return;
    }
    // Never hijack typing — the input handles its own keys (Enter via the form).
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
    if (running && sub?.prompt.replayable && e.key.toLowerCase() === 'r') {
      e.preventDefault();
      void playPrompt();
    }
  }

  onMount(() => {
    if (kind === 'words') {
      store = new Store();
      const params = new URLSearchParams(location.search);
      fromLesson = params.get('from');
      // Legacy ?mode deep-links map onto the two session modes.
      const urlMode = params.get('mode');
      if (urlMode === 'listen' || urlMode === 'da-dictation') wordMode = 'listen';
      else if (urlMode) wordMode = 'translate';
      const urlTag = params.get('tag');
      if (urlTag) {
        const lesson = lessons.find((l) => l.tag === urlTag);
        if (lesson) {
          sourceId = 'sets';
          selectedSets = [lesson.id];
        } else rawTag = urlTag;
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
  <!-- Deduplicated context (user decision: compact + context): only what the
       prompt/hint did NOT already show. exampleSv never repeats here (sv→da
       shows it as the hint; elsewhere it adds little); sentence items ARE the
       example, so only the falsk vän-note survives for them. -->
  {#if item.card}
    {#if item.sub === 'da-dictation'}<p class="sv">{item.card.swedish}</p>{/if}
    {#if item.sub === 'da-sv' && item.card.swedish !== item.answer}
      <p class="sv">{item.card.swedish}</p>
    {/if}
    {#if (item.sub === 'sv-da' || item.sub === 'da-dictation' || item.sub === 'da-sv') && item.card.exampleDa}
      <p class="ex" lang="da">
        {item.card.exampleDa}
        <SpeakButton text={item.card.exampleDa} audio={item.card.audioExample} label={F.hear} />
      </p>
    {/if}
    {#if item.card.note}<p class="callout">{item.card.note}</p>{/if}
  {/if}
{/snippet}

{#snippet answerLine(item: DrillItem)}
  <!-- The lang follows the ANSWER's language (the input's), never the
       prompt's: in da→sv the answer is the Swedish gloss. -->
  {#if item.audio?.kind === 'number'}
    <!-- Numbers: ONE merged line — digits · transcript · replay (no diff). -->
    <p class="da">
      {item.answer} · <span class="transcript" lang="da">{item.prompt}</span>
      <button type="button" class="replay" onclick={() => playItemAudio(item)}>{F.replay}</button>
    </p>
  {:else}
    <p class="da" lang={danishInput ? 'da' : undefined}>
      {item.answer}
      {#if item.audio?.kind === 'clip' && item.sub !== 'da-sv' && item.sub !== 'sent-da-sv' && item.sub !== 'sent-listen'}
        <SpeakButton text={item.audio.text} audio={item.audio.url} />
      {/if}
    </p>
  {/if}
{/snippet}

{#snippet continueRow()}
  <p class="continue">
    <button type="button" class="linklike" onclick={continueFromMiss}>{T.next}</button>
    <span class="hint-inline">{T.continue}</span>
  </p>
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
      {#if completedRun}<CelebrationFlag />{/if}
      <p class="stats-line">{T.doneLine(accuracy, totalTime, drill.bestCombo)}</p>
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
          <fieldset class="choices-row">
            <legend>{T.modeLegend}</legend>
            {#each ['translate', 'listen'] as const as m (m)}
              <label>
                <input type="radio" name="drill-mode" value={m} bind:group={wordMode} />
                {T.modes[m]}
              </label>
            {/each}
          </fieldset>
          <fieldset class="choices-row">
            <legend>{T.contentLegend}</legend>
            {#each ['words', 'sentences'] as const as c (c)}
              <label>
                <input type="radio" name="drill-content" value={c} bind:group={contentKind} />
                {T.content[c]}
              </label>
            {/each}
          </fieldset>
          {#if rawTag}
            <p class="tagline">
              {F.trainingTagPrefix} <strong>#{rawTag}</strong>
              <button type="button" onclick={() => (rawTag = null)}>{F.showAllDecks}</button>
            </p>
          {:else}
            <fieldset class="choices-row">
              <legend>{T.sourceLegend}</legend>
              <label>
                <input
                  type="radio"
                  name="drill-source"
                  value="due"
                  bind:group={sourceId}
                  disabled={contentKind === 'sentences'}
                />
                {T.sourceDue}
              </label>
              <label>
                <input type="radio" name="drill-source" value="free" bind:group={sourceId} />
                {T.sourceFree}
              </label>
              <label>
                <input type="radio" name="drill-source" value="sets" bind:group={sourceId} />
                {T.sourceSets}
              </label>
            </fieldset>
            {#if sourceId === 'sets'}
              <details class="sets" open={selectedSets.length === 0}>
                <summary>{T.setsLegend} — {T.setsSelected(selectedSets.length)}</summary>
                <div class="sets-list">
                  {#if lessons.length > 0}
                    <p class="sets-group">{T.setsLessons}</p>
                    {#each lessons as l (l.id)}
                      <label>
                        <input type="checkbox" value={l.id} bind:group={selectedSets} />
                        {l.title}
                      </label>
                    {/each}
                  {/if}
                  {#each setOptgroups as og (og)}
                    <p class="sets-group">{og}</p>
                    {#each setGroups.filter((g) => g.optgroup === og) as g (g.id)}
                      <label>
                        <input type="checkbox" value={g.id} bind:group={selectedSets} />
                        {g.label}
                      </label>
                    {/each}
                  {/each}
                </div>
              </details>
            {/if}
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
          {#if kind === 'words'}
            <select bind:value={size}>
              <option value="flow">{T.sizeFlow}</option>
              {#each SIZES.filter((n) => available !== null && n < available) as n (n)}
                <option value={n}>{n}</option>
              {/each}
              {#if available !== null && available > 0}
                <option value="all">{T.sizeAll(available)}</option>
              {/if}
            </select>
          {:else}
            <select bind:value={size}>
              {#each SIZES as n (n)}<option value={n}>{n}</option>{/each}
            </select>
          {/if}
        </label>
        <button
          type="button"
          class="cta"
          bind:this={startBtn}
          disabled={kind === 'words' && available === 0}
          onclick={() => void start()}
        >{T.start}</button>
        {#if loadingDeck}<p class="hint" role="status">{F.loadingDeck}</p>{/if}
        {#if emptyReason}<p class="hint" role="status">{emptyReason}</p>{/if}
        {#if emptyMsg && !emptyReason}
          <p class="hint" role="status" tabindex="-1" bind:this={emptyMsgEl}>{emptyMsg}</p>
        {/if}
      {/if}
    </section>
  {/if}

  {#if running && drill && current && sub}
    <section
      class="run"
      role="group"
      aria-label={kind === 'numbers' ? T.numbers.title : T.title}
      tabindex="-1"
      onkeydown={onContainerKey}
    >
      <div class="runbar">
        <button type="button" class="linklike leave" onclick={leaveRun}>
          {isFlow ? T.finishFlow : T.back}
        </button>
        {#if drill.combo >= 2}<span class="combo">{T.inARow(drill.combo)}</span>{/if}
      </div>
      {#if !isFlow}
        <div
          class="progress-track"
          class:pulse={drill.phase === 'feedback-correct' && !nearShown}
          aria-hidden="true"
        >
          <div
            class="progress-fill"
            style={`width: ${Math.round((drill.answered / Math.max(1, drill.answered + (drill.queue.length - drill.idx))) * 100)}%`}
          ></div>
        </div>
      {/if}
      <p class="vh" aria-live="polite">
        {isFlow ? T.progressFlow(drill.answered) : T.progress(drill.idx + 1, drill.queue.length)}
      </p>

      <!-- The prompt -->
      {#if sub.prompt.kind === 'audio'}
        <p class="prompt-listen">
          {kind === 'numbers'
            ? T.numbers.listenPrompt
            : current.sub === 'sent-listen'
              ? T.listenSentencePrompt
              : F.listenPrompt}
        </p>
        {#if promptAudioState === 'blocked'}
          <!-- Autoplay denied (no user gesture yet): an explicit play button. -->
          <button type="button" class="replay" onclick={() => void playPrompt()}>▶ {F.play}</button>
        {:else if promptAudioState === 'none'}
          <p class="hint" role="status">{F.noPromptAudio}</p>
        {:else if promptAudioState === 'missing'}
          <p class="hint" role="status">{T.numbers.missingAudio}</p>
        {:else}
          <!-- Plain replay, answer-safe label: never the Danish text or digits.
               No "Tangent R" tooltip: focus lives in the answer input, where R
               just types an r — the button IS the keyboard path here. -->
          <button
            type="button"
            class="replay"
            onclick={() => void playPrompt()}
            aria-label={F.replay}
          >{F.replay}</button>
          {#if promptAudioState === 'tts'}<span class="tts-hint" title={F.ttsHintTitle}>{F.ttsHint}</span>{/if}
        {/if}
        {#if kind === 'numbers'}<p class="hint">{T.numbers.digitsHint}</p>{/if}
      {:else}
        <p
          class="prompt"
          class:prompt-long={current.prompt.length > 40}
          lang={sub.prompt.lang === 'da' ? 'da' : undefined}
        >
          {current.prompt}
          {#if sub.prompt.replayable && current.audio?.kind === 'clip'}
            <SpeakButton text={current.audio.text} audio={current.audio.url} label={F.hear} />
          {/if}
        </p>
        {#if current.sub === 'sv-da' && current.card?.exampleSv}
          <p class="hint">{current.card.exampleSv}</p>
        {/if}
      {/if}

      <!-- Verdict + plain-text summary for AT (the colored diff is aria-hidden). -->
      <div class="feedback" aria-live="polite">
        {#if drill.phase === 'feedback-correct' && !nearShown}
          <p class="verdict ok">{F.correct}</p>
        {:else if nearShown}
          <p class="verdict ok">{T.nearMiss}</p>
          <p class="vh">{T.answerLabel} {current.answer} · {T.youWrote} {lastTyped}</p>
        {:else if isMiss}
          <p class="verdict no">{F.incorrect}</p>
          <p class="vh">
            {T.answerLabel} {current.answer}{#if lastTyped}&nbsp;· {T.youWrote} {lastTyped}{/if}
          </p>
        {:else if drill.revealed}
          <!-- "Visa svaret" must be announced too — the visual answerLine below
               sits outside this live region, so SR users would hear nothing. -->
          <p class="summary">
            {T.answerLabel} <strong lang={danishInput ? 'da' : undefined}>{current.answer}</strong>
          </p>
        {/if}
      </div>

      {#if isMiss || nearShown}
        {#if current.sub === 'number'}
          {@render answerLine(current)}
        {:else}
          <p class="diff" lang={danishInput ? 'da' : undefined} aria-hidden="true">
            {#each showDiff as d, i (i)}<span class={`d-${d.kind}`}>{d.ch}</span>{/each}
            {#if current.audio?.kind === 'clip' && current.sub !== 'da-sv' && current.sub !== 'sent-da-sv' && current.sub !== 'sent-listen'}
              <SpeakButton text={current.audio.text} audio={current.audio.url} />
            {/if}
          </p>
          {#if current.sub === 'sent-listen'}
            <!-- The heard Danish sentence, revealed with its clip. -->
            <p class="ex" lang="da">
              {current.prompt}
              {#if current.audio?.kind === 'clip'}
                <SpeakButton text={current.audio.text} audio={current.audio.url} label={F.hear} />
              {/if}
            </p>
          {/if}
          {#if lastTyped}
            <p class="attempt" aria-hidden="true">{T.youWrote} {lastTyped}</p>
          {/if}
        {/if}
        {#if isMiss}
          {@render glossary(current)}
          {#if drill.queue.slice(drill.idx + 1).some((q) => q.id === current.id)}
            <p class="hint">{T.requeued}</p>
          {/if}
        {/if}
        {@render continueRow()}
      {:else if drill.phase === 'answering' && drill.revealed}
        <!-- "Visa svaret": the answer + glossary are on screen; the coming
             submit scores as a hint-miss (outcomeOf handles it). -->
        {@render answerLine(current)}
        {@render glossary(current)}
      {/if}

      <!-- novalidate: the numeric pattern would otherwise block submission of
           "1 994" (Swedish thousands space) with a native, non-Swedish bubble
           before normalizeDigits() ever ran. The pattern attr stays for the
           legacy-iOS numeric keypad. -->
      <form novalidate onsubmit={(e) => { e.preventDefault(); onSubmit(); }}>
        <label class="vh" for="drill-answer">{sub.input.label}</label>
        <input
          id="drill-answer"
          type="text"
          value={typed}
          oninput={onInput}
          bind:this={input}
          lang={danishInput ? 'da' : undefined}
          inputmode={sub.input.inputmode === 'numeric' ? 'numeric' : undefined}
          pattern={sub.input.inputmode === 'numeric' ? '[0-9]*' : undefined}
          autocomplete="off"
          autocapitalize="off"
          autocorrect="off"
          spellcheck={false}
          placeholder={sub.input.placeholder}
        />
        <button type="submit">{T.submit}</button>
        {#if drill.phase === 'answering' && !drill.revealed}
          <button type="button" class="linklike hint-btn" onclick={doReveal}>{T.hint}</button>
        {/if}
      </form>
      {#if sub.input.charHelper}
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
  /* Light token-only pass — a design reskin is coming; keep values from
     global.css tokens and structure over polish. */
  .from-lesson { font-size: var(--step--1); margin: 0 0 var(--sp-3); }
  .card {
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--surface);
    padding: var(--sp-4) var(--sp-6);
  }

  /* Setup: a calm stacked panel. */
  .setup { display: flex; flex-direction: column; align-items: flex-start; gap: var(--sp-4); }
  .choices-row { border: none; padding: 0; margin: 0; display: flex; gap: var(--sp-4); flex-wrap: wrap; }
  .choices-row legend { font-size: var(--step--1); color: var(--muted); padding: 0; margin-bottom: var(--sp-1); }
  .choices-row label { display: inline-flex; align-items: center; gap: 0.3em; font-size: var(--step-0); min-height: var(--min-tap); }
  .sets { width: 100%; font-size: var(--step--1); }
  .sets summary { cursor: pointer; color: var(--muted); min-height: var(--min-tap); display: flex; align-items: center; }
  .sets-list { display: flex; flex-direction: column; gap: var(--sp-1); max-height: 18rem; overflow-y: auto; padding: var(--sp-2) 0; }
  .sets-list label { display: inline-flex; align-items: center; gap: 0.4em; }
  .sets-group { margin: var(--sp-2) 0 0; color: var(--muted); font-weight: 600; }
  .pick { display: inline-flex; align-items: center; gap: var(--sp-2); font-size: var(--step--1); flex-wrap: wrap; max-width: 100%; }
  select { font: inherit; padding: var(--sp-1) var(--sp-2); border-radius: var(--radius); border: 1px solid var(--border); background: var(--surface); color: var(--text); min-height: var(--min-tap); max-width: 100%; }
  .cta { border: none; cursor: pointer; font-size: var(--step-0); }
  .cta:disabled { cursor: not-allowed; opacity: 0.6; }
  .tagline { margin: 0; font-size: var(--step--1); }

  /* Run = focus mode: open air (no card surface), one centered column. */
  .run { max-width: 30rem; margin-inline: auto; padding: var(--sp-4) 0 var(--sp-6); min-height: 16rem; }
  .run:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; border-radius: var(--radius); }
  .runbar { display: flex; align-items: baseline; justify-content: space-between; gap: var(--sp-3); margin-bottom: var(--sp-2); }
  .linklike { background: none; border: none; padding: 0; color: var(--muted); font: inherit; font-size: var(--step--1); cursor: pointer; text-decoration: underline; text-underline-offset: 3px; min-height: var(--min-tap); }
  .linklike:hover, .linklike:focus-visible { color: var(--accent); }
  .combo { color: var(--muted); font-size: var(--step--1); }

  /* Hairline progress (FlashcardReviewer's pattern); the correct-pulse lives
     here instead of a full-card flash. */
  .progress-track {
    height: 2px;
    border-radius: var(--radius-pill);
    background: var(--subtle-border);
    margin: 0 0 var(--sp-6);
    overflow: hidden;
  }
  .progress-fill { height: 100%; border-radius: var(--radius-pill); background: var(--accent); }

  .prompt { font-size: var(--step-3); font-weight: 600; margin: 0 0 var(--sp-2); display: flex; align-items: baseline; gap: var(--sp-3); flex-wrap: wrap; }
  .prompt-long { font-size: var(--step-1); }
  .prompt-listen { font-size: var(--step-1); margin: 0 0 var(--sp-2); }
  .hint { color: var(--muted); font-size: var(--step--1); margin: var(--sp-1) 0; }
  form { display: flex; gap: var(--sp-2); flex-wrap: wrap; margin-top: var(--sp-4); }
  form input { flex: 1 1 12rem; font-size: var(--step-1); }
  form button { min-height: var(--min-tap); }
  .hint-btn { font-size: var(--step--1); }
  .charbar { display: flex; align-items: center; gap: var(--sp-2); flex-wrap: wrap; margin: var(--sp-2) 0 0; color: var(--muted); font-size: var(--step--1); }
  .char { min-width: 2.2em; min-height: 2.2em; font-size: var(--step-0); }
  .verdict { font-weight: 700; margin: var(--sp-2) 0; }
  .verdict.ok { color: var(--correct); }
  .verdict.no { color: var(--accent); }
  .summary { margin: 0 0 var(--sp-2); }
  .attempt { color: var(--muted); font-size: var(--step--1); margin: 0 0 var(--sp-2); }
  .continue { margin: var(--sp-3) 0 0; display: flex; align-items: baseline; gap: var(--sp-3); }
  .hint-inline { color: var(--muted); font-size: var(--step--1); }
  .da { font-size: var(--step-2); font-weight: 700; margin: 0 0 var(--sp-1); display: flex; align-items: baseline; gap: var(--sp-3); flex-wrap: wrap; }
  .transcript { font-weight: 400; }
  .sv { margin: 0 0 var(--sp-1); }
  .ex { color: var(--muted); margin: 0 0 var(--sp-2); }
  .warning { color: var(--accent); margin-top: var(--sp-4); }
  .replay { min-height: var(--min-tap); }
  .tts-hint { color: var(--muted); font-size: var(--step--1); font-style: italic; margin-left: 0.35em; cursor: help; }

  /* Per-letter diff (aria-hidden; the .vh summary is the AT version). */
  .diff { font-size: var(--step-2); letter-spacing: 0.06em; margin: 0 0 var(--sp-2); }
  .d-match { color: var(--correct); }
  .d-wrong { color: var(--accent); text-decoration: underline; }
  .d-missing { color: var(--accent); opacity: 0.6; text-decoration: underline dotted; }
  .d-extra { color: var(--accent); text-decoration: line-through; }

  /* Done */
  .done h2 { margin-top: 0; }
  .stats-line { color: var(--muted); font-size: var(--step-1); margin: var(--sp-4) 0; }
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
    .progress-track.pulse .progress-fill { animation: fillpulse 650ms ease-out; }
    @keyframes fillpulse {
      from { background: var(--correct); box-shadow: 0 0 6px var(--correct); }
      to { background: var(--accent); box-shadow: none; }
    }
    .feedback .verdict { animation: fade 120ms ease-out; }
    @keyframes fade { from { opacity: 0; } to { opacity: 1; } }
  }
</style>

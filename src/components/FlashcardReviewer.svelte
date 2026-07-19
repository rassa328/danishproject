<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { Store, DIRECTIONS, type Direction } from '../lib/storage.ts';
  import { clampForCorrectness, Rating, type ReviewGrade } from '../lib/srs.ts';
  import { speak } from '../lib/speech.ts';
  import { withBase } from '../lib/url.ts';
  import SpeakButton from './SpeakButton.svelte';
  import SettingsPanel from './SettingsPanel.svelte';
  import FlashcardSettings from './FlashcardSettings.svelte';
  import FlashcardEmptyState from './FlashcardEmptyState.svelte';
  import CelebrationFlag from './CelebrationFlag.svelte';
  import { clozeSentence, type Card } from '../lib/vocab.ts';
  import { DUE_ALL_GROUP_ID, type GroupMatch, type StudyGroup } from '../lib/deck-groups.ts';
  import { fetchPraksis, praksisCache } from '../lib/praksis-client.ts';
  import {
    buildQueue,
    buildChoices,
    matchTyped,
    matchCloze,
    reinsertAgain,
    eligibleForDirection,
    dueByDirection,
    type FilteredReason,
  } from '../lib/session.ts';
  import { UI } from '../lib/strings.ts';

  const T = UI.flashcards;
  // Touch devices get captions without keyboard references (tangenterna 1–4,
  // enter). SSR-safe: the captions only render post-interaction, after
  // hydration, so the guard never causes a hydration mismatch.
  const coarsePointer =
    typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches;
  // Inställningar + Säkerhetskopiera are temporarily hidden from the UI (user
  // request). `as boolean` keeps the block type-checked (no unreachable-code
  // error) and its handlers/import referenced; flip to true to restore.
  const SHOW_SETTINGS = false as boolean;
  // Mode labels for the done screen's "N kvar i {läge}" links (same mapping as
  // SettingsPanel's default-mode picker).
  const MODE_LABEL: Record<Direction, string> = {
    produce: T.write,
    recognize: T.recognize,
    listen: T.listen,
    'listen-sentence': T.listenSentence,
    speak: T.speak,
    cloze: T.cloze,
  };

  // `cards` is ONLY the curated starter deck (small, inlined as island props so
  // starter sessions start instantly). The 5000-word praksis deck is fetched
  // lazily as JSON the first time a session needs it (see lib/praksis-client);
  // `knownCards` below holds the merged union once that happens. `groups` are
  // lightweight picker descriptors (they carry counts, not cards) so the picker
  // renders immediately either way. `totalCards` = starter + praksis count, for
  // the "N av M ord" line — a count, so it never needs the fetch.
  let {
    cards,
    groups,
    totalCards,
  }: { cards: Card[]; groups: StudyGroup[]; totalCards: number } = $props();

  let store: Store;
  let ready = $state(false);
  let tag = $state<string | null>(null);
  let fromLesson = $state<string | null>(null);
  let selectedGroupId = $state(groups[0]?.id ?? '');
  let direction = $state<Direction>('produce');
  // Previous values so a cancelled "restart?" confirm can revert the control.
  let prevGroup = selectedGroupId;
  let prevDirection: Direction = direction;
  let grading = false; // re-entrancy guard for the grade transition window
  let queue = $state<Card[]>([]);
  let idx = $state(0);
  let phase = $state<'prompt' | 'revealed' | 'done'>('prompt');
  let typed = $state('');
  let wasCorrect = $state(false);
  let reviewed = $state(0);
  let warning = $state('');
  // Waveform sweep counter for the listen-mode replay button.
  let promptPulse = $state(0);
  // Sweep counter for the 0.75× slow-replay glyphs (prompt slow + speak-mode
  // word slow — never visible at once, so one counter serves both; reset per
  // card so a fresh mount never replays a stale sweep).
  let slowPulse = $state(0);
  // The site's ONE animated moment: true only when 'done' was EARNED by grading
  // the last card (grade() sets it; start() clears it). A boolean, not {#key} —
  // the done screen remounts on settings-save/repeat-round and a key would
  // re-fire the flag unearned.
  let celebrate = $state(false);
  let container = $state<HTMLElement>();
  let input = $state<HTMLInputElement>();
  // The revealed answer's audio glyphs — bound so reveal auto-speech can pulse
  // them in sync with the sound it plays (they don't self-trigger it).
  let wordSpeak = $state<SpeakButton>();
  let exampleSpeak = $state<SpeakButton>();
  // Deck popover open/closed (replaces the old native <select> dropdown). The
  // pill's hover/open visual is handled in CSS; only "open" needs to be state.
  let pickerOpen = $state(false);
  // Cloze mode: the Swedish sentence is a hidden hint that fades up on click.
  let hintOpen = $state(false);

  // Listen-mode voice graph (template §speaker): pure-gray span bars. The word
  // graph is 7 bars; the sentence graph is longer (per design override).
  const VOICE_BARS = [10, 22, 34, 26, 34, 18, 10];
  const VOICE_BARS_LONG = [8, 18, 30, 22, 34, 26, 32, 16, 28, 20, 34, 14, 24];
  // 0.75× slow-replay glyph: the word graph at inline scale, next to the
  // mono speed label; its sweep runs at a lazier tempo (see .slow-bar).
  const SLOW_BARS = VOICE_BARS.map((h) => Math.round(h * 0.35));
  const now = () => new Date();
  const current = $derived(queue[idx]);
  // Best-effort answer-example glyph: the bar count tracks THIS example's
  // length (~1 bar per 3 chars, clamped), heights cycle the sentence-graph
  // table at inline scale. Longer mening, longer graph — deterministic, no
  // per-clip envelope extraction.
  const exBars = $derived.by(() => {
    const n = Math.max(7, Math.min(24, Math.round((current?.exampleDa?.length ?? 0) / 3)));
    return Array.from({ length: n }, (_, i) => Math.round((VOICE_BARS_LONG[i % VOICE_BARS_LONG.length] ?? 24) * 0.35));
  });
  const remaining = $derived(Math.max(0, queue.length - idx));
  // Self-graded modes have no typed answer (speak: rate your pronunciation;
  // listen-sentence: rate your comprehension) — skip the verdict, never floor.
  const selfGraded = $derived(direction === 'speak' || direction === 'listen-sentence');
  // The grade Enter selects in the revealed phase: Medel (3) when the answer was
  // correct or self-graded, Igen (1) when it was wrong (2–4 are disabled then).
  // Single source of truth for BOTH the Enter handler and the ↵ button indicator.
  const defaultGrade = $derived((selfGraded || wasCorrect ? 3 : 1) as ReviewGrade);
  // Optgroup headers for the picker, in first-seen order. '' marks top-level
  // entries (the due-all group), rendered before the optgroups.
  const optgroups = $derived([...new Set(groups.map((g) => g.optgroup).filter(Boolean))]);
  // The fill-in-the-blank for 'cloze': { text, answer } or null.
  const clozeText = $derived(direction === 'cloze' && current ? clozeSentence(current) : null);
  // Is the due-only cross-deck group selected? (Drives its plain empty state.)
  const isDueAll = $derived(groups.find((g) => g.id === selectedGroupId)?.match.kind === 'all');
  // The listen-mode voice graph: longer bars for the sentence exercise.
  const voiceBars = $derived(direction === 'listen-sentence' ? VOICE_BARS_LONG : VOICE_BARS);
  // Reset the cloze hint whenever the shown card changes.
  $effect(() => {
    idx;
    hintOpen = false;
  });

  // Session state set by start(), so we don't re-filter the 5000+ card union
  // on every render/card: the raw active pool (distractor source), its size (for
  // the empty-state message), and whether cloze was picked but has no eligible
  // cards. speakSilent flags a 'speak' reveal that produced no audio.
  let sessionPool = $state<Card[]>([]);
  let poolSize = $state(0);
  // Free practice is a no-stakes roam: grades are never written back, so the
  // SRS schedule, streak and daily new-card budget stay untouched (the "öva
  // fritt — påverkar inte schemat" promise). Set per session by start(free).
  let freeSession = $state(false);
  let filteredReason = $state<FilteredReason>('none');
  let speakSilent = $state(false);
  // Everything the reviewer can study right now: the starter props, plus the
  // praksis deck once its lazy JSON fetch has resolved (merged in start()).
  let knownCards = $state<Card[]>(cards);
  // True while start() awaits the praksis fetch (renders a small loading line).
  let loadingDeck = $state(false);
  // The fetch failed: sessions degrade to starter-only with a visible notice.
  let praksisNotice = $state(false);
  // Outcome of the PROMPT audio in listen modes: 'none' shows a Swedish notice
  // (+ skip), 'blocked' swaps in an explicit play button (autoplay denied until
  // a user gesture), 'tts' shows the talsyntes marker by the replay control.
  let promptAudioState = $state<'ok' | 'tts' | 'none' | 'blocked'>('ok');
  // Times each card re-entered THIS session after an Again grade (caps the
  // reinsertAgain loop). Session-only — never persisted, not rendered.
  let againReentries = new Map<string, number>();

  // Mode gating: eligible-card counts for the filtered directions, recomputed
  // when the pool changes (group/tag change) — cheap pure session.ts calls.
  // A 0 disables the radio so deck×mode dead ends are visible BEFORE selection.
  const clozeCount = $derived(eligibleForDirection(sessionPool, 'cloze').length);
  const listenSentenceCount = $derived(
    eligibleForDirection(sessionPool, 'listen-sentence').length,
  );
  // Done screen: what's still due in this pool, per direction (one-click switch).
  const doneDue = $derived.by(() => {
    if (!ready || phase !== 'done') return [];
    return dueByDirection({ pool: sessionPool, directions: DIRECTIONS, srs: store, now: now() });
  });

  // "Deck complete" empty state (selected mode has no due cards, nothing was
  // reviewed this round, and it's not a tag/mode-availability dead end). Shows
  // the færdig empty-state card instead of a plain message.
  const showEmptyCard = $derived(
    ready &&
      phase === 'done' &&
      reviewed === 0 &&
      !(tag && poolSize === 0) &&
      filteredReason === 'none',
  );
  // {nextDue} source: variant A (other modes still due) reports when the CLEARED
  // current mode returns; variant B (nothing due anywhere) the soonest globally.
  const emptyNextDueDate = $derived.by(() => {
    if (!showEmptyCard) return null;
    return doneDue.length > 0 ? soonestDueForDirection(direction) : store.nextDueDate(now());
  });

  /** Soonest strictly-future due date among this pool's cards in one direction,
   *  or null if none are scheduled ahead. */
  function soonestDueForDirection(d: Direction): Date | null {
    const t = now().getTime();
    let best: number | null = null;
    for (const c of eligibleForDirection(sessionPool, d)) {
      const r = store.getRecord(c.id, d);
      if (!r || r.suspended) continue;
      const due = new Date(r.due).getTime();
      if (due > t && (best === null || due < best)) best = due;
    }
    return best === null ? null : new Date(best);
  }

  /** Restart the session, but if the learner is mid-round, confirm first and
   *  revert the just-changed control on cancel. */
  function restartGuarded(revert: () => void) {
    if (reviewed > 0 && phase !== 'done' && !confirm(T.confirmRestart)) {
      revert();
      return;
    }
    prevGroup = selectedGroupId;
    prevDirection = direction;
    // Remember the picked deck so the next visit resumes it (not always Vardag).
    store.setSettings({ selectedGroupId });
    start();
  }

  // ---- Deck pill + popover (presentation only; selection still flows through
  // restartGuarded exactly like the old <select onchange>) ----
  // Reformat a group label ("Falska vänner (29)") into the pill/popover display:
  // uppercase name + a "29 KORT" count. Labels without a trailing "(n)" (e.g.
  // "Att repetera (alla)") just uppercase, with no count column.
  function deckDisplay(label: string): { name: string; count: string } {
    const m = label.match(/^(.*?)\s*\((\d+)\)\s*$/);
    const name = m?.[1];
    const num = m?.[2];
    if (name && num) return { name: name.toUpperCase(), count: `${num} ${T.kortUnit}` };
    return { name: label.toUpperCase(), count: '' };
  }
  const selectedGroup = $derived(groups.find((g) => g.id === selectedGroupId));
  const pillDisplay = $derived(deckDisplay(selectedGroup?.label ?? ''));

  function togglePicker() {
    pickerOpen = !pickerOpen;
  }

  /** Pick a deck from the popover. Mirrors the old `<select>`: set the new id,
   *  then run the same restart guard that reverts to `prevGroup` on cancel. */
  function pickDeck(id: string) {
    pickerOpen = false;
    if (id === selectedGroupId) return;
    selectedGroupId = id;
    restartGuarded(() => (selectedGroupId = prevGroup));
  }

  // Multiple-choice options for 'recognize' mode (see lib/session.ts for the
  // distractor policy). Rebuilt on each new card.
  let choices = $state<string[]>([]);
  function refreshChoices() {
    choices =
      direction === 'recognize' && current
        ? buildChoices({ card: current, pool: sessionPool, allCards: knownCards })
        : [];
  }

  function choose(option: string) {
    if (phase !== 'prompt' || !current) return;
    typed = option;
    wasCorrect = option === current.danish;
    phase = 'revealed';
    tick().then(() => {
      container?.focus();
      void autoSpeakReveal();
    });
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

  /** Play the prompt audio in listen modes and CAPTURE the outcome so silence
   *  is never mute-with-no-message: 'none'/'blocked'/'tts' drive visible UI
   *  (see promptAudioState); 'cancelled' (superseded by a newer play) is
   *  ignored. `rate` enables the slow replay (0.75×). */
  async function playPrompt(rate?: number) {
    if (!current) return;
    let text: string | undefined;
    let audio: string | undefined;
    if (direction === 'listen') {
      text = current.danish;
      audio = current.audio;
    } else if (direction === 'listen-sentence' && current.exampleDa) {
      // Play the example SENTENCE (text hidden) — connected-speech listening.
      text = current.exampleDa;
      audio = current.audioExample;
    }
    if (!text) return;
    const opts: { audioUrl?: string; rate?: number } = {};
    if (audio) opts.audioUrl = withBase(audio);
    if (rate !== undefined) opts.rate = rate;
    const outcome = await speak(text, opts);
    if (outcome === 'cancelled') return;
    promptAudioState = outcome === 'audio' ? 'ok' : outcome;
    // The control the learner pressed is the one that sweeps: slow replays
    // pulse the slow glyph, normal replays the main graph.
    if (outcome === 'audio' || outcome === 'tts') {
      if (rate !== undefined) slowPulse++;
      else promptPulse++;
    }
  }

  // Slow replay of the revealed word in 'speak' mode (compare against your own
  // pronunciation at 0.75×).
  async function playSlowWord() {
    if (!current) return;
    const opts: { audioUrl?: string; rate: number } = { rate: 0.75 };
    if (current.audio) opts.audioUrl = withBase(current.audio);
    const outcome = await speak(current.danish, opts);
    if (outcome === 'audio' || outcome === 'tts') slowPulse++;
  }

  /** Advance past an unplayable listen card WITHOUT grading it (no forced
   *  "Again" on a card the learner never got to hear). Deliberately does NOT
   *  set `celebrate`: a session that ends by skipping wasn't earned. */
  function skipCard() {
    if (phase !== 'prompt') return;
    idx++;
    typed = '';
    if (idx >= queue.length) phase = 'done';
    else afterPrompt();
  }

  /** Done-screen next step: jump straight into another direction's backlog. */
  function switchDirection(d: Direction) {
    direction = d;
    prevDirection = d;
    start();
  }

  // 'listen-sentence': audio already played on prompt; reveal just shows the text
  // for self-graded comprehension.
  function revealSelf() {
    if (phase !== 'prompt' || !current) return;
    phase = 'revealed';
    tick().then(() => container?.focus());
  }

  // 'speak': the learner says the word from the Swedish prompt, then reveals to
  // hear the native clip and self-compare. Play the clip on reveal.
  function revealSpeak() {
    if (phase !== 'prompt' || !current) return;
    phase = 'revealed';
    speakSilent = false;
    tick().then(async () => {
      container?.focus();
      if (!current) return;
      const outcome = await speak(
        current.danish,
        current.audio ? { audioUrl: withBase(current.audio) } : {},
      );
      speakSilent = outcome === 'none'; // no clip + no da-DK voice → tell the user
    });
  }

  /** Does a session over this picker state need the praksis deck?
   *  - praksis groups (all/POS/theme slices): always;
   *  - tag deep-links: yes — praksis rows carry tags too (e.g. falsk-ven);
   *  - the due-all group: for free practice (roams the whole union) or when
   *    some SRS record belongs to a non-starter card;
   *  - starter themes: never — they start instantly without the fetch. */
  function needsPraksis(m: GroupMatch | null, free: boolean): boolean {
    if (tag) return true;
    if (!m) return false;
    if (m.kind === 'praksisAll' || m.kind === 'praksisPos' || m.kind === 'praksisTheme')
      return true;
    if (m.kind === 'all') return free || hasNonStarterRecords();
    return false;
  }

  /** Store can't enumerate record ids, but startedCount() counts distinct ids —
   *  compare it against how many STARTER ids have a record: any surplus means
   *  praksis (or imported) records exist and due-all must include that deck. */
  function hasNonStarterRecords(): boolean {
    let starterStarted = 0;
    for (const c of cards) {
      if (DIRECTIONS.some((d) => store.getRecord(c.id, d) !== null)) starterStarted++;
    }
    return store.startedCount() > starterStarted;
  }

  // Guards overlapping start() calls: while one awaits the praksis fetch the
  // learner may pick another group — the newer call wins, the stale one bails.
  let startToken = 0;

  async function start(free = false) {
    // Any restart (repeat-due, free practice, settings-save) voids the earned
    // state — only grade() flipping to 'done' re-arms the celebration.
    celebrate = false;
    // Scheduling lives in lib/session.ts (pure + unit-tested); the component
    // just supplies the store, clock and current picker state. Store satisfies
    // SrsView structurally; Settings carries the newPerDay/reviewPerDay limits.
    const g = groups.find((x) => x.id === selectedGroupId);
    const match = g?.match ?? null;
    const token = ++startToken;
    if (!praksisCache() && needsPraksis(match, free)) {
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
    const built = buildQueue({
      cards: knownCards,
      tag,
      match,
      direction,
      free,
      srs: store,
      now: now(),
      limits: store.getSettings(),
    });
    sessionPool = built.pool; // cached for distractors (avoid re-filtering per card)
    poolSize = built.pool.length;
    freeSession = free; // gates grade() persistence for this session
    filteredReason = built.filteredReason;
    againReentries = new Map();
    queue = built.queue;
    idx = 0;
    reviewed = 0;
    typed = '';
    warning = '';
    phase = queue.length ? 'prompt' : 'done';
    if (phase === 'prompt') afterPrompt();
  }

  /** A settings change auto-saves immediately (the dashboard has no Save button).
   *  Re-apply it now only when idle at the done screen — mid-round it takes
   *  effect on the next round, exactly like the old panel's onSaved contract. */
  function onSettingsChange() {
    if (phase === 'done') start();
  }

  /** Auto-play the revealed word (and, if enabled, its example sentence) for the
   *  reading/writing modes when "Automatiskt uttal" is on. listen / listen-
   *  sentence / speak already voice the card in their own flow, so they never
   *  double-fire here. Clip-first via speak(); silent no-op if autoplay is
   *  blocked or there's no voice — the manual replay button stays available. */
  async function autoSpeakReveal() {
    // Snapshot the card: `current` is a $derived read live on every access, and a
    // fast grade between the two awaits below would otherwise play the NEXT card's
    // sentence audio during its prompt — leaking the answer. Bind once, and bail
    // if the card/phase moved on before the sentence plays.
    const card = current;
    if (!card) return;
    if (direction === 'listen' || direction === 'listen-sentence' || direction === 'speak') return;
    const st = store.getSettings();
    // Human recordings only (product invariant): auto-play a card ONLY when it has
    // a committed clip. A clip-less card stays silent here — the manual replay
    // button still lets the learner trigger the browser voice deliberately.
    if (!st.autoSpeech || !card.audio) return;
    if (st.speakSentence && card.exampleDa && card.audioExample) {
      await speak(card.danish, { audioUrl: withBase(card.audio), awaitEnd: true, onStart: () => wordSpeak?.flash() });
      if (phase !== 'revealed' || current !== card) return; // moved on — don't leak
      await speak(card.exampleDa, { audioUrl: withBase(card.audioExample), awaitEnd: true, onStart: () => exampleSpeak?.flash() });
    } else {
      await speak(card.danish, { audioUrl: withBase(card.audio), onStart: () => wordSpeak?.flash() });
    }
  }

  function afterPrompt() {
    speakSilent = false;
    promptAudioState = 'ok';
    slowPulse = 0;
    refreshChoices();
    tick().then(() => {
      // Non-typed modes have no input — focus the container so the keyboard
      // shortcuts (digits, Enter/Space, R) work without a pointer trip.
      if (input) input.focus();
      else container?.focus();
      void playPrompt();
    });
  }

  async function submit() {
    if (phase !== 'prompt' || !current) return;
    // Cloze requires the exact in-context form that was blanked (not just the
    // lemma); other typed modes accept any accepted form. Both tolerate edge
    // punctuation ("løbe." for "løbe") and Swedish-keyboard spellings of æ/ø
    // (ä→æ, ö→ø, ae→æ) — see session.ts.
    wasCorrect =
      direction === 'cloze' && clozeText
        ? matchCloze(typed, clozeText.answer)
        : matchTyped(typed, current);
    phase = 'revealed';
    await tick();
    container?.focus();
    void autoSpeakReveal();
  }

  function grade(g: ReviewGrade) {
    if (grading || phase !== 'revealed' || !current) return;
    grading = true;
    try {
      // Self-graded modes (speak) trust the learner's rating; typed modes floor a
      // wrong answer to Again.
      const eff = selfGraded ? g : clampForCorrectness(g, wasCorrect);
      // Free practice never persists: no reschedule, no streak bump, no new-card
      // spend. The card can still re-queue on Again below (session-only).
      if (!freeSession) {
        const { result } = store.grade(current.id, direction, eff, now());
        if (!result.ok) warning = T.saveError;
      }
      // A failed card re-enters this session a few positions ahead (capped per
      // card), so FSRS's minutes-scale relearning step gets a real same-session
      // retrieval attempt instead of waiting a day.
      if (eff === Rating.Again) {
        const n = againReentries.get(current.id) ?? 0;
        const requeued = reinsertAgain(queue, idx, n);
        if (requeued) {
          againReentries.set(current.id, n + 1);
          queue = requeued;
        }
      }
      reviewed++;
      idx++;
      typed = '';
      if (idx >= queue.length) {
        phase = 'done';
        celebrate = true; // earned: the session's last card was graded
      } else {
        phase = 'prompt';
        afterPrompt();
      }
    } finally {
      grading = false;
    }
  }

  function onContainerKey(e: KeyboardEvent) {
    if (loadingDeck) return; // no queue to act on while the deck fetch runs
    // Never hijack typing: the answer input handles its own keys (Enter submits
    // via the form; letters/digits are text).
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
    if (phase === 'revealed') {
      if (e.key >= '1' && e.key <= '4') {
        e.preventDefault();
        grade(Number(e.key) as ReviewGrade);
        return;
      }
      if (e.key === 'Enter') {
        // Enter accepts the contextual default (see `defaultGrade`): Igen (1) when
        // the answer was wrong (2–4 are disabled anyway), Medel (3) when correct or
        // self-graded. The ↵ glyph marks whichever button this is.
        e.preventDefault();
        grade(defaultGrade);
      }
      return;
    }
    if (phase !== 'prompt') return;
    // Prompt phase (desktop): digits pick a recognize choice, Enter/Space
    // reveals in the self-graded modes, R replays the prompt audio.
    if (direction === 'recognize' && e.key >= '1' && e.key <= '4') {
      const c = choices[Number(e.key) - 1];
      if (c !== undefined) {
        e.preventDefault();
        choose(c);
      }
      return;
    }
    if (e.key === 'Enter' || e.key === ' ') {
      if (direction === 'speak') {
        e.preventDefault();
        revealSpeak();
      } else if (direction === 'listen-sentence') {
        e.preventDefault();
        revealSelf();
      }
      return;
    }
    if ((direction === 'listen' || direction === 'listen-sentence') && e.key.toLowerCase() === 'r') {
      e.preventDefault();
      void playPrompt();
    }
  }

  function exportBackup() {
    const blob = new Blob([store.exportBackup()], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'dansk-for-svenskar-backup.json';
    a.click();
    URL.revokeObjectURL(url);
  }

  function importBackup(e: Event) {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    file.text().then((t) => {
      const r = store.importBackup(t);
      warning = r.ok ? T.backup.imported : T.backup.importError;
      start();
    });
  }

  onMount(() => {
    store = new Store();
    const params = new URLSearchParams(location.search);
    tag = params.get('tag');
    fromLesson = params.get('from');
    // Initial direction: a ?direction= deep-link (e.g. a lesson routing into
    // speak/listen) wins; else the learner's saved default; else produce.
    const urlDir = params.get('direction');
    const defDir = store.getSettings().directions?.[0];
    if (urlDir && (DIRECTIONS as string[]).includes(urlDir)) direction = urlDir as Direction;
    else if (defDir && (DIRECTIONS as string[]).includes(defDir)) direction = defDir;
    prevDirection = direction;
    // Initial group: a valid ?group= deep-link wins (?tag has priority anyway —
    // buildQueue ignores the group while a tag is set); else the saved pick; a
    // saved id that no longer exists falls back to the due-all group. With no
    // history at all: due-all when a backlog exists, else the first real deck
    // (a fresh browser still gets its immediate new-card session).
    const urlGroup = params.get('group');
    const savedGroup = store.getSettings().selectedGroupId;
    const validGroup = (id: string | null): id is string =>
      !!id && groups.some((g) => g.id === id);
    if (validGroup(urlGroup)) selectedGroupId = urlGroup;
    else if (validGroup(savedGroup)) selectedGroupId = savedGroup;
    else if (savedGroup) selectedGroupId = DUE_ALL_GROUP_ID;
    else if (store.dueCount() > 0) selectedGroupId = DUE_ALL_GROUP_ID;
    else selectedGroupId = groups.find((g) => g.match.kind !== 'all')?.id ?? groups[0]?.id ?? '';
    prevGroup = selectedGroupId;
    ready = true;
    start();

    // Deck popover dismissal: outside pointer-down or Escape closes it. Scoped
    // to document because the pill/popover live in the header, outside the
    // reviewer section's own keydown handler.
    const onDocPointer = (e: PointerEvent) => {
      if (!pickerOpen) return;
      const t = e.target as HTMLElement | null;
      if (!t?.closest('[data-deck-picker]')) pickerOpen = false;
    };
    const onDocKey = (e: KeyboardEvent) => {
      if (pickerOpen && e.key === 'Escape') pickerOpen = false;
    };
    document.addEventListener('pointerdown', onDocPointer);
    document.addEventListener('keydown', onDocKey);
    return () => {
      document.removeEventListener('pointerdown', onDocPointer);
      document.removeEventListener('keydown', onDocKey);
    };
  });
</script>

<!-- The 0.75× glyph: the word voice graph at inline scale. Shared by the
     listen-prompt slow replays and the speak-mode word slow replay. -->
{#snippet slowGraph()}
  <span class="slow-wave" class:animate={slowPulse > 0} aria-hidden="true">
    {#key slowPulse}
      {#each SLOW_BARS as h, j (j)}
        <span class="slow-bar" style={`height:${h}px;animation-delay:${j * 75}ms`}></span>
      {/each}
    {/key}
  </span>
{/snippet}

{#if !ready}
  <div class="head-row"><h1 class="page-title">{T.title}</h1></div>
  <p class="loading-line">{T.loading}</p>
{:else}
  {#if fromLesson}
    <p class="from-lesson"><a href={withBase(`lektioner/${fromLesson}`)}>{UI.lessons.backToLesson}</a></p>
  {/if}

  <!-- Header row: serif h1 + deck pill (or the tag bar when deep-linked) + the
       settings gear (opens the dashboard popover). -->
  <div class="head-row">
    <h1 class="page-title">{T.title}</h1>
    <div class="head-tools">
    {#if tag}
      <span class="tag-bar">
        <span class="tag-label">{T.trainingTagPrefix} <strong>#{tag}</strong></span>
        <button type="button" class="linklike" onclick={() => { tag = null; start(); }}>{T.showAllDecks}</button>
      </span>
    {:else}
      <!-- Deck picker: a mono pill that opens a popover. Selection still runs
           through restartGuarded (same confirm+revert+persist as the old
           <select onchange>); the popover mirrors the optgroup structure. -->
      <span class="deck-picker" data-deck-picker>
        <button
          type="button"
          class="deck-pill"
          class:open={pickerOpen}
          title={T.deckLabel}
          aria-haspopup="true"
          aria-expanded={pickerOpen}
          onclick={togglePicker}
        >
          {pillDisplay.name}{#if pillDisplay.count} <span class="pill-sep">·</span> {pillDisplay.count}{/if}
          <span class="pill-caret" aria-hidden="true">▾</span>
        </button>
        {#if pickerOpen}
          <!-- A menu of buttons (not a listbox): buttons are natively focusable
               and operable by Tab+Enter+Esc; the current deck is marked
               aria-current. (A real listbox would require arrow-key/roving-tabindex
               nav + option roles on non-button elements — not what this is.) -->
          <div class="deck-pop" role="group" aria-label={T.deckLabel}>
            {#each groups.filter((g) => !g.optgroup) as g}
              {@const d = deckDisplay(g.label)}
              <button
                type="button"
                class="deck-row"
                class:selected={g.id === selectedGroupId}
                aria-current={g.id === selectedGroupId ? 'true' : undefined}
                onclick={() => pickDeck(g.id)}
              >
                <span class="deck-name">{d.name}</span>
                <span class="deck-meta"><span class="deck-count">{d.count}</span><span class="deck-check" aria-hidden="true">{g.id === selectedGroupId ? '✓' : ''}</span></span>
              </button>
            {/each}
            {#each optgroups as og}
              <div class="deck-section">{og}</div>
              {#each groups.filter((g) => g.optgroup === og) as g}
                {@const d = deckDisplay(g.label)}
                <button
                  type="button"
                  class="deck-row"
                  class:selected={g.id === selectedGroupId}
                  aria-current={g.id === selectedGroupId ? 'true' : undefined}
                  onclick={() => pickDeck(g.id)}
                >
                  <span class="deck-name">{d.name}</span>
                  <span class="deck-meta"><span class="deck-count">{d.count}</span><span class="deck-check" aria-hidden="true">{g.id === selectedGroupId ? '✓' : ''}</span></span>
                </button>
              {/each}
            {/each}
            <div class="deck-foot">{T.popoverFooter}</div>
          </div>
        {/if}
      </span>
    {/if}
      <FlashcardSettings {store} onChange={onSettingsChange} />
    </div>
  </div>

  <!-- Mode pills: the six Direction radios, native dot hidden, label styled as a
       pill. bind:group/onchange/disabled/title all preserved (§ contract). -->
  <fieldset class="modes">
    <legend class="vh">{T.directionLegend}</legend>
    <label class="mode"><input type="radio" name="dir" value="produce" bind:group={direction} onchange={() => restartGuarded(() => (direction = prevDirection))} />{T.write}</label>
    <label class="mode"><input type="radio" name="dir" value="recognize" bind:group={direction} onchange={() => restartGuarded(() => (direction = prevDirection))} />{T.recognize}</label>
    <label class="mode"><input type="radio" name="dir" value="listen" bind:group={direction} onchange={() => restartGuarded(() => (direction = prevDirection))} />{T.listen}</label>
    <!-- Cloze/listen-sentence are gated per deck: a pool with 0 eligible cards
         disables the radio (with the reason as a tooltip) instead of letting
         the learner discover an empty session after selecting. -->
    <label class="mode" title={listenSentenceCount === 0 ? T.listenSentenceUnavailable : undefined}><input type="radio" name="dir" value="listen-sentence" bind:group={direction} disabled={listenSentenceCount === 0} onchange={() => restartGuarded(() => (direction = prevDirection))} />{T.listenSentence}{#if listenSentenceCount === 0}&nbsp;(0){/if}</label>
    <label class="mode"><input type="radio" name="dir" value="speak" bind:group={direction} onchange={() => restartGuarded(() => (direction = prevDirection))} />{T.speak}</label>
    <label class="mode" title={clozeCount === 0 ? T.clozeUnavailable : undefined}><input type="radio" name="dir" value="cloze" bind:group={direction} disabled={clozeCount === 0} onchange={() => restartGuarded(() => (direction = prevDirection))} />{T.cloze}{#if clozeCount === 0}&nbsp;(0){/if}</label>
  </fieldset>

  <section
    class="reviewer"
    role="group"
    aria-label="Flashcards"
    tabindex="-1"
    bind:this={container}
    onkeydown={onContainerKey}
  >
    {#if praksisNotice}<p class="warning" role="alert">{T.praksisFailed}</p>{/if}
    {#if loadingDeck}
      <div class="card"><p class="progress" role="status">{T.loadingDeck}</p></div>
    {:else if showEmptyCard}
      <FlashcardEmptyState
        dueModes={doneDue}
        activeMode={direction}
        nextDueDate={emptyNextDueDate}
        streakDays={store.getStreak()}
        wordsLearning={store.startedCount()}
        onSwitchMode={switchDirection}
        onPracticeFree={() => start(true)}
      />
    {:else if phase === 'done'}
      <div class="card">
        <div class="done">
          {#if reviewed === 0 && tag && poolSize === 0}
            <h2 tabindex="-1">{T.doneEmpty}</h2>
            <p>{T.noTagMatch}</p>
            <div class="done-actions">
              <button type="button" class="text-btn" onclick={() => { tag = null; start(); }}>{T.showAllDecks}</button>
            </div>
          {:else if reviewed === 0 && filteredReason === 'cloze'}
            <h2 tabindex="-1">{T.doneEmpty}</h2>
            <p>{T.noClozeCards}</p>
          {:else if reviewed === 0 && filteredReason === 'listen'}
            <h2 tabindex="-1">{T.doneEmpty}</h2>
            <p>{T.noListenCards}</p>
          {:else}
            <h2 tabindex="-1">{reviewed > 0 ? T.doneTitle : isDueAll ? T.dueAllEmpty : T.doneEmpty}</h2>
            {#if celebrate}<CelebrationFlag />{/if}
            {#if reviewed > 0}<p>{T.reviewedCount(reviewed)}</p>{/if}
            <p class="started">{UI.progress.words(store.startedCount(), totalCards)}</p>
            {#if store.getStreak() > 0}<p class="started">{UI.progress.streak(store.getStreak())}</p>{/if}
            <!-- Contextual next steps: what's still due in this deck per mode
                 (one click switches), or a calm pointer to the lessons. -->
            {#if doneDue.length > 0}
              <ul class="next-due">
                {#each doneDue as d (d.direction)}
                  <li><button type="button" class="linklike" onclick={() => switchDirection(d.direction)}>{T.stillDue(d.count, MODE_LABEL[d.direction])}</button></li>
                {/each}
              </ul>
            {:else}
              <p class="started"><a href={withBase('lektioner')}>{T.toLessons}</a></p>
            {/if}
            <div class="done-actions">
              <button type="button" class="text-btn" onclick={() => start(false)}>{T.repeatDue}</button>
              <button type="button" class="text-btn" onclick={() => start(true)}>{T.practiceFree}</button>
            </div>
          {/if}
        </div>
      </div>
    {:else if current}
      <div class="card">
        <div class="card-top">
          <p class="progress" aria-live="polite">{T.progress(idx + 1, queue.length, remaining)}</p>
          <!-- reviewed/(reviewed+remaining), not idx/queue.length: reinsertAgain grows
               the queue mid-session and would make an index-based bar jump backwards. -->
          <div class="progress-track" aria-hidden="true">
            <div class="progress-fill" style={`width: ${Math.round((reviewed / Math.max(1, reviewed + remaining)) * 100)}%`}></div>
          </div>
        </div>

        <div class="drill">
          {#if direction === 'listen' || direction === 'listen-sentence'}
            {#snippet voiceGraph()}
              <span class="voice-wave" aria-hidden="true">
                {#key promptPulse}
                  {#each voiceBars as h, j (j)}
                    <span class="voice-bar" style={`height:${h}px;animation-delay:${j * 55}ms`}></span>
                  {/each}
                {/key}
              </span>
            {/snippet}
            <!-- Plain replay (not SpeakButton): its aria-label must NOT contain the
                 Danish text, or a screen reader would announce the answer before
                 the learner attempts the exercise. -->
            {#if promptAudioState === 'none'}
              <p class="hint" role="status">{T.noPromptAudio}</p>
              {#if phase === 'prompt'}
                <button type="button" class="text-btn" onclick={skipCard}>{T.skipCard}</button>
              {/if}
            {:else if promptAudioState === 'blocked'}
              <!-- Autoplay denied (no user gesture yet): an explicit play instead of
                   pretending the clip was heard. The click is the gesture. -->
              <button type="button" class="voice-btn" onclick={() => playPrompt()} aria-label={T.play}>
                {@render voiceGraph()}
              </button>
              <button type="button" class="slow" onclick={() => playPrompt(0.75)} title={T.slowReplay}>{@render slowGraph()}{T.slowSpeed}</button>
            {:else}
              <button type="button" class="voice-btn" onclick={() => playPrompt()} aria-label={T.replay} title={direction === 'listen-sentence' ? T.replayKeyTitle : undefined}>
                {@render voiceGraph()}
              </button>
              <button type="button" class="slow" onclick={() => playPrompt(0.75)} title={T.slowReplay}>{@render slowGraph()}{T.slowSpeed}</button>
              {#if promptAudioState === 'tts'}<span class="tts-hint" title={T.ttsHintTitle}>{T.ttsHint}</span>{/if}
            {/if}
          {:else if direction === 'cloze'}
            <p class="prompt-caption">{T.clozePrompt}</p>
            <p class="prompt prompt-cloze" lang="da">{clozeText?.text}</p>
            {#if hintOpen}
              <p class="prompt-ex hint-open">{current.swedish}{#if current.exampleSv} — {current.exampleSv}{/if}</p>
            {:else}
              <button type="button" class="hint-toggle" onclick={() => (hintOpen = true)}>{T.clozeHint}</button>
            {/if}
          {:else}
            <p class="prompt">{current.swedish}</p>
            {#if current.exampleSv}<p class="prompt-ex">{current.exampleSv}</p>{/if}
          {/if}

          {#if phase === 'prompt'}
            {#if direction === 'recognize'}
              <div class="choices" role="group" aria-label={T.choosePrompt}>
                {#each choices as c, i}
                  <button type="button" class="choice" lang="da" title={T.chooseKeyTitle(i + 1)} onclick={() => choose(c)}>{c}</button>
                {/each}
              </div>
            {:else if direction === 'speak'}
              <p class="prompt-caption instr">{T.speakPrompt}</p>
              <span class="hairline" aria-hidden="true"></span>
              <div class="reveal-row">
                <button type="button" class="text-btn reveal-btn" title={T.revealKeyTitle} onclick={revealSpeak}>{T.speakReveal} <span class="key" aria-hidden="true">enter</span></button>
              </div>
            {:else if direction === 'listen-sentence'}
              <span class="hairline" aria-hidden="true"></span>
              <div class="reveal-row">
                <button type="button" class="text-btn reveal-btn" title={T.revealKeyTitle} onclick={revealSelf}>{T.listenSentenceReveal} <span class="key" aria-hidden="true">enter</span></button>
              </div>
            {:else}
              <form class="answer-form" onsubmit={(e) => { e.preventDefault(); submit(); }}>
                <label class="vh" for="answer">{T.inputLabel}</label>
                <input
                  id="answer"
                  type="text"
                  bind:value={typed}
                  bind:this={input}
                  lang="da"
                  autocomplete="off"
                  autocapitalize="off"
                  autocorrect="off"
                  spellcheck={false}
                  placeholder={T.placeholder}
                />
                <p class="charbar">
                  {#each ['æ', 'ø', 'å'] as ch}
                    <button type="button" class="char" onclick={() => insertChar(ch)} aria-label={`Infoga ${ch}`}>{ch}</button>
                  {/each}
                </p>
                <button type="submit" class="text-btn reveal-btn">{T.reveal} <span class="key" aria-hidden="true">enter</span></button>
              </form>
            {/if}
          {:else}
            <div class="answer" class:correct={!selfGraded && wasCorrect} aria-live="polite">
              {#if !selfGraded}
                <!-- Wordless feedback: a green hairline on a correct answer; the
                     struck-through attempt on a wrong one; nothing on an empty
                     miss. The verdict word stays for screen readers only. -->
                <span class="vh">{wasCorrect ? T.correct : T.incorrect}</span>
                {#if wasCorrect}
                  <span class="ok-line" aria-hidden="true"></span>
                {:else if typed.trim()}
                  <p class="attempt" lang="da" aria-hidden="true">{typed}</p>
                {/if}
              {/if}
              <!-- listen-sentence is a SENTENCE-level exercise: the reveal shows only
                   the sentence (below), so the singular headword + its play button are
                   hidden here. Every other mode still leads with the word. -->
              {#if direction !== 'listen-sentence'}
                <p class="da" lang="da">{current.danish} <SpeakButton bind:this={wordSpeak} text={current.danish} audio={current.audio} showLabel={false} bars={[8, 16, 22, 13, 8]} />{#if direction === 'speak'}<button type="button" class="slow" onclick={playSlowWord} title={T.slowReplay}>{@render slowGraph()}{T.slowSpeed}</button>{/if}</p>
              {/if}
              {#if current.exampleDa}<p class="ex" lang="da">{current.exampleDa} <SpeakButton bind:this={exampleSpeak} text={current.exampleDa} audio={current.audioExample} label={T.hear} showLabel={false} bars={exBars} barWidth={2.5} barGap={2} /></p>{/if}
              {#if current.note}<p class="note"><span class="obs" aria-hidden="true">OBS</span>{current.note}</p>{/if}
              {#if selfGraded && speakSilent}<p class="hint">{T.noAudio}</p>{/if}
              <div class="grade-pills">
                <button type="button" class="grade again" class:is-default={defaultGrade === 1} onclick={() => grade(1 as ReviewGrade)}><span class="gd" aria-hidden="true">1</span>{T.grades.again}{#if defaultGrade === 1}<span class="default-grade-enter-hint" aria-hidden="true">↵</span>{/if}</button>
                <button type="button" class="grade" onclick={() => grade(2 as ReviewGrade)} disabled={!selfGraded && !wasCorrect}><span class="gd" aria-hidden="true">2</span>{T.grades.hard}</button>
                <button type="button" class="grade" class:is-default={defaultGrade === 3} onclick={() => grade(3 as ReviewGrade)} disabled={!selfGraded && !wasCorrect}><span class="gd" aria-hidden="true">3</span>{T.grades.good}{#if defaultGrade === 3}<span class="default-grade-enter-hint" aria-hidden="true">↵</span>{/if}</button>
                <button type="button" class="grade" onclick={() => grade(4 as ReviewGrade)} disabled={!selfGraded && !wasCorrect}><span class="gd" aria-hidden="true">4</span>{T.grades.easy}</button>
              </div>
            </div>
          {/if}
        </div>
      </div>
      <!-- Helper caption sits below the card (design §8.7), still keyed to the
           revealed state and carrying the same per-mode copy. -->
      {#if phase === 'revealed'}
        <p class="card-hint">{#if direction === 'listen-sentence'}{coarsePointer ? T.comprehendHintTouch : T.comprehendHint}{:else if selfGraded}{coarsePointer ? T.selfGradeHintTouch : T.selfGradeHint}{:else}{coarsePointer ? T.gradeKeysHintTouch : T.gradeKeysHint}{/if}</p>
      {/if}
    {/if}

    {#if warning}<p class="warning" role="alert">{warning}</p>{/if}
  </section>

  <!-- Inställningar (SettingsPanel) + Säkerhetskopiera temporarily hidden from
       the UI (user request). Kept behind {#if false} so the store wiring,
       import, and export/import handlers stay referenced and re-enabling is a
       one-line change. Settings still fall back to store.getSettings() defaults. -->
  {#if SHOW_SETTINGS}
    <div class="panel-wrap">
      <SettingsPanel {store} onSaved={() => { if (phase === 'done') start(); }} />
    </div>

    <details class="backup">
      <summary>{T.backup.summary}</summary>
      <p>{T.backup.note}</p>
      <button onclick={exportBackup}>{T.backup.export}</button>
      <label class="import">{T.backup.import}
        <input type="file" accept="application/json" aria-label={T.backup.import} onchange={importBackup} />
      </label>
    </details>
  {/if}
{/if}

<style>
  /* Every top-level island block spans the 640px content column. */
  .from-lesson,
  .head-row,
  .modes,
  .reviewer,
  .panel-wrap,
  .backup {
    width: 100%;
  }

  .from-lesson { font-size: 13px; margin: 0 0 16px; }
  .from-lesson a { color: var(--mut2); text-decoration: none; }
  .from-lesson a:hover { color: var(--red); }
  .loading-line { color: var(--mut2); margin-top: 24px; }

  /* ---- Header row: serif h1 + deck pill ---- */
  .head-row {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 16px;
    flex-wrap: wrap;
  }
  .page-title {
    margin: 0;
    font-family: var(--font-serif);
    font-weight: 500;
    font-size: 34px;
    line-height: 1.1;
    letter-spacing: -0.02em;
    color: var(--ink);
  }

  /* Right-side header cluster: deck pill / tag bar + the settings gear. The
     flex box takes its baseline from its first item (the pill/tag text), so the
     pill still baseline-aligns with the serif h1 exactly as before; the gear
     rides centered beside it. */
  .head-tools { display: inline-flex; align-items: center; gap: 10px; margin-left: auto; }

  .tag-bar { display: inline-flex; align-items: baseline; gap: 12px; font-size: 12.5px; color: var(--mut2); }
  .tag-bar strong { color: var(--ink); font-weight: 600; }

  /* Deck pill */
  .deck-picker { position: relative; display: inline-flex; }
  .deck-pill {
    display: inline-flex;
    align-items: baseline;
    gap: 8px;
    font-family: var(--font-mono);
    font-size: 11px;
    letter-spacing: 0.14em;
    color: var(--mut2);
    background: transparent;
    border: 1px solid var(--bd5);
    border-radius: 999px;
    padding: 6px 12px;
    cursor: pointer;
    white-space: nowrap;
    transition: color 120ms ease, background-color 120ms ease, border-color 120ms ease;
  }
  .deck-pill:hover,
  .deck-pill.open {
    color: var(--ink);
    background: var(--card);
    border-color: var(--mut4);
  }
  .pill-sep { color: inherit; }
  .pill-caret { font-size: 9px; color: inherit; }

  /* Deck popover */
  .deck-pop {
    position: absolute;
    z-index: 5;
    top: calc(100% + 8px);
    right: 0;
    display: flex;
    flex-direction: column;
    min-width: 240px;
    max-height: min(60vh, 420px);
    overflow-y: auto;
    background: var(--card);
    border: 1px solid var(--bd1);
    border-radius: 14px;
    padding: 8px;
    box-shadow: 0 1px 2px var(--sh1), 0 16px 40px var(--sh3);
  }
  .deck-section {
    font-family: var(--font-mono);
    font-size: 10px;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--mut3);
    padding: 10px 12px 4px;
  }
  .deck-row {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 16px;
    font: inherit;
    font-size: 13.5px;
    font-weight: 400;
    background: transparent;
    border: none;
    border-radius: 8px;
    padding: 9px 12px;
    cursor: pointer;
    text-align: left;
    transition: background-color 100ms ease;
  }
  .deck-name { color: var(--mut1); font-weight: 400; }
  .deck-row.selected .deck-name { color: var(--ink); font-weight: 650; }
  .deck-row:hover { background: var(--bd6); border: none; }
  .deck-row:hover .deck-name { color: var(--red); }
  .deck-meta { display: inline-flex; align-items: baseline; gap: 7px; }
  .deck-count { font-family: var(--font-mono); font-size: 10.5px; letter-spacing: 0.1em; color: var(--mut3); }
  .deck-check { font-family: var(--font-mono); font-size: 10.5px; color: var(--red); min-width: 11px; }
  .deck-foot {
    font-size: 11px;
    color: var(--mut3);
    padding: 8px 12px 6px;
    border-top: 1px solid var(--bd2);
    margin-top: 6px;
  }

  /* ---- Mode pills (radios styled as pills) ---- */
  .modes {
    border: none;
    padding: 0;
    margin: 22px 0 0;
    min-inline-size: 0;
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
  }
  .mode {
    position: relative;
    display: inline-flex;
    align-items: center;
    font-size: 13px;
    font-weight: 400;
    color: var(--mut2);
    background: transparent;
    border: 1px solid transparent;
    border-radius: 999px;
    padding: 7px 14px;
    cursor: pointer;
    white-space: nowrap;
  }
  .mode input {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    margin: 0;
    opacity: 0;
    cursor: pointer;
  }
  .mode:has(:checked) {
    font-weight: 500;
    color: var(--ink);
    background: var(--card);
    border-color: var(--bd4);
  }
  .mode:has(:disabled) { opacity: 0.45; cursor: not-allowed; }
  .mode:has(:disabled) input { cursor: not-allowed; }
  .mode:has(:focus-visible) { outline: 2px solid var(--red); outline-offset: 2px; }

  /* ---- Card ---- */
  .reviewer { margin-top: 26px; }
  /* The reviewer is a tabindex=-1 grouping element focused PROGRAMMATICALLY for
     1–4 grading; the visible cue is the grade pills + hint, not a ring. Suppress
     the global :focus-visible red outline so the whole card doesn't light up. */
  .reviewer:focus,
  .reviewer:focus-visible {
    outline: none;
  }
  .card {
    width: 100%;
    box-sizing: border-box;
    background: var(--card);
    border: 1px solid var(--bd1);
    border-radius: 20px;
    padding: 30px clamp(20px, 5vw, 36px);
    box-shadow: 0 1px 2px var(--sh1), 0 16px 40px var(--sh2);
  }
  .card-top { display: flex; flex-direction: column; }
  .progress { color: var(--mut3); font-size: 12.5px; margin: 0; }
  .progress-track {
    height: 2px;
    background: var(--bd2);
    border-radius: 1px;
    margin-top: 10px;
    overflow: hidden;
  }
  .progress-fill { height: 100%; background: var(--red); border-radius: 1px; }
  @media (prefers-reduced-motion: no-preference) {
    .progress-fill { transition: width 300ms ease; }
  }

  /* Centered drill/done block — stable card height across states. */
  .drill,
  .done {
    min-height: 300px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    text-align: center;
  }
  .drill { padding: 28px 0 8px; }
  .done { padding: 20px 0 8px; }

  /* ---- Prompt ---- */
  .prompt-caption { font-size: 13.5px; color: var(--mut3); margin: 0; }
  .prompt-caption.instr { margin-top: 10px; }
  .prompt {
    margin: 10px 0 0;
    font-size: 32px;
    font-weight: 300;
    color: var(--soft);
    letter-spacing: 0.01em;
    line-height: 1.35;
    max-width: 460px;
  }
  .prompt-cloze { font-size: 24px; }
  .prompt-ex { margin: 12px 0 0; font-size: 14px; color: var(--mut2); }
  /* Cloze: the Swedish sentence is a hidden hint that fades up on click. */
  .hint-toggle {
    /* Touch hit area ~40px; negative margins offset the extra padding so the
       text sits where the bare 4px-padded button did. */
    margin: 4px -8px -8px 0;
    background: none;
    border: none;
    padding: 12px 14px;
    font-size: 13px;
    font-style: italic;
    color: var(--mut4);
    cursor: pointer;
  }
  .hint-toggle:hover { color: var(--mut2); border: none; }
  @media (prefers-reduced-motion: no-preference) {
    .prompt-ex.hint-open { animation: hintFadeUp 320ms cubic-bezier(0.2, 0.8, 0.3, 1) both; }
  }
  @keyframes hintFadeUp {
    from { transform: translateY(6px); opacity: 0; }
    to { transform: translateY(0); opacity: 1; }
  }
  .hint { color: var(--mut2); font-size: 13px; margin: 10px 0 0; }

  /* Text-only buttons (reveal / skip / done actions). Overrides global button. */
  .text-btn {
    background: none;
    border: none;
    padding: 8px 20px;
    color: var(--mut1);
    font-size: 14px;
    cursor: pointer;
  }
  .text-btn:hover { color: var(--ink); border: none; }

  /* Voice-graph replay button (listen modes) — larger pure-gray span bars. */
  .voice-btn {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    height: 52px;
    margin-top: 14px;
    padding: 12px 10px;
    background: none;
    border: none;
    cursor: pointer;
  }
  .voice-wave { display: inline-flex; align-items: center; gap: 4px; }
  .voice-bar {
    flex: none;
    width: 4.5px;
    border-radius: 3px;
    background: var(--bars);
    transform-origin: center;
  }
  @media (prefers-reduced-motion: no-preference) {
    .voice-bar { animation: voicePulse 500ms ease-in-out both; }
  }
  @keyframes voicePulse {
    0% { transform: scaleY(1); }
    50% { transform: scaleY(1.35); }
    100% { transform: scaleY(1); }
  }
  /* 0.75× slow-replay: the mini word graph + a small mono label — same glyph
     family as the other audio controls. Its sweep runs at a lazier tempo than
     the full-speed graphs (750ms/75ms vs 500ms/55ms): the button itself
     sounds slow. */
  .slow {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    /* Touch hit area ~40px tall: the padding grows the box; the negative
       margins put the glyph back where the bare 2px-padded button sat.
       position:relative paints the padded box above in-flow siblings the
       negative margin pulls it under (else they steal the edge taps). */
    position: relative;
    margin: -9px -2px;
    background: none;
    border: none;
    padding: 11px 8px;
    font-family: var(--font-mono);
    font-size: 11px;
    letter-spacing: 0.08em;
    color: var(--mut4);
    cursor: pointer;
  }
  .slow:hover { color: var(--ink); border: none; }
  .slow-wave { display: inline-flex; align-items: center; gap: 2px; }
  .slow-bar {
    flex: none;
    width: 2.5px;
    border-radius: 2px;
    background: var(--bars);
    transform-origin: center;
  }
  .slow:hover .slow-bar { background: var(--ink); }
  @media (prefers-reduced-motion: no-preference) {
    .slow-wave.animate .slow-bar { animation: voicePulse 750ms ease-in-out both; }
  }
  .tts-hint { color: var(--mut3); font-size: 11px; font-style: italic; margin-top: 6px; cursor: help; }

  /* Reveal-button block (speak / listen-sentence). */
  .hairline { display: block; width: 168px; height: 1px; background: var(--bd3); margin-top: 30px; }
  .reveal-row { margin-top: 30px; }
  .reveal-btn { margin-top: 16px; }
  /* The "enter" key hint on reveal buttons — smaller, mono, a darker tone.
     Hidden on touch devices: there is no enter key to press (same for the
     grade pills' ↵ default-grade marker). */
  .key { font-family: var(--font-mono); font-size: 10px; color: var(--mut4); }
  @media (pointer: coarse) {
    .key,
    .default-grade-enter-hint { display: none; }
  }

  /* ---- Känn igen: stacked choice pills ---- */
  .choices {
    display: flex;
    flex-direction: column;
    gap: 10px;
    margin-top: 30px;
    width: min(320px, 100%);
  }
  .choice {
    font: inherit;
    font-size: 16px;
    font-weight: 400;
    color: var(--ink);
    background: none;
    border: 1px solid var(--bd4);
    border-radius: 999px;
    padding: 11px 20px;
    cursor: pointer;
    text-align: center;
  }
  .choice:hover { border-color: var(--mut2); }

  /* ---- Input block ---- */
  .answer-form { display: flex; flex-direction: column; align-items: center; width: 100%; }
  .answer-form input {
    width: min(360px, 100%);
    box-sizing: border-box;
    margin-top: 34px;
    padding: 6px 2px 12px;
    font: inherit;
    font-size: 22px;
    font-weight: 300;
    text-align: center;
    color: var(--ink);
    background: transparent;
    border: none;
    border-bottom: 1px solid var(--bd3);
    border-radius: 0;
    outline: none;
  }
  .answer-form input:focus { border-bottom-color: var(--mut2); outline: none; }
  .charbar {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 18px;
    flex-wrap: wrap;
    margin: 18px 0 0;
  }
  .char {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font: inherit;
    font-size: 15px;
    color: var(--mut2);
    background: none;
    border: none;
    padding: 4px 6px;
    /* Boxless buttons, so the 44px touch minimum is invisible chrome. */
    min-width: 44px;
    min-height: 44px;
    -webkit-tap-highlight-color: transparent;
    cursor: pointer;
  }
  .char:hover { color: var(--ink); border: none; }

  /* ---- Revealed answer ---- */
  .answer { display: flex; flex-direction: column; align-items: center; width: 100%; }
  /* Wordless feedback. Correct: a green hairline above the word that scales in
     from center, and the whole answer block rises in. Wrong: the struck-through
     attempt (no animation). Empty miss: nothing. */
  .ok-line {
    display: block;
    width: 30px;
    height: 2px;
    border-radius: 1px;
    margin: 26px auto 0;
    background: var(--ok);
    box-shadow: 0 0 12px var(--ok);
    transform-origin: center;
  }
  .attempt {
    margin: 0 0 6px;
    font-size: 17px;
    font-weight: 300;
    color: var(--mut3);
    text-decoration: line-through;
    text-decoration-color: var(--red);
    text-decoration-thickness: 1px;
  }
  @media (prefers-reduced-motion: no-preference) {
    .ok-line { animation: hairlineIn 850ms cubic-bezier(0.2, 0.8, 0.3, 1) both; }
    .answer.correct { animation: answerRise 480ms cubic-bezier(0.2, 0.8, 0.3, 1) 120ms both; }
  }
  /* Draw in with a glow bloom and a momentary thickness swell, settle under,
     one small second bounce (the flag-drop cadence), relax to the resting
     glow. The draw still completes by ~320ms so it reads as fast; the extra
     300ms is the settle, not the arrival. */
  @keyframes hairlineIn {
    0% { transform: scale(0, 1); opacity: 0; box-shadow: 0 0 0 color-mix(in oklab, var(--ok) 0%, transparent); }
    38% { transform: scale(1.4, 1.8); opacity: 1; box-shadow: 0 0 18px 3px color-mix(in oklab, var(--ok) 85%, transparent); }
    60% { transform: scale(0.94, 1); }
    78% { transform: scale(1.12, 1.3); box-shadow: 0 0 15px 1px var(--ok); }
    100% { transform: scale(1, 1); box-shadow: 0 0 12px var(--ok); }
  }
  @keyframes answerRise {
    from { transform: translateY(10px); opacity: 0; }
    to { transform: translateY(0); opacity: 1; }
  }
  .da {
    display: flex;
    align-items: center;
    justify-content: center;
    flex-wrap: wrap;
    gap: 14px;
    margin: 16px 0 0;
    font-family: var(--font-serif);
    font-size: 42px;
    font-weight: 600;
    color: var(--ink);
    letter-spacing: -0.01em;
    line-height: 1.25;
  }
  .ex {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-wrap: wrap;
    gap: 9px;
    margin: 14px 0 0;
    font-size: 15px;
    color: var(--mut1);
  }
  .note { margin: 16px 0 0; max-width: 400px; font-size: 13px; line-height: 1.55; color: var(--mut2); }
  .obs {
    font-family: var(--font-mono);
    font-size: 10.5px;
    font-weight: 600;
    letter-spacing: 0.14em;
    color: var(--red);
    margin-right: 10px;
  }

  /* Grade pills */
  .grade-pills {
    display: flex;
    align-items: center;
    justify-content: center;
    flex-wrap: wrap;
    gap: 10px;
    margin-top: 30px;
  }
  /* Narrow phones: the four pills need ~365px, so flex wrap strands Lätt
     alone on a second row — a 2×2 grid reads deliberately instead. */
  @media (max-width: 420px) {
    .grade-pills {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      width: min(320px, 100%);
    }
    .grade {
      justify-content: center;
    }
  }
  .grade {
    display: inline-flex;
    align-items: baseline;
    gap: 8px;
    font: inherit;
    font-size: 14px;
    color: var(--ink);
    background: none;
    border: 1px solid var(--bd4);
    border-radius: 999px;
    padding: 10px 18px;
    cursor: pointer;
  }
  .grade .gd { font-family: var(--font-mono); font-size: 10px; color: var(--mut4); }
  /* The Enter default: a slightly brighter border only — no fill, no glow. --mut4
     is the app's brighter-border tone (the handoff's rgba(255,240,220,0.4)),
     theme-adaptive. Placed before :hover so hover still overrides. */
  .grade.is-default { border-color: var(--mut4); }
  /* Discreet ↵ glyph after the label, tucked closer than the button's 8px gap. */
  .default-grade-enter-hint {
    margin-left: -3px;
    font-family: var(--font-mono);
    font-size: 11px;
    line-height: 1;
    color: var(--mut4);
  }
  @media (hover: none), (max-width: 640px) {
    .default-grade-enter-hint { display: none; }
  }
  .grade:hover { border-color: var(--ink); }
  .grade.again:hover { border-color: var(--red); color: var(--red); }
  .grade.again:hover .gd { color: var(--red); }
  .grade:disabled { opacity: 0.5; cursor: not-allowed; }
  .grade:disabled:hover { border-color: var(--bd4); }

  /* Helper caption below the card. */
  .card-hint { margin: 18px 0 0; font-size: 12.5px; color: var(--mut3); text-align: center; }

  /* ---- Completion ---- */
  .done h2 {
    margin: 0;
    font-family: var(--font-serif);
    font-size: 28px;
    font-weight: 500;
    color: var(--ink);
  }
  .done p { margin: 12px 0 0; color: var(--mut1); font-size: 14px; }
  .started { color: var(--mut1); font-size: 14px; margin-top: 8px; }
  .started a { color: var(--mut1); text-decoration: none; }
  .started a:hover { color: var(--red); }
  .next-due {
    list-style: none;
    margin: 18px 0 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
  }
  .linklike {
    background: none;
    border: none;
    padding: 0;
    font: inherit;
    font-size: 13px;
    color: var(--mut1);
    text-decoration: none;
    cursor: pointer;
  }
  .linklike:hover { color: var(--red); }
  .done-actions { display: flex; align-items: baseline; gap: 24px; margin-top: 22px; flex-wrap: wrap; justify-content: center; }
  .done-actions .text-btn { font-size: 13.5px; padding: 8px; }

  .warning { color: var(--red); font-size: 13px; text-align: center; margin-top: 16px; }

  /* ---- Secondary panels ---- */
  .panel-wrap { margin-top: 24px; }
  .backup { margin-top: 24px; color: var(--mut3); font-size: 12.5px; }
  .backup summary { cursor: pointer; }
  .backup button, .backup .import { margin-right: var(--sp-3); }
  .import { display: inline-block; cursor: pointer; }
  .import input { display: block; margin-top: var(--sp-1); }

  .vh { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }

  @media (prefers-reduced-motion: no-preference) {
    .answer { animation: fade 120ms ease-out; }
    @keyframes fade { from { opacity: 0; } to { opacity: 1; } }
    /* No entrance animation on the done heading: the celebration flag
       (earned completions only) is the site's one animated moment. */
  }
</style>

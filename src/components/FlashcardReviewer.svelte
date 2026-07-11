<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { Store, DIRECTIONS, type Direction } from '../lib/storage.ts';
  import { clampForCorrectness, Rating, type ReviewGrade } from '../lib/srs.ts';
  import { speak } from '../lib/speech.ts';
  import { withBase } from '../lib/url.ts';
  import SpeakButton from './SpeakButton.svelte';
  import SettingsPanel from './SettingsPanel.svelte';
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
  let container = $state<HTMLElement>();
  let input = $state<HTMLInputElement>();

  const now = () => new Date();
  const current = $derived(queue[idx]);
  const remaining = $derived(Math.max(0, queue.length - idx));
  // Self-graded modes have no typed answer (speak: rate your pronunciation;
  // listen-sentence: rate your comprehension) — skip the verdict, never floor.
  const selfGraded = $derived(direction === 'speak' || direction === 'listen-sentence');
  // Optgroup headers for the picker, in first-seen order. '' marks top-level
  // entries (the due-all group), rendered before the optgroups.
  const optgroups = $derived([...new Set(groups.map((g) => g.optgroup).filter(Boolean))]);
  // The fill-in-the-blank for 'cloze': { text, answer } or null.
  const clozeText = $derived(direction === 'cloze' && current ? clozeSentence(current) : null);
  // Is the due-only cross-deck group selected? (Drives its plain empty state.)
  const isDueAll = $derived(groups.find((g) => g.id === selectedGroupId)?.match.kind === 'all');

  // Session state set by start(), so we don't re-filter the 5000+ card union
  // on every render/card: the raw active pool (distractor source), its size (for
  // the empty-state message), and whether cloze was picked but has no eligible
  // cards. speakSilent flags a 'speak' reveal that produced no audio.
  let sessionPool = $state<Card[]>([]);
  let poolSize = $state(0);
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
    tick().then(() => container?.focus());
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
  }

  // Slow replay of the revealed word in 'speak' mode (compare against your own
  // pronunciation at 0.75×).
  function playSlowWord() {
    if (!current) return;
    const opts: { audioUrl?: string; rate: number } = { rate: 0.75 };
    if (current.audio) opts.audioUrl = withBase(current.audio);
    void speak(current.danish, opts);
  }

  /** Advance past an unplayable listen card WITHOUT grading it (no forced
   *  "Again" on a card the learner never got to hear). */
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

  function afterPrompt() {
    speakSilent = false;
    promptAudioState = 'ok';
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
    // punctuation ("løbe." for "løbe") but never fold æ/ø/å — see session.ts.
    wasCorrect =
      direction === 'cloze' && clozeText
        ? matchCloze(typed, clozeText.answer)
        : matchTyped(typed, current);
    phase = 'revealed';
    await tick();
    container?.focus();
  }

  function grade(g: ReviewGrade) {
    if (grading || phase !== 'revealed' || !current) return;
    grading = true;
    try {
      // Self-graded modes (speak) trust the learner's rating; typed modes floor a
      // wrong answer to Again.
      const eff = selfGraded ? g : clampForCorrectness(g, wasCorrect);
      const { result } = store.grade(current.id, direction, eff, now());
      if (!result.ok) warning = T.saveError;
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
      if (idx >= queue.length) phase = 'done';
      else {
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
  });
</script>

{#if !ready}
  <p>{T.loading}</p>
{:else}
  {#if fromLesson}
    <p class="from-lesson"><a href={withBase(`lektioner/${fromLesson}`)}>{UI.lessons.backToLesson}</a></p>
  {/if}
  <div class="bar">
    {#if tag}
      <span>{T.trainingTagPrefix} <strong>#{tag}</strong></span>
      <button onclick={() => { tag = null; start(); }}>{T.showAllDecks}</button>
    {:else}
      <label>
        {T.deckLabel}
        <select bind:value={selectedGroupId} onchange={() => restartGuarded(() => (selectedGroupId = prevGroup))}>
          {#each groups.filter((g) => !g.optgroup) as g}<option value={g.id}>{g.label}</option>{/each}
          {#each optgroups as og}
            <optgroup label={og}>
              {#each groups.filter((g) => g.optgroup === og) as g}<option value={g.id}>{g.label}</option>{/each}
            </optgroup>
          {/each}
        </select>
      </label>
    {/if}

    <fieldset class="dir">
      <legend class="vh">{T.directionLegend}</legend>
      <label><input type="radio" name="dir" value="produce" bind:group={direction} onchange={() => restartGuarded(() => (direction = prevDirection))} /> {T.write}</label>
      <label><input type="radio" name="dir" value="recognize" bind:group={direction} onchange={() => restartGuarded(() => (direction = prevDirection))} /> {T.recognize}</label>
      <label><input type="radio" name="dir" value="listen" bind:group={direction} onchange={() => restartGuarded(() => (direction = prevDirection))} /> {T.listen}</label>
      <!-- Cloze/listen-sentence are gated per deck: a pool with 0 eligible cards
           disables the radio (with the reason as a tooltip) instead of letting
           the learner discover an empty session after selecting. -->
      <label title={listenSentenceCount === 0 ? T.listenSentenceUnavailable : undefined}><input type="radio" name="dir" value="listen-sentence" bind:group={direction} disabled={listenSentenceCount === 0} onchange={() => restartGuarded(() => (direction = prevDirection))} /> {T.listenSentence}{#if listenSentenceCount === 0}&nbsp;(0){/if}</label>
      <label><input type="radio" name="dir" value="speak" bind:group={direction} onchange={() => restartGuarded(() => (direction = prevDirection))} /> {T.speak}</label>
      <label title={clozeCount === 0 ? T.clozeUnavailable : undefined}><input type="radio" name="dir" value="cloze" bind:group={direction} disabled={clozeCount === 0} onchange={() => restartGuarded(() => (direction = prevDirection))} /> {T.cloze}{#if clozeCount === 0}&nbsp;(0){/if}</label>
    </fieldset>
  </div>

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
      <p class="progress" role="status">{T.loadingDeck}</p>
    {:else if phase === 'done'}
      <div class="done">
        {#if reviewed === 0 && tag && poolSize === 0}
          <h2 tabindex="-1">{T.doneEmpty}</h2>
          <p>{T.noTagMatch}</p>
          <div class="grades">
            <button onclick={() => { tag = null; start(); }}>{T.showAllDecks}</button>
          </div>
        {:else if reviewed === 0 && filteredReason === 'cloze'}
          <h2 tabindex="-1">{T.doneEmpty}</h2>
          <p>{T.noClozeCards}</p>
        {:else if reviewed === 0 && filteredReason === 'listen'}
          <h2 tabindex="-1">{T.doneEmpty}</h2>
          <p>{T.noListenCards}</p>
        {:else}
          <h2 tabindex="-1">{reviewed > 0 ? T.doneTitle : isDueAll ? T.dueAllEmpty : T.doneEmpty}</h2>
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
          <div class="grades">
            <button onclick={() => start(false)}>{T.repeatDue}</button>
            <button onclick={() => start(true)}>{T.practiceFree}</button>
          </div>
        {/if}
      </div>
    {:else if current}
      <p class="progress" aria-live="polite">{T.progress(idx + 1, queue.length, remaining)}</p>

      {#if direction === 'listen' || direction === 'listen-sentence'}
        <p class="prompt-listen">{direction === 'listen' ? T.listenPrompt : T.listenSentencePrompt}</p>
        <!-- Plain replay (not SpeakButton): its aria-label must NOT contain the
             Danish text, or a screen reader would announce the answer before
             the learner attempts the exercise. -->
        {#if promptAudioState === 'none'}
          <p class="hint" role="status">{T.noPromptAudio}</p>
          {#if phase === 'prompt'}
            <button type="button" onclick={skipCard}>{T.skipCard}</button>
          {/if}
        {:else if promptAudioState === 'blocked'}
          <!-- Autoplay denied (no user gesture yet): an explicit play instead of
               pretending the clip was heard. The click is the gesture. -->
          <button type="button" class="replay" onclick={() => playPrompt()}>{T.play}</button>
        {:else}
          <button type="button" class="replay" onclick={() => playPrompt()} aria-label={T.replay} title={direction === 'listen-sentence' ? T.replayKeyTitle : undefined}>
            <span aria-hidden="true">🔊</span> {T.replay}
          </button>
          {#if direction === 'listen-sentence'}
            <button type="button" class="replay" onclick={() => playPrompt(0.75)}>{T.slowReplay}</button>
          {/if}
          {#if promptAudioState === 'tts'}<span class="tts-hint" title={T.ttsHintTitle}>{T.ttsHint}</span>{/if}
        {/if}
      {:else if direction === 'cloze'}
        <p class="prompt-listen">{T.clozePrompt}</p>
        <p class="prompt" lang="da">{clozeText?.text}</p>
        <p class="hint">{current.swedish}{#if current.exampleSv} — {current.exampleSv}{/if}</p>
      {:else}
        <p class="prompt">{current.swedish}</p>
        {#if current.exampleSv}<p class="hint">{current.exampleSv}</p>{/if}
      {/if}

      {#if phase === 'prompt'}
        {#if direction === 'recognize'}
          <div class="choices" role="group" aria-label={T.choosePrompt}>
            {#each choices as c, i}
              <button type="button" class="choice" lang="da" title={T.chooseKeyTitle(i + 1)} onclick={() => choose(c)}>{c}</button>
            {/each}
          </div>
        {:else if direction === 'speak'}
          <p class="prompt-listen">{T.speakPrompt}</p>
          <div class="grades">
            <button type="button" title={T.revealKeyTitle} onclick={revealSpeak}>{T.speakReveal}</button>
          </div>
        {:else if direction === 'listen-sentence'}
          <div class="grades">
            <button type="button" title={T.revealKeyTitle} onclick={revealSelf}>{T.listenSentenceReveal}</button>
          </div>
        {:else}
          <form onsubmit={(e) => { e.preventDefault(); submit(); }}>
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
            <button type="submit">{T.reveal}</button>
          </form>
          <p class="charbar">
            <span>{T.charHelper}</span>
            {#each ['æ', 'ø', 'å'] as ch}
              <button type="button" class="char" onclick={() => insertChar(ch)} aria-label={`Infoga ${ch}`}>{ch}</button>
            {/each}
          </p>
        {/if}
      {:else}
        <div class="answer" aria-live="polite">
          {#if !selfGraded}
            <p class={wasCorrect ? 'verdict ok' : 'verdict no'}>
              {wasCorrect ? T.correct : T.incorrect}
            </p>
          {/if}
          <p class="da" lang="da">{current.danish} <SpeakButton text={current.danish} audio={current.audio} />{#if direction === 'speak'}<button type="button" class="slow" onclick={playSlowWord}>{T.slowReplay}</button>{/if}</p>
          <p class="sv">{current.swedish}</p>
          {#if current.exampleDa}<p class="ex" lang="da">{current.exampleDa} <SpeakButton text={current.exampleDa} audio={current.audioExample} label={T.hear} /></p>{/if}
          {#if current.note}<p class="callout">{current.note}</p>{/if}
          {#if selfGraded && speakSilent}<p class="hint">{T.noAudio}</p>{/if}
          <div class="grades">
            <button onclick={() => grade(1 as ReviewGrade)}>{T.grades.again} (1)</button>
            <button onclick={() => grade(2 as ReviewGrade)} disabled={!selfGraded && !wasCorrect}>{T.grades.hard} (2)</button>
            <button onclick={() => grade(3 as ReviewGrade)} disabled={!selfGraded && !wasCorrect}>{T.grades.good} (3)</button>
            <button onclick={() => grade(4 as ReviewGrade)} disabled={!selfGraded && !wasCorrect}>{T.grades.easy} (4)</button>
          </div>
          {#if direction === 'listen-sentence'}<p class="hint">{T.comprehendHint}</p>{:else if selfGraded}<p class="hint">{T.selfGradeHint}</p>{:else if wasCorrect}<p class="hint">{T.gradeKeysHint}</p>{:else}<p class="hint">{T.wrongHint}</p>{/if}
        </div>
      {/if}
    {/if}

    {#if warning}<p class="warning" role="alert">{warning}</p>{/if}
  </section>

  <!-- Apply saved settings only when between rounds; mid-round we keep the
       current queue and they take effect next round (matches the panel copy). -->
  <SettingsPanel {store} onSaved={() => { if (phase === 'done') start(); }} />

  <details class="backup">
    <summary>{T.backup.summary}</summary>
    <p>{T.backup.note}</p>
    <button onclick={exportBackup}>{T.backup.export}</button>
    <label class="import">{T.backup.import}
      <input type="file" accept="application/json" aria-label={T.backup.import} onchange={importBackup} />
    </label>
  </details>
{/if}

<style>
  .from-lesson { font-size: var(--step--1); margin: 0 0 var(--sp-3); }
  .started { color: var(--muted); font-size: var(--step--1); margin-top: var(--sp-2); }
  .bar { display: flex; align-items: center; gap: var(--sp-4); margin-bottom: var(--sp-4); flex-wrap: wrap; }
  select { font: inherit; padding: var(--sp-1) var(--sp-2); border-radius: var(--radius); border: 1px solid var(--border); background: var(--surface); color: var(--text); }
  .dir { border: 1px solid var(--border); border-radius: var(--radius); padding: var(--sp-1) var(--sp-3); display: flex; gap: var(--sp-3); margin: 0; }
  .dir label { display: inline-flex; align-items: center; gap: 0.3em; font-size: var(--step--1); }
  .reviewer { border: 1px solid var(--border); border-radius: var(--radius); background: var(--surface); padding: var(--sp-6); min-height: 16rem; }
  .reviewer:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  .progress { color: var(--muted); font-size: var(--step--1); margin: 0 0 var(--sp-4); }
  .prompt { font-size: var(--step-2); font-weight: 600; margin: 0 0 var(--sp-2); }
  .prompt-listen { font-size: var(--step-1); margin: 0 0 var(--sp-2); }
  .hint { color: var(--muted); font-size: var(--step--1); margin: var(--sp-1) 0; }
  form { display: flex; gap: var(--sp-2); flex-wrap: wrap; margin-top: var(--sp-4); }
  form input { flex: 1 1 12rem; }
  .choices { display: grid; gap: var(--sp-2); margin-top: var(--sp-4); }
  .choice { text-align: left; font-size: var(--step-0); padding: var(--sp-3) var(--sp-4); min-height: var(--min-tap); }
  .charbar { display: flex; align-items: center; gap: var(--sp-2); flex-wrap: wrap; margin: var(--sp-2) 0 0; color: var(--muted); font-size: var(--step--1); }
  .char { min-width: 2.2em; min-height: 2.2em; font-size: var(--step-0); }
  .verdict { font-weight: 700; margin: 0 0 var(--sp-2); }
  .verdict.ok { color: var(--correct); }
  .verdict.no { color: var(--accent); }
  .da { font-size: var(--step-2); font-weight: 700; margin: 0 0 var(--sp-1); display: flex; align-items: baseline; gap: var(--sp-3); }
  .sv { margin: 0 0 var(--sp-1); }
  .ex { color: var(--muted); margin: 0 0 var(--sp-2); }
  .grades { display: flex; gap: var(--sp-2); flex-wrap: wrap; margin-top: var(--sp-4); }
  .warning { color: var(--accent); margin-top: var(--sp-4); }
  .replay + .replay { margin-left: var(--sp-2); }
  .slow { font-size: var(--step--1); }
  .tts-hint { color: var(--muted); font-size: var(--step--1); font-style: italic; margin-left: 0.35em; cursor: help; }
  .next-due { list-style: none; margin: var(--sp-3) 0 0; padding: 0; display: grid; gap: var(--sp-1); justify-items: start; }
  .linklike { background: none; border: none; padding: 0; font: inherit; font-size: var(--step--1); color: var(--accent); text-decoration: underline; cursor: pointer; }
  .backup { margin-top: var(--sp-6); color: var(--muted); font-size: var(--step--1); }
  .backup summary { cursor: pointer; }
  .backup button, .backup .import { margin-right: var(--sp-3); }
  .import { display: inline-block; cursor: pointer; }
  .import input { display: block; margin-top: var(--sp-1); }
  .vh { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
  @media (prefers-reduced-motion: no-preference) {
    .answer { animation: fade 120ms ease-out; }
    @keyframes fade { from { opacity: 0; } to { opacity: 1; } }
    .done h2 { animation: pop 320ms ease-out; }
    @keyframes pop { 0% { transform: scale(0.96); opacity: 0; } 60% { transform: scale(1.02); } 100% { transform: scale(1); opacity: 1; } }
  }
</style>

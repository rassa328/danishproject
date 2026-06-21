<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { Store, DIRECTIONS, type Direction } from '../lib/storage.ts';
  import { clampForCorrectness, type ReviewGrade } from '../lib/srs.ts';
  import { speak } from '../lib/speech.ts';
  import { withBase } from '../lib/url.ts';
  import SpeakButton from './SpeakButton.svelte';
  import SettingsPanel from './SettingsPanel.svelte';
  import { matchAnswer, normalizeAnswer, clozeSentence, type Card } from '../lib/vocab.ts';
  import { matchesGroup, type StudyGroup } from '../lib/deck-groups.ts';
  import { UI } from '../lib/strings.ts';

  const T = UI.flashcards;

  // `cards` is the full studyable set (starter ∪ praksis), serialized once.
  // `groups` are lightweight picker descriptors that resolve to subsets of it.
  let { cards, groups }: { cards: Card[]; groups: StudyGroup[] } = $props();

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
  // Optgroup headers for the picker, in first-seen order.
  const optgroups = $derived([...new Set(groups.map((g) => g.optgroup))]);
  // The fill-in-the-blank for 'cloze': { text, answer } or null.
  const clozeText = $derived(direction === 'cloze' && current ? clozeSentence(current) : null);

  // Session state set by buildQueue, so we don't re-filter the 5000+ card union
  // on every render/card: the raw active pool (distractor source), its size (for
  // the empty-state message), and whether cloze was picked but has no eligible
  // cards. speakSilent flags a 'speak' reveal that produced no audio.
  let sessionPool = $state<Card[]>([]);
  let poolSize = $state(0);
  // Why a filtered mode produced an empty queue: 'cloze' (no example sentences)
  // or 'listen' (no sentence audio) — drives a clear done-screen message.
  let filteredReason = $state<'none' | 'cloze' | 'listen'>('none');
  let speakSilent = $state(false);

  /** Restart the session, but if the learner is mid-round, confirm first and
   *  revert the just-changed control on cancel. */
  function restartGuarded(revert: () => void) {
    if (reviewed > 0 && phase !== 'done' && !confirm(T.confirmRestart)) {
      revert();
      return;
    }
    prevGroup = selectedGroupId;
    prevDirection = direction;
    start();
  }

  function shuffle<T>(a: T[]): T[] {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j] as T, a[i] as T];
    }
    return a;
  }

  function pool(): Card[] {
    if (tag) return cards.filter((c) => c.tags.includes(tag as string));
    const g = groups.find((x) => x.id === selectedGroupId);
    return g ? cards.filter((c) => matchesGroup(c, g.match)) : [];
  }

  function buildQueue(free: boolean): Card[] {
    const raw = pool();
    sessionPool = raw; // cached for distractors (avoid re-filtering per card)
    poolSize = raw.length;
    // Filtered modes: cloze needs the headword in the example; listen-sentence
    // needs committed sentence audio.
    const dc =
      direction === 'cloze'
        ? raw.filter((c) => clozeSentence(c) !== null)
        : direction === 'listen-sentence'
          ? raw.filter((c) => !!c.audioExample && !!c.exampleDa)
          : raw;
    filteredReason =
      dc.length === 0 && raw.length > 0
        ? direction === 'cloze'
          ? 'cloze'
          : direction === 'listen-sentence'
            ? 'listen'
            : 'none'
        : 'none';
    if (free) return shuffle([...dc]);
    const settings = store.getSettings();
    const due: { c: Card; due: number }[] = [];
    const fresh: Card[] = [];
    for (const c of dc) {
      const r = store.getRecord(c.id, direction);
      if (!r) fresh.push(c);
      else if (!r.suspended && new Date(r.due) <= now()) due.push({ c, due: new Date(r.due).getTime() });
    }
    // Cap the due backlog MOST-OVERDUE first (not deck order), so badly overdue
    // cards aren't starved when there are more due than the cap.
    due.sort((a, b) => a.due - b.due);
    // Introduce new cards most-useful-first: by frequency rank when present,
    // else by level (B1 before B2 — a coarse frequency proxy). The queue is
    // shuffled below, so this changes WHICH fresh cards enter, not their order.
    fresh.sort((a, b) => {
      const ra = a.rank ?? Infinity;
      const rb = b.rank ?? Infinity;
      if (ra !== rb) return ra - rb;
      return a.cefr === b.cefr ? 0 : a.cefr === 'b1' ? -1 : 1;
    });
    // Caps: reviewPerDay bounds the due backlog per session; newPerDay is a true
    // DAILY budget (shared across directions) — subtract cards already introduced
    // today so multiple sessions can't silently pile up review debt.
    const dueCards = due.slice(0, settings.reviewPerDay).map((x) => x.c);
    const newBudget = Math.max(0, settings.newPerDay - store.newCardsToday(now()));
    return shuffle([...dueCards, ...fresh.slice(0, newBudget)]);
  }

  // Multiple-choice options for 'recognize' mode: the answer + 3 distractors.
  // Distractors are drawn from the ACTIVE pool so they stay in-domain (a 5000-word
  // "all" pool would otherwise pair an emotion word with a cycling-part); for a
  // tiny pool we fall back to the whole set so options still fill. Same
  // part-of-speech is preferred for plausibility. Rebuilt on each new card.
  let choices = $state<string[]>([]);
  function buildChoices() {
    if (direction !== 'recognize' || !current) {
      choices = [];
      return;
    }
    const correct = current.danish;
    const uniq = (cs: Card[]) => [...new Set(cs.map((c) => c.danish))].filter((d) => d !== correct);
    const base = sessionPool.length >= 8 ? sessionPool : cards;
    const samePos = shuffle(uniq(base.filter((c) => c.pos === current.pos)));
    const anyPos = shuffle(uniq(base));
    const distractors = [...new Set([...samePos, ...anyPos])].slice(0, 3);
    choices = shuffle([correct, ...distractors]);
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

  function playPrompt() {
    if (direction === 'listen' && current) {
      void speak(current.danish, current.audio ? { audioUrl: withBase(current.audio) } : {});
    } else if (direction === 'listen-sentence' && current?.exampleDa) {
      // Play the example SENTENCE (text hidden) — connected-speech listening.
      void speak(
        current.exampleDa,
        current.audioExample ? { audioUrl: withBase(current.audioExample) } : {},
      );
    }
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

  function start(free = false) {
    queue = buildQueue(free);
    idx = 0;
    reviewed = 0;
    typed = '';
    warning = '';
    phase = queue.length ? 'prompt' : 'done';
    if (phase === 'prompt') afterPrompt();
  }

  function afterPrompt() {
    speakSilent = false;
    buildChoices();
    tick().then(() => {
      input?.focus();
      playPrompt();
    });
  }

  async function submit() {
    if (phase !== 'prompt' || !current) return;
    // Cloze requires the exact in-context form that was blanked (not just the
    // lemma); other typed modes accept any accepted form.
    wasCorrect =
      direction === 'cloze' && clozeText
        ? normalizeAnswer(typed) === normalizeAnswer(clozeText.answer)
        : matchAnswer(typed, current);
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
    if (phase !== 'revealed') return;
    if (e.key >= '1' && e.key <= '4') {
      e.preventDefault();
      grade(Number(e.key) as ReviewGrade);
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
      <label><input type="radio" name="dir" value="listen-sentence" bind:group={direction} onchange={() => restartGuarded(() => (direction = prevDirection))} /> {T.listenSentence}</label>
      <label><input type="radio" name="dir" value="speak" bind:group={direction} onchange={() => restartGuarded(() => (direction = prevDirection))} /> {T.speak}</label>
      <label><input type="radio" name="dir" value="cloze" bind:group={direction} onchange={() => restartGuarded(() => (direction = prevDirection))} /> {T.cloze}</label>
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
    {#if phase === 'done'}
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
          <h2 tabindex="-1">{reviewed > 0 ? T.doneTitle : T.doneEmpty}</h2>
          {#if reviewed > 0}<p>{T.reviewedCount(reviewed)}</p>{/if}
          <p class="started">{UI.progress.words(store.startedCount(), cards.length)}</p>
          {#if store.getStreak() > 0}<p class="started">{UI.progress.streak(store.getStreak())}</p>{/if}
          <div class="grades">
            <button onclick={() => start(false)}>{T.repeatDue}</button>
            <button onclick={() => start(true)}>{T.practiceFree}</button>
          </div>
        {/if}
      </div>
    {:else if current}
      <p class="progress" aria-live="polite">{T.progress(idx + 1, queue.length, remaining)}</p>

      {#if direction === 'listen'}
        <p class="prompt-listen">{T.listenPrompt}</p>
        <SpeakButton text={current.danish} audio={current.audio} label={T.replay} />
      {:else if direction === 'listen-sentence'}
        <p class="prompt-listen">{T.listenSentencePrompt}</p>
        <!-- Plain replay (not SpeakButton): its aria-label must NOT contain the
             sentence text, or a screen reader would announce the answer before
             the learner attempts to comprehend the audio. -->
        <button type="button" class="replay" onclick={playPrompt} aria-label={T.replay}>
          <span aria-hidden="true">🔊</span> {T.replay}
        </button>
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
            {#each choices as c}
              <button type="button" class="choice" lang="da" onclick={() => choose(c)}>{c}</button>
            {/each}
          </div>
        {:else if direction === 'speak'}
          <p class="prompt-listen">{T.speakPrompt}</p>
          <div class="grades">
            <button type="button" onclick={revealSpeak}>{T.speakReveal}</button>
          </div>
        {:else if direction === 'listen-sentence'}
          <div class="grades">
            <button type="button" onclick={revealSelf}>{T.listenSentenceReveal}</button>
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
          <p class="da" lang="da">{current.danish} <SpeakButton text={current.danish} audio={current.audio} /></p>
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

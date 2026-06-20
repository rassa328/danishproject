<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { Store, type Direction } from '../lib/storage.ts';
  import { clampForCorrectness, type ReviewGrade } from '../lib/srs.ts';
  import { speak } from '../lib/speech.ts';
  import { withBase } from '../lib/url.ts';
  import SpeakButton from './SpeakButton.svelte';
  import { matchAnswer, type Card } from '../lib/vocab.ts';
  import { UI } from '../lib/strings.ts';

  const T = UI.flashcards;

  let { cards, decks }: { cards: Card[]; decks: string[] } = $props();

  let store: Store;
  let ready = $state(false);
  let tag = $state<string | null>(null);
  let fromLesson = $state<string | null>(null);
  let selectedDeck = $state(decks[0] ?? '');
  let direction = $state<Direction>('produce');
  // Previous values so a cancelled "restart?" confirm can revert the control.
  let prevDeck = selectedDeck;
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
  // True when the current filter (tag or deck) contains no cards at all — lets
  // the done screen say "no match, clear filter" instead of "all caught up".
  const poolEmpty = $derived(ready && pool().length === 0);

  /** Restart the session, but if the learner is mid-round, confirm first and
   *  revert the just-changed control on cancel. */
  function restartGuarded(revert: () => void) {
    if (reviewed > 0 && phase !== 'done' && !confirm(T.confirmRestart)) {
      revert();
      return;
    }
    prevDeck = selectedDeck;
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
    return tag
      ? cards.filter((c) => c.tags.includes(tag as string))
      : cards.filter((c) => c.deck === selectedDeck);
  }

  function buildQueue(free: boolean): Card[] {
    const dc = pool();
    if (free) return shuffle([...dc]);
    const settings = store.getSettings();
    const due: Card[] = [];
    const fresh: Card[] = [];
    for (const c of dc) {
      const r = store.getRecord(c.id, direction);
      if (!r) fresh.push(c);
      else if (!r.suspended && new Date(r.due) <= now()) due.push(c);
    }
    // Introduce easier (B1) cards before harder (B2) ones; shuffle within level.
    fresh.sort((a, b) => (a.cefr === b.cefr ? 0 : a.cefr === 'b1' ? -1 : 1));
    return shuffle([...due, ...fresh.slice(0, settings.newPerDay)]);
  }

  // Multiple-choice options for 'recognize' mode: the answer + up to 3 distractors
  // drawn from the same pool, shuffled. Rebuilt on each new card.
  let choices = $state<string[]>([]);
  function buildChoices() {
    if (direction !== 'recognize' || !current) {
      choices = [];
      return;
    }
    const others = [...new Set(pool().map((c) => c.danish))].filter((d) => d !== current.danish);
    choices = shuffle([current.danish, ...shuffle(others).slice(0, 3)]);
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
    }
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
    buildChoices();
    tick().then(() => {
      input?.focus();
      playPrompt();
    });
  }

  async function submit() {
    if (phase !== 'prompt' || !current) return;
    wasCorrect = matchAnswer(typed, current);
    phase = 'revealed';
    await tick();
    container?.focus();
  }

  function grade(g: ReviewGrade) {
    if (grading || phase !== 'revealed' || !current) return;
    grading = true;
    try {
      const eff = clampForCorrectness(g, wasCorrect);
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
        <select bind:value={selectedDeck} onchange={() => restartGuarded(() => (selectedDeck = prevDeck))}>
          {#each decks as d}<option value={d}>{d}</option>{/each}
        </select>
      </label>
    {/if}

    <fieldset class="dir">
      <legend class="vh">{T.directionLegend}</legend>
      <label><input type="radio" name="dir" value="produce" bind:group={direction} onchange={() => restartGuarded(() => (direction = prevDirection))} /> {T.write}</label>
      <label><input type="radio" name="dir" value="recognize" bind:group={direction} onchange={() => restartGuarded(() => (direction = prevDirection))} /> {T.recognize}</label>
      <label><input type="radio" name="dir" value="listen" bind:group={direction} onchange={() => restartGuarded(() => (direction = prevDirection))} /> {T.listen}</label>
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
        {#if reviewed === 0 && tag && poolEmpty}
          <h2 tabindex="-1">{T.doneEmpty}</h2>
          <p>{T.noTagMatch}</p>
          <div class="grades">
            <button onclick={() => { tag = null; start(); }}>{T.showAllDecks}</button>
          </div>
        {:else}
          <h2 tabindex="-1">{reviewed > 0 ? T.doneTitle : T.doneEmpty}</h2>
          {#if reviewed > 0}<p>{T.reviewedCount(reviewed)}</p>{/if}
          <p class="started">{UI.progress.words(store.startedCount(), cards.length)}</p>
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
          <p class={wasCorrect ? 'verdict ok' : 'verdict no'}>
            {wasCorrect ? T.correct : T.incorrect}
          </p>
          <p class="da" lang="da">{current.danish} <SpeakButton text={current.danish} audio={current.audio} /></p>
          <p class="sv">{current.swedish}</p>
          {#if current.exampleDa}<p class="ex" lang="da">{current.exampleDa} <SpeakButton text={current.exampleDa} audio={current.audioExample} label={T.hear} /></p>{/if}
          {#if current.note}<p class="callout">{current.note}</p>{/if}
          <div class="grades">
            <button onclick={() => grade(1 as ReviewGrade)}>{T.grades.again} (1)</button>
            <button onclick={() => grade(2 as ReviewGrade)} disabled={!wasCorrect}>{T.grades.hard} (2)</button>
            <button onclick={() => grade(3 as ReviewGrade)} disabled={!wasCorrect}>{T.grades.good} (3)</button>
            <button onclick={() => grade(4 as ReviewGrade)} disabled={!wasCorrect}>{T.grades.easy} (4)</button>
          </div>
          {#if wasCorrect}<p class="hint">{T.gradeKeysHint}</p>{:else}<p class="hint">{T.wrongHint}</p>{/if}
        </div>
      {/if}
    {/if}

    {#if warning}<p class="warning" role="alert">{warning}</p>{/if}
  </section>

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

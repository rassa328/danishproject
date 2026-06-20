<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { Store, type Direction } from '../lib/storage.ts';
  import { clampForCorrectness, type ReviewGrade } from '../lib/srs.ts';
  import { speak } from '../lib/speech.ts';
  import { withBase } from '../lib/url.ts';
  import SpeakButton from './SpeakButton.svelte';
  import type { Card } from '../lib/vocab.ts';

  let { cards, decks }: { cards: Card[]; decks: string[] } = $props();

  let store: Store;
  let ready = $state(false);
  let tag = $state<string | null>(null);
  let selectedDeck = $state(decks[0] ?? '');
  let direction = $state<Direction>('produce');
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
  // trim + lowercase + collapse spaces ONLY — never fold æ/ø/å (a Swedish
  // spelling like "läse" must count as wrong).
  const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');
  const current = $derived(queue[idx]);
  const remaining = $derived(Math.max(0, queue.length - idx));

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
    return shuffle([...due, ...fresh.slice(0, settings.newPerDay)]);
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
    tick().then(() => {
      input?.focus();
      playPrompt();
    });
  }

  async function submit() {
    if (phase !== 'prompt' || !current) return;
    wasCorrect = norm(typed) === norm(current.danish);
    phase = 'revealed';
    await tick();
    container?.focus();
  }

  function grade(g: ReviewGrade) {
    if (phase !== 'revealed' || !current) return;
    const eff = clampForCorrectness(g, wasCorrect);
    const { result } = store.grade(current.id, direction, eff, now());
    if (!result.ok) warning = 'Framsteg kunde inte sparas (lagringen kan vara full). Exportera en backup.';
    reviewed++;
    idx++;
    typed = '';
    if (idx >= queue.length) phase = 'done';
    else {
      phase = 'prompt';
      afterPrompt();
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
      warning = r.ok ? 'Backup importerad.' : 'Kunde inte läsa backup-filen.';
      start();
    });
  }

  onMount(() => {
    store = new Store();
    const params = new URLSearchParams(location.search);
    tag = params.get('tag');
    ready = true;
    start();
  });
</script>

{#if !ready}
  <p>Laddar…</p>
{:else}
  <div class="bar">
    {#if tag}
      <span>Tränar taggen <strong>#{tag}</strong></span>
      <button onclick={() => { tag = null; start(); }}>Visa alla kortlekar</button>
    {:else}
      <label>
        Kortlek:
        <select bind:value={selectedDeck} onchange={() => start()}>
          {#each decks as d}<option value={d}>{d}</option>{/each}
        </select>
      </label>
    {/if}

    <fieldset class="dir">
      <legend class="vh">Riktning</legend>
      <label><input type="radio" name="dir" value="produce" bind:group={direction} onchange={() => start()} /> Skriv</label>
      <label><input type="radio" name="dir" value="listen" bind:group={direction} onchange={() => start()} /> Lyssna</label>
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
        <h2 tabindex="-1">{reviewed > 0 ? 'Klart för nu!' : 'Inga kort att repetera just nu'}</h2>
        {#if reviewed > 0}<p>Du repeterade {reviewed} kort.</p>{/if}
        <div class="grades">
          <button onclick={() => start(false)}>Repetera förfallna</button>
          <button onclick={() => start(true)}>Öva fritt (påverkar ej schemat)</button>
        </div>
      </div>
    {:else if current}
      <p class="progress" aria-live="polite">Kort {idx + 1} av {queue.length} · {remaining} kvar</p>

      {#if direction === 'listen'}
        <p class="prompt-listen">🎧 Lyssna och skriv ordet du hör:</p>
        <SpeakButton text={current.danish} audio={current.audio} label="Spela igen" />
      {:else}
        <p class="prompt">{current.swedish}</p>
        {#if current.exampleSv}<p class="hint">{current.exampleSv}</p>{/if}
      {/if}

      {#if phase === 'prompt'}
        <form onsubmit={(e) => { e.preventDefault(); submit(); }}>
          <label class="vh" for="answer">Skriv ordet på danska</label>
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
            placeholder="skriv på danska…"
          />
          <button type="submit">Visa svar (Enter)</button>
        </form>
      {:else}
        <div class="answer" aria-live="polite">
          <p class={wasCorrect ? 'verdict ok' : 'verdict no'}>
            {wasCorrect ? '✓ Rätt!' : '✗ Inte riktigt'}
          </p>
          <p class="da" lang="da">{current.danish} <SpeakButton text={current.danish} audio={current.audio} /></p>
          <p class="sv">{current.swedish}</p>
          {#if current.exampleDa}<p class="ex" lang="da">{current.exampleDa} <SpeakButton text={current.exampleDa} audio={current.audioExample} label="Lyssna" /></p>{/if}
          {#if current.note}<p class="callout">{current.note}</p>{/if}
          <div class="grades">
            <button onclick={() => grade(1 as ReviewGrade)}>Igen (1)</button>
            <button onclick={() => grade(2 as ReviewGrade)} disabled={!wasCorrect}>Svårt (2)</button>
            <button onclick={() => grade(3 as ReviewGrade)} disabled={!wasCorrect}>Bra (3)</button>
            <button onclick={() => grade(4 as ReviewGrade)} disabled={!wasCorrect}>Lätt (4)</button>
          </div>
          {#if !wasCorrect}<p class="hint">Fel svar räknas som ”Igen”.</p>{/if}
        </div>
      {/if}
    {/if}

    {#if warning}<p class="warning" role="alert">{warning}</p>{/if}
  </section>

  <details class="backup">
    <summary>Säkerhetskopiera</summary>
    <p>Framsteg sparas bara i den här webbläsaren. Exportera då och då, eller flytta till en annan enhet.</p>
    <button onclick={exportBackup}>Exportera backup (JSON)</button>
    <label class="import">Importera backup
      <input type="file" accept="application/json" onchange={importBackup} />
    </label>
  </details>
{/if}

<style>
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
  }
</style>

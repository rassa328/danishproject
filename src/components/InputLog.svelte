<script lang="ts">
  // Log real Danish input (TV, podcasts, conversations) and the new words it
  // surfaced. Makes immersion trackable and feeds a future "words I met" deck.
  import { onMount } from 'svelte';
  import { Store, type InputEntry } from '../lib/storage.ts';
  import { UI } from '../lib/strings.ts';

  const T = UI.practice.log;
  const SOURCES = ['tv', 'podcast', 'samtal', 'laesning', 'andet'];

  let store: Store;
  let ready = $state(false);
  let entries = $state<InputEntry[]>([]);
  let source = $state('tv');
  let note = $state('');

  onMount(() => {
    store = new Store();
    entries = store.getInputLog();
    ready = true;
  });

  const newId = (): string =>
    typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

  function add() {
    const text = note.trim();
    if (!text) return;
    store.addInputEntry({ id: newId(), at: Date.now(), source, note: text });
    entries = store.getInputLog();
    note = '';
  }

  function remove(id: string) {
    store.removeInputEntry(id);
    entries = store.getInputLog();
  }

  const sourceLabel = (s: string): string => T.sources[s] ?? s;
  const fmtDate = (at: number): string => new Date(at).toLocaleDateString('sv-SE');
</script>

<div class="log">
  <h3>{T.heading}</h3>
  <p class="intro">{T.intro}</p>

  <form onsubmit={(e) => { e.preventDefault(); add(); }}>
    <label>
      <span class="vh">{T.sourceLabel}</span>
      <select bind:value={source}>
        {#each SOURCES as s}<option value={s}>{sourceLabel(s)}</option>{/each}
      </select>
    </label>
    <input type="text" bind:value={note} placeholder={T.notePlaceholder} aria-label={T.noteLabel} />
    <button type="submit">{T.add}</button>
  </form>
  <p class="hint">{T.wordsHint}</p>

  {#if ready}
    {#if entries.length === 0}
      <p class="empty">{T.empty}</p>
    {:else}
      <ul>
        {#each entries as e (e.id)}
          <li>
            <span class="meta">{fmtDate(e.at)} · {sourceLabel(e.source)}</span>
            <span class="note">{e.note}</span>
            <button type="button" class="rm" onclick={() => remove(e.id)} aria-label={T.remove}>×</button>
          </li>
        {/each}
      </ul>
    {/if}
  {/if}
</div>

<style>
  .log { border: 1px solid var(--border); border-radius: var(--radius); background: var(--surface); padding: var(--sp-4) var(--sp-6); }
  .log h3 { margin: 0 0 var(--sp-2); color: var(--accent); font-size: var(--step-0); }
  .intro { margin: 0 0 var(--sp-3); color: var(--muted); font-size: var(--step--1); }
  form { display: flex; gap: var(--sp-2); flex-wrap: wrap; }
  form input { flex: 1 1 14rem; }
  select, input { font: inherit; padding: var(--sp-1) var(--sp-2); border-radius: var(--radius); border: 1px solid var(--border); background: var(--surface); color: var(--text); }
  .hint { color: var(--muted); font-size: var(--step--1); margin: var(--sp-2) 0 0; }
  .empty { color: var(--muted); font-size: var(--step--1); }
  ul { list-style: none; padding: 0; margin: var(--sp-3) 0 0; display: grid; gap: var(--sp-2); }
  li { display: grid; grid-template-columns: auto 1fr auto; gap: var(--sp-3); align-items: baseline; border-top: 1px solid var(--border); padding-top: var(--sp-2); }
  .meta { color: var(--muted); font-size: var(--step--1); white-space: nowrap; }
  .note { word-break: break-word; }
  .rm { min-width: 2em; min-height: 2em; line-height: 1; }
  .vh { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
</style>

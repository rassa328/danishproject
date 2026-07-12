<script lang="ts">
  // Wordlist search: client-side substring search over the FULL vocabulary
  // (starter ∪ praksis) on danish + swedish. The starter entries arrive slim as
  // island props; the praksis deck is fetched lazily (shared praksis-client
  // cache) on first focus of the field, so plain browsing never downloads it.
  // While a query is active the themed sections below are hidden and the matches
  // render in the normal wordlist row look (same as VocabTable).
  import SpeakButton from './SpeakButton.svelte';
  import { fetchPraksis } from '../lib/praksis-client.ts';
  import { foldNordic } from '../lib/char-map.ts';
  import { UI } from '../lib/strings.ts';

  const T = UI.wordlist;
  const MAX_SHOWN = 50;

  interface Entry {
    id: string;
    danish: string;
    swedish: string;
    deck: string;
    tags: string[];
    audio?: string;
    exampleDa?: string;
    exampleSv?: string;
    audioExample?: string;
    note?: string;
  }
  let { starter }: { starter: Entry[] } = $props();

  let q = $state('');
  let praksis = $state<Entry[]>([]);
  let loadState = $state<'idle' | 'loading' | 'ready' | 'failed'>('idle');

  function ensurePraksis() {
    if (loadState === 'loading' || loadState === 'ready') return;
    loadState = 'loading';
    fetchPraksis()
      .then((cards) => {
        // Keep the fields the normal wordlist row shows (example/note/audio).
        praksis = cards.map((c) => ({
          id: c.id,
          danish: c.danish,
          swedish: c.swedish,
          deck: c.deck,
          tags: c.tags,
          ...(c.audio ? { audio: c.audio } : {}),
          ...(c.exampleDa ? { exampleDa: c.exampleDa } : {}),
          ...(c.exampleSv ? { exampleSv: c.exampleSv } : {}),
          ...(c.audioExample ? { audioExample: c.audioExample } : {}),
          ...(c.note ? { note: c.note } : {}),
        }));
        loadState = 'ready';
      })
      .catch(() => {
        loadState = 'failed';
      });
  }

  // Cross-language fold: ä/æ and ö/ø collapse so a Swedish spelling finds the
  // Danish word and vice versa (foldNordic also NFC-lowercases). Substring of
  // either field is a match.
  const results = $derived.by(() => {
    const query = foldNordic(q.trim());
    if (!query) return null;
    return [...starter, ...praksis].filter(
      (e) => foldNordic(e.danish).includes(query) || foldNordic(e.swedish).includes(query),
    );
  });

  // Hide the themed sections (and the list-note) while a query is active, so the
  // search shows ONLY its results — in the normal wordlist look below.
  $effect(() => {
    const active = !!q.trim();
    const sections = document.getElementById('ordlista-sections');
    if (sections) sections.hidden = active;
  });
</script>

<div class="search">
  <label class="vh" for="ordsok">{T.searchLabel}</label>
  <input
    id="ordsok"
    type="search"
    bind:value={q}
    onfocus={ensurePraksis}
    placeholder={T.searchPlaceholder}
    autocomplete="off"
    autocapitalize="off"
    spellcheck={false}
  />
  {#if loadState === 'loading'}<p class="status" role="status">{T.searchLoading}</p>{/if}
  {#if loadState === 'failed'}<p class="status" role="status">{T.searchFailed}</p>{/if}
  {#if results}
    {#if results.length === 0}
      <p class="status">{T.noMatches}</p>
    {:else}
      <p class="status" role="status">
        {T.matchCount(Math.min(results.length, MAX_SHOWN), results.length)}
      </p>
      <div class="vocab">
        {#each results.slice(0, MAX_SHOWN) as e (e.id)}
          <div class="row">
            <div class="col">
              <span class="da" lang="da"
                >{e.danish}{#if e.audio}
                  <SpeakButton text={e.danish} audio={e.audio} showLabel={false} />{/if}</span
              >
              {#if e.exampleDa}<span class="ex" lang="da">{e.exampleDa}</span>{/if}
            </div>
            <div class="col">
              <span class="sv">{e.swedish}</span>
              {#if e.exampleSv}<span class="ex">{e.exampleSv}</span>{/if}
            </div>
            <span class="note">
              {#if e.tags.includes('falsk-ven')}<span class="warn" title="Falsk vän">⚠ </span>{/if}{e.note ??
                ''}
            </span>
          </div>
        {/each}
      </div>
    {/if}
  {/if}
</div>

<style>
  .search {
    margin: 0;
  }
  .vh {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
    white-space: nowrap;
  }
  input {
    width: 100%;
    box-sizing: border-box;
    margin-top: 36px;
    font: inherit;
    font-size: 17px;
    padding: 14px 2px;
    border: none;
    border-bottom: 1px solid var(--bd3);
    border-radius: 0;
    background: transparent;
    color: var(--ink);
    outline: none;
    transition: border-color 120ms ease;
  }
  input:focus {
    border-bottom-color: var(--ink);
  }
  input::placeholder {
    color: var(--mut3);
  }
  /* Hide the native search "clear" affordance — keeps the hairline clean. */
  input[type='search']::-webkit-search-decoration,
  input[type='search']::-webkit-search-cancel-button {
    -webkit-appearance: none;
  }
  .status {
    color: var(--mut3);
    font-size: 13px;
    margin: 16px 2px 0;
  }
  /* Results in the normal wordlist row look (mirrors VocabTable). */
  .vocab {
    display: flex;
    flex-direction: column;
    margin-top: 10px;
  }
  .row {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
    gap: 16px 24px;
    padding: 16px 2px;
    border-bottom: 1px solid var(--bd2);
  }
  .col {
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 0;
  }
  .da {
    font-size: 15.5px;
    font-weight: 600;
    color: var(--ink);
    width: fit-content;
  }
  .sv {
    font-size: 15px;
    color: var(--ink);
  }
  .ex {
    font-size: 13px;
    line-height: 1.5;
    color: var(--mut2);
  }
  /* Match VocabTable's glossary house style: lowercase-first head word and
     translation; example sentences and notes keep normal sentence case. */
  .da::first-letter,
  .sv::first-letter {
    text-transform: lowercase;
  }
  .note {
    font-size: 13px;
    line-height: 1.55;
    color: var(--mut2);
    min-width: 0;
  }
  .warn {
    color: var(--red);
  }
  /* The search box is an on-screen tool, not part of the printable cheat sheet. */
  @media print {
    .search {
      display: none;
    }
  }
</style>

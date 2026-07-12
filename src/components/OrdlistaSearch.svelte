<script lang="ts">
  // Wordlist search: client-side substring search over the FULL vocabulary
  // (starter ∪ praksis) on danish + swedish. The starter entries arrive slim as
  // island props; the praksis deck is fetched lazily (shared praksis-client
  // cache) on first focus of the field, so plain browsing never downloads it.
  import SpeakButton from './SpeakButton.svelte';
  import { fetchPraksis } from '../lib/praksis-client.ts';
  import { themeKey, themeLabel, praksisThemeOf, praksisThemeLabel } from '../lib/deck-groups.ts';
  import { UI } from '../lib/strings.ts';

  const T = UI.wordlist;
  const MAX_SHOWN = 50;

  interface Entry {
    id: string;
    danish: string;
    swedish: string;
    deck: string;
    audio?: string;
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
        // Slim to the searched/rendered fields (the JSON is already
        // de-duplicated against the starter deck at build).
        praksis = cards.map((c) => ({
          id: c.id,
          danish: c.danish,
          swedish: c.swedish,
          deck: c.deck,
          ...(c.audio ? { audio: c.audio } : {}),
        }));
        loadState = 'ready';
      })
      .catch(() => {
        loadState = 'failed';
      });
  }

  // Lowercase + NFC only — æ/ø/å stay significant, same policy as answer
  // matching (a search for "läse" should not match "læse" by accident, but a
  // substring of either field is enough to find a word).
  const norm = (s: string) => s.normalize('NFC').toLowerCase();

  const results = $derived.by(() => {
    const query = norm(q.trim());
    if (!query) return null;
    return [...starter, ...praksis].filter(
      (e) => norm(e.danish).includes(query) || norm(e.swedish).includes(query),
    );
  });

  /** Where a match comes from: the starter theme, or 'Praksis · <super-theme>'. */
  const origin = (deck: string): string =>
    deck.startsWith('praksis-')
      ? `Praksis · ${praksisThemeLabel(praksisThemeOf(deck))}`
      : themeLabel(themeKey(deck));
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
      <ul class="results">
        {#each results.slice(0, MAX_SHOWN) as e (e.id)}
          <li>
            <span class="da" lang="da">{e.danish}</span>
            <span class="sv">{e.swedish}</span>
            <span class="origin">{origin(e.deck)}</span>
            {#if e.audio}<SpeakButton text={e.danish} audio={e.audio} />{/if}
          </li>
        {/each}
      </ul>
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
  .results {
    list-style: none;
    margin: 10px 0 0;
    padding: 0;
    display: flex;
    flex-direction: column;
  }
  .results li {
    display: flex;
    align-items: baseline;
    gap: 24px;
    flex-wrap: wrap;
    padding: 16px 2px;
    border-bottom: 1px solid var(--bd2);
  }
  .da {
    font-size: 15.5px;
    font-weight: 600;
    color: var(--ink);
  }
  .sv {
    font-size: 15px;
    color: var(--ink);
  }
  .origin {
    margin-left: auto;
    color: var(--mut3);
    font-family: var(--font-mono);
    font-size: 11px;
    letter-spacing: 0.1em;
    text-transform: uppercase;
  }
  /* The search box is an on-screen tool, not part of the printable cheat sheet. */
  @media print {
    .search {
      display: none;
    }
  }
</style>

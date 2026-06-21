<script lang="ts">
  // Embedded in FlashcardReviewer so it shares the SAME Store instance — a
  // separate island would hold a stale cached SRS root and the reviewer wouldn't
  // see saved changes until reload. `onSaved` lets the reviewer restart the round
  // so new caps/retention apply immediately.
  import type { Store } from '../lib/storage.ts';
  import { UI } from '../lib/strings.ts';

  let { store, onSaved }: { store: Store; onSaved: () => void } = $props();
  const T = UI.settings;

  const s = store.getSettings();
  let newPerDay = $state(s.newPerDay);
  let reviewPerDay = $state(s.reviewPerDay);
  let retentionPct = $state(Math.round(s.requestRetention * 100));
  let saved = $state(false);

  const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

  function save() {
    store.setSettings({
      newPerDay: clamp(Math.round(newPerDay), 0, 100),
      reviewPerDay: clamp(Math.round(reviewPerDay), 1, 1000),
      requestRetention: clamp(retentionPct, 70, 97) / 100,
    });
    saved = true;
    onSaved();
  }
</script>

<details class="settings">
  <summary>{T.summary}</summary>
  <div class="grid">
    <label>{T.newPerDay}
      <input type="number" min="0" max="100" bind:value={newPerDay} oninput={() => (saved = false)} />
    </label>
    <label>{T.reviewPerDay}
      <input type="number" min="1" max="1000" bind:value={reviewPerDay} oninput={() => (saved = false)} />
    </label>
    <label>{T.retention}
      <input type="number" min="70" max="97" bind:value={retentionPct} oninput={() => (saved = false)} />
      <span class="hint">{T.retentionHint}</span>
    </label>
  </div>
  <button type="button" onclick={save}>{T.save}</button>
  {#if saved}<span class="ok" role="status">{T.saved}</span>{/if}
</details>

<style>
  .settings { margin-top: var(--sp-6); color: var(--muted); font-size: var(--step--1); }
  .settings summary { cursor: pointer; }
  .grid { display: grid; gap: var(--sp-3); margin: var(--sp-3) 0; max-width: 28rem; }
  .grid label { display: grid; gap: var(--sp-1); color: var(--text); }
  .grid input { font: inherit; padding: var(--sp-1) var(--sp-2); border-radius: var(--radius); border: 1px solid var(--border); background: var(--surface); color: var(--text); max-width: 8rem; }
  .hint { color: var(--muted); }
  .ok { color: var(--correct); margin-left: var(--sp-3); }
</style>

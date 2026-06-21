<script lang="ts">
  // Embedded in FlashcardReviewer so it shares the SAME Store instance — a
  // separate island would hold a stale cached SRS root and the reviewer wouldn't
  // see saved changes until reload. `onSaved` lets the reviewer restart the round
  // so new caps/retention apply immediately.
  import { DIRECTIONS, type Store, type Direction } from '../lib/storage.ts';
  import { UI } from '../lib/strings.ts';

  let { store, onSaved }: { store: Store; onSaved: () => void } = $props();
  const T = UI.settings;
  const F = UI.flashcards;
  const MODE_LABEL: Record<Direction, string> = {
    produce: F.write,
    recognize: F.recognize,
    listen: F.listen,
    'listen-sentence': F.listenSentence,
    speak: F.speak,
    cloze: F.cloze,
  };

  const s = store.getSettings();
  let newPerDay = $state(s.newPerDay);
  let reviewPerDay = $state(s.reviewPerDay);
  let retentionPct = $state(Math.round(s.requestRetention * 100));
  let defaultMode = $state<Direction>((s.directions?.[0] as Direction) ?? 'produce');
  let saved = $state(false);

  const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
  // A cleared/invalid number input binds as NaN; fall back to the current value
  // instead of persisting NaN (which serializes to null and empties sessions).
  const num = (v: number, fallback: number) => (Number.isFinite(v) ? v : fallback);

  function save() {
    const cur = store.getSettings();
    store.setSettings({
      newPerDay: clamp(Math.round(num(newPerDay, cur.newPerDay)), 0, 100),
      reviewPerDay: clamp(Math.round(num(reviewPerDay, cur.reviewPerDay)), 1, 1000),
      requestRetention: clamp(num(retentionPct, cur.requestRetention * 100), 70, 97) / 100,
      directions: [defaultMode],
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
    <label>{T.defaultMode}
      <select bind:value={defaultMode} onchange={() => (saved = false)}>
        {#each DIRECTIONS as d}<option value={d}>{MODE_LABEL[d]}</option>{/each}
      </select>
      <span class="hint">{T.defaultModeHint}</span>
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
  .grid select { font: inherit; padding: var(--sp-1) var(--sp-2); border-radius: var(--radius); border: 1px solid var(--border); background: var(--surface); color: var(--text); max-width: 14rem; }
  .hint { color: var(--muted); }
  .ok { color: var(--correct); margin-left: var(--sp-3); }
</style>

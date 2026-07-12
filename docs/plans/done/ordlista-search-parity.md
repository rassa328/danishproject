---
title: Ordlista search — render results identical to the normal word list
owner: claude (bg job cd71c729, ultracode)
branch: ordlista-search-parity
status: done
write_set:
  - src/lib/word-audio.ts
  - src/components/WordAudio.svelte
  - src/components/OrdlistaSearch.svelte
verify: npm run build && npx svelte-check ; manual — search a word on /ordlista
opened: 2026-07-12
---

## Context

On `/ordlista`, the search box rendered its matches through a **separate,
re-implemented row layout** (`OrdlistaSearch.svelte`) that had drifted from the
normal list (`VocabTable.astro`). Reported symptoms:

- Search rows added a **speaker/play icon** per row (`<SpeakButton …>`) — the
  normal list has none.
- In search, **clicking the word did nothing**; you had to click the icon. In
  normal mode you click the word itself. (Cause: normal-mode words are made
  click-to-hear at runtime by the `WordAudio` island scanning `[data-audio]`
  **once on mount**; the search island renders its rows later/reactively, so they
  were never enhanced.)
- Search rows **looked different** and appeared to be **missing descriptions**.

Desired outcome: search is *just a filter* — matches render in the **exact same
format as the non-search list**, the **word is clicked to play** (no icon), and
missing fields (note/example) simply render **empty** with the layout unchanged.

Scope (confirmed with user): **keep searching the full corpus** (starter ∪
praksis, ~5000 words). The 225 curated grundord are 100% fleshed out (note + Da/Sv
examples + audio); the ~4850 praksis words carry audio + translation 100%, but
examples only ~8% and notes ~0.7%. That's fine — praksis rows show what data
exists and leave the rest empty; the grid layout stays put. No corpus/search-logic
change, no data fabrication.

## What was implemented

The search island can't reuse `VocabTable.astro` (Astro/server-only) and can't be
reached by `WordAudio`'s one-time DOM scan. So the per-element click-to-hear
enhancement was extracted into a shared module and exposed two ways.

### 1. New: `src/lib/word-audio.ts`
Shared click-to-hear logic lifted out of `WordAudio.svelte`, with a **module-scoped
`playing`** so the static table and the search island coordinate a single
`.is-playing` highlight:
- `setTtsHint(el, show)` — muted "talsyntes" sibling on TTS fallback (unchanged).
- `enhanceAudio(el, text, audio): () => void` — adds `da-clickable` + role/tabindex/
  aria-label, wires `click` + Enter/Space → `speak(text, { audioUrl: withBase(audio) })`
  with the 700 ms flash; returns a teardown.
- `audioClick(node, params?)` — Svelte action wrapping `enhanceAudio`; `params`
  `undefined` (no clip) makes the action **no-op**, leaving plain non-interactive
  text, exactly like normal mode omitting `data-audio`.

### 2. `src/components/WordAudio.svelte`
`onMount` now delegates to `enhanceAudio` (behavior unchanged for the normal list).

### 3. `src/components/OrdlistaSearch.svelte`
Dropped the `SpeakButton` import/usage; the results block now mirrors `VocabTable`
exactly and uses `use:audioClick` on the Danish headword and Danish example.
`foldNordic`, `fetchPraksis`, `results`, and the `#ordlista-sections` hide
`$effect` are untouched. The affordance CSS is the existing `:global(.da-clickable)`
in `ordlista.astro` (already reaches island nodes — no CSS change). `SpeakButton`
stays in the repo (used by `FlashcardReviewer`, etc.).

## Verification
- `npm run build` — passes; `/ordlista` builds.
- `npx svelte-check` — the three changed files are clean (0 new errors; pre-existing
  `exactOptionalPropertyTypes` errors in unrelated files unchanged).
- `npm test` — 298/298 pass; content check passes.
- Bundle wiring — `OrdlistaSearch` imports the shared `word-audio` chunk, no longer
  references `SpeakButton`/`Waveform`, and shares the chunk with `WordAudio`.
- Manual (recommended): `npm run dev` → `/ordlista` → search a starter word (note +
  examples, click word plays, no icon) and a praksis word (word + translation +
  clickable audio, empty note/example, same grid).

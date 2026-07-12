---
title: Redesign corrections round 4 — verification report
owner: rasmussamuelson
branch: redesign-port
status: done
opened: 2026-07-12
---

# Redesign corrections round 4 — goal & result (for independent verification)

This report is written so a second agent can re-verify the work end to end without
re-reading the conversation. It states the goal, every change, and how to reproduce
the verification. Scope was **presentation/copy only** — no data, SRS, audio-id, or
keyboard-flow behavior was changed.

Branch `redesign-port`, delivered on top of the merged redesign (PR #3) and the first
correction round (PR #4). Worktree:
`/Users/rasmussamuelson/claude/.claude/worktrees/redesign-port`.

## Goal (verbatim intent from the reviewer)
1. **Stød page**: generate a sound wave for *every* displayed word (was ~2 shapes total).
2. **Snabbkoll drill**: remove the "rätt!" text — green/red visual confirmation is enough.
3. **Flashcards**:
   - Move æ/ø/å directly under the writing line; drop the "saknar æ ø å … klicka för att infoga" helper.
   - Replace the text answer feedback with wordless indicators (green hairline on correct;
     struck-through attempt on wrong; nothing on an empty miss). Exact spec followed (see §Flashcards).
   - "Visa svar (Enter)" → "visa svar" + a darker "enter" (all reveal buttons, lowercase);
     "Lyssna (mening)" reveal → "visa meningen enter".
   - Listen + Listen (mening): a larger pure-gray voice graph (longer for the sentence) with a
     small subtle "0.75x" below it. Remove the "lyssna och skriv ordet"/"lyssna på meningen" captions.
   - Cloze: the Swedish example becomes a clickable hint that fades up.
   - Move Inställningar/Säkerhetskopiera out of the UI — *already done in the previous round; unchanged here.*
4. **Ordlista**: while searching, hide the themed sets and show only the results in the normal
   list look; fold Swedish↔Danish letters so a Swedish spelling finds the Danish word and vice
   versa; no träna button in search (already the case).
5. **Zen**: remove the box on hover — only a red line + highlighted white text; shape the category
   grid cells as elongated flat-top hexagons.

## What changed (by file)
- `src/components/MinimalPairs.svelte` — replaced the two shared bar arrays with a deterministic
  per-word generator `barsFor(word, withDip)` (FNV-1a hash → mulberry32 PRNG → 5–6 bars). Med-stød
  words keep exactly one red `dip` bar; utan-stød none. Pure/deterministic (SSR-stable).
- `src/components/MinimalPairDrill.svelte` — removed the `<p class="verdict">…"✓ Rätt!"/"✗ …"` line;
  kept the green outline on the correct choice and **added** a red outline on the user's wrong pick
  (`is-wrong`); the verdict text is retained visually-hidden (`role="status"`) for screen readers.
- `src/components/FlashcardReviewer.svelte` + `src/lib/strings.ts`:
  - æ/ø/å `.charbar` moved inside the `<form>`, directly under `<input>`, above the reveal button;
    `charHelper` no longer rendered.
  - Reveal labels lowercased with a `<span class="key">enter</span>` (mono, 10px, `--mut4`):
    `reveal`→"visa svar", `speakReveal`→"hör uttalet", `listenSentenceReveal`→"visa meningen".
  - Removed the listen prompt captions.
  - Larger pure-gray voice graph (hand-rolled `.voice-bar` spans, `var(--bars)`): `VOICE_BARS`
    (7 bars) for the word, `VOICE_BARS_LONG` (13) for the sentence; pulse via `{#key promptPulse}`.
  - "0.75x" control (`slowSpeed`) shown below the graph in **both** listen modes and both the
    `blocked` and playable states; `title` keeps "Långsammare (0,75×)".
  - Wordless feedback: `.ok-line` green hairline (`hairlineIn` keyframe) + `.answer.correct` rise-in
    (`answerRise`) on correct; `.attempt` struck-through typed/chosen value on wrong; nothing on an
    empty miss. Verdict word kept SR-only (`correct`→"Rätt", `incorrect`→"Fel").
  - Cloze: Swedish example hidden behind a `.hint-toggle` ("ledtråd"); click sets `hintOpen` and the
    sentence fades up (`hintFadeUp`). Reset per card via `$effect` on `idx`.
- `src/components/OrdlistaSearch.svelte` + `src/pages/ordlista.astro` + `src/lib/char-map.ts`:
  - `foldNordic()` (NFC+lowercase then ä→æ, ö→ø) applied to query and both fields → bidirectional
    letter matching ("smör" ↔ "smør").
  - `$effect` toggles `#ordlista-sections` (themed sets + list-note) hidden while a query is active.
  - Results render in the normal wordlist row look (VocabTable markup/CSS); enriched props carry
    example/note/tags; origin badge dropped; audio via SpeakButton glyph.
- `src/components/Zen.svelte`:
  - Focus-box fix: the reset selectors got a `.zen ` prefix so they out-specify
    `.zen button:focus-visible` — options/cats/deck cells now show only the red line + ink text, no box.
  - Category cells: elongated flat-top hexagon via `clip-path` on `::before` (ring color) + `::after`
    (`var(--bg)` cutout) so text is never clipped; faint ring at rest, red ring + ink text on hover/hot.
  - `zen.ts` and `zen.test.ts` unchanged (island-only concern).

## Gates (all green)
- `npm test` → **298 passed** (incl. `zen.test.ts` 26 behavior-lock tests); content check passes.
- `npx astro check` → **0 errors** (1 pre-existing `elapsed_days` hint).
- `npx svelte-check` → **9 errors / 20 warnings** — the known pre-existing baseline; **no new** ones.
- `npm run build` → exit 0, 23 pages.

## Visual verification (headless Chrome, dark+light+375px)
Reusable helper: `$CLAUDE_JOB_DIR/tmp/shot.mjs` (CDP screenshot + keystroke driver);
`fc-green.mjs` and `drill.mjs` capture reveal states that depend on a correct/wrong outcome.
Confirmed:
- **Stød lesson**: every word shows a distinct wave; med-stød keeps the red dip; no dotted underline;
  notes inline; no CTA.
- **Snabbkoll**: change verified by code (verdict `<p>` removed; `is-wrong` red outline + SR-only
  status added) + `svelte-check`. Note: the drill can't be rendered in headless Chrome because its
  clip **probe** (`new Audio()` metadata) fails there, so its pairs filter out — a headless-audio
  limitation, not a regression (the sibling MinimalPairs island, which doesn't probe, renders fine;
  the drill renders in a real browser). Re-verify the answered state (green on the correct choice,
  red on a wrong pick, no "rätt!" text) manually in a real browser.
- **Flashcards** (each mode): æ/ø/å under the input, no helper; reveal buttons read
  "visa svar/hör uttalet/visa meningen" + darker "enter"; correct → green hairline + rise-in;
  wrong → struck-through attempt; listen graph larger/gray (longer for the sentence) with "0.75x"
  below; no listen prompt captions; cloze shows a "ledtråd" that fades up.
- **Ordlista**: searching "sö" → 47 matches folded across ä/ö↔æ/ø (e.g. *söskende, sød, försöker*);
  themed sections hidden; results in the normal row look.
- **Zen**: category grid = elongated flat-top hexagons; hover/select = red line + white text, no box
  (dark, light, 375px); arrow-nav, click-to-select, fler/färre, and the full flow still work.

## How to re-verify independently
1. `npm ci` (if needed), then run the four gates above; all must pass with the stated numbers.
2. `git diff main...redesign-port -- src/` — confirm the changes are confined to the files listed and
   are presentation-only (no changes to `session.ts`, `srs`/scheduling, `audio-id.ts`, `zen.ts`).
3. `npm run dev`, then walk each screen (or drive with the helper scripts under the job tmp dir):
   `/lektioner/01-stoed`, `/flashcards` (each mode tab), `/ordlista` (search "sö"), `/zen`
   (Enter → category grid). Check the bullet list above in both themes and at ~375px.

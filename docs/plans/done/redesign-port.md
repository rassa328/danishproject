---
title: Port the design-handoff redesign into the Astro app
owner: rasmussamuelson
branch: redesign-port
status: done
write_set:
  - src/
  - public/favicon.svg
verify: npm test && npm run build
opened: 2026-07-12
---

# Port redesign into Astro app (2026-07-12 10:30)

Recreate the visual redesign in `design_handoff_danish_site_redesign/` (untracked in the
main checkout; read via absolute path) inside the existing Astro + Svelte codebase.
**Presentation-layer rewrite** — preserve ALL behavior/data. Handoff is the source of
truth for presentation; the app is the source of truth for functionality.

The `.dc.html` inline styles are the exact source of truth (screenshots orient). Where the
README disagrees with the `.dc.html`, the HTML wins (e.g. Zen card word is "morsomt", not
the README's "ristet").

## Ground truth already confirmed from source
- Tokens: full dark (default on `html`) + light (`html[data-theme="light"]`) tables, from
  the front-page `.dc.html` `<head>`. Card shadow `0 1px 2px var(--sh1), 0 16px 40px var(--sh2)`.
- Theme: FOUC-safe inline head script sets `document.documentElement.dataset.theme =
  localStorage.getItem('dfs-theme') || 'dark'`; `◐` button `data-theme-toggle` flips + persists;
  `body { transition: background-color 250ms ease }`. Replaces today's `prefers-color-scheme`.
- Fonts: Newsreader (Google) `ital,opsz,wght@0,6..72,400;0,6..72,500;0,6..72,600;1,6..72,400;1,6..72,500`
  + preconnect; system-ui sans; ui-monospace meta.
- favicon.svg → handoff mark (rounded red #c8102e square, white #faf9f5 Dannebrog cross, hoist-offset).
- `src/data/hero-waveform.json` already matches the reference hun/hund envelopes + dip [6,2].
- Audio: keep cyrb53 → `da-<hex14>` → `/audio/<id>.mp3` pipeline unchanged.

## Phases
0. **Setup** — DONE. Fresh worktree off `main`; baseline `npm test` green (298).
1. **Foundation** — rewrite `global.css` tokens; theme system (head script + nav toggle);
   Newsreader; `BaseLayout` (nav/footer/head/favicon/ghost); restyle `Nav.astro`; swap
   favicon; remove "Tal" from nav; ghost-letters shared. `FocusLayout` bg to dark-default.
2. **Front page** (`index.astro`) — hero + ghost + 3 cards (Zen demo, Flashcards w/ SR
   timeline, Stød w/ playable hun/hund waveform via real audio pipeline). Drop old
   ProgressSummary/DailyMission/InputLog widgets (not in redesign); data pipelines stay.
3. **Zen** (`Zen.svelte` + `zen.astro`) — restyle every screen (mode/deck/begynd/play/
   feedback/paus), preserve the full keyboard flow + state machine exactly.
4. **Flashcards** (`FlashcardReviewer.svelte` + `CelebrationFlag.svelte`) — deck pill +
   popover, mode pills, all 6 modes, reveal + grade pills (1–4, Igen requeue), Dannebrog
   completion. Preserve SRS + storage.
5. **Lektioner** (`lektioner/index.astro`) + **lesson template** (`LessonLayout.astro` +
   `[...id].astro` + `MinimalPairDrill`) — remove B1/B2 chips; minimal-pair audio table.
6. **Ordlista** (`OrdlistaSearch.svelte` + `ordlista.astro`) — search + playable rows.
7. **Polish** — 375px mobile + both themes on every route; verify audio/keyboard/flashcard/
   zen/glossary/persistence/nav; review diff for regressions/dead code; fix all.

## Non-goals / constraints
- Do not ship `.dc.html`, screenshots, or `support.js`.
- Do not delete the `/tal` route (only remove it from nav).
- Keep SettingsPanel/backup if wired; if dead code, leave untouched (out of scope).
- Verify each phase: `npm test`, `npm run build`, and drive the app.

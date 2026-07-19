---
title: Mobile port — full-site touch/viewport audit + fixes
owner: claude-main
branch: flashcards-lyssna-mening-hide-word
status: done
write_set:
  - src/components/Nav.astro
  - src/components/StodCard.svelte
  - src/components/MinimalPairs.svelte
  - src/components/FlashcardReviewer.svelte
  - src/components/FlashcardSettings.svelte
  - src/components/FlashcardEmptyState.svelte
  - src/components/OrdlistaSearch.svelte
  - src/components/DrillEngine.svelte
  - src/components/Zen.svelte
  - src/layouts/BaseLayout.astro
  - src/layouts/LessonLayout.astro
  - src/pages/ordlista.astro
  - src/lib/strings.ts
verify: npm test && npx svelte-check && npm run build (plus live Playwright passes, see Method)
opened: 2026-07-19
---

# Mobile port audit — 2026-07-19 20:20

Task: "make sure the website is fully ported to mobile — current functionality
working on the phone." Method: 8 parallel audit agents (6 driving every page
live in Playwright-chromium with the iPhone 13 descriptor — 390×844, touch,
`pointer: coarse`/`hover: none` — plus a 320×660 narrow pass; 2 static code
auditors for mobile-hostile CSS/JS), every finding adversarially re-verified by
an independent live reproduction before being accepted. 41 findings confirmed,
3 refuted. All 41 fixed, then every fix re-verified live; round 2 caught 5
defects in the fixes themselves (below), repaired and verified green.

Gates at completion: 909/909 vitest, production build clean, svelte-check at
the 9 pre-existing errors (none added). **Changes are uncommitted working-tree
edits on `flashcards-lyssna-mening-hide-word`**, alongside that session's own
uncommitted flashcards work (preserved untouched).

## What was broken / fixed (by theme)

- **Functional (everywhere, not just mobile):** MinimalPairDrill in lesson 01
  never rendered — it SSRs zero children while probing clips, and a zero-child
  `client:visible` island is never observed by Astro's IntersectionObserver,
  so it never hydrates. → `client:idle` (`LessonLayout.astro`).
- **Tap targets** (13–26 px → ~40–44 px, visuals unchanged): nav links + theme
  toggle (`Nav.astro`), StodCard "Till lektionen", `.mp-word` audio buttons,
  ordlista head words + "Träna →", flashcards æ/ø/å chars / 0.75× slow /
  cloze hint-toggle, settings steppers/toggles/×/chips (`::before inset:-9px`),
  empty-state "öva fritt", zen category cells / ← / ◐ / footer back, tal
  "Vidare" (54×44 — meets the 44 px floor, short of stretch width).
- **Layout:** lesson tables scroll in their own box ≤480 px (page no longer
  pans); grade pills 2×2 grid ≤420 px; nav gap floor 12 px so the toggle
  doesn't wrap alone at 320; footer separator dots hidden when stacked; zen
  start stage scrolls (expanded 42-cell cloud was clipped, footer now in the
  scroll flow below content).
- **Touch semantics:** ordlista example sentences keep the dotted playable
  underline on `hover: none` (was hover-only = invisible); search results
  gained the missing example-sentence SpeakButton; keyboard-hint copy
  (enter/esc/1–4) hidden or swapped for touch variants (`*Touch` strings in
  strings.ts); zen input gets `skriv här` placeholder + faint wash (iOS won't
  raise the keyboard from programmatic focus); outside taps no longer re-raise
  the zen keyboard; `.zen` height tracks `visualViewport` so the keyboard
  can't cover the answer UI; DrillEngine miss-panel no longer silently
  discards typed text on submit.

## Traps discovered (round-2 verification caught these in the fixes)

1. **`.zen button` reset out-specifies bare class rules** (`0,2,1` vs
   `0,2,0`): `.top-back { padding: … }` was dead CSS. Always `.zen`-prefix
   (the `.zen .cat` pattern). This had also silently killed the pre-existing
   `.touch-btn` padding.
2. **`:active { transform: scale() }` cancels expanded hit areas mid-tap**:
   the click hit-test runs on the scaled-down geometry, so edge taps retarget
   to the parent and no-op. On `pointer: coarse` use an opacity press cue.
3. **Hit-area expansions must stay under half the sibling gap** or later-DOM
   siblings capture the taps (settings chips crossed rows; zen cat rows) —
   fixed with coarse-only row-gap bumps.
4. `::before` `inset` resolves against the **padding box** — with a 1 px
   border, `-8px` reaches only 7 px past the visual edge; use `-9px`.
5. An absolute footer inside a newly scrollable container paints mid-content
   and steals taps — put it in the scroll flow instead.

## Open / future work

- [ ] **Real-device pass.** Everything verified in Playwright-chromium iPhone
  emulation (faithful for layout, `pointer: coarse`, touch events) — not real
  iOS Safari. Worth 5 minutes on an actual phone: zen keyboard behavior
  (visualViewport), audio autoplay-block recovery, rubber-band scrolling.
- [ ] **Zen mode/direction steps: one-tap vs two-tap is platform-dependent.**
  The pointerdown was-hot guard (`noteDeckPointerDown`) exists only on
  source-step buttons; on Chromium/Android, focus precedes click, so a single
  tap on a non-hot mode/direction option commits immediately (iOS Safari
  doesn't focus on tap → two taps). Touch hint is therefore scoped to the
  source step. Proper fix: extend the guard to mode/direction buttons for
  consistent two-tap everywhere (or decide one-tap is fine and drop the gate).
- [ ] **Zen expanded cloud shows duplicate labels** (pre-existing): "verb",
  "kropp & hälsa", "falska vänner", "övrigt" each appear twice (theme set vs
  POS/other set) with no distinguishing note.
- [ ] **svelte-check baseline (9 pre-existing errors):** all
  `exactOptionalPropertyTypes` mismatches passing `audio: string | undefined`
  to SpeakButton's `audio?: string` (6× DrillEngine, 2× FlashcardReviewer,
  1× LessonAudio). Mechanical fix: widen the prop to `string | undefined`.
- [ ] Optional polish: widen tal "Vidare" beyond 54 px (`--sp-3/4`
  padding-inline); `touch-action: manipulation` on rapid-tap game controls
  (refuted as harmless today — chromium no longer double-tap-zooms — but
  cheap hardening if iOS shows tap delay).

Refuted findings (verified non-issues, don't re-fix): `min-height: 100vh` in
the layout shells (no observable symptom — natural content height governs);
0 px gap between search-result word and speak button (desktop-identical,
by design).

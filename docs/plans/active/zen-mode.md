---
title: Zen mode
owner: claude (bg job cd71c729, ultracode)
branch: worktree-zen-mode
status: active
write_set:
  - src/pages/zen.astro
  - src/components/Zen.svelte
  - src/layouts/FocusLayout.astro
  - src/lib/zen.ts
  - src/lib/zen.test.ts
  - src/lib/strings.ts
  - src/lib/drill-modes.ts
  - src/components/Nav.astro
verify: npm test && npx astro check && npm run build
opened: 2026-07-11 19:56
---

# Zen mode — the Fokus design, generalized beyond numbers

User (2026-07-11): "the design for the zen mode is excellent so ultracode it
in but its not only for numbers remember - dont discard the old zen mode (we
can utilize some for this)". Zen is a general practice presentation
(cross-activity), /tal is *slated* for removal later but NOT in this change.

Design sources (project 881c9867-6a03-4c81-9619-8af468cab0f3):
- `Tal Fokus v2.dc.html` — the chosen interaction model: dark palette,
  stepped start flow (arrows/enter/esc), run (glow-dot listen / big-type
  translate → underline input → reveal + auto-advance), pause, done.
- `Tal Fokus - Morgendis v2.dc.html` — the "old zen mode" to utilize: its
  light warm-paper palette becomes the light theme (site is light-by-default,
  dark via prefers-color-scheme), its Dannebrog-red glow + 4s breathe for
  light mode, and its restore-prefs-on-mount behavior.

## New page /zen (chrome-less FocusLayout), island `Zen.svelte`

Start flow (one step at a time, Fokus v2 model, Esc backs up):
1. **övar** — `ord` / `tal`  ← the "not only numbers" generalization
2. **läge** — `lyssna` / `översätt` (subs adapt per subject)
3. **visas på** — `danska` / `svenska` (översätt only)
4. **source** — tal: the 4 number levels (lyssna gated on FULL clip coverage,
   disabled + "saknar inspelningar"); ord: `repetera` (due, SRS-graded,
   disabled + "inget förfallet" when due=0) / `blandat` (free mix, ungraded —
   matches flashcards' "Öva fritt" semantics)
5. **Begynd** + summary line. Prefs in `zen.prefs.v1`, restored on mount.

Run/pause/done exactly as the design: 170px prompt/reveal cross-fade stage,
Enter grades → reveal (Danish reading big + sub) → advance after 500ms+holdMs,
blank Enter replays in lyssna, r replays, Esc pauses, "N ord/tal. Vi ses i
morgon."

## Content adapters (pure lib `zen.ts`, tested)

- **tal**: NUMBER_LEVELS gens → {value, tokens, kind}; grading digits
  (normalizeDigits/Number) or Danish reading (fold ä/ö, spacing-free, year and
  bare-cardinal price alternates); prompt 'år 1994' / '42 kronor'; audio via
  number-audio player (composed real clips, never TTS); reveal silent (design).
- **ord**: delegate to DRILL_MODES — lyssna=da-dictation (clip-backed cards
  only), översätt+danska=da-sv, översätt+svenska=sv-da; items/grading/audio
  verbatim from the registry. repetera = match {kind:'all'} due-only;
  blandat = buildQueue free:true (needs a 3-line `free` passthrough in
  drill-modes DrillBuildDeps — only drill-modes.ts change). SRS writes
  (recordOutcome, 'correct'/'wrong') for repetera only. Reveal: big = the
  Danish form (lang=da), sub = the other side (gloss) + "du skrev …" on miss;
  the word's real clip plays on reveal (the app's core promise — deviation
  from the silent-number design, deliberate).
- praksis deck prefetched when 'ord' is picked (praksis-client, cached);
  begin() awaits it, degrades silently to starter-only on failure.

## Other

- Nav gains Zen (strings UI.nav.zen); /tal and /skriv untouched.
- Theme: Fokus v2 palette under prefers-color-scheme: dark, Morgendis v2
  under light; FocusLayout body bg matches both (no flash).
- a11y deviations from the .dc files (deliberate): options are real buttons
  with :focus-visible, reveal is aria-live, riseIn/breathe gated behind
  prefers-reduced-motion, input aria-labels per answer language.
- After implementation: multi-lens adversarial review via Workflow
  (correctness/design-fidelity/a11y/conventions/invariants), fix confirmed
  findings, then npm test + astro check + build; draft PR.

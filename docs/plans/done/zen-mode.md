---
title: Zen mode
owner: claude (bg job cd71c729, ultracode)
branch: worktree-zen-mode
status: done
write_set:
  - src/pages/zen.astro
  - src/components/Zen.svelte
  - src/layouts/FocusLayout.astro
  - src/lib/zen.ts
  - src/lib/zen.test.ts
  - src/lib/strings.ts
  - src/lib/drill-modes.ts
  - src/lib/speech.ts
  - src/components/Nav.astro
verify: npm test && npx astro check && npm run build
opened: 2026-07-11
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

## Close-out (2026-07-11 21:05)

Shipped on branch worktree-zen-mode:
- 336283a plan · 8cc4905 implementation · 3d5868b + follow-up: fixes for the
  adversarial reviews.
- Review round 1 (6 lenses, 45 agents): 38 confirmed findings → all fixed or
  explicitly dispositioned. Round 2 (3 attack agents on the fixes, 17 agents):
  14 confirmed (7 distinct) → all fixed, incl. the pause()-mid-fade deadlock
  and the unbounded praksis await behind the closed fade gate.
- Verified: 273 vitest (22 zen), astro check clean, build green, preview
  smoke of /zen and /tal, plans:check green.

As-designed (matches the .dc files, left alone): reveal auto-hide pace
(holdMs prop covers it), 400ms quit fade, dueness recomputed per navigation.
Deliberate deviations (documented in the island's comments): real buttons +
focus-follows-highlight + aria-live (a11y), --z-dim/--z-sub lifted to ≥3:1 /
≥4.5:1 contrast, ord reveals play the word's real clip, coarse-pointer
svara/paus buttons, prefs restored on mount (Morgendis behavior).

Open, needs Rasmus:
- /tal removal (explicitly slated but a separate go).
- Manual browser pass (repo policy: DOM/WebAudio = manual pass) — especially
  iOS: numeric keypad, touch buttons, audio unlock.
- speech.ts gained stopSpeech() (added to write_set above).

## Integration with drill-zen (2026-07-11 21:20)

origin/main had concurrently shipped **drill-zen** (6c84291, owner
claude-main): the word drill reworked into the Zen tool at /zen with the
design-swap-ready split this design pass then slotted into. Merged main into
this branch; resolution:

- THEIRS wholesale: Nav (the ◎ icon entry — user decision), drill-modes
  (their registries subsume my `free` flag), DrillEngine, /skriv→/zen
  redirect, sentence-match + deck-groups + drill-engine fixes.
- MINE: /zen page + island (the design swap their plan round 3 anticipated),
  FocusLayout, zen lib/tests, speech.stopSpeech.
- Adopted THEIR user-decided semantics into MY design shell: ord-översätt is
  ONE mixed both-directions run (no visas-på step for ord; per-ITEM input/
  grading/SRS via SUB_CONFIGS), 'visas på' remains for tal only.
- nav zenLabel 'Zen — skrivövning' → 'Zen — övning' (zen now spans ord+tal).

NOT yet in the design shell (their zen had them; follow-ups for the next
design round): meningar (sentence subs), multi-select sets, endless Flöde,
count picker, stats/CelebrationFlag end screen. All their lib support is
merged and live — only the Fokus UI doesn't expose them yet.

## Round 3 — user feedback on the live site (2026-07-11 21:45)

"not possible to exit · no tal option in the start (part of översätt, choose
sv→da or da→sv) · sets from the flashcards alongside repetera/blandat ·
warmer, more yellow dot". Applied:

- Exit: 'lämna · esc' link on the first step (footer) → site start page; Esc
  on the first step does the same.
- Flow v2: läge (lyssna · översätt) → riktning (svenska→danska ·
  danska→svenska, översätt only) → källa (repetera · blandat · tal ·
  flashcard sets) → nivå (tal only) → Begynd. Mixed translate is gone from
  zen (kept in drill-modes as 'translate'); new single-direction sessions
  'translate-sv-da'/'translate-da-sv' added to DRILL_SESSIONS.
- Sets = the flashcards' study groups (due-all synthetic excluded), scheduled
  builds (due first + new under the daily budget), SRS-graded like repetera;
  blandat stays free/ungraded; tal ungraded (no number SRS in v1).
- Light-theme glow: Dannebrog red → warm amber #c99b3f (dark's gold stays).
- Prefs bumped to zen.prefs.v2 (mode/direction/source/level).

## Round 4 (2026-07-11 22:10)

"all tal 0–100, no stora tal, no level menus — tal covers all of them."
Level step removed entirely: källa 'tal' → Begynd. One pool 0–100 (ALL_TAL);
years/prices (stora tal) gone from zen. lyssna draws ONLY from values whose
every clip is committed (playableTal — 12 values today: 20,27,30,40,42,50,
60,68,70,80,90,99), widening automatically as recordings land; never TTS.
översätt uses the whole 0–100. NUMBER_LEVELS stays untouched (/tal page
still uses it). Prefs shed the level field (same v2 key; extra field
ignored). svelte-check is now part of the manual gate after the round-3
begin() escape (astro check does not type-check .svelte script blocks).

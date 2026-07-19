# TODO — things to fix

Backlog of user-reported issues, verbatim where possible. Not a plan —
whoever picks an item up registers a normal plan in `docs/plans/active/` first
(several items touch files inside the drill-engine plan's write_set; coordinate).

Recorded 2026-07-11 from a live review of the deployed site.

## Flashcards (reviewer)

- [ ] **Explain the four grade buttons in the UI** (decision changed
  2026-07-11: KEEP the 1–4 grades and shortcuts — user originally wanted them
  gone, then saw what they do and reversed). The grades matter: measured with
  the app's own scheduler at 0.9 retention, a mature card next comes due in
  minutes (Igen) / 32 d (Svårt) / 46 d (Bra) / 77 d (Lätt), and each grade
  also shifts the card's hidden difficulty. Nothing in the UI says any of
  this. Add a short always-visible note (or first-session hint) under the
  grade row, roughly: "Igen = fel, kortet kommer snart tillbaka · Svårt/Bra/
  Lätt = rätt, styr hur länge kortet vilar" — user picks final wording.
  Still wanted from the original complaint, refined 2026-07-11: **Enter in
  the revealed phase should advance WITHOUT grading** — "I just wanted to
  look at it." No SRS write; the card simply stays due and comes back next
  session. (Today Enter does nothing after reveal.) The existing `skipCard`
  (`FlashcardReviewer.svelte:215`) is the right semantics but is
  prompt-phase-only — needs a revealed-phase variant. Like skip, it must NOT
  set `celebrate` and should probably not count toward `reviewed`.
  Parked for the future plan-mode session (no need now): Enter is also the
  reveal key, so Enter-Enter walks the deck without ever grading — easy to
  accidentally skip a card you meant to grade. Maybe a tiny guard (ignore
  Enter ~300 ms after reveal), maybe over-engineering. Decide then.
  ⚠ 2026-07-11 15:43: drill-engine plan is DONE — the `strings.ts` write_set
  block is lifted; this item is unblocked.
- [x] **Typed answers: map Swedish letters to Danish.** DONE 2026-07-11
  (plan `done/swedish-letter-folding.md`): `ä`→`æ`, `ö`→`ø`, digraph `ae`→`æ`
  accepted at comparison time in `matchTyped`/`matchCloze` (typed side only,
  exact match tried first). Not included: `oe`→`ø` (not requested), live
  input-field transform (possible follow-up).
  ⚠ Still open (2026-07-11 15:43: char-map.ts now EXISTS — drill-engine done):
  `src/lib/char-map.ts` (input-side live remap) and `session.ts` `foldSwedish`
  (comparison-side) are two deliberate layers today; unify into one shared
  module eventually.
- [ ] **"Repetera förfallna" is a dead button when nothing is due.** On the
  "Inga kort att repetera just nu" screen the button (`FlashcardReviewer.svelte:570`)
  is clickable but `start(false)` rebuilds an empty queue and re-renders the
  same screen — a silent no-op that reads as broken. Hide it when nothing is
  due, or replace it with when the next card comes due.
- [ ] **Remove the 🔥 from the streak line.** "no tacky emojis."
  `strings.ts:253` (`🔥 1 dag i rad`), shown on the done screen and in
  ProgressSummary. Plain text: `1 dag i rad`.
- [ ] **Reword "Läs en lektion →".** User: "man läser inte en lektion."
  `strings.ts:97`, done-screen link. Needs a verb that matches what lessons
  are (listening/doing): e.g. "Gå till lektionerna →" — user picks the wording.
- [ ] **Lyssna / Lyssna (mening): drop the prompt playback controls on the
  solution screen.** Requested 2026-07-12 20:21. In listen and listen-sentence,
  the prompt's replay controls (the 1× voice-graph play button + the 0.75×
  slow-replay) currently keep showing after the answer is revealed — redundant,
  since the revealed card already has its own play button (the `SpeakButton` on
  the word / sentence). Hide them once we reach the solution. In
  `FlashcardReviewer.svelte`, the `{#if direction === 'listen' ||
  direction === 'listen-sentence'}` voice-controls block at the top of `.drill`
  (~L794–825) renders in BOTH phases; wrap its inner `.voice-btn` / `.slow` /
  no-audio-notice in `{#if phase === 'prompt'}` (keep the outer branch so the
  cloze/default prompt text is unaffected). Low-risk, isolated — no keyboard
  shortcut depends on these in the revealed phase (`R`-replay is prompt-only).

- [ ] **Fast flip-review mode (game-like).** Decided 2026-07-11, detailed
  plan-mode session pending. Agreed shape:
  - New review direction `flip` inside the existing reviewer (inherits FSRS
    per-direction records, due-all group, `?direction=flip` links, group
    scoping, persistence, free practice).
  - **Prompt = Swedish, think/say the Danish** (decision A — active recall).
    No typing.
  - Enter / Space / tap card → reveal. Then binary grade: swipe right / → /
    Enter = knew it (FSRS Good); swipe left / ← = didn't (FSRS Again —
    existing re-entry brings the card back ~6 positions later, giving the
    fast-repeat loop). Double-Enter is the whole happy path.
  - Swipe = pointer-event drag with card-follow, slight tilt, green/red edge
    tint, ~60 px threshold; Nej/Ja buttons as fallback; reduced-motion snaps.
  - Word-clip autoplay at reveal as a **persisted toggle** (speaker button in
    the reviewer header).
  - Constraint lifted 2026-07-11 15:43 (drill-engine done): `strings.ts` is
    free, and the drill's `blip.ts`/`webaudio.ts` + DrillEngine feedback
    patterns are now real modules to reuse.

## Numbers (/tal)

- [ ] **Fold the number-dictation logic into flashcards and remove `/tal`.**
  Decided 2026-07-11 22:09 — full plan-mode session TOMORROW (this is a
  placeholder, not the plan). Goal: **delete the standalone `/tal` page**;
  its number-drill capability lives inside the flashcards surface instead.
  Rationale: now that `/zen` exists as the cross-activity focused-drill shell,
  a separate top-level numbers page is redundant — numbers should be one more
  thing you can practise from flashcards.
  What `/tal` is today (inventory for the plan):
  - Page `src/pages/tal.astro` → mounts `DrillEngine.svelte` with
    `kind="numbers"` and the `src/data/number-audio.json` clip manifest.
  - Mode `number-dictation` in `src/lib/drill-modes.ts` — **ungraded, no SRS**
    ("numbers v1", `srs: null`). Audio composes committed clips via
    NumberAudioPlayer (real recordings only, never TTS — product invariant).
  - Core logic: `src/lib/danish-numbers.ts` (`NUMBER_LEVELS`,
    `normalizeDigits`), `src/lib/number-audio.ts`, `src/data/number-audio.json`.
  - Level gating: island disables levels lacking full clip coverage.
  Open questions to settle in the plan (don't decide now):
  - Do numbers become real FSRS cards, or stay an ungraded practice mode
    reachable from the flashcards page? (Flashcards are SRS today; `/tal` is not.)
  - Entry point in flashcards UI — a study group / mode toggle? How the
    picker surfaces number levels.
  - `/skriv` also mounts DrillEngine (`kind="words"`) — out of scope unless the
    plan says otherwise; only `/tal` is being removed.
  - Cleanup once absorbed: `tal.astro`, nav link, any `/tal` references in
    `strings.ts` and `index.astro`; keep `danish-numbers.*` / `number-audio.*`
    (they move, not die). Confirm no other page imports the numbers path.
  - Redirect/handling for existing `/tal` bookmarks after removal.
  Registers a normal plan in `docs/plans/active/` before implementation starts.

## Home page

- [ ] **Redesign or remove the "Daglig praktik" block (DailyMission + InputLog).**
  User verdict: "this i hate — looks some kindergarden shit. it should not be a
  diary but a practice tool, and not some 'do this when you cook food'."
  Concretely rejected: mission prompts like "Tänk högt på danska medan du lagar
  mat eller diskar" (`strings.ts:204`), the "Logga dansk input" diary/source
  fields (`strings.ts:211`, `InputLog.svelte`), and the "Tips: nya ord du
  loggar kan senare bli en egen kortlek" framing (`strings.ts:226`).
  Direction: an actual practice tool, not journaling. Bigger design item —
  needs its own plan (and a decision on what happens to existing
  `missionLog`/`inputLog` localStorage data).

## Visual

- [ ] **Ghost letters: Å renders as a plain "A".** User: "the ghost letters are
  not supposed to be æ, ø and just an a?" Root cause confirmed:
  `.ghost-head { overflow: hidden }` + the 4–8rem ghost span centered in a much
  shorter header (`global.css:145-163`) crops the glyphs top and bottom, and
  Å's ring is exactly what gets cut. Fix so all three of Æ Ø Å read as
  themselves (smaller size, more headroom, or crop-safe positioning). Applies
  on `lektioner/index.astro:16-17` and `ordlista.astro:48-49`.

## Mobile (2026-07-19 audit — see `done/mobile-port-audit.md`)

Full-site mobile audit + fixes done 2026-07-19 20:20 (uncommitted on
`flashcards-lyssna-mening-hide-word`). 41 live-verified findings fixed:
tap targets, table overflow, hover-only affordances, keyboard-hint copy,
zen scroll/virtual-keyboard handling, plus the lesson-01 minimal-pair drill
that never hydrated at all (`client:visible` island with zero SSR children).
Still open from that audit:

- [ ] **Real-device iOS Safari pass** — everything was verified in
  Playwright-chromium iPhone emulation only. Check: zen keyboard
  (visualViewport height), audio after autoplay-block, scroll feel.
- [ ] **Zen mode/direction steps commit on ONE tap on Android** (focus
  precedes click; the pointerdown was-hot guard covers source-step buttons
  only) while iOS needs two — unify (extend `noteDeckPointerDown` to
  mode/direction, or embrace one-tap and drop the gate there).
- [ ] **Zen expanded cloud duplicate labels** (pre-existing): "verb",
  "kropp & hälsa", "falska vänner", "övrigt" appear twice (theme set vs POS
  set) with nothing distinguishing them.
- [ ] **svelte-check: clear the 9 pre-existing errors** — all
  `exactOptionalPropertyTypes` on SpeakButton's `audio` prop (6 DrillEngine,
  2 FlashcardReviewer, 1 LessonAudio); widen the prop to
  `string | undefined`.

## Parking lot (earlier review findings, not re-raised by user)

- ~1.5 s audible gap between hun and hund in the hero sample (clip trailing
  silence + 350 ms pause).
- Hem is red-heavy (accent on cards/DailyMission h3).
- ~~Ordlista table overflows at 320 px (pre-existing).~~ FIXED 2026-07-19
  (mobile audit — no page-level overflow at 320 px, verified live).

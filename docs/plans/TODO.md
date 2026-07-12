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

## Process & tooling

Recorded 2026-07-12 19:35.

User (verbatim): "remake the project instructions to always ask for a playwright
test - for me (and if necessary for the agent (not always the case - not
necessary but sometime when we want extra verification)) and make the playwright
instructions, as we can have many maybe running with different ports if
necessary? also i want to change that we ship to a demo page before it gets
merged on github pages if possible"

- [ ] **Make a Playwright test the default ask on every change.** Update the
  project instructions (`AGENTS.md` / `CLAUDE.md`) so each change offers a
  Playwright run:
  - **For the user** — always offer a Playwright-backed way for the user to try
    the change themselves (a runnable server + suggested things to click). This
    is the always-on part.
  - **For the agent** — an agent-run Playwright verification only when extra
    confidence is wanted, not required for every change.
  - Write a reusable **Playwright harness + instructions** that supports several
    runs at once on **different ports** (parallel agents/sessions), isolated
    throwaway worktrees, a build-or-dev choice, and cleanup. (Reference: the
    ad-hoc harness used to verify the ordlista search PR #18 — isolated worktree
    + `astro preview`/`dev`, `--port`, curl-gated readiness, port/worktree
    teardown — is a starting point to formalize.)
- [ ] **Ship to a demo/preview page before merging to GitHub Pages.** Investigate
  a pre-merge preview deploy (e.g. a per-PR or per-branch demo URL) so changes
  can be reviewed live before they land on the production GitHub Pages site — if
  feasible with the current static / GH-Pages setup.

## Parking lot (earlier review findings, not re-raised by user)

- ~1.5 s audible gap between hun and hund in the hero sample (clip trailing
  silence + 350 ms pause).
- Hem is red-heavy (accent on cards/DailyMission h3).
- Ordlista table overflows at 320 px (pre-existing).

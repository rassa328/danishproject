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
  ⚠ Note text lives in `strings.ts` — inside the drill-engine plan's
  write_set; sequence or coordinate.
- [x] **Typed answers: map Swedish letters to Danish.** DONE 2026-07-11
  (plan `done/swedish-letter-folding.md`): `ä`→`æ`, `ö`→`ø`, digraph `ae`→`æ`
  accepted at comparison time in `matchTyped`/`matchCloze` (typed side only,
  exact match tried first). Not included: `oe`→`ø` (not requested), live
  input-field transform (possible follow-up).
  ⚠ Still open: the drill-engine plan builds its own `src/lib/char-map.ts` —
  the two mappings should eventually be one shared module (coordinate with
  that plan's owner).
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
  - Constraint: needs `strings.ts`, which is in the active drill-engine
    plan's write_set — sequence after it or coordinate the one-file overlap;
    its blip/feedback modules may be reusable.

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

## Parking lot (earlier review findings, not re-raised by user)

- ~1.5 s audible gap between hun and hund in the hero sample (clip trailing
  silence + 350 ms pause).
- Hem is red-heavy (accent on cards/DailyMission h3).
- Ordlista table overflows at 320 px (pre-existing).

# TODO — things to fix

Backlog of user-reported issues, verbatim where possible. Not a plan —
whoever picks an item up registers a normal plan in `docs/plans/active/` first
(several items touch files inside the drill-engine plan's write_set; coordinate).

Recorded 2026-07-11 from a live review of the deployed site.

## Flashcards (reviewer)

- [ ] **Drop the visible "(1) (2) (3) (4)" on the grade buttons.**
  User: "what even is that for? i think enter is just enough."
  They are keyboard shortcuts for the four FSRS grades
  (`FlashcardReviewer.svelte:670-673`, handler at `:403-408`). Keep or drop the
  digit *shortcuts* as a separate decision, but the labels should go, and
  **Enter in the revealed phase should grade Good and advance** (today Enter
  does nothing after reveal — only digits work).
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

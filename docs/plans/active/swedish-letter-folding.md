---
title: Accept Swedish-typed ä/ö/ae for Danish æ/ø in typed answers
owner: claude-main
branch: main
status: active
write_set:
  - src/lib/session.ts
  - src/lib/session.test.ts
  - docs/plans/TODO.md
verify: npm test && npx astro check
opened: 2026-07-11
---

User decision (2026-07-11, reversing the deliberate no-fold rule commented in
`session.ts`): typed answers in the flashcard reviewer should accept Swedish
keyboard spellings for the Danish letters — `ä` → `æ`, `ö` → `ø`, and the
digraph `ae` → `æ`. `å` is shared and needs nothing. `oe` → `ø` was NOT
requested and is not included.

Implementation: comparison-time second chance, typed side only. `normalizeTyped`
stays unfolded (it also feeds recognize-distractor sets); `matchTyped` and
`matchCloze` first compare exactly (so answers legitimately containing "ae",
e.g. loanwords, still match), then retry with the folded form. Stored Danish is
never altered; the input field is not live-transformed (possible follow-up).

Tests: flip the "Swedish-letter spellings stay WRONG" cases to the new
behavior, keep `bocker`≠`bøger` (plain o must not fold) and `gá`≠`gå`, add
digraph + cloze folding cases.

Out of scope: the drill-engine plan's `src/lib/char-map.ts` (other owner);
unifying the two mappings later is noted in docs/plans/TODO.md.

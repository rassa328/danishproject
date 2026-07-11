# Batch-001 — the applied audit edits

_Recorded: 2026-07-11 16:19 (edits applied during the original run; this is the durable record.)_

Batch-001 was produced by the original primary → specialist → coordinator pipeline (whose raw artifacts
were later lost — see [resolution-summary.md](resolution-summary.md)) and applied to the two canonical
CSVs. It remains in the working tree and is validated by the six-role diff review in
[diff-review.md](diff-review.md).

## Scope (exact, measured from the HEAD→working diff)

- **306 Swedish-side edits** (297 in praksis, 9 in starter) — changes to `swedish`, `note`,
  `example_sv`, and/or `accepted` only.
- **18 whole-row removals** (all in praksis).
- **324 affected HEAD rows** total (306 + 18). _Note:_ the plan/manifest's "324 edits" figure folds the
  18 removals into the count; the precise split is 306 edits + 18 removals.

## Character of the edits (from the review)

- Swedish-gloss corrections: false-friend fixes, wrong meat cuts / species / tools / ingredients,
  de-Danglishing, slash→comma normalization.
- 16 `accepted`-field edits: 14 clears (incl. `Hvad`→"" and `Jo`→"") removing prompt-equal values,
  plus 2 additions of Danish alternate spellings. `accepted == danish` count is 0 in both files.
- Added register/usage/false-friend notes (e.g. `luder`, `betænksom`, `frikadelle`, `guldsmed`).
- 18 removals: predominantly transparent DA–SV cognates and inflected/duplicate forms whose base lemma
  survives (e.g. `riget`→`rige`, `vejer`→`veje`, `kraniet`→`kranium`, `forelske`→`forelske sig`,
  `strømhvirvel`→`hvirvel`, `sparkle`→`spartle`). Full list: `../../../tmp` removed-rows artifact was
  transient; the 18 removed stable IDs are recoverable via `git show HEAD:` vs the working tree.

## Invariants confirmed

- ADR-001: no Danish headword, Danish example, or audio reference changed on any modified row.
- Structural: every modified row keeps the exact column count (praksis 13, starter 12); valid quoting;
  no orphaned references; every touched deck retains ≥3 sibling rows.
- Validation at apply time and after batch-002: `check-content` pass, `npm test` 251/251.

## Corrections

Seven batch-001 edits were later found to be regressions and corrected in
[batch-002.md](batch-002.md).

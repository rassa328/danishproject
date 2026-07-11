# Vocabulary audit — resolution summary

_Last updated: 2026-07-11 16:19_

Durable record of the deterministic full-vocabulary audit (plan: `docs/plans/done/vocabulary-audit.md`,
opened as commit `180667d`). This file is the top-level index; see the companion files for detail.

## What was audited

Every canonical vocabulary entry across the two decks:
`src/data/vocab/starter-deck.csv` and `src/data/vocab/praksis-deck.csv`.
The deterministic manifest maps **5,213 source rows → 5,095 effective stable IDs** (118 cross-deck
duplicate IDs where starter wins), sharded into **40 deterministic shards** of 127–128, sorted by ID.

## Outcome (what is committed)

- **Applied to the CSVs:** batch-001 (306 Swedish-side edits + 18 whole-row removals = 324 affected
  HEAD rows) plus batch-002 (7 corrective fixes from the final review). Net committed diff = **305
  Swedish-side edits + 18 removals**. See [batch-001.md](batch-001.md) and [batch-002.md](batch-002.md).
- **Product invariant preserved (ADR-001):** across the entire committed diff, **0 Danish headwords,
  0 Danish examples, and 0 audio references changed** — verified by an audio-key join of HEAD vs the
  working tree (praksis 4,970 common rows, starter 225; danish/example_da/audio all byte-identical).
  Every human recording stays aligned.
- **Validation green:** `node scripts/check-content.mjs` passes (5,077 distinct card ids, 5,815 audio
  refs, 0 missing) and `npm test` is 251/251.

## Evidence chain (verifiable, this session)

1. **Primary coverage — 100%, exactly once.** [primary-coverage.md](primary-coverage.md).
   The verifier (`scripts/vocab-audit-verify.mjs`) confirms 5,095/5,095 reviewed across 40 shards,
   0 missing / 0 duplicate / 0 unexpected. Fresh recovery-primary decisions:
   **4,893 keep / 191 improve / 5 replace / 5 merge / 1 remove.**
   Machine-readable: `recovery-primary-summary.json`, `recovery-primary-nonkeep.jsonl` (202 proposals).
2. **Changed-entry review — the applied diff.** [diff-review.md](diff-review.md).
   Six independent lenses (Danish, Swedish, learning-value, dataset-integrity, audio-compatibility,
   validation/build) reviewed the applied 324-affected-row diff; every entry-level finding was then
   adversarially verified. **9 confirmed, 9 dismissed** as false positives.
   Machine-readable: `diff-review-findings.json`.
3. **Fixes applied + re-validated.** The 9 confirmed findings (7 unique entries) were fixed in
   batch-002; validation re-run green (above).

## Honesty note on the incident (READ THIS)

Partway through the original run, an accident deleted the raw evidence tree (`/tmp/danish-vocab-audit`):
the 8-role **specialist wave**, the automated **checks/flags**, and the **coordinator-resolution**
artifacts. Repository files were untouched. Recovery rebuilt the manifest from `git show HEAD:` and
re-ran **primary review only**, to a verifiable 100%.

Therefore, under the agreed **pragmatic close** standard:

- **Verified in this session (on-disk artifacts):** the 100% primary coverage, the applied diff, the
  six-role + adversarial diff review, batch-002, and all validation above.
- **Historical / NOT re-verified (from the deleted pre-incident artifacts):** the original specialist
  wave (~1,151 unique entries across 8 roles + secondary), and the coordinator-resolution totals
  reported at the time — keep/improve/replace/merge/remove = **4,589 / 324 / 15 / 149 / 18**, with
  **69** audio-regeneration and **178** manual-review items. These figures are recorded for provenance
  only and were **not** reproduced by the recovery. The specialist/coordinator layers were deliberately
  **not** regenerated (that would be a fresh full audit and could diverge from the applied batch).

The changed-entry specialist coverage requirement is met in this session by the six-role diff review
(step 2), which independently re-examined every applied change.

## Deferred / not applied

See [deferred-manual.md](deferred-manual.md). In brief: the fresh recovery-primary produced 202
non-keep **proposals** that were recorded but **not** auto-applied (the recovery primary is coverage
evidence, not the applied batch). Of those, 11 touch the Danish headword and would require new human
recordings or stable-ID migration; the 191 Swedish-side "improve" proposals form a backlog for a future
review cycle.

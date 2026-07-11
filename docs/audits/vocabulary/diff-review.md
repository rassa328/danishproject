# Final diff review — six lenses + adversarial verification

_Run: 2026-07-11 16:xx • Machine-readable: `diff-review-findings.json`_

The applied batch-001 diff (324 affected rows) was reviewed by six independent lenses; every
entry-level finding was then handed to a skeptical verifier (default: not-a-problem) that re-checked it
against the actual `-`/`+` diff lines and deck context before it counted.

## Lenses and outcomes

| Lens | Ran | Raw findings | Notes |
|---|---|---|---|
| danish-linguistic | ✓ | 7 | sense/deck-theme accuracy of each new gloss |
| swedish-linguistic | ✓ | 5 | naturalness/spelling of the new Swedish |
| learning-value | ✓ | 7 | pedagogy + justification of the 18 removals |
| dataset-integrity | ✓ | 0 | column counts, quoting, id/audio columns, removals — clean |
| audio-compatibility | ✓ | 0 | **0 Danish/example_da/audio changes** — ADR-001 holds |
| validation-build | ✓ | 1 | `check-content` pass + `npm test` 251/251; 1 bookkeeping note |

Bookkeeping note (validation-build): the batch is **306 Swedish-side edits + 18 removals**, not "324
edits"; the manifest folded removals into the edit count. Corrected in the records.

## Adversarial verification: 9 confirmed, 9 dismissed

**Confirmed (fixed in [batch-002.md](batch-002.md)) — 7 unique entries:**
`rask` (revert/further-fix, medium), `brovten` (revert, medium), `håndrod` (further-fix, medium),
`smiske` / `bjæffe` / `remonce` / `vandskræk` (further-fix, low).

**Dismissed as false positives (reviewer premise did not survive scrutiny):**

- `svensknøgle` — the batch edit `rörtång → skiftnyckel` is a **correction**; svensknøgle is the
  adjustable spanner, so the original gloss was the error. Reviewers had the tool inverted.
- `mundfuld`/`munfull`, `ildebefindende`/`illabefinnande` — flagged as Danglish calques, but both are
  established Swedish words.
- `nip`, `rødgrød` — glosses hold up against the dictionary / are valid stylistic choices.
- `kørvel`, `telefonbog` (removals) — clean whole-row removals of near-identical transparent cognates
  with minimal learning value; siblings/topic coverage remain. Defensible curation, not a defect.

The 18 removals as a set were judged sound: ~12 are dedup/inflected-form cleanups with a surviving base
lemma; the remainder are transparent cognates or oddly-placed niche B2 items. Independent corroboration
from the fresh recovery-primary (which flagged four of them merge/remove) is noted in
[primary-coverage.md](primary-coverage.md).

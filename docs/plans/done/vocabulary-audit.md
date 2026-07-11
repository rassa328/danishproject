---
title: Deterministic full vocabulary audit
owner: codex-root
branch: main
status: done
write_set:
  - docs/audits/vocabulary/
  - docs/plans/active/vocabulary-audit.md
  - docs/plans/done/vocabulary-audit.md
  - scripts/vocab-audit-manifest.mjs
  - scripts/vocab-audit-checks.mjs
  - scripts/vocab-audit-verify.mjs
  - src/data/vocab/starter-deck.csv
  - src/data/vocab/praksis-deck.csv
verify: node scripts/vocab-audit-verify.mjs
opened: 2026-07-11
closed: 2026-07-11
---

Audit every canonical vocabulary entry through deterministic primary shards, automated checks, targeted specialist review, centrally applied edits, and final cross-discipline review. Primary and specialist agents remain read-only against canonical sources. Raw manifest and per-shard JSONL artifacts live under `/tmp/danish-vocab-audit`; durable summary and incremental edit records live under `docs/audits/vocabulary/`.

## Completion (2026-07-11 16:19)

Closed under the **pragmatic-close** standard after the mid-run loss of the raw evidence tree
(`/tmp/danish-vocab-audit`): the specialist wave, automated checks, and coordinator-resolution artifacts
were destroyed; repository files were untouched. Recovery rebuilt the manifest from `git show HEAD:` and
re-ran **primary review** to a verifiable 100% (5,095/5,095, 40 shards). The applied CSV diff was then
re-reviewed by six independent lenses with adversarial verification, and the confirmed fixes applied.

- **Applied:** batch-001 (306 Swedish-side edits + 18 removals) + batch-002 (7 corrective fixes). Net
  committed diff: 305 edits + 18 removals. ADR-001 preserved (0 Danish/example/audio changes).
- **Validation:** `check-content` pass (5,077 ids, 0 missing audio); `npm test` 251/251.
- **Records:** `docs/audits/vocabulary/` — resolution-summary, primary-coverage, batch-001, batch-002,
  diff-review, deferred-manual, plus machine-readable evidence (`recovery-primary-*`, `diff-review-findings.json`).
- **Committed in:** `fd3c891` (audit work) + this plan move.
- **Not reproduced (historical only):** pre-incident specialist/coordinator totals and the 69
  audio-regeneration / 178 manual-review counts — see `docs/audits/vocabulary/deferred-manual.md`.

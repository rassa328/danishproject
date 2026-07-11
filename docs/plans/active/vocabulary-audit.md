---
title: Deterministic full vocabulary audit
owner: codex-root
branch: main
status: active
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
---

Audit every canonical vocabulary entry through deterministic primary shards, automated checks, targeted specialist review, centrally applied edits, and final cross-discipline review. Primary and specialist agents remain read-only against canonical sources. Raw manifest and per-shard JSONL artifacts live under `/tmp/danish-vocab-audit`; durable summary and incremental edit records live under `docs/audits/vocabulary/`.

# Primary audit coverage — 100%, verified

_Last updated: 2026-07-11 16:19_

## Result

The global verifier `node scripts/vocab-audit-verify.mjs`
(`VOCAB_AUDIT_DIR=/tmp/danish-vocab-audit-recovery`) exits 0 with:

```json
{
  "manifest_entries": 5095,
  "expected_shards": 40,
  "completed_shards": 40,
  "reviewed_entries": 5095,
  "primary_coverage_percent": 100,
  "duplicate_primary_ids": 0,
  "missing_primary_ids": 0,
  "unexpected_primary_ids": 0,
  "decisions": { "keep": 4893, "improve": 191, "replace": 5, "merge": 5, "remove": 1 }
}
```

Decision totals sum to 5,095 (= manifest). Each shard's findings were validated field-by-field against
its raw shard (id, `source:line`, `danish_current`, `swedish_current`, decision enum, confidence,
audio_impact, compatibility_impact). Snapshot: `recovery-primary-summary.json`.

## Method (and why it is a fresh, independent pass)

The original raw evidence tree was destroyed mid-run (see [resolution-summary.md](resolution-summary.md)).
Recovery rebuilt the exact pre-edit manifest from `git show HEAD:` (same 5,095 IDs, same 40 shards) and
re-ran primary review from scratch:

- **40 shard reviews.** Shards 001–024 were completed during the interrupted recovery session; shards
  025–040 were completed this session by 16 independent Danish/Swedish linguist agents (one shard each),
  orchestrated as a hybrid workflow. Every agent self-verified its shard before reporting; the global
  verifier then confirmed exactly-once coverage of all 5,095 IDs.
- **Serialization safety.** Each agent supplied only linguistic judgments; a shared generator copied all
  structural fields (id / source / danish / swedish) verbatim from the raw shard, so the verifier's
  strict field-match holds by construction.

Because it is an independent pass, the fresh decision counts differ from the pre-incident coordinator
totals — this is expected and acceptable; the requirement is complete verified coverage, not replication.

## Non-keep proposals (recorded, not auto-applied)

The 202 non-keep proposals are persisted at `recovery-primary-nonkeep.jsonl`
(191 improve / 5 replace / 5 merge / 1 remove). These are **independent suggestions** from the recovery
primary, not the basis of the applied batch (that came from the now-deleted coordinator resolution). They
form a backlog; see [deferred-manual.md](deferred-manual.md).

Independent corroboration: the fresh primary flagged `forelske`, `riget`, `vejer` as **merge** and
`forsegling` as **remove** — the exact entries batch-001 removed — supporting those removals.

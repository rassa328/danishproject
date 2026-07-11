---
title: Coordination-system audit — multi-angle (adversary, newcomer, historian)
owner: claude-main
branch: main
status: active
write_set:
  - docs/plans/active/coordination-audit.md
  - docs/plans/done/audit-2026-07-11.md
verify: npm run plans:check
opened: 2026-07-11
---

Read-only audit of the repo's agent-coordination system (AGENTS.md, CLAUDE.md, docs/plans/*,
docs/decisions/*, plans-check.mjs, .gitignore, CI, validator scripts). Three parallel audit
angles — ADVERSARY (does the system bind?), NEWCOMER (is the first-task path unambiguous?),
HISTORIAN (does policy match shipped reality?) — plus a general consistency pass. Findings
deduped, adversarially re-verified, and reported to docs/plans/done/audit-2026-07-11.md,
ranked critical/important/nit with evidence, an "invariants enforced by nothing" list, top-3
fixes, and a verdict. Only write is the report (and this registration, which moves to done/
as the report itself on completion).

---
title: Dansk för svenskar — Danish-learning site for Swedish speakers (v1)
owner: claude
branch: main
status: done
write_set:
  - src/
  - public/
  - scripts/
  - package.json
  - astro.config.mjs
  - .github/workflows/deploy.yml
verify: npx astro check && npm test && npm run build
opened: 2026-06-19
---

The greenfield v1 plan: pure-static Astro 6 + Svelte 5 islands site teaching Danish to
Swedish speakers (CEFR B1–B2), FSRS-6 spaced repetition over an imported word deck,
structured lessons, GitHub Pages deploy. Shipped incrementally through June 2026; v1 is
live at rassa328.github.io/danishproject.

Migrated 2026-07-11 from the draft `~/.claude/plans/ultraplan-cannot-launch-cloud-smooth-manatee.md`
(executed by pre-adoption Claude Code sessions). The full 33 KB hardened plan remains in
that draft; git history is the authoritative record of what shipped.

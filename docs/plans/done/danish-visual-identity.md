---
title: Danish visual identity — accent, hero, waveform, ghost letters, celebration flag
owner: claude
branch: main
status: done
write_set:
  - src/styles/global.css
  - src/components/Nav.astro
  - src/components/HeroSample.svelte
  - src/components/Waveform.svelte
  - src/components/CelebrationFlag.svelte
  - src/components/FlashcardReviewer.svelte
  - src/lib/waveform.ts
  - src/lib/speech.ts
  - src/lib/strings.ts
verify: npx astro check && npm test && npm run build
opened: 2026-07-11
---

Deliberate Danish design identity: exactly one accent color (Dannebrog red, AA-verified
dark variant `#f4566a`), static hero with hun/hund sample player, waveform SVG system,
ghost letters, and the site's single animated moment (celebration flag on earned states).
Shipped in commit `5b00b11` with follow-up fix `a079070` (active nav link accent under
Astro attribute scoping). The accent/animation invariants are recorded as ADR-002.

Migrated 2026-07-11 from the draft `~/.claude/plans/task-build-a-humble-perlis.md`
(first of two stacked plans in that file; the second — the drill engine — is in
`docs/plans/active/drill-engine.md`).

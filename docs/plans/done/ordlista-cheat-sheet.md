---
title: Vocabulary cheat sheet page (Ordlista)
owner: claude
branch: main
status: done
write_set:
  - src/pages/ordlista.astro
  - src/components/VocabTable.astro
  - src/components/WordAudio.svelte
  - src/components/Nav.astro
  - src/pages/index.astro
verify: npx astro check && npm test && npm run build
opened: 2026-06-20
---

One printable page listing every deck word grouped by theme with Swedish translation,
example sentences, notes, and click-to-hear native audio. Shipped (`src/pages/ordlista.astro`
exists and is nav-linked); later extended with search and super-themes in commit `5127236`.

Migrated 2026-07-11 from the draft `~/.claude/plans/continue-with-this-plan-smooth-sundae.md`
(executed by pre-adoption Claude Code sessions).

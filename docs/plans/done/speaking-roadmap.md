---
title: Roadmap to confident Danish speaking (app-driven)
owner: claude
branch: main
status: done
write_set:
  - src/lib/storage.ts
  - src/lib/vocab.ts
  - src/lib/praksis.ts
  - src/lib/deck-groups.ts
  - src/components/FlashcardReviewer.svelte
  - src/components/SettingsPanel.svelte
  - src/pages/flashcards.astro
  - scripts/generate-tts.ts
  - scripts/rank-deck.ts
verify: npx astro check && npm test && npm run build
opened: 2026-06-21
---

Six-phase roadmap reorienting the app from recognition to production: SPEAK/shadowing
direction, settings + streak + dashboard, frequency-first unlock of the 4994-word praksis
deck (grouping layer, rank column, lazy loading), native audio at scale, cloze direction,
and daily output missions + input log. All six phases shipped — evidence: `'speak'` and
streak in `storage.ts`, `deck-groups.ts`/`praksis.ts` exist, commits `6a4882c` (frequency
ranks), `caacf46` (full TTS run), `7a047b2` (Phase 5: cloze), `d0de2f9` (Phase 6: output
missions + input log).

Migrated 2026-07-11 from the draft `~/.claude/plans/spin-up-maybe-100-graceful-tide.md`
(executed by pre-adoption Claude Code sessions).

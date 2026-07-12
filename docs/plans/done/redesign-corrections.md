---
title: Redesign corrections — Lessons, Flashcards, Ordlista, Zen
owner: rasmussamuelson
branch: redesign-port
status: done
write_set:
  - src/
verify: npm test && npm run build
opened: 2026-07-12
---

# Redesign corrections (2026-07-12 12:30)

Post-review corrections to the design-handoff port (branch `redesign-port`, PR #3). Presentation/copy
only — data, SRS, audio-id, keyboard behavior preserved. Canonical copy of the approved plan at
`~/.claude/plans/so-some-things-are-adaptive-church.md`.

**User decisions:** keep the interactive stød drill + checkpoints; remove the "Börja öva orden →" CTA
from all 16 lessons.

## 1. Lessons (match Lektion Stød template)
- Remove the practice CTA globally from `LessonLayout.astro` (keep vocabTags/practiceDirection
  frontmatter; keep MinimalPairDrill + Checkpoint).
- Delete the closing "riktiga ljudklipp" paragraph in `01-stoed.md`.
- Minimal-pair table → new `MinimalPairs.svelte` fed from a `minimalPairs` frontmatter field
  (schema in `content.config.ts`): template grid with bar glyphs (3 grey utan-stød / 4 with red
  3rd med-stød), inline notes kept with the word (nowrap), playback via `spanAudioId`. No dotted
  underline on pair words.

## 2. Flashcards
- Audio glyph bars only (SpeakButton `showLabel` prop; reveal + listen replay icon-only).
- Reveal helper caption `gradeKeysHint` = "tangenterna 1–4 graderar — och styr hur ofta ordet
  repeteras · klicka på ordet för att höra det" (shown on every graded reveal).
- Drop the Swedish word + the "svenska" caption on the card.
- Comment out Inställningar (SettingsPanel) + Säkerhetskopiera (backup) temporarily.
- Prompt copy lowercase + no emoji; Säg reveal shows "(Enter)".
- Enter on reveal grades default: wrong→1 (Igen), correct/self→3 (Medel). Rename grade Bra→Medel.
- Done screen: no 🔥; reword the empty "Inga kort att repetera just nu".

## 3. Ordlista
- List note: drop "— hela listan finns i appen".

## 4. Zen (deck screen)
- Click selects (red underline), second click / Enter confirms.
- Curated categories + "fler…/färre" toggle; 2-D grid layout + arrow nav (island-only; `zen.ts` +
  `zen.test.ts` unchanged).
- Highlight = red underline only, no focus-outline box.

## Verify
`npm test` (298), `npx svelte-check` (9 baseline), `npx astro check` (0), `npm run build` (0), plus
headless screenshots per screen (both themes + 375px). Commit per area; push to PR #3.

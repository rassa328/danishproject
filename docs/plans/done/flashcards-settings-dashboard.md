---
title: Flashcards settings dashboard (gear popover)
owner: rasmus (Claude Code)
branch: wordlist-keep-authored-casing
status: done
write_set:
  - src/components/FlashcardSettings.svelte
  - src/components/FlashcardReviewer.svelte
  - src/lib/storage.ts
  - src/lib/session.ts
  - src/lib/fc-settings.ts
  - src/lib/strings.ts
  - src/lib/fc-settings.test.ts
  - src/lib/session.test.ts
verify: npx svelte-check ; npm test ; npm run build ; scratch Playwright visual check on /flashcards
opened: 2026-07-12 18:28
---

# Goal

Implement the flashcards settings dashboard exactly as prototyped in
`design_handoff_flashcards_settings/` (hifi, "recreate pixel-perfectly"): a
gear-triggered popover in the flashcards header, replacing the currently-hidden
`<details>` SettingsPanel. Warm-dark, calm, editorial; springy toggles; ∞
steppers; retention chips; mode chips; paused-cards row; auto-save footer.

# Fidelity strategy

The prototype ships Google Fonts (Playfair Display / IBM Plex Mono) and hardcoded
warm-dark hexes. The app already IS that design language via CSS variables, so map
prototype tokens → existing tokens (no Google Fonts, works in light theme for free):

- serif title → `--font-serif` (Newsreader); mono → `--font-mono`
- panel bg → `--card`; page bg dark-text-on-fill → `--bg`
- primary/secondary/muted/faint text → `--ink`/`--mut2`/`--mut4`/`--mut5`
- selected chip / toggle-ON "light fill" (#e8dfd2 + #1a1512 text) → `--ink` fill + `--bg` text (theme-adaptive inversion)
- hairlines → `--bd2`; idle borders → `--bd4`/`--bd5`; accent → `--red`; bars → `--bars`
- shadows → `0 1px 2px var(--sh1), 0 16px 40px var(--sh3)` (matches the deck popover)

# Settings mapping (prototype → real Store)

| Prototype        | Store field                     | Notes |
|------------------|---------------------------------|-------|
| autoSpeech       | Settings.autoSpeech (NEW, true) | auto-play word audio on reveal (reading/writing modes only) |
| speakSentence    | Settings.speakSentence (NEW, false) | also play exampleDa after the word |
| newPerDay        | Settings.newPerDay              | 0–200 step 5, then ∞ (-1) |
| maxReviews       | Settings.reviewPerDay           | 10–500 step 10, then ∞ (-1) |
| retention (80–99)| Settings.requestRetention (×100)| chips 85/90/95 + manual 80–99 |
| mode             | Settings.directions[0]          | DEFAULT mode; default → 'recognize' (was 'produce') |
| pausedCount      | store.suspendedCount() / resumeAllSuspended() | real |

∞ sentinel: stored as -1; `buildQueue` treats newPerDay/reviewPerDay < 0 as
Infinity (else `slice(0,-1)` silently drops a card). Unit-tested.

Default mode changes 'produce' → 'recognize' (design-approved; only affects users
with no saved preference; existing saved prefs untouched).

# Steps

1. storage.ts: add autoSpeech/speakSentence to Settings + DEFAULT_SETTINGS; default directions ['recognize'].
2. session.ts: negative newPerDay/reviewPerDay → Infinity. + session.test.ts cases.
3. fc-settings.ts (pure): stepper ∞ transitions, count display, retention presets. + fc-settings.test.ts.
4. strings.ts: new `fcSettings` copy block (Swedish).
5. FlashcardSettings.svelte: gear trigger + popover; all controls; a11y (dialog, switches, radios, steppers); motion behind prefers-reduced-motion.
6. FlashcardReviewer.svelte: mount trigger in head-row; wire auto-speak on reveal; onChange restart-if-done.
7. Verify: svelte-check (baseline 11 known errors), vitest, build, Playwright visual + interaction check. Adversarial fidelity review.

# Result (2026-07-12 19:00 — complete, uncommitted)

Implemented and verified. All 7 steps done. Gates: `npx svelte-check` = 9 errors (all
pre-existing baseline, 0 new), `npm test` = 904 passed, `npm run build` clean.
Playwright (scratch, dark/light/mobile) = 26/26 interaction+visual checks + 7 targeted
probes (contrast tokens, radiogroup arrow-nav, manual-reveal focus, 24px close target).

Post-implementation adversarial review (3 lenses) → fixed: WCAG contrast (eyebrows→--mut3,
hints/manual-link→--mut2, autosaved→--mut3), a real autoSpeakReveal answer-leak (snapshot
`current` across awaits), chips → native-radio radiogroups (arrow-nav, one Tab stop),
manual-reveal focus, stable stepper aria-labels, close 16px + 24px target, and several 2px
spacing/divider fidelity fixes. Auto-speech restricted to committed human clips (product
invariant). Changes are uncommitted on branch wordlist-keep-authored-casing — awaiting the
user's branch/PR decision (unrelated uncommitted files in the tree were left untouched).

Follow-up (19:16): reveal auto-speech now PULSES the answer's audio glyphs in sync with the
sound. Added opt-in `onStart` callback to `speak()` (fires at playback START, even under
awaitEnd) + exported `flash()` on SpeakButton; FlashcardReviewer binds the word/example
glyphs and flashes each via onStart. Verified: 5/5 Playwright animation checks (word-only,
negative control with autoSpeech off, sequenced word→sentence, getAnimations=1 confirms a
real CSS animation); onStart is opt-in so no other speak() caller regresses.

# Out of scope

Old SettingsPanel.svelte / backup block (stay behind SHOW_SETTINGS=false). Page
mode-tabs restyle (prototype's page render is only context). ttsEnabled/theme
Settings fields (vestigial; theme lives under dfs-theme).

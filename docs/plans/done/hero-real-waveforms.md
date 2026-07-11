---
title: Real hun·hund waveforms in the hero (per-word envelopes from the actual clips)
owner: claude
branch: main
status: done
write_set:
  - scripts/waveform-data.ts
  - src/data/hero-waveform.json
  - src/lib/waveform.ts
  - src/lib/waveform.test.ts
  - src/components/Waveform.svelte
  - src/components/HeroSample.svelte
  - src/lib/strings.ts
  - package.json
verify: npx astro check && npm test && npm run build
opened: 2026-07-11
---

Replaced the hero's decorative waveform with real per-word envelopes generated at build
time from the actual hun/hund clips (`scripts/waveform-data.ts` → committed
`src/data/hero-waveform.json`), each word labelled under its own shape, per-word playback
sweep, and the stød dip in "hund" marked accent-red. Shipped in commit `d63e209`.

Migrated 2026-07-11 from the draft `~/.claude/plans/hazy-waddling-llama.md`.

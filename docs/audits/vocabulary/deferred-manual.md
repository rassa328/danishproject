# Deferred / manual-follow-up items

_Last updated: 2026-07-11 16:19_

Items intentionally **not** applied in this close, recorded for a future review cycle. Nothing here
blocks the current committed state.

## A. Fresh recovery-primary proposals (this session, verifiable)

The recovery primary is **coverage evidence**, not the applied batch, so its 202 non-keep proposals were
recorded but not auto-applied. Full data: `recovery-primary-nonkeep.jsonl`.

### A1. Audio-impacting / stable-ID-migration proposals — 11 (need new human recordings; ADR-001)

Changing a Danish headword desyncs its human recording, so these require a new recording (and stable-ID
migration) before they could be applied. Deferred by design.

| Decision | Entry | Proposed | Note |
|---|---|---|---|
| replace | `dække` | `dækning` | headword change → new audio |
| replace | `taste` | `tast` | headword change → new audio |
| replace | `forsten` | `forstene` | headword change → new audio |
| replace | `glatte` | `glatføre` | headword change → new audio |
| replace | `fortrydelig` | `fortrædelig` | spelling correction; headword change → new audio |
| merge | `forelske` | (into `forelske sig`) | already removed in batch-001; corroborates removal |
| merge | `riget` | (into `rige`) | already removed in batch-001 |
| merge | `vejer` | (into `veje`) | already removed in batch-001 |
| merge | `nu om dage` | (dup sense) | needs stable-ID migration |
| merge | `gløder` | (into `glød`) | needs stable-ID migration |
| remove | `forsegling` | — | already removed in batch-001 |

### A2. Swedish-side "improve" backlog — 191

191 fresh-primary `improve` proposals touch only the Swedish side (gloss/note/example_sv/accepted) and
are audio-safe. They are an **independent reviewer's suggestions**, distinct from the applied batch, so
applying them is a separate scoped task (each would want its own review, ≤500/batch, validation after).
Listed in `recovery-primary-nonkeep.jsonl` (`decision:"improve"`).

## B. Historical items from the pre-incident run (NOT re-verified)

From the original specialist/coordinator layers whose raw artifacts were destroyed (see
[resolution-summary.md](resolution-summary.md)). Recorded for provenance only; these counts were **not**
reproduced by the recovery:

- **69** entries flagged for audio regeneration under ADR-001 (renamed headwords needing new recordings).
- **178** entries deferred for manual review (stable-ID migration or new real recordings).
- Pre-incident coordinator totals: keep/improve/replace/merge/remove = **4,589 / 324 / 15 / 149 / 18**.

Because these rest on deleted artifacts, they should be treated as historical. A future cycle that wants
verified specialist/coordinator coverage would re-run those layers from the (regenerable) manifest.

## Product-invariant reminder

Any future application of A1/B audio-impacting items must supply **real human recordings** — never
TTS-generated user-facing audio (ADR-001).

# Batch-002 — corrective fixes from the final diff review

_Applied: 2026-07-11 16:17_

The six-role diff review + adversarial verification ([diff-review.md](diff-review.md)) confirmed 9
findings across **7 unique entries** (all in praksis, all pre-existing batch-001 edits). Batch-002
corrects them. All fixes are **Swedish-side only** (gloss/note); Danish headwords and audio are
untouched (ADR-001 safe). Applied atomically with per-edit uniqueness assertion and CRLF preserved
(script: transient, in the job tmp dir; each `old` string matched exactly once).

| Entry (deck) | Fix type | Before → After (Swedish side) |
|---|---|---|
| `rask` (praksis-adjektiver-fart-b1) | further-fix | `frisk` → `rask, kvick (snabb); äv. frisk (sund)` — speed deck; restore the pace sense, keep health |
| `brovten` (praksis-humoer-nuancer-b2) | **revert to HEAD** | `skrytsam, skrävlande` + false note "…är ett adjektiv…" → `skryt (mallighet)`, note cleared — it is a noun |
| `håndrod` (praksis-skelet-knogler-b2) | further-fix | palm-description gloss + note falsely denying `handlov`=`håndrod` → `handlov (handroten, carpus)` + corrected håndrod≠håndled note |
| `smiske` (praksis-grine-graede-b2) | further-fix | `fjäska, smöra` → `le inställsamt, fjäska` — restore the smile element |
| `bjæffe` (praksis-tale-maader-b2) | further-fix | `gläfsa, skälla` (canine) → `snäsa, fräsa (åt någon)` — human-speech deck |
| `remonce` (praksis-bager-konditor-b2) | further-fix | `remons (fyllning …)` (invented Sv word) → `smörfyllning (av smör och socker, i wienerbröd)` |
| `vandskræk` (praksis-sygdomme-konkrete-b2) | further-fix | `vattuskräck` (archaic, connotes rabies) → `vattenskräck`; note kept |

`brovten` was reverted exactly to its HEAD row, so it drops out of the committed diff entirely; the final
net committed diff is **305 Swedish-side edits + 18 removals**.

## Validation after batch-002

- `node scripts/check-content.mjs` → pass (5,077 card ids, 5,815 audio refs, 0 missing).
- `npm test` → 251/251.
- ADR-001 audio-key join (HEAD vs working): praksis 4,970 common rows / starter 225 — danish,
  example_da, and audio all byte-identical; 0 audio keys added.

# Curriculum design

How the lessons are structured, why they're sequenced the way they are, and what's
still missing. The machine-checked parts of this (lesson↔card links, prerequisites,
audio) are enforced by `scripts/check-content.mjs` at build time.

## Content model

- **Lessons** live in `src/content/lessons/*.md`; the schema is `src/content.config.ts`.
  Key fields: `unit`, `order`, `objectives`, `prerequisites`, `vocabTags`, `checkpoint`.
- **Units** group lessons thematically. The registry (labels + display order) is
  `src/lib/lessons.ts` (`UNITS`); the lessons index renders lessons grouped by unit.
- **Vocab** lives in `src/data/vocab/starter-deck.csv`. A lesson links to flashcards via
  `vocabTags`, which match a card's `tags`. The validator fails the build if a tag
  resolves to zero cards (no more dead "Träna orden" links).
- **Accepted answers**: a card's `danish` field plus its `/`-variants and the optional
  `accepted` column are all marked correct (`matchAnswer` in `src/lib/vocab.ts`). Never
  fold æ/ø/å — a Swedish ä/ö/å spelling stays wrong.

## Units & sequencing rationale

1. **Grund — Ljud & skrift** (stød, talad danska, stavning). Swedes already *read* Danish;
   the hard part is hearing and pronouncing it. Front-load the sound system so later audio
   is intelligible. `talad-dansk` requires `stød`.
2. **Ord som lurar — Falske venner** (false friends 1 & 2). Tackled early because false
   friends create *false confidence*: the learner thinks they understood. Part 2 (subtler,
   partly-overlapping pairs) requires part 1.
3. **System — Tal, grammatik & uttryck** (numbers, grammar, småord/idiom). The few places
   Danish genuinely diverges from Swedish, plus the vigesimal number system.
4. **Vardag — Hverdagsord** (mad, rejser, arbejde, krop, hjem). Situational vocabulary;
   the false-friend-heavy ones (mad, arbejde, hjem) list `02-falske-venner` as prerequisite.

## Known gaps / roadmap

Lessons currently without a drill deck (prose/checkpoint only): `01-stoed`, `03-tal`,
`04-talad-dansk`, `07-grammatik`. `03` and `07` now have checkpoints; `01`/`04` rely on
click-to-hear audio.

Vocabulary/topics still to add for a credible B1 core:
- **Pronunciation:** a dedicated *blødt d/g* lesson (currently only noted on cards).
- **Grammar:** prepositions (a major Swedish-speaker weak point), verb tenses & agreement,
  pronouns/reflexives.
- **Topics:** time & dates, politeness/register (De vs du), ordinals/measurements.
- **Decks for** `minimalt-par` (stød pairs) and `tal` so lessons 01/03 can drill, plus a
  "false friends → correct alternative" pairing (e.g. flink↔hurtig, rar↔sød).

When adding cards: keep deck names `{topic}-{level}`, tag false friends `falsk-ven`, and run
`npm run check:content` (or just `npm run build`) — it verifies every lesson link resolves.

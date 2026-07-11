---
title: Gamified typing-drill engine + number dictation drill
owner: claude-main
branch: main
status: done
closed: 2026-07-11 15:43
write_set:
  - src/lib/char-map.ts
  - src/lib/char-map.test.ts
  - src/lib/letter-diff.ts
  - src/lib/letter-diff.test.ts
  - src/lib/danish-numbers.ts
  - src/lib/danish-numbers.test.ts
  - src/lib/drill-engine.ts
  - src/lib/drill-engine.test.ts
  - src/lib/drill-srs.ts
  - src/lib/drill-srs.test.ts
  - src/lib/drill-modes.ts
  - src/lib/drill-modes.test.ts
  - src/lib/number-audio.ts
  - src/lib/number-audio.test.ts
  - src/lib/webaudio.ts
  - src/lib/blip.ts
  - src/components/DrillEngine.svelte
  - src/pages/skriv.astro
  - src/pages/tal.astro
  - src/data/number-audio.json
  - src/lib/strings.ts
  - src/components/Nav.astro
  - src/lib/vocab.ts
  - src/lib/vocab.test.ts
  - src/lib/speech.ts
  - scripts/generate-tts.ts
  - scripts/check-content.mjs
verify: npx astro check && npm test && npm run build
opened: 2026-07-11
---

<!-- Migrated 2026-07-11 from ~/.claude/plans/task-build-a-humble-perlis.md (drill-engine
     section). Approved in plan mode 2026-07-11; not yet implemented. This repo copy is
     canonical; the ~/.claude/plans file is a draft. -->
<!-- 2026-07-11 14:08: ownership taken over from main2-non-workflow by claude-main on the
     user's direct instruction (original owner idle; user confirmed no other agent active).
     Execution starting now, phases per §5. -->
<!-- DONE 2026-07-11 15:43. Commits: cc7bd8f (phases 1-2: pure libs, 118 new tests),
     f894006 (phases 3-5: island + pages + manifest), 996d387 (24 confirmed findings from a
     29-finding adversarial review fixed, +6 regression tests). Final: astro check clean,
     251 tests green, build green (23 pages), package.json deps unchanged. NOT pushed.
     Deliberate deviations from this spec (all recorded in commit messages):
     · §3.2 island props: lazy praksis fetch (FlashcardReviewer pattern) instead of the full
       5k-card union as props — preserves the 1.82MB→205KB page-weight fix.
     · Combo blip REPLACES the correct blip on every 5th (no stacked tones).
     · stora-tal price generator range 2-999 kr — avoids 'en kroner'; add a 'krone' atom
       later if singular prices are wanted.
     · Manifest one-atom-per-line for clean diffs.
     Open user actions: record the 92 missing number atoms (src/data/number-audio.json is
     the checklist; only 'tiotal' level playable today) or run npm run tts -- --numbers
     with Azure creds; teacher-verify the formal year reading (§8); optionally curate
     accepted_sv CSV columns for da→sv (heuristic gloss parsing is live). -->
<!-- Executor note 2026-07-11: §2.2's "normalizeTyped never folds æ/ø/å" predates the
     swedish-letter-folding change (done/swedish-letter-folding.md): matchTyped/matchCloze now
     accept ä→æ/ö→ø as a comparison-time second chance. Harmless here — the drill remaps
     input live via char-map before comparison — but letter-diff works on normalizeTyped
     forms, which remain unfolded, exactly as §6 assumes. -->


# Gamified typing-drill engine + number dictation drill — SELF-CONTAINED execution plan

> Written 2026-07-11 in plan mode. **This file is the single source of truth for a later
> execution session** — all exploration findings, user decisions, and design details are
> folded in. Repo: `/Users/rasmussamuelson/claude` (git, branch `main`, clean at planning time).

## 1. Context

The site ("Dansk för svenskar", Astro 6 static + Svelte 5 runes + TS `strictest`, GitHub Pages
under base `/danishproject/`) teaches Danish to Swedish speakers (B1–B2). It has lessons,
a 184-word starter deck + 4994-word praksis deck, FSRS spaced repetition (`ts-fsrs@^5.4.1`),
and pre-generated committed audio clips (runtime is clip-first; browser TTS is only a fallback
for words — the product promise is *no runtime TTS as primary*). It lacks a fast keyboard-first
**production** drill. Deliverable: two nav-linked pages — `/skriv` (word typing drill: sv→da,
dictation, da→sv) and `/tal` (number dictation) — sharing ONE `DrillEngine.svelte` island,
writing word results into the **existing** SRS store (no parallel system), pure unit-tested
logic modules, and a green `astro check` + `vitest` + production build.

### User decisions (asked & answered 2026-07-11)
1. **da→sv accepted Swedish answers**: heuristic gloss parser + a new optional `accepted_sv`
   CSV column that overrides the heuristic when present (curate over time; no upfront backfill).
2. **Number clip granularity**: **compound tens-units** — `syvoghalvfems` (97) is ONE clip;
   hundreds/thousands composed from parts. ≈105 atoms total, ~13 already on disk from lesson 03.
3. **Clip creation**: extend `scripts/generate-tts.ts` with a `--numbers` task. **Write it,
   never run the Azure synth** — the user records clips themselves or runs
   `npm run tts -- --numbers` with their own Azure creds. UI degrades gracefully until clips exist.
   (Memory note applies: don't preempt user-handled work — do NOT generate clips for them.)

### Original requirements (condensed checklist — all binding)
- Session = N cards (default 20, **configurable**) from (a) due SRS cards or (b) a chosen lesson's words.
- Loop: prompt shown/played; single always-focused text input; **Enter submits**.
  - Correct: WebAudio blip + play the word's real Danish clip + success flash + **auto-advance ~650 ms**.
  - Wrong: play clip, **per-letter diff** expected vs typed, show glossary info (meaning, example,
    falska vän-note), **require typing the word correctly once before advancing** (ungraded),
    combo resets, card **requeued to end of run**.
  - "Show word" hint available before answering: **reveals answer + glossary info, counts as SRS miss**.
- Live input mapping ä→æ, ö→ø (+uppercase) **preserving caret**; comparison case-insensitive + trimmed.
- **Preload next card's audio** while current card is active.
- Modes (one engine, config-driven): sv→da typing · dictation (Danish audio, replayable via
  button/hotkey, no text prompt) · da→sv (type Swedish meaning, accept a list of valid answers).
- End screen: accuracy %, total time, best combo, missed words with replay buttons, "run again".
- **Every answered card (correct/wrong/hint) updates the same SRS state the flashcards use.**
- Numbers: Danish number plays → type digits (`inputmode="numeric"`, validated as integer).
  Tiers: (1) 0–20, (2) tens 20–90 incl. halvtreds/halvfjerds…, (3) any 0–99 (trains ental-first),
  (4) hundreds/years/prices. Number→Danish-words = pure unit-tested fn. Clip-composition playback
  via an interface; **commit a manifest listing every clip file needed**; levels disable gracefully
  with an explanatory note when clips are missing. **NO runtime TTS for numbers, ever.**
- TypeScript throughout, repo conventions; fully keyboard-operable; `aria-live` feedback; labels on
  all controls; mobile-friendly; match site look + dark/light; **proper loading skeleton** (not bare
  "Laddar…"); all UI copy Swedish in the site's tone; **no new runtime dependencies**;
  `withBase()` on every asset/route URL.
- Per phase: `npx astro check` clean + dev-server pass; unit tests for normalization/diff/
  number-words/SRS write-back; production build green.

---

## 2. Verified codebase reference (all claims source-verified during planning)

### 2.1 Conventions (must follow)
- TS `strictest` (`tsconfig extends astro/tsconfigs/strictest`; `exactOptionalPropertyTypes`,
  `noUncheckedIndexedAccess` active). **No path aliases** — relative imports with explicit
  `.ts`/`.svelte` extensions (`import { UI } from '../lib/strings.ts'`).
- No ESLint/Prettier. Hand style: 2-space indent, single quotes, semicolons. Node 22, `type: module`.
- Svelte 5 runes (`$props()`, `$state()`, `$derived()`); `<script lang="ts">`. Islands mounted
  **`client:idle`** (site default; `client:visible` only for below-fold). `Store`/localStorage only
  in `onMount`, never module top (SSR safety).
- Logic lives in pure `src/lib/*.ts` with co-located `*.test.ts` (Vitest, no config file;
  `describe/it/expect`; injected clock/rng/KV; `const noShuffle = () => 0.999999` pins Fisher–Yates).
  Components are thin and untested (repo policy).
- npm scripts: `dev`, `build` (prebuild = `node scripts/check-content.mjs`), `preview`,
  `test` = `vitest run` (pretest = check-content), `test:watch`, `tts`. Typecheck: `npx astro check`.
  CI (`.github/workflows/deploy.yml`): astro check → npm test → build → Pages deploy (hard gate).
- Existing test count: 76 (day 3, lessons 5, session 23, srs 6, storage 20, vocab 19).
- Deps (runtime): astro, @astrojs/{mdx,sitemap,svelte}, papaparse, svelte, ts-fsrs, typescript.
  **Do not add any.**

### 2.2 SRS (write path the drill MUST use)
- `src/lib/srs.ts`: `Rating` (Manual=0 excluded; Again=1, Hard=2, Good=3, Easy=4), `State`,
  `ReviewGrade` (=1|2|3|4), `newCard(now)`, `review(card, grade, now, requestRetention=0.9)`,
  `isDue(card, now)`, `clampForCorrectness(grade, correct)` (wrong → Again).
- `src/lib/storage.ts`:
  - `Direction = 'produce'|'listen'|'recognize'|'speak'|'cloze'|'listen-sentence'` (line 17) +
    runtime `DIRECTIONS` array. **Do not extend** (leaks into SettingsPanel + flashcards URL validation).
  - `SrsRecord` (line 36): FSRS card fields with ISO-string dates + optional `suspended`/`leech`.
  - `Settings`: `newPerDay(10), reviewPerDay(200), requestRetention(0.9), directions, leechThreshold(8),
    ttsEnabled, theme, selectedGroupId('')` — note `selectedGroupId` exists (added after older docs).
  - **`Store.grade(vocabId, direction, grade, now=new Date())` (line 296)** returns
    `{ record: SrsRecord; result: WriteResult }`. Handles: load-or-create, FSRS review, un-suspend on
    Good/Easy of a suspended card, leech (`Again` && `lapses >= leechThreshold` → suspended), first-study
    `bumpNewCount`, `bumpStreak`, quota-safe write-through. `WriteResult = {ok, quotaExceeded?}`.
  - Keys: record key `${vocabId}::${direction}` (`recordKey`); localStorage `dansk4svensk:srs:v1`
    (hot) / `dansk4svensk:decks:v1` (cold). Injectable `KV`; `memoryKV()` for tests
    (pattern in `storage.test.ts`); `new Store()` defaults to browser localStorage w/ SSR fallback.
  - Also available: `getRecord`, `newCardsToday`, `dueCount`, `getSettings`, `setSettings`, `getStreak`.
- `src/lib/session.ts` (pure; the extracted session engine — **reuse, do not modify**):
  - `normalizeTyped(s)` — NFC/trim/lowercase/space-collapse + edge-punctuation strip;
    **never folds æ/ø/å** (Swedish spelling stays wrong).
  - `matchTyped(typed, card)` — matches any `acceptedAnswers(card)` form.
  - `eligibleForDirection(pool, direction)` — filters only for cloze/listen-sentence; our three
    directions pass through untouched (verified line 86-91).
  - **`buildQueue({cards, tag?, match?, direction, free?, srs, now, limits, rng?}): SessionQueue`**
    (line 104): pool = tag (wins) else `matchesGroup` else empty; scheduled mode = due records
    (`!suspended && due<=now`) most-overdue-first capped at `limits.reviewPerDay` + fresh cards by
    rank/B1-first under `max(0, newPerDay - srs.newCardsToday(now))`; shuffled.
    **Special case: `match {kind:'all'}` with no tag = DUE-ONLY, most-overdue-first, unshuffled** —
    exactly "due SRS cards". `free: true` = everything, shuffled, no SRS filter.
    `SrsView = { getRecord, newCardsToday }` — `Store` satisfies structurally; `Settings` satisfies
    `QueueLimits` structurally.
  - `dueByDirection({pool, directions, srs, now})` exists for done-screen next-step counts.
  - `reinsertAgain` (+6 offset, max 2) is the *flashcards'* re-entry — NOT what the drill needs
    (drill requeues at END); don't use, don't modify.

### 2.3 Word data
- `src/lib/vocab.ts`: `Card { id, danish, swedish, pos, exampleDa?, exampleSv?, note?, deck, cefr,
  tags[], accepted[], audio?, audioExample?, rank? }`. `toCard` defaults: pos `'other'`, cefr `'b1'`,
  deck `'allmänt-b1'`; `tags`/`accepted` split on `[|,]`; `id` = explicit column or `deriveId(danish,pos)`.
  `acceptedAnswers(card)` = danish `/`-variants + `accepted[]`, normalized, deduped.
  `normalizeAnswer` = NFC+trim+lowercase+collapse (no æ/ø/å folding). Re-exports
  `nfc, deriveId, audioKey, lessonAudioId, spanAudioId` from `audio-id.ts`.
- Decks: `src/lib/decks.ts` → `allCards` (184 starter), `getByTag(tag)`, `deckNames`, `getDeck`;
  `src/lib/praksis.ts` → `praksisCards` (4994, has `rank`). CSVs in `src/data/vocab/*.csv`
  (loaded via `?raw` + papaparse, header:
  `danish,swedish,pos,example_da,example_sv,note,deck,cefr,tags,accepted,audio,audio_example[,rank]`).
  **Never re-parse CSV in new code — import the loaders.**
- False friends: free-text `note` + tags `falsk-ven`(39 starter rows)/`asymmetrisk`/`omvänd`.
- Swedish gloss is ONE free-text string, e.g. `"hoppa (även: brista, sprängas)"`,
  `"temporär / temporärt"` — no structured Swedish-answer list exists (hence decision #1).
- Study groups: `src/lib/deck-groups.ts` — `buildStudyGroups(allCards, praksisCards): StudyGroup[]`,
  `StudyGroup {id,label,optgroup,match}`, `GroupMatch` kinds incl. `'all'`, `'decks'`, `'praksisAll'`,
  `'praksisPos'`; `matchesGroup(card, match)`.
- Lessons: content collection `src/content/lessons/*.md` (13). Words associate via frontmatter
  `vocabTags` (tag strings), resolved at runtime by tag filter. Mapping:
  02+13→`falsk-ven`, 05→`stavning`, 06→`fras`, 08→`mad`, 09→`rejser`, 10→`arbejde`, 11→`krop`,
  12→`hjem`; lessons 01/03/04/07 have `vocabTags: []` (no word list). Deep-link contract used by
  lessons→flashcards: `withBase('flashcards?tag=X&from=<lessonId>&direction=Y')`.

### 2.4 Audio
- All clips flat in `public/audio/` (2702 mp3: 2537 word `da-<hash>.mp3` + 165 example `-ex.mp3`).
  Starter deck 100% clip-covered (hard build error otherwise); praksis ≈ half (TTS-fallback tolerated).
- Playback: **single entry point `speak(text, {audioUrl?, rate?}): Promise<SpeakOutcome>`** in
  `src/lib/speech.ts`. `SpeakOutcome = 'audio'|'tts'|'blocked'|'cancelled'|'none'`. Clip-first, Web
  Speech fallback, monotonic `speakSeq` = no-overlap, `'blocked'` on autoplay refusal, SSR-safe,
  never throws. Always `speak(text, { audioUrl: withBase(card.audio) })`. **No preload exists yet.**
- `SpeakButton.svelte` props `{text, audio?, label='Lyssna', ariaLabel?}` — reuse for missed-word
  replay on the end screen (answer-safe aria-label convention).
- Id scheme (`src/lib/audio-id.ts`): word clips `deriveId(danish, pos)`; **lesson-prose clips
  `lessonAudioId(text)` = `deriveId(audioKey(text), '')` (pos-less)** — number atoms reuse this so
  existing lesson-03 clips work as-is. Homograph override: `spanAudioId(text, {ipa?, say?})`.
- Number-word clips ALREADY on disk + in `src/data/lesson-audio.json` (verified id↔file):
  `tyve` da-1f3784354a3037 · `tredive` da-14db3c3b929c9f · `fyrre` da-11b50363c7682d ·
  `halvtreds` da-02829f62738a92 · `tres` da-17505a0d16e413 · `halvfjerds` da-17eeb52ae2ca48 ·
  `firs` da-1af37862fc0dbc · `halvfems` da-145e14c79c220c · compounds `syvogtyve` da-03c34db9bed786,
  `toogfyrre` da-14f6aab7a2167d, `otteogtres` da-0504a069944160, `nioghalvfems` da-102278fca85536 ·
  also `halvanden`, `tresindstyve`, `halvtredsindstyve`. `og` likely exists too — **the reconcile
  step derives presence from disk; never hardcode ids** (recompute via `lessonAudioId(word)`).
- Generator `scripts/generate-tts.ts` (346 lines): Azure REST (`da-DK-ChristelNeural`, prosody −5%),
  env `AZURE_SPEECH_KEY`/`AZURE_SPEECH_REGION`, idempotent skip-if-exists, `--force`, retry/backoff,
  arg helpers `argVal('--name')`/`intArg`, `AUDIO_DIR`, `MANIFEST_PATH` (lesson manifest is a flat
  string[] of ids, reconciled against disk). Extend with `--numbers` following the same structure.
- `scripts/check-content.mjs` (149 lines, prebuild+pretest, exits non-zero): validates vocabTags
  resolve, prerequisites exist, starter audio refs tracked (`git ls-files` in CI). Extend for the
  number manifest.

### 2.5 Base path & nav
- `withBase(path)` from `src/lib/url.ts` — **mandatory** for every internal href/asset/fetch
  (Astro doesn't auto-prefix; bare paths 404 under `/danishproject/`).
- `src/components/Nav.astro`: frontmatter `links` array (`{href: withBase('x'), label, match:
  'exact'|'prefix'}`), active via `aria-current`. Add two entries after `ordlista`:
  `{ href: withBase('skriv'), label: UI.nav.write, match: 'prefix' }` and
  `{ href: withBase('tal'), label: UI.nav.numbers, match: 'prefix' }`.

### 2.6 Styling / theming / a11y patterns
- One global stylesheet `src/styles/global.css` imported by `BaseLayout.astro`. Dark theme ONLY via
  `@media (prefers-color-scheme: dark)` var overrides (no data-theme, no toggle). Use vars only:
  type `--step--1..--step-4`; space `--sp-1..--sp-12`; `--radius`, `--radius-pill`, `--maxw: 46rem`,
  `--min-tap: 2.75rem`; colors `--bg --surface --text --muted --border --accent --accent-contrast
  --correct --warn --warn-bg --due`; derived `--code-bg`/`--subtle-border` via
  `color-mix(in oklab, var(--text) N%, transparent)`. **No new color literals.**
- Global element styles already cover `button`, `input[type=text]`, `:focus-visible`, `.callout`.
  Repeated component patterns to copy: card (`border:1px solid var(--border); border-radius:
  var(--radius); background:var(--surface); padding:var(--sp-4) var(--sp-6)`), CTA
  (accent-filled, `min-height:var(--min-tap)`), badge/pill, `.grades` flex row, per-component `.vh`
  visually-hidden class, verdict colors ok→`--correct` / no→`--accent`, motion behind
  `@media (prefers-reduced-motion: no-preference)`.
- FlashcardReviewer.svelte (647 lines) — the pattern donor: `{#if !ready}` fallback; `onMount` →
  `new Store()` + URL params (`?tag`, `?from`, `?direction` validated); container `tabindex="-1"` +
  `onkeydown` + refocus after transitions; **hotkey `R` = replay** (`replayKeyTitle: 'Tangent R'`);
  `aria-live="polite"` on progress + feedback; `role="alert"` for save errors; æøå insert buttons
  `aria-label={'Infoga ' + ch}`; Danish inputs get `spellcheck={false} autocorrect="off"
  autocapitalize="off"` and `lang` attrs on Danish text.
- Loading today = bare `<p>Laddar…</p>` — we ship a real skeleton instead (see §3.6).

### 2.7 UI copy (`src/lib/strings.ts`)
Single typed `const UI = {...} as const`; ALL new copy goes here. Tone: plain warm Swedish,
`du`-form, no SRS/FSRS jargon, sparse emoji (✓ ✗ 🎧 🗣 🔥), curly quotes, `·` separators.
Reusable existing strings: `flashcards.replay` ('Spela igen'), `.play` ('▶ Spela'), `.slowReplay`,
`.charHelper`, `.saveError`, `.correct`/`.incorrect`, `.listenPrompt` ('🎧 Lyssna och skriv ordet du
hör:'), `.ttsHint`, `.confirmRestart`, `.progress(i,total,remaining)`. New: `UI.nav.write: 'Skriv'`,
`UI.nav.numbers: 'Tal'`, and a `UI.drill` block (title 'Skrivövning', numbers title 'Sifferdiktat',
`hint: 'Visa ordet (räknas som miss)'`, `typeItOnce: 'Skriv ordet rätt en gång för att gå vidare'`,
`comboLabel`, `accuracy`, `totalTime`, `missedHeading`, `runAgain: 'Kör igen'`,
`numbers.missingAudio: 'Ljudklipp för den här nivån saknas ännu — nivån är avstängd.'`,
level labels, source labels 'Att repetera (förfallna)' / 'Från lektion', `cardCount: 'Antal kort'`, …).

---

## 3. Design

### 3.1 SRS integration (Q1 of the task)
**No new `Direction` members; no parallel store.** Modes map onto existing directions so drill and
flashcards share ONE dueness per (card, skill) — grading in the drill reschedules the exact record
flashcards read (that is what "update the same SRS state" means; a drilled card leaves the
flashcards due queue by design):

| Mode | Direction | Grade on correct | on wrong | on hint |
|---|---|---|---|---|
| sv→da typing | `produce` | `Rating.Good` | `Rating.Again` | `Rating.Again` |
| dictation | `listen` | `Rating.Good` | `Rating.Again` | `Rating.Again` |
| da→sv meaning | `recognize` | `Rating.Good` | `Rating.Again` | `Rating.Again` |
| number dictation | — | **no SRS in v1** (`srs: null`) | | |

No Hard/Easy in v1 (no self-assessment). Every scored attempt writes via `Store.grade` — including a
requeued card's re-attempt (FSRS-6 short-term steps handle same-session Again→Good). The forced
corrective retype after a miss is **not** re-graded (same attempt). On `!result.ok` → `role="alert"`
quota message. Known accepted trade-off: da→sv typed shares `recognize` records with the flashcards'
easier multiple-choice (same skill, mixed difficulty).

New adapter `src/lib/drill-srs.ts` (pure):
```ts
export type DrillOutcome = 'correct' | 'hint' | 'wrong';
export function gradeForOutcome(o: DrillOutcome): ReviewGrade;   // correct→Good else Again
export interface SrsSink {                                        // structural Store slice
  grade(vocabId: string, direction: Direction, grade: ReviewGrade, now: Date):
    { record: SrsRecord; result: WriteResult };
}
export function recordOutcome(sink: SrsSink, vocabId: string, direction: Direction,
  outcome: DrillOutcome, now: Date): WriteResult;
```

**Queue source** — reuse `buildQueue` verbatim, then slice to session size N (default 20; UI select
10/20/40):
- Source “Att repetera”: `match: {kind:'all'}` → due-only, most-overdue-first (exactly "due SRS cards").
- Source “Från lektion X”: `tag: lesson.vocabTags[0]` → due + new under existing budgets.
  `skriv.astro` passes `lessons: {id, title, tag}[]` built from the content collection
  (only the 9 lessons with non-empty vocabTags).
- Deep-link parity: `?mode=`, `?tag=`, `?from=` (same parsing as FlashcardReviewer).
- Dictation mode filters items to cards with a real clip (`!!c.audio`) — drill-side filter in
  `drill-modes.ts`, NOT a `session.ts` change (keeps the real-audio promise; flashcards behavior
  untouched).

### 3.2 Component architecture (Q3)
Astro island props must be serializable → pages pass data + `kind` string; the island resolves the
full config (with functions) from a client-side registry.

```
src/pages/skriv.astro    BaseLayout + <DrillEngine client:idle kind="words" cards={[...allCards, ...praksisCards]}
                           groups={buildStudyGroups(allCards, praksisCards)} lessons={lessonRefs} />
src/pages/tal.astro      BaseLayout + <DrillEngine client:idle kind="numbers" />
src/components/DrillEngine.svelte   thin UI — all decisions delegated to lib/
src/lib/drill-modes.ts   DRILL_MODES registry (functions live client-side)
src/lib/drill-engine.ts  pure loop reducer
src/lib/drill-srs.ts     pure SRS adapter (above)
```

```ts
// drill-modes.ts
export type DrillModeId = 'sv-da' | 'da-dictation' | 'da-sv' | 'number-dictation';
export type DrillAudio =
  | { kind: 'clip'; text: string; url?: string }   // via speak(); TTS fallback OK (words)
  | { kind: 'number'; tokens: string[] };          // via NumberAudioPlayer; clips ONLY
export interface DrillItem {
  id: string;              // Card.id or `num:<value>`; stable within session
  prompt: string;          // Swedish gloss / Danish word / number transcript (for reveal)
  answer: string;          // canonical display answer (danish, swedish gloss, or digit string)
  audio?: DrillAudio;
  sourceCardId?: string;   // present ⇒ SRS-backed
  card?: Card;             // glossary info for the feedback panel (meaning/example/note)
}
export interface DrillModeConfig {
  id: DrillModeId;
  prompt: { kind: 'text' | 'audio'; lang: 'sv' | 'da'; replayable: boolean };
  input: { lang: 'da' | 'sv'; inputmode: 'text' | 'numeric'; liveRemap: boolean;
           charHelper: boolean; label: string; placeholder: string };
  srs: null | { direction: Direction; gradeFor(o: DrillOutcome): ReviewGrade };
  buildItems(deps: { cards: Card[]; srs: SrsView; now: Date; limits: QueueLimits; rng?: Rng;
                     tag?: string | null; match?: GroupMatch | null; size: number;
                     numberLevel?: NumberLevelId; manifest?: NumberAudioManifest }): DrillItem[];
  audioFor(item: DrillItem): DrillAudio | null;
  matches(typed: string, item: DrillItem): boolean; // matchTyped / acceptedSwedish / digit compare
}
export function acceptedSwedish(card: Card): string[];  // acceptedSv override wins; else heuristic:
  // split gloss on '/', strip '(...)' but harvest alternatives after 'även:'/'el.', normalizeTyped
```

### 3.3 The drill loop — pure reducer `src/lib/drill-engine.ts` (exactly per spec)
```ts
export type DrillPhase = 'answering' | 'feedback-correct' | 'corrective' | 'done';
export const DRILL_MAX_REQUEUES = 2;
export interface DrillState {
  queue: DrillItem[]; idx: number; phase: DrillPhase;
  combo: number; bestCombo: number;
  answered: number; firstTryCorrect: number;   // accuracy = firstTryCorrect / answered
  missedIds: string[];                          // unique, ordered — end-screen list
  requeues: Record<string, number>;
  revealed: boolean;                            // "Visa ordet" used on current item
  startedAt: number;                            // ms, injected clock
}
export function createDrill(items: DrillItem[], opts: { size?: number; now: number }): DrillState; // slices to size (default 20)
export function reveal(s: DrillState): DrillState;                    // hint: revealed=true
export function submit(s: DrillState, correct: boolean): DrillState;
  // answering + correct + !revealed → feedback-correct, combo++, bestCombo, firstTryCorrect++
  // answering + (wrong || revealed) → corrective, combo=0, missed, requeue at END (cap 2)
  // corrective + correct (ungraded retype) → advance
export function advance(s: DrillState): DrillState;                   // next item or done; resets revealed
export function outcomeOf(s: DrillState, correct: boolean): DrillOutcome; // for the SRS write
```
Component wiring: Enter in `answering` → `matches()` → `submit`; SRS write via `recordOutcome`
(once per scored attempt); `feedback-correct` → blip + `speak(word clip)` + success flash + 650 ms
timer → `advance`; `corrective` → play clip, render `diffLetters`, glossary panel, input stays; a
correct retype (compared with the same `matches`) → `advance` (Enter-driven). Hint button visible
only in `answering`.

### 3.4 Supporting pure modules
- **`src/lib/char-map.ts`** — `mapToDanishChars(s)` (ä→æ, Ä→Æ, ö→ø, Ö→Ø; å untouched; 1:1
  codepoints) + `remapWithCaret(value, caret)`. DOM side in the component `oninput`: read
  `selectionStart`, remap, assign, `setSelectionRange`. Active only when `input.liveRemap`.
- **`src/lib/letter-diff.ts`** — `diffLetters(expected, typed): {ch, kind:'match'|'wrong'|'missing'|'extra'}[]`,
  Levenshtein backtrace over `normalizeTyped` forms. Render: colored spans (`--correct`/`--accent`)
  in an `aria-hidden` block + plain-text summary into the `aria-live` region (no letter soup for AT).
- **`src/lib/webaudio.ts`** — `getAudioContext(): AudioContext | null` lazy singleton, SSR-safe.
- **`src/lib/blip.ts`** — `blip(kind: 'correct' | 'combo')`: OscillatorNode sine ~80 ms with gain
  envelope; `'combo'` (every 5th consecutive correct) = rising two-note. Fire-and-forget, never throws.
- **`src/lib/speech.ts`** — ADD `preloadClip(url: string): void` (`new Audio(url); preload='auto'`;
  SSR-safe). Engine warms `queue[idx+1]`'s clip after each advance; numbers use `player.preload`.

### 3.5 Danish numbers — `src/lib/danish-numbers.ts` (pure) + `src/lib/number-audio.ts`
Linguistic rules (source: lesson `src/content/lessons/03-tal.md`, teacher-verified content):
- 0–20: nul, en/et, to, tre, fire, fem, seks, syv, otte, ni, ti, elleve, tolv, tretten, fjorten,
  femten, seksten, sytten, atten, nitten, tyve.
- Tens: tyve 20, tredive 30, fyrre 40, **halvtreds 50, tres 60, halvfjerds 70, firs 80, halvfems 90**
  (vigesimal short forms).
- 21–99 = **ental first, one spoken word**: `syvogtyve` 27, `toogfyrre` 42, `otteogtres` 68,
  `nioghalvfems` 99 (unit is `en`, not `et`, in compounds).
- Hundreds: `(et|to|…) hundrede [og <rest<100>]` — `og` before a final <100 part (342 =
  tre hundrede og toogfyrre; 101 = et hundrede og en). Thousands: `(et|to|…) tusind [og] …`
  (2024 = to tusind og fireogtyve).
- Years: formal reading `nitten hundrede og fireoghalvfems` (1994); 2000s as thousands. NOTE for
  executor: colloquial Danish often drops "hundrede og" (`nitten fireoghalvfems`) — implement the
  formal form (uses existing atoms) and flag for the user's teacher-verification pass.
- Prices: whole kroner in v1 — `syvoghalvfjerds kroner` (77). No øre/komma in v1.

```ts
export function numberToDanish(n: number): string;      // orthographic one-word compound (display)
export function numberToTokens(n: number): string[];    // spoken atoms: 97→['syvoghalvfems'],
                                                        // 342→['tre','hundrede','og','toogfyrre']
export function yearToTokens(y: number): string[];
export function priceToTokens(kroner: number): string[]; // [...numberToTokens(n), 'kroner']
export function normalizeDigits(typed: string): string;  // strip spaces/thin-spaces: '1 994'→'1994'
export const NUMBER_ATOMS: readonly string[];            // closed set, ≈105 (see below)
export type NumberLevelId = '0-20' | 'tiotal' | '0-99' | 'stora-tal';
export const NUMBER_LEVELS: { id: NumberLevelId; label: string;
  gen(rng: Rng): { value: number; tokens: string[]; kind: 'number'|'year'|'price' } }[];
// Range 0–9999 enforced (throw outside). Tiers per spec: 0–20 · tens 20–90 · any 0–99 · hundreds/years/prices.
```
Atom inventory (≈105 — decision #2, compound granularity): nul–tyve incl. both en/et (22) +
tredive–halvfems (7) + all 72 ental+tiotal compounds (9 units × 8 tens: enogtyve…nioghalvfems) +
hundrede, tusind, og, kroner (4). ~13 already on disk (lesson 03); tier **`tiotal` is playable day
one** (all 8 tens clips exist).

```ts
// number-audio.ts — manifest + composition
export type NumberAudioManifest = {
  atoms: Record<string, { id: string; file: string; present: boolean }>; // EVERY needed atom listed
};
// pure (unit-tested):
export function planClips(tokens: string[], m: NumberAudioManifest): string[] | null; // null ⇒ missing atom
export function levelAvailable(level: NumberLevelId, m: NumberAudioManifest): boolean;
export function atomsForLevel(level: NumberLevelId): string[];
// impure (WebAudio, not unit-tested):
export interface NumberAudioPlayer {
  canPlay(tokens: string[]): boolean;
  preload(tokens: string[]): Promise<void>;    // fetch + decodeAudioData into a Map cache
  play(tokens: string[], opts?: { gapMs?: number }): Promise<'played'|'blocked'|'cancelled'|'missing'>;
  stop(): void;
}
export function createNumberAudioPlayer(m: NumberAudioManifest): NumberAudioPlayer;
```
Playback: shared `AudioContext`, buffers fetched from `withBase('audio/' + id + '.mp3')`,
`AudioBufferSourceNode`s scheduled back-to-back with `gapMs` ≈ 90–120 ms, monotonic seq counter for
no-overlap (mirror `speech.ts`). **Never TTS.** Manifest `src/data/number-audio.json` is COMMITTED,
generated by the script's reconcile (id = `lessonAudioId(word)`, `present` from disk) — it doubles
as the user's recording checklist (word → target filename). Disabled level UI: option disabled +
note `UI.drill.numbers.missingAudio`; if NO level available → `.callout` explainer, no drill.

### 3.6 UI / a11y / mobile / theming / skeleton
- Keyboard: input auto-focused each card (respect corrective phase); Enter submits/advances;
  **R** replays audio (matches flashcards); buttons mirror every hotkey. Container
  `tabindex="-1"` + refocus pattern from FlashcardReviewer.
- `aria-live="polite"` for progress + verdict/diff summary; `role="alert"` for save errors;
  `.vh` labels on all controls; replay buttons get answer-safe `aria-label`; æøå char-helper for
  Danish inputs; `inputmode="numeric" pattern="[0-9]*"` on `/tal`; `spellcheck=false
  autocorrect=off autocapitalize=off` + `lang="da"` on Danish inputs.
- End screen: accuracy % (firstTryCorrect/answered), total time (mm:ss), best combo, missed words
  with `SpeakButton` replays, "Kör igen" (rebuild items, fresh state) — plus flashcards-style
  next-step links via `dueByDirection` (nice-to-have, cut if time).
- Skeleton: the island's `{#if !ready}` branch renders block placeholders (prompt bar + input bar +
  button row) with `background: color-mix(in oklab, var(--text) 8%, transparent)` + pulse behind
  `prefers-reduced-motion`, `.vh` "Laddar…" for AT. Rendered from SSR markup at first paint until
  `client:idle` hydration.
- Scoped `<style>` per component, existing vars only; card/CTA/badge/grades-row patterns from §2.6.

---

## 4. Files

### Create
| Path | Contents |
|---|---|
| `src/lib/char-map.ts` + `.test.ts` | ä/ö→æ/ø mapping + caret-preserving remap |
| `src/lib/letter-diff.ts` + `.test.ts` | per-letter Levenshtein diff |
| `src/lib/danish-numbers.ts` + `.test.ts` | number/year/price→words/tokens, `NUMBER_ATOMS`, levels |
| `src/lib/drill-engine.ts` + `.test.ts` | pure reducer (phases, requeue-at-end, combo, stats) |
| `src/lib/drill-srs.ts` + `.test.ts` | outcome→grade + `SrsSink` adapter |
| `src/lib/drill-modes.ts` + `.test.ts` | mode registry, `acceptedSwedish`, item builders |
| `src/lib/number-audio.ts` + `.test.ts` | manifest types + planClips/levelAvailable (pure) + player (impure) |
| `src/lib/webaudio.ts` | lazy shared AudioContext (no test — DOM) |
| `src/lib/blip.ts` | success/combo blip (no test — DOM) |
| `src/components/DrillEngine.svelte` | the one reusable island |
| `src/pages/skriv.astro` | word drill page |
| `src/pages/tal.astro` | number dictation page |
| `src/data/number-audio.json` | committed manifest (atoms w/ present flags — recording checklist) |

### Modify
| Path | Change |
|---|---|
| `src/lib/strings.ts` | `UI.nav.write`, `UI.nav.numbers`, new `UI.drill` block |
| `src/components/Nav.astro` | two `links` entries (withBase, `match:'prefix'`) |
| `src/lib/vocab.ts` | additive `Card.acceptedSv?: string[]` + parse optional `accepted_sv` column |
| `src/lib/speech.ts` | additive `preloadClip(url)` |
| `scripts/generate-tts.ts` | `--numbers` synth task + `--reconcile-only` (no Azure key needed) writing `number-audio.json` |
| `scripts/check-content.mjs` | ERROR if manifest `present` flags drift vs tracked files; WARN listing disabled levels |

**No changes** to `session.ts`, `srs.ts`, `storage.ts`, `FlashcardReviewer.svelte` — zero regression
surface on the existing 76 tests. Rationale for a new `drill-engine.ts` over extending `session.ts`:
flashcards' `reinsertAgain` (+6) ≠ drill requeue-at-end; combo/corrective/hint semantics don't belong
in the flashcard flow; nothing is forked (`buildQueue`/`matchTyped`/`normalizeTyped` are imported).

## 5. Phases (each ends: `npx astro check` clean · `npm test` green · from Phase 3 also `npm run build`)

1. **Pure foundations** — `danish-numbers`, `char-map`, `letter-diff` + tests.
2. **Drill logic** — `drill-engine`, `drill-srs`, `drill-modes` (word modes; number mode stubbed
   disabled), `vocab.ts` `acceptedSv` + tests.
3. **Word drill UI** — `webaudio`, `blip`, `preloadClip`, `DrillEngine.svelte`, `skriv.astro`,
   `strings.ts`, `Nav.astro`. Manual dev pass: keyboard-only run of all 3 modes; mid-string caret
   remap; diff + glossary + forced retype; hint flow; SRS round-trip vs `/flashcards` (inspect
   `dansk4svensk:srs:v1` keys `::produce/::listen/::recognize`); dark mode; skeleton.
4. **Number audio infra** — `NUMBER_ATOMS`-driven `--numbers`/`--reconcile-only` in
   `generate-tts.ts`; run reconcile-only (no Azure) → commit `number-audio.json` (existing lesson-03
   atoms show `present: true`); `number-audio.ts` + tests; `check-content.mjs` guard.
   **Do NOT run Azure synthesis — user's call (record or run `npm run tts -- --numbers` themselves).**
5. **Number drill + polish** — number mode, `tal.astro`, level gating + disabled notes, preload,
   numeric input, skeleton polish. Manual: each level (tiotal works day one), degradation path
   (remove an atom from a local manifest copy), mobile-viewport keypad; then `npm run build` +
   `npm run preview` click-through under `/danishproject/` (base-path-safe URLs + clip fetches).

## 6. Test strategy (Vitest, co-located, injected clock/rng/fakes; `noShuffle = () => 0.999999`)

- `danish-numbers.test.ts` — 0–20; vigesimal tens; ental-first 27/42/68/99; hundreds 100/101/342;
  thousands 1000/2024/9999; years 1994/2024; prices; `normalizeDigits('1 994')`; throws outside
  0–9999; **closure property**: every token of every n ∈ 0..9999 + year/price outputs ∈
  `NUMBER_ATOMS` (this guarantees the manifest lists every needed clip).
- `char-map.test.ts` — ä→æ/ö→ø/uppercase; å untouched; idempotence; `remapWithCaret` caret at
  start/middle/end, with and without mapped chars.
- `letter-diff.test.ts` — exact match; substitution (`læse` vs `läse` flags the æ position — the
  Swedish-letter regression guard); missing; extra; empty typed; normalization-before-diff.
- `drill-engine.test.ts` — combo/bestCombo; wrong → combo reset + corrective gates advance +
  requeue AT END + cap 2; hint (reveal) → scored miss + corrective; corrective retype ungraded;
  size slice (default 20); accuracy/time stats; done; immutability.
- `drill-srs.test.ts` — correct→Good(3), wrong/hint→Again(1); exact `(vocabId, direction, grade,
  now)` on a fake `SrsSink`; `WriteResult` propagation incl. quotaExceeded; integration with real
  `new Store(memoryKV())` (correct leaves `New` state; wrong keeps lapse behavior).
- `drill-modes.test.ts` — `acceptedSwedish` ('hoppa (även: brista, sprängas)'→3 answers;
  'temporär / temporärt'→both; `acceptedSv` override wins); buildItems delegates to `buildQueue`
  (due-first + new-budget visible via fake `SrsView`); dictation filters clip-less cards; per-mode
  `matches`; `audioFor` shapes.
- `number-audio.test.ts` — `planClips` resolves/nulls on missing; `levelAvailable` per tier
  (fixture manifests); `atomsForLevel('0-20')` exact set; **committed-manifest drift guard**: every
  id = `lessonAudioId(word)`, every key ∈ `NUMBER_ATOMS`, every atom present in the file.
- `vocab.test.ts` (extend) — `accepted_sv` parsing (present/absent/multi-value).

Not unit-tested (repo policy — pure lib only): the island, blip/webaudio, player half of
number-audio, preloadClip → covered by Phase 3/5 manual passes.

## 7. Definition of done
`/skriv` + `/tal` in nav; one shared engine island; word results land in the existing SRS store
(records visible to and from `/flashcards`); numbers clip-composed only, levels degrade gracefully;
keyboard-only operable; mobile numeric keypad; dark/light via vars only; skeleton-first load; all
copy Swedish in `strings.ts`. `npx astro check` + `npm test` (76 existing + ~70 new) +
`npm run check:content` + `npm run build` all green; `package.json` dependencies unchanged.
Final e2e: `npm run preview`, complete one full session per mode under `/danishproject/`.

## 8. Risks & notes
- Number clips absent until the user records or runs the generator — tier `tiotal` playable
  immediately from existing lesson clips; other tiers ship disabled with a Swedish note. Phases 1–3
  (word drill) are independently shippable.
- Autoplay: first clip + blips need a user gesture — the "Starta" button provides it; `'blocked'`
  outcomes surface a ▶ Spela button (mirror flashcards).
- Composed prosody: compound atoms (decision #2) keep 21–99 natural; tune `gapMs` by ear in Phase 5.
- da→sv shares `recognize` records with easier multiple-choice recognize — accepted trade-off.
- Praksis dictation covers only the 2537 clip-backed cards (deliberate filter).
- `yearToTokens` uses the formal "nitten hundrede og …" reading — flag to the user for
  teacher-verification (colloquial drops "hundrede og").
- `exactOptionalPropertyTypes` is on — follow `fromFsrs`'s conditional-assign pattern for optional
  fields (e.g. `acceptedSv`, `suspended`).

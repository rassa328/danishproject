---
title: Redesign corrections — round 4 (stød waves, drill, flashcards, ordlista search, zen hexagons)
owner: rasmussamuelson
branch: redesign-port
status: done
write_set:
  - src/components/MinimalPairs.svelte
  - src/components/MinimalPairDrill.svelte
  - src/components/FlashcardReviewer.svelte
  - src/components/OrdlistaSearch.svelte
  - src/pages/ordlista.astro
  - src/components/Zen.svelte
  - src/lib/strings.ts
  - src/lib/char-map.ts
verify: npm test && npx astro check && npx svelte-check && npm run build
opened: 2026-07-12
---

# Redesign corrections — round 4 (stød waves, drill, flashcards, ordlista search, zen hexagons)

## Context
The redesign is live on `main` (PR #3) and the first correction round shipped as PR #4. A second
design review surfaced a further batch of divergences from the handoff templates plus several net-new
refinements. This round is presentation/copy only — all data, SRS, audio-id, and keyboard behavior stay
intact. Worktree: `/Users/rasmussamuelson/claude/.claude/worktrees/redesign-port` (branch
`redesign-port`). Templates (read-only, main checkout):
`/Users/rasmussamuelson/claude/design_handoff_danish_site_redesign/*.dc.html`.

Grounding (verified this session): `--ok` (#7fb98e/#2e7d4f), `--bars` (#8a8172/#aca496, the template's
"pure gray" voice-graph color), `--mut4` (#6b6357, the darker "enter" hint tone), and `--bg` (solid) all
exist in `src/styles/global.css`. What is in the templates vs net-new is noted per item below.

---

## 1. Stød lesson — per-word sound waves  ·  `src/components/MinimalPairs.svelte`
Today every "utan stød" word reuses one shared `UTAN` bar array and every "med stød" word reuses one
`MED` array (`:27-39`) → only 2 visible glyph shapes. Give **each displayed word its own deterministic
waveform**:
- Replace the two module constants with a generator `barsFor(word, withDip)` that seeds a tiny
  string-hash PRNG (mulberry32-style, pure/deterministic so SSR and client markup match — same
  discipline as `src/lib/waveform.ts`) from the word text and emits 5–6 bars with pleasant heights.
- **Preserve the semantic invariant**: med-stød words (`pair.b`, `withDip=true`) keep exactly one
  `dip:true` bar (rendered `var(--red)` — the stød dip) placed mid-glyph; utan-stød words have none.
- The render loop, keying (`keyA`/`keyB`), `animation-delay: j*55ms` sweep, and `.bar.dip` CSS
  (`:65-107`, `:185-199`) stay as-is — only the source array becomes `barsFor(pair.a,false)` /
  `barsFor(pair.b,true)`. Scope: stød page only (this component is used only there).

## 2. Snabbkoll drill — remove the "rätt!" text  ·  `src/components/MinimalPairDrill.svelte`
- Delete the `<p class="verdict">…{answered ? T.correct : T.wrong(...)}</p>` (`:179-184`). Keep the Nästa/
  Visa-resultat button.
- The green outline on the correct choice (`.choice.is-answer { outline: 2px solid var(--correct) }`,
  `:168`, `:225-228`) stays. To honor "green/red is enough", **add a red outline on a wrong pick**
  (`class:is-wrong` on the picked-but-wrong button → `outline: 2px solid var(--red)`), since no red
  indicator exists today.
- A11y: the removed `<p role="status">` was the only spoken feedback — add a visually-hidden
  `role="status"` announcing "Rätt"/"Fel" so screen readers still get the verdict.

## 3. Flashcards  ·  `src/components/FlashcardReviewer.svelte` + `src/lib/strings.ts`

3a. **æ/ø/å row placement + drop the helper text** (`:754-775`). Move the `.charbar` to sit *inside*
   the `<form>`, directly under the `<input>` and *above* the reveal button (template order:
   input → æøå → visa svar). Remove the `<span class="char-help">{T.charHelper}</span>` (symbols speak
   for themselves). Match template spacing: `margin-top:18px; gap:18px; align-items:baseline`, buttons
   `15px var(--mut2)` → hover `var(--ink)`.

3b. **"enter" key hint on every reveal button** (template `Flashcards.dc.html:135,150`). The three reveal
   buttons (`{T.reveal}` :768, `{T.speakReveal}` :746, `{T.listenSentenceReveal}` :751) render
   `{label} <span class="key" aria-hidden="true">enter</span>`. Strings go **lowercase, no parens**:
   `reveal` → `'visa svar'`, `speakReveal` → `'hör uttalet'`, `listenSentenceReveal` → `'visa meningen'`.
   New `.key` CSS: `font-family: var(--font-mono); font-size:10px; color: var(--mut4)`.

3c. **Remove the listen prompts** (`:702`). Drop the `<p class="prompt-caption">` for `listen` /
   `listen-sentence` (removes "lyssna och skriv ordet" / "lyssna på meningen"). Leave the strings unused
   or delete the keys.

3d. **Larger pure-gray voice graph in listen modes** (`:701-725`). Replace `<Waveform size="icon">`
   (:714,:719) inside the replay button with a larger hand-rolled span-bar graph matching the template
   (`Flashcards.dc.html:118-125`): bars `width:4.5px; border-radius:3px; background: var(--bars)`,
   container `gap:4px; height≈52px`, pulse via `{#key promptPulse}` + staggered `55ms` `wfPulse`. Word
   graph = 7 bars `[10,22,34,26,34,18,10]`; **sentence graph = longer** (~12–13 bars, per user override —
   template uses the same 7 for both). Keep the button + its answer-safe `aria-label`.

3e. **0.75× control** (`:722`, and the speak-reveal `.slow` at :784). Replace the `Långsammare (0,75×)`
   label with a small subtle **"0.75x"** (`.slow` restyled: `var(--font-mono); ~11px; var(--mut4);
   letter-spacing`) placed **right below the graph**. Render it for **both** `listen` and
   `listen-sentence` (today only sentence). New string `slowSpeed: '0.75x'`.

3f. **Wordless answer feedback** — remove the verdict block (`:778-783`) and implement the user's spec.
   Track an `attempt` string (typed value for produce/listen/cloze; the chosen option for recognize —
   set it in `choose()`/`submit()`). Applies only to **input/choice modes** (write, recognize, listen,
   cloze); speak & listen-sentence render no feedback element.
   - **Correct**: a green hairline centered above the revealed word — `30px×2px; border-radius:1px;
     background/box-shadow: var(--ok) (0 0 12px)`, `margin-top:~26px`; animate
     `scaleX(0)/opacity0 → scaleX(1.35)@60% → scaleX(1)`, `550ms cubic-bezier(.2,.8,.3,1)`,
     `transform-origin:center`. Also the `.answer` block **rises in**: `translateY(10px)/opacity0 → 0/1`,
     `480ms` same easing, `120ms` delay.
   - **Wrong with an attempt**: show the attempt above the word — `17px; font-weight:300; var(--mut3);
     line-through var(--red)`; no animation.
   - **Empty wrong**: render nothing (revealed answer alone is the feedback).
   - A11y: keep a visually-hidden `aria-live` verdict ("Rätt"/"Fel").
   Add CSS keyframes `hairlineIn`, `answerRise`; class the `.answer` `.correct` when applicable.

3g. **Cloze Swedish hint = clickable, fades up** (`:726-729`). The Swedish example (`.prompt-ex`,
   `current.swedish [— exampleSv]`) becomes hidden behind a subtle **"ledtråd"** text button (new string
   `clozeHint: 'ledtråd'`); clicking sets `hintOpen=true` (reset per card) and reveals the sentence with
   a fade-up (`translateY(6px)/opacity0 → 0/1`, ~320ms). Net-new (template shows it statically).

3h. Reveal layout otherwise unchanged (answer word + glyph, example, OBS, grade pills). `onContainerKey`
   Enter-grades already correct (`:438-450`) — only ensure `attempt` is set before reveal.

## 4. Ordlista search  ·  `src/components/OrdlistaSearch.svelte` + `src/pages/ordlista.astro` + a fold util
4a. **Bidirectional Nordic letter fold** — override the current "keep æ/ø/å significant" `norm`
   (`OrdlistaSearch :48-59`). Add `foldNordic(s)` (new small helper, e.g. in `src/lib/char-map.ts`)
   that maps **both** Swedish and Danish variants to one canonical letter (ä↔æ, ö↔ø; å already shared)
   after NFC+lowercase, and apply it to both the query and each field. So "smör" finds "smør" and vice
   versa (per user: "map swedish to danish letters and the opposite").
4b. **Hide the sets while searching; show only results** — wrap `sections.map(...)` and the `.list-note`
   in a container (id) in `ordlista.astro`; in `OrdlistaSearch` an `$effect` toggles their visibility
   when `q.trim()` is non-empty (results-only view). Restore on clear.
4c. **Results use the normal ordlista look** — enrich `searchStarter` (add `exampleDa/exampleSv/note/
   tags`; keep the same fields off the lazy praksis fetch) and render results as VocabTable-style rows
   (Danish bold + example / Swedish + example / note, hairline dividers — mirror `VocabTable.astro`
   markup+CSS) instead of the badge list. Drop the `.origin` badge; keep audio via `SpeakButton`. No
   träna button in search (already the case — unchanged).

## 5. Zen category grid  ·  `src/components/Zen.svelte`
5a. **Kill the hover/focus box** (root cause found): `.zen button:focus-visible { outline:1px solid
   var(--mut3); … }` (`:1061-1065`) out-specifies the reset `.cat:focus-visible{outline:none}`
   (`:1070-1077`). Fix by raising the reset specificity — `.zen .opt:…, .zen .src:…, .zen .cat:…,
   .zen .begin:…` for both `:focus` and `:focus-visible` — so options/cats/deck cells show **no box**,
   only their red line + ink text. Verify across every option/deck/category on click and arrow-nav.
5b. **Elongated flat-top hexagon cells** (the "delegate extra power" item — net-new; no clip-path exists
   anywhere in the repo/templates). Shape `.cat` as a wide flat-top hexagon via `clip-path:
   polygon(10px 0, calc(100%-10px) 0, 100% 50%, calc(100%-10px) 100%, 10px 100%, 0 50%)` drawn on a
   `::before` background layer (so the text itself is never clipped), with a 1px hex ring via the
   standard two-layer clip trick (ring color over a `var(--bg)`-filled inset hexagon). Resting: faint
   ring + `var(--mut2)` text. Hover/hot (`hotId`): text → `var(--ink)` (highlighted white) and the ring/
   line → `var(--red)` — no box. Keep 3 columns (`DECK_COLS=3`); widen cells/padding and tune
   `.cat-grid` gaps so they read as elongated hexagons. "Won't be perfect — that's the charm": iterate
   visually (screenshots, both themes + mobile) until it reads right. The `fler…/färre` cell keeps the
   hexagon (italic text). `zen.ts` + `zen.test.ts` stay untouched (island-only concern).

---

## Execution — dynamic workflow
Per the request to use dynamic workflows and hand over a 100% product:
1. **Implement** the five areas in this worktree, committing per area (files are largely disjoint;
   `strings.ts` is the only file touched by more than one area — sequence those edits).
2. **Hexagon R&D** (5b): a short design-exploration workflow — 2–3 candidate clip-path/ring
   implementations rendered headlessly and judged by screenshots (both themes) — graft the best.
3. **Verification fan-out** (dynamic workflow): parallel agents screenshot every touched screen ×
   {dark, light} × {desktop, 375px} and check against this plan's spec, reusing
   `/Users/rasmussamuelson/.claude/jobs/cd71c729/tmp/shot.mjs`. Fix every finding, re-verify.
   - Stød lesson: each word shows a distinct wave; med-stød keeps the red dip; playback unchanged.
   - Snabbkoll: no "rätt!" text; green on correct / red on wrong; result flow completes.
   - Flashcards (every mode): æøå directly under the input, no helper text; reveal buttons read
     "visa svar/hör uttalet/visa meningen" + darker-mono "enter"; listen modes show the larger gray
     graph (longer for sentence) with "0.75x" below; no listen prompts; correct → green hairline +
     rise-in; wrong → struck-through attempt; empty-wrong → nothing; cloze Swedish hint fades up on
     click; Enter/1–4 grading intact.
   - Ordlista: searching hides the themed sections and shows only results in the normal row look;
     "smör"↔"smør" cross-matches; träna absent in search, present per theme otherwise.
   - Zen: category grid renders as elongated flat-top hexagons; hover/select shows red line + white
     text with **no box**; arrow-nav + click-to-select + fler/färre + full drill flow still work.
4. **Gates**: `npm test` (298, incl. `zen.test.ts`), `npx astro check` (0 errors), `npx svelte-check`
   (9 known baseline, no new), `npm run build` (exit 0).
5. **Handover report**: write a report doc under `docs/plans/` stating the goal, every change, and the
   verification evidence, structured for an independent AI to re-verify. Commit this plan to
   `docs/plans/active/` before implementing and move it to `done/` when finished; push to PR #4.

## Key interpretation choices (surfaced for review)
- **0.75×** added to **both** listen modes (not sentence-only).
- **Feedback**: implementing the user's exact green-hairline / strikethrough spec (not the template's
  text feedback); also adding a **red outline on wrong picks** in the snabbkoll drill (green/red parity).
- **Search results** rendered in the full VocabTable row look (examples/notes included) with sections
  hidden while a query is active; letter fold made **bidirectional**, deliberately overriding the old
  "keep æ/ø/å significant" policy.
- **Hexagon** implemented as a clip-path flat-top hexagon with a red-line + white-text selected state
  (no box); accepted as "imperfect — that's the charm" and tuned via screenshots.

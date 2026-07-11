// Build-time content integrity check (wired as npm `prebuild` + `pretest`).
// Astro/Zod already validate each lesson's frontmatter shape; this script adds
// the CROSS-references Zod can't see:
//   - every non-empty lesson `vocabTags` resolves to >=1 card    (ERROR: dead link)
//   - every `prerequisites` id points at a real lesson file      (ERROR)
//   - starter-deck audio refs resolve to real clips              (ERROR: curated
//     stød audio is the starter deck's core value; a broken ref must not ship)
//   - praksis-deck audio refs resolve to real clips              (WARN: long-tail
//     deck, a missing clip degrades to Web Speech TTS)
//   - ids duplicated across starter ∪ praksis agree on danish+pos (ERROR: the
//     runtime dedupes by id preferring the starter copy, so a praksis row that
//     shares an id but differs in content would silently diverge/vanish)
// Audio existence: locally against the working tree (existsSync); in CI against
// `git ls-files` — a Pages build starts from a clean checkout, so an UNTRACKED
// local mp3 that satisfies existsSync would still 404 in production.
// Exits non-zero on any error so a broken link can never ship.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import Papa from 'papaparse';
// Node >=22.18 strips types natively, so importing the runtime id helpers keeps
// this check byte-identical with the ids the app derives (no copied hash).
import { deriveId, nfc } from '../src/lib/audio-id.ts';
import { numberToTokens, priceToTokens, yearToTokens } from '../src/lib/danish-numbers.ts';

const root = fileURLToPath(new URL('..', import.meta.url));
const lessonsDir = root + 'src/content/lessons';
const publicDir = root + 'public';
const DECKS = [
  { name: 'starter', path: root + 'src/data/vocab/starter-deck.csv', missingAudio: 'error' },
  { name: 'praksis', path: root + 'src/data/vocab/praksis-deck.csv', missingAudio: 'warn' },
];

const errors = [];
const warnings = [];

// ---- load cards (same row validations for every deck CSV) ----
const tagSet = new Set(); // union: the runtime tag filter runs over starter ∪ praksis
const errorRefs = new Set(); // audio refs that must exist
const warnRefs = new Set(); // audio refs that merely warn when missing
const idInfo = new Map(); // card id -> { deck, danish, pos } (first occurrence)
let crossDupes = 0;

for (const deck of DECKS) {
  // Normalize CRLF→LF before parsing: .gitattributes commits these as LF, but a
  // tool that wrote CRLF can leave the WORKING TREE with mixed endings, which
  // makes Papa mis-detect the newline and mangle the last row (seen in the
  // interrupted TTS run). Validate the canonical content git will store.
  const csv = readFileSync(deck.path, 'utf8').replace(/\r\n/g, '\n');
  const { data: rows } = Papa.parse(csv, { header: true, skipEmptyLines: true });
  for (const r of rows) {
    for (const t of (r.tags || '').split(/[|,]/).map((s) => s.trim()).filter(Boolean)) tagSet.add(t);
    for (const a of [r.audio, r.audio_example]) {
      if (a && a.trim()) (deck.missingAudio === 'error' ? errorRefs : warnRefs).add(a.trim());
    }
    const danish = nfc(r.danish);
    if (!danish) continue;
    const pos = nfc(r.pos ?? '');
    const id = nfc(r.id) || deriveId(danish, pos); // same resolution as vocab.ts
    const prev = idInfo.get(id);
    if (!prev) {
      idInfo.set(id, { deck: deck.name, danish, pos });
    } else if (prev.deck !== deck.name) {
      // Cross-deck duplicate ids are EXPECTED (runtime dedupes preferring
      // starter) — but only when both rows are the very same word.
      crossDupes++;
      if (prev.danish !== danish || prev.pos !== pos) {
        errors.push(
          `${deck.name}: id ${id} duplicates a ${prev.deck} card but the rows differ: ` +
            `"${prev.danish}" (${prev.pos}) vs "${danish}" (${pos}). ` +
            `Cross-deck duplicates must be identical in danish+pos.`,
        );
      }
    }
  }
}

// ---- load lessons ----
const files = readdirSync(lessonsDir).filter((f) => /\.mdx?$/.test(f));
const lessonIds = new Set(files.map((f) => f.replace(/\.mdx?$/, '')));

for (const file of files) {
  const raw = readFileSync(`${lessonsDir}/${file}`, 'utf8');
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) {
    errors.push(`${file}: no frontmatter block`);
    continue;
  }
  let fm;
  try {
    fm = parseYaml(m[1]) ?? {};
  } catch (e) {
    errors.push(`${file}: invalid YAML frontmatter (${e.message})`);
    continue;
  }

  for (const tag of fm.vocabTags ?? []) {
    if (!tagSet.has(tag)) {
      errors.push(`${file}: vocabTags '${tag}' matches 0 cards (dead "Träna orden" link). Tag cards or remove it.`);
    }
  }
  for (const pre of fm.prerequisites ?? []) {
    if (!lessonIds.has(pre)) {
      errors.push(`${file}: prerequisites '${pre}' is not an existing lesson id.`);
    }
  }
}

// ---- audio existence ----
// In CI validate against TRACKED files: an untracked local mp3 must not satisfy
// the check, because the deployed build won't have it. Locally the working tree
// is the truth (a TTS run's fresh clips are legitimately not yet committed).
let hasAudio = (ref) => existsSync(`${publicDir}/${ref}`);
if (process.env.CI && existsSync(`${root}.git`)) {
  const out = execFileSync('git', ['ls-files', '-z', '--', 'public/audio'], {
    cwd: root,
    encoding: 'utf8',
  });
  const tracked = new Set(out.split('\0').filter(Boolean));
  hasAudio = (ref) => tracked.has(`public/${ref}`);
}

let missingError = 0;
let missingWarn = 0;
for (const ref of errorRefs) {
  if (hasAudio(ref)) continue;
  missingError++;
  if (missingError <= 10) errors.push(`starter: referenced audio missing: public/${ref}`);
}
if (missingError > 10) errors.push(`…and ${missingError - 10} more missing starter audio refs`);
for (const ref of warnRefs) {
  if (errorRefs.has(ref) || hasAudio(ref)) continue; // already errored above
  missingWarn++;
  if (missingWarn <= 10) warnings.push(`praksis: audio file missing (falls back to TTS): public/${ref}`);
}
if (missingWarn > 10) warnings.push(`…and ${missingWarn - 10} more missing praksis audio files`);

// ---- number-audio manifest ----
// The /tal drill composes numbers from committed atom clips (never TTS) and
// gates its levels on the manifest's `present` flags. A flag that drifts from
// reality either 404s at runtime (true without a clip) or keeps a playable
// level needlessly disabled (false with one) — both are reconcile bugs, so
// they ERROR. Missing recordings themselves are expected (the manifest doubles
// as the recording checklist) and only WARN — listing WHICH levels the current
// flags keep disabled (plan §4), so the recording loop's feedback is in the
// build output. Same tracked-vs-disk rule as above: in CI an untracked local
// clip must not count as present.
const numberManifestPath = root + 'src/data/number-audio.json';
if (!existsSync(numberManifestPath)) {
  errors.push('src/data/number-audio.json missing — run: npm run tts -- --numbers --reconcile-only');
} else {
  const { atoms } = JSON.parse(readFileSync(numberManifestPath, 'utf8'));
  let drift = 0;
  let unrecorded = 0;
  for (const [word, entry] of Object.entries(atoms)) {
    const onDisk = hasAudio(`audio/${entry.file}`);
    if (entry.present !== onDisk) {
      drift++;
      if (drift <= 10) {
        errors.push(
          entry.present
            ? `number-audio: '${word}' marked present but public/audio/${entry.file} is missing/untracked`
            : `number-audio: '${word}' has a clip at public/audio/${entry.file} but is marked present:false`,
        );
      }
    }
    if (!entry.present) unrecorded++;
  }
  if (drift > 10) errors.push(`…and ${drift - 10} more number-audio present-flag drifts`);
  if (drift > 0) errors.push('number-audio manifest is stale — re-run: npm run tts -- --numbers --reconcile-only');
  if (unrecorded > 0) {
    // Which /tal levels the current `present` flags keep disabled. The atom
    // ranges MIRROR number-audio.ts atomsForLevel (that module pulls in the
    // browser-only url.ts/webaudio.ts, so it can't be imported under plain
    // Node); the gen-sweep unit test guards the range sync on the app side.
    const levelNeeds = new Map();
    const need = (level, tokens) => {
      const set = levelNeeds.get(level) ?? new Set();
      for (const t of tokens) set.add(t);
      levelNeeds.set(level, set);
    };
    for (let n = 0; n <= 20; n++) need('0-20', numberToTokens(n));
    for (let n = 20; n <= 90; n += 10) need('tiotal', numberToTokens(n));
    for (let n = 0; n <= 99; n++) need('0-99', numberToTokens(n));
    for (let n = 100; n <= 999; n++) need('stora-tal', numberToTokens(n));
    for (let y = 1900; y <= 2099; y++) need('stora-tal', yearToTokens(y));
    for (let kr = 2; kr <= 999; kr++) need('stora-tal', priceToTokens(kr));
    const disabled = [...levelNeeds]
      .filter(([, set]) => ![...set].every((w) => atoms[w]?.present === true))
      .map(([id]) => id);
    warnings.push(
      `number-audio: ${unrecorded} of ${Object.keys(atoms).length} atoms lack clips — ` +
        (disabled.length
          ? `disabled /tal levels: ${disabled.join(', ')}`
          : 'all /tal levels are still playable'),
    );
  }
}

// ---- report ----
for (const w of warnings) console.warn(`⚠ ${w}`);
if (errors.length) {
  for (const e of errors) console.error(`✖ ${e}`);
  console.error(`\nContent check FAILED: ${errors.length} error(s).`);
  process.exit(1);
}
console.log(
  `✓ Content check passed: ${files.length} lessons, ${tagSet.size} vocab tags, ` +
    `${idInfo.size} distinct card ids (${crossDupes} expected cross-deck duplicates), ` +
    `${errorRefs.size + warnRefs.size} audio refs (${missingWarn} missing → TTS fallback).`,
);

// Build-time content integrity check (wired as npm `prebuild` + `pretest`).
// Astro/Zod already validate each lesson's frontmatter shape; this script adds
// the CROSS-references Zod can't see:
//   - every non-empty lesson `vocabTags` resolves to >=1 card   (ERROR: dead link)
//   - every `prerequisites` id points at a real lesson file     (ERROR)
//   - every card audio path exists under public/                (WARN: falls back to TTS)
// Exits non-zero on any error so a broken link can never ship.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import Papa from 'papaparse';

const root = fileURLToPath(new URL('..', import.meta.url));
const lessonsDir = root + 'src/content/lessons';
const csvPath = root + 'src/data/vocab/starter-deck.csv';
const publicDir = root + 'public';

const errors = [];
const warnings = [];

// ---- load cards ----
const csv = readFileSync(csvPath, 'utf8');
const { data: rows } = Papa.parse(csv, { header: true, skipEmptyLines: true });
const tagSet = new Set();
const audioPaths = new Set();
for (const r of rows) {
  for (const t of (r.tags || '').split(/[|,]/).map((s) => s.trim()).filter(Boolean)) tagSet.add(t);
  for (const a of [r.audio, r.audio_example]) if (a && a.trim()) audioPaths.add(a.trim());
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
  const id = file.replace(/\.mdx?$/, '');

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

// ---- audio existence (warn-only: missing audio degrades to TTS) ----
let missingAudio = 0;
for (const a of audioPaths) {
  if (!existsSync(`${publicDir}/${a}`)) {
    missingAudio++;
    if (missingAudio <= 10) warnings.push(`audio file missing: public/${a}`);
  }
}
if (missingAudio > 10) warnings.push(`…and ${missingAudio - 10} more missing audio files`);

// ---- report ----
for (const w of warnings) console.warn(`⚠ ${w}`);
if (errors.length) {
  for (const e of errors) console.error(`✖ ${e}`);
  console.error(`\nContent check FAILED: ${errors.length} error(s).`);
  process.exit(1);
}
console.log(
  `✓ Content check passed: ${files.length} lessons, ${tagSet.size} vocab tags, ` +
    `${audioPaths.size} audio refs (${missingAudio} missing → TTS fallback).`,
);

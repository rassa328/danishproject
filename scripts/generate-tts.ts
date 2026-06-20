// Pre-generate native Danish neural audio with Azure AI Speech.
//
// GitHub Pages has no runtime backend, so we generate MP3s once here, commit
// them under public/audio/, and the app plays the clips (speak() is clip-first,
// falling back to Web Speech only when a clip is missing). Run with:
//
//   AZURE_SPEECH_KEY=… AZURE_SPEECH_REGION=westeurope npm run tts
//
// Idempotent: existing clips are skipped (no API call). Pass --force to redo all.
// After generating, the vocab CSV's `audio` / `audio_example` columns are
// rewritten to base-relative paths the UI resolves via withBase().

import { readFile, writeFile, mkdir, access, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Papa from 'papaparse';
import { deriveId, nfc, audioKey, lessonAudioId } from '../src/lib/vocab.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CSV_PATH = path.join(ROOT, 'src/data/vocab/starter-deck.csv');
const AUDIO_DIR = path.join(ROOT, 'public/audio');
const LESSONS_DIR = path.join(ROOT, 'src/content/lessons');
const MANIFEST_PATH = path.join(ROOT, 'src/data/lesson-audio.json');

const KEY = process.env.AZURE_SPEECH_KEY;
const REGION = process.env.AZURE_SPEECH_REGION;
const VOICE = process.env.AZURE_SPEECH_VOICE || 'da-DK-ChristelNeural';
const FORCE = process.argv.includes('--force');

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const exists = (p: string) =>
  access(p).then(
    () => true,
    () => false,
  );

const escapeXml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!);

/** Azure REST TTS → MP3 bytes. Retries with backoff on 429 (rate limit). */
async function synthesize(text: string): Promise<Buffer> {
  // rate -5% matches the slightly-slowed Web Speech fallback (rate 0.95).
  const ssml =
    `<speak version='1.0' xml:lang='da-DK'>` +
    `<voice name='${VOICE}'><prosody rate='-5%'>${escapeXml(text)}</prosody></voice>` +
    `</speak>`;
  const url = `https://${REGION}.tts.speech.microsoft.com/cognitiveservices/v1`;

  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Ocp-Apim-Subscription-Key': KEY!,
        'Content-Type': 'application/ssml+xml',
        'X-Microsoft-OutputFormat': 'audio-24khz-48kbitrate-mono-mp3',
        'User-Agent': 'dansk-for-svenskar',
      },
      body: ssml,
    });
    if (res.ok) return Buffer.from(await res.arrayBuffer());
    if (res.status === 429 && attempt < 5) {
      const wait = (Number(res.headers.get('retry-after')) || 2 ** attempt) * 1000;
      console.warn(`  429 rate-limited, waiting ${wait}ms…`);
      await sleep(wait);
      continue;
    }
    const body = await res.text().catch(() => '');
    throw new Error(`Azure TTS ${res.status} ${res.statusText}: ${body.slice(0, 200)}`);
  }
}

/** Turn a span's raw markdown inner text into the same string the browser sees
 *  as `el.textContent` after rendering: decode entities, drop any nested tags,
 *  and strip markdown emphasis/code markers. (Our lesson spans hold plain text,
 *  so this is mostly defensive; audioKey() then handles quotes/whitespace.) */
function spanInnerToText(inner: string): string {
  return inner
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/<[^>]+>/g, '')
    .replace(/[*`]/g, '');
}

/** Scan every lesson for `<span lang="da">…</span>` and return the unique Danish
 *  texts (words, number forms, whole example sentences). */
async function collectLessonSpanTexts(): Promise<string[]> {
  const entries = await readdir(LESSONS_DIR);
  const files = entries.filter((f) => f.endsWith('.md') || f.endsWith('.mdx'));
  const re = /<span lang=["']da["']>([\s\S]*?)<\/span>/gi;
  const seen = new Map<string, string>(); // audioKey -> display text
  for (const file of files) {
    const md = await readFile(path.join(LESSONS_DIR, file), 'utf8');
    for (const m of md.matchAll(re)) {
      const text = spanInnerToText(m[1] ?? '');
      const key = audioKey(text);
      if (key && !seen.has(key)) seen.set(key, text);
    }
  }
  return [...seen.values()];
}

async function main() {
  if (!KEY || !REGION) {
    console.error('Missing AZURE_SPEECH_KEY and/or AZURE_SPEECH_REGION. See .env.example.');
    process.exit(1);
  }

  const csv = await readFile(CSV_PATH, 'utf8');
  const parsed = Papa.parse<Record<string, string>>(csv, { header: true, skipEmptyLines: true });
  const rows = parsed.data;
  await mkdir(AUDIO_DIR, { recursive: true });

  // Build the work list: a word clip per card, plus an example clip when the
  // card has a Danish example sentence. Filenames use the same id the app does.
  type Clip = { file: string; text: string };
  const clips: Clip[] = [];
  for (const row of rows) {
    const danish = nfc(row.danish);
    if (!danish) continue;
    const id = deriveId(danish, row.pos ?? '');
    clips.push({ file: path.join(AUDIO_DIR, `${id}.mp3`), text: danish });
    const example = nfc(row.example_da);
    if (example) clips.push({ file: path.join(AUDIO_DIR, `${id}-ex.mp3`), text: example });
  }

  // Lesson prose: a clip per unique <span lang="da"> text so each Danish word,
  // number form, and whole example sentence in the lessons is click-to-hear.
  // Keyed by lessonAudioId (pos-less) so the in-browser island resolves the same
  // filename from the rendered DOM text. Distinct from deck ids (which carry pos).
  const lessonIds = new Set<string>();
  for (const text of await collectLessonSpanTexts()) {
    const id = lessonAudioId(text);
    if (lessonIds.has(id)) continue;
    lessonIds.add(id);
    clips.push({ file: path.join(AUDIO_DIR, `${id}.mp3`), text });
  }

  let generated = 0;
  let skipped = 0;
  let failed = 0;
  for (const clip of clips) {
    const name = path.basename(clip.file);
    if (!FORCE && (await exists(clip.file))) {
      skipped++;
      continue;
    }
    try {
      const mp3 = await synthesize(clip.text);
      await writeFile(clip.file, mp3);
      generated++;
      console.log(`✓ ${name}  "${clip.text.slice(0, 48)}"`);
      await sleep(120); // gentle throttle to stay well under rate limits
    } catch (err) {
      failed++;
      console.error(`✗ ${name}: ${(err as Error).message}`);
    }
  }

  // Rewrite the CSV so each column reflects what's actually on disk (a failed or
  // missing clip leaves its cell empty, and the app falls back to Web Speech).
  for (const row of rows) {
    const danish = nfc(row.danish);
    if (!danish) continue;
    const id = deriveId(danish, row.pos ?? '');
    row.audio = (await exists(path.join(AUDIO_DIR, `${id}.mp3`))) ? `audio/${id}.mp3` : '';
    const hasEx = nfc(row.example_da) && (await exists(path.join(AUDIO_DIR, `${id}-ex.mp3`)));
    row.audio_example = hasEx ? `audio/${id}-ex.mp3` : '';
  }

  // Explicit field list keeps the original column order and appends the two new
  // columns; quotes:true preserves the existing fully-quoted CSV style.
  const baseFields = (parsed.meta.fields ?? []).filter((f) => f !== 'audio' && f !== 'audio_example');
  const fields = [...baseFields, 'audio', 'audio_example'];
  const out = Papa.unparse({ fields, data: rows }, { quotes: true });
  await writeFile(CSV_PATH, out + '\n');

  // Lesson-audio manifest: the ids that actually have a clip on disk. The
  // LessonAudio island only makes a span clickable when its id is here, so a
  // failed/missing clip never produces a 404 (it just stays plain text).
  const manifest: string[] = [];
  for (const id of lessonIds) {
    if (await exists(path.join(AUDIO_DIR, `${id}.mp3`))) manifest.push(id);
  }
  manifest.sort();
  await writeFile(MANIFEST_PATH, JSON.stringify(manifest) + '\n');

  console.log(`\nDone: ${generated} generated, ${skipped} skipped, ${failed} failed.`);
  console.log(`Voice: ${VOICE}. Clips in public/audio/, CSV + lesson-audio.json updated.`);
  console.log(`Lesson clips: ${manifest.length} of ${lessonIds.size} lesson spans.`);
  if (failed) process.exit(1);
}

main();

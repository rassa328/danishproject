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
import { deriveId, nfc, audioKey, spanAudioId } from '../src/lib/vocab.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const AUDIO_DIR = path.join(ROOT, 'public/audio');
const LESSONS_DIR = path.join(ROOT, 'src/content/lessons');
const MANIFEST_PATH = path.join(ROOT, 'src/data/lesson-audio.json');

// Selectable decks. Default 'starter' also does lesson-prose clips (the curated
// content). The big 'praksis' deck (5000 words) is opt-in and SHOULD be gated:
//   --deck=praksis --max-rank=1500   (only frequency-ranked top 1500)
//   --deck=praksis --limit=1000      (cap clip count regardless of rank)
// because 5000 mp3s add ~75–125 MB to the repo. The long tail falls back to
// da-DK Web Speech in the app, so gating is safe.
const DECK_PATHS: Record<string, string> = {
  starter: path.join(ROOT, 'src/data/vocab/starter-deck.csv'),
  praksis: path.join(ROOT, 'src/data/vocab/praksis-deck.csv'),
};

const argVal = (name: string): string => {
  const a = process.argv.find((x) => x.startsWith(`${name}=`));
  return a ? a.slice(name.length + 1) : '';
};

// Parse a non-negative integer arg; reject garbage rather than silently treating
// it as 0 (= no cap), which would defeat the gate.
const intArg = (name: string): number => {
  const raw = argVal(name);
  if (!raw) return 0; // not provided -> no cap
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) {
    console.error(`Invalid ${name}=${raw} (expected a non-negative integer).`);
    process.exit(1);
  }
  return n;
};

const KEY = process.env.AZURE_SPEECH_KEY;
const REGION = process.env.AZURE_SPEECH_REGION;
const VOICE = process.env.AZURE_SPEECH_VOICE || 'da-DK-ChristelNeural';
const FORCE = process.argv.includes('--force');
const ALL_CLIPS = process.argv.includes('--all-clips'); // opt in to voicing a whole big deck
const DECK_SEL = argVal('--deck') || 'starter'; // 'starter' | 'praksis' | 'all'
const LIMIT = intArg('--limit'); // cap clips per deck (0 = no cap)
const MAX_RANK = intArg('--max-rank'); // only ranked rows with rank <= N (0 = all)

// Frequency rank of a row, or Infinity when unranked (Number(0) is finite, so
// `|| Infinity` would wrongly bucket rank 0; check explicitly).
const rankOf = (r: Record<string, string>): number => {
  const n = Number(r.rank);
  return Number.isFinite(n) && n > 0 ? n : Infinity;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const exists = (p: string) =>
  access(p).then(
    () => true,
    () => false,
  );

const escapeXml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!);

/** Azure REST TTS → MP3 bytes. Retries with backoff on 429 (rate limit) and on
 *  timeouts/network drops — same attempt cap for both. When `ph` (IPA) is given
 *  the word is wrapped in a <phoneme> so we can force a specific pronunciation —
 *  e.g. stød vs no stød for an otherwise identical spelling. An unsupported IPA
 *  phone makes Azure return HTTP 400 (surfaced as a failed clip), our signal to
 *  fall back to a carrier phrase instead. */
async function synthesize(text: string, ph?: string): Promise<Buffer> {
  const inner = ph
    ? `<phoneme alphabet='ipa' ph='${escapeXml(ph)}'>${escapeXml(text)}</phoneme>`
    : escapeXml(text);
  // rate -5% matches the slightly-slowed Web Speech fallback (rate 0.95).
  const ssml =
    `<speak version='1.0' xml:lang='da-DK'>` +
    `<voice name='${VOICE}'><prosody rate='-5%'>${inner}</prosody></voice>` +
    `</speak>`;
  const url = `https://${REGION}.tts.speech.microsoft.com/cognitiveservices/v1`;

  const MAX_RETRIES = 5;
  for (let attempt = 0; ; attempt++) {
    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: {
          'Ocp-Apim-Subscription-Key': KEY!,
          'Content-Type': 'application/ssml+xml',
          'X-Microsoft-OutputFormat': 'audio-24khz-48kbitrate-mono-mp3',
          'User-Agent': 'dansk-for-svenskar',
        },
        body: ssml,
        // A hung connection would otherwise stall the whole run indefinitely.
        signal: AbortSignal.timeout(30_000),
      });
    } catch (err) {
      // TimeoutError / transient network failure: retryable, same cap as 429.
      if (attempt < MAX_RETRIES) {
        const wait = 2 ** attempt * 1000;
        const why = (err as Error).name === 'TimeoutError' ? 'timed out (30s)' : `failed (${(err as Error).name})`;
        console.warn(`  request ${why}, retrying in ${wait}ms…`);
        await sleep(wait);
        continue;
      }
      throw new Error(`Azure TTS request failed after ${attempt + 1} attempts: ${(err as Error).message}`);
    }
    if (res.ok) {
      // Trust nothing about a 2xx: an HTML error page or an empty/truncated
      // body written to disk would become a permanently "done" broken clip
      // (existing files are skipped unless --force). Real clips are >1 kB.
      const type = res.headers.get('content-type') ?? '';
      const body = Buffer.from(await res.arrayBuffer());
      if (!type.startsWith('audio/')) {
        throw new Error(
          `Azure TTS 2xx with non-audio content-type "${type}" (${body.length} bytes) — refusing to write a corrupt clip`,
        );
      }
      if (body.length < 1000) {
        throw new Error(
          `Azure TTS returned an empty/truncated body (${body.length} bytes) — refusing to write a corrupt clip`,
        );
      }
      return body;
    }
    if (res.status === 429 && attempt < MAX_RETRIES) {
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

type LessonSpan = { id: string; text: string; ph?: string; say?: string };

/** Scan every lesson for `<span lang="da" …>…</span>` and return the unique
 *  Danish clips to make (words, number forms, sentences). A span may carry a
 *  `data-ipa` (phoneme) or `data-say` (carrier phrase) override to force a
 *  pronunciation when the visible text alone is ambiguous (stød pairs); the
 *  override makes the clip id distinct so two identical spellings get two clips. */
async function collectLessonSpans(): Promise<LessonSpan[]> {
  const entries = await readdir(LESSONS_DIR);
  const files = entries.filter((f) => f.endsWith('.md') || f.endsWith('.mdx'));
  const re = /<span lang=["']da["']([^>]*)>([\s\S]*?)<\/span>/gi;
  const byId = new Map<string, LessonSpan>();
  for (const file of files) {
    const md = await readFile(path.join(LESSONS_DIR, file), 'utf8');
    for (const m of md.matchAll(re)) {
      const attrs = m[1] ?? '';
      const text = spanInnerToText(m[2] ?? '');
      if (!audioKey(text)) continue;
      const ipa = /data-ipa=["']([^"']*)["']/i.exec(attrs)?.[1];
      const say = /data-say=["']([^"']*)["']/i.exec(attrs)?.[1];
      const id = spanAudioId(text, { ipa, say });
      if (!byId.has(id)) byId.set(id, { id, text, ph: ipa, say });
    }
  }
  return [...byId.values()];
}

type Clip = { file: string; text: string; ph?: string };
type Stats = { generated: number; skipped: number; failed: number };

/** Synthesize a list of clips, skipping ones already on disk (unless --force).
 *  `checkpoint` (when given) runs after every 25 generated clips so a long run
 *  persists its progress as it goes — see processDeck. */
async function generateClips(clips: Clip[], checkpoint?: () => Promise<void>): Promise<Stats> {
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
      const mp3 = await synthesize(clip.text, clip.ph);
      await writeFile(clip.file, mp3);
      generated++;
      console.log(`✓ ${name}  "${clip.text.slice(0, 48)}"`);
      if (checkpoint && generated % 25 === 0) await checkpoint();
      await sleep(120); // gentle throttle to stay well under rate limits
    } catch (err) {
      failed++;
      console.error(`✗ ${name}: ${(err as Error).message}`);
    }
  }
  return { generated, skipped, failed };
}

/** Generate word/example clips for one deck CSV, with optional rank/limit gating
 *  (to keep the big praksis deck's footprint sane), then rewrite the CSV's
 *  audio/audio_example columns to reflect what's actually on disk. */
async function processDeck(csvPath: string): Promise<Stats> {
  const csv = await readFile(csvPath, 'utf8');
  const parsed = Papa.parse<Record<string, string>>(csv, { header: true, skipEmptyLines: true });
  const rows = parsed.data;

  // Pick which rows get clips. With --max-rank, keep ONLY ranked rows within
  // range (unranked are excluded — they have unknown frequency, so a rank gate
  // on an unranked deck correctly yields nothing rather than everything). Order
  // by rank so --limit keeps the most frequent.
  let eligible = rows.filter((r) => nfc(r.danish));
  if (MAX_RANK > 0) eligible = eligible.filter((r) => rankOf(r) <= MAX_RANK);
  eligible = [...eligible].sort((a, b) => rankOf(a) - rankOf(b));
  if (LIMIT > 0) eligible = eligible.slice(0, LIMIT);
  if (eligible.length === 0) {
    console.warn(`  (no eligible rows — is the deck unranked? rank-deck.ts populates ranks)`);
  }

  // A word clip per card, plus an example clip when the card has a Danish
  // example sentence. Filenames use the same id the app derives.
  const clips: Clip[] = [];
  for (const row of eligible) {
    const danish = nfc(row.danish);
    const id = deriveId(danish, row.pos ?? '');
    clips.push({ file: path.join(AUDIO_DIR, `${id}.mp3`), text: danish });
    const example = nfc(row.example_da);
    if (example) clips.push({ file: path.join(AUDIO_DIR, `${id}-ex.mp3`), text: example });
  }
  // Reconcile audio columns for the rows we actually PROCESS this run (reflect
  // disk: a failed clip clears its cell). Rows gated out by --limit/--max-rank
  // are left untouched, so a partial/gated run never blanks committed audio for
  // words it didn't attempt. Runs INCREMENTALLY (every 25 generated clips) and
  // again in the finally below — a single end-of-loop write once let an
  // interrupted praksis run orphan 2,119 clips no CSV row referenced.
  const reconcile = async () => {
    for (const row of eligible) {
      const danish = nfc(row.danish);
      if (!danish) continue;
      const id = deriveId(danish, row.pos ?? '');
      row.audio = (await exists(path.join(AUDIO_DIR, `${id}.mp3`))) ? `audio/${id}.mp3` : '';
      const hasEx = nfc(row.example_da) && (await exists(path.join(AUDIO_DIR, `${id}-ex.mp3`)));
      row.audio_example = hasEx ? `audio/${id}-ex.mp3` : '';
    }
    // Keep original column order; ensure audio/audio_example are last.
    const baseFields = (parsed.meta.fields ?? []).filter((f) => f !== 'audio' && f !== 'audio_example');
    const fields = [...baseFields, 'audio', 'audio_example'];
    const out = Papa.unparse({ fields, data: rows }, { quotes: true });
    await writeFile(csvPath, out + '\n');
  };

  try {
    return await generateClips(clips, reconcile);
  } finally {
    await reconcile();
  }
}

/** Lesson prose: a clip per unique <span lang="da"> (word, number form, whole
 *  sentence), keyed by spanAudioId so the in-browser island resolves the same
 *  filename. Writes the manifest of ids that actually have a clip on disk. */
async function processLessons(): Promise<Stats> {
  const lessonIds = new Set<string>();
  const clips: Clip[] = [];
  for (const span of await collectLessonSpans()) {
    lessonIds.add(span.id);
    clips.push({ file: path.join(AUDIO_DIR, `${span.id}.mp3`), text: span.say ?? span.text, ph: span.ph });
  }
  const stats = await generateClips(clips);
  const manifest: string[] = [];
  for (const id of lessonIds) {
    if (await exists(path.join(AUDIO_DIR, `${id}.mp3`))) manifest.push(id);
  }
  manifest.sort();
  await writeFile(MANIFEST_PATH, JSON.stringify(manifest) + '\n');
  console.log(`Lesson clips: ${manifest.length} of ${lessonIds.size} lesson spans.`);
  return stats;
}

async function main() {
  if (!KEY || !REGION) {
    console.error('Missing AZURE_SPEECH_KEY and/or AZURE_SPEECH_REGION. See .env.example.');
    process.exit(1);
  }
  await mkdir(AUDIO_DIR, { recursive: true });

  // Guard against accidentally voicing the entire 5000-word praksis deck
  // (~75–125 MB of mp3s committed). Require an explicit gate or opt-in.
  if ((DECK_SEL === 'praksis' || DECK_SEL === 'all') && !LIMIT && !MAX_RANK && !ALL_CLIPS) {
    console.error(
      'Refusing to voice the full praksis deck (~5000 clips). ' +
        'Pass --max-rank=N or --limit=N to gate, or --all-clips to override.',
    );
    process.exit(1);
  }

  const decks = DECK_SEL === 'all' ? ['starter', 'praksis'] : [DECK_SEL];
  let failed = 0;
  for (const d of decks) {
    const p = DECK_PATHS[d];
    if (!p) {
      console.error(`Unknown --deck "${d}". Use: ${Object.keys(DECK_PATHS).join(', ')}, or all.`);
      process.exit(1);
    }
    console.log(`\n=== Deck: ${d}${LIMIT ? ` (limit ${LIMIT})` : ''}${MAX_RANK ? ` (rank ≤ ${MAX_RANK})` : ''} ===`);
    const s = await processDeck(p);
    failed += s.failed;
    console.log(`  ${s.generated} generated, ${s.skipped} skipped, ${s.failed} failed.`);
  }

  // Lessons accompany the curated content; skip when doing only the praksis deck.
  if (DECK_SEL === 'starter' || DECK_SEL === 'all') {
    failed += (await processLessons()).failed;
  }

  console.log(`\nDone. Voice: ${VOICE}. Clips in public/audio/.`);
  if (failed) process.exit(1);
}

main();

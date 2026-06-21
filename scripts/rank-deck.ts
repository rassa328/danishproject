// Populate the optional `rank` column of a vocab CSV from a Danish frequency
// list, so the reviewer can introduce new cards most-frequent-first.
//
// USAGE:
//   node --experimental-strip-types scripts/rank-deck.ts <freq-list> [deck-csv]
//
//   <freq-list>  A text file of Danish words, ONE PER LINE, most frequent first
//                (rank = line number). A second whitespace/comma column (a count)
//                is ignored if present. Source e.g. a public subtitle-frequency
//                list (OpenSubtitles-derived) or a Danish frequency dictionary.
//   [deck-csv]   Defaults to src/data/vocab/praksis-deck.csv.
//
// Join is on the headword (`danish`, lowercased, first "/"-variant). Unmatched
// words get no rank (they sort last in the queue — graceful). The `rank` column
// is added to the header if absent; parsing is by header name so position is
// irrelevant and the starter deck (no rank column) is unaffected.
//
// NOT part of the build. Run manually once a frequency list is available, then
// commit the updated CSV.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import Papa from 'papaparse';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');

const freqPath = process.argv[2];
const deckPath = process.argv[3] ?? resolve(root, 'src/data/vocab/praksis-deck.csv');

if (!freqPath) {
  console.error('Usage: rank-deck.ts <freq-list> [deck-csv]');
  process.exit(1);
}

// Build word -> rank (first occurrence wins).
const rankByWord = new Map<string, number>();
const freqLines = readFileSync(freqPath, 'utf8').split('\n');
let rank = 0;
for (const line of freqLines) {
  const word = line.trim().split(/[\s,;\t]+/)[0]?.toLowerCase();
  if (!word) continue;
  rank++;
  if (!rankByWord.has(word)) rankByWord.set(word, rank);
}

const csv = readFileSync(deckPath, 'utf8');
const parsed = Papa.parse<Record<string, string>>(csv, { header: true, skipEmptyLines: true });
const fields = parsed.meta.fields ?? [];
if (!fields.includes('rank')) fields.push('rank');

let matched = 0;
for (const row of parsed.data) {
  const head = (row.danish ?? '').toLowerCase().split('/')[0]?.trim() ?? '';
  const r = rankByWord.get(head);
  if (r !== undefined) {
    row.rank = String(r);
    matched++;
  } else if (row.rank === undefined) {
    row.rank = '';
  }
}

const out = Papa.unparse(parsed.data, { columns: fields, quotes: true });
writeFileSync(deckPath, out + '\n');
console.log(`Ranked ${matched}/${parsed.data.length} rows from ${rankByWord.size} freq entries -> ${deckPath}`);

import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from '../src/lib/vocab.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = process.env.VOCAB_AUDIT_DIR || '/tmp/danish-vocab-audit';
const SHARD_COUNT = 40;
const SOURCES = [
  'src/data/vocab/starter-deck.csv',
  'src/data/vocab/praksis-deck.csv',
];

function recordStartLines(text) {
  const starts = [1];
  let line = 1;
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '"') {
      if (quoted && text[i + 1] === '"') i++;
      else quoted = !quoted;
    } else if (char === '\n') {
      line++;
      if (!quoted && i < text.length - 1) starts.push(line);
    }
  }
  if (quoted) throw new Error('unterminated quoted CSV field');
  return starts;
}

function jsonl(items) {
  return items.map((item) => JSON.stringify(item)).join('\n') + (items.length ? '\n' : '');
}

const sourceRows = [];
for (const source of SOURCES) {
  const raw = readFileSync(join(ROOT, source), 'utf8');
  const parsed = parse(raw, { strict: true });
  const starts = recordStartLines(raw).slice(1);
  if (starts.length !== parsed.cards.length) {
    throw new Error(`${source}: found ${starts.length} CSV records but parsed ${parsed.cards.length} cards`);
  }
  parsed.cards.forEach((card, index) => {
    sourceRows.push({
      id: card.id,
      source,
      line: starts[index],
      danish: card.danish,
      swedish: card.swedish,
      pos: card.pos,
      deck: card.deck,
      example_da: card.exampleDa ?? null,
      example_sv: card.exampleSv ?? null,
      note: card.note ?? null,
      accepted: card.accepted,
      audio: card.audio ?? null,
      audio_example: card.audioExample ?? null,
      rank: card.rank ?? null,
      source_order: sourceRows.length,
    });
  });
}

const byId = new Map();
const duplicateIds = new Map();
for (const row of sourceRows) {
  const winner = byId.get(row.id);
  if (!winner) {
    byId.set(row.id, { ...row, duplicate_sources: [] });
    continue;
  }
  winner.duplicate_sources.push({ source: row.source, line: row.line });
  const group = duplicateIds.get(row.id) ?? [
    { source: winner.source, line: winner.line, danish: winner.danish, swedish: winner.swedish },
  ];
  group.push({ source: row.source, line: row.line, danish: row.danish, swedish: row.swedish });
  duplicateIds.set(row.id, group);
}

const manifest = [...byId.values()].sort(
  (a, b) => a.id.localeCompare(b.id) || a.source_order - b.source_order,
);
const missingIds = manifest.filter((entry) => !entry.id);
if (missingIds.length) throw new Error(`${missingIds.length} manifest entries have no stable ID`);

const shardCount = Math.max(SHARD_COUNT, Math.ceil(manifest.length / 175));
const baseSize = Math.floor(manifest.length / shardCount);
const remainder = manifest.length % shardCount;
const shards = [];
let cursor = 0;
for (let index = 0; index < shardCount; index++) {
  const size = baseSize + (index < remainder ? 1 : 0);
  const name = `shard-${String(index + 1).padStart(3, '0')}`;
  const entries = manifest.slice(cursor, cursor + size);
  cursor += size;
  shards.push({ name, size, first_id: entries[0]?.id ?? null, last_id: entries.at(-1)?.id ?? null });
}
if (cursor !== manifest.length) throw new Error('shard assignment did not consume the full manifest');

rmSync(OUT, { recursive: true, force: true });
mkdirSync(join(OUT, 'shards'), { recursive: true });
mkdirSync(join(OUT, 'primary'), { recursive: true });
mkdirSync(join(OUT, 'specialist'), { recursive: true });
mkdirSync(join(OUT, 'checks'), { recursive: true });
writeFileSync(join(OUT, 'manifest.jsonl'), jsonl(manifest));
writeFileSync(join(OUT, 'source-rows.jsonl'), jsonl(sourceRows));
writeFileSync(
  join(OUT, 'duplicate-ids.json'),
  JSON.stringify(Object.fromEntries([...duplicateIds.entries()].sort()), null, 2) + '\n',
);

cursor = 0;
for (const shard of shards) {
  const entries = manifest.slice(cursor, cursor + shard.size);
  cursor += shard.size;
  writeFileSync(join(OUT, 'shards', `${shard.name}.jsonl`), jsonl(entries));
}

const summary = {
  generated_at: new Date().toISOString(),
  canonical_sources: SOURCES,
  source_row_count: sourceRows.length,
  manifest_entry_count: manifest.length,
  missing_stable_id_count: missingIds.length,
  duplicate_stable_id_count: duplicateIds.size,
  duplicate_source_row_count: sourceRows.length - manifest.length,
  shard_count: shards.length,
  shard_sizes: shards.map((shard) => shard.size),
  shards,
};
writeFileSync(join(OUT, 'manifest-summary.json'), JSON.stringify(summary, null, 2) + '\n');
console.log(JSON.stringify(summary, null, 2));

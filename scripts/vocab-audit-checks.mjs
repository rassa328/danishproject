import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { clozeSentence, normalizeAnswer, parse } from '../src/lib/vocab.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = process.env.VOCAB_AUDIT_DIR || '/tmp/danish-vocab-audit';
const SOURCES = ['src/data/vocab/starter-deck.csv', 'src/data/vocab/praksis-deck.csv'];
const POS = new Set(['noun', 'verb', 'adj', 'adv', 'num', 'phrase', 'other']);
const CEFR = new Set(['b1', 'b2']);

const sourceRows = readFileSync(join(OUT, 'source-rows.jsonl'), 'utf8')
  .split(/\r?\n/)
  .filter(Boolean)
  .map(JSON.parse);
const manifest = readFileSync(join(OUT, 'manifest.jsonl'), 'utf8')
  .split(/\r?\n/)
  .filter(Boolean)
  .map(JSON.parse);
const manifestById = new Map(manifest.map((entry) => [entry.id, entry]));

const cards = [];
let sourceCursor = 0;
for (const source of SOURCES) {
  const parsed = parse(readFileSync(join(ROOT, source), 'utf8'), { strict: true });
  for (const card of parsed.cards) {
    const row = sourceRows[sourceCursor++];
    if (!row || row.id !== card.id || row.source !== source) {
      throw new Error(`source manifest drift at ${source}:${row?.line ?? '?'}`);
    }
    cards.push({ ...card, source, line: row.line });
  }
}
if (sourceCursor !== sourceRows.length) throw new Error('source row count drift');

const flags = [];
const flag = (card, check, detail, relatedIds = []) => {
  const primary = manifestById.get(card.id) ?? card;
  flags.push({
    id: card.id,
    source: `${primary.source}:${primary.line}`,
    check,
    detail,
    related_ids: relatedIds,
  });
};

const groupBy = (items, key) => {
  const groups = new Map();
  for (const item of items) {
    const value = key(item);
    const group = groups.get(value) ?? [];
    group.push(item);
    groups.set(value, group);
  }
  return groups;
};

const compact = (value) =>
  value.normalize('NFC').toLocaleLowerCase('da').replace(/[\p{P}\p{S}]+/gu, ' ').replace(/\s+/g, ' ').trim();
const transparent = (value) =>
  compact(value).replaceAll('æ', 'ä').replaceAll('ø', 'ö');

function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      current[j] = Math.min(
        current[j - 1] + 1,
        previous[j] + 1,
        previous[j - 1] + Number(a[i - 1] !== b[j - 1]),
      );
    }
    previous = current;
  }
  return previous[b.length];
}

function flagGroups(groups, check, describe) {
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const ids = [...new Set(group.map((card) => card.id))];
    for (const card of group) flag(card, check, describe(group), ids.filter((id) => id !== card.id));
  }
}

flagGroups(groupBy(cards, (card) => card.id), 'duplicate_id', (group) => `${group.length} source rows share this stable ID`);
flagGroups(groupBy(cards, (card) => card.danish), 'duplicate_danish_exact', (group) => `${group.length} rows share exact Danish text`);
flagGroups(
  groupBy(cards, (card) => `${card.danish}\u0000${card.swedish}`),
  'duplicate_pair_exact',
  (group) => `${group.length} rows share the exact Danish–Swedish pair`,
);
flagGroups(groupBy(cards, (card) => compact(card.danish)), 'duplicate_danish_normalized', (group) => `${group.length} rows normalize to the same Danish text`);
flagGroups(
  groupBy(cards, (card) => `${compact(card.danish)}\u0000${compact(card.swedish)}`),
  'duplicate_pair_normalized',
  (group) => `${group.length} rows normalize to the same Danish–Swedish pair`,
);

for (const card of cards) {
  for (const [field, value] of [
    ['danish', card.danish],
    ['swedish', card.swedish],
    ['pos', card.pos],
    ['deck', card.deck],
  ]) {
    if (!value?.trim()) flag(card, 'empty_required_field', `${field} is empty`);
  }
  if (!POS.has(card.pos)) flag(card, 'invalid_schema', `invalid pos: ${card.pos}`);
  if (!CEFR.has(card.cefr)) flag(card, 'invalid_schema', `invalid cefr: ${card.cefr}`);

  if (card.exampleDa && clozeSentence(card) === null) {
    flag(card, 'example_target_missing', 'Danish example does not contain the prompt or an accepted answer');
  }
  const prompt = normalizeAnswer(card.danish);
  for (const accepted of card.accepted) {
    if (normalizeAnswer(accepted) === prompt) {
      flag(card, 'accepted_equals_prompt', `accepted answer duplicates prompt: ${accepted}`);
    }
  }

  for (const [field, ref, expected] of [
    ['audio', card.audio, `audio/${card.id}.mp3`],
    ['audio_example', card.audioExample, `audio/${card.id}-ex.mp3`],
  ]) {
    if (!ref) continue;
    if (!existsSync(join(ROOT, 'public', ref))) flag(card, 'missing_audio', `${field} missing: ${ref}`);
    if (ref !== expected) flag(card, 'stale_audio_reference', `${field} expected ${expected}, got ${ref}`);
  }

  const da = transparent(card.danish);
  const sv = transparent(card.swedish);
  if (da && sv && !da.includes(' ') && !sv.includes(' ')) {
    const similarity = 1 - levenshtein(da, sv) / Math.max(da.length, sv.length);
    if (da === sv || (Math.min(da.length, sv.length) >= 4 && similarity >= 0.9)) {
      flag(card, 'suspiciously_transparent_pair', `orthographic similarity ${(similarity * 100).toFixed(0)}%`);
    }
  }
}

const phrases = manifest
  .filter((entry) => compact(entry.danish).includes(' '))
  .map((entry) => ({ ...entry, normalized: compact(entry.danish) }));
const phraseBuckets = groupBy(phrases, (entry) => `${entry.normalized[0] ?? ''}:${Math.floor(entry.normalized.length / 5)}`);
for (const bucket of phraseBuckets.values()) {
  for (let i = 0; i < bucket.length; i++) {
    for (let j = i + 1; j < bucket.length; j++) {
      const a = bucket[i];
      const b = bucket[j];
      if (Math.abs(a.normalized.length - b.normalized.length) > 3) continue;
      const distance = levenshtein(a.normalized, b.normalized);
      const similarity = 1 - distance / Math.max(a.normalized.length, b.normalized.length);
      if (similarity < 0.88 || a.normalized === b.normalized) continue;
      flag(a, 'near_duplicate_phrase', `${Math.round(similarity * 100)}% similar to ${b.id}`, [b.id]);
      flag(b, 'near_duplicate_phrase', `${Math.round(similarity * 100)}% similar to ${a.id}`, [a.id]);
    }
  }
}

flags.sort((a, b) => a.id.localeCompare(b.id) || a.check.localeCompare(b.check));
writeFileSync(join(OUT, 'checks', 'flags.jsonl'), flags.map((item) => JSON.stringify(item)).join('\n') + (flags.length ? '\n' : ''));
const byCheck = Object.fromEntries(
  [...groupBy(flags, (item) => item.check).entries()].map(([check, items]) => [check, items.length]).sort(),
);
const summary = {
  source_rows: cards.length,
  effective_manifest_entries: manifest.length,
  total_flags: flags.length,
  flagged_ids: new Set(flags.map((item) => item.id)).size,
  by_check: byCheck,
};
writeFileSync(join(OUT, 'checks', 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
console.log(JSON.stringify(summary, null, 2));

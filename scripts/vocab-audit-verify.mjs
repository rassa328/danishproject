import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

const OUT = process.env.VOCAB_AUDIT_DIR || '/tmp/danish-vocab-audit';
const DECISIONS = ['keep', 'improve', 'replace', 'merge', 'remove'];
const CONFIDENCE = ['high', 'medium', 'low'];
const AUDIO_IMPACT = ['none', 'word', 'example', 'both', 'uncertain'];
const SPECIALIST_ROLES = [
  'natural-danish',
  'natural-swedish',
  'learning-value',
  'spoken-danish',
  'frequency-usefulness',
  'dataset-integrity',
  'examples-accepted',
  'audio-compatibility',
];
const NULLABLE_PROPOSALS = [
  'danish_proposed',
  'swedish_proposed',
  'example_da_proposed',
  'example_sv_proposed',
  'note_proposed',
];

function readJsonl(file) {
  return readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line, index) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        throw new Error(`${file}:${index + 1}: invalid JSON (${error.message})`);
      }
    });
}

function validateFinding(finding, expected, file, line) {
  const at = `${file}:${line}`;
  if (finding.id !== expected.id) throw new Error(`${at}: expected id ${expected.id}, got ${finding.id}`);
  const source = `${expected.source}:${expected.line}`;
  if (finding.source !== source) throw new Error(`${at}: expected source ${source}`);
  if (finding.danish_current !== expected.danish) throw new Error(`${at}: danish_current mismatch`);
  if (finding.swedish_current !== expected.swedish) throw new Error(`${at}: swedish_current mismatch`);
  if (!DECISIONS.includes(finding.decision)) throw new Error(`${at}: invalid decision`);
  for (const key of NULLABLE_PROPOSALS) {
    if (finding[key] !== null && typeof finding[key] !== 'string') {
      throw new Error(`${at}: ${key} must be a string or null`);
    }
  }
  if (!Array.isArray(finding.accepted_proposed) || finding.accepted_proposed.some((v) => typeof v !== 'string')) {
    throw new Error(`${at}: accepted_proposed must be a string array`);
  }
  if (typeof finding.reason !== 'string' || !finding.reason.trim()) throw new Error(`${at}: missing reason`);
  if (!CONFIDENCE.includes(finding.confidence)) throw new Error(`${at}: invalid confidence`);
  if (!AUDIO_IMPACT.includes(finding.audio_impact)) throw new Error(`${at}: invalid audio_impact`);
  if (typeof finding.compatibility_impact !== 'string' || !finding.compatibility_impact.trim()) {
    throw new Error(`${at}: missing compatibility_impact`);
  }
}

function validateShard(name) {
  const shardFile = join(OUT, 'shards', `${name}.jsonl`);
  const findingFile = join(OUT, 'primary', `${name}.jsonl`);
  const summaryFile = join(OUT, 'primary', `${name}.summary.json`);
  if (!existsSync(findingFile)) throw new Error(`${name}: missing primary findings`);
  if (!existsSync(summaryFile)) throw new Error(`${name}: missing primary summary`);

  const expected = readJsonl(shardFile);
  const findings = readJsonl(findingFile);
  const summary = JSON.parse(readFileSync(summaryFile, 'utf8'));
  if (findings.length !== expected.length) {
    throw new Error(`${name}: expected ${expected.length} findings, got ${findings.length}`);
  }
  if (summary.entries_received !== expected.length || summary.entries_reviewed !== findings.length) {
    throw new Error(`${name}: summary counts do not match artifacts`);
  }
  if (summary.completed !== true) throw new Error(`${name}: summary is not marked completed`);
  findings.forEach((finding, index) => validateFinding(finding, expected[index], findingFile, index + 1));
  return findings;
}

function allPrimaryFindings(manifestSummary) {
  const rows = [];
  for (const shard of manifestSummary.shards) rows.push(...validateShard(shard.name));
  return rows;
}

function stableScore(value) {
  return createHash('sha256').update(value).digest('hex');
}

function prepareSpecialists() {
  const manifestSummary = JSON.parse(readFileSync(join(OUT, 'manifest-summary.json'), 'utf8'));
  const manifest = readJsonl(join(OUT, 'manifest.jsonl'));
  const manifestById = new Map(manifest.map((entry) => [entry.id, entry]));
  const primary = allPrimaryFindings(manifestSummary);
  const primaryById = new Map(primary.map((finding) => [finding.id, finding]));
  const checks = readJsonl(join(OUT, 'checks', 'flags.jsonl'));
  const checksById = new Map();
  for (const check of checks) {
    const rows = checksById.get(check.id) ?? [];
    rows.push(check);
    checksById.set(check.id, rows);
  }

  const selected = new Map();
  const select = (id, reason) => {
    const item = selected.get(id) ?? { id, reasons: new Set(), qc: false };
    item.reasons.add(reason);
    selected.set(id, item);
    return item;
  };
  for (const finding of primary) {
    if (finding.decision !== 'keep') select(finding.id, `primary:${finding.decision}`);
    if (finding.confidence !== 'high') select(finding.id, `confidence:${finding.confidence}`);
  }
  for (const check of checks) select(check.id, `check:${check.check}`);

  const qcByShard = {};
  for (const shard of manifestSummary.shards) {
    const findings = validateShard(shard.name);
    const keeps = findings.filter((finding) => finding.decision === 'keep');
    const count = Math.ceil(keeps.length * 0.05);
    const sample = [...keeps]
      .sort((a, b) => stableScore(`${shard.name}:${a.id}`).localeCompare(stableScore(`${shard.name}:${b.id}`)))
      .slice(0, count);
    qcByShard[shard.name] = { keep_count: keeps.length, qc_count: sample.length };
    for (const finding of sample) {
      const item = select(finding.id, `qc:${shard.name}`);
      item.qc = true;
    }
  }

  const assignments = Object.fromEntries(SPECIALIST_ROLES.map((role) => [role, []]));
  const roleCounts = Object.fromEntries(SPECIALIST_ROLES.map((role) => [role, 0]));
  const leastLoaded = (roles) => [...roles].sort((a, b) => roleCounts[a] - roleCounts[b] || a.localeCompare(b))[0];
  const addRole = (item, role, reason) => {
    if (item.roles.has(role)) return;
    item.roles.add(role);
    item.roleReasons[role] = reason;
    roleCounts[role]++;
  };

  const linguisticQcRoles = [
    'natural-danish',
    'natural-swedish',
    'learning-value',
    'spoken-danish',
    'frequency-usefulness',
  ];
  for (const selectedItem of [...selected.values()].sort((a, b) => a.id.localeCompare(b.id))) {
    const finding = primaryById.get(selectedItem.id);
    const automated = checksById.get(selectedItem.id) ?? [];
    const checkNames = new Set(automated.map((check) => check.check));
    const item = {
      ...selectedItem,
      roles: new Set(),
      roleReasons: {},
      finding,
      automated,
      manifest: manifestById.get(selectedItem.id),
    };

    let candidates = [];
    if (
      finding.decision === 'merge' ||
      finding.decision === 'remove' ||
      [...checkNames].some((name) => name.includes('duplicate'))
    ) candidates.push('dataset-integrity');
    if (finding.danish_proposed !== null) candidates.push('natural-danish');
    if (finding.swedish_proposed !== null) candidates.push('natural-swedish');
    if (
      finding.example_da_proposed !== null ||
      finding.example_sv_proposed !== null ||
      finding.note_proposed !== null ||
      finding.accepted_proposed.length ||
      checkNames.has('example_target_missing') ||
      checkNames.has('accepted_equals_prompt')
    ) candidates.push('examples-accepted');
    if (
      finding.audio_impact !== 'none' ||
      checkNames.has('missing_audio') ||
      checkNames.has('stale_audio_reference')
    ) candidates.push('audio-compatibility');
    if (checkNames.has('suspiciously_transparent_pair')) {
      candidates.push('learning-value', 'frequency-usefulness');
    }
    if (finding.decision === 'replace') candidates.push('learning-value', 'frequency-usefulness');
    if (finding.confidence !== 'high') candidates.push('natural-danish', 'natural-swedish');
    if (item.qc) candidates.push(...linguisticQcRoles);
    if (!candidates.length) candidates.push('learning-value');

    const primaryRole = leastLoaded(new Set(candidates));
    addRole(item, primaryRole, 'primary specialist assignment');
    if (finding.decision === 'replace' || finding.decision === 'remove') {
      const secondary = leastLoaded(
        new Set(['natural-danish', 'natural-swedish', 'learning-value', 'frequency-usefulness', 'dataset-integrity'].filter((role) => role !== primaryRole)),
      );
      addRole(item, secondary, 'independent replacement/removal review');
    }

    const payload = {
      id: item.id,
      manifest: item.manifest,
      primary: item.finding,
      automated_checks: item.automated,
      inclusion_reasons: [...item.reasons].sort(),
      assignment_roles: [...item.roles].sort(),
    };
    for (const role of item.roles) {
      assignments[role].push({ ...payload, assignment_reason: item.roleReasons[role] });
    }
  }

  const flagged = [...selected.values()].sort((a, b) => a.id.localeCompare(b.id)).map((item) => ({
    id: item.id,
    manifest: manifestById.get(item.id),
    primary: primaryById.get(item.id),
    automated_checks: checksById.get(item.id) ?? [],
    inclusion_reasons: [...item.reasons].sort(),
  }));
  mkdirSync(join(OUT, 'specialist', 'inputs'), { recursive: true });
  mkdirSync(join(OUT, 'specialist', 'outputs'), { recursive: true });
  writeFileSync(join(OUT, 'specialist', 'flagged.jsonl'), flagged.map((item) => JSON.stringify(item)).join('\n') + '\n');
  for (const role of SPECIALIST_ROLES) {
    writeFileSync(
      join(OUT, 'specialist', 'inputs', `${role}.jsonl`),
      assignments[role].map((item) => JSON.stringify(item)).join('\n') + (assignments[role].length ? '\n' : ''),
    );
  }
  const summary = {
    unique_flagged_entries: flagged.length,
    changed_or_uncertain_entries: primary.filter((finding) => finding.decision !== 'keep' || finding.confidence !== 'high').length,
    automated_flagged_entries: checksById.size,
    qc_keep_entries: [...selected.values()].filter((item) => item.qc).length,
    qc_by_shard: qcByShard,
    specialist_assignment_counts: Object.fromEntries(SPECIALIST_ROLES.map((role) => [role, assignments[role].length])),
    double_review_replace_remove: primary.filter((finding) => finding.decision === 'replace' || finding.decision === 'remove').length,
  };
  writeFileSync(join(OUT, 'specialist', 'assignment-summary.json'), JSON.stringify(summary, null, 2) + '\n');
  console.log(JSON.stringify(summary, null, 2));
}

function validateSpecialist(role) {
  if (!SPECIALIST_ROLES.includes(role)) throw new Error(`unknown specialist role: ${role}`);
  const inputFile = join(OUT, 'specialist', 'inputs', `${role}.jsonl`);
  const outputFile = join(OUT, 'specialist', 'outputs', `${role}.jsonl`);
  const summaryFile = join(OUT, 'specialist', 'outputs', `${role}.summary.json`);
  if (!existsSync(outputFile) || !existsSync(summaryFile)) throw new Error(`${role}: missing specialist output or summary`);
  const input = readJsonl(inputFile);
  const output = readJsonl(outputFile);
  const summary = JSON.parse(readFileSync(summaryFile, 'utf8'));
  if (output.length !== input.length) throw new Error(`${role}: expected ${input.length} reviews, got ${output.length}`);
  if (summary.entries_received !== input.length || summary.entries_reviewed !== output.length || summary.completed !== true) {
    throw new Error(`${role}: invalid summary counts`);
  }
  const verdicts = new Set(['approve', 'revise', 'reject', 'manual']);
  output.forEach((review, index) => {
    const expected = input[index];
    if (review.id !== expected.id) throw new Error(`${role}:${index + 1}: expected ${expected.id}, got ${review.id}`);
    if (review.role !== role) throw new Error(`${role}:${index + 1}: role mismatch`);
    if (!verdicts.has(review.verdict)) throw new Error(`${role}:${index + 1}: invalid verdict`);
    if (!DECISIONS.includes(review.decision)) throw new Error(`${role}:${index + 1}: invalid decision`);
    for (const key of NULLABLE_PROPOSALS) {
      if (review[key] !== null && typeof review[key] !== 'string') throw new Error(`${role}:${index + 1}: invalid ${key}`);
    }
    if (!Array.isArray(review.accepted_proposed)) throw new Error(`${role}:${index + 1}: accepted_proposed must be an array`);
    if (typeof review.reason !== 'string' || !review.reason.trim()) throw new Error(`${role}:${index + 1}: missing reason`);
    if (!CONFIDENCE.includes(review.confidence)) throw new Error(`${role}:${index + 1}: invalid confidence`);
    if (!AUDIO_IMPACT.includes(review.audio_impact)) throw new Error(`${role}:${index + 1}: invalid audio impact`);
    if (typeof review.compatibility_impact !== 'string' || !review.compatibility_impact.trim()) {
      throw new Error(`${role}:${index + 1}: missing compatibility impact`);
    }
  });
  return output;
}

function verifyAllSpecialists() {
  const byId = new Map();
  let reviewCount = 0;
  for (const role of SPECIALIST_ROLES) {
    for (const review of validateSpecialist(role)) {
      const reviews = byId.get(review.id) ?? [];
      reviews.push(review);
      byId.set(review.id, reviews);
      reviewCount++;
    }
  }
  const flagged = readJsonl(join(OUT, 'specialist', 'flagged.jsonl'));
  const missing = flagged.filter((item) => !byId.has(item.id));
  const insufficientDouble = flagged.filter(
    (item) => ['replace', 'remove'].includes(item.primary.decision) && (byId.get(item.id)?.length ?? 0) < 2,
  );
  if (missing.length || insufficientDouble.length) {
    throw new Error(`specialist coverage failure: missing=${missing.length}, insufficient_double=${insufficientDouble.length}`);
  }
  const changed = flagged.filter((item) => item.primary.decision !== 'keep' || item.primary.confidence !== 'high');
  const changedCovered = changed.filter((item) => byId.has(item.id)).length;
  const result = {
    specialist_roles: SPECIALIST_ROLES.length,
    specialist_reviews: reviewCount,
    unique_entries_reviewed: byId.size,
    flagged_entries: flagged.length,
    changed_or_uncertain_entries: changed.length,
    changed_or_uncertain_coverage_percent: changed.length ? (changedCovered / changed.length) * 100 : 100,
    replacement_removal_double_reviewed: insufficientDouble.length === 0,
  };
  writeFileSync(join(OUT, 'specialist', 'review-summary.json'), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result, null, 2));
}

const requested = process.argv[2];
if (requested === '--prepare-specialists') {
  prepareSpecialists();
  process.exit(0);
}
if (requested === '--specialist') {
  const role = process.argv[3];
  const output = validateSpecialist(role);
  console.log(`${role}: ${output.length} specialist reviews verified`);
  process.exit(0);
}
if (requested === '--verify-specialists') {
  verifyAllSpecialists();
  process.exit(0);
}
if (requested) {
  const findings = validateShard(requested);
  console.log(`${requested}: ${findings.length} entries verified`);
  process.exit(0);
}

const manifestSummary = JSON.parse(readFileSync(join(OUT, 'manifest-summary.json'), 'utf8'));
const manifest = readJsonl(join(OUT, 'manifest.jsonl'));
const expectedShards = manifestSummary.shards.map((shard) => shard.name);
const all = [];
for (const shard of expectedShards) all.push(...validateShard(shard));

const manifestIds = new Set(manifest.map((entry) => entry.id));
const reviewedIds = new Set();
const duplicates = [];
for (const finding of all) {
  if (reviewedIds.has(finding.id)) duplicates.push(finding.id);
  reviewedIds.add(finding.id);
}
const missing = [...manifestIds].filter((id) => !reviewedIds.has(id));
const unexpected = [...reviewedIds].filter((id) => !manifestIds.has(id));
if (duplicates.length || missing.length || unexpected.length || all.length !== manifest.length) {
  throw new Error(
    `coverage failure: reviewed=${all.length}/${manifest.length}, duplicates=${duplicates.length}, missing=${missing.length}, unexpected=${unexpected.length}`,
  );
}

const decisions = Object.fromEntries(DECISIONS.map((decision) => [decision, 0]));
for (const finding of all) decisions[finding.decision]++;
const decisionTotal = Object.values(decisions).reduce((sum, value) => sum + value, 0);
if (decisionTotal !== manifest.length) throw new Error('decision totals do not equal manifest total');

const result = {
  manifest_entries: manifest.length,
  expected_shards: expectedShards.length,
  completed_shards: expectedShards.length,
  reviewed_entries: all.length,
  primary_coverage_percent: 100,
  duplicate_primary_ids: duplicates.length,
  missing_primary_ids: missing.length,
  unexpected_primary_ids: unexpected.length,
  decisions,
};
writeFileSync(join(OUT, 'primary-summary.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result, null, 2));

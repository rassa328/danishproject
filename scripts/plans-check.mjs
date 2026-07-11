import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join, posix, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ACTIVE_DIR = join(ROOT, 'docs', 'plans', 'active');
const MAX_IDLE_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

const unquote = (value) => {
  const trimmed = value.trim();
  if (
    trimmed.length >= 2 &&
    ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'")))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
};

function parseFrontmatter(file) {
  const text = readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
  const lines = text.split('\n');
  if (lines[0] !== '---') throw new Error('missing opening frontmatter delimiter');

  const end = lines.indexOf('---', 1);
  if (end === -1) throw new Error('missing closing frontmatter delimiter');

  const data = {};
  let listKey = null;
  for (const line of lines.slice(1, end)) {
    if (!line.trim() || line.trimStart().startsWith('#')) continue;

    const item = line.match(/^\s+-\s+(.+)$/);
    if (item) {
      if (!listKey) throw new Error(`list item without a key: ${line.trim()}`);
      data[listKey].push(unquote(item[1]));
      continue;
    }

    const field = line.match(/^([A-Za-z_][A-Za-z0-9_]*):(?:\s*(.*))?$/);
    if (!field) throw new Error(`unsupported frontmatter line: ${line.trim()}`);
    const [, key, raw = ''] = field;
    if (raw.trim()) {
      data[key] = unquote(raw);
      listKey = null;
    } else {
      data[key] = [];
      listKey = key;
    }
  }
  return data;
}

function validatePlan(file, data) {
  const errors = [];
  const requiredScalars = ['title', 'owner', 'branch', 'status', 'verify', 'opened'];
  for (const key of requiredScalars) {
    if (typeof data[key] !== 'string' || !data[key].trim()) errors.push(`missing ${key}`);
  }
  if (data.status && data.status !== 'active') errors.push('status must be active in docs/plans/active');
  if (!Array.isArray(data.write_set) || data.write_set.length === 0) {
    errors.push('write_set must contain at least one path');
  }
  if (data.opened && Number.isNaN(Date.parse(`${data.opened}T00:00:00Z`))) {
    errors.push('opened must be a valid YYYY-MM-DD date');
  }
  if (errors.length) throw new Error(errors.join('; '));

  return {
    file,
    plan: file.slice(0, -3),
    title: data.title,
    owner: data.owner,
    branch: data.branch,
    writeSet: data.write_set,
  };
}

function normalizeWritePath(raw) {
  const original = raw.trim().replaceAll('\\', '/');
  const withoutDot = original.replace(/^\.\//, '');
  if (!withoutDot || isAbsolute(withoutDot) || withoutDot === '..' || withoutDot.startsWith('../')) {
    throw new Error(`write_set path must be repository-relative: ${raw}`);
  }

  const normalized = posix.normalize(withoutDot).replace(/\/$/, '');
  if (normalized === '..' || normalized.startsWith('../')) {
    throw new Error(`write_set path escapes the repository: ${raw}`);
  }

  const diskPath = join(ROOT, ...normalized.split('/'));
  const directory = original.endsWith('/') || (existsSync(diskPath) && statSync(diskPath).isDirectory());
  return { raw, path: normalized, directory };
}

function pathsIntersect(a, b) {
  if (a.path === b.path) return true;
  if (a.directory && b.path.startsWith(`${a.path}/`)) return true;
  if (b.directory && a.path.startsWith(`${b.path}/`)) return true;
  return false;
}

function git(args) {
  return spawnSync('git', args, { cwd: ROOT, encoding: 'utf8' });
}

function resolveBranch(branch) {
  const candidates = branch.startsWith('refs/')
    ? [branch]
    : [`refs/heads/${branch}`, `refs/remotes/${branch}`, `refs/remotes/origin/${branch}`];
  for (const ref of candidates) {
    if (git(['show-ref', '--verify', '--quiet', ref]).status === 0) return ref;
  }
  return null;
}

function lastCommitAge(ref) {
  const result = git(['log', '-1', '--format=%ct', ref]);
  if (result.status !== 0 || !result.stdout.trim()) return null;
  const timestamp = Number(result.stdout.trim()) * 1000;
  if (!Number.isFinite(timestamp)) return null;
  return Math.max(0, (Date.now() - timestamp) / DAY_MS);
}

function printTable(rows) {
  const columns = [
    ['plan', 'plan'],
    ['owner', 'owner'],
    ['branch', 'branch'],
    ['writeSet', 'write_set'],
    ['age', 'age'],
  ];
  const printable = rows.map((row) => ({
    ...row,
    writeSet: row.writeSet.join(', '),
    age: `${row.age.toFixed(1)}d`,
  }));
  const widths = columns.map(([key, label]) =>
    Math.max(label.length, ...printable.map((row) => String(row[key]).length)),
  );
  const render = (row) =>
    columns.map(([key], index) => String(row[key]).padEnd(widths[index])).join(' | ');

  console.log(render(Object.fromEntries(columns.map(([key, label]) => [key, label]))));
  console.log(widths.map((width) => '-'.repeat(width)).join('-|-'));
  for (const row of printable) console.log(render(row));
}

const issues = [];
const plans = [];
const files = existsSync(ACTIVE_DIR)
  ? readdirSync(ACTIVE_DIR).filter((file) => file.endsWith('.md')).sort()
  : [];

for (const file of files) {
  try {
    const data = parseFrontmatter(join(ACTIVE_DIR, file));
    const plan = validatePlan(file, data);
    plan.normalizedWriteSet = plan.writeSet.map(normalizeWritePath);
    plans.push(plan);
  } catch (error) {
    issues.push(`${file}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

for (let i = 0; i < plans.length; i++) {
  for (let j = i + 1; j < plans.length; j++) {
    const left = plans[i];
    const right = plans[j];
    for (const a of left.normalizedWriteSet) {
      for (const b of right.normalizedWriteSet) {
        if (pathsIntersect(a, b)) {
          issues.push(`${left.file} (${a.raw}) intersects ${right.file} (${b.raw})`);
        }
      }
    }
  }
}

for (const plan of plans) {
  const ref = resolveBranch(plan.branch);
  if (!ref) {
    issues.push(`${plan.file}: branch does not exist: ${plan.branch}`);
    continue;
  }
  plan.age = lastCommitAge(ref);
  if (plan.age === null) {
    issues.push(`${plan.file}: branch has no commits: ${plan.branch}`);
  } else if (plan.age > MAX_IDLE_DAYS) {
    issues.push(`${plan.file}: no commits on ${plan.branch} for ${plan.age.toFixed(1)} days`);
  }
}

if (issues.length) {
  console.error('plans:check failed');
  for (const issue of issues) console.error(`- ${issue}`);
  process.exitCode = 1;
} else {
  printTable(plans);
}

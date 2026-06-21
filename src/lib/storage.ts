// Versioned, quota-safe localStorage layer.
// Two SEPARATE keys so re-importing deck CONTENT never rewrites SRS state, and
// grading never rewrites the (large) imported-deck blob:
//   dansk4svensk:srs:v1   -> scheduling state, settings, progress  (small, hot)
//   dansk4svensk:decks:v1 -> imported card content                 (large, cold)
// Backend is injectable => headless unit tests + SSR-safe (no top-level access).
import { newCard, review, Rating, type ReviewGrade, type FsrsCard } from './srs.ts';
import type { Card } from './vocab.ts';

// 'speak' (shadowing) is self-graded: the learner says the word aloud, hears the
// native clip, and rates their own pronunciation — no typed answer to check.
export type Direction = 'produce' | 'listen' | 'recognize' | 'speak';

/** ts-fsrs Card persisted verbatim (Dates as ISO) + our app-level flags. */
export interface SrsRecord {
  due: string;
  stability: number;
  difficulty: number;
  elapsed_days: number;
  scheduled_days: number;
  learning_steps: number;
  reps: number;
  lapses: number;
  state: 0 | 1 | 2 | 3;
  last_review: string | null;
  suspended?: boolean;
  leech?: boolean;
}

export interface Settings {
  newPerDay: number;
  reviewPerDay: number;
  requestRetention: number;
  directions: Direction[];
  leechThreshold: number;
  ttsEnabled: boolean;
  theme: 'light' | 'dark' | 'system';
}

export interface SrsRoot {
  schemaVersion: number;
  srs: Record<string, SrsRecord>;
  lessonsCompleted: Record<string, number>;
  activeDeck: string | null;
  onboarded: boolean;
  firstRunAt: number | null;
  streak: { lastReviewIso: string; current: number } | null;
  settings: Settings;
}

interface DecksRoot {
  schemaVersion: number;
  importedDecks: Record<string, Card[]>;
}

export interface KV {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface WriteResult {
  ok: boolean;
  quotaExceeded?: boolean;
}

const SRS_KEY = 'dansk4svensk:srs:v1';
const DECKS_KEY = 'dansk4svensk:decks:v1';
const SCHEMA_VERSION = 1;

export const DEFAULT_SETTINGS: Settings = {
  newPerDay: 10,
  reviewPerDay: 200,
  requestRetention: 0.9,
  directions: ['produce'],
  leechThreshold: 8,
  ttsEnabled: true,
  theme: 'system',
};

function defaultSrsRoot(): SrsRoot {
  return {
    schemaVersion: SCHEMA_VERSION,
    srs: {},
    lessonsCompleted: {},
    activeDeck: null,
    onboarded: false,
    firstRunAt: null,
    streak: null,
    settings: { ...DEFAULT_SETTINGS },
  };
}

function defaultDecksRoot(): DecksRoot {
  return { schemaVersion: SCHEMA_VERSION, importedDecks: {} };
}

const toIso = (d: Date | string): string =>
  d instanceof Date ? d.toISOString() : new Date(d).toISOString();

function toFsrs(r: SrsRecord): FsrsCard {
  return {
    due: new Date(r.due),
    stability: r.stability,
    difficulty: r.difficulty,
    elapsed_days: r.elapsed_days,
    scheduled_days: r.scheduled_days,
    learning_steps: r.learning_steps,
    reps: r.reps,
    lapses: r.lapses,
    state: r.state,
    last_review: r.last_review ? new Date(r.last_review) : undefined,
  } as FsrsCard;
}

function fromFsrs(c: FsrsCard, prev?: SrsRecord): SrsRecord {
  const rec: SrsRecord = {
    due: toIso(c.due),
    stability: c.stability,
    difficulty: c.difficulty,
    elapsed_days: c.elapsed_days,
    scheduled_days: c.scheduled_days,
    learning_steps: c.learning_steps,
    reps: c.reps,
    lapses: c.lapses,
    state: c.state as 0 | 1 | 2 | 3,
    last_review: c.last_review ? toIso(c.last_review) : null,
  };
  // Preserve app-level flags; only set when true (exactOptionalPropertyTypes-safe).
  if (prev?.suspended) rec.suspended = true;
  if (prev?.leech) rec.leech = true;
  return rec;
}

/** In-memory KV — the default headless/SSR fallback and the test backend. */
export function memoryKV(): KV {
  const m = new Map<string, string>();
  return {
    getItem: (k) => (m.has(k) ? (m.get(k) as string) : null),
    setItem: (k, v) => {
      m.set(k, v);
    },
    removeItem: (k) => {
      m.delete(k);
    },
  };
}

function browserKV(): KV {
  try {
    if (typeof localStorage !== 'undefined') return localStorage;
  } catch {
    /* SecurityError in some privacy modes */
  }
  return memoryKV();
}

export class Store {
  private kv: KV;
  private srsRoot?: SrsRoot;

  constructor(kv: KV = browserKV()) {
    this.kv = kv;
  }

  // ---- low-level, never throws to the UI ----
  private read<T extends { schemaVersion?: number }>(key: string, fallback: () => T): T {
    let raw: string | null = null;
    try {
      raw = this.kv.getItem(key);
    } catch {
      return fallback();
    }
    if (!raw) return fallback();
    try {
      const parsed = JSON.parse(raw) as T & { schemaVersion?: number };
      return migrate(parsed, fallback);
    } catch {
      return fallback(); // corrupt JSON -> fresh default, never crash
    }
  }

  private write(key: string, value: unknown): WriteResult {
    try {
      this.kv.setItem(key, JSON.stringify(value));
      return { ok: true };
    } catch (e) {
      const quota =
        e instanceof Error &&
        (e.name === 'QuotaExceededError' || e.name === 'SecurityError');
      return { ok: false, quotaExceeded: quota };
    }
  }

  // ---- SRS root (cached in memory; write-through on change) ----
  private loadSrs(): SrsRoot {
    if (!this.srsRoot) this.srsRoot = this.read<SrsRoot>(SRS_KEY, defaultSrsRoot);
    return this.srsRoot;
  }
  private saveSrs(): WriteResult {
    return this.write(SRS_KEY, this.loadSrs());
  }

  getSettings(): Settings {
    return { ...this.loadSrs().settings };
  }
  setSettings(patch: Partial<Settings>): WriteResult {
    const root = this.loadSrs();
    root.settings = { ...root.settings, ...patch };
    return this.saveSrs();
  }

  recordKey(vocabId: string, direction: Direction): string {
    return `${vocabId}::${direction}`;
  }
  getRecord(vocabId: string, direction: Direction): SrsRecord | null {
    return this.loadSrs().srs[this.recordKey(vocabId, direction)] ?? null;
  }

  /** Grade a card: load-or-create FSRS state, schedule, leech-check, persist
   *  ONLY the changed record (write-through of the small SRS root). */
  grade(
    vocabId: string,
    direction: Direction,
    grade: ReviewGrade,
    now: Date = new Date(),
  ): { record: SrsRecord; result: WriteResult } {
    const root = this.loadSrs();
    const key = this.recordKey(vocabId, direction);
    const prev = root.srs[key];
    const card = prev ? toFsrs(prev) : newCard(now);
    const next = review(card, grade, now, root.settings.requestRetention);
    const rec = fromFsrs(next, prev);
    if (grade === Rating.Again && rec.lapses >= root.settings.leechThreshold) {
      rec.leech = true;
      rec.suspended = true;
    }
    root.srs[key] = rec;
    return { record: rec, result: this.saveSrs() };
  }

  /** Distinct vocab cards the learner has started (any direction/state). */
  startedCount(): number {
    const srs = this.loadSrs().srs;
    const ids = new Set<string>();
    for (const k of Object.keys(srs)) ids.add(k.split('::')[0] as string);
    return ids.size;
  }

  /** Count of records due now (+ new cards are handled by the reviewer queue). */
  dueCount(now: Date = new Date()): number {
    const srs = this.loadSrs().srs;
    let n = 0;
    for (const k of Object.keys(srs)) {
      const r = srs[k];
      if (r && !r.suspended && new Date(r.due) <= now) n++;
    }
    return n;
  }

  markLessonComplete(slug: string, at: number): WriteResult {
    this.loadSrs().lessonsCompleted[slug] = at;
    return this.saveSrs();
  }
  isLessonComplete(slug: string): boolean {
    return this.loadSrs().lessonsCompleted[slug] !== undefined;
  }
  setOnboarded(at: number): WriteResult {
    const root = this.loadSrs();
    root.onboarded = true;
    if (root.firstRunAt === null) root.firstRunAt = at;
    return this.saveSrs();
  }

  // ---- imported decks (separate key) ----
  getImportedDeck(name: string): Card[] {
    const root = this.read<DecksRoot>(DECKS_KEY, defaultDecksRoot);
    return root.importedDecks[name] ?? [];
  }

  /** Non-destructive merge: update card CONTENT, never touch srs[id]; cards
   *  whose id disappears are kept unless prune=true. Returns {added,updated}. */
  mergeDeck(
    name: string,
    incoming: Card[],
    prune = false,
  ): { added: number; updated: number; result: WriteResult } {
    const root = this.read<DecksRoot>(DECKS_KEY, defaultDecksRoot);
    const existing = root.importedDecks[name] ?? [];
    const byId = new Map(existing.map((c) => [c.id, c]));
    let added = 0;
    let updated = 0;
    for (const card of incoming) {
      if (byId.has(card.id)) updated++;
      else added++;
      byId.set(card.id, card); // content overwrite; SRS lives in the other key
    }
    let merged = [...byId.values()];
    if (prune) {
      const keep = new Set(incoming.map((c) => c.id));
      merged = merged.filter((c) => keep.has(c.id));
    }
    root.importedDecks[name] = merged;
    return { added, updated, result: this.write(DECKS_KEY, root) };
  }

  // ---- backup ----
  exportBackup(): string {
    return JSON.stringify({
      srs: this.loadSrs(),
      decks: this.read<DecksRoot>(DECKS_KEY, defaultDecksRoot),
    });
  }
  importBackup(json: string): WriteResult {
    let data: { srs?: SrsRoot; decks?: DecksRoot };
    try {
      data = JSON.parse(json);
    } catch {
      return { ok: false };
    }
    if (data.srs) {
      this.srsRoot = migrate(data.srs, defaultSrsRoot);
      const r = this.saveSrs();
      if (!r.ok) return r;
    }
    if (data.decks) return this.write(DECKS_KEY, migrate(data.decks, defaultDecksRoot));
    return { ok: true };
  }
}

/** Run schema migrations up to SCHEMA_VERSION. Unknown/older blobs that can't be
 *  upgraded fall back to a fresh default rather than throwing. */
function migrate<T extends { schemaVersion?: number }>(value: T, fallback: () => T): T {
  const v = typeof value?.schemaVersion === 'number' ? value.schemaVersion : 0;
  if (v === SCHEMA_VERSION) return value;
  if (v > SCHEMA_VERSION) return value; // forward-compat: keep unknown newer data
  // v < SCHEMA_VERSION: no historical migrations yet (v1 is first). Reset cleanly.
  return fallback();
}

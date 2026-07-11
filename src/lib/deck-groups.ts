// Shared deck/theme grouping, used by both the wordlist (ordlista) and the
// flashcard reviewer so they agree on theme keys and labels.
//
// Two consumers, two shapes:
//  - ordlista groups the curated starter cards into themed sections (themeKey).
//  - the reviewer needs a small, navigable PICKER over both the 187 starter
//    cards AND the 5000-word praksis deck. The praksis deck has ~475 micro-decks,
//    so we never list those individually — we expose it as one frequency pool
//    plus a handful of part-of-speech buckets. Groups carry only a lightweight
//    `match` descriptor (not card arrays) so the cards serialize to the island
//    exactly once.
import type { Card, Pos } from './vocab.ts';

// ---- starter theme keys/labels (also imported by ordlista.astro) ----

// Merge stray/duplicate decks, then strip the -b1/-b2 suffix so a theme's B1 and
// B2 words sit together (e.g. falske-venner-b1 + -b2 → one theme).
const DECK_ALIAS: Record<string, string> = {};

export const themeKey = (deck: string): string => {
  const base = deck.replace(/-b[12]$/, '');
  return DECK_ALIAS[base] ?? base;
};

const THEME_LABELS: Record<string, string> = {
  hverdag: 'Vardag',
  verber: 'Verb',
  'rejser-og-transport': 'Resor & transport',
  'mad-og-restaurant': 'Mat & restaurang',
  'krop-og-sundhed': 'Kropp & hälsa',
  'hjem-og-familie': 'Hem & familj',
  arbejde: 'Arbete',
  'falske-venner': 'Falska vänner',
  'udtryk-og-idiomer': 'Uttryck & idiom',
  smalltalk: 'Småprat',
  foelelser: 'Känslor',
};

const humanize = (key: string): string => {
  const s = key.replace(/-og-/g, ' & ').replace(/-/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
};

export const themeLabel = (key: string): string => THEME_LABELS[key] ?? humanize(key);

// ---- reviewer study-group descriptors ----

export type GroupMatch =
  | { kind: 'all' } // every card (starter ∪ praksis) — the due-only review group
  | { kind: 'decks'; decks: string[] } // a starter theme = a set of deck names
  | { kind: 'praksisAll' } // the whole 5000-word deck (frequency-ordered)
  | { kind: 'praksisPos'; pos: Pos }; // one part-of-speech slice of the deck

export interface StudyGroup {
  id: string;
  label: string;
  /** '' = top-level picker entry (rendered before the optgroups). */
  optgroup: string;
  match: GroupMatch;
}

export const OPTGROUP_STARTER = 'Utvalda';
export const OPTGROUP_PRAKSIS = 'Praksis (5000 ord)';

/** The synthetic first picker entry: everything DUE across all decks for the
 *  current direction, no new cards (buildQueue treats kind 'all' as due-only).
 *  Exported so deep links (?group=due-all) can be built outside the reviewer. */
export const DUE_ALL_GROUP_ID = 'due-all';
const DUE_ALL_LABEL = 'Att repetera (alla)';

const isPraksis = (c: Card): boolean => c.deck.startsWith('praksis-');

/** Does a card belong to a study group? Pure, derives everything from `deck`. */
export function matchesGroup(c: Card, m: GroupMatch): boolean {
  switch (m.kind) {
    case 'all':
      return true;
    case 'decks':
      return m.decks.includes(c.deck);
    case 'praksisAll':
      return isPraksis(c);
    case 'praksisPos':
      return isPraksis(c) && c.pos === m.pos;
  }
}

const POS_LABEL: Record<Pos, string> = {
  verb: 'Verb',
  noun: 'Substantiv',
  adj: 'Adjektiv',
  adv: 'Adverb',
  phrase: 'Fraser',
  num: 'Tal',
  other: 'Övrigt',
};
// Pickable POS order (most useful for speaking first).
const POS_ORDER: Pos[] = ['verb', 'noun', 'adj', 'adv', 'phrase', 'num', 'other'];

/** Build the reviewer's picker: the due-only "everything" group FIRST (top
 *  level, no optgroup), then starter themes (biggest first, labels carry counts
 *  like the praksis ones) + the praksis frequency pool and its non-empty
 *  part-of-speech slices. */
export function buildStudyGroups(starter: Card[], praksis: Card[]): StudyGroup[] {
  // Starter themes, biggest first (mirrors ordlista ordering).
  const byTheme = new Map<string, { decks: Set<string>; count: number }>();
  for (const c of starter) {
    const k = themeKey(c.deck);
    const e = byTheme.get(k) ?? { decks: new Set<string>(), count: 0 };
    e.decks.add(c.deck);
    e.count++;
    byTheme.set(k, e);
  }
  const starterGroups: StudyGroup[] = [...byTheme.entries()]
    .sort((a, b) => b[1].count - a[1].count || themeLabel(a[0]).localeCompare(themeLabel(b[0]), 'sv'))
    .map(([key, e]) => ({
      id: `starter:${key}`,
      label: `${themeLabel(key)} (${e.count})`,
      optgroup: OPTGROUP_STARTER,
      match: { kind: 'decks', decks: [...e.decks] },
    }));

  // Praksis: one "all" pool + non-empty POS slices.
  const posCount = new Map<Pos, number>();
  for (const c of praksis) posCount.set(c.pos, (posCount.get(c.pos) ?? 0) + 1);
  const praksisGroups: StudyGroup[] = [
    {
      id: 'praksis:all',
      label: `Alla ${praksis.length} ord (frekvens)`,
      optgroup: OPTGROUP_PRAKSIS,
      match: { kind: 'praksisAll' },
    },
    ...POS_ORDER.filter((p) => posCount.get(p)).map((p) => ({
      id: `praksis:${p}`,
      label: `${POS_LABEL[p]} (${posCount.get(p)})`,
      optgroup: OPTGROUP_PRAKSIS,
      match: { kind: 'praksisPos', pos: p } as GroupMatch,
    })),
  ];

  const dueAll: StudyGroup = {
    id: DUE_ALL_GROUP_ID,
    label: DUE_ALL_LABEL,
    optgroup: '',
    match: { kind: 'all' },
  };
  return [dueAll, ...starterGroups, ...praksisGroups];
}

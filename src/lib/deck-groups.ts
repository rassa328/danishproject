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
  udtale: 'Uttal (stød)',
};

const humanize = (key: string): string => {
  const s = key.replace(/-og-/g, ' & ').replace(/-/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
};

export const themeLabel = (key: string): string => THEME_LABELS[key] ?? humanize(key);

// ---- praksis super-themes ----
// The praksis deck has ~246 micro-deck base names ('praksis-mad-grund-b1' →
// 'mad-grund'), far too many to pick from. They fold into ~20 super-themes via
// keyword matching on the base name. ORDER MATTERS — the first theme with a
// keyword hit wins — because base names collide across topics:
//   falske-venner-verber must beat 'verber'; 'vaerktoej'/'koeretoej' must beat
//   the clothes keyword 'toej'; 'haandarbejde' must beat 'arbejde'; 'husdyr'
//   must beat 'hus'; 'fritid'/'maaltider' must beat 'tid'/'maal'.
// Anything unmatched lands in the 'oevrigt' fallback, so every deck maps.
const PRAKSIS_THEMES: ReadonlyArray<{ id: string; label: string; keywords: readonly string[] }> = [
  { id: 'falske-venner', label: 'Falska vänner', keywords: ['falske-venner'] },
  { id: 'verb', label: 'Verb (tema)', keywords: ['verber', 'bevaegelse', 'handlinger'] },
  { id: 'adjektiv', label: 'Adjektiv (tema)', keywords: ['adjektiver'] },
  {
    id: 'smaaord',
    label: 'Småord & adverb',
    keywords: ['adverbier', 'forholdsord', 'bindeord', 'smaaord', 'spoergeord', 'retninger', 'positioner'],
  },
  {
    id: 'mat',
    label: 'Mat & kök',
    keywords: ['mad', 'drikke', 'koekken', 'krydderier', 'svampe', 'noedder', 'mejeri', 'kager', 'supper', 'saucer', 'konserves', 'paalaeg', 'bagning', 'foedevarer', 'urter', 'maaltider', 'bager', 'slagter', 'emballage'],
  },
  {
    id: 'natur',
    label: 'Natur & djur',
    keywords: ['natur', 'vejr', 'klima', 'dyr', 'fugle', 'insekter', 'fisk', 'traeer', 'blomster', 'geologi', 'vand-hav', 'astronomi', 'landskab', 'miljoe', 'landbrug', 'landmand', 'gartner', 'planter'],
  },
  {
    id: 'kropp',
    label: 'Kropp & hälsa',
    keywords: ['krop', 'sundhed', 'sygdom', 'symptomer', 'hospital', 'tandlaege', 'medicin', 'foerstehjaelp', 'skelet', 'muskler', 'graviditet'],
  },
  {
    id: 'hem',
    label: 'Hem & hushåll',
    keywords: ['hus', 'bolig', 'moebler', 'rengoering', 'badevaerelse', 'sovevaerelse', 'belysning', 'gulv', 'vinduer', 'opvarmning', 'opbevaring', 'hverdag', 'have'],
  },
  {
    id: 'resor',
    label: 'Resor & trafik',
    keywords: ['transport', 'trafik', 'rejse', 'koeretoej', 'bilens', 'cykel', 'infrastruktur', 'by-bygninger'],
  },
  {
    id: 'hantverk',
    label: 'Hantverk & bygg',
    keywords: ['byggeri', 'murer', 'vvs', 'elektriker', 'maler', 'mekaniker', 'smed', 'snedker', 'vaerktoej', 'haandarbejde', 'materialer', 'tekstur'],
  },
  {
    id: 'klader',
    label: 'Kläder & utseende',
    keywords: ['toej', 'sko-', 'smykker', 'frisoer', 'tekstiler', 'syning', 'makeup'],
  },
  {
    id: 'arbete',
    label: 'Arbete & pengar',
    keywords: ['arbejde', 'erhverv', 'kontor', 'penge', 'oekonomi', 'bank', 'arbejdsmarked', 'handel', 'indkoeb'],
  },
  {
    id: 'skola',
    label: 'Skola & vetenskap',
    keywords: ['skole', 'uddannelse', 'universitet', 'videnskab', 'matematik', 'filosofi', 'historie', 'geografi'],
  },
  {
    id: 'teknik',
    label: 'Teknik & medier',
    keywords: ['teknologi', 'computer', 'internet', 'telefon', 'elektronik', 'energi'],
  },
  {
    id: 'kanslor',
    label: 'Känslor & sinne',
    keywords: ['foelelser', 'humoer', 'personlighed', 'karaktertraek', 'vilje', 'moral', 'tillid', 'grine', 'psykologi', 'ansigt', 'konflikt', 'beslutning', 'tanke', 'problem'],
  },
  { id: 'familj', label: 'Familj & relationer', keywords: ['familie', 'relationer', 'baby', 'social'] },
  {
    id: 'fritid',
    label: 'Fritid & kultur',
    keywords: ['sport', 'musik', 'kunst', 'kultur', 'boeger', 'film', 'teater', 'braetspil', 'hobby', 'fritid', 'ferie', 'friluftsliv', 'spil'],
  },
  {
    id: 'samhalle',
    label: 'Samhälle & politik',
    keywords: ['politik', 'samfund', 'stat', 'lov', 'kriminalitet', 'religion', 'nyheder'],
  },
  {
    id: 'sprak',
    label: 'Språk & uttryck',
    keywords: ['kommunikation', 'tale', 'slang', 'sprog', 'lyd', 'idiomatisk'],
  },
  { id: 'tid', label: 'Tid & mått', keywords: ['tid', 'kalender', 'ugedage', 'maal', 'mængder', 'former'] },
];

export const PRAKSIS_THEME_FALLBACK = 'oevrigt';
const PRAKSIS_THEME_LABELS: Record<string, string> = Object.fromEntries([
  ...PRAKSIS_THEMES.map((t) => [t.id, t.label]),
  [PRAKSIS_THEME_FALLBACK, 'Övrigt'],
]);

export const praksisThemeLabel = (id: string): string =>
  PRAKSIS_THEME_LABELS[id] ?? humanize(id);

// Memoized: matchesGroup runs over 5000 cards per session build, but there are
// only ~470 distinct deck names.
const themeByDeck = new Map<string, string>();

/** Super-theme id for a praksis deck name (any deck name maps — unknown ones
 *  fall back to 'oevrigt', so no deck is ever dropped from the picker). */
export function praksisThemeOf(deck: string): string {
  const hit = themeByDeck.get(deck);
  if (hit) return hit;
  const base = deck.replace(/^praksis-/, '').replace(/-b[12]$/, '');
  const theme =
    PRAKSIS_THEMES.find((t) => t.keywords.some((k) => base.includes(k)))?.id ??
    PRAKSIS_THEME_FALLBACK;
  themeByDeck.set(deck, theme);
  return theme;
}

// ---- reviewer study-group descriptors ----

export type GroupMatch =
  | { kind: 'all' } // every card (starter ∪ praksis) — the due-only review group
  | { kind: 'decks'; decks: string[] } // a starter theme = a set of deck names
  | { kind: 'praksisAll' } // the whole 5000-word deck (frequency-ordered)
  | { kind: 'praksisPos'; pos: Pos } // one part-of-speech slice of the deck
  | { kind: 'praksisTheme'; theme: string } // one super-theme slice (praksisThemeOf)
  // Multi-set selection (the Zen drill): a card matches when it carries ANY of
  // the tags (picked lessons) OR matches ANY of the nested matches (picked
  // groups). buildQueue treats it as a normal scheduled pool — only the 'all'
  // kind gets the due-only special case, so flashcards are unaffected.
  | { kind: 'union'; tags: string[]; matches: GroupMatch[] };

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
    case 'praksisTheme':
      return isPraksis(c) && praksisThemeOf(c.deck) === m.theme;
    case 'union':
      return m.tags.some((t) => c.tags.includes(t)) || m.matches.some((mm) => matchesGroup(c, mm));
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

  // Praksis: one "all" pool + non-empty POS slices + super-theme slices
  // (~20 keyword-folded topic groups, AFTER the all/POS entries; biggest first,
  // the 'Övrigt' fallback always last).
  const posCount = new Map<Pos, number>();
  for (const c of praksis) posCount.set(c.pos, (posCount.get(c.pos) ?? 0) + 1);
  const themeCount = new Map<string, number>();
  for (const c of praksis) {
    const t = praksisThemeOf(c.deck);
    themeCount.set(t, (themeCount.get(t) ?? 0) + 1);
  }
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
    ...[...themeCount.entries()]
      .sort(
        (a, b) =>
          Number(a[0] === PRAKSIS_THEME_FALLBACK) - Number(b[0] === PRAKSIS_THEME_FALLBACK) ||
          b[1] - a[1] ||
          praksisThemeLabel(a[0]).localeCompare(praksisThemeLabel(b[0]), 'sv'),
      )
      .map(([t, n]) => ({
        id: `praksis-tema:${t}`,
        label: `${praksisThemeLabel(t)} (${n})`,
        optgroup: OPTGROUP_PRAKSIS,
        match: { kind: 'praksisTheme', theme: t } as GroupMatch,
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

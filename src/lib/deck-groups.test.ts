import { describe, it, expect } from 'vitest';
import {
  buildStudyGroups,
  matchesGroup,
  praksisThemeOf,
  praksisThemeLabel,
  DUE_ALL_GROUP_ID,
  PRAKSIS_THEME_FALLBACK,
  OPTGROUP_STARTER,
  OPTGROUP_PRAKSIS,
} from './deck-groups.ts';
import { praksisCards } from './praksis.ts';
import type { Card, Pos } from './vocab.ts';

const card = (id: string, deck: string, pos: Pos = 'other'): Card => ({
  id,
  danish: id,
  swedish: `sv-${id}`,
  pos,
  deck,
  cefr: 'b1',
  tags: [],
  accepted: [],
});

const starter = [
  card('s1', 'hverdag-b1'),
  card('s2', 'hverdag-b1'),
  card('s3', 'hverdag-b2'),
  card('s4', 'verber-b1', 'verb'),
];
const praksis = [
  card('p1', 'praksis-verber-b1', 'verb'),
  card('p2', 'praksis-substantiver-b1', 'noun'),
];

describe('buildStudyGroups', () => {
  const groups = buildStudyGroups(starter, praksis);

  it('puts the due-all group FIRST, top-level (no optgroup), with match kind "all"', () => {
    const first = groups[0]!;
    expect(first.id).toBe(DUE_ALL_GROUP_ID);
    expect(first.label).toBe('Att repetera (alla)');
    expect(first.optgroup).toBe('');
    expect(first.match).toEqual({ kind: 'all' });
    // No other group is top-level.
    expect(groups.filter((g) => !g.optgroup)).toHaveLength(1);
  });

  it('gives starter labels counts, like the praksis ones', () => {
    const hverdag = groups.find((g) => g.id === 'starter:hverdag')!;
    expect(hverdag.label).toBe('Vardag (3)'); // b1+b2 merged into one theme
    expect(hverdag.optgroup).toBe(OPTGROUP_STARTER);
    const verber = groups.find((g) => g.id === 'starter:verber')!;
    expect(verber.label).toBe('Verb (1)');
  });

  it('keeps the praksis pool + POS slices (counts intact)', () => {
    const all = groups.find((g) => g.id === 'praksis:all')!;
    expect(all.label).toBe('Alla 2 ord (frekvens)');
    expect(all.optgroup).toBe(OPTGROUP_PRAKSIS);
    expect(groups.find((g) => g.id === 'praksis:verb')?.label).toBe('Verb (1)');
  });
});

describe('matchesGroup', () => {
  it('kind "all" matches every card, starter and praksis alike', () => {
    for (const c of [...starter, ...praksis]) {
      expect(matchesGroup(c, { kind: 'all' })).toBe(true);
    }
  });

  it('other kinds stay scoped (decks / praksisAll / praksisPos)', () => {
    expect(matchesGroup(starter[0]!, { kind: 'decks', decks: ['hverdag-b1'] })).toBe(true);
    expect(matchesGroup(praksis[0]!, { kind: 'decks', decks: ['hverdag-b1'] })).toBe(false);
    expect(matchesGroup(praksis[0]!, { kind: 'praksisAll' })).toBe(true);
    expect(matchesGroup(starter[0]!, { kind: 'praksisAll' })).toBe(false);
    expect(matchesGroup(praksis[0]!, { kind: 'praksisPos', pos: 'verb' })).toBe(true);
    expect(matchesGroup(praksis[1]!, { kind: 'praksisPos', pos: 'verb' })).toBe(false);
  });

  it('kind "praksisTheme" matches praksis cards of that theme only', () => {
    const mad = card('p3', 'praksis-mad-grund-b1');
    const starterMad = card('s5', 'mad-og-restaurant-b1'); // starter deck, same topic
    expect(matchesGroup(mad, { kind: 'praksisTheme', theme: 'mat' })).toBe(true);
    expect(matchesGroup(mad, { kind: 'praksisTheme', theme: 'natur' })).toBe(false);
    expect(matchesGroup(starterMad, { kind: 'praksisTheme', theme: 'mat' })).toBe(false);
  });
});

describe('praksis super-themes', () => {
  it('maps every real praksis deck to a labelled theme; counts sum to deck size', () => {
    // Runs over the REAL CSV via the same loader the build uses.
    const counts = new Map<string, number>();
    for (const c of praksisCards) {
      const theme = praksisThemeOf(c.deck);
      expect(theme).toBeTruthy();
      expect(praksisThemeLabel(theme)).toBeTruthy();
      counts.set(theme, (counts.get(theme) ?? 0) + 1);
    }
    const sum = [...counts.values()].reduce((a, b) => a + b, 0);
    expect(sum).toBe(praksisCards.length); // nothing dropped, nothing doubled
    // ~20 super-themes, not ~246 micro-decks…
    expect(counts.size).toBeGreaterThanOrEqual(15);
    expect(counts.size).toBeLessThanOrEqual(25);
    // …and the fallback bucket stays a sliver, not a dumping ground.
    expect(counts.get(PRAKSIS_THEME_FALLBACK) ?? 0).toBeLessThan(praksisCards.length * 0.05);
  });

  it('keyword collisions resolve to the intended theme (order matters)', () => {
    expect(praksisThemeOf('praksis-falske-venner-verber-b2')).toBe('falske-venner'); // not verb
    expect(praksisThemeOf('praksis-vaerktoej-diy-b2')).toBe('hantverk'); // not kläder (toej)
    expect(praksisThemeOf('praksis-transport-koeretoejer-b1')).toBe('resor'); // not kläder (toej)
    expect(praksisThemeOf('praksis-haandarbejde-b2')).toBe('hantverk'); // not arbete (arbejde)
    expect(praksisThemeOf('praksis-dyr-husdyr-b1')).toBe('natur'); // not hem (hus)
    expect(praksisThemeOf('praksis-fritid-b1')).toBe('fritid'); // not tid
    expect(praksisThemeOf('praksis-maaltider-restaurant-b1')).toBe('mat'); // not tid (maal)
  });

  it('an unknown deck falls back to Övrigt (every deck maps somewhere)', () => {
    expect(praksisThemeOf('praksis-helt-ukendt-emne-b1')).toBe(PRAKSIS_THEME_FALLBACK);
    expect(praksisThemeLabel(PRAKSIS_THEME_FALLBACK)).toBe('Övrigt');
  });

  it('buildStudyGroups appends theme entries with counts AFTER the all/POS entries', () => {
    const p = [
      card('p1', 'praksis-verber-bevaegelse-b1', 'verb'),
      card('p2', 'praksis-mad-grund-b1', 'noun'),
      card('p3', 'praksis-mad-frugt-groent-b2', 'noun'),
    ];
    const groups = buildStudyGroups(starter, p);
    const praksisEntries = groups.filter((g) => g.optgroup === OPTGROUP_PRAKSIS);
    // Order within the optgroup: all → POS slices → theme slices.
    const kinds = praksisEntries.map((g) => g.match.kind);
    const firstTheme = kinds.indexOf('praksisTheme');
    expect(kinds[0]).toBe('praksisAll');
    expect(firstTheme).toBeGreaterThan(0);
    expect(kinds.slice(firstTheme).every((k) => k === 'praksisTheme')).toBe(true);
    // Labels carry counts; theme counts sum to the deck size.
    const themeEntries = praksisEntries.filter((g) => g.match.kind === 'praksisTheme');
    expect(themeEntries.map((g) => g.label)).toEqual(['Mat & kök (2)', 'Verb (tema) (1)']);
    // Every praksis card is matched by exactly one theme entry.
    for (const c of p) {
      const matching = themeEntries.filter((g) => matchesGroup(c, g.match));
      expect(matching).toHaveLength(1);
    }
  });
});

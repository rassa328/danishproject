import { describe, it, expect } from 'vitest';
import {
  buildStudyGroups,
  matchesGroup,
  DUE_ALL_GROUP_ID,
  OPTGROUP_STARTER,
  OPTGROUP_PRAKSIS,
} from './deck-groups.ts';
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
});

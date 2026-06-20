import { describe, it, expect } from 'vitest';
import { sortLessons, groupByUnit, getNeighbors, UNITS, type LessonLike } from './lessons.ts';

// Minimal fixtures spanning all units, deliberately out of order.
const L = (id: string, unit: LessonLike['data']['unit'], order: number): LessonLike => ({
  id,
  data: { unit, order },
});
const lessons = [
  L('hjem', 'hverdag', 12),
  L('stoed', 'grund', 1),
  L('fv2', 'falske-venner', 13),
  L('tal', 'system', 3),
  L('fv', 'falske-venner', 2),
  L('stavning', 'grund', 5),
];

describe('sortLessons', () => {
  it('orders by unit display order, then by `order`', () => {
    expect(sortLessons(lessons).map((l) => l.id)).toEqual([
      'stoed', 'stavning', 'fv', 'fv2', 'tal', 'hjem',
    ]);
  });
});

describe('groupByUnit', () => {
  it('groups under units in UNITS order and drops empty units', () => {
    const groups = groupByUnit(lessons);
    expect(groups.map((g) => g.id)).toEqual(['grund', 'falske-venner', 'system', 'hverdag']);
    expect(groups[0]!.lessons.map((l) => l.id)).toEqual(['stoed', 'stavning']);
    expect(groups.every((g) => g.lessons.length > 0)).toBe(true);
  });

  it('every unit has a human label', () => {
    for (const u of UNITS) expect(u.label.length).toBeGreaterThan(0);
  });
});

describe('getNeighbors', () => {
  it('returns prev/next in global reading order', () => {
    const n = getNeighbors(lessons, 'fv');
    expect(n.prev?.id).toBe('stavning');
    expect(n.next?.id).toBe('fv2');
    expect(n.total).toBe(6);
  });
  it('null at the ends', () => {
    expect(getNeighbors(lessons, 'stoed').prev).toBeNull();
    expect(getNeighbors(lessons, 'hjem').next).toBeNull();
  });
});

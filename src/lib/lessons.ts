// Lesson taxonomy helpers: the unit registry plus build-time-safe utilities for
// grouping lessons into units and computing prev/next neighbours. Kept free of
// `astro:content` imports so it can be unit-tested in plain vitest — callers
// pass the already-loaded lesson list in.

export type UnitId = 'grund' | 'falske-venner' | 'system' | 'hverdag';

/** Ordered units. The array order IS the display order on the lessons index. */
export const UNITS: ReadonlyArray<{ id: UnitId; label: string; blurb: string }> = [
  { id: 'grund', label: 'Ljud & skrift', blurb: 'Det som gör talad danska svår att höra och uttala.' },
  { id: 'falske-venner', label: 'Ord som lurar', blurb: 'Ord som ser svenska ut men betyder något annat.' },
  { id: 'system', label: 'Tal, grammatik & uttryck', blurb: 'Systemen bakom danskan: tal, grammatik och småord.' },
  { id: 'hverdag', label: 'Vardagsord', blurb: 'Ordförråd för mat, resor, jobb, kropp och hem.' },
];

const UNIT_ORDER: Record<UnitId, number> = Object.fromEntries(
  UNITS.map((u, i) => [u.id, i]),
) as Record<UnitId, number>;

/** Minimal shape this module needs — a subset of the lesson collection entry. */
export interface LessonLike {
  id: string;
  data: { unit: UnitId; order: number; draft?: boolean };
}

/** Lessons sorted by unit display order, then by their `order` field. */
export function sortLessons<T extends LessonLike>(lessons: T[]): T[] {
  return [...lessons].sort(
    (a, b) =>
      UNIT_ORDER[a.data.unit] - UNIT_ORDER[b.data.unit] || a.data.order - b.data.order,
  );
}

/** Group lessons under each unit, in display order, dropping empty units. */
export function groupByUnit<T extends LessonLike>(
  lessons: T[],
): Array<{ id: UnitId; label: string; blurb: string; lessons: T[] }> {
  const sorted = sortLessons(lessons);
  return UNITS.map((u) => ({
    ...u,
    lessons: sorted.filter((l) => l.data.unit === u.id),
  })).filter((g) => g.lessons.length > 0);
}

/** Previous/next lesson in the global reading order (unit order, then `order`). */
export function getNeighbors<T extends LessonLike>(
  lessons: T[],
  id: string,
): { prev: T | null; next: T | null; index: number; total: number } {
  const sorted = sortLessons(lessons);
  const i = sorted.findIndex((l) => l.id === id);
  return {
    prev: i > 0 ? (sorted[i - 1] as T) : null,
    next: i >= 0 && i < sorted.length - 1 ? (sorted[i + 1] as T) : null,
    index: i,
    total: sorted.length,
  };
}

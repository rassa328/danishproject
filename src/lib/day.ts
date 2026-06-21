// Local-calendar date helpers. The streak and the daily mission must roll over
// at the LEARNER'S local midnight, not UTC — the audience is in CET/CEST, where
// toISOString() (UTC) would shift "today" by a day around midnight.

/** Local date as YYYY-MM-DD (not UTC). */
export const localDayIso = (d: Date): string => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

/** Whole days from aIso to bIso (both YYYY-MM-DD). Parsed as UTC midnight on
 *  both sides, so the difference is an exact integer (DST-safe). */
export const daysBetween = (aIso: string, bIso: string): number =>
  Math.round((Date.parse(bIso) - Date.parse(aIso)) / 86_400_000);

/** A stable per-local-day integer, for deterministic day-based rotation. */
export const dayNumber = (d: Date): number =>
  Math.round(Date.parse(localDayIso(d)) / 86_400_000);

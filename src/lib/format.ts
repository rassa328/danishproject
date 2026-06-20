// Small display-formatting helpers shared across pages. Centralized so a label
// convention (e.g. how a CEFR level renders) lives in one place rather than as
// scattered `.toUpperCase()` calls.

/** CEFR level badge text, e.g. 'b1' -> 'B1'. */
export const formatLevel = (level: string): string => level.toUpperCase();

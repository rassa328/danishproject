// Pure, DOM-free logic for the flashcards settings dashboard
// (FlashcardSettings.svelte). Extracted so the ∞-sentinel stepper transitions
// and retention mapping are unit-tested independently of the Svelte component.

/** Value a stepper stores once it is raised past its max — the ∞ (unlimited)
 *  sentinel. buildQueue (lib/session) reads any negative limit as Infinity. */
export const UNLIMITED = -1;

export interface StepperSpec {
  step: number;
  min: number;
  max: number;
}

/** The two Anki steppers, matching the design's ranges. */
export const NEW_PER_DAY: StepperSpec = { step: 5, min: 0, max: 200 };
export const MAX_REVIEWS: StepperSpec = { step: 10, min: 10, max: 500 };

/** Increment: at/over max the next press becomes ∞; ∞ stays ∞. */
export function stepUp(value: number, spec: StepperSpec): number {
  if (value === UNLIMITED) return UNLIMITED;
  return value + spec.step > spec.max ? UNLIMITED : value + spec.step;
}

/** Decrement: ∞ drops back to max; otherwise step down, clamped to [min, max]. */
export function stepDown(value: number, spec: StepperSpec): number {
  if (value === UNLIMITED) return spec.max;
  return Math.min(spec.max, Math.max(spec.min, value - spec.step));
}

/** Stepper display: the ∞ glyph for the unlimited sentinel, else the number. */
export function stepperDisplay(value: number): string {
  return value === UNLIMITED ? '∞' : String(value);
}

// ---- retention ----

export const RETENTION_MIN = 80;
export const RETENTION_MAX = 99;
/** The three named presets (whole percent): Avslappnad / Balanserad / Intensiv. */
export const RETENTION_PRESETS = [85, 90, 95] as const;
export type RetentionPreset = (typeof RETENTION_PRESETS)[number];

/** Clamp a manual retention percent into the adjustable range. */
export const clampRetention = (pct: number): number =>
  Math.min(RETENTION_MAX, Math.max(RETENTION_MIN, Math.round(pct)));

/** requestRetention (0–1 fraction, as stored) → whole percent for the UI. */
export const retentionToPct = (fraction: number): number => Math.round(fraction * 100);

/** Whole percent → requestRetention fraction for the Store. */
export const pctToRetention = (pct: number): number => pct / 100;

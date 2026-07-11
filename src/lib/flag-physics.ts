// Physics for the celebration table-flag drop — the site's ONE animated moment.
// Pure and precomputed so it can be unit-tested and driven by a single rAF
// clock in CelebrationFlag.svelte. Units: px, seconds; y ≤ 0 where 0 = resting
// on the "table" hairline (negative = above it).

export const G = 1900; // px/s² — snappy, toy-like gravity
export const RESTITUTION = 0.42; // energy kept per bounce
export const DECAY = 0.86; // squash/dip magnitude retained per successive impact
export const MAX_BOUNCES = 4; // impacts before the flag settles

export interface DropSpec {
  dropHeight: number;
  /** Impact times (s), strictly increasing; impacts[0] ends the free fall. */
  impacts: number[];
  /** Downward speed (px/s) at each impact — strictly decreasing. */
  impactSpeeds: number[];
  /** Airborne arcs between impacts: launched at `start` with upward speed `u`. */
  arcs: { start: number; u: number; end: number }[];
  /** Time of the final impact — the flag rests from here on. */
  settleTime: number;
}

export function computeDrop(dropHeight: number): DropSpec {
  const t0 = Math.sqrt((2 * dropHeight) / G);
  const impacts: number[] = [t0];
  const impactSpeeds: number[] = [G * t0];
  const arcs: DropSpec['arcs'] = [];
  let t = t0;
  let v = G * t0;
  while (impacts.length < MAX_BOUNCES) {
    const u = v * RESTITUTION;
    const air = (2 * u) / G;
    arcs.push({ start: t, u, end: t + air });
    t += air;
    v = u;
    impacts.push(t);
    impactSpeeds.push(v);
  }
  return { dropHeight, impacts, impactSpeeds, arcs, settleTime: t };
}

/** Vertical offset of the flag at time t: -dropHeight at t=0, 0 at rest.
 *  Clamped ≤ 0 — the flag never passes through the floor. */
export function flagY(t: number, spec: DropSpec): number {
  if (t <= 0) return -spec.dropHeight;
  const firstImpact = spec.impacts[0] ?? 0;
  if (t < firstImpact) return Math.min(0, -spec.dropHeight + 0.5 * G * t * t);
  for (const arc of spec.arcs) {
    if (t >= arc.start && t < arc.end) {
      const tau = t - arc.start;
      return Math.min(0, -(arc.u * tau - 0.5 * G * tau * tau));
    }
  }
  return 0;
}

const SQUASH_DURATION = 0.09; // s per impact pulse
const SQUASH_MAG = 0.16; // peak 1−sy on the first impact

/** Bottom-origin squash pulse on each impact. Volume-preserving: sx = 1/sy.
 *  Later impacts pulse weaker (×DECAY each). Between pulses: identity. */
export function flagSquash(t: number, spec: DropSpec): { sx: number; sy: number } {
  // Latest impact wins where windows overlap (late bounces are < 90ms apart).
  for (let i = spec.impacts.length - 1; i >= 0; i -= 1) {
    const tau = t - (spec.impacts[i] ?? 0);
    if (tau >= 0 && tau < SQUASH_DURATION) {
      const m = SQUASH_MAG * DECAY ** i * Math.sin((tau / SQUASH_DURATION) * Math.PI);
      const sy = 1 - m;
      return { sx: 1 / sy, sy };
    }
  }
  return { sx: 1, sy: 1 };
}

const DIP_DURATION = 0.16; // s of hairline spring per impact
const DIP_MAX = 2; // px, first impact

/** Hairline "table" flex under the flag: a damped down-up wobble per impact,
 *  ≤ DIP_MAX px, exactly 0 outside the impact windows. */
export function hairlineDip(t: number, spec: DropSpec): number {
  for (let i = spec.impacts.length - 1; i >= 0; i -= 1) {
    const tau = t - (spec.impacts[i] ?? 0);
    if (tau >= 0 && tau < DIP_DURATION) {
      const phase = tau / DIP_DURATION;
      return DIP_MAX * DECAY ** i * Math.sin(2 * Math.PI * phase) * (1 - phase);
    }
  }
  return 0;
}

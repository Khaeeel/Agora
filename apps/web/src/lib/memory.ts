/**
 * Turning an agent's accumulated output into something a picture can show.
 *
 * These lived in the roster component that used to sit under the gym floor.
 * That panel is gone; the maths is not, because the scene is drawn from it.
 */

/**
 * Characters written, folded to a 0..1 "bulk".
 *
 * Log, not linear: a real room runs from n0tail at 257k to fury at 1.5k, and on
 * a linear scale every agent but the largest collapses into the same figure.
 *
 * The scale is ABSOLUTE, not relative to the biggest agent present. Relative
 * would mean the whole room could double its memory with nothing moving on
 * screen, and a brand-new room's first agent would render as a champion for
 * having written twice. 1k characters is the floor, 400k the ceiling.
 */
export function bulkOf(chars: number): number {
  const lo = 3; // log10(1k)
  const hi = 5.6; // log10(~400k)
  const v = (Math.log10(Math.max(chars, 1) + 1) - lo) / (hi - lo);
  return Math.max(0, Math.min(1, v));
}

const TIERS: Array<[number, string]> = [
  [0.15, "Rookie"],
  [0.32, "Novice"],
  [0.5, "Regular"],
  [0.68, "Strong"],
  [0.85, "Veteran"],
  [1.01, "Beast"],
];

export function tierOf(bulk: number): string {
  for (const [ceil, name] of TIERS) if (bulk < ceil) return name;
  return "Beast";
}

/** 257664 -> "258k". The exact figure is noise at this size. */
export function compactCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000) return `${Math.round(n / 1000)}k`;
  if (n >= 1_000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

/** @module cleanup/rotation-candidates */

/**
 * Standard 30° rotation candidate set used when probing rigid subtree
 * rotations during overlap resolution and presentation tidying.
 */
export const STANDARD_ROTATION_ANGLES = Object.freeze([
  0,
  Math.PI / 6,
  -Math.PI / 6,
  Math.PI / 3,
  -Math.PI / 3,
  Math.PI / 2,
  -Math.PI / 2,
  (2 * Math.PI) / 3,
  -(2 * Math.PI) / 3,
  Math.PI
]);

/**
 * Coarse fallback rotation candidate set, dropping the ±30° entries.
 */
export const COARSE_ROTATION_ANGLES = Object.freeze([
  0,
  Math.PI / 3,
  -Math.PI / 3,
  Math.PI / 2,
  -Math.PI / 2,
  (2 * Math.PI) / 3,
  -(2 * Math.PI) / 3,
  Math.PI
]);

/**
 * Finer rotation candidate set including ±15° steps; used when local rotation
 * probing must consider smaller torsions before resorting to coarser rotations.
 */
export const FINE_ROTATION_ANGLES = Object.freeze([
  0,
  Math.PI / 12,
  -Math.PI / 12,
  Math.PI / 6,
  -Math.PI / 6,
  Math.PI / 3,
  -Math.PI / 3,
  Math.PI / 2,
  -Math.PI / 2,
  (2 * Math.PI) / 3,
  -(2 * Math.PI) / 3,
  Math.PI
]);

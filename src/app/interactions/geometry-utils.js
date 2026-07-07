/** @module app/interactions/geometry-utils */

/** Snap radius, in rendered pixels, for matching a selection pivot to a selected atom's position. */
export const SELECTION_PIVOT_ATOM_SNAP_RADIUS = 16;

/**
 * Coerces a value to a finite number, or null when it isn't one.
 * @param {number|string|null|undefined} value - Value to coerce.
 * @returns {number|null} The finite number, or null.
 */
export function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

/**
 * Finds the closest point to a target within a radius.
 * @param {Iterable<{x: number, y: number}>} points - Candidate points (may carry extra fields, e.g. atomId).
 * @param {{x: number, y: number}} target - Point to measure distance from.
 * @param {number} radius - Maximum distance to consider a match.
 * @returns {(object & {distance: number})|null} The closest matching point (with a `distance` field), or null.
 */
export function nearestPointWithinRadius(points, target, radius) {
  if (!target) {
    return null;
  }
  const targetX = finiteNumber(target.x);
  const targetY = finiteNumber(target.y);
  if (targetX == null || targetY == null) {
    return null;
  }
  let best = null;
  for (const point of points) {
    const x = finiteNumber(point?.x);
    const y = finiteNumber(point?.y);
    if (x == null || y == null) {
      continue;
    }
    const distance = Math.hypot(x - targetX, y - targetY);
    if (distance <= radius && (!best || distance < best.distance)) {
      best = { ...point, x, y, distance };
    }
  }
  return best;
}

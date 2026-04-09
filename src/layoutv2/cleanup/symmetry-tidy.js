/** @module cleanup/symmetry-tidy */

/**
 * Snaps tiny coordinate noise back onto clean axes after cleanup.
 * @param {Map<string, {x: number, y: number}>} inputCoords - Coordinate map.
 * @param {object} [options] - Symmetry-tidy options.
 * @param {number} [options.epsilon] - Snap tolerance.
 * @returns {{coords: Map<string, {x: number, y: number}>, snappedCount: number}} Tidied coordinates and snap count.
 */
export function tidySymmetry(inputCoords, options = {}) {
  const epsilon = options.epsilon ?? 1e-6;
  const coords = new Map();
  let snappedCount = 0;

  for (const [atomId, position] of inputCoords) {
    const nextPosition = { ...position };
    if (Math.abs(nextPosition.x) <= epsilon) {
      nextPosition.x = 0;
      snappedCount++;
    }
    if (Math.abs(nextPosition.y) <= epsilon) {
      nextPosition.y = 0;
      snappedCount++;
    }
    coords.set(atomId, nextPosition);
  }

  return { coords, snappedCount };
}

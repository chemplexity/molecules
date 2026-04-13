/** @module topology/macrocycles */

/**
 * Returns whether a ring should be treated as a macrocycle under the current threshold.
 * @param {object} ring - Ring descriptor.
 * @param {number} [minimumSize] - Inclusive macrocycle threshold.
 * @returns {boolean} True when the ring is macrocyclic.
 */
export function isMacrocycleRing(ring, minimumSize = 12) {
  return Boolean(ring && ring.size >= minimumSize);
}

/**
 * Returns macrocyclic rings from a ring list.
 * @param {object[]} rings - Ring descriptors.
 * @param {number} [minimumSize] - Inclusive macrocycle threshold.
 * @returns {object[]} Macrocycle ring descriptors.
 */
export function findMacrocycleRings(rings, minimumSize = 12) {
  return rings.filter(ring => isMacrocycleRing(ring, minimumSize));
}

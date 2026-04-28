/** @module geometry/ring-hypervalent */

const MAX_RING_EMBEDDED_BIS_OXO_SPREAD = Math.PI / 2;

/**
 * Returns the exterior oxo spread for a ring-embedded bis-oxo center. The
 * spread mirrors a regular ring's internal angle, keeping three-member rings
 * at a compact 60-degree V while opening larger rings up to a readable cap.
 * @param {number} ringSize - Number of atoms in the incident ring.
 * @returns {number} Full angle between the two terminal oxo ligands.
 */
export function ringEmbeddedBisOxoSpread(ringSize) {
  const effectiveRingSize = Math.max(3, ringSize);
  return Math.min(MAX_RING_EMBEDDED_BIS_OXO_SPREAD, Math.PI - (2 * Math.PI) / effectiveRingSize);
}

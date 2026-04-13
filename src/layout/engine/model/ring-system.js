/** @module model/ring-system */

import { sortAtomIdsCanonical } from '../topology/canonical-order.js';

/**
 * Creates a deterministic ring-system descriptor.
 * @param {{atomIds: string[], ringIds: number[]}} rawSystem - Raw ring-system membership.
 * @param {object[]} rings - Adapted ring descriptors.
 * @param {Map<string, number>} canonicalAtomRank - Canonical heavy-atom ranks.
 * @param {number} id - Stable ring-system ID.
 * @returns {{id: number, atomIds: string[], ringIds: number[], signature: string}} Ring-system descriptor.
 */
export function createRingSystem(rawSystem, rings, canonicalAtomRank, id) {
  const atomIds = sortAtomIdsCanonical(rawSystem.atomIds, canonicalAtomRank);
  const ringIds = [...rawSystem.ringIds].sort((firstRingId, secondRingId) => firstRingId - secondRingId);
  const signature = `${atomIds.length}|${ringIds.map(ringId => rings[ringId].signature).join('#')}`;
  return {
    id,
    atomIds,
    ringIds,
    signature
  };
}

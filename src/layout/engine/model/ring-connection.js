/** @module model/ring-connection */

/**
 * Returns the deterministic storage key for a ring pair.
 * @param {number} firstRingId - First ring ID.
 * @param {number} secondRingId - Second ring ID.
 * @returns {string} Pair key.
 */
export function ringConnectionKey(firstRingId, secondRingId) {
  return firstRingId < secondRingId
    ? `${firstRingId}:${secondRingId}`
    : `${secondRingId}:${firstRingId}`;
}

/**
 * Creates an explicit ring-connection descriptor.
 * @param {number} id - Connection ID.
 * @param {number} firstRingId - First ring ID.
 * @param {number} secondRingId - Second ring ID.
 * @param {string[]} sharedAtomIds - Shared atom IDs.
 * @param {'bridged'|'spiro'|'fused'} kind - Connection kind.
 * @returns {{id: number, firstRingId: number, secondRingId: number, sharedAtomIds: string[], kind: 'bridged'|'spiro'|'fused'}} Ring connection descriptor.
 */
export function createRingConnection(id, firstRingId, secondRingId, sharedAtomIds, kind) {
  return {
    id,
    firstRingId,
    secondRingId,
    sharedAtomIds: [...sharedAtomIds],
    kind
  };
}

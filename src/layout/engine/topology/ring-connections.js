/** @module topology/ring-connections */

import { createRingConnection, ringConnectionKey } from '../model/ring-connection.js';
import { findSharedAtoms } from './ring-analysis.js';
import { atomPairKey } from '../constants.js';

/**
 * Builds a molecule-wide neighbor map for ring-connection classification.
 * @param {object} molecule - Molecule-like graph.
 * @returns {Map<string, Set<string>>} Neighbor map keyed by atom ID.
 */
function buildNeighborMap(molecule) {
  const neighborMap = new Map();
  for (const [atomId, atom] of molecule.atoms) {
    const neighbors = new Set();
    for (const bondId of atom.bonds) {
      const bond = molecule.bonds.get(bondId);
      if (!bond) {
        continue;
      }
      neighbors.add(bond.getOtherAtom(atomId));
    }
    neighborMap.set(atomId, neighbors);
  }
  return neighborMap;
}


/**
 * Looks up a ring descriptor by ID.
 * @param {object[]} rings - Ring descriptors.
 * @param {number} ringId - Ring ID.
 * @returns {object|null} Matching ring or null.
 */
function getRingById(rings, ringId) {
  return rings[ringId] ?? null;
}

/**
 * Returns whether two atoms are adjacent in a cyclic ring descriptor.
 * @param {string[]} ringAtomIds - Ordered ring atom IDs.
 * @param {string} firstAtomId - First atom ID.
 * @param {string} secondAtomId - Second atom ID.
 * @returns {boolean} True when the atoms form a ring edge.
 */
function areAdjacentInRing(ringAtomIds, firstAtomId, secondAtomId) {
  const atomCount = ringAtomIds.length;
  for (let index = 0; index < atomCount; index++) {
    const atomId = ringAtomIds[index];
    const nextAtomId = ringAtomIds[(index + 1) % atomCount];
    if ((atomId === firstAtomId && nextAtomId === secondAtomId) || (atomId === secondAtomId && nextAtomId === firstAtomId)) {
      return true;
    }
  }
  return false;
}

/**
 * Returns the internal atoms of the longer ring arc between two ring atoms.
 * @param {string[]} ringAtomIds - Ordered ring atom IDs.
 * @param {string} startAtomId - Start atom ID.
 * @param {string} endAtomId - End atom ID.
 * @returns {string[]} Internal atom IDs for the nonshared ring arc.
 */
function longRingArcInternalAtomIds(ringAtomIds, startAtomId, endAtomId) {
  const atomCount = ringAtomIds.length;
  const startIndex = ringAtomIds.indexOf(startAtomId);
  const endIndex = ringAtomIds.indexOf(endAtomId);
  if (startIndex < 0 || endIndex < 0) {
    return [];
  }
  const forward = [];
  let cursor = startIndex;
  do {
    cursor = (cursor + 1) % atomCount;
    const atomId = ringAtomIds[cursor];
    if (atomId === endAtomId) {
      break;
    }
    forward.push(atomId);
  } while (cursor !== endIndex);
  const backward = [];
  cursor = startIndex;
  do {
    cursor = (cursor - 1 + atomCount) % atomCount;
    const atomId = ringAtomIds[cursor];
    if (atomId === endAtomId) {
      break;
    }
    backward.push(atomId);
  } while (cursor !== endIndex);
  if (forward.length === 0) {
    return backward;
  }
  if (backward.length === 0) {
    return forward;
  }
  return forward.length >= backward.length ? forward : backward;
}

/**
 * Returns whether a path exists between two shared atoms outside the two ring arcs.
 * @param {string} startAtomId - First shared atom ID.
 * @param {string} endAtomId - Second shared atom ID.
 * @param {Set<string>} excludedAtomIds - Ring-arc atoms to exclude.
 * @param {string} excludedBondKey - Shared-bond key to exclude.
 * @param {Map<string, Set<string>>} neighborMap - Precomputed molecule neighbor map.
 * @returns {boolean} True when an extra bridge path exists.
 */
function hasBridgePathOutsideRingAtoms(startAtomId, endAtomId, excludedAtomIds, excludedBondKey, neighborMap) {
  const visited = new Set([startAtomId]);
  const queue = [startAtomId];
  let queueHead = 0;

  while (queueHead < queue.length) {
    const atomId = queue[queueHead++];
    for (const neighborAtomId of neighborMap.get(atomId) ?? []) {
      if (atomPairKey(atomId, neighborAtomId) === excludedBondKey) {
        continue;
      }
      if (neighborAtomId === endAtomId) {
        return true;
      }
      if (excludedAtomIds.has(neighborAtomId) || visited.has(neighborAtomId)) {
        continue;
      }
      visited.add(neighborAtomId);
      queue.push(neighborAtomId);
    }
  }

  return false;
}

/**
 * Returns whether a ring connection is spiro.
 * @param {string[]} sharedAtomIds - Shared atom IDs.
 * @returns {boolean} True when the connection is spiro.
 */
export function isSpiroConnection(sharedAtomIds) {
  return sharedAtomIds.length === 1;
}

/**
 * Returns whether a ring connection is fused.
 * @param {string[]} sharedAtomIds - Shared atom IDs.
 * @returns {boolean} True when the connection is fused.
 */
export function isFusedConnection(sharedAtomIds) {
  return sharedAtomIds.length === 2;
}

/**
 * Returns whether a ring connection is bridged under the current heuristic.
 * @param {object} molecule - Molecule-like graph.
 * @param {object[]} rings - Ring descriptors.
 * @param {number} firstRingId - First ring ID.
 * @param {number} secondRingId - Second ring ID.
 * @param {string[]} sharedAtomIds - Shared atom IDs.
 * @param {Map<string, Set<string>>} [neighborMap] - Optional precomputed neighbor map.
 * @returns {boolean} True when the connection is bridged.
 */
export function isBridgedConnection(molecule, rings, firstRingId, secondRingId, sharedAtomIds, neighborMap = buildNeighborMap(molecule)) {
  if (sharedAtomIds.length > 2) {
    return true;
  }
  if (sharedAtomIds.length !== 2) {
    return false;
  }
  const [firstSharedAtomId, secondSharedAtomId] = sharedAtomIds;
  const firstRing = getRingById(rings, firstRingId);
  const secondRing = getRingById(rings, secondRingId);
  if (!firstRing || !secondRing) {
    return false;
  }
  const firstRingSharesBond = areAdjacentInRing(firstRing.atomIds, firstSharedAtomId, secondSharedAtomId);
  const secondRingSharesBond = areAdjacentInRing(secondRing.atomIds, firstSharedAtomId, secondSharedAtomId);
  if (!firstRingSharesBond || !secondRingSharesBond) {
    return true;
  }
  const excludedAtomIds = new Set([
    ...longRingArcInternalAtomIds(firstRing.atomIds, firstSharedAtomId, secondSharedAtomId),
    ...longRingArcInternalAtomIds(secondRing.atomIds, firstSharedAtomId, secondSharedAtomId)
  ]);
  return hasBridgePathOutsideRingAtoms(firstSharedAtomId, secondSharedAtomId, excludedAtomIds, atomPairKey(firstSharedAtomId, secondSharedAtomId), neighborMap);
}

/**
 * Classifies the connection kind between two rings.
 * @param {object} molecule - Molecule-like graph.
 * @param {object[]} rings - Ring descriptors.
 * @param {number} firstRingId - First ring ID.
 * @param {number} secondRingId - Second ring ID.
 * @param {string[]} [sharedAtomIds] - Optional shared atom IDs.
 * @param {Map<string, Set<string>>} [neighborMap] - Optional precomputed neighbor map.
 * @returns {'bridged'|'spiro'|'fused'|null} Connection kind.
 */
export function classifyRingConnection(
  molecule,
  rings,
  firstRingId,
  secondRingId,
  sharedAtomIds = findSharedAtoms(rings[firstRingId].atomIds, rings[secondRingId].atomIds),
  neighborMap = buildNeighborMap(molecule)
) {
  if (isBridgedConnection(molecule, rings, firstRingId, secondRingId, sharedAtomIds, neighborMap)) {
    return 'bridged';
  }
  if (isSpiroConnection(sharedAtomIds)) {
    return 'spiro';
  }
  if (isFusedConnection(sharedAtomIds)) {
    return 'fused';
  }
  return null;
}

/**
 * Builds explicit ring-connection descriptors for a ring list.
 * @param {object} molecule - Molecule-like graph.
 * @param {object[]} rings - Ring descriptors.
 * @returns {{connections: object[], ringAdj: Map<number, number[]>, connectionByPair: Map<string, object>}} Ring connections.
 */
export function buildRingConnections(molecule, rings) {
  const neighborMap = buildNeighborMap(molecule);
  const ringAdj = new Map(rings.map(ring => [ring.id, []]));
  const connectionByPair = new Map();
  const connections = [];

  for (let firstIndex = 0; firstIndex < rings.length; firstIndex++) {
    for (let secondIndex = firstIndex + 1; secondIndex < rings.length; secondIndex++) {
      const firstRing = rings[firstIndex];
      const secondRing = rings[secondIndex];
      const sharedAtomIds = findSharedAtoms(firstRing.atomIds, secondRing.atomIds);
      if (sharedAtomIds.length === 0) {
        continue;
      }
      const kind = classifyRingConnection(molecule, rings, firstRing.id, secondRing.id, sharedAtomIds, neighborMap);
      if (!kind) {
        continue;
      }
      const connection = createRingConnection(connections.length, firstRing.id, secondRing.id, sharedAtomIds, kind);
      connections.push(connection);
      ringAdj.get(firstRing.id)?.push(secondRing.id);
      ringAdj.get(secondRing.id)?.push(firstRing.id);
      connectionByPair.set(ringConnectionKey(firstRing.id, secondRing.id), connection);
    }
  }

  for (const neighbors of ringAdj.values()) {
    neighbors.sort((firstRingId, secondRingId) => firstRingId - secondRingId);
  }

  return {
    connections,
    ringAdj,
    connectionByPair
  };
}

/**
 * Looks up a connection descriptor for a ring pair.
 * @param {Map<string, object>} connectionByPair - Pair-keyed connection map.
 * @param {number} firstRingId - First ring ID.
 * @param {number} secondRingId - Second ring ID.
 * @returns {object|null} Matching connection or null.
 */
export function getRingConnection(connectionByPair, firstRingId, secondRingId) {
  return connectionByPair.get(ringConnectionKey(firstRingId, secondRingId)) ?? null;
}

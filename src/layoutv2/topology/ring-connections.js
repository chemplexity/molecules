/** @module topology/ring-connections */

import { createRingConnection, ringConnectionKey } from '../model/ring-connection.js';
import { findSharedAtoms } from './ring-analysis.js';

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
  const firstNeighbors = neighborMap.get(firstSharedAtomId) ?? new Set();
  const secondNeighbors = neighborMap.get(secondSharedAtomId) ?? new Set();
  const firstRingAtoms = new Set(rings[firstRingId].atomIds);
  const secondRingAtoms = new Set(rings[secondRingId].atomIds);

  for (const neighborId of firstNeighbors) {
    if (neighborId === secondSharedAtomId || !secondNeighbors.has(neighborId)) {
      continue;
    }
    if (firstRingAtoms.has(neighborId) || secondRingAtoms.has(neighborId)) {
      return true;
    }
  }

  return false;
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
      const connection = createRingConnection(
        connections.length,
        firstRing.id,
        secondRing.id,
        sharedAtomIds,
        kind
      );
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

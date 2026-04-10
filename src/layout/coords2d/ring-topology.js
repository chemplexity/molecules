/** @module layout/coords2d/ring-topology */

import { findSharedAtoms } from './ring-detection.js';

function buildNeighborMap(molecule) {
  const neighborMap = new Map();
  for (const [atomId, atom] of molecule.atoms) {
    const neighbors = new Set();
    for (const bondId of atom.bonds) {
      const bond = molecule.bonds.get(bondId);
      if (!bond) {
        continue;
      }
      const otherId = bond.atoms[0] === atomId ? bond.atoms[1] : bond.atoms[0];
      neighbors.add(otherId);
    }
    neighborMap.set(atomId, neighbors);
  }
  return neighborMap;
}

function ringConnectionKey(firstRingId, secondRingId) {
  return firstRingId < secondRingId ? `${firstRingId}:${secondRingId}` : `${secondRingId}:${firstRingId}`;
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
 * Returns whether a ring connection is bridged.
 * @param {object} molecule - Molecule-like graph.
 * @param {Array<Array<string>>} rings - Ring atom lists.
 * @param {number} ringA - First ring index.
 * @param {number} ringB - Second ring index.
 * @param {string[]} sharedAtomIds - Shared atom IDs.
 * @param {Map<string, Set<string>>} [neighborMap] - Optional precomputed neighbor map.
 * @returns {boolean} True when the connection is bridged.
 */
export function isBridgedConnection(molecule, rings, ringA, ringB, sharedAtomIds, neighborMap = buildNeighborMap(molecule)) {
  if (sharedAtomIds.length > 2) {
    return true;
  }
  if (sharedAtomIds.length !== 2) {
    return false;
  }

  const [firstShared, secondShared] = sharedAtomIds;
  const firstNeighbors = neighborMap.get(firstShared) ?? new Set();
  const secondNeighbors = neighborMap.get(secondShared) ?? new Set();
  const ringASet = new Set(rings[ringA]);
  const ringBSet = new Set(rings[ringB]);

  for (const neighborId of firstNeighbors) {
    if (neighborId === secondShared || !secondNeighbors.has(neighborId)) {
      continue;
    }
    if (ringASet.has(neighborId) || ringBSet.has(neighborId)) {
      return true;
    }
  }

  return false;
}

/**
 * Classifies the connection kind between two rings.
 * @param {object} molecule - Molecule-like graph.
 * @param {Array<Array<string>>} rings - Ring atom lists.
 * @param {number} ringA - First ring index.
 * @param {number} ringB - Second ring index.
 * @param {string[]} [sharedAtomIds] - Optional shared atom IDs.
 * @param {Map<string, Set<string>>} [neighborMap] - Optional precomputed neighbor map.
 * @returns {'bridged'|'spiro'|'fused'|null} Connection kind.
 */
export function classifyRingConnection(molecule, rings, ringA, ringB, sharedAtomIds = findSharedAtoms(rings[ringA], rings[ringB]), neighborMap = buildNeighborMap(molecule)) {
  if (isBridgedConnection(molecule, rings, ringA, ringB, sharedAtomIds, neighborMap)) {
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
 * Builds explicit ring-connection descriptors for a ring set.
 * @param {object} molecule - Molecule-like graph.
 * @param {Array<Array<string>>} rings - Ring atom lists.
 * @param {number[]|null} [ringIds] - Optional scoped ring IDs. Defaults to all rings.
 * @returns {{connections: object[], ringAdj: Map<number, number[]>, connectionByPair: Map<string, object>}} Ring connections.
 */
export function buildRingConnections(molecule, rings, ringIds = null) {
  const scopedRingIds = ringIds ? [...ringIds] : rings.map((_, index) => index);
  const neighborMap = buildNeighborMap(molecule);
  const ringAdj = new Map(scopedRingIds.map(ringId => [ringId, []]));
  const connections = [];
  const connectionByPair = new Map();

  for (let i = 0; i < scopedRingIds.length; i++) {
    for (let j = i + 1; j < scopedRingIds.length; j++) {
      const firstRingId = scopedRingIds[i];
      const secondRingId = scopedRingIds[j];
      const sharedAtomIds = findSharedAtoms(rings[firstRingId], rings[secondRingId]);
      if (sharedAtomIds.length === 0) {
        continue;
      }
      const kind = classifyRingConnection(molecule, rings, firstRingId, secondRingId, sharedAtomIds, neighborMap);
      if (!kind) {
        continue;
      }
      const connection = {
        firstRingId,
        secondRingId,
        sharedAtomIds,
        kind
      };
      connections.push(connection);
      ringAdj.get(firstRingId)?.push(secondRingId);
      ringAdj.get(secondRingId)?.push(firstRingId);
      connectionByPair.set(ringConnectionKey(firstRingId, secondRingId), connection);
    }
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
 * @param {number} firstRingId - First ring index.
 * @param {number} secondRingId - Second ring index.
 * @returns {object|null} Matching connection or null.
 */
export function getRingConnection(connectionByPair, firstRingId, secondRingId) {
  return connectionByPair.get(ringConnectionKey(firstRingId, secondRingId)) ?? null;
}

/**
 * Groups rings connected by bridged connections into bridged components.
 * @param {Array<Array<string>>} rings - Ring atom lists.
 * @param {number[]} ringIds - Scoped ring IDs.
 * @param {object[]} connections - Ring connection descriptors.
 * @returns {{components: {ringIds: number[], atomIds: string[]}[], ringToComponent: Map<number, {ringIds: number[], atomIds: string[]}>}} Bridged component summary.
 */
export function buildBridgedRingComponents(rings, ringIds, connections) {
  const scopedRingIds = [...ringIds];
  const bridgedAdj = new Map(scopedRingIds.map(ringId => [ringId, []]));
  for (const connection of connections) {
    if (connection.kind !== 'bridged') {
      continue;
    }
    bridgedAdj.get(connection.firstRingId)?.push(connection.secondRingId);
    bridgedAdj.get(connection.secondRingId)?.push(connection.firstRingId);
  }

  const components = [];
  const ringToComponent = new Map();
  const seen = new Set();
  for (const ringId of scopedRingIds) {
    if (seen.has(ringId) || (bridgedAdj.get(ringId)?.length ?? 0) === 0) {
      continue;
    }
    const queue = [ringId];
    const componentRingIds = [];
    seen.add(ringId);
    while (queue.length > 0) {
      const currentRingId = queue.shift();
      componentRingIds.push(currentRingId);
      for (const nextRingId of bridgedAdj.get(currentRingId) ?? []) {
        if (seen.has(nextRingId)) {
          continue;
        }
        seen.add(nextRingId);
        queue.push(nextRingId);
      }
    }
    const atomIdSet = new Set();
    for (const componentRingId of componentRingIds) {
      for (const atomId of rings[componentRingId]) {
        atomIdSet.add(atomId);
      }
    }
    const component = {
      ringIds: componentRingIds,
      atomIds: [...atomIdSet]
    };
    components.push(component);
    for (const componentRingId of componentRingIds) {
      ringToComponent.set(componentRingId, component);
    }
  }

  return {
    components,
    ringToComponent
  };
}

/** @module topology/ring-analysis */

import { buildCanonicalRingSignature } from './canonical-order.js';
import { createRingSystem } from '../model/ring-system.js';

function compareStrings(firstValue, secondValue) {
  return String(firstValue).localeCompare(String(secondValue), 'en', { numeric: true });
}

function ringKey(atomIds) {
  return [...atomIds].sort(compareStrings).join('\0');
}

function ringBondKey(firstAtomId, secondAtomId) {
  return compareStrings(firstAtomId, secondAtomId) <= 0 ? `${firstAtomId}\0${secondAtomId}` : `${secondAtomId}\0${firstAtomId}`;
}

function ringBondKeys(ringAtomIds) {
  const keys = [];
  for (let index = 0; index < ringAtomIds.length; index++) {
    keys.push(ringBondKey(ringAtomIds[index], ringAtomIds[(index + 1) % ringAtomIds.length]));
  }
  return keys;
}

/**
 * Finds the shortest cycle containing a bond by removing the bond and finding
 * the shortest path between its endpoints.
 * @param {object} molecule - Molecule-like graph.
 * @param {object} bond - Source molecule bond.
 * @returns {string[]|null} Cycle atom IDs, or null when the bond is acyclic.
 */
function shortestCycleThroughBond(molecule, bond) {
  const [firstAtomId, secondAtomId] = bond.atoms ?? [];
  if (!firstAtomId || !secondAtomId) {
    return null;
  }

  const previousByAtomId = new Map([[firstAtomId, null]]);
  const queue = [firstAtomId];
  let queueHead = 0;
  while (queueHead < queue.length) {
    const atomId = queue[queueHead++];
    for (const bondId of molecule.atoms.get(atomId)?.bonds ?? []) {
      if (bondId === bond.id) {
        continue;
      }
      const neighborBond = molecule.bonds.get(bondId);
      if (!neighborBond) {
        continue;
      }
      const neighborAtomId = neighborBond.getOtherAtom(atomId);
      if (!neighborAtomId || previousByAtomId.has(neighborAtomId)) {
        continue;
      }
      previousByAtomId.set(neighborAtomId, atomId);
      if (neighborAtomId === secondAtomId) {
        const cycleAtomIds = [];
        for (let currentAtomId = secondAtomId; currentAtomId != null; currentAtomId = previousByAtomId.get(currentAtomId)) {
          cycleAtomIds.push(currentAtomId);
        }
        cycleAtomIds.reverse();
        return cycleAtomIds;
      }
      queue.push(neighborAtomId);
    }
  }

  return null;
}

function createRingDescriptor(molecule, atomIds, canonicalAtomRank, rawIndex, supplemental = false) {
  let aromaticAtomCount = 0;
  for (const atomId of atomIds) {
    const atom = molecule.atoms.get(atomId);
    if ((typeof atom?.isAromatic === 'function' && atom.isAromatic()) || atom?.properties.aromatic) {
      aromaticAtomCount++;
    }
  }
  return {
    rawIndex,
    atomIds,
    size: atomIds.length,
    aromatic: aromaticAtomCount === atomIds.length && atomIds.length > 0,
    aromaticAtomCount,
    supplemental,
    signature: buildCanonicalRingSignature(atomIds, canonicalAtomRank, molecule)
  };
}

function withSupplementalBondCoveringRings(molecule, rings, canonicalAtomRank) {
  const seenRingKeys = new Set(rings.map(ring => ringKey(ring.atomIds)));
  const supplementedRings = [...rings];
  const coveredRingBondKeys = new Set();
  for (const ring of rings) {
    for (const key of ringBondKeys(ring.atomIds)) {
      coveredRingBondKeys.add(key);
    }
  }

  for (const bond of molecule.bonds.values()) {
    const [firstAtomId, secondAtomId] = bond.atoms ?? [];
    if (!firstAtomId || !secondAtomId) {
      continue;
    }
    const bondKey = ringBondKey(firstAtomId, secondAtomId);
    if (
      coveredRingBondKeys.has(bondKey) ||
      typeof bond.isInRing !== 'function' ||
      !bond.isInRing(molecule)
    ) {
      continue;
    }

    const cycleAtomIds = shortestCycleThroughBond(molecule, bond);
    if (!cycleAtomIds || cycleAtomIds.length < 3) {
      continue;
    }
    const key = ringKey(cycleAtomIds);
    if (seenRingKeys.has(key)) {
      continue;
    }
    seenRingKeys.add(key);
    const supplementalRing = createRingDescriptor(molecule, cycleAtomIds, canonicalAtomRank, supplementedRings.length, true);
    supplementedRings.push(supplementalRing);
    for (const coveredKey of ringBondKeys(supplementalRing.atomIds)) {
      coveredRingBondKeys.add(coveredKey);
    }
  }

  return supplementedRings;
}

/**
 * Returns atom IDs shared by two rings.
 * @param {string[]} firstRingAtomIds - First ring atom IDs.
 * @param {string[]} secondRingAtomIds - Second ring atom IDs.
 * @returns {string[]} Shared atom IDs.
 */
export function findSharedAtoms(firstRingAtomIds, secondRingAtomIds) {
  const atomIdSet = new Set(firstRingAtomIds);
  return secondRingAtomIds.filter(atomId => atomIdSet.has(atomId)).sort(compareStrings);
}

/**
 * Groups rings into ring systems by shared atoms.
 * @param {string[][]} ringAtomIdsList - Ring atom ID arrays.
 * @returns {{atomIds: string[], ringIds: number[]}[]} Ring-system descriptors.
 */
export function detectRingSystems(ringAtomIdsList) {
  if (ringAtomIdsList.length === 0) {
    return [];
  }
  const parent = ringAtomIdsList.map((_, index) => index);
  function find(index) {
    while (parent[index] !== index) {
      parent[index] = parent[parent[index]];
      index = parent[index];
    }
    return index;
  }
  function union(firstIndex, secondIndex) {
    parent[find(firstIndex)] = find(secondIndex);
  }

  const atomToRings = new Map();
  for (let ringIndex = 0; ringIndex < ringAtomIdsList.length; ringIndex++) {
    for (const atomId of ringAtomIdsList[ringIndex]) {
      if (!atomToRings.has(atomId)) {
        atomToRings.set(atomId, []);
      }
      atomToRings.get(atomId).push(ringIndex);
    }
  }

  for (const ringIndexes of atomToRings.values()) {
    for (let index = 1; index < ringIndexes.length; index++) {
      union(ringIndexes[0], ringIndexes[index]);
    }
  }

  const systems = new Map();
  for (let ringIndex = 0; ringIndex < ringAtomIdsList.length; ringIndex++) {
    const root = find(ringIndex);
    if (!systems.has(root)) {
      systems.set(root, { atomIds: new Set(), ringIds: [] });
    }
    const system = systems.get(root);
    system.ringIds.push(ringIndex);
    for (const atomId of ringAtomIdsList[ringIndex]) {
      system.atomIds.add(atomId);
    }
  }

  return [...systems.values()].map(system => ({
    atomIds: [...system.atomIds],
    ringIds: system.ringIds
  }));
}

/**
 * Returns the raw ring atom-id lists from the current ring adapter boundary.
 * This is the only place in layout/engine that should call `molecule.getRings()`
 * directly during the initial adapter-backed phase.
 * @param {object} molecule - Molecule-like graph.
 * @returns {string[][]} Ring atom-id lists.
 */
export function getRingAtomIds(molecule) {
  return molecule.getRings().map(ringAtomIds => [...ringAtomIds]);
}

/**
 * Adapts the current molecule ring perception into deterministic layout ring
 * and ring-system descriptors.
 * @param {object} molecule - Molecule-like graph.
 * @param {Map<string, number>} canonicalAtomRank - Canonical heavy-atom ranks.
 * @returns {{rings: object[], ringSystems: object[]}} Ring analysis results.
 */
export function analyzeRings(molecule, canonicalAtomRank = new Map()) {
  const adaptedRings = withSupplementalBondCoveringRings(
    molecule,
    getRingAtomIds(molecule).map((ringAtomIds, rawIndex) => createRingDescriptor(molecule, [...ringAtomIds], canonicalAtomRank, rawIndex)),
    canonicalAtomRank
  )
    .sort((firstRing, secondRing) => {
      if (secondRing.size !== firstRing.size) {
        return secondRing.size - firstRing.size;
      }
      const signatureCompare = compareStrings(firstRing.signature, secondRing.signature);
      if (signatureCompare !== 0) {
        return signatureCompare;
      }
      return firstRing.rawIndex - secondRing.rawIndex;
    })
    .map((ring, index) => ({
      ...ring,
      id: index
    }));

  const rawRingSystems = detectRingSystems(adaptedRings.map(ring => ring.atomIds));
  const ringSystems = rawRingSystems
    .map(system => createRingSystem(system, adaptedRings, canonicalAtomRank, -1))
    .sort((firstSystem, secondSystem) => {
      if (secondSystem.atomIds.length !== firstSystem.atomIds.length) {
        return secondSystem.atomIds.length - firstSystem.atomIds.length;
      }
      return compareStrings(firstSystem.signature, secondSystem.signature);
    })
    .map((system, index) => ({ ...system, id: index }));

  return {
    rings: adaptedRings,
    ringSystems
  };
}

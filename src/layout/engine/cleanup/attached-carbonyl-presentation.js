/** @module cleanup/attached-carbonyl-presentation */

import { collectCutSubtree } from './subtree-utils.js';

/**
 * Returns whether a descriptor represents an O-linked acyclic carbonyl carrying
 * a sizeable attached ring block whose mirror choice affects presentation.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {{anchorAtomId: string, rootAtomId: string, subtreeAtomIds: string[]}|null} descriptor - Candidate descriptor.
 * @returns {boolean} True when the descriptor matches the targeted presentation case.
 */
export function supportsAttachedCarbonylPresentationPreference(layoutGraph, descriptor) {
  const anchorAtom = layoutGraph.atoms.get(descriptor?.anchorAtomId);
  const rootAtom = layoutGraph.atoms.get(descriptor?.rootAtomId);
  if (!anchorAtom || !rootAtom || anchorAtom.element !== 'O' || rootAtom.element !== 'C') {
    return false;
  }
  if (rootAtom.aromatic || rootAtom.heavyDegree !== 3 || (layoutGraph.atomToRings.get(descriptor.rootAtomId)?.length ?? 0) > 0) {
    return false;
  }

  let nonAromaticMultipleBondCount = 0;
  let ringNeighborCount = 0;
  for (const bond of layoutGraph.bondsByAtomId.get(descriptor.rootAtomId) ?? []) {
    if (!bond || bond.kind !== 'covalent') {
      continue;
    }
    const neighborAtomId = bond.a === descriptor.rootAtomId ? bond.b : bond.a;
    const neighborAtom = layoutGraph.atoms.get(neighborAtomId);
    if (!neighborAtom || neighborAtom.element === 'H') {
      continue;
    }
    if (!bond.aromatic && (bond.order ?? 1) >= 2) {
      nonAromaticMultipleBondCount++;
    }
    if (neighborAtomId !== descriptor.anchorAtomId && (layoutGraph.atomToRings.get(neighborAtomId)?.length ?? 0) > 0) {
      ringNeighborCount++;
    }
  }

  if (nonAromaticMultipleBondCount !== 1 || ringNeighborCount === 0) {
    return false;
  }

  let subtreeRingAtomCount = 0;
  for (const atomId of descriptor.subtreeAtomIds) {
    if ((layoutGraph.atomToRings.get(atomId)?.length ?? 0) > 0 && layoutGraph.atoms.get(atomId)?.element !== 'H') {
      subtreeRingAtomCount++;
    }
  }
  return subtreeRingAtomCount >= 3;
}

/**
 * Collects single-bond O→carbonyl descriptors whose attached ring blocks can
 * benefit from the targeted presentation scoring.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Current coordinate map.
 * @param {Set<string>|null} [focusAtomIds] - Optional focus set for local scoring.
 * @returns {Array<{anchorAtomId: string, rootAtomId: string, subtreeAtomIds: string[]}>} Matching descriptors.
 */
export function collectAttachedCarbonylPresentationDescriptors(layoutGraph, coords, focusAtomIds = null) {
  const focusSet = focusAtomIds instanceof Set && focusAtomIds.size > 0 ? focusAtomIds : null;
  const descriptors = [];
  const seen = new Set();

  for (const bond of layoutGraph.bonds?.values?.() ?? []) {
    if (!bond || bond.kind !== 'covalent' || bond.inRing || (bond.order ?? 1) !== 1) {
      continue;
    }
    for (const [anchorAtomId, rootAtomId] of [
      [bond.a, bond.b],
      [bond.b, bond.a]
    ]) {
      const subtreeAtomIds = [...collectCutSubtree(layoutGraph, rootAtomId, anchorAtomId)].filter(atomId => coords.has(atomId));
      if (subtreeAtomIds.length === 0) {
        continue;
      }
      const descriptor = {
        anchorAtomId,
        rootAtomId,
        subtreeAtomIds
      };
      if (!supportsAttachedCarbonylPresentationPreference(layoutGraph, descriptor)) {
        continue;
      }
      if (
        focusSet
        && !focusSet.has(anchorAtomId)
        && !focusSet.has(rootAtomId)
        && !subtreeAtomIds.some(atomId => focusSet.has(atomId))
      ) {
        continue;
      }
      const key = `${anchorAtomId}->${rootAtomId}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      descriptors.push(descriptor);
    }
  }

  return descriptors;
}

/**
 * Measures the minimum heavy-atom clearance between the attached carbonyl
 * subtree and the rest of the scaffold.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Current coordinate map.
 * @param {{anchorAtomId: string, rootAtomId: string, subtreeAtomIds: string[]}} descriptor - Target descriptor.
 * @returns {number|null} Minimum clearance distance, or null when unsupported.
 */
export function measureAttachedCarbonylSubtreeClearance(layoutGraph, coords, descriptor) {
  if (!supportsAttachedCarbonylPresentationPreference(layoutGraph, descriptor)) {
    return null;
  }

  const subtreeAtomIds = new Set(descriptor.subtreeAtomIds);
  const subtreeHeavyAtomIds = [];
  const scaffoldHeavyAtomIds = [];

  for (const atomId of coords.keys()) {
    const atom = layoutGraph.atoms.get(atomId);
    if (!atom || atom.element === 'H') {
      continue;
    }
    if (atomId === descriptor.rootAtomId) {
      continue;
    }
    if (subtreeAtomIds.has(atomId)) {
      subtreeHeavyAtomIds.push(atomId);
      continue;
    }
    if (atomId !== descriptor.anchorAtomId) {
      scaffoldHeavyAtomIds.push(atomId);
    }
  }

  if (subtreeHeavyAtomIds.length === 0 || scaffoldHeavyAtomIds.length === 0) {
    return null;
  }

  let minSq = Infinity;
  for (let i = 0; i < subtreeHeavyAtomIds.length; i++) {
    const p1 = coords.get(subtreeHeavyAtomIds[i]);
    if (!p1) {
      continue;
    }
    for (let j = 0; j < scaffoldHeavyAtomIds.length; j++) {
      const p2 = coords.get(scaffoldHeavyAtomIds[j]);
      if (!p2) {
        continue;
      }
      const dx = p1.x - p2.x;
      const dy = p1.y - p2.y;
      const distSq = dx * dx + dy * dy;
      if (distSq < minSq) {
        minSq = distSq;
      }
    }
  }

  return minSq < Infinity ? Math.sqrt(minSq) : null;
}

/**
 * Adds a crowding penalty for targeted attached-carbonyl ring blocks so cleanup
 * can distinguish cleaner mirror choices that ordinary ring-outward scoring
 * treats as equivalent.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Current coordinate map.
 * @param {{focusAtomIds?: Set<string>|null}} [options] - Optional focus set for local scoring.
 * @returns {number} Total presentation penalty contribution.
 */
export function measureAttachedCarbonylPresentationPenalty(layoutGraph, coords, options = {}) {
  const descriptors = collectAttachedCarbonylPresentationDescriptors(layoutGraph, coords, options.focusAtomIds);
  const bondLength = layoutGraph.options?.bondLength ?? 1.5;
  let penalty = 0;

  for (const descriptor of descriptors) {
    const clearance = measureAttachedCarbonylSubtreeClearance(layoutGraph, coords, descriptor);
    if (clearance != null && clearance > 1e-6) {
      penalty += (2 * bondLength) / clearance;
    }
  }

  return penalty;
}

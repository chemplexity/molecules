/** @module stereo/ez */

import { assignCIPRanks } from '../../../core/Molecule.js';

const MAX_GENERIC_CYCLIC_EZ_RESCUE_RING_SIZE = 11;

function heavyNeighborIds(molecule, atomId, excludedAtomId) {
  const atom = molecule.atoms.get(atomId);
  if (!atom) {
    return [];
  }
  const neighborIds = [];
  for (const bondId of atom.bonds) {
    const bond = molecule.bonds.get(bondId);
    if (!bond) {
      continue;
    }
    const otherAtomId = bond.getOtherAtom(atomId);
    if (!otherAtomId || otherAtomId === excludedAtomId) {
      continue;
    }
    neighborIds.push(otherAtomId);
  }
  return neighborIds;
}

/**
 * Returns the highest-CIP-priority substituent attached to an alkene center.
 * @param {object} molecule - Molecule-like graph.
 * @param {string} centerAtomId - Alkene endpoint atom ID.
 * @param {string} excludedAtomId - Other alkene endpoint atom ID.
 * @returns {string|null} Highest-priority substituent atom ID.
 */
export function highestPriorityAlkeneSubstituentId(molecule, centerAtomId, excludedAtomId) {
  const neighborIds = heavyNeighborIds(molecule, centerAtomId, excludedAtomId);
  if (neighborIds.length === 0) {
    return null;
  }

  const ranks = assignCIPRanks(centerAtomId, neighborIds, molecule);
  let bestAtomId = null;
  let bestRank = -Infinity;
  let bestCount = 0;
  for (let index = 0; index < neighborIds.length; index++) {
    const rank = ranks[index] ?? 0;
    if (rank > bestRank) {
      bestRank = rank;
      bestAtomId = neighborIds[index];
      bestCount = 1;
    } else if (rank === bestRank) {
      bestCount++;
    }
  }

  return bestCount === 1 ? bestAtomId : null;
}

function prioritySubstituentCacheKey(centerAtomId, excludedAtomId) {
  return `${centerAtomId}\0${excludedAtomId}`;
}

/**
 * Returns the highest-priority alkene substituent, caching the CIP result on
 * the layout graph for repeated E/Z audit and enforcement passes.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {string} centerAtomId - Alkene endpoint atom ID.
 * @param {string} excludedAtomId - Other alkene endpoint atom ID.
 * @returns {string|null} Highest-priority substituent atom ID.
 */
export function highestPriorityAlkeneSubstituentIdForLayoutGraph(layoutGraph, centerAtomId, excludedAtomId) {
  const molecule = layoutGraph?.sourceMolecule ?? null;
  if (!molecule) {
    return null;
  }
  const cache = layoutGraph._ezPrioritySubstituentCache ??= new Map();
  const cacheKey = prioritySubstituentCacheKey(centerAtomId, excludedAtomId);
  if (cache.has(cacheKey)) {
    return cache.get(cacheKey);
  }
  const substituentId = highestPriorityAlkeneSubstituentId(molecule, centerAtomId, excludedAtomId);
  cache.set(cacheKey, substituentId);
  return substituentId;
}

/**
 * Returns the smallest qualifying ring that contains both annotated double-bond
 * atoms. Bonds inside smaller rings are treated as unsupported for `E/Z`
 * enforcement and audit purposes because the current engine intentionally does
 * not try to rescue them.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {object} bond - Layout bond descriptor.
 * @returns {object|null} Smallest qualifying ring descriptor, or null.
 */
export function smallestQualifyingStereoRing(layoutGraph, bond) {
  let bestRing = null;
  for (const ring of layoutGraph.rings ?? []) {
    if (ring.size < 8) {
      continue;
    }
    if (!ring.atomIds.includes(bond.a) || !ring.atomIds.includes(bond.b)) {
      continue;
    }
    if (!bestRing || ring.size < bestRing.size) {
      bestRing = ring;
    }
  }
  return bestRing;
}

/**
 * Returns whether an annotated double bond is within the current stereo rescue
 * support envelope. Non-ring and exocyclic annotated bonds are supported;
 * endocyclic annotated bonds are only supported for qualifying medium/large
 * rings where the engine has an explicit rescue strategy.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {object} bond - Layout bond descriptor.
 * @returns {boolean} True when the bond participates in enforceable `E/Z` audit.
 */
export function isSupportedAnnotatedDoubleBond(layoutGraph, bond) {
  return !bond.inRing || smallestQualifyingStereoRing(layoutGraph, bond) != null;
}

/**
 * Returns whether a cyclic annotated double bond has a complete placed ring
 * system context. Partial mixed layouts can place the four local alkene atoms
 * while omitting adjacent fused-ring atoms; those fragments are not stable
 * enough to audit as enforceable cyclic `E/Z` depictions.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Coordinate map.
 * @param {object} bond - Layout bond descriptor.
 * @returns {boolean} True when the bond has enough coordinates for cyclic `E/Z` audit/enforcement.
 */
export function hasCompleteCyclicEZContext(layoutGraph, coords, bond) {
  if (!bond.inRing) {
    return true;
  }

  const firstRingSystemId = layoutGraph.atomToRingSystemId?.get(bond.a);
  const secondRingSystemId = layoutGraph.atomToRingSystemId?.get(bond.b);
  const ringSystem = firstRingSystemId != null && firstRingSystemId === secondRingSystemId
    ? layoutGraph.ringSystemById?.get(firstRingSystemId)
    : null;
  if (ringSystem) {
    return ringSystem.atomIds.every(atomId => coords.has(atomId));
  }

  const ring = smallestQualifyingStereoRing(layoutGraph, bond);
  return ring ? ring.atomIds.every(atomId => coords.has(atomId)) : false;
}

/**
 * Returns whether a cyclic annotated double bond can be rescued by the generic
 * reflection strategy. Fused macrocycle systems and larger monocyclic
 * macrocycles need dedicated templates or a correct seed; reflecting a side of
 * those systems can satisfy `E/Z` only by tearing ring bonds open.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Coordinate map.
 * @param {object} bond - Layout bond descriptor.
 * @returns {boolean} True when generic cyclic `E/Z` enforcement is safe to attempt.
 */
export function hasEnforceableCyclicEZContext(layoutGraph, coords, bond) {
  if (!bond.inRing) {
    return true;
  }
  if (!hasCompleteCyclicEZContext(layoutGraph, coords, bond)) {
    return false;
  }

  const firstRingSystemId = layoutGraph.atomToRingSystemId?.get(bond.a);
  const secondRingSystemId = layoutGraph.atomToRingSystemId?.get(bond.b);
  const ringSystem = firstRingSystemId != null && firstRingSystemId === secondRingSystemId
    ? layoutGraph.ringSystemById?.get(firstRingSystemId)
    : null;
  if ((ringSystem?.ringIds?.length ?? 1) > 1) {
    return false;
  }

  const ring = smallestQualifyingStereoRing(layoutGraph, bond);
  return ring != null && ring.size <= MAX_GENERIC_CYCLIC_EZ_RESCUE_RING_SIZE;
}

/**
 * Returns whether an annotated double bond should count as an auditable `E/Z`
 * check for the current coordinates. Fused and larger macrocyclic systems that
 * already depict the requested geometry remain auditable, but mismatched
 * systems are left unsupported unless the generic rescuer can safely operate on
 * them.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Coordinate map.
 * @param {object} bond - Layout bond descriptor.
 * @param {'E'|'Z'|null} targetStereo - Requested stereodescriptor.
 * @param {'E'|'Z'|null} actualStereo - Coordinate-implied stereodescriptor.
 * @returns {boolean} True when the check should contribute to supported `E/Z` audit counts.
 */
export function hasAuditableEZContext(layoutGraph, coords, bond, targetStereo, actualStereo) {
  if (!isSupportedAnnotatedDoubleBond(layoutGraph, bond)) {
    return false;
  }
  if (!bond.inRing) {
    return true;
  }
  if (targetStereo != null && actualStereo != null && targetStereo === actualStereo) {
    return true;
  }
  return hasEnforceableCyclicEZContext(layoutGraph, coords, bond);
}

/**
 * Collects the atom ids whose current coordinates directly determine the
 * supported annotated `E/Z` audit for the layout graph. Freezing these atoms
 * during a late cleanup touchup preserves rescued double-bond stereo while
 * still allowing unrelated overlap moves elsewhere in the layout.
 * @param {object} layoutGraph - Layout graph shell.
 * @returns {Set<string>} Stereo-defining atom ids for supported annotated double bonds.
 */
export function collectProtectedEZAtomIds(layoutGraph) {
  const atomIds = new Set();
  const molecule = layoutGraph.sourceMolecule;

  for (const bond of layoutGraph.bonds.values()) {
    if (bond.kind !== 'covalent' || bond.aromatic || bond.order !== 2) {
      continue;
    }
    const target = molecule.getEZStereo?.(bond.id) ?? null;
    if (!target || !isSupportedAnnotatedDoubleBond(layoutGraph, bond)) {
      continue;
    }

    atomIds.add(bond.a);
    atomIds.add(bond.b);

    const firstSubstituentId = highestPriorityAlkeneSubstituentIdForLayoutGraph(layoutGraph, bond.a, bond.b);
    const secondSubstituentId = highestPriorityAlkeneSubstituentIdForLayoutGraph(layoutGraph, bond.b, bond.a);
    if (firstSubstituentId) {
      atomIds.add(firstSubstituentId);
    }
    if (secondSubstituentId) {
      atomIds.add(secondSubstituentId);
    }
  }

  return atomIds;
}

/**
 * Derives the actual E/Z configuration of a placed alkene bond from coordinates.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Coordinate map.
 * @param {object} bond - Layout bond descriptor.
 * @returns {'E'|'Z'|null} Actual coordinate-implied stereodescriptor.
 */
export function actualAlkeneStereo(layoutGraph, coords, bond) {
  const firstAtomId = bond.a;
  const secondAtomId = bond.b;
  const firstPosition = coords.get(firstAtomId);
  const secondPosition = coords.get(secondAtomId);
  if (!firstPosition || !secondPosition) {
    return null;
  }

  const firstSubstituentId = highestPriorityAlkeneSubstituentIdForLayoutGraph(layoutGraph, firstAtomId, secondAtomId);
  const secondSubstituentId = highestPriorityAlkeneSubstituentIdForLayoutGraph(layoutGraph, secondAtomId, firstAtomId);
  if (!firstSubstituentId || !secondSubstituentId) {
    return null;
  }

  const firstSubstituentPosition = coords.get(firstSubstituentId);
  const secondSubstituentPosition = coords.get(secondSubstituentId);
  if (!firstSubstituentPosition || !secondSubstituentPosition) {
    return null;
  }

  const dx = secondPosition.x - firstPosition.x;
  const dy = secondPosition.y - firstPosition.y;
  const firstCross = dx * (firstSubstituentPosition.y - firstPosition.y) - dy * (firstSubstituentPosition.x - firstPosition.x);
  const secondCross = dx * (secondSubstituentPosition.y - secondPosition.y) - dy * (secondSubstituentPosition.x - secondPosition.x);
  if (Math.abs(firstCross) < 1e-6 || Math.abs(secondCross) < 1e-6) {
    return null;
  }

  return Math.sign(firstCross) === Math.sign(secondCross) ? 'Z' : 'E';
}

/**
 * Inspects all double-bond E/Z annotations against the current coordinate set.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Coordinate map.
 * @returns {{checkedBondCount: number, supportedCheckCount: number, unsupportedCheckCount: number, resolvedBondCount: number, violationCount: number, checks: Array<{bondId: string, target: 'E'|'Z', actual: 'E'|'Z'|null, ok: boolean, supported: boolean}>}} Stereo summary.
 */
export function inspectEZStereo(layoutGraph, coords) {
  const checks = [];
  let resolvedBondCount = 0;
  let supportedCheckCount = 0;

  for (const bond of layoutGraph.bonds.values()) {
    if (bond.kind !== 'covalent' || bond.aromatic || bond.order !== 2) {
      continue;
    }
    const target = layoutGraph.sourceMolecule.getEZStereo?.(bond.id) ?? null;
    if (target == null) {
      continue;
    }
    const actual = actualAlkeneStereo(layoutGraph, coords, bond);
    const supported = hasAuditableEZContext(layoutGraph, coords, bond, target, actual);
    if (actual != null) {
      resolvedBondCount++;
    }
    if (supported) {
      supportedCheckCount++;
    }
    checks.push({
      bondId: bond.id,
      target,
      actual,
      ok: (!supported) || (actual != null && actual === target),
      supported
    });
  }

  return {
    checkedBondCount: checks.length,
    supportedCheckCount,
    unsupportedCheckCount: checks.length - supportedCheckCount,
    resolvedBondCount,
    violationCount: checks.filter(check => check.supported && check.actual != null && check.actual !== check.target).length,
    checks
  };
}

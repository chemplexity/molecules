/** @module stereo/ez */

import { assignCIPRanks } from '../../../core/Molecule.js';

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

    const firstSubstituentId = highestPriorityAlkeneSubstituentId(molecule, bond.a, bond.b);
    const secondSubstituentId = highestPriorityAlkeneSubstituentId(molecule, bond.b, bond.a);
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
  const molecule = layoutGraph.sourceMolecule;
  const firstAtomId = bond.a;
  const secondAtomId = bond.b;
  const firstPosition = coords.get(firstAtomId);
  const secondPosition = coords.get(secondAtomId);
  if (!firstPosition || !secondPosition) {
    return null;
  }

  const firstSubstituentId = highestPriorityAlkeneSubstituentId(molecule, firstAtomId, secondAtomId);
  const secondSubstituentId = highestPriorityAlkeneSubstituentId(molecule, secondAtomId, firstAtomId);
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
    const supported = isSupportedAnnotatedDoubleBond(layoutGraph, bond);
    const actual = actualAlkeneStereo(layoutGraph, coords, bond);
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

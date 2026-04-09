/** @module stereo/ez */

import { assignCIPRanks } from '../../core/Molecule.js';

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
 * @returns {{checkedBondCount: number, resolvedBondCount: number, violationCount: number, checks: Array<{bondId: string, target: 'E'|'Z', actual: 'E'|'Z'|null, ok: boolean}>}} Stereo summary.
 */
export function inspectEZStereo(layoutGraph, coords) {
  const checks = [];
  let resolvedBondCount = 0;

  for (const bond of layoutGraph.bonds.values()) {
    if (bond.kind !== 'covalent' || bond.aromatic || bond.order !== 2) {
      continue;
    }
    const target = layoutGraph.sourceMolecule.getEZStereo?.(bond.id) ?? null;
    if (target == null) {
      continue;
    }
    const actual = actualAlkeneStereo(layoutGraph, coords, bond);
    if (actual != null) {
      resolvedBondCount++;
    }
    checks.push({
      bondId: bond.id,
      target,
      actual,
      ok: actual != null && actual === target
    });
  }

  return {
    checkedBondCount: checks.length,
    resolvedBondCount,
    violationCount: checks.filter(check => check.actual != null && check.actual !== check.target).length,
    checks
  };
}

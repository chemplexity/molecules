/** @module placement/attached-ring-mirrors */

import { auditLayout } from '../audit/audit.js';
import { findVisibleHeavyBondCrossings } from '../audit/invariants.js';
import { collectMovableAttachedRingDescriptors } from '../cleanup/presentation/attached-ring-fallback.js';
import { reflectAcrossLine } from '../geometry/transforms.js';

const MAX_HEAVY_ATOMS = 96;
const MAX_MIRROR_CANDIDATES = 16;
const MAX_BRANCH_HEAVY_ATOMS = 18;

/**
 * Reconsiders pendant aromatic-ring mirrors after their branches are placed.
 * Skeleton-only attachment scoring cannot distinguish symmetric ring poses
 * whose unplaced substituents will later cross a neighboring branch. Each
 * eligible ring receives just one rigid reflection about its attachment bond;
 * the scaffold, attachment axis, bond lengths, and internal angles stay fixed.
 *
 * Runs only for crossed mixed placements of at most 96 heavy atoms. Each
 * movable branch is limited to 18 heavy atoms;
 * one pass evaluates at most 16 mirrors. Fixed or stereo-bearing branches are
 * excluded. Acceptance strictly reduces crossings without worsening the other
 * geometry checks. No angular sweep or recursive search is introduced.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} inputCoords - Completed branch placement.
 * @param {Map<string, string>} bondValidationClasses - Existing per-bond classes.
 * @param {number} bondLength - Target bond length.
 * @returns {{coords: Map<string, {x: number, y: number}>, mirrors: number}} Accepted placement and mirror count.
 */
export function selectAttachedRingMirrors(layoutGraph, inputCoords, bondValidationClasses, bondLength) {
  const unchanged = { coords: inputCoords, mirrors: 0 };
  if (layoutGraph.options.allowBranchReflect === false || layoutGraph.traits.heavyAtomCount > MAX_HEAVY_ATOMS) {
    return unchanged;
  }
  const crossings = findVisibleHeavyBondCrossings(layoutGraph, inputCoords);
  if (crossings.length === 0) {
    return unchanged;
  }
  const crossingAtoms = new Set();
  for (const crossing of crossings) {
    for (const bondId of [crossing.firstBondId, crossing.secondBondId]) {
      const bond = layoutGraph.bonds.get(bondId);
      crossingAtoms.add(bond.a);
      crossingAtoms.add(bond.b);
    }
  }
  let coords = inputCoords;
  let mirrors = 0;
  let attempts = 0;
  let audit = auditLayout(layoutGraph, coords, { bondLength, bondValidationClasses });
  for (const descriptor of collectMovableAttachedRingDescriptors(layoutGraph, inputCoords)) {
    const { anchorAtomId, rootAtomId, subtreeAtomIds } = descriptor;
    const ringSystem = layoutGraph.ringSystemById.get(layoutGraph.atomToRingSystemId.get(rootAtomId));
    if (
      !layoutGraph.atoms.get(anchorAtomId)?.aromatic ||
      !layoutGraph.atoms.get(rootAtomId)?.aromatic ||
      ringSystem?.ringIds.length !== 1 ||
      ringSystem.atomIds.length > 8 ||
      !layoutGraph.ringById.get(ringSystem.ringIds[0])?.aromatic ||
      subtreeAtomIds.filter(atomId => layoutGraph.atoms.get(atomId)?.element !== 'H').length > MAX_BRANCH_HEAVY_ATOMS ||
      !subtreeAtomIds.some(atomId => crossingAtoms.has(atomId)) ||
      subtreeAtomIds.some(atomId => layoutGraph.atoms.get(atomId)?.chirality || (layoutGraph.bondsByAtomId.get(atomId) ?? []).some(bond => bond.stereo))
    ) {
      continue;
    }
    if (attempts++ >= MAX_MIRROR_CANDIDATES) {
      break;
    }
    const candidate = new Map(coords);
    for (const atomId of subtreeAtomIds) {
      candidate.set(atomId, reflectAcrossLine(coords.get(atomId), coords.get(anchorAtomId), coords.get(rootAtomId)));
    }
    const candidateAudit = auditLayout(layoutGraph, candidate, { bondLength, bondValidationClasses });
    if (
      candidateAudit.visibleHeavyBondCrossingCount >= audit.visibleHeavyBondCrossingCount ||
      candidateAudit.maxBondLengthDeviation > audit.maxBondLengthDeviation + 1e-9 ||
      candidateAudit.severeOverlapPenalty > audit.severeOverlapPenalty + 1e-9 ||
      [
        'visibleHeavyBondCrossingFailureCount',
        'severeOverlapCount',
        'bondLengthFailureCount',
        'labelOverlapCount',
        'collapsedMacrocycleCount',
        'ringSubstituentReadabilityFailureCount',
        'inwardRingSubstituentCount',
        'outwardAxisRingSubstituentFailureCount'
      ].some(key => candidateAudit[key] > audit[key])
    ) {
      continue;
    }
    coords = candidate;
    audit = candidateAudit;
    mirrors++;
  }
  return { coords, mirrors };
}

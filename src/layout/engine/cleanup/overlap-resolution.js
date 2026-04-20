/** @module cleanup/overlap-resolution */

import { buildAtomGrid, computeAtomDistortionCost, computeSubtreeOverlapCost, findSevereOverlaps } from '../audit/invariants.js';
import { angleOf, angularDifference, centroid, sub, wrapAngle } from '../geometry/vec2.js';
import { containsFrozenAtom } from './frozen-atoms.js';
import { probeRigidRotation, rigidDescriptorKey, rotateRigidDescriptorPositions } from './rigid-rotation.js';
import { collectCutSubtree } from './subtree-utils.js';
import { ANGLE_EPSILON, IMPROVEMENT_EPSILON, NUMERIC_EPSILON } from '../constants.js';

const RIGID_SUBTREE_ROTATION_ANGLES = Object.freeze([
  0,
  Math.PI / 6,
  -Math.PI / 6,
  Math.PI / 3,
  -Math.PI / 3,
  Math.PI / 2,
  -Math.PI / 2,
  (2 * Math.PI) / 3,
  -(2 * Math.PI) / 3,
  Math.PI
]);
const COARSE_RIGID_SUBTREE_ROTATION_ANGLES = Object.freeze([
  0,
  Math.PI / 3,
  -Math.PI / 3,
  Math.PI / 2,
  -Math.PI / 2,
  (2 * Math.PI) / 3,
  -(2 * Math.PI) / 3,
  Math.PI
]);
const EXACT_RING_ROOT_RELATIVE_ROTATION_OFFSETS = Object.freeze(
  RIGID_SUBTREE_ROTATION_ANGLES.filter(angle => Math.abs(angle) > ANGLE_EPSILON)
);
const LARGE_RIGID_SUBTREE_COMPONENT_ATOM_COUNT = 24;
const LARGE_RIGID_SUBTREE_SIZE = 6;
const MAX_RIGID_DESCRIPTOR_OPTIONS_PER_ATOM = 4;
const COMPACT_RING_ANCHORED_RIGID_SUBTREE_MAX_HEAVY_ATOMS = 6;
const COMPACT_RING_ANCHORED_RIGID_SUBTREE_MAX_ATOMS = 10;
const COMPACT_HYPERVALENT_RIGID_SUBTREE_ELEMENTS = new Set(['P', 'S', 'Se', 'As']);
const COMPACT_HYPERVALENT_RIGID_SUBTREE_MAX_HEAVY_ATOMS = 8;
const COMPACT_HYPERVALENT_RIGID_SUBTREE_MAX_ATOMS = 12;
const EXACT_HYPERVALENT_RELATIVE_ROTATION_OFFSETS = Object.freeze([
  Math.PI / 12,
  -(Math.PI / 12),
  Math.PI / 6,
  -(Math.PI / 6),
  Math.PI / 4,
  -(Math.PI / 4),
  Math.PI / 3,
  -(Math.PI / 3)
]);

function protectsLargeMoleculeBackbone(options) {
  return options.protectLargeMoleculeBackbone === true;
}

/**
 * Returns whether overlap cleanup should treat the atom as immovable.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {string} atomId - Atom identifier.
 * @param {object} [options] - Cleanup options.
 * @param {Set<string>|null} [options.frozenAtomIds] - Refinement-preserved atoms that cleanup must not move.
 * @returns {boolean} True when the atom must stay fixed during cleanup.
 */
function isFixedAtom(layoutGraph, atomId, options = {}) {
  return (layoutGraph.options.preserveFixed !== false && layoutGraph.fixedCoords.has(atomId)) || options.frozenAtomIds?.has(atomId) === true;
}

function atomPairKey(firstAtomId, secondAtomId) {
  return firstAtomId < secondAtomId ? `${firstAtomId}:${secondAtomId}` : `${secondAtomId}:${firstAtomId}`;
}

/**
 * Returns the heavy-atom count for one rigid cleanup subtree.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {string[]} subtreeAtomIds - Candidate subtree atom ids.
 * @returns {number} Heavy-atom count within the subtree.
 */
function subtreeHeavyAtomCount(layoutGraph, subtreeAtomIds) {
  return subtreeAtomIds.filter(atomId => layoutGraph.atoms.get(atomId)?.element !== 'H').length;
}

function isTerminalMultipleBondHetero(layoutGraph, centerAtomId, bond) {
  if (!layoutGraph || !bond || bond.kind !== 'covalent' || bond.aromatic || (bond.order ?? 1) < 2) {
    return false;
  }
  const neighborAtomId = bond.a === centerAtomId ? bond.b : bond.a;
  const neighborAtom = layoutGraph.atoms.get(neighborAtomId);
  if (!neighborAtom || neighborAtom.element === 'H' || neighborAtom.element === 'C') {
    return false;
  }
  return neighborAtom.heavyDegree === 1;
}

function isOrthogonalHypervalentCenter(layoutGraph, atomId) {
  const atom = layoutGraph.atoms.get(atomId);
  if (!atom || !COMPACT_HYPERVALENT_RIGID_SUBTREE_ELEMENTS.has(atom.element)) {
    return false;
  }

  let ligandCount = 0;
  let singleNeighborCount = 0;
  let terminalMultipleNeighborCount = 0;
  for (const bond of layoutGraph.bondsByAtomId.get(atomId) ?? []) {
    if (!bond || bond.kind !== 'covalent' || bond.aromatic) {
      return false;
    }
    const neighborAtomId = bond.a === atomId ? bond.b : bond.a;
    const neighborAtom = layoutGraph.atoms.get(neighborAtomId);
    if (!neighborAtom || neighborAtom.element === 'H') {
      continue;
    }
    ligandCount++;
    if ((bond.order ?? 1) === 1) {
      singleNeighborCount++;
      continue;
    }
    if (isTerminalMultipleBondHetero(layoutGraph, atomId, bond)) {
      terminalMultipleNeighborCount++;
      continue;
    }
    return false;
  }

  if (ligandCount !== 4) {
    return false;
  }
  return (
    (singleNeighborCount === 2 && terminalMultipleNeighborCount === 2)
    || (singleNeighborCount === 3 && terminalMultipleNeighborCount === 1)
  );
}

/**
 * Returns whether a small non-ring subtree rooted on a ring atom should also be
 * treated as a rigid overlap-cleanup unit. Compact acyl/carboxyl and similar
 * ring substituents can often resolve a clash locally, which is usually better
 * than swinging an entire attached ring block through a chemically sensitive
 * linker just because that larger rigid move happened to be available.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {string} anchorAtomId - Anchor atom id.
 * @param {string[]} subtreeAtomIds - Candidate subtree atom ids.
 * @param {number} heavyAtomCount - Heavy-atom count in the subtree.
 * @returns {boolean} True when the subtree should be offered as a rigid move.
 */
function isCompactRingAnchoredRigidSubtree(layoutGraph, anchorAtomId, subtreeAtomIds, heavyAtomCount) {
  if ((layoutGraph.atomToRings?.get(anchorAtomId)?.length ?? 0) === 0) {
    return false;
  }
  if (heavyAtomCount < 2 || heavyAtomCount > COMPACT_RING_ANCHORED_RIGID_SUBTREE_MAX_HEAVY_ATOMS) {
    return false;
  }
  if (subtreeAtomIds.length > COMPACT_RING_ANCHORED_RIGID_SUBTREE_MAX_ATOMS) {
    return false;
  }
  return subtreeAtomIds.every(atomId => (layoutGraph.atomToRings?.get(atomId)?.length ?? 0) === 0);
}

/**
 * Returns whether a compact orthogonal hypervalent branch should be movable as
 * one rigid cleanup unit around its parent bond. This lets overlap cleanup
 * clear one colliding terminal ligand by rotating the whole phosphate/sulfone
 * block, rather than distorting an otherwise clean cross-like center.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {string} anchorAtomId - Anchor atom id.
 * @param {string} rootAtomId - Root atom id of the candidate subtree.
 * @param {string[]} subtreeAtomIds - Candidate subtree atom ids.
 * @param {number} heavyAtomCount - Heavy-atom count in the subtree.
 * @returns {boolean} True when the subtree should be offered as a rigid move.
 */
function isCompactHypervalentRigidSubtree(layoutGraph, anchorAtomId, rootAtomId, subtreeAtomIds, heavyAtomCount) {
  if ((layoutGraph.atomToRings?.get(anchorAtomId)?.length ?? 0) > 0) {
    return false;
  }
  if (!isOrthogonalHypervalentCenter(layoutGraph, rootAtomId)) {
    return false;
  }
  if (heavyAtomCount < 4 || heavyAtomCount > COMPACT_HYPERVALENT_RIGID_SUBTREE_MAX_HEAVY_ATOMS) {
    return false;
  }
  if (subtreeAtomIds.length > COMPACT_HYPERVALENT_RIGID_SUBTREE_MAX_ATOMS) {
    return false;
  }
  return subtreeAtomIds.every(atomId => (layoutGraph.atomToRings?.get(atomId)?.length ?? 0) === 0);
}

/**
 * Returns whether one rigid descriptor is a compact non-ring substituent rooted
 * directly on a ring atom, such as a carboxyl or acyl branch on an aromatic
 * ring. When several rigid rotations clear the same clash equally well, these
 * descriptors should prefer the exact local ring-outward direction instead of
 * merely maximizing separation from the overlapping atom.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {{anchorAtomId: string, subtreeAtomIds: string[]}} descriptor - Rigid-subtree descriptor.
 * @returns {boolean} True when the descriptor should preserve exact ring-root presentation.
 */
function isCompactRingAnchoredRigidDescriptor(layoutGraph, descriptor) {
  return isCompactRingAnchoredRigidSubtree(
    layoutGraph,
    descriptor.anchorAtomId,
    descriptor.subtreeAtomIds,
    subtreeHeavyAtomCount(layoutGraph, descriptor.subtreeAtomIds)
  );
}

function isCompactHypervalentRigidDescriptor(layoutGraph, descriptor) {
  return isCompactHypervalentRigidSubtree(
    layoutGraph,
    descriptor.anchorAtomId,
    descriptor.rootAtomId,
    descriptor.subtreeAtomIds,
    subtreeHeavyAtomCount(layoutGraph, descriptor.subtreeAtomIds)
  );
}

/**
 * Measures how far a rigid subtree root deviates from the local ring-outward
 * direction of its anchor. Lower values are better.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Current coordinate map.
 * @param {{anchorAtomId: string, rootAtomId: string}} descriptor - Rigid-subtree descriptor.
 * @param {Map<string, {x: number, y: number}>|null} [overridePositions] - Optional candidate positions.
 * @returns {number} Minimum outward-deviation angle in radians.
 */
function compactRingAnchoredRootOutwardDeviation(layoutGraph, coords, descriptor, overridePositions = null) {
  const anchorPosition = overridePositions?.get(descriptor.anchorAtomId) ?? coords.get(descriptor.anchorAtomId);
  const rootPosition = overridePositions?.get(descriptor.rootAtomId) ?? coords.get(descriptor.rootAtomId);
  if (!anchorPosition || !rootPosition) {
    return Number.POSITIVE_INFINITY;
  }

  const rootAngle = angleOf(sub(rootPosition, anchorPosition));
  let bestDeviation = Number.POSITIVE_INFINITY;
  for (const ring of layoutGraph.atomToRings?.get(descriptor.anchorAtomId) ?? []) {
    const ringPositions = ring.atomIds.map(atomId => overridePositions?.get(atomId) ?? coords.get(atomId)).filter(Boolean);
    if (ringPositions.length < 3) {
      continue;
    }
    const outwardAngle = angleOf(sub(anchorPosition, centroid(ringPositions)));
    bestDeviation = Math.min(bestDeviation, angularDifference(rootAngle, outwardAngle));
  }
  return bestDeviation;
}

/**
 * Returns whether one rigid cleanup move should beat another.
 * Overlap gain stays primary, then local presentation, then subtree size so
 * equally effective fixes prefer the smaller less-disruptive branch.
 * @param {object|null} incumbent - Current best rigid move.
 * @param {object} candidate - Candidate rigid move.
 * @returns {boolean} True when the candidate should replace the incumbent.
 */
function isBetterRigidMove(incumbent, candidate) {
  if (!incumbent) {
    return true;
  }
  const candidateHasExactRingRootPresentation = Number.isFinite(candidate.ringRootDeviation);
  const incumbentHasExactRingRootPresentation = Number.isFinite(incumbent.ringRootDeviation);
  if (candidateHasExactRingRootPresentation && incumbentHasExactRingRootPresentation) {
    if (candidate.ringRootDeviation < incumbent.ringRootDeviation - IMPROVEMENT_EPSILON) {
      return true;
    }
    if (Math.abs(candidate.ringRootDeviation - incumbent.ringRootDeviation) > IMPROVEMENT_EPSILON) {
      return false;
    }
  }
  if (candidate.improvement > incumbent.improvement + IMPROVEMENT_EPSILON) {
    return true;
  }
  if (Math.abs(candidate.improvement - incumbent.improvement) > IMPROVEMENT_EPSILON) {
    return false;
  }
  if (candidate.ringRootDeviation < incumbent.ringRootDeviation - IMPROVEMENT_EPSILON) {
    return true;
  }
  if (Math.abs(candidate.ringRootDeviation - incumbent.ringRootDeviation) > IMPROVEMENT_EPSILON) {
    return false;
  }
  const candidateTotalRingRootDeviation = candidate.totalRingRootDeviation ?? candidate.ringRootDeviation;
  const incumbentTotalRingRootDeviation = incumbent.totalRingRootDeviation ?? incumbent.ringRootDeviation;
  if (candidateTotalRingRootDeviation < incumbentTotalRingRootDeviation - IMPROVEMENT_EPSILON) {
    return true;
  }
  if (Math.abs(candidateTotalRingRootDeviation - incumbentTotalRingRootDeviation) > IMPROVEMENT_EPSILON) {
    return false;
  }
  if (candidate.subtreeHeavyAtomCount !== incumbent.subtreeHeavyAtomCount) {
    return candidate.subtreeHeavyAtomCount < incumbent.subtreeHeavyAtomCount;
  }
  if (candidate.subtreeAtomCount !== incumbent.subtreeAtomCount) {
    return candidate.subtreeAtomCount < incumbent.subtreeAtomCount;
  }
  return candidate.resolvedDistance > incumbent.resolvedDistance + IMPROVEMENT_EPSILON;
}

/**
 * Returns whether a candidate rigid-subtree descriptor should replace the
 * current descriptor for the same member atom.
 * @param {{anchorAtomId: string, rootAtomId: string, subtreeAtomIds: string[]}} candidate - Candidate descriptor.
 * @param {{anchorAtomId: string, rootAtomId: string, subtreeAtomIds: string[]}|undefined} incumbent - Existing descriptor.
 * @returns {boolean} True when the candidate is the better local move.
 */
function shouldReplaceRigidDescriptor(candidate, incumbent) {
  if (!incumbent) {
    return true;
  }
  if (candidate.subtreeAtomIds.length !== incumbent.subtreeAtomIds.length) {
    return candidate.subtreeAtomIds.length < incumbent.subtreeAtomIds.length;
  }
  if (candidate.rootAtomId !== incumbent.rootAtomId) {
    return candidate.rootAtomId.localeCompare(incumbent.rootAtomId, 'en', { numeric: true }) < 0;
  }
  return candidate.anchorAtomId.localeCompare(incumbent.anchorAtomId, 'en', { numeric: true }) < 0;
}

/**
 * Collects the rigid cleanup subtrees that can be moved as one unit during
 * overlap repair. The default set includes singly attached ring blocks plus
 * compact non-ring substituents rooted on ring atoms.
 * @param {object} layoutGraph - Layout graph shell.
 * @returns {Map<string, {anchorAtomId: string, rootAtomId: string, subtreeAtomIds: string[]}>} Preferred rigid-subtree descriptor by member atom ID.
 */
export function collectRigidPendantRingSubtrees(layoutGraph) {
  const descriptorsByAtomId = new Map();
  const ringAtomIds = new Set((layoutGraph.rings ?? []).flatMap(ring => ring.atomIds));
  const totalAtomCount = layoutGraph.atoms?.size ?? 0;
  if (ringAtomIds.size === 0 || totalAtomCount === 0) {
    return descriptorsByAtomId;
  }

  for (const bond of layoutGraph.bonds?.values?.() ?? []) {
    if (!bond || bond.kind !== 'covalent' || bond.inRing || (bond.order ?? 1) !== 1) {
      continue;
    }

    for (const [anchorAtomId, rootAtomId] of [
      [bond.a, bond.b],
      [bond.b, bond.a]
    ]) {
      const subtreeAtomIds = collectCutSubtree(layoutGraph, rootAtomId, anchorAtomId);
      if (subtreeAtomIds.has(anchorAtomId) || subtreeAtomIds.size >= totalAtomCount) {
        continue;
      }
      const descriptorAtomIds = [...subtreeAtomIds];
      const heavyAtomCount = subtreeHeavyAtomCount(layoutGraph, descriptorAtomIds);
      const includesRingAtoms = descriptorAtomIds.some(atomId => ringAtomIds.has(atomId));
      const includesCompactRingAnchoredSubtree =
        !includesRingAtoms
        && isCompactRingAnchoredRigidSubtree(layoutGraph, anchorAtomId, descriptorAtomIds, heavyAtomCount);
      const includesCompactHypervalentSubtree =
        !includesRingAtoms
        && isCompactHypervalentRigidSubtree(layoutGraph, anchorAtomId, rootAtomId, descriptorAtomIds, heavyAtomCount);
      if (heavyAtomCount === 0) {
        continue;
      }
      if (!includesRingAtoms && !includesCompactRingAnchoredSubtree && !includesCompactHypervalentSubtree) {
        continue;
      }
      if (includesRingAtoms && heavyAtomCount > 14) {
        continue;
      }
      let hasFixed = false;
      for (const id of subtreeAtomIds) { if (layoutGraph.fixedCoords.has(id)) { hasFixed = true; break; } }
      if (hasFixed) {
        continue;
      }

      const descriptor = {
        anchorAtomId,
        rootAtomId,
        subtreeAtomIds: descriptorAtomIds
      };
      for (const atomId of descriptor.subtreeAtomIds) {
        const existingDescriptor = descriptorsByAtomId.get(atomId);
        if (shouldReplaceRigidDescriptor(descriptor, existingDescriptor)) {
          descriptorsByAtomId.set(atomId, descriptor);
        }
      }
    }
  }

  return descriptorsByAtomId;
}

function rigidDescriptorsFromValue(value) {
  if (!value) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}

/**
 * Merges cleanup rigid-subtree descriptor maps. Values may be single
 * descriptors or arrays of descriptors per atom ID.
 * @param {...Map<string, {anchorAtomId: string, rootAtomId: string, subtreeAtomIds: string[]}|Array<{anchorAtomId: string, rootAtomId: string, subtreeAtomIds: string[]}>>} descriptorMaps - Descriptor maps to merge.
 * @returns {Map<string, Array<{anchorAtomId: string, rootAtomId: string, subtreeAtomIds: string[]}>>} Merged descriptor map.
 */
export function mergeRigidSubtreesByAtomId(...descriptorMaps) {
  const merged = new Map();

  for (const descriptorMap of descriptorMaps) {
    if (!(descriptorMap instanceof Map) || descriptorMap.size === 0) {
      continue;
    }

    for (const [atomId, descriptorValue] of descriptorMap) {
      const nextDescriptors = merged.get(atomId) ?? [];
      const seenDescriptorKeys = new Set();
      for (const d of nextDescriptors) { seenDescriptorKeys.add(rigidDescriptorKey(d)); }
      for (const descriptor of rigidDescriptorsFromValue(descriptorValue)) {
        const key = rigidDescriptorKey(descriptor);
        if (seenDescriptorKeys.has(key)) {
          continue;
        }
        nextDescriptors.push(descriptor);
        seenDescriptorKeys.add(key);
      }
      nextDescriptors.sort((firstDescriptor, secondDescriptor) => {
        if (firstDescriptor.subtreeAtomIds.length !== secondDescriptor.subtreeAtomIds.length) {
          return firstDescriptor.subtreeAtomIds.length - secondDescriptor.subtreeAtomIds.length;
        }
        if (firstDescriptor.rootAtomId !== secondDescriptor.rootAtomId) {
          return firstDescriptor.rootAtomId.localeCompare(secondDescriptor.rootAtomId, 'en', { numeric: true });
        }
        return firstDescriptor.anchorAtomId.localeCompare(secondDescriptor.anchorAtomId, 'en', { numeric: true });
      });
      merged.set(atomId, nextDescriptors);
    }
  }

  return merged;
}

/**
 * Returns whether a rigid-subtree descriptor touches any frozen atom.
 * @param {{subtreeAtomIds: string[]}} descriptor - Rigid-subtree descriptor.
 * @param {Set<string>} frozenAtomIds - Frozen atom ids.
 * @returns {boolean} True when the descriptor would move a frozen atom.
 */
/**
 * Removes rigid-subtree cleanup descriptors that would move frozen atoms.
 * @param {Map<string, {anchorAtomId: string, rootAtomId: string, subtreeAtomIds: string[]}|Array<{anchorAtomId: string, rootAtomId: string, subtreeAtomIds: string[]}>>} descriptorsByAtomId - Descriptor map.
 * @param {Set<string>} frozenAtomIds - Frozen atom ids.
 * @returns {Map<string, Array<{anchorAtomId: string, rootAtomId: string, subtreeAtomIds: string[]}>>} Filtered descriptor map.
 */
function filterFrozenRigidSubtrees(descriptorsByAtomId, frozenAtomIds) {
  const filtered = new Map();
  if (!(descriptorsByAtomId instanceof Map) || descriptorsByAtomId.size === 0) {
    return filtered;
  }

  for (const [atomId, descriptorValue] of descriptorsByAtomId) {
    const activeDescriptors = rigidDescriptorsFromValue(descriptorValue).filter(descriptor => !containsFrozenAtom(descriptor.subtreeAtomIds, frozenAtomIds));
    if (activeDescriptors.length > 0) {
      filtered.set(atomId, activeDescriptors);
    }
  }

  return filtered;
}

function rigidDescriptorsForAtom(rigidSubtreesByAtomId, atomId) {
  return rigidDescriptorsFromValue(rigidSubtreesByAtomId?.get(atomId)).slice(0, MAX_RIGID_DESCRIPTOR_OPTIONS_PER_ATOM);
}

/**
 * Scores how disposable an atom is during overlap cleanup.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {string} atomId - Atom identifier.
 * @returns {number} Higher scores mean the atom is safer to move.
 */
function movePreference(layoutGraph, atomId) {
  const atom = layoutGraph.atoms.get(atomId);
  if (!atom) {
    return 0;
  }
  if (atom.element === 'H') {
    return 4;
  }
  if (atom.heavyDegree <= 1) {
    return 3;
  }
  if (atom.heavyDegree === 2) {
    return 2;
  }
  return 1;
}

/**
 * Chooses which atom in an overlap pair should move.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {string} firstAtomId - First overlapping atom ID.
 * @param {string} secondAtomId - Second overlapping atom ID.
 * @param {boolean} firstFixed - Whether the first atom is fixed.
 * @param {boolean} secondFixed - Whether the second atom is fixed.
 * @returns {{mode: 'first'|'second'|'both', scale: number}|null} Move strategy, or null when neither atom can move.
 */
function chooseMoveStrategy(layoutGraph, firstAtomId, secondAtomId, firstFixed, secondFixed) {
  if (firstFixed && secondFixed) {
    return null;
  }
  if (firstFixed) {
    return { mode: 'second', scale: 2 };
  }
  if (secondFixed) {
    return { mode: 'first', scale: 2 };
  }

  const firstPreference = movePreference(layoutGraph, firstAtomId);
  const secondPreference = movePreference(layoutGraph, secondAtomId);
  if (firstPreference > secondPreference) {
    return { mode: 'first', scale: 2 };
  }
  if (secondPreference > firstPreference) {
    return { mode: 'second', scale: 2 };
  }
  return { mode: 'both', scale: 1 };
}

function atomTouchesRing(layoutGraph, atomId) {
  return (layoutGraph.bondsByAtomId?.get(atomId) ?? []).some(bond => bond?.inRing === true);
}

function canMoveAtomIndividually(layoutGraph, atomId, options = {}) {
  if (!protectsLargeMoleculeBackbone(options)) {
    return true;
  }
  const atom = layoutGraph.atoms.get(atomId);
  if (!atom) {
    return false;
  }
  if (atom.element === 'H') {
    return true;
  }
  if (atomTouchesRing(layoutGraph, atomId)) {
    return false;
  }
  return (atom.heavyDegree ?? 0) <= 1;
}

function restrictMoveStrategy(layoutGraph, strategy, firstAtomId, secondAtomId, options = {}) {
  if (!strategy || !protectsLargeMoleculeBackbone(options)) {
    return strategy;
  }
  const firstSafe = canMoveAtomIndividually(layoutGraph, firstAtomId, options);
  const secondSafe = canMoveAtomIndividually(layoutGraph, secondAtomId, options);

  if (strategy.mode === 'both') {
    if (firstSafe && secondSafe) {
      return strategy;
    }
    if (firstSafe) {
      return { mode: 'first', scale: 2 };
    }
    if (secondSafe) {
      return { mode: 'second', scale: 2 };
    }
    return null;
  }
  if (strategy.mode === 'first') {
    return firstSafe ? strategy : (secondSafe ? { mode: 'second', scale: 2 } : null);
  }
  if (strategy.mode === 'second') {
    return secondSafe ? strategy : (firstSafe ? { mode: 'first', scale: 2 } : null);
  }
  return strategy;
}

/**
 * Returns the unique heavy-atom anchor for a terminal substituent.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {string} atomId - Atom identifier.
 * @returns {string|null} Anchor atom ID, or null when the atom is not singly anchored.
 */
function singleHeavyAnchorAtomId(layoutGraph, atomId) {
  const heavyNeighborIds = [];
  for (const bond of layoutGraph.bondsByAtomId?.get(atomId) ?? []) {
    if (!bond || bond.kind !== 'covalent') {
      continue;
    }
    const neighborAtomId = bond.a === atomId ? bond.b : bond.a;
    const neighborAtom = layoutGraph.atoms.get(neighborAtomId);
    if (!neighborAtom || neighborAtom.element === 'H') {
      continue;
    }
    heavyNeighborIds.push(neighborAtomId);
  }
  return heavyNeighborIds.length === 1 ? heavyNeighborIds[0] : null;
}

/**
 * Rotates a 2D vector around the origin.
 * @param {{x: number, y: number}} vector - Input vector.
 * @param {number} angle - Rotation angle in radians.
 * @returns {{x: number, y: number}} Rotated vector.
 */
function rotateVector(vector, angle) {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return {
    x: vector.x * cos - vector.y * sin,
    y: vector.x * sin + vector.y * cos
  };
}

function reflectPointAcrossLine(point, lineStart, lineEnd) {
  const dx = lineEnd.x - lineStart.x;
  const dy = lineEnd.y - lineStart.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared <= NUMERIC_EPSILON) {
    return { ...point };
  }
  const projection =
    ((point.x - lineStart.x) * dx + (point.y - lineStart.y) * dy)
    / lengthSquared;
  const projectedPoint = {
    x: lineStart.x + dx * projection,
    y: lineStart.y + dy * projection
  };
  return {
    x: (2 * projectedPoint.x) - point.x,
    y: (2 * projectedPoint.y) - point.y
  };
}

function localNonbondedClearance(layoutGraph, coords, atomId, position, searchRadius, atomGrid) {
  let minimumDistance = searchRadius;
  const candidateAtomIds = atomGrid ? atomGrid.queryRadius(position, searchRadius) : coords.keys();
  for (const otherAtomId of candidateAtomIds) {
    if (otherAtomId === atomId || layoutGraph.bondedPairSet?.has(atomPairKey(atomId, otherAtomId))) {
      continue;
    }
    const otherPosition = coords.get(otherAtomId);
    if (!otherPosition) {
      continue;
    }
    minimumDistance = Math.min(minimumDistance, Math.hypot(position.x - otherPosition.x, position.y - otherPosition.y));
  }
  return minimumDistance;
}

function reflectedRigidDescriptorPositions(coords, descriptor) {
  const anchorPosition = coords.get(descriptor.anchorAtomId);
  const rootPosition = coords.get(descriptor.rootAtomId);
  if (!anchorPosition || !rootPosition) {
    return null;
  }
  const newPositions = new Map();
  for (const subtreeAtomId of descriptor.subtreeAtomIds) {
    const subtreePosition = coords.get(subtreeAtomId);
    if (!subtreePosition) {
      continue;
    }
    newPositions.set(subtreeAtomId, reflectPointAcrossLine(subtreePosition, anchorPosition, rootPosition));
  }
  return newPositions;
}

/**
 * Applies a rigid subtree move and updates the atom grid in place.
 * @param {Map<string, {x: number, y: number}>} coords - Current coordinate map.
 * @param {AtomGrid} atomGrid - Spatial atom grid.
 * @param {Map<string, {x: number, y: number}>} newPositions - Replacement subtree coordinates.
 * @returns {void}
 */
function applyRigidSubtreeMove(coords, atomGrid, newPositions) {
  for (const [atomId, newPosition] of newPositions) {
    const previousPosition = coords.get(atomId);
    if (!previousPosition) {
      continue;
    }
    atomGrid.remove(atomId, previousPosition);
    previousPosition.x = newPosition.x;
    previousPosition.y = newPosition.y;
    atomGrid.insert(atomId, previousPosition);
  }
}

/**
 * Returns the rotation angles to evaluate for a rigid pendant subtree move.
 * Larger/crowded layouts use a coarser sampling so we do not brute-force the
 * full 24-angle set on every sugar-like subtree overlap.
 * @param {number} subtreeSize - Number of atoms in the rigid subtree.
 * @param {number} visibleAtomCount - Visible laid-out atom count.
 * @returns {number[]} Rotation angles in radians.
 */
function rigidSubtreeCandidateAngles(subtreeSize, visibleAtomCount) {
  if (subtreeSize < LARGE_RIGID_SUBTREE_SIZE && visibleAtomCount < LARGE_RIGID_SUBTREE_COMPONENT_ATOM_COUNT) {
    return RIGID_SUBTREE_ROTATION_ANGLES;
  }

  return COARSE_RIGID_SUBTREE_ROTATION_ANGLES;
}

/**
 * Merges one base candidate lattice with extra exact-root-preserving rigid
 * rotations, deduping wrapped angles in insertion order.
 * @param {number[]} baseAngles - Base candidate angles in radians.
 * @param {number[]} extraAngles - Additional candidate angles in radians.
 * @returns {number[]} Deduped candidate angles.
 */
function mergeRigidCandidateAngles(baseAngles, extraAngles) {
  const merged = [];
  for (const angle of [...baseAngles, ...extraAngles]) {
    const wrappedAngle = wrapAngle(angle);
    if (merged.some(existingAngle => angularDifference(existingAngle, wrappedAngle) <= ANGLE_EPSILON)) {
      continue;
    }
    merged.push(wrappedAngle);
  }
  return merged;
}

/**
 * Returns the rigid-rotation candidates to probe for one descriptor. Compact
 * ring-anchored rigid branches keep the global absolute lattice but also add a
 * small set of rotations relative to the current root direction so overlap
 * cleanup can try the least-disruptive local escape before jumping to a much
 * larger reorientation.
 * @param {number} subtreeSize - Number of atoms in the rigid subtree.
 * @param {number} visibleAtomCount - Visible laid-out atom count.
 * @param {number} currentRootAngle - Current root-bond angle in radians.
 * @param {boolean} exactRingRootDescriptor - Whether the descriptor should preserve exact ring-root presentation when possible.
 * @param {boolean} exactHypervalentDescriptor - Whether the descriptor should preserve exact hypervalent presentation when possible.
 * @returns {number[]} Candidate root angles in radians.
 */
function rigidSubtreeProbeAngles(subtreeSize, visibleAtomCount, currentRootAngle, exactRingRootDescriptor, exactHypervalentDescriptor) {
  const baseAngles = rigidSubtreeCandidateAngles(subtreeSize, visibleAtomCount);
  const extraAngles = [];
  if (exactRingRootDescriptor) {
    extraAngles.push(...EXACT_RING_ROOT_RELATIVE_ROTATION_OFFSETS.map(offset => currentRootAngle + offset));
  }
  if (exactHypervalentDescriptor) {
    extraAngles.push(...EXACT_HYPERVALENT_RELATIVE_ROTATION_OFFSETS.map(offset => currentRootAngle + offset));
  }
  if (extraAngles.length === 0) {
    return baseAngles;
  }
  return mergeRigidCandidateAngles(baseAngles, extraAngles);
}

/**
 * Attempts to clear an overlap by rotating a singly attached ring subtree as a rigid body.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Current coordinate map.
 * @param {AtomGrid} atomGrid - Spatial atom grid.
 * @param {{anchorAtomId: string, rootAtomId: string, subtreeAtomIds: string[]}|undefined} descriptor - Candidate rigid-subtree descriptor.
 * @param {string} movingAtomId - Overlapping atom within the subtree.
 * @param {string} opposingAtomId - Opposing overlapping atom.
 * @param {number} bondLength - Target bond length.
 * @param {number} threshold - Severe-overlap threshold.
 * @param {number} visibleAtomCount - Visible laid-out atom count.
 * @returns {{positions: Map<string, {x: number, y: number}>, improvement: number, resolvedDistance: number}|null} Best rigid-subtree move, or null.
 */
function bestRigidSubtreeMove(layoutGraph, coords, atomGrid, descriptor, movingAtomId, opposingAtomId, bondLength, threshold, visibleAtomCount) {
  if (!descriptor || !descriptor.subtreeAtomIds.includes(movingAtomId) || descriptor.subtreeAtomIds.includes(opposingAtomId)) {
    return null;
  }

  const anchorPosition = coords.get(descriptor.anchorAtomId);
  const rootPosition = coords.get(descriptor.rootAtomId);
  const movingPosition = coords.get(movingAtomId);
  const opposingPosition = coords.get(opposingAtomId);
  if (!anchorPosition || !rootPosition || !movingPosition || !opposingPosition) {
    return null;
  }

  const currentRootVector = {
    x: rootPosition.x - anchorPosition.x,
    y: rootPosition.y - anchorPosition.y
  };
  const currentRootAngle = Math.atan2(currentRootVector.y, currentRootVector.x);
  const subtreeIsSingleAtom = descriptor.subtreeAtomIds.length === 1;
  const exactHypervalentDescriptor = isCompactHypervalentRigidDescriptor(layoutGraph, descriptor);
  const baseLocalClearance = subtreeIsSingleAtom
    ? localNonbondedClearance(layoutGraph, coords, movingAtomId, movingPosition, threshold * 2, atomGrid)
    : 0;
  const baseOverlapCost = computeSubtreeOverlapCost(layoutGraph, coords, descriptor.subtreeAtomIds, null, bondLength, { atomGrid });
  const baseAnchorDistortion = exactHypervalentDescriptor
    ? 0
    : computeAtomDistortionCost(layoutGraph, coords, descriptor.anchorAtomId, null);
  const exactRingRootDescriptor = isCompactRingAnchoredRigidDescriptor(layoutGraph, descriptor);
  let bestMove = null;

  const evaluateCandidatePositions = newPositions => {
    if (!newPositions) {
      return;
    }
    const movedAtomPosition = newPositions.get(movingAtomId);
    if (!movedAtomPosition) {
      return;
    }
    const resolvedDistance = Math.hypot(movedAtomPosition.x - opposingPosition.x, movedAtomPosition.y - opposingPosition.y);
    if (resolvedDistance < threshold) {
      return;
    }

    const newOverlapCost = computeSubtreeOverlapCost(layoutGraph, coords, descriptor.subtreeAtomIds, newPositions, bondLength, { atomGrid });
    const newAnchorDistortion = exactHypervalentDescriptor
      ? 0
      : computeAtomDistortionCost(layoutGraph, coords, descriptor.anchorAtomId, newPositions);
    let improvement = baseOverlapCost - newOverlapCost + (baseAnchorDistortion - newAnchorDistortion);
    const ringRootDeviation = exactRingRootDescriptor
      ? compactRingAnchoredRootOutwardDeviation(layoutGraph, coords, descriptor, newPositions)
      : Number.POSITIVE_INFINITY;
    if (improvement <= IMPROVEMENT_EPSILON && subtreeIsSingleAtom && newOverlapCost <= baseOverlapCost + IMPROVEMENT_EPSILON) {
      const candidateLocalClearance = localNonbondedClearance(layoutGraph, coords, movingAtomId, movedAtomPosition, threshold * 2, atomGrid);
      if (candidateLocalClearance > baseLocalClearance + IMPROVEMENT_EPSILON) {
        improvement = candidateLocalClearance - baseLocalClearance;
      }
    }
    if (improvement <= IMPROVEMENT_EPSILON) {
      return;
    }

    const candidateMove = {
      positions: newPositions,
      improvement,
      resolvedDistance,
      ringRootDeviation,
      totalRingRootDeviation: ringRootDeviation,
      subtreeAtomCount: descriptor.subtreeAtomIds.length,
      subtreeHeavyAtomCount: subtreeHeavyAtomCount(layoutGraph, descriptor.subtreeAtomIds)
    };
    if (isBetterRigidMove(bestMove, candidateMove)) {
      bestMove = candidateMove;
    }
  };

  if (exactRingRootDescriptor) {
    evaluateCandidatePositions(reflectedRigidDescriptorPositions(coords, descriptor));
  }

  const rigidRotationProbe = probeRigidRotation(layoutGraph, coords, descriptor, {
    angles: rigidSubtreeProbeAngles(
      descriptor.subtreeAtomIds.length,
      visibleAtomCount,
      currentRootAngle,
      exactRingRootDescriptor,
      exactHypervalentDescriptor
    ).filter(candidateAngle => {
      return Math.abs(candidateAngle - currentRootAngle) > ANGLE_EPSILON;
    }),
    buildPositionsFn(inputCoords, inputDescriptor, candidateAngle) {
      return rotateRigidDescriptorPositions(inputCoords, inputDescriptor, candidateAngle - currentRootAngle);
    },
    scoreFn(_inputCoords, overridePositions) {
      const movedAtomPosition = overridePositions.get(movingAtomId);
      if (!movedAtomPosition) {
        return null;
      }
      const resolvedDistance = Math.hypot(movedAtomPosition.x - opposingPosition.x, movedAtomPosition.y - opposingPosition.y);
      if (resolvedDistance < threshold) {
        return null;
      }

      const newOverlapCost = computeSubtreeOverlapCost(layoutGraph, coords, descriptor.subtreeAtomIds, overridePositions, bondLength, { atomGrid });
      const newAnchorDistortion = exactHypervalentDescriptor
        ? 0
        : computeAtomDistortionCost(layoutGraph, coords, descriptor.anchorAtomId, overridePositions);
      let improvement = baseOverlapCost - newOverlapCost + (baseAnchorDistortion - newAnchorDistortion);
      const ringRootDeviation = exactRingRootDescriptor
        ? compactRingAnchoredRootOutwardDeviation(layoutGraph, coords, descriptor, overridePositions)
        : Number.POSITIVE_INFINITY;
      if (improvement <= IMPROVEMENT_EPSILON && subtreeIsSingleAtom && newOverlapCost <= baseOverlapCost + IMPROVEMENT_EPSILON) {
        const candidateLocalClearance = localNonbondedClearance(layoutGraph, coords, movingAtomId, movedAtomPosition, threshold * 2, atomGrid);
        if (candidateLocalClearance > baseLocalClearance + IMPROVEMENT_EPSILON) {
          improvement = candidateLocalClearance - baseLocalClearance;
        }
      }
      if (improvement <= IMPROVEMENT_EPSILON) {
        return null;
      }

      return {
        positions: overridePositions,
        improvement,
        resolvedDistance,
        ringRootDeviation,
        totalRingRootDeviation: ringRootDeviation,
        subtreeAtomCount: descriptor.subtreeAtomIds.length,
        subtreeHeavyAtomCount: subtreeHeavyAtomCount(layoutGraph, descriptor.subtreeAtomIds)
      };
    },
    isBetterScoreFn(candidateMove, incumbentMove) {
      return isBetterRigidMove(incumbentMove, candidateMove);
    }
  });
  if (rigidRotationProbe.bestScore && isBetterRigidMove(bestMove, rigidRotationProbe.bestScore)) {
    bestMove = rigidRotationProbe.bestScore;
  }

  return bestMove;
}

function bestRigidSubtreeMoveForAtom(layoutGraph, coords, atomGrid, rigidSubtreesByAtomId, movingAtomId, opposingAtomId, bondLength, threshold, visibleAtomCount) {
  let bestMove = null;

  for (const descriptor of rigidDescriptorsForAtom(rigidSubtreesByAtomId, movingAtomId)) {
    const candidateMove = bestRigidSubtreeMove(
      layoutGraph,
      coords,
      atomGrid,
      descriptor,
      movingAtomId,
      opposingAtomId,
      bondLength,
      threshold,
      visibleAtomCount
    );
    if (!candidateMove) {
      continue;
    }
    if (isBetterRigidMove(bestMove, candidateMove)) {
      bestMove = candidateMove;
    }
  }

  return bestMove;
}

/**
 * Keeps singly anchored substituents on their original bond-length circle during nudges.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Current coordinate map.
 * @param {string} atomId - Atom being moved.
 * @param {{x: number, y: number}} tentativePosition - Tentative moved position.
 * @param {string} opposingAtomId - Atom that triggered the overlap.
 * @param {number} threshold - Target nonbonded separation.
 * @param {import('../geometry/atom-grid.js').AtomGrid|null} [atomGrid] - Optional spatial atom grid built from coords.
 * @returns {{x: number, y: number}} Constrained moved position.
 */
function constrainSingleAtomMove(layoutGraph, coords, atomId, tentativePosition, opposingAtomId, threshold, atomGrid = null) {
  const anchorAtomId = singleHeavyAnchorAtomId(layoutGraph, atomId);
  if (!anchorAtomId) {
    return tentativePosition;
  }
  const anchorPosition = coords.get(anchorAtomId);
  const currentPosition = coords.get(atomId);
  const opposingPosition = coords.get(opposingAtomId);
  if (!anchorPosition || !currentPosition) {
    return tentativePosition;
  }
  if (!opposingPosition) {
    return tentativePosition;
  }

  const radius = Math.hypot(currentPosition.x - anchorPosition.x, currentPosition.y - anchorPosition.y);
  if (radius <= NUMERIC_EPSILON) {
    return tentativePosition;
  }
  const currentVector = {
    x: currentPosition.x - anchorPosition.x,
    y: currentPosition.y - anchorPosition.y
  };
  const tentativeShift = Math.hypot(tentativePosition.x - currentPosition.x, tentativePosition.y - currentPosition.y);
  if (tentativeShift <= NUMERIC_EPSILON) {
    return tentativePosition;
  }
  const minimumNonbondedDistance = candidatePosition => {
    let minimumDistance = Number.POSITIVE_INFINITY;
    const candidateAtomIds = atomGrid ? atomGrid.queryRadius(candidatePosition, threshold * 2) : coords.keys();
    for (const otherAtomId of candidateAtomIds) {
      if (otherAtomId === atomId || otherAtomId === anchorAtomId || layoutGraph.bondedPairSet?.has(atomPairKey(atomId, otherAtomId))) {
        continue;
      }
      const otherPosition = coords.get(otherAtomId);
      if (!otherPosition) {
        continue;
      }
      minimumDistance = Math.min(minimumDistance, Math.hypot(candidatePosition.x - otherPosition.x, candidatePosition.y - otherPosition.y));
    }
    return Number.isFinite(minimumDistance) ? minimumDistance : Number.POSITIVE_INFINITY;
  };
  const baseStep = Math.max(tentativeShift / radius, Math.PI / 18);
  let bestCandidate = null;

  for (const multiplier of [1, 1.5, 2, 3]) {
    const step = Math.min(baseStep * multiplier, Math.PI / 2);
    for (const direction of [-1, 1]) {
      const rotated = rotateVector(currentVector, step * direction);
      const candidatePosition = {
        x: anchorPosition.x + rotated.x,
        y: anchorPosition.y + rotated.y
      };
      const opposingDistance = Math.hypot(candidatePosition.x - opposingPosition.x, candidatePosition.y - opposingPosition.y);
      const nonbondedDistance = minimumNonbondedDistance(candidatePosition);
      const clearsThreshold = opposingDistance >= threshold;
      if (!bestCandidate) {
        bestCandidate = { position: candidatePosition, opposingDistance, nonbondedDistance, step, clearsThreshold };
        continue;
      }
      if (clearsThreshold !== bestCandidate.clearsThreshold) {
        if (clearsThreshold) {
          bestCandidate = { position: candidatePosition, opposingDistance, nonbondedDistance, step, clearsThreshold };
        }
        continue;
      }
      if (clearsThreshold) {
        if (nonbondedDistance > bestCandidate.nonbondedDistance + NUMERIC_EPSILON) {
          bestCandidate = { position: candidatePosition, opposingDistance, nonbondedDistance, step, clearsThreshold };
          continue;
        }
        if (
          Math.abs(nonbondedDistance - bestCandidate.nonbondedDistance) <= NUMERIC_EPSILON &&
          (step < bestCandidate.step - NUMERIC_EPSILON || (Math.abs(step - bestCandidate.step) <= NUMERIC_EPSILON && opposingDistance > bestCandidate.opposingDistance))
        ) {
          bestCandidate = { position: candidatePosition, opposingDistance, nonbondedDistance, step, clearsThreshold };
        }
      } else if (
        opposingDistance > bestCandidate.opposingDistance + NUMERIC_EPSILON ||
        (Math.abs(opposingDistance - bestCandidate.opposingDistance) <= NUMERIC_EPSILON && nonbondedDistance > bestCandidate.nonbondedDistance)
      ) {
        bestCandidate = { position: candidatePosition, opposingDistance, nonbondedDistance, step, clearsThreshold };
      }
    }
  }

  return bestCandidate?.position ?? tentativePosition;
}

/**
 * Resolves the most severe nonbonded overlaps with a conservative nudge pass.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} inputCoords - Coordinate map.
 * @param {object} [options] - Overlap-resolution options.
 * @param {number} [options.bondLength] - Target bond length.
 * @param {number} [options.maxPasses] - Maximum overlap passes.
 * @param {number} [options.thresholdFactor] - Overlap target as a bond-length multiple, clamped to the audit severe-overlap floor.
 * @returns {{coords: Map<string, {x: number, y: number}>, moves: number}} Updated coordinates and move count.
 */
export function resolveOverlaps(layoutGraph, inputCoords, options = {}) {
  const bondLength = options.bondLength ?? layoutGraph.options.bondLength;
  const maxPasses = options.maxPasses ?? 5;
  const threshold = bondLength * Math.max(options.thresholdFactor ?? 0.45, 0.55);
  const coords = new Map([...inputCoords.entries()].map(([atomId, position]) => [atomId, { ...position }]));
  const atomGrid = buildAtomGrid(layoutGraph, coords, bondLength);
  const frozenAtomIds = options.frozenAtomIds instanceof Set && options.frozenAtomIds.size > 0 ? options.frozenAtomIds : null;
  const rawRigidSubtreesByAtomId = options.rigidSubtreesByAtomId ?? collectRigidPendantRingSubtrees(layoutGraph);
  const rigidSubtreesByAtomId =
    frozenAtomIds
      ? filterFrozenRigidSubtrees(rawRigidSubtreesByAtomId, frozenAtomIds)
      : rawRigidSubtreesByAtomId;
  let visibleAtomCount = options.visibleAtomCount;
  if (visibleAtomCount == null) {
    visibleAtomCount = 0;
    for (const atom of layoutGraph.atoms.values()) { if (atom.visible) { visibleAtomCount++; } }
  }
  let moves = 0;

  for (let pass = 0; pass < maxPasses; pass++) {
    const overlaps = findSevereOverlaps(layoutGraph, coords, bondLength, { atomGrid });
    if (overlaps.length === 0) {
      break;
    }

    let movedThisPass = false;
    for (const overlap of overlaps) {
      const firstPosition = coords.get(overlap.firstAtomId);
      const secondPosition = coords.get(overlap.secondAtomId);
      if (!firstPosition || !secondPosition) {
        continue;
      }

      const dx = secondPosition.x - firstPosition.x;
      const dy = secondPosition.y - firstPosition.y;
      const distance = Math.hypot(dx, dy) || 1;
      const deficit = threshold - overlap.distance;
      if (deficit <= 0) {
        continue;
      }
      const ux = dx / distance;
      const uy = dy / distance;
      const delta = deficit / 2 + bondLength * 0.02;

      const firstFixed = isFixedAtom(layoutGraph, overlap.firstAtomId, options);
      const secondFixed = isFixedAtom(layoutGraph, overlap.secondAtomId, options);
      const strategy = restrictMoveStrategy(
        layoutGraph,
        chooseMoveStrategy(layoutGraph, overlap.firstAtomId, overlap.secondAtomId, firstFixed, secondFixed),
        overlap.firstAtomId,
        overlap.secondAtomId,
        options
      );
      if (!strategy) {
        continue;
      }

      const firstRigidMove = bestRigidSubtreeMoveForAtom(
        layoutGraph,
        coords,
        atomGrid,
        rigidSubtreesByAtomId,
        overlap.firstAtomId,
        overlap.secondAtomId,
        bondLength,
        threshold,
        visibleAtomCount
      );
      const secondRigidMove = bestRigidSubtreeMoveForAtom(
        layoutGraph,
        coords,
        atomGrid,
        rigidSubtreesByAtomId,
        overlap.secondAtomId,
        overlap.firstAtomId,
        bondLength,
        threshold,
        visibleAtomCount
      );
      let rigidMove = null;
      for (const candidateMove of [firstRigidMove, secondRigidMove]) {
        if (candidateMove && isBetterRigidMove(rigidMove, candidateMove)) {
          rigidMove = candidateMove;
        }
      }
      if (rigidMove) {
        applyRigidSubtreeMove(coords, atomGrid, rigidMove.positions);
        moves++;
        movedThisPass = true;
        break;
      }

      if (strategy.mode === 'second') {
        const previousSecondPosition = { ...secondPosition };
        const constrainedPosition = constrainSingleAtomMove(
          layoutGraph,
          coords,
          overlap.secondAtomId,
          {
            x: secondPosition.x + ux * delta * strategy.scale,
            y: secondPosition.y + uy * delta * strategy.scale
          },
          overlap.firstAtomId,
          threshold,
          atomGrid
        );
        secondPosition.x = constrainedPosition.x;
        secondPosition.y = constrainedPosition.y;
        atomGrid.remove(overlap.secondAtomId, previousSecondPosition);
        atomGrid.insert(overlap.secondAtomId, secondPosition);
      } else if (strategy.mode === 'first') {
        const previousFirstPosition = { ...firstPosition };
        const constrainedPosition = constrainSingleAtomMove(
          layoutGraph,
          coords,
          overlap.firstAtomId,
          {
            x: firstPosition.x - ux * delta * strategy.scale,
            y: firstPosition.y - uy * delta * strategy.scale
          },
          overlap.secondAtomId,
          threshold,
          atomGrid
        );
        firstPosition.x = constrainedPosition.x;
        firstPosition.y = constrainedPosition.y;
        atomGrid.remove(overlap.firstAtomId, previousFirstPosition);
        atomGrid.insert(overlap.firstAtomId, firstPosition);
      } else {
        const previousFirstPosition = { ...firstPosition };
        const previousSecondPosition = { ...secondPosition };
        firstPosition.x -= ux * delta;
        firstPosition.y -= uy * delta;
        secondPosition.x += ux * delta;
        secondPosition.y += uy * delta;
        atomGrid.remove(overlap.firstAtomId, previousFirstPosition);
        atomGrid.remove(overlap.secondAtomId, previousSecondPosition);
        atomGrid.insert(overlap.firstAtomId, firstPosition);
        atomGrid.insert(overlap.secondAtomId, secondPosition);
      }
      moves++;
      movedThisPass = true;
    }

    if (!movedThisPass) {
      break;
    }
  }

  return { coords, moves };
}

/** @module cleanup/local-rotation */

import { CLEANUP_EPSILON, DISTANCE_EPSILON, IDEAL_DIVALENT_CONTINUATION_ELEMENTS, ORTHOGONAL_HYPERVALENT_ELEMENTS, TERMINAL_HETERO_BRANCH_ELEMENTS, atomPairKey } from '../constants.js';
import { add, angleOf, angularDifference, centroid, fromAngle, rotate, sub, wrapAngle } from '../geometry/vec2.js';
import { pointInPolygon } from '../geometry/polygon.js';
import { buildAtomGrid, buildSubtreeOverlapContext, computeAtomDistortionCost, computeSubtreeOverlapCost } from '../audit/invariants.js';
import { auditLayout } from '../audit/audit.js';
import { containsFrozenAtom } from './frozen-atoms.js';
import { forEachRigidRotationCandidate } from './rigid-rotation.js';
import { collectCutSubtree } from './subtree-utils.js';
import { reflectAcrossLine } from '../geometry/transforms.js';
import {
  measureSmallRingExteriorGapSpreadPenalty,
  smallRingExteriorTargetAngles,
  supportsExteriorBranchSpreadRingSize
} from '../placement/branch-placement.js';
import {
  isExactVisibleTrigonalBisectorEligible,
  isPlanarDivalentNitrogenContinuationPair
} from '../placement/branch-placement/angle-selection.js';
import { FINE_ROTATION_ANGLES } from './rotation-candidates.js';
import { visibleHeavyCovalentBonds } from './bond-utils.js';
const LOCAL_TRIGONAL_HETERO_DISTORTION_WEIGHT = 5;
const LOCAL_RING_TRIGONAL_HETERO_DISTORTION_WEIGHT = 12;
const MAX_SIBLING_SWAP_SUBTREE_ATOMS = 18;
const MAX_BRANCHED_SATURATED_SUBTREE_ATOMS = 20;
const MAX_ANCHORED_RING_BLOCK_ATOMS = 18;
const MAX_SPIRO_SMALL_RING_BLOCK_ATOMS = 12;
const MAX_EXACT_TRIGONAL_RING_BRANCH_REFLECTION_ATOMS = 48;
const MAX_LOCAL_TRIGONAL_HETERO_LAYOUT_ATOMS = 48;
const MAX_SIBLING_SWAP_LAYOUT_ATOMS = 48;
const LOCAL_ROTATION_BOND_CROWDING_FINALISTS = 2;
const EXACT_ROTATION_ANGLE_EPSILON = 1e-6;
const IDEAL_LEAF_LINEAR_NEIGHBOR_TOLERANCE = Math.PI / 12;
const ANCHORED_RING_EXTERIOR_SPREAD_WEIGHT = 8;
const SPIRO_SMALL_RING_EXTERIOR_SPREAD_WEIGHT = 8;
const SPIRO_SMALL_RING_EXTERIOR_ROTATION_FRACTIONS = Object.freeze([0.5, 0.4, 0.25, 0.2, 0.15]);

/**
 * Returns the circular mean of signed angular offsets.
 * @param {number[]} angles - Angles in radians.
 * @returns {number|null} Mean angle, or null when the vectors cancel.
 */
function meanSignedAngle(angles) {
  if (angles.length === 0) {
    return null;
  }
  let x = 0;
  let y = 0;
  for (const angle of angles) {
    x += Math.cos(angle);
    y += Math.sin(angle);
  }
  if (Math.hypot(x, y) <= DISTANCE_EPSILON) {
    return null;
  }
  return Math.atan2(y, x);
}

function buildPlacedAdjacency(layoutGraph, coords) {
  const adjacency = new Map();
  for (const atomId of coords.keys()) {
    adjacency.set(atomId, []);
  }
  for (const bond of layoutGraph.bonds.values()) {
    if (!coords.has(bond.a) || !coords.has(bond.b) || bond.kind !== 'covalent') {
      continue;
    }
    adjacency.get(bond.a)?.push(bond.b);
    adjacency.get(bond.b)?.push(bond.a);
  }
  return adjacency;
}

function singleBondDescriptor(layoutGraph, firstAtomId, secondAtomId) {
  const bond = layoutGraph.bondByAtomPair.get(atomPairKey(firstAtomId, secondAtomId));
  if (!bond || bond.kind !== 'covalent' || bond.inRing || bond.aromatic || (bond.order ?? 1) !== 1) {
    return null;
  }
  return bond;
}

function terminalMultipleBondLeafBond(layoutGraph, anchorAtomId, rootAtomId) {
  const bond = layoutGraph.bondByAtomPair.get(atomPairKey(anchorAtomId, rootAtomId));
  if (!bond || bond.kind !== 'covalent' || bond.aromatic || (bond.order ?? 1) < 2) {
    return null;
  }
  const rootAtom = layoutGraph.atoms.get(rootAtomId);
  if (!rootAtom || rootAtom.element === 'H' || rootAtom.aromatic || rootAtom.heavyDegree !== 1) {
    return null;
  }
  return bond;
}

/**
 * Returns the exact ideal angle for a terminal subtree root attached to a
 * visible trigonal center with one multiple bond. This keeps carbonyl oxygens
 * and the matching terminal single-bond substituents on the true trigonal
 * bisector of the other two fixed heavy neighbors instead of approximating
 * them with the generic cleanup rotation lattice.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Current coordinate map.
 * @param {string} anchorAtomId - Trigonal center atom id.
 * @param {string} rootAtomId - Terminal subtree-root atom id.
 * @returns {number|null} Exact ideal angle in radians, or null when unsupported.
 */
function exactIdealTrigonalTerminalAngle(layoutGraph, coords, anchorAtomId, rootAtomId) {
  const anchorPosition = coords.get(anchorAtomId);
  if (!anchorPosition) {
    return null;
  }
  const visibleHeavyBonds = (layoutGraph.bondsByAtomId.get(anchorAtomId) ?? [])
    .filter(bond => {
      if (bond.kind !== 'covalent') {
        return false;
      }
      const neighborAtomId = bond.a === anchorAtomId ? bond.b : bond.a;
      const neighborAtom = layoutGraph.atoms.get(neighborAtomId);
      return !!neighborAtom && neighborAtom.element !== 'H' && coords.has(neighborAtomId);
    });
  if (visibleHeavyBonds.length !== 3) {
    return null;
  }
  const multipleBondCount = visibleHeavyBonds.filter(bond => !bond.aromatic && (bond.order ?? 1) >= 2).length;
  if (multipleBondCount !== 1) {
    return null;
  }
  const rootBond = visibleHeavyBonds.find(bond => (bond.a === anchorAtomId ? bond.b : bond.a) === rootAtomId) ?? null;
  const rootAtom = layoutGraph.atoms.get(rootAtomId);
  if (!rootBond || !rootAtom || rootAtom.element === 'H' || rootAtom.aromatic) {
    return null;
  }

  if ((rootBond.order ?? 1) >= 2 && !terminalMultipleBondLeafBond(layoutGraph, anchorAtomId, rootAtomId)) {
    return null;
  }

  const otherNeighborPositions = visibleHeavyBonds
    .map(bond => (bond.a === anchorAtomId ? bond.b : bond.a))
    .filter(neighborAtomId => neighborAtomId !== rootAtomId)
    .map(neighborAtomId => coords.get(neighborAtomId))
    .filter(Boolean);
  if (otherNeighborPositions.length !== 2) {
    return null;
  }
  const otherNeighborAngles = otherNeighborPositions.map(position => angleOf(sub(position, anchorPosition)));
  if (Math.abs(angularDifference(otherNeighborAngles[0], otherNeighborAngles[1]) - Math.PI) <= IDEAL_LEAF_LINEAR_NEIGHBOR_TOLERANCE) {
    return null;
  }

  const outwardVector = sub(anchorPosition, centroid(otherNeighborPositions));
  if (Math.hypot(outwardVector.x, outwardVector.y) <= DISTANCE_EPSILON) {
    return null;
  }
  return angleOf(outwardVector);
}

/**
 * Returns exact 120-degree continuation angles for simple saturated divalent
 * anchors such as `-CH2CH3` when hydrogens are omitted. Keeping these exact
 * zigzag slots available lets local cleanup clear crowding without letting the
 * terminal leaf drift to an arbitrary off-angle lattice position.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Current coordinate map.
 * @param {string} anchorAtomId - Divalent anchor atom id.
 * @param {string} rootAtomId - Rotating terminal leaf atom id.
 * @returns {number[]} Exact ideal continuation angles in radians.
 */
function exactIdealDivalentContinuationAngles(layoutGraph, coords, anchorAtomId, rootAtomId) {
  const anchorAtom = layoutGraph.atoms.get(anchorAtomId);
  const anchorPosition = coords.get(anchorAtomId);
  const rootPosition = coords.get(rootAtomId);
  if (
    !anchorAtom
    || !anchorPosition
    || !rootPosition
    || anchorAtom.aromatic
    || layoutGraph.ringAtomIdSet.has(anchorAtomId)
  ) {
    return [];
  }

  const visibleHeavyBonds = (layoutGraph.bondsByAtomId.get(anchorAtomId) ?? [])
    .filter(bond => {
      if (bond.kind !== 'covalent') {
        return false;
      }
      const neighborAtomId = bond.a === anchorAtomId ? bond.b : bond.a;
      const neighborAtom = layoutGraph.atoms.get(neighborAtomId);
      return !!neighborAtom && neighborAtom.element !== 'H' && coords.has(neighborAtomId);
    });
  if (visibleHeavyBonds.length !== 2) {
    return [];
  }

  const rootBond = visibleHeavyBonds.find(bond => (bond.a === anchorAtomId ? bond.b : bond.a) === rootAtomId) ?? null;
  if (!rootBond || rootBond.aromatic || (rootBond.order ?? 1) !== 1) {
    return [];
  }

  const parentBond = visibleHeavyBonds.find(bond => bond !== rootBond) ?? null;
  const parentAtomId = parentBond ? (parentBond.a === anchorAtomId ? parentBond.b : parentBond.a) : null;
  const parentAtom = parentAtomId ? layoutGraph.atoms.get(parentAtomId) : null;
  const parentPosition = parentAtomId ? coords.get(parentAtomId) : null;
  if (!parentBond || !parentAtomId || !parentAtom || !parentPosition || parentBond.aromatic) {
    return [];
  }
  const parentOrder = parentBond.order ?? 1;
  const isExactDivalentElement =
    IDEAL_DIVALENT_CONTINUATION_ELEMENTS.has(anchorAtom.element)
    || (
      anchorAtom.element === 'N'
      && isPlanarDivalentNitrogenContinuationPair(layoutGraph, parentAtomId, rootAtomId)
    );
  if (!isExactDivalentElement) {
    return [];
  }
  const isSupportedBondPattern =
    parentOrder === 1
    || (
      anchorAtom.element === 'N'
      && parentOrder >= 2
      && isPlanarDivalentNitrogenContinuationPair(layoutGraph, parentAtomId, rootAtomId)
    );
  if (!isSupportedBondPattern) {
    return [];
  }

  const parentAngle = angleOf(sub(parentPosition, anchorPosition));
  const currentAngle = angleOf(sub(rootPosition, anchorPosition));
  return [parentAngle + ((2 * Math.PI) / 3), parentAngle - ((2 * Math.PI) / 3)]
    .sort((firstAngle, secondAngle) => angularDifference(firstAngle, currentAngle) - angularDifference(secondAngle, currentAngle));
}

function preferredRotationAngles(layoutGraph, coords, anchorAtomId, rootAtomId) {
  const candidateAngles = [];
  for (const exactAngle of exactIdealDivalentContinuationAngles(layoutGraph, coords, anchorAtomId, rootAtomId)) {
    if (candidateAngles.some(existingAngle => angularDifference(existingAngle, exactAngle) <= EXACT_ROTATION_ANGLE_EPSILON)) {
      continue;
    }
    candidateAngles.push(exactAngle);
  }
  const exactIdealAngle = exactIdealTrigonalTerminalAngle(layoutGraph, coords, anchorAtomId, rootAtomId);
  if (Number.isFinite(exactIdealAngle)) {
    candidateAngles.push(exactIdealAngle);
  }
  for (const angle of FINE_ROTATION_ANGLES) {
    if (candidateAngles.some(existingAngle => angularDifference(existingAngle, angle) <= EXACT_ROTATION_ANGLE_EPSILON)) {
      continue;
    }
    candidateAngles.push(angle);
  }
  return candidateAngles;
}

/**
 * Returns whether a terminal subtree should remain on an exact divalent
 * continuation slot during local cleanup. The current root must already be
 * exact, so the guard preserves good zig-zag geometry while still allowing
 * alternate exact slots.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Current coordinate map.
 * @param {string} anchorAtomId - Divalent anchor atom id.
 * @param {string} rootAtomId - Terminal subtree root atom id.
 * @returns {boolean} True when non-exact rotations should be rejected.
 */
function shouldPreserveExactDivalentContinuation(layoutGraph, coords, anchorAtomId, rootAtomId) {
  const rootPosition = coords.get(rootAtomId);
  const anchorPosition = coords.get(anchorAtomId);
  if (!rootPosition || !anchorPosition) {
    return false;
  }
  const exactAngles = exactIdealDivalentContinuationAngles(layoutGraph, coords, anchorAtomId, rootAtomId);
  if (exactAngles.length === 0) {
    return false;
  }
  const currentAngle = angleOf(sub(rootPosition, anchorPosition));
  return exactAngles.some(exactAngle => angularDifference(currentAngle, exactAngle) <= EXACT_ROTATION_ANGLE_EPSILON);
}

/**
 * Returns whether proposed terminal root positions keep an exact divalent
 * continuation when that local fan started exact.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Current coordinate map.
 * @param {string} anchorAtomId - Divalent anchor atom id.
 * @param {string} rootAtomId - Terminal subtree root atom id.
 * @param {Map<string, {x: number, y: number}>} newPositions - Candidate sparse positions.
 * @returns {boolean} True when the candidate is still on an exact slot.
 */
function preservesExactDivalentContinuation(layoutGraph, coords, anchorAtomId, rootAtomId, newPositions) {
  const anchorPosition = coords.get(anchorAtomId);
  const rootPosition = newPositions.get(rootAtomId);
  if (!anchorPosition || !rootPosition) {
    return true;
  }
  const exactAngles = exactIdealDivalentContinuationAngles(layoutGraph, coords, anchorAtomId, rootAtomId);
  if (exactAngles.length === 0) {
    return true;
  }
  const rootAngle = angleOf(sub(rootPosition, anchorPosition));
  return exactAngles.some(exactAngle => angularDifference(rootAngle, exactAngle) <= EXACT_ROTATION_ANGLE_EPSILON);
}

function isBranchedSaturatedRingAxisReflectionEligible(layoutGraph, coords, anchorAtomId, rootAtomId) {
  const anchorAtom = layoutGraph.atoms.get(anchorAtomId);
  const rootAtom = layoutGraph.atoms.get(rootAtomId);
  const anchorPosition = coords.get(anchorAtomId);
  const rootPosition = coords.get(rootAtomId);
  if (
    !anchorAtom
    || !rootAtom
    || !anchorPosition
    || !rootPosition
    || !layoutGraph.ringAtomIdSet.has(anchorAtomId)
    || rootAtom.element !== 'C'
    || rootAtom.aromatic
    || rootAtom.heavyDegree !== 3
    || rootAtom.degree !== 4
    || layoutGraph.options.suppressH !== true
    || layoutGraph.ringAtomIdSet.has(rootAtomId)
  ) {
    return false;
  }

  const rootBond = singleBondDescriptor(layoutGraph, anchorAtomId, rootAtomId);
  if (!rootBond) {
    return false;
  }
  for (const bond of layoutGraph.bondsByAtomId.get(rootAtomId) ?? []) {
    if (!bond || bond.kind !== 'covalent' || bond.aromatic || (bond.order ?? 1) !== 1) {
      return false;
    }
  }

  return true;
}

/**
 * Returns whether a short saturated terminal subtree can rotate as one unit
 * around a single bond. This covers ordinary alkyl-like roots such as
 * `-CH2CH3` or `-CH2SiH3`, which should be rotatable even though the root is
 * not itself a heavy-atom leaf.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {string} atomId - Candidate subtree-root atom id.
 * @param {string[]} heavyNeighborIds - Heavy neighbors currently placed.
 * @returns {{anchorAtomId: string}|null} Rotation descriptor or `null`.
 */
function saturatedTerminalSubtreeDescriptor(layoutGraph, atomId, heavyNeighborIds) {
  const atom = layoutGraph.atoms.get(atomId);
  if (!atom || atom.element === 'H' || atom.aromatic || atom.heavyDegree !== 2) {
    return null;
  }
  if (layoutGraph.ringAtomIdSet.has(atomId) || heavyNeighborIds.length !== 2) {
    return null;
  }

  for (const anchorAtomId of heavyNeighborIds) {
    const terminalLeafAtomId = heavyNeighborIds.find(neighborAtomId => neighborAtomId !== anchorAtomId) ?? null;
    const anchorAtom = layoutGraph.atoms.get(anchorAtomId);
    const terminalLeafAtom = terminalLeafAtomId ? layoutGraph.atoms.get(terminalLeafAtomId) : null;
    if (
      !anchorAtomId
      || !terminalLeafAtomId
      || !anchorAtom
      || !terminalLeafAtom
      || anchorAtom.element === 'H'
      || terminalLeafAtom.element === 'H'
      || terminalLeafAtom.aromatic
      || terminalLeafAtom.heavyDegree !== 1
      || layoutGraph.ringAtomIdSet.has(terminalLeafAtomId)
      || !singleBondDescriptor(layoutGraph, atomId, anchorAtomId)
      || !singleBondDescriptor(layoutGraph, atomId, terminalLeafAtomId)
    ) {
      continue;
    }
    return { anchorAtomId };
  }

  return null;
}

/**
 * Returns whether an atom is a non-ring terminal heavy leaf.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {string} atomId - Candidate atom id.
 * @returns {boolean} True when the atom is a terminal heavy leaf.
 */
function isTerminalHeavyLeaf(layoutGraph, atomId) {
  const atom = layoutGraph.atoms.get(atomId);
  return !!atom
    && atom.element !== 'H'
    && !atom.aromatic
    && atom.heavyDegree === 1
    && !layoutGraph.ringAtomIdSet.has(atomId);
}

/**
 * Returns a rigid cleanup descriptor for a terminal trigonal carbonyl/alkene
 * group attached to a larger chain through one single bond. Moving the whole
 * group preserves the exact local trigonal spread instead of rotating the
 * multiple-bond leaf or terminal single-bond leaf independently.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {string} atomId - Candidate trigonal root atom id.
 * @param {string[]} heavyNeighborIds - Heavy neighbors currently placed.
 * @returns {{anchorAtomId: string}|null} Rotation descriptor or `null`.
 */
function terminalTrigonalSubtreeDescriptor(layoutGraph, atomId, heavyNeighborIds) {
  const atom = layoutGraph.atoms.get(atomId);
  if (
    !atom
    || atom.element !== 'C'
    || atom.aromatic
    || atom.heavyDegree !== 3
    || heavyNeighborIds.length !== 3
    || layoutGraph.ringAtomIdSet.has(atomId)
  ) {
    return null;
  }

  let terminalMultipleNeighborId = null;
  const singleNeighborIds = [];
  for (const neighborAtomId of heavyNeighborIds) {
    const bond = layoutGraph.bondByAtomPair.get(atomPairKey(atomId, neighborAtomId));
    if (!bond || bond.kind !== 'covalent' || bond.inRing || bond.aromatic) {
      return null;
    }
    if ((bond.order ?? 1) === 1) {
      singleNeighborIds.push(neighborAtomId);
      continue;
    }
    if ((bond.order ?? 1) >= 2 && terminalMultipleBondLeafBond(layoutGraph, atomId, neighborAtomId)) {
      if (terminalMultipleNeighborId != null) {
        return null;
      }
      terminalMultipleNeighborId = neighborAtomId;
      continue;
    }
    return null;
  }

  if (terminalMultipleNeighborId == null || singleNeighborIds.length !== 2) {
    return null;
  }

  const compactSingleNeighborIds = singleNeighborIds.filter(neighborAtomId => (
    isTerminalHeavyLeaf(layoutGraph, neighborAtomId)
    || isCompactAcyclicSideGroup(layoutGraph, neighborAtomId, atomId, 6)
  ));
  const anchorNeighborIds = singleNeighborIds.filter(neighborAtomId => !compactSingleNeighborIds.includes(neighborAtomId));
  if (compactSingleNeighborIds.length !== 1 || anchorNeighborIds.length !== 1) {
    return null;
  }

  return { anchorAtomId: anchorNeighborIds[0] };
}

/**
 * Returns a descriptor for reflecting a carbonyl/imine-attached ring branch as
 * one rigid group around its parent bond. This preserves the exact trigonal
 * root fan while giving symmetric crowded diaryl carbonyls a mirror escape.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {string} atomId - Candidate trigonal root atom id.
 * @param {string[]} heavyNeighborIds - Heavy neighbors currently placed.
 * @returns {{anchorAtomId: string}|null} Reflection descriptor or `null`.
 */
function exactTrigonalRingBranchAxisReflectionDescriptor(layoutGraph, atomId, heavyNeighborIds) {
  const atom = layoutGraph.atoms.get(atomId);
  if (
    !atom
    || atom.element === 'H'
    || atom.aromatic
    || atom.heavyDegree !== 3
    || heavyNeighborIds.length !== 3
    || layoutGraph.ringAtomIdSet.has(atomId)
  ) {
    return null;
  }

  let multipleLeafAtomId = null;
  let ringNeighborAtomId = null;
  let anchorAtomId = null;
  for (const neighborAtomId of heavyNeighborIds) {
    const bond = layoutGraph.bondByAtomPair.get(atomPairKey(atomId, neighborAtomId));
    const neighborAtom = layoutGraph.atoms.get(neighborAtomId);
    if (!bond || !neighborAtom || neighborAtom.element === 'H' || bond.kind !== 'covalent' || bond.aromatic || bond.inRing) {
      return null;
    }
    if ((bond.order ?? 1) >= 2 && terminalMultipleBondLeafBond(layoutGraph, atomId, neighborAtomId)) {
      if (multipleLeafAtomId != null) {
        return null;
      }
      multipleLeafAtomId = neighborAtomId;
      continue;
    }
    if ((bond.order ?? 1) !== 1) {
      return null;
    }
    if (layoutGraph.ringAtomIdSet.has(neighborAtomId)) {
      if (ringNeighborAtomId != null) {
        return null;
      }
      ringNeighborAtomId = neighborAtomId;
      continue;
    }
    if (anchorAtomId != null) {
      return null;
    }
    anchorAtomId = neighborAtomId;
  }

  if (!multipleLeafAtomId || !ringNeighborAtomId || !anchorAtomId) {
    return null;
  }

  const subtreeAtomIds = collectCutSubtree(layoutGraph, atomId, anchorAtomId);
  return subtreeAtomIds.size > 1 && subtreeAtomIds.size <= MAX_EXACT_TRIGONAL_RING_BRANCH_REFLECTION_ATOMS
    ? { anchorAtomId }
    : null;
}

/**
 * Returns whether a side group can move as part of a compact saturated branch.
 * This keeps cleanup from treating long acyclic chains as one rigid object
 * while still allowing small methyl, alcohol, and carbonyl side groups to move
 * with their omitted-h saturated root.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {string} atomId - Side-group root atom id.
 * @param {string} parentAtomId - Parent saturated-root atom id.
 * @param {number} maxHeavyAtoms - Maximum allowed visible heavy atoms.
 * @returns {boolean} True when the side group is compact and acyclic.
 */
function isCompactSaturatedSideGroup(layoutGraph, atomId, parentAtomId, maxHeavyAtoms) {
  const subtreeAtomIds = collectCutSubtree(layoutGraph, atomId, parentAtomId);
  let heavyAtomCount = 0;
  for (const subtreeAtomId of subtreeAtomIds) {
    const atom = layoutGraph.atoms.get(subtreeAtomId);
    if (!atom) {
      return false;
    }
    if (layoutGraph.ringAtomIdSet.has(subtreeAtomId)) {
      return false;
    }
    if (atom.element !== 'H') {
      heavyAtomCount++;
    }
  }
  return heavyAtomCount > 0 && heavyAtomCount <= maxHeavyAtoms;
}

/**
 * Returns whether a side group is a compact acyclic substituent that can move
 * with a rigid trigonal or saturated root during overlap cleanup.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {string} atomId - Side-group root atom id.
 * @param {string} parentAtomId - Parent root atom id.
 * @param {number} maxHeavyAtoms - Maximum allowed visible heavy atoms.
 * @returns {boolean} True when the side group is compact and acyclic.
 */
function isCompactAcyclicSideGroup(layoutGraph, atomId, parentAtomId, maxHeavyAtoms) {
  const subtreeAtomIds = collectCutSubtree(layoutGraph, atomId, parentAtomId);
  let heavyAtomCount = 0;
  for (const subtreeAtomId of subtreeAtomIds) {
    const atom = layoutGraph.atoms.get(subtreeAtomId);
    if (!atom) {
      return false;
    }
    if (layoutGraph.ringAtomIdSet.has(subtreeAtomId)) {
      return false;
    }
    if (atom.element !== 'H') {
      heavyAtomCount++;
    }
  }
  return heavyAtomCount > 0 && heavyAtomCount <= maxHeavyAtoms;
}

/**
 * Returns whether all atoms in a subtree are acyclic visible-heavy compatible
 * cleanup members.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Iterable<string>} subtreeAtomIds - Candidate subtree atom ids.
 * @returns {boolean} True when the subtree contains no ring atoms.
 */
function isAcyclicSubtree(layoutGraph, subtreeAtomIds) {
  for (const atomId of subtreeAtomIds) {
    if (layoutGraph.ringAtomIdSet.has(atomId)) {
      return false;
    }
  }
  return true;
}

/**
 * Returns whether a subtree's visible-heavy atoms form a short unbranched path.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Iterable<string>} subtreeAtomIds - Candidate subtree atom ids.
 * @param {number} minHeavyAtoms - Minimum visible-heavy atoms in the subtree.
 * @param {number} maxHeavyAtoms - Maximum visible-heavy atoms in the subtree.
 * @returns {boolean} True when the heavy atoms form a compact linear branch.
 */
function isShortLinearHeavySubtree(layoutGraph, subtreeAtomIds, minHeavyAtoms, maxHeavyAtoms) {
  const subtreeAtomIdSet = new Set(subtreeAtomIds);
  let heavyAtomCount = 0;
  for (const atomId of subtreeAtomIds) {
    const atom = layoutGraph.atoms.get(atomId);
    if (!atom || atom.element === 'H') {
      continue;
    }
    heavyAtomCount++;
    let subtreeHeavyNeighborCount = 0;
    for (const bond of layoutGraph.bondsByAtomId.get(atomId) ?? []) {
      if (!bond || bond.kind !== 'covalent') {
        continue;
      }
      const neighborAtomId = bond.a === atomId ? bond.b : bond.a;
      const neighborAtom = layoutGraph.atoms.get(neighborAtomId);
      if (subtreeAtomIdSet.has(neighborAtomId) && neighborAtom?.element !== 'H') {
        subtreeHeavyNeighborCount++;
      }
    }
    if (subtreeHeavyNeighborCount > 2) {
      return false;
    }
  }
  return heavyAtomCount >= minHeavyAtoms && heavyAtomCount <= maxHeavyAtoms;
}

/**
 * Returns whether a subtree contains a terminal hetero or halogen leaf.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Iterable<string>} subtreeAtomIds - Candidate subtree atom ids.
 * @returns {boolean} True when a visible-heavy terminal hetero leaf is present.
 */
function hasTerminalHeteroBranchLeaf(layoutGraph, subtreeAtomIds) {
  const subtreeAtomIdSet = new Set(subtreeAtomIds);
  for (const atomId of subtreeAtomIds) {
    const atom = layoutGraph.atoms.get(atomId);
    if (!atom || !TERMINAL_HETERO_BRANCH_ELEMENTS.has(atom.element)) {
      continue;
    }
    let subtreeHeavyNeighborCount = 0;
    for (const bond of layoutGraph.bondsByAtomId.get(atomId) ?? []) {
      if (!bond || bond.kind !== 'covalent') {
        continue;
      }
      const neighborAtomId = bond.a === atomId ? bond.b : bond.a;
      const neighborAtom = layoutGraph.atoms.get(neighborAtomId);
      if (subtreeAtomIdSet.has(neighborAtomId) && neighborAtom?.element !== 'H') {
        subtreeHeavyNeighborCount++;
      }
    }
    if (subtreeHeavyNeighborCount <= 1) {
      return true;
    }
  }
  return false;
}

/**
 * Returns a descriptor for compact divalent acyclic continuations with terminal
 * hetero leaves. Rotating from the downstream continuation bond clears local
 * clashes without collapsing the upstream trigonal fan.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {string} atomId - Candidate branch root atom id.
 * @param {string[]} heavyNeighborIds - Heavy neighbors currently placed.
 * @returns {{anchorAtomId: string}|null} Rotation descriptor or `null`.
 */
function compactDivalentAcyclicBranchDescriptor(layoutGraph, atomId, heavyNeighborIds) {
  const atom = layoutGraph.atoms.get(atomId);
  if (
    !atom
    || atom.element !== 'C'
    || atom.aromatic
    || atom.heavyDegree !== 2
    || heavyNeighborIds.length !== 2
    || layoutGraph.ringAtomIdSet.has(atomId)
  ) {
    return null;
  }
  if (heavyNeighborIds.some(neighborAtomId => !singleBondDescriptor(layoutGraph, atomId, neighborAtomId))) {
    return null;
  }

  for (const anchorAtomId of heavyNeighborIds) {
    const anchorAtom = layoutGraph.atoms.get(anchorAtomId);
    if (
      !anchorAtom
      || anchorAtom.element !== 'C'
      || anchorAtom.aromatic
      || anchorAtom.heavyDegree !== 2
      || layoutGraph.ringAtomIdSet.has(anchorAtomId)
    ) {
      continue;
    }
    const subtreeAtomIds = collectCutSubtree(layoutGraph, atomId, anchorAtomId);
    if (
      isAcyclicSubtree(layoutGraph, subtreeAtomIds)
      && isShortLinearHeavySubtree(layoutGraph, subtreeAtomIds, 3, 6)
      && hasTerminalHeteroBranchLeaf(layoutGraph, subtreeAtomIds)
    ) {
      return { anchorAtomId };
    }
  }

  return null;
}

/**
 * Returns a rigid cleanup descriptor for compact saturated omitted-h branches.
 * Rotating the whole branch around its parent can resolve a nearby clash while
 * preserving the root's visible `120/120/120` heavy-neighbor spread and any
 * terminal carbonyl geometry inside the branch.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {string} atomId - Candidate saturated branch root atom id.
 * @param {string[]} heavyNeighborIds - Heavy neighbors currently placed.
 * @returns {{anchorAtomId: string}|null} Rotation descriptor or `null`.
 */
function branchedSaturatedSubtreeDescriptor(layoutGraph, atomId, heavyNeighborIds) {
  const atom = layoutGraph.atoms.get(atomId);
  if (
    !atom
    || atom.element !== 'C'
    || atom.aromatic
    || atom.heavyDegree !== 3
    || atom.degree !== 4
    || heavyNeighborIds.length !== 3
    || layoutGraph.ringAtomIdSet.has(atomId)
  ) {
    return null;
  }

  if (heavyNeighborIds.some(neighborAtomId => !singleBondDescriptor(layoutGraph, atomId, neighborAtomId))) {
    return null;
  }

  for (const anchorAtomId of heavyNeighborIds) {
    const anchorAtom = layoutGraph.atoms.get(anchorAtomId);
    if (!anchorAtom || anchorAtom.element === 'H' || anchorAtom.heavyDegree <= 1) {
      continue;
    }
    const sideGroupIds = heavyNeighborIds.filter(neighborAtomId => neighborAtomId !== anchorAtomId);
    const totalSubtreeAtomCount = [...collectCutSubtree(layoutGraph, atomId, anchorAtomId)].length;
    if (
      totalSubtreeAtomCount <= MAX_BRANCHED_SATURATED_SUBTREE_ATOMS
      && sideGroupIds.every(sideGroupId => isCompactSaturatedSideGroup(layoutGraph, sideGroupId, atomId, 3))
    ) {
      return { anchorAtomId };
    }
  }

  return null;
}

/**
 * Returns a rigid cleanup descriptor for compact quaternary saturated branches
 * such as tert-butyl ester roots. Rotating the whole group around its parent
 * preserves the projected four-coordinate fan while moving all terminal
 * methyls out of nearby clashes together.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {string} atomId - Candidate saturated branch root atom id.
 * @param {string[]} heavyNeighborIds - Heavy neighbors currently placed.
 * @returns {{anchorAtomId: string}|null} Rotation descriptor or `null`.
 */
function quaternarySaturatedSubtreeDescriptor(layoutGraph, atomId, heavyNeighborIds) {
  const atom = layoutGraph.atoms.get(atomId);
  if (
    !atom
    || atom.element !== 'C'
    || atom.aromatic
    || atom.heavyDegree !== 4
    || atom.degree !== 4
    || heavyNeighborIds.length !== 4
    || layoutGraph.ringAtomIdSet.has(atomId)
  ) {
    return null;
  }

  if (heavyNeighborIds.some(neighborAtomId => !singleBondDescriptor(layoutGraph, atomId, neighborAtomId))) {
    return null;
  }

  for (const anchorAtomId of heavyNeighborIds) {
    const anchorAtom = layoutGraph.atoms.get(anchorAtomId);
    if (!anchorAtom || anchorAtom.element === 'H' || anchorAtom.heavyDegree <= 1) {
      continue;
    }
    const sideGroupIds = heavyNeighborIds.filter(neighborAtomId => neighborAtomId !== anchorAtomId);
    const totalSubtreeAtomCount = [...collectCutSubtree(layoutGraph, atomId, anchorAtomId)].length;
    if (
      totalSubtreeAtomCount <= MAX_BRANCHED_SATURATED_SUBTREE_ATOMS
      && sideGroupIds.every(sideGroupId => isCompactAcyclicSideGroup(layoutGraph, sideGroupId, atomId, 3))
    ) {
      return { anchorAtomId };
    }
  }

  return null;
}

/**
 * Collects the movable side of a ring anchored at a tetra-substituted atom.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {object} ring - Incident ring descriptor.
 * @param {string} anchorAtomId - Fixed ring anchor atom ID.
 * @param {string[]} blockedNeighborIds - Exocyclic neighbors that must stay fixed.
 * @param {Map<string, {x: number, y: number}>} coords - Current coordinate map.
 * @returns {string[]} Atom IDs in the movable ring block.
 */
function collectAnchoredRingBlockAtomIds(layoutGraph, ring, anchorAtomId, blockedNeighborIds, coords) {
  const blockedAtomIds = new Set([anchorAtomId, ...blockedNeighborIds]);
  const visitedAtomIds = new Set(blockedAtomIds);
  const queue = ring.atomIds.filter(atomId => atomId !== anchorAtomId && coords.has(atomId));
  const blockAtomIds = [];

  while (queue.length > 0) {
    const atomId = queue.pop();
    if (visitedAtomIds.has(atomId)) {
      continue;
    }
    visitedAtomIds.add(atomId);
    blockAtomIds.push(atomId);
    for (const bond of layoutGraph.bondsByAtomId.get(atomId) ?? []) {
      if (!bond || bond.kind !== 'covalent') {
        continue;
      }
      const neighborAtomId = bond.a === atomId ? bond.b : bond.a;
      if (!visitedAtomIds.has(neighborAtomId) && coords.has(neighborAtomId)) {
        queue.push(neighborAtomId);
      }
    }
  }

  return blockAtomIds;
}

/**
 * Collects saturated five-member-or-larger ring blocks that can rotate rigidly
 * around a tetra-substituted ring atom to recover a cleaner exterior branch fan.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Current coordinate map.
 * @returns {Array<{anchorAtomId: string, ringNeighborIds: string[], exocyclicNeighborIds: string[], subtreeAtomIds: string[]}>} Anchored ring-block descriptors.
 */
function anchoredRingBlockExteriorSpreadDescriptors(layoutGraph, coords) {
  const descriptors = [];
  for (const [anchorAtomId, atom] of layoutGraph.atoms) {
    if (!atom || atom.element === 'H' || atom.aromatic || atom.heavyDegree !== 4 || !coords.has(anchorAtomId)) {
      continue;
    }
    const anchorRings = layoutGraph.atomToRings.get(anchorAtomId) ?? [];
    if (anchorRings.length !== 1) {
      continue;
    }
    const ring = anchorRings[0];
    const ringSize = ring?.atomIds?.length ?? 0;
    if (ring?.aromatic || ringSize < 5 || !supportsExteriorBranchSpreadRingSize(ringSize)) {
      continue;
    }
    if (ring.atomIds.some(atomId => atomId !== anchorAtomId && (layoutGraph.ringCountByAtomId.get(atomId) ?? 0) !== 1)) {
      continue;
    }

    const ringNeighborIds = [];
    const exocyclicNeighborIds = [];
    let eligible = true;
    for (const bond of layoutGraph.bondsByAtomId.get(anchorAtomId) ?? []) {
      if (!bond || bond.kind !== 'covalent' || bond.aromatic || (bond.order ?? 1) !== 1) {
        eligible = false;
        break;
      }
      const neighborAtomId = bond.a === anchorAtomId ? bond.b : bond.a;
      const neighborAtom = layoutGraph.atoms.get(neighborAtomId);
      if (!neighborAtom || neighborAtom.element === 'H') {
        continue;
      }
      if (!coords.has(neighborAtomId)) {
        eligible = false;
        break;
      }
      if (ring.atomIds.includes(neighborAtomId)) {
        ringNeighborIds.push(neighborAtomId);
      } else {
        exocyclicNeighborIds.push(neighborAtomId);
      }
    }
    if (!eligible || ringNeighborIds.length !== 2 || exocyclicNeighborIds.length !== 2) {
      continue;
    }
    if (measureSmallRingExteriorGapSpreadPenalty(layoutGraph, coords, anchorAtomId) <= CLEANUP_EPSILON) {
      continue;
    }

    const subtreeAtomIds = collectAnchoredRingBlockAtomIds(layoutGraph, ring, anchorAtomId, exocyclicNeighborIds, coords);
    const subtreeHeavyAtomCount = subtreeAtomIds.reduce(
      (count, atomId) => count + (layoutGraph.atoms.get(atomId)?.element === 'H' ? 0 : 1),
      0
    );
    if (subtreeAtomIds.length === 0 || subtreeHeavyAtomCount > MAX_ANCHORED_RING_BLOCK_ATOMS) {
      continue;
    }
    descriptors.push({
      anchorAtomId,
      ringNeighborIds,
      exocyclicNeighborIds,
      subtreeAtomIds
    });
  }
  return descriptors;
}

/**
 * Returns exact ring-block rotations that align exterior branch targets with
 * the fixed exocyclic neighbors at a tetra-substituted ring anchor.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Current coordinate map.
 * @param {{anchorAtomId: string, ringNeighborIds: string[], exocyclicNeighborIds: string[]}} descriptor - Anchored ring-block descriptor.
 * @returns {number[]} Candidate rotation offsets in radians.
 */
function anchoredRingBlockExteriorSpreadRotations(layoutGraph, coords, descriptor) {
  const anchorPosition = coords.get(descriptor.anchorAtomId);
  if (!anchorPosition) {
    return [];
  }
  const anchorRings = layoutGraph.atomToRings.get(descriptor.anchorAtomId) ?? [];
  const ringSize = anchorRings[0]?.atomIds?.length ?? 0;
  const ringNeighborAngles = descriptor.ringNeighborIds
    .map(atomId => coords.get(atomId))
    .filter(Boolean)
    .map(position => angleOf(sub(position, anchorPosition)));
  const exocyclicAngles = descriptor.exocyclicNeighborIds
    .map(atomId => coords.get(atomId))
    .filter(Boolean)
    .map(position => angleOf(sub(position, anchorPosition)));
  if (ringNeighborAngles.length !== 2 || exocyclicAngles.length !== 2) {
    return [];
  }
  const targetAngles = smallRingExteriorTargetAngles(ringNeighborAngles, ringSize);
  if (targetAngles.length !== 2) {
    return [];
  }

  const rotations = [];
  for (const targetOrder of [
    [targetAngles[0], targetAngles[1]],
    [targetAngles[1], targetAngles[0]]
  ]) {
    const rotation = meanSignedAngle([
      wrapAngle(exocyclicAngles[0] - targetOrder[0]),
      wrapAngle(exocyclicAngles[1] - targetOrder[1])
    ]);
    if (
      rotation != null &&
      Math.abs(rotation) > EXACT_ROTATION_ANGLE_EPSILON &&
      !rotations.some(existingRotation => angularDifference(existingRotation, rotation) <= EXACT_ROTATION_ANGLE_EPSILON)
    ) {
      rotations.push(rotation);
    }
  }
  return rotations;
}

/**
 * Returns the two visible ring neighbors of an anchor within one ring.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {object} ring - Ring descriptor.
 * @param {string} anchorAtomId - Anchor atom ID.
 * @returns {string[]} Neighbor atom IDs that belong to the ring.
 */
function ringNeighborIdsAtAnchor(layoutGraph, ring, anchorAtomId) {
  return (layoutGraph.bondsByAtomId.get(anchorAtomId) ?? [])
    .filter(bond => bond?.kind === 'covalent')
    .map(bond => (bond.a === anchorAtomId ? bond.b : bond.a))
    .filter(neighborAtomId => ring.atomIds.includes(neighborAtomId));
}

/**
 * Collects a covalent side while treating one atom as completely unavailable.
 * This is used for cyclic side blocks where cutting only the root bond would
 * still allow traversal back through the opposite side of the ring.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {string} rootAtomId - Root atom on the movable side.
 * @param {string} blockedAtomId - Atom that must not be crossed.
 * @returns {string[]} Atom IDs reachable without visiting the blocked atom.
 */
function collectSubtreeBlockingAtom(layoutGraph, rootAtomId, blockedAtomId) {
  const visitedAtomIds = new Set([blockedAtomId]);
  const pendingAtomIds = [rootAtomId];
  const subtreeAtomIds = [];

  while (pendingAtomIds.length > 0) {
    const atomId = pendingAtomIds.pop();
    if (visitedAtomIds.has(atomId)) {
      continue;
    }
    visitedAtomIds.add(atomId);
    subtreeAtomIds.push(atomId);
    for (const bond of layoutGraph.bondsByAtomId.get(atomId) ?? []) {
      if (!bond || bond.kind !== 'covalent') {
        continue;
      }
      const neighborAtomId = bond.a === atomId ? bond.b : bond.a;
      if (!visitedAtomIds.has(neighborAtomId)) {
        pendingAtomIds.push(neighborAtomId);
      }
    }
  }

  return subtreeAtomIds;
}

/**
 * Collects the movable side of a spiro small ring, rejecting cases where the
 * side reconnects into the parent ring.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {object} smallRing - Four-member spiro side-ring descriptor.
 * @param {object} parentRing - Larger parent-ring descriptor.
 * @param {string} anchorAtomId - Shared spiro atom ID.
 * @param {string[]} smallRingNeighborIds - Small-ring neighbors at the anchor.
 * @returns {Set<string>|null} Movable atom IDs, or null when not separable.
 */
function spiroSmallRingSideAtomIds(layoutGraph, smallRing, parentRing, anchorAtomId, smallRingNeighborIds) {
  const parentRingAtomIds = new Set(parentRing.atomIds.filter(atomId => atomId !== anchorAtomId));
  const sideAtomIds = new Set();

  for (const neighborAtomId of smallRingNeighborIds) {
    for (const atomId of collectSubtreeBlockingAtom(layoutGraph, neighborAtomId, anchorAtomId)) {
      if (parentRingAtomIds.has(atomId)) {
        return null;
      }
      if (atomId !== anchorAtomId && layoutGraph.atoms.has(atomId)) {
        sideAtomIds.add(atomId);
      }
    }
  }

  return sideAtomIds;
}

/**
 * Returns ideal anchor angles for a four-member spiro side ring centered in the
 * exterior gap of its larger parent ring.
 * @param {number[]} parentRingNeighborAngles - Parent-ring bond angles at the spiro atom.
 * @param {number} smallRingSize - Size of the spiro side ring.
 * @returns {number[]} Target small-ring neighbor angles.
 */
function spiroSmallRingExteriorTargetAngles(parentRingNeighborAngles, smallRingSize) {
  if (parentRingNeighborAngles.length !== 2 || smallRingSize < 3) {
    return [];
  }
  const sortedAngles = [...parentRingNeighborAngles].sort((firstAngle, secondAngle) => firstAngle - secondAngle);
  const forwardGap = sortedAngles[1] - sortedAngles[0];
  const wrapGap = (2 * Math.PI) - forwardGap;
  const exteriorStartAngle = forwardGap >= wrapGap ? sortedAngles[0] : sortedAngles[1];
  const exteriorGap = Math.max(forwardGap, wrapGap);
  const exteriorCenterAngle = wrapAngle(exteriorStartAngle + exteriorGap / 2);
  const smallRingInteriorAngle = Math.PI - (2 * Math.PI) / smallRingSize;
  return [
    wrapAngle(exteriorCenterAngle - smallRingInteriorAngle / 2),
    wrapAngle(exteriorCenterAngle + smallRingInteriorAngle / 2)
  ];
}

/**
 * Measures how far a spiro small-ring side fan is from its exterior targets.
 * @param {Map<string, {x: number, y: number}>} coords - Coordinate map.
 * @param {{anchorAtomId: string, smallRingNeighborIds: string[], targetAngles: number[]}} descriptor - Spiro small-ring descriptor.
 * @returns {number} Squared angular penalty.
 */
function measureSpiroSmallRingExteriorPenalty(coords, descriptor) {
  const anchorPosition = coords.get(descriptor.anchorAtomId);
  if (!anchorPosition || descriptor.targetAngles.length !== 2) {
    return Number.POSITIVE_INFINITY;
  }

  const smallRingNeighborAngles = descriptor.smallRingNeighborIds.map(atomId => {
    const position = coords.get(atomId);
    return position ? angleOf(sub(position, anchorPosition)) : null;
  });
  if (smallRingNeighborAngles.some(angle => angle == null)) {
    return Number.POSITIVE_INFINITY;
  }

  const alignedPenalty =
    angularDifference(smallRingNeighborAngles[0], descriptor.targetAngles[0]) ** 2
    + angularDifference(smallRingNeighborAngles[1], descriptor.targetAngles[1]) ** 2;
  const swappedPenalty =
    angularDifference(smallRingNeighborAngles[0], descriptor.targetAngles[1]) ** 2
    + angularDifference(smallRingNeighborAngles[1], descriptor.targetAngles[0]) ** 2;
  return Math.min(alignedPenalty, swappedPenalty);
}

/**
 * Collects four-member spiro side rings that can rotate partway toward the
 * exterior gap of their larger parent ring. This repairs cleanup moves that
 * clear an overlap by regularizing the small ring while leaving one spiro bond
 * visibly pinched against the parent ring.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Current coordinate map.
 * @returns {Array<{anchorAtomId: string, smallRingNeighborIds: string[], parentRingNeighborIds: string[], subtreeAtomIds: string[], targetAngles: number[]}>} Spiro small-ring descriptors.
 */
function spiroSmallRingExteriorSpreadDescriptors(layoutGraph, coords) {
  const descriptors = [];
  for (const [anchorAtomId, atom] of layoutGraph.atoms) {
    if (!atom || atom.element === 'H' || atom.aromatic || atom.heavyDegree !== 4 || !coords.has(anchorAtomId)) {
      continue;
    }

    const anchorRings = layoutGraph.atomToRings.get(anchorAtomId) ?? [];
    if (anchorRings.length !== 2) {
      continue;
    }

    for (const smallRing of anchorRings) {
      if (smallRing?.aromatic || smallRing?.atomIds?.length !== 4) {
        continue;
      }
      for (const parentRing of anchorRings) {
        if (parentRing === smallRing || parentRing?.aromatic || (parentRing?.atomIds?.length ?? 0) < 5) {
          continue;
        }
        const parentRingAtomIds = new Set(parentRing.atomIds);
        const sharedAtomIds = smallRing.atomIds.filter(atomId => parentRingAtomIds.has(atomId));
        if (sharedAtomIds.length !== 1 || sharedAtomIds[0] !== anchorAtomId) {
          continue;
        }

        const smallRingNeighborIds = ringNeighborIdsAtAnchor(layoutGraph, smallRing, anchorAtomId);
        const parentRingNeighborIds = ringNeighborIdsAtAnchor(layoutGraph, parentRing, anchorAtomId);
        if (
          smallRingNeighborIds.length !== 2
          || parentRingNeighborIds.length !== 2
          || !smallRingNeighborIds.every(atomId => coords.has(atomId))
          || !parentRingNeighborIds.every(atomId => coords.has(atomId))
        ) {
          continue;
        }

        const sideAtomIds = spiroSmallRingSideAtomIds(layoutGraph, smallRing, parentRing, anchorAtomId, smallRingNeighborIds);
        if (!sideAtomIds || sideAtomIds.size === 0) {
          continue;
        }
        const subtreeAtomIds = [...sideAtomIds].filter(atomId => coords.has(atomId));
        const subtreeHeavyAtomCount = subtreeAtomIds.reduce(
          (count, atomId) => count + (layoutGraph.atoms.get(atomId)?.element === 'H' ? 0 : 1),
          0
        );
        if (subtreeAtomIds.length === 0 || subtreeHeavyAtomCount > MAX_SPIRO_SMALL_RING_BLOCK_ATOMS) {
          continue;
        }

        const anchorPosition = coords.get(anchorAtomId);
        const parentRingNeighborAngles = parentRingNeighborIds.map(atomId => angleOf(sub(coords.get(atomId), anchorPosition)));
        const targetAngles = spiroSmallRingExteriorTargetAngles(parentRingNeighborAngles, smallRing.atomIds.length);
        if (targetAngles.length !== 2) {
          continue;
        }

        descriptors.push({
          anchorAtomId,
          smallRingNeighborIds,
          parentRingNeighborIds,
          subtreeAtomIds,
          targetAngles
        });
      }
    }
  }
  return descriptors;
}

/**
 * Builds fractional rotations that move a spiro small-ring side toward its
 * parent-ring exterior targets without forcing exact overlap-prone placement.
 * @param {Map<string, {x: number, y: number}>} coords - Coordinate map.
 * @param {{anchorAtomId: string, smallRingNeighborIds: string[], targetAngles: number[]}} descriptor - Spiro small-ring descriptor.
 * @returns {number[]} Candidate rotation offsets in radians.
 */
function spiroSmallRingExteriorSpreadRotations(coords, descriptor) {
  const anchorPosition = coords.get(descriptor.anchorAtomId);
  if (!anchorPosition) {
    return [];
  }
  const smallRingNeighborAngles = descriptor.smallRingNeighborIds
    .map(atomId => coords.get(atomId))
    .filter(Boolean)
    .map(position => angleOf(sub(position, anchorPosition)));
  if (smallRingNeighborAngles.length !== 2 || descriptor.targetAngles.length !== 2) {
    return [];
  }

  const rotations = [];
  for (const targetOrder of [
    [descriptor.targetAngles[0], descriptor.targetAngles[1]],
    [descriptor.targetAngles[1], descriptor.targetAngles[0]]
  ]) {
    const exactRotation = meanSignedAngle([
      wrapAngle(targetOrder[0] - smallRingNeighborAngles[0]),
      wrapAngle(targetOrder[1] - smallRingNeighborAngles[1])
    ]);
    if (exactRotation == null || Math.abs(exactRotation) <= EXACT_ROTATION_ANGLE_EPSILON) {
      continue;
    }
    for (const fraction of SPIRO_SMALL_RING_EXTERIOR_ROTATION_FRACTIONS) {
      const rotation = exactRotation * fraction;
      if (!rotations.some(existingRotation => angularDifference(existingRotation, rotation) <= EXACT_ROTATION_ANGLE_EPSILON)) {
        rotations.push(rotation);
      }
    }
  }
  return rotations;
}

/**
 * Collects movable terminal subtrees from the currently placed covalent graph.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Current coordinate map.
 * @returns {Array<{atomId: string, anchorAtomId: string, subtreeAtomIds: string[]}>} Rotatable terminal subtrees.
 */
function movableTerminalSubtrees(layoutGraph, coords) {
  const adjacency = buildPlacedAdjacency(layoutGraph, coords);
  const result = [];
  for (const [atomId, neighbors] of adjacency) {
    const atom = layoutGraph.atoms.get(atomId);
    if (!atom || atom.element === 'H' || atom.heavyDegree !== 1) {
      continue;
    }
    const heavyNeighbors = neighbors.filter(neighborAtomId => layoutGraph.atoms.get(neighborAtomId)?.element !== 'H');
    if (heavyNeighbors.length !== 1) {
      continue;
    }
    const anchorAtomId = heavyNeighbors[0];
    const bond = layoutGraph.bondByAtomPair.get(atomPairKey(atomId, anchorAtomId));
    if (!bond || bond.inRing || bond.order > 2) {
      continue;
    }
    result.push({
      atomId,
      anchorAtomId,
      subtreeAtomIds: [...collectCutSubtree(layoutGraph, atomId, anchorAtomId)].filter(subtreeAtomId => coords.has(subtreeAtomId))
    });
  }
  for (const [atomId, neighbors] of adjacency) {
    const atom = layoutGraph.atoms.get(atomId);
    if (!atom || atom.element === 'H' || atom.heavyDegree !== 2 || atom.degree !== 2) {
      continue;
    }
    const heavyNeighbors = neighbors.filter(neighborAtomId => layoutGraph.atoms.get(neighborAtomId)?.element !== 'H');
    if (heavyNeighbors.length !== 2) {
      continue;
    }
    let anchorAtomId = null;
    let branchRootAtomId = null;
    for (const candidateNeighborAtomId of heavyNeighbors) {
      const bond = layoutGraph.bondByAtomPair.get(atomPairKey(atomId, candidateNeighborAtomId));
      if (!bond || bond.inRing) {
        anchorAtomId = null;
        branchRootAtomId = null;
        break;
      }
      if ((bond.order ?? 1) === 1) {
        anchorAtomId = candidateNeighborAtomId;
      } else if ((bond.order ?? 1) >= 2) {
        branchRootAtomId = candidateNeighborAtomId;
      }
    }
    if (!anchorAtomId || !branchRootAtomId) {
      continue;
    }
    const branchRootAtom = layoutGraph.atoms.get(branchRootAtomId);
    if (!branchRootAtom || branchRootAtom.heavyDegree !== 1) {
      continue;
    }
    result.push({
      atomId,
      anchorAtomId,
      subtreeAtomIds: [...collectCutSubtree(layoutGraph, atomId, anchorAtomId)].filter(subtreeAtomId => coords.has(subtreeAtomId))
    });
  }
  for (const [atomId, neighbors] of adjacency) {
    const heavyNeighbors = neighbors.filter(neighborAtomId => layoutGraph.atoms.get(neighborAtomId)?.element !== 'H');
    const descriptor = saturatedTerminalSubtreeDescriptor(layoutGraph, atomId, heavyNeighbors);
    if (!descriptor) {
      continue;
    }
    result.push({
      atomId,
      anchorAtomId: descriptor.anchorAtomId,
      subtreeAtomIds: [...collectCutSubtree(layoutGraph, atomId, descriptor.anchorAtomId)].filter(subtreeAtomId => coords.has(subtreeAtomId))
    });
  }
  for (const [atomId, neighbors] of adjacency) {
    const heavyNeighbors = neighbors.filter(neighborAtomId => layoutGraph.atoms.get(neighborAtomId)?.element !== 'H');
    const descriptor = terminalTrigonalSubtreeDescriptor(layoutGraph, atomId, heavyNeighbors);
    if (!descriptor) {
      continue;
    }
    result.push({
      atomId,
      anchorAtomId: descriptor.anchorAtomId,
      subtreeAtomIds: [...collectCutSubtree(layoutGraph, atomId, descriptor.anchorAtomId)].filter(subtreeAtomId => coords.has(subtreeAtomId)),
      preferAtomOverlapClearance: true
    });
  }
  for (const [atomId, neighbors] of adjacency) {
    const heavyNeighbors = neighbors.filter(neighborAtomId => layoutGraph.atoms.get(neighborAtomId)?.element !== 'H');
    const descriptor = exactTrigonalRingBranchAxisReflectionDescriptor(layoutGraph, atomId, heavyNeighbors);
    if (!descriptor) {
      continue;
    }
    result.push({
      atomId,
      anchorAtomId: descriptor.anchorAtomId,
      subtreeAtomIds: [...collectCutSubtree(layoutGraph, atomId, descriptor.anchorAtomId)].filter(subtreeAtomId => coords.has(subtreeAtomId)),
      exactTrigonalRingBranchAxisReflection: true,
      preferAtomOverlapClearance: true
    });
  }
  for (const [atomId, neighbors] of adjacency) {
    const heavyNeighbors = neighbors.filter(neighborAtomId => layoutGraph.atoms.get(neighborAtomId)?.element !== 'H');
    const descriptor = compactDivalentAcyclicBranchDescriptor(layoutGraph, atomId, heavyNeighbors);
    if (!descriptor) {
      continue;
    }
    result.push({
      atomId,
      anchorAtomId: descriptor.anchorAtomId,
      subtreeAtomIds: [...collectCutSubtree(layoutGraph, atomId, descriptor.anchorAtomId)].filter(subtreeAtomId => coords.has(subtreeAtomId)),
      preferAtomOverlapClearance: true,
      skipPairRotation: true
    });
  }
  for (const [atomId, neighbors] of adjacency) {
    const heavyNeighbors = neighbors.filter(neighborAtomId => layoutGraph.atoms.get(neighborAtomId)?.element !== 'H');
    const descriptor = branchedSaturatedSubtreeDescriptor(layoutGraph, atomId, heavyNeighbors);
    if (!descriptor) {
      continue;
    }
    result.push({
      atomId,
      anchorAtomId: descriptor.anchorAtomId,
      subtreeAtomIds: [...collectCutSubtree(layoutGraph, atomId, descriptor.anchorAtomId)].filter(subtreeAtomId => coords.has(subtreeAtomId))
    });
  }
  for (const [atomId, neighbors] of adjacency) {
    const heavyNeighbors = neighbors.filter(neighborAtomId => layoutGraph.atoms.get(neighborAtomId)?.element !== 'H');
    const descriptor = quaternarySaturatedSubtreeDescriptor(layoutGraph, atomId, heavyNeighbors);
    if (!descriptor) {
      continue;
    }
    result.push({
      atomId,
      anchorAtomId: descriptor.anchorAtomId,
      subtreeAtomIds: [...collectCutSubtree(layoutGraph, atomId, descriptor.anchorAtomId)].filter(subtreeAtomId => coords.has(subtreeAtomId))
    });
  }
  return result;
}

/**
 * Returns geminal subtree pairs that share the same rotation anchor.
 * @param {Array<{atomId: string, anchorAtomId: string, subtreeAtomIds: string[]}>} terminalSubtrees - Individual movable terminal subtrees.
 * @returns {Array<{anchorAtomId: string, firstSubtree: {atomId: string, anchorAtomId: string, subtreeAtomIds: string[]}, secondSubtree: {atomId: string, anchorAtomId: string, subtreeAtomIds: string[]}, subtreeAtomIds: string[]}>} Geminal subtree pairs.
 */
function geminalSubtreePairs(terminalSubtrees) {
  const subtreesByAnchor = new Map();
  for (const subtree of terminalSubtrees) {
    if (subtree.skipPairRotation === true) {
      continue;
    }
    const anchorSubtrees = subtreesByAnchor.get(subtree.anchorAtomId) ?? [];
    anchorSubtrees.push(subtree);
    subtreesByAnchor.set(subtree.anchorAtomId, anchorSubtrees);
  }

  const pairs = [];
  for (const [anchorAtomId, anchorSubtrees] of subtreesByAnchor) {
    if (anchorSubtrees.length < 2) {
      continue;
    }
    for (let firstIndex = 0; firstIndex < anchorSubtrees.length - 1; firstIndex++) {
      for (let secondIndex = firstIndex + 1; secondIndex < anchorSubtrees.length; secondIndex++) {
        const firstSubtree = anchorSubtrees[firstIndex];
        const secondSubtree = anchorSubtrees[secondIndex];
        const seenSubtreeIds = new Set(firstSubtree.subtreeAtomIds);
        const subtreeAtomIds = [...firstSubtree.subtreeAtomIds];
        for (const id of secondSubtree.subtreeAtomIds) { if (!seenSubtreeIds.has(id)) { subtreeAtomIds.push(id); } }
        pairs.push({ anchorAtomId, firstSubtree, secondSubtree, subtreeAtomIds });
      }
    }
  }
  return pairs;
}

/**
 * Collects attached ring blocks that can swap occupied trigonal slots with a
 * sibling branch around a planar tertiary nitrogen.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Current coordinate map.
 * @returns {Array<{atomId: string, anchorAtomId: string, subtreeAtomIds: string[]}>} Attached ring subtrees eligible only for sibling swaps.
 */
function planarNitrogenAttachedRingSwapSubtrees(layoutGraph, coords) {
  const result = [];
  const seenKeys = new Set();
  for (const bond of layoutGraph.bonds?.values?.() ?? []) {
    if (!bond || bond.kind !== 'covalent' || bond.inRing || bond.aromatic || (bond.order ?? 1) !== 1) {
      continue;
    }
    for (const [anchorAtomId, rootAtomId] of [[bond.a, bond.b], [bond.b, bond.a]]) {
      const anchorAtom = layoutGraph.atoms.get(anchorAtomId);
      const rootAtom = layoutGraph.atoms.get(rootAtomId);
      if (
        !anchorAtom
        || !rootAtom
        || anchorAtom.element !== 'N'
        || rootAtom.element === 'H'
        || !coords.has(anchorAtomId)
        || !coords.has(rootAtomId)
        || !layoutGraph.ringAtomIdSet.has(rootAtomId)
        || !isExactVisibleTrigonalBisectorEligible(layoutGraph, anchorAtomId, rootAtomId)
      ) {
        continue;
      }
      const subtreeAtomIds = [...collectCutSubtree(layoutGraph, rootAtomId, anchorAtomId)].filter(subtreeAtomId => coords.has(subtreeAtomId));
      if (
        subtreeAtomIds.length === 0
        || subtreeAtomIds.includes(anchorAtomId)
        || !subtreeAtomIds.some(atomId => layoutGraph.ringAtomIdSet.has(atomId))
      ) {
        continue;
      }
      const key = `${anchorAtomId}:${rootAtomId}`;
      if (seenKeys.has(key)) {
        continue;
      }
      seenKeys.add(key);
      result.push({
        atomId: rootAtomId,
        anchorAtomId,
        subtreeAtomIds
      });
    }
  }
  return result;
}

/**
 * Returns whether sibling subtrees may swap exact trigonal slots around a
 * planar tertiary nitrogen anchor.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {string} anchorAtomId - Shared anchor atom ID.
 * @param {Array<{atomId: string}>} anchorSubtrees - Candidate sibling subtrees.
 * @returns {boolean} True when swapping preserves a planar trigonal anchor.
 */
function isPlanarNitrogenSiblingSwapAnchor(layoutGraph, anchorAtomId, anchorSubtrees) {
  const anchorAtom = layoutGraph.atoms.get(anchorAtomId);
  return !!anchorAtom
    && anchorAtom.element === 'N'
    && anchorAtom.heavyDegree === 3
    && anchorSubtrees.length >= 2
    && anchorSubtrees.every(subtree => isExactVisibleTrigonalBisectorEligible(layoutGraph, anchorAtomId, subtree.atomId));
}

/**
 * Returns subtree pairs that can be improved by swapping their occupied root
 * slots around the same anchor atom.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Current coordinate map.
 * @param {Array<{atomId: string, anchorAtomId: string, subtreeAtomIds: string[]}>} terminalSubtrees - Individual movable terminal subtrees.
 * @returns {Array<{anchorAtomId: string, firstSubtree: {atomId: string, anchorAtomId: string, subtreeAtomIds: string[]}, secondSubtree: {atomId: string, anchorAtomId: string, subtreeAtomIds: string[]}, subtreeAtomIds: string[]}>} Swappable sibling-subtree pairs.
 */
function siblingSwapPairs(layoutGraph, coords, terminalSubtrees) {
  if (coords.size > MAX_SIBLING_SWAP_LAYOUT_ATOMS) {
    return [];
  }
  const swapSubtrees = [
    ...terminalSubtrees.filter(subtree => subtree.skipPairRotation !== true),
    ...planarNitrogenAttachedRingSwapSubtrees(layoutGraph, coords)
  ];
  const subtreesByAnchor = new Map();
  for (const subtree of swapSubtrees) {
    const anchorSubtrees = subtreesByAnchor.get(subtree.anchorAtomId) ?? [];
    if (!anchorSubtrees.some(existingSubtree => existingSubtree.atomId === subtree.atomId)) {
      anchorSubtrees.push(subtree);
    }
    subtreesByAnchor.set(subtree.anchorAtomId, anchorSubtrees);
  }

  const pairs = [];
  for (const [anchorAtomId, anchorSubtrees] of subtreesByAnchor) {
    const anchorAtom = layoutGraph.atoms.get(anchorAtomId);
    const isPlanarNitrogenSwap = isPlanarNitrogenSiblingSwapAnchor(layoutGraph, anchorAtomId, anchorSubtrees);
    if (!anchorAtom || anchorAtom.element === 'H' || (anchorAtom.heavyDegree < 4 && !isPlanarNitrogenSwap)) {
      continue;
    }
    if (anchorSubtrees.length < 2) {
      continue;
    }
    for (let firstIndex = 0; firstIndex < anchorSubtrees.length - 1; firstIndex++) {
      for (let secondIndex = firstIndex + 1; secondIndex < anchorSubtrees.length; secondIndex++) {
        const firstSubtree = anchorSubtrees[firstIndex];
        const secondSubtree = anchorSubtrees[secondIndex];
        const seenSwapIds = new Set(firstSubtree.subtreeAtomIds);
        const subtreeAtomIds = [...firstSubtree.subtreeAtomIds];
        for (const id of secondSubtree.subtreeAtomIds) { if (!seenSwapIds.has(id)) { subtreeAtomIds.push(id); } }
        if (subtreeAtomIds.length > MAX_SIBLING_SWAP_SUBTREE_ATOMS) {
          continue;
        }
        pairs.push({
          anchorAtomId,
          firstSubtree,
          secondSubtree,
          subtreeAtomIds
        });
      }
    }
  }
  return pairs;
}

/**
 * Computes reusable rotatable subtree descriptors for local cleanup.
 * The topology of these subtrees depends on connectivity and placed atom
 * presence, not on the later rotation candidate chosen within one cleanup loop.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Current coordinate map.
 * @returns {{terminalSubtrees: Array<{atomId: string, anchorAtomId: string, subtreeAtomIds: string[]}>, siblingSwaps: Array<{anchorAtomId: string, firstSubtree: {atomId: string, anchorAtomId: string, subtreeAtomIds: string[]}, secondSubtree: {atomId: string, anchorAtomId: string, subtreeAtomIds: string[]}, subtreeAtomIds: string[]}>, geminalPairs: Array<{anchorAtomId: string, firstSubtree: {atomId: string, anchorAtomId: string, subtreeAtomIds: string[]}, secondSubtree: {atomId: string, anchorAtomId: string, subtreeAtomIds: string[]}, subtreeAtomIds: string[]}>, anchoredRingBlocks: Array<{anchorAtomId: string, ringNeighborIds: string[], exocyclicNeighborIds: string[], subtreeAtomIds: string[]}>, spiroSmallRingBlocks: Array<{anchorAtomId: string, smallRingNeighborIds: string[], parentRingNeighborIds: string[], subtreeAtomIds: string[], targetAngles: number[]}>}} Reusable local-rotation descriptors.
 */
export function computeRotatableSubtrees(layoutGraph, coords) {
  const terminalSubtrees = movableTerminalSubtrees(layoutGraph, coords);
  return {
    terminalSubtrees,
    siblingSwaps: siblingSwapPairs(layoutGraph, coords, terminalSubtrees),
    geminalPairs: geminalSubtreePairs(terminalSubtrees),
    anchoredRingBlocks: anchoredRingBlockExteriorSpreadDescriptors(layoutGraph, coords),
    spiroSmallRingBlocks: spiroSmallRingExteriorSpreadDescriptors(layoutGraph, coords)
  };
}

/**
 * Collects the overlap atoms plus their immediate covalent neighbors so local
 * cleanup can focus on descriptors that can plausibly affect the current clash.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Array<{firstAtomId: string, secondAtomId: string}>} overlapPairs - Severe overlaps from the current coordinates.
 * @returns {Set<string>} Atom IDs relevant to the current overlap probe.
 */
function overlapRelevantAtomIds(layoutGraph, overlapPairs) {
  const relevantAtomIds = new Set();
  for (const overlap of overlapPairs) {
    for (const atomId of [overlap.firstAtomId, overlap.secondAtomId]) {
      relevantAtomIds.add(atomId);
      for (const bond of layoutGraph.bondsByAtomId.get(atomId) ?? []) {
        if (bond.kind !== 'covalent') {
          continue;
        }
        relevantAtomIds.add(bond.a === atomId ? bond.b : bond.a);
      }
    }
  }
  return relevantAtomIds;
}

/**
 * Returns whether a cleanup descriptor can plausibly influence one of the
 * currently overlapping atoms.
 * @param {{anchorAtomId: string, subtreeAtomIds: string[]}} descriptor - Rotation descriptor.
 * @param {Set<string>} relevantAtomIds - Atom IDs near the current overlaps.
 * @returns {boolean} True when the descriptor should be kept for this probe.
 */
function descriptorTouchesRelevantAtoms(descriptor, relevantAtomIds) {
  if (relevantAtomIds.has(descriptor.anchorAtomId)) {
    return true;
  }
  return descriptor.subtreeAtomIds.some(atomId => relevantAtomIds.has(atomId));
}

/**
 * Narrows reusable rotation descriptors to those that can affect the current
 * overlap set. When no overlaps are provided, all descriptors remain eligible.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {{terminalSubtrees: Array<object>, siblingSwaps: Array<object>, geminalPairs: Array<object>, anchoredRingBlocks?: Array<object>, spiroSmallRingBlocks?: Array<object>}} descriptors - Reusable rotation descriptors.
 * @param {Array<{firstAtomId: string, secondAtomId: string}>|null|undefined} overlapPairs - Severe overlaps from the current coordinates.
 * @returns {{terminalSubtrees: Array<object>, siblingSwaps: Array<object>, geminalPairs: Array<object>, anchoredRingBlocks: Array<object>, spiroSmallRingBlocks: Array<object>}} Filtered descriptors.
 */
function filterDescriptorsByOverlap(layoutGraph, descriptors, overlapPairs) {
  if (!Array.isArray(overlapPairs) || overlapPairs.length === 0) {
    return {
      ...descriptors,
      anchoredRingBlocks: descriptors.anchoredRingBlocks ?? [],
      spiroSmallRingBlocks: descriptors.spiroSmallRingBlocks ?? []
    };
  }
  const relevantAtomIds = overlapRelevantAtomIds(layoutGraph, overlapPairs);
  return {
    terminalSubtrees: descriptors.terminalSubtrees.filter(descriptor => descriptorTouchesRelevantAtoms(descriptor, relevantAtomIds)),
    siblingSwaps: descriptors.siblingSwaps.filter(descriptor => descriptorTouchesRelevantAtoms(descriptor, relevantAtomIds)),
    geminalPairs: descriptors.geminalPairs.filter(descriptor => descriptorTouchesRelevantAtoms(descriptor, relevantAtomIds)),
    anchoredRingBlocks: (descriptors.anchoredRingBlocks ?? []).filter(descriptor => descriptorTouchesRelevantAtoms(descriptor, relevantAtomIds)),
    spiroSmallRingBlocks: (descriptors.spiroSmallRingBlocks ?? []).filter(descriptor => descriptorTouchesRelevantAtoms(descriptor, relevantAtomIds))
  };
}

function filterDescriptorsByFocus(descriptors, focusAtomIds) {
  if (!(focusAtomIds instanceof Set) || focusAtomIds.size === 0) {
    return {
      ...descriptors,
      anchoredRingBlocks: descriptors.anchoredRingBlocks ?? [],
      spiroSmallRingBlocks: descriptors.spiroSmallRingBlocks ?? []
    };
  }
  return {
    terminalSubtrees: descriptors.terminalSubtrees.filter(descriptor => descriptorTouchesRelevantAtoms(descriptor, focusAtomIds)),
    siblingSwaps: descriptors.siblingSwaps.filter(descriptor => descriptorTouchesRelevantAtoms(descriptor, focusAtomIds)),
    geminalPairs: descriptors.geminalPairs.filter(descriptor => descriptorTouchesRelevantAtoms(descriptor, focusAtomIds)),
    anchoredRingBlocks: (descriptors.anchoredRingBlocks ?? []).filter(descriptor => descriptorTouchesRelevantAtoms(descriptor, focusAtomIds)),
    spiroSmallRingBlocks: (descriptors.spiroSmallRingBlocks ?? []).filter(descriptor => descriptorTouchesRelevantAtoms(descriptor, focusAtomIds))
  };
}

/**
 * Inserts one approximate local-cleanup move into a small finalist list sorted
 * by descending cheap improvement.
 * @param {Array<{positions: Map<string, {x: number, y: number}>, approximateImprovement: number, atomOverlapCost: number, anchorDistortion: number}>} finalists - Finalist buffer.
 * @param {{positions: Map<string, {x: number, y: number}>, approximateImprovement: number, atomOverlapCost: number, anchorDistortion: number}|null} candidate - Candidate move.
 * @returns {void}
 */
function recordFinalist(finalists, candidate) {
  if (!candidate) {
    return;
  }
  let inserted = false;
  for (let index = 0; index < finalists.length; index++) {
    if (candidate.approximateImprovement > finalists[index].approximateImprovement) {
      finalists.splice(index, 0, candidate);
      inserted = true;
      break;
    }
  }
  if (!inserted) {
    finalists.push(candidate);
  }
  if (finalists.length > LOCAL_ROTATION_BOND_CROWDING_FINALISTS) {
    finalists.length = LOCAL_ROTATION_BOND_CROWDING_FINALISTS;
  }
}

/**
 * Chooses the stronger local cleanup move. Geometry-preserving descriptors can
 * opt into preferring fewer severe atom-overlap penalties before softer gains.
 * @param {object|null} incumbent - Current best move.
 * @param {object} candidate - Candidate move.
 * @param {number} epsilon - Numeric tie tolerance.
 * @returns {boolean} True when the candidate should replace the incumbent.
 */
function isBetterLocalMove(incumbent, candidate, epsilon) {
  if (!incumbent) {
    return true;
  }
  const preferAtomOverlapCost = candidate.preferAtomOverlapCost === true || incumbent.preferAtomOverlapCost === true;
  if (preferAtomOverlapCost && Math.abs((candidate.atomOverlapCost ?? 0) - (incumbent.atomOverlapCost ?? 0)) > epsilon) {
    return (candidate.atomOverlapCost ?? 0) < (incumbent.atomOverlapCost ?? 0);
  }
  return candidate.improvement > incumbent.improvement + epsilon;
}

/**
 * Re-scores a small set of approximate local-cleanup finalists with bond
 * crowding enabled and returns the best surviving full move.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Current coordinate map.
 * @param {string[]} subtreeAtomIds - Atoms moved by the descriptor.
 * @param {Array<{positions: Map<string, {x: number, y: number}>, approximateImprovement: number}>} finalists - Approximate finalists to refine.
 * @param {number} bondLength - Target bond length.
 * @param {object} subtreeContext - Reusable subtree-overlap context.
 * @param {number} epsilon - Minimum accepted improvement.
 * @param {{preferAtomOverlapCost?: boolean}} [options] - Finalist ranking options.
 * @returns {{positions: Map<string, {x: number, y: number}>, improvement: number, atomOverlapCost?: number, preferAtomOverlapCost?: boolean}|null} Best fully scored move.
 */
function finalizeBestMove(layoutGraph, coords, subtreeAtomIds, finalists, bondLength, subtreeContext, epsilon, options = {}) {
  if (finalists.length === 0) {
    return null;
  }

  const baseBondCrowdingCost = computeSubtreeOverlapCost(layoutGraph, coords, subtreeAtomIds, null, bondLength, {
    includeAtomOverlaps: false,
    includeBondCrowding: true,
    subtreeContext
  });

  let bestMove = null;
  for (const finalist of finalists) {
    const candidateBondCrowdingCost = computeSubtreeOverlapCost(layoutGraph, coords, subtreeAtomIds, finalist.positions, bondLength, {
      includeAtomOverlaps: false,
      includeBondCrowding: true,
      subtreeContext
    });
    const improvement = finalist.approximateImprovement + (baseBondCrowdingCost - candidateBondCrowdingCost);
    if (improvement > epsilon) {
      const candidateMove = {
        positions: finalist.positions,
        improvement,
        atomOverlapCost: finalist.atomOverlapCost ?? 0,
        preferAtomOverlapCost: options.preferAtomOverlapCost === true
      };
      if (isBetterLocalMove(bestMove, candidateMove, epsilon)) {
        bestMove = candidateMove;
      }
    }
  }

  return bestMove;
}

/**
 * Computes the approximate inward ring-core vector for a ring anchor by summing
 * the vectors from the anchor to the centroids of each incident ring.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Current coordinate map.
 * @param {string} anchorAtomId - Anchor atom id.
 * @returns {{x: number, y: number}|null} Inward ring-core vector, or null when unavailable.
 */
function computeRingInteriorVector(layoutGraph, coords, anchorAtomId) {
  const anchorPosition = coords.get(anchorAtomId);
  const anchorRings = layoutGraph.atomToRings.get(anchorAtomId) ?? [];
  if (!anchorPosition || anchorRings.length === 0) {
    return null;
  }

  let inwardX = 0;
  let inwardY = 0;
  let countedRings = 0;
  for (const ring of anchorRings) {
    let centroidX = 0;
    let centroidY = 0;
    let countedAtoms = 0;
    for (const ringAtomId of ring.atomIds) {
      const ringPosition = coords.get(ringAtomId);
      if (!ringPosition) {
        continue;
      }
      centroidX += ringPosition.x;
      centroidY += ringPosition.y;
      countedAtoms++;
    }
    if (countedAtoms === 0) {
      continue;
    }
    inwardX += centroidX / countedAtoms - anchorPosition.x;
    inwardY += centroidY / countedAtoms - anchorPosition.y;
    countedRings++;
  }

  if (countedRings === 0 || Math.hypot(inwardX, inwardY) <= DISTANCE_EPSILON) {
    return null;
  }
  return { x: inwardX, y: inwardY };
}

/**
 * Returns the number of incident ring polygons containing a candidate branch root.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Current coordinate map.
 * @param {string} anchorAtomId - Anchor atom id.
 * @param {{x: number, y: number}} position - Candidate branch-root position.
 * @returns {number} Number of incident ring faces containing the position.
 */
function containingIncidentRingCount(layoutGraph, coords, anchorAtomId, position) {
  let containingRingCount = 0;
  for (const ring of layoutGraph.atomToRings.get(anchorAtomId) ?? []) {
    const polygon = ring.atomIds.map(ringAtomId => coords.get(ringAtomId)).filter(Boolean);
    if (polygon.length >= 3 && pointInPolygon(position, polygon)) {
      containingRingCount++;
    }
  }
  return containingRingCount;
}

/**
 * Returns whether a cleanup candidate would flip a ring substituent from the
 * outside of the ring system toward the ring interior.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Current coordinate map.
 * @param {string} anchorAtomId - Anchor atom id.
 * @param {{x: number, y: number}} currentRootPosition - Current subtree-root position.
 * @param {{x: number, y: number}} candidateRootPosition - Candidate subtree-root position.
 * @param {number} tolerance - Small dot-product tolerance for near-tangent cases.
 * @returns {boolean} True when the candidate flips an outward substituent inward.
 */
function flipsRingSubstituentInward(layoutGraph, coords, anchorAtomId, currentRootPosition, candidateRootPosition, tolerance) {
  if (containingIncidentRingCount(layoutGraph, coords, anchorAtomId, candidateRootPosition) > containingIncidentRingCount(layoutGraph, coords, anchorAtomId, currentRootPosition)) {
    return true;
  }
  const anchorPosition = coords.get(anchorAtomId);
  const inwardVector = computeRingInteriorVector(layoutGraph, coords, anchorAtomId);
  if (!anchorPosition || !inwardVector) {
    return false;
  }

  const currentVector = sub(currentRootPosition, anchorPosition);
  const candidateVector = sub(candidateRootPosition, anchorPosition);
  const currentDot = currentVector.x * inwardVector.x + currentVector.y * inwardVector.y;
  const candidateDot = candidateVector.x * inwardVector.x + candidateVector.y * inwardVector.y;
  return currentDot <= tolerance && candidateDot > tolerance;
}

/**
 * Returns whether the atom should be tracked in the visible-geometry atom grid.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {string} atomId - Atom identifier.
 * @returns {boolean} True when the atom is visible and should be tracked.
 */
function shouldTrackVisibleAtom(layoutGraph, atomId) {
  return layoutGraph.atoms.get(atomId)?.visible === true;
}

/**
 * Applies moved atom positions onto the working atom grid in place.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {import('../geometry/atom-grid.js').AtomGrid} atomGrid - Working atom grid.
 * @param {Map<string, {x: number, y: number}>} coords - Current coordinate map before mutation.
 * @param {Array<[string, {x: number, y: number}]>} movedPositions - Accepted moved positions.
 * @returns {void}
 */
function updateAtomGridForMove(layoutGraph, atomGrid, coords, movedPositions) {
  for (const [atomId, nextPosition] of movedPositions) {
    if (!shouldTrackVisibleAtom(layoutGraph, atomId)) {
      continue;
    }
    const previousPosition = coords.get(atomId);
    if (previousPosition) {
      atomGrid.remove(atomId, previousPosition);
    }
    atomGrid.insert(atomId, nextPosition);
  }
}

/**
 * Returns whether a spiro-ring retouch preserves all audit-count invariants.
 * @param {object} candidateAudit - Candidate audit result.
 * @param {object} baseAudit - Baseline audit result.
 * @returns {boolean} True when the retouch is audit-safe.
 */
function spiroSmallRingAuditDoesNotWorsen(candidateAudit, baseAudit) {
  if (baseAudit.ok === true && candidateAudit.ok !== true) {
    return false;
  }
  return (
    candidateAudit.severeOverlapCount <= baseAudit.severeOverlapCount
    && candidateAudit.bondLengthFailureCount <= baseAudit.bondLengthFailureCount
    && (candidateAudit.visibleHeavyBondCrossingCount ?? 0) <= (baseAudit.visibleHeavyBondCrossingCount ?? 0)
    && candidateAudit.ringSubstituentReadabilityFailureCount <= baseAudit.ringSubstituentReadabilityFailureCount
    && candidateAudit.inwardRingSubstituentCount <= baseAudit.inwardRingSubstituentCount
    && candidateAudit.outwardAxisRingSubstituentFailureCount <= baseAudit.outwardAxisRingSubstituentFailureCount
  );
}

/**
 * Applies one audit-guarded spiro small-ring fan correction after overlap
 * cleanup has made room for it. The move is intentionally fractional: it
 * improves the exterior angle without forcing the compact spiro ring into a
 * neighboring substituent pocket.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} inputCoords - Coordinate map.
 * @param {object} [options] - Cleanup options.
 * @param {number} [options.bondLength] - Target bond length.
 * @param {number} [options.epsilon] - Minimum accepted improvement.
 * @param {Set<string>|null} [options.frozenAtomIds] - Atom ids that cleanup must not move.
 * @returns {{coords: Map<string, {x: number, y: number}>, nudges: number, improvement: number}} Retouched coordinates and stats.
 */
export function runSpiroSmallRingExteriorCleanup(layoutGraph, inputCoords, options = {}) {
  const bondLength = options.bondLength ?? layoutGraph.options.bondLength;
  const epsilon = options.epsilon ?? CLEANUP_EPSILON;
  const frozenAtomIds = options.frozenAtomIds instanceof Set && options.frozenAtomIds.size > 0 ? options.frozenAtomIds : null;
  const coords = new Map([...inputCoords.entries()].map(([atomId, position]) => [atomId, { ...position }]));
  const descriptors = spiroSmallRingExteriorSpreadDescriptors(layoutGraph, coords)
    .filter(descriptor => !frozenAtomIds || !containsFrozenAtom(descriptor.subtreeAtomIds, frozenAtomIds))
    .map(descriptor => ({
      ...descriptor,
      basePenalty: measureSpiroSmallRingExteriorPenalty(coords, descriptor)
    }))
    .filter(descriptor => Number.isFinite(descriptor.basePenalty) && descriptor.basePenalty > epsilon)
    .sort((first, second) => second.basePenalty - first.basePenalty);

  if (descriptors.length === 0) {
    return {
      coords,
      nudges: 0,
      improvement: 0
    };
  }

  let nudges = 0;
  let totalImprovement = 0;
  let baseAudit = auditLayout(layoutGraph, coords, { bondLength });
  const atomGrid = buildAtomGrid(layoutGraph, coords, bondLength);

  for (const descriptor of descriptors) {
    const refreshedDescriptor = spiroSmallRingExteriorSpreadDescriptors(layoutGraph, coords)
      .find(candidate => candidate.anchorAtomId === descriptor.anchorAtomId
        && candidate.smallRingNeighborIds.every(atomId => descriptor.smallRingNeighborIds.includes(atomId))
        && candidate.parentRingNeighborIds.every(atomId => descriptor.parentRingNeighborIds.includes(atomId)));
    if (!refreshedDescriptor) {
      continue;
    }

    const baseExteriorPenalty = measureSpiroSmallRingExteriorPenalty(coords, refreshedDescriptor);
    if (!Number.isFinite(baseExteriorPenalty) || baseExteriorPenalty <= epsilon) {
      continue;
    }

    const subtreeContext = buildSubtreeOverlapContext(layoutGraph, refreshedDescriptor.subtreeAtomIds, {
      includeBondCrowding: true
    });
    const baseAtomOverlapCost = computeSubtreeOverlapCost(layoutGraph, coords, refreshedDescriptor.subtreeAtomIds, null, bondLength, {
      atomGrid,
      subtreeContext
    });

    let bestCandidate = null;
    for (const rotation of spiroSmallRingExteriorSpreadRotations(coords, refreshedDescriptor)) {
      const anchorPosition = coords.get(refreshedDescriptor.anchorAtomId);
      if (!anchorPosition) {
        continue;
      }
      const movedPositions = new Map();
      for (const atomId of refreshedDescriptor.subtreeAtomIds) {
        const position = coords.get(atomId);
        if (!position) {
          continue;
        }
        movedPositions.set(atomId, add(anchorPosition, rotate(sub(position, anchorPosition), rotation)));
      }
      if (movedPositions.size !== refreshedDescriptor.subtreeAtomIds.length) {
        continue;
      }

      const candidateCoords = new Map(coords);
      for (const [atomId, position] of movedPositions) {
        candidateCoords.set(atomId, position);
      }
      const candidatePenalty = measureSpiroSmallRingExteriorPenalty(candidateCoords, refreshedDescriptor);
      if (candidatePenalty >= baseExteriorPenalty - epsilon) {
        continue;
      }
      const candidateAudit = auditLayout(layoutGraph, candidateCoords, { bondLength });
      if (!spiroSmallRingAuditDoesNotWorsen(candidateAudit, baseAudit)) {
        continue;
      }

      const candidateAtomOverlapCost = computeSubtreeOverlapCost(
        layoutGraph,
        coords,
        refreshedDescriptor.subtreeAtomIds,
        movedPositions,
        bondLength,
        {
          atomGrid,
          subtreeContext
        }
      );
      const improvement =
        (baseExteriorPenalty - candidatePenalty) * SPIRO_SMALL_RING_EXTERIOR_SPREAD_WEIGHT
        + baseAtomOverlapCost - candidateAtomOverlapCost;
      if (improvement <= epsilon) {
        continue;
      }
      if (
        !bestCandidate
        || candidatePenalty < bestCandidate.penalty - epsilon
        || (
          Math.abs(candidatePenalty - bestCandidate.penalty) <= epsilon
          && candidateAtomOverlapCost < bestCandidate.atomOverlapCost - epsilon
        )
      ) {
        bestCandidate = {
          movedPositions,
          audit: candidateAudit,
          penalty: candidatePenalty,
          atomOverlapCost: candidateAtomOverlapCost,
          improvement
        };
      }
    }

    if (!bestCandidate) {
      continue;
    }
    updateAtomGridForMove(layoutGraph, atomGrid, coords, bestCandidate.movedPositions);
    for (const [atomId, position] of bestCandidate.movedPositions) {
      coords.set(atomId, position);
    }
    baseAudit = bestCandidate.audit;
    totalImprovement += bestCandidate.improvement;
    nudges++;
  }

  return {
    coords,
    nudges,
    improvement: totalImprovement
  };
}

/**
 * Returns whether a ring-bound hetero center should preserve a visible three-way
 * branch fan during local cleanup. Saturated tertiary amines with one exocyclic
 * compact substituent can otherwise clear an overlap by collapsing that branch
 * into the adjacent ring-bond slot.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {string} atomId - Candidate anchor atom ID.
 * @param {Array<{bond: object, neighborAtomId: string}>} heavyBonds - Visible single heavy bonds.
 * @returns {boolean} True when ring-local cleanup should score the fan as trigonal.
 */
function shouldPreserveRingTrigonalHeteroFan(layoutGraph, atomId, heavyBonds) {
  const atom = layoutGraph.atoms.get(atomId);
  const incidentRings = layoutGraph.atomToRings.get(atomId) ?? [];
  if (
    !atom
    || incidentRings.length === 0
    || atom.heavyDegree !== 3
    || atom.degree !== 3
    || heavyBonds.length !== 3
  ) {
    return false;
  }

  const ringBondCount = heavyBonds.filter(({ bond }) => bond.inRing).length;
  if (ringBondCount !== 2) {
    return false;
  }

  const exocyclicBond = heavyBonds.find(({ bond }) => !bond.inRing) ?? null;
  if (!exocyclicBond) {
    return false;
  }
  const exocyclicAtom = layoutGraph.atoms.get(exocyclicBond.neighborAtomId);
  return !!exocyclicAtom
    && exocyclicAtom.element !== 'H'
    && !exocyclicAtom.aromatic
    && !layoutGraph.ringAtomIdSet.has(exocyclicBond.neighborAtomId)
    && isCompactAcyclicSideGroup(layoutGraph, exocyclicBond.neighborAtomId, atomId, 4);
}

/**
 * Returns whether an atom belongs to at least one ring.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {string} atomId - Candidate atom ID.
 * @returns {boolean} True when the atom is ring-membered.
 */
function isRingAtom(layoutGraph, atomId) {
  return (layoutGraph.atomToRings?.get(atomId)?.length ?? 0) > 0;
}

/**
 * Scores distortion of a ring atom's two ring bonds plus one exocyclic
 * substituent. The scoped local cleanup guard uses this to avoid bending an
 * already exact ring-root fan just to tidy a compact terminal carboxyl group.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Current coordinate map.
 * @param {string} atomId - Candidate ring atom ID.
 * @param {Map<string, {x: number, y: number}>|null} overridePositions - Optional candidate moved positions.
 * @returns {number} Ring-root fan distortion penalty.
 */
function ringRootFanDistortionCost(layoutGraph, coords, atomId, overridePositions) {
  if (!isRingAtom(layoutGraph, atomId)) {
    return 0;
  }
  const atomPosition = overridePositions?.get(atomId) ?? coords.get(atomId);
  if (!atomPosition) {
    return 0;
  }

  const neighborAngles = [];
  let ringBondCount = 0;
  for (const bond of layoutGraph.bondsByAtomId?.get(atomId) ?? []) {
    if (!bond || bond.kind !== 'covalent') {
      continue;
    }
    const neighborAtomId = bond.a === atomId ? bond.b : bond.a;
    const neighborAtom = layoutGraph.atoms.get(neighborAtomId);
    const neighborPosition = overridePositions?.get(neighborAtomId) ?? coords.get(neighborAtomId);
    if (!neighborAtom || neighborAtom.element === 'H' || !neighborPosition) {
      continue;
    }
    if (bond.inRing) {
      ringBondCount++;
    }
    neighborAngles.push(angleOf(sub(neighborPosition, atomPosition)));
  }
  if (neighborAngles.length !== 3 || ringBondCount < 2) {
    return 0;
  }

  const sortedAngles = neighborAngles.map(wrapAngle).sort((firstAngle, secondAngle) => firstAngle - secondAngle);
  const idealSeparation = (2 * Math.PI) / 3;
  return sortedAngles.reduce((cost, currentAngle, index) => {
    const nextAngle = sortedAngles[(index + 1) % sortedAngles.length];
    const separation = index === sortedAngles.length - 1
      ? nextAngle + 2 * Math.PI - currentAngle
      : nextAngle - currentAngle;
    return cost + ((separation - idealSeparation) ** 2);
  }, 0);
}

function hypervalentCrossFanDistortionCost(layoutGraph, coords, atomId, overridePositions) {
  const atom = layoutGraph.atoms.get(atomId);
  if (!atom || !ORTHOGONAL_HYPERVALENT_ELEMENTS.has(atom.element)) {
    return 0;
  }
  const atomPosition = overridePositions?.get(atomId) ?? coords.get(atomId);
  if (!atomPosition) {
    return 0;
  }
  const neighborAngles = [];
  for (const bond of layoutGraph.bondsByAtomId.get(atomId) ?? []) {
    if (!bond || bond.kind !== 'covalent') {
      continue;
    }
    const neighborAtomId = bond.a === atomId ? bond.b : bond.a;
    const neighborAtom = layoutGraph.atoms.get(neighborAtomId);
    const neighborPosition = overridePositions?.get(neighborAtomId) ?? coords.get(neighborAtomId);
    if (!neighborAtom || neighborAtom.element === 'H' || !neighborPosition) {
      continue;
    }
    neighborAngles.push(angleOf(sub(neighborPosition, atomPosition)));
  }
  if (neighborAngles.length !== 4) {
    return 0;
  }
  const sortedAngles = neighborAngles.map(wrapAngle).sort((firstAngle, secondAngle) => firstAngle - secondAngle);
  const idealSeparation = Math.PI / 2;
  return sortedAngles.reduce((cost, currentAngle, index) => {
    const nextAngle = sortedAngles[(index + 1) % sortedAngles.length];
    const separation = index === sortedAngles.length - 1
      ? nextAngle + 2 * Math.PI - currentAngle
      : nextAngle - currentAngle;
    return cost + ((separation - idealSeparation) ** 2);
  }, 0);
}

/**
 * Returns whether local cleanup should preserve an exact saturated three-heavy
 * carbon fan. These omitted-H branch points look trigonal in 2D, and rotating
 * one branch off an already exact 120-degree slot creates a conspicuous kink.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Current coordinate map.
 * @param {string} atomId - Candidate anchor atom ID.
 * @param {number} baseDistortion - Current anchor distortion cost.
 * @returns {boolean} True when cleanup should reject fan-distorting moves.
 */
function shouldPreserveExactThreeHeavyCarbonFan(layoutGraph, coords, atomId, baseDistortion) {
  const atom = layoutGraph.atoms.get(atomId);
  const hasRingNeighbor = (layoutGraph.bondsByAtomId.get(atomId) ?? []).some(bond => {
    const neighborAtomId = bond.a === atomId ? bond.b : bond.a;
    const neighborAtom = layoutGraph.atoms.get(neighborAtomId);
    return neighborAtom?.element !== 'H' && layoutGraph.ringAtomIdSet.has(neighborAtomId);
  });
  return Boolean(
    atom
    && atom.element === 'C'
    && !atom.aromatic
    && atom.heavyDegree === 3
    && atom.degree === 4
    && layoutGraph.options.suppressH === true
    && !layoutGraph.ringAtomIdSet.has(atomId)
    && hasRingNeighbor
    && baseDistortion <= CLEANUP_EPSILON
  );
}

/**
 * Returns whether local cleanup should preserve an exact visible trigonal fan.
 * Cleanup may still move noisy trigonal centers, but it should not collapse an
 * already exact carbonyl or imine fan into a 90/180/90 split just to win a small
 * local clearance tie-break.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Current coordinate map.
 * @param {string} atomId - Candidate anchor atom ID.
 * @param {number} baseDistortion - Current anchor distortion cost.
 * @returns {boolean} True when cleanup should reject fan-distorting moves.
 */
function shouldPreserveExactTrigonalFan(layoutGraph, coords, atomId, baseDistortion) {
  if (baseDistortion > CLEANUP_EPSILON) {
    return false;
  }
  const atom = layoutGraph.atoms.get(atomId);
  if (!atom || atom.element === 'H' || atom.aromatic) {
    return false;
  }
  const heavyBonds = visibleHeavyCovalentBonds(layoutGraph, coords, atomId);
  if (heavyBonds.length !== 3) {
    return false;
  }
  return heavyBonds.some(({ bond }) => !bond.aromatic && (bond.order ?? 1) >= 2);
}

function isExactTrigonalRingAxisReflectionEligible(layoutGraph, coords, anchorAtomId, rootAtomId, baseDistortion) {
  if (!shouldPreserveExactTrigonalFan(layoutGraph, coords, anchorAtomId, baseDistortion)) {
    return false;
  }
  const bond = layoutGraph.bondByAtomPair.get(atomPairKey(anchorAtomId, rootAtomId));
  if (!bond || bond.kind !== 'covalent' || bond.aromatic || (bond.order ?? 1) !== 1) {
    return false;
  }
  if (!layoutGraph.ringAtomIdSet.has(rootAtomId)) {
    return false;
  }
  const subtreeAtomIds = collectCutSubtree(layoutGraph, rootAtomId, anchorAtomId);
  return subtreeAtomIds.size > 1 && [...subtreeAtomIds].some(atomId => layoutGraph.ringAtomIdSet.has(atomId));
}

/**
 * Returns the distortion penalty for a non-ring three-coordinate hetero center
 * that should still read as roughly trigonal in 2D cleanup.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Current coordinate map.
 * @param {string} atomId - Candidate anchor atom ID.
 * @param {Map<string, {x: number, y: number}>|null} overridePositions - Candidate moved positions.
 * @returns {number} Trigonal hetero-center distortion penalty.
 */
function localTrigonalHeteroDistortionCost(layoutGraph, coords, atomId, overridePositions) {
  const atom = layoutGraph.atoms.get(atomId);
  if (!atom || atom.element === 'H' || atom.element === 'C' || atom.aromatic) {
    return 0;
  }

  const atomPosition = overridePositions?.get(atomId) ?? coords.get(atomId);
  if (!atomPosition) {
    return 0;
  }

  const neighborAngles = [];
  const heavyBonds = [];
  for (const bond of layoutGraph.bondsByAtomId.get(atomId) ?? []) {
    if (bond.kind !== 'covalent' || bond.aromatic || (bond.order ?? 1) !== 1) {
      return 0;
    }
    const neighborAtomId = bond.a === atomId ? bond.b : bond.a;
    const neighborAtom = layoutGraph.atoms.get(neighborAtomId);
    const neighborPosition = overridePositions?.get(neighborAtomId) ?? coords.get(neighborAtomId);
    if (!neighborAtom || neighborAtom.element === 'H' || !neighborPosition) {
      continue;
    }
    heavyBonds.push({ bond, neighborAtomId });
    neighborAngles.push(angleOf(sub(neighborPosition, atomPosition)));
  }

  if (neighborAngles.length !== 3) {
    return 0;
  }

  const incidentRingCount = layoutGraph.ringCountByAtomId.get(atomId) ?? 0;
  if (incidentRingCount > 0 && !shouldPreserveRingTrigonalHeteroFan(layoutGraph, atomId, heavyBonds)) {
    return 0;
  }

  const sortedAngles = [...neighborAngles].sort((firstAngle, secondAngle) => firstAngle - secondAngle);
  let cost = 0;
  for (let index = 0; index < sortedAngles.length; index++) {
    const currentAngle = sortedAngles[index];
    const nextAngle = sortedAngles[(index + 1) % sortedAngles.length];
    const rawGap = nextAngle - currentAngle;
    const separation = rawGap > 0 ? rawGap : rawGap + Math.PI * 2;
    cost += (separation - ((Math.PI * 2) / 3)) ** 2;
  }
  const weight = incidentRingCount > 0
    ? LOCAL_RING_TRIGONAL_HETERO_DISTORTION_WEIGHT
    : LOCAL_TRIGONAL_HETERO_DISTORTION_WEIGHT;
  return cost * weight;
}

/**
 * Applies one rigid subtree rotation into a candidate move buffer.
 * @param {Map<string, {x: number, y: number}>} newPositions - Candidate moved positions.
 * @param {Map<string, {x: number, y: number}>} coords - Current coordinate map.
 * @param {string} rootAtomId - Subtree root atom ID.
 * @param {{x: number, y: number}} nextRootPosition - Candidate root position.
 * @param {number} rotation - Rotation delta in radians.
 * @param {string[]} subtreeAtomIds - Subtree atom IDs.
 * @returns {void}
 */
function appendRotatedSubtreePositions(newPositions, coords, rootAtomId, nextRootPosition, rotation, subtreeAtomIds) {
  newPositions.set(rootAtomId, nextRootPosition);
  const rootPosition = coords.get(rootAtomId);
  if (!rootPosition) {
    return;
  }
  for (const subtreeAtomId of subtreeAtomIds) {
    if (subtreeAtomId === rootAtomId) {
      continue;
    }
    const subtreePosition = coords.get(subtreeAtomId);
    if (!subtreePosition) {
      continue;
    }
    newPositions.set(subtreeAtomId, add(nextRootPosition, rotate(sub(subtreePosition, rootPosition), rotation)));
  }
}

/**
 * Runs a conservative local cleanup pass by rotating leaf atoms around their
 * anchors when doing so lowers the global layout cost.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} inputCoords - Coordinate map.
 * @param {object} [options] - Cleanup options.
 * @param {number} [options.maxPasses] - Maximum cleanup passes.
 * @param {number} [options.epsilon] - Minimum accepted improvement.
 * @param {number} [options.bondLength] - Target bond length.
 * @param {import('../geometry/atom-grid.js').AtomGrid} [options.baseAtomGrid] - Optional reusable base atom grid.
 * @param {Array<{atomId: string, anchorAtomId: string, subtreeAtomIds: string[]}>} [options.baseTerminalSubtrees] - Optional reusable terminal-subtree descriptors.
 * @param {Array<{anchorAtomId: string, firstSubtree: {atomId: string, anchorAtomId: string, subtreeAtomIds: string[]}, secondSubtree: {atomId: string, anchorAtomId: string, subtreeAtomIds: string[]}, subtreeAtomIds: string[]}>} [options.baseSiblingSwaps] - Optional reusable sibling-swap descriptors.
 * @param {Array<{anchorAtomId: string, firstSubtree: {atomId: string, anchorAtomId: string, subtreeAtomIds: string[]}, secondSubtree: {atomId: string, anchorAtomId: string, subtreeAtomIds: string[]}, subtreeAtomIds: string[]}>} [options.baseGeminalPairs] - Optional reusable geminal-subtree descriptors.
 * @param {Array<{firstAtomId: string, secondAtomId: string, distance: number}>} [options.overlapPairs] - Optional current severe overlaps used to focus a one-step probe.
 * @param {Set<string>|null} [options.focusAtomIds] - Optional nearby atom ids used to narrow the local cleanup probe.
 * @param {Set<string>|null} [options.frozenAtomIds] - Atom ids that cleanup must not move.
 * @returns {{coords: Map<string, {x: number, y: number}>, passes: number, improvement: number}} Cleanup result.
 */
export function runLocalCleanup(layoutGraph, inputCoords, options = {}) {
  const maxPasses = options.maxPasses ?? layoutGraph.options.maxCleanupPasses;
  const epsilon = options.epsilon ?? CLEANUP_EPSILON;
  const bondLength = options.bondLength ?? layoutGraph.options.bondLength;
  const coords = new Map([...inputCoords.entries()].map(([atomId, position]) => [atomId, { ...position }]));
  let totalImprovement = 0;
  let passes = 0;
  const rotatableSubtrees =
    options.baseTerminalSubtrees && options.baseGeminalPairs
        ? {
          terminalSubtrees: options.baseTerminalSubtrees,
          siblingSwaps: options.baseSiblingSwaps ?? siblingSwapPairs(layoutGraph, coords, options.baseTerminalSubtrees),
          geminalPairs: options.baseGeminalPairs,
          anchoredRingBlocks: anchoredRingBlockExteriorSpreadDescriptors(layoutGraph, coords),
          spiroSmallRingBlocks: spiroSmallRingExteriorSpreadDescriptors(layoutGraph, coords)
        }
      : computeRotatableSubtrees(layoutGraph, coords);
  const frozenAtomIds = options.frozenAtomIds instanceof Set && options.frozenAtomIds.size > 0 ? options.frozenAtomIds : null;
  const terminalSubtrees =
    frozenAtomIds
      ? rotatableSubtrees.terminalSubtrees.filter(subtree => !containsFrozenAtom(subtree.subtreeAtomIds, frozenAtomIds))
      : rotatableSubtrees.terminalSubtrees;
  const siblingSwaps =
    frozenAtomIds
      ? rotatableSubtrees.siblingSwaps.filter(pair => !containsFrozenAtom(pair.subtreeAtomIds, frozenAtomIds))
      : rotatableSubtrees.siblingSwaps;
  const geminalPairs =
    frozenAtomIds
      ? rotatableSubtrees.geminalPairs.filter(pair => !containsFrozenAtom(pair.subtreeAtomIds, frozenAtomIds))
      : rotatableSubtrees.geminalPairs;
  const anchoredRingBlocks =
    frozenAtomIds
      ? (rotatableSubtrees.anchoredRingBlocks ?? []).filter(descriptor => !containsFrozenAtom(descriptor.subtreeAtomIds, frozenAtomIds))
      : (rotatableSubtrees.anchoredRingBlocks ?? []);
  const spiroSmallRingBlocks =
    frozenAtomIds
      ? (rotatableSubtrees.spiroSmallRingBlocks ?? []).filter(descriptor => !containsFrozenAtom(descriptor.subtreeAtomIds, frozenAtomIds))
      : (rotatableSubtrees.spiroSmallRingBlocks ?? []);
  const overlapEligibleDescriptors = filterDescriptorsByOverlap(layoutGraph, {
    terminalSubtrees,
    siblingSwaps,
    geminalPairs,
    anchoredRingBlocks,
    spiroSmallRingBlocks
  }, options.overlapPairs);
  const eligibleDescriptors = filterDescriptorsByFocus(overlapEligibleDescriptors, options.focusAtomIds);
  const atomGrid = options.baseAtomGrid?.clone() ?? buildAtomGrid(layoutGraph, coords, bondLength);
  const includeLocalTrigonalHeteroDistortion = coords.size <= MAX_LOCAL_TRIGONAL_HETERO_LAYOUT_ATOMS;
  const scoreAnchorDistortion = includeLocalTrigonalHeteroDistortion
    ? (atomId, overridePositions) => {
        return computeAtomDistortionCost(layoutGraph, coords, atomId, overridePositions)
          + localTrigonalHeteroDistortionCost(layoutGraph, coords, atomId, overridePositions);
      }
    : (atomId, overridePositions) => computeAtomDistortionCost(layoutGraph, coords, atomId, overridePositions);

  while (passes < maxPasses) {
    passes++;
    let bestMove = null;
    const inwardFlipTolerance = bondLength * bondLength * 0.02;

    for (const subtree of eligibleDescriptors.terminalSubtrees) {
      const { atomId, anchorAtomId, subtreeAtomIds } = subtree;
      const anchorPosition = coords.get(anchorAtomId);
      const rootPosition = coords.get(atomId);
      if (!anchorPosition || !rootPosition) {
        continue;
      }
      const currentAngle = angleOf(sub(rootPosition, anchorPosition));
      const currentRadius = Math.hypot(rootPosition.x - anchorPosition.x, rootPosition.y - anchorPosition.y) || bondLength;
      const subtreeContext = buildSubtreeOverlapContext(layoutGraph, subtreeAtomIds, {
        includeBondCrowding: true
      });
      const baseAtomOverlapCost = computeSubtreeOverlapCost(layoutGraph, coords, subtreeAtomIds, null, bondLength, {
        atomGrid,
        subtreeContext
      });
      const baseAnchorDistortion = scoreAnchorDistortion(anchorAtomId, null);
      const preserveExactThreeHeavyCarbonFan = shouldPreserveExactThreeHeavyCarbonFan(layoutGraph, coords, anchorAtomId, baseAnchorDistortion);
      const preserveExactTrigonalFan = shouldPreserveExactTrigonalFan(layoutGraph, coords, anchorAtomId, baseAnchorDistortion);
      const preserveExactDivalentContinuation =
        shouldPreserveExactDivalentContinuation(layoutGraph, coords, anchorAtomId, atomId);
      const preserveExactRingRootFan =
        ringRootFanDistortionCost(layoutGraph, coords, anchorAtomId, null) <= CLEANUP_EPSILON;
      const preserveExactHypervalentFan =
        hypervalentCrossFanDistortionCost(layoutGraph, coords, anchorAtomId, null) <= CLEANUP_EPSILON;
      const finalists = [];
      if (
        isBranchedSaturatedRingAxisReflectionEligible(layoutGraph, coords, anchorAtomId, atomId)
        || isExactTrigonalRingAxisReflectionEligible(layoutGraph, coords, anchorAtomId, atomId, baseAnchorDistortion)
        || subtree.exactTrigonalRingBranchAxisReflection === true
      ) {
        const newPositions = new Map();
        for (const subtreeAtomId of subtreeAtomIds) {
          const subtreePosition = coords.get(subtreeAtomId);
          if (!subtreePosition) {
            continue;
          }
          newPositions.set(subtreeAtomId, reflectAcrossLine(subtreePosition, anchorPosition, rootPosition));
        }
        if (newPositions.size === subtreeAtomIds.length) {
          const newAtomOverlapCost = computeSubtreeOverlapCost(layoutGraph, coords, subtreeAtomIds, newPositions, bondLength, {
            atomGrid,
            subtreeContext
          });
          if (
            !(
              preserveExactRingRootFan
              && ringRootFanDistortionCost(layoutGraph, coords, anchorAtomId, newPositions) > CLEANUP_EPSILON
            )
            && !((preserveExactThreeHeavyCarbonFan || preserveExactTrigonalFan) && scoreAnchorDistortion(anchorAtomId, newPositions) > CLEANUP_EPSILON)
            && !(preserveExactDivalentContinuation && !preservesExactDivalentContinuation(layoutGraph, coords, anchorAtomId, atomId, newPositions))
            && !(preserveExactHypervalentFan && hypervalentCrossFanDistortionCost(layoutGraph, coords, anchorAtomId, newPositions) > CLEANUP_EPSILON)
            && !(
              subtree.exactTrigonalRingBranchAxisReflection === true
              && computeAtomDistortionCost(layoutGraph, coords, atomId, newPositions) > CLEANUP_EPSILON
            )
          ) {
            const newAnchorDistortion = scoreAnchorDistortion(anchorAtomId, newPositions);
            const approximateImprovement = baseAtomOverlapCost - newAtomOverlapCost + (baseAnchorDistortion - newAnchorDistortion);
            recordFinalist(finalists, {
              positions: newPositions,
              approximateImprovement,
              atomOverlapCost: newAtomOverlapCost,
              anchorDistortion: newAnchorDistortion
            });
          }
        }
      }
      if (subtree.exactTrigonalRingBranchAxisReflection === true) {
        const refinedMove = finalizeBestMove(layoutGraph, coords, subtreeAtomIds, finalists, bondLength, subtreeContext, epsilon, {
          preferAtomOverlapCost: true
        });
        if (refinedMove && isBetterLocalMove(bestMove, refinedMove, epsilon)) {
          bestMove = refinedMove;
        }
        continue;
      }
      forEachRigidRotationCandidate(layoutGraph, coords, {
        anchorAtomId,
        rootAtomId: atomId,
        subtreeAtomIds
      }, {
        angles: preferredRotationAngles(layoutGraph, coords, anchorAtomId, atomId),
        buildPositionsFn(_coords, descriptor, angle) {
          const rotatedRoot = add(anchorPosition, fromAngle(angle, currentRadius));
          const rotation = angle - currentAngle;
          if (flipsRingSubstituentInward(layoutGraph, coords, anchorAtomId, rootPosition, rotatedRoot, inwardFlipTolerance)) {
            return null;
          }
          const newPositions = new Map();
          appendRotatedSubtreePositions(newPositions, coords, descriptor.rootAtomId, rotatedRoot, rotation, descriptor.subtreeAtomIds);
          return newPositions;
        },
        visitCandidate(newPositions) {
          const newAtomOverlapCost = computeSubtreeOverlapCost(layoutGraph, coords, subtreeAtomIds, newPositions, bondLength, {
            atomGrid,
            subtreeContext
          });
          if (
            preserveExactRingRootFan
            && ringRootFanDistortionCost(layoutGraph, coords, anchorAtomId, newPositions) > CLEANUP_EPSILON
          ) {
            return;
          }
          if (preserveExactThreeHeavyCarbonFan && scoreAnchorDistortion(anchorAtomId, newPositions) > CLEANUP_EPSILON) {
            return;
          }
          if (preserveExactTrigonalFan && scoreAnchorDistortion(anchorAtomId, newPositions) > CLEANUP_EPSILON) {
            return;
          }
          if (
            preserveExactDivalentContinuation
            && !preservesExactDivalentContinuation(layoutGraph, coords, anchorAtomId, atomId, newPositions)
          ) {
            return;
          }
          if (preserveExactHypervalentFan && hypervalentCrossFanDistortionCost(layoutGraph, coords, anchorAtomId, newPositions) > CLEANUP_EPSILON) {
            return;
          }
          const newAnchorDistortion = scoreAnchorDistortion(anchorAtomId, newPositions);
          const approximateImprovement = baseAtomOverlapCost - newAtomOverlapCost + (baseAnchorDistortion - newAnchorDistortion);
          recordFinalist(finalists, {
            positions: newPositions,
            approximateImprovement,
            atomOverlapCost: newAtomOverlapCost,
            anchorDistortion: newAnchorDistortion
          });
        }
      });

      const refinedMove = finalizeBestMove(layoutGraph, coords, subtreeAtomIds, finalists, bondLength, subtreeContext, epsilon, {
        preferAtomOverlapCost: subtree.preferAtomOverlapClearance === true
      });
      if (refinedMove && isBetterLocalMove(bestMove, refinedMove, epsilon)) {
        bestMove = refinedMove;
      }
    }

    for (const { anchorAtomId, firstSubtree, secondSubtree, subtreeAtomIds } of eligibleDescriptors.siblingSwaps) {
      const anchorPosition = coords.get(anchorAtomId);
      const firstRootPosition = coords.get(firstSubtree.atomId);
      const secondRootPosition = coords.get(secondSubtree.atomId);
      if (!anchorPosition || !firstRootPosition || !secondRootPosition) {
        continue;
      }

      const subtreeContext = buildSubtreeOverlapContext(layoutGraph, subtreeAtomIds, {
        includeBondCrowding: true
      });
      const baseAtomOverlapCost = computeSubtreeOverlapCost(layoutGraph, coords, subtreeAtomIds, null, bondLength, {
        atomGrid,
        subtreeContext
      });
      const baseAnchorDistortion = scoreAnchorDistortion(anchorAtomId, null);
      const preserveExactHypervalentFan =
        hypervalentCrossFanDistortionCost(layoutGraph, coords, anchorAtomId, null) <= CLEANUP_EPSILON;
      if (
        flipsRingSubstituentInward(layoutGraph, coords, anchorAtomId, firstRootPosition, secondRootPosition, inwardFlipTolerance)
        || flipsRingSubstituentInward(layoutGraph, coords, anchorAtomId, secondRootPosition, firstRootPosition, inwardFlipTolerance)
      ) {
        continue;
      }

      const firstRotation = angleOf(sub(secondRootPosition, anchorPosition)) - angleOf(sub(firstRootPosition, anchorPosition));
      const secondRotation = angleOf(sub(firstRootPosition, anchorPosition)) - angleOf(sub(secondRootPosition, anchorPosition));
      const newPositions = new Map();
      appendRotatedSubtreePositions(newPositions, coords, firstSubtree.atomId, secondRootPosition, firstRotation, firstSubtree.subtreeAtomIds);
      appendRotatedSubtreePositions(newPositions, coords, secondSubtree.atomId, firstRootPosition, secondRotation, secondSubtree.subtreeAtomIds);

      const newAtomOverlapCost = computeSubtreeOverlapCost(layoutGraph, coords, subtreeAtomIds, newPositions, bondLength, {
        atomGrid,
        subtreeContext
      });
      const newAnchorDistortion = scoreAnchorDistortion(anchorAtomId, newPositions);
      if (
        shouldPreserveExactThreeHeavyCarbonFan(layoutGraph, coords, anchorAtomId, baseAnchorDistortion)
        && newAnchorDistortion > CLEANUP_EPSILON
      ) {
        continue;
      }
      if (
        shouldPreserveExactTrigonalFan(layoutGraph, coords, anchorAtomId, baseAnchorDistortion)
        && newAnchorDistortion > CLEANUP_EPSILON
      ) {
        continue;
      }
      if (
        preserveExactHypervalentFan
        && hypervalentCrossFanDistortionCost(layoutGraph, coords, anchorAtomId, newPositions) > CLEANUP_EPSILON
      ) {
        continue;
      }
      const approximateImprovement = baseAtomOverlapCost - newAtomOverlapCost + (baseAnchorDistortion - newAnchorDistortion);
      const refinedMove = finalizeBestMove(layoutGraph, coords, subtreeAtomIds, [{
        positions: newPositions,
        approximateImprovement,
        atomOverlapCost: newAtomOverlapCost,
        anchorDistortion: newAnchorDistortion
      }], bondLength, subtreeContext, epsilon);
      if (refinedMove && isBetterLocalMove(bestMove, refinedMove, epsilon)) {
        bestMove = refinedMove;
      }
    }

    for (const { anchorAtomId, firstSubtree, secondSubtree, subtreeAtomIds } of eligibleDescriptors.geminalPairs) {
      const anchorPosition = coords.get(anchorAtomId);
      const firstRootPosition = coords.get(firstSubtree.atomId);
      const secondRootPosition = coords.get(secondSubtree.atomId);
      if (!anchorPosition || !firstRootPosition || !secondRootPosition) {
        continue;
      }

      const firstCurrentAngle = angleOf(sub(firstRootPosition, anchorPosition));
      const firstCurrentRadius = Math.hypot(firstRootPosition.x - anchorPosition.x, firstRootPosition.y - anchorPosition.y) || bondLength;
      const secondCurrentRadius = Math.hypot(secondRootPosition.x - anchorPosition.x, secondRootPosition.y - anchorPosition.y) || bondLength;
      const subtreeContext = buildSubtreeOverlapContext(layoutGraph, subtreeAtomIds, {
        includeBondCrowding: true
      });
      const baseAtomOverlapCost = computeSubtreeOverlapCost(layoutGraph, coords, subtreeAtomIds, null, bondLength, {
        atomGrid,
        subtreeContext
      });
      const baseAnchorDistortion = scoreAnchorDistortion(anchorAtomId, null);
      const preserveExactTrigonalFan = shouldPreserveExactTrigonalFan(layoutGraph, coords, anchorAtomId, baseAnchorDistortion);
      const preserveExactHypervalentFan =
        hypervalentCrossFanDistortionCost(layoutGraph, coords, anchorAtomId, null) <= CLEANUP_EPSILON;
      const finalists = [];

      for (const angle of FINE_ROTATION_ANGLES) {
        const rotation = angle - firstCurrentAngle;
        const rotatedFirstRoot = add(anchorPosition, fromAngle(angle, firstCurrentRadius));
        const rotatedSecondRoot = add(anchorPosition, fromAngle(angleOf(sub(secondRootPosition, anchorPosition)) + rotation, secondCurrentRadius));
        if (
          flipsRingSubstituentInward(layoutGraph, coords, anchorAtomId, firstRootPosition, rotatedFirstRoot, inwardFlipTolerance) ||
          flipsRingSubstituentInward(layoutGraph, coords, anchorAtomId, secondRootPosition, rotatedSecondRoot, inwardFlipTolerance)
        ) {
          continue;
        }

        const newPositions = new Map();
        appendRotatedSubtreePositions(newPositions, coords, firstSubtree.atomId, rotatedFirstRoot, rotation, firstSubtree.subtreeAtomIds);
        appendRotatedSubtreePositions(newPositions, coords, secondSubtree.atomId, rotatedSecondRoot, rotation, secondSubtree.subtreeAtomIds);

        const newAtomOverlapCost = computeSubtreeOverlapCost(layoutGraph, coords, subtreeAtomIds, newPositions, bondLength, {
          atomGrid,
          subtreeContext
        });
        const newAnchorDistortion = scoreAnchorDistortion(anchorAtomId, newPositions);
        if (
          shouldPreserveExactThreeHeavyCarbonFan(layoutGraph, coords, anchorAtomId, baseAnchorDistortion)
          && newAnchorDistortion > CLEANUP_EPSILON
        ) {
          continue;
        }
        if (preserveExactTrigonalFan && newAnchorDistortion > CLEANUP_EPSILON) {
          continue;
        }
        if (
          preserveExactHypervalentFan
          && hypervalentCrossFanDistortionCost(layoutGraph, coords, anchorAtomId, newPositions) > CLEANUP_EPSILON
        ) {
          continue;
        }
        const approximateImprovement = baseAtomOverlapCost - newAtomOverlapCost + (baseAnchorDistortion - newAnchorDistortion);
        recordFinalist(finalists, {
          positions: newPositions,
          approximateImprovement,
          atomOverlapCost: newAtomOverlapCost,
          anchorDistortion: newAnchorDistortion
        });
      }

      const refinedMove = finalizeBestMove(layoutGraph, coords, subtreeAtomIds, finalists, bondLength, subtreeContext, epsilon);
      if (refinedMove && isBetterLocalMove(bestMove, refinedMove, epsilon)) {
        bestMove = refinedMove;
      }
    }

    for (const descriptor of eligibleDescriptors.anchoredRingBlocks) {
      const { anchorAtomId, subtreeAtomIds } = descriptor;
      const anchorPosition = coords.get(anchorAtomId);
      if (!anchorPosition) {
        continue;
      }
      const baseExteriorPenalty = measureSmallRingExteriorGapSpreadPenalty(layoutGraph, coords, anchorAtomId);
      if (baseExteriorPenalty <= epsilon) {
        continue;
      }

      const subtreeContext = buildSubtreeOverlapContext(layoutGraph, subtreeAtomIds, {
        includeBondCrowding: true
      });
      const baseAtomOverlapCost = computeSubtreeOverlapCost(layoutGraph, coords, subtreeAtomIds, null, bondLength, {
        atomGrid,
        subtreeContext
      });
      const baseAnchorDistortion = scoreAnchorDistortion(anchorAtomId, null);
      const finalists = [];

      for (const rotation of anchoredRingBlockExteriorSpreadRotations(layoutGraph, coords, descriptor)) {
        const newPositions = new Map();
        for (const atomId of subtreeAtomIds) {
          const position = coords.get(atomId);
          if (!position) {
            continue;
          }
          newPositions.set(atomId, add(anchorPosition, rotate(sub(position, anchorPosition), rotation)));
        }
        if (newPositions.size !== subtreeAtomIds.length) {
          continue;
        }
        const candidateCoords = new Map(coords);
        for (const [atomId, position] of newPositions) {
          candidateCoords.set(atomId, position);
        }
        const candidateExteriorPenalty = measureSmallRingExteriorGapSpreadPenalty(layoutGraph, candidateCoords, anchorAtomId);
        if (candidateExteriorPenalty >= baseExteriorPenalty - epsilon) {
          continue;
        }

        const newAtomOverlapCost = computeSubtreeOverlapCost(layoutGraph, coords, subtreeAtomIds, newPositions, bondLength, {
          atomGrid,
          subtreeContext
        });
        const newAnchorDistortion = scoreAnchorDistortion(anchorAtomId, newPositions);
        const approximateImprovement =
          baseAtomOverlapCost - newAtomOverlapCost
          + (baseAnchorDistortion - newAnchorDistortion)
          + (baseExteriorPenalty - candidateExteriorPenalty) * ANCHORED_RING_EXTERIOR_SPREAD_WEIGHT;
        recordFinalist(finalists, {
          positions: newPositions,
          approximateImprovement,
          atomOverlapCost: newAtomOverlapCost,
          anchorDistortion: newAnchorDistortion
        });
      }

      const refinedMove = finalizeBestMove(layoutGraph, coords, subtreeAtomIds, finalists, bondLength, subtreeContext, epsilon);
      if (refinedMove && isBetterLocalMove(bestMove, refinedMove, epsilon)) {
        bestMove = refinedMove;
      }
    }

    for (const descriptor of eligibleDescriptors.spiroSmallRingBlocks ?? []) {
      const { anchorAtomId, subtreeAtomIds } = descriptor;
      const anchorPosition = coords.get(anchorAtomId);
      if (!anchorPosition) {
        continue;
      }
      const baseExteriorPenalty = measureSpiroSmallRingExteriorPenalty(coords, descriptor);
      if (baseExteriorPenalty <= epsilon || !Number.isFinite(baseExteriorPenalty)) {
        continue;
      }

      const subtreeContext = buildSubtreeOverlapContext(layoutGraph, subtreeAtomIds, {
        includeBondCrowding: true
      });
      const baseAtomOverlapCost = computeSubtreeOverlapCost(layoutGraph, coords, subtreeAtomIds, null, bondLength, {
        atomGrid,
        subtreeContext
      });
      const baseAnchorDistortion = scoreAnchorDistortion(anchorAtomId, null);
      const finalists = [];

      for (const rotation of spiroSmallRingExteriorSpreadRotations(coords, descriptor)) {
        const newPositions = new Map();
        for (const atomId of subtreeAtomIds) {
          const position = coords.get(atomId);
          if (!position) {
            continue;
          }
          newPositions.set(atomId, add(anchorPosition, rotate(sub(position, anchorPosition), rotation)));
        }
        if (newPositions.size !== subtreeAtomIds.length) {
          continue;
        }

        const candidateCoords = new Map(coords);
        for (const [atomId, position] of newPositions) {
          candidateCoords.set(atomId, position);
        }
        const candidateExteriorPenalty = measureSpiroSmallRingExteriorPenalty(candidateCoords, descriptor);
        if (candidateExteriorPenalty >= baseExteriorPenalty - epsilon) {
          continue;
        }

        const newAtomOverlapCost = computeSubtreeOverlapCost(layoutGraph, coords, subtreeAtomIds, newPositions, bondLength, {
          atomGrid,
          subtreeContext
        });
        if (newAtomOverlapCost > baseAtomOverlapCost + epsilon) {
          continue;
        }

        const newAnchorDistortion = scoreAnchorDistortion(anchorAtomId, newPositions);
        const approximateImprovement =
          baseAtomOverlapCost - newAtomOverlapCost
          + (baseAnchorDistortion - newAnchorDistortion)
          + (baseExteriorPenalty - candidateExteriorPenalty) * SPIRO_SMALL_RING_EXTERIOR_SPREAD_WEIGHT;
        recordFinalist(finalists, {
          positions: newPositions,
          approximateImprovement,
          atomOverlapCost: newAtomOverlapCost,
          anchorDistortion: newAnchorDistortion
        });
      }

      const refinedMove = finalizeBestMove(layoutGraph, coords, subtreeAtomIds, finalists, bondLength, subtreeContext, epsilon);
      if (refinedMove && isBetterLocalMove(bestMove, refinedMove, epsilon)) {
        bestMove = refinedMove;
      }
    }

    if (!bestMove) {
      passes--;
      break;
    }

    updateAtomGridForMove(layoutGraph, atomGrid, coords, bestMove.positions);
    for (const [atomId, position] of bestMove.positions) {
      coords.set(atomId, position);
    }
    totalImprovement += bestMove.improvement;
  }

  return {
    coords,
    passes,
    improvement: totalImprovement
  };
}

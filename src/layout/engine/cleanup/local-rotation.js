/** @module cleanup/local-rotation */

import { CLEANUP_EPSILON, DISTANCE_EPSILON } from '../constants.js';
import { add, angleOf, angularDifference, centroid, fromAngle, rotate, sub } from '../geometry/vec2.js';
import { pointInPolygon } from '../geometry/polygon.js';
import { buildAtomGrid, buildSubtreeOverlapContext, computeAtomDistortionCost, computeSubtreeOverlapCost } from '../audit/invariants.js';
import { containsFrozenAtom } from './frozen-atoms.js';
import { forEachRigidRotationCandidate } from './rigid-rotation.js';
import { collectCutSubtree } from './subtree-utils.js';

const DISCRETE_ROTATION_ANGLES = Object.freeze([
  0,
  Math.PI / 12,
  -Math.PI / 12,
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
const LOCAL_TRIGONAL_HETERO_DISTORTION_WEIGHT = 5;
const MAX_SIBLING_SWAP_SUBTREE_ATOMS = 18;
const MAX_LOCAL_TRIGONAL_HETERO_LAYOUT_ATOMS = 48;
const MAX_SIBLING_SWAP_LAYOUT_ATOMS = 48;
const LOCAL_ROTATION_BOND_CROWDING_FINALISTS = 2;
const EXACT_ROTATION_ANGLE_EPSILON = 1e-6;
const IDEAL_LEAF_LINEAR_NEIGHBOR_TOLERANCE = Math.PI / 12;
const IDEAL_DIVALENT_CONTINUATION_ELEMENTS = new Set(['C', 'O', 'S', 'Se']);

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
  const pairKey = firstAtomId < secondAtomId ? `${firstAtomId}:${secondAtomId}` : `${secondAtomId}:${firstAtomId}`;
  const bond = layoutGraph.bondByAtomPair.get(pairKey);
  if (!bond || bond.kind !== 'covalent' || bond.inRing || bond.aromatic || (bond.order ?? 1) !== 1) {
    return null;
  }
  return bond;
}

function terminalMultipleBondLeafBond(layoutGraph, anchorAtomId, rootAtomId) {
  const pairKey = anchorAtomId < rootAtomId ? `${anchorAtomId}:${rootAtomId}` : `${rootAtomId}:${anchorAtomId}`;
  const bond = layoutGraph.bondByAtomPair.get(pairKey);
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
    || !IDEAL_DIVALENT_CONTINUATION_ELEMENTS.has(anchorAtom.element)
    || (layoutGraph.atomToRings.get(anchorAtomId)?.length ?? 0) > 0
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
  if (!parentBond || !parentAtomId || !parentAtom || !parentPosition || parentBond.aromatic || (parentBond.order ?? 1) !== 1) {
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
  for (const angle of DISCRETE_ROTATION_ANGLES) {
    if (candidateAngles.some(existingAngle => angularDifference(existingAngle, angle) <= EXACT_ROTATION_ANGLE_EPSILON)) {
      continue;
    }
    candidateAngles.push(angle);
  }
  return candidateAngles;
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
  if ((layoutGraph.atomToRings.get(atomId)?.length ?? 0) > 0 || heavyNeighborIds.length !== 2) {
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
      || (layoutGraph.atomToRings.get(terminalLeafAtomId)?.length ?? 0) > 0
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
    && (layoutGraph.atomToRings.get(atomId)?.length ?? 0) === 0;
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
    || (layoutGraph.atomToRings.get(atomId)?.length ?? 0) > 0
  ) {
    return null;
  }

  let terminalMultipleNeighborId = null;
  const singleNeighborIds = [];
  for (const neighborAtomId of heavyNeighborIds) {
    const pairKey = atomId < neighborAtomId ? `${atomId}:${neighborAtomId}` : `${neighborAtomId}:${atomId}`;
    const bond = layoutGraph.bondByAtomPair.get(pairKey);
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

  const terminalSingleNeighborIds = singleNeighborIds.filter(neighborAtomId => isTerminalHeavyLeaf(layoutGraph, neighborAtomId));
  const anchorNeighborIds = singleNeighborIds.filter(neighborAtomId => !isTerminalHeavyLeaf(layoutGraph, neighborAtomId));
  if (terminalSingleNeighborIds.length !== 1 || anchorNeighborIds.length !== 1) {
    return null;
  }

  return { anchorAtomId: anchorNeighborIds[0] };
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
    const pairKey = atomId < anchorAtomId ? `${atomId}:${anchorAtomId}` : `${anchorAtomId}:${atomId}`;
    const bond = layoutGraph.bondByAtomPair.get(pairKey);
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
      const pairKey = atomId < candidateNeighborAtomId ? `${atomId}:${candidateNeighborAtomId}` : `${candidateNeighborAtomId}:${atomId}`;
      const bond = layoutGraph.bondByAtomPair.get(pairKey);
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
  const subtreesByAnchor = new Map();
  for (const subtree of terminalSubtrees) {
    const anchorSubtrees = subtreesByAnchor.get(subtree.anchorAtomId) ?? [];
    anchorSubtrees.push(subtree);
    subtreesByAnchor.set(subtree.anchorAtomId, anchorSubtrees);
  }

  const pairs = [];
  for (const [anchorAtomId, anchorSubtrees] of subtreesByAnchor) {
    const anchorAtom = layoutGraph.atoms.get(anchorAtomId);
    if (!anchorAtom || anchorAtom.element === 'H' || anchorAtom.heavyDegree < 4) {
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
 * @returns {{terminalSubtrees: Array<{atomId: string, anchorAtomId: string, subtreeAtomIds: string[]}>, siblingSwaps: Array<{anchorAtomId: string, firstSubtree: {atomId: string, anchorAtomId: string, subtreeAtomIds: string[]}, secondSubtree: {atomId: string, anchorAtomId: string, subtreeAtomIds: string[]}, subtreeAtomIds: string[]}>, geminalPairs: Array<{anchorAtomId: string, firstSubtree: {atomId: string, anchorAtomId: string, subtreeAtomIds: string[]}, secondSubtree: {atomId: string, anchorAtomId: string, subtreeAtomIds: string[]}, subtreeAtomIds: string[]}>}} Reusable local-rotation descriptors.
 */
export function computeRotatableSubtrees(layoutGraph, coords) {
  const terminalSubtrees = movableTerminalSubtrees(layoutGraph, coords);
  return {
    terminalSubtrees,
    siblingSwaps: siblingSwapPairs(layoutGraph, coords, terminalSubtrees),
    geminalPairs: geminalSubtreePairs(terminalSubtrees)
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
 * @param {{terminalSubtrees: Array<object>, siblingSwaps: Array<object>, geminalPairs: Array<object>}} descriptors - Reusable rotation descriptors.
 * @param {Array<{firstAtomId: string, secondAtomId: string}>|null|undefined} overlapPairs - Severe overlaps from the current coordinates.
 * @returns {{terminalSubtrees: Array<object>, siblingSwaps: Array<object>, geminalPairs: Array<object>}} Filtered descriptors.
 */
function filterDescriptorsByOverlap(layoutGraph, descriptors, overlapPairs) {
  if (!Array.isArray(overlapPairs) || overlapPairs.length === 0) {
    return descriptors;
  }
  const relevantAtomIds = overlapRelevantAtomIds(layoutGraph, overlapPairs);
  return {
    terminalSubtrees: descriptors.terminalSubtrees.filter(descriptor => descriptorTouchesRelevantAtoms(descriptor, relevantAtomIds)),
    siblingSwaps: descriptors.siblingSwaps.filter(descriptor => descriptorTouchesRelevantAtoms(descriptor, relevantAtomIds)),
    geminalPairs: descriptors.geminalPairs.filter(descriptor => descriptorTouchesRelevantAtoms(descriptor, relevantAtomIds))
  };
}

function filterDescriptorsByFocus(descriptors, focusAtomIds) {
  if (!(focusAtomIds instanceof Set) || focusAtomIds.size === 0) {
    return descriptors;
  }
  return {
    terminalSubtrees: descriptors.terminalSubtrees.filter(descriptor => descriptorTouchesRelevantAtoms(descriptor, focusAtomIds)),
    siblingSwaps: descriptors.siblingSwaps.filter(descriptor => descriptorTouchesRelevantAtoms(descriptor, focusAtomIds)),
    geminalPairs: descriptors.geminalPairs.filter(descriptor => descriptorTouchesRelevantAtoms(descriptor, focusAtomIds))
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
  if ((layoutGraph.atomToRings.get(atomId)?.length ?? 0) > 0) {
    return 0;
  }

  const atomPosition = overridePositions?.get(atomId) ?? coords.get(atomId);
  if (!atomPosition) {
    return 0;
  }

  const neighborAngles = [];
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
    neighborAngles.push(angleOf(sub(neighborPosition, atomPosition)));
  }

  if (neighborAngles.length !== 3) {
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
  return cost * LOCAL_TRIGONAL_HETERO_DISTORTION_WEIGHT;
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
          geminalPairs: options.baseGeminalPairs
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
  const overlapEligibleDescriptors = filterDescriptorsByOverlap(layoutGraph, {
    terminalSubtrees,
    siblingSwaps,
    geminalPairs
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
      const finalists = [];
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
      const finalists = [];

      for (const angle of DISCRETE_ROTATION_ANGLES) {
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

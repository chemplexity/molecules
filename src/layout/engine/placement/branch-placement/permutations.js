/** @module placement/branch-placement/permutations */

import { angleOf, angularDifference, sub } from '../../geometry/vec2.js';
import { buildAtomGrid, measureFocusedPlacementCost, measureLayoutCost } from '../../audit/invariants.js';
import { compareCanonicalAtomIds } from '../../topology/canonical-order.js';
import {
  ARRANGEMENT_IDEAL_GEOMETRY_WEIGHT,
  BRANCH_COMPLEXITY_LIMITS,
  DEG120,
  MAX_BRANCH_RECURSION_DEPTH,
  SMALL_RING_EXTERIOR_GAP_WEIGHT,
  clonePlacementState,
  copyPlacementState,
  isRingAnchor,
  setPlacedPosition,
  subtreeHeavyAtomCount
} from './shared.js';
import {
  buildCandidateAngleSets,
  describeCrossLikeHypervalentCenter,
  isLinearCenter,
  isTerminalMultipleBondLeaf,
  measureSmallRingExteriorGapSpreadPenalty,
  supportsProjectedTetrahedralGeometry
} from './angle-selection.js';

const INDEX_PERMUTATIONS_2 = Object.freeze([[0, 1], [1, 0]]);
const INDEX_PERMUTATIONS_3 = Object.freeze([
  [0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]
]);

const ORTHOGONAL_SLOT_OFFSETS = [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2];
const ARRANGEMENT_COST_TIE_EPSILON = 1e-12;
const TRIGONAL_BRANCH_CLEARANCE_ASSIGNMENT_WEIGHT = 0.25;
const ORTHOGONAL_SLOT_PERMUTATIONS = [
  [0, 1, 2, 3],
  [0, 1, 3, 2],
  [0, 2, 1, 3],
  [0, 2, 3, 1],
  [0, 3, 1, 2],
  [0, 3, 2, 1],
  [1, 0, 2, 3],
  [1, 0, 3, 2],
  [1, 2, 0, 3],
  [1, 2, 3, 0],
  [1, 3, 0, 2],
  [1, 3, 2, 0],
  [2, 0, 1, 3],
  [2, 0, 3, 1],
  [2, 1, 0, 3],
  [2, 1, 3, 0],
  [2, 3, 0, 1],
  [2, 3, 1, 0],
  [3, 0, 1, 2],
  [3, 0, 2, 1],
  [3, 1, 0, 2],
  [3, 1, 2, 0],
  [3, 2, 0, 1],
  [3, 2, 1, 0]
];

function bisOxoOrthogonalSlotPermutations() {
  const permutations = [];
  for (const singlePair of [[0, 2], [1, 3]]) {
    const multiplePair = ORTHOGONAL_SLOT_OFFSETS
      .map((_, slotIndex) => slotIndex)
      .filter(slotIndex => !singlePair.includes(slotIndex));
    for (const singleOrder of [[singlePair[0], singlePair[1]], [singlePair[1], singlePair[0]]]) {
      for (const multipleOrder of [[multiplePair[0], multiplePair[1]], [multiplePair[1], multiplePair[0]]]) {
        permutations.push([...singleOrder, ...multipleOrder]);
      }
    }
  }
  return permutations;
}

function orthogonalSlotPermutations(descriptor) {
  return descriptor?.kind === 'bis-oxo'
    ? bisOxoOrthogonalSlotPermutations()
    : ORTHOGONAL_SLOT_PERMUTATIONS;
}

/**
 * Returns whether a projected-tetrahedral leaf batch is small enough to score
 * exhaustively even when the surrounding acyclic component is large. Keeping
 * these equivalent terminal siblings together prevents greedy one-at-a-time
 * placement from reusing a filled orthogonal slot.
 * @param {object|null} layoutGraph - Layout graph shell.
 * @param {string} anchorAtomId - Center atom ID being evaluated.
 * @param {string[]} primaryNeighborIds - Child atom IDs awaiting placement.
 * @param {Array<{childAtomId: string, subtreeSize: number}>} childDescriptors - Child subtree descriptors.
 * @returns {boolean} True when the local leaf batch should bypass greedy placement.
 */
function isSmallProjectedTetrahedralLeafBatch(layoutGraph, anchorAtomId, primaryNeighborIds, childDescriptors) {
  if (
    primaryNeighborIds.length < 2
    || primaryNeighborIds.length > 3
    || !supportsProjectedTetrahedralGeometry(layoutGraph, anchorAtomId)
  ) {
    return false;
  }

  return primaryNeighborIds.every(childAtomId => {
    const atom = layoutGraph?.atoms.get(childAtomId);
    const descriptor = childDescriptors.find(candidate => candidate.childAtomId === childAtomId);
    return !!atom && atom.element !== 'H' && atom.heavyDegree === 1 && (descriptor?.subtreeSize ?? 0) <= 1;
  });
}

/**
 * Returns whether a branch center should skip exhaustive sibling backtracking.
 * Large mixed/acyclic slices can explode combinatorially when every backbone
 * center tries to recursively score whole-subtree permutations.
 * @param {object|null} layoutGraph - Layout graph shell.
 * @param {Set<string>} atomIdsToPlace - Slice participant IDs.
 * @param {string} anchorAtomId - Center atom ID being evaluated.
 * @param {string[]} primaryNeighborIds - Heavy neighbors awaiting placement.
 * @param {Array<{childAtomId: string, subtreeSize: number}>} [childDescriptors] - Child subtree descriptors.
 * @param {{angularBudgets?: Map<string, {centerAngle: number, minOffset: number, maxOffset: number, preferredAngle: number}>}|null} [branchConstraints] - Optional branch-angle constraints.
 * @returns {boolean} True when greedy sibling placement is safer.
 */
export function shouldUseGreedyBranchPlacement(layoutGraph, atomIdsToPlace, anchorAtomId, primaryNeighborIds, childDescriptors = [], branchConstraints = null) {
  if (primaryNeighborIds.length < 2) {
    return true;
  }
  if (isSmallProjectedTetrahedralLeafBatch(layoutGraph, anchorAtomId, primaryNeighborIds, childDescriptors)) {
    return false;
  }
  const participantCount = atomIdsToPlace?.size ?? 0;
  const heavyThreshold = layoutGraph?.options?.largeMoleculeThreshold?.heavyAtomCount ?? Number.MAX_SAFE_INTEGER;
  const hasMacrocycleBudgets = (branchConstraints?.angularBudgets?.size ?? 0) > 0;
  const greedyBudget = Math.max(48, Math.floor(heavyThreshold * 0.5));
  const totalSubtreeSize = childDescriptors.reduce((sum, descriptor) => sum + descriptor.subtreeSize, 0);
  const maxSubtreeSize = childDescriptors.reduce((max, descriptor) => Math.max(max, descriptor.subtreeSize), 0);
  const largeSubtreeCount = childDescriptors.filter(descriptor => descriptor.subtreeSize >= BRANCH_COMPLEXITY_LIMITS.subtreeFloor).length;
  if (participantCount > greedyBudget) {
    return true;
  }
  if (hasMacrocycleBudgets && participantCount > Math.max(24, Math.floor(greedyBudget * 0.5))) {
    return true;
  }
  if (!isRingAnchor(layoutGraph, anchorAtomId) && primaryNeighborIds.length >= 4 && (maxSubtreeSize >= 12 || totalSubtreeSize >= 24 || largeSubtreeCount >= 3)) {
    return true;
  }
  return false;
}

function permutations(items, maxPermutations = Number.MAX_SAFE_INTEGER) {
  const count = items.length;
  if (count <= 1) {
    return [items];
  }
  if (count === 2) {
    const perms = INDEX_PERMUTATIONS_2.map(indices => [items[indices[0]], items[indices[1]]]);
    return maxPermutations >= 2 ? perms : perms.slice(0, maxPermutations);
  }
  if (count === 3) {
    const perms = INDEX_PERMUTATIONS_3.map(indices => [items[indices[0]], items[indices[1]], items[indices[2]]]);
    return maxPermutations >= 6 ? perms : perms.slice(0, maxPermutations);
  }
  if (count === 4 && maxPermutations >= 24) {
    return ORTHOGONAL_SLOT_PERMUTATIONS.map(indices => [items[indices[0]], items[indices[1]], items[indices[2]], items[indices[3]]]);
  }
  const result = [];
  const recurse = (prefix, remainingItems) => {
    if (result.length >= maxPermutations) {
      return;
    }
    if (remainingItems.length === 0) {
      result.push(prefix);
      return;
    }
    for (let index = 0; index < remainingItems.length; index++) {
      recurse(prefix.concat([remainingItems[index]]), remainingItems.slice(0, index).concat(remainingItems.slice(index + 1)));
      if (result.length >= maxPermutations) {
        return;
      }
    }
  };
  recurse([], items);
  return result;
}

function orderChildDescriptors(childDescriptors, canonicalAtomRank) {
  return [...childDescriptors].sort((firstDescriptor, secondDescriptor) => {
    if (secondDescriptor.subtreeSize !== firstDescriptor.subtreeSize) {
      return secondDescriptor.subtreeSize - firstDescriptor.subtreeSize;
    }
    return compareCanonicalAtomIds(firstDescriptor.childAtomId, secondDescriptor.childAtomId, canonicalAtomRank);
  });
}

function branchPermutationBudget(layoutGraph, anchorAtomId, childDescriptors, branchConstraints = null) {
  if (childDescriptors.length <= 2) {
    return Number.MAX_SAFE_INTEGER;
  }
  if (isRingAnchor(layoutGraph, anchorAtomId) && (branchConstraints?.angularBudgets?.size ?? 0) === 0) {
    return Number.MAX_SAFE_INTEGER;
  }
  const totalSubtreeSize = childDescriptors.reduce((sum, descriptor) => sum + descriptor.subtreeSize, 0);
  const maxSubtreeSize = childDescriptors.reduce((max, descriptor) => Math.max(max, descriptor.subtreeSize), 0);
  const largeSubtreeCount = childDescriptors.filter(descriptor => descriptor.subtreeSize >= BRANCH_COMPLEXITY_LIMITS.subtreeFloor).length;

  if ((branchConstraints?.angularBudgets?.size ?? 0) > 0 && childDescriptors.length >= 3) {
    return BRANCH_COMPLEXITY_LIMITS.highMaxPermutations;
  }
  if (childDescriptors.length >= 4) {
    if (maxSubtreeSize >= 12 || totalSubtreeSize >= 24 || largeSubtreeCount >= 3) {
      return BRANCH_COMPLEXITY_LIMITS.extremeMaxPermutations;
    }
    if (maxSubtreeSize >= 8 || totalSubtreeSize >= 16 || largeSubtreeCount >= 2) {
      return BRANCH_COMPLEXITY_LIMITS.highMaxPermutations;
    }
  }
  if (childDescriptors.length === 3) {
    if (maxSubtreeSize >= 12 || totalSubtreeSize >= 18) {
      return BRANCH_COMPLEXITY_LIMITS.highMaxPermutations;
    }
    if (maxSubtreeSize >= 8 || totalSubtreeSize >= 12) {
      return BRANCH_COMPLEXITY_LIMITS.mediumMaxPermutations;
    }
    // Cross-like hypervalent centers (P, S, Se, As) may appear in chained arrangements
    // (e.g. triphosphate P1-O-P2-O-P3). Their angle sets already constrain geometry
    // tightly, so cap permutations to keep the nested trial count from exploding
    // exponentially: 3 perms × 2 angle sets^depth stays linear instead of cubic.
    if (describeCrossLikeHypervalentCenter(layoutGraph, anchorAtomId)) {
      return BRANCH_COMPLEXITY_LIMITS.highMaxPermutations;
    }
  }
  return Number.MAX_SAFE_INTEGER;
}

function hypervalentChildPermutations(layoutGraph, anchorAtomId, orderedChildDescriptors) {
  const descriptor = describeCrossLikeHypervalentCenter(layoutGraph, anchorAtomId);
  if (!descriptor || orderedChildDescriptors.length !== 3) {
    return null;
  }

  const singleDescriptors = [];
  const multipleDescriptors = [];
  for (const childDescriptor of orderedChildDescriptors) {
    if (descriptor.singleNeighborIds.includes(childDescriptor.childAtomId)) {
      singleDescriptors.push(childDescriptor);
      continue;
    }
    if (descriptor.multipleNeighborIds.includes(childDescriptor.childAtomId)) {
      multipleDescriptors.push(childDescriptor);
    }
  }

  if (singleDescriptors.length === 2 && multipleDescriptors.length === 1) {
    const oppositeSingleDescriptor = singleDescriptors[0];
    const orthogonalSingleDescriptor = singleDescriptors[1];
    const multipleDescriptor = multipleDescriptors[0];
    return [
      [oppositeSingleDescriptor, multipleDescriptor, orthogonalSingleDescriptor],
      [oppositeSingleDescriptor, orthogonalSingleDescriptor, multipleDescriptor]
    ];
  }

  if (singleDescriptors.length === 1 && multipleDescriptors.length === 2) {
    const oppositeSingleDescriptor = singleDescriptors[0];
    return [
      [oppositeSingleDescriptor, multipleDescriptors[0], multipleDescriptors[1]],
      [oppositeSingleDescriptor, multipleDescriptors[1], multipleDescriptors[0]]
    ];
  }

  return null;
}

function collectNewlyPlacedAtomIds(baseCoords, candidateCoords) {
  const newlyPlacedAtomIds = [];
  for (const atomId of candidateCoords.keys()) {
    if (!baseCoords.has(atomId)) {
      newlyPlacedAtomIds.push(atomId);
    }
  }
  return newlyPlacedAtomIds;
}

function shouldTrackFocusedPlacementAtom(layoutGraph, atomId) {
  if (!layoutGraph) {
    return false;
  }
  const atom = layoutGraph.atoms.get(atomId);
  if (!atom) {
    return false;
  }
  if (layoutGraph.options.suppressH && atom.element === 'H') {
    return false;
  }
  return true;
}

function buildCandidateArrangementAtomGrid(layoutGraph, baseAtomGrid, candidateCoords, newlyPlacedAtomIds) {
  if (!layoutGraph || !baseAtomGrid) {
    return null;
  }
  const candidateAtomGrid = baseAtomGrid.clone();
  for (const atomId of newlyPlacedAtomIds) {
    if (!shouldTrackFocusedPlacementAtom(layoutGraph, atomId)) {
      continue;
    }
    const position = candidateCoords.get(atomId);
    if (!position) {
      continue;
    }
    candidateAtomGrid.insert(atomId, position);
  }
  return candidateAtomGrid;
}

function shouldUseFocusedArrangementCost(layoutGraph, coords, focusAtomIds = []) {
  if (!layoutGraph || focusAtomIds.length === 0) {
    return false;
  }
  return coords.size >= 24 || focusAtomIds.length >= 8;
}

function tetrahedralSpreadPenalty(layoutGraph, coords, atomId) {
  if (!layoutGraph) {
    return 0;
  }
  const atom = layoutGraph.atoms.get(atomId);
  if (!atom || atom.element === 'H') {
    return 0;
  }

  const neighborAngles = [];
  for (const bond of layoutGraph.bondsByAtomId.get(atomId) ?? []) {
    if (bond.kind !== 'covalent') {
      continue;
    }
    if ((bond.order ?? 1) !== 1 || bond.aromatic) {
      return 0;
    }
    const neighborAtomId = bond.a === atomId ? bond.b : bond.a;
    const neighborAtom = layoutGraph.atoms.get(neighborAtomId);
    const neighborPosition = coords.get(neighborAtomId);
    const atomPosition = coords.get(atomId);
    if (!neighborAtom || neighborAtom.element === 'H' || !neighborPosition || !atomPosition) {
      continue;
    }
    neighborAngles.push(angleOf(sub(neighborPosition, atomPosition)));
  }

  if (neighborAngles.length !== 4) {
    return 0;
  }

  const separations = [];
  const sortedAngles = [...neighborAngles].sort((firstAngle, secondAngle) => firstAngle - secondAngle);
  for (let index = 0; index < sortedAngles.length; index++) {
    const currentAngle = sortedAngles[index];
    const nextAngle = sortedAngles[(index + 1) % sortedAngles.length];
    const rawGap = nextAngle - currentAngle;
    separations.push(rawGap > 0 ? rawGap : rawGap + Math.PI * 2);
  }

  return separations.reduce((sum, separation) => sum + (separation - Math.PI / 2) ** 2, 0);
}

function linearCenterPenalty(layoutGraph, coords, atomId) {
  if (!layoutGraph || !isLinearCenter(layoutGraph, atomId)) {
    return 0;
  }

  const atomPosition = coords.get(atomId);
  if (!atomPosition) {
    return 0;
  }

  const neighborAngles = [];
  for (const bond of layoutGraph.bondsByAtomId.get(atomId) ?? []) {
    if (bond.kind !== 'covalent') {
      continue;
    }
    const neighborAtomId = bond.a === atomId ? bond.b : bond.a;
    const neighborAtom = layoutGraph.atoms.get(neighborAtomId);
    const neighborPosition = coords.get(neighborAtomId);
    if (!neighborAtom || neighborAtom.element === 'H' || !neighborPosition) {
      continue;
    }
    neighborAngles.push(angleOf(sub(neighborPosition, atomPosition)));
  }

  if (neighborAngles.length !== 2) {
    return 0;
  }
  return (angularDifference(neighborAngles[0], neighborAngles[1]) - Math.PI) ** 2;
}

function trigonalCenterPenalty(layoutGraph, coords, atomId) {
  if (!layoutGraph) {
    return 0;
  }
  const atom = layoutGraph.atoms.get(atomId);
  const atomPosition = coords.get(atomId);
  if (!atom || atom.element === 'H' || !atomPosition) {
    return 0;
  }

  const visibleCovalentNeighbors = [];
  for (const bond of layoutGraph.bondsByAtomId.get(atomId) ?? []) {
    if (bond.kind !== 'covalent') {
      continue;
    }
    const neighborAtomId = bond.a === atomId ? bond.b : bond.a;
    const neighborAtom = layoutGraph.atoms.get(neighborAtomId);
    const neighborPosition = coords.get(neighborAtomId);
    if (!neighborAtom || neighborAtom.element === 'H' || !neighborPosition) {
      continue;
    }
    visibleCovalentNeighbors.push({ bond, neighborPosition });
  }

  if (visibleCovalentNeighbors.length !== 3) {
    return 0;
  }
  if (visibleCovalentNeighbors.filter(({ bond }) => (bond.order ?? 1) >= 2).length !== 1) {
    return 0;
  }

  const sortedAngles = visibleCovalentNeighbors
    .map(({ neighborPosition }) => angleOf(sub(neighborPosition, atomPosition)))
    .sort((firstAngle, secondAngle) => firstAngle - secondAngle);
  const separations = [];
  for (let index = 0; index < sortedAngles.length; index++) {
    const currentAngle = sortedAngles[index];
    const nextAngle = sortedAngles[(index + 1) % sortedAngles.length];
    const rawGap = nextAngle - currentAngle;
    separations.push(rawGap > 0 ? rawGap : rawGap + Math.PI * 2);
  }

  return separations.reduce((sum, separation) => sum + (separation - DEG120) ** 2, 0);
}

function arrangementIdealGeometryPenalty(layoutGraph, coords, anchorAtomId, focusAtomIds = []) {
  if (!layoutGraph) {
    return 0;
  }

  let penalty = linearCenterPenalty(layoutGraph, coords, anchorAtomId) + trigonalCenterPenalty(layoutGraph, coords, anchorAtomId);
  for (const atomId of focusAtomIds) {
    if (atomId === anchorAtomId) {
      continue;
    }
    penalty += linearCenterPenalty(layoutGraph, coords, atomId);
    penalty += trigonalCenterPenalty(layoutGraph, coords, atomId);
  }
  return penalty;
}

function crossLikeHypervalentPenalty(layoutGraph, coords, atomId) {
  const descriptor = describeCrossLikeHypervalentCenter(layoutGraph, atomId);
  if (!descriptor) {
    return 0;
  }

  const neighborAtomIds = [...descriptor.singleNeighborIds, ...descriptor.multipleNeighborIds];
  const atomPosition = coords.get(atomId);
  if (!atomPosition || neighborAtomIds.length !== 4) {
    return 0;
  }
  const neighborAngles = neighborAtomIds.map(neighborAtomId => {
    const neighborPosition = coords.get(neighborAtomId);
    return neighborPosition && atomPosition ? angleOf(sub(neighborPosition, atomPosition)) : null;
  });
  if (neighborAngles.some(angle => angle == null)) {
    return 0;
  }

  const candidateAlphas = neighborAngles.flatMap(angle => ORTHOGONAL_SLOT_OFFSETS.map(slotOffset => angle - slotOffset));
  const slotPermutations = orthogonalSlotPermutations(descriptor);
  let bestPenalty = Number.POSITIVE_INFINITY;
  outer: for (const alpha of candidateAlphas) {
    const targetAngles = ORTHOGONAL_SLOT_OFFSETS.map(slotOffset => alpha + slotOffset);
    for (const permutation of slotPermutations) {
      let penalty = 0;
      for (let neighborIndex = 0; neighborIndex < neighborAngles.length; neighborIndex++) {
        penalty += angularDifference(neighborAngles[neighborIndex], targetAngles[permutation[neighborIndex]]) ** 2;
        if (penalty >= bestPenalty) {
          break;
        }
      }
      if (penalty < bestPenalty) {
        bestPenalty = penalty;
        if (bestPenalty < 1e-9) {
          break outer;
        }
      }
    }
  }
  return Number.isFinite(bestPenalty) ? bestPenalty : 0;
}

function arrangementCrossLikeHypervalentPenalty(layoutGraph, coords, anchorAtomId) {
  return crossLikeHypervalentPenalty(layoutGraph, coords, anchorAtomId);
}

/**
 * Counts heavy atoms in the covalent subtree reached from a root across one cut bond.
 * @param {object|null} layoutGraph - Layout graph shell.
 * @param {string} rootAtomId - Root atom on the traversed side.
 * @param {string} blockedAtomId - Atom on the blocked side of the cut.
 * @returns {number} Heavy atom count in the downstream subtree.
 */
function covalentHeavySubtreeSize(layoutGraph, rootAtomId, blockedAtomId) {
  if (!layoutGraph) {
    return 0;
  }
  const visited = new Set([blockedAtomId]);
  const queue = [rootAtomId];
  let heavyAtomCount = 0;

  while (queue.length > 0) {
    const atomId = queue.pop();
    if (visited.has(atomId)) {
      continue;
    }
    visited.add(atomId);
    const atom = layoutGraph.atoms.get(atomId);
    if (!atom) {
      continue;
    }
    if (atom.element !== 'H') {
      heavyAtomCount++;
    }
    for (const bond of layoutGraph.bondsByAtomId.get(atomId) ?? []) {
      if (!bond || bond.kind !== 'covalent') {
        continue;
      }
      const neighborAtomId = bond.a === atomId ? bond.b : bond.a;
      if (!visited.has(neighborAtomId)) {
        queue.push(neighborAtomId);
      }
    }
  }

  return heavyAtomCount;
}

/**
 * Returns the minimum visible distance from one atom to the already placed scaffold.
 * @param {object|null} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Candidate coordinate map.
 * @param {string} atomId - Atom whose clearance should be measured.
 * @param {Set<string>} excludedAtomIds - Atoms to ignore, usually the new local arrangement.
 * @param {import('../../geometry/atom-grid.js').AtomGrid|null} [atomGrid] - Optional spatial index for proximity queries.
 * @returns {number} Minimum distance to an already placed visible atom.
 */
function visibleScaffoldClearance(layoutGraph, coords, atomId, excludedAtomIds, atomGrid = null) {
  const position = coords.get(atomId);
  if (!layoutGraph || !position) {
    return 0;
  }

  const candidateAtomIds = atomGrid
    ? atomGrid.queryRadius(position, atomGrid.cellSize * 5)
    : coords.keys();
  let minimumDistance = Number.POSITIVE_INFINITY;
  for (const otherAtomId of candidateAtomIds) {
    if (excludedAtomIds.has(otherAtomId)) {
      continue;
    }
    const otherAtom = layoutGraph.atoms.get(otherAtomId);
    if (!otherAtom || otherAtom.visible === false || otherAtom.element === 'H') {
      continue;
    }
    const otherPosition = coords.get(otherAtomId);
    if (!otherPosition) {
      continue;
    }
    const dx = position.x - otherPosition.x;
    const dy = position.y - otherPosition.y;
    minimumDistance = Math.min(minimumDistance, Math.hypot(dx, dy));
  }

  return Number.isFinite(minimumDistance) ? minimumDistance : 0;
}

/**
 * Penalizes carbonyl-like trigonal assignments that put a larger single-bond
 * branch into a tighter scaffold slot than a terminal multiple-bond hetero
 * leaf. This keeps acyl and ester tails on the open side when the local
 * 120-degree alternatives are otherwise tied by geometry cost.
 * @param {object|null} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Candidate coordinate map.
 * @param {string} anchorAtomId - Trigonal anchor atom ID.
 * @param {string[]} [focusAtomIds] - Newly placed atoms participating in the arrangement.
 * @param {import('../../geometry/atom-grid.js').AtomGrid|null} [atomGrid] - Optional spatial index for clearance queries.
 * @returns {number} Slot-assignment penalty; lower is better.
 */
function trigonalBranchClearanceAssignmentPenalty(layoutGraph, coords, anchorAtomId, focusAtomIds = [], atomGrid = null) {
  const anchorAtom = layoutGraph?.atoms.get(anchorAtomId);
  if (
    !layoutGraph
    || !anchorAtom
    || anchorAtom.element !== 'C'
    || anchorAtom.aromatic
    || anchorAtom.heavyDegree !== 3
    || anchorAtom.degree !== 3
    || (layoutGraph.atomToRings.get(anchorAtomId)?.length ?? 0) > 0
  ) {
    return 0;
  }

  const focusAtomIdSet = new Set(focusAtomIds);
  const terminalMultipleLeafIds = [];
  const bulkySingleBranchIds = [];
  for (const bond of layoutGraph.bondsByAtomId.get(anchorAtomId) ?? []) {
    if (!bond || bond.kind !== 'covalent' || bond.aromatic) {
      return 0;
    }
    const neighborAtomId = bond.a === anchorAtomId ? bond.b : bond.a;
    if (!focusAtomIdSet.has(neighborAtomId) || !coords.has(neighborAtomId)) {
      continue;
    }
    const neighborAtom = layoutGraph.atoms.get(neighborAtomId);
    if (!neighborAtom || neighborAtom.element === 'H') {
      continue;
    }
    if ((bond.order ?? 1) >= 2 && isTerminalMultipleBondLeaf(layoutGraph, anchorAtomId, bond) && neighborAtom.element !== 'C') {
      terminalMultipleLeafIds.push(neighborAtomId);
      continue;
    }
    if ((bond.order ?? 1) === 1 && covalentHeavySubtreeSize(layoutGraph, neighborAtomId, anchorAtomId) >= 2) {
      bulkySingleBranchIds.push(neighborAtomId);
    }
  }

  if (terminalMultipleLeafIds.length !== 1 || bulkySingleBranchIds.length !== 1) {
    return 0;
  }

  const excludedAtomIds = new Set([anchorAtomId, ...focusAtomIds]);
  const terminalClearance = visibleScaffoldClearance(layoutGraph, coords, terminalMultipleLeafIds[0], excludedAtomIds, atomGrid);
  const branchClearance = visibleScaffoldClearance(layoutGraph, coords, bulkySingleBranchIds[0], excludedAtomIds, atomGrid);
  return Math.max(0, terminalClearance - branchClearance) ** 2;
}

/**
 * Returns a local ring-substituent readability penalty for one arrangement
 * candidate. This lets mirrored multi-child placements around aromatic and
 * conjugated ring roots prefer the orientation that keeps existing exocyclic
 * bonds on the ring-outward side instead of only minimizing coarse layout
 * cost.
 * @param {object|null} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Candidate coordinate map.
 * @param {number} bondLength - Canonical bond length.
 * @param {string} anchorAtomId - Anchor atom ID whose local arrangement is being scored.
 * @param {string[]} [focusAtomIds] - Newly placed atom IDs participating in the arrangement.
 * @param {AtomGrid|null} [atomGrid] - Optional spatial index for focused scoring.
 * @returns {number} Local readability penalty.
 */
function arrangementCost(layoutGraph, coords, bondLength, anchorAtomId, focusAtomIds = [], atomGrid = null) {
  const layoutCost = !layoutGraph
    ? 0
    : shouldUseFocusedArrangementCost(layoutGraph, coords, focusAtomIds)
      ? measureFocusedPlacementCost(layoutGraph, coords, bondLength, focusAtomIds, { atomGrid })
      : measureLayoutCost(layoutGraph, coords, bondLength);
  return (
    layoutCost +
    tetrahedralSpreadPenalty(layoutGraph, coords, anchorAtomId) * ARRANGEMENT_IDEAL_GEOMETRY_WEIGHT +
    measureSmallRingExteriorGapSpreadPenalty(layoutGraph, coords, anchorAtomId) * SMALL_RING_EXTERIOR_GAP_WEIGHT +
    arrangementCrossLikeHypervalentPenalty(layoutGraph, coords, anchorAtomId) * ARRANGEMENT_IDEAL_GEOMETRY_WEIGHT +
    arrangementIdealGeometryPenalty(layoutGraph, coords, anchorAtomId, focusAtomIds) * ARRANGEMENT_IDEAL_GEOMETRY_WEIGHT +
    trigonalBranchClearanceAssignmentPenalty(layoutGraph, coords, anchorAtomId, focusAtomIds, atomGrid) * TRIGONAL_BRANCH_CLEARANCE_ASSIGNMENT_WEIGHT
  );
}

function evaluateAnglePermutations(
  adjacency,
  canonicalAtomRank,
  coords,
  placementState,
  atomIdsToPlace,
  anchorAtomId,
  bondLength,
  layoutGraph,
  branchConstraints,
  depth,
  anchorPosition,
  angleSets,
  childDescriptors,
  placeChildrenFn,
  _baseAtomGrid = null
) {
  const orderedChildDescriptors = orderChildDescriptors(childDescriptors, canonicalAtomRank);
  const childPermutations =
    hypervalentChildPermutations(layoutGraph, anchorAtomId, orderedChildDescriptors) ??
    permutations(orderedChildDescriptors, branchPermutationBudget(layoutGraph, anchorAtomId, orderedChildDescriptors, branchConstraints));
  let bestPlacement = null;

  for (const angleSet of angleSets) {
    for (const permutation of childPermutations) {
      const tempCoords = new Map(coords);
      const tempPlacementState = clonePlacementState(placementState);
      const assignedPlacements = angleSet.map((angle, index) => ({
        childAtomId: permutation[index].childAtomId,
        angle,
        subtreeSize: permutation[index].subtreeSize
      }));

      for (const placement of assignedPlacements) {
        setPlacedPosition(
          tempCoords,
          tempPlacementState,
          placement.childAtomId,
          {
            x: anchorPosition.x + Math.cos(placement.angle) * bondLength,
            y: anchorPosition.y + Math.sin(placement.angle) * bondLength
          },
          layoutGraph
        );
      }

      const recursionOrder = [...assignedPlacements].sort((firstPlacement, secondPlacement) => {
        if (secondPlacement.subtreeSize !== firstPlacement.subtreeSize) {
          return secondPlacement.subtreeSize - firstPlacement.subtreeSize;
        }
        return compareCanonicalAtomIds(firstPlacement.childAtomId, secondPlacement.childAtomId, canonicalAtomRank);
      });
      for (const placement of recursionOrder) {
        placeChildrenFn(
          adjacency,
          canonicalAtomRank,
          tempCoords,
          tempPlacementState,
          atomIdsToPlace,
          placement.childAtomId,
          anchorAtomId,
          bondLength,
          layoutGraph,
          branchConstraints,
          depth + 1
        );
      }

      const newlyPlacedAtomIds = collectNewlyPlacedAtomIds(coords, tempCoords);
      const cost = arrangementCost(layoutGraph, tempCoords, bondLength, anchorAtomId, newlyPlacedAtomIds, null);
      if (!bestPlacement || cost < bestPlacement.cost - ARRANGEMENT_COST_TIE_EPSILON) {
        bestPlacement = {
          cost,
          coords: tempCoords,
          placementState: tempPlacementState
        };
      }
    }
  }

  return bestPlacement;
}

function evaluateLocalAnglePermutations(
  canonicalAtomRank,
  coords,
  placementState,
  anchorAtomId,
  bondLength,
  layoutGraph,
  anchorPosition,
  angleSets,
  childDescriptors,
  baseAtomGrid = null
) {
  const orderedChildDescriptors = orderChildDescriptors(childDescriptors, canonicalAtomRank);
  const childPermutations =
    hypervalentChildPermutations(layoutGraph, anchorAtomId, orderedChildDescriptors) ??
    permutations(orderedChildDescriptors, branchPermutationBudget(layoutGraph, anchorAtomId, orderedChildDescriptors));
  let bestPlacement = null;

  for (const angleSet of angleSets) {
    for (const permutation of childPermutations) {
      const tempCoords = new Map(coords);
      const tempPlacementState = clonePlacementState(placementState);
      const assignedPlacements = angleSet.map((angle, index) => ({
        childAtomId: permutation[index].childAtomId,
        angle
      }));

      for (const placement of assignedPlacements) {
        setPlacedPosition(
          tempCoords,
          tempPlacementState,
          placement.childAtomId,
          {
            x: anchorPosition.x + Math.cos(placement.angle) * bondLength,
            y: anchorPosition.y + Math.sin(placement.angle) * bondLength
          },
          layoutGraph
        );
      }

      // The local variant places only direct children — no recursive subtree expansion —
      // so the newly placed atoms are exactly the assigned child atoms (excluding any
      // that were already in coords, e.g. ring atoms that were pre-placed).
      const newlyPlacedAtomIds = assignedPlacements.map(p => p.childAtomId).filter(id => !coords.has(id));
      const candidateAtomGrid = buildCandidateArrangementAtomGrid(layoutGraph, baseAtomGrid, tempCoords, newlyPlacedAtomIds);
      const cost = arrangementCost(layoutGraph, tempCoords, bondLength, anchorAtomId, newlyPlacedAtomIds, candidateAtomGrid);
      if (!bestPlacement || cost < bestPlacement.cost - ARRANGEMENT_COST_TIE_EPSILON) {
        bestPlacement = {
          cost,
          coords: tempCoords,
          placementState: tempPlacementState,
          assignedPlacements
        };
      }
    }
  }

  return bestPlacement;
}

/**
 * Chooses among multiple competing single-child continuation angles by
 * recursively placing the child's subtree for each candidate and keeping the
 * arrangement with the lowest resulting cost.
 * @param {Map<string, string[]>} adjacency - Component adjacency map.
 * @param {Map<string, number>} canonicalAtomRank - Canonical rank lookup.
 * @param {Map<string, {x: number, y: number}>} coords - Mutable coordinate map.
 * @param {{sumX: number, sumY: number, count: number, trackedPositions: Map<string, {x: number, y: number}>}} placementState - Running placement state.
 * @param {Set<string>} atomIdsToPlace - Eligible atom IDs in the current slice.
 * @param {string} anchorAtomId - Anchor atom ID.
 * @param {string|null} parentAtomId - Already placed parent atom ID.
 * @param {string} childAtomId - Child atom ID being placed.
 * @param {number[]} candidateAngles - Candidate continuation angles to compare.
 * @param {number} bondLength - Target bond length.
 * @param {(adjacency: Map<string, string[]>, canonicalAtomRank: Map<string, number>, coords: Map<string, {x: number, y: number}>, placementState: {sumX: number, sumY: number, count: number, trackedPositions: Map<string, {x: number, y: number}>}, atomIdsToPlace: Set<string>, anchorAtomId: string, parentAtomId: string|null, bondLength: number, layoutGraph?: object|null, branchConstraints?: {angularBudgets?: Map<string, {centerAngle: number, minOffset: number, maxOffset: number, preferredAngle: number}>}|null, depth?: number, placementContext?: object|null) => void} placeChildrenFn - Recursive child placement callback.
 * @param {object|null} [layoutGraph] - Layout graph shell.
 * @param {{angularBudgets?: Map<string, {centerAngle: number, minOffset: number, maxOffset: number, preferredAngle: number}>}|null} [branchConstraints] - Optional branch-angle constraints.
 * @param {number} [depth] - Current recursion depth.
 * @param {{childAtomId: string, subtreeSize: number}|null} [childDescriptor] - Optional precomputed child descriptor.
 * @returns {number|null} Chosen angle in radians, or `null` when no lookahead candidate was evaluated.
 */
export function chooseSingleBranchAngleWithLookahead(
  adjacency,
  canonicalAtomRank,
  coords,
  placementState,
  atomIdsToPlace,
  anchorAtomId,
  parentAtomId,
  childAtomId,
  candidateAngles,
  bondLength,
  placeChildrenFn,
  layoutGraph = null,
  branchConstraints = null,
  depth = 0,
  childDescriptor = null
) {
  const anchorPosition = coords.get(anchorAtomId);
  if (!anchorPosition || !childAtomId || depth > MAX_BRANCH_RECURSION_DEPTH) {
    return null;
  }

  const uniqueCandidateAngles = [];
  for (const candidateAngle of candidateAngles ?? []) {
    if (!Number.isFinite(candidateAngle)) {
      continue;
    }
    if (!uniqueCandidateAngles.some(existingAngle => angularDifference(existingAngle, candidateAngle) <= 1e-9)) {
      uniqueCandidateAngles.push(candidateAngle);
    }
  }
  if (uniqueCandidateAngles.length < 2) {
    return uniqueCandidateAngles[0] ?? null;
  }

  const resolvedChildDescriptors = [
    childDescriptor ?? {
      childAtomId,
      subtreeSize: subtreeHeavyAtomCount(adjacency, layoutGraph, coords, childAtomId, anchorAtomId)
    }
  ];
  const bestPlacement = evaluateAnglePermutations(
    adjacency,
    canonicalAtomRank,
    coords,
    placementState,
    atomIdsToPlace,
    anchorAtomId,
    bondLength,
    layoutGraph,
    branchConstraints,
    depth,
    anchorPosition,
    uniqueCandidateAngles.map(angle => [angle]),
    resolvedChildDescriptors,
    placeChildrenFn
  );

  if (!bestPlacement) {
    return null;
  }

  for (const atomId of atomIdsToPlace) {
    if (bestPlacement.coords.has(atomId)) {
      coords.set(atomId, bestPlacement.coords.get(atomId));
    }
  }
  copyPlacementState(placementState, bestPlacement.placementState);
  return angleOf(sub(coords.get(childAtomId), anchorPosition));
}

/**
 * Chooses one best child-angle assignment for a multi-branch placement step.
 * @param {Map<string, string[]>} adjacency - Component adjacency map.
 * @param {Map<string, number>} canonicalAtomRank - Canonical rank lookup.
 * @param {Map<string, {x: number, y: number}>} coords - Mutable coordinate map.
 * @param {{sumX: number, sumY: number, count: number, trackedPositions: Map<string, {x: number, y: number}>}} placementState - Running placement state.
 * @param {Set<string>} atomIdsToPlace - Eligible atom IDs in the current slice.
 * @param {string} anchorAtomId - Anchor atom ID.
 * @param {string|null} parentAtomId - Already placed parent atom ID.
 * @param {string[]} unplacedNeighborIds - Child atom IDs to assign.
 * @param {number} bondLength - Target bond length.
 * @param {(adjacency: Map<string, string[]>, canonicalAtomRank: Map<string, number>, coords: Map<string, {x: number, y: number}>, placementState: {sumX: number, sumY: number, count: number, trackedPositions: Map<string, {x: number, y: number}>}, atomIdsToPlace: Set<string>, anchorAtomId: string, parentAtomId: string|null, bondLength: number, layoutGraph?: object|null, branchConstraints?: {angularBudgets?: Map<string, {centerAngle: number, minOffset: number, maxOffset: number, preferredAngle: number}>}|null, depth?: number, placementContext?: object|null) => void} placeChildrenFn - Recursive child placement callback.
 * @param {object|null} [layoutGraph] - Layout graph shell.
 * @param {{angularBudgets?: Map<string, {centerAngle: number, minOffset: number, maxOffset: number, preferredAngle: number}>}|null} [branchConstraints] - Optional branch-angle constraints.
 * @param {number} [depth] - Current recursion depth.
 * @param {Array<{childAtomId: string, subtreeSize: number}>|null} [childDescriptors] - Optional precomputed child descriptors.
 * @param {{atomGrid?: import('../../geometry/atom-grid.js').AtomGrid|null}} [placementContext] - Optional reusable branch-placement context.
 * @returns {Array<{childAtomId: string, angle: number}>} Assigned angles for the requested children.
 */
export function chooseBatchAngleAssignments(
  adjacency,
  canonicalAtomRank,
  coords,
  placementState,
  atomIdsToPlace,
  anchorAtomId,
  parentAtomId,
  unplacedNeighborIds,
  bondLength,
  placeChildrenFn,
  layoutGraph = null,
  branchConstraints = null,
  depth = 0,
  childDescriptors = null,
  placementContext = null
) {
  const anchorPosition = coords.get(anchorAtomId);
  if (!anchorPosition || unplacedNeighborIds.length === 0 || depth > MAX_BRANCH_RECURSION_DEPTH) {
    return [];
  }

  const angleSets = buildCandidateAngleSets(adjacency, coords, anchorAtomId, parentAtomId, unplacedNeighborIds, layoutGraph, branchConstraints);
  const baseAtomGrid = placementContext?.atomGrid ?? (layoutGraph && coords.size >= 160 ? buildAtomGrid(layoutGraph, coords, bondLength) : null);
  const resolvedChildDescriptors =
    childDescriptors ??
    unplacedNeighborIds.map(childAtomId => ({
      childAtomId,
      subtreeSize: subtreeHeavyAtomCount(adjacency, layoutGraph, coords, childAtomId, anchorAtomId)
    }));
  const useLocalHypervalentBatch = !!describeCrossLikeHypervalentCenter(layoutGraph, anchorAtomId) && resolvedChildDescriptors.length >= 3;
  const bestPlacement = useLocalHypervalentBatch
    ? evaluateLocalAnglePermutations(
        canonicalAtomRank,
        coords,
        placementState,
        anchorAtomId,
        bondLength,
        layoutGraph,
        anchorPosition,
        angleSets,
        resolvedChildDescriptors,
        baseAtomGrid
      )
    : evaluateAnglePermutations(
        adjacency,
        canonicalAtomRank,
        coords,
        placementState,
        atomIdsToPlace,
        anchorAtomId,
        bondLength,
        layoutGraph,
        branchConstraints,
        depth,
        anchorPosition,
        angleSets,
        resolvedChildDescriptors,
        placeChildrenFn,
        baseAtomGrid
      );

  if (!bestPlacement) {
    return [];
  }

  for (const atomId of atomIdsToPlace) {
    if (bestPlacement.coords.has(atomId)) {
      coords.set(atomId, bestPlacement.coords.get(atomId));
    }
  }
  copyPlacementState(placementState, bestPlacement.placementState);
  if (useLocalHypervalentBatch) {
    const recursionOrder = [...bestPlacement.assignedPlacements].sort((firstPlacement, secondPlacement) => {
      const firstDescriptor = resolvedChildDescriptors.find(descriptor => descriptor.childAtomId === firstPlacement.childAtomId);
      const secondDescriptor = resolvedChildDescriptors.find(descriptor => descriptor.childAtomId === secondPlacement.childAtomId);
      const firstSubtreeSize = firstDescriptor?.subtreeSize ?? 0;
      const secondSubtreeSize = secondDescriptor?.subtreeSize ?? 0;
      if (secondSubtreeSize !== firstSubtreeSize) {
        return secondSubtreeSize - firstSubtreeSize;
      }
      return compareCanonicalAtomIds(firstPlacement.childAtomId, secondPlacement.childAtomId, canonicalAtomRank);
    });
    for (const placement of recursionOrder) {
      placeChildrenFn(
        adjacency,
        canonicalAtomRank,
        coords,
        placementState,
        atomIdsToPlace,
        placement.childAtomId,
        anchorAtomId,
        bondLength,
        layoutGraph,
        branchConstraints,
        depth + 1,
        null
      );
    }
  }

  return unplacedNeighborIds.map(childAtomId => ({
    childAtomId,
    angle: angleOf(sub(coords.get(childAtomId), anchorPosition))
  }));
}

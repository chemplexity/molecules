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
import { buildCandidateAngleSets, describeCrossLikeHypervalentCenter, isLinearCenter, measureSmallRingExteriorGapSpreadPenalty } from './angle-selection.js';

const ORTHOGONAL_SLOT_OFFSETS = [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2];
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
  if (items.length <= 1) {
    return [items];
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
  let bestPenalty = Number.POSITIVE_INFINITY;
  outer: for (const alpha of candidateAlphas) {
    const targetAngles = ORTHOGONAL_SLOT_OFFSETS.map(slotOffset => alpha + slotOffset);
    for (const permutation of ORTHOGONAL_SLOT_PERMUTATIONS) {
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
    arrangementIdealGeometryPenalty(layoutGraph, coords, anchorAtomId, focusAtomIds) * ARRANGEMENT_IDEAL_GEOMETRY_WEIGHT
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
      if (!bestPlacement || cost < bestPlacement.cost) {
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
      if (!bestPlacement || cost < bestPlacement.cost) {
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
 * @param {(adjacency: Map<string, string[]>, canonicalAtomRank: Map<string, number>, coords: Map<string, {x: number, y: number}>, placementState: {sumX: number, sumY: number, count: number, trackedPositions: Map<string, {x: number, y: number}>}, atomIdsToPlace: Set<string>, anchorAtomId: string, parentAtomId: string|null, bondLength: number, layoutGraph?: object|null, branchConstraints?: {angularBudgets?: Map<string, {centerAngle: number, minOffset: number, maxOffset: number, preferredAngle: number}>}|null, depth?: number) => void} placeChildrenFn - Recursive child placement callback.
 * @param {object|null} [layoutGraph] - Layout graph shell.
 * @param {{angularBudgets?: Map<string, {centerAngle: number, minOffset: number, maxOffset: number, preferredAngle: number}>}|null} [branchConstraints] - Optional branch-angle constraints.
 * @param {number} [depth] - Current recursion depth.
 * @param {Array<{childAtomId: string, subtreeSize: number}>|null} [childDescriptors] - Optional precomputed child descriptors.
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
  childDescriptors = null
) {
  const anchorPosition = coords.get(anchorAtomId);
  if (!anchorPosition || unplacedNeighborIds.length === 0 || depth > MAX_BRANCH_RECURSION_DEPTH) {
    return [];
  }

  const angleSets = buildCandidateAngleSets(adjacency, coords, anchorAtomId, parentAtomId, unplacedNeighborIds, layoutGraph, branchConstraints);
  const baseAtomGrid = layoutGraph && coords.size >= 160 ? buildAtomGrid(layoutGraph, coords, bondLength) : null;
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
        depth + 1
      );
    }
  }

  return unplacedNeighborIds.map(childAtomId => ({
    childAtomId,
    angle: angleOf(sub(coords.get(childAtomId), anchorPosition))
  }));
}

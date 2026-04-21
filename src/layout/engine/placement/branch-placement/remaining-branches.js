/** @module placement/branch-placement/remaining-branches */

import { add, fromAngle } from '../../geometry/vec2.js';
import { AtomGrid } from '../../geometry/atom-grid.js';
import {
  DISCRETE_BRANCH_ANGLES,
  MAX_BRANCH_RECURSION_DEPTH,
  isHydrogenAtom,
  isRingAnchor,
  neighborOrder,
  placedNeighborIds,
  seedPlacementState,
  setPlacedPosition,
  splitDeferredLeafNeighbors,
  subtreeHeavyAtomCount
} from './shared.js';
import {
  budgetPreferredAngles,
  chooseContinuationAngle,
  chooseExactPreferredAngle,
  evaluateAngleCandidates,
  filterAnglesByBudget,
  findLayoutBond,
  incidentRingPolygons,
  isExactSmallRingExteriorContinuationEligible,
  isExactRingTrigonalBisectorEligible,
  isExactSimpleAcyclicContinuationEligible,
  isExactRingOutwardEligibleSubstituent,
  isTerminalMultipleBondLeaf,
  mergeCandidateAngles,
  occupiedNeighborAngles,
  pickBestCandidateAngle,
  preferredBranchAngles,
  resolvedPreferredAngles,
  shouldPromotePreferredRingAngle,
  supportsProjectedTetrahedralGeometry
} from './angle-selection.js';
import { chooseBatchAngleAssignments, shouldUseGreedyBranchPlacement } from './permutations.js';

/**
 * Returns whether an anchor still has an unplaced heavy neighbor outside the
 * current placement slice. Mixed-family branch growth can revisit these
 * anchors after pending ring blocks attach, so simple leaf atoms should wait
 * instead of claiming the local slots too early.
 * @param {Map<string, string[]>} adjacency - Component adjacency map.
 * @param {Set<string>} atomIdsToPlace - Atom IDs in the current placement slice.
 * @param {Map<string, {x: number, y: number}>} coords - Current coordinate map.
 * @param {string} anchorAtomId - Anchor atom ID.
 * @param {object|null} layoutGraph - Layout graph shell.
 * @returns {boolean} True when the anchor has a pending out-of-slice heavy neighbor.
 */
function hasPendingHeavyNeighborOutsidePlacementSlice(adjacency, atomIdsToPlace, coords, anchorAtomId, layoutGraph) {
  if (!layoutGraph) {
    return false;
  }
  return (adjacency.get(anchorAtomId) ?? []).some(neighborAtomId => {
    if (atomIdsToPlace.has(neighborAtomId) || coords.has(neighborAtomId)) {
      return false;
    }
    return layoutGraph.atoms.get(neighborAtomId)?.element !== 'H';
  });
}

function placeNeighborSequence(
  adjacency,
  canonicalAtomRank,
  coords,
  placementState,
  atomIdsToPlace,
  anchorAtomId,
  parentAtomId,
  bondLength,
  neighborAtomIds,
  layoutGraph = null,
  branchConstraints = null,
  depth = 0
) {
  const anchorPosition = coords.get(anchorAtomId);
  if (!anchorPosition || neighborAtomIds.length === 0 || depth > MAX_BRANCH_RECURSION_DEPTH) {
    return;
  }

  const occupiedAngles = occupiedNeighborAngles(adjacency, coords, anchorAtomId, atomIdsToPlace);
  const ringPolygons = incidentRingPolygons(layoutGraph, coords, anchorAtomId);

  const atomGrid = bondLength > 0 && coords.size >= 160 ? new AtomGrid(bondLength) : null;
  if (atomGrid) {
    for (const [atomId, pos] of coords) {
      atomGrid.insert(atomId, pos);
    }
  }

  for (const childAtomId of neighborAtomIds) {
    const currentPlacedNeighborIds = placedNeighborIds(adjacency, coords, anchorAtomId);
    const childBond = childAtomId ? findLayoutBond(layoutGraph, anchorAtomId, childAtomId) : null;
    const preferredAngles = preferredBranchAngles(adjacency, coords, anchorAtomId, atomIdsToPlace, parentAtomId, childAtomId, layoutGraph);
    const excludedAtomIds = new Set([anchorAtomId, ...currentPlacedNeighborIds]);
    const childIsHydrogen = isHydrogenAtom(layoutGraph, childAtomId);
    const scoringPreferredAngles = childIsHydrogen ? [] : resolvedPreferredAngles(anchorAtomId, preferredAngles, branchConstraints);
    const constrainedPreferredAngles = mergeCandidateAngles(
      filterAnglesByBudget(scoringPreferredAngles, anchorAtomId, branchConstraints),
      childIsHydrogen ? [] : budgetPreferredAngles(anchorAtomId, branchConstraints)
    );
    const constrainedFallbackAngles = mergeCandidateAngles(
      filterAnglesByBudget(DISCRETE_BRANCH_ANGLES, anchorAtomId, branchConstraints),
      budgetPreferredAngles(anchorAtomId, branchConstraints)
    );
    const shouldHonorProjectedTetrahedralAngle =
      preferredAngles.length > 0
      && !childIsHydrogen
      && supportsProjectedTetrahedralGeometry(layoutGraph, anchorAtomId);
    const shouldHonorPreferredAngle =
      preferredAngles.length > 0
      && !childIsHydrogen
      && (currentPlacedNeighborIds.length === 1 || isRingAnchor(layoutGraph, anchorAtomId) || shouldHonorProjectedTetrahedralAngle);
    const allowFinePreferredAngles = shouldHonorPreferredAngle && isRingAnchor(layoutGraph, anchorAtomId);
    const shouldForceExactTrigonalAngle =
      preferredAngles.length > 0
      && !childIsHydrogen
      && childBond != null
      && isTerminalMultipleBondLeaf(layoutGraph, anchorAtomId, childBond);
    const shouldForceExactRingTrigonalBisectorAngle =
      preferredAngles.length > 0
      && !childIsHydrogen
      && isExactRingTrigonalBisectorEligible(layoutGraph, anchorAtomId, childAtomId);
    const shouldForceExactSimpleAcyclicAngle =
      shouldHonorPreferredAngle
      && isExactSimpleAcyclicContinuationEligible(layoutGraph, anchorAtomId, parentAtomId, childAtomId);
    const shouldForceExactProjectedTetrahedralAngle =
      shouldHonorProjectedTetrahedralAngle
      && currentPlacedNeighborIds.length >= 2;
    const allowDirectPreferredAngle =
      !shouldHonorPreferredAngle
      || shouldPromotePreferredRingAngle(layoutGraph, anchorAtomId, childAtomId)
      || shouldForceExactTrigonalAngle
      || shouldForceExactRingTrigonalBisectorAngle
      || shouldForceExactSimpleAcyclicAngle
      || shouldForceExactProjectedTetrahedralAngle
      || isExactSmallRingExteriorContinuationEligible(layoutGraph, anchorAtomId, childAtomId);
    const exactPreferredAngle =
      (
        (shouldHonorPreferredAngle && isExactRingOutwardEligibleSubstituent(layoutGraph, anchorAtomId, childAtomId))
        || shouldForceExactTrigonalAngle
        || shouldForceExactRingTrigonalBisectorAngle
        || shouldForceExactSimpleAcyclicAngle
        || shouldForceExactProjectedTetrahedralAngle
      )
        ? chooseExactPreferredAngle(anchorPosition, bondLength, coords, occupiedAngles, constrainedPreferredAngles, excludedAtomIds, placementState, ringPolygons, atomGrid)
        : null;
    const fallbackCandidates = evaluateAngleCandidates(
      constrainedFallbackAngles,
      occupiedAngles,
      constrainedPreferredAngles,
      anchorPosition,
      bondLength,
      coords,
      excludedAtomIds,
      placementState,
      ringPolygons,
      atomGrid
    );
    const chosenAngle =
      exactPreferredAngle ??
      (shouldHonorPreferredAngle
        ? chooseContinuationAngle(
            anchorPosition,
            bondLength,
            coords,
            occupiedAngles,
            constrainedPreferredAngles,
            constrainedFallbackAngles,
            excludedAtomIds,
            placementState,
            ringPolygons,
            allowFinePreferredAngles,
            allowDirectPreferredAngle,
            atomGrid
          )
        : pickBestCandidateAngle(fallbackCandidates, bondLength, !childIsHydrogen, {
            anchorPosition,
            coords,
            excludedAtomIds
          }));
    setPlacedPosition(coords, placementState, childAtomId, add(anchorPosition, fromAngle(chosenAngle, bondLength)), layoutGraph);
    if (atomGrid) {
      const childPos = coords.get(childAtomId);
      if (childPos) {
        atomGrid.insert(childAtomId, childPos);
      }
    }
    occupiedAngles.push(chosenAngle);
    placeChildren(adjacency, canonicalAtomRank, coords, placementState, atomIdsToPlace, childAtomId, anchorAtomId, bondLength, layoutGraph, branchConstraints, depth + 1);
  }
}

function placeChildren(
  adjacency,
  canonicalAtomRank,
  coords,
  placementState,
  atomIdsToPlace,
  anchorAtomId,
  parentAtomId,
  bondLength,
  layoutGraph = null,
  branchConstraints = null,
  depth = 0
) {
  const anchorPosition = coords.get(anchorAtomId);
  if (!anchorPosition || depth > MAX_BRANCH_RECURSION_DEPTH) {
    return;
  }
  const unplacedNeighbors = neighborOrder(
    (adjacency.get(anchorAtomId) ?? []).filter(neighborAtomId => atomIdsToPlace.has(neighborAtomId) && !coords.has(neighborAtomId)),
    canonicalAtomRank
  );
  const { primaryNeighborIds, deferredNeighborIds } = splitDeferredLeafNeighbors(unplacedNeighbors, layoutGraph);
  const shouldLeaveDeferredLeavesForLaterPass =
    primaryNeighborIds.length === 0
    && deferredNeighborIds.length > 0
    && hasPendingHeavyNeighborOutsidePlacementSlice(adjacency, atomIdsToPlace, coords, anchorAtomId, layoutGraph);
  const childDescriptors = primaryNeighborIds.map(childAtomId => ({
    childAtomId,
    subtreeSize: subtreeHeavyAtomCount(adjacency, layoutGraph, coords, childAtomId, anchorAtomId)
  }));
  if (primaryNeighborIds.length >= 2 && !shouldUseGreedyBranchPlacement(layoutGraph, atomIdsToPlace, anchorAtomId, primaryNeighborIds, childDescriptors, branchConstraints)) {
    chooseBatchAngleAssignments(
      adjacency,
      canonicalAtomRank,
      coords,
      placementState,
      atomIdsToPlace,
      anchorAtomId,
      parentAtomId,
      primaryNeighborIds,
      bondLength,
      placeChildren,
      layoutGraph,
      branchConstraints,
      depth,
      childDescriptors
    );
  } else {
    placeNeighborSequence(
      adjacency,
      canonicalAtomRank,
      coords,
      placementState,
      atomIdsToPlace,
      anchorAtomId,
      parentAtomId,
      bondLength,
      primaryNeighborIds,
      layoutGraph,
      branchConstraints,
      depth
    );
  }
  if (deferredNeighborIds.length > 0 && !shouldLeaveDeferredLeavesForLaterPass) {
    placeNeighborSequence(
      adjacency,
      canonicalAtomRank,
      coords,
      placementState,
      atomIdsToPlace,
      anchorAtomId,
      parentAtomId,
      bondLength,
      deferredNeighborIds,
      layoutGraph,
      branchConstraints,
      depth
    );
  }
}

/**
 * Fills in the remaining acyclic/substituent atoms around an already placed
 * scaffold by recursively choosing discrete branch directions.
 * @param {Map<string, string[]>} adjacency - Component adjacency map.
 * @param {Map<string, number>} canonicalAtomRank - Canonical atom rank map.
 * @param {Map<string, {x: number, y: number}>} coords - Coordinate map to update.
 * @param {Set<string>} atomIdsToPlace - Eligible atom IDs for this component.
 * @param {string[]} seedAtomIds - Already placed atom IDs.
 * @param {number} bondLength - Target bond length.
 * @param {object|null} [layoutGraph] - Layout graph shell.
 * @param {{angularBudgets?: Map<string, {centerAngle: number, minOffset: number, maxOffset: number}>}|null} [branchConstraints] - Optional branch-angle constraints keyed by anchor atom ID.
 * @param {number} [depth] - Recursive depth guard for pathological graphs.
 * @returns {Map<string, {x: number, y: number}>} Updated coordinate map.
 */
export function placeRemainingBranches(adjacency, canonicalAtomRank, coords, atomIdsToPlace, seedAtomIds, bondLength, layoutGraph = null, branchConstraints = null, depth = 0) {
  if (depth > MAX_BRANCH_RECURSION_DEPTH) {
    return coords;
  }
  const placementState = seedPlacementState(layoutGraph, coords);
  const orderedSeedAtomIds = neighborOrder(
    seedAtomIds.filter(atomId => coords.has(atomId)),
    canonicalAtomRank
  );
  for (const seedAtomId of orderedSeedAtomIds) {
    const placedNeighbors = (adjacency.get(seedAtomId) ?? []).filter(neighborAtomId => coords.has(neighborAtomId) && atomIdsToPlace.has(neighborAtomId));
    const orderedPlacedNeighbors = neighborOrder(placedNeighbors, canonicalAtomRank);
    const parentAtomId = orderedPlacedNeighbors.length === 1 ? orderedPlacedNeighbors[0] : null;
    placeChildren(adjacency, canonicalAtomRank, coords, placementState, atomIdsToPlace, seedAtomId, parentAtomId, bondLength, layoutGraph, branchConstraints, depth);
  }
  return coords;
}

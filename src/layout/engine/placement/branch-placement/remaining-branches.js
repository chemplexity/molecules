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
  hasNonAromaticMultipleBond,
  incidentRingPolygons,
  isExactSmallRingExteriorContinuationEligible,
  isExactRingTrigonalBisectorEligible,
  isExactSimpleAcyclicContinuationEligible,
  isExactVisibleTrigonalBisectorEligible,
  isExactRingOutwardEligibleSubstituent,
  isTerminalMultipleBondLeaf,
  mergeCandidateAngles,
  occupiedNeighborAngles,
  pickBestCandidateAngle,
  preferredBranchAngles,
  resolvedPreferredAngles,
  shouldPreferOmittedHydrogenTrigonalBisector,
  shouldPromotePreferredRingAngle,
  supportsProjectedTetrahedralGeometry
} from './angle-selection.js';
import { chooseBatchAngleAssignments, chooseSingleBranchAngleWithLookahead, shouldUseGreedyBranchPlacement } from './permutations.js';

const SINGLE_BRANCH_LOOKAHEAD_MAX_PARTICIPANTS = 64;

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

function buildBranchPlacementAtomGrid(layoutGraph, coords, bondLength) {
  if (!(bondLength > 0) || coords.size < 160) {
    return null;
  }
  const atomGrid = new AtomGrid(bondLength);
  for (const [atomId, pos] of coords) {
    atomGrid.insert(atomId, pos);
  }
  return atomGrid;
}

function resetBranchPlacementContext(placementContext, layoutGraph, coords, bondLength) {
  placementContext.layoutGraph = layoutGraph;
  placementContext.coords = coords;
  placementContext.bondLength = bondLength;
  placementContext.placementState = seedPlacementState(layoutGraph, coords);
  placementContext.atomGrid = buildBranchPlacementAtomGrid(layoutGraph, coords, bondLength);
  placementContext.ringPolygonsByAnchor = new Map();
  placementContext.needsResync = false;
  return placementContext;
}

function ensureBranchPlacementContext(layoutGraph, coords, bondLength, placementContext = null) {
  const resolvedContext = placementContext ?? {};
  if (
    resolvedContext.layoutGraph !== layoutGraph
    || resolvedContext.coords !== coords
    || resolvedContext.bondLength !== bondLength
    || !resolvedContext.placementState
    || resolvedContext.needsResync === true
    || (!!resolvedContext.atomGrid) !== (bondLength > 0 && coords.size >= 160)
  ) {
    return resetBranchPlacementContext(resolvedContext, layoutGraph, coords, bondLength);
  }
  return resolvedContext;
}

function incidentRingPolygonsForAnchor(layoutGraph, coords, anchorAtomId, placementContext = null) {
  if (!placementContext) {
    return incidentRingPolygons(layoutGraph, coords, anchorAtomId);
  }
  if (!placementContext.ringPolygonsByAnchor.has(anchorAtomId)) {
    placementContext.ringPolygonsByAnchor.set(anchorAtomId, incidentRingPolygons(layoutGraph, coords, anchorAtomId));
  }
  return placementContext.ringPolygonsByAnchor.get(anchorAtomId);
}

/**
 * Returns whether the recursive single-child lookahead is bounded enough for
 * the current placement slice. The lookahead is useful for compact
 * carboxylate-like sidechains, but large peptide-scale slices can spend most
 * of their runtime recursively re-placing whole downstream subtrees.
 * @param {object|null} layoutGraph - Layout graph shell.
 * @param {Set<string>} atomIdsToPlace - Eligible atom IDs in the current placement slice.
 * @returns {boolean} True when single-branch lookahead may run.
 */
function allowsSingleBranchLookahead(layoutGraph, atomIdsToPlace) {
  return (
    (layoutGraph?.traits?.heavyAtomCount ?? 0) <= SINGLE_BRANCH_LOOKAHEAD_MAX_PARTICIPANTS
    && (atomIdsToPlace?.size ?? 0) <= SINGLE_BRANCH_LOOKAHEAD_MAX_PARTICIPANTS
  );
}

function shouldPreferFineAlkylTailRescue(layoutGraph, anchorAtomId, parentAtomId, childAtomId, currentPlacedNeighborIds, preferredAngles) {
  if (
    !layoutGraph
    || !parentAtomId
    || !childAtomId
    || currentPlacedNeighborIds.length !== 1
    || preferredAngles.length < 2
    || (layoutGraph.atomToRings.get(anchorAtomId)?.length ?? 0) > 0
    || (layoutGraph.atomToRings.get(childAtomId)?.length ?? 0) > 0
  ) {
    return false;
  }

  const anchorAtom = layoutGraph.atoms.get(anchorAtomId);
  const childAtom = layoutGraph.atoms.get(childAtomId);
  if (
    !anchorAtom
    || !childAtom
    || anchorAtom.element !== 'C'
    || childAtom.element !== 'C'
    || anchorAtom.aromatic
    || childAtom.aromatic
    || anchorAtom.heavyDegree !== 2
  ) {
    return false;
  }

  const parentBond = findLayoutBond(layoutGraph, anchorAtomId, parentAtomId);
  const childBond = findLayoutBond(layoutGraph, anchorAtomId, childAtomId);
  return (
    !!parentBond
    && !!childBond
    && parentBond.kind === 'covalent'
    && childBond.kind === 'covalent'
    && !parentBond.aromatic
    && !childBond.aromatic
    && (parentBond.order ?? 1) === 1
    && (childBond.order ?? 1) === 1
  );
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
  depth = 0,
  placementContext = null
) {
  const anchorPosition = coords.get(anchorAtomId);
  if (!anchorPosition || neighborAtomIds.length === 0 || depth > MAX_BRANCH_RECURSION_DEPTH) {
    return;
  }

  const occupiedAngles = occupiedNeighborAngles(adjacency, coords, anchorAtomId, atomIdsToPlace);
  const ringPolygons = incidentRingPolygonsForAnchor(layoutGraph, coords, anchorAtomId, placementContext);
  const atomGrid = placementContext?.atomGrid ?? null;

  for (const childAtomId of neighborAtomIds) {
    const currentPlacedNeighborIds = placedNeighborIds(adjacency, coords, anchorAtomId);
    const childBond = childAtomId ? findLayoutBond(layoutGraph, anchorAtomId, childAtomId) : null;
    const preferredAngles = preferredBranchAngles(adjacency, coords, anchorAtomId, atomIdsToPlace, parentAtomId, childAtomId, layoutGraph);
    const excludedAtomIds = new Set([anchorAtomId, ...currentPlacedNeighborIds]);
    const childIsHydrogen = isHydrogenAtom(layoutGraph, childAtomId);
    const childSubtreeSize = childIsHydrogen ? 0 : subtreeHeavyAtomCount(adjacency, layoutGraph, coords, childAtomId, anchorAtomId);
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
    const shouldHonorOmittedHydrogenTrigonalAngle =
      preferredAngles.length > 0
      && !childIsHydrogen
      && currentPlacedNeighborIds.length === 2
      && childBond != null
      && !childBond.aromatic
      && (childBond.order ?? 1) === 1
      && shouldPreferOmittedHydrogenTrigonalBisector(layoutGraph, anchorAtomId);
    const shouldHonorVisibleTrigonalBisectorAngle =
      preferredAngles.length > 0
      && !childIsHydrogen
      && currentPlacedNeighborIds.length === 2
      && childBond != null
      && !childBond.aromatic
      && (childBond.order ?? 1) === 1
      && isExactVisibleTrigonalBisectorEligible(layoutGraph, anchorAtomId, childAtomId);
    const shouldHonorPreferredAngle =
      preferredAngles.length > 0
      && !childIsHydrogen
      && (
        currentPlacedNeighborIds.length === 1
        || isRingAnchor(layoutGraph, anchorAtomId)
        || shouldHonorProjectedTetrahedralAngle
        || shouldHonorOmittedHydrogenTrigonalAngle
        || shouldHonorVisibleTrigonalBisectorAngle
      );
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
    const shouldForceExactOmittedHydrogenTrigonalAngle =
      shouldHonorOmittedHydrogenTrigonalAngle;
    const shouldForceExactVisibleTrigonalAngle =
      shouldHonorVisibleTrigonalBisectorAngle;
    const shouldForceExactProjectedTetrahedralAngle =
      shouldHonorProjectedTetrahedralAngle
      && currentPlacedNeighborIds.length >= 2;
    const shouldUseFineAlkylTailRescue = shouldPreferFineAlkylTailRescue(
      layoutGraph,
      anchorAtomId,
      parentAtomId,
      childAtomId,
      currentPlacedNeighborIds,
      constrainedPreferredAngles
    );
    const allowDirectPreferredAngle =
      !shouldHonorPreferredAngle
      || shouldPromotePreferredRingAngle(layoutGraph, anchorAtomId, childAtomId)
      || shouldForceExactTrigonalAngle
      || shouldForceExactRingTrigonalBisectorAngle
      || shouldForceExactSimpleAcyclicAngle
      || shouldForceExactOmittedHydrogenTrigonalAngle
      || shouldForceExactVisibleTrigonalAngle
      || shouldForceExactProjectedTetrahedralAngle
      || isExactSmallRingExteriorContinuationEligible(layoutGraph, anchorAtomId, childAtomId);
    const exactPreferredAngle =
      (
        (shouldHonorPreferredAngle && isExactRingOutwardEligibleSubstituent(layoutGraph, anchorAtomId, childAtomId))
        || shouldForceExactTrigonalAngle
        || shouldForceExactRingTrigonalBisectorAngle
        || shouldForceExactSimpleAcyclicAngle
        || shouldForceExactOmittedHydrogenTrigonalAngle
        || shouldForceExactVisibleTrigonalAngle
        || shouldForceExactProjectedTetrahedralAngle
      )
        ? chooseExactPreferredAngle(
            anchorPosition,
            bondLength,
            coords,
            occupiedAngles,
            constrainedPreferredAngles,
            excludedAtomIds,
            placementState,
            ringPolygons,
            atomGrid,
            shouldForceExactOmittedHydrogenTrigonalAngle ? { clearanceFloorFactor: 0.5 } : {}
          )
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
            allowFinePreferredAngles || shouldUseFineAlkylTailRescue,
            allowDirectPreferredAngle,
            atomGrid,
            shouldUseFineAlkylTailRescue
          )
        : pickBestCandidateAngle(fallbackCandidates, bondLength, !childIsHydrogen, {
            anchorPosition,
            coords,
            excludedAtomIds
          }));
    const shouldUseSingleBranchLookahead =
      !childIsHydrogen
      && allowsSingleBranchLookahead(layoutGraph, atomIdsToPlace)
      && childBond != null
      && !childBond.aromatic
      && (childBond.order ?? 1) === 1
      && currentPlacedNeighborIds.length === 1
      && constrainedPreferredAngles.length >= 2
      && childSubtreeSize >= 3
      && hasNonAromaticMultipleBond(layoutGraph, childAtomId);
    if (shouldUseSingleBranchLookahead) {
      const lookaheadAngle = chooseSingleBranchAngleWithLookahead(
        adjacency,
        canonicalAtomRank,
        coords,
        placementState,
        atomIdsToPlace,
        anchorAtomId,
        parentAtomId,
        childAtomId,
        mergeCandidateAngles([chosenAngle], constrainedPreferredAngles),
        bondLength,
        placeChildren,
        layoutGraph,
        branchConstraints,
        depth,
        {
          childAtomId,
          subtreeSize: childSubtreeSize
        }
      );
      if (lookaheadAngle != null) {
        occupiedAngles.push(lookaheadAngle);
        continue;
      }
    }
    setPlacedPosition(coords, placementState, childAtomId, add(anchorPosition, fromAngle(chosenAngle, bondLength)), layoutGraph);
    if (atomGrid) {
      const childPos = coords.get(childAtomId);
      if (childPos) {
        atomGrid.insert(childAtomId, childPos);
      }
    }
    occupiedAngles.push(chosenAngle);
    placeChildren(adjacency, canonicalAtomRank, coords, placementState, atomIdsToPlace, childAtomId, anchorAtomId, bondLength, layoutGraph, branchConstraints, depth + 1, placementContext);
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
  depth = 0,
  placementContext = null
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
  const deferredHeavyNeighborIds = deferredNeighborIds.filter(neighborAtomId => !isHydrogenAtom(layoutGraph, neighborAtomId));
  const deferredHydrogenNeighborIds = deferredNeighborIds.filter(neighborAtomId => isHydrogenAtom(layoutGraph, neighborAtomId));
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
      childDescriptors,
      placementContext
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
      depth,
      placementContext
    );
  }
  const shouldBatchDeferredHeavyLeaves =
    deferredHeavyNeighborIds.length >= 2
    && supportsProjectedTetrahedralGeometry(layoutGraph, anchorAtomId);
  if (deferredHeavyNeighborIds.length > 0 && !shouldLeaveDeferredLeavesForLaterPass) {
    if (shouldBatchDeferredHeavyLeaves) {
      chooseBatchAngleAssignments(
        adjacency,
        canonicalAtomRank,
        coords,
        placementState,
        atomIdsToPlace,
        anchorAtomId,
        parentAtomId,
        deferredHeavyNeighborIds,
        bondLength,
        placeChildren,
        layoutGraph,
        branchConstraints,
        depth,
        deferredHeavyNeighborIds.map(childAtomId => ({
          childAtomId,
          subtreeSize: subtreeHeavyAtomCount(adjacency, layoutGraph, coords, childAtomId, anchorAtomId)
        })),
        placementContext
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
        deferredHeavyNeighborIds,
        layoutGraph,
        branchConstraints,
        depth,
        placementContext
      );
    }
  }
  if (deferredHydrogenNeighborIds.length > 0 && !shouldLeaveDeferredLeavesForLaterPass) {
    placeNeighborSequence(
      adjacency,
      canonicalAtomRank,
      coords,
      placementState,
      atomIdsToPlace,
      anchorAtomId,
      parentAtomId,
      bondLength,
      deferredHydrogenNeighborIds,
      layoutGraph,
      branchConstraints,
      depth,
      placementContext
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
 * @param {{placementState?: {sumX: number, sumY: number, count: number, trackedPositions: Map<string, {x: number, y: number}>}, atomGrid?: import('../../geometry/atom-grid.js').AtomGrid|null, ringPolygonsByAnchor?: Map<string, Array<Array<{x: number, y: number}>>>, needsResync?: boolean}|null} [placementContext] - Optional reusable branch-placement context.
 * @returns {Map<string, {x: number, y: number}>} Updated coordinate map.
 */
export function placeRemainingBranches(adjacency, canonicalAtomRank, coords, atomIdsToPlace, seedAtomIds, bondLength, layoutGraph = null, branchConstraints = null, depth = 0, placementContext = null) {
  if (depth > MAX_BRANCH_RECURSION_DEPTH) {
    return coords;
  }
  const resolvedPlacementContext = ensureBranchPlacementContext(layoutGraph, coords, bondLength, placementContext);
  const placementState = resolvedPlacementContext.placementState;
  const orderedSeedAtomIds = neighborOrder(
    seedAtomIds.filter(atomId => coords.has(atomId)),
    canonicalAtomRank
  );
  for (const seedAtomId of orderedSeedAtomIds) {
    const placedNeighbors = (adjacency.get(seedAtomId) ?? []).filter(neighborAtomId => coords.has(neighborAtomId) && atomIdsToPlace.has(neighborAtomId));
    const orderedPlacedNeighbors = neighborOrder(placedNeighbors, canonicalAtomRank);
    const parentAtomId = orderedPlacedNeighbors.length === 1 ? orderedPlacedNeighbors[0] : null;
    placeChildren(adjacency, canonicalAtomRank, coords, placementState, atomIdsToPlace, seedAtomId, parentAtomId, bondLength, layoutGraph, branchConstraints, depth, resolvedPlacementContext);
  }
  return coords;
}

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
  chooseNearPreferredRescueAngle,
  describeCrossLikeHypervalentCenter,
  evaluateAngleCandidates,
  filterAnglesByBudget,
  findLayoutBond,
  hasCrossLikeHypervalentNeighbor,
  hasNonAromaticMultipleBond,
  incidentRingPolygons,
  isExactSmallRingExteriorContinuationEligible,
  isExactRingTrigonalBisectorEligible,
  isExactSimpleAcyclicContinuationEligible,
  isExactVisibleTrigonalBisectorEligible,
  isExactRingOutwardEligibleSubstituent,
  isTerminalMultipleBondLeaf,
  isPlanarConjugatedTertiaryNitrogen,
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
const RING_ANCHOR_SINGLE_BRANCH_LOOKAHEAD_MIN_SUBTREE = 4;

function isFusedOnlyRingSystemAnchor(layoutGraph, atomId) {
  const ringSystemId = layoutGraph?.atomToRingSystemId?.get(atomId);
  const ringSystem = ringSystemId != null ? layoutGraph.ringSystems?.find(candidate => candidate.id === ringSystemId) : null;
  if (!ringSystem || (ringSystem.ringIds?.length ?? 0) <= 1) {
    return false;
  }

  const ringIds = new Set(ringSystem.ringIds);
  const systemConnections = (layoutGraph.ringConnections ?? []).filter(connection => (
    ringIds.has(connection.firstRingId) && ringIds.has(connection.secondRingId)
  ));
  return systemConnections.length > 0 && systemConnections.every(connection => connection.kind === 'fused');
}

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

/**
 * Returns whether an anchor has an unplaced non-aromatic ring neighbor outside
 * the current placement slice.
 * @param {Map<string, string[]>} adjacency - Component adjacency map.
 * @param {Set<string>} atomIdsToPlace - Atom IDs in the current placement slice.
 * @param {Map<string, {x: number, y: number}>} coords - Current coordinate map.
 * @param {string} anchorAtomId - Anchor atom ID.
 * @param {object|null} layoutGraph - Layout graph shell.
 * @returns {boolean} True when a pending non-aromatic ring neighbor remains.
 */
function hasPendingNonAromaticRingNeighborOutsidePlacementSlice(adjacency, atomIdsToPlace, coords, anchorAtomId, layoutGraph) {
  if (!layoutGraph) {
    return false;
  }
  return (adjacency.get(anchorAtomId) ?? []).some(neighborAtomId => {
    if (atomIdsToPlace.has(neighborAtomId) || coords.has(neighborAtomId)) {
      return false;
    }
    const neighborAtom = layoutGraph.atoms.get(neighborAtomId);
    if (!neighborAtom || neighborAtom.element === 'H') {
      return false;
    }
    return (layoutGraph.atomToRings.get(neighborAtomId) ?? []).some(ring => !ring.aromatic);
  });
}

function isTerminalCarbonLeafNeighbor(layoutGraph, anchorAtomId, neighborAtomId) {
  const neighborAtom = layoutGraph?.atoms.get(neighborAtomId);
  if (!neighborAtom || neighborAtom.element !== 'C' || neighborAtom.heavyDegree !== 1) {
    return false;
  }

  const bond = findLayoutBond(layoutGraph, anchorAtomId, neighborAtomId);
  return Boolean(
    bond
    && bond.kind === 'covalent'
    && !bond.aromatic
    && (bond.order ?? 1) === 1
  );
}

/**
 * Returns whether a terminal carbon leaf should wait for an out-of-slice
 * non-aromatic ring neighbor before placement. Planar three-heavy centers need
 * those more constrained ring roots present before a terminal methyl-like leaf
 * can take the exact final trigonal slot; otherwise large mixed components may
 * greedily snap the leaf to a nearby coarse angle before the pending ring
 * arrives.
 * @param {Map<string, string[]>} adjacency - Component adjacency map.
 * @param {Set<string>} atomIdsToPlace - Atom IDs in the current placement slice.
 * @param {Map<string, {x: number, y: number}>} coords - Current coordinate map.
 * @param {string} anchorAtomId - Anchor atom ID.
 * @param {string} neighborAtomId - Candidate terminal carbon leaf atom ID.
 * @param {object|null} layoutGraph - Layout graph shell.
 * @returns {boolean} True when the leaf should be deferred for a later pass.
 */
function shouldDeferTerminalCarbonLeafForPendingTrigonalNeighbor(adjacency, atomIdsToPlace, coords, anchorAtomId, neighborAtomId, layoutGraph) {
  if (
    !layoutGraph
    || (layoutGraph.atomToRings.get(anchorAtomId)?.length ?? 0) > 0
    || !isTerminalCarbonLeafNeighbor(layoutGraph, anchorAtomId, neighborAtomId)
    || !hasPendingNonAromaticRingNeighborOutsidePlacementSlice(adjacency, atomIdsToPlace, coords, anchorAtomId, layoutGraph)
  ) {
    return false;
  }

  const anchorAtom = layoutGraph.atoms.get(anchorAtomId);
  if (!anchorAtom || anchorAtom.element === 'H' || anchorAtom.aromatic || anchorAtom.heavyDegree !== 3) {
    return false;
  }

  return isPlanarConjugatedTertiaryNitrogen(layoutGraph, anchorAtomId);
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

function shouldUseRingAnchorSingleBranchLookahead(
  layoutGraph,
  anchorAtomId,
  childAtomId,
  childBond,
  currentPlacedNeighborIds,
  childSubtreeSize,
  fallbackAngles
) {
  const anchorAtom = layoutGraph?.atoms.get(anchorAtomId);
  const placedRingNeighborCount = currentPlacedNeighborIds.filter(neighborAtomId => (
    (layoutGraph?.atomToRings.get(neighborAtomId)?.length ?? 0) > 0
  )).length;
  return (
    layoutGraph
    && isRingAnchor(layoutGraph, anchorAtomId)
    && anchorAtom?.aromatic !== true
    && (layoutGraph.atomToRings.get(anchorAtomId)?.length ?? 0) >= 2
    && (layoutGraph.atomToRings.get(childAtomId)?.length ?? 0) === 0
    && childBond != null
    && !childBond.aromatic
    && (childBond.order ?? 1) === 1
    && placedRingNeighborCount >= 2
    && childSubtreeSize >= RING_ANCHOR_SINGLE_BRANCH_LOOKAHEAD_MIN_SUBTREE
    && fallbackAngles.length >= 2
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

function branchPlacementExcludedAtomIds(layoutGraph, anchorAtomId, currentPlacedNeighborIds) {
  const excludedAtomIds = new Set([anchorAtomId]);
  const anchorIsRingAtom = isRingAnchor(layoutGraph, anchorAtomId);
  for (const neighborAtomId of currentPlacedNeighborIds) {
    if (anchorIsRingAtom && (layoutGraph?.atomToRings.get(neighborAtomId)?.length ?? 0) > 0) {
      continue;
    }
    excludedAtomIds.add(neighborAtomId);
  }
  return excludedAtomIds;
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
    const excludedAtomIds = branchPlacementExcludedAtomIds(layoutGraph, anchorAtomId, currentPlacedNeighborIds);
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
    const shouldUseNearPreferredTerminalMultipleHeteroRescue =
      shouldForceExactTrigonalAngle
      && layoutGraph?.atoms.get(childAtomId)?.element !== 'C'
      && isFusedOnlyRingSystemAnchor(layoutGraph, anchorAtomId);
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
    const nearPreferredRescueAngle =
      exactPreferredAngle == null
      && shouldUseNearPreferredTerminalMultipleHeteroRescue
        ? chooseNearPreferredRescueAngle(
            anchorPosition,
            bondLength,
            coords,
            occupiedAngles,
            constrainedPreferredAngles,
            excludedAtomIds,
            placementState,
            ringPolygons,
            atomGrid
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
      nearPreferredRescueAngle ??
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
    const shouldUseClassicSingleBranchLookahead =
      childBond != null
      && !childBond.aromatic
      && (childBond.order ?? 1) === 1
      && currentPlacedNeighborIds.length === 1
      && constrainedPreferredAngles.length >= 2
      && childSubtreeSize >= 3
      && hasNonAromaticMultipleBond(layoutGraph, childAtomId);
    const shouldUseRingAnchorLookahead = shouldUseRingAnchorSingleBranchLookahead(
      layoutGraph,
      anchorAtomId,
      childAtomId,
      childBond,
      currentPlacedNeighborIds,
      childSubtreeSize,
      constrainedFallbackAngles
    );
    const shouldUseSingleBranchLookahead =
      !childIsHydrogen
      && allowsSingleBranchLookahead(layoutGraph, atomIdsToPlace)
      && (shouldUseClassicSingleBranchLookahead || shouldUseRingAnchorLookahead);
    if (shouldUseSingleBranchLookahead) {
      const lookaheadCandidateAngles = shouldUseRingAnchorLookahead
        ? mergeCandidateAngles(mergeCandidateAngles([chosenAngle], constrainedPreferredAngles), constrainedFallbackAngles)
        : mergeCandidateAngles([chosenAngle], constrainedPreferredAngles);
      const lookaheadAngle = chooseSingleBranchAngleWithLookahead(
        adjacency,
        canonicalAtomRank,
        coords,
        placementState,
        atomIdsToPlace,
        anchorAtomId,
        parentAtomId,
        childAtomId,
        lookaheadCandidateAngles,
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
  const splitNeighbors = splitDeferredLeafNeighbors(unplacedNeighbors, layoutGraph);
  const pendingTrigonalLeafNeighborIds = splitNeighbors.primaryNeighborIds.filter(neighborAtomId =>
    shouldDeferTerminalCarbonLeafForPendingTrigonalNeighbor(adjacency, atomIdsToPlace, coords, anchorAtomId, neighborAtomId, layoutGraph)
  );
  const pendingTrigonalLeafNeighborIdSet = new Set(pendingTrigonalLeafNeighborIds);
  const basePrimaryNeighborIds = splitNeighbors.primaryNeighborIds.filter(neighborAtomId => !pendingTrigonalLeafNeighborIdSet.has(neighborAtomId));
  const baseDeferredNeighborIds = pendingTrigonalLeafNeighborIds.length > 0
    ? neighborOrder([...splitNeighbors.deferredNeighborIds, ...pendingTrigonalLeafNeighborIds], canonicalAtomRank)
    : splitNeighbors.deferredNeighborIds;
  const crossLikeCenter = describeCrossLikeHypervalentCenter(layoutGraph, anchorAtomId);
  const primaryHypervalentHydrogenIds = crossLikeCenter
    ? baseDeferredNeighborIds.filter(neighborAtomId => (
        isHydrogenAtom(layoutGraph, neighborAtomId)
        && crossLikeCenter.singleNeighborIds.includes(neighborAtomId)
      ))
    : [];
  const primaryNeighborIds = primaryHypervalentHydrogenIds.length > 0
    ? neighborOrder([...basePrimaryNeighborIds, ...primaryHypervalentHydrogenIds], canonicalAtomRank)
    : basePrimaryNeighborIds;
  const primaryHypervalentHydrogenIdSet = new Set(primaryHypervalentHydrogenIds);
  const deferredNeighborIds = primaryHypervalentHydrogenIds.length > 0
    ? baseDeferredNeighborIds.filter(neighborAtomId => !primaryHypervalentHydrogenIdSet.has(neighborAtomId))
    : baseDeferredNeighborIds;
  const deferredHeavyNeighborIds = deferredNeighborIds.filter(neighborAtomId => !isHydrogenAtom(layoutGraph, neighborAtomId));
  const deferredHydrogenNeighborIds = deferredNeighborIds.filter(neighborAtomId => isHydrogenAtom(layoutGraph, neighborAtomId));
  const shouldPromoteDeferredHeavyLeavesForProjectedTetrahedral =
    hasCrossLikeHypervalentNeighbor(layoutGraph, anchorAtomId)
    && supportsProjectedTetrahedralGeometry(layoutGraph, anchorAtomId)
    && primaryNeighborIds.length > 0
    && deferredHeavyNeighborIds.length > 0;
  const placementPrimaryNeighborIds = shouldPromoteDeferredHeavyLeavesForProjectedTetrahedral
    ? neighborOrder([...primaryNeighborIds, ...deferredHeavyNeighborIds], canonicalAtomRank)
    : primaryNeighborIds;
  const placementDeferredHeavyNeighborIds = shouldPromoteDeferredHeavyLeavesForProjectedTetrahedral
    ? []
    : deferredHeavyNeighborIds;
  const shouldLeaveDeferredLeavesForLaterPass =
    placementPrimaryNeighborIds.length === 0
    && deferredNeighborIds.length > 0
    && hasPendingHeavyNeighborOutsidePlacementSlice(adjacency, atomIdsToPlace, coords, anchorAtomId, layoutGraph);
  const childDescriptors = placementPrimaryNeighborIds.map(childAtomId => ({
    childAtomId,
    subtreeSize: subtreeHeavyAtomCount(adjacency, layoutGraph, coords, childAtomId, anchorAtomId)
  }));
  if (placementPrimaryNeighborIds.length >= 2 && !shouldUseGreedyBranchPlacement(layoutGraph, atomIdsToPlace, anchorAtomId, placementPrimaryNeighborIds, childDescriptors, branchConstraints)) {
    chooseBatchAngleAssignments(
      adjacency,
      canonicalAtomRank,
      coords,
      placementState,
      atomIdsToPlace,
      anchorAtomId,
      parentAtomId,
      placementPrimaryNeighborIds,
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
      placementPrimaryNeighborIds,
      layoutGraph,
      branchConstraints,
      depth,
      placementContext
    );
  }
  const shouldBatchDeferredHeavyLeaves =
    placementDeferredHeavyNeighborIds.length >= 2
    && supportsProjectedTetrahedralGeometry(layoutGraph, anchorAtomId);
  if (placementDeferredHeavyNeighborIds.length > 0 && !shouldLeaveDeferredLeavesForLaterPass) {
    if (shouldBatchDeferredHeavyLeaves) {
      chooseBatchAngleAssignments(
        adjacency,
        canonicalAtomRank,
        coords,
        placementState,
        atomIdsToPlace,
        anchorAtomId,
        parentAtomId,
        placementDeferredHeavyNeighborIds,
        bondLength,
        placeChildren,
        layoutGraph,
        branchConstraints,
        depth,
        placementDeferredHeavyNeighborIds.map(childAtomId => ({
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
        placementDeferredHeavyNeighborIds,
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

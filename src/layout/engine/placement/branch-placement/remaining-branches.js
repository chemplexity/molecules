/** @module placement/branch-placement/remaining-branches */

import { add, angularDifference, fromAngle } from '../../geometry/vec2.js';
import { computeIncidentRingOutwardAngles } from '../../geometry/ring-direction.js';
import { segmentsProperlyIntersect } from '../../geometry/segments.js';
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
  chooseAttachmentAngle,
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
  supportsExteriorBranchSpreadRingSize,
  supportsProjectedTetrahedralGeometry
} from './angle-selection.js';
import { chooseBatchAngleAssignments, chooseSingleBranchAngleWithLookahead, shouldUseGreedyBranchPlacement } from './permutations.js';

const SINGLE_BRANCH_LOOKAHEAD_MAX_PARTICIPANTS = 64;
const RING_ANCHOR_SINGLE_BRANCH_LOOKAHEAD_MIN_SUBTREE = 3;
const EXACT_TERMINAL_RING_LEAF_SLOT_ELEMENTS = new Set(['F', 'Cl', 'Br', 'I', 'O', 'S', 'Se']);
const PHOSPHATE_AROMATIC_TAIL_LOOKAHEAD_OFFSETS = Object.freeze([Math.PI / 4, -Math.PI / 4]);
const EXACT_TERMINAL_CARBON_BOND_CROSSING_RESCUE_STEP = Math.PI / 36;
const EXACT_TERMINAL_CARBON_BOND_CROSSING_RESCUE_LIMIT = Math.PI / 2;
const EXACT_TERMINAL_CARBON_BOND_CROSSING_RESCUE_CLEARANCE_FACTOR = 0.68;

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
 * Returns whether an atom should participate in visible heavy-bond checks.
 * @param {object|null} layoutGraph - Layout graph shell.
 * @param {string} atomId - Atom ID to inspect.
 * @returns {boolean} True when the atom is visible and heavy.
 */
function isVisibleHeavyLayoutAtom(layoutGraph, atomId) {
  const atom = layoutGraph?.atoms?.get(atomId);
  return Boolean(atom && atom.element !== 'H' && !(layoutGraph.options?.suppressH && atom.visible === false));
}

/**
 * Returns whether a preferred exact branch would cross an already placed
 * visible heavy bond. Exact terminal ring substituents can otherwise pass the
 * point-clearance test while their bond line cuts through a nearby ring edge.
 * @param {object|null} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Current coordinate map.
 * @param {string} anchorAtomId - Placed branch anchor atom ID.
 * @param {string} childAtomId - Branch child atom ID.
 * @param {number} candidateAngle - Candidate branch angle in radians.
 * @param {number} bondLength - Target bond length.
 * @returns {boolean} True when the candidate branch segment crosses a placed bond.
 */
function branchAngleCrossesExistingVisibleBond(layoutGraph, coords, anchorAtomId, childAtomId, candidateAngle, bondLength) {
  if (!layoutGraph || !coords.has(anchorAtomId) || !(bondLength > 0)) {
    return false;
  }
  const anchorPosition = coords.get(anchorAtomId);
  const childPosition = add(anchorPosition, fromAngle(candidateAngle, bondLength));
  for (const bond of layoutGraph.bonds?.values?.() ?? []) {
    if (
      !bond
      || bond.kind !== 'covalent'
      || bond.a === anchorAtomId
      || bond.b === anchorAtomId
      || bond.a === childAtomId
      || bond.b === childAtomId
      || !isVisibleHeavyLayoutAtom(layoutGraph, bond.a)
      || !isVisibleHeavyLayoutAtom(layoutGraph, bond.b)
      || !coords.has(bond.a)
      || !coords.has(bond.b)
    ) {
      continue;
    }
    if (segmentsProperlyIntersect(anchorPosition, childPosition, coords.get(bond.a), coords.get(bond.b))) {
      return true;
    }
  }
  return false;
}

/**
 * Returns whether a child is a terminal carbon leaf on a ring anchor.
 * @param {object|null} layoutGraph - Layout graph shell.
 * @param {string} anchorAtomId - Branch anchor atom ID.
 * @param {string} childAtomId - Candidate terminal child atom ID.
 * @param {object|null} childBond - Bond between anchor and child.
 * @returns {boolean} True when the child is a terminal carbon ring branch.
 */
function isTerminalCarbonRingBranchLeaf(layoutGraph, anchorAtomId, childAtomId, childBond) {
  const anchorAtom = layoutGraph?.atoms?.get(anchorAtomId);
  const childAtom = layoutGraph?.atoms?.get(childAtomId);
  return Boolean(
    anchorAtom
    && childAtom
    && childBond
    && childBond.kind === 'covalent'
    && !childBond.aromatic
    && (childBond.order ?? 1) === 1
    && childAtom.element === 'C'
    && !childAtom.aromatic
    && !childAtom.chirality
    && childAtom.heavyDegree === 1
    && (layoutGraph.atomToRings.get(anchorAtomId)?.length ?? 0) > 0
    && (layoutGraph.atomToRings.get(childAtomId)?.length ?? 0) === 0
  );
}

/**
 * Builds ordered near-preferred offsets for a terminal carbon bond-crossing rescue.
 * @param {number[]} preferredAngles - Preferred branch angles in radians.
 * @returns {number[]} Candidate rescue angles in radians.
 */
function exactTerminalCarbonBondCrossingRescueAngles(preferredAngles) {
  const rescueOffsets = [];
  for (
    let offset = EXACT_TERMINAL_CARBON_BOND_CROSSING_RESCUE_STEP;
    offset <= EXACT_TERMINAL_CARBON_BOND_CROSSING_RESCUE_LIMIT + 1e-9;
    offset += EXACT_TERMINAL_CARBON_BOND_CROSSING_RESCUE_STEP
  ) {
    rescueOffsets.push(-offset, offset);
  }
  return mergeCandidateAngles(
    [],
    preferredAngles.flatMap(preferredAngle => rescueOffsets.map(offset => preferredAngle + offset))
  );
}

/**
 * Returns the smallest angular miss between a candidate and any preferred angle.
 * @param {number} candidateAngle - Candidate angle in radians.
 * @param {number[]} preferredAngles - Preferred angles in radians.
 * @returns {number} Smallest angular deviation in radians.
 */
function minimumPreferredDeviation(candidateAngle, preferredAngles) {
  let bestDeviation = Number.POSITIVE_INFINITY;
  for (const preferredAngle of preferredAngles) {
    bestDeviation = Math.min(bestDeviation, angularDifference(candidateAngle, preferredAngle));
  }
  return bestDeviation;
}

/**
 * Chooses the nearest safe angle for a terminal carbon ring substituent whose
 * exact outward branch would visibly cross an existing heavy bond.
 * @param {object|null} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Current coordinate map.
 * @param {string} anchorAtomId - Placed branch anchor atom ID.
 * @param {string} childAtomId - Branch child atom ID.
 * @param {number} bondLength - Target bond length.
 * @param {number[]} occupiedAngles - Already occupied anchor-neighbor angles.
 * @param {number[]} preferredAngles - Exact preferred branch angles.
 * @param {Set<string>} excludedAtomIds - Atoms ignored for endpoint clearance.
 * @param {{sumX: number, sumY: number, count: number}} placementState - Running placement center state.
 * @param {Array<Array<{x: number, y: number}>>} ringPolygons - Incident ring polygons.
 * @param {object|null} atomGrid - Optional spatial grid for clearance checks.
 * @returns {number|null} Rescue angle, or null when no clean angle exists.
 */
function chooseExactTerminalCarbonBondCrossingRescueAngle(
  layoutGraph,
  coords,
  anchorAtomId,
  childAtomId,
  bondLength,
  occupiedAngles,
  preferredAngles,
  excludedAtomIds,
  placementState,
  ringPolygons,
  atomGrid
) {
  const anchorPosition = coords.get(anchorAtomId);
  if (!anchorPosition || preferredAngles.length === 0) {
    return null;
  }
  const clearanceFloor = bondLength * EXACT_TERMINAL_CARBON_BOND_CROSSING_RESCUE_CLEARANCE_FACTOR;
  const candidates = evaluateAngleCandidates(
    exactTerminalCarbonBondCrossingRescueAngles(preferredAngles),
    occupiedAngles,
    preferredAngles,
    anchorPosition,
    bondLength,
    coords,
    excludedAtomIds,
    placementState,
    ringPolygons,
    atomGrid
  ).filter(candidate => (
    candidate.isSafe !== false
    && (candidate.insideRingCount ?? 0) === 0
    && (candidate.minSeparation ?? 0) >= Math.PI / 6
    && !branchAngleCrossesExistingVisibleBond(layoutGraph, coords, anchorAtomId, childAtomId, candidate.angle, bondLength)
  ));
  const viableCandidates = candidates.filter(candidate => {
    const candidatePosition = add(anchorPosition, fromAngle(candidate.angle, bondLength));
    for (const [atomId, position] of coords) {
      if (!excludedAtomIds.has(atomId) && Math.hypot(candidatePosition.x - position.x, candidatePosition.y - position.y) < clearanceFloor - 1e-9) {
        return false;
      }
    }
    return true;
  });
  if (viableCandidates.length === 0) {
    return null;
  }

  let bestCandidate = viableCandidates[0];
  let bestDeviation = minimumPreferredDeviation(bestCandidate.angle, preferredAngles);
  for (let index = 1; index < viableCandidates.length; index++) {
    const candidate = viableCandidates[index];
    const deviation = minimumPreferredDeviation(candidate.angle, preferredAngles);
    if (deviation < bestDeviation - 1e-9) {
      bestCandidate = candidate;
      bestDeviation = deviation;
      continue;
    }
    if (Math.abs(deviation - bestDeviation) > 1e-9) {
      continue;
    }
    if ((candidate.minSeparation ?? 0) > (bestCandidate.minSeparation ?? 0)) {
      bestCandidate = candidate;
      continue;
    }
    if (
      (candidate.minSeparation ?? 0) === (bestCandidate.minSeparation ?? 0)
      && candidate.centerDistanceScore > bestCandidate.centerDistanceScore
    ) {
      bestCandidate = candidate;
    }
  }

  return bestCandidate.angle;
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

/**
 * Returns whether a neighbor is a terminal carbon leaf joined to the anchor by
 * an ordinary single covalent bond.
 * @param {object|null} layoutGraph - Layout graph shell.
 * @param {string} anchorAtomId - Anchor atom ID.
 * @param {string} neighborAtomId - Candidate neighbor atom ID.
 * @returns {boolean} True when the neighbor is a terminal carbon leaf.
 */
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

/**
 * Returns whether deferred terminal leaves should still be assigned together
 * because their ring anchor has an exact exterior fan. Halogens normally wait
 * until heavier branches are placed, but `CF2`-like saturated ring atoms need
 * both leaves in one batch so the exact exterior slots can be paired instead
 * of picked greedily one at a time.
 * @param {object|null} layoutGraph - Layout graph shell.
 * @param {string} anchorAtomId - Anchor atom ID.
 * @param {string[]} deferredHeavyNeighborIds - Deferred heavy leaf IDs.
 * @returns {boolean} True when the deferred leaves should use batch placement.
 */
function shouldBatchSmallRingExteriorDeferredLeaves(layoutGraph, anchorAtomId, deferredHeavyNeighborIds) {
  return (
    deferredHeavyNeighborIds.length >= 2
    && deferredHeavyNeighborIds.every(neighborAtomId =>
      isExactSmallRingExteriorContinuationEligible(layoutGraph, anchorAtomId, neighborAtomId)
    )
  );
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

/**
 * Returns whether the anchor belongs to an aromatic ring with an exocyclic
 * oxygen-phosphorus substituent. Phosphate-bound aryl rings tend to be placed
 * near sibling aryl blocks, so short alkyl tails need a little downstream
 * context before committing to the first ring-exterior slot.
 * @param {object|null} layoutGraph - Layout graph shell.
 * @param {string} anchorAtomId - Aromatic ring anchor atom ID.
 * @returns {boolean} True when the anchor ring is phosphate-bound.
 */
function isPhosphateBoundAromaticRing(layoutGraph, anchorAtomId) {
  if (!layoutGraph) {
    return false;
  }
  const rings = layoutGraph.atomToRings.get(anchorAtomId) ?? [];
  for (const ring of rings) {
    if (ring?.aromatic !== true || !Array.isArray(ring.atomIds)) {
      continue;
    }
    const ringAtomIds = new Set(ring.atomIds);
    for (const ringAtomId of ring.atomIds) {
      for (const exocyclicBond of layoutGraph.bondsByAtomId.get(ringAtomId) ?? []) {
        if (!exocyclicBond || exocyclicBond.kind !== 'covalent' || exocyclicBond.aromatic || (exocyclicBond.order ?? 1) !== 1) {
          continue;
        }
        const oxygenAtomId = exocyclicBond.a === ringAtomId ? exocyclicBond.b : exocyclicBond.a;
        if (ringAtomIds.has(oxygenAtomId) || layoutGraph.atoms.get(oxygenAtomId)?.element !== 'O') {
          continue;
        }
        for (const oxygenBond of layoutGraph.bondsByAtomId.get(oxygenAtomId) ?? []) {
          if (!oxygenBond || oxygenBond.kind !== 'covalent' || oxygenBond.aromatic) {
            continue;
          }
          const neighborAtomId = oxygenBond.a === oxygenAtomId ? oxygenBond.b : oxygenBond.a;
          if (neighborAtomId !== ringAtomId && layoutGraph.atoms.get(neighborAtomId)?.element === 'P') {
            return true;
          }
        }
      }
    }
  }
  return false;
}

/**
 * Returns whether a branch is a compact unbranched hydrocarbon tail rooted on
 * an aromatic ring. These aryl alkyl/propargyl tails are small enough for
 * recursive lookahead on phosphate-bound aryl clusters and can otherwise fold
 * back through neighboring rings when the first outward slot leaves the second
 * bond boxed in.
 * @param {object|null} layoutGraph - Layout graph shell.
 * @param {string} anchorAtomId - Ring anchor atom ID.
 * @param {string} childAtomId - Outgoing child atom ID.
 * @param {number} childSubtreeSize - Heavy atom count below the child.
 * @returns {boolean} True when the branch is a compact aromatic hydrocarbon tail.
 */
function isCompactAromaticHydrocarbonTail(layoutGraph, anchorAtomId, childAtomId, childSubtreeSize) {
  if (!layoutGraph || childSubtreeSize !== RING_ANCHOR_SINGLE_BRANCH_LOOKAHEAD_MIN_SUBTREE) {
    return false;
  }

  const visited = new Set([anchorAtomId]);
  const queue = [childAtomId];
  let heavyAtomCount = 0;
  while (queue.length > 0) {
    const atomId = queue.pop();
    if (visited.has(atomId)) {
      continue;
    }
    visited.add(atomId);
    const atom = layoutGraph.atoms.get(atomId);
    if (!atom || (layoutGraph.atomToRings.get(atomId)?.length ?? 0) > 0) {
      return false;
    }
    if (atom.element === 'H') {
      continue;
    }
    if (atom.element !== 'C' || atom.aromatic || (atom.heavyDegree ?? 0) > 2) {
      return false;
    }
    heavyAtomCount++;
    for (const bond of layoutGraph.bondsByAtomId.get(atomId) ?? []) {
      if (!bond || bond.kind !== 'covalent' || bond.aromatic) {
        return false;
      }
      const neighborAtomId = bond.a === atomId ? bond.b : bond.a;
      if (!visited.has(neighborAtomId)) {
        queue.push(neighborAtomId);
      }
    }
  }

  return heavyAtomCount === childSubtreeSize;
}

/**
 * Returns whether a ring-rooted branch is a compact terminal multiple-bond
 * group, such as a nitrile, whose first bond should be scored together with
 * the downstream linear leaf.
 * @param {object|null} layoutGraph - Layout graph shell.
 * @param {string} anchorAtomId - Placed ring anchor atom ID.
 * @param {string} childAtomId - Outgoing branch-root atom ID.
 * @param {object|null} childBond - Bond from the anchor to the branch root.
 * @returns {boolean} True when the branch root owns one terminal multiple-bond leaf.
 */
function isTerminalMultipleBranchRoot(layoutGraph, anchorAtomId, childAtomId, childBond) {
  const childAtom = layoutGraph?.atoms.get(childAtomId);
  if (
    !layoutGraph
    || !childAtom
    || childAtom.element === 'H'
    || childAtom.aromatic
    || (layoutGraph.atomToRings.get(childAtomId)?.length ?? 0) > 0
    || !childBond
    || childBond.kind !== 'covalent'
    || childBond.aromatic
    || (childBond.order ?? 1) !== 1
  ) {
    return false;
  }

  let terminalMultipleLeafCount = 0;
  for (const bond of layoutGraph.bondsByAtomId.get(childAtomId) ?? []) {
    if (!bond || bond.kind !== 'covalent') {
      continue;
    }
    const neighborAtomId = bond.a === childAtomId ? bond.b : bond.a;
    if (neighborAtomId === anchorAtomId) {
      continue;
    }
    if (isTerminalMultipleBondLeaf(layoutGraph, childAtomId, bond)) {
      terminalMultipleLeafCount++;
      continue;
    }
    const neighborAtom = layoutGraph.atoms.get(neighborAtomId);
    if (neighborAtom && neighborAtom.element !== 'H') {
      return false;
    }
  }
  return terminalMultipleLeafCount === 1;
}

function phosphateAromaticTailLookaheadAngles(layoutGraph, anchorAtomId, childAtomId, childSubtreeSize, preferredAngles) {
  if (
    layoutGraph?.atoms.get(anchorAtomId)?.aromatic !== true
    || (layoutGraph.atomToRings.get(anchorAtomId)?.length ?? 0) !== 1
    || !isPhosphateBoundAromaticRing(layoutGraph, anchorAtomId)
    || !isCompactAromaticHydrocarbonTail(layoutGraph, anchorAtomId, childAtomId, childSubtreeSize)
  ) {
    return [];
  }
  return (preferredAngles ?? []).flatMap(preferredAngle =>
    PHOSPHATE_AROMATIC_TAIL_LOOKAHEAD_OFFSETS.map(offset => preferredAngle + offset)
  );
}

/**
 * Returns whether a ring-anchored outgoing branch should be placed with
 * recursive lookahead instead of a greedy first-bond choice. Compact
 * allyl-sized tails can still fold their second atom back into fused, bridged,
 * or crowded aromatic ring scaffolds, so three heavy atoms is enough to
 * justify the bounded candidate search.
 * @param {object|null} layoutGraph - Layout graph shell.
 * @param {string} anchorAtomId - Ring anchor atom ID.
 * @param {string} childAtomId - Outgoing child atom ID.
 * @param {object|null} childBond - Bond from anchor to child.
 * @param {string[]} currentPlacedNeighborIds - Already placed anchor neighbors.
 * @param {number} childSubtreeSize - Heavy atom count below the child.
 * @param {number[]} fallbackAngles - Fallback candidate angles.
 * @returns {boolean} True when single-branch lookahead should score the tail.
 */
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
  const ringCount = layoutGraph?.atomToRings.get(anchorAtomId)?.length ?? 0;
  const useAromaticTailLookahead =
    anchorAtom?.aromatic === true
    && ringCount === 1
    && isPhosphateBoundAromaticRing(layoutGraph, anchorAtomId)
    && isCompactAromaticHydrocarbonTail(layoutGraph, anchorAtomId, childAtomId, childSubtreeSize);
  const useSaturatedMultiRingLookahead = anchorAtom?.aromatic !== true && ringCount >= 2;
  const useTerminalMultipleLookahead = isTerminalMultipleBranchRoot(layoutGraph, anchorAtomId, childAtomId, childBond);
  return (
    layoutGraph
    && isRingAnchor(layoutGraph, anchorAtomId)
    && (useSaturatedMultiRingLookahead || useAromaticTailLookahead)
    && (layoutGraph.atomToRings.get(childAtomId)?.length ?? 0) === 0
    && childBond != null
    && !childBond.aromatic
    && (childBond.order ?? 1) === 1
    && placedRingNeighborCount >= 2
    && (childSubtreeSize >= RING_ANCHOR_SINGLE_BRANCH_LOOKAHEAD_MIN_SUBTREE || useTerminalMultipleLookahead)
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

/**
 * Returns terminal hetero leaves attached to a ring atom.
 * @param {object|null} layoutGraph - Layout graph shell.
 * @param {string} anchorAtomId - Ring anchor atom ID.
 * @param {string|null} skipLeafAtomId - Optional leaf atom ID to ignore.
 * @returns {string[]} Terminal hetero leaf atom IDs.
 */
function terminalRingLeafIds(layoutGraph, anchorAtomId, skipLeafAtomId) {
  const leafAtomIds = [];
  for (const bond of layoutGraph?.bondsByAtomId.get(anchorAtomId) ?? []) {
    if (!bond || bond.kind !== 'covalent' || bond.inRing || bond.aromatic || (bond.order ?? 1) !== 1) {
      continue;
    }
    const neighborAtomId = bond.a === anchorAtomId ? bond.b : bond.a;
    if (neighborAtomId === skipLeafAtomId) {
      continue;
    }
    const neighborAtom = layoutGraph.atoms.get(neighborAtomId);
    if (
      !neighborAtom
      || !EXACT_TERMINAL_RING_LEAF_SLOT_ELEMENTS.has(neighborAtom.element)
      || (neighborAtom.heavyDegree ?? 0) !== 1
      || (layoutGraph.atomToRings.get(neighborAtomId)?.length ?? 0) > 0
    ) {
      continue;
    }
    leafAtomIds.push(neighborAtomId);
  }
  return leafAtomIds;
}

/**
 * Returns exact outward slot points for existing terminal hetero leaves on
 * ring anchors. Branch placement uses these as reserved publication-style
 * positions even when a provisional leaf pose has bent away from the slot.
 * @param {object|null} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Current coordinate map.
 * @param {number} bondLength - Target bond length.
 * @param {string|null} [skipLeafAtomId] - Leaf atom ID currently being placed.
 * @returns {Array<{x: number, y: number}>} Exact terminal ring-leaf slot points.
 */
function exactTerminalRingLeafSlotPoints(layoutGraph, coords, bondLength, skipLeafAtomId = null) {
  if (!layoutGraph || !(bondLength > 0)) {
    return [];
  }

  const slotPoints = [];
  for (const [anchorAtomId, anchorPosition] of coords) {
    if ((layoutGraph.atomToRings.get(anchorAtomId)?.length ?? 0) === 0) {
      continue;
    }
    const leafAtomIds = terminalRingLeafIds(layoutGraph, anchorAtomId, skipLeafAtomId);
    if (leafAtomIds.length === 0) {
      continue;
    }
    const outwardAngles = computeIncidentRingOutwardAngles(layoutGraph, anchorAtomId, atomId => coords.get(atomId) ?? null);
    for (const outwardAngle of outwardAngles) {
      for (const leafAtomId of leafAtomIds) {
        if (!coords.has(leafAtomId)) {
          continue;
        }
        slotPoints.push(add(anchorPosition, fromAngle(outwardAngle, bondLength)));
      }
    }
  }
  return slotPoints;
}

/**
 * Returns whether a pending ring root has enough local topology to preview its
 * first ring-neighbor positions.
 * @param {object|null} layoutGraph - Layout graph shell.
 * @param {string} ringRootAtomId - Pending ring-root atom ID.
 * @returns {boolean} True when the ring root can be previewed.
 */
function ringRootHasPreviewableNeighbors(layoutGraph, ringRootAtomId) {
  const ring = (layoutGraph?.atomToRings.get(ringRootAtomId) ?? [])[0];
  if (!ring || !supportsExteriorBranchSpreadRingSize(ring.atomIds?.length ?? 0)) {
    return false;
  }
  let ringNeighborCount = 0;
  for (const bond of layoutGraph.bondsByAtomId.get(ringRootAtomId) ?? []) {
    if (!bond || bond.kind !== 'covalent' || !bond.inRing) {
      continue;
    }
    const neighborAtomId = bond.a === ringRootAtomId ? bond.b : bond.a;
    const neighborAtom = layoutGraph.atoms.get(neighborAtomId);
    if (neighborAtom && neighborAtom.element !== 'H') {
      ringNeighborCount++;
    }
  }
  return ringNeighborCount >= 2;
}

/**
 * Projects terminal hetero-leaf slots on the first neighbors of a future ring.
 * @param {object|null} layoutGraph - Layout graph shell.
 * @param {{x: number, y: number}} ringRootPosition - Previewed ring-root position.
 * @param {number} rootParentAngle - Angle from the future root back to its parent.
 * @param {number} bondLength - Target bond length.
 * @param {string} ringRootAtomId - Pending ring-root atom ID.
 * @returns {Array<{x: number, y: number}>} Future terminal leaf slot points.
 */
function futureRingTerminalLeafSlotPoints(layoutGraph, ringRootPosition, rootParentAngle, bondLength, ringRootAtomId) {
  const ring = (layoutGraph?.atomToRings.get(ringRootAtomId) ?? [])[0];
  const ringAtomIds = ring?.atomIds ?? [];
  const ringRootIndex = ringAtomIds.indexOf(ringRootAtomId);
  if (!ring || ringRootIndex < 0 || !supportsExteriorBranchSpreadRingSize(ringAtomIds.length)) {
    return [];
  }

  const previousRingNeighborId = ringAtomIds[(ringRootIndex - 1 + ringAtomIds.length) % ringAtomIds.length];
  const nextRingNeighborId = ringAtomIds[(ringRootIndex + 1) % ringAtomIds.length];
  const firstRingNeighborPosition = add(ringRootPosition, fromAngle(rootParentAngle + (2 * Math.PI) / 3, bondLength));
  const secondRingNeighborPosition = add(ringRootPosition, fromAngle(rootParentAngle - (2 * Math.PI) / 3, bondLength));
  const descriptors = [
    {
      anchorAtomId: previousRingNeighborId,
      anchorPosition: firstRingNeighborPosition,
      leafAngle: rootParentAngle + Math.PI / 3
    },
    {
      anchorAtomId: nextRingNeighborId,
      anchorPosition: secondRingNeighborPosition,
      leafAngle: rootParentAngle - Math.PI / 3
    }
  ];

  const slotPoints = [];
  for (const descriptor of descriptors) {
    for (const leafAtomId of terminalRingLeafIds(layoutGraph, descriptor.anchorAtomId, null)) {
      const leafAtom = layoutGraph.atoms.get(leafAtomId);
      if (!leafAtom || leafAtom.visible === false) {
        continue;
      }
      slotPoints.push(add(descriptor.anchorPosition, fromAngle(descriptor.leafAngle, bondLength)));
    }
  }
  return slotPoints;
}

/**
 * Previews exact terminal hetero-leaf slots for ring roots that are attached
 * to already placed atoms but have not been placed yet. This gives flexible
 * acyclic continuations a chance to choose the open mirror slot before a later
 * ring leaf is forced to bend.
 * @param {Map<string, string[]>} adjacency - Component adjacency map.
 * @param {object|null} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Current coordinate map.
 * @param {Set<string>} atomIdsToPlace - Eligible atom IDs in the current placement slice.
 * @param {number} bondLength - Target bond length.
 * @param {{angularBudgets?: Map<string, {centerAngle: number, minOffset: number, maxOffset: number, preferredAngle: number}>}|null} branchConstraints - Optional branch constraints.
 * @returns {Array<{x: number, y: number}>} Future terminal ring-leaf slot points.
 */
function futureTerminalRingLeafSlotPoints(adjacency, layoutGraph, coords, atomIdsToPlace, bondLength, branchConstraints) {
  if (!layoutGraph || !(bondLength > 0)) {
    return [];
  }

  const slotPoints = [];
  const seenRingRoots = new Set();
  for (const [anchorAtomId, anchorPosition] of coords) {
    for (const bond of layoutGraph.bondsByAtomId.get(anchorAtomId) ?? []) {
      if (!bond || bond.kind !== 'covalent' || bond.aromatic || (bond.order ?? 1) !== 1) {
        continue;
      }
      const ringRootAtomId = bond.a === anchorAtomId ? bond.b : bond.a;
      if (
        coords.has(ringRootAtomId)
        || seenRingRoots.has(ringRootAtomId)
        || !ringRootHasPreviewableNeighbors(layoutGraph, ringRootAtomId)
      ) {
        continue;
      }
      seenRingRoots.add(ringRootAtomId);
      const attachmentAngle = chooseAttachmentAngle(
        adjacency,
        coords,
        anchorAtomId,
        atomIdsToPlace,
        null,
        layoutGraph,
        ringRootAtomId,
        branchConstraints
      );
      const ringRootPosition = add(anchorPosition, fromAngle(attachmentAngle, bondLength));
      slotPoints.push(
        ...futureRingTerminalLeafSlotPoints(
          layoutGraph,
          ringRootPosition,
          attachmentAngle + Math.PI,
          bondLength,
          ringRootAtomId
        )
      );
    }
  }
  return slotPoints;
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
    const shouldAvoidTerminalRingLeafSlots =
      shouldForceExactSimpleAcyclicAngle
      && (layoutGraph?.atomToRings.get(childAtomId)?.length ?? 0) === 0;
    const exactPreferredAvoidPoints = shouldAvoidTerminalRingLeafSlots && constrainedPreferredAngles.length > 1
      ? [
          ...exactTerminalRingLeafSlotPoints(layoutGraph, coords, bondLength, childAtomId),
          ...futureTerminalRingLeafSlotPoints(adjacency, layoutGraph, coords, atomIdsToPlace, bondLength, branchConstraints)
        ]
      : [];
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
            {
              ...(shouldForceExactOmittedHydrogenTrigonalAngle ? { clearanceFloorFactor: 0.5 } : {}),
              avoidPoints: exactPreferredAvoidPoints
            }
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
    const exactPreferredBondCrossingRescueAngle =
      exactPreferredAngle != null
      && isTerminalCarbonRingBranchLeaf(layoutGraph, anchorAtomId, childAtomId, childBond)
      && branchAngleCrossesExistingVisibleBond(layoutGraph, coords, anchorAtomId, childAtomId, exactPreferredAngle, bondLength)
        ? chooseExactTerminalCarbonBondCrossingRescueAngle(
            layoutGraph,
            coords,
            anchorAtomId,
            childAtomId,
            bondLength,
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
    const initialChosenAngle =
      exactPreferredBondCrossingRescueAngle ??
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
    const terminalBondCrossingRescueAngle =
      exactPreferredBondCrossingRescueAngle == null
      && isTerminalCarbonRingBranchLeaf(layoutGraph, anchorAtomId, childAtomId, childBond)
      && branchAngleCrossesExistingVisibleBond(layoutGraph, coords, anchorAtomId, childAtomId, initialChosenAngle, bondLength)
        ? (
            chooseExactTerminalCarbonBondCrossingRescueAngle(
              layoutGraph,
              coords,
              anchorAtomId,
              childAtomId,
              bondLength,
              occupiedAngles,
              constrainedPreferredAngles.length > 0 ? constrainedPreferredAngles : [initialChosenAngle],
              excludedAtomIds,
              placementState,
              ringPolygons,
              atomGrid
            ) ?? initialChosenAngle
          )
        : null;
    const chosenAngle =
      terminalBondCrossingRescueAngle ??
      initialChosenAngle;
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
      const phosphateTailLookaheadAngles = shouldUseRingAnchorLookahead
        ? phosphateAromaticTailLookaheadAngles(
            layoutGraph,
            anchorAtomId,
            childAtomId,
            childSubtreeSize,
            constrainedPreferredAngles
          )
        : [];
      const lookaheadCandidateAngles = shouldUseRingAnchorLookahead
        ? mergeCandidateAngles(
            mergeCandidateAngles(
              mergeCandidateAngles([chosenAngle], constrainedPreferredAngles),
              phosphateTailLookaheadAngles
            ),
            constrainedFallbackAngles
          )
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
    && (
      supportsProjectedTetrahedralGeometry(layoutGraph, anchorAtomId)
      || shouldBatchSmallRingExteriorDeferredLeaves(layoutGraph, anchorAtomId, placementDeferredHeavyNeighborIds)
    );
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

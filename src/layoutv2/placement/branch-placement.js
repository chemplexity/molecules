/** @module placement/branch-placement */

import { add, angleOf, angularDifference, centroid, distance, fromAngle, length, perpLeft, sub } from '../geometry/vec2.js';
import { measureLayoutCost } from '../audit/invariants.js';
import { compareCanonicalAtomIds } from '../topology/canonical-order.js';

const DISCRETE_BRANCH_ANGLES = Array.from({ length: 12 }, (_, index) => (index * Math.PI) / 6);
const CHAIN_CONTINUATION_OFFSET = Math.PI / 3;
const CENTERED_NEIGHBOR_EPSILON = 1e-6;
const DEG60 = Math.PI / 3;
const DEG120 = (2 * Math.PI) / 3;
const ANGLE_SCORE_TIEBREAK_RATIO = 0.05;
const MAX_BRANCH_RECURSION_DEPTH = 120;

function neighborOrder(neighbors, canonicalAtomRank) {
  return [...neighbors].sort((firstAtomId, secondAtomId) => compareCanonicalAtomIds(firstAtomId, secondAtomId, canonicalAtomRank));
}

function occupiedNeighborAngles(adjacency, coords, anchorAtomId, _atomIdsToPlace) {
  const occupiedAngles = [];
  for (const neighborAtomId of adjacency.get(anchorAtomId) ?? []) {
    if (!coords.has(neighborAtomId)) {
      continue;
    }
    occupiedAngles.push(angleOf(sub(coords.get(neighborAtomId), coords.get(anchorAtomId))));
  }
  return occupiedAngles;
}

function scoreCandidateAngle(candidateAngle, occupiedAngles, preferredAngles) {
  const minSeparation = occupiedAngles.length === 0
    ? Math.PI
    : Math.min(...occupiedAngles.map(occupiedAngle => angularDifference(candidateAngle, occupiedAngle)));
  const preferredPenalty = !preferredAngles || preferredAngles.length === 0
    ? 0
    : Math.min(...preferredAngles.map(preferredAngle => angularDifference(candidateAngle, preferredAngle)));
  return (minSeparation * 100) - preferredPenalty;
}

/**
 * Returns whether an atom should contribute to the running placement CoM.
 * @param {object|null} layoutGraph - Layout graph shell.
 * @param {string} atomId - Atom ID.
 * @returns {boolean} True when the atom should be tracked.
 */
function shouldTrackPlacementAtom(layoutGraph, atomId) {
  if (!layoutGraph) {
    return true;
  }
  const atom = layoutGraph.atoms.get(atomId);
  return Boolean(atom) && atom.visible !== false;
}

/**
 * Creates the running CoM state used during recursive branch placement.
 * @param {object|null} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Current coordinate map.
 * @returns {{sumX: number, sumY: number, count: number, trackedPositions: Map<string, {x: number, y: number}>}} Placement state.
 */
function seedPlacementState(layoutGraph, coords) {
  const trackedPositions = new Map();
  let sumX = 0;
  let sumY = 0;
  let count = 0;

  const seedPosition = (atomId, position) => {
    if (!position || trackedPositions.has(atomId) || !shouldTrackPlacementAtom(layoutGraph, atomId)) {
      return;
    }
    trackedPositions.set(atomId, { ...position });
    sumX += position.x;
    sumY += position.y;
    count++;
  };

  for (const [atomId, position] of coords) {
    seedPosition(atomId, position);
  }
  for (const [atomId, position] of layoutGraph?.fixedCoords ?? []) {
    seedPosition(atomId, position);
  }

  return {
    sumX,
    sumY,
    count,
    trackedPositions
  };
}

/**
 * Clones the mutable placement CoM state for branch-placement backtracking.
 * @param {{sumX: number, sumY: number, count: number, trackedPositions: Map<string, {x: number, y: number}>}} placementState - Placement state.
 * @returns {{sumX: number, sumY: number, count: number, trackedPositions: Map<string, {x: number, y: number}>}} Cloned state.
 */
function clonePlacementState(placementState) {
  return {
    sumX: placementState.sumX,
    sumY: placementState.sumY,
    count: placementState.count,
    trackedPositions: new Map([...placementState.trackedPositions.entries()].map(([atomId, position]) => [atomId, { ...position }]))
  };
}

/**
 * Overwrites a placement state with a chosen backtracked candidate state.
 * @param {{sumX: number, sumY: number, count: number, trackedPositions: Map<string, {x: number, y: number}>}} targetState - State to mutate.
 * @param {{sumX: number, sumY: number, count: number, trackedPositions: Map<string, {x: number, y: number}>}} sourceState - Winning state.
 * @returns {void}
 */
function copyPlacementState(targetState, sourceState) {
  targetState.sumX = sourceState.sumX;
  targetState.sumY = sourceState.sumY;
  targetState.count = sourceState.count;
  targetState.trackedPositions = new Map([...sourceState.trackedPositions.entries()].map(([atomId, position]) => [atomId, { ...position }]));
}

/**
 * Records a newly placed atom position in both the coordinate map and CoM state.
 * @param {Map<string, {x: number, y: number}>} coords - Coordinate map to update.
 * @param {{sumX: number, sumY: number, count: number, trackedPositions: Map<string, {x: number, y: number}>}} placementState - Mutable placement state.
 * @param {string} atomId - Atom ID.
 * @param {{x: number, y: number}} position - New atom position.
 * @param {object|null} layoutGraph - Layout graph shell.
 * @returns {void}
 */
function setPlacedPosition(coords, placementState, atomId, position, layoutGraph) {
  coords.set(atomId, { ...position });
  if (!shouldTrackPlacementAtom(layoutGraph, atomId)) {
    placementState.trackedPositions.delete(atomId);
    return;
  }

  const previousPosition = placementState.trackedPositions.get(atomId);
  if (previousPosition) {
    placementState.sumX -= previousPosition.x;
    placementState.sumY -= previousPosition.y;
  } else {
    placementState.count++;
  }

  placementState.trackedPositions.set(atomId, { ...position });
  placementState.sumX += position.x;
  placementState.sumY += position.y;
}

/**
 * Returns the distance from a candidate position to the current placement CoM.
 * @param {{sumX: number, sumY: number, count: number}} placementState - Placement state.
 * @param {{x: number, y: number}} candidatePosition - Candidate atom position.
 * @returns {number} Distance from the current CoM.
 */
function centerDistanceScore(placementState, candidatePosition) {
  if (!placementState || placementState.count <= 0) {
    return 0;
  }
  const centerX = placementState.sumX / placementState.count;
  const centerY = placementState.sumY / placementState.count;
  return Math.hypot(candidatePosition.x - centerX, candidatePosition.y - centerY);
}

function chooseBranchAngle(occupiedAngles, preferredAngles = []) {
  let bestAngle = DISCRETE_BRANCH_ANGLES[0];
  let bestScore = Number.NEGATIVE_INFINITY;
  for (const candidateAngle of DISCRETE_BRANCH_ANGLES) {
    const score = scoreCandidateAngle(candidateAngle, occupiedAngles, preferredAngles);
    if (score > bestScore) {
      bestScore = score;
      bestAngle = candidateAngle;
    }
  }
  return bestAngle;
}

function nearestDiscreteAngle(targetAngle) {
  let bestAngle = DISCRETE_BRANCH_ANGLES[0];
  let bestDifference = Number.POSITIVE_INFINITY;
  for (const candidateAngle of DISCRETE_BRANCH_ANGLES) {
    const difference = angularDifference(candidateAngle, targetAngle);
    if (difference < bestDifference) {
      bestDifference = difference;
      bestAngle = candidateAngle;
    }
  }
  return bestAngle;
}

function preferredDiscreteAngles(preferredAngles) {
  const uniqueAngles = new Set();
  for (const preferredAngle of preferredAngles) {
    uniqueAngles.add(nearestDiscreteAngle(preferredAngle));
  }
  return [...uniqueAngles];
}

function findLayoutBond(layoutGraph, firstAtomId, secondAtomId) {
  if (!layoutGraph) {
    return null;
  }
  for (const bond of layoutGraph.bonds.values()) {
    if ((bond.a === firstAtomId && bond.b === secondAtomId) || (bond.a === secondAtomId && bond.b === firstAtomId)) {
      return bond;
    }
  }
  return null;
}

function hasNonAromaticMultipleBond(layoutGraph, atomId) {
  if (!layoutGraph) {
    return false;
  }
  for (const bond of layoutGraph.bonds.values()) {
    if ((bond.a !== atomId && bond.b !== atomId) || bond.aromatic) {
      continue;
    }
    if ((bond.order ?? 1) >= 2) {
      return true;
    }
  }
  return false;
}

function isLinearCenter(layoutGraph, atomId) {
  if (!layoutGraph) {
    return false;
  }
  let doubleCount = 0;
  for (const bond of layoutGraph.bonds.values()) {
    if ((bond.a !== atomId && bond.b !== atomId) || bond.aromatic) {
      continue;
    }
    const order = bond.order ?? 1;
    if (order >= 3) {
      return true;
    }
    if (order >= 2) {
      doubleCount++;
    }
  }
  return doubleCount >= 2;
}

function preferredRingAngles(layoutGraph, coords, anchorAtomId) {
  if (!layoutGraph || !coords.has(anchorAtomId)) {
    return [];
  }
  const anchorPosition = coords.get(anchorAtomId);
  const ringAngles = [];
  for (const ring of layoutGraph.rings) {
    if (!ring.atomIds.includes(anchorAtomId)) {
      continue;
    }
    const placedRingPositions = ring.atomIds
      .filter(atomId => coords.has(atomId))
      .map(atomId => coords.get(atomId));
    if (placedRingPositions.length < 3) {
      continue;
    }
    const ringCenter = centroid(placedRingPositions);
    const outwardVector = sub(anchorPosition, ringCenter);
    if (length(outwardVector) <= CENTERED_NEIGHBOR_EPSILON) {
      continue;
    }
    ringAngles.push(angleOf(outwardVector));
  }
  return ringAngles;
}

function prefersLinearContinuation(layoutGraph, anchorAtomId, parentAtomId, childAtomId) {
  if (!layoutGraph || !parentAtomId || !childAtomId) {
    return false;
  }
  const parentBond = findLayoutBond(layoutGraph, anchorAtomId, parentAtomId);
  const childBond = findLayoutBond(layoutGraph, anchorAtomId, childAtomId);
  return (parentBond?.order ?? 1) >= 3 || (childBond?.order ?? 1) >= 3;
}

function candidateClearanceScore(anchorPosition, candidateAngle, bondLength, coords, excludedAtomIds) {
  const candidatePosition = add(anchorPosition, fromAngle(candidateAngle, bondLength));
  let minDistance = Number.POSITIVE_INFINITY;
  for (const [atomId, position] of coords) {
    if (excludedAtomIds.has(atomId)) {
      continue;
    }
    minDistance = Math.min(minDistance, distance(candidatePosition, position));
  }
  return Number.isFinite(minDistance) ? minDistance : 0;
}

function pickBestCandidateAngle(candidates, bondLength) {
  if (candidates.length === 0) {
    return DISCRETE_BRANCH_ANGLES[0];
  }

  const safeCandidates = bondLength > 0
    ? candidates.filter(candidate => candidate.clearanceScore >= (bondLength * 0.55))
    : candidates;
  const candidatesToConsider = safeCandidates.length > 0 ? safeCandidates : candidates;
  const bestAngleScore = Math.max(...candidatesToConsider.map(candidate => candidate.angleScore));
  const scoreTolerance = Math.max(Math.abs(bestAngleScore) * ANGLE_SCORE_TIEBREAK_RATIO, 1e-9);
  const nearBestCandidates = candidatesToConsider.filter(candidate => candidate.angleScore >= (bestAngleScore - scoreTolerance));

  let bestCandidate = nearBestCandidates[0];
  for (let index = 1; index < nearBestCandidates.length; index++) {
    const candidate = nearBestCandidates[index];
    if (candidate.centerDistanceScore > bestCandidate.centerDistanceScore) {
      bestCandidate = candidate;
      continue;
    }
    if (candidate.centerDistanceScore === bestCandidate.centerDistanceScore && candidate.clearanceScore > bestCandidate.clearanceScore) {
      bestCandidate = candidate;
      continue;
    }
    if (
      candidate.centerDistanceScore === bestCandidate.centerDistanceScore &&
      candidate.clearanceScore === bestCandidate.clearanceScore &&
      candidate.angleScore > bestCandidate.angleScore
    ) {
      bestCandidate = candidate;
    }
  }

  return bestCandidate.angle;
}

function evaluateAngleCandidates(candidateAngles, occupiedAngles, preferredAngles, anchorPosition, bondLength, coords, excludedAtomIds, placementState) {
  return candidateAngles.map(candidateAngle => ({
    angle: candidateAngle,
    angleScore: scoreCandidateAngle(candidateAngle, occupiedAngles, preferredAngles),
    clearanceScore: candidateClearanceScore(anchorPosition, candidateAngle, bondLength, coords, excludedAtomIds),
    centerDistanceScore: centerDistanceScore(placementState, add(anchorPosition, fromAngle(candidateAngle, bondLength)))
  }));
}

function chooseContinuationAngle(anchorPosition, bondLength, coords, occupiedAngles, preferredAngles, excludedAtomIds, placementState) {
  const preferredCandidateAngles = preferredDiscreteAngles(preferredAngles);
  if (preferredCandidateAngles.length > 0) {
    const preferredCandidates = evaluateAngleCandidates(
      preferredCandidateAngles,
      occupiedAngles,
      preferredAngles,
      anchorPosition,
      bondLength,
      coords,
      excludedAtomIds,
      placementState
    );
    const safePreferredCandidates = preferredCandidates.filter(candidate => candidate.clearanceScore >= (bondLength * 0.55));
    if (safePreferredCandidates.length > 0) {
      return pickBestCandidateAngle(safePreferredCandidates, bondLength);
    }
  }

  return pickBestCandidateAngle(
    evaluateAngleCandidates(
      DISCRETE_BRANCH_ANGLES,
      occupiedAngles,
      preferredAngles,
      anchorPosition,
      bondLength,
      coords,
      excludedAtomIds,
      placementState
    ),
    bondLength
  );
}

function computeLegacyChildAngles(childCount, outAngle, fromRing, incomingAngle, isLinear) {
  if (childCount === 1) {
    if (fromRing || isLinear) {
      return [outAngle];
    }
    const cross = Math.sin(outAngle - incomingAngle);
    return [outAngle + (cross >= 0 ? -DEG60 : DEG60)];
  }
  if (childCount === 2) {
    if (isLinear) {
      return [outAngle, outAngle + Math.PI];
    }
    return [outAngle + DEG60, outAngle - DEG60];
  }
  if (childCount === 3) {
    return [outAngle, outAngle + DEG120, outAngle - DEG120];
  }
  if (childCount === 4) {
    return [outAngle + DEG60, outAngle - DEG60, outAngle + DEG120, outAngle - DEG120];
  }
  const spread = (Math.PI * 4) / 3;
  const step = spread / Math.max(childCount - 1, 1);
  return Array.from({ length: childCount }, (_, index) => outAngle - (spread / 2) + (index * step));
}

function largestGapAngles(fixedAngles, childCount) {
  const sortedAngles = [...fixedAngles].sort((firstAngle, secondAngle) => firstAngle - secondAngle);
  if (sortedAngles.length === 0) {
    return DISCRETE_BRANCH_ANGLES.slice(0, childCount);
  }

  let gapStart = sortedAngles[sortedAngles.length - 1];
  let gapSize = sortedAngles[0] - sortedAngles[sortedAngles.length - 1] + (Math.PI * 2);
  for (let index = 0; index < sortedAngles.length - 1; index++) {
    const gap = sortedAngles[index + 1] - sortedAngles[index];
    if (gap > gapSize) {
      gapSize = gap;
      gapStart = sortedAngles[index];
    }
  }

  const step = gapSize / (childCount + 1);
  return Array.from({ length: childCount }, (_, index) => gapStart + (step * (index + 1)));
}

function placedNeighborIds(adjacency, coords, anchorAtomId) {
  return (adjacency.get(anchorAtomId) ?? []).filter(neighborAtomId => coords.has(neighborAtomId));
}

function isHydrogenAtom(layoutGraph, atomId) {
  return layoutGraph?.atoms.get(atomId)?.element === 'H';
}

function splitDeferredHydrogenNeighbors(unplacedNeighborIds, layoutGraph) {
  if (!layoutGraph) {
    return {
      primaryNeighborIds: unplacedNeighborIds,
      deferredNeighborIds: []
    };
  }
  const primaryNeighborIds = unplacedNeighborIds.filter(neighborAtomId => !isHydrogenAtom(layoutGraph, neighborAtomId));
  if (primaryNeighborIds.length === 0) {
    return {
      primaryNeighborIds: unplacedNeighborIds,
      deferredNeighborIds: []
    };
  }
  return {
    primaryNeighborIds,
    deferredNeighborIds: unplacedNeighborIds.filter(neighborAtomId => isHydrogenAtom(layoutGraph, neighborAtomId))
  };
}

function subtreeHeavyAtomCount(adjacency, layoutGraph, coords, rootAtomId, blockedAtomId) {
  const queue = [rootAtomId];
  const visited = new Set([blockedAtomId]);
  let count = 0;

  while (queue.length > 0) {
    const atomId = queue.pop();
    if (visited.has(atomId)) {
      continue;
    }
    visited.add(atomId);
    const atom = layoutGraph?.atoms.get(atomId);
    if (!atom || coords.has(atomId)) {
      continue;
    }
    if (atom.element !== 'H') {
      count++;
    }
    for (const neighborAtomId of adjacency.get(atomId) ?? []) {
      if (!visited.has(neighborAtomId)) {
        queue.push(neighborAtomId);
      }
    }
  }

  return count;
}

function permutations(items) {
  if (items.length <= 1) {
    return [items];
  }
  const result = [];
  for (let index = 0; index < items.length; index++) {
    const head = items[index];
    const tail = items.slice(0, index).concat(items.slice(index + 1));
    for (const permutation of permutations(tail)) {
      result.push([head, ...permutation]);
    }
  }
  return result;
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
  for (const bond of layoutGraph.bonds.values()) {
    if (bond.kind !== 'covalent' || bond.a !== atomId && bond.b !== atomId) {
      continue;
    }
    if ((bond.order ?? 1) !== 1 || bond.aromatic) {
      return 0;
    }
    const neighborAtomId = bond.a === atomId ? bond.b : bond.a;
    const neighborAtom = layoutGraph.atoms.get(neighborAtomId);
    if (!neighborAtom || neighborAtom.element === 'H') {
      continue;
    }
    const neighborPosition = coords.get(neighborAtomId);
    const atomPosition = coords.get(atomId);
    if (!neighborPosition || !atomPosition) {
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
    separations.push(rawGap > 0 ? rawGap : rawGap + (Math.PI * 2));
  }

  return separations.reduce((sum, separation) => sum + ((separation - (Math.PI / 2)) ** 2), 0);
}

function arrangementCost(layoutGraph, coords, bondLength, anchorAtomId) {
  const layoutCost = layoutGraph ? measureLayoutCost(layoutGraph, coords, bondLength) : 0;
  return layoutCost + (tetrahedralSpreadPenalty(layoutGraph, coords, anchorAtomId) * 20);
}

function chooseBatchAngleAssignments(
  adjacency,
  canonicalAtomRank,
  coords,
  placementState,
  atomIdsToPlace,
  anchorAtomId,
  parentAtomId,
  unplacedNeighborIds,
  bondLength,
  layoutGraph = null,
  depth = 0
) {
  const anchorPosition = coords.get(anchorAtomId);
  if (!anchorPosition || unplacedNeighborIds.length === 0 || depth > MAX_BRANCH_RECURSION_DEPTH) {
    return [];
  }

  const currentPlacedNeighborIds = placedNeighborIds(adjacency, coords, anchorAtomId);
  const ringAngles = preferredRingAngles(layoutGraph, coords, anchorAtomId);
  const fromRing = ringAngles.length > 0;
  const incomingAngle = parentAtomId && coords.has(parentAtomId)
    ? angleOf(sub(coords.get(parentAtomId), anchorPosition))
    : ringAngles[0] == null
      ? 0
      : ringAngles[0] + Math.PI;
  const outAngle = ringAngles[0] ?? (incomingAngle + Math.PI);
  const hasMultipleBond = hasNonAromaticMultipleBond(layoutGraph, anchorAtomId);
  const isLinear = isLinearCenter(layoutGraph, anchorAtomId);

  const shouldUseGapStrategy =
    !fromRing &&
    currentPlacedNeighborIds.length > 0 &&
    (
      currentPlacedNeighborIds.length >= 2 ||
      (!isLinear && unplacedNeighborIds.length >= 2 && (!hasMultipleBond || unplacedNeighborIds.length <= 2)) ||
      (unplacedNeighborIds.length === 1 && currentPlacedNeighborIds.length >= 2)
    );

  const angleSets = shouldUseGapStrategy
    ? [largestGapAngles(
      currentPlacedNeighborIds
        .map(neighborAtomId => angleOf(sub(coords.get(neighborAtomId), anchorPosition))),
      unplacedNeighborIds.length
    )]
    : [computeLegacyChildAngles(unplacedNeighborIds.length, outAngle, fromRing, incomingAngle, isLinear)];

  const childDescriptors = unplacedNeighborIds.map(childAtomId => ({
    childAtomId,
    subtreeSize: subtreeHeavyAtomCount(adjacency, layoutGraph, coords, childAtomId, anchorAtomId)
  }));
  const childPermutations = permutations(childDescriptors);

  let bestPlacement = null;

  for (const angleSet of angleSets) {
    for (const permutation of childPermutations) {
      const tempCoords = new Map([...coords.entries()].map(([atomId, position]) => [atomId, { ...position }]));
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
          add(anchorPosition, fromAngle(placement.angle, bondLength)),
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
        placeChildren(
          adjacency,
          canonicalAtomRank,
          tempCoords,
          tempPlacementState,
          atomIdsToPlace,
          placement.childAtomId,
          anchorAtomId,
          bondLength,
          layoutGraph,
          depth + 1
        );
      }

      const cost = arrangementCost(layoutGraph, tempCoords, bondLength, anchorAtomId);
      if (!bestPlacement || cost < bestPlacement.cost) {
        bestPlacement = {
          cost,
          coords: tempCoords,
          placementState: tempPlacementState
        };
      }
    }
  }

  if (!bestPlacement) {
    return [];
  }

  for (const atomId of atomIdsToPlace) {
    if (bestPlacement.coords.has(atomId)) {
      coords.set(atomId, bestPlacement.coords.get(atomId));
    }
  }
  copyPlacementState(placementState, bestPlacement.placementState);

  return unplacedNeighborIds.map(childAtomId => ({
    childAtomId,
    angle: angleOf(sub(coords.get(childAtomId), anchorPosition))
  }));
}

/**
 * Chooses a discrete outward angle for a new attachment on an already placed
 * anchor atom.
 * @param {Map<string, string[]>} adjacency - Component adjacency map.
 * @param {Map<string, {x: number, y: number}>} coords - Current coordinate map.
 * @param {string} anchorAtomId - Anchor atom ID.
 * @param {Set<string>} atomIdsToPlace - Eligible atom IDs.
 * @param {number|null} [preferredAngle] - Preferred angle in radians.
 * @param {object|null} [layoutGraph] - Layout graph shell.
 * @returns {number} Chosen attachment angle.
 */
export function chooseAttachmentAngle(adjacency, coords, anchorAtomId, atomIdsToPlace, preferredAngle = null, layoutGraph = null) {
  const preferredAngles = preferredAngle == null ? [] : [preferredAngle];
  preferredAngles.push(...preferredRingAngles(layoutGraph, coords, anchorAtomId));
  return chooseBranchAngle(
    occupiedNeighborAngles(adjacency, coords, anchorAtomId, atomIdsToPlace),
    preferredAngles
  );
}

function preferredBranchAngles(adjacency, coords, anchorAtomId, _atomIdsToPlace, parentAtomId, childAtomId, layoutGraph = null) {
  const anchorPosition = coords.get(anchorAtomId);
  if (!anchorPosition) {
    return [];
  }
  const ringAngles = preferredRingAngles(layoutGraph, coords, anchorAtomId);
  if (ringAngles.length > 0) {
    return ringAngles;
  }
  const placedNeighborIds = (adjacency.get(anchorAtomId) ?? []).filter(neighborAtomId => coords.has(neighborAtomId));
  if (placedNeighborIds.length >= 2) {
    if (placedNeighborIds.length === 2) {
      const neighborCenter = centroid(placedNeighborIds.map(neighborAtomId => coords.get(neighborAtomId)));
      const outwardVector = sub(anchorPosition, neighborCenter);
      if (length(outwardVector) <= CENTERED_NEIGHBOR_EPSILON) {
        const neighborAxis = sub(coords.get(placedNeighborIds[1]), coords.get(placedNeighborIds[0]));
        const perpendicular = perpLeft(neighborAxis);
        if (length(perpendicular) > CENTERED_NEIGHBOR_EPSILON) {
          const perpendicularAngle = angleOf(perpendicular);
          return [perpendicularAngle, perpendicularAngle + Math.PI];
        }
      }
    }
    const neighborCenter = centroid(placedNeighborIds.map(neighborAtomId => coords.get(neighborAtomId)));
    return [angleOf(sub(anchorPosition, neighborCenter))];
  }
  const resolvedParentAtomId = parentAtomId ?? placedNeighborIds[0] ?? null;
  if (!resolvedParentAtomId || !coords.has(resolvedParentAtomId)) {
    return [];
  }
  const forwardAngle = angleOf(sub(anchorPosition, coords.get(resolvedParentAtomId)));
  if (prefersLinearContinuation(layoutGraph, anchorAtomId, resolvedParentAtomId, childAtomId)) {
    return [forwardAngle];
  }
  return [
    forwardAngle + CHAIN_CONTINUATION_OFFSET,
    forwardAngle - CHAIN_CONTINUATION_OFFSET
  ];
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
  depth = 0
) {
  const anchorPosition = coords.get(anchorAtomId);
  if (!anchorPosition || neighborAtomIds.length === 0 || depth > MAX_BRANCH_RECURSION_DEPTH) {
    return;
  }

  let occupiedAngles = occupiedNeighborAngles(adjacency, coords, anchorAtomId, atomIdsToPlace);

  for (const childAtomId of neighborAtomIds) {
    const currentPlacedNeighborIds = placedNeighborIds(adjacency, coords, anchorAtomId);
    const preferredAngles = preferredBranchAngles(adjacency, coords, anchorAtomId, atomIdsToPlace, parentAtomId, childAtomId, layoutGraph);
    const excludedAtomIds = new Set([anchorAtomId, ...currentPlacedNeighborIds]);
    const chosenAngle = currentPlacedNeighborIds.length === 1 && preferredAngles.length > 0
      ? chooseContinuationAngle(
        anchorPosition,
        bondLength,
        coords,
        occupiedAngles,
        preferredAngles,
        excludedAtomIds,
        placementState
      )
      : pickBestCandidateAngle(
        evaluateAngleCandidates(
          DISCRETE_BRANCH_ANGLES,
          occupiedAngles,
          preferredAngles,
          anchorPosition,
          bondLength,
          coords,
          excludedAtomIds,
          placementState
        ),
        bondLength
      );
    setPlacedPosition(coords, placementState, childAtomId, add(anchorPosition, fromAngle(chosenAngle, bondLength)), layoutGraph);
    occupiedAngles = occupiedAngles.concat([chosenAngle]);
    placeChildren(adjacency, canonicalAtomRank, coords, placementState, atomIdsToPlace, childAtomId, anchorAtomId, bondLength, layoutGraph, depth + 1);
  }
}

function placeChildren(adjacency, canonicalAtomRank, coords, placementState, atomIdsToPlace, anchorAtomId, parentAtomId, bondLength, layoutGraph = null, depth = 0) {
  const anchorPosition = coords.get(anchorAtomId);
  if (!anchorPosition || depth > MAX_BRANCH_RECURSION_DEPTH) {
    return;
  }
  const unplacedNeighbors = neighborOrder(
    (adjacency.get(anchorAtomId) ?? []).filter(neighborAtomId => atomIdsToPlace.has(neighborAtomId) && !coords.has(neighborAtomId)),
    canonicalAtomRank
  );
  const { primaryNeighborIds, deferredNeighborIds } = splitDeferredHydrogenNeighbors(unplacedNeighbors, layoutGraph);
  if (primaryNeighborIds.length >= 2) {
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
      layoutGraph,
      depth
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
      depth
    );
  }
  if (deferredNeighborIds.length > 0) {
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
 * @param {number} [depth] - Recursive depth guard for pathological graphs.
 * @returns {Map<string, {x: number, y: number}>} Updated coordinate map.
 */
export function placeRemainingBranches(adjacency, canonicalAtomRank, coords, atomIdsToPlace, seedAtomIds, bondLength, layoutGraph = null, depth = 0) {
  if (depth > MAX_BRANCH_RECURSION_DEPTH) {
    return coords;
  }
  const placementState = seedPlacementState(layoutGraph, coords);
  const orderedSeedAtomIds = neighborOrder(seedAtomIds.filter(atomId => coords.has(atomId)), canonicalAtomRank);
  for (const seedAtomId of orderedSeedAtomIds) {
    const placedNeighbors = (adjacency.get(seedAtomId) ?? []).filter(neighborAtomId => coords.has(neighborAtomId) && atomIdsToPlace.has(neighborAtomId));
    const orderedPlacedNeighbors = neighborOrder(placedNeighbors, canonicalAtomRank);
    const parentAtomId = orderedPlacedNeighbors.length === 1 ? orderedPlacedNeighbors[0] : null;
    placeChildren(adjacency, canonicalAtomRank, coords, placementState, atomIdsToPlace, seedAtomId, parentAtomId, bondLength, layoutGraph, depth);
  }
  return coords;
}

/** @module placement/branch-placement */

import { add, angleOf, angularDifference, centroid, distance, fromAngle, length, perpLeft, sub } from '../geometry/vec2.js';
import { countPointInPolygons } from '../geometry/polygon.js';
import { buildAtomGrid, measureFocusedPlacementCost, measureLayoutCost } from '../audit/invariants.js';
import { BRANCH_CLEARANCE_FLOOR_FACTOR, BRANCH_COMPLEXITY_LIMITS } from '../constants.js';
import { compareCanonicalAtomIds } from '../topology/canonical-order.js';

const DISCRETE_BRANCH_ANGLES = Array.from({ length: 12 }, (_, index) => (index * Math.PI) / 6);
const CHAIN_CONTINUATION_OFFSET = Math.PI / 3;
const CENTERED_NEIGHBOR_EPSILON = 1e-6;
const DEG90 = Math.PI / 2;
const DEG60 = Math.PI / 3;
const DEG120 = (2 * Math.PI) / 3;
const DEG30 = Math.PI / 6;
const DEG15 = Math.PI / 12;
const ANGLE_SCORE_TIEBREAK_RATIO = 0.05;
const MAX_BRANCH_RECURSION_DEPTH = 120;
const ARRANGEMENT_IDEAL_GEOMETRY_WEIGHT = 20;
const SMALL_RING_EXTERIOR_GAP_WEIGHT = 80;
const CROSS_LIKE_HYPERVALENT_ELEMENTS = new Set(['S', 'P', 'Se', 'As']);
const STRICT_ACYCLIC_CONTINUATION_HETERO_ELEMENTS = new Set(['O', 'S', 'Se']);

/**
 * Normalizes an angle into the signed `(-pi, pi]` range.
 * @param {number} angle - Input angle in radians.
 * @returns {number} Wrapped signed angle.
 */
function normalizeSignedAngle(angle) {
  let wrappedAngle = angle;
  while (wrappedAngle > Math.PI) {
    wrappedAngle -= 2 * Math.PI;
  }
  while (wrappedAngle <= -Math.PI) {
    wrappedAngle += 2 * Math.PI;
  }
  return wrappedAngle;
}

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
  let minSeparation = Math.PI;
  for (const occ of occupiedAngles) {
    const d = angularDifference(candidateAngle, occ);
    if (d < minSeparation) { minSeparation = d; }
  }
  let preferredPenalty = 0;
  if (preferredAngles && preferredAngles.length > 0) {
    preferredPenalty = Infinity;
    for (const pref of preferredAngles) {
      const d = angularDifference(candidateAngle, pref);
      if (d < preferredPenalty) { preferredPenalty = d; }
    }
  }
  return minSeparation * 100 - preferredPenalty;
}

/**
 * Filters candidate angles through an optional anchor-specific angular budget.
 * @param {number[]} candidateAngles - Candidate angles in radians.
 * @param {string} anchorAtomId - Anchor atom ID.
 * @param {{angularBudgets?: Map<string, {centerAngle: number, minOffset: number, maxOffset: number, preferredAngle: number}>}|null} branchConstraints - Optional branch constraints.
 * @returns {number[]} Candidate angles that satisfy the budget, or the original set when unconstrained.
 */
function filterAnglesByBudget(candidateAngles, anchorAtomId, branchConstraints) {
  const budget = branchConstraints?.angularBudgets?.get(anchorAtomId);
  if (!budget) {
    return candidateAngles;
  }
  const filteredAngles = candidateAngles.filter(candidateAngle => {
    const offset = normalizeSignedAngle(candidateAngle - budget.centerAngle);
    return offset >= budget.minOffset - 1e-9 && offset <= budget.maxOffset + 1e-9;
  });
  return filteredAngles.length > 0 ? filteredAngles : candidateAngles;
}

/**
 * Returns any explicit preferred angle carried by an anchor-specific branch budget.
 * @param {string} anchorAtomId - Anchor atom ID.
 * @param {{angularBudgets?: Map<string, {centerAngle: number, minOffset: number, maxOffset: number, preferredAngle: number}>}|null} branchConstraints - Optional branch constraints.
 * @returns {number[]} Preferred budget-derived angles.
 */
function budgetPreferredAngles(anchorAtomId, branchConstraints) {
  const budget = branchConstraints?.angularBudgets?.get(anchorAtomId);
  if (!budget) {
    return [];
  }
  return [budget.preferredAngle ?? budget.centerAngle];
}

/**
 * Appends extra candidate angles while avoiding near-duplicate directions.
 * @param {number[]} baseAngles - Existing candidate angles.
 * @param {number[]} extraAngles - Extra candidate angles to append.
 * @returns {number[]} Deduplicated candidate angles.
 */
function mergeCandidateAngles(baseAngles, extraAngles) {
  const mergedAngles = [...baseAngles];
  for (const extraAngle of extraAngles) {
    if (!mergedAngles.some(candidateAngle => angularDifference(candidateAngle, extraAngle) <= 1e-9)) {
      mergedAngles.push(extraAngle);
    }
  }
  return mergedAngles;
}

/**
 * Returns the bisector of the largest open angular gap between occupied bonds.
 * When multiple gaps tie, the bisector closest to an optional preferred angle wins.
 * @param {number[]} occupiedAngles - Occupied bond angles in radians.
 * @param {number|null} preferredAngle - Optional tie-break angle in radians.
 * @returns {number|null} Largest-gap bisector in radians, or null when unsupported.
 */
function largestAngularGapBisector(occupiedAngles, preferredAngle = null) {
  if (occupiedAngles.length === 0) {
    return null;
  }
  const sortedAngles = [...occupiedAngles]
    .map(normalizeSignedAngle)
    .sort((firstAngle, secondAngle) => firstAngle - secondAngle)
    .filter((angle, index, angles) => index === 0 || angularDifference(angle, angles[index - 1]) > 1e-9);

  if (sortedAngles.length === 0) {
    return null;
  }

  let bestBisector = null;
  let bestGap = -Infinity;
  let bestPenalty = Infinity;
  for (let index = 0; index < sortedAngles.length; index++) {
    const gapStart = sortedAngles[index];
    const nextIndex = (index + 1) % sortedAngles.length;
    let gapEnd = sortedAngles[nextIndex];
    if (nextIndex === 0) {
      gapEnd += 2 * Math.PI;
    }
    const gap = gapEnd - gapStart;
    const bisector = normalizeSignedAngle(gapStart + gap / 2);
    const preferredPenalty = preferredAngle == null ? 0 : angularDifference(bisector, preferredAngle);
    if (gap > bestGap + 1e-9 || (Math.abs(gap - bestGap) <= 1e-9 && preferredPenalty < bestPenalty - 1e-9)) {
      bestGap = gap;
      bestPenalty = preferredPenalty;
      bestBisector = bisector;
    }
  }
  return bestBisector;
}

/**
 * Resolves the preferred-angle set for an anchor, letting macrocycle budget
 * preferences override the generic ring-outward fallback when present.
 * @param {string} anchorAtomId - Anchor atom ID.
 * @param {number[]} fallbackPreferredAngles - Existing preferred angles.
 * @param {{angularBudgets?: Map<string, {centerAngle: number, minOffset: number, maxOffset: number, preferredAngle: number}>}|null} branchConstraints - Optional branch constraints.
 * @returns {number[]} Preferred angles to score against.
 */
function resolvedPreferredAngles(anchorAtomId, fallbackPreferredAngles, branchConstraints) {
  const budgetAngles = budgetPreferredAngles(anchorAtomId, branchConstraints);
  return budgetAngles.length > 0 ? budgetAngles : fallbackPreferredAngles;
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
    trackedPositions: new Map(placementState.trackedPositions)
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
  targetState.trackedPositions = new Map(sourceState.trackedPositions);
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

/**
 * Chooses the best discrete angle from the preferred candidates only.
 * Attachment placement sometimes needs to preserve trigonal or ring-derived
 * continuation geometry rather than falling back to a wider but chemically
 * wrong direction from the full candidate set.
 * @param {number[]} preferredAngles - Preferred angles in radians.
 * @param {boolean} [allowFinePreferredAngles] - Whether to add finer offsets around preferred angles.
 * @returns {number|null} Winning preferred angle, or `null` when none exist.
 */
function buildPreferredCandidateAngles(preferredAngles = [], allowFinePreferredAngles = false) {
  const candidateAngles = mergeCandidateAngles(preferredDiscreteAngles(preferredAngles), preferredAngles);
  if (!allowFinePreferredAngles) {
    return candidateAngles;
  }
  return mergeCandidateAngles(candidateAngles, preferredAngles.flatMap(preferredAngle => [
    preferredAngle - DEG30,
    preferredAngle - DEG15,
    preferredAngle + DEG15,
    preferredAngle + DEG30
  ]));
}

function choosePreferredDiscreteAngle(occupiedAngles, preferredAngles = [], allowFinePreferredAngles = false) {
  const candidateAngles = buildPreferredCandidateAngles(preferredAngles, allowFinePreferredAngles);
  if (candidateAngles.length === 0) {
    return null;
  }

  let bestAngle = candidateAngles[0];
  let bestScore = Number.NEGATIVE_INFINITY;
  for (const candidateAngle of candidateAngles) {
    const score = scoreCandidateAngle(candidateAngle, occupiedAngles, preferredAngles);
    if (score > bestScore) {
      bestScore = score;
      bestAngle = candidateAngle;
    }
  }

  return bestAngle;
}

/**
 * Returns whether the preferred discrete continuation candidates are clear
 * enough to be honored without forcing an obviously crowded attachment slot.
 * @param {number[]} occupiedAngles - Occupied neighbor angles.
 * @param {number[]} preferredAngles - Preferred angles in radians.
 * @param {boolean} [allowFinePreferredAngles] - Whether to add finer offsets around preferred angles.
 * @returns {boolean} True when a preferred discrete angle is acceptably separated.
 */
function hasSafePreferredDiscreteAngle(occupiedAngles, preferredAngles = [], allowFinePreferredAngles = false) {
  const candidateAngles = buildPreferredCandidateAngles(preferredAngles, allowFinePreferredAngles);
  if (candidateAngles.length === 0) {
    return false;
  }
  return candidateAngles.some(candidateAngle => {
    if (occupiedAngles.length === 0) {
      return true;
    }
    let minSeparation = Infinity;
    for (const occ of occupiedAngles) {
      const d = angularDifference(candidateAngle, occ);
      if (d < minSeparation) { minSeparation = d; }
    }
    return minSeparation >= Math.PI / 6;
  });
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
  const key = firstAtomId < secondAtomId ? `${firstAtomId}:${secondAtomId}` : `${secondAtomId}:${firstAtomId}`;
  return layoutGraph.bondByAtomPair.get(key) ?? null;
}

function hasNonAromaticMultipleBond(layoutGraph, atomId) {
  if (!layoutGraph) {
    return false;
  }
  for (const bond of layoutGraph.bondsByAtomId.get(atomId) ?? []) {
    if (bond.aromatic) {
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
  for (const bond of layoutGraph.bondsByAtomId.get(atomId) ?? []) {
    if (bond.aromatic) {
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

/**
 * Returns whether a multiple-bond neighbor is a terminal heavy substituent leaf.
 * @param {object|null} layoutGraph - Layout graph shell.
 * @param {string} centerAtomId - Central atom ID.
 * @param {object} bond - Incident bond descriptor.
 * @returns {boolean} True when the neighbor is a terminal heavy leaf.
 */
function isTerminalMultipleBondLeaf(layoutGraph, centerAtomId, bond) {
  if (!layoutGraph || !bond || bond.kind !== 'covalent' || bond.aromatic) {
    return false;
  }
  if ((bond.order ?? 1) < 2) {
    return false;
  }

  const neighborAtomId = bond.a === centerAtomId ? bond.b : bond.a;
  const neighborAtom = layoutGraph.atoms.get(neighborAtomId);
  if (!neighborAtom || neighborAtom.element === 'H') {
    return false;
  }
  return neighborAtom.heavyDegree === 1;
}

/**
 * Returns whether a multiple-bond neighbor is a terminal hetero substituent.
 * @param {object|null} layoutGraph - Layout graph shell.
 * @param {string} centerAtomId - Central atom ID.
 * @param {object} bond - Incident bond descriptor.
 * @returns {boolean} True when the neighbor is a terminal hetero atom.
 */
function isTerminalMultipleBondHetero(layoutGraph, centerAtomId, bond) {
  if (!isTerminalMultipleBondLeaf(layoutGraph, centerAtomId, bond)) {
    return false;
  }
  const neighborAtomId = bond.a === centerAtomId ? bond.b : bond.a;
  return layoutGraph.atoms.get(neighborAtomId)?.element !== 'C';
}

/**
 * Returns whether a child is a single-bond exocyclic heavy substituent root on
 * a ring atom. These substituent roots can safely prefer the exact
 * ring-outward angle instead of snapping to the generic discrete branch
 * lattice when the outward direction is already clear.
 * @param {object|null} layoutGraph - Layout graph shell.
 * @param {string} anchorAtomId - Anchor atom ID.
 * @param {string|null} childAtomId - Candidate child atom ID.
 * @returns {boolean} True when the child qualifies for exact ring-outward placement.
 */
function isExactRingOutwardEligibleSubstituent(layoutGraph, anchorAtomId, childAtomId) {
  if (!layoutGraph || !childAtomId) {
    return false;
  }
  if ((layoutGraph.atomToRings.get(anchorAtomId)?.length ?? 0) === 0) {
    return false;
  }

  const anchorAtom = layoutGraph.atoms.get(anchorAtomId);
  const childAtom = layoutGraph.atoms.get(childAtomId);
  if (!anchorAtom || !childAtom || childAtom.aromatic || childAtom.element === 'H') {
    return false;
  }
  if ((layoutGraph.atomToRings.get(childAtomId)?.length ?? 0) > 0) {
    return false;
  }

  const bond = findLayoutBond(layoutGraph, anchorAtomId, childAtomId);
  if (!bond || bond.kind !== 'covalent' || bond.aromatic || (bond.order ?? 1) !== 1) {
    return false;
  }
  return true;
}

/**
 * Returns whether a simple acyclic divalent hetero center should preserve the
 * exact preferred continuation angle for its remaining heavy child instead of
 * letting nearby center-of-mass scoring cant the bond off that ideal slot.
 * This keeps esters and ethers from drifting away from their intended clean
 * 120-degree depiction when the exact continuation is already safe.
 * @param {object|null} layoutGraph - Layout graph shell.
 * @param {string} anchorAtomId - Anchor atom ID.
 * @param {string|null} parentAtomId - Already placed parent atom ID.
 * @param {string|null} childAtomId - Candidate child atom ID.
 * @returns {boolean} True when the anchor should honor the exact continuation.
 */
function isExactAcyclicHeteroContinuationEligible(layoutGraph, anchorAtomId, parentAtomId, childAtomId) {
  if (!layoutGraph || !parentAtomId || !childAtomId) {
    return false;
  }
  if ((layoutGraph.atomToRings.get(anchorAtomId)?.length ?? 0) > 0) {
    return false;
  }

  const anchorAtom = layoutGraph.atoms.get(anchorAtomId);
  if (!anchorAtom || anchorAtom.aromatic || anchorAtom.heavyDegree !== 2 || !STRICT_ACYCLIC_CONTINUATION_HETERO_ELEMENTS.has(anchorAtom.element)) {
    return false;
  }

  for (const neighborAtomId of [parentAtomId, childAtomId]) {
    if (!neighborAtomId) {
      return false;
    }
    const bond = findLayoutBond(layoutGraph, anchorAtomId, neighborAtomId);
    if (!bond || bond.kind !== 'covalent' || bond.aromatic || (bond.order ?? 1) !== 1) {
      return false;
    }
  }

  return true;
}

/**
 * Describes a cross-like hypervalent main-group center when one is present.
 * These centers conventionally read as a 2D cross with single bonds opposite
 * each other and terminal multiple-bond hetero substituents perpendicular.
 * @param {object|null} layoutGraph - Layout graph shell.
 * @param {string} atomId - Candidate center atom ID.
 * @returns {{singleNeighborIds: string[], multipleNeighborIds: string[]}|null} Cross-like center descriptor or `null`.
 */
export function describeCrossLikeHypervalentCenter(layoutGraph, atomId) {
  if (!layoutGraph) {
    return null;
  }
  const atom = layoutGraph.atoms.get(atomId);
  if (!atom || !CROSS_LIKE_HYPERVALENT_ELEMENTS.has(atom.element)) {
    return null;
  }

  const singleNeighborIds = [];
  const multipleNeighborIds = [];
  for (const bond of layoutGraph.bondsByAtomId.get(atomId) ?? []) {
    if (bond.kind !== 'covalent' || bond.aromatic) {
      return null;
    }
    const neighborAtomId = bond.a === atomId ? bond.b : bond.a;
    const neighborAtom = layoutGraph.atoms.get(neighborAtomId);
    if (!neighborAtom || neighborAtom.element === 'H') {
      continue;
    }
    const order = bond.order ?? 1;
    if (order === 1) {
      singleNeighborIds.push(neighborAtomId);
      continue;
    }
    if (isTerminalMultipleBondHetero(layoutGraph, atomId, bond)) {
      multipleNeighborIds.push(neighborAtomId);
      continue;
    }
    return null;
  }

  if (singleNeighborIds.length !== 2 || multipleNeighborIds.length !== 2) {
    return null;
  }
  return {
    singleNeighborIds,
    multipleNeighborIds
  };
}

/**
 * Returns the whole-ring-system outward angle for a multi-ring anchor atom.
 * @param {object|null} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Current coordinate map.
 * @param {string} anchorAtomId - Anchor atom ID.
 * @returns {number|null} Outward angle in radians, or null when unavailable.
 */
function preferredRingSystemAngle(layoutGraph, coords, anchorAtomId) {
  if (!layoutGraph || !coords.has(anchorAtomId)) {
    return null;
  }
  const anchorPosition = coords.get(anchorAtomId);
  const ringSystemId = layoutGraph.atomToRingSystemId?.get(anchorAtomId);
  const ringSystem = ringSystemId != null ? layoutGraph.ringSystems.find(rs => rs.id === ringSystemId) : null;
  if (!ringSystem) {
    return null;
  }
  const placedRingSystemPositions = ringSystem.atomIds.filter(atomId => coords.has(atomId)).map(atomId => coords.get(atomId));
  if (placedRingSystemPositions.length < 3) {
    return null;
  }
  const ringSystemCenter = centroid(placedRingSystemPositions);
  const outwardVector = sub(anchorPosition, ringSystemCenter);
  if (length(outwardVector) <= CENTERED_NEIGHBOR_EPSILON) {
    return null;
  }
  return angleOf(outwardVector);
}

/**
 * Returns the exterior junction-gap angle for a fused or bridged ring anchor
 * that already has three placed ring neighbors and is placing an exocyclic
 * child. When one shared junction bond dominates the fusion, the exact
 * continuation opposite that bond wins if it keeps safe clearance; otherwise
 * the preferred exit direction falls back to the bisector of the widest open
 * gap between the already-placed ring bonds.
 * @param {object|null} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Current coordinate map.
 * @param {string} anchorAtomId - Anchor atom ID.
 * @param {string[]} placedNeighborIds - Currently placed neighbor IDs.
 * @param {string|null} childAtomId - Candidate child atom ID.
 * @returns {number|null} Preferred junction-gap angle in radians, or null when unsupported.
 */
function preferredRingJunctionGapAngle(layoutGraph, coords, anchorAtomId, placedNeighborIds, childAtomId) {
  if (!layoutGraph || !coords.has(anchorAtomId) || !childAtomId) {
    return null;
  }
  if ((layoutGraph.atomToRings.get(anchorAtomId)?.length ?? 0) === 0 || (layoutGraph.atomToRings.get(childAtomId)?.length ?? 0) > 0) {
    return null;
  }

  const ringNeighborIds = placedNeighborIds.filter(neighborAtomId => (layoutGraph.atomToRings.get(neighborAtomId)?.length ?? 0) > 0);
  if (ringNeighborIds.length < 3 || ringNeighborIds.length !== placedNeighborIds.length) {
    return null;
  }
  const ringNeighborAngles = ringNeighborIds
    .map(neighborAtomId => coords.get(neighborAtomId))
    .filter(Boolean)
    .map(neighborPosition => angleOf(sub(neighborPosition, coords.get(anchorAtomId))));
  const anchorRings = layoutGraph.atomToRings.get(anchorAtomId) ?? [];
  const sharedJunctionNeighborIds = ringNeighborIds.filter(neighborAtomId => {
    const neighborRings = layoutGraph.atomToRings.get(neighborAtomId) ?? [];
    return neighborRings.filter(ring => anchorRings.includes(ring)).length > 1;
  });
  if (sharedJunctionNeighborIds.length === 1 && coords.has(sharedJunctionNeighborIds[0])) {
    const sharedNeighborAngle = angleOf(sub(coords.get(sharedJunctionNeighborIds[0]), coords.get(anchorAtomId)));
    const straightJunctionAngle = normalizeSignedAngle(sharedNeighborAngle + Math.PI);
    const straightJunctionClearance = Math.min(...ringNeighborAngles.map(occupiedAngle => angularDifference(straightJunctionAngle, occupiedAngle)));
    if (straightJunctionClearance >= DEG60 - 1e-6) {
      return straightJunctionAngle;
    }
  }
  return largestAngularGapBisector(ringNeighborAngles, preferredRingSystemAngle(layoutGraph, coords, anchorAtomId));
}

function preferredRingAngles(layoutGraph, coords, anchorAtomId) {
  if (!layoutGraph || !coords.has(anchorAtomId)) {
    return [];
  }
  const anchorPosition = coords.get(anchorAtomId);
  const anchorRings = layoutGraph.atomToRings.get(anchorAtomId) ?? [];
  if (anchorRings.length > 1) {
    const ringSystemAngle = preferredRingSystemAngle(layoutGraph, coords, anchorAtomId);
    if (ringSystemAngle != null) {
      return [ringSystemAngle];
    }
  }
  const ringAngles = [];
  for (const ring of anchorRings) {
    const placedRingPositions = ring.atomIds.filter(atomId => coords.has(atomId)).map(atomId => coords.get(atomId));
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

/**
 * Returns whether a candidate position clears the branch safety floor.
 * This is a fast rejection screen only; exact clearance scoring is still used
 * later for finalist tie-breaking.
 * @param {{x: number, y: number}} anchorPosition - Anchor position.
 * @param {number} candidateAngle - Candidate angle in radians.
 * @param {number} bondLength - Target bond length.
 * @param {Map<string, {x: number, y: number}>} coords - Current coordinate map.
 * @param {Set<string>} excludedAtomIds - Atoms to ignore when checking safety.
 * @returns {boolean} True when the candidate clears the branch safety floor.
 */
function isCandidateSafe(anchorPosition, candidateAngle, bondLength, coords, excludedAtomIds) {
  const clearanceFloor = bondLength * BRANCH_CLEARANCE_FLOOR_FACTOR;
  const clearanceFloorSq = clearanceFloor * clearanceFloor;
  const candidatePosition = add(anchorPosition, fromAngle(candidateAngle, bondLength));
  for (const [atomId, position] of coords) {
    if (excludedAtomIds.has(atomId)) {
      continue;
    }
    const dx = candidatePosition.x - position.x;
    const dy = candidatePosition.y - position.y;
    if (dx * dx + dy * dy < clearanceFloorSq) {
      return false;
    }
  }
  return true;
}

/**
 * Returns the exterior trigonal bisector for a center with two placed neighbors.
 * This is used for exocyclic alkene attachments where the third substituent
 * should land opposite the centroid of the already placed substituent pair.
 * @param {Map<string, {x: number, y: number}>} coords - Current coordinate map.
 * @param {string} anchorAtomId - Center atom ID.
 * @param {string[]} placedNeighborIds - Already placed neighbor IDs.
 * @returns {number|null} Preferred trigonal angle in radians, or `null`.
 */
function preferredTrigonalBisectorAngle(coords, anchorAtomId, placedNeighborIds) {
  if (placedNeighborIds.length !== 2 || !coords.has(anchorAtomId)) {
    return null;
  }

  const anchorPosition = coords.get(anchorAtomId);
  const neighborPositions = placedNeighborIds.map(neighborAtomId => coords.get(neighborAtomId)).filter(Boolean);
  if (neighborPositions.length !== 2) {
    return null;
  }

  const neighborCenter = centroid(neighborPositions);
  const outwardVector = sub(anchorPosition, neighborCenter);
  if (length(outwardVector) <= CENTERED_NEIGHBOR_EPSILON) {
    const neighborAxis = sub(neighborPositions[1], neighborPositions[0]);
    const perpendicular = perpLeft(neighborAxis);
    if (length(perpendicular) <= CENTERED_NEIGHBOR_EPSILON) {
      return null;
    }
    return angleOf(perpendicular);
  }

  return angleOf(outwardVector);
}

/**
 * Returns the placed incident-ring polygons for a branch anchor.
 * @param {object|null} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Current coordinate map.
 * @param {string} anchorAtomId - Anchor atom identifier.
 * @returns {Array<Array<{x: number, y: number}>>} Incident ring polygons.
 */
function incidentRingPolygons(layoutGraph, coords, anchorAtomId) {
  if (!layoutGraph || !coords.has(anchorAtomId)) {
    return [];
  }
  return (layoutGraph.atomToRings.get(anchorAtomId) ?? []).map(ring => ring.atomIds.map(atomId => coords.get(atomId)).filter(Boolean)).filter(polygon => polygon.length >= 3);
}

/**
 * Chooses the best branch angle from pre-scored candidate directions.
 * @param {Array<{angle: number, angleScore: number, clearanceScore: number, centerDistanceScore: number, insideRingCount?: number, minSeparation?: number}>} candidates - Candidate descriptors.
 * @param {number} bondLength - Target bond length.
 * @param {boolean} [preferClearance] - Whether to prefer candidates that satisfy the standard clearance floor.
 * @param {{anchorPosition: {x: number, y: number}, coords: Map<string, {x: number, y: number}>, excludedAtomIds: Set<string>}|null} [clearanceContext] - Lazy exact-clearance context.
 * @returns {number} Winning angle in radians.
 */
function pickBestCandidateAngle(candidates, bondLength, preferClearance = true, clearanceContext = null) {
  if (candidates.length === 0) {
    return DISCRETE_BRANCH_ANGLES[0];
  }

  const safeCandidates = preferClearance && bondLength > 0 ? candidates.filter(candidate => candidate.isSafe !== false) : candidates;
  const clearanceCandidates = safeCandidates.length > 0 ? safeCandidates : candidates;
  let minimumInsideRingCount = clearanceCandidates[0].insideRingCount ?? 0;
  for (let i = 1; i < clearanceCandidates.length; i++) { const v = clearanceCandidates[i].insideRingCount ?? 0; if (v < minimumInsideRingCount) { minimumInsideRingCount = v; } }
  const candidatesToConsider = clearanceCandidates.filter(candidate => (candidate.insideRingCount ?? 0) === minimumInsideRingCount);
  let bestAngleScore = candidatesToConsider[0].angleScore;
  for (let i = 1; i < candidatesToConsider.length; i++) { if (candidatesToConsider[i].angleScore > bestAngleScore) { bestAngleScore = candidatesToConsider[i].angleScore; } }
  const scoreTolerance = Math.max(Math.abs(bestAngleScore) * ANGLE_SCORE_TIEBREAK_RATIO, 1e-9);
  const nearBestCandidates = candidatesToConsider.filter(candidate => candidate.angleScore >= bestAngleScore - scoreTolerance);
  if (clearanceContext) {
    for (const candidate of nearBestCandidates) {
      if (!Number.isFinite(candidate.clearanceScore)) {
        candidate.clearanceScore = candidateClearanceScore(clearanceContext.anchorPosition, candidate.angle, bondLength, clearanceContext.coords, clearanceContext.excludedAtomIds);
      }
    }
  }

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

/**
 * Scores candidate branch angles against occupied directions, placement CoM, and incident ring faces.
 * @param {number[]} candidateAngles - Candidate angles in radians.
 * @param {number[]} occupiedAngles - Occupied neighbor angles.
 * @param {number[]} preferredAngles - Preferred angles.
 * @param {{x: number, y: number}} anchorPosition - Anchor position.
 * @param {number} bondLength - Target bond length.
 * @param {Map<string, {x: number, y: number}>} coords - Current coordinate map.
 * @param {Set<string>} excludedAtomIds - Atoms to ignore when scoring clearance.
 * @param {{sumX: number, sumY: number, count: number}} placementState - Running placement CoM state.
 * @param {Array<Array<{x: number, y: number}>>} [ringPolygons] - Incident ring polygons.
 * @returns {Array<{angle: number, angleScore: number, clearanceScore: number|null, centerDistanceScore: number, insideRingCount: number, minSeparation: number, isSafe: boolean}>} Scored candidates.
 */
function evaluateAngleCandidates(candidateAngles, occupiedAngles, preferredAngles, anchorPosition, bondLength, coords, excludedAtomIds, placementState, ringPolygons = []) {
  return candidateAngles.map(candidateAngle => {
    const candidatePosition = add(anchorPosition, fromAngle(candidateAngle, bondLength));
    return {
      minSeparation: (() => { let m = Math.PI; for (const occ of occupiedAngles) { const d = angularDifference(candidateAngle, occ); if (d < m) { m = d; } } return m; })(),
      angle: candidateAngle,
      angleScore: scoreCandidateAngle(candidateAngle, occupiedAngles, preferredAngles),
      clearanceScore: null,
      centerDistanceScore: centerDistanceScore(placementState, candidatePosition),
      insideRingCount: countPointInPolygons(ringPolygons, candidatePosition),
      isSafe: isCandidateSafe(anchorPosition, candidateAngle, bondLength, coords, excludedAtomIds)
    };
  });
}

/**
 * Chooses a continuation angle while preferring safe ring-exterior directions when available.
 * @param {{x: number, y: number}} anchorPosition - Anchor position.
 * @param {number} bondLength - Target bond length.
 * @param {Map<string, {x: number, y: number}>} coords - Current coordinate map.
 * @param {number[]} occupiedAngles - Occupied neighbor angles.
 * @param {number[]} preferredAngles - Preferred continuation angles.
 * @param {number[]} candidateAngles - Candidate continuation angles after applying any optional budget.
 * @param {Set<string>} excludedAtomIds - Atoms to ignore during clearance scoring.
 * @param {{sumX: number, sumY: number, count: number}} placementState - Running placement CoM state.
 * @param {Array<Array<{x: number, y: number}>>} [ringPolygons] - Incident ring polygons.
 * @param {boolean} [allowFinePreferredAngles] - Whether to add finer offsets around preferred angles.
 * @returns {number} Chosen continuation angle in radians.
 */
function chooseContinuationAngle(
  anchorPosition,
  bondLength,
  coords,
  occupiedAngles,
  preferredAngles,
  candidateAngles,
  excludedAtomIds,
  placementState,
  ringPolygons = [],
  allowFinePreferredAngles = false
) {
  const clearanceContext = {
    anchorPosition,
    coords,
    excludedAtomIds
  };
  const preferredCandidateAngles = buildPreferredCandidateAngles(preferredAngles, allowFinePreferredAngles);
  if (preferredCandidateAngles.length > 0) {
    const preferredCandidates = evaluateAngleCandidates(
      preferredCandidateAngles,
      occupiedAngles,
      preferredAngles,
      anchorPosition,
      bondLength,
      coords,
      excludedAtomIds,
      placementState,
      ringPolygons
    );
    const safePreferredCandidates = preferredCandidates.filter(candidate => candidate.isSafe !== false);
    let bestPreferredInsideRingCount = Number.POSITIVE_INFINITY;
    let bestPreferredSeparation = 0;
    if (safePreferredCandidates.length > 0) {
      bestPreferredInsideRingCount = safePreferredCandidates[0].insideRingCount ?? 0;
      bestPreferredSeparation = safePreferredCandidates[0].minSeparation ?? 0;
      for (let i = 1; i < safePreferredCandidates.length; i++) {
        const v = safePreferredCandidates[i].insideRingCount ?? 0;
        if (v < bestPreferredInsideRingCount) { bestPreferredInsideRingCount = v; }
        const s = safePreferredCandidates[i].minSeparation ?? 0;
        if (s > bestPreferredSeparation) { bestPreferredSeparation = s; }
      }
    }
    if (safePreferredCandidates.length > 0 && bestPreferredInsideRingCount === 0 && bestPreferredSeparation >= Math.PI / 6) {
      return pickBestCandidateAngle(safePreferredCandidates, bondLength, true, clearanceContext);
    }
  }

  return pickBestCandidateAngle(
    evaluateAngleCandidates(
      mergeCandidateAngles(candidateAngles, preferredCandidateAngles),
      occupiedAngles,
      preferredAngles,
      anchorPosition,
      bondLength,
      coords,
      excludedAtomIds,
      placementState,
      ringPolygons
    ),
    bondLength,
    true,
    clearanceContext
  );
}

/**
 * Chooses the exact preferred angle when it is already safe and outside any incident ring face.
 * This is used for cases where the exact preferred direction is chemically
 * meaningful, such as ring-outward leaf substituents and terminal multiple-bond
 * leaves on trigonal centers, so they can follow the true idealized direction
 * instead of snapping to the discrete branch lattice.
 * @param {{x: number, y: number}} anchorPosition - Anchor position.
 * @param {number} bondLength - Target bond length.
 * @param {Map<string, {x: number, y: number}>} coords - Current coordinate map.
 * @param {number[]} occupiedAngles - Occupied neighbor angles.
 * @param {number[]} preferredAngles - Preferred exact continuation angles.
 * @param {Set<string>} excludedAtomIds - Atoms to ignore during clearance scoring.
 * @param {{sumX: number, sumY: number, count: number}|null} placementState - Running placement CoM state.
 * @param {Array<Array<{x: number, y: number}>>} [ringPolygons] - Incident ring polygons.
 * @returns {number|null} Safe exact preferred angle, or `null` when it should not be forced.
 */
function chooseExactPreferredAngle(anchorPosition, bondLength, coords, occupiedAngles, preferredAngles, excludedAtomIds, placementState, ringPolygons = []) {
  const exactPreferredAngles = mergeCandidateAngles([], preferredAngles.filter(Number.isFinite));
  if (exactPreferredAngles.length === 0) {
    return null;
  }

  const clearanceContext = {
    anchorPosition,
    coords,
    excludedAtomIds
  };
  const exactCandidates = evaluateAngleCandidates(
    exactPreferredAngles,
    occupiedAngles,
    preferredAngles,
    anchorPosition,
    bondLength,
    coords,
    excludedAtomIds,
    placementState,
    ringPolygons
  );
  const safeExactCandidates = exactCandidates.filter(candidate => candidate.isSafe !== false);
  if (safeExactCandidates.length === 0) {
    return null;
  }

  let bestInsideRingCount = safeExactCandidates[0].insideRingCount ?? 0;
  let bestSeparation = safeExactCandidates[0].minSeparation ?? 0;
  for (let i = 1; i < safeExactCandidates.length; i++) {
    const v = safeExactCandidates[i].insideRingCount ?? 0;
    if (v < bestInsideRingCount) { bestInsideRingCount = v; }
    const s = safeExactCandidates[i].minSeparation ?? 0;
    if (s > bestSeparation) { bestSeparation = s; }
  }
  if (bestInsideRingCount !== 0 || bestSeparation < Math.PI / 6) {
    return null;
  }
  return pickBestCandidateAngle(safeExactCandidates, bondLength, true, clearanceContext);
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
  return Array.from({ length: childCount }, (_, index) => outAngle - spread / 2 + index * step);
}

/**
 * Returns cross-like angle-set candidates for hypervalent sulfur/phosphorus centers.
 * @param {Map<string, string[]>} adjacency - Component adjacency map.
 * @param {Map<string, {x: number, y: number}>} coords - Current coordinate map.
 * @param {string} anchorAtomId - Center atom ID.
 * @param {string[]} currentPlacedNeighborIds - Already placed neighbor IDs.
 * @param {string[]} unplacedNeighborIds - Unplaced neighbor IDs.
 * @param {object|null} layoutGraph - Layout graph shell.
 * @returns {number[][]} Candidate angle sets.
 */
function crossLikeHypervalentAngleSets(adjacency, coords, anchorAtomId, currentPlacedNeighborIds, unplacedNeighborIds, layoutGraph) {
  const descriptor = describeCrossLikeHypervalentCenter(layoutGraph, anchorAtomId);
  if (!descriptor || !coords.has(anchorAtomId)) {
    return [];
  }

  const placedSingleNeighborIds = currentPlacedNeighborIds.filter(neighborAtomId => descriptor.singleNeighborIds.includes(neighborAtomId));
  const placedMultipleNeighborIds = currentPlacedNeighborIds.filter(neighborAtomId => descriptor.multipleNeighborIds.includes(neighborAtomId));
  const unplacedSingleNeighborIds = unplacedNeighborIds.filter(neighborAtomId => descriptor.singleNeighborIds.includes(neighborAtomId));
  const unplacedMultipleNeighborIds = unplacedNeighborIds.filter(neighborAtomId => descriptor.multipleNeighborIds.includes(neighborAtomId));
  const anchorPosition = coords.get(anchorAtomId);
  const angleSets = [];

  if (unplacedNeighborIds.length === 3 && unplacedSingleNeighborIds.length === 1 && unplacedMultipleNeighborIds.length === 2 && placedSingleNeighborIds.length === 1) {
    const singleAxisAngle = angleOf(sub(coords.get(placedSingleNeighborIds[0]), anchorPosition));
    const oppositeSingleAngle = singleAxisAngle + Math.PI;
    angleSets.push([oppositeSingleAngle, oppositeSingleAngle + DEG90, oppositeSingleAngle - DEG90]);
  }

  if (unplacedNeighborIds.length === 2 && unplacedMultipleNeighborIds.length === 2 && placedSingleNeighborIds.length === 2) {
    const singleAxisAngle = angleOf(sub(coords.get(placedSingleNeighborIds[0]), anchorPosition));
    angleSets.push([singleAxisAngle + DEG90, singleAxisAngle - DEG90]);
  }

  if (unplacedNeighborIds.length === 2 && unplacedSingleNeighborIds.length === 2 && placedMultipleNeighborIds.length === 2) {
    const multipleAxisAngle = angleOf(sub(coords.get(placedMultipleNeighborIds[0]), anchorPosition));
    angleSets.push([multipleAxisAngle + DEG90, multipleAxisAngle - DEG90]);
  }

  return angleSets;
}

function largestGapAngles(fixedAngles, childCount) {
  const sortedAngles = [...fixedAngles].sort((firstAngle, secondAngle) => firstAngle - secondAngle);
  if (sortedAngles.length === 0) {
    return DISCRETE_BRANCH_ANGLES.slice(0, childCount);
  }

  let gapStart = sortedAngles[sortedAngles.length - 1];
  let gapSize = sortedAngles[0] - sortedAngles[sortedAngles.length - 1] + Math.PI * 2;
  for (let index = 0; index < sortedAngles.length - 1; index++) {
    const gap = sortedAngles[index + 1] - sortedAngles[index];
    if (gap > gapSize) {
      gapSize = gap;
      gapStart = sortedAngles[index];
    }
  }

  const step = gapSize / (childCount + 1);
  return Array.from({ length: childCount }, (_, index) => gapStart + step * (index + 1));
}

/**
 * Describes a small saturated ring atom that should spread two heavy exocyclic
 * branches through the large exterior gap rather than stacking them on the
 * same side of the ring vertex.
 * @param {object|null} layoutGraph - Layout graph shell.
 * @param {string} anchorAtomId - Candidate ring-anchor atom ID.
 * @returns {{ringNeighborIds: string[], exocyclicNeighborIds: string[]}|null} Spread descriptor when eligible.
 */
function describeSmallRingExteriorSpreadAnchor(layoutGraph, anchorAtomId) {
  if (!layoutGraph) {
    return null;
  }

  const atom = layoutGraph.atoms.get(anchorAtomId);
  if (!atom || atom.element === 'H' || atom.aromatic || atom.heavyDegree !== 4) {
    return null;
  }

  const anchorRings = layoutGraph.atomToRings.get(anchorAtomId) ?? [];
  if (anchorRings.length !== 1) {
    return null;
  }
  const ring = anchorRings[0];
  if ((ring?.atomIds?.length ?? 0) < 3 || (ring?.atomIds?.length ?? 0) > 4) {
    return null;
  }

  const ringNeighborIds = [];
  const exocyclicNeighborIds = [];
  for (const bond of layoutGraph.bondsByAtomId.get(anchorAtomId) ?? []) {
    if (bond.kind !== 'covalent' || bond.aromatic || (bond.order ?? 1) !== 1) {
      return null;
    }
    const neighborAtomId = bond.a === anchorAtomId ? bond.b : bond.a;
    const neighborAtom = layoutGraph.atoms.get(neighborAtomId);
    if (!neighborAtom || neighborAtom.element === 'H') {
      continue;
    }
    if (ring.atomIds.includes(neighborAtomId)) {
      ringNeighborIds.push(neighborAtomId);
      continue;
    }
    if ((layoutGraph.atomToRings.get(neighborAtomId)?.length ?? 0) > 0) {
      return null;
    }
    exocyclicNeighborIds.push(neighborAtomId);
  }

  if (ringNeighborIds.length !== 2 || exocyclicNeighborIds.length !== 2) {
    return null;
  }
  return {
    ringNeighborIds,
    exocyclicNeighborIds
  };
}

/**
 * Returns the exact outward continuation angles opposite the two ring bonds of
 * a small saturated ring anchor.
 * @param {number[]} ringNeighborAngles - Ring-neighbor bond angles in radians.
 * @returns {number[]} Exact exterior continuation angles.
 */
function smallRingExteriorContinuationAngles(ringNeighborAngles) {
  return ringNeighborAngles.map(ringNeighborAngle => normalizeSignedAngle(ringNeighborAngle + Math.PI));
}

/**
 * Returns exact continuation angle sets for a small saturated ring anchor when
 * both heavy exocyclic children are being placed together. This lets batch
 * branch placement evaluate the true outside continuations of the ring edges
 * instead of only approximating them with a largest-gap fan.
 * @param {object|null} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Current coordinate map.
 * @param {string} anchorAtomId - Anchor atom ID.
 * @param {string[]} currentPlacedNeighborIds - Already placed neighbor IDs.
 * @param {string[]} unplacedNeighborIds - Unplaced child atom IDs.
 * @returns {number[][]} Exact small-ring continuation angle sets.
 */
function exactSmallRingExteriorAngleSets(layoutGraph, coords, anchorAtomId, currentPlacedNeighborIds, unplacedNeighborIds) {
  if (!layoutGraph || !coords.has(anchorAtomId) || unplacedNeighborIds.length !== 2) {
    return [];
  }

  const descriptor = describeSmallRingExteriorSpreadAnchor(layoutGraph, anchorAtomId);
  if (!descriptor) {
    return [];
  }

  const placedRingNeighborIds = descriptor.ringNeighborIds.filter(
    neighborAtomId => currentPlacedNeighborIds.includes(neighborAtomId) && coords.has(neighborAtomId)
  );
  if (placedRingNeighborIds.length !== 2) {
    return [];
  }
  if (!unplacedNeighborIds.every(neighborAtomId => descriptor.exocyclicNeighborIds.includes(neighborAtomId))) {
    return [];
  }

  const anchorPosition = coords.get(anchorAtomId);
  const ringNeighborAngles = placedRingNeighborIds.map(neighborAtomId => angleOf(sub(coords.get(neighborAtomId), anchorPosition)));
  const targetAngles = smallRingExteriorContinuationAngles(ringNeighborAngles);
  return targetAngles.length === unplacedNeighborIds.length ? [targetAngles] : [];
}

/**
 * Returns whether a crowded ring anchor should also try distributing multiple
 * exocyclic children through the full exterior opening between its placed ring
 * bonds instead of only the legacy outward-fan candidate.
 * @param {object|null} layoutGraph - Layout graph shell.
 * @param {string} anchorAtomId - Anchor atom ID.
 * @param {string[]} currentPlacedNeighborIds - Already placed neighbor IDs.
 * @param {string[]} unplacedNeighborIds - Unplaced child IDs.
 * @returns {boolean} True when an exterior-gap spread candidate is warranted.
 */
function shouldTryRingExteriorGapSpread(layoutGraph, anchorAtomId, currentPlacedNeighborIds, unplacedNeighborIds) {
  if (!layoutGraph || (layoutGraph.atomToRings.get(anchorAtomId)?.length ?? 0) === 0) {
    return false;
  }
  if (currentPlacedNeighborIds.length !== 2 || unplacedNeighborIds.length < 2) {
    return false;
  }
  if (!currentPlacedNeighborIds.every(neighborAtomId => (layoutGraph.atomToRings.get(neighborAtomId)?.length ?? 0) > 0)) {
    return false;
  }

  for (const neighborAtomId of [...currentPlacedNeighborIds, ...unplacedNeighborIds]) {
    if ((layoutGraph.atomToRings.get(neighborAtomId)?.length ?? 0) > 0 && !currentPlacedNeighborIds.includes(neighborAtomId)) {
      return false;
    }
    const bond = findLayoutBond(layoutGraph, anchorAtomId, neighborAtomId);
    if (!bond || bond.kind !== 'covalent' || bond.aromatic || (bond.order ?? 1) !== 1) {
      return false;
    }
  }

  return true;
}

/**
 * Returns the preferred exact exterior continuation angles for a small
 * saturated ring anchor with two heavy exocyclic neighbors. When one
 * exocyclic branch is already placed, this narrows to the remaining
 * continuation opposite the other ring bond.
 * @param {object|null} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Current coordinate map.
 * @param {string} anchorAtomId - Anchor atom ID.
 * @param {string[]} placedNeighborIds - Currently placed neighbor IDs.
 * @param {string|null} childAtomId - Candidate child atom ID.
 * @returns {number[]} Preferred exterior-gap angles in radians.
 */
function preferredSmallRingExteriorGapAngles(layoutGraph, coords, anchorAtomId, placedNeighborIds, childAtomId) {
  if (!layoutGraph || !coords.has(anchorAtomId) || !childAtomId) {
    return [];
  }

  const descriptor = describeSmallRingExteriorSpreadAnchor(layoutGraph, anchorAtomId);
  if (!descriptor || !descriptor.exocyclicNeighborIds.includes(childAtomId)) {
    return [];
  }

  const atomPosition = coords.get(anchorAtomId);
  const placedRingNeighborIds = descriptor.ringNeighborIds.filter(neighborAtomId => placedNeighborIds.includes(neighborAtomId) && coords.has(neighborAtomId));
  if (placedRingNeighborIds.length !== 2) {
    return [];
  }

  const ringNeighborAngles = placedRingNeighborIds.map(neighborAtomId => angleOf(sub(coords.get(neighborAtomId), atomPosition)));
  const targetAngles = smallRingExteriorContinuationAngles(ringNeighborAngles);
  if (targetAngles.length !== descriptor.exocyclicNeighborIds.length) {
    return [];
  }

  const placedExocyclicNeighborIds = descriptor.exocyclicNeighborIds.filter(
    neighborAtomId => neighborAtomId !== childAtomId && placedNeighborIds.includes(neighborAtomId) && coords.has(neighborAtomId)
  );
  if (placedExocyclicNeighborIds.length === 0) {
    return targetAngles;
  }
  if (placedExocyclicNeighborIds.length !== 1) {
    return [];
  }

  const placedExocyclicAngle = angleOf(sub(coords.get(placedExocyclicNeighborIds[0]), atomPosition));
  const firstPenalty = angularDifference(placedExocyclicAngle, targetAngles[0]);
  const secondPenalty = angularDifference(placedExocyclicAngle, targetAngles[1]);
  return [firstPenalty <= secondPenalty ? targetAngles[1] : targetAngles[0]];
}

function placedNeighborIds(adjacency, coords, anchorAtomId) {
  return (adjacency.get(anchorAtomId) ?? []).filter(neighborAtomId => coords.has(neighborAtomId));
}

function isHydrogenAtom(layoutGraph, atomId) {
  return layoutGraph?.atoms.get(atomId)?.element === 'H';
}

function isDeferredLeafNeighbor(layoutGraph, atomId) {
  const atom = layoutGraph?.atoms.get(atomId);
  if (!atom) {
    return false;
  }
  if (atom.element === 'H') {
    return true;
  }
  return ['F', 'Cl', 'Br', 'I'].includes(atom.element) && atom.heavyDegree === 1;
}

function splitDeferredLeafNeighbors(unplacedNeighborIds, layoutGraph) {
  if (!layoutGraph) {
    return {
      primaryNeighborIds: unplacedNeighborIds,
      deferredNeighborIds: []
    };
  }
  const primaryNeighborIds = unplacedNeighborIds.filter(neighborAtomId => !isDeferredLeafNeighbor(layoutGraph, neighborAtomId));
  if (primaryNeighborIds.length === 0) {
    return {
      primaryNeighborIds: unplacedNeighborIds,
      deferredNeighborIds: []
    };
  }
  return {
    primaryNeighborIds,
    deferredNeighborIds: unplacedNeighborIds.filter(neighborAtomId => isDeferredLeafNeighbor(layoutGraph, neighborAtomId))
  };
}

/**
 * Returns whether an atom already sits on one or more placed rings.
 * @param {object|null} layoutGraph - Layout graph shell.
 * @param {string} atomId - Anchor atom ID.
 * @returns {boolean} True when the anchor is a ring atom.
 */
function isRingAnchor(layoutGraph, atomId) {
  return (layoutGraph?.atomToRings.get(atomId)?.length ?? 0) > 0;
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
function shouldUseGreedyBranchPlacement(layoutGraph, atomIdsToPlace, anchorAtomId, primaryNeighborIds, childDescriptors = [], branchConstraints = null) {
  if (primaryNeighborIds.length < 2) {
    return true;
  }
  const participantCount = atomIdsToPlace?.size ?? 0;
  const heavyThreshold = layoutGraph?.options?.largeMoleculeThreshold?.heavyAtomCount ?? Number.MAX_SAFE_INTEGER;
  const hasMacrocycleBudgets = (branchConstraints?.angularBudgets?.size ?? 0) > 0;
  const greedyBudget = Math.max(48, Math.floor(heavyThreshold * 0.5));
  const totalSubtreeSize = childDescriptors.reduce((sum, descriptor) => sum + descriptor.subtreeSize, 0);
  const maxSubtreeSize = childDescriptors.reduce((max, descriptor) => Math.max(max, descriptor.subtreeSize), 0);
  const largeSubtreeCount = childDescriptors.filter(
    descriptor => descriptor.subtreeSize >= BRANCH_COMPLEXITY_LIMITS.subtreeFloor
  ).length;
  if (participantCount > greedyBudget) {
    return true;
  }
  if (hasMacrocycleBudgets && participantCount > Math.max(24, Math.floor(greedyBudget * 0.5))) {
    return true;
  }
  if (
    !isRingAnchor(layoutGraph, anchorAtomId)
    &&
    primaryNeighborIds.length >= 4
    && (maxSubtreeSize >= 12 || totalSubtreeSize >= 24 || largeSubtreeCount >= 3)
  ) {
    return true;
  }
  return false;
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
  const largeSubtreeCount = childDescriptors.filter(
    descriptor => descriptor.subtreeSize >= BRANCH_COMPLEXITY_LIMITS.subtreeFloor
  ).length;

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
  }
  return Number.MAX_SAFE_INTEGER;
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
    separations.push(rawGap > 0 ? rawGap : rawGap + Math.PI * 2);
  }

  return separations.reduce((sum, separation) => sum + (separation - Math.PI / 2) ** 2, 0);
}

/**
 * Returns the angular distortion penalty for a linear center.
 * This lets upstream branch-permutation scoring favor parent-center rotations
 * that preserve downstream `sp` geometries such as nitriles and alkynes.
 * @param {object|null} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Coordinate map.
 * @param {string} atomId - Candidate linear-center atom ID.
 * @returns {number} Linear-center angular distortion penalty.
 */
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

/**
 * Returns the angular distortion penalty for a visible trigonal center.
 * This keeps parent-center rotation search from accepting a compact but
 * chemically sloppy orientation when a clean 120-degree arrangement is
 * already available for an attached unsaturated branch.
 * @param {object|null} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Coordinate map.
 * @param {string} atomId - Candidate trigonal-center atom ID.
 * @returns {number} Trigonal angular distortion penalty.
 */
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

/**
 * Returns the penalty for crowding two heavy exocyclic branches onto the same
 * side of a small saturated ring atom. Cyclopropyl and cyclobutyl quaternary
 * carbons read best when their two exocyclic heavy bonds follow the exact
 * outer continuations of the ring edges rather than leaving softened,
 * near-parallel exits off the ring vertex.
 * @param {object|null} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Coordinate map.
 * @param {string} atomId - Candidate anchor atom ID.
 * @returns {number} Exterior-gap crowding penalty.
 */
export function measureSmallRingExteriorGapSpreadPenalty(layoutGraph, coords, atomId) {
  if (!layoutGraph) {
    return 0;
  }

  const atom = layoutGraph.atoms.get(atomId);
  if (!atom || atom.element === 'H' || atom.aromatic || atom.heavyDegree !== 4) {
    return 0;
  }

  const anchorRings = layoutGraph.atomToRings.get(atomId) ?? [];
  if (anchorRings.length !== 1) {
    return 0;
  }
  const smallRing = anchorRings[0];
  if ((smallRing?.atomIds?.length ?? 0) < 3 || (smallRing?.atomIds?.length ?? 0) > 4) {
    return 0;
  }

  const atomPosition = coords.get(atomId);
  if (!atomPosition) {
    return 0;
  }

  const ringNeighborAngles = [];
  const exocyclicAngles = [];
  for (const bond of layoutGraph.bondsByAtomId.get(atomId) ?? []) {
    if (bond.kind !== 'covalent' || bond.aromatic || (bond.order ?? 1) !== 1) {
      return 0;
    }
    const neighborAtomId = bond.a === atomId ? bond.b : bond.a;
    const neighborAtom = layoutGraph.atoms.get(neighborAtomId);
    if (!neighborAtom || neighborAtom.element === 'H') {
      continue;
    }
    const neighborPosition = coords.get(neighborAtomId);
    if (!neighborPosition) {
      return 0;
    }
    if (smallRing.atomIds.includes(neighborAtomId)) {
      ringNeighborAngles.push(angleOf(sub(neighborPosition, atomPosition)));
      continue;
    }
    if ((layoutGraph.atomToRings.get(neighborAtomId)?.length ?? 0) > 0) {
      return 0;
    }
    exocyclicAngles.push(angleOf(sub(neighborPosition, atomPosition)));
  }

  if (ringNeighborAngles.length !== 2 || exocyclicAngles.length !== 2) {
    return 0;
  }

  const targetAngles = smallRingExteriorContinuationAngles(ringNeighborAngles);
  if (targetAngles.length !== 2) {
    return 0;
  }

  const alignedPenalty =
    (angularDifference(exocyclicAngles[0], targetAngles[0]) ** 2)
    + (angularDifference(exocyclicAngles[1], targetAngles[1]) ** 2);
  const swappedPenalty =
    (angularDifference(exocyclicAngles[0], targetAngles[1]) ** 2)
    + (angularDifference(exocyclicAngles[1], targetAngles[0]) ** 2);
  return Math.min(alignedPenalty, swappedPenalty);
}

/**
 * Returns the idealized angular-geometry penalty for a focused arrangement.
 * Parent-center branch search uses this to prefer rotations that keep newly
 * placed downstream groups on exact linear/trigonal depictions when available.
 * @param {object|null} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Coordinate map.
 * @param {string} anchorAtomId - Branch anchor atom ID.
 * @param {string[]} [focusAtomIds] - Newly placed atom IDs to score.
 * @returns {number} Total ideal-geometry penalty.
 */
function arrangementIdealGeometryPenalty(layoutGraph, coords, anchorAtomId, focusAtomIds = []) {
  if (!layoutGraph) {
    return 0;
  }

  let penalty = linearCenterPenalty(layoutGraph, coords, anchorAtomId) + trigonalCenterPenalty(layoutGraph, coords, anchorAtomId);
  for (const atomId of focusAtomIds) {
    if (atomId === anchorAtomId) { continue; }
    penalty += linearCenterPenalty(layoutGraph, coords, atomId);
    penalty += trigonalCenterPenalty(layoutGraph, coords, atomId);
  }
  return penalty;
}

/**
 * Returns the angular distortion penalty for a cross-like hypervalent center.
 * @param {object|null} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Coordinate map.
 * @param {string} atomId - Center atom ID.
 * @returns {number} Cross-like angular distortion penalty.
 */
function crossLikeHypervalentPenalty(layoutGraph, coords, atomId) {
  const descriptor = describeCrossLikeHypervalentCenter(layoutGraph, atomId);
  if (!descriptor) {
    return 0;
  }

  const singleAngles = descriptor.singleNeighborIds.map(neighborAtomId => {
    const neighborPosition = coords.get(neighborAtomId);
    const atomPosition = coords.get(atomId);
    return neighborPosition && atomPosition ? angleOf(sub(neighborPosition, atomPosition)) : null;
  });
  const multipleAngles = descriptor.multipleNeighborIds.map(neighborAtomId => {
    const neighborPosition = coords.get(neighborAtomId);
    const atomPosition = coords.get(atomId);
    return neighborPosition && atomPosition ? angleOf(sub(neighborPosition, atomPosition)) : null;
  });
  if (singleAngles[0] == null || singleAngles[1] == null || multipleAngles[0] == null || multipleAngles[1] == null) {
    return 0;
  }

  let penalty = (angularDifference(singleAngles[0], singleAngles[1]) - Math.PI) ** 2;
  penalty += (angularDifference(multipleAngles[0], multipleAngles[1]) - Math.PI) ** 2;
  for (const singleAngle of singleAngles) {
    for (const multipleAngle of multipleAngles) {
      penalty += (angularDifference(singleAngle, multipleAngle) - DEG90) ** 2;
    }
  }
  return penalty;
}

function arrangementCost(layoutGraph, coords, bondLength, anchorAtomId, focusAtomIds = [], atomGrid = null) {
  const layoutCost =
    !layoutGraph
      ? 0
      : shouldUseFocusedArrangementCost(layoutGraph, coords, focusAtomIds)
        ? measureFocusedPlacementCost(layoutGraph, coords, bondLength, focusAtomIds, { atomGrid })
        : measureLayoutCost(layoutGraph, coords, bondLength);
  return layoutCost
    + tetrahedralSpreadPenalty(layoutGraph, coords, anchorAtomId) * ARRANGEMENT_IDEAL_GEOMETRY_WEIGHT
    + measureSmallRingExteriorGapSpreadPenalty(layoutGraph, coords, anchorAtomId) * SMALL_RING_EXTERIOR_GAP_WEIGHT
    + crossLikeHypervalentPenalty(layoutGraph, coords, anchorAtomId) * ARRANGEMENT_IDEAL_GEOMETRY_WEIGHT
    + arrangementIdealGeometryPenalty(layoutGraph, coords, anchorAtomId, focusAtomIds) * ARRANGEMENT_IDEAL_GEOMETRY_WEIGHT;
}

/**
 * Builds candidate child-angle sets for one multi-child branch placement step.
 * @param {Map<string, string[]>} adjacency - Component adjacency map.
 * @param {Map<string, {x: number, y: number}>} coords - Current coordinate map.
 * @param {string} anchorAtomId - Anchor atom ID.
 * @param {string|null} parentAtomId - Already placed parent atom ID.
 * @param {string[]} unplacedNeighborIds - Immediate unplaced child atom IDs.
 * @param {object|null} [layoutGraph] - Layout graph shell.
 * @param {{angularBudgets?: Map<string, {centerAngle: number, minOffset: number, maxOffset: number, preferredAngle: number}>}|null} [branchConstraints] - Optional branch-angle constraints keyed by anchor atom ID.
 * @returns {number[][]} Candidate angle sets sized to the requested child count.
 */
function buildCandidateAngleSets(adjacency, coords, anchorAtomId, parentAtomId, unplacedNeighborIds, layoutGraph = null, branchConstraints = null) {
  const anchorPosition = coords.get(anchorAtomId);
  const currentPlacedNeighborIds = placedNeighborIds(adjacency, coords, anchorAtomId);
  const currentPlacedNeighborAngles = currentPlacedNeighborIds.map(neighborAtomId => angleOf(sub(coords.get(neighborAtomId), anchorPosition)));
  const ringAngles = preferredRingAngles(layoutGraph, coords, anchorAtomId);
  const fromRing = ringAngles.length > 0;
  const incomingAngle = parentAtomId && coords.has(parentAtomId) ? angleOf(sub(coords.get(parentAtomId), anchorPosition)) : ringAngles[0] == null ? 0 : ringAngles[0] + Math.PI;
  const outAngle = ringAngles[0] ?? incomingAngle + Math.PI;
  const hasMultipleBond = hasNonAromaticMultipleBond(layoutGraph, anchorAtomId);
  const isLinear = isLinearCenter(layoutGraph, anchorAtomId);

  const shouldUseGapStrategy =
    !fromRing &&
    currentPlacedNeighborIds.length > 0 &&
    (currentPlacedNeighborIds.length >= 2 ||
      (!isLinear && !hasMultipleBond && unplacedNeighborIds.length >= 2) ||
      (unplacedNeighborIds.length === 1 && currentPlacedNeighborIds.length >= 2));

  const fallbackAngleSets = shouldUseGapStrategy
    ? [
        largestGapAngles(currentPlacedNeighborAngles, unplacedNeighborIds.length)
      ]
    : [computeLegacyChildAngles(unplacedNeighborIds.length, outAngle, fromRing, incomingAngle, isLinear)];

  const ringExteriorGapAngleSets =
    shouldTryRingExteriorGapSpread(layoutGraph, anchorAtomId, currentPlacedNeighborIds, unplacedNeighborIds) && !hasMultipleBond && !isLinear
      ? [largestGapAngles(currentPlacedNeighborAngles, unplacedNeighborIds.length)]
      : [];
  const exactExteriorAngleSets =
    !hasMultipleBond && !isLinear
      ? exactSmallRingExteriorAngleSets(layoutGraph, coords, anchorAtomId, currentPlacedNeighborIds, unplacedNeighborIds)
      : [];

  return [...crossLikeHypervalentAngleSets(adjacency, coords, anchorAtomId, currentPlacedNeighborIds, unplacedNeighborIds, layoutGraph), ...exactExteriorAngleSets, ...ringExteriorGapAngleSets, ...fallbackAngleSets]
    .map(angleSet => filterAnglesByBudget(angleSet, anchorAtomId, branchConstraints))
    .filter(angleSet => angleSet.length === unplacedNeighborIds.length);
}

/**
 * Evaluates candidate child-order and angle permutations for one branching step.
 * @param {Map<string, string[]>} adjacency - Component adjacency map.
 * @param {Map<string, number>} canonicalAtomRank - Canonical atom-rank map.
 * @param {Map<string, {x: number, y: number}>} coords - Current coordinate map.
 * @param {{sumX: number, sumY: number, count: number, trackedPositions: Map<string, {x: number, y: number}>}} placementState - Running placement CoM state.
 * @param {Set<string>} atomIdsToPlace - Eligible atom IDs for recursive placement.
 * @param {string} anchorAtomId - Anchor atom ID.
 * @param {number} bondLength - Target bond length.
 * @param {object|null} [layoutGraph] - Layout graph shell.
 * @param {{angularBudgets?: Map<string, {centerAngle: number, minOffset: number, maxOffset: number, preferredAngle: number}>}|null} [branchConstraints] - Optional branch-angle constraints keyed by anchor atom ID.
 * @param {number} [depth] - Recursive depth counter.
 * @param {{x: number, y: number}} anchorPosition - Anchor position.
 * @param {number[][]} angleSets - Candidate angle sets.
 * @param {Array<{childAtomId: string, subtreeSize: number}>} childDescriptors - Child descriptors to permute.
 * @param {import('../geometry/atom-grid.js').AtomGrid|null} [baseAtomGrid] - Optional spatial grid for the currently placed coords.
 * @returns {{cost: number, coords: Map<string, {x: number, y: number}>, placementState: {sumX: number, sumY: number, count: number, trackedPositions: Map<string, {x: number, y: number}>}}|null} Best evaluated placement snapshot.
 */
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
  baseAtomGrid = null
) {
  const orderedChildDescriptors = orderChildDescriptors(childDescriptors, canonicalAtomRank);
  const childPermutations = permutations(orderedChildDescriptors, branchPermutationBudget(layoutGraph, anchorAtomId, orderedChildDescriptors, branchConstraints));
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
        setPlacedPosition(tempCoords, tempPlacementState, placement.childAtomId, add(anchorPosition, fromAngle(placement.angle, bondLength)), layoutGraph);
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
          branchConstraints,
          depth + 1
        );
      }

      const newlyPlacedAtomIds = collectNewlyPlacedAtomIds(coords, tempCoords);
      const candidateAtomGrid = buildCandidateArrangementAtomGrid(layoutGraph, baseAtomGrid, tempCoords, newlyPlacedAtomIds);
      const cost = arrangementCost(layoutGraph, tempCoords, bondLength, anchorAtomId, newlyPlacedAtomIds, candidateAtomGrid);
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
  branchConstraints = null,
  depth = 0,
  childDescriptors = null
) {
  const anchorPosition = coords.get(anchorAtomId);
  if (!anchorPosition || unplacedNeighborIds.length === 0 || depth > MAX_BRANCH_RECURSION_DEPTH) {
    return [];
  }

  const angleSets = buildCandidateAngleSets(adjacency, coords, anchorAtomId, parentAtomId, unplacedNeighborIds, layoutGraph, branchConstraints);
  const baseAtomGrid = layoutGraph ? buildAtomGrid(layoutGraph, coords, bondLength) : null;
  const resolvedChildDescriptors = childDescriptors ?? unplacedNeighborIds.map(childAtomId => ({
    childAtomId,
    subtreeSize: subtreeHeavyAtomCount(adjacency, layoutGraph, coords, childAtomId, anchorAtomId)
  }));
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
    angleSets,
    resolvedChildDescriptors,
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
 * @param {string|null} [attachedAtomId] - Unplaced atom being attached to the anchor.
 * @param {{angularBudgets?: Map<string, {centerAngle: number, minOffset: number, maxOffset: number, preferredAngle: number}>}|null} [branchConstraints] - Optional branch-angle constraints keyed by anchor atom ID.
 * @returns {number} Chosen attachment angle.
 */
export function chooseAttachmentAngle(adjacency, coords, anchorAtomId, atomIdsToPlace, preferredAngle = null, layoutGraph = null, attachedAtomId = null, branchConstraints = null) {
  const occupiedAngles = occupiedNeighborAngles(adjacency, coords, anchorAtomId, atomIdsToPlace);
  if (attachedAtomId) {
    const allowFinePreferredAngles = isRingAnchor(layoutGraph, anchorAtomId);
    const placedNeighborIds = neighborOrder(
      (adjacency.get(anchorAtomId) ?? []).filter(neighborAtomId => coords.has(neighborAtomId) && atomIdsToPlace.has(neighborAtomId)),
      layoutGraph?.canonicalAtomRank ?? new Map()
    );
    const parentAtomId = placedNeighborIds.length === 1 ? placedNeighborIds[0] : null;
    const continuationAngles = preferredBranchAngles(adjacency, coords, anchorAtomId, atomIdsToPlace, parentAtomId, attachedAtomId, layoutGraph);
    const constrainedContinuationAngles = mergeCandidateAngles(
      filterAnglesByBudget(continuationAngles, anchorAtomId, branchConstraints),
      budgetPreferredAngles(anchorAtomId, branchConstraints)
    );
    if (
      isExactRingOutwardEligibleSubstituent(layoutGraph, anchorAtomId, attachedAtomId)
      || isExactAcyclicHeteroContinuationEligible(layoutGraph, anchorAtomId, parentAtomId, attachedAtomId)
    ) {
      const exactPreferredAngle = chooseExactPreferredAngle(
        coords.get(anchorAtomId),
        1,
        coords,
        occupiedAngles,
        constrainedContinuationAngles,
        new Set([anchorAtomId]),
        null,
        incidentRingPolygons(layoutGraph, coords, anchorAtomId)
      );
      if (exactPreferredAngle != null) {
        return exactPreferredAngle;
      }
    }
    const preferredContinuationAngle = choosePreferredDiscreteAngle(occupiedAngles, constrainedContinuationAngles, allowFinePreferredAngles);
    if (preferredContinuationAngle != null && hasSafePreferredDiscreteAngle(occupiedAngles, constrainedContinuationAngles, allowFinePreferredAngles)) {
      return preferredContinuationAngle;
    }
  }

  const preferredAngles = resolvedPreferredAngles(
    anchorAtomId,
    [...(preferredAngle == null ? [] : [preferredAngle]), ...preferredRingAngles(layoutGraph, coords, anchorAtomId)],
    branchConstraints
  );
  const constrainedCandidateAngles = mergeCandidateAngles(
    filterAnglesByBudget(DISCRETE_BRANCH_ANGLES, anchorAtomId, branchConstraints),
    budgetPreferredAngles(anchorAtomId, branchConstraints)
  );
  return pickBestCandidateAngle(
    evaluateAngleCandidates(
      constrainedCandidateAngles,
      occupiedAngles,
      preferredAngles,
      coords.get(anchorAtomId),
      1,
      coords,
      new Set([anchorAtomId]),
      null,
      incidentRingPolygons(layoutGraph, coords, anchorAtomId)
    ),
    1,
    false,
    {
      anchorPosition: coords.get(anchorAtomId),
      coords,
      excludedAtomIds: new Set([anchorAtomId])
    }
  );
}

function preferredBranchAngles(adjacency, coords, anchorAtomId, _atomIdsToPlace, parentAtomId, childAtomId, layoutGraph = null) {
  const anchorPosition = coords.get(anchorAtomId);
  if (!anchorPosition) {
    return [];
  }
  const placedNeighborIds = (adjacency.get(anchorAtomId) ?? []).filter(neighborAtomId => coords.has(neighborAtomId));
  const ringJunctionGapAngle = preferredRingJunctionGapAngle(layoutGraph, coords, anchorAtomId, placedNeighborIds, childAtomId);
  if (ringJunctionGapAngle != null) {
    return [ringJunctionGapAngle];
  }
  const smallRingExteriorAngles = preferredSmallRingExteriorGapAngles(layoutGraph, coords, anchorAtomId, placedNeighborIds, childAtomId);
  if (smallRingExteriorAngles.length > 0) {
    return smallRingExteriorAngles;
  }
  const childBond = childAtomId ? findLayoutBond(layoutGraph, anchorAtomId, childAtomId) : null;
  if (placedNeighborIds.length === 2 && childBond && !childBond.aromatic && (childBond.order ?? 1) >= 2) {
    const trigonalBisectorAngle = preferredTrigonalBisectorAngle(coords, anchorAtomId, placedNeighborIds);
    if (trigonalBisectorAngle != null) {
      return [trigonalBisectorAngle];
    }
  }
  const ringAngles = preferredRingAngles(layoutGraph, coords, anchorAtomId);
  if (ringAngles.length > 0) {
    return ringAngles;
  }
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
  return [forwardAngle + CHAIN_CONTINUATION_OFFSET, forwardAngle - CHAIN_CONTINUATION_OFFSET];
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

  let occupiedAngles = occupiedNeighborAngles(adjacency, coords, anchorAtomId, atomIdsToPlace);
  const ringPolygons = incidentRingPolygons(layoutGraph, coords, anchorAtomId);

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
    const shouldHonorPreferredAngle = preferredAngles.length > 0 && !childIsHydrogen && (currentPlacedNeighborIds.length === 1 || isRingAnchor(layoutGraph, anchorAtomId));
    const allowFinePreferredAngles = shouldHonorPreferredAngle && isRingAnchor(layoutGraph, anchorAtomId);
    const shouldForceExactTrigonalAngle =
      preferredAngles.length > 0
      && !childIsHydrogen
      && childBond != null
      && isTerminalMultipleBondLeaf(layoutGraph, anchorAtomId, childBond);
    const shouldForceExactAcyclicHeteroAngle =
      shouldHonorPreferredAngle
      && isExactAcyclicHeteroContinuationEligible(layoutGraph, anchorAtomId, parentAtomId, childAtomId);
    const exactPreferredAngle =
      ((shouldHonorPreferredAngle && isExactRingOutwardEligibleSubstituent(layoutGraph, anchorAtomId, childAtomId)) || shouldForceExactTrigonalAngle || shouldForceExactAcyclicHeteroAngle)
        ? chooseExactPreferredAngle(anchorPosition, bondLength, coords, occupiedAngles, constrainedPreferredAngles, excludedAtomIds, placementState, ringPolygons)
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
      ringPolygons
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
            allowFinePreferredAngles
          )
        : pickBestCandidateAngle(fallbackCandidates, bondLength, !childIsHydrogen, {
            anchorPosition,
            coords,
            excludedAtomIds
          }));
    setPlacedPosition(coords, placementState, childAtomId, add(anchorPosition, fromAngle(chosenAngle, bondLength)), layoutGraph);
    occupiedAngles = occupiedAngles.concat([chosenAngle]);
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

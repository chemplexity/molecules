/** @module placement/branch-placement/angle-selection */

import { add, angleOf, angularDifference, centroid, distance, fromAngle, length, perpLeft, sub } from '../../geometry/vec2.js';
import { countPointInPolygons } from '../../geometry/polygon.js';
import { BRANCH_CLEARANCE_FLOOR_FACTOR } from '../../constants.js';
import {
  ANGLE_SCORE_TIEBREAK_RATIO,
  CENTERED_NEIGHBOR_EPSILON,
  CHAIN_CONTINUATION_OFFSET,
  CROSS_LIKE_HYPERVALENT_ELEMENTS,
  DEG15,
  DEG30,
  DEG60,
  DEG90,
  DEG120,
  DISCRETE_BRANCH_ANGLES,
  STRICT_ACYCLIC_CONTINUATION_HETERO_ELEMENTS,
  centerDistanceScore,
  isRingAnchor,
  neighborOrder,
  normalizeSignedAngle,
  placedNeighborIds
} from './shared.js';

/**
 * Returns the bond angles of all already placed neighbors around an anchor.
 * @param {Map<string, string[]>} adjacency - Component adjacency map.
 * @param {Map<string, {x: number, y: number}>} coords - Current coordinate map.
 * @param {string} anchorAtomId - Anchor atom ID.
 * @param {Set<string>} _atomIdsToPlace - Eligible atom IDs for the current placement slice.
 * @returns {number[]} Occupied neighbor angles in radians.
 */
export function occupiedNeighborAngles(adjacency, coords, anchorAtomId, _atomIdsToPlace) {
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
export function filterAnglesByBudget(candidateAngles, anchorAtomId, branchConstraints) {
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
export function budgetPreferredAngles(anchorAtomId, branchConstraints) {
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
export function mergeCandidateAngles(baseAngles, extraAngles) {
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
export function resolvedPreferredAngles(anchorAtomId, fallbackPreferredAngles, branchConstraints) {
  const budgetAngles = budgetPreferredAngles(anchorAtomId, branchConstraints);
  return budgetAngles.length > 0 ? budgetAngles : fallbackPreferredAngles;
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

/**
 * Returns the layout bond descriptor for an unordered atom pair.
 * @param {object|null} layoutGraph - Layout graph shell.
 * @param {string} firstAtomId - First atom ID.
 * @param {string} secondAtomId - Second atom ID.
 * @returns {object|null} Matching bond descriptor, or `null`.
 */
export function findLayoutBond(layoutGraph, firstAtomId, secondAtomId) {
  if (!layoutGraph) {
    return null;
  }
  const key = firstAtomId < secondAtomId ? `${firstAtomId}:${secondAtomId}` : `${secondAtomId}:${firstAtomId}`;
  return layoutGraph.bondByAtomPair.get(key) ?? null;
}

/**
 * Returns whether an atom has any non-aromatic multiple bond.
 * @param {object|null} layoutGraph - Layout graph shell.
 * @param {string} atomId - Atom ID.
 * @returns {boolean} True when the atom has a double or triple bond.
 */
export function hasNonAromaticMultipleBond(layoutGraph, atomId) {
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

/**
 * Returns whether an atom should be treated as an `sp`-like linear center.
 * @param {object|null} layoutGraph - Layout graph shell.
 * @param {string} atomId - Atom ID.
 * @returns {boolean} True when the center is effectively linear.
 */
export function isLinearCenter(layoutGraph, atomId) {
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
export function isTerminalMultipleBondLeaf(layoutGraph, centerAtomId, bond) {
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
export function isExactRingOutwardEligibleSubstituent(layoutGraph, anchorAtomId, childAtomId) {
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
export function isExactAcyclicHeteroContinuationEligible(layoutGraph, anchorAtomId, parentAtomId, childAtomId) {
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

function preferredRingJunctionGapAngle(layoutGraph, coords, anchorAtomId, placedNeighborIdsList, childAtomId) {
  if (!layoutGraph || !coords.has(anchorAtomId) || !childAtomId) {
    return null;
  }
  if ((layoutGraph.atomToRings.get(anchorAtomId)?.length ?? 0) === 0 || (layoutGraph.atomToRings.get(childAtomId)?.length ?? 0) > 0) {
    return null;
  }

  const ringNeighborIds = placedNeighborIdsList.filter(neighborAtomId => (layoutGraph.atomToRings.get(neighborAtomId)?.length ?? 0) > 0);
  if (ringNeighborIds.length < 3 || ringNeighborIds.length !== placedNeighborIdsList.length) {
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

function preferredTrigonalBisectorAngle(coords, anchorAtomId, placedNeighborIdsList) {
  if (placedNeighborIdsList.length !== 2 || !coords.has(anchorAtomId)) {
    return null;
  }

  const anchorPosition = coords.get(anchorAtomId);
  const neighborPositions = placedNeighborIdsList.map(neighborAtomId => coords.get(neighborAtomId)).filter(Boolean);
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
export function incidentRingPolygons(layoutGraph, coords, anchorAtomId) {
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
export function pickBestCandidateAngle(candidates, bondLength, preferClearance = true, clearanceContext = null) {
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
export function evaluateAngleCandidates(candidateAngles, occupiedAngles, preferredAngles, anchorPosition, bondLength, coords, excludedAtomIds, placementState, ringPolygons = []) {
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
export function chooseContinuationAngle(
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
export function chooseExactPreferredAngle(anchorPosition, bondLength, coords, occupiedAngles, preferredAngles, excludedAtomIds, placementState, ringPolygons = []) {
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

function smallRingExteriorContinuationAngles(ringNeighborAngles) {
  return ringNeighborAngles.map(ringNeighborAngle => normalizeSignedAngle(ringNeighborAngle + Math.PI));
}

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

function preferredSmallRingExteriorGapAngles(layoutGraph, coords, anchorAtomId, placedNeighborIdsList, childAtomId) {
  if (!layoutGraph || !coords.has(anchorAtomId) || !childAtomId) {
    return [];
  }

  const descriptor = describeSmallRingExteriorSpreadAnchor(layoutGraph, anchorAtomId);
  if (!descriptor || !descriptor.exocyclicNeighborIds.includes(childAtomId)) {
    return [];
  }

  const atomPosition = coords.get(anchorAtomId);
  const placedRingNeighborIds = descriptor.ringNeighborIds.filter(neighborAtomId => placedNeighborIdsList.includes(neighborAtomId) && coords.has(neighborAtomId));
  if (placedRingNeighborIds.length !== 2) {
    return [];
  }

  const ringNeighborAngles = placedRingNeighborIds.map(neighborAtomId => angleOf(sub(coords.get(neighborAtomId), atomPosition)));
  const targetAngles = smallRingExteriorContinuationAngles(ringNeighborAngles);
  if (targetAngles.length !== descriptor.exocyclicNeighborIds.length) {
    return [];
  }

  const placedExocyclicNeighborIds = descriptor.exocyclicNeighborIds.filter(
    neighborAtomId => neighborAtomId !== childAtomId && placedNeighborIdsList.includes(neighborAtomId) && coords.has(neighborAtomId)
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
export function buildCandidateAngleSets(adjacency, coords, anchorAtomId, parentAtomId, unplacedNeighborIds, layoutGraph = null, branchConstraints = null) {
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
 * Returns preferred continuation angles for a child branch at the current anchor.
 * @param {Map<string, string[]>} adjacency - Component adjacency map.
 * @param {Map<string, {x: number, y: number}>} coords - Current coordinate map.
 * @param {string} anchorAtomId - Anchor atom ID.
 * @param {Set<string>} _atomIdsToPlace - Eligible atom IDs for the current placement slice.
 * @param {string|null} parentAtomId - Already placed parent atom ID.
 * @param {string|null} childAtomId - Child atom being placed.
 * @param {object|null} [layoutGraph] - Layout graph shell.
 * @returns {number[]} Preferred angles in radians.
 */
export function preferredBranchAngles(adjacency, coords, anchorAtomId, _atomIdsToPlace, parentAtomId, childAtomId, layoutGraph = null) {
  const anchorPosition = coords.get(anchorAtomId);
  if (!anchorPosition) {
    return [];
  }
  const placedNeighborIdsList = (adjacency.get(anchorAtomId) ?? []).filter(neighborAtomId => coords.has(neighborAtomId));
  const ringJunctionGapAngle = preferredRingJunctionGapAngle(layoutGraph, coords, anchorAtomId, placedNeighborIdsList, childAtomId);
  if (ringJunctionGapAngle != null) {
    return [ringJunctionGapAngle];
  }
  const smallRingExteriorAngles = preferredSmallRingExteriorGapAngles(layoutGraph, coords, anchorAtomId, placedNeighborIdsList, childAtomId);
  if (smallRingExteriorAngles.length > 0) {
    return smallRingExteriorAngles;
  }
  const childBond = childAtomId ? findLayoutBond(layoutGraph, anchorAtomId, childAtomId) : null;
  if (placedNeighborIdsList.length === 2 && childBond && !childBond.aromatic && (childBond.order ?? 1) >= 2) {
    const trigonalBisectorAngle = preferredTrigonalBisectorAngle(coords, anchorAtomId, placedNeighborIdsList);
    if (trigonalBisectorAngle != null) {
      return [trigonalBisectorAngle];
    }
  }
  const ringAngles = preferredRingAngles(layoutGraph, coords, anchorAtomId);
  if (ringAngles.length > 0) {
    return ringAngles;
  }
  if (placedNeighborIdsList.length >= 2) {
    if (placedNeighborIdsList.length === 2) {
      const neighborCenter = centroid(placedNeighborIdsList.map(neighborAtomId => coords.get(neighborAtomId)));
      const outwardVector = sub(anchorPosition, neighborCenter);
      if (length(outwardVector) <= CENTERED_NEIGHBOR_EPSILON) {
        const neighborAxis = sub(coords.get(placedNeighborIdsList[1]), coords.get(placedNeighborIdsList[0]));
        const perpendicular = perpLeft(neighborAxis);
        if (length(perpendicular) > CENTERED_NEIGHBOR_EPSILON) {
          const perpendicularAngle = angleOf(perpendicular);
          return [perpendicularAngle, perpendicularAngle + Math.PI];
        }
      }
    }
    const neighborCenter = centroid(placedNeighborIdsList.map(neighborAtomId => coords.get(neighborAtomId)));
    return [angleOf(sub(anchorPosition, neighborCenter))];
  }
  const resolvedParentAtomId = parentAtomId ?? placedNeighborIdsList[0] ?? null;
  if (!resolvedParentAtomId || !coords.has(resolvedParentAtomId)) {
    return [];
  }
  const forwardAngle = angleOf(sub(anchorPosition, coords.get(resolvedParentAtomId)));
  if (prefersLinearContinuation(layoutGraph, anchorAtomId, resolvedParentAtomId, childAtomId)) {
    return [forwardAngle];
  }
  return [forwardAngle + CHAIN_CONTINUATION_OFFSET, forwardAngle - CHAIN_CONTINUATION_OFFSET];
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
    const placedNeighborIdsList = neighborOrder(
      (adjacency.get(anchorAtomId) ?? []).filter(neighborAtomId => coords.has(neighborAtomId) && atomIdsToPlace.has(neighborAtomId)),
      layoutGraph?.canonicalAtomRank ?? new Map()
    );
    const parentAtomId = placedNeighborIdsList.length === 1 ? placedNeighborIdsList[0] : null;
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

/** @module placement/branch-placement/shared */

import { compareCanonicalAtomIds } from '../../topology/canonical-order.js';

export const BRANCH_COMPLEXITY_LIMITS = Object.freeze({
  subtreeFloor: 4,
  mediumMaxPermutations: 6,
  highMaxPermutations: 3,
  extremeMaxPermutations: 2
});

export const DISCRETE_BRANCH_ANGLES = Array.from({ length: 12 }, (_, index) => (index * Math.PI) / 6);
export const CHAIN_CONTINUATION_OFFSET = Math.PI / 3;
export const CENTERED_NEIGHBOR_EPSILON = 1e-6;
export const DEG90 = Math.PI / 2;
export const DEG60 = Math.PI / 3;
export const DEG120 = (2 * Math.PI) / 3;
export const DEG30 = Math.PI / 6;
export const DEG15 = Math.PI / 12;
export const ANGLE_SCORE_TIEBREAK_RATIO = 0.05;
export const MAX_BRANCH_RECURSION_DEPTH = 120;
export const ARRANGEMENT_IDEAL_GEOMETRY_WEIGHT = 20;
export const SMALL_RING_EXTERIOR_GAP_WEIGHT = 80;
export const CROSS_LIKE_HYPERVALENT_ELEMENTS = new Set(['S', 'P', 'Se', 'As']);
export const STRICT_ACYCLIC_CONTINUATION_HETERO_ELEMENTS = new Set(['O', 'S', 'Se']);

/**
 * Normalizes an angle into the signed `(-pi, pi]` range.
 * @param {number} angle - Input angle in radians.
 * @returns {number} Wrapped signed angle.
 */
export function normalizeSignedAngle(angle) {
  let wrappedAngle = angle;
  while (wrappedAngle > Math.PI) {
    wrappedAngle -= 2 * Math.PI;
  }
  while (wrappedAngle <= -Math.PI) {
    wrappedAngle += 2 * Math.PI;
  }
  return wrappedAngle;
}

/**
 * Sorts atom IDs by canonical rank with lexical fallback stability.
 * @param {string[]} neighbors - Neighbor atom IDs.
 * @param {Map<string, number>} canonicalAtomRank - Canonical rank lookup.
 * @returns {string[]} Sorted atom IDs.
 */
export function neighborOrder(neighbors, canonicalAtomRank) {
  return [...neighbors].sort((firstAtomId, secondAtomId) => compareCanonicalAtomIds(firstAtomId, secondAtomId, canonicalAtomRank));
}

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
export function seedPlacementState(layoutGraph, coords) {
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
export function clonePlacementState(placementState) {
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
export function copyPlacementState(targetState, sourceState) {
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
export function setPlacedPosition(coords, placementState, atomId, position, layoutGraph) {
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
export function centerDistanceScore(placementState, candidatePosition) {
  if (!placementState || placementState.count <= 0) {
    return 0;
  }
  const centerX = placementState.sumX / placementState.count;
  const centerY = placementState.sumY / placementState.count;
  return Math.hypot(candidatePosition.x - centerX, candidatePosition.y - centerY);
}

/**
 * Returns the currently placed neighbors of an anchor atom.
 * @param {Map<string, string[]>} adjacency - Component adjacency map.
 * @param {Map<string, {x: number, y: number}>} coords - Current coordinate map.
 * @param {string} anchorAtomId - Anchor atom ID.
 * @returns {string[]} Already placed neighbor IDs.
 */
export function placedNeighborIds(adjacency, coords, anchorAtomId) {
  return (adjacency.get(anchorAtomId) ?? []).filter(neighborAtomId => coords.has(neighborAtomId));
}

/**
 * Returns whether the requested atom is a hydrogen atom.
 * @param {object|null} layoutGraph - Layout graph shell.
 * @param {string} atomId - Atom ID.
 * @returns {boolean} True when the atom is hydrogen.
 */
export function isHydrogenAtom(layoutGraph, atomId) {
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

/**
 * Splits unplaced neighbors into primary heavy branches and deferred leaf atoms.
 * @param {string[]} unplacedNeighborIds - Unplaced neighbor IDs.
 * @param {object|null} layoutGraph - Layout graph shell.
 * @returns {{primaryNeighborIds: string[], deferredNeighborIds: string[]}} Split neighbor lists.
 */
export function splitDeferredLeafNeighbors(unplacedNeighborIds, layoutGraph) {
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
export function isRingAnchor(layoutGraph, atomId) {
  return (layoutGraph?.atomToRings.get(atomId)?.length ?? 0) > 0;
}

/**
 * Counts unplaced heavy atoms in the subtree reached across one cut bond.
 * @param {Map<string, string[]>} adjacency - Component adjacency map.
 * @param {object|null} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Current coordinate map.
 * @param {string} rootAtomId - Root atom on the traversed side.
 * @param {string} blockedAtomId - Atom on the blocked side of the cut.
 * @returns {number} Heavy-atom count in the subtree.
 */
export function subtreeHeavyAtomCount(adjacency, layoutGraph, coords, rootAtomId, blockedAtomId) {
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

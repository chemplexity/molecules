/** @module families/spiro */

import { circumradiusForRegularPolygon, placeRegularPolygon } from '../geometry/polygon.js';
import { add, angleOf, angularDifference, centroid, distance, fromAngle, normalize, scale, sub } from '../geometry/vec2.js';
import { placeTemplateCoords } from '../templates/placement.js';

const SPIRO_PATH_CENTER_OFFSETS = Object.freeze([
  0,
  Math.PI / 12,
  Math.PI / 6,
  Math.PI / 4,
  Math.PI / 3
]);
const SPIRO_JUNCTION_CLEARANCE_FACTOR = 0.95;
const SPIRO_JUNCTION_ANGLE_EPSILON = 1e-9;

/**
 * Returns a ring ordering for simple spiro chains when the spiro graph is a path.
 * @param {object[]} rings - Ring descriptors in the target spiro system.
 * @param {Map<string, object>} ringConnectionByPair - Pair-keyed ring connection map.
 * @returns {number[]|null} Ordered ring IDs from one endpoint to the other, or null for non-path graphs.
 */
function orderSpiroPath(rings, ringConnectionByPair) {
  if (rings.length < 3) {
    return null;
  }

  const spiroAdj = new Map(rings.map(ring => [ring.id, []]));
  let edgeCount = 0;

  for (const connection of ringConnectionByPair.values()) {
    if (!connection || connection.kind !== 'spiro') {
      continue;
    }
    spiroAdj.get(connection.firstRingId)?.push(connection.secondRingId);
    spiroAdj.get(connection.secondRingId)?.push(connection.firstRingId);
    edgeCount += 1;
  }

  if (edgeCount !== rings.length - 1) {
    return null;
  }

  const endpoints = [];
  for (const ring of rings) {
    const degree = spiroAdj.get(ring.id)?.length ?? 0;
    if (degree > 2) {
      return null;
    }
    if (degree === 1) {
      endpoints.push(ring);
    }
  }

  if (endpoints.length !== 2) {
    return null;
  }

  endpoints.sort((firstRing, secondRing) => {
    const sizeDelta = secondRing.atomIds.length - firstRing.atomIds.length;
    return sizeDelta !== 0 ? sizeDelta : firstRing.id - secondRing.id;
  });
  const ordered = [];
  const visited = new Set();
  let currentRingId = endpoints[0].id;
  let previousRingId = null;

  while (currentRingId != null && !visited.has(currentRingId)) {
    ordered.push(currentRingId);
    visited.add(currentRingId);
    const nextRingId = (spiroAdj.get(currentRingId) ?? []).find(neighborRingId => neighborRingId !== previousRingId) ?? null;
    previousRingId = currentRingId;
    currentRingId = nextRingId;
  }

  return ordered.length === rings.length ? ordered : null;
}

/**
 * Returns whether path walking should own a spiro chain. When the largest ring
 * sits inside the path rather than at an endpoint, the largest ring is usually
 * the parent scaffold and smaller spiro rings should be placed outward from it.
 * In that shape, endpoint-rooted path walking can pinch the small-ring exits
 * against the parent ring.
 * @param {object[]} rings - Ring descriptors in the target spiro system.
 * @param {number[]} ringOrder - Candidate path order from one endpoint to the other.
 * @param {Map<string, object>} ringConnectionByPair - Pair-keyed ring connection map.
 * @returns {boolean} True when endpoint-rooted path placement should be used.
 */
function shouldUseEndpointSpiroPath(rings, ringOrder, ringConnectionByPair) {
  if (!ringOrder || ringOrder.length < 3) {
    return false;
  }

  const ringById = new Map(rings.map(ring => [ring.id, ring]));
  const endpointSizes = [
    ringById.get(ringOrder[0])?.atomIds.length ?? 0,
    ringById.get(ringOrder[ringOrder.length - 1])?.atomIds.length ?? 0
  ];
  const largestEndpointSize = Math.max(...endpointSizes);

  for (let index = 1; index < ringOrder.length - 1; index++) {
    const ring = ringById.get(ringOrder[index]);
    if (!ring || ring.atomIds.length <= largestEndpointSize) {
      continue;
    }

    const previousConnectionKey = ringOrder[index - 1] < ring.id ? `${ringOrder[index - 1]}:${ring.id}` : `${ring.id}:${ringOrder[index - 1]}`;
    const nextConnectionKey = ring.id < ringOrder[index + 1] ? `${ring.id}:${ringOrder[index + 1]}` : `${ringOrder[index + 1]}:${ring.id}`;
    if (ringConnectionByPair.has(previousConnectionKey) && ringConnectionByPair.has(nextConnectionKey)) {
      return false;
    }
  }

  return true;
}

/**
 * Rotates an atom ordering so the shared spiro atom is first.
 * @param {string[]} atomIds - Ring atom IDs in perimeter order.
 * @param {string} startAtomId - Shared atom ID to place first.
 * @returns {string[]} Rotated atom IDs.
 */
function rotateSequenceToStart(atomIds, startAtomId) {
  const startIndex = atomIds.indexOf(startAtomId);
  if (startIndex < 0) {
    return [...atomIds];
  }
  return atomIds.slice(startIndex).concat(atomIds.slice(0, startIndex));
}

/**
 * Generates one candidate regular-polygon placement for a spiro ring around its shared atom.
 * @param {object} ring - Ring descriptor.
 * @param {string} sharedAtomId - Shared spiro atom ID.
 * @param {{x: number, y: number}} sharedPosition - Shared atom position.
 * @param {{x: number, y: number}} center - Candidate ring center.
 * @param {number} sign - Perimeter direction, either 1 or -1.
 * @param {number} bondLength - Target bond length.
 * @returns {Map<string, {x: number, y: number}>} Candidate coordinates.
 */
function candidateSpiroRingCoords(ring, sharedAtomId, sharedPosition, center, sign, bondLength) {
  const orderedAtomIds = rotateSequenceToStart(ring.atomIds, sharedAtomId);
  const startAngle = angleOf(sub(sharedPosition, center));
  const step = sign * ((2 * Math.PI) / orderedAtomIds.length);
  const radius = circumradiusForRegularPolygon(orderedAtomIds.length, bondLength);
  const coords = new Map([[sharedAtomId, sharedPosition]]);
  for (let index = 1; index < orderedAtomIds.length; index++) {
    coords.set(orderedAtomIds[index], add(center, fromAngle(startAngle + index * step, radius)));
  }
  return coords;
}

/**
 * Returns the two ring neighbors adjacent to an atom within a ring perimeter.
 * @param {object} ring - Ring descriptor.
 * @param {string} atomId - Atom ID to inspect.
 * @returns {string[]} Neighbor atom IDs in the ring sequence.
 */
function ringPerimeterNeighbors(ring, atomId) {
  const atomIndex = ring.atomIds.indexOf(atomId);
  if (atomIndex < 0 || ring.atomIds.length < 3) {
    return [];
  }
  return [
    ring.atomIds[(atomIndex - 1 + ring.atomIds.length) % ring.atomIds.length],
    ring.atomIds[(atomIndex + 1) % ring.atomIds.length]
  ];
}

function regularRingInteriorAngle(ringSize) {
  return ringSize >= 3 ? ((ringSize - 2) * Math.PI) / ringSize : 0;
}

/**
 * Returns the ideal minimum cross-ring gap at one spiro shared atom.
 * @param {object} firstRing - First ring descriptor.
 * @param {object} secondRing - Second ring descriptor.
 * @returns {number|null} Ideal cross-ring gap in radians, or null when ordinary path fanning should own the junction.
 */
function idealSpiroCrossRingAngle(firstRing, secondRing) {
  if (Math.min(firstRing.atomIds.length, secondRing.atomIds.length) > 3) {
    return null;
  }
  const firstInteriorAngle = regularRingInteriorAngle(firstRing.atomIds.length);
  const secondInteriorAngle = regularRingInteriorAngle(secondRing.atomIds.length);
  return Math.max(0, ((2 * Math.PI) - firstInteriorAngle - secondInteriorAngle) / 2);
}

/**
 * Measures local cross-ring clearance at each spiro junction in a path.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Current placed coordinates.
 * @param {Map<number, object>} ringById - Ring descriptors keyed by ring ID.
 * @param {Map<string, object>} ringConnectionByPair - Pair-keyed ring connection map.
 * @param {number[]} ringOrder - Ordered ring IDs from one path endpoint to the other.
 * @param {number} bondLength - Target bond length.
 * @returns {{failureCount: number, minDistance: number, angleDeficit: number, minAngle: number}} Local clearance score.
 */
function measureSpiroJunctionClearance(layoutGraph, coords, ringById, ringConnectionByPair, ringOrder, bondLength) {
  const minimumClearDistance = bondLength * SPIRO_JUNCTION_CLEARANCE_FACTOR;
  let failureCount = 0;
  let minDistance = Infinity;
  let angleDeficit = 0;
  let minAngle = Infinity;

  for (let index = 1; index < ringOrder.length; index++) {
    const firstRingId = ringOrder[index - 1];
    const secondRingId = ringOrder[index];
    const connectionKey = firstRingId < secondRingId ? `${firstRingId}:${secondRingId}` : `${secondRingId}:${firstRingId}`;
    const connection = ringConnectionByPair.get(connectionKey);
    const sharedAtomId = connection?.sharedAtomIds?.[0] ?? null;
    const firstRing = ringById.get(firstRingId);
    const secondRing = ringById.get(secondRingId);
    if (!connection || connection.kind !== 'spiro' || !sharedAtomId || !firstRing || !secondRing) {
      continue;
    }

    const firstNeighbors = ringPerimeterNeighbors(firstRing, sharedAtomId).filter(atomId => coords.has(atomId));
    const secondNeighbors = ringPerimeterNeighbors(secondRing, sharedAtomId).filter(atomId => coords.has(atomId));
    const sharedPosition = coords.get(sharedAtomId);
    const idealCrossAngle = idealSpiroCrossRingAngle(firstRing, secondRing);
    let junctionMinAngle = Infinity;
    for (const firstAtomId of firstNeighbors) {
      for (const secondAtomId of secondNeighbors) {
        if (firstAtomId === secondAtomId) {
          continue;
        }
        const key = firstAtomId < secondAtomId ? `${firstAtomId}:${secondAtomId}` : `${secondAtomId}:${firstAtomId}`;
        if (layoutGraph.bondedPairSet.has(key)) {
          continue;
        }
        if (sharedPosition) {
          const angleBetween = angularDifference(
            angleOf(sub(coords.get(firstAtomId), sharedPosition)),
            angleOf(sub(coords.get(secondAtomId), sharedPosition))
          );
          junctionMinAngle = Math.min(junctionMinAngle, angleBetween);
          minAngle = Math.min(minAngle, angleBetween);
        }
        const distanceBetween = distance(coords.get(firstAtomId), coords.get(secondAtomId));
        minDistance = Math.min(minDistance, distanceBetween);
        if (distanceBetween < minimumClearDistance) {
          failureCount++;
        }
      }
    }
    if (Number.isFinite(junctionMinAngle)) {
      angleDeficit += Number.isFinite(idealCrossAngle) ? Math.max(0, idealCrossAngle - junctionMinAngle) : 0;
    }
  }

  return {
    failureCount,
    minDistance: Number.isFinite(minDistance) ? minDistance : Infinity,
    angleDeficit,
    minAngle: Number.isFinite(minAngle) ? minAngle : Infinity
  };
}

/**
 * Scores a candidate spiro placement against already placed coordinates.
 * @param {Map<string, {x: number, y: number}>} candidateCoords - Candidate coordinates.
 * @param {Map<string, {x: number, y: number}>} placedCoords - Already placed coordinates.
 * @param {string} sharedAtomId - Shared spiro atom ID.
 * @returns {number} Minimum non-shared inter-atom distance; larger is better.
 */
function scoreCandidateCoords(candidateCoords, placedCoords, sharedAtomId) {
  let minDistance = Infinity;
  for (const [atomId, position] of candidateCoords) {
    if (atomId === sharedAtomId) {
      continue;
    }
    for (const [placedAtomId, placedPosition] of placedCoords) {
      if (placedAtomId === sharedAtomId) {
        continue;
      }
      minDistance = Math.min(minDistance, distance(position, placedPosition));
    }
  }
  return minDistance;
}

/**
 * Scores a partially or fully placed spiro path by overlap severity and clearance.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Current placed coordinates.
 * @param {Map<number, {x: number, y: number}>} ringCenters - Current ring centers.
 * @param {number[]} ringOrder - Ordered ring IDs from one path endpoint to the other.
 * @param {number} bondLength - Target bond length.
 * @param {Map<number, object>} ringById - Ring descriptors keyed by ring ID.
 * @param {Map<string, object>} ringConnectionByPair - Pair-keyed ring connection map.
 * @returns {{severeOverlapCount: number, spiroJunctionClearanceFailureCount: number, spiroJunctionMinDistance: number, spiroJunctionAngleDeficit: number, spiroJunctionMinAngle: number, centerBend: number, minDistance: number}} Placement score.
 */
function scoreSpiroCoords(layoutGraph, coords, ringCenters, ringOrder, bondLength, ringById, ringConnectionByPair) {
  const threshold = bondLength * 0.55;
  const atomIds = [...coords.keys()];
  let severeOverlapCount = 0;
  let minDistance = Infinity;
  let centerBend = 0;

  for (let firstIndex = 0; firstIndex < atomIds.length; firstIndex++) {
    const firstAtomId = atomIds[firstIndex];
    for (let secondIndex = firstIndex + 1; secondIndex < atomIds.length; secondIndex++) {
      const secondAtomId = atomIds[secondIndex];
      const key = firstAtomId < secondAtomId ? `${firstAtomId}:${secondAtomId}` : `${secondAtomId}:${firstAtomId}`;
      if (layoutGraph.bondedPairSet.has(key)) {
        continue;
      }
      const distanceBetween = distance(coords.get(firstAtomId), coords.get(secondAtomId));
      minDistance = Math.min(minDistance, distanceBetween);
      if (distanceBetween < threshold) {
        severeOverlapCount++;
      }
    }
  }

  for (let index = 1; index < ringOrder.length - 1; index++) {
    const previousCenter = ringCenters.get(ringOrder[index - 1]);
    const currentCenter = ringCenters.get(ringOrder[index]);
    const nextCenter = ringCenters.get(ringOrder[index + 1]);
    if (!previousCenter || !currentCenter || !nextCenter) {
      continue;
    }
    const firstVector = sub(currentCenter, previousCenter);
    const secondVector = sub(nextCenter, currentCenter);
    centerBend += Math.abs(firstVector.x * secondVector.y - firstVector.y * secondVector.x);
  }
  const spiroJunctionClearance = measureSpiroJunctionClearance(
    layoutGraph,
    coords,
    ringById,
    ringConnectionByPair,
    ringOrder,
    bondLength
  );

  return {
    severeOverlapCount,
    spiroJunctionClearanceFailureCount: spiroJunctionClearance.failureCount,
    spiroJunctionMinDistance: spiroJunctionClearance.minDistance,
    spiroJunctionAngleDeficit: spiroJunctionClearance.angleDeficit,
    spiroJunctionMinAngle: spiroJunctionClearance.minAngle,
    centerBend,
    minDistance: Number.isFinite(minDistance) ? minDistance : Infinity
  };
}

/**
 * Returns whether the first spiro-path score is better than the second.
 * @param {{severeOverlapCount: number, centerBend: number, minDistance: number}} firstScore - First score.
 * @param {{severeOverlapCount: number, centerBend: number, minDistance: number}} secondScore - Second score.
 * @returns {boolean} True when the first score is preferable.
 */
function isBetterSpiroScore(firstScore, secondScore) {
  if (firstScore.severeOverlapCount !== secondScore.severeOverlapCount) {
    return firstScore.severeOverlapCount < secondScore.severeOverlapCount;
  }
  if (firstScore.spiroJunctionClearanceFailureCount !== secondScore.spiroJunctionClearanceFailureCount) {
    return firstScore.spiroJunctionClearanceFailureCount < secondScore.spiroJunctionClearanceFailureCount;
  }
  if (
    firstScore.spiroJunctionClearanceFailureCount > 0
    && Math.abs(firstScore.spiroJunctionMinDistance - secondScore.spiroJunctionMinDistance) > 1e-12
  ) {
    return firstScore.spiroJunctionMinDistance > secondScore.spiroJunctionMinDistance;
  }
  if (Math.abs(firstScore.spiroJunctionAngleDeficit - secondScore.spiroJunctionAngleDeficit) > SPIRO_JUNCTION_ANGLE_EPSILON) {
    return firstScore.spiroJunctionAngleDeficit < secondScore.spiroJunctionAngleDeficit;
  }
  if (
    firstScore.spiroJunctionAngleDeficit > SPIRO_JUNCTION_ANGLE_EPSILON
    && Math.abs(firstScore.spiroJunctionMinAngle - secondScore.spiroJunctionMinAngle) > SPIRO_JUNCTION_ANGLE_EPSILON
  ) {
    return firstScore.spiroJunctionMinAngle > secondScore.spiroJunctionMinAngle;
  }
  if (Math.abs(firstScore.centerBend - secondScore.centerBend) > 1e-12) {
    return firstScore.centerBend > secondScore.centerBend;
  }
  return firstScore.minDistance > secondScore.minDistance;
}

/**
 * Searches the candidate placements for the remainder of a spiro path.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<number, object>} ringById - Ring descriptors keyed by ring ID.
 * @param {number[]} ringOrder - Ordered ring IDs from one path endpoint to the other.
 * @param {Map<string, object>} ringConnectionByPair - Pair-keyed ring connection map.
 * @param {number} bondLength - Target bond length.
 * @param {Map<string, {x: number, y: number}>} coords - Current coordinates.
 * @param {Map<number, {x: number, y: number}>} ringCenters - Current ring centers.
 * @param {number} index - Next path index to place.
 * @returns {{coords: Map<string, {x: number, y: number}>, ringCenters: Map<number, {x: number, y: number}>, score: {severeOverlapCount: number, centerBend: number, minDistance: number}}} Best remaining placement.
 */
function searchSpiroPathPlacements(layoutGraph, ringById, ringOrder, ringConnectionByPair, bondLength, coords, ringCenters, index) {
  if (index >= ringOrder.length) {
    return {
      coords,
      ringCenters,
      score: scoreSpiroCoords(layoutGraph, coords, ringCenters, ringOrder, bondLength, ringById, ringConnectionByPair)
    };
  }

  const previousRingId = ringOrder[index - 1];
  const currentRingId = ringOrder[index];
  const connectionKey = previousRingId < currentRingId ? `${previousRingId}:${currentRingId}` : `${currentRingId}:${previousRingId}`;
  const connection = ringConnectionByPair.get(connectionKey);
  const currentRing = ringById.get(currentRingId);
  const sharedAtomId = connection?.sharedAtomIds?.[0];
  const sharedPosition = sharedAtomId ? coords.get(sharedAtomId) : null;
  const previousCenter = ringCenters.get(previousRingId);

  if (!connection || connection.kind !== 'spiro' || !currentRing || !sharedAtomId || !sharedPosition || !previousCenter) {
    return {
      coords,
      ringCenters,
      score: scoreSpiroCoords(layoutGraph, coords, ringCenters, ringOrder, bondLength, ringById, ringConnectionByPair)
    };
  }

  const radius = circumradiusForRegularPolygon(currentRing.atomIds.length, bondLength);
  const outwardAngle = angleOf(sub(sharedPosition, previousCenter));
  let bestPlacement = null;

  for (const offset of SPIRO_PATH_CENTER_OFFSETS) {
    for (const direction of [1, -1]) {
      const centerAngle = outwardAngle + direction * offset;
      const center = add(sharedPosition, fromAngle(centerAngle, radius));
      for (const sign of [1, -1]) {
        const candidateCoords = candidateSpiroRingCoords(currentRing, sharedAtomId, sharedPosition, center, sign, bondLength);
        const nextCoords = new Map(coords);
        for (const [atomId, position] of candidateCoords) {
          nextCoords.set(atomId, position);
        }
        const nextRingCenters = new Map(ringCenters);
        nextRingCenters.set(currentRingId, center);
        const candidatePlacement = searchSpiroPathPlacements(layoutGraph, ringById, ringOrder, ringConnectionByPair, bondLength, nextCoords, nextRingCenters, index + 1);
        if (!bestPlacement || isBetterSpiroScore(candidatePlacement.score, bestPlacement.score)) {
          bestPlacement = candidatePlacement;
        }
      }
    }
  }

  return (
    bestPlacement ?? {
      coords,
      ringCenters,
      score: scoreSpiroCoords(layoutGraph, coords, ringCenters, ringOrder, bondLength, ringById, ringConnectionByPair)
    }
  );
}

/**
 * Places a simple polyspiro chain by walking its ring path and fanning each new ring away from the previous one.
 * Candidate turns are searched globally so the chain can avoid self-overlap without post-placement bond distortion.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {object[]} rings - Ring descriptors in the target spiro system.
 * @param {number[]} ringOrder - Ordered ring IDs from one path endpoint to the other.
 * @param {Map<string, object>} ringConnectionByPair - Pair-keyed ring connection map.
 * @param {number} bondLength - Target bond length.
 * @returns {{coords: Map<string, {x: number, y: number}>, ringCenters: Map<number, {x: number, y: number}>, placementMode: string}} Placement result.
 */
function layoutSpiroPath(layoutGraph, rings, ringOrder, ringConnectionByPair, bondLength) {
  const coords = new Map();
  const ringCenters = new Map();
  const ringById = new Map(rings.map(ring => [ring.id, ring]));
  const rootRing = ringById.get(ringOrder[0]);
  const rootCoords = placeRegularPolygon(rootRing.atomIds, { x: 0, y: 0 }, bondLength);

  for (const [atomId, position] of rootCoords) {
    coords.set(atomId, position);
  }
  ringCenters.set(rootRing.id, centroid(rootRing.atomIds.map(atomId => coords.get(atomId))));
  const placement = searchSpiroPathPlacements(layoutGraph, ringById, ringOrder, ringConnectionByPair, bondLength, coords, ringCenters, 1);

  return { coords: placement.coords, ringCenters: placement.ringCenters, placementMode: 'constructed-path' };
}

/**
 * Places a spiro ring system by growing regular polygons through shared atoms
 * and choosing the lower-overlap orientation at each step.
 * @param {object[]} rings - Ring descriptors in the target spiro system.
 * @param {Map<number, number[]>} ringAdj - Ring adjacency map.
 * @param {Map<string, object>} ringConnectionByPair - Pair-keyed ring connection map.
 * @param {number} bondLength - Target bond length.
 * @param {{layoutGraph?: object, templateId?: string|null}} [options] - Placement options.
 * @returns {{coords: Map<string, {x: number, y: number}>, ringCenters: Map<number, {x: number, y: number}>}} Placement result.
 */
export function layoutSpiroFamily(rings, ringAdj, ringConnectionByPair, bondLength, options = {}) {
  const templateAtomIds = [...new Set(rings.flatMap(ring => ring.atomIds))];
  const templateCoords = options.layoutGraph ? placeTemplateCoords(options.layoutGraph, options.templateId, templateAtomIds, bondLength) : null;
  const coords = new Map();
  const ringCenters = new Map();
  if (rings.length === 0) {
    return { coords, ringCenters, placementMode: 'constructed' };
  }
  if (templateCoords) {
    for (const [atomId, position] of templateCoords) {
      coords.set(atomId, position);
    }
    for (const ring of rings) {
      ringCenters.set(ring.id, centroid(ring.atomIds.map(atomId => coords.get(atomId))));
    }
    return { coords, ringCenters, placementMode: 'template' };
  }

  const ringOrder = options.layoutGraph ? orderSpiroPath(rings, ringConnectionByPair) : null;
  if (ringOrder && shouldUseEndpointSpiroPath(rings, ringOrder, ringConnectionByPair)) {
    return layoutSpiroPath(options.layoutGraph, rings, ringOrder, ringConnectionByPair, bondLength);
  }

  const rootRing = [...rings].sort((firstRing, secondRing) => {
    const sizeDelta = secondRing.atomIds.length - firstRing.atomIds.length;
    return sizeDelta !== 0 ? sizeDelta : firstRing.id - secondRing.id;
  })[0];
  const rootCoords = placeRegularPolygon(rootRing.atomIds, { x: 0, y: 0 }, bondLength);
  for (const [atomId, position] of rootCoords) {
    coords.set(atomId, position);
  }
  ringCenters.set(rootRing.id, centroid(rootRing.atomIds.map(atomId => coords.get(atomId))));

  const ringById = new Map(rings.map(ring => [ring.id, ring]));
  const placedRingIds = new Set([rootRing.id]);
  const queue = [rootRing.id];

  while (queue.length > 0) {
    const currentRingId = queue.shift();
    const currentCenter = ringCenters.get(currentRingId);
    for (const neighborRingId of ringAdj.get(currentRingId) ?? []) {
      if (placedRingIds.has(neighborRingId)) {
        continue;
      }
      const connectionKey = currentRingId < neighborRingId ? `${currentRingId}:${neighborRingId}` : `${neighborRingId}:${currentRingId}`;
      const connection = ringConnectionByPair.get(connectionKey);
      if (!connection || connection.kind !== 'spiro') {
        continue;
      }
      const neighborRing = ringById.get(neighborRingId);
      const sharedAtomId = connection.sharedAtomIds[0];
      const sharedPosition = coords.get(sharedAtomId);
      if (!sharedPosition || !currentCenter) {
        continue;
      }

      const radius = circumradiusForRegularPolygon(neighborRing.atomIds.length, bondLength);
      let outward = normalize(sub(sharedPosition, currentCenter));
      if (Math.hypot(outward.x, outward.y) <= 1e-12) {
        outward = { x: 1, y: 0 };
      }
      const neighborCenter = add(sharedPosition, scale(outward, radius));
      ringCenters.set(neighborRing.id, neighborCenter);

      const clockwiseCandidate = candidateSpiroRingCoords(neighborRing, sharedAtomId, sharedPosition, neighborCenter, 1, bondLength);
      const counterClockwiseCandidate = candidateSpiroRingCoords(neighborRing, sharedAtomId, sharedPosition, neighborCenter, -1, bondLength);
      const clockwiseScore = scoreCandidateCoords(clockwiseCandidate, coords, sharedAtomId);
      const counterClockwiseScore = scoreCandidateCoords(counterClockwiseCandidate, coords, sharedAtomId);
      const chosen = clockwiseScore >= counterClockwiseScore ? clockwiseCandidate : counterClockwiseCandidate;
      for (const [atomId, position] of chosen) {
        coords.set(atomId, position);
      }

      placedRingIds.add(neighborRing.id);
      queue.push(neighborRing.id);
    }
  }

  return { coords, ringCenters, placementMode: 'constructed' };
}

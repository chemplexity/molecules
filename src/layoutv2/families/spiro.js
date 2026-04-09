/** @module families/spiro */

import { circumradiusForRegularPolygon, placeRegularPolygon } from '../geometry/polygon.js';
import { add, angleOf, centroid, distance, fromAngle, normalize, scale, sub } from '../geometry/vec2.js';
import { placeTemplateCoords } from '../templates/placement.js';

function rotateSequenceToStart(atomIds, startAtomId) {
  const startIndex = atomIds.indexOf(startAtomId);
  if (startIndex < 0) {
    return [...atomIds];
  }
  return atomIds.slice(startIndex).concat(atomIds.slice(0, startIndex));
}

function candidateSpiroRingCoords(ring, sharedAtomId, sharedPosition, center, sign, bondLength) {
  const orderedAtomIds = rotateSequenceToStart(ring.atomIds, sharedAtomId);
  const startAngle = angleOf(sub(sharedPosition, center));
  const step = sign * ((2 * Math.PI) / orderedAtomIds.length);
  const radius = circumradiusForRegularPolygon(orderedAtomIds.length, bondLength);
  const coords = new Map([[sharedAtomId, sharedPosition]]);
  for (let index = 1; index < orderedAtomIds.length; index++) {
    coords.set(orderedAtomIds[index], add(center, fromAngle(startAngle + (index * step), radius)));
  }
  return coords;
}

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

  const rootRing = rings[0];
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

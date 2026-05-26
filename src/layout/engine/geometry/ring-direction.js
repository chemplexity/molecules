/** @module geometry/ring-direction */

import { angleOf, angularDifference, sub, wrapAngle } from './vec2.js';

const RING_DIRECTION_EPSILON = 1e-9;

function incidentRingNeighborAngles(layoutGraph, anchorAtomId, ring, getPosition, anchorPosition) {
  const neighborAngles = [];
  const ringAtomIds = ring.atomIds ?? [];
  const anchorIndex = layoutGraph.ringAtomIndexByRingId?.get(ring.id)?.get(anchorAtomId) ?? ringAtomIds.indexOf(anchorAtomId);
  if (anchorIndex < 0) {
    return neighborAngles;
  }
  const ringNeighborAtomIds = [ringAtomIds[(anchorIndex - 1 + ringAtomIds.length) % ringAtomIds.length], ringAtomIds[(anchorIndex + 1) % ringAtomIds.length]];

  for (const neighborAtomId of ringNeighborAtomIds) {
    const neighborPosition = getPosition(neighborAtomId);
    if (!neighborPosition) {
      continue;
    }
    const neighborAngle = angleOf(sub(neighborPosition, anchorPosition));
    if (!neighborAngles.some(existingAngle => angularDifference(existingAngle, neighborAngle) <= RING_DIRECTION_EPSILON)) {
      neighborAngles.push(neighborAngle);
    }
  }

  return neighborAngles;
}

function placedRingCentroid(ring, getPosition) {
  let sumX = 0;
  let sumY = 0;
  let count = 0;
  for (const ringAtomId of ring.atomIds ?? []) {
    const position = getPosition(ringAtomId);
    if (!position) {
      continue;
    }
    sumX += position.x;
    sumY += position.y;
    count++;
  }
  return count >= 3 ? { x: sumX / count, y: sumY / count } : null;
}

function chooseSingleRingOutwardAngle(neighborAngles, fallbackOutwardAngle) {
  if (neighborAngles.length !== 2) {
    return fallbackOutwardAngle;
  }

  const bisectorX = Math.cos(neighborAngles[0]) + Math.cos(neighborAngles[1]);
  const bisectorY = Math.sin(neighborAngles[0]) + Math.sin(neighborAngles[1]);
  if (Math.hypot(bisectorX, bisectorY) <= RING_DIRECTION_EPSILON) {
    return fallbackOutwardAngle;
  }

  const internalBisector = Math.atan2(bisectorY, bisectorX);
  const candidateAngles = [wrapAngle(internalBisector), wrapAngle(internalBisector + Math.PI)];
  return candidateAngles.reduce((bestAngle, candidateAngle) =>
    angularDifference(candidateAngle, fallbackOutwardAngle) < angularDifference(bestAngle, fallbackOutwardAngle) ? candidateAngle : bestAngle
  );
}

/**
 * Returns de-duplicated outward directions for each incident ring at one
 * anchor atom. Single-ring anchors with exactly two placed ring bonds use the
 * external bisector of those bonds, with the ring-centroid vector only used to
 * disambiguate which bisector points outward.
 * @param {object|null} layoutGraph - Layout graph shell.
 * @param {string} anchorAtomId - Anchor atom id.
 * @param {(atomId: string) => {x: number, y: number}|null|undefined} getPosition - Coordinate lookup.
 * @returns {number[]} Outward angles in radians.
 */
export function computeIncidentRingOutwardAngles(layoutGraph, anchorAtomId, getPosition) {
  if (!layoutGraph || typeof getPosition !== 'function') {
    return [];
  }

  const anchorPosition = getPosition(anchorAtomId);
  if (!anchorPosition) {
    return [];
  }

  const ringAngles = [];
  for (const ring of layoutGraph.atomToRings.get(anchorAtomId) ?? []) {
    const ringCenter = placedRingCentroid(ring, getPosition);
    if (!ringCenter) {
      continue;
    }

    const fallbackOutwardAngle = angleOf(sub(anchorPosition, ringCenter));
    const outwardAngle = chooseSingleRingOutwardAngle(incidentRingNeighborAngles(layoutGraph, anchorAtomId, ring, getPosition, anchorPosition), fallbackOutwardAngle);
    if (!ringAngles.some(ringAngle => angularDifference(ringAngle, outwardAngle) <= RING_DIRECTION_EPSILON)) {
      ringAngles.push(outwardAngle);
    }
  }

  return ringAngles;
}

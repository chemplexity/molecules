/** @module geometry/ring-direction */

import { angleOf, angularDifference, centroid, sub } from './vec2.js';

const RING_DIRECTION_EPSILON = 1e-9;

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

function incidentRingNeighborAngles(layoutGraph, anchorAtomId, ring, getPosition, anchorPosition) {
  const neighborAngles = [];

  for (const bond of layoutGraph.bondsByAtomId.get(anchorAtomId) ?? []) {
    if (!bond || bond.kind !== 'covalent' || !bond.inRing) {
      continue;
    }
    const neighborAtomId = bond.a === anchorAtomId ? bond.b : bond.a;
    if (!ring.atomIds.includes(neighborAtomId)) {
      continue;
    }
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
  const candidateAngles = [
    normalizeSignedAngle(internalBisector),
    normalizeSignedAngle(internalBisector + Math.PI)
  ];
  return candidateAngles.reduce((bestAngle, candidateAngle) => (
    angularDifference(candidateAngle, fallbackOutwardAngle) < angularDifference(bestAngle, fallbackOutwardAngle)
      ? candidateAngle
      : bestAngle
  ));
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
    const ringPositions = ring.atomIds.map(ringAtomId => getPosition(ringAtomId)).filter(Boolean);
    if (ringPositions.length < 3) {
      continue;
    }

    const fallbackOutwardAngle = angleOf(sub(anchorPosition, centroid(ringPositions)));
    const outwardAngle = chooseSingleRingOutwardAngle(
      incidentRingNeighborAngles(layoutGraph, anchorAtomId, ring, getPosition, anchorPosition),
      fallbackOutwardAngle
    );
    if (!ringAngles.some(ringAngle => angularDifference(ringAngle, outwardAngle) <= RING_DIRECTION_EPSILON)) {
      ringAngles.push(outwardAngle);
    }
  }

  return ringAngles;
}

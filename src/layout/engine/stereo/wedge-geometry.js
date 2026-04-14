/** @module stereo/wedge-geometry */

import { add, angleOf, angularDifference, fromAngle, length, normalize, scale, sub } from '../geometry/vec2.js';
import { countPointInPolygons } from '../geometry/polygon.js';

/**
 * Returns the bisector angles of the angular gaps around a stereocenter.
 * @param {{x: number, y: number}} centerPosition - Stereocenter position.
 * @param {{x: number, y: number}[]} knownPositions - Known neighbor positions.
 * @returns {number[]} Gap-bisector angles in radians.
 */
function gapBisectorAngles(centerPosition, knownPositions) {
  const knownAngles = knownPositions.map(position => angleOf(sub(position, centerPosition))).sort((firstAngle, secondAngle) => firstAngle - secondAngle);
  if (knownAngles.length === 0) {
    return [];
  }

  const bisectorAngles = [];
  for (let index = 0; index < knownAngles.length; index++) {
    const firstAngle = knownAngles[index];
    const secondAngle = index === knownAngles.length - 1 ? knownAngles[0] + Math.PI * 2 : knownAngles[index + 1];
    bisectorAngles.push(firstAngle + (secondAngle - firstAngle) / 2);
  }
  return bisectorAngles;
}

/**
 * Synthesizes a hidden-hydrogen position opposite known substituents.
 * @param {{x: number, y: number}} centerPosition - Stereocenter position.
 * @param {{x: number, y: number}[]} knownPositions - Known neighbor positions.
 * @param {number} bondLength - Target bond length.
 * @param {object} [options] - Synthesis options.
 * @param {Array<Array<{x: number, y: number}>>} [options.incidentRingPolygons] - Incident ring polygons to avoid.
 * @returns {{x: number, y: number}} Synthesized hydrogen position.
 */
export function synthesizeHydrogenPosition(centerPosition, knownPositions, bondLength, options = {}) {
  const incidentRingPolygons = options.incidentRingPolygons ?? [];
  if (knownPositions.length === 0) {
    return add(centerPosition, { x: bondLength, y: 0 });
  }

  let direction = { x: 0, y: 0 };
  let radiusSum = 0;
  for (const position of knownPositions) {
    const vector = sub(position, centerPosition);
    const unit = normalize(vector);
    direction = add(direction, scale(unit, -1));
    radiusSum += Math.max(length(vector), bondLength);
  }

  if (length(direction) <= 1e-6) {
    const fallbackVector = sub(knownPositions[0], centerPosition);
    const fallbackAngle = Math.atan2(fallbackVector.y, fallbackVector.x) + Math.PI;
    direction = fromAngle(fallbackAngle, 1);
  } else {
    direction = normalize(direction);
  }

  const radius = radiusSum / knownPositions.length;
  const baseAngle = angleOf(direction);
  const basePosition = add(centerPosition, scale(direction, radius));
  if (incidentRingPolygons.length === 0 || countPointInPolygons(incidentRingPolygons, basePosition) === 0) {
    return basePosition;
  }

  let bestCandidate = null;
  for (const candidateAngle of [baseAngle, ...gapBisectorAngles(centerPosition, knownPositions)]) {
    const candidatePosition = add(centerPosition, fromAngle(candidateAngle, radius));
    const containingRingCount = countPointInPolygons(incidentRingPolygons, candidatePosition);
    const sector = minimumSectorAngle(centerPosition, candidatePosition, knownPositions);
    const deviation = angularDifference(candidateAngle, baseAngle);
    if (!bestCandidate) {
      bestCandidate = { position: candidatePosition, containingRingCount, sector, deviation };
      continue;
    }
    if (containingRingCount !== bestCandidate.containingRingCount) {
      if (containingRingCount < bestCandidate.containingRingCount) {
        bestCandidate = { position: candidatePosition, containingRingCount, sector, deviation };
      }
      continue;
    }
    if (sector > bestCandidate.sector + 1e-6 || (Math.abs(sector - bestCandidate.sector) <= 1e-6 && deviation < bestCandidate.deviation)) {
      bestCandidate = { position: candidatePosition, containingRingCount, sector, deviation };
    }
  }

  return bestCandidate?.position ?? basePosition;
}

/**
 * Returns the minimum angular sector between a candidate wedge bond and the
 * other neighbor bonds around the same stereocenter.
 * @param {{x: number, y: number}} centerPosition - Stereocenter position.
 * @param {{x: number, y: number}} candidatePosition - Candidate neighbor position.
 * @param {{x: number, y: number}[]} otherPositions - Other neighbor positions.
 * @returns {number} Minimum separation angle in radians.
 */
export function minimumSectorAngle(centerPosition, candidatePosition, otherPositions) {
  const candidateAngle = Math.atan2(candidatePosition.y - centerPosition.y, candidatePosition.x - centerPosition.x);
  if (otherPositions.length === 0) {
    return Math.PI;
  }
  let best = Math.PI;
  for (const otherPosition of otherPositions) {
    const otherAngle = Math.atan2(otherPosition.y - centerPosition.y, otherPosition.x - centerPosition.x);
    best = Math.min(best, angularDifference(candidateAngle, otherAngle));
  }
  return best;
}

/** @module stereo/wedge-geometry */

import { add, angleOf, angularDifference, fromAngle, length, normalize, scale, sub } from '../geometry/vec2.js';
import { countPointInPolygons } from '../geometry/polygon.js';

const CARDINAL_AXIS_ANGLES = [0, Math.PI / 2, Math.PI, -Math.PI / 2];
const CARDINAL_AXIS_SECTOR_TOLERANCE = Math.PI / 24;

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
 * Returns the angular distance from one angle to the nearest cardinal axis.
 * @param {number} angle - Angle to compare.
 * @returns {number} Angular distance to the nearest horizontal or vertical axis.
 */
function nearestCardinalDeviation(angle) {
  let best = Math.PI;
  for (const axisAngle of CARDINAL_AXIS_ANGLES) {
    best = Math.min(best, angularDifference(angle, axisAngle));
  }
  return best;
}

/**
 * Removes duplicate angular candidates while preserving order.
 * @param {number[]} angles - Candidate angles in radians.
 * @returns {number[]} Unique angles in radians.
 */
function uniqueAngles(angles) {
  const unique = [];
  for (const angle of angles) {
    if (unique.some(existingAngle => angularDifference(existingAngle, angle) <= 1e-6)) {
      continue;
    }
    unique.push(angle);
  }
  return unique;
}

/**
 * Ranks a hydrogen projection candidate for display-time axis snapping.
 * @param {{x: number, y: number}} centerPosition - Stereocenter position.
 * @param {{x: number, y: number}[]} knownPositions - Known neighbor positions.
 * @param {number} radius - Projection distance from the center.
 * @param {number} angle - Candidate projection angle.
 * @param {number} baseAngle - Raw opposite-vector angle before any snapping.
 * @param {Array<Array<{x: number, y: number}>>} incidentRingPolygons - Incident ring polygons.
 * @returns {{position: {x: number, y: number}, containingRingCount: number, sector: number, baseDeviation: number, cardinalDeviation: number}} Ranked candidate data.
 */
function evaluateCandidate(centerPosition, knownPositions, radius, angle, baseAngle, incidentRingPolygons) {
  const position = add(centerPosition, fromAngle(angle, radius));
  return {
    position,
    containingRingCount: countPointInPolygons(incidentRingPolygons, position),
    sector: minimumSectorAngle(centerPosition, position, knownPositions),
    baseDeviation: angularDifference(angle, baseAngle),
    cardinalDeviation: nearestCardinalDeviation(angle)
  };
}

/**
 * Returns the best display-time hydrogen projection candidate.
 * @param {{x: number, y: number}} centerPosition - Stereocenter position.
 * @param {{x: number, y: number}[]} knownPositions - Known neighbor positions.
 * @param {number} radius - Projection distance from the center.
 * @param {number} baseAngle - Raw opposite-vector angle before any snapping.
 * @param {Array<Array<{x: number, y: number}>>} incidentRingPolygons - Incident ring polygons.
 * @returns {{x: number, y: number}} Chosen hydrogen position.
 */
function bestDisplayCandidate(centerPosition, knownPositions, radius, baseAngle, incidentRingPolygons) {
  const candidates = uniqueAngles([baseAngle, ...gapBisectorAngles(centerPosition, knownPositions), ...CARDINAL_AXIS_ANGLES]).map(angle =>
    evaluateCandidate(centerPosition, knownPositions, radius, angle, baseAngle, incidentRingPolygons)
  );
  const bestContainingRingCount = Math.min(...candidates.map(candidate => candidate.containingRingCount));
  const ringSafeCandidates = candidates.filter(candidate => candidate.containingRingCount === bestContainingRingCount);
  const bestSector = Math.max(...ringSafeCandidates.map(candidate => candidate.sector));
  const nearBestSectorCandidates = ringSafeCandidates.filter(candidate => candidate.sector >= bestSector - CARDINAL_AXIS_SECTOR_TOLERANCE);

  let bestCandidate = nearBestSectorCandidates[0] ?? ringSafeCandidates[0] ?? candidates[0];
  for (const candidate of nearBestSectorCandidates) {
    if (candidate.cardinalDeviation < bestCandidate.cardinalDeviation - 1e-6) {
      bestCandidate = candidate;
      continue;
    }
    if (Math.abs(candidate.cardinalDeviation - bestCandidate.cardinalDeviation) > 1e-6) {
      continue;
    }
    if (candidate.sector > bestCandidate.sector + 1e-6) {
      bestCandidate = candidate;
      continue;
    }
    if (Math.abs(candidate.sector - bestCandidate.sector) > 1e-6) {
      continue;
    }
    if (candidate.baseDeviation < bestCandidate.baseDeviation) {
      bestCandidate = candidate;
    }
  }

  return bestCandidate.position;
}

/**
 * Synthesizes a hidden-hydrogen position opposite known substituents.
 * @param {{x: number, y: number}} centerPosition - Stereocenter position.
 * @param {{x: number, y: number}[]} knownPositions - Known neighbor positions.
 * @param {number} bondLength - Target bond length.
 * @param {object} [options] - Synthesis options.
 * @param {Array<Array<{x: number, y: number}>>} [options.incidentRingPolygons] - Incident ring polygons to avoid.
 * @param {boolean} [options.preferCardinalAxes] - When true, prefer exact horizontal or vertical projections when they are almost as open as the best free-angle candidate.
 * @returns {{x: number, y: number}} Synthesized hydrogen position.
 */
export function synthesizeHydrogenPosition(centerPosition, knownPositions, bondLength, options = {}) {
  const incidentRingPolygons = options.incidentRingPolygons ?? [];
  const preferCardinalAxes = options.preferCardinalAxes === true;
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
  if (preferCardinalAxes) {
    return bestDisplayCandidate(centerPosition, knownPositions, radius, baseAngle, incidentRingPolygons);
  }
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

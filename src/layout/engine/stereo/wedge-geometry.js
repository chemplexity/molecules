/** @module stereo/wedge-geometry */

import { add, angleOf, angularDifference, fromAngle, length, normalize, scale, sub } from '../geometry/vec2.js';
import { countPointInPolygons } from '../geometry/polygon.js';

const CARDINAL_AXIS_ANGLES = [0, Math.PI / 2, Math.PI, -Math.PI / 2];
const CARDINAL_AXIS_SECTOR_TOLERANCE = Math.PI / 24;
const RING_VERTEX_MATCH_TOLERANCE = 1e-6;
const ANGLE_ARC_TOLERANCE = 1e-6;
const SHARP_RING_VERTEX_INTERIOR_LIMIT = Math.PI / 3;
const DISPLAYED_STEREO_HYDROGEN_MINIMUM_SECTOR = Math.PI / 6;
const DISPLAYED_STEREO_HYDROGEN_READABLE_SECTOR = Math.PI / 3;
const DISPLAYED_STEREO_HYDROGEN_READABLE_SECTOR_SLACK = Math.PI / 90;
export const DISPLAYED_STEREO_CARDINAL_AXIS_SECTOR_TOLERANCE = Math.PI / 16;

/**
 * Returns the nearest distance from a point to a list of positions.
 * @param {{x: number, y: number}} position - Candidate position.
 * @param {{x: number, y: number}[]} avoidPositions - Positions to avoid.
 * @returns {number} Minimum distance, or infinity when no positions are supplied.
 */
function minimumAvoidDistance(position, avoidPositions) {
  if (avoidPositions.length === 0) {
    return Infinity;
  }
  let minDistance = Infinity;
  for (const avoidPosition of avoidPositions) {
    const dx = position.x - avoidPosition.x;
    const dy = position.y - avoidPosition.y;
    minDistance = Math.min(minDistance, Math.hypot(dx, dy));
  }
  return minDistance;
}

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
 * Returns the counter-clockwise angular delta from one angle to another.
 * @param {number} fromAngle - Starting angle in radians.
 * @param {number} toAngle - Ending angle in radians.
 * @returns {number} Positive angular delta in `[0, 2 * Math.PI)`.
 */
function positiveAngleDelta(fromAngle, toAngle) {
  const fullTurn = Math.PI * 2;
  let delta = (toAngle - fromAngle) % fullTurn;
  if (delta < 0) {
    delta += fullTurn;
  }
  return delta;
}

/**
 * Returns whether an angle lies on the counter-clockwise arc from start to end.
 * @param {number} angle - Candidate angle in radians.
 * @param {number} startAngle - Arc start angle in radians.
 * @param {number} endAngle - Arc end angle in radians.
 * @returns {boolean} True when the angle is within the directed arc.
 */
function angleWithinCounterClockwiseArc(angle, startAngle, endAngle) {
  return positiveAngleDelta(startAngle, angle) <= positiveAngleDelta(startAngle, endAngle) + ANGLE_ARC_TOLERANCE;
}

/**
 * Returns whether an angle falls in an unusually sharp local sector between
 * adjacent ring bonds. Fused and bridged templates can make the ring centroid
 * land just outside a pinched vertex, so this catches the occupied wedge before
 * centroid-based face detection has a chance to miss it.
 * @param {number} angle - Candidate angle in radians.
 * @param {number} firstAngle - First incident ring-bond angle.
 * @param {number} secondAngle - Second incident ring-bond angle.
 * @returns {boolean} True when the candidate points into a narrow local ring sector.
 */
function angleWithinNarrowRingVertexSector(angle, firstAngle, secondAngle) {
  const firstToSecondDelta = positiveAngleDelta(firstAngle, secondAngle);
  const secondToFirstDelta = positiveAngleDelta(secondAngle, firstAngle);
  const narrowDelta = Math.min(firstToSecondDelta, secondToFirstDelta);
  if (narrowDelta > SHARP_RING_VERTEX_INTERIOR_LIMIT) {
    return false;
  }
  if (firstToSecondDelta <= secondToFirstDelta) {
    return angleWithinCounterClockwiseArc(angle, firstAngle, secondAngle);
  }
  return angleWithinCounterClockwiseArc(angle, secondAngle, firstAngle);
}

/**
 * Returns the centroid of a polygon, optionally excluding the center vertex.
 * @param {Array<{x: number, y: number}>} polygon - Ring polygon coordinates.
 * @param {{x: number, y: number}} centerPosition - Stereocenter position.
 * @returns {{x: number, y: number}} Polygon centroid.
 */
function polygonCentroidExcludingCenter(polygon, centerPosition) {
  const points = polygon.filter(point => length(sub(point, centerPosition)) > RING_VERTEX_MATCH_TOLERANCE);
  const centroidPoints = points.length > 0 ? points : polygon;
  const sum = centroidPoints.reduce(
    (accumulator, point) => ({
      x: accumulator.x + point.x,
      y: accumulator.y + point.y
    }),
    { x: 0, y: 0 }
  );
  return {
    x: sum.x / centroidPoints.length,
    y: sum.y / centroidPoints.length
  };
}

/**
 * Returns whether the candidate vector points through the local interior sector
 * of an incident ring face. Endpoint containment alone misses fused-ring cases
 * where a short displayed hydrogen lands outside the polygon but the bond still
 * visually cuts into the ring face.
 * @param {{x: number, y: number}} centerPosition - Stereocenter position.
 * @param {Array<{x: number, y: number}>} ringPolygon - Incident ring polygon.
 * @param {number} candidateAngle - Candidate projection angle in radians.
 * @returns {boolean} True when the candidate points through the ring interior.
 */
function pointsIntoRingInteriorSector(centerPosition, ringPolygon, candidateAngle) {
  const centerIndex = ringPolygon.findIndex(point => length(sub(point, centerPosition)) <= RING_VERTEX_MATCH_TOLERANCE);
  if (centerIndex < 0 || ringPolygon.length < 3) {
    return false;
  }

  const previousPoint = ringPolygon[(centerIndex - 1 + ringPolygon.length) % ringPolygon.length];
  const nextPoint = ringPolygon[(centerIndex + 1) % ringPolygon.length];
  if (length(sub(previousPoint, centerPosition)) <= RING_VERTEX_MATCH_TOLERANCE || length(sub(nextPoint, centerPosition)) <= RING_VERTEX_MATCH_TOLERANCE) {
    return false;
  }

  const previousAngle = angleOf(sub(previousPoint, centerPosition));
  const nextAngle = angleOf(sub(nextPoint, centerPosition));
  if (angleWithinNarrowRingVertexSector(candidateAngle, previousAngle, nextAngle)) {
    return true;
  }
  const centroidVector = sub(polygonCentroidExcludingCenter(ringPolygon, centerPosition), centerPosition);
  const previousToNextDelta = positiveAngleDelta(previousAngle, nextAngle);
  const centroidInsidePreviousToNext =
    length(centroidVector) > RING_VERTEX_MATCH_TOLERANCE ? angleWithinCounterClockwiseArc(angleOf(centroidVector), previousAngle, nextAngle) : previousToNextDelta <= Math.PI;
  return centroidInsidePreviousToNext ? angleWithinCounterClockwiseArc(candidateAngle, previousAngle, nextAngle) : angleWithinCounterClockwiseArc(candidateAngle, nextAngle, previousAngle);
}

/**
 * Counts incident ring faces whose local interior sector contains the candidate
 * hydrogen projection vector.
 * @param {{x: number, y: number}} centerPosition - Stereocenter position.
 * @param {{x: number, y: number}} candidatePosition - Candidate hydrogen position.
 * @param {Array<Array<{x: number, y: number}>>} incidentRingPolygons - Incident ring polygons.
 * @returns {number} Number of local ring interiors crossed by the candidate vector.
 */
function countRingInteriorSectorIntrusions(centerPosition, candidatePosition, incidentRingPolygons) {
  const candidateAngle = angleOf(sub(candidatePosition, centerPosition));
  return incidentRingPolygons.filter(ringPolygon => pointsIntoRingInteriorSector(centerPosition, ringPolygon, candidateAngle)).length;
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
 * @param {{x: number, y: number}[]} avoidPositions - Non-neighbor atom positions to avoid.
 * @returns {{position: {x: number, y: number}, ringInteriorCount: number, containingRingCount: number, sector: number, avoidDistance: number, baseDeviation: number, cardinalDeviation: number}} Ranked candidate data.
 */
function evaluateCandidate(centerPosition, knownPositions, radius, angle, baseAngle, incidentRingPolygons, avoidPositions) {
  const position = add(centerPosition, fromAngle(angle, radius));
  return {
    position,
    ringInteriorCount: countRingInteriorSectorIntrusions(centerPosition, position, incidentRingPolygons),
    containingRingCount: countPointInPolygons(incidentRingPolygons, position),
    sector: minimumSectorAngle(centerPosition, position, knownPositions),
    avoidDistance: minimumAvoidDistance(position, avoidPositions),
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
 * @param {number} cardinalAxisSectorTolerance - Allowed sector drop when snapping to a cardinal axis.
 * @param {{x: number, y: number}[]} avoidPositions - Non-neighbor atom positions to avoid.
 * @param {number} minimumAvoidanceDistance - Distance that counts as fully clear of avoid positions.
 * @returns {{x: number, y: number}} Chosen hydrogen position.
 */
function bestDisplayCandidate(centerPosition, knownPositions, radius, baseAngle, incidentRingPolygons, cardinalAxisSectorTolerance, avoidPositions, minimumAvoidanceDistance) {
  const candidates = uniqueAngles([baseAngle, ...gapBisectorAngles(centerPosition, knownPositions), ...CARDINAL_AXIS_ANGLES]).map(angle =>
    evaluateCandidate(centerPosition, knownPositions, radius, angle, baseAngle, incidentRingPolygons, avoidPositions)
  );
  const bestRingInteriorCount = Math.min(...candidates.map(candidate => candidate.ringInteriorCount));
  const ringExteriorCandidates = candidates.filter(candidate => candidate.ringInteriorCount === bestRingInteriorCount);
  const bestContainingRingCount = Math.min(...ringExteriorCandidates.map(candidate => candidate.containingRingCount));
  const ringSafeCandidates = ringExteriorCandidates.filter(candidate => candidate.containingRingCount === bestContainingRingCount);
  const bestAvoidance = Math.max(...ringSafeCandidates.map(candidate => Math.min(candidate.avoidDistance, minimumAvoidanceDistance)));
  const atomClearCandidates = ringSafeCandidates.filter(candidate => Math.min(candidate.avoidDistance, minimumAvoidanceDistance) >= bestAvoidance - 1e-6);
  const bestSector = Math.max(...atomClearCandidates.map(candidate => candidate.sector));
  const nearBestSectorCandidates = atomClearCandidates.filter(candidate => candidate.sector >= bestSector - cardinalAxisSectorTolerance);
  const readableNearBestSectorCandidates =
    bestSector >= DISPLAYED_STEREO_HYDROGEN_READABLE_SECTOR
      ? nearBestSectorCandidates.filter(candidate => candidate.sector >= DISPLAYED_STEREO_HYDROGEN_READABLE_SECTOR - DISPLAYED_STEREO_HYDROGEN_READABLE_SECTOR_SLACK)
      : nearBestSectorCandidates;

  let bestCandidate = readableNearBestSectorCandidates[0] ?? nearBestSectorCandidates[0] ?? atomClearCandidates[0] ?? ringSafeCandidates[0] ?? candidates[0];
  for (const candidate of readableNearBestSectorCandidates) {
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

  if (bestCandidate.containingRingCount === 0 && bestCandidate.sector < DISPLAYED_STEREO_HYDROGEN_MINIMUM_SECTOR) {
    const minimumReadableSector = Math.max(DISPLAYED_STEREO_HYDROGEN_MINIMUM_SECTOR, bestCandidate.sector + DISPLAYED_STEREO_HYDROGEN_MINIMUM_SECTOR * 0.75);
    const readableEndpointCandidates = candidates.filter(
      candidate =>
        candidate.containingRingCount === 0 && candidate.sector >= minimumReadableSector - 1e-6 && Math.min(candidate.avoidDistance, minimumAvoidanceDistance) >= minimumAvoidanceDistance * 0.5
    );
    if (readableEndpointCandidates.length > 0) {
      const readableBestSector = Math.max(...readableEndpointCandidates.map(candidate => candidate.sector));
      const readableNearBestSectorCandidates = readableEndpointCandidates.filter(candidate => candidate.sector >= readableBestSector - cardinalAxisSectorTolerance);
      const readableBestAvoidance = Math.max(...readableNearBestSectorCandidates.map(candidate => Math.min(candidate.avoidDistance, minimumAvoidanceDistance)));
      const readableAtomClearCandidates = readableNearBestSectorCandidates.filter(candidate => Math.min(candidate.avoidDistance, minimumAvoidanceDistance) >= readableBestAvoidance - 1e-6);
      bestCandidate = readableAtomClearCandidates[0] ?? readableNearBestSectorCandidates[0] ?? readableEndpointCandidates[0];
    }
  }

  if (bestCandidate.containingRingCount > 0) {
    const minimumEndpointExteriorSector = DISPLAYED_STEREO_HYDROGEN_MINIMUM_SECTOR * 0.75;
    const endpointExteriorCandidates = candidates.filter(candidate => candidate.containingRingCount < bestCandidate.containingRingCount && candidate.sector >= minimumEndpointExteriorSector - 1e-6);
    if (endpointExteriorCandidates.length > 0) {
      const fallbackBestInteriorCount = Math.min(...endpointExteriorCandidates.map(candidate => candidate.ringInteriorCount));
      const fallbackRingCandidates = endpointExteriorCandidates.filter(candidate => candidate.ringInteriorCount === fallbackBestInteriorCount);
      const fallbackBestSector = Math.max(...fallbackRingCandidates.map(candidate => candidate.sector));
      const fallbackNearBestSectorCandidates = fallbackRingCandidates.filter(candidate => candidate.sector >= fallbackBestSector - cardinalAxisSectorTolerance);
      const fallbackBestAvoidance = Math.max(...fallbackNearBestSectorCandidates.map(candidate => Math.min(candidate.avoidDistance, minimumAvoidanceDistance)));
      const fallbackAtomClearCandidates = fallbackNearBestSectorCandidates.filter(candidate => Math.min(candidate.avoidDistance, minimumAvoidanceDistance) >= fallbackBestAvoidance - 1e-6);
      bestCandidate = fallbackAtomClearCandidates[0] ?? fallbackNearBestSectorCandidates[0] ?? fallbackRingCandidates[0] ?? endpointExteriorCandidates[0];
      for (const candidate of fallbackNearBestSectorCandidates) {
        const candidateAvoidance = Math.min(candidate.avoidDistance, minimumAvoidanceDistance);
        const bestAvoidanceForCandidate = Math.min(bestCandidate.avoidDistance, minimumAvoidanceDistance);
        if (candidateAvoidance > bestAvoidanceForCandidate + 1e-6) {
          bestCandidate = candidate;
          continue;
        }
        if (Math.abs(candidateAvoidance - bestAvoidanceForCandidate) > 1e-6) {
          continue;
        }
        if (candidate.cardinalDeviation < bestCandidate.cardinalDeviation - 1e-6) {
          bestCandidate = candidate;
          continue;
        }
        if (Math.abs(candidate.cardinalDeviation - bestCandidate.cardinalDeviation) > 1e-6) {
          continue;
        }
        if (candidate.baseDeviation < bestCandidate.baseDeviation) {
          bestCandidate = candidate;
        }
      }
    }
  }

  return bestCandidate.position;
}

/**
 * Counts incident ring polygons that contain a displayed hydrogen endpoint.
 * @param {{x: number, y: number}} candidatePosition - Candidate hydrogen position.
 * @param {Array<Array<{x: number, y: number}>>} incidentRingPolygons - Incident ring polygons.
 * @returns {number} Number of incident rings containing the endpoint.
 */
function ringEndpointContainmentCount(candidatePosition, incidentRingPolygons) {
  return countPointInPolygons(incidentRingPolygons, candidatePosition);
}

/**
 * Synthesizes a hidden-hydrogen position opposite known substituents.
 * @param {{x: number, y: number}} centerPosition - Stereocenter position.
 * @param {{x: number, y: number}[]} knownPositions - Known neighbor positions.
 * @param {number} bondLength - Target bond length.
 * @param {object} [options] - Synthesis options.
 * @param {Array<Array<{x: number, y: number}>>} [options.incidentRingPolygons] - Incident ring polygons to avoid.
 * @param {{x: number, y: number}[]} [options.avoidPositions] - Non-neighbor atom positions to avoid.
 * @param {number} [options.minimumAvoidanceDistance] - Distance that counts as fully clear of avoid positions.
 * @param {boolean} [options.preferCardinalAxes] - When true, prefer exact horizontal or vertical projections when they are almost as open as the best free-angle candidate.
 * @param {number} [options.cardinalAxisSectorTolerance] - Allowed sector drop when snapping to a cardinal axis.
 * @param {boolean} [options.fixedRadius] - When true, use `bondLength` as the exact projection radius instead of matching neighboring bond lengths.
 * @returns {{x: number, y: number}} Synthesized hydrogen position.
 */
export function synthesizeHydrogenPosition(centerPosition, knownPositions, bondLength, options = {}) {
  const incidentRingPolygons = options.incidentRingPolygons ?? [];
  const avoidPositions = options.avoidPositions ?? [];
  const preferCardinalAxes = options.preferCardinalAxes === true;
  const cardinalAxisSectorTolerance = options.cardinalAxisSectorTolerance ?? CARDINAL_AXIS_SECTOR_TOLERANCE;
  const fixedRadius = options.fixedRadius === true;
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

  const radius = fixedRadius ? bondLength : radiusSum / knownPositions.length;
  const baseAngle = angleOf(direction);
  const basePosition = add(centerPosition, scale(direction, radius));
  const minimumAvoidanceDistance = options.minimumAvoidanceDistance ?? radius * 0.6;
  if (preferCardinalAxes) {
    return bestDisplayCandidate(centerPosition, knownPositions, radius, baseAngle, incidentRingPolygons, cardinalAxisSectorTolerance, avoidPositions, minimumAvoidanceDistance);
  }
  if (incidentRingPolygons.length === 0) {
    return basePosition;
  }
  if (countPointInPolygons(incidentRingPolygons, basePosition) === 0 && countRingInteriorSectorIntrusions(centerPosition, basePosition, incidentRingPolygons) === 0) {
    return basePosition;
  }

  let bestCandidate = null;
  for (const candidateAngle of [baseAngle, ...gapBisectorAngles(centerPosition, knownPositions)]) {
    const candidatePosition = add(centerPosition, fromAngle(candidateAngle, radius));
    const ringInteriorCount = countRingInteriorSectorIntrusions(centerPosition, candidatePosition, incidentRingPolygons);
    const containingRingCount = countPointInPolygons(incidentRingPolygons, candidatePosition);
    const sector = minimumSectorAngle(centerPosition, candidatePosition, knownPositions);
    const deviation = angularDifference(candidateAngle, baseAngle);
    if (!bestCandidate) {
      bestCandidate = { position: candidatePosition, ringInteriorCount, containingRingCount, sector, deviation };
      continue;
    }
    if (ringInteriorCount !== bestCandidate.ringInteriorCount) {
      if (ringInteriorCount < bestCandidate.ringInteriorCount) {
        bestCandidate = { position: candidatePosition, ringInteriorCount, containingRingCount, sector, deviation };
      }
      continue;
    }
    if (containingRingCount !== bestCandidate.containingRingCount) {
      if (containingRingCount < bestCandidate.containingRingCount) {
        bestCandidate = { position: candidatePosition, ringInteriorCount, containingRingCount, sector, deviation };
      }
      continue;
    }
    if (sector > bestCandidate.sector + 1e-6 || (Math.abs(sector - bestCandidate.sector) <= 1e-6 && deviation < bestCandidate.deviation)) {
      bestCandidate = { position: candidatePosition, ringInteriorCount, containingRingCount, sector, deviation };
    }
  }

  return bestCandidate?.position ?? basePosition;
}

/**
 * Synthesizes a displayed stereochemical hydrogen position, backing off ring
 * face avoidance when that would draw the hydrogen almost on top of another
 * incident bond.
 * @param {{x: number, y: number}} centerPosition - Stereocenter position.
 * @param {{x: number, y: number}[]} knownPositions - Known neighbor positions.
 * @param {number} bondLength - Target display bond length.
 * @param {object} [options] - Synthesis options.
 * @param {Array<Array<{x: number, y: number}>>} [options.incidentRingPolygons] - Incident ring polygons to avoid.
 * @param {{x: number, y: number}[]} [options.avoidPositions] - Non-neighbor atom positions to avoid.
 * @param {number} [options.minimumAvoidanceDistance] - Distance that counts as fully clear of avoid positions.
 * @param {number} [options.cardinalAxisSectorTolerance] - Allowed sector drop when snapping to a cardinal axis.
 * @param {number} [options.minimumDisplaySector] - Minimum acceptable angular clearance from existing bonds.
 * @returns {{x: number, y: number}} Synthesized hydrogen position.
 */
export function synthesizeDisplayedStereoHydrogenPosition(centerPosition, knownPositions, bondLength, options = {}) {
  const incidentRingPolygons = options.incidentRingPolygons ?? [];
  const avoidPositions = options.avoidPositions ?? [];
  const minimumAvoidanceDistance = options.minimumAvoidanceDistance ?? bondLength * 0.6;
  const preferredPosition = synthesizeHydrogenPosition(centerPosition, knownPositions, bondLength, {
    ...options,
    preferCardinalAxes: true,
    fixedRadius: true
  });
  if (incidentRingPolygons.length === 0 || knownPositions.length === 0) {
    return preferredPosition;
  }

  const minimumDisplaySector = options.minimumDisplaySector ?? DISPLAYED_STEREO_HYDROGEN_MINIMUM_SECTOR;
  const preferredSector = minimumSectorAngle(centerPosition, preferredPosition, knownPositions);
  const preferredAvoidDistance = minimumAvoidDistance(preferredPosition, avoidPositions);
  if (preferredSector >= minimumDisplaySector && preferredAvoidDistance >= minimumAvoidanceDistance) {
    return preferredPosition;
  }

  const relaxedPosition = synthesizeHydrogenPosition(centerPosition, knownPositions, bondLength, {
    ...options,
    incidentRingPolygons: [],
    preferCardinalAxes: true,
    fixedRadius: true
  });
  const preferredContainingRingCount = ringEndpointContainmentCount(preferredPosition, incidentRingPolygons);
  const relaxedContainingRingCount = ringEndpointContainmentCount(relaxedPosition, incidentRingPolygons);
  const relaxedSector = minimumSectorAngle(centerPosition, relaxedPosition, knownPositions);
  const relaxedAvoidDistance = minimumAvoidDistance(relaxedPosition, avoidPositions);
  const preferredIsTooPinchedForDisplay = preferredSector < minimumDisplaySector * 0.5;
  const relaxedEndpointIsNoWorse = relaxedContainingRingCount <= preferredContainingRingCount || preferredIsTooPinchedForDisplay;
  if (relaxedEndpointIsNoWorse && relaxedAvoidDistance > preferredAvoidDistance + 1e-6 && relaxedSector >= minimumDisplaySector - 1e-6) {
    return relaxedPosition;
  }
  return relaxedEndpointIsNoWorse && relaxedSector > preferredSector + minimumDisplaySector ? relaxedPosition : preferredPosition;
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

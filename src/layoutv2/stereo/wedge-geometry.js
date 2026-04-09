/** @module stereo/wedge-geometry */

import { add, angularDifference, fromAngle, length, normalize, scale, sub } from '../geometry/vec2.js';

/**
 * Synthesizes a hidden-hydrogen position opposite known substituents.
 * @param {{x: number, y: number}} centerPosition - Stereocenter position.
 * @param {{x: number, y: number}[]} knownPositions - Known neighbor positions.
 * @param {number} bondLength - Target bond length.
 * @returns {{x: number, y: number}} Synthesized hydrogen position.
 */
export function synthesizeHydrogenPosition(centerPosition, knownPositions, bondLength) {
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

  return add(centerPosition, scale(direction, radiusSum / knownPositions.length));
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

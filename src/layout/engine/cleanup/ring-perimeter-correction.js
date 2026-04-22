/** @module cleanup/ring-perimeter-correction */

import { ellipsePerimeterPoints, macrocycleAspectRatio, solveEllipseScale } from '../geometry/ellipse.js';
import { RING_PERIMETER_MAX_DEVIATION_FACTOR } from '../constants.js';
import { angleOf, centroid, distance, sub } from '../geometry/vec2.js';

/**
 * Returns the placed macrocycle rings eligible for perimeter correction.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Coordinate map.
 * @returns {object[]} Eligible macrocycle rings sorted largest-first.
 */
function eligibleMacrocycleRings(layoutGraph, coords) {
  const simpleMacrocycleRingIds = new Set(layoutGraph.ringSystems.filter(ringSystem => ringSystem.ringIds.length === 1).flatMap(ringSystem => ringSystem.ringIds));
  return [...layoutGraph.rings]
    .filter(ring => ring.size >= 12 && simpleMacrocycleRingIds.has(ring.id) && ring.atomIds.every(atomId => coords.has(atomId)))
    .sort((firstRing, secondRing) => secondRing.size - firstRing.size || firstRing.id - secondRing.id);
}

/**
 * Returns the ideal ellipse perimeter points for the current macrocycle ring orientation.
 * @param {object} ring - Macrocycle ring descriptor.
 * @param {Map<string, {x: number, y: number}>} coords - Coordinate map.
 * @param {number} bondLength - Target bond length.
 * @returns {Array<{x: number, y: number}>} Ideal ellipse perimeter points in ring order.
 */
function idealMacrocyclePerimeter(ring, coords, bondLength) {
  const ringPoints = ring.atomIds.map(atomId => coords.get(atomId));
  const center = centroid(ringPoints);
  const startAngle = angleOf(sub(ringPoints[0], center));
  const aspectRatio = macrocycleAspectRatio(ring.size);
  const baseScale = solveEllipseScale(ring.size, bondLength, aspectRatio, startAngle);
  return ellipsePerimeterPoints(center, ring.atomIds.length, baseScale * aspectRatio, baseScale / aspectRatio, startAngle);
}

/**
 * Returns whether the current layout contains an eligible macrocycle whose ring
 * atoms drift materially away from the ideal ellipse perimeter.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Coordinate map.
 * @param {{bondLength?: number}} [options] - Optional bond-length override.
 * @returns {boolean} True when the tidy should run.
 */
export function hasRingPerimeterCorrectionNeed(layoutGraph, coords, options = {}) {
  const bondLength = options.bondLength ?? layoutGraph.options.bondLength;
  const maxDeviation = bondLength * RING_PERIMETER_MAX_DEVIATION_FACTOR;

  for (const ring of eligibleMacrocycleRings(layoutGraph, coords)) {
    const idealPoints = idealMacrocyclePerimeter(ring, coords, bondLength);
    for (let index = 0; index < ring.atomIds.length; index++) {
      if (distance(coords.get(ring.atomIds[index]), idealPoints[index]) > maxDeviation) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Nudges macrocycle ring atoms back toward the ideal ellipse perimeter after cleanup.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} inputCoords - Coordinate map.
 * @param {object} [options] - Correction options.
 * @param {number} [options.bondLength] - Target bond length.
 * @param {number} [options.maxIterations] - Iteration budget.
 * @returns {{coords: Map<string, {x: number, y: number}>, nudges: number, iterations: number}} Corrected coordinates and correction stats.
 */
export function runRingPerimeterCorrection(layoutGraph, inputCoords, options = {}) {
  const bondLength = options.bondLength ?? layoutGraph.options.bondLength;
  const maxIterations = options.maxIterations ?? 2;
  const maxDeviation = bondLength * RING_PERIMETER_MAX_DEVIATION_FACTOR;
  const coords = new Map([...inputCoords.entries()].map(([atomId, position]) => [atomId, { ...position }]));
  let nudges = 0;
  let iterations = 0;

  for (let iteration = 0; iteration < maxIterations; iteration++) {
    let moved = false;
    for (const ring of eligibleMacrocycleRings(layoutGraph, coords)) {
      const idealPoints = idealMacrocyclePerimeter(ring, coords, bondLength);
      for (let index = 0; index < ring.atomIds.length; index++) {
        const atomId = ring.atomIds[index];
        const currentPosition = coords.get(atomId);
        const idealPosition = idealPoints[index];
        const deviation = distance(currentPosition, idealPosition);
        if (deviation <= maxDeviation) {
          continue;
        }
        coords.set(atomId, {
          x: currentPosition.x + (idealPosition.x - currentPosition.x) * 0.5,
          y: currentPosition.y + (idealPosition.y - currentPosition.y) * 0.5
        });
        nudges++;
        moved = true;
      }
    }
    if (!moved) {
      break;
    }
    iterations++;
  }

  return { coords, nudges, iterations };
}

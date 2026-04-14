/** @module cleanup/symmetry-tidy */

import { ANGLE_EPSILON, DISTANCE_EPSILON } from '../constants.js';
import { computeBounds } from '../geometry/bounds.js';
import { angleOf, angularDifference, centroid, rotate, sub } from '../geometry/vec2.js';

/**
 * Returns the qualifying fused ring-junction pairs that should be snapped to an axis.
 * @param {object} layoutGraph - Layout graph shell.
 * @returns {Map<number, {atomIds: string[], junctionPairs: string[][]}>} Component-indexed junction targets.
 */
function collectJunctionTargets(layoutGraph) {
  if (!layoutGraph) {
    return new Map();
  }

  const ringById = new Map(layoutGraph.rings.map(ring => [ring.id, ring]));
  const componentByAtomId = new Map();
  for (const component of layoutGraph.components ?? []) {
    for (const atomId of component.atomIds) {
      componentByAtomId.set(atomId, component);
    }
  }

  const targets = new Map();
  for (const connection of layoutGraph.ringConnections ?? []) {
    if (connection.kind !== 'fused' || connection.sharedAtomIds.length !== 2) {
      continue;
    }
    const firstRing = ringById.get(connection.firstRingId);
    const secondRing = ringById.get(connection.secondRingId);
    if (!firstRing || !secondRing) {
      continue;
    }
    const ringSizes = [firstRing.size, secondRing.size].sort((firstSize, secondSize) => firstSize - secondSize);
    if (!(ringSizes[0] === 5 && ringSizes[1] === 6) && !(ringSizes[0] === 6 && ringSizes[1] === 6)) {
      continue;
    }
    const component = componentByAtomId.get(connection.sharedAtomIds[0]);
    if (!component) {
      continue;
    }
    if (!targets.has(component.id)) {
      targets.set(component.id, {
        atomIds: [...component.atomIds],
        junctionPairs: []
      });
    }
    targets.get(component.id).junctionPairs.push([...connection.sharedAtomIds]);
  }

  return targets;
}

/**
 * Returns the angular deviation of a bond from the nearest horizontal or vertical axis.
 * @param {{x: number, y: number}} firstPosition - First bond endpoint.
 * @param {{x: number, y: number}} secondPosition - Second bond endpoint.
 * @returns {number} Absolute deviation in radians.
 */
function axisDeviation(firstPosition, secondPosition) {
  const bondAngle = angleOf(sub(secondPosition, firstPosition));
  return Math.min(angularDifference(bondAngle, 0), angularDifference(bondAngle, Math.PI / 2), angularDifference(bondAngle, Math.PI), angularDifference(bondAngle, -Math.PI / 2));
}

/**
 * Returns a rotated copy of one connected component around its centroid.
 * @param {Map<string, {x: number, y: number}>} coords - Coordinate map.
 * @param {string[]} atomIds - Component atom IDs.
 * @param {number} rotationAngle - Rotation angle in radians.
 * @returns {Map<string, {x: number, y: number}>} Rotated coordinate map.
 */
function rotateComponent(coords, atomIds, rotationAngle) {
  if (Math.abs(rotationAngle) <= ANGLE_EPSILON) {
    return coords;
  }

  const points = atomIds.map(atomId => coords.get(atomId)).filter(Boolean);
  if (points.length === 0) {
    return coords;
  }

  const center = centroid(points);
  const rotatedCoords = new Map(coords);
  for (const atomId of atomIds) {
    const position = coords.get(atomId);
    if (!position) {
      continue;
    }
    const rotatedPosition = rotate(sub(position, center), rotationAngle);
    rotatedCoords.set(atomId, {
      x: center.x + rotatedPosition.x,
      y: center.y + rotatedPosition.y
    });
  }
  return rotatedCoords;
}

/**
 * Scores the current axis alignment of qualifying junction bonds in a component.
 * @param {Map<string, {x: number, y: number}>} coords - Coordinate map.
 * @param {{atomIds: string[], junctionPairs: string[][]}} target - Component target descriptor.
 * @returns {number} Aggregate score; lower is better.
 */
function scoreJunctionAlignment(coords, target) {
  let score = 0;
  for (const [firstAtomId, secondAtomId] of target.junctionPairs) {
    const firstPosition = coords.get(firstAtomId);
    const secondPosition = coords.get(secondAtomId);
    if (!firstPosition || !secondPosition) {
      continue;
    }
    score += axisDeviation(firstPosition, secondPosition);
  }

  const bounds = computeBounds(coords, target.atomIds);
  if (bounds && bounds.height > bounds.width) {
    score += Math.PI;
  }
  return score;
}

/**
 * Returns the candidate component rotations that exactly align a junction bond to an axis.
 * @param {Map<string, {x: number, y: number}>} coords - Coordinate map.
 * @param {string[][]} junctionPairs - Shared fused-junction bond pairs.
 * @returns {number[]} Candidate rotation angles in radians.
 */
function candidateJunctionRotations(coords, junctionPairs) {
  const candidateAngles = new Set([0]);
  for (const [firstAtomId, secondAtomId] of junctionPairs) {
    const firstPosition = coords.get(firstAtomId);
    const secondPosition = coords.get(secondAtomId);
    if (!firstPosition || !secondPosition) {
      continue;
    }
    const bondAngle = angleOf(sub(secondPosition, firstPosition));
    for (const targetAngle of [0, Math.PI / 2]) {
      const rotationAngle = targetAngle - bondAngle;
      candidateAngles.add(Number(rotationAngle.toFixed(12)));
    }
  }
  return [...candidateAngles];
}

/**
 * Rotates qualifying fused components so their shared junction bonds land on an axis.
 * @param {Map<string, {x: number, y: number}>} inputCoords - Coordinate map.
 * @param {object} layoutGraph - Layout graph shell.
 * @returns {{coords: Map<string, {x: number, y: number}>, junctionSnapCount: number}} Adjusted coordinates and snap count.
 */
function snapRingJunctions(inputCoords, layoutGraph) {
  const targets = collectJunctionTargets(layoutGraph);
  if (targets.size === 0) {
    return {
      coords: inputCoords,
      junctionSnapCount: 0
    };
  }

  let coords = new Map(inputCoords);
  let junctionSnapCount = 0;
  for (const target of targets.values()) {
    const currentScore = scoreJunctionAlignment(coords, target);
    let bestScore = currentScore;
    let bestCoords = coords;

    for (const rotationAngle of candidateJunctionRotations(coords, target.junctionPairs)) {
      if (Math.abs(rotationAngle) <= ANGLE_EPSILON) {
        continue;
      }
      const candidateCoords = rotateComponent(coords, target.atomIds, rotationAngle);
      const candidateScore = scoreJunctionAlignment(candidateCoords, target);
      if (candidateScore + ANGLE_EPSILON < bestScore) {
        bestScore = candidateScore;
        bestCoords = candidateCoords;
      }
    }

    if (bestCoords !== coords) {
      coords = bestCoords;
      junctionSnapCount += target.junctionPairs.length;
    }
  }

  return {
    coords,
    junctionSnapCount
  };
}

/**
 * Snaps tiny coordinate noise back onto clean axes after cleanup.
 * @param {Map<string, {x: number, y: number}>} inputCoords - Coordinate map.
 * @param {object} [options] - Symmetry-tidy options.
 * @param {number} [options.epsilon] - Snap tolerance.
 * @param {object} [options.layoutGraph] - Optional layout graph for fused-junction snapping.
 * @returns {{coords: Map<string, {x: number, y: number}>, snappedCount: number, junctionSnapCount: number}} Tidied coordinates and snap counts.
 */
export function tidySymmetry(inputCoords, options = {}) {
  const epsilon = options.epsilon ?? DISTANCE_EPSILON;
  const junctionSnap = snapRingJunctions(inputCoords, options.layoutGraph);
  const coords = new Map();
  let snappedCount = 0;

  for (const [atomId, position] of junctionSnap.coords) {
    const nextPosition = { ...position };
    if (Math.abs(nextPosition.x) <= epsilon) {
      nextPosition.x = 0;
      snappedCount++;
    }
    if (Math.abs(nextPosition.y) <= epsilon) {
      nextPosition.y = 0;
      snappedCount++;
    }
    coords.set(atomId, nextPosition);
  }

  return {
    coords,
    snappedCount,
    junctionSnapCount: junctionSnap.junctionSnapCount
  };
}

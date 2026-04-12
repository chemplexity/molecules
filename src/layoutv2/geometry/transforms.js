/** @module geometry/transforms */

import { add, angleOf, rotate, scale, sub } from './vec2.js';

function transformPoint(point, origin, targetOrigin, rotation, uniformScale) {
  const shifted = sub(point, origin);
  return add(targetOrigin, rotate(scale(shifted, uniformScale), rotation));
}

/**
 * Reflects a point across the infinite line through the given anchor points.
 * @param {{x: number, y: number}} point - Point to reflect.
 * @param {{x: number, y: number}} lineFirst - First point on the mirror line.
 * @param {{x: number, y: number}} lineSecond - Second point on the mirror line.
 * @returns {{x: number, y: number}} Reflected point.
 */
function reflectAcrossLine(point, lineFirst, lineSecond) {
  const axis = sub(lineSecond, lineFirst);
  const axisLength = Math.hypot(axis.x, axis.y);
  if (axisLength <= 1e-12) {
    return { ...point };
  }

  const unitAxis = { x: axis.x / axisLength, y: axis.y / axisLength };
  const offset = sub(point, lineFirst);
  const parallel = (offset.x * unitAxis.x) + (offset.y * unitAxis.y);
  const parallelVector = { x: unitAxis.x * parallel, y: unitAxis.y * parallel };
  const perpendicularVector = sub(offset, parallelVector);
  return add(lineFirst, sub(parallelVector, perpendicularVector));
}

/**
 * Applies the current two-anchor similarity transform to a source coordinate map.
 * @param {Map<string, {x: number, y: number}>} sourceCoords - Source coordinate map.
 * @param {string[]} atomIds - Component atom ids.
 * @param {string} firstAtomId - First fixed anchor atom id.
 * @param {string} secondAtomId - Second fixed anchor atom id.
 * @param {Map<string, {x: number, y: number}>} fixedCoords - Fixed target coordinates.
 * @returns {Map<string, {x: number, y: number}>} Transformed coordinates.
 */
function applyTwoAnchorTransform(sourceCoords, atomIds, firstAtomId, secondAtomId, fixedCoords) {
  const currentFirst = sourceCoords.get(firstAtomId);
  const currentSecond = sourceCoords.get(secondAtomId);
  const targetFirst = fixedCoords.get(firstAtomId);
  const targetSecond = fixedCoords.get(secondAtomId);
  const currentVector = sub(currentSecond, currentFirst);
  const targetVector = sub(targetSecond, targetFirst);
  const currentLength = Math.hypot(currentVector.x, currentVector.y);
  const targetLength = Math.hypot(targetVector.x, targetVector.y);
  const rotation = angleOf(targetVector) - angleOf(currentVector);
  const uniformScale = targetLength / currentLength;
  const transformed = new Map(sourceCoords);
  for (const atomId of atomIds) {
    const position = sourceCoords.get(atomId);
    if (!position) {
      continue;
    }
    transformed.set(atomId, transformPoint(position, currentFirst, targetFirst, rotation, uniformScale));
  }
  return transformed;
}

/**
 * Scores how well transformed coordinates match the full fixed-atom set.
 * Lower scores indicate the transformed layout preserves the existing handedness
 * and local shape more faithfully.
 * @param {Map<string, {x: number, y: number}>} transformedCoords - Candidate transformed coordinates.
 * @param {string[]} fixedAtomIds - Fixed atom ids participating in the score.
 * @param {Map<string, {x: number, y: number}>} fixedCoords - Fixed target coordinates.
 * @returns {number} Sum of squared residual distances over the fixed atoms.
 */
function fixedResidualScore(transformedCoords, fixedAtomIds, fixedCoords) {
  let residual = 0;
  for (const atomId of fixedAtomIds) {
    const transformed = transformedCoords.get(atomId);
    const target = fixedCoords.get(atomId);
    if (!transformed || !target) {
      continue;
    }
    const dx = transformed.x - target.x;
    const dy = transformed.y - target.y;
    residual += (dx * dx) + (dy * dy);
  }
  return residual;
}

/**
 * Chooses the most stable fixed-anchor pair for similarity alignment.
 * Using the widest-separated fixed pair makes cleanup-only refinement less
 * likely to flip an existing acyclic handedness around an arbitrary local bond.
 * @param {string[]} fixedAtomIds - Fixed atom ids available for alignment.
 * @param {Map<string, {x: number, y: number}>} fixedCoords - Fixed target coordinates.
 * @returns {[string, string]} Pair of fixed atom ids to use as anchors.
 */
function chooseAnchorPair(fixedAtomIds, fixedCoords) {
  let bestPair = [fixedAtomIds[0], fixedAtomIds[1]];
  let bestDistanceSquared = -1;
  for (let firstIndex = 0; firstIndex < fixedAtomIds.length; firstIndex++) {
    const firstAtomId = fixedAtomIds[firstIndex];
    const firstPosition = fixedCoords.get(firstAtomId);
    if (!firstPosition) {
      continue;
    }
    for (let secondIndex = firstIndex + 1; secondIndex < fixedAtomIds.length; secondIndex++) {
      const secondAtomId = fixedAtomIds[secondIndex];
      const secondPosition = fixedCoords.get(secondAtomId);
      if (!secondPosition) {
        continue;
      }
      const dx = secondPosition.x - firstPosition.x;
      const dy = secondPosition.y - firstPosition.y;
      const distanceSquared = (dx * dx) + (dy * dy);
      if (distanceSquared > bestDistanceSquared) {
        bestDistanceSquared = distanceSquared;
        bestPair = [firstAtomId, secondAtomId];
      }
    }
  }
  return bestPair;
}

/**
 * Aligns a component's coordinates to one or two fixed atoms when available.
 * For one fixed atom, a pure translation is applied. For two or more fixed
 * atoms, the component receives a uniform scale, rotation, and translation
 * anchored on the first two canonical fixed atoms.
 * @param {Map<string, {x: number, y: number}>} coords - Coordinate map.
 * @param {string[]} atomIds - Component atom IDs.
 * @param {Map<string, {x: number, y: number}>} fixedCoords - Fixed-coordinate map.
 * @returns {{coords: Map<string, {x: number, y: number}>, anchored: boolean}} Aligned coordinates and anchor flag.
 */
export function alignCoordsToFixed(coords, atomIds, fixedCoords) {
  const fixedAtomIds = atomIds.filter(atomId => fixedCoords.has(atomId) && coords.has(atomId));
  if (fixedAtomIds.length === 0) {
    return { coords, anchored: false };
  }
  if (fixedAtomIds.length === 1) {
    const atomId = fixedAtomIds[0];
    const current = coords.get(atomId);
    const target = fixedCoords.get(atomId);
    const dx = target.x - current.x;
    const dy = target.y - current.y;
    const transformed = new Map(coords);
    for (const currentAtomId of atomIds) {
      const position = coords.get(currentAtomId);
      if (!position) {
        continue;
      }
      transformed.set(currentAtomId, { x: position.x + dx, y: position.y + dy });
    }
    return { coords: transformed, anchored: true };
  }

  const [firstAtomId, secondAtomId] = chooseAnchorPair(fixedAtomIds, fixedCoords);
  const currentFirst = coords.get(firstAtomId);
  const currentSecond = coords.get(secondAtomId);
  const targetFirst = fixedCoords.get(firstAtomId);
  const targetSecond = fixedCoords.get(secondAtomId);
  const currentVector = sub(currentSecond, currentFirst);
  const targetVector = sub(targetSecond, targetFirst);
  const currentLength = Math.hypot(currentVector.x, currentVector.y);
  const targetLength = Math.hypot(targetVector.x, targetVector.y);
  if (currentLength <= 1e-12 || targetLength <= 1e-12) {
    return alignCoordsToFixed(coords, [firstAtomId], fixedCoords);
  }

  const transformed = applyTwoAnchorTransform(coords, atomIds, firstAtomId, secondAtomId, fixedCoords);
  if (fixedAtomIds.length < 3) {
    return { coords: transformed, anchored: true };
  }

  const mirroredSource = new Map(coords);
  for (const atomId of atomIds) {
    const position = coords.get(atomId);
    if (!position) {
      continue;
    }
    mirroredSource.set(atomId, reflectAcrossLine(position, currentFirst, currentSecond));
  }
  const mirroredTransformed = applyTwoAnchorTransform(mirroredSource, atomIds, firstAtomId, secondAtomId, fixedCoords);
  const directResidual = fixedResidualScore(transformed, fixedAtomIds, fixedCoords);
  const mirroredResidual = fixedResidualScore(mirroredTransformed, fixedAtomIds, fixedCoords);
  return { coords: mirroredResidual < directResidual ? mirroredTransformed : transformed, anchored: true };
}

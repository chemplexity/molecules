/** @module geometry/transforms */

import { add, angleOf, rotate, scale, sub } from './vec2.js';

function transformPoint(point, origin, targetOrigin, rotation, uniformScale) {
  const shifted = sub(point, origin);
  return add(targetOrigin, rotate(scale(shifted, uniformScale), rotation));
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

  const [firstAtomId, secondAtomId] = fixedAtomIds;
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

  const rotation = angleOf(targetVector) - angleOf(currentVector);
  const uniformScale = targetLength / currentLength;
  const transformed = new Map(coords);
  for (const atomId of atomIds) {
    const position = coords.get(atomId);
    if (!position) {
      continue;
    }
    transformed.set(atomId, transformPoint(position, currentFirst, targetFirst, rotation, uniformScale));
  }
  return { coords: transformed, anchored: true };
}

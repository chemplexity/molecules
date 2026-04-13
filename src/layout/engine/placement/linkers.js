/** @module placement/linkers */

import { add, angleOf, centroid, normalize, rotate, sub } from '../geometry/vec2.js';

/**
 * Mirrors a point across an axis passing through the given origin.
 * @param {{x: number, y: number}} point - Point to mirror.
 * @param {{x: number, y: number}} origin - Axis origin.
 * @param {number} axisAngle - Axis angle in radians.
 * @returns {{x: number, y: number}} Mirrored point.
 */
function mirrorAcrossAxis(point, origin, axisAngle) {
  const relative = sub(point, origin);
  const aligned = rotate(relative, -axisAngle);
  const mirrored = { x: aligned.x, y: -aligned.y };
  return add(origin, rotate(mirrored, axisAngle));
}

/**
 * Rigidly transforms an attached block onto a target atom position and outgoing angle.
 * @param {Map<string, {x: number, y: number}>} coords - Block coordinates.
 * @param {string} attachmentAtomId - Block attachment atom ID.
 * @param {{x: number, y: number}} targetPosition - Target attachment position.
 * @param {number} targetAngle - Target outgoing angle in radians.
 * @param {{mirror?: boolean}} [options] - Transform options.
 * @returns {Map<string, {x: number, y: number}>} Transformed coordinates.
 */
export function transformAttachedBlock(coords, attachmentAtomId, targetPosition, targetAngle, options = {}) {
  const currentAttachment = coords.get(attachmentAtomId);
  const currentCenter = centroid([...coords.values()]);
  const currentDirection = normalize(sub(currentCenter, currentAttachment));
  const currentAngle = Math.hypot(currentDirection.x, currentDirection.y) <= 1e-12 ? 0 : angleOf(currentDirection);
  const rotation = targetAngle - currentAngle;
  const transformed = new Map();
  for (const [atomId, position] of coords) {
    const shifted = sub(position, currentAttachment);
    const rotated = rotate(shifted, rotation);
    const placedPosition = add(targetPosition, rotated);
    transformed.set(
      atomId,
      options.mirror && atomId !== attachmentAtomId
        ? mirrorAcrossAxis(placedPosition, targetPosition, targetAngle)
        : placedPosition
    );
  }
  return transformed;
}

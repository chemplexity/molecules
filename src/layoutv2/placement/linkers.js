/** @module placement/linkers */

import { add, angleOf, centroid, normalize, rotate, sub } from '../geometry/vec2.js';

/**
 * Rigidly transforms an attached block onto a target atom position and outgoing angle.
 * @param {Map<string, {x: number, y: number}>} coords - Block coordinates.
 * @param {string} attachmentAtomId - Block attachment atom ID.
 * @param {{x: number, y: number}} targetPosition - Target attachment position.
 * @param {number} targetAngle - Target outgoing angle in radians.
 * @returns {Map<string, {x: number, y: number}>} Transformed coordinates.
 */
export function transformAttachedBlock(coords, attachmentAtomId, targetPosition, targetAngle) {
  const currentAttachment = coords.get(attachmentAtomId);
  const currentCenter = centroid([...coords.values()]);
  const currentDirection = normalize(sub(currentCenter, currentAttachment));
  const currentAngle = Math.hypot(currentDirection.x, currentDirection.y) <= 1e-12 ? 0 : angleOf(currentDirection);
  const rotation = targetAngle - currentAngle;
  const transformed = new Map();
  for (const [atomId, position] of coords) {
    const shifted = sub(position, currentAttachment);
    const rotated = rotate(shifted, rotation);
    transformed.set(atomId, add(targetPosition, rotated));
  }
  return transformed;
}

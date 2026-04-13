/** @module placement/block-stitching */

import { add, angleOf, angularDifference, centroid, fromAngle, rotate, sub } from '../geometry/vec2.js';

const STITCH_REFINEMENT_OFFSETS = Object.freeze([
  0,
  Math.PI / 12,
  -Math.PI / 12,
  Math.PI / 6,
  -Math.PI / 6,
  Math.PI / 4,
  -Math.PI / 4
]);

/**
 * Rigidly rotates and translates a child block so its attachment atom lands at
 * the target bond endpoint and the block points along the requested angle.
 * @param {Map<string, {x: number, y: number}>} childCoords - Child block coordinates.
 * @param {string[]} childAtomIds - Child block atom IDs.
 * @param {string} childAttachmentAtomId - Child-side attachment atom.
 * @param {{x: number, y: number}} parentAttachmentPosition - Parent-side attachment position.
 * @param {number} targetAngle - Desired stitched bond angle in radians.
 * @param {number} bondLength - Target bond length.
 * @returns {Map<string, {x: number, y: number}>} Transformed child coordinates.
 */
export function stitchChildBlock(
  childCoords,
  childAtomIds,
  childAttachmentAtomId,
  parentAttachmentPosition,
  targetAngle,
  bondLength
) {
  const childAttachment = childCoords.get(childAttachmentAtomId);
  if (!childAttachment) {
    return new Map(childCoords);
  }

  const childCenter = centroid(childAtomIds.map(atomId => childCoords.get(atomId)).filter(Boolean));
  const currentDirection = sub(childCenter, childAttachment);
  const currentAngle = Math.hypot(currentDirection.x, currentDirection.y) <= 1e-12 ? 0 : angleOf(currentDirection);
  const rotation = targetAngle - currentAngle;
  const targetChildAttachment = add(parentAttachmentPosition, fromAngle(targetAngle, bondLength));
  const transformed = new Map();

  for (const [atomId, position] of childCoords) {
    const shifted = sub(position, childAttachment);
    const rotated = rotate(shifted, rotation);
    transformed.set(atomId, add(targetChildAttachment, rotated));
  }

  return transformed;
}

function scoreStitchedChild(transformedChild, childAtomIds, placedCoords, targetAngle, testedAngle, bondLength) {
  const childPositions = childAtomIds.map(atomId => transformedChild.get(atomId)).filter(Boolean);
  const placedPositions = [...placedCoords.values()];
  let score = 0;

  for (const childPosition of childPositions) {
    for (const placedPosition of placedPositions) {
      const dx = childPosition.x - placedPosition.x;
      const dy = childPosition.y - placedPosition.y;
      const distance = Math.hypot(dx, dy);
      if (distance <= 1e-8) {
        score += 1e9;
        continue;
      }
      if (distance < bondLength * 0.7) {
        score += (bondLength * 0.7 - distance) * 1e5;
      } else if (distance < bondLength * 1.2) {
        score += (bondLength * 1.2 - distance) * 1e3;
      }
    }
  }

  score += angularDifference(testedAngle, targetAngle) * 5;
  return score;
}

/**
 * Locally refines a stitched child block by testing a small angle fan around
 * the requested attachment direction and choosing the lowest-overlap pose
 * against already placed atoms.
 * @param {Map<string, {x: number, y: number}>} childCoords - Child block coordinates.
 * @param {string[]} childAtomIds - Child block atom IDs.
 * @param {string} childAttachmentAtomId - Child-side attachment atom.
 * @param {{x: number, y: number}} parentAttachmentPosition - Parent-side attachment position.
 * @param {number} targetAngle - Desired stitched bond angle in radians.
 * @param {number} bondLength - Target bond length.
 * @param {Map<string, {x: number, y: number}>} placedCoords - Coordinates already committed in the parent frame.
 * @returns {{coords: Map<string, {x: number, y: number}>, angle: number}} Refined stitched coordinates and chosen angle.
 */
export function refineStitchedBlock(
  childCoords,
  childAtomIds,
  childAttachmentAtomId,
  parentAttachmentPosition,
  targetAngle,
  bondLength,
  placedCoords
) {
  let bestAngle = targetAngle;
  let bestCoords = stitchChildBlock(
    childCoords,
    childAtomIds,
    childAttachmentAtomId,
    parentAttachmentPosition,
    targetAngle,
    bondLength
  );
  let bestScore = scoreStitchedChild(bestCoords, childAtomIds, placedCoords, targetAngle, targetAngle, bondLength);

  for (const offset of STITCH_REFINEMENT_OFFSETS) {
    if (offset === 0) {
      continue;
    }
    const testedAngle = targetAngle + offset;
    const testedCoords = stitchChildBlock(
      childCoords,
      childAtomIds,
      childAttachmentAtomId,
      parentAttachmentPosition,
      testedAngle,
      bondLength
    );
    const testedScore = scoreStitchedChild(testedCoords, childAtomIds, placedCoords, targetAngle, testedAngle, bondLength);
    if (testedScore < bestScore) {
      bestScore = testedScore;
      bestAngle = testedAngle;
      bestCoords = testedCoords;
    }
  }

  return {
    coords: bestCoords,
    angle: bestAngle
  };
}

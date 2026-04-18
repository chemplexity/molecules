/** @module cleanup/rigid-rotation */

import { add, rotate, sub } from '../geometry/vec2.js';
import { containsFrozenAtom } from './frozen-atoms.js';

/**
 * Builds a stable dedupe key for a rigid-subtree rotation descriptor.
 * @param {{anchorAtomId: string, rootAtomId: string, subtreeAtomIds: string[]}} descriptor - Rigid descriptor.
 * @returns {string} Stable descriptor key.
 */
export function rigidDescriptorKey(descriptor) {
  return `${descriptor.anchorAtomId}|${descriptor.rootAtomId}|${descriptor.subtreeAtomIds.join(',')}`;
}

/**
 * Builds sparse override positions for a rigid subtree rotated around its anchor.
 * @param {Map<string, {x: number, y: number}>} coords - Current coordinate map.
 * @param {{anchorAtomId: string, rootAtomId: string, subtreeAtomIds: string[]}} descriptor - Rigid descriptor.
 * @param {number} rotation - Rotation angle in radians.
 * @returns {Map<string, {x: number, y: number}>|null} Sparse override positions, or `null` when the anchor is missing.
 */
export function rotateRigidDescriptorPositions(coords, descriptor, rotation) {
  const anchorPosition = coords.get(descriptor.anchorAtomId);
  if (!anchorPosition) {
    return null;
  }
  const overridePositions = new Map();
  for (const atomId of descriptor.subtreeAtomIds) {
    const currentPosition = coords.get(atomId);
    if (!currentPosition) {
      continue;
    }
    overridePositions.set(atomId, add(anchorPosition, rotate(sub(currentPosition, anchorPosition), rotation)));
  }
  return overridePositions;
}

/**
 * Iterates caller-supplied rigid-rotation candidates for one descriptor.
 * @param {object|null} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Current coordinate map.
 * @param {{anchorAtomId: string, rootAtomId: string, subtreeAtomIds: string[]}|null} descriptor - Rigid descriptor.
 * @param {{angles?: number[], frozenAtomIds?: Set<string>|null, buildPositionsFn?: ((coords: Map<string, {x: number, y: number}>, descriptor: {anchorAtomId: string, rootAtomId: string, subtreeAtomIds: string[]}, angle: number, layoutGraph: object|null) => Map<string, {x: number, y: number}>|null), visitCandidate?: ((overridePositions: Map<string, {x: number, y: number}>, angle: number) => void)}} [options] - Candidate generation hooks.
 * @returns {void}
 */
export function forEachRigidRotationCandidate(layoutGraph, coords, descriptor, options = {}) {
  if (!descriptor) {
    return;
  }
  const frozenAtomIds = options.frozenAtomIds instanceof Set && options.frozenAtomIds.size > 0 ? options.frozenAtomIds : null;
  if (frozenAtomIds && containsFrozenAtom(descriptor.subtreeAtomIds, frozenAtomIds)) {
    return;
  }
  if (typeof options.visitCandidate !== 'function') {
    return;
  }

  const buildPositionsFn =
    typeof options.buildPositionsFn === 'function'
      ? options.buildPositionsFn
      : (inputCoords, inputDescriptor, angle) => rotateRigidDescriptorPositions(inputCoords, inputDescriptor, angle);

  for (const angle of options.angles ?? []) {
    const overridePositions = buildPositionsFn(coords, descriptor, angle, layoutGraph);
    if (!overridePositions) {
      continue;
    }
    options.visitCandidate(overridePositions, angle);
  }
}

/**
 * Probes a rigid descriptor across a candidate angle list and keeps the best score.
 * @param {object|null} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Current coordinate map.
 * @param {{anchorAtomId: string, rootAtomId: string, subtreeAtomIds: string[]}|null} descriptor - Rigid descriptor.
 * @param {{angles?: number[], frozenAtomIds?: Set<string>|null, buildPositionsFn?: ((coords: Map<string, {x: number, y: number}>, descriptor: {anchorAtomId: string, rootAtomId: string, subtreeAtomIds: string[]}, angle: number, layoutGraph: object|null) => Map<string, {x: number, y: number}>|null), scoreFn?: ((coords: Map<string, {x: number, y: number}>, overridePositions: Map<string, {x: number, y: number}>, angle: number, descriptor: {anchorAtomId: string, rootAtomId: string, subtreeAtomIds: string[]}, layoutGraph: object|null) => unknown), isBetterScoreFn?: ((candidateScore: unknown, incumbentScore: unknown) => boolean)}} [options] - Probe options.
 * @returns {{bestOverridePositions: Map<string, {x: number, y: number}>|null, bestScore: unknown, bestAngle: number|null, didImprove: boolean}} Best candidate summary.
 */
export function probeRigidRotation(layoutGraph, coords, descriptor, options = {}) {
  let bestOverridePositions = null;
  let bestScore = null;
  let bestAngle = null;
  const isBetterScoreFn =
    typeof options.isBetterScoreFn === 'function'
      ? options.isBetterScoreFn
      : (candidateScore, incumbentScore) => candidateScore < incumbentScore;

  forEachRigidRotationCandidate(layoutGraph, coords, descriptor, {
    ...options,
    visitCandidate(overridePositions, angle) {
      const score = options.scoreFn?.(coords, overridePositions, angle, descriptor, layoutGraph);
      if (score == null) {
        return;
      }
      if (bestScore == null || isBetterScoreFn(score, bestScore)) {
        bestOverridePositions = overridePositions;
        bestScore = score;
        bestAngle = angle;
      }
    }
  });

  return {
    bestOverridePositions,
    bestScore,
    bestAngle,
    didImprove: bestOverridePositions != null
  };
}

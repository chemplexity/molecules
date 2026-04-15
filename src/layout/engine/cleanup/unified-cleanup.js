/** @module cleanup/unified-cleanup */

import { buildAtomGrid, measureLayoutState } from '../audit/invariants.js';
import { CLEANUP_EPSILON, UNIFIED_CLEANUP_LIMITS } from '../constants.js';
import { runLocalCleanup } from './local-rotation.js';
import { collectRigidPendantRingSubtrees, mergeRigidSubtreesByAtomId, resolveOverlaps } from './overlap-resolution.js';

/**
 * Scores a one-step cleanup candidate against the current coordinates.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {object} baseState - Current measured layout state.
 * @param {Map<string, {x: number, y: number}>} candidateCoords - Candidate coordinate map.
 * @param {number} bondLength - Target bond length.
 * @returns {{coords: Map<string, {x: number, y: number}>, overlapCount: number, cost: number, improvement: number, overlapReduction: number, bondLengthFailureCount: number, candidateState: object}} Candidate score.
 */
function scoreCandidate(layoutGraph, baseState, candidateCoords, bondLength) {
  const candidateState = measureLayoutState(layoutGraph, candidateCoords, bondLength);
  return {
    coords: candidateCoords,
    overlapCount: candidateState.overlapCount,
    cost: candidateState.cost,
    improvement: baseState.cost - candidateState.cost,
    overlapReduction: baseState.overlapCount - candidateState.overlapCount,
    bondLengthFailureCount: candidateState.bondDeviation.failingBondCount,
    candidateState
  };
}

/**
 * Returns whether the candidate is better than the current best unified-cleanup move.
 * @param {object|null} bestCandidate - Best candidate so far.
 * @param {object} candidate - Candidate score.
 * @param {number} epsilon - Minimum meaningful improvement threshold.
 * @param {object} [options] - Ranking options.
 * @param {boolean} [options.protectLargeMoleculeBackbone] - Whether cleanup should preserve large-molecule bond integrity.
 * @returns {boolean} True when the candidate should replace the current best one.
 */
function isBetterCandidate(bestCandidate, candidate, epsilon, options = {}) {
  if (!bestCandidate) {
    return true;
  }
  if (options.protectLargeMoleculeBackbone && candidate.bondLengthFailureCount !== bestCandidate.bondLengthFailureCount) {
    return candidate.bondLengthFailureCount < bestCandidate.bondLengthFailureCount;
  }
  if (candidate.overlapCount !== bestCandidate.overlapCount) {
    return candidate.overlapCount < bestCandidate.overlapCount;
  }
  if (candidate.cost + epsilon < bestCandidate.cost) {
    return true;
  }
  if (Math.abs(candidate.cost - bestCandidate.cost) <= epsilon) {
    return candidate.improvement > bestCandidate.improvement + epsilon;
  }
  return false;
}

/**
 * Returns whether unified cleanup should skip the local-rotation probe for the
 * current pass because an overlap-reducing move already clearly wins on a large
 * crowded component.
 * @param {number} visibleAtomCount - Visible laid-out atom count.
 * @param {number} baseOverlapCount - Severe-overlap count before the pass.
 * @param {object|null} bestCandidate - Best overlap candidate so far.
 * @param {object} [options] - Probe-selection options.
 * @param {boolean} [options.protectLargeMoleculeBackbone] - Whether cleanup should always keep local-rotation options available for large-molecule cases.
 * @returns {boolean} True when the rotation probe can be skipped for this pass.
 */
function shouldSkipRotationProbe(visibleAtomCount, baseOverlapCount, bestCandidate, options = {}) {
  if (options.protectLargeMoleculeBackbone) {
    return false;
  }
  return visibleAtomCount >= UNIFIED_CLEANUP_LIMITS.overlapPriorityAtomCount
    && baseOverlapCount > 0
    && !!bestCandidate
    && bestCandidate.overlapReduction > 0;
}

function protectLargeMoleculeBackbone(options = {}) {
  return options.protectLargeMoleculeBackbone === true;
}

function shouldAcceptCandidate(baseState, candidate, epsilon, options = {}) {
  if (!(candidate.overlapReduction > 0 || candidate.improvement > epsilon)) {
    return false;
  }
  if (protectLargeMoleculeBackbone(options) && candidate.overlapCount > baseState.overlapCount) {
    return false;
  }
  if (
    protectLargeMoleculeBackbone(options)
    && baseState.bondDeviation.failingBondCount === 0
    && candidate.bondLengthFailureCount > 0
  ) {
    return false;
  }
  return true;
}

/**
 * Returns whether the atom should be tracked in the visible-geometry atom grid.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {string} atomId - Atom identifier.
 * @returns {boolean} True when the atom is visible and should be tracked.
 */
function shouldTrackVisibleAtom(layoutGraph, atomId) {
  return layoutGraph.atoms.get(atomId)?.visible === true;
}

/**
 * Applies moved atom positions onto the live unified-cleanup grid in place.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {import('../geometry/atom-grid.js').AtomGrid} atomGrid - Working atom grid.
 * @param {Map<string, {x: number, y: number}>} previousCoords - Coordinates before the accepted move.
 * @param {Map<string, {x: number, y: number}>} nextCoords - Coordinates after the accepted move.
 * @returns {void}
 */
function updateAtomGridForAcceptedMove(layoutGraph, atomGrid, previousCoords, nextCoords) {
  for (const [atomId, nextPosition] of nextCoords) {
    if (!shouldTrackVisibleAtom(layoutGraph, atomId)) {
      continue;
    }
    const previousPosition = previousCoords.get(atomId);
    if (previousPosition && previousPosition.x === nextPosition.x && previousPosition.y === nextPosition.y) {
      continue;
    }
    if (previousPosition) {
      atomGrid.remove(atomId, previousPosition);
    }
    atomGrid.insert(atomId, nextPosition);
  }
}

/**
 * Runs a unified cleanup loop that evaluates one-step overlap nudges and one-step
 * local rotations from the same coordinate state, then accepts the stronger move.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} inputCoords - Coordinate map.
 * @param {object} [options] - Cleanup options.
 * @param {number} [options.maxPasses] - Maximum accepted cleanup passes.
 * @param {number} [options.epsilon] - Minimum accepted improvement.
 * @param {number} [options.bondLength] - Target bond length.
 * @param {Map<string, Array<{anchorAtomId: string, rootAtomId: string, subtreeAtomIds: string[]}>>} [options.cleanupRigidSubtreesByAtomId] - Optional extra rigid-subtree descriptors keyed by atom ID.
 * @returns {{coords: Map<string, {x: number, y: number}>, passes: number, improvement: number, overlapMoves: number}} Cleanup result.
 */
export function runUnifiedCleanup(layoutGraph, inputCoords, options = {}) {
  const maxPasses = options.maxPasses ?? layoutGraph.options.maxCleanupPasses;
  const epsilon = options.epsilon ?? CLEANUP_EPSILON;
  const bondLength = options.bondLength ?? layoutGraph.options.bondLength;
  const visibleAtomCount = [...layoutGraph.atoms.values()].filter(atom => atom.visible).length;
  let pendantRigidSubtreesByAtomId = null;
  let coords = new Map([...inputCoords.entries()].map(([atomId, position]) => [atomId, { ...position }]));
  const atomGrid = buildAtomGrid(layoutGraph, coords, bondLength);
  let passes = 0;
  let totalImprovement = 0;
  let overlapMoves = 0;

  while (passes < maxPasses) {
    const baseState = measureLayoutState(layoutGraph, coords, bondLength);
    const baseOverlapCount = baseState.overlapCount;
    let bestCandidate = null;

    if (baseOverlapCount > 0) {
      pendantRigidSubtreesByAtomId ??= collectRigidPendantRingSubtrees(layoutGraph);
      const rigidSubtreesByAtomId =
        protectLargeMoleculeBackbone(options)
        && baseOverlapCount >= UNIFIED_CLEANUP_LIMITS.largeMoleculeBlockAwareOverlapFloor
          ? mergeRigidSubtreesByAtomId(pendantRigidSubtreesByAtomId, options.cleanupRigidSubtreesByAtomId)
          : pendantRigidSubtreesByAtomId;
      const overlapCandidate = resolveOverlaps(layoutGraph, coords, {
        bondLength,
        maxPasses: 1,
        rigidSubtreesByAtomId,
        visibleAtomCount,
        protectLargeMoleculeBackbone: protectLargeMoleculeBackbone(options)
      });
      if (overlapCandidate.moves > 0) {
        const scoredOverlapCandidate = {
          ...scoreCandidate(layoutGraph, baseState, overlapCandidate.coords, bondLength),
          overlapMoves: overlapCandidate.moves
        };
        if (shouldAcceptCandidate(baseState, scoredOverlapCandidate, epsilon, options)) {
          bestCandidate = scoredOverlapCandidate;
        }
      }
    }

    if (!shouldSkipRotationProbe(visibleAtomCount, baseOverlapCount, bestCandidate, options)) {
      const rotationCandidate = runLocalCleanup(layoutGraph, coords, {
        maxPasses: 1,
        epsilon,
        bondLength,
        baseAtomGrid: atomGrid
      });
      if (rotationCandidate.passes > 0) {
        const scoredRotationCandidate = {
          ...scoreCandidate(layoutGraph, baseState, rotationCandidate.coords, bondLength),
          overlapMoves: 0
        };
        if (shouldAcceptCandidate(baseState, scoredRotationCandidate, epsilon, options)) {
          if (isBetterCandidate(bestCandidate, scoredRotationCandidate, epsilon, options)) {
            bestCandidate = scoredRotationCandidate;
          }
        }
      }
    }

    if (!bestCandidate) {
      break;
    }

    updateAtomGridForAcceptedMove(layoutGraph, atomGrid, coords, bestCandidate.coords);
    coords = new Map([...bestCandidate.coords.entries()].map(([atomId, position]) => [atomId, { ...position }]));
    passes++;
    overlapMoves += bestCandidate.overlapMoves;
    totalImprovement += Math.max(bestCandidate.improvement, 0);
  }

  return {
    coords,
    passes,
    improvement: totalImprovement,
    overlapMoves
  };
}

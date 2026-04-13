/** @module cleanup/unified-cleanup */

import { buildAtomGrid, measureLayoutState } from '../audit/invariants.js';
import { CLEANUP_EPSILON } from '../constants.js';
import { runLocalCleanup } from './local-rotation.js';
import { collectRigidPendantRingSubtrees, resolveOverlaps } from './overlap-resolution.js';

const LARGE_COMPONENT_OVERLAP_PRIORITY_ATOM_COUNT = 24;

/**
 * Scores a one-step cleanup candidate against the current coordinates.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {number} baseCost - Current layout cost.
 * @param {number} baseOverlapCount - Current severe-overlap count.
 * @param {Map<string, {x: number, y: number}>} candidateCoords - Candidate coordinate map.
 * @param {number} bondLength - Target bond length.
 * @returns {{coords: Map<string, {x: number, y: number}>, overlapCount: number, cost: number, improvement: number, overlapReduction: number}} Candidate score.
 */
function scoreCandidate(layoutGraph, baseCost, baseOverlapCount, candidateCoords, bondLength) {
  const candidateState = measureLayoutState(layoutGraph, candidateCoords, bondLength);
  return {
    coords: candidateCoords,
    overlapCount: candidateState.overlapCount,
    cost: candidateState.cost,
    improvement: baseCost - candidateState.cost,
    overlapReduction: baseOverlapCount - candidateState.overlapCount
  };
}

/**
 * Returns whether the candidate is better than the current best unified-cleanup move.
 * @param {object|null} bestCandidate - Best candidate so far.
 * @param {object} candidate - Candidate score.
 * @param {number} epsilon - Minimum meaningful improvement threshold.
 * @returns {boolean} True when the candidate should replace the current best one.
 */
function isBetterCandidate(bestCandidate, candidate, epsilon) {
  if (!bestCandidate) {
    return true;
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
 * @returns {boolean} True when the rotation probe can be skipped for this pass.
 */
function shouldSkipRotationProbe(visibleAtomCount, baseOverlapCount, bestCandidate) {
  return (
    visibleAtomCount >= LARGE_COMPONENT_OVERLAP_PRIORITY_ATOM_COUNT
    && baseOverlapCount > 0
    && !!bestCandidate
    && bestCandidate.overlapReduction > 0
  );
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
    if (
      previousPosition
      && previousPosition.x === nextPosition.x
      && previousPosition.y === nextPosition.y
    ) {
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
 * @returns {{coords: Map<string, {x: number, y: number}>, passes: number, improvement: number, overlapMoves: number}} Cleanup result.
 */
export function runUnifiedCleanup(layoutGraph, inputCoords, options = {}) {
  const maxPasses = options.maxPasses ?? layoutGraph.options.maxCleanupPasses;
  const epsilon = options.epsilon ?? CLEANUP_EPSILON;
  const bondLength = options.bondLength ?? layoutGraph.options.bondLength;
  const visibleAtomCount = [...layoutGraph.atoms.values()].filter(atom => atom.visible).length;
  let rigidSubtreesByAtomId = null;
  let coords = new Map([...inputCoords.entries()].map(([atomId, position]) => [atomId, { ...position }]));
  const atomGrid = buildAtomGrid(layoutGraph, coords, bondLength);
  let passes = 0;
  let totalImprovement = 0;
  let overlapMoves = 0;

  while (passes < maxPasses) {
    const baseState = measureLayoutState(layoutGraph, coords, bondLength);
    const baseOverlapCount = baseState.overlapCount;
    const baseCost = baseState.cost;
    let bestCandidate = null;

    if (baseOverlapCount > 0) {
      rigidSubtreesByAtomId ??= collectRigidPendantRingSubtrees(layoutGraph);
      const overlapCandidate = resolveOverlaps(layoutGraph, coords, {
        bondLength,
        maxPasses: 1,
        rigidSubtreesByAtomId,
        visibleAtomCount
      });
      if (overlapCandidate.moves > 0) {
        const scoredOverlapCandidate = {
          ...scoreCandidate(layoutGraph, baseCost, baseOverlapCount, overlapCandidate.coords, bondLength),
          overlapMoves: overlapCandidate.moves
        };
        if (
          scoredOverlapCandidate.overlapReduction > 0
          || scoredOverlapCandidate.improvement > epsilon
        ) {
          bestCandidate = scoredOverlapCandidate;
        }
      }
    }

    if (!shouldSkipRotationProbe(visibleAtomCount, baseOverlapCount, bestCandidate)) {
      const rotationCandidate = runLocalCleanup(layoutGraph, coords, {
        maxPasses: 1,
        epsilon,
        bondLength,
        baseAtomGrid: atomGrid
      });
      if (rotationCandidate.passes > 0) {
        const scoredRotationCandidate = {
          ...scoreCandidate(layoutGraph, baseCost, baseOverlapCount, rotationCandidate.coords, bondLength),
          overlapMoves: 0
        };
        if (
          scoredRotationCandidate.overlapReduction > 0
          || scoredRotationCandidate.improvement > epsilon
        ) {
          if (isBetterCandidate(bestCandidate, scoredRotationCandidate, epsilon)) {
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

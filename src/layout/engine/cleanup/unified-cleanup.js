/** @module cleanup/unified-cleanup */

import { buildAtomGrid, measureLayoutState, measureOverlapState } from '../audit/invariants.js';
import { CLEANUP_EPSILON, UNIFIED_CLEANUP_LIMITS } from '../constants.js';
import { computeRotatableSubtrees, runLocalCleanup } from './local-rotation.js';
import { collectRigidPendantRingSubtrees, mergeRigidSubtreesByAtomId, resolveOverlaps } from './overlap-resolution.js';

/**
 * Builds the reduced overlap-focused cleanup state from a full measured state.
 * @param {object} measuredState - Full measured layout state.
 * @returns {{overlaps: Array<{firstAtomId: string, secondAtomId: string, distance: number}>, overlapCount: number, overlapPenalty: number, bondDeviation: {sampleCount: number, maxDeviation: number, meanDeviation: number, failingBondCount: number}, cost: number}} Reduced overlap-focused state.
 */
function overlapStateFromMeasuredState(measuredState) {
  const bondPenalty = measuredState.bondDeviation.meanDeviation * 10 + measuredState.bondDeviation.maxDeviation * 5;
  return {
    overlaps: measuredState.overlaps,
    overlapCount: measuredState.overlapCount,
    overlapPenalty: measuredState.overlapPenalty,
    bondDeviation: measuredState.bondDeviation,
    cost: measuredState.overlapPenalty + bondPenalty
  };
}

/**
 * Prescores a one-step cleanup candidate against the current coordinates using
 * only overlap and bond-length metrics.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {object} baseState - Current measured layout state.
 * @param {Map<string, {x: number, y: number}>} candidateCoords - Candidate coordinate map.
 * @param {number} bondLength - Target bond length.
 * @param {object} [options] - Prescore options.
 * @param {import('../geometry/atom-grid.js').AtomGrid|null} [options.atomGrid] - Optional reused spatial grid for overlap lookup.
 * @returns {{coords: Map<string, {x: number, y: number}>, overlapCount: number, cost: number, improvement: number, overlapReduction: number, bondLengthFailureCount: number, candidateState: object}} Candidate score.
 */
function prescoreCandidate(layoutGraph, baseState, candidateCoords, bondLength, options = {}) {
  const candidateState = measureOverlapState(layoutGraph, candidateCoords, bondLength, {
    atomGrid: options.atomGrid
  });
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
 * Scores a one-step cleanup candidate against the current coordinates using the
 * full cleanup state after prescoring selected it as the provisional winner.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {object} baseState - Current measured full layout state.
 * @param {Map<string, {x: number, y: number}>} candidateCoords - Candidate coordinate map.
 * @param {number} bondLength - Target bond length.
 * @param {object} [options] - Full-score options.
 * @param {Array<{firstAtomId: string, secondAtomId: string, distance: number}>} [options.overlaps] - Optional precomputed severe overlaps.
 * @returns {{coords: Map<string, {x: number, y: number}>, overlapCount: number, cost: number, improvement: number, overlapReduction: number, bondLengthFailureCount: number, candidateState: object}} Candidate score.
 */
function scoreCandidate(layoutGraph, baseState, candidateCoords, bondLength, options = {}) {
  const candidateState = measureLayoutState(layoutGraph, candidateCoords, bondLength, {
    overlaps: options.overlaps
  });
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

function protectLargeMoleculeBackbone(options = {}) {
  return options.protectLargeMoleculeBackbone === true;
}

function protectCleanupBondIntegrity(options = {}) {
  return protectLargeMoleculeBackbone(options) || options.protectBondIntegrity === true;
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
  if (protectCleanupBondIntegrity(options) && candidate.bondLengthFailureCount !== bestCandidate.bondLengthFailureCount) {
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
  if (protectCleanupBondIntegrity(options)) {
    return false;
  }
  return visibleAtomCount >= UNIFIED_CLEANUP_LIMITS.overlapPriorityAtomCount
    && baseOverlapCount > 0
    && !!bestCandidate
    && bestCandidate.overlapReduction > 0;
}

function shouldAcceptCandidate(baseState, candidate, epsilon, options = {}) {
  if (!(candidate.overlapReduction > 0 || candidate.improvement > epsilon)) {
    return false;
  }
  if (protectLargeMoleculeBackbone(options) && candidate.overlapCount > baseState.overlapCount) {
    return false;
  }
  if (
    protectCleanupBondIntegrity(options)
    && candidate.bondLengthFailureCount > baseState.bondDeviation.failingBondCount
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
 * @param {Set<string>|null} [options.frozenAtomIds] - Atom ids that cleanup must not move.
 * @param {boolean} [options.protectBondIntegrity] - Whether cleanup should refuse moves that increase bond failures for the current family.
 * @returns {{coords: Map<string, {x: number, y: number}>, passes: number, improvement: number, overlapMoves: number}} Cleanup result.
 */
export function runUnifiedCleanup(layoutGraph, inputCoords, options = {}) {
  const maxPasses = options.maxPasses ?? layoutGraph.options.maxCleanupPasses;
  const epsilon = options.epsilon ?? CLEANUP_EPSILON;
  const bondLength = options.bondLength ?? layoutGraph.options.bondLength;
  const frozenAtomIds = options.frozenAtomIds instanceof Set && options.frozenAtomIds.size > 0 ? options.frozenAtomIds : null;
  const visibleAtomCount = [...layoutGraph.atoms.values()].filter(atom => atom.visible).length;
  let pendantRigidSubtreesByAtomId = null;
  let coords = new Map([...inputCoords.entries()].map(([atomId, position]) => [atomId, { ...position }]));
  const { terminalSubtrees, geminalPairs } = computeRotatableSubtrees(layoutGraph, coords);
  const atomGrid = buildAtomGrid(layoutGraph, coords, bondLength);
  let passes = 0;
  let totalImprovement = 0;
  let overlapMoves = 0;

  while (passes < maxPasses) {
    const baseState = measureLayoutState(layoutGraph, coords, bondLength);
    const baseOverlapState = overlapStateFromMeasuredState(baseState);
    const baseOverlapCount = baseState.overlapCount;
    let bestPrescoredCandidate = null;

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
        protectLargeMoleculeBackbone: protectLargeMoleculeBackbone(options),
        frozenAtomIds
      });
      if (overlapCandidate.moves > 0) {
        const prescoredOverlapCandidate = {
          ...prescoreCandidate(layoutGraph, baseOverlapState, overlapCandidate.coords, bondLength),
          overlapMoves: overlapCandidate.moves
        };
        bestPrescoredCandidate = prescoredOverlapCandidate;
      }
    }

    if (!shouldSkipRotationProbe(visibleAtomCount, baseOverlapCount, bestPrescoredCandidate, options)) {
      const rotationCandidate = runLocalCleanup(layoutGraph, coords, {
        maxPasses: 1,
        epsilon,
        bondLength,
        baseAtomGrid: atomGrid,
        baseTerminalSubtrees: terminalSubtrees,
        baseGeminalPairs: geminalPairs,
        frozenAtomIds
      });
      if (rotationCandidate.passes > 0) {
        const prescoredRotationCandidate = {
          ...prescoreCandidate(layoutGraph, baseOverlapState, rotationCandidate.coords, bondLength),
          overlapMoves: 0
        };
        if (isBetterCandidate(bestPrescoredCandidate, prescoredRotationCandidate, epsilon, options)) {
          bestPrescoredCandidate = prescoredRotationCandidate;
        }
      }
    }

    if (!bestPrescoredCandidate) {
      break;
    }

    const bestCandidate = {
      ...scoreCandidate(layoutGraph, baseState, bestPrescoredCandidate.coords, bondLength, {
        overlaps: bestPrescoredCandidate.candidateState.overlaps
      }),
      overlapMoves: bestPrescoredCandidate.overlapMoves
    };
    if (!shouldAcceptCandidate(baseState, bestCandidate, epsilon, options)) {
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

/** @module cleanup/unified-cleanup */

import { buildAtomGrid, measureLayoutState, measureOverlapState } from '../audit/invariants.js';
import { CLEANUP_EPSILON, UNIFIED_CLEANUP_LIMITS } from '../constants.js';
import { computeRotatableSubtrees, runLocalCleanup } from './local-rotation.js';
import { collectRigidPendantRingSubtrees, mergeRigidSubtreesByAtomId, resolveOverlaps } from './overlap-resolution.js';
import { measureOrthogonalHypervalentDeviation } from './hypervalent-angle-tidy.js';

const PROTECTED_BACKBONE_MAX_BOND_DEVIATION = 0.05;
const NONIMPROVING_TRIGONAL_WORSENING_LIMIT = 0.05;

/**
 * Prescores a one-step cleanup candidate against the current coordinates using
 * only overlap and bond-length metrics.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {object} baseState - Current measured overlap-focused state.
 * @param {Map<string, {x: number, y: number}>} candidateCoords - Candidate coordinate map.
 * @param {number} bondLength - Target bond length.
 * @param {object} [options] - Prescore options.
 * @param {import('../geometry/atom-grid.js').AtomGrid|null} [options.atomGrid] - Optional reused spatial grid for overlap lookup.
 * @param {number} [options.presentationImprovement] - Optional local presentation improvement for audit-tied candidates.
 * @returns {{coords: Map<string, {x: number, y: number}>, overlapCount: number, cost: number, improvement: number, overlapReduction: number, bondLengthFailureCount: number, presentationImprovement: number, candidateState: object}} Candidate score.
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
    hypervalentDeviation: measureOrthogonalHypervalentDeviation(layoutGraph, candidateCoords),
    presentationImprovement: options.presentationImprovement ?? 0,
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
 * @returns {{coords: Map<string, {x: number, y: number}>, overlapCount: number, cost: number, improvement: number, overlapReduction: number, bondLengthFailureCount: number, presentationImprovement: number, candidateState: object}} Candidate score.
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
    hypervalentDeviation: measureOrthogonalHypervalentDeviation(layoutGraph, candidateCoords),
    presentationImprovement: options.presentationImprovement ?? 0,
    candidateState
  };
}

function protectLargeMoleculeBackbone(options = {}) {
  return options.protectLargeMoleculeBackbone === true;
}

function protectCleanupBondIntegrity(options = {}) {
  return protectLargeMoleculeBackbone(options) || options.protectBondIntegrity === true;
}

function candidateMaxBondDeviation(candidate) {
  return candidate?.candidateState?.bondDeviation?.maxDeviation ?? Number.POSITIVE_INFINITY;
}

function trigonalDistortionWorsening(baseState, candidate) {
  return (
    candidate?.candidateState?.trigonalDistortion?.totalDeviation ?? 0
  ) - (
    baseState?.trigonalDistortion?.totalDeviation ?? 0
  );
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
  if (protectLargeMoleculeBackbone(options)) {
    const candidateWithinDeviationGuard = candidateMaxBondDeviation(candidate) <= PROTECTED_BACKBONE_MAX_BOND_DEVIATION + epsilon;
    const bestWithinDeviationGuard = candidateMaxBondDeviation(bestCandidate) <= PROTECTED_BACKBONE_MAX_BOND_DEVIATION + epsilon;
    if (candidateWithinDeviationGuard !== bestWithinDeviationGuard) {
      return candidateWithinDeviationGuard;
    }
  }
  if (protectCleanupBondIntegrity(options) && candidate.bondLengthFailureCount !== bestCandidate.bondLengthFailureCount) {
    return candidate.bondLengthFailureCount < bestCandidate.bondLengthFailureCount;
  }
  if (
    candidate.bondLengthFailureCount !== bestCandidate.bondLengthFailureCount
    && Math.abs(candidate.overlapCount - bestCandidate.overlapCount) <= 1
  ) {
    return candidate.bondLengthFailureCount < bestCandidate.bondLengthFailureCount;
  }
  if (candidate.overlapCount !== bestCandidate.overlapCount) {
    return candidate.overlapCount < bestCandidate.overlapCount;
  }
  if (Math.abs((candidate.hypervalentDeviation ?? 0) - (bestCandidate.hypervalentDeviation ?? 0)) > epsilon) {
    return (candidate.hypervalentDeviation ?? 0) < (bestCandidate.hypervalentDeviation ?? 0);
  }
  if (candidate.cost + epsilon < bestCandidate.cost) {
    return true;
  }
  if (Math.abs(candidate.cost - bestCandidate.cost) <= epsilon) {
    if (candidate.improvement > bestCandidate.improvement + epsilon) {
      return true;
    }
    if (Math.abs(candidate.improvement - bestCandidate.improvement) <= epsilon) {
      return (candidate.presentationImprovement ?? 0) > (bestCandidate.presentationImprovement ?? 0) + epsilon;
    }
  }
  return false;
}

/**
 * Returns whether unified cleanup should skip the local-rotation probe for the
 * current pass because an overlap-reducing move already clearly wins on a large
 * crowded component.
 * @param {number} visibleHeavyAtomCount - Visible laid-out heavy-atom count.
 * @param {number} baseOverlapCount - Severe-overlap count before the pass.
 * @param {object|null} bestCandidate - Best overlap candidate so far.
 * @param {object} [options] - Probe-selection options.
 * @param {boolean} [options.protectLargeMoleculeBackbone] - Whether cleanup should always keep local-rotation options available for large-molecule cases.
 * @returns {boolean} True when the rotation probe can be skipped for this pass.
 */
function shouldSkipRotationProbe(visibleHeavyAtomCount, baseOverlapCount, bestCandidate, options = {}) {
  if (protectCleanupBondIntegrity(options)) {
    return false;
  }
  return visibleHeavyAtomCount >= UNIFIED_CLEANUP_LIMITS.overlapPriorityAtomCount
    && baseOverlapCount > 0
    && !!bestCandidate
    && bestCandidate.bondLengthFailureCount === 0
    && bestCandidate.overlapReduction > 0;
}

function shouldAcceptCandidate(baseState, candidate, epsilon, options = {}) {
  if (!(
    candidate.overlapReduction > 0
    || candidate.improvement > epsilon
    || (
      candidate.presentationImprovement > epsilon
      && candidate.overlapCount <= baseState.overlapCount
      && candidate.bondLengthFailureCount <= baseState.bondDeviation.failingBondCount
    )
  )) {
    return false;
  }
  if (protectLargeMoleculeBackbone(options) && candidate.overlapCount > baseState.overlapCount) {
    return false;
  }
  if (
    protectLargeMoleculeBackbone(options)
    && candidateMaxBondDeviation(candidate) > Math.max(PROTECTED_BACKBONE_MAX_BOND_DEVIATION, (baseState.bondDeviation?.maxDeviation ?? 0) + epsilon)
  ) {
    return false;
  }
  if (
    protectCleanupBondIntegrity(options)
    && candidate.bondLengthFailureCount > baseState.bondDeviation.failingBondCount
  ) {
    return false;
  }
  if (
    candidate.overlapReduction > 0
    && candidate.improvement <= epsilon
    && trigonalDistortionWorsening(baseState, candidate) > NONIMPROVING_TRIGONAL_WORSENING_LIMIT
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
 * Runs a unified cleanup loop that evaluates one-step overlap nudges and bounded
 * local-rotation probes from the same coordinate state, then accepts the
 * stronger move.
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
  let visibleAtomCount = 0;
  let visibleHeavyAtomCount = 0;
  for (const atom of layoutGraph.atoms.values()) {
    if (!atom.visible) {
      continue;
    }
    visibleAtomCount++;
    if (atom.element !== 'H') {
      visibleHeavyAtomCount++;
    }
  }
  let pendantRigidSubtreesByAtomId = null;
  let coords = new Map();
  for (const [atomId, position] of inputCoords) { coords.set(atomId, { x: position.x, y: position.y }); }
  const { terminalSubtrees, siblingSwaps, geminalPairs } = computeRotatableSubtrees(layoutGraph, coords);
  const atomGrid = buildAtomGrid(layoutGraph, coords, bondLength);
  let passes = 0;
  let totalImprovement = 0;
  let overlapMoves = 0;
  let baseLayoutState = null;

  while (passes < maxPasses) {
    const baseOverlapState = baseLayoutState ?? measureOverlapState(layoutGraph, coords, bondLength, {
      atomGrid
    });
    const baseOverlapCount = baseOverlapState.overlapCount;
    let bestPrescoredCandidate = null;

    if (baseOverlapCount > 0) {
      pendantRigidSubtreesByAtomId ??= collectRigidPendantRingSubtrees(layoutGraph);
      const rigidSubtreeDescriptorMaps = [pendantRigidSubtreesByAtomId];
      if (
        protectLargeMoleculeBackbone(options)
        && baseOverlapCount >= UNIFIED_CLEANUP_LIMITS.largeMoleculeBlockAwareOverlapFloor
        && options.cleanupRigidSubtreesByAtomId instanceof Map
        && options.cleanupRigidSubtreesByAtomId.size > 0
      ) {
        rigidSubtreeDescriptorMaps.push(
          mergeRigidSubtreesByAtomId(pendantRigidSubtreesByAtomId, options.cleanupRigidSubtreesByAtomId)
        );
      }

      for (const rigidSubtreesByAtomId of rigidSubtreeDescriptorMaps) {
        const overlapCandidate = resolveOverlaps(layoutGraph, coords, {
          bondLength,
          maxPasses: 1,
          rigidSubtreesByAtomId,
          visibleAtomCount,
          protectLargeMoleculeBackbone: protectLargeMoleculeBackbone(options),
          frozenAtomIds,
          baseAtomGrid: atomGrid
        });
        if (overlapCandidate.moves <= 0) {
          continue;
        }
        const prescoredOverlapCandidate = {
          ...prescoreCandidate(layoutGraph, baseOverlapState, overlapCandidate.coords, bondLength, {
            presentationImprovement: 0
          }),
          overlapMoves: overlapCandidate.moves
        };
        if (isBetterCandidate(bestPrescoredCandidate, prescoredOverlapCandidate, epsilon, options)) {
          bestPrescoredCandidate = prescoredOverlapCandidate;
        }
      }
    }

    if (!shouldSkipRotationProbe(visibleHeavyAtomCount, baseOverlapCount, bestPrescoredCandidate, options)) {
      const rotationProbeMaxPasses =
        visibleHeavyAtomCount <= UNIFIED_CLEANUP_LIMITS.moderateLayoutRotationProbeAtomCount
        && baseOverlapCount <= UNIFIED_CLEANUP_LIMITS.smallLayoutRotationProbeOverlapCount
          ? UNIFIED_CLEANUP_LIMITS.smallLayoutRotationProbeMaxPasses
          : 1;
      const rotationCandidate = runLocalCleanup(layoutGraph, coords, {
        maxPasses: rotationProbeMaxPasses,
        epsilon,
        bondLength,
        baseAtomGrid: atomGrid,
        baseTerminalSubtrees: terminalSubtrees,
        baseSiblingSwaps: siblingSwaps,
        baseGeminalPairs: geminalPairs,
        overlapPairs: baseOverlapState.overlaps,
        frozenAtomIds
      });
      if (rotationCandidate.passes > 0) {
        const prescoredRotationCandidate = {
          ...prescoreCandidate(layoutGraph, baseOverlapState, rotationCandidate.coords, bondLength, {
            presentationImprovement: rotationCandidate.improvement
          }),
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

    const baseState = baseLayoutState ?? measureLayoutState(layoutGraph, coords, bondLength, {
      overlaps: baseOverlapState.overlaps
    });
    const bestCandidate = {
      ...scoreCandidate(layoutGraph, baseState, bestPrescoredCandidate.coords, bondLength, {
        overlaps: bestPrescoredCandidate.candidateState.overlaps,
        presentationImprovement: bestPrescoredCandidate.presentationImprovement
      }),
      overlapMoves: bestPrescoredCandidate.overlapMoves
    };
    if (!shouldAcceptCandidate(baseState, bestCandidate, epsilon, options)) {
      break;
    }

    updateAtomGridForAcceptedMove(layoutGraph, atomGrid, coords, bestCandidate.coords);
    coords = new Map();
    for (const [atomId, position] of bestCandidate.coords) { coords.set(atomId, { x: position.x, y: position.y }); }
    passes++;
    overlapMoves += bestCandidate.overlapMoves;
    totalImprovement += Math.max(bestCandidate.improvement, 0);
    baseLayoutState = bestCandidate.candidateState;
  }

  return {
    coords,
    passes,
    improvement: totalImprovement,
    overlapMoves
  };
}

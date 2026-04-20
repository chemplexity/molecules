/** @module cleanup/attached-ring-rotation-tidy */

import { buildAtomGrid, findSevereOverlaps, measureDirectAttachedRingJunctionContinuationDistortion, measureLayoutCost } from '../audit/invariants.js';
import { measureCleanupStagePresentationPenalty, measureTotalSmallRingExteriorGapPenalty } from '../audit/stage-metrics.js';
import { computeRotatableSubtrees, runLocalCleanup } from './local-rotation.js';
import { runRingSubstituentTidy } from './ring-substituent-tidy.js';
import { containsFrozenAtom } from './frozen-atoms.js';
import { probeRigidRotation, rigidDescriptorKey } from './rigid-rotation.js';
import { collectCutSubtree } from './subtree-utils.js';

const ATTACHED_RING_ROTATION_TIDY_ANGLES = [
  Math.PI / 6,
  -Math.PI / 6,
  Math.PI / 3,
  -Math.PI / 3,
  (2 * Math.PI) / 3,
  -(2 * Math.PI) / 3,
  Math.PI
];

function expandFocusAtomIds(layoutGraph, atomIds, depth = 1) {
  const expandedAtomIds = new Set(atomIds);
  let frontierAtomIds = new Set(atomIds);

  for (let level = 0; level < depth; level++) {
    const nextFrontierAtomIds = new Set();
    for (const atomId of frontierAtomIds) {
      for (const bond of layoutGraph.bondsByAtomId.get(atomId) ?? []) {
        if (!bond || bond.kind !== 'covalent') {
          continue;
        }
        const neighborAtomId = bond.a === atomId ? bond.b : bond.a;
        if (expandedAtomIds.has(neighborAtomId)) {
          continue;
        }
        expandedAtomIds.add(neighborAtomId);
        nextFrontierAtomIds.add(neighborAtomId);
      }
    }
    frontierAtomIds = nextFrontierAtomIds;
    if (frontierAtomIds.size === 0) {
      break;
    }
  }

  return expandedAtomIds;
}

function coordsWithOverrides(inputCoords, overridePositions) {
  const coords = new Map();
  for (const [atomId, position] of inputCoords) {
    const nextPosition = overridePositions.get(atomId) ?? position;
    coords.set(atomId, { x: nextPosition.x, y: nextPosition.y });
  }
  return coords;
}

/**
 * Collects rigid attached-ring subtrees that can be rotated as cleanup candidates.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Current placed coordinates.
 * @param {Set<string>|null} [frozenAtomIds] - Optional atoms that must not move.
 * @returns {Array<{anchorAtomId: string, rootAtomId: string, subtreeAtomIds: string[]}>} Unique movable descriptors.
 */
export function collectMovableAttachedRingDescriptors(layoutGraph, coords, frozenAtomIds = null) {
  const uniqueDescriptors = new Map();
  const ringAtomIds = new Set();
  for (const ring of layoutGraph.rings ?? []) {
    for (const atomId of ring.atomIds) {
      ringAtomIds.add(atomId);
    }
  }

  for (const bond of layoutGraph.bonds?.values?.() ?? []) {
    if (!bond || bond.kind !== 'covalent' || bond.inRing || (bond.order ?? 1) !== 1) {
      continue;
    }
    // Skip bonds involving hydrogen — rotating a H-rooted subtree is meaningless and
    // H-anchored bonds with large subtrees inflate the descriptor count dramatically.
    if (layoutGraph.atoms.get(bond.a)?.element === 'H' || layoutGraph.atoms.get(bond.b)?.element === 'H') {
      continue;
    }

    for (const [anchorAtomId, rootAtomId] of [
      [bond.a, bond.b],
      [bond.b, bond.a]
    ]) {
      const subtreeAtomIds = [...collectCutSubtree(layoutGraph, rootAtomId, anchorAtomId)].filter(atomId => coords.has(atomId));
      if (subtreeAtomIds.length === 0 || subtreeAtomIds.length >= coords.size) {
        continue;
      }
      const heavyAtomCount = subtreeAtomIds.reduce(
        (count, atomId) => count + (layoutGraph.atoms.get(atomId)?.element === 'H' ? 0 : 1),
        0
      );
      if (
        heavyAtomCount === 0
        || heavyAtomCount > 18
        || !subtreeAtomIds.some(atomId => ringAtomIds.has(atomId))
        || subtreeAtomIds.some(atomId => layoutGraph.fixedCoords.has(atomId))
        || (frozenAtomIds && containsFrozenAtom(subtreeAtomIds, frozenAtomIds))
      ) {
        continue;
      }

      const descriptor = {
        anchorAtomId,
        rootAtomId,
        subtreeAtomIds
      };
      uniqueDescriptors.set(rigidDescriptorKey(descriptor), descriptor);
    }
  }
  return [...uniqueDescriptors.values()];
}

/**
 * Tries rigid attached-ring rotations plus local follow-up cleanup to improve presentation.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} inputCoords - Starting coordinates.
 * @param {{bondLength?: number, frozenAtomIds?: Set<string>|null}} [options] - Touchup options.
 * @returns {{coords: Map<string, {x: number, y: number}>, nudges: number}} Best accepted touchup result.
 */
export function runAttachedRingRotationTouchup(layoutGraph, inputCoords, options = {}) {
  const bondLength = options.bondLength ?? layoutGraph.options.bondLength;
  const frozenAtomIds = options.frozenAtomIds instanceof Set && options.frozenAtomIds.size > 0 ? options.frozenAtomIds : null;
  if ((layoutGraph.traits.heavyAtomCount ?? 0) > 60) {
    return { coords: inputCoords, nudges: 0 };
  }

  const descriptors = collectMovableAttachedRingDescriptors(layoutGraph, inputCoords, frozenAtomIds);
  if (descriptors.length === 0) {
    return { coords: inputCoords, nudges: 0 };
  }

  // Pre-compute once — subtree topology depends only on connectivity and placed-atom
  // membership, not on positions, so the same descriptors apply across all angle candidates.
  const { terminalSubtrees, siblingSwaps, geminalPairs } = computeRotatableSubtrees(layoutGraph, inputCoords);

  // Pre-build once — reused for the baseline overlap check and passed through to
  // findSevereOverlaps so it does not rebuild the spatial index for inputCoords.
  const baseAtomGrid = buildAtomGrid(layoutGraph, inputCoords, bondLength);
  const baseOverlapCount = findSevereOverlaps(layoutGraph, inputCoords, bondLength, { atomGrid: baseAtomGrid }).length;
  let bestCandidate = null;

  for (const descriptor of descriptors) {
    const focusAtomIds = expandFocusAtomIds(
      layoutGraph,
      new Set([descriptor.anchorAtomId, descriptor.rootAtomId, ...descriptor.subtreeAtomIds])
    );
    const basePresentationPenalty = measureCleanupStagePresentationPenalty(layoutGraph, inputCoords, {
      focusAtomIds,
      includeSmallRingExteriorPenalty: false
    });
    const baseJunctionContinuationPenalty = measureDirectAttachedRingJunctionContinuationDistortion(layoutGraph, inputCoords, { focusAtomIds }).totalDeviation;
    const baseSmallRingExteriorPenalty = measureTotalSmallRingExteriorGapPenalty(layoutGraph, inputCoords, focusAtomIds);
    const rigidRotationProbe = probeRigidRotation(layoutGraph, inputCoords, descriptor, {
      angles: ATTACHED_RING_ROTATION_TIDY_ANGLES.filter(rotation => Math.abs(rotation) > 1e-9),
      frozenAtomIds,
      scoreFn(coords, overridePositions) {
        const ringSubstituentTouchup = runRingSubstituentTidy(layoutGraph, coords, {
          bondLength,
          frozenAtomIds,
          focusAtomIds,
          overridePositions
        });
        const localLeafTouchup = runLocalCleanup(layoutGraph, ringSubstituentTouchup.coords, {
          maxPasses: 2,
          epsilon: bondLength * 0.001,
          bondLength,
          frozenAtomIds,
          focusAtomIds,
          baseTerminalSubtrees: terminalSubtrees,
          baseSiblingSwaps: siblingSwaps,
          baseGeminalPairs: geminalPairs
        });
        const candidateCoords = localLeafTouchup.coords;
        const overlapCount = findSevereOverlaps(layoutGraph, candidateCoords, bondLength).length;
        if (overlapCount > baseOverlapCount) {
          return null;
        }
        const junctionContinuationPenalty = measureDirectAttachedRingJunctionContinuationDistortion(layoutGraph, candidateCoords, { focusAtomIds }).totalDeviation;
        if (junctionContinuationPenalty > baseJunctionContinuationPenalty + 1e-6) {
          return null;
        }
        const smallRingExteriorPenalty = measureTotalSmallRingExteriorGapPenalty(layoutGraph, candidateCoords, focusAtomIds);
        if (smallRingExteriorPenalty > baseSmallRingExteriorPenalty + 1e-6) {
          return null;
        }
        const presentationPenalty = measureCleanupStagePresentationPenalty(layoutGraph, candidateCoords, {
          focusAtomIds,
          includeSmallRingExteriorPenalty: false
        });
        if (presentationPenalty >= basePresentationPenalty - 1e-6) {
          return null;
        }
        return {
          coords: candidateCoords,
          nudges: ringSubstituentTouchup.nudges + localLeafTouchup.passes + 1,
          overlapCount,
          junctionContinuationPenalty,
          presentationImprovement: basePresentationPenalty - presentationPenalty,
          layoutCost: measureLayoutCost(layoutGraph, candidateCoords, bondLength)
        };
      },
      isBetterScoreFn(candidate, incumbent) {
        return (
          overlapCountWins(candidate, incumbent)
          || presentationWins(candidate, incumbent)
          || layoutCostWins(candidate, incumbent)
        );
      }
    });
    if (rigidRotationProbe.bestScore && isBetterAttachedRingCandidate(rigidRotationProbe.bestScore, bestCandidate)) {
      bestCandidate = rigidRotationProbe.bestScore;
    }
  }

  return bestCandidate
    ? {
        coords: bestCandidate.coords,
        nudges: bestCandidate.nudges
      }
    : { coords: inputCoords, nudges: 0 };
}

function overlapCountWins(candidate, incumbent) {
  return !!incumbent && candidate.overlapCount < incumbent.overlapCount;
}

function presentationWins(candidate, incumbent) {
  return !!incumbent
    && candidate.overlapCount === incumbent.overlapCount
    && candidate.presentationImprovement > incumbent.presentationImprovement + 1e-6;
}

function layoutCostWins(candidate, incumbent) {
  return !!incumbent
    && candidate.overlapCount === incumbent.overlapCount
    && Math.abs(candidate.presentationImprovement - incumbent.presentationImprovement) <= 1e-6
    && candidate.layoutCost < incumbent.layoutCost - 1e-6;
}

function isBetterAttachedRingCandidate(candidate, incumbent) {
  if (!incumbent) {
    return true;
  }
  return overlapCountWins(candidate, incumbent)
    || presentationWins(candidate, incumbent)
    || layoutCostWins(candidate, incumbent);
}

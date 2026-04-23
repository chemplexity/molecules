/** @module cleanup/presentation/attached-ring-fallback */

import {
  buildAtomGrid,
  findSevereOverlaps,
  measureDirectAttachedRingJunctionContinuationDistortion,
  measureLayoutCost,
  measureRingSubstituentReadability,
  measureTrigonalDistortion
} from '../../audit/invariants.js';
import { add, angleOf, angularDifference, centroid, rotate, sub, wrapAngle } from '../../geometry/vec2.js';
import { isExactSimpleAcyclicContinuationEligible } from '../../placement/branch-placement/angle-selection.js';
import { measureCleanupStagePresentationPenalty, measureTotalSmallRingExteriorGapPenalty } from '../../audit/stage-metrics.js';
import { visitPresentationDescriptorCandidates } from '../candidate-search.js';
import { computeRotatableSubtrees, runLocalCleanup } from '../local-rotation.js';
import { runRingSubstituentTidy } from './ring-substituent.js';
import { measureAttachedCarbonylSubtreeClearance, supportsAttachedCarbonylPresentationPreference } from './attached-carbonyl.js';
import { containsFrozenAtom } from '../frozen-atoms.js';
import { rigidDescriptorKey, rotateRigidDescriptorPositions } from '../rigid-rotation.js';
import { collectCutSubtree } from '../subtree-utils.js';
import { runUnifiedCleanup } from '../unified-cleanup.js';
import { reflectAcrossLine } from '../../geometry/transforms.js';

const ATTACHED_RING_ROTATION_TIDY_ANGLES = [
  Math.PI / 6,
  -Math.PI / 6,
  Math.PI / 3,
  -Math.PI / 3,
  (2 * Math.PI) / 3,
  -(2 * Math.PI) / 3,
  Math.PI
];

function largestAngularGapBisector(occupiedAngles) {
  const sortedAngles = [...occupiedAngles]
    .map(wrapAngle)
    .sort((firstAngle, secondAngle) => firstAngle - secondAngle)
    .filter((angle, index, angles) => index === 0 || angularDifference(angle, angles[index - 1]) > 1e-9);
  if (sortedAngles.length === 0) {
    return null;
  }

  let bestBisector = null;
  let bestGap = -Infinity;
  for (let index = 0; index < sortedAngles.length; index++) {
    const gapStart = sortedAngles[index];
    let gapEnd = sortedAngles[(index + 1) % sortedAngles.length];
    if (index + 1 === sortedAngles.length) {
      gapEnd += Math.PI * 2;
    }
    const gap = gapEnd - gapStart;
    if (gap > bestGap + 1e-9) {
      bestGap = gap;
      bestBisector = wrapAngle(gapStart + gap / 2);
    }
  }
  return bestBisector;
}

function attachedRingRootOutwardAngles(layoutGraph, coords, rootAtomId, anchorAtomId) {
  const rootPosition = coords.get(rootAtomId);
  if (!rootPosition) {
    return [];
  }

  const outwardAngles = [];
  for (const ring of layoutGraph.atomToRings.get(rootAtomId) ?? []) {
    if (ring.atomIds.includes(anchorAtomId)) {
      continue;
    }
    const ringNeighborAngles = [];
    for (const bond of layoutGraph.bondsByAtomId.get(rootAtomId) ?? []) {
      if (!bond || bond.kind !== 'covalent') {
        continue;
      }
      const neighborAtomId = bond.a === rootAtomId ? bond.b : bond.a;
      if (neighborAtomId === anchorAtomId || !ring.atomIds.includes(neighborAtomId) || !coords.has(neighborAtomId)) {
        continue;
      }
      ringNeighborAngles.push(angleOf(sub(coords.get(neighborAtomId), rootPosition)));
    }
    if (ringNeighborAngles.length !== 2) {
      continue;
    }
    const outwardAngle = largestAngularGapBisector(ringNeighborAngles);
    if (outwardAngle == null || outwardAngles.some(existingAngle => angularDifference(existingAngle, outwardAngle) <= 1e-9)) {
      continue;
    }
    outwardAngles.push(outwardAngle);
  }
  return outwardAngles;
}

function measureAttachedRingRootOutwardPenalty(layoutGraph, coords, descriptor) {
  const parentAtomId = descriptor?.anchorAtomId ?? null;
  const rootAtomId = descriptor?.rootAtomId ?? null;
  if (!parentAtomId || !rootAtomId || !coords.has(parentAtomId) || !coords.has(rootAtomId)) {
    return 0;
  }
  const outwardAngles = attachedRingRootOutwardAngles(layoutGraph, coords, rootAtomId, parentAtomId);
  if (outwardAngles.length === 0) {
    return 0;
  }
  const parentAngle = angleOf(sub(coords.get(parentAtomId), coords.get(rootAtomId)));
  return Math.min(...outwardAngles.map(outwardAngle => angularDifference(parentAngle, outwardAngle) ** 2));
}

function supportsRootAnchoredAttachedRingRotation(layoutGraph, descriptor) {
  const rootRingCount = layoutGraph.atomToRings.get(descriptor.rootAtomId)?.length ?? 0;
  if (rootRingCount === 0) {
    return false;
  }
  const rootRingSystemId = layoutGraph.atomToRingSystemId.get(descriptor.rootAtomId);
  if (rootRingSystemId == null || layoutGraph.atomToRingSystemId.get(descriptor.anchorAtomId) === rootRingSystemId) {
    return false;
  }
  let subtreeRingAtomCount = 0;
  for (const atomId of descriptor.subtreeAtomIds) {
    if ((layoutGraph.atomToRings.get(atomId)?.length ?? 0) > 0) {
      subtreeRingAtomCount++;
    }
  }
  return subtreeRingAtomCount >= 3;
}

function rotateAttachedRingAroundRoot(coords, descriptor, rotation) {
  const rootPosition = coords.get(descriptor.rootAtomId);
  if (!rootPosition) {
    return null;
  }
  const overridePositions = new Map();
  for (const atomId of descriptor.subtreeAtomIds) {
    if (atomId === descriptor.rootAtomId) {
      continue;
    }
    const currentPosition = coords.get(atomId);
    if (!currentPosition) {
      continue;
    }
    overridePositions.set(atomId, add(rootPosition, rotate(sub(currentPosition, rootPosition), rotation)));
  }
  return overridePositions;
}

function applyRigidRotationToCoords(coords, subtreeAtomIds, pivotAtomId, rotation) {
  const pivotPosition = coords.get(pivotAtomId);
  if (!pivotPosition) {
    return coords;
  }
  const rotatedCoords = new Map(coords);
  for (const atomId of subtreeAtomIds) {
    if (atomId === pivotAtomId) {
      continue;
    }
    const currentPosition = rotatedCoords.get(atomId);
    if (!currentPosition) {
      continue;
    }
    rotatedCoords.set(atomId, add(pivotPosition, rotate(sub(currentPosition, pivotPosition), rotation)));
  }
  return rotatedCoords;
}

function reflectSubtreeAcrossBond(coords, subtreeAtomIds, lineStartAtomId, lineEndAtomId, fixedAtomIds = new Set()) {
  const lineStartPosition = coords.get(lineStartAtomId);
  const lineEndPosition = coords.get(lineEndAtomId);
  if (!lineStartPosition || !lineEndPosition) {
    return coords;
  }
  const reflectedCoords = new Map(coords);
  for (const atomId of subtreeAtomIds) {
    if (fixedAtomIds.has(atomId)) {
      continue;
    }
    const currentPosition = reflectedCoords.get(atomId);
    if (!currentPosition) {
      continue;
    }
    reflectedCoords.set(atomId, reflectAcrossLine(currentPosition, lineStartPosition, lineEndPosition));
  }
  return reflectedCoords;
}

function compareCanonicalIds(layoutGraph, firstAtomId, secondAtomId) {
  const firstRank = layoutGraph.canonicalAtomRank?.get(firstAtomId) ?? Number.MAX_SAFE_INTEGER;
  const secondRank = layoutGraph.canonicalAtomRank?.get(secondAtomId) ?? Number.MAX_SAFE_INTEGER;
  return firstRank - secondRank || String(firstAtomId).localeCompare(String(secondAtomId), 'en', { numeric: true });
}

function attachedRingLocalPoseKey(layoutGraph, coords, descriptor) {
  const rootPosition = coords.get(descriptor.rootAtomId);
  const anchorPosition = coords.get(descriptor.anchorAtomId);
  if (!rootPosition || !anchorPosition) {
    return '';
  }
  const anchorAngle = angleOf(sub(anchorPosition, rootPosition));
  const atomIds = [...new Set(descriptor.subtreeAtomIds)].filter(atomId => coords.has(atomId));
  atomIds.sort((firstAtomId, secondAtomId) => compareCanonicalIds(layoutGraph, firstAtomId, secondAtomId));
  return atomIds.map(atomId => {
    const alignedPosition = rotate(sub(coords.get(atomId), rootPosition), -anchorAngle);
    return `${atomId}:${Math.round(alignedPosition.x * 1e6)}:${Math.round(alignedPosition.y * 1e6)}`;
  }).join('|');
}

function isExactCleanAttachedRingCandidate(candidate) {
  return (
    candidate.overlapCount === 0
    && candidate.exactContinuationPenalty <= 1e-6
    && candidate.rootOutwardPenalty <= 1e-6
    && candidate.trigonalBisectorPenalty <= 1e-6
    && candidate.trigonalDistortionPenalty <= 1e-6
    && candidate.failingSubstituentCount === 0
    && candidate.inwardSubstituentCount === 0
    && candidate.outwardAxisFailureCount === 0
    && candidate.globalFailingSubstituentCount === 0
    && candidate.globalInwardSubstituentCount === 0
    && candidate.globalOutwardAxisFailureCount === 0
    && candidate.totalOutwardDeviation <= 1e-6
    && candidate.maxOutwardDeviation <= 1e-6
  );
}

function shouldCanonicalizeReflectedAttachedRingTie(candidate, incumbent) {
  return (
    !!incumbent
    && isExactCleanAttachedRingCandidate(candidate)
    && isExactCleanAttachedRingCandidate(incumbent)
    && (
      candidate.reflectAnchor === true
      || incumbent.reflectAnchor === true
    )
  );
}

function collectAttachedCarbonylRingChildDescriptors(layoutGraph, coords, descriptor) {
  if (!supportsAttachedCarbonylPresentationPreference(layoutGraph, descriptor)) {
    return [];
  }

  const childDescriptors = [];
  const seen = new Set();
  for (const bond of layoutGraph.bondsByAtomId.get(descriptor.rootAtomId) ?? []) {
    if (!bond || bond.kind !== 'covalent' || bond.aromatic || (bond.order ?? 1) !== 1) {
      continue;
    }
    const neighborAtomId = bond.a === descriptor.rootAtomId ? bond.b : bond.a;
    if (neighborAtomId === descriptor.anchorAtomId) {
      continue;
    }
    const neighborAtom = layoutGraph.atoms.get(neighborAtomId);
    if (!neighborAtom || neighborAtom.element === 'H' || (layoutGraph.atomToRings.get(neighborAtomId)?.length ?? 0) === 0) {
      continue;
    }
    const subtreeAtomIds = [...collectCutSubtree(layoutGraph, neighborAtomId, descriptor.rootAtomId)].filter(atomId => coords.has(atomId));
    const heavyRingAtomCount = subtreeAtomIds.filter(
      atomId => (layoutGraph.atomToRings.get(atomId)?.length ?? 0) > 0 && layoutGraph.atoms.get(atomId)?.element !== 'H'
    ).length;
    if (heavyRingAtomCount < 3) {
      continue;
    }
    const key = `${descriptor.rootAtomId}->${neighborAtomId}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    childDescriptors.push({
      ringAnchorAtomId: neighborAtomId,
      subtreeAtomIds
    });
  }
  return childDescriptors;
}

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
function readabilityTupleImproves(candidate, baseline) {
  const candidateFailures = candidate?.failingSubstituentCount ?? 0;
  const baselineFailures = baseline?.failingSubstituentCount ?? 0;
  if (candidateFailures !== baselineFailures) {
    return candidateFailures < baselineFailures;
  }
  const candidateInward = candidate?.inwardSubstituentCount ?? 0;
  const baselineInward = baseline?.inwardSubstituentCount ?? 0;
  if (candidateInward !== baselineInward) {
    return candidateInward < baselineInward;
  }
  const candidateOutward = candidate?.outwardAxisFailureCount ?? 0;
  const baselineOutward = baseline?.outwardAxisFailureCount ?? 0;
  return candidateOutward < baselineOutward;
}

function readabilityTupleWorsens(candidate, baseline) {
  const candidateFailures = candidate?.failingSubstituentCount ?? 0;
  const baselineFailures = baseline?.failingSubstituentCount ?? 0;
  if (candidateFailures !== baselineFailures) {
    return candidateFailures > baselineFailures;
  }
  const candidateInward = candidate?.inwardSubstituentCount ?? 0;
  const baselineInward = baseline?.inwardSubstituentCount ?? 0;
  if (candidateInward !== baselineInward) {
    return candidateInward > baselineInward;
  }
  const candidateOutward = candidate?.outwardAxisFailureCount ?? 0;
  const baselineOutward = baseline?.outwardAxisFailureCount ?? 0;
  return candidateOutward > baselineOutward;
}

function measureExactAcyclicContinuationDistortion(layoutGraph, coords, focusAtomIds = null) {
  const focusSet = focusAtomIds instanceof Set && focusAtomIds.size > 0 ? focusAtomIds : null;
  let centerCount = 0;
  let totalDeviation = 0;
  let maxDeviation = 0;

  for (const atomId of coords.keys()) {
    if (focusSet && !focusSet.has(atomId)) {
      continue;
    }
    const atom = layoutGraph.atoms.get(atomId);
    if (!atom || atom.element === 'H') {
      continue;
    }

    const heavyNeighborIds = [];
    for (const bond of layoutGraph.bondsByAtomId.get(atomId) ?? []) {
      if (!bond || bond.kind !== 'covalent') {
        continue;
      }
      const neighborAtomId = bond.a === atomId ? bond.b : bond.a;
      const neighborAtom = layoutGraph.atoms.get(neighborAtomId);
      if (!neighborAtom || neighborAtom.element === 'H' || !coords.has(neighborAtomId)) {
        continue;
      }
      heavyNeighborIds.push(neighborAtomId);
    }
    if (heavyNeighborIds.length !== 2) {
      continue;
    }

    const [firstNeighborAtomId, secondNeighborAtomId] = heavyNeighborIds;
    if (
      !isExactSimpleAcyclicContinuationEligible(layoutGraph, atomId, firstNeighborAtomId, secondNeighborAtomId)
      && !isExactSimpleAcyclicContinuationEligible(layoutGraph, atomId, secondNeighborAtomId, firstNeighborAtomId)
    ) {
      continue;
    }

    const deviation = (
      angularDifference(
        angleOf(sub(coords.get(firstNeighborAtomId), coords.get(atomId))),
        angleOf(sub(coords.get(secondNeighborAtomId), coords.get(atomId)))
      ) - (2 * Math.PI) / 3
    ) ** 2;
    centerCount++;
    totalDeviation += deviation;
    maxDeviation = Math.max(maxDeviation, deviation);
  }

  return {
    centerCount,
    totalDeviation,
    maxDeviation
  };
}

function measureDirectAttachmentTrigonalBisectorPenalty(layoutGraph, coords, descriptor) {
  const parentAtomId = descriptor?.anchorAtomId ?? null;
  const attachmentAtomId = descriptor?.rootAtomId ?? null;
  if (!parentAtomId || !attachmentAtomId || !coords.has(parentAtomId) || !coords.has(attachmentAtomId)) {
    return 0;
  }

  const anchorAtom = layoutGraph.atoms.get(parentAtomId);
  if (!anchorAtom || anchorAtom.aromatic || anchorAtom.heavyDegree !== 3 || (layoutGraph.atomToRings.get(parentAtomId)?.length ?? 0) > 0) {
    return 0;
  }

  let nonAromaticMultipleBondCount = 0;
  let ringNeighborCount = 0;
  const otherHeavyNeighborIds = [];
  for (const bond of layoutGraph.bondsByAtomId.get(parentAtomId) ?? []) {
    if (!bond || bond.kind !== 'covalent') {
      continue;
    }
    const neighborAtomId = bond.a === parentAtomId ? bond.b : bond.a;
    const neighborAtom = layoutGraph.atoms.get(neighborAtomId);
    if (!neighborAtom || neighborAtom.element === 'H') {
      continue;
    }
    if (!bond.aromatic && (bond.order ?? 1) >= 2) {
      nonAromaticMultipleBondCount++;
    }
    if ((layoutGraph.atomToRings.get(neighborAtomId)?.length ?? 0) > 0) {
      ringNeighborCount++;
    }
    if (neighborAtomId !== attachmentAtomId && coords.has(neighborAtomId)) {
      otherHeavyNeighborIds.push(neighborAtomId);
    }
  }

  const supportsHiddenHydrogenTrigonalSpread =
    anchorAtom.degree === 4 && ringNeighborCount >= 1 && nonAromaticMultipleBondCount === 0;
  if ((!supportsHiddenHydrogenTrigonalSpread && nonAromaticMultipleBondCount !== 1) || otherHeavyNeighborIds.length !== 2) {
    return 0;
  }

  const anchorPosition = coords.get(parentAtomId);
  const idealAngle = angleOf(sub(anchorPosition, centroid(otherHeavyNeighborIds.map(neighborAtomId => coords.get(neighborAtomId)))));
  const attachmentAngle = angleOf(sub(coords.get(attachmentAtomId), anchorPosition));
  return angularDifference(attachmentAngle, idealAngle) ** 2;
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
 * @param {{
 *   bondLength?: number,
 *   frozenAtomIds?: Set<string>|null,
 *   cleanupRigidSubtreesByAtomId?: Map<string, Array<{anchorAtomId: string, rootAtomId: string, subtreeAtomIds: string[]}>>,
 *   protectLargeMoleculeBackbone?: boolean
 * }} [options] - Touchup options.
 * @returns {{coords: Map<string, {x: number, y: number}>, nudges: number}} Best accepted touchup result.
 */
export function runAttachedRingRotationTouchup(layoutGraph, inputCoords, options = {}) {
  const bondLength = options.bondLength ?? layoutGraph.options.bondLength;
  const maxPasses = Math.max(1, options.maxPasses ?? 2);
  const frozenAtomIds = options.frozenAtomIds instanceof Set && options.frozenAtomIds.size > 0 ? options.frozenAtomIds : null;
  if ((layoutGraph.traits.heavyAtomCount ?? 0) > 60) {
    return { coords: inputCoords, nudges: 0 };
  }

  let currentCoords = inputCoords;
  let totalNudges = 0;

  for (let pass = 0; pass < maxPasses; pass++) {
    const descriptors = collectMovableAttachedRingDescriptors(layoutGraph, currentCoords, frozenAtomIds);
    const baseAtomGrid = buildAtomGrid(layoutGraph, currentCoords, bondLength);
    if (descriptors.length === 0) {
      break;
    }

    const { terminalSubtrees, siblingSwaps, geminalPairs } = computeRotatableSubtrees(layoutGraph, currentCoords);
    const baseOverlapCount = findSevereOverlaps(layoutGraph, currentCoords, bondLength, { atomGrid: baseAtomGrid }).length;
    const baseGlobalReadability = measureRingSubstituentReadability(layoutGraph, currentCoords);
    let bestCandidate = null;

    for (const descriptor of descriptors) {
      const focusAtomIds = expandFocusAtomIds(
        layoutGraph,
        new Set([descriptor.anchorAtomId, descriptor.rootAtomId, ...descriptor.subtreeAtomIds])
      );
      const basePresentationPenalty = measureCleanupStagePresentationPenalty(layoutGraph, currentCoords, {
        focusAtomIds,
        includeSmallRingExteriorPenalty: false
      });
      const baseJunctionContinuationPenalty = measureDirectAttachedRingJunctionContinuationDistortion(layoutGraph, currentCoords, { focusAtomIds }).totalDeviation;
      const baseExactContinuationPenalty = measureExactAcyclicContinuationDistortion(layoutGraph, currentCoords, focusAtomIds).totalDeviation;
      const baseRootOutwardPenalty = measureAttachedRingRootOutwardPenalty(layoutGraph, currentCoords, descriptor);
      const baseTrigonalBisectorPenalty = measureDirectAttachmentTrigonalBisectorPenalty(layoutGraph, currentCoords, descriptor);
      const baseTrigonalDistortionPenalty = measureTrigonalDistortion(layoutGraph, currentCoords, { focusAtomIds }).totalDeviation;
      const baseSubtreeClearance = measureAttachedCarbonylSubtreeClearance(layoutGraph, currentCoords, descriptor);
      const baseSmallRingExteriorPenalty = measureTotalSmallRingExteriorGapPenalty(layoutGraph, currentCoords, focusAtomIds);
      const baseReadability = measureRingSubstituentReadability(layoutGraph, currentCoords, {
        focusAtomIds
      });
      const buildCandidateScore = (candidateCoords, nudges) => {
        const overlapCount = findSevereOverlaps(layoutGraph, candidateCoords, bondLength).length;
        if (overlapCount > baseOverlapCount) {
          buildCandidateScore.lastRejectReason = 'overlap-count';
          return null;
        }
        const junctionContinuationPenalty = measureDirectAttachedRingJunctionContinuationDistortion(layoutGraph, candidateCoords, { focusAtomIds }).totalDeviation;
        if (junctionContinuationPenalty > baseJunctionContinuationPenalty + 1e-6) {
          buildCandidateScore.lastRejectReason = 'junction-continuation';
          return null;
        }
        const exactContinuationPenalty = measureExactAcyclicContinuationDistortion(layoutGraph, candidateCoords, focusAtomIds).totalDeviation;
        if (exactContinuationPenalty > baseExactContinuationPenalty + 1e-6) {
          buildCandidateScore.lastRejectReason = 'exact-continuation';
          return null;
        }
        const rootOutwardPenalty = measureAttachedRingRootOutwardPenalty(layoutGraph, candidateCoords, descriptor);
        if (rootOutwardPenalty > baseRootOutwardPenalty + 1e-6) {
          buildCandidateScore.lastRejectReason = 'root-outward';
          return null;
        }
        const trigonalBisectorPenalty = measureDirectAttachmentTrigonalBisectorPenalty(layoutGraph, candidateCoords, descriptor);
        if (trigonalBisectorPenalty > baseTrigonalBisectorPenalty + 1e-6) {
          buildCandidateScore.lastRejectReason = 'trigonal-bisector';
          return null;
        }
        const trigonalDistortionPenalty = measureTrigonalDistortion(layoutGraph, candidateCoords, { focusAtomIds }).totalDeviation;
        if (trigonalDistortionPenalty > baseTrigonalDistortionPenalty + 1e-6) {
          buildCandidateScore.lastRejectReason = 'trigonal-distortion';
          return null;
        }
        const readability = measureRingSubstituentReadability(layoutGraph, candidateCoords, {
          focusAtomIds
        });
        const globalReadability = measureRingSubstituentReadability(layoutGraph, candidateCoords);
        if (readabilityTupleWorsens(readability, baseReadability) || readabilityTupleWorsens(globalReadability, baseGlobalReadability)) {
          buildCandidateScore.lastRejectReason = 'readability';
          return null;
        }
        const subtreeClearance = measureAttachedCarbonylSubtreeClearance(layoutGraph, candidateCoords, descriptor);
        const smallRingExteriorPenalty = measureTotalSmallRingExteriorGapPenalty(layoutGraph, candidateCoords, focusAtomIds);
        if (smallRingExteriorPenalty > baseSmallRingExteriorPenalty + 1e-6) {
          buildCandidateScore.lastRejectReason = 'small-ring-exterior';
          return null;
        }
        const presentationPenalty = measureCleanupStagePresentationPenalty(layoutGraph, candidateCoords, {
          focusAtomIds,
          includeSmallRingExteriorPenalty: false
        });
        const attachedCarbonylSetupImprovesClearance =
          baseSubtreeClearance != null
          && subtreeClearance != null
          && subtreeClearance > baseSubtreeClearance + 1e-6
          && (readability.maxOutwardDeviation ?? Number.POSITIVE_INFINITY) <= (baseReadability.maxOutwardDeviation ?? Number.POSITIVE_INFINITY) + 1e-6;
        if (
          presentationPenalty > basePresentationPenalty + 1e-6
          && !readabilityTupleImproves(readability, baseReadability)
          && !attachedCarbonylSetupImprovesClearance
        ) {
          buildCandidateScore.lastRejectReason = 'presentation';
          return null;
        }
        buildCandidateScore.lastRejectReason = null;
        return {
          coords: candidateCoords,
          nudges,
          overlapCount,
          junctionContinuationPenalty,
          exactContinuationPenalty,
          rootOutwardPenalty,
          trigonalBisectorPenalty,
          trigonalDistortionPenalty,
          subtreeClearance,
          baseSubtreeClearance,
          failingSubstituentCount: readability.failingSubstituentCount ?? 0,
          inwardSubstituentCount: readability.inwardSubstituentCount ?? 0,
          outwardAxisFailureCount: readability.outwardAxisFailureCount ?? 0,
          globalFailingSubstituentCount: globalReadability.failingSubstituentCount ?? 0,
          globalInwardSubstituentCount: globalReadability.inwardSubstituentCount ?? 0,
          globalOutwardAxisFailureCount: globalReadability.outwardAxisFailureCount ?? 0,
          totalOutwardDeviation: readability.totalOutwardDeviation ?? 0,
          maxOutwardDeviation: readability.maxOutwardDeviation ?? 0,
          presentationImprovement: basePresentationPenalty - presentationPenalty,
          layoutCost: measureLayoutCost(layoutGraph, candidateCoords, bondLength),
          localPoseKey: attachedRingLocalPoseKey(layoutGraph, candidateCoords, descriptor)
        };
      };
      const scoreCandidate = (seedCandidateCoords, overridePositions) => {
        let bestScore = buildCandidateScore(seedCandidateCoords, 1);
        const ringSubstituentTouchup = runRingSubstituentTidy(layoutGraph, currentCoords, {
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
        const localScore = buildCandidateScore(
          localLeafTouchup.coords,
          ringSubstituentTouchup.nudges + localLeafTouchup.passes + 1
        );
        if (localScore && isBetterAttachedRingCandidate(localScore, bestScore)) {
          bestScore = localScore;
        }
        const unifiedCleanup = runUnifiedCleanup(layoutGraph, ringSubstituentTouchup.coords, {
          maxPasses: 1,
          epsilon: bondLength * 0.001,
          bondLength,
          cleanupRigidSubtreesByAtomId: options.cleanupRigidSubtreesByAtomId,
          frozenAtomIds,
          protectLargeMoleculeBackbone: options.protectLargeMoleculeBackbone === true,
          protectBondIntegrity: true
        });
        if (unifiedCleanup.passes > 0) {
          const unifiedScore = buildCandidateScore(
            unifiedCleanup.coords,
            ringSubstituentTouchup.nudges + unifiedCleanup.passes + 1
          );
          if (unifiedScore && isBetterAttachedRingCandidate(unifiedScore, bestScore)) {
            bestScore = unifiedScore;
          }
        }
        return bestScore;
      };
      const attachedCarbonylRingChildren = collectAttachedCarbonylRingChildDescriptors(layoutGraph, currentCoords, descriptor);
      const attachedRingSearch = visitPresentationDescriptorCandidates(layoutGraph, currentCoords, descriptor, {
        context: {
          focusAtomIds,
          attachedCarbonylRingChildren,
          terminalSubtrees,
          siblingSwaps,
          geminalPairs
        },
        generateSeeds(inputDescriptor, searchContext) {
          const seeds = ATTACHED_RING_ROTATION_TIDY_ANGLES
            .filter(rotation => Math.abs(rotation) > 1e-9)
            .map(rotation => ({ kind: 'rigid', rotation }));
          if (supportsRootAnchoredAttachedRingRotation(layoutGraph, inputDescriptor)) {
            for (const rotation of ATTACHED_RING_ROTATION_TIDY_ANGLES) {
              if (Math.abs(rotation) <= 1e-9) {
                continue;
              }
              seeds.push({ kind: 'root-anchored', rotation });
            }
          }
          if (searchContext.attachedCarbonylRingChildren.length > 0) {
            const compositeRotations = [0, ...ATTACHED_RING_ROTATION_TIDY_ANGLES];
            for (const childDescriptor of searchContext.attachedCarbonylRingChildren) {
              for (const reflectAnchor of [false, true]) {
                for (const anchorRotation of compositeRotations) {
                  for (const ringRotation of compositeRotations) {
                    if (!reflectAnchor && Math.abs(anchorRotation) <= 1e-9 && Math.abs(ringRotation) <= 1e-9) {
                      continue;
                    }
                    seeds.push({
                      kind: 'composite',
                      childDescriptor,
                      reflectAnchor,
                      anchorRotation,
                      ringRotation
                    });
                  }
                }
              }
            }
          }
          return seeds;
        },
        materializeOverrides(inputCoords, inputDescriptor, seed) {
          if (seed.kind === 'rigid') {
            return rotateRigidDescriptorPositions(inputCoords, inputDescriptor, seed.rotation);
          }
          if (seed.kind === 'root-anchored') {
            return rotateAttachedRingAroundRoot(inputCoords, inputDescriptor, seed.rotation);
          }
          if (seed.kind !== 'composite') {
            return null;
          }
          let candidateCoords = inputCoords;
          if (Math.abs(seed.anchorRotation) > 1e-9) {
            candidateCoords = applyRigidRotationToCoords(candidateCoords, inputDescriptor.subtreeAtomIds, inputDescriptor.anchorAtomId, seed.anchorRotation);
          }
          if (seed.reflectAnchor === true) {
            candidateCoords = reflectSubtreeAcrossBond(
              candidateCoords,
              inputDescriptor.subtreeAtomIds,
              inputDescriptor.anchorAtomId,
              inputDescriptor.rootAtomId,
              new Set([inputDescriptor.rootAtomId])
            );
          }
          if (Math.abs(seed.ringRotation) > 1e-9) {
            candidateCoords = applyRigidRotationToCoords(
              candidateCoords,
              seed.childDescriptor.subtreeAtomIds,
              seed.childDescriptor.ringAnchorAtomId,
              seed.ringRotation
            );
          }
          const overridePositions = new Map();
          for (const atomId of inputDescriptor.subtreeAtomIds) {
            if (atomId === inputDescriptor.anchorAtomId) {
              continue;
            }
            const position = candidateCoords.get(atomId);
            if (position) {
              overridePositions.set(atomId, position);
            }
          }
          for (const atomId of seed.childDescriptor.subtreeAtomIds) {
            if (atomId === seed.childDescriptor.ringAnchorAtomId) {
              continue;
            }
            const position = candidateCoords.get(atomId);
            if (position) {
              overridePositions.set(atomId, position);
            }
          }
          return overridePositions;
        },
        scoreSeed(_descriptor, _candidateCoords, _seed, _searchContext, overridePositions) {
          const scoredCandidate = scoreCandidate(_candidateCoords, overridePositions);
          if (scoredCandidate) {
            scoredCandidate.reflectAnchor = _seed?.reflectAnchor === true;
          }
          return scoredCandidate;
        },
        isBetterScore(candidateScore, incumbentScore) {
          if (shouldCanonicalizeReflectedAttachedRingTie(candidateScore, incumbentScore)) {
            return false;
          }
          return isBetterAttachedRingCandidate(candidateScore, incumbentScore);
        },
        compareEquivalentCandidates(candidate, incumbent) {
          if (
            shouldCanonicalizeReflectedAttachedRingTie(candidate.seedScore, incumbent.seedScore)
            && typeof candidate.seedScore.localPoseKey === 'string'
            && typeof incumbent.seedScore.localPoseKey === 'string'
          ) {
            return candidate.seedScore.localPoseKey.localeCompare(incumbent.seedScore.localPoseKey, 'en', { numeric: true });
          }
          return 0;
        },
      });
      if (attachedRingSearch.bestFinalCandidate) {
        const candidateScore = attachedRingSearch.bestFinalCandidate.score;
        if (
          !bestCandidate
          || isBetterAttachedRingCandidate(candidateScore, bestCandidate)
          || (
            shouldCanonicalizeReflectedAttachedRingTie(candidateScore, bestCandidate)
            && typeof candidateScore.localPoseKey === 'string'
            && typeof bestCandidate.localPoseKey === 'string'
            && candidateScore.localPoseKey.localeCompare(bestCandidate.localPoseKey, 'en', { numeric: true }) < 0
          )
        ) {
          bestCandidate = candidateScore;
        }
      }
    }

    if (!bestCandidate) {
      break;
    }
    currentCoords = bestCandidate.coords;
    totalNudges += bestCandidate.nudges;
  }

  return totalNudges > 0
    ? {
        coords: currentCoords,
        nudges: totalNudges
      }
    : { coords: inputCoords, nudges: 0 };
}

function overlapCountWins(candidate, incumbent) {
  return !!incumbent && candidate.overlapCount < incumbent.overlapCount;
}

function exactContinuationWins(candidate, incumbent) {
  return !!incumbent
    && candidate.overlapCount === incumbent.overlapCount
    && candidate.exactContinuationPenalty < incumbent.exactContinuationPenalty - 1e-6;
}

function readabilityFailureWins(candidate, incumbent) {
  return !!incumbent
    && candidate.overlapCount === incumbent.overlapCount
    && Math.abs(candidate.exactContinuationPenalty - incumbent.exactContinuationPenalty) <= 1e-6
    && Math.abs(candidate.rootOutwardPenalty - incumbent.rootOutwardPenalty) <= 1e-6
    && Math.abs(candidate.trigonalBisectorPenalty - incumbent.trigonalBisectorPenalty) <= 1e-6
    && Math.abs(candidate.trigonalDistortionPenalty - incumbent.trigonalDistortionPenalty) <= 1e-6
    && candidate.failingSubstituentCount < incumbent.failingSubstituentCount;
}

function inwardReadabilityWins(candidate, incumbent) {
  return !!incumbent
    && candidate.overlapCount === incumbent.overlapCount
    && Math.abs(candidate.exactContinuationPenalty - incumbent.exactContinuationPenalty) <= 1e-6
    && Math.abs(candidate.rootOutwardPenalty - incumbent.rootOutwardPenalty) <= 1e-6
    && Math.abs(candidate.trigonalBisectorPenalty - incumbent.trigonalBisectorPenalty) <= 1e-6
    && Math.abs(candidate.trigonalDistortionPenalty - incumbent.trigonalDistortionPenalty) <= 1e-6
    && candidate.failingSubstituentCount === incumbent.failingSubstituentCount
    && candidate.inwardSubstituentCount < incumbent.inwardSubstituentCount;
}

function outwardReadabilityWins(candidate, incumbent) {
  return !!incumbent
    && candidate.overlapCount === incumbent.overlapCount
    && Math.abs(candidate.exactContinuationPenalty - incumbent.exactContinuationPenalty) <= 1e-6
    && Math.abs(candidate.rootOutwardPenalty - incumbent.rootOutwardPenalty) <= 1e-6
    && Math.abs(candidate.trigonalBisectorPenalty - incumbent.trigonalBisectorPenalty) <= 1e-6
    && Math.abs(candidate.trigonalDistortionPenalty - incumbent.trigonalDistortionPenalty) <= 1e-6
    && candidate.failingSubstituentCount === incumbent.failingSubstituentCount
    && candidate.inwardSubstituentCount === incumbent.inwardSubstituentCount
    && candidate.outwardAxisFailureCount < incumbent.outwardAxisFailureCount;
}

function globalReadabilityFailureWins(candidate, incumbent) {
  return !!incumbent
    && candidate.overlapCount === incumbent.overlapCount
    && Math.abs(candidate.exactContinuationPenalty - incumbent.exactContinuationPenalty) <= 1e-6
    && Math.abs(candidate.rootOutwardPenalty - incumbent.rootOutwardPenalty) <= 1e-6
    && Math.abs(candidate.trigonalBisectorPenalty - incumbent.trigonalBisectorPenalty) <= 1e-6
    && Math.abs(candidate.trigonalDistortionPenalty - incumbent.trigonalDistortionPenalty) <= 1e-6
    && candidate.failingSubstituentCount === incumbent.failingSubstituentCount
    && candidate.inwardSubstituentCount === incumbent.inwardSubstituentCount
    && candidate.outwardAxisFailureCount === incumbent.outwardAxisFailureCount
    && candidate.globalFailingSubstituentCount < incumbent.globalFailingSubstituentCount;
}

function globalInwardReadabilityWins(candidate, incumbent) {
  return !!incumbent
    && candidate.overlapCount === incumbent.overlapCount
    && Math.abs(candidate.exactContinuationPenalty - incumbent.exactContinuationPenalty) <= 1e-6
    && Math.abs(candidate.rootOutwardPenalty - incumbent.rootOutwardPenalty) <= 1e-6
    && Math.abs(candidate.trigonalBisectorPenalty - incumbent.trigonalBisectorPenalty) <= 1e-6
    && Math.abs(candidate.trigonalDistortionPenalty - incumbent.trigonalDistortionPenalty) <= 1e-6
    && candidate.failingSubstituentCount === incumbent.failingSubstituentCount
    && candidate.inwardSubstituentCount === incumbent.inwardSubstituentCount
    && candidate.outwardAxisFailureCount === incumbent.outwardAxisFailureCount
    && candidate.globalFailingSubstituentCount === incumbent.globalFailingSubstituentCount
    && candidate.globalInwardSubstituentCount < incumbent.globalInwardSubstituentCount;
}

function globalOutwardReadabilityWins(candidate, incumbent) {
  return !!incumbent
    && candidate.overlapCount === incumbent.overlapCount
    && Math.abs(candidate.exactContinuationPenalty - incumbent.exactContinuationPenalty) <= 1e-6
    && Math.abs(candidate.rootOutwardPenalty - incumbent.rootOutwardPenalty) <= 1e-6
    && Math.abs(candidate.trigonalBisectorPenalty - incumbent.trigonalBisectorPenalty) <= 1e-6
    && Math.abs(candidate.trigonalDistortionPenalty - incumbent.trigonalDistortionPenalty) <= 1e-6
    && candidate.failingSubstituentCount === incumbent.failingSubstituentCount
    && candidate.inwardSubstituentCount === incumbent.inwardSubstituentCount
    && candidate.outwardAxisFailureCount === incumbent.outwardAxisFailureCount
    && candidate.globalFailingSubstituentCount === incumbent.globalFailingSubstituentCount
    && candidate.globalInwardSubstituentCount === incumbent.globalInwardSubstituentCount
    && candidate.globalOutwardAxisFailureCount < incumbent.globalOutwardAxisFailureCount;
}

function attachedCarbonylRootDescriptorWins(candidate, incumbent) {
  return !!incumbent
    && candidate.overlapCount === incumbent.overlapCount
    && Math.abs(candidate.exactContinuationPenalty - incumbent.exactContinuationPenalty) <= 1e-6
    && Math.abs(candidate.rootOutwardPenalty - incumbent.rootOutwardPenalty) <= 1e-6
    && Math.abs(candidate.trigonalBisectorPenalty - incumbent.trigonalBisectorPenalty) <= 1e-6
    && Math.abs(candidate.trigonalDistortionPenalty - incumbent.trigonalDistortionPenalty) <= 1e-6
    && candidate.failingSubstituentCount === incumbent.failingSubstituentCount
    && candidate.inwardSubstituentCount === incumbent.inwardSubstituentCount
    && candidate.outwardAxisFailureCount === incumbent.outwardAxisFailureCount
    && candidate.globalFailingSubstituentCount === incumbent.globalFailingSubstituentCount
    && candidate.globalInwardSubstituentCount === incumbent.globalInwardSubstituentCount
    && candidate.globalOutwardAxisFailureCount === incumbent.globalOutwardAxisFailureCount
    && candidate.subtreeClearance != null
    && incumbent.subtreeClearance == null;
}

function attachedCarbonylSetupWins(candidate, incumbent) {
  return !!incumbent
    && candidate.overlapCount === incumbent.overlapCount
    && Math.abs(candidate.exactContinuationPenalty - incumbent.exactContinuationPenalty) <= 1e-6
    && Math.abs(candidate.rootOutwardPenalty - incumbent.rootOutwardPenalty) <= 1e-6
    && Math.abs(candidate.trigonalBisectorPenalty - incumbent.trigonalBisectorPenalty) <= 1e-6
    && Math.abs(candidate.trigonalDistortionPenalty - incumbent.trigonalDistortionPenalty) <= 1e-6
    && candidate.failingSubstituentCount === incumbent.failingSubstituentCount
    && candidate.inwardSubstituentCount === incumbent.inwardSubstituentCount
    && candidate.outwardAxisFailureCount === incumbent.outwardAxisFailureCount
    && candidate.globalFailingSubstituentCount === incumbent.globalFailingSubstituentCount
    && candidate.globalInwardSubstituentCount === incumbent.globalInwardSubstituentCount
    && candidate.globalOutwardAxisFailureCount === incumbent.globalOutwardAxisFailureCount
    && candidate.subtreeClearance != null
    && incumbent.subtreeClearance != null
    && candidate.totalOutwardDeviation <= incumbent.totalOutwardDeviation + 1e-6
    && candidate.maxOutwardDeviation <= incumbent.maxOutwardDeviation + 1e-6
    && candidate.subtreeClearance > incumbent.subtreeClearance + 1e-6;
}

function presentationWins(candidate, incumbent) {
  return !!incumbent
    && candidate.overlapCount === incumbent.overlapCount
    && Math.abs(candidate.exactContinuationPenalty - incumbent.exactContinuationPenalty) <= 1e-6
    && Math.abs(candidate.rootOutwardPenalty - incumbent.rootOutwardPenalty) <= 1e-6
    && Math.abs(candidate.trigonalBisectorPenalty - incumbent.trigonalBisectorPenalty) <= 1e-6
    && Math.abs(candidate.trigonalDistortionPenalty - incumbent.trigonalDistortionPenalty) <= 1e-6
    && candidate.failingSubstituentCount === incumbent.failingSubstituentCount
    && candidate.inwardSubstituentCount === incumbent.inwardSubstituentCount
    && candidate.outwardAxisFailureCount === incumbent.outwardAxisFailureCount
    && candidate.globalFailingSubstituentCount === incumbent.globalFailingSubstituentCount
    && candidate.globalInwardSubstituentCount === incumbent.globalInwardSubstituentCount
    && candidate.globalOutwardAxisFailureCount === incumbent.globalOutwardAxisFailureCount
    && Math.abs(candidate.totalOutwardDeviation - incumbent.totalOutwardDeviation) <= 1e-6
    && Math.abs(candidate.maxOutwardDeviation - incumbent.maxOutwardDeviation) <= 1e-6
    && (
      candidate.subtreeClearance == null
      || incumbent.subtreeClearance == null
      || Math.abs(candidate.subtreeClearance - incumbent.subtreeClearance) <= 1e-6
    )
    && candidate.presentationImprovement > incumbent.presentationImprovement + 1e-6;
}

function layoutCostWins(candidate, incumbent) {
  return !!incumbent
    && candidate.overlapCount === incumbent.overlapCount
    && Math.abs(candidate.exactContinuationPenalty - incumbent.exactContinuationPenalty) <= 1e-6
    && Math.abs(candidate.rootOutwardPenalty - incumbent.rootOutwardPenalty) <= 1e-6
    && Math.abs(candidate.trigonalBisectorPenalty - incumbent.trigonalBisectorPenalty) <= 1e-6
    && Math.abs(candidate.trigonalDistortionPenalty - incumbent.trigonalDistortionPenalty) <= 1e-6
    && candidate.failingSubstituentCount === incumbent.failingSubstituentCount
    && candidate.inwardSubstituentCount === incumbent.inwardSubstituentCount
    && candidate.outwardAxisFailureCount === incumbent.outwardAxisFailureCount
    && candidate.globalFailingSubstituentCount === incumbent.globalFailingSubstituentCount
    && candidate.globalInwardSubstituentCount === incumbent.globalInwardSubstituentCount
    && candidate.globalOutwardAxisFailureCount === incumbent.globalOutwardAxisFailureCount
    && Math.abs(candidate.totalOutwardDeviation - incumbent.totalOutwardDeviation) <= 1e-6
    && Math.abs(candidate.maxOutwardDeviation - incumbent.maxOutwardDeviation) <= 1e-6
    && (
      candidate.subtreeClearance == null
      || incumbent.subtreeClearance == null
      || Math.abs(candidate.subtreeClearance - incumbent.subtreeClearance) <= 1e-6
    )
    && Math.abs(candidate.presentationImprovement - incumbent.presentationImprovement) <= 1e-6
    && candidate.layoutCost < incumbent.layoutCost - 1e-6;
}

function outwardDeviationWins(candidate, incumbent) {
  return !!incumbent
    && candidate.overlapCount === incumbent.overlapCount
    && Math.abs(candidate.exactContinuationPenalty - incumbent.exactContinuationPenalty) <= 1e-6
    && Math.abs(candidate.rootOutwardPenalty - incumbent.rootOutwardPenalty) <= 1e-6
    && Math.abs(candidate.trigonalBisectorPenalty - incumbent.trigonalBisectorPenalty) <= 1e-6
    && Math.abs(candidate.trigonalDistortionPenalty - incumbent.trigonalDistortionPenalty) <= 1e-6
    && candidate.failingSubstituentCount === incumbent.failingSubstituentCount
    && candidate.inwardSubstituentCount === incumbent.inwardSubstituentCount
    && candidate.outwardAxisFailureCount === incumbent.outwardAxisFailureCount
    && candidate.globalFailingSubstituentCount === incumbent.globalFailingSubstituentCount
    && candidate.globalInwardSubstituentCount === incumbent.globalInwardSubstituentCount
    && candidate.globalOutwardAxisFailureCount === incumbent.globalOutwardAxisFailureCount
    && (
      candidate.totalOutwardDeviation < incumbent.totalOutwardDeviation - 1e-6
      || (
        Math.abs(candidate.totalOutwardDeviation - incumbent.totalOutwardDeviation) <= 1e-6
        && candidate.maxOutwardDeviation < incumbent.maxOutwardDeviation - 1e-6
      )
    );
}

function rootOutwardWins(candidate, incumbent) {
  return !!incumbent
    && candidate.overlapCount === incumbent.overlapCount
    && Math.abs(candidate.exactContinuationPenalty - incumbent.exactContinuationPenalty) <= 1e-6
    && candidate.rootOutwardPenalty < incumbent.rootOutwardPenalty - 1e-6;
}

function trigonalBisectorWins(candidate, incumbent) {
  return !!incumbent
    && candidate.overlapCount === incumbent.overlapCount
    && Math.abs(candidate.exactContinuationPenalty - incumbent.exactContinuationPenalty) <= 1e-6
    && Math.abs(candidate.rootOutwardPenalty - incumbent.rootOutwardPenalty) <= 1e-6
    && candidate.trigonalBisectorPenalty < incumbent.trigonalBisectorPenalty - 1e-6;
}

function trigonalDistortionWins(candidate, incumbent) {
  return !!incumbent
    && candidate.overlapCount === incumbent.overlapCount
    && Math.abs(candidate.exactContinuationPenalty - incumbent.exactContinuationPenalty) <= 1e-6
    && Math.abs(candidate.rootOutwardPenalty - incumbent.rootOutwardPenalty) <= 1e-6
    && Math.abs(candidate.trigonalBisectorPenalty - incumbent.trigonalBisectorPenalty) <= 1e-6
    && candidate.trigonalDistortionPenalty < incumbent.trigonalDistortionPenalty - 1e-6;
}

function subtreeClearanceWins(candidate, incumbent) {
  return !!incumbent
    && candidate.overlapCount === incumbent.overlapCount
    && Math.abs(candidate.exactContinuationPenalty - incumbent.exactContinuationPenalty) <= 1e-6
    && Math.abs(candidate.rootOutwardPenalty - incumbent.rootOutwardPenalty) <= 1e-6
    && Math.abs(candidate.trigonalBisectorPenalty - incumbent.trigonalBisectorPenalty) <= 1e-6
    && Math.abs(candidate.trigonalDistortionPenalty - incumbent.trigonalDistortionPenalty) <= 1e-6
    && candidate.failingSubstituentCount === incumbent.failingSubstituentCount
    && candidate.inwardSubstituentCount === incumbent.inwardSubstituentCount
    && candidate.outwardAxisFailureCount === incumbent.outwardAxisFailureCount
    && candidate.globalFailingSubstituentCount === incumbent.globalFailingSubstituentCount
    && candidate.globalInwardSubstituentCount === incumbent.globalInwardSubstituentCount
    && candidate.globalOutwardAxisFailureCount === incumbent.globalOutwardAxisFailureCount
    && Math.abs(candidate.totalOutwardDeviation - incumbent.totalOutwardDeviation) <= 1e-6
    && Math.abs(candidate.maxOutwardDeviation - incumbent.maxOutwardDeviation) <= 1e-6
    && candidate.subtreeClearance != null
    && incumbent.subtreeClearance != null
    && candidate.subtreeClearance > incumbent.subtreeClearance + 1e-6;
}

function isBetterAttachedRingCandidate(candidate, incumbent) {
  if (!incumbent) {
    return true;
  }
  return overlapCountWins(candidate, incumbent)
    || exactContinuationWins(candidate, incumbent)
    || rootOutwardWins(candidate, incumbent)
    || trigonalBisectorWins(candidate, incumbent)
    || trigonalDistortionWins(candidate, incumbent)
    || readabilityFailureWins(candidate, incumbent)
    || inwardReadabilityWins(candidate, incumbent)
    || outwardReadabilityWins(candidate, incumbent)
    || globalReadabilityFailureWins(candidate, incumbent)
    || globalInwardReadabilityWins(candidate, incumbent)
    || globalOutwardReadabilityWins(candidate, incumbent)
    || attachedCarbonylRootDescriptorWins(candidate, incumbent)
    || attachedCarbonylSetupWins(candidate, incumbent)
    || outwardDeviationWins(candidate, incumbent)
    || subtreeClearanceWins(candidate, incumbent)
    || presentationWins(candidate, incumbent)
    || layoutCostWins(candidate, incumbent);
}

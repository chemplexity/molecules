/** @module cleanup/presentation/attached-ring-fallback */

import {
  buildAtomGrid,
  findSevereOverlaps,
  measureDirectAttachedRingJunctionContinuationDistortion,
  measureLayoutCost,
  measureRingSubstituentReadability,
  measureTetrahedralDistortion,
  measureThreeHeavyContinuationDistortion,
  measureTrigonalDistortion
} from '../../audit/invariants.js';
import { auditLayout } from '../../audit/audit.js';
import { computeIncidentRingOutwardAngles } from '../../geometry/ring-direction.js';
import { add, angleOf, angularDifference, centroid, rotate, sub, wrapAngle } from '../../geometry/vec2.js';
import {
  findLayoutBond,
  isExactSimpleAcyclicContinuationEligible,
  isExactVisibleTrigonalBisectorEligible,
  isLinearCenter
} from '../../placement/branch-placement/angle-selection.js';
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
const ATTACHED_RING_FINE_ROTATION_ANGLES = [
  Math.PI / 12,
  -(Math.PI / 12),
  Math.PI / 4,
  -(Math.PI / 4)
];
const ATTACHED_RING_PREFERRED_SIDE_HEAVY_GAP = 3;
const ATTACHED_RING_COUPLED_RESCUE_ANGLES = [
  Math.PI / 12,
  -(Math.PI / 12),
  Math.PI / 6,
  -(Math.PI / 6),
  Math.PI / 4,
  -(Math.PI / 4)
];
const ATTACHED_RING_PERIPHERAL_FOCUS_CLEARANCE_FACTOR = 0.75;
const ATTACHED_RING_PARENT_CONJUGATED_HETERO_ELEMENTS = new Set(['O', 'S', 'Se', 'P']);
const CROWDED_CENTER_HEAVY_ATOM_LIMIT = 60;
const CROWDED_CENTER_MAX_RING_ROOTS = 4;
const CROWDED_CENTER_MAX_SUBTREE_HEAVY_ATOMS = 12;
const CROWDED_CENTER_ROOT_DEVIATION_TRIGGER = Math.PI / 6;
const CROWDED_CENTER_SIBLING_DEVIATION_LIMIT = Math.PI / 18;
const CROWDED_CENTER_MIN_ROOT_PENALTY_IMPROVEMENT = (Math.PI / 18) ** 2;
const CROWDED_CENTER_MAX_TETRAHEDRAL_WORSENING = 0.25;
const CROWDED_CENTER_PRIMARY_ANCHOR_OFFSETS = [
  0,
  Math.PI / 30,
  -(Math.PI / 30),
  Math.PI / 15,
  -(Math.PI / 15),
  Math.PI / 10,
  -(Math.PI / 10),
  Math.PI / 7.5,
  -(Math.PI / 7.5),
  Math.PI / 6,
  -(Math.PI / 6),
  Math.PI / 5,
  -(Math.PI / 5),
  7 * Math.PI / 30,
  -(7 * Math.PI / 30),
  4 * Math.PI / 15,
  -(4 * Math.PI / 15),
  3 * Math.PI / 10,
  -(3 * Math.PI / 10),
  Math.PI / 3,
  -(Math.PI / 3)
];
const CROWDED_CENTER_SIBLING_ANCHOR_OFFSETS = [
  0,
  Math.PI / 30,
  -(Math.PI / 30),
  Math.PI / 15,
  -(Math.PI / 15)
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

function attachedRingAnchorOutwardAngles(layoutGraph, coords, anchorAtomId, otherAtomId = null) {
  const anchorPosition = coords.get(anchorAtomId);
  if (!anchorPosition) {
    return [];
  }

  const outwardAngles = [];
  for (const ring of layoutGraph.atomToRings.get(anchorAtomId) ?? []) {
    if (otherAtomId && ring.atomIds.includes(otherAtomId)) {
      continue;
    }

    const ringNeighborAngles = [];
    for (const bond of layoutGraph.bondsByAtomId.get(anchorAtomId) ?? []) {
      if (!bond || bond.kind !== 'covalent') {
        continue;
      }
      const neighborAtomId = bond.a === anchorAtomId ? bond.b : bond.a;
      if (neighborAtomId === otherAtomId || !ring.atomIds.includes(neighborAtomId) || !coords.has(neighborAtomId)) {
        continue;
      }
      ringNeighborAngles.push(angleOf(sub(coords.get(neighborAtomId), anchorPosition)));
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

function measureDirectAttachmentOutwardPenalty(layoutGraph, coords, focusAtomIds = null, blockedOtherAtomIds = null) {
  const focusSet = focusAtomIds instanceof Set && focusAtomIds.size > 0 ? focusAtomIds : null;
  const blockedSet = blockedOtherAtomIds instanceof Set && blockedOtherAtomIds.size > 0 ? blockedOtherAtomIds : null;
  let totalPenalty = 0;

  for (const [anchorAtomId, anchorPosition] of coords) {
    const anchorRings = layoutGraph.atomToRings.get(anchorAtomId) ?? [];
    if (anchorRings.length === 0) {
      continue;
    }

    const incidentRingAtomIds = new Set(anchorRings.flatMap(ring => ring.atomIds));
    const heavyExocyclicNeighborIds = [];
    for (const bond of layoutGraph.bondsByAtomId.get(anchorAtomId) ?? []) {
      if (!bond || bond.kind !== 'covalent') {
        continue;
      }
      const neighborAtomId = bond.a === anchorAtomId ? bond.b : bond.a;
      const neighborAtom = layoutGraph.atoms.get(neighborAtomId);
      if (!neighborAtom || neighborAtom.element === 'H' || incidentRingAtomIds.has(neighborAtomId) || !coords.has(neighborAtomId)) {
        continue;
      }
      heavyExocyclicNeighborIds.push(neighborAtomId);
    }
    if (heavyExocyclicNeighborIds.length !== 1) {
      continue;
    }

    const otherAtomId = heavyExocyclicNeighborIds[0];
    if (blockedSet && blockedSet.has(otherAtomId)) {
      continue;
    }
    if (focusSet && !focusSet.has(anchorAtomId) && !focusSet.has(otherAtomId)) {
      continue;
    }

    const outwardAngles = [
      ...attachedRingAnchorOutwardAngles(layoutGraph, coords, anchorAtomId, otherAtomId),
      ...computeIncidentRingOutwardAngles(layoutGraph, anchorAtomId, atomId => coords.get(atomId) ?? null)
    ].filter((outwardAngle, index, angles) =>
      angles.findIndex(existingAngle => angularDifference(existingAngle, outwardAngle) <= 1e-9) === index
    );
    if (outwardAngles.length === 0) {
      continue;
    }

    const otherAngle = angleOf(sub(coords.get(otherAtomId), anchorPosition));
    totalPenalty += Math.min(...outwardAngles.map(outwardAngle => angularDifference(otherAngle, outwardAngle) ** 2));
  }

  return totalPenalty;
}

function measureFocusDirectAttachmentOutwardPenalty(layoutGraph, coords, focusAtomIds = null) {
  return measureDirectAttachmentOutwardPenalty(layoutGraph, coords, focusAtomIds);
}

function collectAnchorSideFocusAtomIds(layoutGraph, descriptor, maxDepth = 3) {
  const anchorAtomId = descriptor?.anchorAtomId ?? null;
  if (!anchorAtomId) {
    return null;
  }

  const blockedAtomIds = new Set(descriptor?.subtreeAtomIds ?? []);
  blockedAtomIds.delete(anchorAtomId);

  const focusAtomIds = new Set([anchorAtomId]);
  let frontierAtomIds = new Set([anchorAtomId]);
  for (let depth = 0; depth < maxDepth; depth++) {
    const nextFrontierAtomIds = new Set();
    for (const atomId of frontierAtomIds) {
      for (const bond of layoutGraph.bondsByAtomId.get(atomId) ?? []) {
        if (!bond || bond.kind !== 'covalent') {
          continue;
        }
        const neighborAtomId = bond.a === atomId ? bond.b : bond.a;
        if (blockedAtomIds.has(neighborAtomId) || focusAtomIds.has(neighborAtomId)) {
          continue;
        }
        focusAtomIds.add(neighborAtomId);
        nextFrontierAtomIds.add(neighborAtomId);
      }
    }
    frontierAtomIds = nextFrontierAtomIds;
    if (frontierAtomIds.size === 0) {
      break;
    }
  }

  return focusAtomIds;
}

function measureAttachedRingAnchorSideOutwardPenalty(layoutGraph, coords, descriptor) {
  const focusAtomIds = collectAnchorSideFocusAtomIds(layoutGraph, descriptor);
  if (!focusAtomIds || focusAtomIds.size === 0) {
    return 0;
  }
  return measureDirectAttachmentOutwardPenalty(
    layoutGraph,
    coords,
    focusAtomIds,
    new Set(descriptor?.subtreeAtomIds ?? [])
  );
}

function measureAttachedRingPeripheralFocusClearance(layoutGraph, coords, descriptor, focusAtomIds = null) {
  const focusSet = focusAtomIds instanceof Set && focusAtomIds.size > 0 ? focusAtomIds : null;
  if (!focusSet || !descriptor?.rootAtomId) {
    return 0;
  }

  const rootRingSystemId = layoutGraph.atomToRingSystemId.get(descriptor.rootAtomId);
  if (rootRingSystemId == null) {
    return 0;
  }
  const rootRingSystemAtomIds = new Set(
    layoutGraph.ringSystems.find(ringSystem => ringSystem.id === rootRingSystemId)?.atomIds ?? []
  );
  const subtreeAtomIdSet = new Set(descriptor.subtreeAtomIds);
  const probeAtomIds = descriptor.subtreeAtomIds.filter(atomId => (
    coords.has(atomId)
    && layoutGraph.atoms.get(atomId)?.element !== 'H'
    && !rootRingSystemAtomIds.has(atomId)
  ));
  const blockerAtomIds = [...focusSet].filter(atomId => (
    coords.has(atomId)
    && layoutGraph.atoms.get(atomId)?.element !== 'H'
    && !subtreeAtomIdSet.has(atomId)
  ));
  if (probeAtomIds.length === 0 || blockerAtomIds.length === 0) {
    return 0;
  }

  let minClearance = Number.POSITIVE_INFINITY;
  for (const probeAtomId of probeAtomIds) {
    const probePosition = coords.get(probeAtomId);
    if (!probePosition) {
      continue;
    }
    for (const blockerAtomId of blockerAtomIds) {
      const blockerPosition = coords.get(blockerAtomId);
      if (!blockerPosition) {
        continue;
      }
      minClearance = Math.min(
        minClearance,
        Math.hypot(probePosition.x - blockerPosition.x, probePosition.y - blockerPosition.y)
      );
    }
  }

  return Number.isFinite(minClearance) ? minClearance : 0;
}

function measureAttachedRingRootOutwardPenalty(layoutGraph, coords, descriptor, focusAtomIds = null) {
  const parentAtomId = descriptor?.anchorAtomId ?? null;
  const rootAtomId = descriptor?.rootAtomId ?? null;
  if (!parentAtomId || !rootAtomId || !coords.has(parentAtomId) || !coords.has(rootAtomId)) {
    return 0;
  }

  let penalty = 0;
  const rootOutwardAngles = attachedRingRootOutwardAngles(layoutGraph, coords, rootAtomId, parentAtomId);
  if (rootOutwardAngles.length > 0) {
    const parentAngle = angleOf(sub(coords.get(parentAtomId), coords.get(rootAtomId)));
    penalty += Math.min(...rootOutwardAngles.map(outwardAngle => angularDifference(parentAngle, outwardAngle) ** 2));
  }

  return penalty + measureFocusDirectAttachmentOutwardPenalty(layoutGraph, coords, focusAtomIds);
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
    && candidate.parentVisibleTrigonalPenalty <= 1e-6
    && candidate.rootOutwardPenalty <= 1e-6
    && candidate.trigonalBisectorPenalty <= 1e-6
    && (candidate.omittedHydrogenTrigonalPenalty ?? 0) <= 1e-6
    && candidate.trigonalDistortionPenalty <= 1e-6
    && (candidate.tetrahedralDistortionPenalty ?? 0) <= 1e-6
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
    && Math.abs((candidate.peripheralFocusClearance ?? 0) - (incumbent.peripheralFocusClearance ?? 0)) <= 1e-6
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

function measureAttachedRingTrigonalDistortion(layoutGraph, coords, options = {}) {
  const trigonalDistortion = measureTrigonalDistortion(layoutGraph, coords, options);
  const threeHeavyContinuationDistortion = measureThreeHeavyContinuationDistortion(layoutGraph, coords, options);
  return {
    centerCount: trigonalDistortion.centerCount + threeHeavyContinuationDistortion.centerCount,
    totalDeviation: trigonalDistortion.totalDeviation + threeHeavyContinuationDistortion.totalDeviation,
    maxDeviation: Math.max(trigonalDistortion.maxDeviation, threeHeavyContinuationDistortion.maxDeviation)
  };
}

/**
 * Measures exact acyclic continuation distortion for simple divalent centers.
 * Trigonal alkene/carbonyl continuations target `120°`, while alkyne-like
 * linear centers target `180°`.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Candidate coordinate map.
 * @param {Set<string>|null} [focusAtomIds] - Optional focus atoms for local scoring.
 * @returns {{centerCount: number, totalDeviation: number, maxDeviation: number}} Continuation distortion statistics.
 */
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

    const idealSeparation = isLinearCenter(layoutGraph, atomId) ? Math.PI : (2 * Math.PI) / 3;
    const deviation = (
      angularDifference(
        angleOf(sub(coords.get(firstNeighborAtomId), coords.get(atomId))),
        angleOf(sub(coords.get(secondNeighborAtomId), coords.get(atomId)))
      ) - idealSeparation
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
 * Returns whether an attached-ring descriptor should preserve an exact
 * parent-side trigonal attachment angle at its anchor atom. This covers both
 * visible trigonal aromatic anchors and conjugated amide-like nitrogens whose
 * `120/120/120` spread should survive presentation cleanup.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {string} parentAtomId - Anchor atom on the fixed side of the attachment bond.
 * @param {string} attachmentAtomId - Attached-ring root atom on the movable side.
 * @returns {boolean} True when the parent anchor has an exact trigonal slot to preserve.
 */
function supportsExactAttachedRingParentPreferredAngle(layoutGraph, parentAtomId, attachmentAtomId) {
  if (!parentAtomId || !attachmentAtomId) {
    return false;
  }

  const attachmentBond = findLayoutBond(layoutGraph, parentAtomId, attachmentAtomId);
  if (
    !attachmentBond
    || attachmentBond.kind !== 'covalent'
    || attachmentBond.aromatic
    || (attachmentBond.order ?? 1) !== 1
  ) {
    return false;
  }

  if (
    layoutGraph.atoms.get(attachmentAtomId)?.aromatic
    && isExactVisibleTrigonalBisectorEligible(layoutGraph, parentAtomId, attachmentAtomId)
  ) {
    return true;
  }

  const parentAtom = layoutGraph.atoms.get(parentAtomId);
  if (
    !parentAtom
    || parentAtom.element !== 'N'
    || parentAtom.aromatic
    || parentAtom.heavyDegree !== 3
    || parentAtom.degree !== 3
    || (layoutGraph.atomToRings.get(parentAtomId)?.length ?? 0) > 0
  ) {
    return false;
  }

  let otherHeavyNeighborCount = 0;
  let conjugatedHeteroMultipleNeighborCount = 0;
  for (const bond of layoutGraph.bondsByAtomId.get(parentAtomId) ?? []) {
    if (!bond || bond.kind !== 'covalent') {
      continue;
    }
    const neighborAtomId = bond.a === parentAtomId ? bond.b : bond.a;
    const neighborAtom = layoutGraph.atoms.get(neighborAtomId);
    if (!neighborAtom || neighborAtom.element === 'H' || neighborAtomId === attachmentAtomId) {
      continue;
    }
    otherHeavyNeighborCount++;
    if (bond.aromatic || (bond.order ?? 1) !== 1 || neighborAtom.aromatic) {
      continue;
    }
    for (const neighborBond of layoutGraph.bondsByAtomId.get(neighborAtomId) ?? []) {
      if (!neighborBond || neighborBond.kind !== 'covalent' || neighborBond.aromatic || (neighborBond.order ?? 1) < 2) {
        continue;
      }
      const heteroAtomId = neighborBond.a === neighborAtomId ? neighborBond.b : neighborBond.a;
      if (heteroAtomId === parentAtomId) {
        continue;
      }
      const heteroAtom = layoutGraph.atoms.get(heteroAtomId);
      if (!heteroAtom || !ATTACHED_RING_PARENT_CONJUGATED_HETERO_ELEMENTS.has(heteroAtom.element)) {
        continue;
      }
      conjugatedHeteroMultipleNeighborCount++;
      break;
    }
  }

  return otherHeavyNeighborCount === 2 && conjugatedHeteroMultipleNeighborCount === 1;
}

/**
 * Returns the exact parent-side trigonal target angle for an attached-ring
 * descriptor whose anchor should stay centered between its two other heavy
 * neighbors.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Candidate coordinate map.
 * @param {string} parentAtomId - Anchor atom on the fixed side of the attachment bond.
 * @param {string} attachmentAtomId - Attached-ring root atom on the movable side.
 * @returns {number|null} Exact parent-side target angle in radians, or `null`.
 */
function attachedRingParentPreferredAngle(layoutGraph, coords, parentAtomId, attachmentAtomId) {
  if (!supportsExactAttachedRingParentPreferredAngle(layoutGraph, parentAtomId, attachmentAtomId) || !coords.has(parentAtomId)) {
    return null;
  }

  const otherHeavyNeighborIds = [];
  for (const bond of layoutGraph.bondsByAtomId.get(parentAtomId) ?? []) {
    if (!bond || bond.kind !== 'covalent') {
      continue;
    }
    const neighborAtomId = bond.a === parentAtomId ? bond.b : bond.a;
    const neighborAtom = layoutGraph.atoms.get(neighborAtomId);
    if (!neighborAtom || neighborAtom.element === 'H' || neighborAtomId === attachmentAtomId || !coords.has(neighborAtomId)) {
      continue;
    }
    otherHeavyNeighborIds.push(neighborAtomId);
  }
  if (otherHeavyNeighborIds.length !== 2) {
    return null;
  }

  return angleOf(sub(
    coords.get(parentAtomId),
    centroid(otherHeavyNeighborIds.map(neighborAtomId => coords.get(neighborAtomId)))
  ));
}

/**
 * Penalizes attached-ring fallback candidates that bend any exact parent-side
 * trigonal center inside the current cleanup focus region away from its
 * chemically preferred slot.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Candidate coordinate map.
 * @param {Set<string>|null} [focusAtomIds] - Optional focus atoms for local scoring.
 * @returns {number} Summed squared parent-side trigonal deviation.
 */
function measureAttachedRingParentVisibleTrigonalPenalty(layoutGraph, coords, focusAtomIds = null) {
  const focusSet = focusAtomIds instanceof Set && focusAtomIds.size > 0 ? focusAtomIds : null;
  let totalPenalty = 0;

  for (const [parentAtomId, parentPosition] of coords) {
    if (focusSet && !focusSet.has(parentAtomId)) {
      continue;
    }
    const parentAtom = layoutGraph.atoms.get(parentAtomId);
    if (!parentAtom || parentAtom.element === 'H') {
      continue;
    }

    for (const bond of layoutGraph.bondsByAtomId.get(parentAtomId) ?? []) {
      if (!bond || bond.kind !== 'covalent') {
        continue;
      }
      const attachmentAtomId = bond.a === parentAtomId ? bond.b : bond.a;
      const attachmentAtom = layoutGraph.atoms.get(attachmentAtomId);
      if (!attachmentAtom || attachmentAtom.element === 'H' || !coords.has(attachmentAtomId)) {
        continue;
      }
      const idealAttachmentAngle = attachedRingParentPreferredAngle(layoutGraph, coords, parentAtomId, attachmentAtomId);
      if (idealAttachmentAngle == null) {
        continue;
      }
      const attachmentAngle = angleOf(sub(coords.get(attachmentAtomId), parentPosition));
      totalPenalty += angularDifference(attachmentAngle, idealAttachmentAngle) ** 2;
    }
  }

  return totalPenalty;
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
  const totalHeavyAtomCount = [...coords.keys()].reduce(
    (count, atomId) => count + (layoutGraph.atoms.get(atomId)?.element === 'H' ? 0 : 1),
    0
  );
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

    const bondDescriptors = [];
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
      bondDescriptors.push({
        descriptor,
        heavyAtomCount
      });
    }

    if (bondDescriptors.length === 0) {
      continue;
    }

    let acceptedBondDescriptors = bondDescriptors;
    if (bondDescriptors.length === 2) {
      const orderedBondDescriptors = [...bondDescriptors].sort((firstDescriptor, secondDescriptor) => (
        firstDescriptor.heavyAtomCount - secondDescriptor.heavyAtomCount
        || firstDescriptor.descriptor.subtreeAtomIds.length - secondDescriptor.descriptor.subtreeAtomIds.length
      ));
      const [smallerDescriptor, largerDescriptor] = orderedBondDescriptors;
      const heavyGap = largerDescriptor.heavyAtomCount - smallerDescriptor.heavyAtomCount;
      if (
        heavyGap >= ATTACHED_RING_PREFERRED_SIDE_HEAVY_GAP
        && largerDescriptor.heavyAtomCount > totalHeavyAtomCount / 2
      ) {
        acceptedBondDescriptors = [smallerDescriptor];
      }
    }

    for (const descriptorRecord of acceptedBondDescriptors) {
      uniqueDescriptors.set(rigidDescriptorKey(descriptorRecord.descriptor), descriptorRecord.descriptor);
    }
  }
  return [...uniqueDescriptors.values()];
}

/**
 * Measures how strongly attached-ring layouts still crowd an anchor-side focus
 * with a peripheral tail that could be cleared by a root-anchored rescue.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Current coordinate map.
 * @param {number} [bondLength] - Target bond length.
 * @returns {number} Summed peripheral-focus clearance deficit.
 */
export function measureAttachedRingPeripheralFocusPenalty(layoutGraph, coords, bondLength = layoutGraph.options.bondLength) {
  const rescueThreshold = bondLength * ATTACHED_RING_PERIPHERAL_FOCUS_CLEARANCE_FACTOR;
  let totalPenalty = 0;

  for (const descriptor of collectMovableAttachedRingDescriptors(layoutGraph, coords)) {
    if (!supportsRootAnchoredAttachedRingRotation(layoutGraph, descriptor)) {
      continue;
    }
    const focusAtomIds = expandFocusAtomIds(
      layoutGraph,
      new Set([descriptor.anchorAtomId, descriptor.rootAtomId, ...descriptor.subtreeAtomIds])
    );
    const clearance = measureAttachedRingPeripheralFocusClearance(layoutGraph, coords, descriptor, focusAtomIds);
    if (clearance <= 0 || clearance >= rescueThreshold - 1e-6) {
      continue;
    }
    totalPenalty += rescueThreshold - clearance;
  }

  return totalPenalty;
}

/**
 * Measures direct-attached ring root outward error for presentation scoring.
 * This captures crowded non-ring centers where a ring subtree is overlap-free
 * but visibly rotated off the ring atom's own exterior axis.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Current coordinate map.
 * @param {Set<string>|null} [frozenAtomIds] - Optional atoms that must not move.
 * @returns {number} Summed squared attached-ring root outward penalty.
 */
export function measureAttachedRingRootOutwardPresentationPenalty(layoutGraph, coords, frozenAtomIds = null) {
  let totalPenalty = 0;
  for (const descriptor of collectMovableAttachedRingDescriptors(layoutGraph, coords, frozenAtomIds)) {
    totalPenalty += measureAttachedRingRootOutwardPenalty(layoutGraph, coords, descriptor);
  }
  return totalPenalty;
}

/**
 * Counts non-hydrogen atoms in a candidate subtree.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {string[]} atomIds - Atom IDs to inspect.
 * @returns {number} Heavy atom count.
 */
function countHeavyAtoms(layoutGraph, atomIds) {
  let heavyAtomCount = 0;
  for (const atomId of atomIds) {
    const atom = layoutGraph.atoms.get(atomId);
    if (atom && atom.element !== 'H') {
      heavyAtomCount++;
    }
  }
  return heavyAtomCount;
}

/**
 * Measures how far a direct-attached ring root is from pointing its parent
 * bond along the ring atom's exterior bisector.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Coordinate map.
 * @param {string} rootAtomId - Ring root atom ID.
 * @param {string} parentAtomId - Parent atom attached to the ring root.
 * @returns {{deviation: number, correction: number}|null} Best outward fit, or null.
 */
function directAttachedRingRootOutwardFit(layoutGraph, coords, rootAtomId, parentAtomId) {
  const rootPosition = coords.get(rootAtomId);
  const parentPosition = coords.get(parentAtomId);
  if (!rootPosition || !parentPosition) {
    return null;
  }

  const parentAngle = angleOf(sub(parentPosition, rootPosition));
  let bestFit = null;
  for (const outwardAngle of attachedRingRootOutwardAngles(layoutGraph, coords, rootAtomId, parentAtomId)) {
    const deviation = angularDifference(parentAngle, outwardAngle);
    const correction = wrapAngle(parentAngle - outwardAngle);
    if (!bestFit || deviation < bestFit.deviation) {
      bestFit = {
        deviation,
        correction
      };
    }
  }

  return bestFit;
}

/**
 * Scores all ring roots around a crowded center by summed outward deviation.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Coordinate map.
 * @param {Array<{rootAtomId: string, centerAtomId: string}>} rootRecords - Attached ring root records.
 * @returns {number} Summed squared root-outward penalty.
 */
function crowdedCenterRootPenalty(layoutGraph, coords, rootRecords) {
  let penalty = 0;
  for (const record of rootRecords) {
    const fit = directAttachedRingRootOutwardFit(layoutGraph, coords, record.rootAtomId, record.centerAtomId);
    if (fit) {
      penalty += fit.deviation ** 2;
    }
  }
  return penalty;
}

/**
 * Finds compact non-ring centers with several directly attached movable ring
 * blocks where one root visibly misses its own exterior axis.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Coordinate map.
 * @param {Set<string>|null} [frozenAtomIds] - Optional atoms that must not move.
 * @returns {Array<{centerAtomId: string, rootRecords: object[]}>} Crowded center descriptors.
 */
function collectCrowdedAttachedRingCenterDescriptors(layoutGraph, coords, frozenAtomIds = null) {
  if ((layoutGraph.traits.heavyAtomCount ?? 0) > CROWDED_CENTER_HEAVY_ATOM_LIMIT) {
    return [];
  }

  const descriptors = [];
  for (const [centerAtomId, centerPosition] of coords) {
    if (!centerPosition) {
      continue;
    }
    const centerAtom = layoutGraph.atoms.get(centerAtomId);
    if (
      !centerAtom
      || centerAtom.element === 'H'
      || centerAtom.aromatic
      || centerAtom.chirality
      || centerAtom.heavyDegree < 3
      || (layoutGraph.atomToRings.get(centerAtomId)?.length ?? 0) > 0
    ) {
      continue;
    }

    const rootRecords = [];
    let allHeavyBondsAreSingle = true;
    for (const bond of layoutGraph.bondsByAtomId.get(centerAtomId) ?? []) {
      if (!bond || bond.kind !== 'covalent') {
        continue;
      }
      const rootAtomId = bond.a === centerAtomId ? bond.b : bond.a;
      const rootAtom = layoutGraph.atoms.get(rootAtomId);
      if (!rootAtom || rootAtom.element === 'H') {
        continue;
      }
      if (bond.aromatic || (bond.order ?? 1) !== 1) {
        allHeavyBondsAreSingle = false;
        break;
      }
      if ((layoutGraph.atomToRings.get(rootAtomId)?.length ?? 0) === 0 || rootAtom.chirality) {
        continue;
      }

      const subtreeAtomIds = [...collectCutSubtree(layoutGraph, rootAtomId, centerAtomId)].filter(atomId => coords.has(atomId));
      const subtreeHeavyAtomCount = countHeavyAtoms(layoutGraph, subtreeAtomIds);
      if (
        subtreeAtomIds.length === 0
        || subtreeHeavyAtomCount === 0
        || subtreeHeavyAtomCount > CROWDED_CENTER_MAX_SUBTREE_HEAVY_ATOMS
        || subtreeAtomIds.some(atomId => layoutGraph.fixedCoords.has(atomId))
        || (frozenAtomIds && containsFrozenAtom(subtreeAtomIds, frozenAtomIds))
      ) {
        continue;
      }

      const fit = directAttachedRingRootOutwardFit(layoutGraph, coords, rootAtomId, centerAtomId);
      if (!fit) {
        continue;
      }
      rootRecords.push({
        centerAtomId,
        rootAtomId,
        subtreeAtomIds,
        subtreeHeavyAtomCount,
        rootOutwardDeviation: fit.deviation,
        rootCorrection: fit.correction
      });
    }

    if (
      !allHeavyBondsAreSingle
      || rootRecords.length < 3
      || rootRecords.length > CROWDED_CENTER_MAX_RING_ROOTS
      || !rootRecords.some(record => record.rootOutwardDeviation > CROWDED_CENTER_ROOT_DEVIATION_TRIGGER)
    ) {
      continue;
    }

    descriptors.push({
      centerAtomId,
      rootRecords
    });
  }

  return descriptors;
}

/**
 * Returns the center-anchor rotation offsets to try for one attached ring record.
 * @param {{rootAtomId: string, rootOutwardDeviation: number}} record - Attached ring record.
 * @param {string} targetRootAtomId - Root currently being repaired exactly.
 * @returns {number[]} Candidate anchor offsets in radians.
 */
function crowdedCenterAnchorOffsetsForRecord(record, targetRootAtomId) {
  if (record.rootAtomId === targetRootAtomId) {
    return CROWDED_CENTER_PRIMARY_ANCHOR_OFFSETS;
  }
  return record.rootOutwardDeviation <= CROWDED_CENTER_SIBLING_DEVIATION_LIMIT
    ? CROWDED_CENTER_SIBLING_ANCHOR_OFFSETS
    : [0];
}

/**
 * Builds a candidate pose by exact-rotating one ring around its root, then
 * applying small anchor rotations around the crowded center.
 * @param {Map<string, {x: number, y: number}>} coords - Source coordinate map.
 * @param {{centerAtomId: string, rootRecords: object[]}} descriptor - Crowded center descriptor.
 * @param {string} targetRootAtomId - Root to align to its exterior axis.
 * @param {Map<string, number>} anchorOffsetsByRootAtomId - Center-anchor offset by root atom.
 * @returns {Map<string, {x: number, y: number}>|null} Candidate coordinates.
 */
function buildCrowdedCenterCandidateCoords(coords, descriptor, targetRootAtomId, anchorOffsetsByRootAtomId) {
  const centerPosition = coords.get(descriptor.centerAtomId);
  if (!centerPosition) {
    return null;
  }

  const candidateCoords = new Map(coords);
  for (const record of descriptor.rootRecords) {
    const rootPosition = coords.get(record.rootAtomId);
    if (!rootPosition) {
      return null;
    }
    const rootCorrection = record.rootAtomId === targetRootAtomId ? record.rootCorrection : 0;
    const anchorOffset = anchorOffsetsByRootAtomId.get(record.rootAtomId) ?? 0;
    for (const atomId of record.subtreeAtomIds) {
      const currentPosition = coords.get(atomId);
      if (!currentPosition) {
        continue;
      }
      let nextPosition = currentPosition;
      if (atomId !== record.rootAtomId && Math.abs(rootCorrection) > 1e-9) {
        nextPosition = add(rootPosition, rotate(sub(nextPosition, rootPosition), rootCorrection));
      }
      if (Math.abs(anchorOffset) > 1e-9) {
        nextPosition = add(centerPosition, rotate(sub(nextPosition, centerPosition), anchorOffset));
      }
      candidateCoords.set(atomId, nextPosition);
    }
  }

  return candidateCoords;
}

/**
 * Visits the bounded Cartesian product of center-anchor offsets for a crowded center.
 * @param {{rootRecords: object[]}} descriptor - Crowded center descriptor.
 * @param {string} targetRootAtomId - Root currently being repaired exactly.
 * @param {(offsetsByRootAtomId: Map<string, number>) => void} visitor - Candidate visitor.
 * @returns {void}
 */
function visitCrowdedCenterAnchorOffsetCombinations(descriptor, targetRootAtomId, visitor) {
  const records = descriptor.rootRecords;
  const offsetsByRootAtomId = new Map();
  const visitRecord = index => {
    if (index >= records.length) {
      visitor(offsetsByRootAtomId);
      return;
    }
    const record = records[index];
    for (const offset of crowdedCenterAnchorOffsetsForRecord(record, targetRootAtomId)) {
      offsetsByRootAtomId.set(record.rootAtomId, offset);
      visitRecord(index + 1);
    }
    offsetsByRootAtomId.delete(record.rootAtomId);
  };
  visitRecord(0);
}

/**
 * Builds a candidate score compatible with the attached-ring fallback scorer.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Candidate coordinate map.
 * @param {{centerAtomId: string, rootRecords: object[]}} descriptor - Crowded center descriptor.
 * @param {number} bondLength - Target bond length.
 * @param {number} rootPenalty - Precomputed root-outward penalty.
 * @returns {object} Candidate score.
 */
function buildCrowdedAttachedRingCenterScore(layoutGraph, coords, descriptor, bondLength, rootPenalty) {
  const audit = auditLayout(layoutGraph, coords, { bondLength });
  const readability = measureRingSubstituentReadability(layoutGraph, coords);
  const focusAtomIds = expandFocusAtomIds(
    layoutGraph,
    new Set([descriptor.centerAtomId, ...descriptor.rootRecords.map(record => record.rootAtomId)])
  );
  const trigonalDistortion = measureAttachedRingTrigonalDistortion(layoutGraph, coords, { focusAtomIds });
  return {
    coords,
    nudges: 1,
    crowdedAttachedRingCenter: true,
    overlapCount: audit.severeOverlapCount,
    exactContinuationPenalty: measureExactAcyclicContinuationDistortion(layoutGraph, coords, focusAtomIds).totalDeviation,
    parentVisibleTrigonalPenalty: measureAttachedRingParentVisibleTrigonalPenalty(layoutGraph, coords, focusAtomIds),
    anchorSideOutwardPenalty: rootPenalty,
    rootOutwardPenalty: rootPenalty,
    trigonalBisectorPenalty: 0,
    omittedHydrogenTrigonalPenalty: measureThreeHeavyContinuationDistortion(layoutGraph, coords, { focusAtomIds }).totalDeviation,
    trigonalDistortionPenalty: trigonalDistortion.totalDeviation,
    tetrahedralDistortionPenalty: measureTetrahedralDistortion(layoutGraph, coords).totalDeviation,
    subtreeClearance: null,
    failingSubstituentCount: readability.failingSubstituentCount ?? 0,
    inwardSubstituentCount: readability.inwardSubstituentCount ?? 0,
    outwardAxisFailureCount: readability.outwardAxisFailureCount ?? 0,
    globalFailingSubstituentCount: readability.failingSubstituentCount ?? 0,
    globalInwardSubstituentCount: readability.inwardSubstituentCount ?? 0,
    globalOutwardAxisFailureCount: readability.outwardAxisFailureCount ?? 0,
    totalOutwardDeviation: readability.totalOutwardDeviation ?? 0,
    maxOutwardDeviation: readability.maxOutwardDeviation ?? 0,
    presentationImprovement: 0,
    layoutCost: measureLayoutCost(layoutGraph, coords, bondLength),
    localPoseKey: attachedRingLocalPoseKey(layoutGraph, coords, {
      rootAtomId: descriptor.centerAtomId,
      anchorAtomId: descriptor.rootRecords[0]?.rootAtomId,
      subtreeAtomIds: descriptor.rootRecords.flatMap(record => record.subtreeAtomIds)
    }),
    audit
  };
}

/**
 * Chooses between crowded-center attached-ring candidates.
 * @param {object} candidate - Candidate score.
 * @param {object|null} incumbent - Current best candidate score.
 * @returns {boolean} True when candidate is preferred.
 */
function isBetterCrowdedAttachedRingCenterScore(candidate, incumbent) {
  if (!incumbent) {
    return true;
  }
  if (candidate.audit.ok !== incumbent.audit.ok) {
    return candidate.audit.ok;
  }
  if (candidate.audit.severeOverlapCount !== incumbent.audit.severeOverlapCount) {
    return candidate.audit.severeOverlapCount < incumbent.audit.severeOverlapCount;
  }
  if (candidate.audit.ringSubstituentReadabilityFailureCount !== incumbent.audit.ringSubstituentReadabilityFailureCount) {
    return candidate.audit.ringSubstituentReadabilityFailureCount < incumbent.audit.ringSubstituentReadabilityFailureCount;
  }
  if (Math.abs(candidate.rootOutwardPenalty - incumbent.rootOutwardPenalty) > 1e-6) {
    return candidate.rootOutwardPenalty < incumbent.rootOutwardPenalty;
  }
  if (Math.abs(candidate.tetrahedralDistortionPenalty - incumbent.tetrahedralDistortionPenalty) > 1e-6) {
    return candidate.tetrahedralDistortionPenalty < incumbent.tetrahedralDistortionPenalty;
  }
  return candidate.layoutCost < incumbent.layoutCost - 1e-6;
}

/**
 * Searches for a bounded crowded-center ring-root repair before the general
 * attached-ring fallback tries broader local rotations.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Starting coordinate map.
 * @param {number} bondLength - Target bond length.
 * @param {Set<string>|null} [frozenAtomIds] - Optional atoms that must not move.
 * @returns {object|null} Best accepted candidate, or null.
 */
function findBestCrowdedAttachedRingCenterCandidate(layoutGraph, coords, bondLength, frozenAtomIds = null) {
  const descriptors = collectCrowdedAttachedRingCenterDescriptors(layoutGraph, coords, frozenAtomIds);
  if (descriptors.length === 0) {
    return null;
  }

  let bestAcceptedCandidate = null;
  for (const descriptor of descriptors) {
    const baseRootPenalty = crowdedCenterRootPenalty(layoutGraph, coords, descriptor.rootRecords);
    const baseScore = buildCrowdedAttachedRingCenterScore(layoutGraph, coords, descriptor, bondLength, baseRootPenalty);
    let bestCandidate = null;
    for (const targetRecord of descriptor.rootRecords.filter(record => record.rootOutwardDeviation > CROWDED_CENTER_ROOT_DEVIATION_TRIGGER)) {
      visitCrowdedCenterAnchorOffsetCombinations(descriptor, targetRecord.rootAtomId, anchorOffsetsByRootAtomId => {
        const candidateCoords = buildCrowdedCenterCandidateCoords(
          coords,
          descriptor,
          targetRecord.rootAtomId,
          anchorOffsetsByRootAtomId
        );
        if (!candidateCoords) {
          return;
        }
        const rootPenalty = crowdedCenterRootPenalty(layoutGraph, candidateCoords, descriptor.rootRecords);
        if (rootPenalty >= baseRootPenalty - CROWDED_CENTER_MIN_ROOT_PENALTY_IMPROVEMENT) {
          return;
        }
        const candidateScore = buildCrowdedAttachedRingCenterScore(
          layoutGraph,
          candidateCoords,
          descriptor,
          bondLength,
          rootPenalty
        );
        if (
          baseScore.audit.ok
          && !candidateScore.audit.ok
        ) {
          return;
        }
        if (
          candidateScore.audit.bondLengthFailureCount > baseScore.audit.bondLengthFailureCount
          || candidateScore.audit.labelOverlapCount > baseScore.audit.labelOverlapCount
          || candidateScore.tetrahedralDistortionPenalty > baseScore.tetrahedralDistortionPenalty + CROWDED_CENTER_MAX_TETRAHEDRAL_WORSENING
        ) {
          return;
        }
        if (isBetterCrowdedAttachedRingCenterScore(candidateScore, bestCandidate)) {
          bestCandidate = candidateScore;
        }
      });
    }

    if (
      bestCandidate
      && bestCandidate.rootOutwardPenalty < baseScore.rootOutwardPenalty - CROWDED_CENTER_MIN_ROOT_PENALTY_IMPROVEMENT
      && isBetterAttachedRingCandidate(bestCandidate, bestAcceptedCandidate)
    ) {
      bestAcceptedCandidate = bestCandidate;
    }
  }

  return bestAcceptedCandidate;
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
    let bestCandidate = findBestCrowdedAttachedRingCenterCandidate(layoutGraph, currentCoords, bondLength, frozenAtomIds);

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
      const baseParentVisibleTrigonalPenalty = measureAttachedRingParentVisibleTrigonalPenalty(layoutGraph, currentCoords, focusAtomIds);
      const baseRootOutwardPenalty = measureAttachedRingRootOutwardPenalty(layoutGraph, currentCoords, descriptor, focusAtomIds);
      const baseTrigonalBisectorPenalty = measureDirectAttachmentTrigonalBisectorPenalty(layoutGraph, currentCoords, descriptor);
      const baseOmittedHydrogenTrigonalPenalty = measureThreeHeavyContinuationDistortion(layoutGraph, currentCoords).totalDeviation;
      const baseTrigonalDistortionPenalty = measureAttachedRingTrigonalDistortion(layoutGraph, currentCoords, { focusAtomIds }).totalDeviation;
      const baseTetrahedralDistortionPenalty = measureTetrahedralDistortion(layoutGraph, currentCoords).totalDeviation;
      const baseSubtreeClearance = measureAttachedCarbonylSubtreeClearance(layoutGraph, currentCoords, descriptor);
      const baseSmallRingExteriorPenalty = measureTotalSmallRingExteriorGapPenalty(layoutGraph, currentCoords, focusAtomIds);
      const baseReadability = measureRingSubstituentReadability(layoutGraph, currentCoords, {
        focusAtomIds
      });
      const basePeripheralFocusClearance = measureAttachedRingPeripheralFocusClearance(
        layoutGraph,
        currentCoords,
        descriptor,
        focusAtomIds
      );
      const needsPeripheralFocusClearanceRescue =
        basePeripheralFocusClearance > 0
        && basePeripheralFocusClearance < bondLength * ATTACHED_RING_PERIPHERAL_FOCUS_CLEARANCE_FACTOR - 1e-6;
      const buildCandidateScore = (candidateCoords, nudges) => {
        const overlapCount = findSevereOverlaps(layoutGraph, candidateCoords, bondLength).length;
        if (overlapCount > baseOverlapCount) {
          buildCandidateScore.lastRejectReason = 'overlap-count';
          return null;
        }
        const reducesOverlapCount = baseOverlapCount > 0 && overlapCount < baseOverlapCount;
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
        const peripheralFocusClearance = measureAttachedRingPeripheralFocusClearance(
          layoutGraph,
          candidateCoords,
          descriptor,
          focusAtomIds
        );
        const improvesPeripheralFocusClearance =
          needsPeripheralFocusClearanceRescue
          && peripheralFocusClearance > basePeripheralFocusClearance + 0.25;
        const parentVisibleTrigonalPenalty = measureAttachedRingParentVisibleTrigonalPenalty(layoutGraph, candidateCoords, focusAtomIds);
        if (
          parentVisibleTrigonalPenalty > baseParentVisibleTrigonalPenalty + 1e-6
          && !reducesOverlapCount
          && !improvesPeripheralFocusClearance
        ) {
          buildCandidateScore.lastRejectReason = 'parent-visible-trigonal';
          return null;
        }
        const rootOutwardPenalty = measureAttachedRingRootOutwardPenalty(layoutGraph, candidateCoords, descriptor, focusAtomIds);
        if (rootOutwardPenalty > baseRootOutwardPenalty + 1e-6 && !reducesOverlapCount && !improvesPeripheralFocusClearance) {
          buildCandidateScore.lastRejectReason = 'root-outward';
          return null;
        }
        const trigonalBisectorPenalty = measureDirectAttachmentTrigonalBisectorPenalty(layoutGraph, candidateCoords, descriptor);
        if (trigonalBisectorPenalty > baseTrigonalBisectorPenalty + 1e-6) {
          buildCandidateScore.lastRejectReason = 'trigonal-bisector';
          return null;
        }
        const omittedHydrogenTrigonalPenalty = measureThreeHeavyContinuationDistortion(layoutGraph, candidateCoords).totalDeviation;
        if (omittedHydrogenTrigonalPenalty > baseOmittedHydrogenTrigonalPenalty + 1e-6 && !reducesOverlapCount && !improvesPeripheralFocusClearance) {
          buildCandidateScore.lastRejectReason = 'omitted-hydrogen-trigonal';
          return null;
        }
        const trigonalDistortionPenalty = measureAttachedRingTrigonalDistortion(layoutGraph, candidateCoords, { focusAtomIds }).totalDeviation;
        if (trigonalDistortionPenalty > baseTrigonalDistortionPenalty + 1e-6 && !reducesOverlapCount && !improvesPeripheralFocusClearance) {
          buildCandidateScore.lastRejectReason = 'trigonal-distortion';
          return null;
        }
        const tetrahedralDistortionPenalty = measureTetrahedralDistortion(layoutGraph, candidateCoords).totalDeviation;
        if (tetrahedralDistortionPenalty > baseTetrahedralDistortionPenalty + 1e-6 && !reducesOverlapCount && !improvesPeripheralFocusClearance) {
          buildCandidateScore.lastRejectReason = 'tetrahedral-distortion';
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
          && !reducesOverlapCount
          && !improvesPeripheralFocusClearance
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
          parentVisibleTrigonalPenalty,
          anchorSideOutwardPenalty: measureAttachedRingAnchorSideOutwardPenalty(layoutGraph, candidateCoords, descriptor),
          peripheralFocusClearance,
          rootOutwardPenalty,
          trigonalBisectorPenalty,
          omittedHydrogenTrigonalPenalty,
          trigonalDistortionPenalty,
          tetrahedralDistortionPenalty,
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
          basePeripheralFocusClearance,
          peripheralFocusRescueThreshold: bondLength * ATTACHED_RING_PERIPHERAL_FOCUS_CLEARANCE_FACTOR,
          peripheralFocusRescueEligible: needsPeripheralFocusClearanceRescue,
          presentationImprovement: basePresentationPenalty - presentationPenalty,
          layoutCost: measureLayoutCost(layoutGraph, candidateCoords, bondLength),
          localPoseKey: attachedRingLocalPoseKey(layoutGraph, candidateCoords, descriptor)
        };
      };
      const buildPeripheralFocusRescueScore = (candidateCoords, nudges) => {
        if (!needsPeripheralFocusClearanceRescue) {
          return null;
        }
        const overlapCount = findSevereOverlaps(layoutGraph, candidateCoords, bondLength).length;
        if (overlapCount > baseOverlapCount) {
          return null;
        }
        const junctionContinuationPenalty = measureDirectAttachedRingJunctionContinuationDistortion(layoutGraph, candidateCoords, { focusAtomIds }).totalDeviation;
        if (junctionContinuationPenalty > baseJunctionContinuationPenalty + 1e-6) {
          return null;
        }
        const exactContinuationPenalty = measureExactAcyclicContinuationDistortion(layoutGraph, candidateCoords, focusAtomIds).totalDeviation;
        if (exactContinuationPenalty > baseExactContinuationPenalty + 1e-6) {
          return null;
        }
        const trigonalBisectorPenalty = measureDirectAttachmentTrigonalBisectorPenalty(layoutGraph, candidateCoords, descriptor);
        if (trigonalBisectorPenalty > baseTrigonalBisectorPenalty + 1e-6) {
          return null;
        }
        const readability = measureRingSubstituentReadability(layoutGraph, candidateCoords, {
          focusAtomIds
        });
        const globalReadability = measureRingSubstituentReadability(layoutGraph, candidateCoords);
        if (readabilityTupleWorsens(readability, baseReadability) || readabilityTupleWorsens(globalReadability, baseGlobalReadability)) {
          return null;
        }
        const smallRingExteriorPenalty = measureTotalSmallRingExteriorGapPenalty(layoutGraph, candidateCoords, focusAtomIds);
        if (smallRingExteriorPenalty > baseSmallRingExteriorPenalty + 1e-6) {
          return null;
        }
        const peripheralFocusClearance = measureAttachedRingPeripheralFocusClearance(
          layoutGraph,
          candidateCoords,
          descriptor,
          focusAtomIds
        );
        if (peripheralFocusClearance <= basePeripheralFocusClearance + 0.25) {
          return null;
        }
        const parentVisibleTrigonalPenalty = measureAttachedRingParentVisibleTrigonalPenalty(layoutGraph, candidateCoords, focusAtomIds);
        const rootOutwardPenalty = measureAttachedRingRootOutwardPenalty(layoutGraph, candidateCoords, descriptor, focusAtomIds);
        const omittedHydrogenTrigonalPenalty = measureThreeHeavyContinuationDistortion(layoutGraph, candidateCoords).totalDeviation;
        if (omittedHydrogenTrigonalPenalty > baseOmittedHydrogenTrigonalPenalty + 1e-6) {
          return null;
        }
        const trigonalDistortionPenalty = measureAttachedRingTrigonalDistortion(layoutGraph, candidateCoords, { focusAtomIds }).totalDeviation;
        const tetrahedralDistortionPenalty = measureTetrahedralDistortion(layoutGraph, candidateCoords).totalDeviation;
        if (tetrahedralDistortionPenalty > baseTetrahedralDistortionPenalty + 1e-6) {
          return null;
        }
        const subtreeClearance = measureAttachedCarbonylSubtreeClearance(layoutGraph, candidateCoords, descriptor);
        const presentationPenalty = measureCleanupStagePresentationPenalty(layoutGraph, candidateCoords, {
          focusAtomIds,
          includeSmallRingExteriorPenalty: false
        });
        return {
          coords: candidateCoords,
          nudges,
          overlapCount,
          junctionContinuationPenalty,
          exactContinuationPenalty,
          parentVisibleTrigonalPenalty,
          anchorSideOutwardPenalty: measureAttachedRingAnchorSideOutwardPenalty(layoutGraph, candidateCoords, descriptor),
          peripheralFocusClearance,
          rootOutwardPenalty,
          trigonalBisectorPenalty,
          omittedHydrogenTrigonalPenalty,
          trigonalDistortionPenalty,
          tetrahedralDistortionPenalty,
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
          basePeripheralFocusClearance,
          peripheralFocusRescueThreshold: bondLength * ATTACHED_RING_PERIPHERAL_FOCUS_CLEARANCE_FACTOR,
          peripheralFocusRescueEligible: true,
          presentationImprovement: basePresentationPenalty - presentationPenalty,
          layoutCost: measureLayoutCost(layoutGraph, candidateCoords, bondLength),
          localPoseKey: attachedRingLocalPoseKey(layoutGraph, candidateCoords, descriptor)
        };
      };
      const scoreCandidate = (seedCandidateCoords, overridePositions) => {
        let bestScore = buildCandidateScore(seedCandidateCoords, 1);
        if (bestScore && isExactCleanAttachedRingCandidate(bestScore)) {
          return bestScore;
        }
        const directUnifiedCleanup = runUnifiedCleanup(layoutGraph, seedCandidateCoords, {
          maxPasses: 1,
          epsilon: bondLength * 0.001,
          bondLength,
          cleanupRigidSubtreesByAtomId: options.cleanupRigidSubtreesByAtomId,
          frozenAtomIds,
          protectLargeMoleculeBackbone: options.protectLargeMoleculeBackbone === true,
          protectBondIntegrity: true
        });
        if (directUnifiedCleanup.passes > 0) {
          const directUnifiedScore = buildCandidateScore(
            directUnifiedCleanup.coords,
            directUnifiedCleanup.passes + 1
          );
          if (directUnifiedScore && isBetterAttachedRingCandidate(directUnifiedScore, bestScore)) {
            bestScore = directUnifiedScore;
            if (isExactCleanAttachedRingCandidate(bestScore)) {
              return bestScore;
            }
          }
        }

        if (!bestScore) {
          return null;
        }

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
          if (isExactCleanAttachedRingCandidate(bestScore)) {
            return bestScore;
          }
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
      if (needsPeripheralFocusClearanceRescue) {
        const reflectedCoords = reflectSubtreeAcrossBond(
          currentCoords,
          descriptor.subtreeAtomIds,
          descriptor.anchorAtomId,
          descriptor.rootAtomId,
          new Set([descriptor.rootAtomId])
        );
        let rescueScore = buildPeripheralFocusRescueScore(reflectedCoords, 1);
        const reflectedUnifiedCleanup = runUnifiedCleanup(layoutGraph, reflectedCoords, {
          maxPasses: 1,
          epsilon: bondLength * 0.001,
          bondLength,
          cleanupRigidSubtreesByAtomId: options.cleanupRigidSubtreesByAtomId,
          frozenAtomIds,
          protectLargeMoleculeBackbone: options.protectLargeMoleculeBackbone === true,
          protectBondIntegrity: true
        });
        if (reflectedUnifiedCleanup.passes > 0) {
          const unifiedRescueScore = buildPeripheralFocusRescueScore(
            reflectedUnifiedCleanup.coords,
            reflectedUnifiedCleanup.passes + 1
          );
          if (unifiedRescueScore && isBetterAttachedRingCandidate(unifiedRescueScore, rescueScore)) {
            rescueScore = unifiedRescueScore;
          }
        }
        if (rescueScore && (!bestCandidate || isBetterAttachedRingCandidate(rescueScore, bestCandidate))) {
          bestCandidate = rescueScore;
        }
      }
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
          const rotationAngles = baseOverlapCount > 0
            ? [...ATTACHED_RING_FINE_ROTATION_ANGLES, ...ATTACHED_RING_ROTATION_TIDY_ANGLES]
            : ATTACHED_RING_ROTATION_TIDY_ANGLES;
          const seeds = rotationAngles
            .filter(rotation => Math.abs(rotation) > 1e-9)
            .map(rotation => ({ kind: 'rigid', rotation }));
          if (supportsRootAnchoredAttachedRingRotation(layoutGraph, inputDescriptor)) {
            if (needsPeripheralFocusClearanceRescue) {
              seeds.push({ kind: 'reflected-subtree', reflectAnchor: true });
            }
            for (const rotation of rotationAngles) {
              if (Math.abs(rotation) <= 1e-9) {
                continue;
              }
              seeds.push({ kind: 'root-anchored', rotation });
            }
            if (baseOverlapCount > 0) {
              for (const anchorRotation of ATTACHED_RING_COUPLED_RESCUE_ANGLES) {
                for (const rootRotation of ATTACHED_RING_COUPLED_RESCUE_ANGLES) {
                  seeds.push({
                    kind: 'coupled-root-anchored',
                    anchorRotation,
                    rootRotation
                  });
                }
              }
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
          if (seed.kind === 'reflected-subtree') {
            const reflectedCoords = reflectSubtreeAcrossBond(
              inputCoords,
              inputDescriptor.subtreeAtomIds,
              inputDescriptor.anchorAtomId,
              inputDescriptor.rootAtomId,
              new Set([inputDescriptor.rootAtomId])
            );
            const overridePositions = new Map();
            for (const atomId of inputDescriptor.subtreeAtomIds) {
              if (atomId === inputDescriptor.anchorAtomId) {
                continue;
              }
              const position = reflectedCoords.get(atomId);
              if (position) {
                overridePositions.set(atomId, position);
              }
            }
            return overridePositions;
          }
          if (seed.kind === 'coupled-root-anchored') {
            const rigidlyRotatedCoords = applyRigidRotationToCoords(
              inputCoords,
              inputDescriptor.subtreeAtomIds,
              inputDescriptor.anchorAtomId,
              seed.anchorRotation
            );
            const coupledCoords = applyRigidRotationToCoords(
              rigidlyRotatedCoords,
              inputDescriptor.subtreeAtomIds,
              inputDescriptor.rootAtomId,
              seed.rootRotation
            );
            const overridePositions = new Map();
            for (const atomId of inputDescriptor.subtreeAtomIds) {
              if (atomId === inputDescriptor.anchorAtomId) {
                continue;
              }
              const position = coupledCoords.get(atomId);
              if (position) {
                overridePositions.set(atomId, position);
              }
            }
            return overridePositions;
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
    if (bestCandidate.crowdedAttachedRingCenter === true) {
      break;
    }
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
    && Math.abs(candidate.parentVisibleTrigonalPenalty - incumbent.parentVisibleTrigonalPenalty) <= 1e-6
    && Math.abs(candidate.rootOutwardPenalty - incumbent.rootOutwardPenalty) <= 1e-6
    && Math.abs(candidate.trigonalBisectorPenalty - incumbent.trigonalBisectorPenalty) <= 1e-6
    && Math.abs(candidate.trigonalDistortionPenalty - incumbent.trigonalDistortionPenalty) <= 1e-6
    && candidate.failingSubstituentCount < incumbent.failingSubstituentCount;
}

function inwardReadabilityWins(candidate, incumbent) {
  return !!incumbent
    && candidate.overlapCount === incumbent.overlapCount
    && Math.abs(candidate.exactContinuationPenalty - incumbent.exactContinuationPenalty) <= 1e-6
    && Math.abs(candidate.parentVisibleTrigonalPenalty - incumbent.parentVisibleTrigonalPenalty) <= 1e-6
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
    && Math.abs(candidate.parentVisibleTrigonalPenalty - incumbent.parentVisibleTrigonalPenalty) <= 1e-6
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
    && Math.abs(candidate.parentVisibleTrigonalPenalty - incumbent.parentVisibleTrigonalPenalty) <= 1e-6
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
    && Math.abs(candidate.parentVisibleTrigonalPenalty - incumbent.parentVisibleTrigonalPenalty) <= 1e-6
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
    && Math.abs(candidate.parentVisibleTrigonalPenalty - incumbent.parentVisibleTrigonalPenalty) <= 1e-6
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

function peripheralFocusClearanceWins(candidate, incumbent) {
  return !!incumbent
    && candidate.peripheralFocusRescueEligible === true
    && incumbent.peripheralFocusRescueEligible === true
    && candidate.overlapCount === incumbent.overlapCount
    && candidate.exactContinuationPenalty <= incumbent.exactContinuationPenalty + 1e-6
    && candidate.parentVisibleTrigonalPenalty <= incumbent.parentVisibleTrigonalPenalty + 1e-6
    && candidate.failingSubstituentCount === incumbent.failingSubstituentCount
    && candidate.inwardSubstituentCount === incumbent.inwardSubstituentCount
    && candidate.outwardAxisFailureCount === incumbent.outwardAxisFailureCount
    && candidate.globalFailingSubstituentCount === incumbent.globalFailingSubstituentCount
    && candidate.globalInwardSubstituentCount === incumbent.globalInwardSubstituentCount
    && candidate.globalOutwardAxisFailureCount === incumbent.globalOutwardAxisFailureCount
    && candidate.totalOutwardDeviation <= incumbent.totalOutwardDeviation + 1e-6
    && candidate.maxOutwardDeviation <= incumbent.maxOutwardDeviation + 1e-6
    && candidate.peripheralFocusClearance > incumbent.peripheralFocusClearance + 0.25;
}

function peripheralFocusRescuePriorityWins(candidate, incumbent) {
  return !!incumbent
    && candidate.peripheralFocusRescueEligible === true
    && incumbent.peripheralFocusRescueEligible !== true
    && candidate.overlapCount === incumbent.overlapCount
    && candidate.exactContinuationPenalty <= incumbent.exactContinuationPenalty + 1e-6
    && candidate.parentVisibleTrigonalPenalty <= incumbent.parentVisibleTrigonalPenalty + 1e-6
    && candidate.failingSubstituentCount <= incumbent.failingSubstituentCount
    && candidate.inwardSubstituentCount <= incumbent.inwardSubstituentCount
    && candidate.outwardAxisFailureCount <= incumbent.outwardAxisFailureCount
    && candidate.globalFailingSubstituentCount <= incumbent.globalFailingSubstituentCount
    && candidate.globalInwardSubstituentCount <= incumbent.globalInwardSubstituentCount
    && candidate.globalOutwardAxisFailureCount <= incumbent.globalOutwardAxisFailureCount
    && candidate.totalOutwardDeviation <= incumbent.totalOutwardDeviation + 1e-6
    && candidate.maxOutwardDeviation <= incumbent.maxOutwardDeviation + 1e-6
    && candidate.peripheralFocusClearance > (candidate.basePeripheralFocusClearance ?? 0) + 0.25
    && candidate.peripheralFocusClearance > (candidate.peripheralFocusRescueThreshold ?? 0) + 0.25;
}

function incumbentPeripheralFocusRescueHolds(candidate, incumbent) {
  return !!incumbent
    && incumbent.peripheralFocusRescueEligible === true
    && candidate.peripheralFocusRescueEligible !== true
    && candidate.overlapCount === incumbent.overlapCount
    && candidate.exactContinuationPenalty >= incumbent.exactContinuationPenalty - 1e-6
    && candidate.parentVisibleTrigonalPenalty >= incumbent.parentVisibleTrigonalPenalty - 1e-6
    && candidate.failingSubstituentCount >= incumbent.failingSubstituentCount
    && candidate.inwardSubstituentCount >= incumbent.inwardSubstituentCount
    && candidate.outwardAxisFailureCount >= incumbent.outwardAxisFailureCount
    && candidate.globalFailingSubstituentCount >= incumbent.globalFailingSubstituentCount
    && candidate.globalInwardSubstituentCount >= incumbent.globalInwardSubstituentCount
    && candidate.globalOutwardAxisFailureCount >= incumbent.globalOutwardAxisFailureCount
    && candidate.totalOutwardDeviation >= incumbent.totalOutwardDeviation - 1e-6
    && candidate.maxOutwardDeviation >= incumbent.maxOutwardDeviation - 1e-6
    && incumbent.peripheralFocusClearance > (incumbent.basePeripheralFocusClearance ?? 0) + 0.25
    && incumbent.peripheralFocusClearance > (incumbent.peripheralFocusRescueThreshold ?? 0) + 0.25;
}

function attachedCarbonylRootDescriptorWins(candidate, incumbent) {
  return !!incumbent
    && candidate.overlapCount === incumbent.overlapCount
    && Math.abs(candidate.exactContinuationPenalty - incumbent.exactContinuationPenalty) <= 1e-6
    && Math.abs(candidate.parentVisibleTrigonalPenalty - incumbent.parentVisibleTrigonalPenalty) <= 1e-6
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
    && Math.abs(candidate.parentVisibleTrigonalPenalty - incumbent.parentVisibleTrigonalPenalty) <= 1e-6
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
    && Math.abs(candidate.parentVisibleTrigonalPenalty - incumbent.parentVisibleTrigonalPenalty) <= 1e-6
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
    && Math.abs(candidate.parentVisibleTrigonalPenalty - incumbent.parentVisibleTrigonalPenalty) <= 1e-6
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
    && Math.abs(candidate.parentVisibleTrigonalPenalty - incumbent.parentVisibleTrigonalPenalty) <= 1e-6
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
    && Math.abs(candidate.parentVisibleTrigonalPenalty - incumbent.parentVisibleTrigonalPenalty) <= 1e-6
    && candidate.anchorSideOutwardPenalty < incumbent.anchorSideOutwardPenalty - 1e-6;
}

function totalRootOutwardWins(candidate, incumbent) {
  return !!incumbent
    && candidate.overlapCount === incumbent.overlapCount
    && Math.abs(candidate.exactContinuationPenalty - incumbent.exactContinuationPenalty) <= 1e-6
    && Math.abs(candidate.parentVisibleTrigonalPenalty - incumbent.parentVisibleTrigonalPenalty) <= 1e-6
    && Math.abs(candidate.anchorSideOutwardPenalty - incumbent.anchorSideOutwardPenalty) <= 1e-6
    && candidate.rootOutwardPenalty < incumbent.rootOutwardPenalty - 1e-6;
}

function parentVisibleTrigonalWins(candidate, incumbent) {
  return !!incumbent
    && candidate.overlapCount === incumbent.overlapCount
    && Math.abs(candidate.exactContinuationPenalty - incumbent.exactContinuationPenalty) <= 1e-6
    && candidate.parentVisibleTrigonalPenalty < incumbent.parentVisibleTrigonalPenalty - 1e-6;
}

function trigonalBisectorWins(candidate, incumbent) {
  return !!incumbent
    && candidate.overlapCount === incumbent.overlapCount
    && Math.abs(candidate.exactContinuationPenalty - incumbent.exactContinuationPenalty) <= 1e-6
    && Math.abs(candidate.parentVisibleTrigonalPenalty - incumbent.parentVisibleTrigonalPenalty) <= 1e-6
    && Math.abs(candidate.rootOutwardPenalty - incumbent.rootOutwardPenalty) <= 1e-6
    && candidate.trigonalBisectorPenalty < incumbent.trigonalBisectorPenalty - 1e-6;
}

function omittedHydrogenTrigonalWins(candidate, incumbent) {
  return !!incumbent
    && candidate.overlapCount === incumbent.overlapCount
    && Math.abs(candidate.exactContinuationPenalty - incumbent.exactContinuationPenalty) <= 1e-6
    && Math.abs(candidate.parentVisibleTrigonalPenalty - incumbent.parentVisibleTrigonalPenalty) <= 1e-6
    && Math.abs(candidate.rootOutwardPenalty - incumbent.rootOutwardPenalty) <= 1e-6
    && Math.abs(candidate.trigonalBisectorPenalty - incumbent.trigonalBisectorPenalty) <= 1e-6
    && (candidate.omittedHydrogenTrigonalPenalty ?? 0) < (incumbent.omittedHydrogenTrigonalPenalty ?? 0) - 1e-6;
}

function omittedHydrogenTrigonalHolds(candidate, incumbent) {
  return !!incumbent
    && candidate.overlapCount === incumbent.overlapCount
    && Math.abs(candidate.exactContinuationPenalty - incumbent.exactContinuationPenalty) <= 1e-6
    && Math.abs(candidate.parentVisibleTrigonalPenalty - incumbent.parentVisibleTrigonalPenalty) <= 1e-6
    && Math.abs(candidate.rootOutwardPenalty - incumbent.rootOutwardPenalty) <= 1e-6
    && Math.abs(candidate.trigonalBisectorPenalty - incumbent.trigonalBisectorPenalty) <= 1e-6
    && (candidate.omittedHydrogenTrigonalPenalty ?? 0) > (incumbent.omittedHydrogenTrigonalPenalty ?? 0) + 1e-6;
}

function trigonalDistortionWins(candidate, incumbent) {
  return !!incumbent
    && candidate.overlapCount === incumbent.overlapCount
    && Math.abs(candidate.exactContinuationPenalty - incumbent.exactContinuationPenalty) <= 1e-6
    && Math.abs(candidate.parentVisibleTrigonalPenalty - incumbent.parentVisibleTrigonalPenalty) <= 1e-6
    && Math.abs(candidate.rootOutwardPenalty - incumbent.rootOutwardPenalty) <= 1e-6
    && Math.abs(candidate.trigonalBisectorPenalty - incumbent.trigonalBisectorPenalty) <= 1e-6
    && candidate.trigonalDistortionPenalty < incumbent.trigonalDistortionPenalty - 1e-6;
}

function subtreeClearanceWins(candidate, incumbent) {
  return !!incumbent
    && candidate.overlapCount === incumbent.overlapCount
    && Math.abs(candidate.exactContinuationPenalty - incumbent.exactContinuationPenalty) <= 1e-6
    && Math.abs(candidate.parentVisibleTrigonalPenalty - incumbent.parentVisibleTrigonalPenalty) <= 1e-6
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
  if (incumbentPeripheralFocusRescueHolds(candidate, incumbent)) {
    return false;
  }
  if (omittedHydrogenTrigonalHolds(candidate, incumbent)) {
    return false;
  }
  return overlapCountWins(candidate, incumbent)
    || exactContinuationWins(candidate, incumbent)
    || parentVisibleTrigonalWins(candidate, incumbent)
    || rootOutwardWins(candidate, incumbent)
    || totalRootOutwardWins(candidate, incumbent)
    || trigonalBisectorWins(candidate, incumbent)
    || omittedHydrogenTrigonalWins(candidate, incumbent)
    || trigonalDistortionWins(candidate, incumbent)
    || readabilityFailureWins(candidate, incumbent)
    || inwardReadabilityWins(candidate, incumbent)
    || outwardReadabilityWins(candidate, incumbent)
    || globalReadabilityFailureWins(candidate, incumbent)
    || globalInwardReadabilityWins(candidate, incumbent)
    || globalOutwardReadabilityWins(candidate, incumbent)
    || peripheralFocusRescuePriorityWins(candidate, incumbent)
    || peripheralFocusClearanceWins(candidate, incumbent)
    || attachedCarbonylRootDescriptorWins(candidate, incumbent)
    || attachedCarbonylSetupWins(candidate, incumbent)
    || outwardDeviationWins(candidate, incumbent)
    || subtreeClearanceWins(candidate, incumbent)
    || presentationWins(candidate, incumbent)
    || layoutCostWins(candidate, incumbent);
}

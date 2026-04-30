/** @module cleanup/presentation/attached-ring-fallback */

import {
  buildAtomGrid,
  findSevereOverlaps,
  findVisibleHeavyBondCrossings,
  measureDirectAttachedRingJunctionContinuationDistortion,
  measureLayoutCost,
  measureRingSubstituentReadability,
  measureTetrahedralDistortion,
  measureThreeHeavyContinuationDistortion,
  measureTrigonalDistortion
} from '../../audit/invariants.js';
import { auditLayout } from '../../audit/audit.js';
import { computeIncidentRingOutwardAngles } from '../../geometry/ring-direction.js';
import { add, angleOf, angularDifference, centroid, fromAngle, rotate, sub, wrapAngle } from '../../geometry/vec2.js';
import {
  findLayoutBond,
  isExactRingOutwardEligibleSubstituent,
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
const MAX_ANCHOR_SIDE_OUTWARD_SUBTREE_HEAVY_ATOMS = 24;
const ATTACHED_RING_PARENT_CONJUGATED_HETERO_ELEMENTS = new Set(['O', 'S', 'Se', 'P']);
const CROWDED_CENTER_HEAVY_ATOM_LIMIT = 60;
const CROWDED_CENTER_MAX_RING_ROOTS = 4;
const CROWDED_CENTER_MAX_SUBTREE_HEAVY_ATOMS = 12;
const CROWDED_CENTER_ROOT_DEVIATION_TRIGGER = Math.PI / 6;
const CROWDED_CENTER_SIBLING_DEVIATION_LIMIT = Math.PI / 18;
const CROWDED_CENTER_MIN_ROOT_PENALTY_IMPROVEMENT = (Math.PI / 18) ** 2;
const CROWDED_CENTER_MAX_TETRAHEDRAL_WORSENING = 0.25;
const OMITTED_H_FAN_RESCUE_MIN_DEVIATION = (Math.PI / 18) ** 2;
const OMITTED_H_FAN_RESCUE_MIN_IMPROVEMENT = 1e-6;
const OMITTED_H_FAN_MAX_TETRAHEDRAL_WORSENING = 0.05;
const OMITTED_H_FAN_MAX_VISIBLE_TRIGONAL_WORSENING = 0.05;
const OMITTED_H_FAN_COLLATERAL_HEAVY_ATOM_LIMIT = 24;
const OMITTED_H_FAN_COLLATERAL_ROTATIONS = [
  -(Math.PI / 36),
  Math.PI / 36,
  -(Math.PI / 18),
  Math.PI / 18,
  -(Math.PI / 12),
  Math.PI / 12,
  -(Math.PI / 4),
  Math.PI / 4,
  -(Math.PI / 6),
  Math.PI / 6,
  -(Math.PI / 3),
  Math.PI / 3
];
const OMITTED_H_FAN_RELIEF_ROTATIONS = [
  Math.PI / 36,
  -(Math.PI / 36),
  Math.PI / 18,
  -(Math.PI / 18),
  Math.PI / 12,
  -(Math.PI / 12)
];
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
const CLEAN_DIRECT_ATTACHMENT_OUTWARD_EPSILON = Math.PI / 180;

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

/**
 * Returns exact rigid rotations that place an attached ring subtree on the
 * anchor ring's local outward axis. This covers cases where the attached ring
 * root itself is already readable, but the placed parent ring atom is left with
 * a visibly pinched `90/150` fan.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Current coordinate map.
 * @param {{anchorAtomId: string, rootAtomId: string}} descriptor - Attached-ring descriptor.
 * @returns {number[]} Rotation offsets in radians.
 */
function anchorSideOutwardRigidRotations(layoutGraph, coords, descriptor) {
  const anchorAtomId = descriptor?.anchorAtomId ?? null;
  const rootAtomId = descriptor?.rootAtomId ?? null;
  const anchorPosition = anchorAtomId ? coords.get(anchorAtomId) : null;
  const rootPosition = rootAtomId ? coords.get(rootAtomId) : null;
  if (!anchorAtomId || !rootAtomId || !anchorPosition || !rootPosition) {
    return [];
  }

  const anchorRings = layoutGraph.atomToRings.get(anchorAtomId) ?? [];
  if (anchorRings.length === 0 || (layoutGraph.atomToRings.get(rootAtomId)?.length ?? 0) === 0) {
    return [];
  }
  if (layoutGraph.atomToRingSystemId.get(anchorAtomId) === layoutGraph.atomToRingSystemId.get(rootAtomId)) {
    return [];
  }

  const incidentRingAtomIds = new Set(anchorRings.flatMap(ring => ring.atomIds));
  const heavyExocyclicNeighborIds = [];
  for (const bond of layoutGraph.bondsByAtomId.get(anchorAtomId) ?? []) {
    if (!bond || bond.kind !== 'covalent') {
      continue;
    }
    const neighborAtomId = bond.a === anchorAtomId ? bond.b : bond.a;
    const neighborAtom = layoutGraph.atoms.get(neighborAtomId);
    if (!neighborAtom || neighborAtom.element === 'H' || incidentRingAtomIds.has(neighborAtomId)) {
      continue;
    }
    heavyExocyclicNeighborIds.push(neighborAtomId);
  }
  if (heavyExocyclicNeighborIds.length !== 1 || heavyExocyclicNeighborIds[0] !== rootAtomId) {
    return [];
  }

  const targetAngles = [
    ...attachedRingAnchorOutwardAngles(layoutGraph, coords, anchorAtomId, rootAtomId),
    ...computeIncidentRingOutwardAngles(layoutGraph, anchorAtomId, atomId => coords.get(atomId) ?? null)
  ].filter((targetAngle, index, angles) =>
    angles.findIndex(existingAngle => angularDifference(existingAngle, targetAngle) <= 1e-9) === index
  );
  if (targetAngles.length === 0) {
    return [];
  }

  const currentAngle = angleOf(sub(rootPosition, anchorPosition));
  return targetAngles
    .map(targetAngle => wrapAngle(targetAngle - currentAngle))
    .filter((rotation, index, rotations) =>
      Math.abs(rotation) > 1e-9 &&
      rotations.findIndex(existingRotation => angularDifference(existingRotation, rotation) <= 1e-9) === index
    );
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

/**
 * Returns the smallest deviation between a direct ring substituent and its
 * exact outward target angles.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Coordinate map.
 * @param {string} anchorAtomId - Ring anchor atom ID.
 * @param {string} otherAtomId - Exocyclic substituent atom ID.
 * @returns {number|null} Smallest outward deviation in radians, or null.
 */
function directAttachmentOutwardDeviation(layoutGraph, coords, anchorAtomId, otherAtomId) {
  const anchorPosition = coords.get(anchorAtomId);
  if (!anchorPosition || !coords.has(otherAtomId)) {
    return null;
  }

  const outwardAngles = [
    ...attachedRingAnchorOutwardAngles(layoutGraph, coords, anchorAtomId, otherAtomId),
    ...computeIncidentRingOutwardAngles(layoutGraph, anchorAtomId, atomId => coords.get(atomId) ?? null)
  ].filter((outwardAngle, index, angles) =>
    angles.findIndex(existingAngle => angularDifference(existingAngle, outwardAngle) <= 1e-9) === index
  );
  if (outwardAngles.length === 0) {
    return null;
  }

  const otherAngle = angleOf(sub(coords.get(otherAtomId), anchorPosition));
  return Math.min(...outwardAngles.map(outwardAngle => angularDifference(otherAngle, outwardAngle)));
}

/**
 * Measures whether a candidate has pulled an already exact ring substituent
 * away from its local outward axis inside the current attached-ring focus.
 * Attached-ring fallback may improve a root ring pose, but it should preserve
 * exact carboxyl, hetero, and terminal leaf exits that were clean before the
 * candidate was tried.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} baseCoords - Baseline coordinate map.
 * @param {Map<string, {x: number, y: number}>} candidateCoords - Candidate coordinate map.
 * @param {Set<string>|null} [focusAtomIds] - Optional focused atoms to inspect.
 * @returns {number} Summed outward-axis regression in radians.
 */
function measureCleanDirectAttachmentOutwardRegression(layoutGraph, baseCoords, candidateCoords, focusAtomIds = null) {
  const focusSet = focusAtomIds instanceof Set && focusAtomIds.size > 0 ? focusAtomIds : null;
  let totalRegression = 0;

  for (const [anchorAtomId] of baseCoords) {
    const anchorRings = layoutGraph.atomToRings.get(anchorAtomId) ?? [];
    if (anchorRings.length === 0 || !candidateCoords.has(anchorAtomId)) {
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
      if (
        !neighborAtom
        || neighborAtom.element === 'H'
        || incidentRingAtomIds.has(neighborAtomId)
        || !baseCoords.has(neighborAtomId)
        || !candidateCoords.has(neighborAtomId)
      ) {
        continue;
      }
      heavyExocyclicNeighborIds.push(neighborAtomId);
    }
    if (heavyExocyclicNeighborIds.length !== 1) {
      continue;
    }

    const otherAtomId = heavyExocyclicNeighborIds[0];
    if (focusSet && !focusSet.has(anchorAtomId) && !focusSet.has(otherAtomId)) {
      continue;
    }
    if (!isExactRingOutwardEligibleSubstituent(layoutGraph, anchorAtomId, otherAtomId)) {
      continue;
    }

    const baseDeviation = directAttachmentOutwardDeviation(layoutGraph, baseCoords, anchorAtomId, otherAtomId);
    if (baseDeviation == null || baseDeviation > CLEAN_DIRECT_ATTACHMENT_OUTWARD_EPSILON) {
      continue;
    }

    const candidateDeviation = directAttachmentOutwardDeviation(layoutGraph, candidateCoords, anchorAtomId, otherAtomId);
    if (candidateDeviation == null) {
      continue;
    }
    totalRegression += Math.max(0, candidateDeviation - baseDeviation);
  }

  return totalRegression;
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

/**
 * Applies sparse override positions to a coordinate map.
 * @param {Map<string, {x: number, y: number}>} coords - Baseline coordinates.
 * @param {Map<string, {x: number, y: number}>|null} overridePositions - Sparse candidate positions.
 * @returns {Map<string, {x: number, y: number}>|null} Materialized candidate coordinates.
 */
function materializeOverrideCoords(coords, overridePositions) {
  if (!(overridePositions instanceof Map)) {
    return null;
  }
  const candidateCoords = new Map(coords);
  for (const [atomId, position] of overridePositions) {
    if (!position) {
      continue;
    }
    candidateCoords.set(atomId, { x: position.x, y: position.y });
  }
  return candidateCoords;
}

/**
 * Collects visible heavy single-bond neighbors for a center atom.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Current coordinate map.
 * @param {string} atomId - Center atom id.
 * @returns {Array<{bond: object, neighborAtomId: string, neighborAtom: object}>} Neighbor records.
 */
function visibleHeavySingleNeighborRecords(layoutGraph, coords, atomId) {
  const records = [];
  for (const bond of layoutGraph.bondsByAtomId.get(atomId) ?? []) {
    if (!bond || bond.kind !== 'covalent' || bond.aromatic || (bond.order ?? 1) !== 1) {
      continue;
    }
    const neighborAtomId = bond.a === atomId ? bond.b : bond.a;
    const neighborAtom = layoutGraph.atoms.get(neighborAtomId);
    if (!neighborAtom || neighborAtom.element === 'H' || !coords.has(neighborAtomId)) {
      continue;
    }
    records.push({ bond, neighborAtomId, neighborAtom });
  }
  return records;
}

/**
 * Returns whether a center is a suppressed-H three-heavy carbon fan repair candidate.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {string} atomId - Candidate center atom id.
 * @param {Array<{neighborAtomId: string}>} neighborRecords - Visible heavy-neighbor records.
 * @returns {boolean} True when the center should be considered for fan repair.
 */
function shouldRepairOmittedHydrogenFanCenter(layoutGraph, atomId, neighborRecords) {
  if (layoutGraph.options.suppressH !== true || neighborRecords.length !== 3) {
    return false;
  }
  const atom = layoutGraph.atoms.get(atomId);
  return (
    atom
    && atom.element === 'C'
    && !atom.aromatic
    && atom.degree === 4
    && atom.heavyDegree === 3
    && (layoutGraph.atomToRings.get(atomId)?.length ?? 0) === 0
  );
}

/**
 * Measures angular spread distortion for one three-heavy omitted-H center.
 * @param {Map<string, {x: number, y: number}>} coords - Coordinate map to score.
 * @param {string} centerAtomId - Center atom id.
 * @param {string[]} neighborAtomIds - Three visible heavy-neighbor atom ids.
 * @returns {{totalDeviation: number, maxDeviation: number}|null} Fan deviation summary.
 */
function measureOmittedHydrogenFanDeviationAtCenter(coords, centerAtomId, neighborAtomIds) {
  const centerPosition = coords.get(centerAtomId);
  if (!centerPosition || neighborAtomIds.length !== 3) {
    return null;
  }
  const angles = [];
  for (const neighborAtomId of neighborAtomIds) {
    const neighborPosition = coords.get(neighborAtomId);
    if (!neighborPosition) {
      return null;
    }
    angles.push(angleOf(sub(neighborPosition, centerPosition)));
  }
  angles.sort((firstAngle, secondAngle) => firstAngle - secondAngle);
  const idealSeparation = (2 * Math.PI) / 3;
  let totalDeviation = 0;
  let maxDeviation = 0;
  for (let index = 0; index < angles.length; index++) {
    const nextAngle = angles[(index + 1) % angles.length];
    const rawSeparation = nextAngle - angles[index];
    const separation = rawSeparation > 0 ? rawSeparation : rawSeparation + Math.PI * 2;
    const deviation = (separation - idealSeparation) ** 2;
    totalDeviation += deviation;
    maxDeviation = Math.max(maxDeviation, deviation);
  }
  return {
    totalDeviation,
    maxDeviation
  };
}

/**
 * Returns bounded root rotations toward an ideal hidden-H three-heavy fan.
 * Exact fan rotations are still considered, but smaller same-direction nudges
 * let the scorer preserve neighboring tetrahedral centers when exact is too
 * disruptive.
 * @param {number} exactRotation - Exact rigid rotation needed for the fan.
 * @returns {number[]} Candidate rotations in radians.
 */
function omittedHydrogenFanRootRotations(exactRotation) {
  const magnitude = Math.abs(exactRotation);
  if (magnitude <= 1e-9) {
    return [];
  }
  const sign = exactRotation < 0 ? -1 : 1;
  const stepMagnitudes = [
    Math.PI / 12,
    Math.PI / 9,
    (5 * Math.PI) / 36,
    Math.PI / 6,
    (7 * Math.PI) / 36,
    (2 * Math.PI) / 9,
    Math.PI / 4,
    (5 * Math.PI) / 18,
    (11 * Math.PI) / 36
  ];
  const rotations = stepMagnitudes
    .filter(stepMagnitude => stepMagnitude < magnitude - 1e-9)
    .map(stepMagnitude => sign * stepMagnitude);
  rotations.push(exactRotation);
  return rotations.filter((rotation, index) =>
    rotations.findIndex(existingRotation => angularDifference(existingRotation, rotation) <= 1e-9) === index
  );
}

function measureTerminalCarbonRingLeafOutwardPenalty(layoutGraph, coords, focusAtomIds = null) {
  let penalty = 0;
  for (const [leafAtomId, leafAtom] of layoutGraph.atoms ?? []) {
    if (
      !leafAtom
      || leafAtom.element !== 'C'
      || leafAtom.aromatic
      || leafAtom.heavyDegree !== 1
      || (layoutGraph.atomToRings.get(leafAtomId)?.length ?? 0) > 0
      || !coords.has(leafAtomId)
    ) {
      continue;
    }

    const bond = (layoutGraph.bondsByAtomId.get(leafAtomId) ?? []).find(candidateBond => {
      if (!candidateBond || candidateBond.kind !== 'covalent' || candidateBond.inRing || candidateBond.aromatic || (candidateBond.order ?? 1) !== 1) {
        return false;
      }
      const neighborAtomId = candidateBond.a === leafAtomId ? candidateBond.b : candidateBond.a;
      const neighborAtom = layoutGraph.atoms.get(neighborAtomId);
      return !!neighborAtom && neighborAtom.element !== 'H' && (layoutGraph.atomToRings.get(neighborAtomId)?.length ?? 0) > 0;
    });
    if (!bond) {
      continue;
    }

    const anchorAtomId = bond.a === leafAtomId ? bond.b : bond.a;
    if (focusAtomIds && !focusAtomIds.has(anchorAtomId) && !focusAtomIds.has(leafAtomId)) {
      continue;
    }
    const anchorPosition = coords.get(anchorAtomId);
    const leafPosition = coords.get(leafAtomId);
    if (!anchorPosition || !leafPosition) {
      continue;
    }
    const outwardAngles = computeIncidentRingOutwardAngles(layoutGraph, anchorAtomId, atomId => coords.get(atomId) ?? null);
    if (outwardAngles.length !== 1) {
      continue;
    }
    const currentAngle = angleOf(sub(leafPosition, anchorPosition));
    penalty += angularDifference(currentAngle, outwardAngles[0]) ** 2;
  }
  return penalty;
}

function measureRingExteriorBondOutwardPenalty(layoutGraph, coords, focusAtomIds = null) {
  let penalty = 0;
  for (const bond of layoutGraph.bonds?.values?.() ?? []) {
    if (!bond || bond.kind !== 'covalent' || bond.inRing || !coords.has(bond.a) || !coords.has(bond.b)) {
      continue;
    }
    for (const [anchorAtomId, neighborAtomId] of [[bond.a, bond.b], [bond.b, bond.a]]) {
      const anchorAtom = layoutGraph.atoms.get(anchorAtomId);
      const neighborAtom = layoutGraph.atoms.get(neighborAtomId);
      if (
        !anchorAtom
        || !neighborAtom
        || anchorAtom.aromatic !== true
        || neighborAtom.element === 'H'
        || (layoutGraph.atomToRings.get(anchorAtomId)?.length ?? 0) === 0
      ) {
        continue;
      }
      if (focusAtomIds && !focusAtomIds.has(anchorAtomId) && !focusAtomIds.has(neighborAtomId)) {
        continue;
      }
      const anchorPosition = coords.get(anchorAtomId);
      const neighborPosition = coords.get(neighborAtomId);
      if (!anchorPosition || !neighborPosition) {
        continue;
      }
      const outwardAngles = computeIncidentRingOutwardAngles(layoutGraph, anchorAtomId, atomId => coords.get(atomId) ?? null);
      if (outwardAngles.length !== 1) {
        continue;
      }
      const currentAngle = angleOf(sub(neighborPosition, anchorPosition));
      penalty += angularDifference(currentAngle, outwardAngles[0]) ** 2;
    }
  }
  return penalty;
}

function snapTerminalCarbonRingLeavesToOutward(layoutGraph, coords) {
  let candidateCoords = null;
  for (const [leafAtomId, leafAtom] of layoutGraph.atoms ?? []) {
    if (
      !leafAtom
      || leafAtom.element !== 'C'
      || leafAtom.aromatic
      || leafAtom.heavyDegree !== 1
      || (layoutGraph.atomToRings.get(leafAtomId)?.length ?? 0) > 0
      || !coords.has(leafAtomId)
    ) {
      continue;
    }

    const bond = (layoutGraph.bondsByAtomId.get(leafAtomId) ?? []).find(candidateBond => {
      if (!candidateBond || candidateBond.kind !== 'covalent' || candidateBond.inRing || candidateBond.aromatic || (candidateBond.order ?? 1) !== 1) {
        return false;
      }
      const neighborAtomId = candidateBond.a === leafAtomId ? candidateBond.b : candidateBond.a;
      const neighborAtom = layoutGraph.atoms.get(neighborAtomId);
      return !!neighborAtom && neighborAtom.element !== 'H' && (layoutGraph.atomToRings.get(neighborAtomId)?.length ?? 0) > 0;
    });
    if (!bond) {
      continue;
    }

    const anchorAtomId = bond.a === leafAtomId ? bond.b : bond.a;
    const anchorPosition = coords.get(anchorAtomId);
    const leafPosition = coords.get(leafAtomId);
    if (!anchorPosition || !leafPosition) {
      continue;
    }
    const outwardAngles = computeIncidentRingOutwardAngles(layoutGraph, anchorAtomId, atomId => coords.get(atomId) ?? null);
    if (outwardAngles.length !== 1) {
      continue;
    }
    const currentAngle = angleOf(sub(leafPosition, anchorPosition));
    if (angularDifference(currentAngle, outwardAngles[0]) <= 1e-6) {
      continue;
    }
    const bondDistance = Math.hypot(leafPosition.x - anchorPosition.x, leafPosition.y - anchorPosition.y);
    if (bondDistance <= 1e-6) {
      continue;
    }
    candidateCoords ??= new Map(coords);
    candidateCoords.set(leafAtomId, add(anchorPosition, fromAngle(outwardAngles[0], bondDistance)));
  }
  return candidateCoords;
}

function collectRingHydrogenCompanions(layoutGraph, ringAtomIds, coords) {
  const companionAtomIds = [];
  const ringAtomIdSet = new Set(ringAtomIds);
  for (const atomId of ringAtomIds) {
    for (const bond of layoutGraph.bondsByAtomId.get(atomId) ?? []) {
      if (!bond || bond.kind !== 'covalent' || bond.inRing) {
        continue;
      }
      const neighborAtomId = bond.a === atomId ? bond.b : bond.a;
      const neighborAtom = layoutGraph.atoms.get(neighborAtomId);
      if (
        neighborAtom?.element === 'H'
        && coords.has(neighborAtomId)
        && !ringAtomIdSet.has(neighborAtomId)
      ) {
        companionAtomIds.push(neighborAtomId);
      }
    }
  }
  return companionAtomIds;
}

function hasExteriorHeavyParent(layoutGraph, rootAtomId, ringAtomIdSet) {
  for (const bond of layoutGraph.bondsByAtomId.get(rootAtomId) ?? []) {
    if (!bond || bond.kind !== 'covalent' || bond.inRing || bond.aromatic) {
      continue;
    }
    const neighborAtomId = bond.a === rootAtomId ? bond.b : bond.a;
    const neighborAtom = layoutGraph.atoms.get(neighborAtomId);
    if (neighborAtom && neighborAtom.element !== 'H' && !ringAtomIdSet.has(neighborAtomId)) {
      return true;
    }
  }
  return false;
}

function collectCompactRingRootReliefVariants(layoutGraph, coords, baseNudges, options) {
  const severeOverlaps = findSevereOverlaps(layoutGraph, coords, options.bondLength);
  if (severeOverlaps.length === 0) {
    return [];
  }

  const variants = [];
  const seenKeys = new Set();
  for (const overlap of severeOverlaps) {
    for (const overlapAtomId of [overlap.firstAtomId, overlap.secondAtomId]) {
      for (const ring of layoutGraph.atomToRings.get(overlapAtomId) ?? []) {
        if (!ring || ring.size > 6) {
          continue;
        }
        const ringAtomIds = ring.atomIds.filter(atomId => coords.has(atomId));
        const ringAtomIdSet = new Set(ringAtomIds);
        for (const rootAtomId of ringAtomIds) {
          if (
            rootAtomId === overlapAtomId
            || !hasExteriorHeavyParent(layoutGraph, rootAtomId, ringAtomIdSet)
          ) {
            continue;
          }
          const subtreeAtomIds = [
            ...ringAtomIds,
            ...collectRingHydrogenCompanions(layoutGraph, ringAtomIds, coords)
          ];
          if (
            countHeavyAtoms(layoutGraph, subtreeAtomIds) > OMITTED_H_FAN_COLLATERAL_HEAVY_ATOM_LIMIT
            || subtreeAtomIds.some(atomId => layoutGraph.fixedCoords.has(atomId))
            || (options.frozenAtomIds && containsFrozenAtom(subtreeAtomIds, options.frozenAtomIds))
          ) {
            continue;
          }
          const key = `${ring.id ?? ringAtomIds.join(',')}|${rootAtomId}`;
          if (seenKeys.has(key)) {
            continue;
          }
          seenKeys.add(key);
          for (const rotation of OMITTED_H_FAN_RELIEF_ROTATIONS) {
            variants.push({
              coords: applyRigidRotationToCoords(coords, subtreeAtomIds, rootAtomId, rotation),
              nudges: baseNudges + 1
            });
          }
        }
      }
    }
  }
  return variants;
}

function collectRingExteriorOutwardRefinementVariants(layoutGraph, coords, baseNudges, options) {
  const variants = [];
  const seenKeys = new Set();
  for (const bond of layoutGraph.bonds?.values?.() ?? []) {
    if (!bond || bond.kind !== 'covalent' || bond.inRing || bond.aromatic || (bond.order ?? 1) !== 1) {
      continue;
    }
    for (const [rootAtomId, parentAtomId] of [[bond.a, bond.b], [bond.b, bond.a]]) {
      const rootAtom = layoutGraph.atoms.get(rootAtomId);
      const parentAtom = layoutGraph.atoms.get(parentAtomId);
      if (
        !rootAtom
        || !parentAtom
        || parentAtom.element === 'H'
        || parentAtom.heavyDegree <= 1
        || (layoutGraph.atomToRings.get(rootAtomId)?.length ?? 0) === 0
        || !coords.has(rootAtomId)
        || !coords.has(parentAtomId)
      ) {
        continue;
      }

      const outwardAngles = computeIncidentRingOutwardAngles(layoutGraph, rootAtomId, atomId => coords.get(atomId) ?? null);
      if (outwardAngles.length !== 1) {
        continue;
      }
      const parentAngle = angleOf(sub(coords.get(parentAtomId), coords.get(rootAtomId)));
      const correction = wrapAngle(parentAngle - outwardAngles[0]);
      if (Math.abs(correction) <= 1e-9) {
        continue;
      }

      const subtreeAtomIds = [...collectCutSubtree(layoutGraph, rootAtomId, parentAtomId)].filter(atomId => coords.has(atomId));
      const descriptor = {
        anchorAtomId: parentAtomId,
        rootAtomId,
        subtreeAtomIds
      };
      if (
        seenKeys.has(rigidDescriptorKey(descriptor))
        || !supportsRootAnchoredAttachedRingRotation(layoutGraph, descriptor)
        || countHeavyAtoms(layoutGraph, subtreeAtomIds) > OMITTED_H_FAN_COLLATERAL_HEAVY_ATOM_LIMIT
        || subtreeAtomIds.some(atomId => layoutGraph.fixedCoords.has(atomId))
        || (options.frozenAtomIds && containsFrozenAtom(subtreeAtomIds, options.frozenAtomIds))
      ) {
        continue;
      }
      seenKeys.add(rigidDescriptorKey(descriptor));

      const exactCoords = materializeOverrideCoords(coords, rotateAttachedRingAroundRoot(coords, descriptor, correction));
      if (!exactCoords) {
        continue;
      }
      variants.push({
        coords: exactCoords,
        nudges: baseNudges + 1
      });
      variants.push(...collectCompactRingRootReliefVariants(layoutGraph, exactCoords, baseNudges + 1, options));
    }
  }
  return variants;
}

function findBestRingExteriorOutwardRefinementCandidate(layoutGraph, coords, bondLength, frozenAtomIds) {
  const baseAudit = auditLayout(layoutGraph, coords, { bondLength });
  const basePenalty = measureRingExteriorBondOutwardPenalty(layoutGraph, coords);
  if (basePenalty <= 1e-9) {
    return null;
  }

  const baseHiddenHydrogenPenalty = measureThreeHeavyContinuationDistortion(layoutGraph, coords).totalDeviation;
  if (baseHiddenHydrogenPenalty <= OMITTED_H_FAN_RESCUE_MIN_DEVIATION) {
    return null;
  }
  const baseTetrahedralPenalty = measureTetrahedralDistortion(layoutGraph, coords).totalDeviation;
  const baseVisibleTrigonalPenalty = measureTrigonalDistortion(layoutGraph, coords).totalDeviation;
  const baseVisibleBondCrossingCount = findVisibleHeavyBondCrossings(layoutGraph, coords).length;
  let bestCandidate = null;
  for (const variant of collectRingExteriorOutwardRefinementVariants(layoutGraph, coords, 1, {
    bondLength,
    frozenAtomIds
  })) {
    const audit = auditLayout(layoutGraph, variant.coords, { bondLength });
    if (
      (baseAudit.ok === true && audit.ok !== true)
      || audit.severeOverlapCount > baseAudit.severeOverlapCount
      || audit.bondLengthFailureCount > baseAudit.bondLengthFailureCount
      || audit.labelOverlapCount > baseAudit.labelOverlapCount
    ) {
      continue;
    }
    if (findVisibleHeavyBondCrossings(layoutGraph, variant.coords).length > baseVisibleBondCrossingCount) {
      continue;
    }
    if (measureThreeHeavyContinuationDistortion(layoutGraph, variant.coords).totalDeviation > baseHiddenHydrogenPenalty + 1e-6) {
      continue;
    }
    if (measureTetrahedralDistortion(layoutGraph, variant.coords).totalDeviation > baseTetrahedralPenalty + OMITTED_H_FAN_MAX_TETRAHEDRAL_WORSENING) {
      continue;
    }
    if (measureTrigonalDistortion(layoutGraph, variant.coords).totalDeviation > baseVisibleTrigonalPenalty + OMITTED_H_FAN_MAX_VISIBLE_TRIGONAL_WORSENING) {
      continue;
    }
    const penalty = measureRingExteriorBondOutwardPenalty(layoutGraph, variant.coords);
    if (penalty >= basePenalty - 1e-6) {
      continue;
    }
    const score = {
      ...variant,
      penalty,
      layoutCost: measureLayoutCost(layoutGraph, variant.coords, bondLength)
    };
    if (
      !bestCandidate
      || score.penalty < bestCandidate.penalty - 1e-6
      || (
        Math.abs(score.penalty - bestCandidate.penalty) <= 1e-6
        && score.layoutCost < bestCandidate.layoutCost - 1e-6
      )
    ) {
      bestCandidate = score;
    }
  }

  return bestCandidate;
}

/**
 * Builds a movable attached-ring descriptor rooted at a hidden-H fan neighbor.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Current coordinate map.
 * @param {string} centerAtomId - Fan center atom id.
 * @param {string} rootAtomId - Attached-ring root atom id.
 * @param {Set<string>|null} frozenAtomIds - Frozen atoms that may not move.
 * @returns {{anchorAtomId: string, rootAtomId: string, subtreeAtomIds: string[]}|null} Movable descriptor.
 */
function buildOmittedHydrogenFanRootDescriptor(layoutGraph, coords, centerAtomId, rootAtomId, frozenAtomIds) {
  const subtreeAtomIds = [...collectCutSubtree(layoutGraph, rootAtomId, centerAtomId)].filter(atomId => coords.has(atomId));
  if (
    subtreeAtomIds.length === 0
    || subtreeAtomIds.length >= coords.size
    || subtreeAtomIds.some(atomId => layoutGraph.fixedCoords.has(atomId))
    || (frozenAtomIds && containsFrozenAtom(subtreeAtomIds, frozenAtomIds))
  ) {
    return null;
  }
  const ringHeavyAtomCount = subtreeAtomIds.reduce((count, atomId) => {
    const atom = layoutGraph.atoms.get(atomId);
    return count + (atom?.element !== 'H' && (layoutGraph.atomToRings.get(atomId)?.length ?? 0) > 0 ? 1 : 0);
  }, 0);
  if (ringHeavyAtomCount < 3) {
    return null;
  }
  return {
    anchorAtomId: centerAtomId,
    rootAtomId,
    subtreeAtomIds
  };
}

/**
 * Counts heavy atoms in a rigid descriptor subtree.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {{subtreeAtomIds: string[]}} descriptor - Rigid subtree descriptor.
 * @returns {number} Heavy atom count.
 */
function descriptorHeavyAtomCount(layoutGraph, descriptor) {
  return descriptor.subtreeAtomIds.reduce(
    (count, atomId) => count + (layoutGraph.atoms.get(atomId)?.element === 'H' ? 0 : 1),
    0
  );
}

/**
 * Finds sibling attached-ring subtrees that collide with a hidden-H fan repair.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Baseline coordinate map.
 * @param {{anchorAtomId: string, rootAtomId: string, subtreeAtomIds: string[]}} targetDescriptor - Repaired attached-ring descriptor.
 * @param {Map<string, {x: number, y: number}>} rootCoords - Coordinates after fan-root rotation.
 * @param {Set<string>|null} frozenAtomIds - Frozen atoms that may not move.
 * @returns {Array<{anchorAtomId: string, rootAtomId: string, subtreeAtomIds: string[]}>} Collateral descriptors.
 */
function collectOmittedHydrogenFanCollateralDescriptors(layoutGraph, coords, targetDescriptor, rootCoords, frozenAtomIds) {
  const targetAtomIds = new Set(targetDescriptor.subtreeAtomIds);
  const overlapAtomIds = new Set();
  for (const overlap of findSevereOverlaps(layoutGraph, rootCoords, layoutGraph.options.bondLength)) {
    for (const atomId of [overlap.firstAtomId, overlap.secondAtomId]) {
      if (atomId && !targetAtomIds.has(atomId)) {
        overlapAtomIds.add(atomId);
      }
    }
  }
  if (overlapAtomIds.size === 0) {
    return [];
  }

  const targetKey = rigidDescriptorKey(targetDescriptor);
  return collectMovableAttachedRingDescriptors(layoutGraph, coords, frozenAtomIds)
    .filter(descriptor => (
      rigidDescriptorKey(descriptor) !== targetKey
      && descriptorHeavyAtomCount(layoutGraph, descriptor) <= OMITTED_H_FAN_COLLATERAL_HEAVY_ATOM_LIMIT
      && descriptor.subtreeAtomIds.some(atomId => overlapAtomIds.has(atomId))
      && !descriptor.subtreeAtomIds.some(atomId => targetAtomIds.has(atomId))
    ))
    .sort((firstDescriptor, secondDescriptor) => (
      descriptorHeavyAtomCount(layoutGraph, firstDescriptor) - descriptorHeavyAtomCount(layoutGraph, secondDescriptor)
      || compareCanonicalIds(layoutGraph, firstDescriptor.rootAtomId, secondDescriptor.rootAtomId)
    ))
    .slice(0, 4);
}

/**
 * Finds small parent-side descriptors that can relieve residual contacts while preserving the fan.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Baseline coordinate map.
 * @param {string} centerAtomId - Hidden-H fan center atom id.
 * @param {{anchorAtomId: string, rootAtomId: string, subtreeAtomIds: string[]}} targetDescriptor - Repaired attached-ring descriptor.
 * @param {Set<string>|null} frozenAtomIds - Frozen atoms that may not move.
 * @returns {Array<{anchorAtomId: string, rootAtomId: string, subtreeAtomIds: string[]}>} Relief descriptors.
 */
function collectOmittedHydrogenFanReliefDescriptors(layoutGraph, coords, centerAtomId, targetDescriptor, frozenAtomIds) {
  const targetKey = rigidDescriptorKey(targetDescriptor);
  const targetAtomIds = new Set(targetDescriptor.subtreeAtomIds);
  return collectMovableAttachedRingDescriptors(layoutGraph, coords, frozenAtomIds)
    .filter(descriptor => (
      rigidDescriptorKey(descriptor) !== targetKey
      && descriptor.subtreeAtomIds.includes(centerAtomId)
      && descriptorHeavyAtomCount(layoutGraph, descriptor) <= OMITTED_H_FAN_COLLATERAL_HEAVY_ATOM_LIMIT
      && [...targetAtomIds].every(atomId => descriptor.subtreeAtomIds.includes(atomId))
    ))
    .sort((firstDescriptor, secondDescriptor) => (
      descriptorHeavyAtomCount(layoutGraph, firstDescriptor) - descriptorHeavyAtomCount(layoutGraph, secondDescriptor)
      || compareCanonicalIds(layoutGraph, firstDescriptor.rootAtomId, secondDescriptor.rootAtomId)
    ))
    .slice(0, 2);
}

/**
 * Returns whether a hidden-H fan candidate is exact and audit-clean enough to stop searching.
 * @param {object|null} candidate - Candidate score.
 * @returns {boolean} True when no broader attached-ring search is needed.
 */
function isResolvedOmittedHydrogenFanCandidate(candidate) {
  return (
    candidate?.audit?.ok === true
    && candidate.overlapCount === 0
    && (candidate.omittedHydrogenTargetFanMaxDeviation ?? Number.POSITIVE_INFINITY) <= 1e-9
  );
}

function isBalancedOmittedHydrogenFanCandidate(candidate) {
  return (
    candidate?.audit?.ok === true
    && candidate.overlapCount === 0
    && (candidate.visibleBondCrossingCount ?? 0) === 0
    && (candidate.visibleTrigonalPenalty ?? Number.POSITIVE_INFINITY) <= 0.16
    && (candidate.ringExteriorBondOutwardPenalty ?? 0) <= (Math.PI / 18) ** 2 + 1e-9
    && (candidate.terminalRingLeafOutwardPenalty ?? 0) <= 1e-9
    && (candidate.omittedHydrogenTargetFanMaxDeviation ?? Number.POSITIVE_INFINITY) <= (Math.PI / 6) ** 2 + 1e-9
  );
}

/**
 * Scores a candidate hidden-H fan repair against the current attached-ring state.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Candidate coordinate map.
 * @param {{anchorAtomId: string, rootAtomId: string, subtreeAtomIds: string[]}} descriptor - Repaired attached-ring descriptor.
 * @param {string[]} targetNeighborAtomIds - Three heavy neighbors around the fan center.
 * @param {Set<string>} focusAtomIds - Local atom focus for presentation metrics.
 * @param {{audit: object, bondLength: number, hiddenHydrogenPenalty: number, presentationPenalty: number, tetrahedralPenalty: number, visibleTrigonalPenalty: number, visibleBondCrossingCount: number}} baseState - Baseline score state.
 * @param {number} nudges - Number of logical candidate moves.
 * @returns {object|null} Candidate score, or null when rejected.
 */
function scoreOmittedHydrogenFanCandidate(layoutGraph, coords, descriptor, targetNeighborAtomIds, focusAtomIds, baseState, nudges) {
  const audit = auditLayout(layoutGraph, coords, { bondLength: baseState.bondLength });
  if (baseState.audit.ok === true && audit.ok !== true) {
    return null;
  }
  if (
    audit.severeOverlapCount > baseState.audit.severeOverlapCount
    || audit.bondLengthFailureCount > baseState.audit.bondLengthFailureCount
    || audit.labelOverlapCount > baseState.audit.labelOverlapCount
  ) {
    return null;
  }

  const hiddenHydrogenPenalty = measureThreeHeavyContinuationDistortion(layoutGraph, coords).totalDeviation;
  if (hiddenHydrogenPenalty >= baseState.hiddenHydrogenPenalty - OMITTED_H_FAN_RESCUE_MIN_IMPROVEMENT) {
    return null;
  }
  const tetrahedralDistortionPenalty = measureTetrahedralDistortion(layoutGraph, coords).totalDeviation;
  if (tetrahedralDistortionPenalty > baseState.tetrahedralPenalty + OMITTED_H_FAN_MAX_TETRAHEDRAL_WORSENING) {
    return null;
  }
  const visibleTrigonalPenalty = measureTrigonalDistortion(layoutGraph, coords).totalDeviation;
  if (visibleTrigonalPenalty > baseState.visibleTrigonalPenalty + OMITTED_H_FAN_MAX_VISIBLE_TRIGONAL_WORSENING) {
    return null;
  }
  const visibleBondCrossingCount = findVisibleHeavyBondCrossings(layoutGraph, coords).length;
  if (visibleBondCrossingCount > baseState.visibleBondCrossingCount) {
    return null;
  }

  const targetFanDeviation = measureOmittedHydrogenFanDeviationAtCenter(
    coords,
    descriptor.anchorAtomId,
    targetNeighborAtomIds
  );
  const readability = measureRingSubstituentReadability(layoutGraph, coords);
  const presentationPenalty = measureCleanupStagePresentationPenalty(layoutGraph, coords, {
    focusAtomIds,
    includeSmallRingExteriorPenalty: false
  });
  return {
    coords,
    nudges,
    omittedHydrogenAttachedRingFan: true,
    overlapCount: audit.severeOverlapCount,
    exactContinuationPenalty: measureExactAcyclicContinuationDistortion(layoutGraph, coords, focusAtomIds).totalDeviation,
    visibleBondCrossingCount,
    visibleTrigonalPenalty,
    parentVisibleTrigonalPenalty: measureAttachedRingParentVisibleTrigonalPenalty(layoutGraph, coords, focusAtomIds),
    anchorSideOutwardPenalty: measureAttachedRingAnchorSideOutwardPenalty(layoutGraph, coords, descriptor),
    rootOutwardPenalty: measureAttachedRingRootOutwardPenalty(layoutGraph, coords, descriptor, focusAtomIds),
    trigonalBisectorPenalty: measureDirectAttachmentTrigonalBisectorPenalty(layoutGraph, coords, descriptor),
    omittedHydrogenTrigonalPenalty: hiddenHydrogenPenalty,
    omittedHydrogenTargetFanMaxDeviation: targetFanDeviation?.maxDeviation ?? Number.POSITIVE_INFINITY,
    ringExteriorBondOutwardPenalty: measureRingExteriorBondOutwardPenalty(layoutGraph, coords),
    terminalRingLeafOutwardPenalty: measureTerminalCarbonRingLeafOutwardPenalty(layoutGraph, coords),
    trigonalDistortionPenalty: measureAttachedRingTrigonalDistortion(layoutGraph, coords, { focusAtomIds }).totalDeviation,
    tetrahedralDistortionPenalty,
    subtreeClearance: null,
    failingSubstituentCount: readability.failingSubstituentCount ?? 0,
    inwardSubstituentCount: readability.inwardSubstituentCount ?? 0,
    outwardAxisFailureCount: readability.outwardAxisFailureCount ?? 0,
    globalFailingSubstituentCount: readability.failingSubstituentCount ?? 0,
    globalInwardSubstituentCount: readability.inwardSubstituentCount ?? 0,
    globalOutwardAxisFailureCount: readability.outwardAxisFailureCount ?? 0,
    totalOutwardDeviation: readability.totalOutwardDeviation ?? 0,
    maxOutwardDeviation: readability.maxOutwardDeviation ?? 0,
    presentationImprovement: baseState.presentationPenalty - presentationPenalty,
    layoutCost: measureLayoutCost(layoutGraph, coords, baseState.bondLength),
    localPoseKey: attachedRingLocalPoseKey(layoutGraph, coords, descriptor),
    audit
  };
}

/**
 * Builds optional cleanup/tidy follow-up variants for a hidden-H fan seed.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Seed coordinate map.
 * @param {number} baseNudges - Moves already used to build the seed.
 * @param {object} options - Cleanup options.
 * @returns {Array<{coords: Map<string, {x: number, y: number}>, nudges: number}>} Refinement variants.
 */
function collectOmittedHydrogenFanRefinementVariants(layoutGraph, coords, baseNudges, options) {
  const variants = [];
  variants.push(...collectRingExteriorOutwardRefinementVariants(layoutGraph, coords, baseNudges, options));

  const seedRingTidy = runRingSubstituentTidy(layoutGraph, coords, {
    bondLength: options.bondLength,
    frozenAtomIds: options.frozenAtomIds
  });
  if ((seedRingTidy.nudges ?? 0) > 0) {
    variants.push({
      coords: seedRingTidy.coords,
      nudges: baseNudges + seedRingTidy.nudges
    });
  }

  const unifiedCleanup = runUnifiedCleanup(layoutGraph, coords, {
    maxPasses: 1,
    epsilon: options.bondLength * 0.001,
    bondLength: options.bondLength,
    cleanupRigidSubtreesByAtomId: options.cleanupRigidSubtreesByAtomId,
    frozenAtomIds: options.frozenAtomIds,
    protectLargeMoleculeBackbone: options.protectLargeMoleculeBackbone === true,
    protectBondIntegrity: true
  });
  if (unifiedCleanup.passes > 0) {
    variants.push({
      coords: unifiedCleanup.coords,
      nudges: baseNudges + unifiedCleanup.passes
    });
    const cleanupRingTidy = runRingSubstituentTidy(layoutGraph, unifiedCleanup.coords, {
      bondLength: options.bondLength,
      frozenAtomIds: options.frozenAtomIds
    });
    if ((cleanupRingTidy.nudges ?? 0) > 0) {
      variants.push({
        coords: cleanupRingTidy.coords,
        nudges: baseNudges + unifiedCleanup.passes + cleanupRingTidy.nudges
      });
    }
  }

  return variants;
}

/**
 * Searches for exact suppressed-H three-heavy fan repairs involving attached rings.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Current coordinate map.
 * @param {number} bondLength - Target bond length.
 * @param {Set<string>|null} frozenAtomIds - Frozen atoms that may not move.
 * @param {object} [options] - Cleanup options for follow-up refinement.
 * @returns {object|null} Best candidate score, or null when no repair improves the fan.
 */
function findBestOmittedHydrogenAttachedRingFanCandidate(layoutGraph, coords, bondLength, frozenAtomIds, options = {}) {
  const baseHiddenHydrogenPenalty = measureThreeHeavyContinuationDistortion(layoutGraph, coords).totalDeviation;
  if (baseHiddenHydrogenPenalty <= OMITTED_H_FAN_RESCUE_MIN_DEVIATION) {
    return null;
  }

  const baseState = {
    audit: auditLayout(layoutGraph, coords, { bondLength }),
    bondLength,
    hiddenHydrogenPenalty: baseHiddenHydrogenPenalty,
    tetrahedralPenalty: measureTetrahedralDistortion(layoutGraph, coords).totalDeviation,
    visibleTrigonalPenalty: measureTrigonalDistortion(layoutGraph, coords).totalDeviation,
    visibleBondCrossingCount: findVisibleHeavyBondCrossings(layoutGraph, coords).length,
    presentationPenalty: measureCleanupStagePresentationPenalty(layoutGraph, coords, {
      includeSmallRingExteriorPenalty: false
    })
  };
  let bestCandidate = null;

  const visitSeedCoords = (seedCoords, descriptor, targetNeighborAtomIds, focusAtomIds, nudges, visitOptions = {}) => {
    let shouldStop = false;
    const seedScore = scoreOmittedHydrogenFanCandidate(
      layoutGraph,
      seedCoords,
      descriptor,
      targetNeighborAtomIds,
      focusAtomIds,
      baseState,
      nudges
    );
    if (seedScore && (!bestCandidate || isBetterAttachedRingCandidate(seedScore, bestCandidate))) {
      bestCandidate = seedScore;
      shouldStop = isResolvedOmittedHydrogenFanCandidate(bestCandidate) || isBalancedOmittedHydrogenFanCandidate(bestCandidate);
    }

    const snappedLeafCoords = snapTerminalCarbonRingLeavesToOutward(layoutGraph, seedCoords);
    if (snappedLeafCoords) {
      const snappedLeafScore = scoreOmittedHydrogenFanCandidate(
        layoutGraph,
        snappedLeafCoords,
        descriptor,
        targetNeighborAtomIds,
        focusAtomIds,
        baseState,
        nudges + 1
      );
      if (snappedLeafScore && (!bestCandidate || isBetterAttachedRingCandidate(snappedLeafScore, bestCandidate))) {
        bestCandidate = snappedLeafScore;
        shouldStop = isResolvedOmittedHydrogenFanCandidate(bestCandidate) || isBalancedOmittedHydrogenFanCandidate(bestCandidate);
      }
    }

    if (shouldStop) {
      return true;
    }
    if (visitOptions.allowRefinement === false) {
      return false;
    }

    for (const variant of collectOmittedHydrogenFanRefinementVariants(layoutGraph, seedCoords, nudges, {
      ...options,
      bondLength,
      frozenAtomIds
    })) {
      const score = scoreOmittedHydrogenFanCandidate(
        layoutGraph,
        variant.coords,
        descriptor,
        targetNeighborAtomIds,
        focusAtomIds,
        baseState,
        variant.nudges
      );
      if (score && (!bestCandidate || isBetterAttachedRingCandidate(score, bestCandidate))) {
        bestCandidate = score;
        if (isResolvedOmittedHydrogenFanCandidate(bestCandidate)) {
          return true;
        }
      }
    }
    return false;
  };

  for (const [centerAtomId, atom] of layoutGraph.atoms ?? []) {
    if (!atom || !coords.has(centerAtomId)) {
      continue;
    }
    const neighborRecords = visibleHeavySingleNeighborRecords(layoutGraph, coords, centerAtomId);
    if (!shouldRepairOmittedHydrogenFanCenter(layoutGraph, centerAtomId, neighborRecords)) {
      continue;
    }
    const neighborAtomIds = neighborRecords.map(record => record.neighborAtomId);
    const centerDeviation = measureOmittedHydrogenFanDeviationAtCenter(coords, centerAtomId, neighborAtomIds);
    if (!centerDeviation || centerDeviation.maxDeviation <= OMITTED_H_FAN_RESCUE_MIN_DEVIATION) {
      continue;
    }

    for (const rootRecord of neighborRecords) {
      if ((layoutGraph.atomToRings.get(rootRecord.neighborAtomId)?.length ?? 0) === 0) {
        continue;
      }
      const descriptor = buildOmittedHydrogenFanRootDescriptor(
        layoutGraph,
        coords,
        centerAtomId,
        rootRecord.neighborAtomId,
        frozenAtomIds
      );
      if (!descriptor) {
        continue;
      }
      const otherNeighborAtomIds = neighborAtomIds.filter(neighborAtomId => neighborAtomId !== rootRecord.neighborAtomId);
      const centerPosition = coords.get(centerAtomId);
      const rootPosition = coords.get(rootRecord.neighborAtomId);
      const otherNeighborPositions = otherNeighborAtomIds.map(neighborAtomId => coords.get(neighborAtomId)).filter(Boolean);
      if (!centerPosition || !rootPosition || otherNeighborPositions.length !== 2) {
        continue;
      }
      const targetAngle = angleOf(sub(centerPosition, centroid(otherNeighborPositions)));
      const rootRotation = wrapAngle(targetAngle - angleOf(sub(rootPosition, centerPosition)));
      if (Math.abs(rootRotation) <= 1e-9) {
        continue;
      }

      const focusAtomIds = expandFocusAtomIds(
        layoutGraph,
        new Set([centerAtomId, rootRecord.neighborAtomId, ...otherNeighborAtomIds, ...descriptor.subtreeAtomIds])
      );

      for (const candidateRootRotation of omittedHydrogenFanRootRotations(rootRotation)) {
        const rootOverrides = rotateRigidDescriptorPositions(coords, descriptor, candidateRootRotation);
        const rootCoords = materializeOverrideCoords(coords, rootOverrides);
        if (!rootCoords) {
          continue;
        }

        if (visitSeedCoords(rootCoords, descriptor, neighborAtomIds, focusAtomIds, 1, { allowRefinement: false })) {
          return bestCandidate;
        }

        const collateralDescriptors = collectOmittedHydrogenFanCollateralDescriptors(
          layoutGraph,
          coords,
          descriptor,
          rootCoords,
          frozenAtomIds
        );
        const reliefDescriptors = collectOmittedHydrogenFanReliefDescriptors(
          layoutGraph,
          coords,
          centerAtomId,
          descriptor,
          frozenAtomIds
        );
        for (const collateralDescriptor of collateralDescriptors) {
          for (const collateralRotation of OMITTED_H_FAN_COLLATERAL_ROTATIONS) {
            const collateralOverrides = rotateRigidDescriptorPositions(rootCoords, collateralDescriptor, collateralRotation);
            const collateralCoords = materializeOverrideCoords(rootCoords, collateralOverrides);
            if (!collateralCoords) {
              continue;
            }
            if (visitSeedCoords(collateralCoords, descriptor, neighborAtomIds, focusAtomIds, 2, { allowRefinement: false })) {
              return bestCandidate;
            }
            let reliefResolved = false;
            for (const reliefDescriptor of reliefDescriptors) {
              for (const reliefRotation of OMITTED_H_FAN_RELIEF_ROTATIONS) {
                const reliefOverrides = rotateRigidDescriptorPositions(collateralCoords, reliefDescriptor, reliefRotation);
                const reliefCoords = materializeOverrideCoords(collateralCoords, reliefOverrides);
                if (!reliefCoords) {
                  continue;
                }
                if (visitSeedCoords(reliefCoords, descriptor, neighborAtomIds, focusAtomIds, 3, { allowRefinement: false })) {
                  return bestCandidate;
                }
                if (isResolvedOmittedHydrogenFanCandidate(bestCandidate)) {
                  reliefResolved = true;
                  break;
                }
              }
              if (reliefResolved) {
                break;
              }
            }
            if (!reliefResolved && visitSeedCoords(collateralCoords, descriptor, neighborAtomIds, focusAtomIds, 2)) {
              return bestCandidate;
            }
          }
        }
        if (visitSeedCoords(rootCoords, descriptor, neighborAtomIds, focusAtomIds, 1)) {
          return bestCandidate;
        }
      }
    }
  }

  return bestCandidate;
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
      const descriptor = {
        anchorAtomId,
        rootAtomId,
        subtreeAtomIds
      };
      const supportsAnchorSideOutwardRescue =
        heavyAtomCount <= MAX_ANCHOR_SIDE_OUTWARD_SUBTREE_HEAVY_ATOMS
        && anchorSideOutwardRigidRotations(layoutGraph, coords, descriptor).length > 0;
      if (
        heavyAtomCount === 0
        || (heavyAtomCount > 18 && !supportsAnchorSideOutwardRescue)
        || !subtreeAtomIds.some(atomId => ringAtomIds.has(atomId))
        || subtreeAtomIds.some(atomId => layoutGraph.fixedCoords.has(atomId))
        || (frozenAtomIds && containsFrozenAtom(subtreeAtomIds, frozenAtomIds))
      ) {
        continue;
      }

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
        if (anchorSideOutwardRigidRotations(layoutGraph, coords, largerDescriptor.descriptor).length > 0) {
          acceptedBondDescriptors.push(largerDescriptor);
        }
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
    visibleTrigonalPenalty: measureTrigonalDistortion(layoutGraph, coords).totalDeviation,
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
          || candidateScore.visibleTrigonalPenalty > baseScore.visibleTrigonalPenalty + OMITTED_H_FAN_MAX_VISIBLE_TRIGONAL_WORSENING
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
    const omittedHydrogenFanCandidate = findBestOmittedHydrogenAttachedRingFanCandidate(
      layoutGraph,
      currentCoords,
      bondLength,
      frozenAtomIds,
      {
        cleanupRigidSubtreesByAtomId: options.cleanupRigidSubtreesByAtomId,
        protectLargeMoleculeBackbone: options.protectLargeMoleculeBackbone === true
      }
    );
    if (isBalancedOmittedHydrogenFanCandidate(omittedHydrogenFanCandidate)) {
      currentCoords = omittedHydrogenFanCandidate.coords;
      totalNudges += omittedHydrogenFanCandidate.nudges;
      break;
    }
    if (omittedHydrogenFanCandidate && (!bestCandidate || isBetterAttachedRingCandidate(omittedHydrogenFanCandidate, bestCandidate))) {
      bestCandidate = omittedHydrogenFanCandidate;
    }
    if (isResolvedOmittedHydrogenFanCandidate(bestCandidate)) {
      currentCoords = bestCandidate.coords;
      totalNudges += bestCandidate.nudges;
      break;
    }

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
      const baseAnchorSideOutwardPenalty = measureAttachedRingAnchorSideOutwardPenalty(layoutGraph, currentCoords, descriptor);
      const baseRootOutwardPenalty = measureAttachedRingRootOutwardPenalty(layoutGraph, currentCoords, descriptor, focusAtomIds);
      const baseTrigonalBisectorPenalty = measureDirectAttachmentTrigonalBisectorPenalty(layoutGraph, currentCoords, descriptor);
      const baseOmittedHydrogenTrigonalPenalty = measureThreeHeavyContinuationDistortion(layoutGraph, currentCoords).totalDeviation;
      const baseVisibleTrigonalDistortionPenalty = measureTrigonalDistortion(layoutGraph, currentCoords).totalDeviation;
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
        const cleanDirectOutwardRegression = measureCleanDirectAttachmentOutwardRegression(
          layoutGraph,
          currentCoords,
          candidateCoords,
          focusAtomIds
        );
        if (cleanDirectOutwardRegression > 1e-6 && !reducesOverlapCount) {
          buildCandidateScore.lastRejectReason = 'clean-direct-outward';
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
        const visibleTrigonalPenalty = measureTrigonalDistortion(layoutGraph, candidateCoords).totalDeviation;
        if (
          omittedHydrogenTrigonalPenalty < baseOmittedHydrogenTrigonalPenalty - OMITTED_H_FAN_RESCUE_MIN_IMPROVEMENT
          && visibleTrigonalPenalty > baseVisibleTrigonalDistortionPenalty + OMITTED_H_FAN_MAX_VISIBLE_TRIGONAL_WORSENING
          && !reducesOverlapCount
        ) {
          buildCandidateScore.lastRejectReason = 'visible-trigonal-distortion';
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
          visibleTrigonalPenalty,
          parentVisibleTrigonalPenalty,
          anchorSideOutwardPenalty: measureAttachedRingAnchorSideOutwardPenalty(layoutGraph, candidateCoords, descriptor),
          anchorSideOutwardImprovement: baseAnchorSideOutwardPenalty - measureAttachedRingAnchorSideOutwardPenalty(layoutGraph, candidateCoords, descriptor),
          peripheralFocusClearance,
          rootOutwardPenalty,
          rootOutwardImprovement: baseRootOutwardPenalty - rootOutwardPenalty,
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
        const cleanDirectOutwardRegression = measureCleanDirectAttachmentOutwardRegression(
          layoutGraph,
          currentCoords,
          candidateCoords,
          focusAtomIds
        );
        if (cleanDirectOutwardRegression > 1e-6) {
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
          anchorSideOutwardImprovement: baseAnchorSideOutwardPenalty - measureAttachedRingAnchorSideOutwardPenalty(layoutGraph, candidateCoords, descriptor),
          peripheralFocusClearance,
          rootOutwardPenalty,
          rootOutwardImprovement: baseRootOutwardPenalty - rootOutwardPenalty,
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
          for (const rotation of anchorSideOutwardRigidRotations(layoutGraph, currentCoords, inputDescriptor)) {
            if (!seeds.some(seed => seed.kind === 'rigid' && angularDifference(seed.rotation, rotation) <= 1e-9)) {
              seeds.push({ kind: 'rigid', rotation, exactAnchorSideOutward: true });
            }
          }
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
            scoredCandidate.exactAnchorSideOutward = _seed?.exactAnchorSideOutward === true;
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
    const exteriorOutwardRefinementCandidate = findBestRingExteriorOutwardRefinementCandidate(
      layoutGraph,
      currentCoords,
      bondLength,
      frozenAtomIds
    );
    if (exteriorOutwardRefinementCandidate) {
      currentCoords = exteriorOutwardRefinementCandidate.coords;
      totalNudges += exteriorOutwardRefinementCandidate.nudges;
    }
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

function incumbentExactAnchorSideOutwardHolds(candidate, incumbent) {
  return !!incumbent
    && incumbent.exactAnchorSideOutward === true
    && candidate.exactAnchorSideOutward !== true
    && (incumbent.anchorSideOutwardImprovement ?? 0) + (incumbent.rootOutwardImprovement ?? 0) > 1e-6
    && candidate.overlapCount >= incumbent.overlapCount
    && candidate.failingSubstituentCount >= incumbent.failingSubstituentCount
    && candidate.inwardSubstituentCount >= incumbent.inwardSubstituentCount
    && candidate.outwardAxisFailureCount >= incumbent.outwardAxisFailureCount
    && candidate.globalFailingSubstituentCount >= incumbent.globalFailingSubstituentCount
    && candidate.globalInwardSubstituentCount >= incumbent.globalInwardSubstituentCount
    && candidate.globalOutwardAxisFailureCount >= incumbent.globalOutwardAxisFailureCount;
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

function exactAnchorSideOutwardWins(candidate, incumbent) {
  return !!incumbent
    && candidate.exactAnchorSideOutward === true
    && (
      (candidate.anchorSideOutwardImprovement ?? 0) > 1e-6
      || (candidate.rootOutwardImprovement ?? 0) > 1e-6
    )
    && candidate.overlapCount <= incumbent.overlapCount
    && candidate.failingSubstituentCount <= incumbent.failingSubstituentCount
    && candidate.inwardSubstituentCount <= incumbent.inwardSubstituentCount
    && candidate.outwardAxisFailureCount <= incumbent.outwardAxisFailureCount
    && candidate.globalFailingSubstituentCount <= incumbent.globalFailingSubstituentCount
    && candidate.globalInwardSubstituentCount <= incumbent.globalInwardSubstituentCount
    && candidate.globalOutwardAxisFailureCount <= incumbent.globalOutwardAxisFailureCount;
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

function terminalRingLeafOutwardWins(candidate, incumbent) {
  return !!incumbent
    && typeof candidate.terminalRingLeafOutwardPenalty === 'number'
    && typeof incumbent.terminalRingLeafOutwardPenalty === 'number'
    && candidate.overlapCount === incumbent.overlapCount
    && Math.abs(candidate.exactContinuationPenalty - incumbent.exactContinuationPenalty) <= 1e-6
    && Math.abs(candidate.parentVisibleTrigonalPenalty - incumbent.parentVisibleTrigonalPenalty) <= 1e-6
    && Math.abs(candidate.rootOutwardPenalty - incumbent.rootOutwardPenalty) <= 1e-6
    && Math.abs(candidate.trigonalBisectorPenalty - incumbent.trigonalBisectorPenalty) <= 1e-6
    && candidate.terminalRingLeafOutwardPenalty < incumbent.terminalRingLeafOutwardPenalty - 1e-6;
}

function terminalRingLeafOutwardHolds(candidate, incumbent) {
  return !!incumbent
    && typeof candidate.terminalRingLeafOutwardPenalty === 'number'
    && typeof incumbent.terminalRingLeafOutwardPenalty === 'number'
    && candidate.overlapCount === incumbent.overlapCount
    && Math.abs(candidate.exactContinuationPenalty - incumbent.exactContinuationPenalty) <= 1e-6
    && Math.abs(candidate.parentVisibleTrigonalPenalty - incumbent.parentVisibleTrigonalPenalty) <= 1e-6
    && Math.abs(candidate.rootOutwardPenalty - incumbent.rootOutwardPenalty) <= 1e-6
    && Math.abs(candidate.trigonalBisectorPenalty - incumbent.trigonalBisectorPenalty) <= 1e-6
    && candidate.terminalRingLeafOutwardPenalty > incumbent.terminalRingLeafOutwardPenalty + 1e-6;
}

function ringExteriorBondOutwardWins(candidate, incumbent) {
  return !!incumbent
    && typeof candidate.ringExteriorBondOutwardPenalty === 'number'
    && typeof incumbent.ringExteriorBondOutwardPenalty === 'number'
    && candidate.overlapCount === incumbent.overlapCount
    && Math.abs(candidate.exactContinuationPenalty - incumbent.exactContinuationPenalty) <= 1e-6
    && Math.abs(candidate.parentVisibleTrigonalPenalty - incumbent.parentVisibleTrigonalPenalty) <= 1e-6
    && Math.abs(candidate.rootOutwardPenalty - incumbent.rootOutwardPenalty) <= 1e-6
    && Math.abs(candidate.trigonalBisectorPenalty - incumbent.trigonalBisectorPenalty) <= 1e-6
    && candidate.ringExteriorBondOutwardPenalty < incumbent.ringExteriorBondOutwardPenalty - 1e-6;
}

function ringExteriorBondOutwardHolds(candidate, incumbent) {
  return !!incumbent
    && typeof candidate.ringExteriorBondOutwardPenalty === 'number'
    && typeof incumbent.ringExteriorBondOutwardPenalty === 'number'
    && candidate.overlapCount === incumbent.overlapCount
    && Math.abs(candidate.exactContinuationPenalty - incumbent.exactContinuationPenalty) <= 1e-6
    && Math.abs(candidate.parentVisibleTrigonalPenalty - incumbent.parentVisibleTrigonalPenalty) <= 1e-6
    && Math.abs(candidate.rootOutwardPenalty - incumbent.rootOutwardPenalty) <= 1e-6
    && Math.abs(candidate.trigonalBisectorPenalty - incumbent.trigonalBisectorPenalty) <= 1e-6
    && candidate.ringExteriorBondOutwardPenalty > incumbent.ringExteriorBondOutwardPenalty + 1e-6;
}

function omittedHydrogenTrigonalWins(candidate, incumbent) {
  return !!incumbent
    && candidate.overlapCount === incumbent.overlapCount
    && Math.abs(candidate.exactContinuationPenalty - incumbent.exactContinuationPenalty) <= 1e-6
    && Math.abs(candidate.parentVisibleTrigonalPenalty - incumbent.parentVisibleTrigonalPenalty) <= 1e-6
    && Math.abs(candidate.rootOutwardPenalty - incumbent.rootOutwardPenalty) <= 1e-6
    && Math.abs(candidate.trigonalBisectorPenalty - incumbent.trigonalBisectorPenalty) <= 1e-6
    && (
      typeof candidate.terminalRingLeafOutwardPenalty !== 'number'
      || typeof incumbent.terminalRingLeafOutwardPenalty !== 'number'
      || candidate.terminalRingLeafOutwardPenalty <= incumbent.terminalRingLeafOutwardPenalty + 1e-6
    )
    && (
      typeof candidate.ringExteriorBondOutwardPenalty !== 'number'
      || typeof incumbent.ringExteriorBondOutwardPenalty !== 'number'
      || candidate.ringExteriorBondOutwardPenalty <= incumbent.ringExteriorBondOutwardPenalty + 1e-6
    )
    && (candidate.omittedHydrogenTrigonalPenalty ?? 0) < (incumbent.omittedHydrogenTrigonalPenalty ?? 0) - 1e-6;
}

function omittedHydrogenTrigonalHolds(candidate, incumbent) {
  return !!incumbent
    && candidate.overlapCount === incumbent.overlapCount
    && Math.abs(candidate.exactContinuationPenalty - incumbent.exactContinuationPenalty) <= 1e-6
    && Math.abs(candidate.parentVisibleTrigonalPenalty - incumbent.parentVisibleTrigonalPenalty) <= 1e-6
    && Math.abs(candidate.rootOutwardPenalty - incumbent.rootOutwardPenalty) <= 1e-6
    && Math.abs(candidate.trigonalBisectorPenalty - incumbent.trigonalBisectorPenalty) <= 1e-6
    && (
      typeof candidate.terminalRingLeafOutwardPenalty !== 'number'
      || typeof incumbent.terminalRingLeafOutwardPenalty !== 'number'
      || Math.abs(candidate.terminalRingLeafOutwardPenalty - incumbent.terminalRingLeafOutwardPenalty) <= 1e-6
    )
    && (
      typeof candidate.ringExteriorBondOutwardPenalty !== 'number'
      || typeof incumbent.ringExteriorBondOutwardPenalty !== 'number'
      || Math.abs(candidate.ringExteriorBondOutwardPenalty - incumbent.ringExteriorBondOutwardPenalty) <= 1e-6
    )
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
  if (incumbentExactAnchorSideOutwardHolds(candidate, incumbent)) {
    return false;
  }
  if (ringExteriorBondOutwardHolds(candidate, incumbent)) {
    return false;
  }
  if (terminalRingLeafOutwardHolds(candidate, incumbent)) {
    return false;
  }
  if (omittedHydrogenTrigonalHolds(candidate, incumbent)) {
    return false;
  }
  return overlapCountWins(candidate, incumbent)
    || exactContinuationWins(candidate, incumbent)
    || parentVisibleTrigonalWins(candidate, incumbent)
    || exactAnchorSideOutwardWins(candidate, incumbent)
    || rootOutwardWins(candidate, incumbent)
    || totalRootOutwardWins(candidate, incumbent)
    || trigonalBisectorWins(candidate, incumbent)
    || ringExteriorBondOutwardWins(candidate, incumbent)
    || terminalRingLeafOutwardWins(candidate, incumbent)
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

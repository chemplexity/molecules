/** @module cleanup/presentation/divalent-continuation */

import { CLEANUP_EPSILON, DISTANCE_EPSILON } from '../../constants.js';
import { angleOf, angularDifference, rotate, sub, wrapAngle } from '../../geometry/vec2.js';
import { rotateAround } from '../../geometry/transforms.js';
import { isExactSimpleAcyclicContinuationEligible } from '../../placement/branch-placement/angle-selection.js';
import { auditLayout } from '../../audit/audit.js';
import { findSevereOverlaps, measureDivalentContinuationDistortion } from '../../audit/invariants.js';
import { collectCutSubtree } from '../subtree-utils.js';
import { visibleHeavyCovalentBonds } from '../bond-utils.js';

const MAX_MOVABLE_DIVALENT_CONTINUATION_HEAVY_ATOMS = 4;
const MAX_MOVABLE_CARBONYL_RING_CONTINUATION_HEAVY_ATOMS = 18;
const MAX_MOVABLE_TERMINAL_RING_CONTINUATION_HEAVY_ATOMS = 12;
const MAX_MOVABLE_LARGE_PHOSPHATE_LINKER_HEAVY_ATOMS = 120;
const MAX_MOVABLE_LARGE_ACYCLIC_ETHER_LINKER_HEAVY_ATOMS = 120;
const MAX_LARGE_PHOSPHATE_LINKER_PASSES = 8;
const MAX_LARGE_ACYCLIC_ETHER_LINKER_PASSES = 6;
const LARGE_PHOSPHATE_LINKER_MIN_DEVIATION = Math.PI / 18;
const LARGE_ACYCLIC_ETHER_LINKER_MIN_DEVIATION = Math.PI / 9;
const LARGE_PHOSPHATE_LINKER_MAX_ROTATION = Math.PI / 6;
const LARGE_ACYCLIC_ETHER_LINKER_MAX_ROTATION = Math.PI / 4;
const IDEAL_DIVALENT_CONTINUATION_ANGLE = (2 * Math.PI) / 3;
const LARGE_PHOSPHATE_LINKER_ROTATION_FACTORS = Object.freeze([1]);
const LARGE_PHOSPHATE_LINKER_ROTATION_STEPS = Object.freeze([5, 10, 15, 20, 25, 30].map(degrees => (degrees * Math.PI) / 180));
const LARGE_ACYCLIC_ETHER_LINKER_ROTATION_STEPS = Object.freeze([10, 15, 20, 25, 30, 35, 40, 45].map(degrees => (degrees * Math.PI) / 180));
const HYPERVALENT_CONTACT_RELIEF_ROTATIONS = Object.freeze([-Math.PI / 36, Math.PI / 36, -Math.PI / 18, Math.PI / 18, -Math.PI / 12, Math.PI / 12]);
const HYPERVALENT_CONTACT_CENTER_ELEMENTS = new Set(['P', 'S', 'Se', 'Si']);
const TERMINAL_ALKENE_PARENT_ROTATIONS = Object.freeze([
  -Math.PI,
  Math.PI,
  (-8 * Math.PI) / 9,
  (8 * Math.PI) / 9,
  (-31 * Math.PI) / 36,
  (31 * Math.PI) / 36,
  (-5 * Math.PI) / 6,
  (5 * Math.PI) / 6,
  (-2 * Math.PI) / 3,
  (2 * Math.PI) / 3,
  -Math.PI / 2,
  Math.PI / 2,
  -Math.PI / 3,
  Math.PI / 3
]);

function isCarbonylAttachedRingContinuationSide(layoutGraph, rootAtomId, centerAtomId, subtreeAtomIds) {
  const rootAtom = layoutGraph.atoms.get(rootAtomId);
  if (!rootAtom || rootAtom.element !== 'C' || rootAtom.aromatic) {
    return false;
  }
  let hasTerminalMultipleHetero = false;
  let hasAttachedRingNeighbor = false;
  for (const bond of layoutGraph.bondsByAtomId.get(rootAtomId) ?? []) {
    if (!bond || bond.kind !== 'covalent' || bond.aromatic) {
      continue;
    }
    const neighborAtomId = bond.a === rootAtomId ? bond.b : bond.a;
    if (neighborAtomId === centerAtomId) {
      continue;
    }
    const neighborAtom = layoutGraph.atoms.get(neighborAtomId);
    if (!neighborAtom || neighborAtom.element === 'H') {
      continue;
    }
    if ((bond.order ?? 1) >= 2 && neighborAtom.element !== 'C' && (neighborAtom.heavyDegree ?? 0) === 1) {
      hasTerminalMultipleHetero = true;
    }
    if (layoutGraph.ringAtomIdSet.has(neighborAtomId)) {
      hasAttachedRingNeighbor = true;
    }
  }
  return hasTerminalMultipleHetero && hasAttachedRingNeighbor && subtreeAtomIds.some(atomId => layoutGraph.ringAtomIdSet.has(atomId));
}

function isCompactTerminalRingContinuationSide(layoutGraph, rootAtomId, centerAtomId, subtreeAtomIds) {
  const rootRings = layoutGraph.atomToRings.get(rootAtomId) ?? [];
  if (rootRings.length !== 1 || layoutGraph.ringAtomIdSet.has(centerAtomId)) {
    return false;
  }
  const ring = rootRings[0];
  const ringAtomIds = ring.atomIds ?? [];
  if (ringAtomIds.length < 5 || ringAtomIds.length > 6) {
    return false;
  }
  const subtreeAtomIdSet = new Set(subtreeAtomIds);
  if (!ringAtomIds.every(atomId => subtreeAtomIdSet.has(atomId))) {
    return false;
  }
  for (const atomId of subtreeAtomIds) {
    const atomRings = layoutGraph.atomToRings.get(atomId) ?? [];
    if (atomRings.length === 0) {
      continue;
    }
    if (atomRings.length !== 1 || atomRings[0] !== ring) {
      return false;
    }
  }
  return true;
}

function collectCompactMovableSide(layoutGraph, coords, rootAtomId, centerAtomId, frozenAtomIds) {
  const subtreeAtomIds = [...collectCutSubtree(layoutGraph, rootAtomId, centerAtomId)].filter(atomId => coords.has(atomId));
  if (subtreeAtomIds.length === 0 || subtreeAtomIds.includes(centerAtomId)) {
    return null;
  }
  const allowCarbonylAttachedRingSide = isCarbonylAttachedRingContinuationSide(layoutGraph, rootAtomId, centerAtomId, subtreeAtomIds);
  const allowTerminalRingSide = isCompactTerminalRingContinuationSide(layoutGraph, rootAtomId, centerAtomId, subtreeAtomIds);
  const allowRingAtoms = allowCarbonylAttachedRingSide || allowTerminalRingSide;
  let heavyAtomCount = 0;
  for (const atomId of subtreeAtomIds) {
    if (frozenAtomIds?.has(atomId)) {
      return null;
    }
    if (!allowRingAtoms && layoutGraph.ringAtomIdSet.has(atomId)) {
      return null;
    }
    const atom = layoutGraph.atoms.get(atomId);
    if (!atom) {
      return null;
    }
    if (atom.element !== 'H') {
      heavyAtomCount++;
    }
  }
  const heavyAtomLimit = allowTerminalRingSide
    ? MAX_MOVABLE_TERMINAL_RING_CONTINUATION_HEAVY_ATOMS
    : allowCarbonylAttachedRingSide
      ? MAX_MOVABLE_CARBONYL_RING_CONTINUATION_HEAVY_ATOMS
      : MAX_MOVABLE_DIVALENT_CONTINUATION_HEAVY_ATOMS;
  return heavyAtomCount > 0 && heavyAtomCount <= heavyAtomLimit ? subtreeAtomIds : null;
}

function divalentContinuationCandidates(layoutGraph, coords, centerAtomId, frozenAtomIds) {
  if (frozenAtomIds?.has(centerAtomId)) {
    return [];
  }
  const centerAtom = layoutGraph.atoms.get(centerAtomId);
  if (!centerAtom || centerAtom.element === 'H' || centerAtom.aromatic || layoutGraph.ringAtomIdSet.has(centerAtomId)) {
    return [];
  }
  const heavyBonds = visibleHeavyCovalentBonds(layoutGraph, coords, centerAtomId);
  if (heavyBonds.length !== 2 || heavyBonds.some(({ bond }) => bond.aromatic || (bond.order ?? 1) !== 1)) {
    return [];
  }

  const [first, second] = heavyBonds;
  const descriptors = [];
  for (const [parentAtomId, rootAtomId] of [
    [first.neighborAtomId, second.neighborAtomId],
    [second.neighborAtomId, first.neighborAtomId]
  ]) {
    if (!isExactSimpleAcyclicContinuationEligible(layoutGraph, centerAtomId, parentAtomId, rootAtomId)) {
      continue;
    }
    const subtreeAtomIds = collectCompactMovableSide(layoutGraph, coords, rootAtomId, centerAtomId, frozenAtomIds);
    if (!subtreeAtomIds) {
      continue;
    }
    descriptors.push({
      centerAtomId,
      parentAtomId,
      rootAtomId,
      subtreeAtomIds
    });
  }
  return descriptors;
}

function isRingAdjacentTerminalContinuationDescriptor(layoutGraph, coords, descriptor) {
  const parentAtom = layoutGraph.atoms.get(descriptor.parentAtomId);
  const rootAtom = layoutGraph.atoms.get(descriptor.rootAtomId);
  return !!(
    parentAtom &&
    rootAtom &&
    rootAtom.element !== 'H' &&
    coords.has(descriptor.rootAtomId) &&
    layoutGraph.ringAtomIdSet.has(descriptor.parentAtomId) &&
    !layoutGraph.ringAtomIdSet.has(descriptor.rootAtomId) &&
    isExactSimpleAcyclicContinuationEligible(layoutGraph, descriptor.centerAtomId, descriptor.parentAtomId, descriptor.rootAtomId)
  );
}

function rotateSubtreeAroundCenter(coords, descriptor, rotation) {
  const centerPosition = coords.get(descriptor.centerAtomId);
  if (!centerPosition) {
    return null;
  }
  const nextCoords = new Map(coords);
  for (const atomId of descriptor.subtreeAtomIds) {
    const position = coords.get(atomId);
    if (!position) {
      continue;
    }
    nextCoords.set(atomId, rotateAround(position, centerPosition, rotation));
  }
  return nextCoords;
}

function normalizeRotation(rotation) {
  return Math.atan2(Math.sin(rotation), Math.cos(rotation));
}

function visibleHeavySingleBondNeighbors(layoutGraph, coords, atomId) {
  return visibleHeavyCovalentBonds(layoutGraph, coords, atomId)
    .filter(({ bond }) => !bond.aromatic && (bond.order ?? 1) === 1)
    .map(({ neighborAtomId }) => neighborAtomId);
}

function phosphateLinkerAngle(coords, centerAtomId, neighborAtomIds) {
  const centerPosition = coords.get(centerAtomId);
  const firstPosition = coords.get(neighborAtomIds[0]);
  const secondPosition = coords.get(neighborAtomIds[1]);
  if (!centerPosition || !firstPosition || !secondPosition) {
    return 0;
  }
  return angularDifference(angleOf(sub(firstPosition, centerPosition)), angleOf(sub(secondPosition, centerPosition)));
}

function largePhosphateLinkerDescriptors(layoutGraph, coords) {
  const descriptors = [];
  for (const [atomId, atom] of layoutGraph.atoms) {
    if (!atom || atom.element !== 'O' || atom.aromatic || layoutGraph.ringAtomIdSet.has(atomId) || !coords.has(atomId)) {
      continue;
    }
    const neighborAtomIds = visibleHeavySingleBondNeighbors(layoutGraph, coords, atomId);
    if (neighborAtomIds.length !== 2) {
      continue;
    }
    if (!neighborAtomIds.some(neighborAtomId => layoutGraph.atoms.get(neighborAtomId)?.element === 'P')) {
      continue;
    }
    const angle = phosphateLinkerAngle(coords, atomId, neighborAtomIds);
    const deviation = Math.abs(angle - IDEAL_DIVALENT_CONTINUATION_ANGLE);
    if (deviation <= LARGE_PHOSPHATE_LINKER_MIN_DEVIATION) {
      continue;
    }
    descriptors.push({
      centerAtomId: atomId,
      neighborAtomIds,
      angle,
      deviation
    });
  }
  descriptors.sort((firstDescriptor, secondDescriptor) => secondDescriptor.deviation - firstDescriptor.deviation);
  return descriptors;
}

function largeAcyclicEtherLinkerDescriptors(layoutGraph, coords) {
  const descriptors = [];
  for (const [atomId, atom] of layoutGraph.atoms) {
    if (!atom || atom.element !== 'O' || atom.aromatic || layoutGraph.ringAtomIdSet.has(atomId) || !coords.has(atomId)) {
      continue;
    }
    const neighborAtomIds = visibleHeavySingleBondNeighbors(layoutGraph, coords, atomId);
    if (neighborAtomIds.length !== 2) {
      continue;
    }
    const neighborAtoms = neighborAtomIds.map(neighborAtomId => layoutGraph.atoms.get(neighborAtomId));
    if (!neighborAtoms.every(neighborAtom => neighborAtom?.element === 'C' && !neighborAtom.aromatic)) {
      continue;
    }
    if (!neighborAtomIds.some(neighborAtomId => layoutGraph.ringAtomIdSet.has(neighborAtomId))) {
      continue;
    }
    const angle = phosphateLinkerAngle(coords, atomId, neighborAtomIds);
    const deviation = Math.abs(angle - IDEAL_DIVALENT_CONTINUATION_ANGLE);
    if (deviation <= LARGE_ACYCLIC_ETHER_LINKER_MIN_DEVIATION) {
      continue;
    }
    descriptors.push({
      centerAtomId: atomId,
      neighborAtomIds,
      angle,
      deviation
    });
  }
  descriptors.sort((firstDescriptor, secondDescriptor) => secondDescriptor.deviation - firstDescriptor.deviation);
  return descriptors;
}

function largeLinkerMovableSide(layoutGraph, coords, centerAtomId, rootAtomId, frozenAtomIds, maxHeavyAtomCount) {
  const subtreeAtomIds = [...collectCutSubtree(layoutGraph, rootAtomId, centerAtomId)].filter(atomId => coords.has(atomId));
  if (subtreeAtomIds.length === 0 || subtreeAtomIds.includes(centerAtomId)) {
    return null;
  }
  let heavyAtomCount = 0;
  for (const atomId of subtreeAtomIds) {
    if (frozenAtomIds?.has(atomId)) {
      return null;
    }
    const atom = layoutGraph.atoms.get(atomId);
    if (!atom) {
      return null;
    }
    if (atom.element !== 'H') {
      heavyAtomCount++;
    }
  }
  return heavyAtomCount > 0 && heavyAtomCount <= maxHeavyAtomCount
    ? {
        atomIds: subtreeAtomIds,
        heavyAtomCount
      }
    : null;
}

function largePhosphateMovableSide(layoutGraph, coords, centerAtomId, rootAtomId, frozenAtomIds) {
  return largeLinkerMovableSide(layoutGraph, coords, centerAtomId, rootAtomId, frozenAtomIds, MAX_MOVABLE_LARGE_PHOSPHATE_LINKER_HEAVY_ATOMS);
}

function largeAcyclicEtherMovableSide(layoutGraph, coords, centerAtomId, rootAtomId, frozenAtomIds) {
  return largeLinkerMovableSide(layoutGraph, coords, centerAtomId, rootAtomId, frozenAtomIds, MAX_MOVABLE_LARGE_ACYCLIC_ETHER_LINKER_HEAVY_ATOMS);
}

function rotateAtomIdsAroundCenter(coords, centerAtomId, atomIds, rotation) {
  const centerPosition = coords.get(centerAtomId);
  if (!centerPosition) {
    return null;
  }
  const nextCoords = new Map(coords);
  for (const atomId of atomIds) {
    const position = coords.get(atomId);
    if (!position) {
      continue;
    }
    nextCoords.set(atomId, rotateAround(position, centerPosition, rotation));
  }
  return nextCoords;
}

function largePhosphateLinkerRotations(desiredRotation) {
  return largeLinkerRotations(desiredRotation, LARGE_PHOSPHATE_LINKER_MAX_ROTATION, LARGE_PHOSPHATE_LINKER_ROTATION_STEPS);
}

function largeAcyclicEtherLinkerRotations(desiredRotation) {
  return largeLinkerRotations(desiredRotation, LARGE_ACYCLIC_ETHER_LINKER_MAX_ROTATION, LARGE_ACYCLIC_ETHER_LINKER_ROTATION_STEPS);
}

function largeLinkerRotations(desiredRotation, maxRotation, rotationSteps) {
  const rotations = new Set();
  const direction = Math.sign(desiredRotation);
  if (direction === 0) {
    return [];
  }
  for (const factor of LARGE_PHOSPHATE_LINKER_ROTATION_FACTORS) {
    rotations.add(Math.max(-maxRotation, Math.min(maxRotation, desiredRotation * factor)));
  }
  for (const step of rotationSteps) {
    if (step <= Math.abs(desiredRotation) + DISTANCE_EPSILON) {
      rotations.add(direction * step);
    }
  }
  return [...rotations].filter(rotation => Math.abs(rotation) > DISTANCE_EPSILON);
}

function largePhosphateLinkerCandidateIsBetter(candidate, incumbent) {
  if (!incumbent) {
    return true;
  }
  if (candidate.metric.maxDeviation < incumbent.metric.maxDeviation - CLEANUP_EPSILON) {
    return true;
  }
  if (candidate.metric.maxDeviation > incumbent.metric.maxDeviation + CLEANUP_EPSILON) {
    return false;
  }
  if (candidate.metric.totalDeviation < incumbent.metric.totalDeviation - CLEANUP_EPSILON) {
    return true;
  }
  if (candidate.metric.totalDeviation > incumbent.metric.totalDeviation + CLEANUP_EPSILON) {
    return false;
  }
  if (candidate.targetDeviation < incumbent.targetDeviation - CLEANUP_EPSILON) {
    return true;
  }
  if (candidate.targetDeviation > incumbent.targetDeviation + CLEANUP_EPSILON) {
    return false;
  }
  return candidate.movedHeavyAtomCount < incumbent.movedHeavyAtomCount;
}

function terminalMultipleBondHypervalentContact(layoutGraph, atomId) {
  const atom = layoutGraph.atoms.get(atomId);
  if (!atom || atom.element === 'H') {
    return null;
  }
  const covalentBonds = (layoutGraph.bondsByAtomId.get(atomId) ?? []).filter(bond => bond?.kind === 'covalent');
  if (covalentBonds.length !== 1) {
    return null;
  }
  const bond = covalentBonds[0];
  if ((bond.order ?? 1) < 2) {
    return null;
  }
  const centerAtomId = bond.a === atomId ? bond.b : bond.a;
  const centerAtom = layoutGraph.atoms.get(centerAtomId);
  if (!centerAtom || !HYPERVALENT_CONTACT_CENTER_ELEMENTS.has(centerAtom.element)) {
    return null;
  }
  return {
    centerAtomId,
    terminalAtomId: atomId
  };
}

function hypervalentContactReliefPivots(layoutGraph, coords, centerAtomId, movedAtomIdSet, frozenAtomIds) {
  const pivots = [];
  for (const bond of layoutGraph.bondsByAtomId.get(centerAtomId) ?? []) {
    if (!bond || bond.kind !== 'covalent' || bond.aromatic || (bond.order ?? 1) !== 1) {
      continue;
    }
    const pivotAtomId = bond.a === centerAtomId ? bond.b : bond.a;
    const pivotAtom = layoutGraph.atoms.get(pivotAtomId);
    if (!pivotAtom || pivotAtom.element === 'H' || frozenAtomIds?.has(pivotAtomId)) {
      continue;
    }
    const subtreeAtomIds = [...collectCutSubtree(layoutGraph, centerAtomId, pivotAtomId)].filter(atomId => coords.has(atomId));
    if (subtreeAtomIds.length === 0 || subtreeAtomIds.some(atomId => movedAtomIdSet.has(atomId) || frozenAtomIds?.has(atomId))) {
      continue;
    }
    pivots.push({
      pivotAtomId,
      subtreeAtomIds
    });
  }
  return pivots;
}

function compareHypervalentContactReliefCandidates(candidate, incumbent) {
  if (!incumbent) {
    return -1;
  }
  if (candidate.divalentPenalty < incumbent.divalentPenalty - CLEANUP_EPSILON) {
    return -1;
  }
  if (candidate.divalentPenalty > incumbent.divalentPenalty + CLEANUP_EPSILON) {
    return 1;
  }
  if (candidate.rotationMagnitude < incumbent.rotationMagnitude - CLEANUP_EPSILON) {
    return -1;
  }
  if (candidate.rotationMagnitude > incumbent.rotationMagnitude + CLEANUP_EPSILON) {
    return 1;
  }
  return candidate.movedAtomCount - incumbent.movedAtomCount;
}

function relieveHypervalentContactAfterDivalentSnap(layoutGraph, coords, movedAtomIds, frozenAtomIds, bondLength) {
  if (!Array.isArray(movedAtomIds) || movedAtomIds.length === 0) {
    return null;
  }
  const movedAtomIdSet = new Set(movedAtomIds);
  const contacts = [];
  for (const overlap of findSevereOverlaps(layoutGraph, coords, bondLength)) {
    for (const [overlapAtomId, otherAtomId] of [
      [overlap.firstAtomId, overlap.secondAtomId],
      [overlap.secondAtomId, overlap.firstAtomId]
    ]) {
      if (!movedAtomIdSet.has(otherAtomId)) {
        continue;
      }
      const contact = terminalMultipleBondHypervalentContact(layoutGraph, overlapAtomId);
      if (contact) {
        contacts.push(contact);
      }
    }
  }
  if (contacts.length === 0) {
    return null;
  }

  let bestCandidate = null;
  for (const contact of contacts) {
    const pivots = hypervalentContactReliefPivots(layoutGraph, coords, contact.centerAtomId, movedAtomIdSet, frozenAtomIds);
    for (const pivot of pivots) {
      const pivotPosition = coords.get(pivot.pivotAtomId);
      if (!pivotPosition) {
        continue;
      }
      for (const rotation of HYPERVALENT_CONTACT_RELIEF_ROTATIONS) {
        const candidateCoords = new Map(coords);
        for (const atomId of pivot.subtreeAtomIds) {
          const position = coords.get(atomId);
          if (!position) {
            continue;
          }
          candidateCoords.set(atomId, rotateAround(position, pivotPosition, rotation));
        }
        const candidateAudit = auditLayout(layoutGraph, candidateCoords, { bondLength });
        if (candidateAudit.ok !== true) {
          continue;
        }
        const movedAtoms = [...new Set([...movedAtomIds, ...pivot.subtreeAtomIds])];
        const candidate = {
          coords: candidateCoords,
          audit: candidateAudit,
          atomIds: movedAtoms,
          divalentPenalty: measureDivalentContinuationDistortion(layoutGraph, candidateCoords).totalDeviation,
          movedAtomCount: movedAtoms.length,
          rotationMagnitude: Math.abs(rotation)
        };
        if (compareHypervalentContactReliefCandidates(candidate, bestCandidate) < 0) {
          bestCandidate = candidate;
        }
      }
    }
  }
  return bestCandidate;
}

function terminalAlkeneContinuationDescriptor(layoutGraph, coords, centerAtomId, frozenAtomIds) {
  if (frozenAtomIds?.has(centerAtomId)) {
    return null;
  }
  const centerAtom = layoutGraph.atoms.get(centerAtomId);
  if (!centerAtom || centerAtom.element !== 'C' || centerAtom.aromatic || !coords.has(centerAtomId)) {
    return null;
  }
  const heavyBonds = visibleHeavyCovalentBonds(layoutGraph, coords, centerAtomId);
  if (heavyBonds.length !== 2) {
    return null;
  }
  const parentBond = heavyBonds.find(({ bond }) => !bond.aromatic && (bond.order ?? 1) === 1);
  const leafBond = heavyBonds.find(({ bond, neighborAtomId }) => {
    const neighborAtom = layoutGraph.atoms.get(neighborAtomId);
    return !bond.aromatic && (bond.order ?? 1) >= 2 && neighborAtom?.element === 'C' && (neighborAtom.heavyDegree ?? 0) === 1;
  });
  if (!parentBond || !leafBond) {
    return null;
  }
  const parentAtomId = parentBond.neighborAtomId;
  const leafAtomId = leafBond.neighborAtomId;
  const grandParentAtomId =
    visibleHeavyCovalentBonds(layoutGraph, coords, parentAtomId)
      .map(({ neighborAtomId }) => neighborAtomId)
      .find(neighborAtomId => neighborAtomId !== centerAtomId) ?? null;
  if (!grandParentAtomId || frozenAtomIds?.has(parentAtomId) || frozenAtomIds?.has(leafAtomId)) {
    return null;
  }
  const parentSubtreeAtomIds = [...collectCutSubtree(layoutGraph, parentAtomId, grandParentAtomId)].filter(atomId => coords.has(atomId));
  const leafSubtreeAtomIds = [...collectCutSubtree(layoutGraph, leafAtomId, centerAtomId)].filter(atomId => coords.has(atomId));
  if (
    parentSubtreeAtomIds.length === 0 ||
    leafSubtreeAtomIds.length === 0 ||
    parentSubtreeAtomIds.some(atomId => frozenAtomIds?.has(atomId)) ||
    leafSubtreeAtomIds.some(atomId => frozenAtomIds?.has(atomId))
  ) {
    return null;
  }
  return {
    centerAtomId,
    parentAtomId,
    grandParentAtomId,
    leafAtomId,
    parentSubtreeAtomIds,
    leafSubtreeAtomIds
  };
}

function rotateAtomIdsAroundAtom(coords, atomIds, pivotAtomId, rotation) {
  const pivot = coords.get(pivotAtomId);
  if (!pivot) {
    return null;
  }
  const nextCoords = new Map(coords);
  for (const atomId of atomIds) {
    const position = nextCoords.get(atomId);
    if (!position) {
      continue;
    }
    nextCoords.set(atomId, rotateAround(position, pivot, rotation));
  }
  return nextCoords;
}

function terminalAlkeneAngleDeviation(coords, descriptor) {
  const centerPosition = coords.get(descriptor.centerAtomId);
  const parentPosition = coords.get(descriptor.parentAtomId);
  const leafPosition = coords.get(descriptor.leafAtomId);
  if (!centerPosition || !parentPosition || !leafPosition) {
    return Number.POSITIVE_INFINITY;
  }
  return Math.abs(angularDifference(angleOf(sub(parentPosition, centerPosition)), angleOf(sub(leafPosition, centerPosition))) - IDEAL_DIVALENT_CONTINUATION_ANGLE);
}

function restoreTerminalAlkeneLeafAngle(coords, descriptor) {
  const centerPosition = coords.get(descriptor.centerAtomId);
  const parentPosition = coords.get(descriptor.parentAtomId);
  const leafPosition = coords.get(descriptor.leafAtomId);
  if (!centerPosition || !parentPosition || !leafPosition) {
    return null;
  }
  const parentAngle = angleOf(sub(parentPosition, centerPosition));
  const leafAngle = angleOf(sub(leafPosition, centerPosition));
  let bestCoords = null;
  let bestRotationMagnitude = Number.POSITIVE_INFINITY;
  for (const targetAngle of [parentAngle + IDEAL_DIVALENT_CONTINUATION_ANGLE, parentAngle - IDEAL_DIVALENT_CONTINUATION_ANGLE]) {
    const rotation = wrapAngle(targetAngle - leafAngle);
    const candidateCoords = rotateAtomIdsAroundAtom(coords, descriptor.leafSubtreeAtomIds, descriptor.centerAtomId, rotation);
    if (!candidateCoords) {
      continue;
    }
    const rotationMagnitude = Math.abs(rotation);
    if (rotationMagnitude < bestRotationMagnitude - CLEANUP_EPSILON) {
      bestCoords = candidateCoords;
      bestRotationMagnitude = rotationMagnitude;
    }
  }
  return bestCoords;
}

function buildContinuationCandidates(layoutGraph, coords, descriptor) {
  const centerPosition = coords.get(descriptor.centerAtomId);
  const parentPosition = coords.get(descriptor.parentAtomId);
  const rootPosition = coords.get(descriptor.rootAtomId);
  if (!centerPosition || !parentPosition || !rootPosition) {
    return [];
  }
  const parentAngle = angleOf(sub(parentPosition, centerPosition));
  const currentRootAngle = angleOf(sub(rootPosition, centerPosition));
  const currentSeparation = angularDifference(parentAngle, currentRootAngle);
  if (Math.abs(currentSeparation - IDEAL_DIVALENT_CONTINUATION_ANGLE) <= CLEANUP_EPSILON) {
    return [];
  }

  const candidates = [];
  for (const targetAngle of [parentAngle + IDEAL_DIVALENT_CONTINUATION_ANGLE, parentAngle - IDEAL_DIVALENT_CONTINUATION_ANGLE]) {
    const rotation = wrapAngle(targetAngle - currentRootAngle);
    const magnitude = Math.abs(rotation);
    if (magnitude <= CLEANUP_EPSILON) {
      continue;
    }
    const candidateCoords = rotateSubtreeAroundCenter(coords, descriptor, rotation);
    if (!candidateCoords) {
      continue;
    }
    const rootOffset = sub(candidateCoords.get(descriptor.rootAtomId), centerPosition);
    const targetOffset = rotate(sub(rootPosition, centerPosition), rotation);
    if (Math.hypot(rootOffset.x - targetOffset.x, rootOffset.y - targetOffset.y) > DISTANCE_EPSILON) {
      continue;
    }
    candidates.push({
      coords: candidateCoords,
      atomIds: descriptor.subtreeAtomIds,
      rotationMagnitude: magnitude
    });
  }
  return candidates;
}

/**
 * Measures exact-continuation distortion only for compact terminal divalent
 * centers attached directly to a ring atom. This excludes ordinary acyclic
 * chain bends, so late presentation retouches can prefer fixing visible ring
 * substituent exits without treating every alkyl zigzag as equally important.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Coordinate map.
 * @returns {{centerCount: number, totalDeviation: number, maxDeviation: number}} Focused distortion statistics.
 */
export function measureRingAdjacentTerminalDivalentContinuationDistortion(layoutGraph, coords) {
  let centerCount = 0;
  let distortedCenterCount = 0;
  let totalDeviation = 0;
  let maxDeviation = 0;

  for (const atomId of coords.keys()) {
    const descriptors = divalentContinuationCandidates(layoutGraph, coords, atomId, null).filter(descriptor => isRingAdjacentTerminalContinuationDescriptor(layoutGraph, coords, descriptor));
    if (descriptors.length === 0) {
      continue;
    }
    const focusedPenalty = measureDivalentContinuationDistortion(layoutGraph, coords, {
      focusAtomIds: new Set([atomId])
    });
    if (focusedPenalty.centerCount <= 0) {
      continue;
    }
    centerCount++;
    totalDeviation += focusedPenalty.maxDeviation;
    maxDeviation = Math.max(maxDeviation, focusedPenalty.maxDeviation);
    if (focusedPenalty.maxDeviation > CLEANUP_EPSILON) {
      distortedCenterCount++;
    }
  }

  return {
    centerCount,
    distortedCenterCount,
    totalDeviation,
    maxDeviation
  };
}

function auditCountsDoNotWorsen(candidateAudit, baseAudit) {
  if (!candidateAudit || !baseAudit || (baseAudit.ok === true && candidateAudit.ok !== true)) {
    return false;
  }
  for (const key of [
    'bondLengthFailureCount',
    'mildBondLengthFailureCount',
    'severeBondLengthFailureCount',
    'collapsedMacrocycleCount',
    'ringSubstituentReadabilityFailureCount',
    'inwardRingSubstituentCount',
    'outwardAxisRingSubstituentFailureCount',
    'severeOverlapCount',
    'visibleHeavyBondCrossingCount',
    'labelOverlapCount'
  ]) {
    if ((candidateAudit[key] ?? 0) > (baseAudit[key] ?? 0)) {
      return false;
    }
  }
  return !((candidateAudit.stereoContradiction ?? false) && !(baseAudit.stereoContradiction ?? false));
}

/**
 * Softly straightens distorted phosphate ester P-O-C continuations in very
 * large layouts by rotating only a bounded side of the linker oxygen. This
 * preserves the rigid phosphorus-centered cross while accepting only candidates
 * that keep externally visible audit counts no worse than the incumbent.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} inputCoords - Starting coordinates.
 * @param {{bondLength?: number, frozenAtomIds?: Set<string>|null, bondValidationClasses?: Map<string, string>|null, maxPasses?: number}} [options] - Retouch options.
 * @returns {{coords: Map<string, {x: number, y: number}>, changed: boolean, nudges: number, movedAtomIds: string[], maxDeviationBefore: number, maxDeviationAfter: number, totalDeviationBefore: number, totalDeviationAfter: number}} Retouch result.
 */
export function runLargePhosphateLinkerContinuationTidy(layoutGraph, inputCoords, options = {}) {
  const bondLength = options.bondLength ?? layoutGraph.options.bondLength;
  const frozenAtomIds = options.frozenAtomIds ?? null;
  const bondValidationClasses = options.bondValidationClasses ?? null;
  const maxPasses = options.maxPasses ?? MAX_LARGE_PHOSPHATE_LINKER_PASSES;
  const baseMetric = measureDivalentContinuationDistortion(layoutGraph, inputCoords);
  let coords = inputCoords;
  let audit = auditLayout(layoutGraph, coords, { bondLength, bondValidationClasses });
  let metric = baseMetric;
  let nudges = 0;
  const movedAtomIds = new Set();

  for (let pass = 0; pass < maxPasses; pass++) {
    let bestCandidate = null;
    for (const descriptor of largePhosphateLinkerDescriptors(layoutGraph, coords).slice(0, 8)) {
      const [firstNeighborAtomId, secondNeighborAtomId] = descriptor.neighborAtomIds;
      for (const [rootAtomId, parentAtomId] of [
        [firstNeighborAtomId, secondNeighborAtomId],
        [secondNeighborAtomId, firstNeighborAtomId]
      ]) {
        const movableSide = largePhosphateMovableSide(layoutGraph, coords, descriptor.centerAtomId, rootAtomId, frozenAtomIds);
        if (!movableSide) {
          continue;
        }
        const centerPosition = coords.get(descriptor.centerAtomId);
        const rootPosition = coords.get(rootAtomId);
        const parentPosition = coords.get(parentAtomId);
        if (!centerPosition || !rootPosition || !parentPosition) {
          continue;
        }
        const rootAngle = angleOf(sub(rootPosition, centerPosition));
        const parentAngle = angleOf(sub(parentPosition, centerPosition));
        for (const sign of [1, -1]) {
          const desiredRotation = normalizeRotation(parentAngle + sign * IDEAL_DIVALENT_CONTINUATION_ANGLE - rootAngle);
          for (const rotation of largePhosphateLinkerRotations(desiredRotation)) {
            const candidateCoords = rotateAtomIdsAroundCenter(coords, descriptor.centerAtomId, movableSide.atomIds, rotation);
            if (!candidateCoords) {
              continue;
            }
            const candidateAudit = auditLayout(layoutGraph, candidateCoords, { bondLength, bondValidationClasses });
            if (!auditCountsDoNotWorsen(candidateAudit, audit)) {
              continue;
            }
            const candidateMetric = measureDivalentContinuationDistortion(layoutGraph, candidateCoords);
            if (candidateMetric.totalDeviation >= metric.totalDeviation - CLEANUP_EPSILON) {
              continue;
            }
            const candidateDescriptor = largePhosphateLinkerDescriptors(layoutGraph, candidateCoords).find(({ centerAtomId }) => centerAtomId === descriptor.centerAtomId);
            const candidate = {
              coords: candidateCoords,
              audit: candidateAudit,
              metric: candidateMetric,
              movedAtomIds: movableSide.atomIds,
              movedHeavyAtomCount: movableSide.heavyAtomCount,
              targetDeviation: candidateDescriptor?.deviation ?? 0
            };
            if (largePhosphateLinkerCandidateIsBetter(candidate, bestCandidate)) {
              bestCandidate = candidate;
            }
          }
        }
      }
    }
    if (!bestCandidate) {
      break;
    }
    coords = bestCandidate.coords;
    audit = bestCandidate.audit;
    metric = bestCandidate.metric;
    for (const atomId of bestCandidate.movedAtomIds) {
      movedAtomIds.add(atomId);
    }
    nudges++;
  }

  return nudges === 0
    ? {
        coords: inputCoords,
        changed: false,
        nudges: 0,
        movedAtomIds: [],
        maxDeviationBefore: baseMetric.maxDeviation,
        maxDeviationAfter: baseMetric.maxDeviation,
        totalDeviationBefore: baseMetric.totalDeviation,
        totalDeviationAfter: baseMetric.totalDeviation
      }
    : {
        coords,
        changed: true,
        nudges,
        movedAtomIds: [...movedAtomIds],
        maxDeviationBefore: baseMetric.maxDeviation,
        maxDeviationAfter: metric.maxDeviation,
        totalDeviationBefore: baseMetric.totalDeviation,
        totalDeviationAfter: metric.totalDeviation
      };
}

/**
 * Softly bends large non-aromatic ether exits such as nucleotide sugar-base
 * O-C continuations back toward the publication-style 120-degree slot. This
 * mirrors the large phosphate linker guardrails but allows a slightly larger
 * single-side rotation because distorted acyclic C-O-C exits often arrive near
 * linear after large-molecule compaction.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} inputCoords - Starting coordinates.
 * @param {{bondLength?: number, frozenAtomIds?: Set<string>|null, bondValidationClasses?: Map<string, string>|null, maxPasses?: number}} [options] - Retouch options.
 * @returns {{coords: Map<string, {x: number, y: number}>, changed: boolean, nudges: number, movedAtomIds: string[], maxDeviationBefore: number, maxDeviationAfter: number, totalDeviationBefore: number, totalDeviationAfter: number}} Retouch result.
 */
export function runLargeAcyclicEtherLinkerContinuationTidy(layoutGraph, inputCoords, options = {}) {
  const bondLength = options.bondLength ?? layoutGraph.options.bondLength;
  const frozenAtomIds = options.frozenAtomIds ?? null;
  const bondValidationClasses = options.bondValidationClasses ?? null;
  const maxPasses = options.maxPasses ?? MAX_LARGE_ACYCLIC_ETHER_LINKER_PASSES;
  const baseMetric = measureDivalentContinuationDistortion(layoutGraph, inputCoords);
  let coords = inputCoords;
  let audit = auditLayout(layoutGraph, coords, { bondLength, bondValidationClasses });
  let metric = baseMetric;
  let nudges = 0;
  const movedAtomIds = new Set();

  for (let pass = 0; pass < maxPasses; pass++) {
    let bestCandidate = null;
    for (const descriptor of largeAcyclicEtherLinkerDescriptors(layoutGraph, coords).slice(0, 12)) {
      const [firstNeighborAtomId, secondNeighborAtomId] = descriptor.neighborAtomIds;
      for (const [rootAtomId, parentAtomId] of [
        [firstNeighborAtomId, secondNeighborAtomId],
        [secondNeighborAtomId, firstNeighborAtomId]
      ]) {
        const movableSide = largeAcyclicEtherMovableSide(layoutGraph, coords, descriptor.centerAtomId, rootAtomId, frozenAtomIds);
        if (!movableSide) {
          continue;
        }
        const centerPosition = coords.get(descriptor.centerAtomId);
        const rootPosition = coords.get(rootAtomId);
        const parentPosition = coords.get(parentAtomId);
        if (!centerPosition || !rootPosition || !parentPosition) {
          continue;
        }
        const rootAngle = angleOf(sub(rootPosition, centerPosition));
        const parentAngle = angleOf(sub(parentPosition, centerPosition));
        for (const sign of [1, -1]) {
          const desiredRotation = normalizeRotation(parentAngle + sign * IDEAL_DIVALENT_CONTINUATION_ANGLE - rootAngle);
          for (const rotation of largeAcyclicEtherLinkerRotations(desiredRotation)) {
            const candidateCoords = rotateAtomIdsAroundCenter(coords, descriptor.centerAtomId, movableSide.atomIds, rotation);
            if (!candidateCoords) {
              continue;
            }
            const candidateAudit = auditLayout(layoutGraph, candidateCoords, { bondLength, bondValidationClasses });
            if (!auditCountsDoNotWorsen(candidateAudit, audit)) {
              continue;
            }
            const candidateMetric = measureDivalentContinuationDistortion(layoutGraph, candidateCoords);
            if (candidateMetric.totalDeviation >= metric.totalDeviation - CLEANUP_EPSILON) {
              continue;
            }
            const candidateDescriptor = largeAcyclicEtherLinkerDescriptors(layoutGraph, candidateCoords).find(({ centerAtomId }) => centerAtomId === descriptor.centerAtomId);
            const candidate = {
              coords: candidateCoords,
              audit: candidateAudit,
              metric: candidateMetric,
              movedAtomIds: movableSide.atomIds,
              movedHeavyAtomCount: movableSide.heavyAtomCount,
              targetDeviation: candidateDescriptor?.deviation ?? 0
            };
            if (largePhosphateLinkerCandidateIsBetter(candidate, bestCandidate)) {
              bestCandidate = candidate;
            }
          }
        }
      }
    }
    if (!bestCandidate) {
      break;
    }
    coords = bestCandidate.coords;
    audit = bestCandidate.audit;
    metric = bestCandidate.metric;
    for (const atomId of bestCandidate.movedAtomIds) {
      movedAtomIds.add(atomId);
    }
    nudges++;
  }

  return nudges === 0
    ? {
        coords: inputCoords,
        changed: false,
        nudges: 0,
        movedAtomIds: [],
        maxDeviationBefore: baseMetric.maxDeviation,
        maxDeviationAfter: baseMetric.maxDeviation,
        totalDeviationBefore: baseMetric.totalDeviation,
        totalDeviationAfter: baseMetric.totalDeviation
      }
    : {
        coords,
        changed: true,
        nudges,
        movedAtomIds: [...movedAtomIds],
        maxDeviationBefore: baseMetric.maxDeviation,
        maxDeviationAfter: metric.maxDeviation,
        totalDeviationBefore: baseMetric.totalDeviation,
        totalDeviationAfter: metric.totalDeviation
      };
}

function isBetterDivalentContinuationCandidate(candidate, incumbent) {
  if (!incumbent) {
    return true;
  }
  if (candidate.penalty.maxDeviation < incumbent.penalty.maxDeviation - CLEANUP_EPSILON) {
    return true;
  }
  if (candidate.penalty.maxDeviation > incumbent.penalty.maxDeviation + CLEANUP_EPSILON) {
    return false;
  }
  if (candidate.penalty.totalDeviation < incumbent.penalty.totalDeviation - CLEANUP_EPSILON) {
    return true;
  }
  if (candidate.penalty.totalDeviation > incumbent.penalty.totalDeviation + CLEANUP_EPSILON) {
    return false;
  }
  if ((candidate.audit?.ok === true) !== (incumbent.audit?.ok === true)) {
    return candidate.audit?.ok === true;
  }
  for (const key of ['severeOverlapCount', 'visibleHeavyBondCrossingCount', 'labelOverlapCount']) {
    const candidateCount = candidate.audit?.[key] ?? 0;
    const incumbentCount = incumbent.audit?.[key] ?? 0;
    if (candidateCount !== incumbentCount) {
      return candidateCount < incumbentCount;
    }
  }
  const candidateOverlapPenalty = candidate.audit?.severeOverlapPenalty ?? 0;
  const incumbentOverlapPenalty = incumbent.audit?.severeOverlapPenalty ?? 0;
  if (Math.abs(candidateOverlapPenalty - incumbentOverlapPenalty) > CLEANUP_EPSILON) {
    return candidateOverlapPenalty < incumbentOverlapPenalty;
  }
  return candidate.rotationMagnitude < incumbent.rotationMagnitude - CLEANUP_EPSILON;
}

/**
 * Snaps compact terminal sides of exact divalent continuations back to 120
 * degrees. This is intentionally late and narrow: it only moves small acyclic
 * leaf-side subtrees, leaving ring roots and larger branches fixed.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} inputCoords - Starting coordinates.
 * @param {{frozenAtomIds?: Set<string>|null}} [options] - Retouch options.
 * @returns {{coords: Map<string, {x: number, y: number}>, nudges: number, changed: boolean}} Retouch result.
 */
export function runDivalentContinuationTidy(layoutGraph, inputCoords, options = {}) {
  const bondLength = options.bondLength ?? layoutGraph.options.bondLength;
  const frozenAtomIds = options.frozenAtomIds ?? null;
  const allowAuditWorsening = options.allowAuditWorsening === true;
  const basePenalty = measureDivalentContinuationDistortion(layoutGraph, inputCoords);
  if (basePenalty.maxDeviation <= CLEANUP_EPSILON) {
    return {
      coords: inputCoords,
      nudges: 0,
      changed: false
    };
  }

  let coords = inputCoords;
  let audit = auditLayout(layoutGraph, coords, { bondLength });
  const movedAtomIds = new Set();
  let nudges = 0;
  for (const atomId of inputCoords.keys()) {
    const focusedPenalty = measureDivalentContinuationDistortion(layoutGraph, coords, {
      focusAtomIds: new Set([atomId])
    });
    if (focusedPenalty.maxDeviation <= CLEANUP_EPSILON) {
      continue;
    }
    let bestCandidate = null;
    for (const descriptor of divalentContinuationCandidates(layoutGraph, coords, atomId, frozenAtomIds)) {
      for (const candidate of buildContinuationCandidates(layoutGraph, coords, descriptor)) {
        let candidateCoords = candidate.coords;
        let candidateAudit = auditLayout(layoutGraph, candidateCoords, { bondLength });
        let candidateAtomIds = candidate.atomIds;
        const contactRelief = allowAuditWorsening ? relieveHypervalentContactAfterDivalentSnap(layoutGraph, candidateCoords, candidateAtomIds, frozenAtomIds, bondLength) : null;
        if (contactRelief && auditCountsDoNotWorsen(contactRelief.audit, audit)) {
          candidateCoords = contactRelief.coords;
          candidateAudit = contactRelief.audit;
          candidateAtomIds = contactRelief.atomIds;
        }
        if (!allowAuditWorsening && !auditCountsDoNotWorsen(candidateAudit, audit)) {
          continue;
        }
        const penalty = measureDivalentContinuationDistortion(layoutGraph, candidateCoords, {
          focusAtomIds: new Set([atomId])
        });
        if (penalty.maxDeviation >= focusedPenalty.maxDeviation - CLEANUP_EPSILON) {
          continue;
        }
        const scoredCandidate = {
          ...candidate,
          coords: candidateCoords,
          atomIds: candidateAtomIds,
          audit: candidateAudit,
          penalty
        };
        if (isBetterDivalentContinuationCandidate(scoredCandidate, bestCandidate)) {
          bestCandidate = scoredCandidate;
        }
      }
    }
    if (!bestCandidate) {
      continue;
    }
    coords = bestCandidate.coords;
    audit = bestCandidate.audit;
    for (const movedAtomId of bestCandidate.atomIds ?? []) {
      movedAtomIds.add(movedAtomId);
    }
    nudges++;
  }

  return nudges === 0
    ? {
        coords: inputCoords,
        nudges: 0,
        changed: false
      }
    : {
        coords,
        nudges,
        changed: true,
        movedAtomIds: [...movedAtomIds]
      };
}

/**
 * Rotates terminal alkene tails away from local overlaps while restoring the
 * visible alkene continuation to its exact trigonal bend.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} inputCoords - Starting coordinates.
 * @param {{bondLength?: number, frozenAtomIds?: Set<string>|null}} [options] - Retouch options.
 * @returns {{coords: Map<string, {x: number, y: number}>, nudges: number, changed: boolean, movedAtomIds?: string[]}} Retouch result.
 */
export function runTerminalAlkeneContinuationRelief(layoutGraph, inputCoords, options = {}) {
  const bondLength = options.bondLength ?? layoutGraph.options.bondLength;
  const frozenAtomIds = options.frozenAtomIds ?? null;
  const descriptors = [];
  for (const centerAtomId of inputCoords.keys()) {
    const descriptor = terminalAlkeneContinuationDescriptor(layoutGraph, inputCoords, centerAtomId, frozenAtomIds);
    if (!descriptor) {
      continue;
    }
    descriptors.push(descriptor);
  }
  if (descriptors.length === 0) {
    return {
      coords: inputCoords,
      nudges: 0,
      changed: false
    };
  }

  const baseAudit = auditLayout(layoutGraph, inputCoords, { bondLength });
  let bestCandidate = null;
  for (const descriptor of descriptors) {
    for (const rotation of TERMINAL_ALKENE_PARENT_ROTATIONS) {
      const parentRotatedCoords = rotateAtomIdsAroundAtom(inputCoords, descriptor.parentSubtreeAtomIds, descriptor.grandParentAtomId, rotation);
      const candidateCoords = parentRotatedCoords ? restoreTerminalAlkeneLeafAngle(parentRotatedCoords, descriptor) : null;
      if (!candidateCoords || terminalAlkeneAngleDeviation(candidateCoords, descriptor) > CLEANUP_EPSILON) {
        continue;
      }
      const candidateAudit = auditLayout(layoutGraph, candidateCoords, { bondLength });
      if (
        (candidateAudit.severeOverlapCount ?? 0) > (baseAudit.severeOverlapCount ?? 0) ||
        (candidateAudit.bondLengthFailureCount ?? 0) > (baseAudit.bondLengthFailureCount ?? 0) ||
        (candidateAudit.visibleHeavyBondCrossingCount ?? 0) > (baseAudit.visibleHeavyBondCrossingCount ?? 0) + 1
      ) {
        continue;
      }
      const candidate = {
        coords: candidateCoords,
        audit: candidateAudit,
        rotationMagnitude: Math.abs(rotation),
        movedAtomIds: [...new Set([...descriptor.parentSubtreeAtomIds, ...descriptor.leafSubtreeAtomIds])]
      };
      if (
        !bestCandidate ||
        (candidate.audit.ok === true && bestCandidate.audit.ok !== true) ||
        (candidate.audit.severeOverlapCount ?? 0) < (bestCandidate.audit.severeOverlapCount ?? 0) ||
        ((candidate.audit.severeOverlapCount ?? 0) === (bestCandidate.audit.severeOverlapCount ?? 0) && candidate.rotationMagnitude < bestCandidate.rotationMagnitude - CLEANUP_EPSILON)
      ) {
        bestCandidate = candidate;
      }
    }
  }
  return bestCandidate
    ? {
        coords: bestCandidate.coords,
        nudges: 1,
        changed: true,
        movedAtomIds: bestCandidate.movedAtomIds
      }
    : {
        coords: inputCoords,
        nudges: 0,
        changed: false
      };
}

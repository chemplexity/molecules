/** @module cleanup/presentation/divalent-continuation */

import { CLEANUP_EPSILON, DISTANCE_EPSILON } from '../../constants.js';
import { angleOf, angularDifference, rotate, sub, wrapAngle } from '../../geometry/vec2.js';
import { rotateAround } from '../../geometry/transforms.js';
import { isExactSimpleAcyclicContinuationEligible } from '../../placement/branch-placement/angle-selection.js';
import { auditLayout } from '../../audit/audit.js';
import { measureDivalentContinuationDistortion } from '../../audit/invariants.js';
import { collectCutSubtree } from '../subtree-utils.js';

const MAX_MOVABLE_DIVALENT_CONTINUATION_HEAVY_ATOMS = 4;
const MAX_MOVABLE_CARBONYL_RING_CONTINUATION_HEAVY_ATOMS = 18;
const IDEAL_DIVALENT_CONTINUATION_ANGLE = (2 * Math.PI) / 3;
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

function visibleHeavyCovalentBonds(layoutGraph, coords, atomId) {
  const bonds = [];
  for (const bond of layoutGraph.bondsByAtomId.get(atomId) ?? []) {
    if (!bond || bond.kind !== 'covalent') {
      continue;
    }
    const neighborAtomId = bond.a === atomId ? bond.b : bond.a;
    const neighborAtom = layoutGraph.atoms.get(neighborAtomId);
    if (!neighborAtom || neighborAtom.element === 'H' || !coords.has(neighborAtomId)) {
      continue;
    }
    bonds.push({ bond, neighborAtomId });
  }
  return bonds;
}

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
    if ((layoutGraph.atomToRings.get(neighborAtomId)?.length ?? 0) > 0) {
      hasAttachedRingNeighbor = true;
    }
  }
  return (
    hasTerminalMultipleHetero
    && hasAttachedRingNeighbor
    && subtreeAtomIds.some(atomId => (layoutGraph.atomToRings.get(atomId)?.length ?? 0) > 0)
  );
}

function collectCompactMovableSide(layoutGraph, coords, rootAtomId, centerAtomId, frozenAtomIds) {
  const subtreeAtomIds = [...collectCutSubtree(layoutGraph, rootAtomId, centerAtomId)]
    .filter(atomId => coords.has(atomId));
  if (subtreeAtomIds.length === 0 || subtreeAtomIds.includes(centerAtomId)) {
    return null;
  }
  const allowRingAtoms = isCarbonylAttachedRingContinuationSide(layoutGraph, rootAtomId, centerAtomId, subtreeAtomIds);
  let heavyAtomCount = 0;
  for (const atomId of subtreeAtomIds) {
    if (frozenAtomIds?.has(atomId)) {
      return null;
    }
    if (!allowRingAtoms && (layoutGraph.atomToRings.get(atomId)?.length ?? 0) > 0) {
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
  const heavyAtomLimit = allowRingAtoms
    ? MAX_MOVABLE_CARBONYL_RING_CONTINUATION_HEAVY_ATOMS
    : MAX_MOVABLE_DIVALENT_CONTINUATION_HEAVY_ATOMS;
  return heavyAtomCount > 0 && heavyAtomCount <= heavyAtomLimit
    ? subtreeAtomIds
    : null;
}

function divalentContinuationCandidates(layoutGraph, coords, centerAtomId, frozenAtomIds) {
  if (frozenAtomIds?.has(centerAtomId)) {
    return [];
  }
  const centerAtom = layoutGraph.atoms.get(centerAtomId);
  if (!centerAtom || centerAtom.element === 'H' || centerAtom.aromatic || (layoutGraph.atomToRings.get(centerAtomId)?.length ?? 0) > 0) {
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
    (layoutGraph.atomToRings.get(descriptor.parentAtomId)?.length ?? 0) > 0 &&
    (layoutGraph.atomToRings.get(descriptor.rootAtomId)?.length ?? 0) === 0 &&
    isExactSimpleAcyclicContinuationEligible(
      layoutGraph,
      descriptor.centerAtomId,
      descriptor.parentAtomId,
      descriptor.rootAtomId
    )
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
  const grandParentAtomId = visibleHeavyCovalentBonds(layoutGraph, coords, parentAtomId)
    .map(({ neighborAtomId }) => neighborAtomId)
    .find(neighborAtomId => neighborAtomId !== centerAtomId) ?? null;
  if (!grandParentAtomId || frozenAtomIds?.has(parentAtomId) || frozenAtomIds?.has(leafAtomId)) {
    return null;
  }
  const parentSubtreeAtomIds = [...collectCutSubtree(layoutGraph, parentAtomId, grandParentAtomId)]
    .filter(atomId => coords.has(atomId));
  const leafSubtreeAtomIds = [...collectCutSubtree(layoutGraph, leafAtomId, centerAtomId)]
    .filter(atomId => coords.has(atomId));
  if (
    parentSubtreeAtomIds.length === 0
    || leafSubtreeAtomIds.length === 0
    || parentSubtreeAtomIds.some(atomId => frozenAtomIds?.has(atomId))
    || leafSubtreeAtomIds.some(atomId => frozenAtomIds?.has(atomId))
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
  return Math.abs(
    angularDifference(
      angleOf(sub(parentPosition, centerPosition)),
      angleOf(sub(leafPosition, centerPosition))
    ) - IDEAL_DIVALENT_CONTINUATION_ANGLE
  );
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
  for (const targetAngle of [
    parentAngle + IDEAL_DIVALENT_CONTINUATION_ANGLE,
    parentAngle - IDEAL_DIVALENT_CONTINUATION_ANGLE
  ]) {
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
  for (const targetAngle of [
    parentAngle + IDEAL_DIVALENT_CONTINUATION_ANGLE,
    parentAngle - IDEAL_DIVALENT_CONTINUATION_ANGLE
  ]) {
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
    const descriptors = divalentContinuationCandidates(layoutGraph, coords, atomId, null)
      .filter(descriptor => isRingAdjacentTerminalContinuationDescriptor(layoutGraph, coords, descriptor));
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
        const candidateAudit = auditLayout(layoutGraph, candidate.coords, { bondLength });
        if (!allowAuditWorsening && !auditCountsDoNotWorsen(candidateAudit, audit)) {
          continue;
        }
        const penalty = measureDivalentContinuationDistortion(layoutGraph, candidate.coords, {
          focusAtomIds: new Set([atomId])
        });
        if (penalty.maxDeviation >= focusedPenalty.maxDeviation - CLEANUP_EPSILON) {
          continue;
        }
        const scoredCandidate = {
          ...candidate,
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
  const baseAudit = auditLayout(layoutGraph, inputCoords, { bondLength });
  let bestCandidate = null;
  for (const centerAtomId of inputCoords.keys()) {
    const descriptor = terminalAlkeneContinuationDescriptor(layoutGraph, inputCoords, centerAtomId, frozenAtomIds);
    if (!descriptor) {
      continue;
    }
    for (const rotation of TERMINAL_ALKENE_PARENT_ROTATIONS) {
      const parentRotatedCoords = rotateAtomIdsAroundAtom(
        inputCoords,
        descriptor.parentSubtreeAtomIds,
        descriptor.grandParentAtomId,
        rotation
      );
      const candidateCoords = parentRotatedCoords
        ? restoreTerminalAlkeneLeafAngle(parentRotatedCoords, descriptor)
        : null;
      if (!candidateCoords || terminalAlkeneAngleDeviation(candidateCoords, descriptor) > CLEANUP_EPSILON) {
        continue;
      }
      const candidateAudit = auditLayout(layoutGraph, candidateCoords, { bondLength });
      if (
        (candidateAudit.severeOverlapCount ?? 0) > (baseAudit.severeOverlapCount ?? 0)
        || (candidateAudit.bondLengthFailureCount ?? 0) > (baseAudit.bondLengthFailureCount ?? 0)
        || (candidateAudit.visibleHeavyBondCrossingCount ?? 0) > (baseAudit.visibleHeavyBondCrossingCount ?? 0) + 1
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
        !bestCandidate
        || (candidate.audit.ok === true && bestCandidate.audit.ok !== true)
        || (candidate.audit.severeOverlapCount ?? 0) < (bestCandidate.audit.severeOverlapCount ?? 0)
        || (
          (candidate.audit.severeOverlapCount ?? 0) === (bestCandidate.audit.severeOverlapCount ?? 0)
          && candidate.rotationMagnitude < bestCandidate.rotationMagnitude - CLEANUP_EPSILON
        )
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

/** @module cleanup/presentation/organometallic-aromatic-ring-retouch */

import { auditLayout } from '../../audit/audit.js';
import { findSevereOverlaps } from '../../audit/invariants.js';
import { isMetalAtom } from '../../topology/metal-centers.js';
import { add, angleOf, angularDifference, centroid, distance, fromAngle, scale, sub } from '../../geometry/vec2.js';
import { atomPairKey } from '../../constants.js';

const COORDINATE_BOND_KINDS = new Set(['coordinate', 'dative', 'haptic']);
const RING_RETOUCH_MIN_ANGLE_DEVIATION = Math.PI / 7.5;
const RING_RETOUCH_MIN_IMPROVEMENT = Math.PI / 18;
const RING_RETOUCH_BOND_DEVIATION_SLACK_FACTOR = 0.02;
const COORDINATE_LIGAND_OUTWARD_STEPS = Object.freeze([0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75]);
const COORDINATE_LIGAND_MAX_HEAVY_ATOMS = 12;
const COORDINATE_LIGAND_MAX_LAYOUT_HEAVY_ATOMS = 80;
const COORDINATE_LIGAND_MAX_PASSES = 2;
const RING_ATOM_OVERLAP_MAX_LAYOUT_HEAVY_ATOMS = 120;
const RING_ATOM_OVERLAP_MAX_MOVED_HEAVY_ATOMS = 8;
const RING_ATOM_OVERLAP_MAX_DEVIATION_SLACK_FACTOR = 0.18;
const RING_ATOM_OVERLAP_SPREAD_FACTORS = Object.freeze([0.15, 0.18, 0.2, 0.24, 0.28, 1 / 3]);
const METAL_BRANCH_FAN_MAX_LAYOUT_HEAVY_ATOMS = 80;
const METAL_BRANCH_FAN_MAX_MOVED_HEAVY_ATOMS = 6;
const METAL_BRANCH_FAN_ROTATIONS = Object.freeze([10, 15, 20, 30, 40, 45, 50, 55, 60, 75, 90].map(degrees => (degrees * Math.PI) / 180).flatMap(rotation => [rotation, -rotation]));
const RING_SIDECHAIN_FAN_MAX_LAYOUT_HEAVY_ATOMS = 120;
const RING_SIDECHAIN_FAN_MAX_MOVED_HEAVY_ATOMS = 12;
const RING_SIDECHAIN_FAN_MAX_PATH_ATOMS = 7;
const RING_SIDECHAIN_FAN_ROTATIONS = Object.freeze(
  [15, 30, 45, 60, 75, 90, 105, 120, 135, 150, 165, 180]
    .map(degrees => (degrees * Math.PI) / 180)
    .flatMap(rotation => [rotation, -rotation])
);

function otherBondAtomId(bond, atomId) {
  return bond.a === atomId ? bond.b : bond.a;
}

function internalRingAngle(coords, ring, atomIndex) {
  const atomId = ring.atomIds[atomIndex];
  const previousAtomId = ring.atomIds[(atomIndex - 1 + ring.atomIds.length) % ring.atomIds.length];
  const nextAtomId = ring.atomIds[(atomIndex + 1) % ring.atomIds.length];
  const atomPosition = coords.get(atomId);
  const previousPosition = coords.get(previousAtomId);
  const nextPosition = coords.get(nextAtomId);
  if (!atomPosition || !previousPosition || !nextPosition) {
    return null;
  }
  return angularDifference(angleOf(sub(previousPosition, atomPosition)), angleOf(sub(nextPosition, atomPosition)));
}

function ringRegularity(layoutGraph, coords, rings) {
  let ringCount = 0;
  let maxAngleDeviation = 0;
  let totalAngleDeviation = 0;

  for (const ring of rings) {
    if (ring.atomIds.some(atomId => !coords.has(atomId))) {
      continue;
    }
    const expectedAngle = Math.PI - (2 * Math.PI) / ring.atomIds.length;
    ringCount++;
    for (let index = 0; index < ring.atomIds.length; index++) {
      const angle = internalRingAngle(coords, ring, index);
      if (angle == null) {
        continue;
      }
      const deviation = Math.abs(angle - expectedAngle);
      maxAngleDeviation = Math.max(maxAngleDeviation, deviation);
      totalAngleDeviation += deviation;
    }
  }

  return {
    ringCount,
    maxAngleDeviation,
    totalAngleDeviation
  };
}

function ringHasCoordinateMetalLink(layoutGraph, ring) {
  for (const atomId of ring.atomIds) {
    for (const bond of layoutGraph.bondsByAtomId.get(atomId) ?? []) {
      if (!COORDINATE_BOND_KINDS.has(bond.kind)) {
        continue;
      }
      const otherAtomId = otherBondAtomId(bond, atomId);
      const otherAtom = layoutGraph.sourceMolecule?.atoms?.get(otherAtomId) ?? layoutGraph.atoms.get(otherAtomId);
      if (isMetalAtom(otherAtom)) {
        return true;
      }
    }
  }
  return false;
}

function findInterAromaticRingAnchorAtomId(layoutGraph, ring) {
  const ringAtomIds = new Set(ring.atomIds);
  for (const atomId of ring.atomIds) {
    for (const bond of layoutGraph.bondsByAtomId.get(atomId) ?? []) {
      if (!bond || bond.kind !== 'covalent') {
        continue;
      }
      const neighborAtomId = otherBondAtomId(bond, atomId);
      if (ringAtomIds.has(neighborAtomId)) {
        continue;
      }
      const neighborAromaticRing = (layoutGraph.atomToRings.get(neighborAtomId) ?? []).some(candidateRing => candidateRing.aromatic && candidateRing.atomIds.length >= 5);
      if (neighborAromaticRing) {
        return atomId;
      }
    }
  }
  return null;
}

function shouldRetouchRing(layoutGraph, coords, ring) {
  if (!ring?.aromatic || ring.atomIds.length < 5 || ring.atomIds.length > 6) {
    return false;
  }
  if (!ringHasCoordinateMetalLink(layoutGraph, ring)) {
    return false;
  }
  if (!findInterAromaticRingAnchorAtomId(layoutGraph, ring)) {
    return false;
  }
  return ringRegularity(layoutGraph, coords, [ring]).maxAngleDeviation > RING_RETOUCH_MIN_ANGLE_DEVIATION;
}

function fitRegularRingTargets(ring, coords, bondLength) {
  const positions = ring.atomIds.map(atomId => coords.get(atomId));
  if (positions.some(position => !position)) {
    return null;
  }

  const center = centroid(positions);
  const step = (2 * Math.PI) / ring.atomIds.length;
  const radius = bondLength / (2 * Math.sin(Math.PI / ring.atomIds.length));
  const actualAngles = positions.map(position => angleOf(sub(position, center)));
  let bestTargets = null;
  let bestError = Number.POSITIVE_INFINITY;

  for (const direction of [1, -1]) {
    const offsetVector = actualAngles.reduce(
      (sum, angle, index) => {
        const offset = angle - direction * index * step;
        return {
          x: sum.x + Math.cos(offset),
          y: sum.y + Math.sin(offset)
        };
      },
      { x: 0, y: 0 }
    );
    const baseAngle = Math.atan2(offsetVector.y, offsetVector.x);
    const targets = new Map();
    let error = 0;

    for (let index = 0; index < ring.atomIds.length; index++) {
      const target = add(center, fromAngle(baseAngle + direction * index * step, radius));
      const actual = positions[index];
      error += (target.x - actual.x) ** 2 + (target.y - actual.y) ** 2;
      targets.set(ring.atomIds[index], target);
    }

    if (error < bestError) {
      bestError = error;
      bestTargets = targets;
    }
  }

  return bestTargets;
}

function anchorShiftedRegularTargets(layoutGraph, coords, ring, bondLength, anchorTargetPositions = new Map()) {
  const targets = fitRegularRingTargets(ring, coords, bondLength);
  if (!targets) {
    return null;
  }
  const anchorAtomId = findInterAromaticRingAnchorAtomId(layoutGraph, ring);
  const anchorTarget = targets.get(anchorAtomId);
  const anchorPosition = anchorTargetPositions.get(anchorAtomId) ?? coords.get(anchorAtomId);
  if (!anchorTarget || !anchorPosition) {
    return null;
  }
  const shift = sub(anchorPosition, anchorTarget);
  return new Map([...targets].map(([atomId, target]) => [atomId, add(target, shift)]));
}

function buildInterRingAnchorTargetPositions(layoutGraph, coords, rings, bondLength) {
  const candidateRingIds = new Set(rings.map(ring => ring.id));
  const anchorByRingId = new Map();
  for (const ring of rings) {
    const anchorAtomId = findInterAromaticRingAnchorAtomId(layoutGraph, ring);
    if (anchorAtomId) {
      anchorByRingId.set(ring.id, anchorAtomId);
    }
  }

  const ringIdsByAtomId = new Map();
  for (const ring of rings) {
    for (const atomId of ring.atomIds) {
      const ringIds = ringIdsByAtomId.get(atomId) ?? [];
      ringIds.push(ring.id);
      ringIdsByAtomId.set(atomId, ringIds);
    }
  }

  const anchorTargetPositions = new Map();
  const seenPairKeys = new Set();
  for (const ring of rings) {
    const anchorAtomId = anchorByRingId.get(ring.id);
    if (!anchorAtomId) {
      continue;
    }
    for (const bond of layoutGraph.bondsByAtomId.get(anchorAtomId) ?? []) {
      if (!bond || bond.kind !== 'covalent') {
        continue;
      }
      const neighborAtomId = otherBondAtomId(bond, anchorAtomId);
      for (const neighborRingId of ringIdsByAtomId.get(neighborAtomId) ?? []) {
        if (!candidateRingIds.has(neighborRingId) || anchorByRingId.get(neighborRingId) !== neighborAtomId) {
          continue;
        }
        const pairKey = anchorAtomId < neighborAtomId ? `${anchorAtomId}:${neighborAtomId}` : `${neighborAtomId}:${anchorAtomId}`;
        if (seenPairKeys.has(pairKey)) {
          continue;
        }
        seenPairKeys.add(pairKey);
        const firstPosition = coords.get(anchorAtomId);
        const secondPosition = coords.get(neighborAtomId);
        if (!firstPosition || !secondPosition) {
          continue;
        }
        const vector = sub(secondPosition, firstPosition);
        const span = Math.hypot(vector.x, vector.y);
        if (span <= 1e-9) {
          continue;
        }
        const midpoint = {
          x: (firstPosition.x + secondPosition.x) / 2,
          y: (firstPosition.y + secondPosition.y) / 2
        };
        const half = bondLength / 2;
        const unit = {
          x: vector.x / span,
          y: vector.y / span
        };
        anchorTargetPositions.set(anchorAtomId, {
          x: midpoint.x - unit.x * half,
          y: midpoint.y - unit.y * half
        });
        anchorTargetPositions.set(neighborAtomId, {
          x: midpoint.x + unit.x * half,
          y: midpoint.y + unit.y * half
        });
      }
    }
  }

  return anchorTargetPositions;
}

function covalentSubtree(layoutGraph, rootAtomId, blockedAtomIds) {
  const atomIds = [];
  const seen = new Set(blockedAtomIds);
  const queue = [rootAtomId];
  seen.add(rootAtomId);

  while (queue.length > 0) {
    const atomId = queue.shift();
    atomIds.push(atomId);
    for (const bond of layoutGraph.bondsByAtomId.get(atomId) ?? []) {
      if (!bond || bond.kind !== 'covalent') {
        continue;
      }
      const neighborAtomId = otherBondAtomId(bond, atomId);
      if (seen.has(neighborAtomId)) {
        continue;
      }
      seen.add(neighborAtomId);
      queue.push(neighborAtomId);
    }
  }

  return atomIds;
}

function isMetalAtomId(layoutGraph, atomId) {
  return isMetalAtom(layoutGraph.sourceMolecule?.atoms?.get(atomId) ?? layoutGraph.atoms.get(atomId));
}

function coordinateMetalNeighborIds(layoutGraph, atomId) {
  const metalAtomIds = [];
  for (const bond of layoutGraph.bondsByAtomId.get(atomId) ?? []) {
    if (!bond || !COORDINATE_BOND_KINDS.has(bond.kind)) {
      continue;
    }
    const neighborAtomId = otherBondAtomId(bond, atomId);
    if (isMetalAtomId(layoutGraph, neighborAtomId)) {
      metalAtomIds.push(neighborAtomId);
    }
  }
  return metalAtomIds;
}

function ligandFragmentHasAromaticRing(layoutGraph, atomIdSet) {
  return (layoutGraph.rings ?? []).some(ring => ring.aromatic && ring.atomIds.length >= 5 && ring.atomIds.every(atomId => atomIdSet.has(atomId)));
}

function visibleHeavyAtomCount(layoutGraph, atomIds) {
  return atomIds.reduce((count, atomId) => {
    const atom = layoutGraph.atoms.get(atomId);
    return atom && atom.element !== 'H' && atom.visible !== false ? count + 1 : count;
  }, 0);
}

function collectSingleAnchorCoordinateAromaticLigands(layoutGraph, coords) {
  const records = [];
  const seenKeys = new Set();
  for (const [atomId, atom] of layoutGraph.atoms) {
    if (!atom || atom.element === 'H' || !coords.has(atomId)) {
      continue;
    }
    const metalAtomIds = coordinateMetalNeighborIds(layoutGraph, atomId).filter(metalAtomId => coords.has(metalAtomId));
    if (metalAtomIds.length !== 1) {
      continue;
    }
    const fragmentAtomIds = covalentSubtree(layoutGraph, atomId, new Set(metalAtomIds));
    const fragmentAtomIdSet = new Set(fragmentAtomIds);
    const coordinateAnchorIds = fragmentAtomIds.filter(fragmentAtomId => coordinateMetalNeighborIds(layoutGraph, fragmentAtomId).length > 0);
    if (coordinateAnchorIds.length !== 1 || coordinateAnchorIds[0] !== atomId) {
      continue;
    }
    if (visibleHeavyAtomCount(layoutGraph, fragmentAtomIds) > COORDINATE_LIGAND_MAX_HEAVY_ATOMS || !ligandFragmentHasAromaticRing(layoutGraph, fragmentAtomIdSet)) {
      continue;
    }
    const key = fragmentAtomIds.sort().join('|');
    if (seenKeys.has(key)) {
      continue;
    }
    seenKeys.add(key);
    records.push({
      anchorAtomId: atomId,
      metalAtomId: metalAtomIds[0],
      atomIds: fragmentAtomIds
    });
  }
  return records;
}

function translateAtomIds(coords, atomIds, displacement) {
  const nextCoords = new Map(coords);
  for (const atomId of atomIds) {
    const position = nextCoords.get(atomId);
    if (!position) {
      continue;
    }
    nextCoords.set(atomId, add(position, displacement));
  }
  return nextCoords;
}

function rotateAtomIdsAroundPivot(coords, atomIds, pivot, rotation) {
  const nextCoords = new Map(coords);
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  for (const atomId of atomIds) {
    const position = coords.get(atomId);
    if (!position) {
      continue;
    }
    const dx = position.x - pivot.x;
    const dy = position.y - pivot.y;
    nextCoords.set(atomId, {
      x: pivot.x + dx * cos - dy * sin,
      y: pivot.y + dx * sin + dy * cos
    });
  }
  return nextCoords;
}

function atomHasCoordinateMetalRing(layoutGraph, atomId) {
  return (layoutGraph.atomToRings.get(atomId) ?? []).some(ring => ringHasCoordinateMetalLink(layoutGraph, ring));
}

function collectRingAtomOverlapMoveGroup(layoutGraph, coords, atomId, blockedAtomId) {
  const atom = layoutGraph.atoms.get(atomId);
  if (!atom || atom.element === 'H' || !coords.has(atomId) || !layoutGraph.ringAtomIdSet.has(atomId) || !atomHasCoordinateMetalRing(layoutGraph, atomId)) {
    return [];
  }

  const atomIds = new Set([atomId]);
  const blockedAtomIds = new Set([blockedAtomId, atomId]);
  for (const bond of layoutGraph.bondsByAtomId.get(atomId) ?? []) {
    if (!bond || bond.kind !== 'covalent') {
      continue;
    }
    const neighborAtomId = otherBondAtomId(bond, atomId);
    const neighborAtom = layoutGraph.atoms.get(neighborAtomId);
    if (!neighborAtom || !coords.has(neighborAtomId)) {
      continue;
    }
    if (neighborAtom.element === 'H') {
      atomIds.add(neighborAtomId);
      continue;
    }
    if (layoutGraph.ringAtomIdSet.has(neighborAtomId)) {
      continue;
    }
    for (const subtreeAtomId of covalentSubtree(layoutGraph, neighborAtomId, blockedAtomIds)) {
      if (coords.has(subtreeAtomId)) {
        atomIds.add(subtreeAtomId);
      }
    }
  }

  const movedHeavyAtomCount = [...atomIds].filter(currentAtomId => {
    const currentAtom = layoutGraph.atoms.get(currentAtomId);
    return currentAtom && currentAtom.element !== 'H' && currentAtom.visible !== false;
  }).length;
  return movedHeavyAtomCount <= RING_ATOM_OVERLAP_MAX_MOVED_HEAVY_ATOMS ? [...atomIds] : [];
}

function coordinateRingAtomOverlapDescriptors(layoutGraph, coords, bondLength) {
  const descriptors = [];
  for (const overlap of findSevereOverlaps(layoutGraph, coords, bondLength)) {
    const firstAtom = layoutGraph.atoms.get(overlap.firstAtomId);
    const secondAtom = layoutGraph.atoms.get(overlap.secondAtomId);
    if (!firstAtom || !secondAtom || firstAtom.element === 'H' || secondAtom.element === 'H') {
      continue;
    }
    if (layoutGraph.bondByAtomPair?.has(atomPairKey(overlap.firstAtomId, overlap.secondAtomId))) {
      continue;
    }
    const firstGroup = collectRingAtomOverlapMoveGroup(layoutGraph, coords, overlap.firstAtomId, overlap.secondAtomId);
    const secondGroup = collectRingAtomOverlapMoveGroup(layoutGraph, coords, overlap.secondAtomId, overlap.firstAtomId);
    if (firstGroup.length === 0 || secondGroup.length === 0 || firstGroup.some(atomId => secondGroup.includes(atomId))) {
      continue;
    }
    descriptors.push({
      firstAtomId: overlap.firstAtomId,
      secondAtomId: overlap.secondAtomId,
      firstGroup,
      secondGroup
    });
  }
  return descriptors;
}

function coordinateRingAtomOverlapCandidate(coords, descriptor, bondLength, spreadFactor) {
  const firstPosition = coords.get(descriptor.firstAtomId);
  const secondPosition = coords.get(descriptor.secondAtomId);
  if (!firstPosition || !secondPosition) {
    return null;
  }
  const axis = sub(firstPosition, secondPosition);
  const axisLength = distance(firstPosition, secondPosition);
  if (axisLength <= 1e-9) {
    return null;
  }
  const displacement = scale(axis, (bondLength * spreadFactor) / axisLength);
  let candidateCoords = translateAtomIds(coords, descriptor.firstGroup, displacement);
  candidateCoords = translateAtomIds(candidateCoords, descriptor.secondGroup, scale(displacement, -1));
  return candidateCoords;
}

function coordinateRingAtomOverlapCandidateMove(coords, candidateCoords, atomIds) {
  return atomIds.reduce((totalMove, atomId) => {
    const before = coords.get(atomId);
    const after = candidateCoords.get(atomId);
    return before && after ? totalMove + distance(before, after) : totalMove;
  }, 0);
}

function sharedMetalNeighborIds(layoutGraph, firstAtomId, secondAtomId, coords) {
  const secondMetalAtomIds = new Set();
  for (const bond of layoutGraph.bondsByAtomId.get(secondAtomId) ?? []) {
    const neighborAtomId = otherBondAtomId(bond, secondAtomId);
    if (coords.has(neighborAtomId) && isMetalAtomId(layoutGraph, neighborAtomId)) {
      secondMetalAtomIds.add(neighborAtomId);
    }
  }

  const metalAtomIds = [];
  for (const bond of layoutGraph.bondsByAtomId.get(firstAtomId) ?? []) {
    const neighborAtomId = otherBondAtomId(bond, firstAtomId);
    if (secondMetalAtomIds.has(neighborAtomId)) {
      metalAtomIds.push(neighborAtomId);
    }
  }
  return metalAtomIds;
}

function collectMetalBranchFanMoveGroup(layoutGraph, coords, rootAtomId, metalAtomId) {
  const rootAtom = layoutGraph.atoms.get(rootAtomId);
  if (!rootAtom || rootAtom.element === 'H' || rootAtom.visible === false || isMetalAtomId(layoutGraph, rootAtomId) || layoutGraph.ringAtomIdSet.has(rootAtomId) || !coords.has(rootAtomId)) {
    return [];
  }
  const atomIds = covalentSubtree(layoutGraph, rootAtomId, new Set([metalAtomId]));
  const movedHeavyAtomIds = atomIds.filter(atomId => {
    const atom = layoutGraph.atoms.get(atomId);
    return atom && atom.element !== 'H' && atom.visible !== false;
  });
  if (movedHeavyAtomIds.length === 0 || movedHeavyAtomIds.length > METAL_BRANCH_FAN_MAX_MOVED_HEAVY_ATOMS) {
    return [];
  }
  const hasExtraMetalAnchor = atomIds.some(atomId => {
    if (atomId === rootAtomId) {
      return false;
    }
    return (layoutGraph.bondsByAtomId.get(atomId) ?? []).some(bond => isMetalAtomId(layoutGraph, otherBondAtomId(bond, atomId)));
  });
  return hasExtraMetalAnchor ? [] : atomIds.filter(atomId => coords.has(atomId));
}

function metalBranchFanDescriptors(layoutGraph, coords, bondLength) {
  const descriptors = [];
  const seenKeys = new Set();
  for (const overlap of findSevereOverlaps(layoutGraph, coords, bondLength)) {
    if (layoutGraph.bondByAtomPair?.has(atomPairKey(overlap.firstAtomId, overlap.secondAtomId))) {
      continue;
    }
    const metalAtomIds = sharedMetalNeighborIds(layoutGraph, overlap.firstAtomId, overlap.secondAtomId, coords);
    for (const metalAtomId of metalAtomIds) {
      for (const [movedRootAtomId, blockerAtomId] of [
        [overlap.firstAtomId, overlap.secondAtomId],
        [overlap.secondAtomId, overlap.firstAtomId]
      ]) {
        const movedAtomIds = collectMetalBranchFanMoveGroup(layoutGraph, coords, movedRootAtomId, metalAtomId);
        if (movedAtomIds.length === 0) {
          continue;
        }
        const key = `${metalAtomId}:${movedAtomIds.slice().sort().join('|')}`;
        if (seenKeys.has(key)) {
          continue;
        }
        seenKeys.add(key);
        descriptors.push({
          metalAtomId,
          movedRootAtomId,
          blockerAtomId,
          movedAtomIds,
          movedHeavyAtomCount: visibleHeavyAtomCount(layoutGraph, movedAtomIds)
        });
      }
    }
  }
  return descriptors;
}

function metalBranchFanCandidateScore(candidate) {
  return (
    (candidate.audit.ok ? -1e9 : 0) +
    candidate.audit.severeOverlapCount * 1e7 +
    candidate.audit.visibleHeavyBondCrossingCount * 1e5 +
    candidate.audit.bondLengthFailureCount * 1e5 +
    candidate.audit.labelOverlapCount * 1e4 +
    candidate.audit.ringSubstituentReadabilityFailureCount * 1e4 +
    candidate.movedHeavyAtomCount * 100 +
    candidate.rotationMagnitude
  );
}

function ringSidechainFanPathToRing(layoutGraph, coords, rootAtomId) {
  const rootAtom = layoutGraph.atoms.get(rootAtomId);
  if (!rootAtom || rootAtom.element === 'H' || rootAtom.visible === false || layoutGraph.ringAtomIdSet.has(rootAtomId) || isMetalAtomId(layoutGraph, rootAtomId) || !coords.has(rootAtomId)) {
    return [];
  }

  const queue = [[rootAtomId]];
  const seen = new Set([rootAtomId]);
  while (queue.length > 0) {
    const path = queue.shift();
    const atomId = path[path.length - 1];
    if (path.length >= RING_SIDECHAIN_FAN_MAX_PATH_ATOMS) {
      continue;
    }
    for (const bond of layoutGraph.bondsByAtomId.get(atomId) ?? []) {
      if (!bond || bond.kind !== 'covalent') {
        continue;
      }
      const neighborAtomId = otherBondAtomId(bond, atomId);
      if (seen.has(neighborAtomId) || !coords.has(neighborAtomId) || isMetalAtomId(layoutGraph, neighborAtomId)) {
        continue;
      }
      const nextPath = [...path, neighborAtomId];
      if (layoutGraph.ringAtomIdSet.has(neighborAtomId)) {
        return atomHasCoordinateMetalRing(layoutGraph, neighborAtomId) ? nextPath : [];
      }
      seen.add(neighborAtomId);
      queue.push(nextPath);
    }
  }
  return [];
}

function collectRingSidechainFanMoveGroup(layoutGraph, coords, rootAtomId, pivotAtomId) {
  const atomIds = covalentSubtree(layoutGraph, rootAtomId, new Set([pivotAtomId]));
  if (atomIds.some(atomId => layoutGraph.ringAtomIdSet.has(atomId) || isMetalAtomId(layoutGraph, atomId))) {
    return [];
  }
  const movedHeavyAtomIds = atomIds.filter(atomId => {
    const atom = layoutGraph.atoms.get(atomId);
    return atom && atom.element !== 'H' && atom.visible !== false;
  });
  if (movedHeavyAtomIds.length === 0 || movedHeavyAtomIds.length > RING_SIDECHAIN_FAN_MAX_MOVED_HEAVY_ATOMS) {
    return [];
  }
  return atomIds.filter(atomId => coords.has(atomId));
}

function ringSidechainFanDescriptors(layoutGraph, coords, bondLength) {
  const descriptors = [];
  const seenKeys = new Set();
  for (const overlap of findSevereOverlaps(layoutGraph, coords, bondLength)) {
    if (layoutGraph.bondByAtomPair?.has(atomPairKey(overlap.firstAtomId, overlap.secondAtomId))) {
      continue;
    }
    for (const [sidechainAtomId, ringAtomId] of [
      [overlap.firstAtomId, overlap.secondAtomId],
      [overlap.secondAtomId, overlap.firstAtomId]
    ]) {
      if (!layoutGraph.ringAtomIdSet.has(ringAtomId) || !atomHasCoordinateMetalRing(layoutGraph, ringAtomId)) {
        continue;
      }
      const pathToRing = ringSidechainFanPathToRing(layoutGraph, coords, sidechainAtomId);
      if (pathToRing.length < 3) {
        continue;
      }
      const pivotAtomId = pathToRing[pathToRing.length - 2];
      const movedRootAtomId = pathToRing[pathToRing.length - 3];
      const movedAtomIds = collectRingSidechainFanMoveGroup(layoutGraph, coords, movedRootAtomId, pivotAtomId);
      if (movedAtomIds.length === 0 || !movedAtomIds.includes(sidechainAtomId)) {
        continue;
      }
      const key = `${pivotAtomId}:${movedAtomIds.slice().sort().join('|')}`;
      if (seenKeys.has(key)) {
        continue;
      }
      seenKeys.add(key);
      descriptors.push({
        pivotAtomId,
        movedRootAtomId,
        ringAtomId,
        sidechainAtomId,
        movedAtomIds,
        movedHeavyAtomCount: visibleHeavyAtomCount(layoutGraph, movedAtomIds)
      });
    }
  }
  return descriptors;
}

function ringSidechainFanCandidateScore(candidate) {
  return (
    (candidate.audit.ok ? -1e9 : 0) +
    candidate.audit.severeOverlapCount * 1e7 +
    candidate.audit.visibleHeavyBondCrossingCount * 1e5 +
    candidate.audit.bondLengthFailureCount * 1e5 +
    candidate.audit.labelOverlapCount * 1e4 +
    candidate.audit.ringSubstituentReadabilityFailureCount * 1e4 +
    candidate.movedHeavyAtomCount * 100 +
    candidate.rotationMagnitude
  );
}

/**
 * Rotates tiny acyclic sidechains away from coordinate-bound organometallic
 * rings when a terminal branch folds inward across the ring face.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Input coordinate map.
 * @param {{bondLength?: number, bondValidationClasses?: Map<string, 'planar'|'bridged'|'haptic'>}} [options] - Retouch options.
 * @returns {{changed: boolean, coords: Map<string, {x: number, y: number}>, movedAtomIds: string[], severeOverlapCountBefore: number, severeOverlapCountAfter: number, visibleHeavyBondCrossingCountBefore: number, visibleHeavyBondCrossingCountAfter: number}} Retouch result.
 */
export function runOrganometallicRingSidechainFanRetouch(layoutGraph, coords, options = {}) {
  const bondLength = options.bondLength ?? layoutGraph.options.bondLength;
  const layoutHeavyAtomCount = layoutGraph.traits?.heavyAtomCount ?? [...layoutGraph.atoms.values()].filter(atom => atom.element !== 'H').length;
  const baseAudit = auditLayout(layoutGraph, coords, {
    bondLength,
    bondValidationClasses: options.bondValidationClasses
  });
  if (layoutHeavyAtomCount > RING_SIDECHAIN_FAN_MAX_LAYOUT_HEAVY_ATOMS || baseAudit.ok || baseAudit.severeOverlapCount <= 0) {
    return {
      changed: false,
      coords,
      movedAtomIds: [],
      severeOverlapCountBefore: baseAudit.severeOverlapCount,
      severeOverlapCountAfter: baseAudit.severeOverlapCount,
      visibleHeavyBondCrossingCountBefore: baseAudit.visibleHeavyBondCrossingCount,
      visibleHeavyBondCrossingCountAfter: baseAudit.visibleHeavyBondCrossingCount
    };
  }

  let bestCandidate = null;
  for (const descriptor of ringSidechainFanDescriptors(layoutGraph, coords, bondLength)) {
    const pivot = coords.get(descriptor.pivotAtomId);
    if (!pivot) {
      continue;
    }
    for (const rotation of RING_SIDECHAIN_FAN_ROTATIONS) {
      const candidateCoords = rotateAtomIdsAroundPivot(coords, descriptor.movedAtomIds, pivot, rotation);
      const candidateAudit = auditLayout(layoutGraph, candidateCoords, {
        bondLength,
        bondValidationClasses: options.bondValidationClasses
      });
      if (
        !candidateAudit.ok ||
        candidateAudit.visibleHeavyBondCrossingCount > baseAudit.visibleHeavyBondCrossingCount ||
        candidateAudit.labelOverlapCount > baseAudit.labelOverlapCount ||
        candidateAudit.ringSubstituentReadabilityFailureCount > baseAudit.ringSubstituentReadabilityFailureCount ||
        ((candidateAudit.stereoContradiction ?? false) && !(baseAudit.stereoContradiction ?? false))
      ) {
        continue;
      }
      const candidate = {
        coords: candidateCoords,
        audit: candidateAudit,
        movedAtomIds: descriptor.movedAtomIds,
        movedHeavyAtomCount: descriptor.movedHeavyAtomCount,
        rotationMagnitude: Math.abs(rotation)
      };
      if (!bestCandidate || ringSidechainFanCandidateScore(candidate) < ringSidechainFanCandidateScore(bestCandidate)) {
        bestCandidate = candidate;
      }
    }
  }

  if (!bestCandidate) {
    return {
      changed: false,
      coords,
      movedAtomIds: [],
      severeOverlapCountBefore: baseAudit.severeOverlapCount,
      severeOverlapCountAfter: baseAudit.severeOverlapCount,
      visibleHeavyBondCrossingCountBefore: baseAudit.visibleHeavyBondCrossingCount,
      visibleHeavyBondCrossingCountAfter: baseAudit.visibleHeavyBondCrossingCount
    };
  }

  return {
    changed: true,
    coords: bestCandidate.coords,
    movedAtomIds: bestCandidate.movedAtomIds,
    severeOverlapCountBefore: baseAudit.severeOverlapCount,
    severeOverlapCountAfter: bestCandidate.audit.severeOverlapCount,
    visibleHeavyBondCrossingCountBefore: baseAudit.visibleHeavyBondCrossingCount,
    visibleHeavyBondCrossingCountAfter: bestCandidate.audit.visibleHeavyBondCrossingCount
  };
}

/**
 * Rotates tiny covalent branches around a shared metal center when the branch
 * collapses onto a neighboring metal-bound ring atom. This is deliberately
 * exact-clean only so ordinary ligand geometry is left untouched.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Input coordinate map.
 * @param {{bondLength?: number, bondValidationClasses?: Map<string, 'planar'|'bridged'|'haptic'>}} [options] - Retouch options.
 * @returns {{changed: boolean, coords: Map<string, {x: number, y: number}>, movedAtomIds: string[], severeOverlapCountBefore: number, severeOverlapCountAfter: number, visibleHeavyBondCrossingCountBefore: number, visibleHeavyBondCrossingCountAfter: number}} Retouch result.
 */
export function runOrganometallicMetalBranchFanRetouch(layoutGraph, coords, options = {}) {
  const bondLength = options.bondLength ?? layoutGraph.options.bondLength;
  const layoutHeavyAtomCount = layoutGraph.traits?.heavyAtomCount ?? [...layoutGraph.atoms.values()].filter(atom => atom.element !== 'H').length;
  const baseAudit = auditLayout(layoutGraph, coords, {
    bondLength,
    bondValidationClasses: options.bondValidationClasses
  });
  if (layoutHeavyAtomCount > METAL_BRANCH_FAN_MAX_LAYOUT_HEAVY_ATOMS || baseAudit.ok || baseAudit.severeOverlapCount <= 0) {
    return {
      changed: false,
      coords,
      movedAtomIds: [],
      severeOverlapCountBefore: baseAudit.severeOverlapCount,
      severeOverlapCountAfter: baseAudit.severeOverlapCount,
      visibleHeavyBondCrossingCountBefore: baseAudit.visibleHeavyBondCrossingCount,
      visibleHeavyBondCrossingCountAfter: baseAudit.visibleHeavyBondCrossingCount
    };
  }

  let bestCandidate = null;
  for (const descriptor of metalBranchFanDescriptors(layoutGraph, coords, bondLength)) {
    const pivot = coords.get(descriptor.metalAtomId);
    if (!pivot) {
      continue;
    }
    for (const rotation of METAL_BRANCH_FAN_ROTATIONS) {
      const candidateCoords = rotateAtomIdsAroundPivot(coords, descriptor.movedAtomIds, pivot, rotation);
      const candidateAudit = auditLayout(layoutGraph, candidateCoords, {
        bondLength,
        bondValidationClasses: options.bondValidationClasses
      });
      if (
        !candidateAudit.ok ||
        candidateAudit.visibleHeavyBondCrossingCount > baseAudit.visibleHeavyBondCrossingCount ||
        candidateAudit.labelOverlapCount > baseAudit.labelOverlapCount ||
        candidateAudit.ringSubstituentReadabilityFailureCount > baseAudit.ringSubstituentReadabilityFailureCount ||
        ((candidateAudit.stereoContradiction ?? false) && !(baseAudit.stereoContradiction ?? false))
      ) {
        continue;
      }
      const candidate = {
        coords: candidateCoords,
        audit: candidateAudit,
        movedAtomIds: descriptor.movedAtomIds,
        movedHeavyAtomCount: descriptor.movedHeavyAtomCount,
        rotationMagnitude: Math.abs(rotation)
      };
      if (!bestCandidate || metalBranchFanCandidateScore(candidate) < metalBranchFanCandidateScore(bestCandidate)) {
        bestCandidate = candidate;
      }
    }
  }

  if (!bestCandidate) {
    return {
      changed: false,
      coords,
      movedAtomIds: [],
      severeOverlapCountBefore: baseAudit.severeOverlapCount,
      severeOverlapCountAfter: baseAudit.severeOverlapCount,
      visibleHeavyBondCrossingCountBefore: baseAudit.visibleHeavyBondCrossingCount,
      visibleHeavyBondCrossingCountAfter: baseAudit.visibleHeavyBondCrossingCount
    };
  }

  return {
    changed: true,
    coords: bestCandidate.coords,
    movedAtomIds: bestCandidate.movedAtomIds,
    severeOverlapCountBefore: baseAudit.severeOverlapCount,
    severeOverlapCountAfter: bestCandidate.audit.severeOverlapCount,
    visibleHeavyBondCrossingCountBefore: baseAudit.visibleHeavyBondCrossingCount,
    visibleHeavyBondCrossingCountAfter: bestCandidate.audit.visibleHeavyBondCrossingCount
  };
}

function coordinateRingAtomOverlapAuditDoesNotRegress(candidateAudit, baseAudit, bondLength) {
  if (!candidateAudit || !baseAudit) {
    return false;
  }
  const maxDeviationLimit = Math.max(baseAudit.maxBondLengthDeviation ?? 0, bondLength * 0.3) + bondLength * RING_ATOM_OVERLAP_MAX_DEVIATION_SLACK_FACTOR;
  return (
    candidateAudit.bondLengthFailureCount <= baseAudit.bondLengthFailureCount &&
    candidateAudit.mildBondLengthFailureCount <= baseAudit.mildBondLengthFailureCount &&
    candidateAudit.severeBondLengthFailureCount <= baseAudit.severeBondLengthFailureCount &&
    candidateAudit.maxBondLengthDeviation <= maxDeviationLimit &&
    candidateAudit.severeOverlapCount <= baseAudit.severeOverlapCount &&
    candidateAudit.visibleHeavyBondCrossingCount <= baseAudit.visibleHeavyBondCrossingCount &&
    candidateAudit.labelOverlapCount <= baseAudit.labelOverlapCount &&
    candidateAudit.ringSubstituentReadabilityFailureCount <= baseAudit.ringSubstituentReadabilityFailureCount &&
    !((candidateAudit.stereoContradiction ?? false) && !(baseAudit.stereoContradiction ?? false))
  );
}

function coordinateRingAtomOverlapAuditImproves(candidateAudit, baseAudit) {
  if (candidateAudit.ok && !baseAudit.ok) {
    return true;
  }
  if (candidateAudit.severeOverlapCount !== baseAudit.severeOverlapCount) {
    return candidateAudit.severeOverlapCount < baseAudit.severeOverlapCount;
  }
  return candidateAudit.severeOverlapPenalty < (baseAudit.severeOverlapPenalty ?? Number.POSITIVE_INFINITY);
}

function coordinateRingAtomOverlapScore(candidate) {
  return (
    (candidate.audit.ok ? -1e9 : 0) +
    candidate.audit.severeOverlapCount * 1e7 +
    candidate.audit.visibleHeavyBondCrossingCount * 1e5 +
    candidate.audit.bondLengthFailureCount * 1e5 +
    candidate.audit.maxBondLengthDeviation * 1e3 +
    candidate.move
  );
}

/**
 * Separates saturated chelate-ring atoms that collapse into each other in
 * organometallic macrocycles. The move is deliberately local and symmetric:
 * the two overlapping ring atoms, plus hydrogens or tiny exocyclic branches
 * attached to them, are nudged apart only if the audited organometallic
 * validation classes remain clean.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Input coordinate map.
 * @param {{bondLength?: number, bondValidationClasses?: Map<string, 'planar'|'bridged'|'haptic'>}} [options] - Retouch options.
 * @returns {{changed: boolean, coords: Map<string, {x: number, y: number}>, movedAtomIds: string[], severeOverlapCountBefore: number, severeOverlapCountAfter: number, maxBondLengthDeviationAfter: number}} Retouch result.
 */
export function runOrganometallicRingAtomOverlapRetouch(layoutGraph, coords, options = {}) {
  const bondLength = options.bondLength ?? layoutGraph.options.bondLength;
  const layoutHeavyAtomCount = layoutGraph.traits?.heavyAtomCount ?? [...layoutGraph.atoms.values()].filter(atom => atom.element !== 'H').length;
  const baseAudit = auditLayout(layoutGraph, coords, {
    bondLength,
    bondValidationClasses: options.bondValidationClasses
  });
  if (layoutHeavyAtomCount > RING_ATOM_OVERLAP_MAX_LAYOUT_HEAVY_ATOMS || baseAudit.ok || baseAudit.severeOverlapCount <= 0 || baseAudit.visibleHeavyBondCrossingCount > 0) {
    return {
      changed: false,
      coords,
      movedAtomIds: [],
      severeOverlapCountBefore: baseAudit.severeOverlapCount,
      severeOverlapCountAfter: baseAudit.severeOverlapCount,
      maxBondLengthDeviationAfter: baseAudit.maxBondLengthDeviation
    };
  }

  let bestCandidate = null;
  for (const descriptor of coordinateRingAtomOverlapDescriptors(layoutGraph, coords, bondLength)) {
    const movedAtomIds = [...new Set([...descriptor.firstGroup, ...descriptor.secondGroup])];
    for (const spreadFactor of RING_ATOM_OVERLAP_SPREAD_FACTORS) {
      const candidateCoords = coordinateRingAtomOverlapCandidate(coords, descriptor, bondLength, spreadFactor);
      if (!candidateCoords) {
        continue;
      }
      const candidateAudit = auditLayout(layoutGraph, candidateCoords, {
        bondLength,
        bondValidationClasses: options.bondValidationClasses
      });
      if (!coordinateRingAtomOverlapAuditDoesNotRegress(candidateAudit, baseAudit, bondLength) || !coordinateRingAtomOverlapAuditImproves(candidateAudit, baseAudit)) {
        continue;
      }
      const candidate = {
        coords: candidateCoords,
        audit: candidateAudit,
        movedAtomIds,
        move: coordinateRingAtomOverlapCandidateMove(coords, candidateCoords, movedAtomIds)
      };
      if (!bestCandidate || coordinateRingAtomOverlapScore(candidate) < coordinateRingAtomOverlapScore(bestCandidate)) {
        bestCandidate = candidate;
      }
    }
  }

  if (!bestCandidate) {
    return {
      changed: false,
      coords,
      movedAtomIds: [],
      severeOverlapCountBefore: baseAudit.severeOverlapCount,
      severeOverlapCountAfter: baseAudit.severeOverlapCount,
      maxBondLengthDeviationAfter: baseAudit.maxBondLengthDeviation
    };
  }

  return {
    changed: true,
    coords: bestCandidate.coords,
    movedAtomIds: bestCandidate.movedAtomIds,
    severeOverlapCountBefore: baseAudit.severeOverlapCount,
    severeOverlapCountAfter: bestCandidate.audit.severeOverlapCount,
    maxBondLengthDeviationAfter: bestCandidate.audit.maxBondLengthDeviation
  };
}

function coordinateLigandAuditDoesNotRegress(candidateAudit, baseAudit, bondLength) {
  if (!candidateAudit || !baseAudit) {
    return false;
  }
  return (
    candidateAudit.bondLengthFailureCount <= baseAudit.bondLengthFailureCount &&
    candidateAudit.mildBondLengthFailureCount <= baseAudit.mildBondLengthFailureCount &&
    candidateAudit.severeBondLengthFailureCount <= baseAudit.severeBondLengthFailureCount &&
    candidateAudit.maxBondLengthDeviation <= baseAudit.maxBondLengthDeviation + bondLength * RING_RETOUCH_BOND_DEVIATION_SLACK_FACTOR &&
    candidateAudit.severeOverlapCount <= baseAudit.severeOverlapCount &&
    candidateAudit.visibleHeavyBondCrossingCount <= baseAudit.visibleHeavyBondCrossingCount &&
    candidateAudit.labelOverlapCount <= baseAudit.labelOverlapCount &&
    candidateAudit.ringSubstituentReadabilityFailureCount <= baseAudit.ringSubstituentReadabilityFailureCount &&
    !((candidateAudit.stereoContradiction ?? false) && !(baseAudit.stereoContradiction ?? false))
  );
}

function coordinateLigandAuditImproves(candidateAudit, baseAudit) {
  if (candidateAudit.ok && !baseAudit.ok) {
    return true;
  }
  if (candidateAudit.severeOverlapCount !== baseAudit.severeOverlapCount) {
    return candidateAudit.severeOverlapCount < baseAudit.severeOverlapCount;
  }
  if (candidateAudit.visibleHeavyBondCrossingCount !== baseAudit.visibleHeavyBondCrossingCount) {
    return candidateAudit.visibleHeavyBondCrossingCount < baseAudit.visibleHeavyBondCrossingCount;
  }
  if (candidateAudit.worstOverlapDeficit !== baseAudit.worstOverlapDeficit) {
    return candidateAudit.worstOverlapDeficit < baseAudit.worstOverlapDeficit;
  }
  return candidateAudit.severeOverlapPenalty < baseAudit.severeOverlapPenalty;
}

function coordinateLigandCandidateScore(audit) {
  return (
    (audit.ok ? -1e9 : 0) +
    audit.bondLengthFailureCount * 1e8 +
    audit.severeOverlapCount * 1e6 +
    audit.visibleHeavyBondCrossingCount * 1e4 +
    audit.labelOverlapCount * 1e3 +
    audit.ringSubstituentReadabilityFailureCount * 1e3 +
    audit.worstOverlapDeficit * 100 +
    audit.severeOverlapPenalty
  );
}

/**
 * Translates small monodentate coordinate-bound aromatic ligands farther along
 * their metal-anchor axis when the ligand sits on top of another ligand ring.
 * Coordinate links are intentionally allowed to lengthen because covalent
 * geometry is unchanged and the move is accepted only when all audit counts
 * improve or stay flat.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Input coordinate map.
 * @param {{bondLength?: number, bondValidationClasses?: Map<string, 'planar'|'bridged'>}} [options] - Retouch options.
 * @returns {{changed: boolean, coords: Map<string, {x: number, y: number}>, movedAtomIds: string[], severeOverlapCountBefore: number, severeOverlapCountAfter: number, visibleHeavyBondCrossingCountBefore: number, visibleHeavyBondCrossingCountAfter: number}} Retouch result.
 */
export function runOrganometallicCoordinateLigandOutwardRetouch(layoutGraph, coords, options = {}) {
  const bondLength = options.bondLength ?? layoutGraph.options.bondLength;
  const layoutHeavyAtomCount = layoutGraph.traits?.heavyAtomCount ?? [...layoutGraph.atoms.values()].filter(atom => atom.element !== 'H').length;
  let currentCoords = coords;
  let currentAudit = auditLayout(layoutGraph, currentCoords, {
    bondLength,
    bondValidationClasses: options.bondValidationClasses
  });
  const initialAudit = currentAudit;
  if (
    layoutHeavyAtomCount > COORDINATE_LIGAND_MAX_LAYOUT_HEAVY_ATOMS ||
    currentAudit.ok ||
    (currentAudit.severeOverlapCount === 0 && currentAudit.visibleHeavyBondCrossingCount === 0)
  ) {
    return {
      changed: false,
      coords,
      movedAtomIds: [],
      severeOverlapCountBefore: currentAudit.severeOverlapCount,
      severeOverlapCountAfter: currentAudit.severeOverlapCount,
      visibleHeavyBondCrossingCountBefore: currentAudit.visibleHeavyBondCrossingCount,
      visibleHeavyBondCrossingCountAfter: currentAudit.visibleHeavyBondCrossingCount
    };
  }

  const movedAtomIds = new Set();
  for (let pass = 0; pass < COORDINATE_LIGAND_MAX_PASSES; pass++) {
    const ligands = collectSingleAnchorCoordinateAromaticLigands(layoutGraph, currentCoords);
    let bestCandidate = null;
    let bestScore = coordinateLigandCandidateScore(currentAudit);
    for (const ligand of ligands) {
      const anchorPosition = currentCoords.get(ligand.anchorAtomId);
      const metalPosition = currentCoords.get(ligand.metalAtomId);
      if (!anchorPosition || !metalPosition) {
        continue;
      }
      const axis = sub(anchorPosition, metalPosition);
      const axisLength = distance(anchorPosition, metalPosition);
      if (axisLength <= 1e-9) {
        continue;
      }
      const direction = scale(axis, 1 / axisLength);
      for (const step of COORDINATE_LIGAND_OUTWARD_STEPS) {
        const displacement = scale(direction, bondLength * step);
        const candidateCoords = translateAtomIds(currentCoords, ligand.atomIds, displacement);
        const candidateAudit = auditLayout(layoutGraph, candidateCoords, {
          bondLength,
          bondValidationClasses: options.bondValidationClasses
        });
        if (!coordinateLigandAuditDoesNotRegress(candidateAudit, currentAudit, bondLength) || !coordinateLigandAuditImproves(candidateAudit, currentAudit)) {
          continue;
        }
        const score = coordinateLigandCandidateScore(candidateAudit) + step * 1e-6;
        if (score < bestScore) {
          bestCandidate = { coords: candidateCoords, audit: candidateAudit, movedAtomIds: ligand.atomIds };
          bestScore = score;
        }
      }
    }
    if (!bestCandidate) {
      break;
    }
    currentCoords = bestCandidate.coords;
    currentAudit = bestCandidate.audit;
    for (const atomId of bestCandidate.movedAtomIds) {
      movedAtomIds.add(atomId);
    }
    if (currentAudit.ok) {
      break;
    }
  }

  return {
    changed: movedAtomIds.size > 0,
    coords: currentCoords,
    movedAtomIds: [...movedAtomIds],
    severeOverlapCountBefore: initialAudit.severeOverlapCount,
    severeOverlapCountAfter: currentAudit.severeOverlapCount,
    visibleHeavyBondCrossingCountBefore: initialAudit.visibleHeavyBondCrossingCount,
    visibleHeavyBondCrossingCountAfter: currentAudit.visibleHeavyBondCrossingCount
  };
}

function translatePendantSubtrees(layoutGraph, coords, displacements, retouchedAtomIds, movedAtomIds) {
  const nextCoords = new Map(coords);
  const blockedAtomIds = new Set(retouchedAtomIds);

  for (const [atomId, displacement] of displacements) {
    if (Math.abs(displacement.x) <= 1e-12 && Math.abs(displacement.y) <= 1e-12) {
      continue;
    }
    for (const bond of layoutGraph.bondsByAtomId.get(atomId) ?? []) {
      if (!bond || bond.kind !== 'covalent') {
        continue;
      }
      const neighborAtomId = otherBondAtomId(bond, atomId);
      if (blockedAtomIds.has(neighborAtomId) || movedAtomIds.has(neighborAtomId)) {
        continue;
      }
      const subtreeAtomIds = covalentSubtree(layoutGraph, neighborAtomId, blockedAtomIds);
      for (const subtreeAtomId of subtreeAtomIds) {
        if (movedAtomIds.has(subtreeAtomId)) {
          continue;
        }
        const position = nextCoords.get(subtreeAtomId);
        if (!position) {
          continue;
        }
        nextCoords.set(subtreeAtomId, add(position, displacement));
        movedAtomIds.add(subtreeAtomId);
      }
    }
  }

  return nextCoords;
}

function buildRetouchedCoords(layoutGraph, coords, rings, bondLength) {
  const targetSums = new Map();
  const targetCounts = new Map();
  const anchorTargetPositions = buildInterRingAnchorTargetPositions(layoutGraph, coords, rings, bondLength);

  for (const ring of rings) {
    const targets = anchorShiftedRegularTargets(layoutGraph, coords, ring, bondLength, anchorTargetPositions);
    if (!targets) {
      continue;
    }
    for (const [atomId, target] of targets) {
      const sum = targetSums.get(atomId) ?? { x: 0, y: 0 };
      sum.x += target.x;
      sum.y += target.y;
      targetSums.set(atomId, sum);
      targetCounts.set(atomId, (targetCounts.get(atomId) ?? 0) + 1);
    }
  }

  if (targetSums.size === 0) {
    return null;
  }

  let nextCoords = new Map(coords);
  const movedAtomIds = new Set();
  const displacements = new Map();
  for (const [atomId, sum] of targetSums) {
    const current = coords.get(atomId);
    const count = targetCounts.get(atomId) ?? 0;
    if (!current || count <= 0) {
      continue;
    }
    const target = {
      x: sum.x / count,
      y: sum.y / count
    };
    const displacement = sub(target, current);
    nextCoords.set(atomId, target);
    movedAtomIds.add(atomId);
    displacements.set(atomId, displacement);
  }

  nextCoords = translatePendantSubtrees(layoutGraph, nextCoords, displacements, new Set(targetSums.keys()), movedAtomIds);
  return { coords: nextCoords, movedAtomIds };
}

function auditDoesNotRegress(candidateAudit, baseAudit, bondLength) {
  if (!candidateAudit || !baseAudit) {
    return false;
  }
  return (
    candidateAudit.severeOverlapCount <= baseAudit.severeOverlapCount &&
    candidateAudit.bondLengthFailureCount <= baseAudit.bondLengthFailureCount &&
    candidateAudit.collapsedMacrocycleCount <= baseAudit.collapsedMacrocycleCount &&
    candidateAudit.visibleHeavyBondCrossingCount <= baseAudit.visibleHeavyBondCrossingCount &&
    candidateAudit.labelOverlapCount <= baseAudit.labelOverlapCount &&
    candidateAudit.ringSubstituentReadabilityFailureCount <= baseAudit.ringSubstituentReadabilityFailureCount &&
    !((candidateAudit.stereoContradiction ?? false) && !(baseAudit.stereoContradiction ?? false)) &&
    candidateAudit.maxBondLengthDeviation <= baseAudit.maxBondLengthDeviation + bondLength * RING_RETOUCH_BOND_DEVIATION_SLACK_FACTOR
  );
}

/**
 * Regularizes distorted aromatic bidentate ligand rings without changing the
 * broader metal-complex layout. The inter-ring linker atom is pinned so the
 * chelating ligand keeps its global pose while the aromatic polygon is restored.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Input coordinate map.
 * @param {{bondLength?: number, bondValidationClasses?: Map<string, 'planar'|'bridged'>}} [options] - Retouch options.
 * @returns {{changed: boolean, coords: Map<string, {x: number, y: number}>, movedAtomIds: string[], maxDeviationBefore: number, maxDeviationAfter: number}} Retouch result.
 */
export function runOrganometallicAromaticRingRetouch(layoutGraph, coords, options = {}) {
  const bondLength = options.bondLength ?? layoutGraph.options.bondLength;
  const candidateRings = (layoutGraph.rings ?? []).filter(ring => shouldRetouchRing(layoutGraph, coords, ring));
  if (candidateRings.length === 0) {
    return {
      changed: false,
      coords,
      movedAtomIds: [],
      maxDeviationBefore: 0,
      maxDeviationAfter: 0
    };
  }

  const baseRegularity = ringRegularity(layoutGraph, coords, candidateRings);
  const retouched = buildRetouchedCoords(layoutGraph, coords, candidateRings, bondLength);
  if (!retouched) {
    return {
      changed: false,
      coords,
      movedAtomIds: [],
      maxDeviationBefore: baseRegularity.maxAngleDeviation,
      maxDeviationAfter: baseRegularity.maxAngleDeviation
    };
  }

  const candidateRegularity = ringRegularity(layoutGraph, retouched.coords, candidateRings);
  if (candidateRegularity.maxAngleDeviation > baseRegularity.maxAngleDeviation - RING_RETOUCH_MIN_IMPROVEMENT) {
    return {
      changed: false,
      coords,
      movedAtomIds: [],
      maxDeviationBefore: baseRegularity.maxAngleDeviation,
      maxDeviationAfter: candidateRegularity.maxAngleDeviation
    };
  }

  const baseAudit = auditLayout(layoutGraph, coords, {
    bondLength,
    bondValidationClasses: options.bondValidationClasses
  });
  const candidateAudit = auditLayout(layoutGraph, retouched.coords, {
    bondLength,
    bondValidationClasses: options.bondValidationClasses
  });
  if (!auditDoesNotRegress(candidateAudit, baseAudit, bondLength)) {
    return {
      changed: false,
      coords,
      movedAtomIds: [],
      maxDeviationBefore: baseRegularity.maxAngleDeviation,
      maxDeviationAfter: candidateRegularity.maxAngleDeviation
    };
  }

  return {
    changed: true,
    coords: retouched.coords,
    movedAtomIds: [...retouched.movedAtomIds],
    maxDeviationBefore: baseRegularity.maxAngleDeviation,
    maxDeviationAfter: candidateRegularity.maxAngleDeviation
  };
}

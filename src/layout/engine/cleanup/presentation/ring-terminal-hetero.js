/** @module cleanup/presentation/ring-terminal-hetero */

import { buildAtomGrid } from '../../audit/invariants.js';
import { auditLayout } from '../../audit/audit.js';
import { countPointInPolygons } from '../../geometry/polygon.js';
import { add, angleOf, angularDifference, centroid, distance, fromAngle, rotate, sub } from '../../geometry/vec2.js';
import { visitPresentationDescriptorCandidates } from '../candidate-search.js';
import { atomPairKey } from '../../constants.js';
import { collectRigidPendantRingSubtrees } from '../overlap-resolution.js';
import { rotateRigidDescriptorPositions } from '../rigid-rotation.js';
import { STANDARD_ROTATION_ANGLES } from '../rotation-candidates.js';
import {
  smallRingExteriorTargetAngles,
  supportsExteriorBranchSpreadRingSize
} from '../../placement/branch-placement.js';
const TIDY_IMPROVEMENT_EPSILON = 1e-6;
const SINGLE_BOND_TERMINAL_HETERO_ELEMENTS = new Set(['O', 'S', 'Se']);
const TERMINAL_HETERO_OUTWARD_NEED_TRIGGER = Math.PI / 9;
const TERMINAL_HETERO_BLOCKER_RELIEF_OFFSETS = Object.freeze([
  ...[1, 2, 3, 4, 5, 6, 8, 10].map(degrees => (degrees * Math.PI) / 180),
  ...[1, 2, 3, 4, 5, 6, 8, 10].map(degrees => -(degrees * Math.PI) / 180),
  ...Array.from({ length: 25 }, (_value, index) => ((12 + index * 2) * Math.PI) / 180),
  ...Array.from({ length: 25 }, (_value, index) => -((12 + index * 2) * Math.PI) / 180)
]);
const TERMINAL_HETERO_BLOCKER_MAX_CENTER_DEVIATION = Math.PI / 4;
const TERMINAL_MULTIPLE_BOND_FAN_IMPROVEMENT_EPSILON = 1e-8;
const TERMINAL_MULTIPLE_BOND_LINEAR_NEIGHBOR_TOLERANCE = Math.PI / 12;
const TERMINAL_MULTIPLE_BOND_SUPPORT_MAX_SEPARATION = (7 * Math.PI) / 9;
const TERMINAL_MULTIPLE_BOND_SUPPORT_MIN_SEPARATION = (22 * Math.PI) / 45;
const TERMINAL_MULTIPLE_BOND_SUPPORT_MAX_ROTATION = Math.PI / 9;
const TERMINAL_MULTIPLE_BOND_SUPPORT_SUBTREE_HEAVY_LIMIT = 18;
const TERMINAL_MULTIPLE_BOND_LEAF_COMPRESSION_FACTORS = Object.freeze(
  Array.from({ length: 111 }, (_value, index) => 0.95 - index * 0.005)
);
const TERMINAL_MULTIPLE_BOND_LEAF_COMPRESSION_TRIGGER_FACTOR = 1.05;
const TERMINAL_MULTIPLE_BOND_LEAF_COMPRESSION_TARGET_FACTOR = 1.25;
const TERMINAL_MULTIPLE_BOND_BLOCKER_RELIEF_CLEARANCE_FACTOR = 0.95;
const TERMINAL_MULTIPLE_BOND_BLOCKER_RELIEF_ROTATIONS = Object.freeze(
  [5, 10, 15, 20, 25, 30, 45, 60, 75, 90].flatMap(degrees => [
    -(degrees * Math.PI) / 180,
    (degrees * Math.PI) / 180
  ])
);
const HIDDEN_H_MULTIPLE_BOND_VISIBLE_ANGLE = (2 * Math.PI) / 3;
const TERMINAL_MULTIPLE_BOND_BALANCED_FAN_TOLERANCE = Math.PI / 15;

function incidentRingPolygons(layoutGraph, coords, anchorAtomId) {
  if (!coords.has(anchorAtomId)) {
    return [];
  }
  return (layoutGraph.atomToRings.get(anchorAtomId) ?? [])
    .map(ring => ring.atomIds.map(atomId => coords.get(atomId)).filter(Boolean))
    .filter(polygon => polygon.length >= 3);
}

function outwardAnglesForAnchor(layoutGraph, coords, anchorAtomId) {
  const anchorPosition = coords.get(anchorAtomId);
  if (!anchorPosition) {
    return [];
  }
  return incidentRingPolygons(layoutGraph, coords, anchorAtomId)
    .map(polygon => angleOf(sub(anchorPosition, centroid(polygon))));
}

function smallRingExteriorTerminalHeteroAngles(layoutGraph, coords, anchorAtomId, heteroAtomId) {
  const anchorAtom = layoutGraph.atoms.get(anchorAtomId);
  if (!anchorAtom || anchorAtom.aromatic || (anchorAtom.heavyDegree ?? 0) !== 4) {
    return [];
  }

  const anchorRings = layoutGraph.atomToRings.get(anchorAtomId) ?? [];
  if (anchorRings.length !== 1) {
    return [];
  }
  const ring = anchorRings[0];
  const ringAtomIds = new Set(ring?.atomIds ?? []);
  if (!supportsExteriorBranchSpreadRingSize(ringAtomIds.size)) {
    return [];
  }

  const anchorPosition = coords.get(anchorAtomId);
  if (!anchorPosition) {
    return [];
  }

  const ringNeighborAngles = [];
  let exocyclicHeavyCount = 0;
  let heteroIsExocyclic = false;
  let otherExocyclicAngle = null;
  for (const bond of layoutGraph.bondsByAtomId.get(anchorAtomId) ?? []) {
    if (!bond || bond.kind !== 'covalent' || bond.aromatic || (bond.order ?? 1) !== 1) {
      return [];
    }
    const neighborAtomId = bond.a === anchorAtomId ? bond.b : bond.a;
    const neighborAtom = layoutGraph.atoms.get(neighborAtomId);
    if (!neighborAtom || neighborAtom.element === 'H') {
      continue;
    }
    const neighborPosition = coords.get(neighborAtomId);
    if (!neighborPosition) {
      return [];
    }
    if (ringAtomIds.has(neighborAtomId)) {
      ringNeighborAngles.push(angleOf(sub(neighborPosition, anchorPosition)));
      continue;
    }
    exocyclicHeavyCount++;
    if (neighborAtomId === heteroAtomId) {
      heteroIsExocyclic = true;
    } else {
      otherExocyclicAngle = angleOf(sub(neighborPosition, anchorPosition));
    }
  }

  if (!heteroIsExocyclic || ringNeighborAngles.length !== 2 || exocyclicHeavyCount !== 2) {
    return [];
  }

  const targetAngles = smallRingExteriorTargetAngles(ringNeighborAngles, ringAtomIds.size);
  if (targetAngles.length !== 2 || otherExocyclicAngle == null) {
    return targetAngles;
  }

  return [
    angularDifference(otherExocyclicAngle, targetAngles[0]) <= angularDifference(otherExocyclicAngle, targetAngles[1])
      ? targetAngles[1]
      : targetAngles[0]
  ];
}

function localNonbondedClearance(layoutGraph, coords, atomGrid, atomId, position, searchRadius) {
  let minimumDistance = searchRadius;
  for (const otherAtomId of atomGrid.queryRadius(position, searchRadius)) {
    if (otherAtomId === atomId || layoutGraph.bondedPairSet.has(atomPairKey(atomId, otherAtomId))) {
      continue;
    }
    const otherPosition = coords.get(otherAtomId);
    if (!otherPosition) {
      continue;
    }
    minimumDistance = Math.min(minimumDistance, Math.hypot(position.x - otherPosition.x, position.y - otherPosition.y));
  }
  return minimumDistance;
}

/**
 * Returns whether an atom participates in visible presentation cleanup checks.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {string} atomId - Candidate atom ID.
 * @returns {boolean} True when the atom should count in local visible geometry checks.
 */
function isVisiblePresentationAtom(layoutGraph, atomId) {
  const atom = layoutGraph.atoms.get(atomId);
  return !!atom && !(layoutGraph.options.suppressH && atom.element === 'H');
}

function localSevereOverlapCount(layoutGraph, coords, atomGrid, atomId, position, threshold) {
  let overlapCount = 0;
  for (const otherAtomId of atomGrid.queryRadius(position, threshold)) {
    if (otherAtomId === atomId || layoutGraph.bondedPairSet.has(atomPairKey(atomId, otherAtomId))) {
      continue;
    }
    const otherPosition = coords.get(otherAtomId);
    if (!otherPosition) {
      continue;
    }
    if (Math.hypot(position.x - otherPosition.x, position.y - otherPosition.y) < threshold) {
      overlapCount++;
    }
  }
  return overlapCount;
}

function terminalMultipleBondBlockerDescriptor(layoutGraph, coords, atomId) {
  const atom = layoutGraph.atoms.get(atomId);
  if (
    !atom
    || atom.element === 'C'
    || atom.element === 'H'
    || atom.aromatic
    || atom.heavyDegree !== 1
    || !coords.has(atomId)
  ) {
    return null;
  }

  const centerBond = (layoutGraph.bondsByAtomId.get(atomId) ?? []).find(bond => {
    if (!bond || bond.kind !== 'covalent' || bond.aromatic || (bond.order ?? 1) < 2) {
      return false;
    }
    const neighborAtomId = bond.a === atomId ? bond.b : bond.a;
    const neighborAtom = layoutGraph.atoms.get(neighborAtomId);
    return !!neighborAtom && neighborAtom.element !== 'H' && coords.has(neighborAtomId);
  });
  if (!centerBond) {
    return null;
  }

  const centerAtomId = centerBond.a === atomId ? centerBond.b : centerBond.a;
  const centerAtom = layoutGraph.atoms.get(centerAtomId);
  if (!centerAtom || centerAtom.element === 'H' || !coords.has(centerAtomId)) {
    return null;
  }

  const heavyNeighborIds = (layoutGraph.bondsByAtomId.get(centerAtomId) ?? [])
    .filter(bond => bond?.kind === 'covalent')
    .map(bond => (bond.a === centerAtomId ? bond.b : bond.a))
    .filter(neighborAtomId => {
      const neighborAtom = layoutGraph.atoms.get(neighborAtomId);
      return !!neighborAtom && neighborAtom.element !== 'H' && coords.has(neighborAtomId);
    });
  return heavyNeighborIds.length === 3
    ? { centerAtomId, blockerAtomId: atomId, heavyNeighborIds }
    : null;
}

function threeHeavyCenterMaxDeviation(coords, centerAtomId, neighborAtomIds) {
  const centerPosition = coords.get(centerAtomId);
  if (!centerPosition || neighborAtomIds.length !== 3) {
    return Number.POSITIVE_INFINITY;
  }

  const neighborAngles = neighborAtomIds.map(neighborAtomId => {
    const neighborPosition = coords.get(neighborAtomId);
    return neighborPosition ? angleOf(sub(neighborPosition, centerPosition)) : null;
  });
  if (neighborAngles.some(angle => angle == null)) {
    return Number.POSITIVE_INFINITY;
  }

  let maxDeviation = 0;
  for (let firstIndex = 0; firstIndex < neighborAngles.length; firstIndex++) {
    for (let secondIndex = firstIndex + 1; secondIndex < neighborAngles.length; secondIndex++) {
      maxDeviation = Math.max(
        maxDeviation,
        Math.abs(angularDifference(neighborAngles[firstIndex], neighborAngles[secondIndex]) - (2 * Math.PI) / 3)
      );
    }
  }
  return maxDeviation;
}

function threeHeavyCenterMaxSeparation(coords, centerAtomId, neighborAtomIds) {
  const centerPosition = coords.get(centerAtomId);
  if (!centerPosition || neighborAtomIds.length !== 3) {
    return Number.POSITIVE_INFINITY;
  }

  const neighborAngles = neighborAtomIds.map(neighborAtomId => {
    const neighborPosition = coords.get(neighborAtomId);
    return neighborPosition ? angleOf(sub(neighborPosition, centerPosition)) : null;
  });
  if (neighborAngles.some(angle => angle == null)) {
    return Number.POSITIVE_INFINITY;
  }

  let maxSeparation = 0;
  for (let firstIndex = 0; firstIndex < neighborAngles.length; firstIndex++) {
    for (let secondIndex = firstIndex + 1; secondIndex < neighborAngles.length; secondIndex++) {
      maxSeparation = Math.max(
        maxSeparation,
        angularDifference(neighborAngles[firstIndex], neighborAngles[secondIndex])
      );
    }
  }
  return maxSeparation;
}

function threeHeavyCenterMinSeparation(coords, centerAtomId, neighborAtomIds) {
  const centerPosition = coords.get(centerAtomId);
  if (!centerPosition || neighborAtomIds.length !== 3) {
    return Number.POSITIVE_INFINITY;
  }

  const neighborAngles = neighborAtomIds.map(neighborAtomId => {
    const neighborPosition = coords.get(neighborAtomId);
    return neighborPosition ? angleOf(sub(neighborPosition, centerPosition)) : null;
  });
  if (neighborAngles.some(angle => angle == null)) {
    return Number.POSITIVE_INFINITY;
  }

  let minSeparation = Number.POSITIVE_INFINITY;
  for (let firstIndex = 0; firstIndex < neighborAngles.length; firstIndex++) {
    for (let secondIndex = firstIndex + 1; secondIndex < neighborAngles.length; secondIndex++) {
      minSeparation = Math.min(
        minSeparation,
        angularDifference(neighborAngles[firstIndex], neighborAngles[secondIndex])
      );
    }
  }
  return minSeparation;
}

function collectCovalentSubtreeAtomIds(layoutGraph, rootAtomId, blockedAtomId) {
  const visitedAtomIds = new Set([blockedAtomId]);
  const pendingAtomIds = [rootAtomId];
  const subtreeAtomIds = [];

  while (pendingAtomIds.length > 0) {
    const atomId = pendingAtomIds.pop();
    if (visitedAtomIds.has(atomId)) {
      continue;
    }
    visitedAtomIds.add(atomId);
    subtreeAtomIds.push(atomId);
    for (const bond of layoutGraph.bondsByAtomId.get(atomId) ?? []) {
      if (!bond || bond.kind !== 'covalent') {
        continue;
      }
      const neighborAtomId = bond.a === atomId ? bond.b : bond.a;
      if (!visitedAtomIds.has(neighborAtomId)) {
        pendingAtomIds.push(neighborAtomId);
      }
    }
  }

  return subtreeAtomIds;
}

function heavyAtomCountInIds(layoutGraph, atomIds) {
  return atomIds.reduce((count, atomId) => {
    const atom = layoutGraph.atoms.get(atomId);
    return atom && atom.element !== 'H' ? count + 1 : count;
  }, 0);
}

function rotateAtomIdsAroundPivot(coords, atomIds, pivotAtomId, rotationAngle) {
  const pivotPosition = coords.get(pivotAtomId);
  if (!pivotPosition) {
    return null;
  }

  const candidateCoords = new Map(coords);
  for (const atomId of atomIds) {
    if (atomId === pivotAtomId) {
      continue;
    }
    const position = candidateCoords.get(atomId);
    if (!position) {
      continue;
    }
    candidateCoords.set(atomId, add(pivotPosition, rotate(sub(position, pivotPosition), rotationAngle)));
  }
  return candidateCoords;
}

function visibleHeavyCovalentBonds(layoutGraph, coords, atomId) {
  return (layoutGraph.bondsByAtomId.get(atomId) ?? [])
    .filter(bond => bond?.kind === 'covalent')
    .map(bond => ({
      bond,
      neighborAtomId: bond.a === atomId ? bond.b : bond.a
    }))
    .filter(({ neighborAtomId }) => {
      const neighborAtom = layoutGraph.atoms.get(neighborAtomId);
      return !!neighborAtom && neighborAtom.element !== 'H' && coords.has(neighborAtomId);
    });
}

function terminalMultipleBondLeafFanPenaltyFromAngles(angles) {
  if (angles.length !== 3) {
    return Number.POSITIVE_INFINITY;
  }
  const sortedAngles = [...angles].sort((firstAngle, secondAngle) => firstAngle - secondAngle);
  const separations = sortedAngles.map((angle, index) => {
    const nextAngle = sortedAngles[(index + 1) % sortedAngles.length];
    return index === sortedAngles.length - 1
      ? (nextAngle + Math.PI * 2) - angle
      : nextAngle - angle;
  });
  const idealSeparation = (Math.PI * 2) / 3;
  return separations.reduce((sum, separation) => sum + (separation - idealSeparation) ** 2, 0);
}

function terminalMultipleBondLeafFanPenalty(coords, centerAtomId, neighborAtomIds) {
  const centerPosition = coords.get(centerAtomId);
  if (!centerPosition || neighborAtomIds.length !== 3) {
    return Number.POSITIVE_INFINITY;
  }
  const angles = [];
  for (const neighborAtomId of neighborAtomIds) {
    const neighborPosition = coords.get(neighborAtomId);
    if (!neighborPosition) {
      return Number.POSITIVE_INFINITY;
    }
    angles.push(angleOf(sub(neighborPosition, centerPosition)));
  }
  return terminalMultipleBondLeafFanPenaltyFromAngles(angles);
}

function terminalMultipleBondLeafFanMaxDeviation(coords, centerAtomId, neighborAtomIds) {
  const centerPosition = coords.get(centerAtomId);
  if (!centerPosition || neighborAtomIds.length !== 3) {
    return Number.POSITIVE_INFINITY;
  }
  const angles = neighborAtomIds.map(neighborAtomId => {
    const neighborPosition = coords.get(neighborAtomId);
    return neighborPosition ? angleOf(sub(neighborPosition, centerPosition)) : null;
  });
  if (angles.some(angle => angle == null)) {
    return Number.POSITIVE_INFINITY;
  }
  let maxDeviation = 0;
  for (let index = 0; index < angles.length; index++) {
    const nextAngle = angles[(index + 1) % angles.length];
    const separation = angularDifference(angles[index], nextAngle);
    maxDeviation = Math.max(maxDeviation, Math.abs(separation - (2 * Math.PI) / 3));
  }
  return maxDeviation;
}

function hiddenHydrogenMultipleBondVisiblePenalty(coords, centerAtomId, firstNeighborAtomId, secondNeighborAtomId) {
  const centerPosition = coords.get(centerAtomId);
  const firstPosition = coords.get(firstNeighborAtomId);
  const secondPosition = coords.get(secondNeighborAtomId);
  if (!centerPosition || !firstPosition || !secondPosition) {
    return Number.POSITIVE_INFINITY;
  }
  const angle = angularDifference(
    angleOf(sub(firstPosition, centerPosition)),
    angleOf(sub(secondPosition, centerPosition))
  );
  return (angle - HIDDEN_H_MULTIPLE_BOND_VISIBLE_ANGLE) ** 2;
}

function hiddenHydrogenTerminalMultipleBondFanDescriptor(layoutGraph, coords, centerAtomId, frozenAtomIds = null) {
  const centerAtom = layoutGraph.atoms.get(centerAtomId);
  if (
    !centerAtom
    || centerAtom.element !== 'C'
    || centerAtom.aromatic
    || centerAtom.heavyDegree !== 2
    || centerAtom.degree !== 3
    || !coords.has(centerAtomId)
  ) {
    return null;
  }

  const heavyBonds = visibleHeavyCovalentBonds(layoutGraph, coords, centerAtomId);
  if (heavyBonds.length !== 2) {
    return null;
  }
  const multipleBond = heavyBonds.find(({ bond, neighborAtomId }) => {
    const neighborAtom = layoutGraph.atoms.get(neighborAtomId);
    return (
      !bond.aromatic
      && (bond.order ?? 1) >= 2
      && neighborAtom
      && neighborAtom.element !== 'H'
      && neighborAtom.heavyDegree === 1
      && !(frozenAtomIds instanceof Set && frozenAtomIds.has(neighborAtomId))
    );
  });
  if (!multipleBond) {
    return null;
  }
  const supportBond = heavyBonds.find(({ neighborAtomId }) => neighborAtomId !== multipleBond.neighborAtomId);
  if (!supportBond || supportBond.bond.aromatic || (supportBond.bond.order ?? 1) !== 1) {
    return null;
  }

  const currentPenalty = hiddenHydrogenMultipleBondVisiblePenalty(
    coords,
    centerAtomId,
    supportBond.neighborAtomId,
    multipleBond.neighborAtomId
  );
  if (!Number.isFinite(currentPenalty) || currentPenalty <= TERMINAL_MULTIPLE_BOND_FAN_IMPROVEMENT_EPSILON) {
    return null;
  }

  return {
    centerAtomId,
    supportAtomId: supportBond.neighborAtomId,
    leafAtomId: multipleBond.neighborAtomId,
    currentPenalty
  };
}

function hiddenHydrogenTerminalMultipleBondTargetAngle(coords, descriptor) {
  const centerPosition = coords.get(descriptor.centerAtomId);
  const supportPosition = coords.get(descriptor.supportAtomId);
  const leafPosition = coords.get(descriptor.leafAtomId);
  if (!centerPosition || !supportPosition || !leafPosition) {
    return null;
  }
  const supportAngle = angleOf(sub(supportPosition, centerPosition));
  const leafAngle = angleOf(sub(leafPosition, centerPosition));
  const candidates = [
    supportAngle + HIDDEN_H_MULTIPLE_BOND_VISIBLE_ANGLE,
    supportAngle - HIDDEN_H_MULTIPLE_BOND_VISIBLE_ANGLE
  ];
  return candidates.sort((firstAngle, secondAngle) =>
    angularDifference(firstAngle, leafAngle) - angularDifference(secondAngle, leafAngle)
  )[0];
}

function movedAtomOverlapCount(layoutGraph, coords, atomIds, overridePositions, threshold) {
  let overlapCount = 0;
  for (const atomId of atomIds) {
    const position = overridePositions.get(atomId) ?? coords.get(atomId);
    if (!position) {
      continue;
    }
    overlapCount += localSevereOverlapCountWithOverrides(
      layoutGraph,
      coords,
      atomId,
      position,
      overridePositions,
      threshold
    );
  }
  return overlapCount;
}

function runHiddenHydrogenTerminalMultipleBondFanTidy(layoutGraph, coords, bondLength, atomGrid, frozenAtomIds) {
  let nudges = 0;
  const threshold = bondLength * 0.55;
  for (const centerAtomId of [...coords.keys()]) {
    const descriptor = hiddenHydrogenTerminalMultipleBondFanDescriptor(layoutGraph, coords, centerAtomId, frozenAtomIds);
    if (!descriptor) {
      continue;
    }
    const targetAngle = hiddenHydrogenTerminalMultipleBondTargetAngle(coords, descriptor);
    const centerPosition = coords.get(descriptor.centerAtomId);
    const leafPosition = coords.get(descriptor.leafAtomId);
    if (targetAngle == null || !centerPosition || !leafPosition) {
      continue;
    }

    const leafAngle = angleOf(sub(leafPosition, centerPosition));
    const rotation = Math.atan2(Math.sin(targetAngle - leafAngle), Math.cos(targetAngle - leafAngle));
    if (Math.abs(rotation) <= TIDY_IMPROVEMENT_EPSILON) {
      continue;
    }
    const movedAtomIds = collectCovalentSubtreeAtomIds(layoutGraph, descriptor.leafAtomId, descriptor.centerAtomId)
      .filter(atomId => coords.has(atomId));
    if (
      movedAtomIds.length === 0
      || (frozenAtomIds instanceof Set && movedAtomIds.some(atomId => frozenAtomIds.has(atomId)))
    ) {
      continue;
    }

    const overridePositions = new Map();
    for (const atomId of movedAtomIds) {
      const position = coords.get(atomId);
      overridePositions.set(atomId, add(centerPosition, rotate(sub(position, centerPosition), rotation)));
    }
    const currentOverlapCount = movedAtomOverlapCount(layoutGraph, coords, movedAtomIds, new Map(), threshold);
    const targetOverlapCount = movedAtomOverlapCount(layoutGraph, coords, movedAtomIds, overridePositions, threshold);
    if (targetOverlapCount > currentOverlapCount) {
      continue;
    }
    const candidateCoords = new Map(coords);
    for (const [atomId, position] of overridePositions) {
      candidateCoords.set(atomId, position);
    }
    const candidatePenalty = hiddenHydrogenMultipleBondVisiblePenalty(
      candidateCoords,
      descriptor.centerAtomId,
      descriptor.supportAtomId,
      descriptor.leafAtomId
    );
    if (candidatePenalty >= descriptor.currentPenalty - TERMINAL_MULTIPLE_BOND_FAN_IMPROVEMENT_EPSILON) {
      continue;
    }
    if (auditLayout(layoutGraph, candidateCoords, { bondLength }).ok !== true) {
      continue;
    }

    for (const [atomId, targetPosition] of overridePositions) {
      const previousPosition = coords.get(atomId);
      if (!previousPosition) {
        continue;
      }
      atomGrid.remove(atomId, previousPosition);
      previousPosition.x = targetPosition.x;
      previousPosition.y = targetPosition.y;
      atomGrid.insert(atomId, previousPosition);
    }
    nudges++;
  }
  return nudges;
}

function terminalMultipleBondBalancedSupportReliefCoords(layoutGraph, coords, descriptor, bondLength, frozenAtomIds) {
  if (descriptor.leafTargets.length !== 1) {
    return null;
  }
  const leafAtomId = descriptor.leafTargets[0].leafAtomId;
  const fixedNeighborIds = descriptor.neighborAtomIds.filter(neighborAtomId => neighborAtomId !== leafAtomId);
  if (fixedNeighborIds.length !== 2) {
    return null;
  }
  const centerPosition = coords.get(descriptor.centerAtomId);
  if (!centerPosition) {
    return null;
  }
  const fixedAngles = fixedNeighborIds.map(neighborAtomId => angleOf(sub(coords.get(neighborAtomId), centerPosition)));
  const fixedSeparation = angularDifference(fixedAngles[0], fixedAngles[1]);
  const targetSupportSeparation = (19 * Math.PI) / 30;
  if (fixedSeparation <= targetSupportSeparation + TIDY_IMPROVEMENT_EPSILON) {
    return null;
  }
  const reliefRotation = Math.min(fixedSeparation - targetSupportSeparation, Math.PI / 6);
  const leafAtomIds = collectCovalentSubtreeAtomIds(layoutGraph, leafAtomId, descriptor.centerAtomId)
    .filter(atomId => coords.has(atomId));
  if (
    leafAtomIds.length === 0
    || (frozenAtomIds instanceof Set && leafAtomIds.some(atomId => frozenAtomIds.has(atomId)))
  ) {
    return null;
  }

  let bestCandidate = null;
  let bestScore = null;
  for (const supportAtomId of fixedNeighborIds) {
    if ((layoutGraph.atomToRings.get(supportAtomId)?.length ?? 0) === 0) {
      continue;
    }
    const supportAtomIds = collectCovalentSubtreeAtomIds(layoutGraph, supportAtomId, descriptor.centerAtomId)
      .filter(atomId => coords.has(atomId));
    const centerSideAtomIds = collectCovalentSubtreeAtomIds(layoutGraph, descriptor.centerAtomId, supportAtomId)
      .filter(atomId => coords.has(atomId));
    if (
      supportAtomIds.length === 0
      || centerSideAtomIds.length === 0
      || (frozenAtomIds instanceof Set && (
        supportAtomIds.some(atomId => frozenAtomIds.has(atomId))
        || centerSideAtomIds.some(atomId => frozenAtomIds.has(atomId))
      ))
    ) {
      continue;
    }
    const otherFixedAtomId = fixedNeighborIds.find(neighborAtomId => neighborAtomId !== supportAtomId);
    for (const supportRotation of [reliefRotation, -reliefRotation]) {
      let candidateCoords = rotateAtomIdsAroundPivot(coords, supportAtomIds, descriptor.centerAtomId, supportRotation);
      if (!candidateCoords) {
        continue;
      }
      const supportSeparation = angularDifference(
        angleOf(sub(candidateCoords.get(supportAtomId), candidateCoords.get(descriptor.centerAtomId))),
        angleOf(sub(candidateCoords.get(otherFixedAtomId), candidateCoords.get(descriptor.centerAtomId)))
      );
      if (supportSeparation >= fixedSeparation - TIDY_IMPROVEMENT_EPSILON) {
        continue;
      }
      candidateCoords = rotateAtomIdsAroundPivot(candidateCoords, leafAtomIds, descriptor.centerAtomId, -supportRotation);
      if (!candidateCoords) {
        continue;
      }
      for (const centerSideRotation of [0, Math.PI / 15, -Math.PI / 15, Math.PI / 12, -Math.PI / 12, Math.PI / 18, -Math.PI / 18, Math.PI / 9, -Math.PI / 9]) {
        const relievedCoords = Math.abs(centerSideRotation) <= TIDY_IMPROVEMENT_EPSILON
          ? candidateCoords
          : rotateAtomIdsAroundPivot(candidateCoords, centerSideAtomIds, supportAtomId, centerSideRotation);
        if (!relievedCoords) {
          continue;
        }
        const audit = auditLayout(layoutGraph, relievedCoords, { bondLength });
        if (audit.ok !== true) {
          continue;
        }
        const fanPenalty = terminalMultipleBondLeafFanPenalty(
          relievedCoords,
          descriptor.centerAtomId,
          descriptor.neighborAtomIds
        );
        if (fanPenalty >= descriptor.currentPenalty - TERMINAL_MULTIPLE_BOND_FAN_IMPROVEMENT_EPSILON) {
          continue;
        }
        const score = fanPenalty + Math.abs(centerSideRotation) * 0.01;
        if (bestScore == null || score < bestScore - TIDY_IMPROVEMENT_EPSILON) {
          bestScore = score;
          bestCandidate = relievedCoords;
        }
      }
    }
  }
  return bestCandidate;
}

/**
 * Returns the best assignment from terminal multiple-bond leaves to target
 * angles with the least angular travel from the current depiction.
 * @param {string[]} leafAtomIds - Movable terminal multiple-bond leaf IDs.
 * @param {Map<string, number>} currentAngles - Current center-relative angles.
 * @param {number[]} targetAngles - Candidate target angles.
 * @returns {{leafAtomId: string, targetAngle: number}[]|null} Assigned leaf targets, or null.
 */
function assignTerminalMultipleBondLeafTargets(leafAtomIds, currentAngles, targetAngles) {
  if (leafAtomIds.length !== targetAngles.length || leafAtomIds.length === 0 || leafAtomIds.length > 2) {
    return null;
  }
  if (leafAtomIds.length === 1) {
    return [{ leafAtomId: leafAtomIds[0], targetAngle: targetAngles[0] }];
  }

  const directCost =
    angularDifference(currentAngles.get(leafAtomIds[0]), targetAngles[0])
    + angularDifference(currentAngles.get(leafAtomIds[1]), targetAngles[1]);
  const swappedCost =
    angularDifference(currentAngles.get(leafAtomIds[0]), targetAngles[1])
    + angularDifference(currentAngles.get(leafAtomIds[1]), targetAngles[0]);
  return directCost <= swappedCost
    ? [
        { leafAtomId: leafAtomIds[0], targetAngle: targetAngles[0] },
        { leafAtomId: leafAtomIds[1], targetAngle: targetAngles[1] }
      ]
    : [
        { leafAtomId: leafAtomIds[0], targetAngle: targetAngles[1] },
        { leafAtomId: leafAtomIds[1], targetAngle: targetAngles[0] }
    ];
}

function bestCrowdedLinearSupportLeafAngle(layoutGraph, coords, centerAtomId, leafAtomId, leafPosition, fixedNeighborAngles, bondLength) {
  const centerPosition = coords.get(centerAtomId);
  if (!centerPosition) {
    return 0;
  }
  const radius = distance(centerPosition, leafPosition) || bondLength;
  const currentAngle = angleOf(sub(leafPosition, centerPosition));
  const threshold = bondLength * 0.55;
  const candidates = [];

  for (const fixedAngle of fixedNeighborAngles) {
    for (const offset of [Math.PI / 2, -Math.PI / 2]) {
      const candidateAngle = fixedAngle + offset;
      const candidatePosition = add(centerPosition, fromAngle(candidateAngle, radius));
      const overridePositions = new Map([[leafAtomId, candidatePosition]]);
      candidates.push({
        angle: candidateAngle,
        overlapCount: localSevereOverlapCountWithOverrides(
          layoutGraph,
          coords,
          leafAtomId,
          candidatePosition,
          overridePositions,
          threshold
        ),
        clearance: localNonbondedClearanceWithOverrides(
          layoutGraph,
          coords,
          leafAtomId,
          candidatePosition,
          overridePositions
        ),
        angleDelta: angularDifference(candidateAngle, currentAngle)
      });
    }
  }

  candidates.sort((firstCandidate, secondCandidate) => {
    if (firstCandidate.overlapCount !== secondCandidate.overlapCount) {
      return firstCandidate.overlapCount - secondCandidate.overlapCount;
    }
    if (Math.abs(firstCandidate.clearance - secondCandidate.clearance) > TIDY_IMPROVEMENT_EPSILON) {
      return secondCandidate.clearance - firstCandidate.clearance;
    }
    return firstCandidate.angleDelta - secondCandidate.angleDelta;
  });
  return candidates[0]?.angle ?? currentAngle;
}

/**
 * Builds a terminal multiple-bond fan descriptor for centers with one movable
 * multiple-bond leaf and two fixed heavy neighbors.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Coordinate map.
 * @param {string} centerAtomId - Three-coordinate fan center atom id.
 * @param {Array<{bond: object, neighborAtomId: string}>} heavyBonds - Visible heavy bonds at the center.
 * @param {Array<{bond: object, neighborAtomId: string}>} terminalMultipleBondLeaves - Movable terminal multiple-bond leaves.
 * @returns {object|null} Fan descriptor, or null when no improvement is available.
 */
function singleTerminalMultipleBondLeafFanDescriptor(layoutGraph, coords, centerAtomId, heavyBonds, terminalMultipleBondLeaves) {
  const centerPosition = coords.get(centerAtomId);
  const leafAtomId = terminalMultipleBondLeaves[0].neighborAtomId;
  const fixedNeighborIds = heavyBonds
    .map(({ neighborAtomId }) => neighborAtomId)
    .filter(neighborAtomId => neighborAtomId !== leafAtomId);
  if (fixedNeighborIds.length !== 2) {
    return null;
  }

  const fixedNeighborPositions = fixedNeighborIds.map(neighborAtomId => coords.get(neighborAtomId)).filter(Boolean);
  if (fixedNeighborPositions.length !== 2) {
    return null;
  }
  const fixedNeighborAngles = fixedNeighborPositions.map(position => angleOf(sub(position, centerPosition)));

  const leafPosition = coords.get(leafAtomId);
  if (!leafPosition) {
    return null;
  }
  const neighborAtomIds = [...fixedNeighborIds, leafAtomId];
  const currentPenalty = terminalMultipleBondLeafFanPenalty(coords, centerAtomId, neighborAtomIds);
  const currentLeafClearance = localNonbondedClearanceWithOverrides(
    layoutGraph,
    coords,
    leafAtomId,
    leafPosition,
    new Map([[leafAtomId, leafPosition]])
  );
  const hasCrowdedLeaf = currentLeafClearance < layoutGraph.options.bondLength * 0.55;
  const fixedNeighborsAreLinear =
    Math.abs(angularDifference(fixedNeighborAngles[0], fixedNeighborAngles[1]) - Math.PI)
      <= TERMINAL_MULTIPLE_BOND_LINEAR_NEIGHBOR_TOLERANCE;
  if (fixedNeighborsAreLinear && !hasCrowdedLeaf) {
    return null;
  }
  if (
    !hasCrowdedLeaf
    && terminalMultipleBondLeafFanMaxDeviation(coords, centerAtomId, neighborAtomIds) <= TERMINAL_MULTIPLE_BOND_BALANCED_FAN_TOLERANCE + TIDY_IMPROVEMENT_EPSILON
  ) {
    return null;
  }
  const targetAngle = fixedNeighborsAreLinear
    ? bestCrowdedLinearSupportLeafAngle(
        layoutGraph,
        coords,
        centerAtomId,
        leafAtomId,
        leafPosition,
        fixedNeighborAngles,
        layoutGraph.options.bondLength
      )
    : angleOf(sub(centerPosition, centroid(fixedNeighborPositions)));
  const targetAngles = [
    fixedNeighborAngles[0],
    fixedNeighborAngles[1],
    targetAngle
  ];
  const targetPenalty = terminalMultipleBondLeafFanPenaltyFromAngles(targetAngles);
  if (targetPenalty > currentPenalty + TERMINAL_MULTIPLE_BOND_FAN_IMPROVEMENT_EPSILON) {
    return null;
  }

  return {
    centerAtomId,
    neighborAtomIds,
    leafTargets: [{ leafAtomId, targetAngle }],
    currentPenalty,
    targetPenalty
  };
}

/**
 * Builds a terminal multiple-bond fan descriptor for centers with two movable
 * multiple-bond leaves and one fixed heavy neighbor.
 * @param {Map<string, {x: number, y: number}>} coords - Coordinate map.
 * @param {string} centerAtomId - Three-coordinate fan center atom id.
 * @param {Array<{bond: object, neighborAtomId: string}>} heavyBonds - Visible heavy bonds at the center.
 * @param {Array<{bond: object, neighborAtomId: string}>} terminalMultipleBondLeaves - Movable terminal multiple-bond leaves.
 * @returns {object|null} Fan descriptor, or null when no improvement is available.
 */
function pairedTerminalMultipleBondLeafFanDescriptor(coords, centerAtomId, heavyBonds, terminalMultipleBondLeaves) {
  const centerPosition = coords.get(centerAtomId);
  const fixedNeighborIds = heavyBonds
    .map(({ neighborAtomId }) => neighborAtomId)
    .filter(neighborAtomId => !terminalMultipleBondLeaves.some(leaf => leaf.neighborAtomId === neighborAtomId));
  if (fixedNeighborIds.length !== 1) {
    return null;
  }

  const fixedNeighborId = fixedNeighborIds[0];
  const fixedNeighborPosition = coords.get(fixedNeighborId);
  if (!fixedNeighborPosition) {
    return null;
  }

  const leafAtomIds = terminalMultipleBondLeaves.map(({ neighborAtomId }) => neighborAtomId);
  if (leafAtomIds.some(leafAtomId => !coords.has(leafAtomId))) {
    return null;
  }

  const fixedNeighborAngle = angleOf(sub(fixedNeighborPosition, centerPosition));
  const targetAngles = [
    fixedNeighborAngle + (2 * Math.PI) / 3,
    fixedNeighborAngle - (2 * Math.PI) / 3
  ];
  const currentAngles = new Map(
    leafAtomIds.map(leafAtomId => [
      leafAtomId,
      angleOf(sub(coords.get(leafAtomId), centerPosition))
    ])
  );
  const leafTargets = assignTerminalMultipleBondLeafTargets(leafAtomIds, currentAngles, targetAngles);
  if (!leafTargets) {
    return null;
  }

  const neighborAtomIds = [fixedNeighborId, ...leafAtomIds];
  const currentPenalty = terminalMultipleBondLeafFanPenalty(coords, centerAtomId, neighborAtomIds);
  if (terminalMultipleBondLeafFanMaxDeviation(coords, centerAtomId, neighborAtomIds) <= TERMINAL_MULTIPLE_BOND_BALANCED_FAN_TOLERANCE + TIDY_IMPROVEMENT_EPSILON) {
    return null;
  }
  const targetPenalty = terminalMultipleBondLeafFanPenaltyFromAngles([
    fixedNeighborAngle,
    ...leafTargets.map(({ targetAngle }) => targetAngle)
  ]);
  if (targetPenalty > currentPenalty + TERMINAL_MULTIPLE_BOND_FAN_IMPROVEMENT_EPSILON) {
    return null;
  }

  return {
    centerAtomId,
    neighborAtomIds,
    leafTargets,
    currentPenalty,
    targetPenalty
  };
}

/**
 * Returns a local terminal multiple-bond fan descriptor for a three-coordinate
 * center whose movable terminal hetero leaves can improve a trigonal spread.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Coordinate map.
 * @param {string} centerAtomId - Candidate fan center atom id.
 * @param {Set<string>|null} frozenAtomIds - Frozen atoms that must not move.
 * @returns {object|null} Fan descriptor, or null when unsupported.
 */
function terminalMultipleBondLeafFanDescriptor(layoutGraph, coords, centerAtomId, frozenAtomIds) {
  const centerAtom = layoutGraph.atoms.get(centerAtomId);
  const centerPosition = coords.get(centerAtomId);
  if (!centerAtom || centerAtom.element === 'H' || centerAtom.aromatic || !centerPosition) {
    return null;
  }

  const heavyBonds = visibleHeavyCovalentBonds(layoutGraph, coords, centerAtomId);
  if (heavyBonds.length !== 3) {
    return null;
  }

  const terminalMultipleBondLeaves = heavyBonds.filter(({ bond, neighborAtomId }) => {
    const neighborAtom = layoutGraph.atoms.get(neighborAtomId);
    return (
      !bond.aromatic
      && (bond.order ?? 1) >= 2
      && neighborAtom
      && neighborAtom.element !== 'C'
      && neighborAtom.heavyDegree === 1
      && !(frozenAtomIds instanceof Set && frozenAtomIds.has(neighborAtomId))
    );
  });
  if (terminalMultipleBondLeaves.length === 1) {
    return singleTerminalMultipleBondLeafFanDescriptor(
      layoutGraph,
      coords,
      centerAtomId,
      heavyBonds,
      terminalMultipleBondLeaves
    );
  }
  if (terminalMultipleBondLeaves.length !== 2) {
    return null;
  }

  const fixedBonds = heavyBonds.filter(({ neighborAtomId }) =>
    !terminalMultipleBondLeaves.some(leaf => leaf.neighborAtomId === neighborAtomId)
  );
  if (
    fixedBonds.length !== 1
    || fixedBonds.some(({ bond }) => bond.aromatic || (bond.order ?? 1) !== 1)
  ) {
    return null;
  }
  return pairedTerminalMultipleBondLeafFanDescriptor(coords, centerAtomId, heavyBonds, terminalMultipleBondLeaves);
}

/**
 * Counts severe local overlaps for one candidate atom position while applying
 * sparse positions for any other leaves that move in the same fan retouch.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Base coordinate map.
 * @param {string} atomId - Candidate moved atom id.
 * @param {{x: number, y: number}} candidatePosition - Proposed atom position.
 * @param {Map<string, {x: number, y: number}>} overridePositions - Sparse moved positions.
 * @param {number} threshold - Severe-overlap distance threshold.
 * @returns {number} Local severe-overlap count.
 */
function localSevereOverlapCountWithOverrides(layoutGraph, coords, atomId, candidatePosition, overridePositions, threshold) {
  let overlapCount = 0;
  for (const [otherAtomId, basePosition] of coords) {
    if (
      otherAtomId === atomId
      || !isVisiblePresentationAtom(layoutGraph, otherAtomId)
      || layoutGraph.bondedPairSet.has(atomPairKey(atomId, otherAtomId))
    ) {
      continue;
    }
    const otherPosition = overridePositions.get(otherAtomId) ?? basePosition;
    if (!otherPosition) {
      continue;
    }
    if (distance(candidatePosition, otherPosition) < threshold) {
      overlapCount++;
    }
  }
  return overlapCount;
}

/**
 * Returns the closest non-bonded atom distance for a candidate position while
 * applying sparse positions for any other leaves that move in the same fan
 * retouch.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Base coordinate map.
 * @param {string} atomId - Candidate moved atom id.
 * @param {{x: number, y: number}} candidatePosition - Proposed atom position.
 * @param {Map<string, {x: number, y: number}>} overridePositions - Sparse moved positions.
 * @returns {number} Minimum non-bonded clearance, or infinity when no neighbor is present.
 */
function localNonbondedClearanceWithOverrides(layoutGraph, coords, atomId, candidatePosition, overridePositions) {
  let minimumDistance = Number.POSITIVE_INFINITY;
  for (const [otherAtomId, basePosition] of coords) {
    if (
      otherAtomId === atomId
      || !isVisiblePresentationAtom(layoutGraph, otherAtomId)
      || layoutGraph.bondedPairSet.has(atomPairKey(atomId, otherAtomId))
    ) {
      continue;
    }
    const otherPosition = overridePositions.get(otherAtomId) ?? basePosition;
    if (!otherPosition) {
      continue;
    }
    minimumDistance = Math.min(minimumDistance, distance(candidatePosition, otherPosition));
  }
  return minimumDistance;
}

/**
 * Builds exact-angle, shortened terminal multiple-bond leaf candidates when
 * the full-length exact fan overlaps or crowds nearby atoms. Carbonyl leaves
 * are accepted by the audit when the direction is exact and the compression
 * stays above the terminal-carbonyl floor.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Base coordinate map.
 * @param {object} descriptor - Terminal multiple-bond fan descriptor.
 * @param {Map<string, {x: number, y: number}>} targetPositions - Full-length exact target positions.
 * @param {number} bondLength - Target bond length.
 * @param {{force?: boolean}} [options] - Compression options.
 * @returns {Map<string, {x: number, y: number}>|null} Compressed target positions, or null.
 */
function compressedTerminalMultipleBondLeafTargetPositions(layoutGraph, coords, descriptor, targetPositions, bondLength, options = {}) {
  const centerPosition = coords.get(descriptor.centerAtomId);
  if (!centerPosition) {
    return null;
  }

  const triggerClearance = bondLength * TERMINAL_MULTIPLE_BOND_LEAF_COMPRESSION_TRIGGER_FACTOR;
  const targetClearance = bondLength * TERMINAL_MULTIPLE_BOND_LEAF_COMPRESSION_TARGET_FACTOR;
  const minimumForceClearance = bondLength * 0.55;
  const compressedTargetPositions = new Map(targetPositions);
  let changed = false;

  for (const { leafAtomId, targetAngle } of descriptor.leafTargets) {
    const targetPosition = compressedTargetPositions.get(leafAtomId);
    if (!targetPosition) {
      return null;
    }

    const fullLengthClearance = localNonbondedClearanceWithOverrides(
      layoutGraph,
      coords,
      leafAtomId,
      targetPosition,
      compressedTargetPositions
    );
    if (options.force !== true && fullLengthClearance >= triggerClearance) {
      continue;
    }

    let bestPosition = null;
    let bestClearance = fullLengthClearance;
    let firstAuditCleanPosition = null;
    let firstForceClearPosition = null;
    for (const compressionFactor of TERMINAL_MULTIPLE_BOND_LEAF_COMPRESSION_FACTORS) {
      const candidatePosition = add(centerPosition, fromAngle(targetAngle, bondLength * compressionFactor));
      const candidatePositions = new Map(compressedTargetPositions);
      candidatePositions.set(leafAtomId, candidatePosition);
      const candidateCoords = new Map(coords);
      for (const [candidateAtomId, candidateTargetPosition] of candidatePositions) {
        candidateCoords.set(candidateAtomId, candidateTargetPosition);
      }
      const candidateAudit = auditLayout(layoutGraph, candidateCoords, { bondLength });
      if (candidateAudit.ok !== true) {
        continue;
      }
      firstAuditCleanPosition ??= candidatePosition;
      const candidateClearance = localNonbondedClearanceWithOverrides(
        layoutGraph,
        coords,
        leafAtomId,
        candidatePosition,
        candidatePositions
      );
      if (!bestPosition || candidateClearance > bestClearance + TIDY_IMPROVEMENT_EPSILON) {
        bestPosition = candidatePosition;
        bestClearance = candidateClearance;
      }
      if (!firstForceClearPosition && candidateClearance >= minimumForceClearance - TIDY_IMPROVEMENT_EPSILON) {
        firstForceClearPosition = candidatePosition;
      }
      if (candidateClearance >= targetClearance) {
        break;
      }
    }

    if (options.force === true && bestClearance < targetClearance && firstAuditCleanPosition) {
      bestPosition = firstForceClearPosition ?? firstAuditCleanPosition;
    }
    if (!bestPosition) {
      if (options.force === true) {
        return null;
      }
      continue;
    }
    compressedTargetPositions.set(leafAtomId, bestPosition);
    changed = true;
  }

  return changed ? compressedTargetPositions : null;
}

function terminalMultipleBondLeafFanBlockingAtomIds(layoutGraph, coords, descriptor, targetPositions, threshold) {
  const blockingAtomIds = new Set();
  const leafAtomIds = new Set(descriptor.leafTargets.map(({ leafAtomId }) => leafAtomId));
  for (const { leafAtomId } of descriptor.leafTargets) {
    const targetPosition = targetPositions.get(leafAtomId);
    if (!targetPosition) {
      continue;
    }
    for (const [otherAtomId, otherPosition] of coords) {
      if (
        leafAtomIds.has(otherAtomId)
        || otherAtomId === descriptor.centerAtomId
        || !isVisiblePresentationAtom(layoutGraph, otherAtomId)
        || layoutGraph.bondedPairSet.has(atomPairKey(leafAtomId, otherAtomId))
      ) {
        continue;
      }
      if (distance(targetPosition, otherPosition) < threshold) {
        blockingAtomIds.add(otherAtomId);
      }
    }
  }
  return [...blockingAtomIds];
}

function terminalMultipleBondLeafReliefClearance(layoutGraph, coords, descriptor, overridePositions) {
  let minimumClearance = Number.POSITIVE_INFINITY;
  for (const { leafAtomId } of descriptor.leafTargets) {
    const targetPosition = overridePositions.get(leafAtomId);
    if (!targetPosition) {
      continue;
    }
    minimumClearance = Math.min(
      minimumClearance,
      localNonbondedClearanceWithOverrides(layoutGraph, coords, leafAtomId, targetPosition, overridePositions)
    );
  }
  return minimumClearance;
}

function terminalMultipleBondLeafFanBlockerReliefScore(layoutGraph, coords, descriptor, overridePositions, bondLength, rotationAngle) {
  const candidateCoords = new Map(coords);
  for (const [atomId, position] of overridePositions) {
    candidateCoords.set(atomId, position);
  }
  const candidateAudit = auditLayout(layoutGraph, candidateCoords, { bondLength });
  if (candidateAudit.ok !== true) {
    return null;
  }
  const fanPenalty = terminalMultipleBondLeafFanPenalty(candidateCoords, descriptor.centerAtomId, descriptor.neighborAtomIds);
  if (fanPenalty > descriptor.currentPenalty + TERMINAL_MULTIPLE_BOND_FAN_IMPROVEMENT_EPSILON) {
    return null;
  }
  const clearance = terminalMultipleBondLeafReliefClearance(layoutGraph, coords, descriptor, overridePositions);
  return {
    fanPenalty,
    clearanceDeficit: Math.max(0, bondLength * TERMINAL_MULTIPLE_BOND_BLOCKER_RELIEF_CLEARANCE_FACTOR - clearance),
    rotationMagnitude: angularDifference(rotationAngle, 0)
  };
}

function isBetterTerminalMultipleBondLeafFanBlockerReliefScore(candidateScore, incumbentScore) {
  if (!incumbentScore) {
    return true;
  }
  for (const key of ['fanPenalty', 'clearanceDeficit', 'rotationMagnitude']) {
    if (Math.abs(candidateScore[key] - incumbentScore[key]) > TIDY_IMPROVEMENT_EPSILON) {
      return candidateScore[key] < incumbentScore[key];
    }
  }
  return false;
}

/**
 * Returns exact terminal multiple-bond leaf targets plus a compact rigid-ring
 * blocker move when a nearby pendant ring occupies the exact trigonal oxo slot.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Base coordinate map.
 * @param {object} descriptor - Terminal multiple-bond fan descriptor.
 * @param {Map<string, {x: number, y: number}>} targetPositions - Exact leaf target positions.
 * @param {number} bondLength - Target bond length.
 * @param {number} threshold - Severe-overlap threshold.
 * @param {Set<string>|null} frozenAtomIds - Frozen atoms that must not move.
 * @returns {Map<string, {x: number, y: number}>|null} Leaf and blocker target positions, or null.
 */
function terminalMultipleBondLeafFanBlockerReliefTargetPositions(
  layoutGraph,
  coords,
  descriptor,
  targetPositions,
  bondLength,
  threshold,
  frozenAtomIds
) {
  const blockingAtomIds = terminalMultipleBondLeafFanBlockingAtomIds(layoutGraph, coords, descriptor, targetPositions, threshold);
  if (blockingAtomIds.length === 0) {
    return null;
  }
  const rigidSubtreesByAtomId = layoutGraph._terminalMultipleBondLeafFanRigidSubtreesByAtomId ??= collectRigidPendantRingSubtrees(layoutGraph);
  const protectedAtomIds = new Set([descriptor.centerAtomId, ...descriptor.neighborAtomIds]);
  let bestTargetPositions = null;
  let bestScore = null;

  for (const blockingAtomId of blockingAtomIds) {
    const rigidDescriptor = rigidSubtreesByAtomId.get(blockingAtomId);
    if (!rigidDescriptor || rigidDescriptor.subtreeAtomIds.some(atomId => protectedAtomIds.has(atomId))) {
      continue;
    }
    if (frozenAtomIds instanceof Set && rigidDescriptor.subtreeAtomIds.some(atomId => frozenAtomIds.has(atomId))) {
      continue;
    }

    for (const rotationAngle of TERMINAL_MULTIPLE_BOND_BLOCKER_RELIEF_ROTATIONS) {
      const blockerPositions = rotateRigidDescriptorPositions(coords, rigidDescriptor, rotationAngle);
      if (!blockerPositions) {
        continue;
      }
      const candidateTargetPositions = new Map([...targetPositions, ...blockerPositions]);
      const candidateScore = terminalMultipleBondLeafFanBlockerReliefScore(
        layoutGraph,
        coords,
        descriptor,
        candidateTargetPositions,
        bondLength,
        rotationAngle
      );
      if (!candidateScore) {
        continue;
      }
      if (isBetterTerminalMultipleBondLeafFanBlockerReliefScore(candidateScore, bestScore)) {
        bestScore = candidateScore;
        bestTargetPositions = candidateTargetPositions;
      }
    }
  }

  return bestTargetPositions;
}

function scoreTerminalHeteroPosition(layoutGraph, coords, descriptor, atomGrid, ringPolygons, position, candidateAngle, currentAngle, threshold, searchRadius) {
  return {
    position,
    insideRingCount: countPointInPolygons(ringPolygons, position),
    overlapCount: localSevereOverlapCount(layoutGraph, coords, atomGrid, descriptor.heteroAtomId, position, threshold),
    clearance: localNonbondedClearance(layoutGraph, coords, atomGrid, descriptor.heteroAtomId, position, searchRadius),
    prefersOutwardGeometry: descriptor.prefersOutwardGeometry,
    outwardDeviation: descriptor.prefersOutwardGeometry
      ? Math.min(...descriptor.outwardAngles.map(outwardAngle => angularDifference(outwardAngle, candidateAngle)))
      : 0,
    angleDelta: angularDifference(candidateAngle, currentAngle)
  };
}

/**
 * Returns placed hydrogens directly attached to a terminal hetero leaf.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Coordinate map.
 * @param {string} heteroAtomId - Terminal hetero atom ID.
 * @returns {string[]} Placed hydrogen atom IDs.
 */
function terminalHeteroHydrogenAtomIds(layoutGraph, coords, heteroAtomId) {
  return (layoutGraph.bondsByAtomId.get(heteroAtomId) ?? [])
    .filter(bond => bond?.kind === 'covalent')
    .map(bond => (bond.a === heteroAtomId ? bond.b : bond.a))
    .filter(neighborAtomId => layoutGraph.atoms.get(neighborAtomId)?.element === 'H' && coords.has(neighborAtomId));
}

/**
 * Builds sparse overrides for moving a terminal hetero and its single displayed
 * hydrogen as a straight continuation of the anchor-hetero bond.
 * @param {object} descriptor - Terminal hetero descriptor.
 * @param {{x: number, y: number}} heteroPosition - Candidate hetero position.
 * @param {number} candidateAngle - Anchor-to-hetero angle in radians.
 * @param {number} bondLength - Target drawn bond length.
 * @returns {Map<string, {x: number, y: number}>} Sparse override positions.
 */
function terminalHeteroMoveOverrides(descriptor, heteroPosition, candidateAngle, bondLength) {
  const overridePositions = new Map([[descriptor.heteroAtomId, heteroPosition]]);
  if (descriptor.hydrogenAtomIds.length === 1) {
    overridePositions.set(
      descriptor.hydrogenAtomIds[0],
      add(heteroPosition, fromAngle(candidateAngle, bondLength))
    );
  }
  return overridePositions;
}

/**
 * Returns whether a single-bond terminal hetero is attached to a saturated
 * multi-ring junction whose branch direction is already controlled by bridge
 * placement rather than phenolic leaf cleanup.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {string} anchorAtomId - Ring anchor atom ID.
 * @param {object} anchorAtom - Anchor layout atom.
 * @returns {boolean} True when late terminal-hetero retouch should skip it.
 */
function isSaturatedBridgeheadTerminalHeteroAnchor(layoutGraph, anchorAtomId, anchorAtom) {
  return (
    anchorAtom.aromatic !== true
    && (anchorAtom.heavyDegree ?? 0) >= 4
    && (layoutGraph.atomToRings.get(anchorAtomId)?.length ?? 0) > 1
  );
}

/**
 * Re-centers terminal multiple-bond hetero leaves onto an improved trigonal fan
 * when either one leaf or a paired set can move without increasing overlaps.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} inputCoords - Coordinate map.
 * @param {object} [options] - Hook options.
 * @param {number} [options.bondLength] - Target bond length.
 * @param {Set<string>|null} [options.frozenAtomIds] - Frozen atoms that must not move.
 * @returns {{coords: Map<string, {x: number, y: number}>, nudges: number}} Adjusted coordinates and move count.
 */
export function runTerminalMultipleBondLeafFanTidy(layoutGraph, inputCoords, options = {}) {
  const bondLength = options.bondLength ?? layoutGraph.options.bondLength;
  const frozenAtomIds = options.frozenAtomIds ?? null;
  const threshold = bondLength * 0.55;
  const coords = new Map([...inputCoords.entries()].map(([atomId, position]) => [atomId, { ...position }]));
  const atomGrid = buildAtomGrid(layoutGraph, coords, bondLength);
  let nudges = 0;

  for (const centerAtomId of coords.keys()) {
    const descriptor = terminalMultipleBondLeafFanDescriptor(layoutGraph, coords, centerAtomId, frozenAtomIds);
    if (!descriptor) {
      continue;
    }

    const centerPosition = coords.get(descriptor.centerAtomId);
    if (!centerPosition) {
      continue;
    }

    const balancedSupportReliefCoords = terminalMultipleBondBalancedSupportReliefCoords(
      layoutGraph,
      coords,
      descriptor,
      bondLength,
      frozenAtomIds
    );
    if (balancedSupportReliefCoords) {
      for (const [atomId, nextPosition] of balancedSupportReliefCoords) {
        const previousPosition = coords.get(atomId);
        if (
          !previousPosition
          || (
            Math.abs(previousPosition.x - nextPosition.x) <= TIDY_IMPROVEMENT_EPSILON
            && Math.abs(previousPosition.y - nextPosition.y) <= TIDY_IMPROVEMENT_EPSILON
          )
        ) {
          continue;
        }
        atomGrid.remove(atomId, previousPosition);
        atomGrid.insert(atomId, nextPosition);
      }
      coords.clear();
      for (const [atomId, position] of balancedSupportReliefCoords) {
        coords.set(atomId, { ...position });
      }
      nudges++;
      continue;
    }

    let targetPositions = new Map();
    let currentOverlapCount = 0;
    let targetOverlapCount = 0;
    for (const { leafAtomId, targetAngle } of descriptor.leafTargets) {
      const leafPosition = coords.get(leafAtomId);
      if (!leafPosition) {
        targetPositions.clear();
        break;
      }
      const radius = distance(centerPosition, leafPosition);
      if (radius <= TIDY_IMPROVEMENT_EPSILON) {
        targetPositions.clear();
        break;
      }
      targetPositions.set(leafAtomId, add(centerPosition, fromAngle(targetAngle, radius)));
      currentOverlapCount += localSevereOverlapCount(layoutGraph, coords, atomGrid, leafAtomId, leafPosition, threshold);
    }
    if (targetPositions.size !== descriptor.leafTargets.length) {
      continue;
    }
    const exactTargetPositions = new Map(targetPositions);
    const exactCandidateCoords = new Map(coords);
    for (const [leafAtomId, targetPosition] of targetPositions) {
      exactCandidateCoords.set(leafAtomId, targetPosition);
    }
    let usedCompressedTargetPositions = false;
    const exactCandidateAuditOk = auditLayout(layoutGraph, exactCandidateCoords, { bondLength }).ok === true;
    if (!exactCandidateAuditOk) {
      const compressedTargetPositions = compressedTerminalMultipleBondLeafTargetPositions(
        layoutGraph,
        coords,
        descriptor,
        targetPositions,
        bondLength,
        { force: true }
      );
      if (compressedTargetPositions) {
        targetPositions = compressedTargetPositions;
        usedCompressedTargetPositions = true;
      } else {
        const blockerReliefTargetPositions = terminalMultipleBondLeafFanBlockerReliefTargetPositions(
          layoutGraph,
          coords,
          descriptor,
          targetPositions,
          bondLength,
          threshold,
          frozenAtomIds
        );
        if (!blockerReliefTargetPositions) {
          targetPositions = exactTargetPositions;
        } else {
          targetPositions = blockerReliefTargetPositions;
        }
      }
    } else {
      const compressedTargetPositions = compressedTerminalMultipleBondLeafTargetPositions(
        layoutGraph,
        coords,
        descriptor,
        targetPositions,
        bondLength,
        { force: false }
      );
      if (compressedTargetPositions) {
        targetPositions = compressedTargetPositions;
        usedCompressedTargetPositions = true;
      }
    }
    for (const [leafAtomId, targetPosition] of targetPositions) {
      targetOverlapCount += localSevereOverlapCountWithOverrides(
        layoutGraph,
        coords,
        leafAtomId,
        targetPosition,
        targetPositions,
        threshold
      );
    }
    if (targetOverlapCount > currentOverlapCount) {
      continue;
    }

    const candidateCoords = new Map(coords);
    for (const [leafAtomId, targetPosition] of targetPositions) {
      candidateCoords.set(leafAtomId, targetPosition);
    }
    const candidatePenalty = terminalMultipleBondLeafFanPenalty(
      candidateCoords,
      descriptor.centerAtomId,
      descriptor.neighborAtomIds
    );
    const currentLeafClearance = terminalMultipleBondLeafReliefClearance(
      layoutGraph,
      coords,
      descriptor,
      new Map(descriptor.leafTargets.map(({ leafAtomId }) => [leafAtomId, coords.get(leafAtomId)]).filter(([, position]) => !!position))
    );
    const targetLeafClearance = terminalMultipleBondLeafReliefClearance(
      layoutGraph,
      coords,
      descriptor,
      targetPositions
    );
    const compressedClearanceImproves =
      usedCompressedTargetPositions
      && targetLeafClearance > currentLeafClearance + TIDY_IMPROVEMENT_EPSILON
      && candidatePenalty <= descriptor.currentPenalty + TERMINAL_MULTIPLE_BOND_FAN_IMPROVEMENT_EPSILON;
    if (
      compressedClearanceImproves
        ? false
        : usedCompressedTargetPositions
        ? candidatePenalty > descriptor.currentPenalty + TERMINAL_MULTIPLE_BOND_FAN_IMPROVEMENT_EPSILON
        : candidatePenalty >= descriptor.currentPenalty - TERMINAL_MULTIPLE_BOND_FAN_IMPROVEMENT_EPSILON
    ) {
      continue;
    }

    for (const [leafAtomId, targetPosition] of targetPositions) {
      const leafPosition = coords.get(leafAtomId);
      atomGrid.remove(leafAtomId, leafPosition);
      leafPosition.x = targetPosition.x;
      leafPosition.y = targetPosition.y;
      atomGrid.insert(leafAtomId, leafPosition);
    }
    nudges++;
  }

  nudges += runHiddenHydrogenTerminalMultipleBondFanTidy(layoutGraph, coords, bondLength, atomGrid, frozenAtomIds);

  return { coords, nudges };
}

function exactOutwardBlockerReliefCandidates(layoutGraph, coords, descriptor, ringPolygons, currentAngle, radius, threshold, searchRadius, bondLength) {
  if (!descriptor.prefersOutwardGeometry || descriptor.outwardAngles.length === 0) {
    return [];
  }

  const anchorPosition = coords.get(descriptor.anchorAtomId);
  if (!anchorPosition) {
    return [];
  }

  const candidates = [];
  for (const outwardAngle of descriptor.outwardAngles) {
    const outwardPosition = add(anchorPosition, fromAngle(outwardAngle, radius));
    const outwardOverrides = terminalHeteroMoveOverrides(descriptor, outwardPosition, outwardAngle, bondLength);
    const exactCoords = new Map(coords);
    for (const [atomId, position] of outwardOverrides) {
      exactCoords.set(atomId, position);
    }

    const blockingAtomIds = [];
    for (const [atomId, atomPosition] of coords) {
      if (
        atomId === descriptor.heteroAtomId
        || layoutGraph.bondedPairSet.has(atomPairKey(descriptor.heteroAtomId, atomId))
        || distance(atomPosition, outwardPosition) >= threshold
      ) {
        continue;
      }
      blockingAtomIds.push(atomId);
    }

    for (const blockingAtomId of blockingAtomIds) {
      const blockerDescriptor = terminalMultipleBondBlockerDescriptor(layoutGraph, coords, blockingAtomId);
      if (!blockerDescriptor) {
        continue;
      }

      const centerPosition = coords.get(blockerDescriptor.centerAtomId);
      const blockerPosition = coords.get(blockerDescriptor.blockerAtomId);
      if (!centerPosition || !blockerPosition) {
        continue;
      }
      const blockerRadius = distance(centerPosition, blockerPosition) || bondLength;
      const blockerAngle = angleOf(sub(blockerPosition, centerPosition));
      for (const reliefOffset of TERMINAL_HETERO_BLOCKER_RELIEF_OFFSETS) {
        const candidateCoords = new Map(exactCoords);
        const candidateBlockerPosition = add(centerPosition, fromAngle(blockerAngle + reliefOffset, blockerRadius));
        candidateCoords.set(blockerDescriptor.blockerAtomId, candidateBlockerPosition);
        const blockerCenterDeviation = threeHeavyCenterMaxDeviation(
          candidateCoords,
          blockerDescriptor.centerAtomId,
          blockerDescriptor.heavyNeighborIds
        );
        if (blockerCenterDeviation > TERMINAL_HETERO_BLOCKER_MAX_CENTER_DEVIATION + TIDY_IMPROVEMENT_EPSILON) {
          continue;
        }

        const candidateGrid = buildAtomGrid(layoutGraph, candidateCoords, bondLength);
        candidates.push({
          ...scoreTerminalHeteroPosition(
            layoutGraph,
            candidateCoords,
            descriptor,
            candidateGrid,
            ringPolygons,
            outwardPosition,
            outwardAngle,
            currentAngle,
            threshold,
            searchRadius
          ),
          blockerCenterDeviation,
          blockerCenterMaxSeparation: threeHeavyCenterMaxSeparation(
            candidateCoords,
            blockerDescriptor.centerAtomId,
            blockerDescriptor.heavyNeighborIds
          ),
          overridePositions: new Map([
            ...outwardOverrides,
            [blockerDescriptor.blockerAtomId, candidateBlockerPosition]
          ])
        });
      }
    }
  }
  return candidates;
}

function terminalRingHeteros(layoutGraph, coords) {
  const descriptors = [];
  const seenPairs = new Set();

  for (const bond of layoutGraph.bonds?.values?.() ?? []) {
    if (!bond || bond.kind !== 'covalent' || bond.aromatic) {
      continue;
    }

    for (const [anchorAtomId, heteroAtomId] of [
      [bond.a, bond.b],
      [bond.b, bond.a]
    ]) {
      const anchorAtom = layoutGraph.atoms.get(anchorAtomId);
      const heteroAtom = layoutGraph.atoms.get(heteroAtomId);
      if (!anchorAtom || !heteroAtom || heteroAtom.element === 'H' || heteroAtom.element === 'C') {
        continue;
      }
      if ((layoutGraph.atomToRings.get(anchorAtomId)?.length ?? 0) === 0 || (layoutGraph.atomToRings.get(heteroAtomId)?.length ?? 0) > 0) {
        continue;
      }
      if (!coords.has(anchorAtomId) || !coords.has(heteroAtomId) || (heteroAtom.heavyDegree ?? 0) !== 1) {
        continue;
      }
      const bondOrder = bond.order ?? 1;
      const prefersOutwardGeometry =
        bondOrder === 1
        && SINGLE_BOND_TERMINAL_HETERO_ELEMENTS.has(heteroAtom.element);
      const sourceAnchorAtom = layoutGraph.sourceMolecule?.atoms?.get?.(anchorAtomId) ?? null;
      if (prefersOutwardGeometry && (anchorAtom.chirality != null || sourceAnchorAtom?.chirality != null)) {
        continue;
      }
      if (prefersOutwardGeometry && isSaturatedBridgeheadTerminalHeteroAnchor(layoutGraph, anchorAtomId, anchorAtom)) {
        continue;
      }
      if (!prefersOutwardGeometry && bondOrder < 2) {
        continue;
      }

      const pairKey = atomPairKey(anchorAtomId, heteroAtomId);
      if (seenPairs.has(pairKey)) {
        continue;
      }
      seenPairs.add(pairKey);
      const smallRingExteriorAngles = smallRingExteriorTerminalHeteroAngles(layoutGraph, coords, anchorAtomId, heteroAtomId);
      const outwardAngles = prefersOutwardGeometry
        ? (smallRingExteriorAngles.length > 0 ? smallRingExteriorAngles : outwardAnglesForAnchor(layoutGraph, coords, anchorAtomId))
        : [];
      descriptors.push({
        anchorAtomId,
        heteroAtomId,
        hydrogenAtomIds: terminalHeteroHydrogenAtomIds(layoutGraph, coords, heteroAtomId),
        prefersOutwardGeometry,
        outwardAngles
      });
    }
  }

  return descriptors;
}

/**
 * Returns whether terminal ring hetero cleanup has a meaningful presentation
 * opportunity in the current layout.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Coordinate map.
 * @param {object} [options] - Hook options.
 * @param {number} [options.bondLength] - Target bond length.
 * @returns {boolean} True when the terminal hetero pass should run.
 */
export function hasRingTerminalHeteroTidyNeed(layoutGraph, coords, options = {}) {
  if (!(coords instanceof Map)) {
    return false;
  }

  const bondLength = options.bondLength ?? layoutGraph.options.bondLength;
  const threshold = bondLength * 0.55;
  const atomGrid = buildAtomGrid(layoutGraph, coords, bondLength);
  for (const descriptor of terminalRingHeteros(layoutGraph, coords)) {
    const anchorPosition = coords.get(descriptor.anchorAtomId);
    const currentPosition = coords.get(descriptor.heteroAtomId);
    if (!anchorPosition || !currentPosition) {
      continue;
    }
    const currentAngle = angleOf(sub(currentPosition, anchorPosition));
    if (
      descriptor.prefersOutwardGeometry
      && descriptor.outwardAngles.length > 0
      && Math.min(...descriptor.outwardAngles.map(outwardAngle => angularDifference(outwardAngle, currentAngle))) > TERMINAL_HETERO_OUTWARD_NEED_TRIGGER
    ) {
      return true;
    }
    if (countPointInPolygons(incidentRingPolygons(layoutGraph, coords, descriptor.anchorAtomId), currentPosition) > 0) {
      return true;
    }
    if (localSevereOverlapCount(layoutGraph, coords, atomGrid, descriptor.heteroAtomId, currentPosition, threshold) > 0) {
      return true;
    }
  }
  return false;
}

/**
 * Measures terminal heteroatom deviation from exact ring-outward presentation.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Coordinate map.
 * @returns {{totalDeviation: number, maxDeviation: number}} Aggregate outward deviation.
 */
export function measureRingTerminalHeteroOutwardPenalty(layoutGraph, coords) {
  let totalDeviation = 0;
  let maxDeviation = 0;
  if (!(coords instanceof Map)) {
    return { totalDeviation, maxDeviation };
  }

  for (const descriptor of terminalRingHeteros(layoutGraph, coords)) {
    if (!descriptor.prefersOutwardGeometry || descriptor.outwardAngles.length === 0) {
      continue;
    }
    const anchorPosition = coords.get(descriptor.anchorAtomId);
    const currentPosition = coords.get(descriptor.heteroAtomId);
    if (!anchorPosition || !currentPosition) {
      continue;
    }
    const currentAngle = angleOf(sub(currentPosition, anchorPosition));
    const deviation = Math.min(...descriptor.outwardAngles.map(outwardAngle => angularDifference(outwardAngle, currentAngle)));
    totalDeviation += deviation;
    maxDeviation = Math.max(maxDeviation, deviation);
  }

  return { totalDeviation, maxDeviation };
}

/**
 * Measures local fan distortion for trigonal centers with one or two terminal
 * multiple-bond hetero leaves.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Coordinate map.
 * @returns {{totalDeviation: number, maxDeviation: number}} Aggregate fan penalty.
 */
export function measureTerminalMultipleBondLeafFanPenalty(layoutGraph, coords) {
  let totalDeviation = 0;
  let maxDeviation = 0;
  if (!(coords instanceof Map)) {
    return { totalDeviation, maxDeviation };
  }

  for (const centerAtomId of coords.keys()) {
    const centerAtom = layoutGraph.atoms.get(centerAtomId);
    const centerPosition = coords.get(centerAtomId);
    if (!centerAtom || centerAtom.element === 'H' || centerAtom.aromatic || !centerPosition) {
      continue;
    }

    const heavyBonds = visibleHeavyCovalentBonds(layoutGraph, coords, centerAtomId);
    if (heavyBonds.length !== 3) {
      continue;
    }
    const terminalMultipleBondLeaves = heavyBonds.filter(({ bond, neighborAtomId }) => {
      const neighborAtom = layoutGraph.atoms.get(neighborAtomId);
      return (
        !bond.aromatic
        && (bond.order ?? 1) >= 2
        && neighborAtom
        && neighborAtom.element !== 'C'
        && neighborAtom.heavyDegree === 1
      );
    });
    if (terminalMultipleBondLeaves.length !== 1 && terminalMultipleBondLeaves.length !== 2) {
      continue;
    }

    const leafAtomIds = new Set(terminalMultipleBondLeaves.map(({ neighborAtomId }) => neighborAtomId));
    const fixedNeighborPositions = heavyBonds
      .map(({ neighborAtomId }) => neighborAtomId)
      .filter(neighborAtomId => !leafAtomIds.has(neighborAtomId))
      .map(neighborAtomId => coords.get(neighborAtomId))
      .filter(Boolean);
    if (fixedNeighborPositions.length !== 3 - terminalMultipleBondLeaves.length) {
      continue;
    }
    if (terminalMultipleBondLeaves.length === 1) {
      const fixedNeighborAngles = fixedNeighborPositions.map(position => angleOf(sub(position, centerPosition)));
      if (
        Math.abs(angularDifference(fixedNeighborAngles[0], fixedNeighborAngles[1]) - Math.PI)
          <= TERMINAL_MULTIPLE_BOND_LINEAR_NEIGHBOR_TOLERANCE
      ) {
        continue;
      }
    }

    const neighborAtomIds = heavyBonds.map(({ neighborAtomId }) => neighborAtomId);
    const penalty = terminalMultipleBondLeafFanPenalty(coords, centerAtomId, neighborAtomIds);
    if (!Number.isFinite(penalty)) {
      continue;
    }
    totalDeviation += penalty;
    maxDeviation = Math.max(maxDeviation, penalty);
  }

  for (const centerAtomId of coords.keys()) {
    const descriptor = hiddenHydrogenTerminalMultipleBondFanDescriptor(layoutGraph, coords, centerAtomId);
    if (!descriptor) {
      continue;
    }
    totalDeviation += descriptor.currentPenalty;
    maxDeviation = Math.max(maxDeviation, descriptor.currentPenalty);
  }

  return { totalDeviation, maxDeviation };
}

function terminalMultipleBondSupportFanDescriptor(layoutGraph, coords, centerAtomId) {
  const centerAtom = layoutGraph.atoms.get(centerAtomId);
  if (!centerAtom || centerAtom.element === 'H' || centerAtom.aromatic || !coords.has(centerAtomId)) {
    return null;
  }

  const heavyBonds = visibleHeavyCovalentBonds(layoutGraph, coords, centerAtomId);
  if (heavyBonds.length !== 3) {
    return null;
  }

  const terminalMultipleBondLeaves = heavyBonds.filter(({ bond, neighborAtomId }) => {
    const neighborAtom = layoutGraph.atoms.get(neighborAtomId);
    return (
      !bond.aromatic
      && (bond.order ?? 1) >= 2
      && neighborAtom
      && neighborAtom.element !== 'C'
      && neighborAtom.heavyDegree === 1
    );
  });
  if (terminalMultipleBondLeaves.length !== 1) {
    return null;
  }

  const supportBonds = heavyBonds.filter(({ neighborAtomId }) => neighborAtomId !== terminalMultipleBondLeaves[0].neighborAtomId);
  if (
    supportBonds.length !== 2
    || supportBonds.some(({ bond }) => bond.aromatic || bond.inRing || (bond.order ?? 1) !== 1)
  ) {
    return null;
  }

  return {
    centerAtomId,
    leafAtomId: terminalMultipleBondLeaves[0].neighborAtomId,
    neighborAtomIds: heavyBonds.map(({ neighborAtomId }) => neighborAtomId),
    supportBonds
  };
}

function compareSupportFanCandidates(candidate, incumbent) {
  if (!incumbent) {
    return -1;
  }
  if (Math.abs(candidate.maxSeparation - incumbent.maxSeparation) > TIDY_IMPROVEMENT_EPSILON) {
    return candidate.maxSeparation - incumbent.maxSeparation;
  }
  if (Math.abs(candidate.fanPenalty - incumbent.fanPenalty) > TERMINAL_MULTIPLE_BOND_FAN_IMPROVEMENT_EPSILON) {
    return candidate.fanPenalty - incumbent.fanPenalty;
  }
  if (Math.abs(candidate.minSeparation - incumbent.minSeparation) > TIDY_IMPROVEMENT_EPSILON) {
    return incumbent.minSeparation - candidate.minSeparation;
  }
  return candidate.rotationMagnitude - incumbent.rotationMagnitude;
}

function boundTerminalMultipleBondSupportFans(layoutGraph, coords, bondLength) {
  let nudges = 0;

  for (const centerAtomId of coords.keys()) {
    const descriptor = terminalMultipleBondSupportFanDescriptor(layoutGraph, coords, centerAtomId);
    if (!descriptor) {
      continue;
    }

    const currentSupportAngles = descriptor.supportBonds.map(({ neighborAtomId }) =>
      angleOf(sub(coords.get(neighborAtomId), coords.get(descriptor.centerAtomId)))
    );
    const currentSupportSeparation = angularDifference(currentSupportAngles[0], currentSupportAngles[1]);
    if (currentSupportSeparation <= TERMINAL_MULTIPLE_BOND_SUPPORT_MAX_SEPARATION + TIDY_IMPROVEMENT_EPSILON) {
      continue;
    }

    const currentMaxSeparation = threeHeavyCenterMaxSeparation(coords, descriptor.centerAtomId, descriptor.neighborAtomIds);
    const currentFanPenalty = terminalMultipleBondLeafFanPenalty(coords, descriptor.centerAtomId, descriptor.neighborAtomIds);
    const targetReduction = Math.min(
      currentSupportSeparation - TERMINAL_MULTIPLE_BOND_SUPPORT_MAX_SEPARATION,
      TERMINAL_MULTIPLE_BOND_SUPPORT_MAX_ROTATION
    );
    let bestCandidate = null;

    for (const { neighborAtomId: supportAtomId } of descriptor.supportBonds) {
      const supportAtom = layoutGraph.atoms.get(supportAtomId);
      if (!supportAtom || supportAtom.element === 'H' || (layoutGraph.atomToRings.get(supportAtomId)?.length ?? 0) === 0) {
        continue;
      }

      const otherSupportAtomId = descriptor.supportBonds
        .map(({ neighborAtomId }) => neighborAtomId)
        .find(neighborAtomId => neighborAtomId !== supportAtomId);
      const movedAtomIds = collectCovalentSubtreeAtomIds(layoutGraph, supportAtomId, descriptor.centerAtomId)
        .filter(atomId => coords.has(atomId));
      if (
        movedAtomIds.length === 0
        || movedAtomIds.includes(descriptor.leafAtomId)
        || movedAtomIds.includes(otherSupportAtomId)
        || heavyAtomCountInIds(layoutGraph, movedAtomIds) > TERMINAL_MULTIPLE_BOND_SUPPORT_SUBTREE_HEAVY_LIMIT
      ) {
        continue;
      }

      for (const rotationOffset of [targetReduction, -targetReduction]) {
        const candidateCoords = rotateAtomIdsAroundPivot(coords, movedAtomIds, descriptor.centerAtomId, rotationOffset);
        if (!candidateCoords) {
          continue;
        }
        const maxSeparation = threeHeavyCenterMaxSeparation(candidateCoords, descriptor.centerAtomId, descriptor.neighborAtomIds);
        const minSeparation = threeHeavyCenterMinSeparation(candidateCoords, descriptor.centerAtomId, descriptor.neighborAtomIds);
        const fanPenalty = terminalMultipleBondLeafFanPenalty(candidateCoords, descriptor.centerAtomId, descriptor.neighborAtomIds);
        if (
          maxSeparation >= currentMaxSeparation - TIDY_IMPROVEMENT_EPSILON
          || maxSeparation > TERMINAL_MULTIPLE_BOND_SUPPORT_MAX_SEPARATION + TIDY_IMPROVEMENT_EPSILON
          || minSeparation < TERMINAL_MULTIPLE_BOND_SUPPORT_MIN_SEPARATION - TIDY_IMPROVEMENT_EPSILON
          || fanPenalty >= currentFanPenalty - TERMINAL_MULTIPLE_BOND_FAN_IMPROVEMENT_EPSILON
        ) {
          continue;
        }
        const candidateAudit = auditLayout(layoutGraph, candidateCoords, { bondLength });
        if (candidateAudit.ok !== true) {
          continue;
        }
        const candidate = {
          coords: candidateCoords,
          maxSeparation,
          minSeparation,
          fanPenalty,
          rotationMagnitude: Math.abs(rotationOffset)
        };
        if (compareSupportFanCandidates(candidate, bestCandidate) < 0) {
          bestCandidate = candidate;
        }
      }
    }

    if (bestCandidate) {
      for (const [atomId, position] of bestCandidate.coords) {
        coords.set(atomId, position);
      }
      nudges++;
    }
  }

  return nudges;
}

function isBetterTidyCandidate(candidate, incumbent) {
  if (!incumbent) {
    return true;
  }
  if (candidate.overlapCount !== incumbent.overlapCount) {
    return candidate.overlapCount < incumbent.overlapCount;
  }
  if (candidate.insideRingCount !== incumbent.insideRingCount) {
    return candidate.insideRingCount < incumbent.insideRingCount;
  }
  if (
    candidate.prefersOutwardGeometry
    && Math.abs(candidate.outwardDeviation - incumbent.outwardDeviation) > TIDY_IMPROVEMENT_EPSILON
  ) {
    return candidate.outwardDeviation < incumbent.outwardDeviation;
  }
  if (
    Number.isFinite(candidate.blockerCenterDeviation)
    && Number.isFinite(incumbent.blockerCenterDeviation)
    && Math.abs(candidate.blockerCenterDeviation - incumbent.blockerCenterDeviation) > TIDY_IMPROVEMENT_EPSILON
  ) {
    return candidate.blockerCenterDeviation < incumbent.blockerCenterDeviation;
  }
  if (
    Number.isFinite(candidate.blockerCenterMaxSeparation)
    && Number.isFinite(incumbent.blockerCenterMaxSeparation)
    && Math.abs(candidate.blockerCenterMaxSeparation - incumbent.blockerCenterMaxSeparation) > TIDY_IMPROVEMENT_EPSILON
  ) {
    return candidate.blockerCenterMaxSeparation < incumbent.blockerCenterMaxSeparation;
  }
  if (candidate.clearance > incumbent.clearance + TIDY_IMPROVEMENT_EPSILON) {
    return true;
  }
  if (Math.abs(candidate.clearance - incumbent.clearance) <= TIDY_IMPROVEMENT_EPSILON) {
    return candidate.angleDelta < incumbent.angleDelta - TIDY_IMPROVEMENT_EPSILON;
  }
  return false;
}

/**
 * Rotates terminal multiple-bond hetero atoms attached directly to ring atoms
 * onto less crowded bond-length preserving slots after cleanup.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} inputCoords - Coordinate map.
 * @param {object} [options] - Hook options.
 * @param {number} [options.bondLength] - Target bond length.
 * @returns {{coords: Map<string, {x: number, y: number}>, nudges: number}} Adjusted coordinates and move count.
 */
export function runRingTerminalHeteroTidy(layoutGraph, inputCoords, options = {}) {
  const bondLength = options.bondLength ?? layoutGraph.options.bondLength;
  const threshold = bondLength * 0.55;
  const searchRadius = bondLength * 4;
  const coords = new Map([...inputCoords.entries()].map(([atomId, position]) => [atomId, { ...position }]));
  const atomGrid = buildAtomGrid(layoutGraph, coords, bondLength);
  let nudges = 0;

  for (const descriptor of terminalRingHeteros(layoutGraph, coords)) {
    const anchorPosition = coords.get(descriptor.anchorAtomId);
    const currentPosition = coords.get(descriptor.heteroAtomId);
    if (!anchorPosition || !currentPosition) {
      continue;
    }

    const radius = distance(anchorPosition, currentPosition);
    if (radius <= TIDY_IMPROVEMENT_EPSILON) {
      continue;
    }

    const ringPolygons = incidentRingPolygons(layoutGraph, coords, descriptor.anchorAtomId);
    const currentAngle = angleOf(sub(currentPosition, anchorPosition));
    const currentCandidate = {
      ...scoreTerminalHeteroPosition(
        layoutGraph,
        coords,
        descriptor,
        atomGrid,
        ringPolygons,
        currentPosition,
        currentAngle,
        currentAngle,
        threshold,
        searchRadius
      ),
      angleDelta: 0
    };
    const candidateAngles = new Set(STANDARD_ROTATION_ANGLES);
    for (const angle of descriptor.outwardAngles) { candidateAngles.add(angle); }
    const candidateSearch = visitPresentationDescriptorCandidates(layoutGraph, coords, {
      anchorAtomId: descriptor.anchorAtomId,
      rootAtomId: descriptor.heteroAtomId,
      subtreeAtomIds: [descriptor.heteroAtomId]
    }, {
      generateSeeds: () => [...candidateAngles],
      materializeOverrides(_coords, _rotationDescriptor, candidateAngle) {
        return terminalHeteroMoveOverrides(
          descriptor,
          add(anchorPosition, fromAngle(candidateAngle, radius)),
          candidateAngle,
          bondLength
        );
      },
      scoreSeed(_rotationDescriptor, _candidateCoords, candidateAngle, _context, overridePositions) {
        const candidatePosition = overridePositions.get(descriptor.heteroAtomId);
        if (!candidatePosition) {
          return null;
        }
        return {
          ...scoreTerminalHeteroPosition(
            layoutGraph,
            coords,
            descriptor,
            atomGrid,
            ringPolygons,
            candidatePosition,
            candidateAngle,
            currentAngle,
            threshold,
            searchRadius
          ),
          overridePositions
        };
      },
      isBetterScore: isBetterTidyCandidate
    });
    let bestCandidate = candidateSearch.bestFinalCandidate?.score ?? currentCandidate;
    for (const reliefCandidate of exactOutwardBlockerReliefCandidates(
      layoutGraph,
      coords,
      descriptor,
      ringPolygons,
      currentAngle,
      radius,
      threshold,
      searchRadius,
      bondLength
    )) {
      if (isBetterTidyCandidate(reliefCandidate, bestCandidate)) {
        bestCandidate = reliefCandidate;
      }
    }

    const improvesOverlapCount = bestCandidate.overlapCount < currentCandidate.overlapCount;
    const improvesInsideRing = bestCandidate.insideRingCount < currentCandidate.insideRingCount;
    const improvesClearance = bestCandidate.clearance > currentCandidate.clearance + TIDY_IMPROVEMENT_EPSILON;
    const improvesOutwardGeometry =
      descriptor.prefersOutwardGeometry
      && bestCandidate.outwardDeviation < currentCandidate.outwardDeviation - TIDY_IMPROVEMENT_EPSILON;
    if (!improvesInsideRing && !improvesOverlapCount && !improvesClearance && !improvesOutwardGeometry) {
      continue;
    }

    const overridePositions = bestCandidate.overridePositions instanceof Map
      ? bestCandidate.overridePositions
      : new Map([[descriptor.heteroAtomId, bestCandidate.position]]);
    for (const [atomId, nextPosition] of overridePositions) {
      const previousPosition = coords.get(atomId);
      if (!previousPosition) {
        continue;
      }
      atomGrid.remove(atomId, previousPosition);
      previousPosition.x = nextPosition.x;
      previousPosition.y = nextPosition.y;
      atomGrid.insert(atomId, previousPosition);
    }
    nudges++;
  }

  nudges += boundTerminalMultipleBondSupportFans(layoutGraph, coords, bondLength);

  return { coords, nudges };
}

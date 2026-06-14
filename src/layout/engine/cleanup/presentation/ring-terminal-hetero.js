/** @module cleanup/presentation/ring-terminal-hetero */

import { buildAtomGrid } from '../../audit/invariants.js';
import { auditCandidateSafety, auditLayout } from '../../audit/audit.js';
import { countPointInPolygons } from '../../geometry/polygon.js';
import { incidentRingPolygonsForAtom } from '../../geometry/ring-polygons.js';
import { reflectAcrossLine } from '../../geometry/transforms.js';
import { add, angleOf, angularDifference, centroid, distance, fromAngle, rotate, sub, wrapAngle } from '../../geometry/vec2.js';
import { visitPresentationDescriptorCandidates } from '../candidate-search.js';
import { atomPairKey } from '../../constants.js';
import { collectRigidPendantRingSubtrees } from '../overlap-resolution.js';
import { rotateRigidDescriptorPositions } from '../rigid-rotation.js';
import { runUnifiedCleanup } from '../unified-cleanup.js';
import { STANDARD_ROTATION_ANGLES } from '../rotation-candidates.js';
import { smallRingExteriorTargetAngles, supportsExteriorBranchSpreadRingSize } from '../../placement/branch-placement.js';
import { isExactVisibleTrigonalBisectorEligible } from '../../placement/branch-placement/angle-selection.js';
import { visibleHeavyCovalentBonds } from '../bond-utils.js';
const TIDY_IMPROVEMENT_EPSILON = 1e-6;
const SINGLE_BOND_TERMINAL_HETERO_ELEMENTS = new Set(['O', 'S', 'Se']);
const TERMINAL_HETERO_OUTWARD_NEED_TRIGGER = Math.PI / 9;
const TERMINAL_HETERO_BOND_LENGTH_NEED_FACTOR = 0.02;
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
const TERMINAL_MULTIPLE_BOND_ACYCLIC_SUPPORT_HEAVY_LIMIT = 18;
const TERMINAL_MULTIPLE_BOND_LARGE_SUPPORT_HEAVY_LIMIT = 40;
const TERMINAL_MULTIPLE_BOND_LARGE_SUPPORT_MIN_COORDS = 80;
const TERMINAL_MULTIPLE_BOND_PROTECTED_SUPPORT_REFLECTION_HEAVY_LIMIT = 24;
const TERMINAL_MULTIPLE_BOND_LEAF_COMPRESSION_FACTORS = Object.freeze(Array.from({ length: 111 }, (_value, index) => 0.95 - index * 0.005));
const TERMINAL_MULTIPLE_BOND_LEAF_COMPRESSION_TRIGGER_FACTOR = 1.05;
const TERMINAL_MULTIPLE_BOND_LEAF_COMPRESSION_TARGET_FACTOR = 1.25;
const TERMINAL_MULTIPLE_BOND_LEAF_FORCE_CLEARANCE_FACTOR = 0.6;
const TERMINAL_MULTIPLE_BOND_LEAF_CROWDING_FACTOR = TERMINAL_MULTIPLE_BOND_LEAF_FORCE_CLEARANCE_FACTOR;
const TERMINAL_MULTIPLE_BOND_BLOCKER_RELIEF_CLEARANCE_FACTOR = 0.95;
const TERMINAL_MULTIPLE_BOND_BLOCKER_RELIEF_ROTATIONS = Object.freeze([5, 10, 15, 20, 25, 30, 45, 60, 75, 90].flatMap(degrees => [-(degrees * Math.PI) / 180, (degrees * Math.PI) / 180]));
const TERMINAL_MULTIPLE_BOND_LEAF_BACKOFF_ROTATIONS = Object.freeze([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 15].flatMap(degrees => [(degrees * Math.PI) / 180, -(degrees * Math.PI) / 180]));
const TERMINAL_MULTIPLE_BOND_CENTER_BRANCH_RELIEF_ROTATIONS = Object.freeze([
  0,
  ...Array.from({ length: 45 }, (_value, index) => index + 1).flatMap(degrees => [-(degrees * Math.PI) / 180, (degrees * Math.PI) / 180])
]);
const TERMINAL_MULTIPLE_BOND_CENTER_BRANCH_MAX_ANCHOR_DEVIATION = Math.PI / 6;
const TERMINAL_MULTIPLE_BOND_LEAF_PARTIAL_FAN_FRACTIONS = Object.freeze([0.1, 0.15, 0.2, 0.225, 0.24, 0.245, 1 / 3, 0.5, 2 / 3, 0.75, 0.85]);
const HIDDEN_H_MULTIPLE_BOND_VISIBLE_ANGLE = (2 * Math.PI) / 3;
const TERMINAL_MULTIPLE_BOND_BALANCED_FAN_TOLERANCE = Math.PI / 15;
const RING_EMBEDDED_BIS_OXO_CROSS_SINGLE_TOLERANCE = Math.PI / 6;
const RING_EMBEDDED_BIS_OXO_CROSS_MIN_OXO_SEPARATION = (5 * Math.PI) / 6;

function incidentRingPolygons(layoutGraph, coords, anchorAtomId) {
  return incidentRingPolygonsForAtom(layoutGraph, coords, anchorAtomId);
}

function outwardAnglesForAnchor(layoutGraph, coords, anchorAtomId) {
  const anchorPosition = coords.get(anchorAtomId);
  if (!anchorPosition) {
    return [];
  }
  return incidentRingPolygons(layoutGraph, coords, anchorAtomId).map(polygon => angleOf(sub(anchorPosition, centroid(polygon))));
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

  return [angularDifference(otherExocyclicAngle, targetAngles[0]) <= angularDifference(otherExocyclicAngle, targetAngles[1]) ? targetAngles[1] : targetAngles[0]];
}

function localNonbondedClearance(layoutGraph, coords, atomGrid, atomId, position, searchRadius) {
  let minimumDistance = searchRadius;
  atomGrid.forEachRadius(position, searchRadius, otherAtomId => {
    if (otherAtomId === atomId || layoutGraph.bondedPairSet.has(atomPairKey(atomId, otherAtomId))) {
      return;
    }
    const otherPosition = coords.get(otherAtomId);
    if (!otherPosition) {
      return;
    }
    minimumDistance = Math.min(minimumDistance, Math.hypot(position.x - otherPosition.x, position.y - otherPosition.y));
  });
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
  atomGrid.forEachRadius(position, threshold, otherAtomId => {
    if (otherAtomId === atomId || layoutGraph.bondedPairSet.has(atomPairKey(atomId, otherAtomId))) {
      return;
    }
    const otherPosition = coords.get(otherAtomId);
    if (!otherPosition) {
      return;
    }
    if (Math.hypot(position.x - otherPosition.x, position.y - otherPosition.y) < threshold) {
      overlapCount++;
    }
  });
  return overlapCount;
}

function terminalMultipleBondBlockerDescriptor(layoutGraph, coords, atomId) {
  const atom = layoutGraph.atoms.get(atomId);
  if (!atom || atom.element === 'C' || atom.element === 'H' || atom.aromatic || atom.heavyDegree !== 1 || !coords.has(atomId)) {
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
  return heavyNeighborIds.length === 3 ? { centerAtomId, blockerAtomId: atomId, heavyNeighborIds } : null;
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
      maxDeviation = Math.max(maxDeviation, Math.abs(angularDifference(neighborAngles[firstIndex], neighborAngles[secondIndex]) - (2 * Math.PI) / 3));
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
      maxSeparation = Math.max(maxSeparation, angularDifference(neighborAngles[firstIndex], neighborAngles[secondIndex]));
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
      minSeparation = Math.min(minSeparation, angularDifference(neighborAngles[firstIndex], neighborAngles[secondIndex]));
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

function terminalMultipleBondLeafFanPenaltyFromAngles(angles) {
  if (angles.length !== 3) {
    return Number.POSITIVE_INFINITY;
  }
  const sortedAngles = [...angles].sort((firstAngle, secondAngle) => firstAngle - secondAngle);
  const separations = sortedAngles.map((angle, index) => {
    const nextAngle = sortedAngles[(index + 1) % sortedAngles.length];
    return index === sortedAngles.length - 1 ? nextAngle + Math.PI * 2 - angle : nextAngle - angle;
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
  const angle = angularDifference(angleOf(sub(firstPosition, centerPosition)), angleOf(sub(secondPosition, centerPosition)));
  return (angle - HIDDEN_H_MULTIPLE_BOND_VISIBLE_ANGLE) ** 2;
}

function hiddenHydrogenTerminalMultipleBondFanDescriptor(layoutGraph, coords, centerAtomId, frozenAtomIds = null) {
  const centerAtom = layoutGraph.atoms.get(centerAtomId);
  if (!centerAtom || centerAtom.element !== 'C' || centerAtom.aromatic || centerAtom.heavyDegree !== 2 || centerAtom.degree !== 3 || !coords.has(centerAtomId)) {
    return null;
  }

  const heavyBonds = visibleHeavyCovalentBonds(layoutGraph, coords, centerAtomId);
  if (heavyBonds.length !== 2) {
    return null;
  }
  const multipleBond = heavyBonds.find(({ bond, neighborAtomId }) => {
    const neighborAtom = layoutGraph.atoms.get(neighborAtomId);
    return (
      !bond.aromatic && (bond.order ?? 1) >= 2 && neighborAtom && neighborAtom.element !== 'H' && neighborAtom.heavyDegree === 1 && !(frozenAtomIds instanceof Set && frozenAtomIds.has(neighborAtomId))
    );
  });
  if (!multipleBond) {
    return null;
  }
  const supportBond = heavyBonds.find(({ neighborAtomId }) => neighborAtomId !== multipleBond.neighborAtomId);
  if (!supportBond || supportBond.bond.aromatic || (supportBond.bond.order ?? 1) !== 1) {
    return null;
  }

  const currentPenalty = hiddenHydrogenMultipleBondVisiblePenalty(coords, centerAtomId, supportBond.neighborAtomId, multipleBond.neighborAtomId);
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
  const candidates = [supportAngle + HIDDEN_H_MULTIPLE_BOND_VISIBLE_ANGLE, supportAngle - HIDDEN_H_MULTIPLE_BOND_VISIBLE_ANGLE];
  return candidates.sort((firstAngle, secondAngle) => angularDifference(firstAngle, leafAngle) - angularDifference(secondAngle, leafAngle))[0];
}

function terminalMultipleBondFanStructuralCenterIds(layoutGraph) {
  if (Array.isArray(layoutGraph._terminalMultipleBondFanStructuralCenterIds)) {
    return layoutGraph._terminalMultipleBondFanStructuralCenterIds;
  }
  const centerIds = [];
  for (const [centerAtomId, centerAtom] of layoutGraph.atoms) {
    if (!centerAtom || centerAtom.element === 'H' || centerAtom.aromatic) {
      continue;
    }
    let heavyBondCount = 0;
    let terminalHeteroMultipleLeafCount = 0;
    let terminalAnyMultipleLeafCount = 0;
    for (const bond of layoutGraph.bondsByAtomId.get(centerAtomId) ?? []) {
      if (!bond || bond.kind !== 'covalent') {
        continue;
      }
      const neighborAtomId = bond.a === centerAtomId ? bond.b : bond.a;
      const neighborAtom = layoutGraph.atoms.get(neighborAtomId);
      if (!neighborAtom || neighborAtom.element === 'H') {
        continue;
      }
      heavyBondCount++;
      if (!bond.aromatic && (bond.order ?? 1) >= 2 && neighborAtom.heavyDegree === 1) {
        terminalAnyMultipleLeafCount++;
        if (neighborAtom.element !== 'C') {
          terminalHeteroMultipleLeafCount++;
        }
      }
    }
    const hasVisibleFan = heavyBondCount === 3 && (terminalHeteroMultipleLeafCount === 1 || terminalHeteroMultipleLeafCount === 2);
    const hasHiddenHydrogenFan = centerAtom.element === 'C' && centerAtom.heavyDegree === 2 && centerAtom.degree === 3 && heavyBondCount === 2 && terminalAnyMultipleLeafCount > 0;
    if (hasVisibleFan || hasHiddenHydrogenFan) {
      centerIds.push(centerAtomId);
    }
  }
  layoutGraph._terminalMultipleBondFanStructuralCenterIds = centerIds;
  return centerIds;
}

function terminalMultipleBondLeafBackoffVariants(layoutGraph, coords, descriptor, bondLength, frozenAtomIds) {
  const variants = [];
  for (const { leafAtomId } of descriptor.leafTargets) {
    const leafAtomIds = collectCovalentSubtreeAtomIds(layoutGraph, leafAtomId, descriptor.centerAtomId).filter(atomId => coords.has(atomId));
    if (leafAtomIds.length === 0 || (frozenAtomIds instanceof Set && leafAtomIds.some(atomId => frozenAtomIds.has(atomId)))) {
      continue;
    }
    for (const rotation of TERMINAL_MULTIPLE_BOND_LEAF_BACKOFF_ROTATIONS) {
      const candidateCoords = rotateAtomIdsAroundPivot(coords, leafAtomIds, descriptor.centerAtomId, rotation);
      if (!candidateCoords || auditCandidateSafety(layoutGraph, candidateCoords, { bondLength }).ok !== true) {
        continue;
      }
      variants.push(candidateCoords);
    }
  }
  return variants;
}

function terminalMultipleBondLeafMinimumClearance(layoutGraph, coords, descriptor) {
  let minimumClearance = Number.POSITIVE_INFINITY;
  for (const { leafAtomId } of descriptor.leafTargets) {
    const leafPosition = coords.get(leafAtomId);
    if (!leafPosition) {
      continue;
    }
    minimumClearance = Math.min(minimumClearance, localNonbondedClearanceWithOverrides(layoutGraph, coords, leafAtomId, leafPosition, new Map([[leafAtomId, leafPosition]])));
  }
  return minimumClearance;
}

function movableTerminalMultipleBondAcyclicSupportAtomIds(layoutGraph, coords, centerAtomId, supportAtomId, protectedAtomIds, frozenAtomIds = null) {
  const supportAtom = layoutGraph.atoms.get(supportAtomId);
  if (!supportAtom || supportAtom.element === 'H' || layoutGraph.ringAtomIdSet.has(supportAtomId)) {
    return null;
  }
  const movedAtomIds = collectCovalentSubtreeAtomIds(layoutGraph, supportAtomId, centerAtomId).filter(atomId => coords.has(atomId));
  if (
    movedAtomIds.length === 0 ||
    movedAtomIds.some(atomId => (atomId !== supportAtomId && protectedAtomIds.has(atomId)) || layoutGraph.ringAtomIdSet.has(atomId) || frozenAtomIds?.has(atomId)) ||
    heavyAtomCountInIds(layoutGraph, movedAtomIds) > TERMINAL_MULTIPLE_BOND_ACYCLIC_SUPPORT_HEAVY_LIMIT
  ) {
    return null;
  }
  return movedAtomIds;
}

function movableTerminalMultipleBondLargeSupportAtomIds(layoutGraph, coords, centerAtomId, supportAtomId, protectedAtomIds, frozenAtomIds = null) {
  if (coords.size < TERMINAL_MULTIPLE_BOND_LARGE_SUPPORT_MIN_COORDS) {
    return null;
  }
  const supportAtom = layoutGraph.atoms.get(supportAtomId);
  if (!supportAtom || supportAtom.element === 'H') {
    return null;
  }
  const movedAtomIds = collectCovalentSubtreeAtomIds(layoutGraph, supportAtomId, centerAtomId).filter(atomId => coords.has(atomId));
  if (
    movedAtomIds.length === 0 ||
    movedAtomIds.some(atomId => (atomId !== supportAtomId && protectedAtomIds.has(atomId)) || frozenAtomIds?.has(atomId)) ||
    heavyAtomCountInIds(layoutGraph, movedAtomIds) > TERMINAL_MULTIPLE_BOND_LARGE_SUPPORT_HEAVY_LIMIT
  ) {
    return null;
  }
  return movedAtomIds;
}

function hasMovableTerminalMultipleBondSupport(layoutGraph, coords, centerAtomId, leafAtomId, fixedNeighborIds, frozenAtomIds = null) {
  if (fixedNeighborIds.length !== 2) {
    return false;
  }
  const protectedAtomIds = new Set([centerAtomId, leafAtomId, ...fixedNeighborIds]);
  return fixedNeighborIds.some(
    supportAtomId =>
      movableTerminalMultipleBondAcyclicSupportAtomIds(layoutGraph, coords, centerAtomId, supportAtomId, protectedAtomIds, frozenAtomIds) != null ||
      movableTerminalMultipleBondLargeSupportAtomIds(layoutGraph, coords, centerAtomId, supportAtomId, protectedAtomIds, frozenAtomIds) != null
  );
}

/**
 * Returns whether rotating a terminal multiple-bond support would disturb an
 * exact trigonal branch owned by the support atom.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {string} supportAtomId - Candidate support atom ID.
 * @param {string} centerAtomId - Terminal multiple-bond center atom ID.
 * @returns {boolean} True when balanced support relief should leave it fixed.
 */
function protectsExactTrigonalSupportBranch(layoutGraph, supportAtomId, centerAtomId) {
  return isExactVisibleTrigonalBisectorEligible(layoutGraph, supportAtomId, centerAtomId);
}

/**
 * Returns whether an atom belongs to at least one ring in a candidate set.
 * @param {string} atomId - Atom ID to inspect.
 * @param {object[]} rings - Ring descriptors.
 * @returns {boolean} True when the atom is present in any ring.
 */
function atomIsInAnyRing(atomId, rings) {
  return rings.some(ring => ring.atomIds.includes(atomId));
}

/**
 * Returns rings shared by two atoms.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {string} firstAtomId - First atom ID.
 * @param {string} secondAtomId - Second atom ID.
 * @returns {object[]} Shared ring descriptors.
 */
function sharedRingsForAtomPair(layoutGraph, firstAtomId, secondAtomId) {
  const secondRings = new Set(layoutGraph.atomToRings.get(secondAtomId) ?? []);
  return (layoutGraph.atomToRings.get(firstAtomId) ?? []).filter(ring => secondRings.has(ring));
}

function exactTrigonalLeafTargetAngleFromFixedAngles(fixedAngles) {
  if (fixedAngles.length !== 2 || Math.abs(angularDifference(fixedAngles[0], fixedAngles[1]) - (2 * Math.PI) / 3) > TIDY_IMPROVEMENT_EPSILON) {
    return null;
  }

  const candidates = [fixedAngles[0] + (2 * Math.PI) / 3, fixedAngles[0] - (2 * Math.PI) / 3];
  candidates.sort(
    (firstAngle, secondAngle) =>
      Math.abs(angularDifference(firstAngle, fixedAngles[1]) - (2 * Math.PI) / 3) -
      Math.abs(angularDifference(secondAngle, fixedAngles[1]) - (2 * Math.PI) / 3)
  );
  return wrapAngle(candidates[0]);
}

function terminalMultipleBondLeafTargetAngleFromFixedSupport(centerPosition, fixedNeighborPositions) {
  const fixedAngles = fixedNeighborPositions.map(position => angleOf(sub(position, centerPosition)));
  return exactTrigonalLeafTargetAngleFromFixedAngles(fixedAngles) ?? angleOf(sub(centerPosition, centroid(fixedNeighborPositions)));
}

/**
 * Returns the exact terminal multiple-bond leaf position implied by the two
 * fixed support atoms around a trigonal center.
 * @param {Map<string, {x: number, y: number}>} coords - Coordinate map.
 * @param {object} descriptor - Terminal multiple-bond fan descriptor.
 * @returns {{x: number, y: number}|null} Exact leaf target position.
 */
function exactTerminalMultipleBondLeafTargetPosition(coords, descriptor) {
  if (descriptor.leafTargets.length !== 1) {
    return null;
  }
  const leafAtomId = descriptor.leafTargets[0].leafAtomId;
  const centerPosition = coords.get(descriptor.centerAtomId);
  const leafPosition = coords.get(leafAtomId);
  if (!centerPosition || !leafPosition) {
    return null;
  }

  const fixedNeighborPositions = descriptor.neighborAtomIds
    .filter(neighborAtomId => neighborAtomId !== leafAtomId)
    .map(neighborAtomId => coords.get(neighborAtomId))
    .filter(Boolean);
  if (fixedNeighborPositions.length !== 2) {
    return null;
  }

  const targetAngle = terminalMultipleBondLeafTargetAngleFromFixedSupport(centerPosition, fixedNeighborPositions);
  return add(centerPosition, fromAngle(targetAngle, distance(centerPosition, leafPosition)));
}

/**
 * Reflects a set of atoms across the infinite line through a bond.
 * @param {Map<string, {x: number, y: number}>} coords - Coordinate map.
 * @param {string[]} atomIds - Atom IDs to reflect.
 * @param {string} firstAtomId - First atom defining the mirror line.
 * @param {string} secondAtomId - Second atom defining the mirror line.
 * @returns {Map<string, {x: number, y: number}>|null} Reflected coordinates.
 */
function reflectAtomIdsAcrossBond(coords, atomIds, firstAtomId, secondAtomId) {
  const firstPosition = coords.get(firstAtomId);
  const secondPosition = coords.get(secondAtomId);
  if (!firstPosition || !secondPosition) {
    return null;
  }

  const candidateCoords = new Map(coords);
  for (const atomId of atomIds) {
    const position = coords.get(atomId);
    if (!position) {
      continue;
    }
    candidateCoords.set(atomId, reflectAcrossLine(position, firstPosition, secondPosition));
  }
  return candidateCoords;
}

/**
 * Returns whether a three-heavy fan remains on exact 120-degree separations.
 * @param {Map<string, {x: number, y: number}>} coords - Coordinate map.
 * @param {string} centerAtomId - Fan center atom ID.
 * @param {string[]} neighborAtomIds - Three neighbor atom IDs.
 * @returns {boolean} True when the fan is still exact trigonal.
 */
function exactTrigonalFanIsPreserved(coords, centerAtomId, neighborAtomIds) {
  return (
    Math.abs(threeHeavyCenterMaxSeparation(coords, centerAtomId, neighborAtomIds) - (2 * Math.PI) / 3) <= TIDY_IMPROVEMENT_EPSILON &&
    Math.abs(threeHeavyCenterMinSeparation(coords, centerAtomId, neighborAtomIds) - (2 * Math.PI) / 3) <= TIDY_IMPROVEMENT_EPSILON
  );
}

/**
 * Compares protected-support reflection candidates.
 * @param {object} candidate - Candidate score.
 * @param {object|null} incumbent - Current best score.
 * @returns {number} Negative when candidate is better.
 */
function compareProtectedSupportReflectionCandidates(candidate, incumbent) {
  if (!incumbent) {
    return -1;
  }
  if (Math.abs(candidate.fanPenalty - incumbent.fanPenalty) > TERMINAL_MULTIPLE_BOND_FAN_IMPROVEMENT_EPSILON) {
    return candidate.fanPenalty - incumbent.fanPenalty;
  }
  if ((candidate.audit.labelOverlapCount ?? 0) !== (incumbent.audit.labelOverlapCount ?? 0)) {
    return (candidate.audit.labelOverlapCount ?? 0) - (incumbent.audit.labelOverlapCount ?? 0);
  }
  if ((candidate.audit.severeOverlapCount ?? 0) !== (incumbent.audit.severeOverlapCount ?? 0)) {
    return (candidate.audit.severeOverlapCount ?? 0) - (incumbent.audit.severeOverlapCount ?? 0);
  }
  if (Math.abs(candidate.movedHeavyAtomCount - incumbent.movedHeavyAtomCount) > TIDY_IMPROVEMENT_EPSILON) {
    return candidate.movedHeavyAtomCount - incumbent.movedHeavyAtomCount;
  }
  return 0;
}

/**
 * Mirrors a protected ring-bound support branch across its existing attachment
 * bond so a blocked terminal multiple-bond leaf can still use the exact
 * trigonal slot without bending the support's own planar fan.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Current coordinate map.
 * @param {object} descriptor - Terminal multiple-bond fan descriptor.
 * @param {number} bondLength - Target bond length.
 * @param {Set<string>|null} frozenAtomIds - Frozen atoms that must not move.
 * @returns {Map<string, {x: number, y: number}>|null} Reflected coordinate candidate, or null.
 */
function terminalMultipleBondProtectedSupportReflectionCoords(layoutGraph, coords, descriptor, bondLength, frozenAtomIds) {
  const leafAtomId = descriptor.leafTargets.length === 1 ? descriptor.leafTargets[0].leafAtomId : null;
  if (!leafAtomId) {
    return null;
  }

  let bestCandidate = null;
  const fixedNeighborIds = descriptor.neighborAtomIds.filter(neighborAtomId => neighborAtomId !== leafAtomId);
  for (const supportAtomId of fixedNeighborIds) {
    if (!protectsExactTrigonalSupportBranch(layoutGraph, supportAtomId, descriptor.centerAtomId)) {
      continue;
    }

    const supportNeighborIds = visibleHeavyCovalentBonds(layoutGraph, coords, supportAtomId).map(({ neighborAtomId }) => neighborAtomId);
    const supportRingNeighborIds = supportNeighborIds.filter(neighborAtomId => {
      if (neighborAtomId === descriptor.centerAtomId) {
        return false;
      }
      return sharedRingsForAtomPair(layoutGraph, supportAtomId, neighborAtomId).length > 0;
    });
    if (supportRingNeighborIds.length !== 2) {
      continue;
    }

    for (const ringNeighborId of supportRingNeighborIds) {
      const sharedRings = sharedRingsForAtomPair(layoutGraph, supportAtomId, ringNeighborId);
      if (sharedRings.length === 0) {
        continue;
      }

      for (const bond of layoutGraph.bondsByAtomId.get(ringNeighborId) ?? []) {
        if (!bond || bond.kind !== 'covalent') {
          continue;
        }
        const outsideAnchorAtomId = bond.a === ringNeighborId ? bond.b : bond.a;
        const outsideAnchorAtom = layoutGraph.atoms.get(outsideAnchorAtomId);
        if (outsideAnchorAtomId === supportAtomId || !outsideAnchorAtom || outsideAnchorAtom.element === 'H' || atomIsInAnyRing(outsideAnchorAtomId, sharedRings) || !coords.has(outsideAnchorAtomId)) {
          continue;
        }

        const reflectedAtomIds = collectCovalentSubtreeAtomIds(layoutGraph, ringNeighborId, outsideAnchorAtomId).filter(atomId => coords.has(atomId));
        if (
          reflectedAtomIds.length === 0 ||
          !reflectedAtomIds.includes(supportAtomId) ||
          !reflectedAtomIds.includes(descriptor.centerAtomId) ||
          !reflectedAtomIds.includes(leafAtomId) ||
          (frozenAtomIds instanceof Set && reflectedAtomIds.some(atomId => frozenAtomIds.has(atomId))) ||
          heavyAtomCountInIds(layoutGraph, reflectedAtomIds) > TERMINAL_MULTIPLE_BOND_PROTECTED_SUPPORT_REFLECTION_HEAVY_LIMIT
        ) {
          continue;
        }

        const reflectedCoords = reflectAtomIdsAcrossBond(coords, reflectedAtomIds, outsideAnchorAtomId, ringNeighborId);
        if (!reflectedCoords) {
          continue;
        }
        const exactLeafPosition = exactTerminalMultipleBondLeafTargetPosition(reflectedCoords, descriptor);
        if (!exactLeafPosition) {
          continue;
        }
        reflectedCoords.set(leafAtomId, exactLeafPosition);
        if (!exactTrigonalFanIsPreserved(reflectedCoords, supportAtomId, supportNeighborIds)) {
          continue;
        }

        const audit = auditLayout(layoutGraph, reflectedCoords, { bondLength, includeVisibleHeavyBondCrossings: false });
        if (audit.ok !== true) {
          continue;
        }
        const fanPenalty = terminalMultipleBondLeafFanPenalty(reflectedCoords, descriptor.centerAtomId, descriptor.neighborAtomIds);
        if (fanPenalty >= descriptor.currentPenalty - TERMINAL_MULTIPLE_BOND_FAN_IMPROVEMENT_EPSILON) {
          continue;
        }

        const candidate = {
          coords: reflectedCoords,
          audit,
          fanPenalty,
          movedHeavyAtomCount: heavyAtomCountInIds(layoutGraph, reflectedAtomIds)
        };
        if (compareProtectedSupportReflectionCandidates(candidate, bestCandidate) < 0) {
          bestCandidate = candidate;
        }
      }
    }
  }

  return bestCandidate?.coords ?? null;
}

function movedAtomOverlapCount(layoutGraph, coords, atomIds, overridePositions, threshold) {
  let overlapCount = 0;
  for (const atomId of atomIds) {
    const position = overridePositions.get(atomId) ?? coords.get(atomId);
    if (!position) {
      continue;
    }
    overlapCount += localSevereOverlapCountWithOverrides(layoutGraph, coords, atomId, position, overridePositions, threshold);
  }
  return overlapCount;
}

function hiddenHydrogenTerminalMultipleBondAuditDoesNotRegress(candidateAudit, incumbentAudit) {
  if (candidateAudit?.ok === true) {
    return true;
  }
  if (incumbentAudit?.ok === true) {
    return false;
  }
  return (
    (candidateAudit?.severeOverlapCount ?? 0) <= (incumbentAudit?.severeOverlapCount ?? 0) &&
    (candidateAudit?.visibleHeavyBondCrossingCount ?? 0) <= (incumbentAudit?.visibleHeavyBondCrossingCount ?? 0) &&
    (candidateAudit?.bondLengthFailureCount ?? 0) <= (incumbentAudit?.bondLengthFailureCount ?? 0) &&
    (candidateAudit?.collapsedMacrocycleCount ?? 0) <= (incumbentAudit?.collapsedMacrocycleCount ?? 0)
  );
}

function terminalMultipleBondLeafFanAuditDoesNotRegress(candidateAudit, incumbentAudit, bondLength) {
  if (candidateAudit?.ok === true) {
    return true;
  }
  if (!candidateAudit || !incumbentAudit || incumbentAudit.ok === true) {
    return false;
  }
  if ((candidateAudit.stereoContradiction ?? false) && !(incumbentAudit.stereoContradiction ?? false)) {
    return false;
  }
  for (const key of [
    'severeOverlapCount',
    'visibleHeavyBondCrossingCount',
    'labelOverlapCount',
    'bondLengthFailureCount',
    'mildBondLengthFailureCount',
    'severeBondLengthFailureCount',
    'collapsedMacrocycleCount',
    'ringSubstituentReadabilityFailureCount',
    'inwardRingSubstituentCount',
    'outwardAxisRingSubstituentFailureCount'
  ]) {
    if ((candidateAudit[key] ?? 0) > (incumbentAudit[key] ?? 0)) {
      return false;
    }
  }
  return (candidateAudit.maxBondLengthDeviation ?? 0) <= (incumbentAudit.maxBondLengthDeviation ?? 0) + bondLength * 1e-3;
}

function runHiddenHydrogenTerminalMultipleBondFanTidy(layoutGraph, coords, bondLength, atomGrid, frozenAtomIds, candidateCenterIds = null) {
  let nudges = 0;
  const threshold = bondLength * 0.55;
  let incumbentAudit = null;
  for (const centerAtomId of candidateCenterIds ?? [...coords.keys()]) {
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
    const movedAtomIds = collectCovalentSubtreeAtomIds(layoutGraph, descriptor.leafAtomId, descriptor.centerAtomId).filter(atomId => coords.has(atomId));
    if (movedAtomIds.length === 0 || (frozenAtomIds instanceof Set && movedAtomIds.some(atomId => frozenAtomIds.has(atomId)))) {
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
    const candidatePenalty = hiddenHydrogenMultipleBondVisiblePenalty(candidateCoords, descriptor.centerAtomId, descriptor.supportAtomId, descriptor.leafAtomId);
    if (candidatePenalty >= descriptor.currentPenalty - TERMINAL_MULTIPLE_BOND_FAN_IMPROVEMENT_EPSILON) {
      continue;
    }
    const candidateAudit = auditLayout(layoutGraph, candidateCoords, { bondLength });
    if (candidateAudit.ok !== true) {
      incumbentAudit ??= auditLayout(layoutGraph, coords, { bondLength });
    }
    if (!hiddenHydrogenTerminalMultipleBondAuditDoesNotRegress(candidateAudit, incumbentAudit)) {
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
    incumbentAudit = null;
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
  if (Math.abs(fixedSeparation - (2 * Math.PI) / 3) <= TIDY_IMPROVEMENT_EPSILON) {
    return null;
  }
  const targetSupportSeparation = (19 * Math.PI) / 30;
  if (fixedSeparation <= targetSupportSeparation + TIDY_IMPROVEMENT_EPSILON) {
    return null;
  }
  const reliefRotation = Math.min(fixedSeparation - targetSupportSeparation, Math.PI / 6);
  const leafAtomIds = collectCovalentSubtreeAtomIds(layoutGraph, leafAtomId, descriptor.centerAtomId).filter(atomId => coords.has(atomId));
  if (leafAtomIds.length === 0 || (frozenAtomIds instanceof Set && leafAtomIds.some(atomId => frozenAtomIds.has(atomId)))) {
    return null;
  }

  const protectedSupportReflectionCoords = terminalMultipleBondProtectedSupportReflectionCoords(layoutGraph, coords, descriptor, bondLength, frozenAtomIds);
  if (protectedSupportReflectionCoords) {
    return protectedSupportReflectionCoords;
  }

  let bestCandidate = null;
  let bestScore = null;
  for (const supportAtomId of fixedNeighborIds) {
    if (protectsExactTrigonalSupportBranch(layoutGraph, supportAtomId, descriptor.centerAtomId)) {
      continue;
    }
    if (!layoutGraph.ringAtomIdSet.has(supportAtomId)) {
      continue;
    }
    const supportAtomIds = collectCovalentSubtreeAtomIds(layoutGraph, supportAtomId, descriptor.centerAtomId).filter(atomId => coords.has(atomId));
    const centerSideAtomIds = collectCovalentSubtreeAtomIds(layoutGraph, descriptor.centerAtomId, supportAtomId).filter(atomId => coords.has(atomId));
    if (
      supportAtomIds.length === 0 ||
      centerSideAtomIds.length === 0 ||
      (frozenAtomIds instanceof Set && (supportAtomIds.some(atomId => frozenAtomIds.has(atomId)) || centerSideAtomIds.some(atomId => frozenAtomIds.has(atomId))))
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
        const relievedCoords =
          Math.abs(centerSideRotation) <= TIDY_IMPROVEMENT_EPSILON ? candidateCoords : rotateAtomIdsAroundPivot(candidateCoords, centerSideAtomIds, supportAtomId, centerSideRotation);
        if (!relievedCoords) {
          continue;
        }
        const variantCoords = [relievedCoords];
        if (auditCandidateSafety(layoutGraph, relievedCoords, { bondLength }).ok !== true) {
          const cleanup = runUnifiedCleanup(layoutGraph, relievedCoords, {
            maxPasses: 2,
            epsilon: bondLength * 0.001,
            bondLength,
            protectBondIntegrity: false,
            frozenAtomIds
          });
          if (cleanup.passes > 0) {
            variantCoords.push(cleanup.coords);
            variantCoords.push(...terminalMultipleBondLeafBackoffVariants(layoutGraph, cleanup.coords, descriptor, bondLength, frozenAtomIds));
          }
        }

        for (const variantCoordMap of variantCoords) {
          const audit = auditLayout(layoutGraph, variantCoordMap, { bondLength, includeVisibleHeavyBondCrossings: false });
          if (audit.ok !== true) {
            continue;
          }
          const fanPenalty = terminalMultipleBondLeafFanPenalty(variantCoordMap, descriptor.centerAtomId, descriptor.neighborAtomIds);
          if (fanPenalty >= descriptor.currentPenalty - TERMINAL_MULTIPLE_BOND_FAN_IMPROVEMENT_EPSILON) {
            continue;
          }
          const clearance = terminalMultipleBondLeafMinimumClearance(layoutGraph, variantCoordMap, descriptor);
          const score = {
            clearance,
            fanPenalty,
            centerSideRotation: Math.abs(centerSideRotation)
          };
          if (
            bestScore == null ||
            clearance > bestScore.clearance + TIDY_IMPROVEMENT_EPSILON ||
            (Math.abs(clearance - bestScore.clearance) <= TIDY_IMPROVEMENT_EPSILON &&
              (fanPenalty < bestScore.fanPenalty - TIDY_IMPROVEMENT_EPSILON ||
                (Math.abs(fanPenalty - bestScore.fanPenalty) <= TIDY_IMPROVEMENT_EPSILON && Math.abs(centerSideRotation) < bestScore.centerSideRotation - TIDY_IMPROVEMENT_EPSILON)))
          ) {
            bestScore = score;
            bestCandidate = variantCoordMap;
          }
        }
      }
    }
  }
  return bestCandidate;
}

/**
 * Rotates a movable support side of a terminal multiple-bond fan into an exact
 * 120-degree slot, then places the terminal leaf in the complementary slot.
 * Small acyclic supports must be audit-clean directly; bounded large supports
 * may use a short cleanup relief if the exact fan move creates local contacts.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Current coordinate map.
 * @param {object} descriptor - Terminal multiple-bond fan descriptor.
 * @param {number} bondLength - Target bond length.
 * @param {Set<string>|null} frozenAtomIds - Frozen atoms that must not move.
 * @param {Map<string, string>|null} bondValidationClasses - Per-bond validation classes for audit-safe candidates.
 * @returns {Map<string, {x: number, y: number}>|null} Retouched coordinates, or null when no audit-safe exact fan is available.
 */
function terminalMultipleBondExactSupportReliefCoords(layoutGraph, coords, descriptor, bondLength, frozenAtomIds, bondValidationClasses = null) {
  if (descriptor.leafTargets.length !== 1) {
    return null;
  }

  const leafAtomId = descriptor.leafTargets[0].leafAtomId;
  const fixedNeighborIds = descriptor.neighborAtomIds.filter(neighborAtomId => neighborAtomId !== leafAtomId);
  if (fixedNeighborIds.length !== 2) {
    return null;
  }

  const centerPosition = coords.get(descriptor.centerAtomId);
  const leafPosition = coords.get(leafAtomId);
  if (!centerPosition || !leafPosition || frozenAtomIds?.has(leafAtomId)) {
    return null;
  }

  const leafRadius = distance(centerPosition, leafPosition) || bondLength;
  const currentLeafAngle = angleOf(sub(leafPosition, centerPosition));
  const protectedAtomIds = new Set([descriptor.centerAtomId, leafAtomId, ...fixedNeighborIds]);
  let bestCandidate = null;

  for (const supportAtomId of fixedNeighborIds) {
    const otherFixedAtomId = fixedNeighborIds.find(neighborAtomId => neighborAtomId !== supportAtomId);
    const supportPosition = coords.get(supportAtomId);
    const otherFixedPosition = coords.get(otherFixedAtomId);
    if (!supportPosition || !otherFixedPosition) {
      continue;
    }

    const acyclicSupportAtomIds = movableTerminalMultipleBondAcyclicSupportAtomIds(layoutGraph, coords, descriptor.centerAtomId, supportAtomId, protectedAtomIds, frozenAtomIds);
    const supportAtomIds = acyclicSupportAtomIds ?? movableTerminalMultipleBondLargeSupportAtomIds(layoutGraph, coords, descriptor.centerAtomId, supportAtomId, protectedAtomIds, frozenAtomIds);
    if (!supportAtomIds) {
      continue;
    }
    const allowCleanupRelief = acyclicSupportAtomIds == null;

    const fixedAngle = angleOf(sub(otherFixedPosition, centerPosition));
    const supportAngle = angleOf(sub(supportPosition, centerPosition));
    const assignments = [
      { supportTargetAngle: fixedAngle + (2 * Math.PI) / 3, leafTargetAngle: fixedAngle - (2 * Math.PI) / 3 },
      { supportTargetAngle: fixedAngle - (2 * Math.PI) / 3, leafTargetAngle: fixedAngle + (2 * Math.PI) / 3 }
    ];
    assignments.sort((first, second) => angularDifference(first.leafTargetAngle, currentLeafAngle) - angularDifference(second.leafTargetAngle, currentLeafAngle));

    for (const { supportTargetAngle, leafTargetAngle } of assignments) {
      const supportRotation = wrapAngle(supportTargetAngle - supportAngle);
      if (Math.abs(supportRotation) <= TIDY_IMPROVEMENT_EPSILON) {
        continue;
      }
      const candidateCoords = rotateAtomIdsAroundPivot(coords, supportAtomIds, descriptor.centerAtomId, supportRotation);
      if (!candidateCoords) {
        continue;
      }
      candidateCoords.set(leafAtomId, add(centerPosition, fromAngle(leafTargetAngle, leafRadius)));

      let scoredCoords = candidateCoords;
      let candidateAudit = auditLayout(layoutGraph, scoredCoords, {
        bondLength,
        bondValidationClasses
      });
      if (candidateAudit.ok !== true && allowCleanupRelief) {
        const cleanup = runUnifiedCleanup(layoutGraph, scoredCoords, {
          maxPasses: 2,
          epsilon: bondLength * 0.001,
          bondLength,
          protectBondIntegrity: false,
          frozenAtomIds
        });
        if (cleanup.passes > 0) {
          const cleanupAudit = auditLayout(layoutGraph, cleanup.coords, {
            bondLength,
            bondValidationClasses
          });
          if (cleanupAudit.ok === true) {
            scoredCoords = cleanup.coords;
            candidateAudit = cleanupAudit;
          }
        }
      }
      if (candidateAudit.ok !== true) {
        continue;
      }

      const fanPenalty = terminalMultipleBondLeafFanPenalty(scoredCoords, descriptor.centerAtomId, descriptor.neighborAtomIds);
      if (fanPenalty >= descriptor.currentPenalty - TERMINAL_MULTIPLE_BOND_FAN_IMPROVEMENT_EPSILON) {
        continue;
      }

      const clearance = terminalMultipleBondLeafMinimumClearance(layoutGraph, scoredCoords, descriptor);
      const candidate = {
        coords: scoredCoords,
        fanPenalty,
        clearance,
        movedHeavyAtomCount: heavyAtomCountInIds(layoutGraph, supportAtomIds),
        rotationMagnitude: Math.abs(supportRotation)
      };
      if (
        !bestCandidate ||
        candidate.fanPenalty < bestCandidate.fanPenalty - TERMINAL_MULTIPLE_BOND_FAN_IMPROVEMENT_EPSILON ||
        (Math.abs(candidate.fanPenalty - bestCandidate.fanPenalty) <= TERMINAL_MULTIPLE_BOND_FAN_IMPROVEMENT_EPSILON &&
          (candidate.clearance > bestCandidate.clearance + TIDY_IMPROVEMENT_EPSILON ||
            (Math.abs(candidate.clearance - bestCandidate.clearance) <= TIDY_IMPROVEMENT_EPSILON &&
              (candidate.movedHeavyAtomCount < bestCandidate.movedHeavyAtomCount ||
                (candidate.movedHeavyAtomCount === bestCandidate.movedHeavyAtomCount && candidate.rotationMagnitude < bestCandidate.rotationMagnitude - TIDY_IMPROVEMENT_EPSILON)))))
      ) {
        bestCandidate = candidate;
      }
    }
  }

  return bestCandidate?.coords ?? null;
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

  const directCost = angularDifference(currentAngles.get(leafAtomIds[0]), targetAngles[0]) + angularDifference(currentAngles.get(leafAtomIds[1]), targetAngles[1]);
  const swappedCost = angularDifference(currentAngles.get(leafAtomIds[0]), targetAngles[1]) + angularDifference(currentAngles.get(leafAtomIds[1]), targetAngles[0]);
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
        overlapCount: localSevereOverlapCountWithOverrides(layoutGraph, coords, leafAtomId, candidatePosition, overridePositions, threshold),
        clearance: localNonbondedClearanceWithOverrides(layoutGraph, coords, leafAtomId, candidatePosition, overridePositions),
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
 * @param {Set<string>|null} [frozenAtomIds] - Frozen atoms that must not move.
 * @returns {object|null} Fan descriptor, or null when no improvement is available.
 */
function singleTerminalMultipleBondLeafFanDescriptor(layoutGraph, coords, centerAtomId, heavyBonds, terminalMultipleBondLeaves, frozenAtomIds = null) {
  const centerPosition = coords.get(centerAtomId);
  const leafAtomId = terminalMultipleBondLeaves[0].neighborAtomId;
  const fixedNeighborIds = heavyBonds.map(({ neighborAtomId }) => neighborAtomId).filter(neighborAtomId => neighborAtomId !== leafAtomId);
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
  const currentLeafClearance = localNonbondedClearanceWithOverrides(layoutGraph, coords, leafAtomId, leafPosition, new Map([[leafAtomId, leafPosition]]));
  const hasCrowdedLeaf = currentLeafClearance < layoutGraph.options.bondLength * TERMINAL_MULTIPLE_BOND_LEAF_CROWDING_FACTOR;
  const fixedNeighborsAreLinear = Math.abs(angularDifference(fixedNeighborAngles[0], fixedNeighborAngles[1]) - Math.PI) <= TERMINAL_MULTIPLE_BOND_LINEAR_NEIGHBOR_TOLERANCE;
  const hasMovableSupport = hasMovableTerminalMultipleBondSupport(layoutGraph, coords, centerAtomId, leafAtomId, fixedNeighborIds, frozenAtomIds);
  if (fixedNeighborsAreLinear && !hasCrowdedLeaf && !hasMovableSupport) {
    return null;
  }
  if (!hasCrowdedLeaf && terminalMultipleBondLeafFanMaxDeviation(coords, centerAtomId, neighborAtomIds) <= TERMINAL_MULTIPLE_BOND_BALANCED_FAN_TOLERANCE + TIDY_IMPROVEMENT_EPSILON) {
    return null;
  }
  const targetAngle = fixedNeighborsAreLinear
    ? bestCrowdedLinearSupportLeafAngle(layoutGraph, coords, centerAtomId, leafAtomId, leafPosition, fixedNeighborAngles, layoutGraph.options.bondLength)
    : terminalMultipleBondLeafTargetAngleFromFixedSupport(centerPosition, fixedNeighborPositions);
  const targetAngles = [fixedNeighborAngles[0], fixedNeighborAngles[1], targetAngle];
  const targetPenalty = terminalMultipleBondLeafFanPenaltyFromAngles(targetAngles);
  if (targetPenalty > currentPenalty + TERMINAL_MULTIPLE_BOND_FAN_IMPROVEMENT_EPSILON && !hasMovableSupport) {
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
  const fixedNeighborIds = heavyBonds.map(({ neighborAtomId }) => neighborAtomId).filter(neighborAtomId => !terminalMultipleBondLeaves.some(leaf => leaf.neighborAtomId === neighborAtomId));
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
  const targetAngles = [fixedNeighborAngle + (2 * Math.PI) / 3, fixedNeighborAngle - (2 * Math.PI) / 3];
  const currentAngles = new Map(leafAtomIds.map(leafAtomId => [leafAtomId, angleOf(sub(coords.get(leafAtomId), centerPosition))]));
  const leafTargets = assignTerminalMultipleBondLeafTargets(leafAtomIds, currentAngles, targetAngles);
  if (!leafTargets) {
    return null;
  }

  const neighborAtomIds = [fixedNeighborId, ...leafAtomIds];
  const currentPenalty = terminalMultipleBondLeafFanPenalty(coords, centerAtomId, neighborAtomIds);
  if (terminalMultipleBondLeafFanMaxDeviation(coords, centerAtomId, neighborAtomIds) <= TERMINAL_MULTIPLE_BOND_BALANCED_FAN_TOLERANCE + TIDY_IMPROVEMENT_EPSILON) {
    return null;
  }
  const targetPenalty = terminalMultipleBondLeafFanPenaltyFromAngles([fixedNeighborAngle, ...leafTargets.map(({ targetAngle }) => targetAngle)]);
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
 * Builds a terminal hetero fan descriptor for trigonal acid-like centers with
 * one terminal multiple-bond hetero leaf and one terminal single-bond hetero
 * leaf. Both terminal leaves are moved around the fixed support atom so
 * carboxyl/acid fans can recover a readable 120-degree spread.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Coordinate map.
 * @param {string} centerAtomId - Three-coordinate fan center atom id.
 * @param {Array<{bond: object, neighborAtomId: string}>} heavyBonds - Visible heavy bonds at the center.
 * @param {Array<{bond: object, neighborAtomId: string}>} terminalMultipleBondLeaves - Movable terminal multiple-bond leaves.
 * @param {Set<string>|null} frozenAtomIds - Frozen atoms that must not move.
 * @returns {object|null} Fan descriptor, or null when unsupported.
 */
function pairedTerminalHeteroLeafFanDescriptor(layoutGraph, coords, centerAtomId, heavyBonds, terminalMultipleBondLeaves, frozenAtomIds) {
  if (terminalMultipleBondLeaves.length !== 1) {
    return null;
  }

  const terminalMultipleLeafAtomId = terminalMultipleBondLeaves[0].neighborAtomId;
  const terminalSingleHeteroLeaves = heavyBonds.filter(({ bond, neighborAtomId }) => {
    const neighborAtom = layoutGraph.atoms.get(neighborAtomId);
    return (
      neighborAtomId !== terminalMultipleLeafAtomId &&
      !bond.aromatic &&
      (bond.order ?? 1) === 1 &&
      neighborAtom &&
      neighborAtom.element !== 'C' &&
      neighborAtom.element !== 'H' &&
      neighborAtom.heavyDegree === 1 &&
      !(frozenAtomIds instanceof Set && frozenAtomIds.has(neighborAtomId))
    );
  });
  if (terminalSingleHeteroLeaves.length !== 1) {
    return null;
  }

  const leafAtomIds = [terminalMultipleLeafAtomId, terminalSingleHeteroLeaves[0].neighborAtomId];
  if (leafAtomIds.some(leafAtomId => !coords.has(leafAtomId))) {
    return null;
  }

  const fixedBonds = heavyBonds.filter(({ neighborAtomId }) => !leafAtomIds.includes(neighborAtomId));
  if (fixedBonds.length !== 1) {
    return null;
  }
  const fixedNeighborId = fixedBonds[0].neighborAtomId;
  const centerPosition = coords.get(centerAtomId);
  const fixedNeighborPosition = coords.get(fixedNeighborId);
  if (!centerPosition || !fixedNeighborPosition) {
    return null;
  }

  const neighborAtomIds = [fixedNeighborId, ...leafAtomIds];
  const currentPenalty = terminalMultipleBondLeafFanPenalty(coords, centerAtomId, neighborAtomIds);
  if (terminalMultipleBondLeafFanMaxDeviation(coords, centerAtomId, neighborAtomIds) <= TERMINAL_MULTIPLE_BOND_BALANCED_FAN_TOLERANCE + TIDY_IMPROVEMENT_EPSILON) {
    return null;
  }

  const fixedNeighborAngle = angleOf(sub(fixedNeighborPosition, centerPosition));
  const targetAngles = [fixedNeighborAngle + (2 * Math.PI) / 3, fixedNeighborAngle - (2 * Math.PI) / 3];
  const currentAngles = new Map(leafAtomIds.map(leafAtomId => [leafAtomId, angleOf(sub(coords.get(leafAtomId), centerPosition))]));
  const leafTargets = assignTerminalMultipleBondLeafTargets(leafAtomIds, currentAngles, targetAngles);
  if (!leafTargets) {
    return null;
  }

  const targetPenalty = terminalMultipleBondLeafFanPenaltyFromAngles([fixedNeighborAngle, ...leafTargets.map(({ targetAngle }) => targetAngle)]);
  if (targetPenalty > currentPenalty + TERMINAL_MULTIPLE_BOND_FAN_IMPROVEMENT_EPSILON) {
    return null;
  }

  return {
    centerAtomId,
    neighborAtomIds,
    leafTargets,
    currentPenalty,
    targetPenalty,
    movesTerminalSingleHeteroLeaf: true
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
      !bond.aromatic && (bond.order ?? 1) >= 2 && neighborAtom && neighborAtom.element !== 'C' && neighborAtom.heavyDegree === 1 && !(frozenAtomIds instanceof Set && frozenAtomIds.has(neighborAtomId))
    );
  });
  if (terminalMultipleBondLeaves.length === 1) {
    const pairedTerminalHeteroDescriptor = pairedTerminalHeteroLeafFanDescriptor(layoutGraph, coords, centerAtomId, heavyBonds, terminalMultipleBondLeaves, frozenAtomIds);
    if (pairedTerminalHeteroDescriptor) {
      return pairedTerminalHeteroDescriptor;
    }
    return singleTerminalMultipleBondLeafFanDescriptor(layoutGraph, coords, centerAtomId, heavyBonds, terminalMultipleBondLeaves, frozenAtomIds);
  }
  if (terminalMultipleBondLeaves.length !== 2) {
    return null;
  }

  const fixedBonds = heavyBonds.filter(({ neighborAtomId }) => !terminalMultipleBondLeaves.some(leaf => leaf.neighborAtomId === neighborAtomId));
  if (fixedBonds.length !== 1 || fixedBonds.some(({ bond }) => bond.aromatic || (bond.order ?? 1) !== 1)) {
    return null;
  }
  return pairedTerminalMultipleBondLeafFanDescriptor(coords, centerAtomId, heavyBonds, terminalMultipleBondLeaves);
}

/**
 * Collects final terminal multiple-bond fan retouch candidates while measuring
 * the same aggregate fan deviation used by the final pipeline gate.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Coordinate map.
 * @param {{frozenAtomIds?: Set<string>|null}} [options] - Candidate options.
 * @returns {{candidateCenterIds: string[], hiddenHydrogenCandidateCenterIds: string[], pairedTerminalHeteroCandidateCenterIds: string[], totalDeviation: number, maxDeviation: number}} Retouch plan and aggregate fan penalty.
 */
export function collectTerminalMultipleBondLeafFanRetouchCenters(layoutGraph, coords, options = {}) {
  const frozenAtomIds = options.frozenAtomIds ?? null;
  const candidateCenterIds = [];
  const hiddenHydrogenCandidateCenterIds = [];
  const pairedTerminalHeteroCandidateCenterIds = [];
  let totalDeviation = 0;
  let maxDeviation = 0;
  if (!(coords instanceof Map)) {
    return {
      candidateCenterIds,
      hiddenHydrogenCandidateCenterIds,
      pairedTerminalHeteroCandidateCenterIds,
      totalDeviation,
      maxDeviation
    };
  }

  const structuralCenterIds = terminalMultipleBondFanStructuralCenterIds(layoutGraph);
  for (const centerAtomId of structuralCenterIds) {
    if (!coords.has(centerAtomId)) {
      continue;
    }
    const centerAtom = layoutGraph.atoms.get(centerAtomId);
    const centerPosition = coords.get(centerAtomId);
    if (!centerAtom || centerAtom.element === 'H' || centerAtom.aromatic || !centerPosition) {
      continue;
    }

    const heavyBonds = visibleHeavyCovalentBonds(layoutGraph, coords, centerAtomId);
    if (heavyBonds.length === 3) {
      const terminalMultipleBondLeaves = heavyBonds.filter(({ bond, neighborAtomId }) => {
        const neighborAtom = layoutGraph.atoms.get(neighborAtomId);
        return !bond.aromatic && (bond.order ?? 1) >= 2 && neighborAtom && neighborAtom.element !== 'C' && neighborAtom.heavyDegree === 1;
      });
      if (terminalMultipleBondLeaves.length === 1 || terminalMultipleBondLeaves.length === 2) {
        const leafAtomIds = new Set(terminalMultipleBondLeaves.map(({ neighborAtomId }) => neighborAtomId));
        const fixedNeighborPositions = heavyBonds
          .map(({ neighborAtomId }) => neighborAtomId)
          .filter(neighborAtomId => !leafAtomIds.has(neighborAtomId))
          .map(neighborAtomId => coords.get(neighborAtomId))
          .filter(Boolean);
        if (fixedNeighborPositions.length === 3 - terminalMultipleBondLeaves.length) {
          let measureFan = true;
          if (terminalMultipleBondLeaves.length === 1) {
            const fixedNeighborAngles = fixedNeighborPositions.map(position => angleOf(sub(position, centerPosition)));
            const fixedNeighborIds = heavyBonds.map(({ neighborAtomId }) => neighborAtomId).filter(neighborAtomId => !leafAtomIds.has(neighborAtomId));
            measureFan =
              Math.abs(angularDifference(fixedNeighborAngles[0], fixedNeighborAngles[1]) - Math.PI) > TERMINAL_MULTIPLE_BOND_LINEAR_NEIGHBOR_TOLERANCE ||
              hasMovableTerminalMultipleBondSupport(layoutGraph, coords, centerAtomId, terminalMultipleBondLeaves[0].neighborAtomId, fixedNeighborIds, frozenAtomIds);
          }
          if (measureFan) {
            const neighborAtomIds = heavyBonds.map(({ neighborAtomId }) => neighborAtomId);
            const penalty = terminalMultipleBondLeafFanPenalty(coords, centerAtomId, neighborAtomIds);
            if (Number.isFinite(penalty)) {
              totalDeviation += penalty;
              maxDeviation = Math.max(maxDeviation, penalty);
            }
          }
        }
      }
    }

    const descriptor = terminalMultipleBondLeafFanDescriptor(layoutGraph, coords, centerAtomId, frozenAtomIds);
    if (!descriptor) {
      continue;
    }
    candidateCenterIds.push(centerAtomId);
    if (descriptor.movesTerminalSingleHeteroLeaf === true) {
      pairedTerminalHeteroCandidateCenterIds.push(centerAtomId);
    }
  }

  for (const centerAtomId of structuralCenterIds) {
    if (!coords.has(centerAtomId)) {
      continue;
    }
    const descriptor = hiddenHydrogenTerminalMultipleBondFanDescriptor(layoutGraph, coords, centerAtomId);
    if (descriptor) {
      totalDeviation += descriptor.currentPenalty;
      maxDeviation = Math.max(maxDeviation, descriptor.currentPenalty);
    }
    const candidateDescriptor = hiddenHydrogenTerminalMultipleBondFanDescriptor(layoutGraph, coords, centerAtomId, frozenAtomIds);
    if (candidateDescriptor) {
      hiddenHydrogenCandidateCenterIds.push(centerAtomId);
    }
  }

  return {
    candidateCenterIds,
    hiddenHydrogenCandidateCenterIds,
    pairedTerminalHeteroCandidateCenterIds,
    totalDeviation,
    maxDeviation
  };
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
    if (otherAtomId === atomId || !isVisiblePresentationAtom(layoutGraph, otherAtomId) || layoutGraph.bondedPairSet.has(atomPairKey(atomId, otherAtomId))) {
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
    if (otherAtomId === atomId || !isVisiblePresentationAtom(layoutGraph, otherAtomId) || layoutGraph.bondedPairSet.has(atomPairKey(atomId, otherAtomId))) {
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
 * @param {{force?: boolean, bondValidationClasses?: Map<string, string>, incumbentAudit?: object|null, acceptNonRegressingAudit?: boolean}} [options] - Compression options.
 * @returns {Map<string, {x: number, y: number}>|null} Compressed target positions, or null.
 */
function compressedTerminalMultipleBondLeafTargetPositions(layoutGraph, coords, descriptor, targetPositions, bondLength, options = {}) {
  const centerPosition = coords.get(descriptor.centerAtomId);
  if (!centerPosition) {
    return null;
  }

  const triggerClearance = bondLength * TERMINAL_MULTIPLE_BOND_LEAF_COMPRESSION_TRIGGER_FACTOR;
  const targetClearance = bondLength * TERMINAL_MULTIPLE_BOND_LEAF_COMPRESSION_TARGET_FACTOR;
  const minimumForceClearance = bondLength * TERMINAL_MULTIPLE_BOND_LEAF_FORCE_CLEARANCE_FACTOR;
  const compressedTargetPositions = new Map(targetPositions);
  let changed = false;

  for (const { leafAtomId, targetAngle } of descriptor.leafTargets) {
    const targetPosition = compressedTargetPositions.get(leafAtomId);
    if (!targetPosition) {
      return null;
    }

    const fullLengthClearance = localNonbondedClearanceWithOverrides(layoutGraph, coords, leafAtomId, targetPosition, compressedTargetPositions);
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
      const candidateAudit = auditCandidateSafety(layoutGraph, candidateCoords, {
        bondLength,
        bondValidationClasses: options.bondValidationClasses
      });
      const auditAccepted =
        candidateAudit.ok === true ||
        (options.acceptNonRegressingAudit === true && terminalMultipleBondLeafFanAuditDoesNotRegress(candidateAudit, options.incumbentAudit, bondLength));
      if (!auditAccepted) {
        continue;
      }
      firstAuditCleanPosition ??= candidatePosition;
      const candidateClearance = localNonbondedClearanceWithOverrides(layoutGraph, coords, leafAtomId, candidatePosition, candidatePositions);
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
        leafAtomIds.has(otherAtomId) ||
        otherAtomId === descriptor.centerAtomId ||
        !isVisiblePresentationAtom(layoutGraph, otherAtomId) ||
        layoutGraph.bondedPairSet.has(atomPairKey(leafAtomId, otherAtomId))
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
    minimumClearance = Math.min(minimumClearance, localNonbondedClearanceWithOverrides(layoutGraph, coords, leafAtomId, targetPosition, overridePositions));
  }
  return minimumClearance;
}

function terminalMultipleBondLeafFanBlockerReliefScore(layoutGraph, coords, descriptor, overridePositions, bondLength, rotationAngle) {
  const candidateCoords = new Map(coords);
  for (const [atomId, position] of overridePositions) {
    candidateCoords.set(atomId, position);
  }
  if (auditCandidateSafety(layoutGraph, candidateCoords, { bondLength }).ok !== true) {
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

function terminalMultipleBondLeafFanProtectedBranchReliefDescriptors(layoutGraph, coords, blockingAtomId, protectedAtomIds, frozenAtomIds) {
  const descriptors = [];
  const seenKeys = new Set();
  for (const anchorAtomId of protectedAtomIds) {
    const anchorAtom = layoutGraph.atoms.get(anchorAtomId);
    if (!anchorAtom || anchorAtom.element === 'H' || !coords.has(anchorAtomId)) {
      continue;
    }
    for (const bond of layoutGraph.bondsByAtomId.get(anchorAtomId) ?? []) {
      if (!bond || bond.kind !== 'covalent') {
        continue;
      }
      const rootAtomId = bond.a === anchorAtomId ? bond.b : bond.a;
      if (protectedAtomIds.has(rootAtomId) || (frozenAtomIds instanceof Set && frozenAtomIds.has(rootAtomId))) {
        continue;
      }
      const subtreeAtomIds = collectCovalentSubtreeAtomIds(layoutGraph, rootAtomId, anchorAtomId).filter(atomId => coords.has(atomId) && isVisiblePresentationAtom(layoutGraph, atomId));
      if (
        !subtreeAtomIds.includes(blockingAtomId) ||
        subtreeAtomIds.some(atomId => protectedAtomIds.has(atomId) || (frozenAtomIds instanceof Set && frozenAtomIds.has(atomId))) ||
        heavyAtomCountInIds(layoutGraph, subtreeAtomIds) > TERMINAL_MULTIPLE_BOND_SUPPORT_SUBTREE_HEAVY_LIMIT
      ) {
        continue;
      }
      const key = `${anchorAtomId}|${rootAtomId}|${subtreeAtomIds.join(',')}`;
      if (seenKeys.has(key)) {
        continue;
      }
      seenKeys.add(key);
      descriptors.push({ anchorAtomId, rootAtomId, subtreeAtomIds });
    }
  }
  return descriptors;
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

function isBetterTerminalMultipleBondLeafFanTerminalBlockerReliefCandidate(candidate, incumbent) {
  if (!incumbent) {
    return true;
  }
  if (Math.abs(candidate.fanPenalty - incumbent.fanPenalty) > TERMINAL_MULTIPLE_BOND_FAN_IMPROVEMENT_EPSILON) {
    return candidate.fanPenalty < incumbent.fanPenalty;
  }
  if (Math.abs(candidate.blockerCenterDeviation - incumbent.blockerCenterDeviation) > TIDY_IMPROVEMENT_EPSILON) {
    return candidate.blockerCenterDeviation < incumbent.blockerCenterDeviation;
  }
  if ((candidate.audit.labelOverlapCount ?? 0) !== (incumbent.audit.labelOverlapCount ?? 0)) {
    return (candidate.audit.labelOverlapCount ?? 0) < (incumbent.audit.labelOverlapCount ?? 0);
  }
  if (Math.abs(candidate.clearanceDeficit - incumbent.clearanceDeficit) > TIDY_IMPROVEMENT_EPSILON) {
    return candidate.clearanceDeficit < incumbent.clearanceDeficit;
  }
  return candidate.rotationMagnitude < incumbent.rotationMagnitude - TIDY_IMPROVEMENT_EPSILON;
}

function terminalMultipleBondLeafFanTerminalBlockerReliefTargetPositions(layoutGraph, coords, descriptor, targetPositions, bondLength, threshold, frozenAtomIds) {
  const blockingAtomIds = terminalMultipleBondLeafFanBlockingAtomIds(layoutGraph, coords, descriptor, targetPositions, threshold);
  if (blockingAtomIds.length === 0) {
    return null;
  }

  const protectedAtomIds = new Set([descriptor.centerAtomId, ...descriptor.neighborAtomIds]);
  let bestCandidate = null;
  for (const blockingAtomId of blockingAtomIds) {
    if (protectedAtomIds.has(blockingAtomId) || (frozenAtomIds instanceof Set && frozenAtomIds.has(blockingAtomId))) {
      continue;
    }
    const blockerDescriptor = terminalMultipleBondBlockerDescriptor(layoutGraph, coords, blockingAtomId);
    if (!blockerDescriptor || protectedAtomIds.has(blockerDescriptor.centerAtomId)) {
      continue;
    }

    const blockerCenterPosition = coords.get(blockerDescriptor.centerAtomId);
    const blockerPosition = coords.get(blockingAtomId);
    if (!blockerCenterPosition || !blockerPosition) {
      continue;
    }

    const blockerRadius = distance(blockerCenterPosition, blockerPosition) || bondLength;
    const blockerAngle = angleOf(sub(blockerPosition, blockerCenterPosition));
    const blockerAtom = layoutGraph.atoms.get(blockingAtomId);
    const blockerCenterAtom = layoutGraph.atoms.get(blockerDescriptor.centerAtomId);
    if (blockerAtom?.element === 'O' && blockerCenterAtom?.element === 'C') {
      for (const compressionFactor of TERMINAL_MULTIPLE_BOND_LEAF_COMPRESSION_FACTORS) {
        const compressedRadius = bondLength * compressionFactor;
        if (compressedRadius >= blockerRadius - TIDY_IMPROVEMENT_EPSILON) {
          continue;
        }
        const candidateBlockerPosition = add(blockerCenterPosition, fromAngle(blockerAngle, compressedRadius));
        const candidateTargetPositions = new Map(targetPositions);
        candidateTargetPositions.set(blockingAtomId, candidateBlockerPosition);
        const candidateCoords = new Map(coords);
        for (const [atomId, position] of candidateTargetPositions) {
          candidateCoords.set(atomId, position);
        }

        const audit = auditLayout(layoutGraph, candidateCoords, { bondLength, includeVisibleHeavyBondCrossings: false });
        if (audit.ok !== true) {
          continue;
        }
        const fanPenalty = terminalMultipleBondLeafFanPenalty(candidateCoords, descriptor.centerAtomId, descriptor.neighborAtomIds);
        if (fanPenalty > descriptor.currentPenalty + TERMINAL_MULTIPLE_BOND_FAN_IMPROVEMENT_EPSILON) {
          continue;
        }

        const clearance = terminalMultipleBondLeafReliefClearance(layoutGraph, coords, descriptor, candidateTargetPositions);
        const candidate = {
          targetPositions: candidateTargetPositions,
          audit,
          fanPenalty,
          blockerCenterDeviation: 0,
          clearanceDeficit: Math.max(0, bondLength * TERMINAL_MULTIPLE_BOND_BLOCKER_RELIEF_CLEARANCE_FACTOR - clearance),
          rotationMagnitude: blockerRadius - compressedRadius
        };
        if (isBetterTerminalMultipleBondLeafFanTerminalBlockerReliefCandidate(candidate, bestCandidate)) {
          bestCandidate = candidate;
        }
      }
    }
    for (const reliefOffset of TERMINAL_HETERO_BLOCKER_RELIEF_OFFSETS) {
      const candidateBlockerPosition = add(blockerCenterPosition, fromAngle(blockerAngle + reliefOffset, blockerRadius));
      const candidateTargetPositions = new Map(targetPositions);
      candidateTargetPositions.set(blockingAtomId, candidateBlockerPosition);
      const candidateCoords = new Map(coords);
      for (const [atomId, position] of candidateTargetPositions) {
        candidateCoords.set(atomId, position);
      }

      const audit = auditLayout(layoutGraph, candidateCoords, { bondLength, includeVisibleHeavyBondCrossings: false });
      if (audit.ok !== true) {
        continue;
      }
      const blockerCenterDeviation = threeHeavyCenterMaxDeviation(candidateCoords, blockerDescriptor.centerAtomId, blockerDescriptor.heavyNeighborIds);
      if (blockerCenterDeviation > TERMINAL_HETERO_BLOCKER_MAX_CENTER_DEVIATION + TIDY_IMPROVEMENT_EPSILON) {
        continue;
      }
      const fanPenalty = terminalMultipleBondLeafFanPenalty(candidateCoords, descriptor.centerAtomId, descriptor.neighborAtomIds);
      if (fanPenalty > descriptor.currentPenalty + TERMINAL_MULTIPLE_BOND_FAN_IMPROVEMENT_EPSILON) {
        continue;
      }

      const clearance = terminalMultipleBondLeafReliefClearance(layoutGraph, coords, descriptor, candidateTargetPositions);
      const candidate = {
        targetPositions: candidateTargetPositions,
        audit,
        fanPenalty,
        blockerCenterDeviation,
        clearanceDeficit: Math.max(0, bondLength * TERMINAL_MULTIPLE_BOND_BLOCKER_RELIEF_CLEARANCE_FACTOR - clearance),
        rotationMagnitude: Math.abs(reliefOffset)
      };
      if (isBetterTerminalMultipleBondLeafFanTerminalBlockerReliefCandidate(candidate, bestCandidate)) {
        bestCandidate = candidate;
      }
    }
  }

  return bestCandidate?.targetPositions ?? null;
}

function isBetterTerminalMultipleBondLeafFanCenterBranchReliefCandidate(candidate, incumbent) {
  if (!incumbent) {
    return true;
  }
  if ((candidate.audit.labelOverlapCount ?? 0) !== (incumbent.audit.labelOverlapCount ?? 0)) {
    return (candidate.audit.labelOverlapCount ?? 0) < (incumbent.audit.labelOverlapCount ?? 0);
  }
  if (Math.abs(candidate.maxCenterDeviation - incumbent.maxCenterDeviation) > TIDY_IMPROVEMENT_EPSILON) {
    return candidate.maxCenterDeviation < incumbent.maxCenterDeviation;
  }
  if (Math.abs(candidate.totalCenterDeviation - incumbent.totalCenterDeviation) > TIDY_IMPROVEMENT_EPSILON) {
    return candidate.totalCenterDeviation < incumbent.totalCenterDeviation;
  }
  if (Math.abs(candidate.clearanceDeficit - incumbent.clearanceDeficit) > TIDY_IMPROVEMENT_EPSILON) {
    return candidate.clearanceDeficit < incumbent.clearanceDeficit;
  }
  return candidate.rotationMagnitude < incumbent.rotationMagnitude - TIDY_IMPROVEMENT_EPSILON;
}

function terminalMultipleBondLeafFanMovedBlockerMaxDeviation(layoutGraph, coords, descriptor, targetPositions) {
  const protectedAtomIds = new Set([descriptor.centerAtomId, ...descriptor.neighborAtomIds]);
  let maxDeviation = 0;
  for (const atomId of targetPositions.keys()) {
    if (protectedAtomIds.has(atomId)) {
      continue;
    }
    const blockerDescriptor = terminalMultipleBondBlockerDescriptor(layoutGraph, coords, atomId);
    if (!blockerDescriptor) {
      continue;
    }
    maxDeviation = Math.max(maxDeviation, threeHeavyCenterMaxDeviation(coords, blockerDescriptor.centerAtomId, blockerDescriptor.heavyNeighborIds));
  }
  return maxDeviation;
}

function terminalMultipleBondLeafFanCenterBranchReliefTargetPositions(layoutGraph, coords, descriptor, targetPositions, bondLength, threshold, frozenAtomIds) {
  if (descriptor.leafTargets.length !== 2) {
    return null;
  }

  const leafAtomIds = new Set(descriptor.leafTargets.map(({ leafAtomId }) => leafAtomId));
  const fixedNeighborIds = descriptor.neighborAtomIds.filter(neighborAtomId => !leafAtomIds.has(neighborAtomId));
  if (fixedNeighborIds.length !== 1) {
    return null;
  }

  const anchorAtomId = fixedNeighborIds[0];
  const anchorAtom = layoutGraph.atoms.get(anchorAtomId);
  const centerAtom = layoutGraph.atoms.get(descriptor.centerAtomId);
  const anchorPosition = coords.get(anchorAtomId);
  const centerPosition = coords.get(descriptor.centerAtomId);
  if (
    !anchorAtom ||
    !centerAtom ||
    !layoutGraph.ringAtomIdSet.has(anchorAtomId) ||
    layoutGraph.ringAtomIdSet.has(descriptor.centerAtomId) ||
    !anchorPosition ||
    !centerPosition ||
    (frozenAtomIds instanceof Set && (frozenAtomIds.has(descriptor.centerAtomId) || [...leafAtomIds].some(leafAtomId => frozenAtomIds.has(leafAtomId))))
  ) {
    return null;
  }

  const anchorNeighborIds = visibleHeavyCovalentBonds(layoutGraph, coords, anchorAtomId).map(({ neighborAtomId }) => neighborAtomId);
  if (anchorNeighborIds.length !== 3 || !anchorNeighborIds.includes(descriptor.centerAtomId)) {
    return null;
  }

  const currentCenterAngle = angleOf(sub(centerPosition, anchorPosition));
  const centerRadius = distance(anchorPosition, centerPosition) || bondLength;
  const currentLeafAngles = new Map([...leafAtomIds].map(leafAtomId => [leafAtomId, angleOf(sub(coords.get(leafAtomId), centerPosition))]));
  let bestCandidate = null;
  for (const rotationOffset of TERMINAL_MULTIPLE_BOND_CENTER_BRANCH_RELIEF_ROTATIONS) {
    const candidateCenterPosition = add(anchorPosition, fromAngle(currentCenterAngle + rotationOffset, centerRadius));
    const fixedAngle = angleOf(sub(anchorPosition, candidateCenterPosition));
    const leafTargets = assignTerminalMultipleBondLeafTargets([...leafAtomIds], currentLeafAngles, [fixedAngle + (2 * Math.PI) / 3, fixedAngle - (2 * Math.PI) / 3]);
    if (!leafTargets) {
      continue;
    }

    let candidateTargetPositions = new Map(targetPositions);
    candidateTargetPositions.set(descriptor.centerAtomId, candidateCenterPosition);
    for (const { leafAtomId, targetAngle } of leafTargets) {
      const leafPosition = coords.get(leafAtomId);
      if (!leafPosition) {
        candidateTargetPositions.clear();
        break;
      }
      const leafRadius = distance(centerPosition, leafPosition) || bondLength;
      candidateTargetPositions.set(leafAtomId, add(candidateCenterPosition, fromAngle(targetAngle, leafRadius)));
    }
    if (candidateTargetPositions.size === 0) {
      continue;
    }

    let candidateCoords = new Map(coords);
    for (const [atomId, position] of candidateTargetPositions) {
      candidateCoords.set(atomId, position);
    }
    let audit = auditLayout(layoutGraph, candidateCoords, { bondLength, includeVisibleHeavyBondCrossings: false });
    if (audit.ok !== true) {
      const relievedTargetPositions = terminalMultipleBondLeafFanTerminalBlockerReliefTargetPositions(layoutGraph, coords, descriptor, candidateTargetPositions, bondLength, threshold, frozenAtomIds);
      if (!relievedTargetPositions) {
        continue;
      }
      candidateTargetPositions = relievedTargetPositions;
      candidateCoords = new Map(coords);
      for (const [atomId, position] of candidateTargetPositions) {
        candidateCoords.set(atomId, position);
      }
      audit = auditLayout(layoutGraph, candidateCoords, { bondLength, includeVisibleHeavyBondCrossings: false });
    }
    if (audit.ok !== true) {
      continue;
    }
    const anchorDeviation = threeHeavyCenterMaxDeviation(candidateCoords, anchorAtomId, anchorNeighborIds);
    if (anchorDeviation > TERMINAL_MULTIPLE_BOND_CENTER_BRANCH_MAX_ANCHOR_DEVIATION + TIDY_IMPROVEMENT_EPSILON) {
      continue;
    }
    const fanPenalty = terminalMultipleBondLeafFanPenalty(candidateCoords, descriptor.centerAtomId, descriptor.neighborAtomIds);
    if (fanPenalty > descriptor.currentPenalty + TERMINAL_MULTIPLE_BOND_FAN_IMPROVEMENT_EPSILON) {
      continue;
    }
    const blockerCenterDeviation = terminalMultipleBondLeafFanMovedBlockerMaxDeviation(layoutGraph, candidateCoords, descriptor, candidateTargetPositions);

    const clearance = terminalMultipleBondLeafReliefClearance(layoutGraph, coords, descriptor, candidateTargetPositions);
    const candidate = {
      targetPositions: candidateTargetPositions,
      audit,
      anchorDeviation,
      blockerCenterDeviation,
      maxCenterDeviation: Math.max(anchorDeviation, blockerCenterDeviation),
      totalCenterDeviation: anchorDeviation + blockerCenterDeviation,
      clearanceDeficit: Math.max(0, bondLength * TERMINAL_MULTIPLE_BOND_BLOCKER_RELIEF_CLEARANCE_FACTOR - clearance),
      rotationMagnitude: Math.abs(rotationOffset)
    };
    if (isBetterTerminalMultipleBondLeafFanCenterBranchReliefCandidate(candidate, bestCandidate)) {
      bestCandidate = candidate;
    }
  }

  return bestCandidate?.targetPositions ?? null;
}

function terminalMultipleBondLeafFanSingleLeafCenterBranchReliefTargetPositions(layoutGraph, coords, descriptor, targetPositions, bondLength, frozenAtomIds) {
  if (descriptor.leafTargets.length !== 1) {
    return null;
  }

  const leafAtomId = descriptor.leafTargets[0].leafAtomId;
  const fixedNeighborIds = descriptor.neighborAtomIds.filter(neighborAtomId => neighborAtomId !== leafAtomId);
  if (fixedNeighborIds.length !== 2) {
    return null;
  }

  const centerAtom = layoutGraph.atoms.get(descriptor.centerAtomId);
  const centerPosition = coords.get(descriptor.centerAtomId);
  if (!centerAtom || layoutGraph.ringAtomIdSet.has(descriptor.centerAtomId) || !centerPosition) {
    return null;
  }

  let bestCandidate = null;
  for (const supportAtomId of fixedNeighborIds) {
    const supportAtom = layoutGraph.atoms.get(supportAtomId);
    const supportPosition = coords.get(supportAtomId);
    if (!supportAtom || supportAtom.aromatic !== true || !layoutGraph.ringAtomIdSet.has(supportAtomId) || !supportPosition) {
      continue;
    }
    const movedAtomIds = collectCovalentSubtreeAtomIds(layoutGraph, descriptor.centerAtomId, supportAtomId).filter(atomId => coords.has(atomId) && isVisiblePresentationAtom(layoutGraph, atomId));
    const otherFixedNeighborId = fixedNeighborIds.find(neighborAtomId => neighborAtomId !== supportAtomId);
    if (
      movedAtomIds.length === 0 ||
      !movedAtomIds.includes(descriptor.centerAtomId) ||
      !movedAtomIds.includes(leafAtomId) ||
      !movedAtomIds.includes(otherFixedNeighborId) ||
      heavyAtomCountInIds(layoutGraph, movedAtomIds) > TERMINAL_MULTIPLE_BOND_SUPPORT_SUBTREE_HEAVY_LIMIT ||
      (frozenAtomIds instanceof Set && movedAtomIds.some(atomId => frozenAtomIds.has(atomId)))
    ) {
      continue;
    }

    const supportNeighborIds = visibleHeavyCovalentBonds(layoutGraph, coords, supportAtomId).map(({ neighborAtomId }) => neighborAtomId);
    if (supportNeighborIds.length !== 3 || !supportNeighborIds.includes(descriptor.centerAtomId)) {
      continue;
    }

    for (const rotationOffset of TERMINAL_MULTIPLE_BOND_CENTER_BRANCH_RELIEF_ROTATIONS) {
      if (Math.abs(rotationOffset) <= TIDY_IMPROVEMENT_EPSILON) {
        continue;
      }

      const rotatedCoords = rotateAtomIdsAroundPivot(coords, movedAtomIds, supportAtomId, rotationOffset);
      if (!rotatedCoords) {
        continue;
      }
      const exactLeafPosition = exactTerminalMultipleBondLeafTargetPosition(rotatedCoords, descriptor);
      if (!exactLeafPosition) {
        continue;
      }

      const candidateTargetPositions = new Map();
      for (const atomId of movedAtomIds) {
        const position = rotatedCoords.get(atomId);
        if (position) {
          candidateTargetPositions.set(atomId, position);
        }
      }
      candidateTargetPositions.set(leafAtomId, exactLeafPosition);
      for (const [atomId, position] of targetPositions) {
        candidateTargetPositions.set(atomId, atomId === leafAtomId ? exactLeafPosition : position);
      }

      const candidateCoords = new Map(coords);
      for (const [atomId, position] of candidateTargetPositions) {
        candidateCoords.set(atomId, position);
      }
      const audit = auditLayout(layoutGraph, candidateCoords, { bondLength, includeVisibleHeavyBondCrossings: false });
      if (audit.ok !== true) {
        continue;
      }

      const supportDeviation = threeHeavyCenterMaxDeviation(candidateCoords, supportAtomId, supportNeighborIds);
      if (supportDeviation > TERMINAL_MULTIPLE_BOND_CENTER_BRANCH_MAX_ANCHOR_DEVIATION + TIDY_IMPROVEMENT_EPSILON) {
        continue;
      }
      const fanPenalty = terminalMultipleBondLeafFanPenalty(candidateCoords, descriptor.centerAtomId, descriptor.neighborAtomIds);
      if (fanPenalty > descriptor.currentPenalty + TERMINAL_MULTIPLE_BOND_FAN_IMPROVEMENT_EPSILON) {
        continue;
      }

      const clearance = terminalMultipleBondLeafReliefClearance(layoutGraph, coords, descriptor, candidateTargetPositions);
      const candidate = {
        targetPositions: candidateTargetPositions,
        audit,
        maxCenterDeviation: supportDeviation,
        totalCenterDeviation: supportDeviation,
        clearanceDeficit: Math.max(0, bondLength * TERMINAL_MULTIPLE_BOND_BLOCKER_RELIEF_CLEARANCE_FACTOR - clearance),
        rotationMagnitude: Math.abs(rotationOffset)
      };
      if (isBetterTerminalMultipleBondLeafFanCenterBranchReliefCandidate(candidate, bestCandidate)) {
        bestCandidate = candidate;
      }
    }
  }

  return bestCandidate?.targetPositions ?? null;
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
function terminalMultipleBondLeafFanBlockerReliefTargetPositions(layoutGraph, coords, descriptor, targetPositions, bondLength, threshold, frozenAtomIds) {
  const blockingAtomIds = terminalMultipleBondLeafFanBlockingAtomIds(layoutGraph, coords, descriptor, targetPositions, threshold);
  if (blockingAtomIds.length === 0) {
    return null;
  }
  const rigidSubtreesByAtomId = (layoutGraph._terminalMultipleBondLeafFanRigidSubtreesByAtomId ??= collectRigidPendantRingSubtrees(layoutGraph));
  const protectedAtomIds = new Set([descriptor.centerAtomId, ...descriptor.neighborAtomIds]);
  let bestTargetPositions = null;
  let bestScore = null;

  for (const blockingAtomId of blockingAtomIds) {
    const rigidDescriptor = rigidSubtreesByAtomId.get(blockingAtomId);
    if (
      rigidDescriptor &&
      !rigidDescriptor.subtreeAtomIds.some(atomId => protectedAtomIds.has(atomId)) &&
      !(frozenAtomIds instanceof Set && rigidDescriptor.subtreeAtomIds.some(atomId => frozenAtomIds.has(atomId)))
    ) {
      for (const rotationAngle of TERMINAL_MULTIPLE_BOND_BLOCKER_RELIEF_ROTATIONS) {
        const blockerPositions = rotateRigidDescriptorPositions(coords, rigidDescriptor, rotationAngle);
        if (!blockerPositions) {
          continue;
        }
        const candidateTargetPositions = new Map([...targetPositions, ...blockerPositions]);
        const candidateScore = terminalMultipleBondLeafFanBlockerReliefScore(layoutGraph, coords, descriptor, candidateTargetPositions, bondLength, rotationAngle);
        if (!candidateScore) {
          continue;
        }
        if (isBetterTerminalMultipleBondLeafFanBlockerReliefScore(candidateScore, bestScore)) {
          bestScore = candidateScore;
          bestTargetPositions = candidateTargetPositions;
        }
      }
    }

    for (const branchDescriptor of terminalMultipleBondLeafFanProtectedBranchReliefDescriptors(layoutGraph, coords, blockingAtomId, protectedAtomIds, frozenAtomIds)) {
      for (const rotationAngle of TERMINAL_MULTIPLE_BOND_BLOCKER_RELIEF_ROTATIONS) {
        const blockerPositions = rotateRigidDescriptorPositions(coords, branchDescriptor, rotationAngle);
        if (!blockerPositions) {
          continue;
        }
        const candidateTargetPositions = new Map([...targetPositions, ...blockerPositions]);
        const candidateScore = terminalMultipleBondLeafFanBlockerReliefScore(layoutGraph, coords, descriptor, candidateTargetPositions, bondLength, rotationAngle);
        if (!candidateScore) {
          continue;
        }
        if (isBetterTerminalMultipleBondLeafFanBlockerReliefScore(candidateScore, bestScore)) {
          bestScore = candidateScore;
          bestTargetPositions = candidateTargetPositions;
        }
      }
    }
  }

  return bestTargetPositions;
}

/**
 * Finds a bounded partial move toward the exact terminal leaf fan target when
 * the exact trigonal slot is blocked. Candidates are audit-gated and must
 * reduce the local fan penalty, so shallow probes can improve bridged-ring
 * imine readability without accepting new overlaps or bond failures.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Coordinate map.
 * @param {object} descriptor - Terminal multiple-bond fan descriptor.
 * @param {number} bondLength - Target bond length.
 * @param {Map<string, string>|null} [bondValidationClasses] - Per-bond validation classes for layout audit.
 * @returns {Map<string, {x: number, y: number}>|null} Sparse leaf target positions, or null when no partial move is audit-clean.
 */
function terminalMultipleBondLeafPartialBackoffTargetPositions(layoutGraph, coords, descriptor, bondLength, bondValidationClasses = null) {
  if (descriptor.leafTargets.length !== 1) {
    return null;
  }
  const { leafAtomId, targetAngle } = descriptor.leafTargets[0];
  const centerPosition = coords.get(descriptor.centerAtomId);
  const leafPosition = coords.get(leafAtomId);
  if (!centerPosition || !leafPosition) {
    return null;
  }
  const radius = distance(centerPosition, leafPosition);
  if (radius <= TIDY_IMPROVEMENT_EPSILON) {
    return null;
  }
  const currentAngle = angleOf(sub(leafPosition, centerPosition));
  const rotation = wrapAngle(targetAngle - currentAngle);
  if (Math.abs(rotation) <= TIDY_IMPROVEMENT_EPSILON) {
    return null;
  }

  let best = null;
  for (const fraction of TERMINAL_MULTIPLE_BOND_LEAF_PARTIAL_FAN_FRACTIONS) {
    const candidatePosition = add(centerPosition, fromAngle(currentAngle + rotation * fraction, radius));
    const candidateCoords = new Map(coords);
    candidateCoords.set(leafAtomId, candidatePosition);
    if (auditCandidateSafety(layoutGraph, candidateCoords, { bondLength, bondValidationClasses }).ok !== true) {
      continue;
    }
    const penalty = terminalMultipleBondLeafFanPenalty(candidateCoords, descriptor.centerAtomId, descriptor.neighborAtomIds);
    if (penalty >= descriptor.currentPenalty - TERMINAL_MULTIPLE_BOND_FAN_IMPROVEMENT_EPSILON) {
      continue;
    }
    const clearance = terminalMultipleBondLeafReliefClearance(layoutGraph, coords, descriptor, new Map([[leafAtomId, candidatePosition]]));
    const candidate = {
      targetPositions: new Map([[leafAtomId, candidatePosition]]),
      penalty,
      clearance,
      rotationMagnitude: Math.abs(rotation * fraction)
    };
    if (
      !best ||
      candidate.penalty < best.penalty - TERMINAL_MULTIPLE_BOND_FAN_IMPROVEMENT_EPSILON ||
      (Math.abs(candidate.penalty - best.penalty) <= TERMINAL_MULTIPLE_BOND_FAN_IMPROVEMENT_EPSILON && candidate.clearance > best.clearance + TIDY_IMPROVEMENT_EPSILON) ||
      (Math.abs(candidate.penalty - best.penalty) <= TERMINAL_MULTIPLE_BOND_FAN_IMPROVEMENT_EPSILON &&
        Math.abs(candidate.clearance - best.clearance) <= TIDY_IMPROVEMENT_EPSILON &&
        candidate.rotationMagnitude < best.rotationMagnitude - TIDY_IMPROVEMENT_EPSILON)
    ) {
      best = candidate;
    }
  }
  return best?.targetPositions ?? null;
}

function scoreTerminalHeteroPosition(layoutGraph, coords, descriptor, atomGrid, ringPolygons, position, candidateAngle, currentAngle, threshold, searchRadius, bondLength) {
  const anchorPosition = coords.get(descriptor.anchorAtomId);
  return {
    position,
    insideRingCount: countPointInPolygons(ringPolygons, position),
    overlapCount: localSevereOverlapCount(layoutGraph, coords, atomGrid, descriptor.heteroAtomId, position, threshold),
    clearance: localNonbondedClearance(layoutGraph, coords, atomGrid, descriptor.heteroAtomId, position, searchRadius),
    terminalBondLengthDeviation: descriptor.prefersOutwardGeometry && anchorPosition ? Math.abs(distance(anchorPosition, position) - bondLength) : 0,
    prefersOutwardGeometry: descriptor.prefersOutwardGeometry,
    outwardDeviation: descriptor.prefersOutwardGeometry ? Math.min(...descriptor.outwardAngles.map(outwardAngle => angularDifference(outwardAngle, candidateAngle))) : 0,
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
    overridePositions.set(descriptor.hydrogenAtomIds[0], add(heteroPosition, fromAngle(candidateAngle, bondLength)));
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
  return anchorAtom.aromatic !== true && (anchorAtom.heavyDegree ?? 0) >= 4 && (layoutGraph.ringCountByAtomId.get(anchorAtomId) ?? 0) > 1;
}

/**
 * Re-centers terminal multiple-bond hetero leaves onto an improved trigonal fan,
 * including equivalent fan slots that clear local contacts without increasing
 * overlaps, when either one leaf or a paired set can move safely.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} inputCoords - Coordinate map.
 * @param {object} [options] - Hook options.
 * @param {number} [options.bondLength] - Target bond length.
 * @param {Set<string>|null} [options.frozenAtomIds] - Frozen atoms that must not move.
 * @param {Map<string, string>|null} [options.bondValidationClasses] - Per-bond validation classes for audit-safe compressed candidates.
 * @returns {{coords: Map<string, {x: number, y: number}>, nudges: number}} Adjusted coordinates and move count.
 */
export function runTerminalMultipleBondLeafFanTidy(layoutGraph, inputCoords, options = {}) {
  const bondLength = options.bondLength ?? layoutGraph.options.bondLength;
  const frozenAtomIds = options.frozenAtomIds ?? null;
  const bondValidationClasses = options.bondValidationClasses ?? null;
  const threshold = bondLength * 0.55;
  const hasExplicitCandidateCenterIds = Array.isArray(options.candidateCenterIds);
  const hasExplicitHiddenHydrogenCandidateCenterIds = Array.isArray(options.hiddenHydrogenCandidateCenterIds);
  const candidateCenterIds = hasExplicitCandidateCenterIds ? [...new Set(options.candidateCenterIds)].filter(centerAtomId => inputCoords.has(centerAtomId)) : [];
  const hiddenHydrogenCandidateCenterIds = hasExplicitHiddenHydrogenCandidateCenterIds
    ? [...new Set(options.hiddenHydrogenCandidateCenterIds)].filter(centerAtomId => inputCoords.has(centerAtomId))
    : [];
  const visibleCandidateCenterIdSet = new Set(candidateCenterIds);
  if (!hasExplicitCandidateCenterIds || !hasExplicitHiddenHydrogenCandidateCenterIds) {
    for (const centerAtomId of terminalMultipleBondFanStructuralCenterIds(layoutGraph)) {
      if (!inputCoords.has(centerAtomId)) {
        continue;
      }
      let hasVisibleCandidate = visibleCandidateCenterIdSet.has(centerAtomId);
      if (!hasExplicitCandidateCenterIds && terminalMultipleBondLeafFanDescriptor(layoutGraph, inputCoords, centerAtomId, frozenAtomIds)) {
        candidateCenterIds.push(centerAtomId);
        visibleCandidateCenterIdSet.add(centerAtomId);
        hasVisibleCandidate = true;
      }
      if (!hasExplicitHiddenHydrogenCandidateCenterIds && !hasVisibleCandidate && hiddenHydrogenTerminalMultipleBondFanDescriptor(layoutGraph, inputCoords, centerAtomId, frozenAtomIds)) {
        hiddenHydrogenCandidateCenterIds.push(centerAtomId);
      }
    }
  }
  if (candidateCenterIds.length === 0 && hiddenHydrogenCandidateCenterIds.length === 0) {
    return { coords: inputCoords, nudges: 0 };
  }

  const coords = new Map([...inputCoords.entries()].map(([atomId, position]) => [atomId, { ...position }]));
  const atomGrid = buildAtomGrid(layoutGraph, coords, bondLength);
  let currentAudit = null;
  const getCurrentAudit = () => {
    currentAudit ??= auditLayout(layoutGraph, coords, { bondLength, bondValidationClasses });
    return currentAudit;
  };
  let nudges = 0;

  for (const centerAtomId of candidateCenterIds) {
    const descriptor = terminalMultipleBondLeafFanDescriptor(layoutGraph, coords, centerAtomId, frozenAtomIds);
    if (!descriptor) {
      continue;
    }

    const centerPosition = coords.get(descriptor.centerAtomId);
    if (!centerPosition) {
      continue;
    }

    const exactSupportReliefCoords =
      descriptor.movesTerminalSingleHeteroLeaf === true ? null : terminalMultipleBondExactSupportReliefCoords(layoutGraph, coords, descriptor, bondLength, frozenAtomIds, bondValidationClasses);
    if (exactSupportReliefCoords) {
      for (const [atomId, nextPosition] of exactSupportReliefCoords) {
        const previousPosition = coords.get(atomId);
        if (!previousPosition || (Math.abs(previousPosition.x - nextPosition.x) <= TIDY_IMPROVEMENT_EPSILON && Math.abs(previousPosition.y - nextPosition.y) <= TIDY_IMPROVEMENT_EPSILON)) {
          continue;
        }
        atomGrid.remove(atomId, previousPosition);
        atomGrid.insert(atomId, nextPosition);
      }
      coords.clear();
      for (const [atomId, position] of exactSupportReliefCoords) {
        coords.set(atomId, { ...position });
      }
      currentAudit = null;
      nudges++;
      continue;
    }

    const balancedSupportReliefCoords =
      descriptor.movesTerminalSingleHeteroLeaf === true ? null : terminalMultipleBondBalancedSupportReliefCoords(layoutGraph, coords, descriptor, bondLength, frozenAtomIds);
    if (balancedSupportReliefCoords) {
      for (const [atomId, nextPosition] of balancedSupportReliefCoords) {
        const previousPosition = coords.get(atomId);
        if (!previousPosition || (Math.abs(previousPosition.x - nextPosition.x) <= TIDY_IMPROVEMENT_EPSILON && Math.abs(previousPosition.y - nextPosition.y) <= TIDY_IMPROVEMENT_EPSILON)) {
          continue;
        }
        atomGrid.remove(atomId, previousPosition);
        atomGrid.insert(atomId, nextPosition);
      }
      coords.clear();
      for (const [atomId, position] of balancedSupportReliefCoords) {
        coords.set(atomId, { ...position });
      }
      currentAudit = null;
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
    const exactCandidateAudit = auditLayout(layoutGraph, exactCandidateCoords, {
      bondLength,
      bondValidationClasses
    });
    const exactCandidateAuditAccepted = terminalMultipleBondLeafFanAuditDoesNotRegress(exactCandidateAudit, getCurrentAudit(), bondLength);
    if (!exactCandidateAuditAccepted) {
      const compressedTargetPositions = compressedTerminalMultipleBondLeafTargetPositions(layoutGraph, coords, descriptor, targetPositions, bondLength, { force: true, bondValidationClasses });
      if (compressedTargetPositions) {
        targetPositions = compressedTargetPositions;
        usedCompressedTargetPositions = true;
      } else {
        const centerBranchReliefTargetPositions =
          terminalMultipleBondLeafFanCenterBranchReliefTargetPositions(layoutGraph, coords, descriptor, targetPositions, bondLength, threshold, frozenAtomIds) ??
          terminalMultipleBondLeafFanSingleLeafCenterBranchReliefTargetPositions(layoutGraph, coords, descriptor, targetPositions, bondLength, frozenAtomIds);
        const terminalBlockerReliefTargetPositions =
          centerBranchReliefTargetPositions ?? terminalMultipleBondLeafFanTerminalBlockerReliefTargetPositions(layoutGraph, coords, descriptor, targetPositions, bondLength, threshold, frozenAtomIds);
        const blockerReliefTargetPositions =
          terminalBlockerReliefTargetPositions ?? terminalMultipleBondLeafFanBlockerReliefTargetPositions(layoutGraph, coords, descriptor, targetPositions, bondLength, threshold, frozenAtomIds);
        if (!blockerReliefTargetPositions) {
          targetPositions = exactTargetPositions;
        } else {
          targetPositions = blockerReliefTargetPositions;
        }
      }
    } else if (exactCandidateAudit.ok === true) {
      const compressedTargetPositions = compressedTerminalMultipleBondLeafTargetPositions(layoutGraph, coords, descriptor, targetPositions, bondLength, { force: false, bondValidationClasses });
      if (compressedTargetPositions) {
        targetPositions = compressedTargetPositions;
        usedCompressedTargetPositions = true;
      }
    }
    for (const { leafAtomId } of descriptor.leafTargets) {
      const targetPosition = targetPositions.get(leafAtomId);
      if (!targetPosition) {
        targetOverlapCount = Number.POSITIVE_INFINITY;
        break;
      }
      targetOverlapCount += localSevereOverlapCountWithOverrides(layoutGraph, coords, leafAtomId, targetPosition, targetPositions, threshold);
    }
    if (targetOverlapCount > currentOverlapCount) {
      const compressedTargetPositions =
        usedCompressedTargetPositions === true
          ? null
          : compressedTerminalMultipleBondLeafTargetPositions(layoutGraph, coords, descriptor, targetPositions, bondLength, {
              force: true,
              bondValidationClasses,
              incumbentAudit: getCurrentAudit(),
              acceptNonRegressingAudit: true
            });
      if (compressedTargetPositions) {
        targetPositions = compressedTargetPositions;
        usedCompressedTargetPositions = true;
        targetOverlapCount = 0;
        for (const { leafAtomId } of descriptor.leafTargets) {
          const targetPosition = targetPositions.get(leafAtomId);
          if (!targetPosition) {
            targetOverlapCount = Number.POSITIVE_INFINITY;
            break;
          }
          targetOverlapCount += localSevereOverlapCountWithOverrides(layoutGraph, coords, leafAtomId, targetPosition, targetPositions, threshold);
        }
      }
    }
    if (targetOverlapCount > currentOverlapCount) {
      const backoffTargetPositions = terminalMultipleBondLeafPartialBackoffTargetPositions(layoutGraph, coords, descriptor, bondLength, bondValidationClasses);
      if (!backoffTargetPositions) {
        continue;
      }
      targetPositions = backoffTargetPositions;
      targetOverlapCount = 0;
      for (const { leafAtomId } of descriptor.leafTargets) {
        const targetPosition = targetPositions.get(leafAtomId);
        if (!targetPosition) {
          targetOverlapCount = Number.POSITIVE_INFINITY;
          break;
        }
        targetOverlapCount += localSevereOverlapCountWithOverrides(layoutGraph, coords, leafAtomId, targetPosition, targetPositions, threshold);
      }
      if (targetOverlapCount > currentOverlapCount) {
        continue;
      }
    }

    const candidateCoords = new Map(coords);
    for (const [leafAtomId, targetPosition] of targetPositions) {
      candidateCoords.set(leafAtomId, targetPosition);
    }
    const candidateAudit = auditLayout(layoutGraph, candidateCoords, { bondLength, bondValidationClasses });
    if (!terminalMultipleBondLeafFanAuditDoesNotRegress(candidateAudit, getCurrentAudit(), bondLength)) {
      continue;
    }
    const candidatePenalty = terminalMultipleBondLeafFanPenalty(candidateCoords, descriptor.centerAtomId, descriptor.neighborAtomIds);
    const currentLeafClearance = terminalMultipleBondLeafReliefClearance(
      layoutGraph,
      coords,
      descriptor,
      new Map(descriptor.leafTargets.map(({ leafAtomId }) => [leafAtomId, coords.get(leafAtomId)]).filter(([, position]) => !!position))
    );
    const targetLeafClearance = terminalMultipleBondLeafReliefClearance(layoutGraph, coords, descriptor, targetPositions);
    const compressedClearanceImproves =
      usedCompressedTargetPositions &&
      targetLeafClearance > currentLeafClearance + TIDY_IMPROVEMENT_EPSILON &&
      candidatePenalty <= descriptor.currentPenalty + TERMINAL_MULTIPLE_BOND_FAN_IMPROVEMENT_EPSILON;
    const equivalentSlotClearanceImproves =
      !usedCompressedTargetPositions &&
      targetLeafClearance > currentLeafClearance + TIDY_IMPROVEMENT_EPSILON &&
      candidatePenalty <= descriptor.currentPenalty + TERMINAL_MULTIPLE_BOND_FAN_IMPROVEMENT_EPSILON &&
      (targetOverlapCount < currentOverlapCount || (candidateAudit.severeOverlapCount ?? 0) < (getCurrentAudit().severeOverlapCount ?? 0));
    if (
      compressedClearanceImproves || equivalentSlotClearanceImproves
        ? false
        : usedCompressedTargetPositions
          ? candidatePenalty > descriptor.currentPenalty + TERMINAL_MULTIPLE_BOND_FAN_IMPROVEMENT_EPSILON
          : candidatePenalty >= descriptor.currentPenalty - TERMINAL_MULTIPLE_BOND_FAN_IMPROVEMENT_EPSILON
    ) {
      const backoffTargetPositions = terminalMultipleBondLeafPartialBackoffTargetPositions(layoutGraph, coords, descriptor, bondLength, bondValidationClasses);
      if (!backoffTargetPositions) {
        continue;
      }
      targetPositions = backoffTargetPositions;
    }

    for (const [leafAtomId, targetPosition] of targetPositions) {
      const leafPosition = coords.get(leafAtomId);
      atomGrid.remove(leafAtomId, leafPosition);
      leafPosition.x = targetPosition.x;
      leafPosition.y = targetPosition.y;
      atomGrid.insert(leafAtomId, leafPosition);
    }
    currentAudit = candidateAudit;
    nudges++;
  }

  if (hiddenHydrogenCandidateCenterIds.length > 0) {
    const hiddenCandidateCenterIds = nudges === 0 ? hiddenHydrogenCandidateCenterIds : null;
    nudges += runHiddenHydrogenTerminalMultipleBondFanTidy(layoutGraph, coords, bondLength, atomGrid, frozenAtomIds, hiddenCandidateCenterIds);
  }

  return { coords, nudges };
}

/**
 * Finds compressed target positions for an acid-like terminal hetero fan.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Coordinate map.
 * @param {object} descriptor - Paired terminal hetero leaf descriptor.
 * @param {number} bondLength - Target bond length.
 * @param {Map<string, string>|null} bondValidationClasses - Per-bond validation classes for layout audit.
 * @returns {Map<string, {x: number, y: number}>|null} Candidate leaf targets, or null when none are audit-clean.
 */
function pairedTerminalHeteroLeafCompressedTargetPositions(layoutGraph, coords, descriptor, bondLength, bondValidationClasses) {
  const centerPosition = coords.get(descriptor.centerAtomId);
  if (!centerPosition || descriptor.movesTerminalSingleHeteroLeaf !== true) {
    return null;
  }

  const exactTargetPositions = new Map();
  for (const { leafAtomId, targetAngle } of descriptor.leafTargets) {
    const leafPosition = coords.get(leafAtomId);
    if (!leafPosition) {
      return null;
    }
    exactTargetPositions.set(leafAtomId, add(centerPosition, fromAngle(targetAngle, distance(centerPosition, leafPosition))));
  }
  const exactCandidateCoords = new Map(coords);
  for (const [leafAtomId, targetPosition] of exactTargetPositions) {
    exactCandidateCoords.set(leafAtomId, targetPosition);
  }
  if (
    auditCandidateSafety(layoutGraph, exactCandidateCoords, { bondLength, bondValidationClasses }).ok === true &&
    terminalMultipleBondLeafFanPenalty(exactCandidateCoords, descriptor.centerAtomId, descriptor.neighborAtomIds) < descriptor.currentPenalty - TERMINAL_MULTIPLE_BOND_FAN_IMPROVEMENT_EPSILON
  ) {
    return exactTargetPositions;
  }

  const compressionFactors = [1, 0.95, 0.9, 0.85, 0.8, 0.75, 0.7, 0.65, 0.6, 0.55, 0.5];
  let bestCandidate = null;

  for (const firstFactor of compressionFactors) {
    for (const secondFactor of compressionFactors) {
      const targetPositions = new Map();
      const factors = [firstFactor, secondFactor];
      let valid = true;
      for (let index = 0; index < descriptor.leafTargets.length; index++) {
        const { leafAtomId, targetAngle } = descriptor.leafTargets[index];
        const leafPosition = coords.get(leafAtomId);
        if (!leafPosition) {
          valid = false;
          break;
        }
        targetPositions.set(leafAtomId, add(centerPosition, fromAngle(targetAngle, distance(centerPosition, leafPosition) * factors[index])));
      }
      if (!valid) {
        continue;
      }

      const candidateCoords = new Map(coords);
      for (const [leafAtomId, targetPosition] of targetPositions) {
        candidateCoords.set(leafAtomId, targetPosition);
      }
      if (auditCandidateSafety(layoutGraph, candidateCoords, { bondLength, bondValidationClasses }).ok !== true) {
        continue;
      }

      const penalty = terminalMultipleBondLeafFanPenalty(candidateCoords, descriptor.centerAtomId, descriptor.neighborAtomIds);
      if (penalty >= descriptor.currentPenalty - TERMINAL_MULTIPLE_BOND_FAN_IMPROVEMENT_EPSILON) {
        continue;
      }
      const clearance = terminalMultipleBondLeafReliefClearance(layoutGraph, coords, descriptor, targetPositions);
      const candidate = {
        targetPositions,
        penalty,
        clearance,
        compression: Math.abs(1 - firstFactor) + Math.abs(1 - secondFactor)
      };
      if (
        !bestCandidate ||
        candidate.penalty < bestCandidate.penalty - TERMINAL_MULTIPLE_BOND_FAN_IMPROVEMENT_EPSILON ||
        (Math.abs(candidate.penalty - bestCandidate.penalty) <= TERMINAL_MULTIPLE_BOND_FAN_IMPROVEMENT_EPSILON && candidate.clearance > bestCandidate.clearance + TIDY_IMPROVEMENT_EPSILON) ||
        (Math.abs(candidate.penalty - bestCandidate.penalty) <= TERMINAL_MULTIPLE_BOND_FAN_IMPROVEMENT_EPSILON &&
          Math.abs(candidate.clearance - bestCandidate.clearance) <= TIDY_IMPROVEMENT_EPSILON &&
          candidate.compression < bestCandidate.compression - TIDY_IMPROVEMENT_EPSILON)
      ) {
        bestCandidate = candidate;
      }
    }
  }

  return bestCandidate?.targetPositions ?? null;
}

/**
 * Retouches acid-like terminal hetero pairs on trigonal centers by moving the
 * single-bond and multiple-bond terminal hetero leaves together. This is used
 * as a final presentation pass when a nearby macrocycle blocks one exact
 * trigonal slot and the paired leaves need a compressed but still wider fan.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} inputCoords - Coordinate map.
 * @param {{bondLength?: number, bondValidationClasses?: Map<string, string>}} [options] - Retouch options.
 * @returns {{coords: Map<string, {x: number, y: number}>, nudges: number}} Retouched coordinates and nudge count.
 */
export function runPairedTerminalHeteroLeafFanTidy(layoutGraph, inputCoords, options = {}) {
  const bondLength = options.bondLength ?? layoutGraph.options.bondLength;
  const bondValidationClasses = options.bondValidationClasses ?? null;
  const candidateCenterIds = [];
  const structuralCenterIds = Array.isArray(options.candidateCenterIds) ? [...new Set(options.candidateCenterIds)] : terminalMultipleBondFanStructuralCenterIds(layoutGraph);
  for (const centerAtomId of structuralCenterIds) {
    if (!inputCoords.has(centerAtomId)) {
      continue;
    }
    const heavyBonds = visibleHeavyCovalentBonds(layoutGraph, inputCoords, centerAtomId);
    if (heavyBonds.length !== 3) {
      continue;
    }
    const terminalMultipleBondLeaves = heavyBonds.filter(({ bond, neighborAtomId }) => {
      const neighborAtom = layoutGraph.atoms.get(neighborAtomId);
      return !bond.aromatic && (bond.order ?? 1) >= 2 && neighborAtom && neighborAtom.element !== 'C' && neighborAtom.heavyDegree === 1;
    });
    if (pairedTerminalHeteroLeafFanDescriptor(layoutGraph, inputCoords, centerAtomId, heavyBonds, terminalMultipleBondLeaves, null)) {
      candidateCenterIds.push(centerAtomId);
    }
  }
  if (candidateCenterIds.length === 0) {
    return { coords: inputCoords, nudges: 0 };
  }

  const coords = new Map([...inputCoords.entries()].map(([atomId, position]) => [atomId, { ...position }]));
  let nudges = 0;

  for (const centerAtomId of candidateCenterIds) {
    const heavyBonds = visibleHeavyCovalentBonds(layoutGraph, coords, centerAtomId);
    if (heavyBonds.length !== 3) {
      continue;
    }
    const terminalMultipleBondLeaves = heavyBonds.filter(({ bond, neighborAtomId }) => {
      const neighborAtom = layoutGraph.atoms.get(neighborAtomId);
      return !bond.aromatic && (bond.order ?? 1) >= 2 && neighborAtom && neighborAtom.element !== 'C' && neighborAtom.heavyDegree === 1;
    });
    const descriptor = pairedTerminalHeteroLeafFanDescriptor(layoutGraph, coords, centerAtomId, heavyBonds, terminalMultipleBondLeaves, null);
    if (!descriptor) {
      continue;
    }
    const targetPositions = pairedTerminalHeteroLeafCompressedTargetPositions(layoutGraph, coords, descriptor, bondLength, bondValidationClasses);
    if (!targetPositions) {
      continue;
    }
    for (const [leafAtomId, targetPosition] of targetPositions) {
      coords.set(leafAtomId, targetPosition);
    }
    nudges++;
  }

  return { coords, nudges };
}

function exactOutwardBlockerReliefCandidates(layoutGraph, coords, descriptor, atomGrid, ringPolygons, currentAngle, targetRadius, threshold, searchRadius, bondLength) {
  if (!descriptor.prefersOutwardGeometry || descriptor.outwardAngles.length === 0) {
    return [];
  }

  const anchorPosition = coords.get(descriptor.anchorAtomId);
  if (!anchorPosition) {
    return [];
  }

  const candidates = [];
  for (const outwardAngle of descriptor.outwardAngles) {
    const outwardPosition = add(anchorPosition, fromAngle(outwardAngle, targetRadius));
    const outwardOverrides = terminalHeteroMoveOverrides(descriptor, outwardPosition, outwardAngle, bondLength);
    const exactCoords = new Map(coords);
    for (const [atomId, position] of outwardOverrides) {
      exactCoords.set(atomId, position);
    }

    const blockingAtomIds = [];
    atomGrid.forEachRadius(outwardPosition, threshold, atomId => {
      const atomPosition = coords.get(atomId);
      if (!atomPosition || atomId === descriptor.heteroAtomId || layoutGraph.bondedPairSet.has(atomPairKey(descriptor.heteroAtomId, atomId)) || distance(atomPosition, outwardPosition) >= threshold) {
        return;
      }
      blockingAtomIds.push(atomId);
    });

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
        const blockerCenterDeviation = threeHeavyCenterMaxDeviation(candidateCoords, blockerDescriptor.centerAtomId, blockerDescriptor.heavyNeighborIds);
        if (blockerCenterDeviation > TERMINAL_HETERO_BLOCKER_MAX_CENTER_DEVIATION + TIDY_IMPROVEMENT_EPSILON) {
          continue;
        }

        const candidateGrid = buildAtomGrid(layoutGraph, candidateCoords, bondLength);
        candidates.push({
          ...scoreTerminalHeteroPosition(layoutGraph, candidateCoords, descriptor, candidateGrid, ringPolygons, outwardPosition, outwardAngle, currentAngle, threshold, searchRadius, bondLength),
          blockerCenterDeviation,
          blockerCenterMaxSeparation: threeHeavyCenterMaxSeparation(candidateCoords, blockerDescriptor.centerAtomId, blockerDescriptor.heavyNeighborIds),
          overridePositions: new Map([...outwardOverrides, [blockerDescriptor.blockerAtomId, candidateBlockerPosition]])
        });
      }
    }
  }
  return candidates;
}

function terminalRingHeteroStructuralPairs(layoutGraph) {
  if (Array.isArray(layoutGraph._terminalRingHeteroStructuralPairs)) {
    return layoutGraph._terminalRingHeteroStructuralPairs;
  }

  const pairs = [];
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
      if (!layoutGraph.ringAtomIdSet.has(anchorAtomId) || layoutGraph.ringAtomIdSet.has(heteroAtomId) || (heteroAtom.heavyDegree ?? 0) !== 1) {
        continue;
      }
      const bondOrder = bond.order ?? 1;
      const prefersOutwardGeometry = bondOrder === 1 && SINGLE_BOND_TERMINAL_HETERO_ELEMENTS.has(heteroAtom.element);
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
      pairs.push({ anchorAtomId, heteroAtomId, prefersOutwardGeometry });
    }
  }

  layoutGraph._terminalRingHeteroStructuralPairs = pairs;
  return pairs;
}

/**
 * Returns whether a terminal multiple-bond hetero leaf is already part of an
 * opposed bis-oxo cross on a ring-embedded hypervalent center.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Coordinate map.
 * @param {string} centerAtomId - Candidate hypervalent ring atom id.
 * @param {string} leafAtomId - Candidate terminal multiple-bond hetero leaf id.
 * @returns {boolean} True when terminal-hetero presentation tidy should leave the paired oxos alone.
 */
function isProtectedRingEmbeddedBisOxoCrossLeaf(layoutGraph, coords, centerAtomId, leafAtomId) {
  if (!layoutGraph.ringAtomIdSet.has(centerAtomId) || !coords.has(centerAtomId) || !coords.has(leafAtomId)) {
    return false;
  }

  const singleNeighborIds = [];
  const multipleLeafIds = [];
  for (const bond of layoutGraph.bondsByAtomId.get(centerAtomId) ?? []) {
    if (!bond || bond.kind !== 'covalent' || bond.aromatic) {
      return false;
    }
    const neighborAtomId = bond.a === centerAtomId ? bond.b : bond.a;
    const neighborAtom = layoutGraph.atoms.get(neighborAtomId);
    if (!neighborAtom || neighborAtom.element === 'H' || !coords.has(neighborAtomId)) {
      continue;
    }
    const bondOrder = bond.order ?? 1;
    if (bondOrder === 1) {
      singleNeighborIds.push(neighborAtomId);
      continue;
    }
    if (bondOrder >= 2 && neighborAtom.element !== 'C' && (neighborAtom.heavyDegree ?? 0) === 1) {
      multipleLeafIds.push(neighborAtomId);
      continue;
    }
    return false;
  }

  if (singleNeighborIds.length !== 2 || multipleLeafIds.length !== 2 || !multipleLeafIds.includes(leafAtomId)) {
    return false;
  }
  const incidentRings = layoutGraph.atomToRings.get(centerAtomId) ?? [];
  if (!incidentRings.some(ring => singleNeighborIds.every(neighborAtomId => ring.atomIds.includes(neighborAtomId)))) {
    return false;
  }

  const centerPosition = coords.get(centerAtomId);
  const singleSeparation = angularDifference(angleOf(sub(coords.get(singleNeighborIds[0]), centerPosition)), angleOf(sub(coords.get(singleNeighborIds[1]), centerPosition)));
  if (Math.PI - singleSeparation > RING_EMBEDDED_BIS_OXO_CROSS_SINGLE_TOLERANCE) {
    return false;
  }
  const oxoSeparation = angularDifference(angleOf(sub(coords.get(multipleLeafIds[0]), centerPosition)), angleOf(sub(coords.get(multipleLeafIds[1]), centerPosition)));
  return oxoSeparation >= RING_EMBEDDED_BIS_OXO_CROSS_MIN_OXO_SEPARATION;
}

function terminalRingHeteros(layoutGraph, coords) {
  const descriptors = [];
  const outwardAnglesByAnchorId = new Map();
  const getOutwardAngles = anchorAtomId => {
    if (outwardAnglesByAnchorId.has(anchorAtomId)) {
      return outwardAnglesByAnchorId.get(anchorAtomId);
    }
    const angles = outwardAnglesForAnchor(layoutGraph, coords, anchorAtomId);
    outwardAnglesByAnchorId.set(anchorAtomId, angles);
    return angles;
  };

  for (const { anchorAtomId, heteroAtomId, prefersOutwardGeometry } of terminalRingHeteroStructuralPairs(layoutGraph)) {
    if (!coords.has(anchorAtomId) || !coords.has(heteroAtomId)) {
      continue;
    }
    if (!prefersOutwardGeometry && isProtectedRingEmbeddedBisOxoCrossLeaf(layoutGraph, coords, anchorAtomId, heteroAtomId)) {
      continue;
    }
    const smallRingExteriorAngles = smallRingExteriorTerminalHeteroAngles(layoutGraph, coords, anchorAtomId, heteroAtomId);
    const outwardAngles = prefersOutwardGeometry ? (smallRingExteriorAngles.length > 0 ? smallRingExteriorAngles : getOutwardAngles(anchorAtomId)) : [];
    descriptors.push({
      anchorAtomId,
      heteroAtomId,
      hydrogenAtomIds: terminalHeteroHydrogenAtomIds(layoutGraph, coords, heteroAtomId),
      prefersOutwardGeometry,
      outwardAngles
    });
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

  const descriptors = terminalRingHeteros(layoutGraph, coords);
  if (descriptors.length === 0) {
    return false;
  }

  const bondLength = options.bondLength ?? layoutGraph.options.bondLength;
  const threshold = bondLength * 0.55;
  const atomGrid = buildAtomGrid(layoutGraph, coords, bondLength);
  for (const descriptor of descriptors) {
    const anchorPosition = coords.get(descriptor.anchorAtomId);
    const currentPosition = coords.get(descriptor.heteroAtomId);
    if (!anchorPosition || !currentPosition) {
      continue;
    }
    const currentAngle = angleOf(sub(currentPosition, anchorPosition));
    if (
      descriptor.prefersOutwardGeometry &&
      descriptor.outwardAngles.length > 0 &&
      Math.min(...descriptor.outwardAngles.map(outwardAngle => angularDifference(outwardAngle, currentAngle))) > TERMINAL_HETERO_OUTWARD_NEED_TRIGGER
    ) {
      return true;
    }
    if (descriptor.prefersOutwardGeometry && Math.abs(distance(anchorPosition, currentPosition) - bondLength) > bondLength * TERMINAL_HETERO_BOND_LENGTH_NEED_FACTOR) {
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

  for (const centerAtomId of terminalMultipleBondFanStructuralCenterIds(layoutGraph)) {
    if (!coords.has(centerAtomId)) {
      continue;
    }
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
      return !bond.aromatic && (bond.order ?? 1) >= 2 && neighborAtom && neighborAtom.element !== 'C' && neighborAtom.heavyDegree === 1;
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
      const fixedNeighborIds = heavyBonds.map(({ neighborAtomId }) => neighborAtomId).filter(neighborAtomId => !leafAtomIds.has(neighborAtomId));
      if (
        Math.abs(angularDifference(fixedNeighborAngles[0], fixedNeighborAngles[1]) - Math.PI) <= TERMINAL_MULTIPLE_BOND_LINEAR_NEIGHBOR_TOLERANCE &&
        !hasMovableTerminalMultipleBondSupport(layoutGraph, coords, centerAtomId, terminalMultipleBondLeaves[0].neighborAtomId, fixedNeighborIds)
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

  for (const centerAtomId of terminalMultipleBondFanStructuralCenterIds(layoutGraph)) {
    if (!coords.has(centerAtomId)) {
      continue;
    }
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
    return !bond.aromatic && (bond.order ?? 1) >= 2 && neighborAtom && neighborAtom.element !== 'C' && neighborAtom.heavyDegree === 1;
  });
  if (terminalMultipleBondLeaves.length !== 1) {
    return null;
  }

  const supportBonds = heavyBonds.filter(({ neighborAtomId }) => neighborAtomId !== terminalMultipleBondLeaves[0].neighborAtomId);
  if (supportBonds.length !== 2 || supportBonds.some(({ bond }) => bond.aromatic || bond.inRing || (bond.order ?? 1) !== 1)) {
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

function boundTerminalMultipleBondSupportFans(layoutGraph, coords, bondLength, candidateCenterIds = null) {
  let nudges = 0;

  for (const centerAtomId of candidateCenterIds ?? terminalMultipleBondFanStructuralCenterIds(layoutGraph)) {
    if (!coords.has(centerAtomId)) {
      continue;
    }
    const descriptor = terminalMultipleBondSupportFanDescriptor(layoutGraph, coords, centerAtomId);
    if (!descriptor) {
      continue;
    }

    const currentSupportAngles = descriptor.supportBonds.map(({ neighborAtomId }) => angleOf(sub(coords.get(neighborAtomId), coords.get(descriptor.centerAtomId))));
    const currentSupportSeparation = angularDifference(currentSupportAngles[0], currentSupportAngles[1]);
    if (currentSupportSeparation <= TERMINAL_MULTIPLE_BOND_SUPPORT_MAX_SEPARATION + TIDY_IMPROVEMENT_EPSILON) {
      continue;
    }

    const currentMaxSeparation = threeHeavyCenterMaxSeparation(coords, descriptor.centerAtomId, descriptor.neighborAtomIds);
    const currentFanPenalty = terminalMultipleBondLeafFanPenalty(coords, descriptor.centerAtomId, descriptor.neighborAtomIds);
    const targetReduction = Math.min(currentSupportSeparation - TERMINAL_MULTIPLE_BOND_SUPPORT_MAX_SEPARATION, TERMINAL_MULTIPLE_BOND_SUPPORT_MAX_ROTATION);
    let bestCandidate = null;

    for (const { neighborAtomId: supportAtomId } of descriptor.supportBonds) {
      const supportAtom = layoutGraph.atoms.get(supportAtomId);
      if (!supportAtom || supportAtom.element === 'H' || !layoutGraph.ringAtomIdSet.has(supportAtomId)) {
        continue;
      }

      const otherSupportAtomId = descriptor.supportBonds.map(({ neighborAtomId }) => neighborAtomId).find(neighborAtomId => neighborAtomId !== supportAtomId);
      const movedAtomIds = collectCovalentSubtreeAtomIds(layoutGraph, supportAtomId, descriptor.centerAtomId).filter(atomId => coords.has(atomId));
      if (
        movedAtomIds.length === 0 ||
        movedAtomIds.includes(descriptor.leafAtomId) ||
        movedAtomIds.includes(otherSupportAtomId) ||
        heavyAtomCountInIds(layoutGraph, movedAtomIds) > TERMINAL_MULTIPLE_BOND_SUPPORT_SUBTREE_HEAVY_LIMIT
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
          maxSeparation >= currentMaxSeparation - TIDY_IMPROVEMENT_EPSILON ||
          maxSeparation > TERMINAL_MULTIPLE_BOND_SUPPORT_MAX_SEPARATION + TIDY_IMPROVEMENT_EPSILON ||
          minSeparation < TERMINAL_MULTIPLE_BOND_SUPPORT_MIN_SEPARATION - TIDY_IMPROVEMENT_EPSILON ||
          fanPenalty >= currentFanPenalty - TERMINAL_MULTIPLE_BOND_FAN_IMPROVEMENT_EPSILON
        ) {
          continue;
        }
        if (auditCandidateSafety(layoutGraph, candidateCoords, { bondLength }).ok !== true) {
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
  if (candidate.prefersOutwardGeometry && Math.abs(candidate.outwardDeviation - incumbent.outwardDeviation) > TIDY_IMPROVEMENT_EPSILON) {
    return candidate.outwardDeviation < incumbent.outwardDeviation;
  }
  if (candidate.prefersOutwardGeometry && Math.abs(candidate.terminalBondLengthDeviation - incumbent.terminalBondLengthDeviation) > TIDY_IMPROVEMENT_EPSILON) {
    return candidate.terminalBondLengthDeviation < incumbent.terminalBondLengthDeviation;
  }
  if (
    Number.isFinite(candidate.blockerCenterDeviation) &&
    Number.isFinite(incumbent.blockerCenterDeviation) &&
    Math.abs(candidate.blockerCenterDeviation - incumbent.blockerCenterDeviation) > TIDY_IMPROVEMENT_EPSILON
  ) {
    return candidate.blockerCenterDeviation < incumbent.blockerCenterDeviation;
  }
  if (
    Number.isFinite(candidate.blockerCenterMaxSeparation) &&
    Number.isFinite(incumbent.blockerCenterMaxSeparation) &&
    Math.abs(candidate.blockerCenterMaxSeparation - incumbent.blockerCenterMaxSeparation) > TIDY_IMPROVEMENT_EPSILON
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
  const descriptors = terminalRingHeteros(layoutGraph, inputCoords);
  const supportCenterIds = terminalMultipleBondFanStructuralCenterIds(layoutGraph).filter(centerAtomId => inputCoords.has(centerAtomId));
  if (descriptors.length === 0 && supportCenterIds.length === 0) {
    return { coords: inputCoords, nudges: 0 };
  }

  const coords = new Map([...inputCoords.entries()].map(([atomId, position]) => [atomId, { ...position }]));
  const atomGrid = descriptors.length > 0 ? buildAtomGrid(layoutGraph, coords, bondLength) : null;
  let nudges = 0;

  for (const descriptor of descriptors) {
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
      ...scoreTerminalHeteroPosition(layoutGraph, coords, descriptor, atomGrid, ringPolygons, currentPosition, currentAngle, currentAngle, threshold, searchRadius, bondLength),
      angleDelta: 0
    };
    const targetRadius = descriptor.prefersOutwardGeometry ? bondLength : radius;
    const candidateAngles = new Set(STANDARD_ROTATION_ANGLES);
    candidateAngles.add(currentAngle);
    for (const angle of descriptor.outwardAngles) {
      candidateAngles.add(angle);
    }
    const candidateSearch = visitPresentationDescriptorCandidates(
      layoutGraph,
      coords,
      {
        anchorAtomId: descriptor.anchorAtomId,
        rootAtomId: descriptor.heteroAtomId,
        subtreeAtomIds: [descriptor.heteroAtomId]
      },
      {
        useSparseCandidateOverlay: true,
        buildSeedKey: (_descriptor, candidateAngle) => `terminal-hetero:${Number.isFinite(candidateAngle) ? candidateAngle.toFixed(12) : `${candidateAngle}`}`,
        generateSeeds: () => [...candidateAngles],
        materializeOverrides(_coords, _rotationDescriptor, candidateAngle) {
          return terminalHeteroMoveOverrides(descriptor, add(anchorPosition, fromAngle(candidateAngle, targetRadius)), candidateAngle, bondLength);
        },
        scoreSeed(_rotationDescriptor, _candidateCoords, candidateAngle, _context, overridePositions) {
          const candidatePosition = overridePositions.get(descriptor.heteroAtomId);
          if (!candidatePosition) {
            return null;
          }
          return {
            ...scoreTerminalHeteroPosition(layoutGraph, coords, descriptor, atomGrid, ringPolygons, candidatePosition, candidateAngle, currentAngle, threshold, searchRadius, bondLength),
            overridePositions
          };
        },
        isBetterScore: isBetterTidyCandidate
      }
    );
    let bestCandidate = candidateSearch.bestFinalCandidate?.score ?? currentCandidate;
    for (const reliefCandidate of exactOutwardBlockerReliefCandidates(layoutGraph, coords, descriptor, atomGrid, ringPolygons, currentAngle, targetRadius, threshold, searchRadius, bondLength)) {
      if (isBetterTidyCandidate(reliefCandidate, bestCandidate)) {
        bestCandidate = reliefCandidate;
      }
    }

    const improvesOverlapCount = bestCandidate.overlapCount < currentCandidate.overlapCount;
    const improvesInsideRing = bestCandidate.insideRingCount < currentCandidate.insideRingCount;
    const improvesClearance = bestCandidate.clearance > currentCandidate.clearance + TIDY_IMPROVEMENT_EPSILON;
    const improvesBondLength = descriptor.prefersOutwardGeometry && bestCandidate.terminalBondLengthDeviation < currentCandidate.terminalBondLengthDeviation - TIDY_IMPROVEMENT_EPSILON;
    const improvesOutwardGeometry = descriptor.prefersOutwardGeometry && bestCandidate.outwardDeviation < currentCandidate.outwardDeviation - TIDY_IMPROVEMENT_EPSILON;
    if (!improvesInsideRing && !improvesOverlapCount && !improvesClearance && !improvesBondLength && !improvesOutwardGeometry) {
      continue;
    }

    const overridePositions = bestCandidate.overridePositions instanceof Map ? bestCandidate.overridePositions : new Map([[descriptor.heteroAtomId, bestCandidate.position]]);
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

  if (supportCenterIds.length > 0) {
    nudges += boundTerminalMultipleBondSupportFans(layoutGraph, coords, bondLength, supportCenterIds);
  }

  return { coords, nudges };
}

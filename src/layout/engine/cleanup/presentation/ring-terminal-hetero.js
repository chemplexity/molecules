/** @module cleanup/presentation/ring-terminal-hetero */

import { buildAtomGrid } from '../../audit/invariants.js';
import { auditLayout } from '../../audit/audit.js';
import { countPointInPolygons } from '../../geometry/polygon.js';
import { add, angleOf, angularDifference, centroid, distance, fromAngle, rotate, sub } from '../../geometry/vec2.js';
import { visitPresentationDescriptorCandidates } from '../candidate-search.js';
import { atomPairKey } from '../../constants.js';
import { STANDARD_ROTATION_ANGLES } from '../rotation-candidates.js';
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
  if (terminalMultipleBondLeaves.length !== 1) {
    return null;
  }

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
  if (
    Math.abs(angularDifference(fixedNeighborAngles[0], fixedNeighborAngles[1]) - Math.PI)
      <= TERMINAL_MULTIPLE_BOND_LINEAR_NEIGHBOR_TOLERANCE
  ) {
    return null;
  }

  const leafPosition = coords.get(leafAtomId);
  if (!leafPosition) {
    return null;
  }
  const neighborAtomIds = [...fixedNeighborIds, leafAtomId];
  const currentPenalty = terminalMultipleBondLeafFanPenalty(coords, centerAtomId, neighborAtomIds);
  const targetAngle = angleOf(sub(centerPosition, centroid(fixedNeighborPositions)));
  const targetAngles = [
    fixedNeighborAngles[0],
    fixedNeighborAngles[1],
    targetAngle
  ];
  const targetPenalty = terminalMultipleBondLeafFanPenaltyFromAngles(targetAngles);
  if (targetPenalty >= currentPenalty - TERMINAL_MULTIPLE_BOND_FAN_IMPROVEMENT_EPSILON) {
    return null;
  }

  return {
    centerAtomId,
    leafAtomId,
    neighborAtomIds,
    targetAngle,
    currentPenalty,
    targetPenalty
  };
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
 * Re-centers terminal multiple-bond hetero leaves on the trigonal bisector of
 * their two fixed heavy neighbors when that improves the local fan.
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
    const leafPosition = coords.get(descriptor.leafAtomId);
    if (!centerPosition || !leafPosition) {
      continue;
    }
    const radius = distance(centerPosition, leafPosition);
    if (radius <= TIDY_IMPROVEMENT_EPSILON) {
      continue;
    }

    const targetPosition = add(centerPosition, fromAngle(descriptor.targetAngle, radius));
    const currentOverlapCount = localSevereOverlapCount(layoutGraph, coords, atomGrid, descriptor.leafAtomId, leafPosition, threshold);
    const targetOverlapCount = localSevereOverlapCount(layoutGraph, coords, atomGrid, descriptor.leafAtomId, targetPosition, threshold);
    if (targetOverlapCount > currentOverlapCount) {
      continue;
    }

    const candidateCoords = new Map(coords);
    candidateCoords.set(descriptor.leafAtomId, targetPosition);
    const candidatePenalty = terminalMultipleBondLeafFanPenalty(
      candidateCoords,
      descriptor.centerAtomId,
      descriptor.neighborAtomIds
    );
    if (candidatePenalty >= descriptor.currentPenalty - TERMINAL_MULTIPLE_BOND_FAN_IMPROVEMENT_EPSILON) {
      continue;
    }

    atomGrid.remove(descriptor.leafAtomId, leafPosition);
    leafPosition.x = targetPosition.x;
    leafPosition.y = targetPosition.y;
    atomGrid.insert(descriptor.leafAtomId, leafPosition);
    nudges++;
  }

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
      descriptors.push({
        anchorAtomId,
        heteroAtomId,
        hydrogenAtomIds: terminalHeteroHydrogenAtomIds(layoutGraph, coords, heteroAtomId),
        prefersOutwardGeometry,
        outwardAngles: prefersOutwardGeometry ? outwardAnglesForAnchor(layoutGraph, coords, anchorAtomId) : []
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
 * Measures local fan distortion for trigonal centers with one terminal
 * multiple-bond hetero leaf.
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
    if (terminalMultipleBondLeaves.length !== 1) {
      continue;
    }

    const leafAtomId = terminalMultipleBondLeaves[0].neighborAtomId;
    const fixedNeighborPositions = heavyBonds
      .map(({ neighborAtomId }) => neighborAtomId)
      .filter(neighborAtomId => neighborAtomId !== leafAtomId)
      .map(neighborAtomId => coords.get(neighborAtomId))
      .filter(Boolean);
    if (fixedNeighborPositions.length !== 2) {
      continue;
    }
    const fixedNeighborAngles = fixedNeighborPositions.map(position => angleOf(sub(position, centerPosition)));
    if (
      Math.abs(angularDifference(fixedNeighborAngles[0], fixedNeighborAngles[1]) - Math.PI)
        <= TERMINAL_MULTIPLE_BOND_LINEAR_NEIGHBOR_TOLERANCE
    ) {
      continue;
    }

    const neighborAtomIds = heavyBonds.map(({ neighborAtomId }) => neighborAtomId);
    const penalty = terminalMultipleBondLeafFanPenalty(coords, centerAtomId, neighborAtomIds);
    if (!Number.isFinite(penalty)) {
      continue;
    }
    totalDeviation += penalty;
    maxDeviation = Math.max(maxDeviation, penalty);
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

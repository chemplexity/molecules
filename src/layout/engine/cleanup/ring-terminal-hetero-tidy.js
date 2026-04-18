/** @module cleanup/ring-terminal-hetero-tidy */

import { buildAtomGrid } from '../audit/invariants.js';
import { countPointInPolygons } from '../geometry/polygon.js';
import { add, angleOf, angularDifference, centroid, distance, fromAngle, sub } from '../geometry/vec2.js';
import { probeRigidRotation } from './rigid-rotation.js';

const TIDY_ROTATION_ANGLES = Object.freeze([
  0,
  Math.PI / 6,
  -Math.PI / 6,
  Math.PI / 3,
  -Math.PI / 3,
  Math.PI / 2,
  -Math.PI / 2,
  (2 * Math.PI) / 3,
  -(2 * Math.PI) / 3,
  Math.PI
]);
const TIDY_IMPROVEMENT_EPSILON = 1e-6;
const SINGLE_BOND_TERMINAL_HETERO_ELEMENTS = new Set(['O', 'S', 'Se']);

function atomPairKey(firstAtomId, secondAtomId) {
  return firstAtomId < secondAtomId ? `${firstAtomId}:${secondAtomId}` : `${secondAtomId}:${firstAtomId}`;
}

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
        prefersOutwardGeometry,
        outwardAngles: prefersOutwardGeometry ? outwardAnglesForAnchor(layoutGraph, coords, anchorAtomId) : []
      });
    }
  }

  return descriptors;
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
      position: currentPosition,
      insideRingCount: countPointInPolygons(ringPolygons, currentPosition),
      overlapCount: localSevereOverlapCount(layoutGraph, coords, atomGrid, descriptor.heteroAtomId, currentPosition, threshold),
      clearance: localNonbondedClearance(layoutGraph, coords, atomGrid, descriptor.heteroAtomId, currentPosition, searchRadius),
      prefersOutwardGeometry: descriptor.prefersOutwardGeometry,
      outwardDeviation: descriptor.prefersOutwardGeometry
        ? Math.min(...descriptor.outwardAngles.map(outwardAngle => angularDifference(outwardAngle, currentAngle)))
        : 0,
      angleDelta: 0
    };
    const candidateAngles = new Set(TIDY_ROTATION_ANGLES);
    for (const angle of descriptor.outwardAngles) { candidateAngles.add(angle); }
    const rigidRotationProbe = probeRigidRotation(layoutGraph, coords, {
      anchorAtomId: descriptor.anchorAtomId,
      rootAtomId: descriptor.heteroAtomId,
      subtreeAtomIds: [descriptor.heteroAtomId]
    }, {
      angles: [...candidateAngles],
      buildPositionsFn(_coords, _rotationDescriptor, candidateAngle) {
        return new Map([[descriptor.heteroAtomId, add(anchorPosition, fromAngle(candidateAngle, radius))]]);
      },
      scoreFn(_coords, overridePositions, candidateAngle) {
        const candidatePosition = overridePositions.get(descriptor.heteroAtomId);
        if (!candidatePosition) {
          return null;
        }
        return {
          position: candidatePosition,
          insideRingCount: countPointInPolygons(ringPolygons, candidatePosition),
          overlapCount: localSevereOverlapCount(layoutGraph, coords, atomGrid, descriptor.heteroAtomId, candidatePosition, threshold),
          clearance: localNonbondedClearance(layoutGraph, coords, atomGrid, descriptor.heteroAtomId, candidatePosition, searchRadius),
          prefersOutwardGeometry: descriptor.prefersOutwardGeometry,
          outwardDeviation: descriptor.prefersOutwardGeometry
            ? Math.min(...descriptor.outwardAngles.map(outwardAngle => angularDifference(outwardAngle, candidateAngle)))
            : 0,
          angleDelta: angularDifference(candidateAngle, currentAngle)
        };
      },
      isBetterScoreFn: isBetterTidyCandidate
    });
    const bestCandidate = rigidRotationProbe.bestScore ?? currentCandidate;

    const improvesOverlapCount = bestCandidate.overlapCount < currentCandidate.overlapCount;
    const improvesInsideRing = bestCandidate.insideRingCount < currentCandidate.insideRingCount;
    const improvesClearance = bestCandidate.clearance > currentCandidate.clearance + TIDY_IMPROVEMENT_EPSILON;
    const improvesOutwardGeometry =
      descriptor.prefersOutwardGeometry
      && bestCandidate.outwardDeviation < currentCandidate.outwardDeviation - TIDY_IMPROVEMENT_EPSILON;
    if (!improvesInsideRing && !improvesOverlapCount && !improvesClearance && !improvesOutwardGeometry) {
      continue;
    }

    atomGrid.remove(descriptor.heteroAtomId, currentPosition);
    currentPosition.x = bestCandidate.position.x;
    currentPosition.y = bestCandidate.position.y;
    atomGrid.insert(descriptor.heteroAtomId, currentPosition);
    nudges++;
  }

  return { coords, nudges };
}

/** @module cleanup/ring-terminal-hetero-tidy */

import { buildAtomGrid } from '../audit/invariants.js';
import { countPointInPolygons } from '../geometry/polygon.js';
import { add, angleOf, angularDifference, distance, fromAngle, sub } from '../geometry/vec2.js';

const TIDY_ROTATION_ANGLES = Array.from({ length: 24 }, (_, index) => (index * Math.PI) / 12);
const TIDY_IMPROVEMENT_EPSILON = 1e-6;

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

function terminalRingMultipleBondHeteros(layoutGraph, coords) {
  const descriptors = [];
  const seenPairs = new Set();

  for (const bond of layoutGraph.bonds?.values?.() ?? []) {
    if (!bond || bond.kind !== 'covalent' || bond.aromatic || (bond.order ?? 1) < 2) {
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

      const pairKey = atomPairKey(anchorAtomId, heteroAtomId);
      if (seenPairs.has(pairKey)) {
        continue;
      }
      seenPairs.add(pairKey);
      descriptors.push({
        anchorAtomId,
        heteroAtomId
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

  for (const descriptor of terminalRingMultipleBondHeteros(layoutGraph, coords)) {
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
      angleDelta: 0
    };
    let bestCandidate = currentCandidate;

    for (const candidateAngle of TIDY_ROTATION_ANGLES) {
      const candidatePosition = add(anchorPosition, fromAngle(candidateAngle, radius));
      const candidate = {
        position: candidatePosition,
        insideRingCount: countPointInPolygons(ringPolygons, candidatePosition),
        overlapCount: localSevereOverlapCount(layoutGraph, coords, atomGrid, descriptor.heteroAtomId, candidatePosition, threshold),
        clearance: localNonbondedClearance(layoutGraph, coords, atomGrid, descriptor.heteroAtomId, candidatePosition, searchRadius),
        angleDelta: angularDifference(candidateAngle, currentAngle)
      };
      if (isBetterTidyCandidate(candidate, bestCandidate)) {
        bestCandidate = candidate;
      }
    }

    const improvesOverlapCount = bestCandidate.overlapCount < currentCandidate.overlapCount;
    const improvesInsideRing = bestCandidate.insideRingCount < currentCandidate.insideRingCount;
    const improvesClearance = bestCandidate.clearance > currentCandidate.clearance + TIDY_IMPROVEMENT_EPSILON;
    if (!improvesInsideRing && !improvesOverlapCount && !improvesClearance) {
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

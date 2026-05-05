/** @module cleanup/presentation/terminal-cation-ring-clearance */

import { auditLayout } from '../../audit/audit.js';
import { findSevereOverlaps } from '../../audit/invariants.js';
import { add, rotate, sub } from '../../geometry/vec2.js';
import { collectCutSubtree } from '../subtree-utils.js';

const CLOSE_TERMINAL_CATION_RING_FACTOR = 1.15;
const MIN_CLEARANCE_IMPROVEMENT_FACTOR = 0.45;
const TIDY_EPSILON = 1e-6;
const RING_BODY_ROTATIONS = Object.freeze([
  Math.PI / 6,
  -(Math.PI / 6),
  Math.PI / 4,
  -(Math.PI / 4),
  Math.PI / 3,
  -(Math.PI / 3)
]);
const RESIDUAL_RING_BODY_ROTATIONS = Object.freeze([
  Math.PI / 6,
  -(Math.PI / 6),
  Math.PI / 4,
  -(Math.PI / 4),
  Math.PI / 3,
  -(Math.PI / 3),
  Math.PI / 2,
  -(Math.PI / 2)
]);
const LINKER_SWING_ROTATIONS = Object.freeze([
  Math.PI / 3,
  -(Math.PI / 3),
  (2 * Math.PI) / 3,
  -(2 * Math.PI) / 3,
  Math.PI
]);

function heavyCovalentNeighborIds(layoutGraph, atomId) {
  const neighborIds = [];
  for (const bond of layoutGraph?.bondsByAtomId?.get(atomId) ?? []) {
    if (!bond || bond.kind !== 'covalent') {
      continue;
    }
    const neighborAtomId = bond.a === atomId ? bond.b : bond.a;
    const neighborAtom = layoutGraph.atoms.get(neighborAtomId);
    if (neighborAtom && neighborAtom.element !== 'H') {
      neighborIds.push(neighborAtomId);
    }
  }
  return neighborIds;
}

function isTerminalCationNitrogen(layoutGraph, atomId) {
  const atom = layoutGraph?.atoms.get(atomId);
  return Boolean(
    atom
    && atom.element === 'N'
    && atom.charge > 0
    && atom.heavyDegree === 1
  );
}

function aromaticRingForRoot(layoutGraph, rootAtomId) {
  return (layoutGraph?.atomToRings.get(rootAtomId) ?? [])
    .find(ring => ring?.aromatic === true && Array.isArray(ring.atomIds)) ?? null;
}

function collectRingBodyAtomIds(layoutGraph, ring, rootAtomId, coords) {
  const atomIds = new Set((ring?.atomIds ?? []).filter(atomId => atomId !== rootAtomId));
  for (const ringAtomId of ring?.atomIds ?? []) {
    if (ringAtomId === rootAtomId) {
      continue;
    }
    for (const bond of layoutGraph?.bondsByAtomId?.get(ringAtomId) ?? []) {
      if (!bond || bond.kind !== 'covalent') {
        continue;
      }
      const neighborAtomId = bond.a === ringAtomId ? bond.b : bond.a;
      if (layoutGraph.atoms.get(neighborAtomId)?.element === 'H') {
        atomIds.add(neighborAtomId);
      }
    }
  }
  return [...atomIds].filter(atomId => coords.has(atomId));
}

function collectResidualAromaticRingReliefDescriptors(layoutGraph, coords, atomId) {
  const descriptors = [];
  for (const ring of layoutGraph?.atomToRings.get(atomId) ?? []) {
    if (!ring?.aromatic || !Array.isArray(ring.atomIds) || !ring.atomIds.includes(atomId)) {
      continue;
    }
    const ringAtomIds = new Set(ring.atomIds);
    for (const rootAtomId of ring.atomIds) {
      const exocyclicParentAtomId = heavyCovalentNeighborIds(layoutGraph, rootAtomId)
        .find(neighborAtomId => !ringAtomIds.has(neighborAtomId));
      if (!exocyclicParentAtomId || !coords.has(exocyclicParentAtomId)) {
        continue;
      }
      const ringBodyAtomIds = collectRingBodyAtomIds(layoutGraph, ring, rootAtomId, coords);
      if (!ringBodyAtomIds.includes(atomId)) {
        continue;
      }
      descriptors.push({
        rootAtomId,
        ringBodyAtomIds
      });
    }
  }
  return descriptors;
}

function minimumDistanceToAtomSet(coords, atomId, targetAtomIds) {
  const position = coords.get(atomId);
  if (!position) {
    return Number.POSITIVE_INFINITY;
  }
  let minimumDistance = Number.POSITIVE_INFINITY;
  for (const targetAtomId of targetAtomIds) {
    const targetPosition = coords.get(targetAtomId);
    if (!targetPosition) {
      continue;
    }
    minimumDistance = Math.min(
      minimumDistance,
      Math.hypot(position.x - targetPosition.x, position.y - targetPosition.y)
    );
  }
  return minimumDistance;
}

function rotateSubtreeAroundPivot(coords, atomIds, pivotAtomId, rotation) {
  const pivotPosition = coords.get(pivotAtomId);
  if (!pivotPosition) {
    return null;
  }
  const nextCoords = new Map([...coords.entries()].map(([atomId, position]) => [atomId, { ...position }]));
  for (const atomId of atomIds) {
    const position = coords.get(atomId);
    if (!position) {
      continue;
    }
    nextCoords.set(atomId, add(pivotPosition, rotate(sub(position, pivotPosition), rotation)));
  }
  return nextCoords;
}

function collectTerminalCationRingDescriptors(layoutGraph, coords, bondLength) {
  const descriptors = [];
  const closeDistance = bondLength * CLOSE_TERMINAL_CATION_RING_FACTOR;

  for (const atomId of coords.keys()) {
    if (!isTerminalCationNitrogen(layoutGraph, atomId)) {
      continue;
    }

    const [parentAtomId] = heavyCovalentNeighborIds(layoutGraph, atomId);
    if (!parentAtomId) {
      continue;
    }
    const parentHeavyNeighborIds = heavyCovalentNeighborIds(layoutGraph, parentAtomId)
      .filter(neighborAtomId => neighborAtomId !== atomId);
    if (parentHeavyNeighborIds.length !== 1) {
      continue;
    }
    const anchorAtomId = parentHeavyNeighborIds[0];

    for (const linkerAtomId of heavyCovalentNeighborIds(layoutGraph, anchorAtomId)) {
      if (linkerAtomId === parentAtomId) {
        continue;
      }
      const linkerAtom = layoutGraph.atoms.get(linkerAtomId);
      if (
        !linkerAtom
        || linkerAtom.aromatic
        || !['O', 'S', 'Se', 'N'].includes(linkerAtom.element)
        || linkerAtom.heavyDegree !== 2
        || (layoutGraph.atomToRings.get(linkerAtomId)?.length ?? 0) > 0
      ) {
        continue;
      }

      const ringRootAtomId = heavyCovalentNeighborIds(layoutGraph, linkerAtomId)
        .find(neighborAtomId => neighborAtomId !== anchorAtomId) ?? null;
      const ring = ringRootAtomId ? aromaticRingForRoot(layoutGraph, ringRootAtomId) : null;
      if (!ring) {
        continue;
      }

      const terminalRingDistance = minimumDistanceToAtomSet(coords, atomId, ring.atomIds);
      if (!(terminalRingDistance < closeDistance - TIDY_EPSILON)) {
        continue;
      }
      const subtreeAtomIds = [...collectCutSubtree(layoutGraph, ringRootAtomId, linkerAtomId)]
        .filter(subtreeAtomId => coords.has(subtreeAtomId));
      if (subtreeAtomIds.length === 0) {
        continue;
      }
      const ringBodyAtomIds = collectRingBodyAtomIds(layoutGraph, ring, ringRootAtomId, coords);
      descriptors.push({
        terminalAtomId: atomId,
        linkerAtomId,
        ringRootAtomId,
        ringAtomIds: ring.atomIds,
        ringBodyAtomIds,
        subtreeAtomIds,
        terminalRingDistance
      });
    }
  }

  return descriptors;
}

function terminalCationRingPenaltyForDescriptors(coords, descriptors, bondLength) {
  const closeDistance = bondLength * CLOSE_TERMINAL_CATION_RING_FACTOR;
  let penalty = 0;
  let minimumDistance = Number.POSITIVE_INFINITY;
  for (const descriptor of descriptors) {
    const distance = minimumDistanceToAtomSet(coords, descriptor.terminalAtomId, descriptor.ringAtomIds);
    minimumDistance = Math.min(minimumDistance, distance);
    const deficit = Math.max(0, closeDistance - distance);
    penalty += deficit * deficit;
  }
  return {
    penalty,
    minimumDistance: Number.isFinite(minimumDistance) ? minimumDistance : 0
  };
}

/**
 * Measures terminal charged-nitrogen labels that sit too close to a sibling
 * aromatic ring across an ether/thioether/amine linker.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Current coordinate map.
 * @param {{bondLength?: number}} [options] - Measurement options.
 * @returns {number} Squared proximity penalty.
 */
export function measureTerminalCationRingProximityPenalty(layoutGraph, coords, options = {}) {
  const bondLength = options.bondLength ?? layoutGraph?.options?.bondLength ?? 1.5;
  const descriptors = collectTerminalCationRingDescriptors(layoutGraph, coords, bondLength);
  return terminalCationRingPenaltyForDescriptors(coords, descriptors, bondLength).penalty;
}

function scoreCandidate(layoutGraph, candidateCoords, descriptor, bondLength, baseOverlapCount, geometryCost) {
  const overlaps = findSevereOverlaps(layoutGraph, candidateCoords, bondLength);
  if (overlaps.length > baseOverlapCount) {
    return null;
  }
  const distance = minimumDistanceToAtomSet(candidateCoords, descriptor.terminalAtomId, descriptor.ringAtomIds);
  return {
    coords: candidateCoords,
    geometryCost,
    overlapCount: overlaps.length,
    terminalRingDistance: distance
  };
}

function relieveResidualAromaticRingOverlaps(layoutGraph, coords, descriptor, bondLength, baseOverlapCount) {
  const startingOverlaps = findSevereOverlaps(layoutGraph, coords, bondLength);
  if (startingOverlaps.length === 0) {
    return coords;
  }

  let best = null;
  const currentTerminalRingDistance = minimumDistanceToAtomSet(coords, descriptor.terminalAtomId, descriptor.ringAtomIds);
  for (const overlap of startingOverlaps) {
    for (const atomId of [overlap.firstAtomId, overlap.secondAtomId]) {
      for (const reliefDescriptor of collectResidualAromaticRingReliefDescriptors(layoutGraph, coords, atomId)) {
        for (const rotation of RESIDUAL_RING_BODY_ROTATIONS) {
          const candidateCoords = rotateSubtreeAroundPivot(
            coords,
            reliefDescriptor.ringBodyAtomIds,
            reliefDescriptor.rootAtomId,
            rotation
          );
          if (!candidateCoords) {
            continue;
          }
          const candidateOverlaps = findSevereOverlaps(layoutGraph, candidateCoords, bondLength);
          if (candidateOverlaps.length > Math.min(startingOverlaps.length - 1, baseOverlapCount)) {
            continue;
          }
          const candidateAudit = auditLayout(layoutGraph, candidateCoords, { bondLength });
          if (candidateAudit.ok !== true) {
            continue;
          }
          const terminalRingDistance = minimumDistanceToAtomSet(candidateCoords, descriptor.terminalAtomId, descriptor.ringAtomIds);
          if (terminalRingDistance < currentTerminalRingDistance - TIDY_EPSILON) {
            continue;
          }
          const candidate = {
            coords: candidateCoords,
            overlapCount: candidateOverlaps.length,
            terminalRingDistance,
            geometryCost: Math.abs(rotation)
          };
          if (isBetterCandidate(candidate, best)) {
            best = candidate;
          }
        }
      }
    }
  }

  return best?.coords ?? coords;
}

function isBetterCandidate(candidate, incumbent) {
  if (!incumbent) {
    return true;
  }
  if (candidate.overlapCount !== incumbent.overlapCount) {
    return candidate.overlapCount < incumbent.overlapCount;
  }
  if (Math.abs(candidate.geometryCost - incumbent.geometryCost) > TIDY_EPSILON) {
    return candidate.geometryCost < incumbent.geometryCost;
  }
  return candidate.terminalRingDistance > incumbent.terminalRingDistance + TIDY_EPSILON;
}

/**
 * Swings compact aryl-linker ring subtrees away from terminal cation labels
 * when an exact sibling arrangement leaves the label inside the ring face.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} inputCoords - Starting coordinates.
 * @param {{bondLength?: number, maxPasses?: number}} [options] - Tidy options.
 * @returns {{coords: Map<string, {x: number, y: number}>, nudges: number}} Tidy result.
 */
export function runTerminalCationRingClearanceTidy(layoutGraph, inputCoords, options = {}) {
  const bondLength = options.bondLength ?? layoutGraph.options.bondLength;
  const maxPasses = Math.max(1, options.maxPasses ?? 1);
  let coords = new Map([...inputCoords.entries()].map(([atomId, position]) => [atomId, { ...position }]));
  let nudges = 0;

  for (let pass = 0; pass < maxPasses; pass++) {
    const descriptors = collectTerminalCationRingDescriptors(layoutGraph, coords, bondLength);
    if (descriptors.length === 0) {
      break;
    }

    let movedThisPass = false;
    for (const descriptor of descriptors) {
      const baseOverlapCount = findSevereOverlaps(layoutGraph, coords, bondLength).length;
      const minimumImprovement = bondLength * MIN_CLEARANCE_IMPROVEMENT_FACTOR;
      let bestCandidate = null;

      for (const rotation of RING_BODY_ROTATIONS) {
        const candidateCoords = rotateSubtreeAroundPivot(
          coords,
          descriptor.ringBodyAtomIds,
          descriptor.ringRootAtomId,
          rotation
        );
        const candidate = candidateCoords
          ? scoreCandidate(layoutGraph, candidateCoords, descriptor, bondLength, baseOverlapCount, Math.abs(rotation))
          : null;
        if (
          !candidate
          || candidate.terminalRingDistance < descriptor.terminalRingDistance + minimumImprovement
        ) {
          continue;
        }
        if (isBetterCandidate(candidate, bestCandidate)) {
          bestCandidate = candidate;
        }
      }

      for (const rotation of LINKER_SWING_ROTATIONS) {
        const candidateCoords = rotateSubtreeAroundPivot(
          coords,
          descriptor.subtreeAtomIds,
          descriptor.linkerAtomId,
          rotation
        );
        const candidate = candidateCoords
          ? scoreCandidate(layoutGraph, candidateCoords, descriptor, bondLength, baseOverlapCount, Math.PI * 2 + Math.abs(rotation))
          : null;
        if (
          !candidate
          || candidate.terminalRingDistance < descriptor.terminalRingDistance + minimumImprovement
        ) {
          continue;
        }
        if (isBetterCandidate(candidate, bestCandidate)) {
          bestCandidate = candidate;
        }
      }

      if (!bestCandidate) {
        continue;
      }
      coords = relieveResidualAromaticRingOverlaps(
        layoutGraph,
        bestCandidate.coords,
        descriptor,
        bondLength,
        baseOverlapCount
      );
      nudges++;
      movedThisPass = true;
    }

    if (!movedThisPass) {
      break;
    }
  }

  return { coords, nudges };
}

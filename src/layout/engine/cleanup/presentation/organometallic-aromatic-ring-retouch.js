/** @module cleanup/presentation/organometallic-aromatic-ring-retouch */

import { auditLayout } from '../../audit/audit.js';
import { isMetalAtom } from '../../topology/metal-centers.js';
import { add, angleOf, angularDifference, centroid, fromAngle, sub } from '../../geometry/vec2.js';

const COORDINATE_BOND_KINDS = new Set(['coordinate', 'dative', 'haptic']);
const RING_RETOUCH_MIN_ANGLE_DEVIATION = Math.PI / 7.5;
const RING_RETOUCH_MIN_IMPROVEMENT = Math.PI / 18;
const RING_RETOUCH_BOND_DEVIATION_SLACK_FACTOR = 0.02;

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

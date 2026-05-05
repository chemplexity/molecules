/** @module cleanup/presentation/projected-tetrahedral-clearance */

import { auditLayout } from '../../audit/audit.js';
import { findSevereOverlaps } from '../../audit/invariants.js';
import { CLEANUP_EPSILON, DISTANCE_EPSILON, PRESENTATION_METRIC_EPSILON } from '../../constants.js';
import { angleOf, angularDifference, sub, wrapAngle } from '../../geometry/vec2.js';
import { rotateAround } from '../../geometry/transforms.js';
import { collectCutSubtree } from '../subtree-utils.js';

const IDEAL_PROJECTED_SLOT_ANGLE = Math.PI / 2;
const IDEAL_PROJECTED_OPPOSITE_ANGLE = Math.PI;
const MAX_PROJECTED_CENTER_DEVIATION = 1e-6;
const MAX_DIRECT_CENTER_SLOT_ROTATION = Math.PI / 3;
const MAX_DIRECT_SLOT_SUBTREE_HEAVY_ATOMS = 28;
const MIN_SAFE_BRANCH_BEND = (7 * Math.PI) / 12;
const MAX_SAFE_BRANCH_BEND = (5 * Math.PI) / 6;
const MAX_BRANCH_CLEARANCE_HEAVY_ATOMS = 24;
const RESOLVED_OVERLAP_CLEARANCE_FACTOR = 0.7;
const BRANCH_CLEARANCE_ROTATION_STEPS = [
  Math.PI / 12,
  -Math.PI / 12,
  Math.PI / 9,
  -Math.PI / 9,
  Math.PI / 18,
  -Math.PI / 18,
  (5 * Math.PI) / 36,
  (-5 * Math.PI) / 36,
  Math.PI / 6,
  -Math.PI / 6
];

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

function projectedCenterPenalty(coords, centerAtomId, neighborAtomIds) {
  const centerPosition = coords.get(centerAtomId);
  if (!centerPosition || neighborAtomIds.length !== 4) {
    return null;
  }

  let maxDeviation = 0;
  let totalDeviation = 0;
  for (let firstIndex = 0; firstIndex < neighborAtomIds.length; firstIndex++) {
    const firstPosition = coords.get(neighborAtomIds[firstIndex]);
    if (!firstPosition) {
      return null;
    }
    const firstAngle = angleOf(sub(firstPosition, centerPosition));
    for (let secondIndex = firstIndex + 1; secondIndex < neighborAtomIds.length; secondIndex++) {
      const secondPosition = coords.get(neighborAtomIds[secondIndex]);
      if (!secondPosition) {
        return null;
      }
      const separation = angularDifference(firstAngle, angleOf(sub(secondPosition, centerPosition)));
      const deviation = Math.min(
        Math.abs(separation - IDEAL_PROJECTED_SLOT_ANGLE),
        Math.abs(separation - IDEAL_PROJECTED_OPPOSITE_ANGLE)
      );
      maxDeviation = Math.max(maxDeviation, deviation);
      totalDeviation += deviation;
    }
  }

  return { maxDeviation, totalDeviation };
}

function isProjectedTetrahedralCenter(layoutGraph, coords, centerAtomId) {
  const centerAtom = layoutGraph.atoms.get(centerAtomId);
  if (
    !centerAtom
    || centerAtom.element === 'H'
    || centerAtom.aromatic
    || (layoutGraph.atomToRings.get(centerAtomId)?.length ?? 0) > 0
  ) {
    return null;
  }
  const heavyBonds = visibleHeavyCovalentBonds(layoutGraph, coords, centerAtomId);
  if (
    heavyBonds.length !== 4
    || heavyBonds.some(({ bond }) => bond.aromatic || (bond.order ?? 1) !== 1)
  ) {
    return null;
  }
  const neighborAtomIds = heavyBonds.map(({ neighborAtomId }) => neighborAtomId);
  const penalty = projectedCenterPenalty(coords, centerAtomId, neighborAtomIds);
  if (!penalty || penalty.maxDeviation > MAX_PROJECTED_CENTER_DEVIATION) {
    return null;
  }
  return { centerAtomId, neighborAtomIds, penalty };
}

function collectDirectSlotCenterDescriptor(layoutGraph, coords, centerAtomId, frozenAtomIds) {
  const centerAtom = layoutGraph.atoms.get(centerAtomId);
  if (
    !centerAtom
    || centerAtom.element !== 'C'
    || centerAtom.aromatic
    || centerAtom.chirality
    || centerAtom.heavyDegree !== 4
    || (layoutGraph.atomToRings.get(centerAtomId)?.length ?? 0) > 0
  ) {
    return null;
  }

  const centerPosition = coords.get(centerAtomId);
  const heavyBonds = visibleHeavyCovalentBonds(layoutGraph, coords, centerAtomId);
  if (
    !centerPosition
    || heavyBonds.length !== 4
    || heavyBonds.some(({ bond }) => bond.aromatic || (bond.order ?? 1) !== 1)
  ) {
    return null;
  }

  const records = [];
  for (const { neighborAtomId } of heavyBonds) {
    const neighborAtom = layoutGraph.atoms.get(neighborAtomId);
    if (!neighborAtom || frozenAtomIds?.has(neighborAtomId)) {
      return null;
    }
    const subtreeAtomIds = [...collectCutSubtree(layoutGraph, neighborAtomId, centerAtomId)]
      .filter(atomId => coords.has(atomId));
    if (
      subtreeAtomIds.length === 0
      || subtreeAtomIds.includes(centerAtomId)
      || subtreeAtomIds.some(atomId => frozenAtomIds?.has(atomId))
    ) {
      return null;
    }
    let heavyAtomCount = 0;
    for (const atomId of subtreeAtomIds) {
      if (layoutGraph.atoms.get(atomId)?.element !== 'H') {
        heavyAtomCount++;
      }
    }
    if (heavyAtomCount === 0 || heavyAtomCount > MAX_DIRECT_SLOT_SUBTREE_HEAVY_ATOMS) {
      return null;
    }
    records.push({
      atomId: neighborAtomId,
      element: neighborAtom.element,
      heavyDegree: neighborAtom.heavyDegree ?? 0,
      isAttachedRingRoot: (layoutGraph.atomToRings.get(neighborAtomId)?.length ?? 0) > 0,
      subtreeAtomIds,
      heavyAtomCount,
      angle: wrapAngle(angleOf(sub(coords.get(neighborAtomId), centerPosition)))
    });
  }

  if (
    records.filter(record => record.isAttachedRingRoot).length < 2
    || !records.some(record => !record.isAttachedRingRoot && record.element === 'N' && record.heavyDegree === 2)
  ) {
    return null;
  }

  const neighborAtomIds = records.map(record => record.atomId);
  const penalty = projectedCenterPenalty(coords, centerAtomId, neighborAtomIds);
  return penalty ? { centerAtomId, neighborAtomIds, records, penalty } : null;
}

function projectedCenterSlotAngles(baseAngle) {
  return [0, 1, 2, 3].map(slotIndex => wrapAngle(baseAngle + (slotIndex * Math.PI) / 2));
}

function visitDirectSlotAssignments(records, slots, visitor) {
  const assignments = [];
  const usedSlots = new Set();
  const visitRecord = index => {
    if (index >= records.length) {
      visitor(assignments.map(assignment => ({ ...assignment })));
      return;
    }
    const record = records[index];
    for (let slotIndex = 0; slotIndex < slots.length; slotIndex++) {
      if (usedSlots.has(slotIndex)) {
        continue;
      }
      const targetAngle = slots[slotIndex];
      const deviation = angularDifference(record.angle, targetAngle);
      if (deviation > MAX_DIRECT_CENTER_SLOT_ROTATION) {
        continue;
      }
      usedSlots.add(slotIndex);
      assignments.push({
        record,
        targetAngle,
        rotation: wrapAngle(targetAngle - record.angle),
        deviation
      });
      visitRecord(index + 1);
      assignments.pop();
      usedSlots.delete(slotIndex);
    }
  };
  visitRecord(0);
}

function buildDirectSlotCandidateCoords(coords, descriptor, assignments) {
  const centerPosition = coords.get(descriptor.centerAtomId);
  if (!centerPosition) {
    return null;
  }
  const candidateCoords = new Map(coords);
  let movedAny = false;
  for (const assignment of assignments) {
    if (Math.abs(assignment.rotation) <= DISTANCE_EPSILON) {
      continue;
    }
    movedAny = true;
    for (const atomId of assignment.record.subtreeAtomIds) {
      const position = coords.get(atomId);
      if (!position) {
        continue;
      }
      candidateCoords.set(atomId, rotateAround(position, centerPosition, assignment.rotation));
    }
  }
  return movedAny ? candidateCoords : null;
}

function collectBranchClearanceDescriptors(layoutGraph, coords, centerDescriptor, frozenAtomIds) {
  const descriptors = [];
  for (const parentAtomId of centerDescriptor.neighborAtomIds) {
    if (frozenAtomIds?.has(parentAtomId)) {
      continue;
    }
    const parentAtom = layoutGraph.atoms.get(parentAtomId);
    if (
      !parentAtom
      || parentAtom.element === 'H'
      || parentAtom.aromatic
      || (layoutGraph.atomToRings.get(parentAtomId)?.length ?? 0) > 0
    ) {
      continue;
    }
    const childBonds = visibleHeavyCovalentBonds(layoutGraph, coords, parentAtomId)
      .filter(({ neighborAtomId, bond }) => (
        neighborAtomId !== centerDescriptor.centerAtomId
        && !bond.aromatic
        && (bond.order ?? 1) === 1
      ));
    if (childBonds.length !== 1) {
      continue;
    }
    const rootAtomId = childBonds[0].neighborAtomId;
    if (frozenAtomIds?.has(rootAtomId)) {
      continue;
    }
    const subtreeAtomIds = [...collectCutSubtree(layoutGraph, rootAtomId, parentAtomId)]
      .filter(atomId => coords.has(atomId));
    if (
      subtreeAtomIds.length === 0
      || subtreeAtomIds.includes(centerDescriptor.centerAtomId)
      || subtreeAtomIds.includes(parentAtomId)
    ) {
      continue;
    }
    let heavyAtomCount = 0;
    let blocked = false;
    for (const atomId of subtreeAtomIds) {
      if (frozenAtomIds?.has(atomId)) {
        blocked = true;
        break;
      }
      if (layoutGraph.atoms.get(atomId)?.element !== 'H') {
        heavyAtomCount++;
      }
    }
    if (blocked || heavyAtomCount === 0 || heavyAtomCount > MAX_BRANCH_CLEARANCE_HEAVY_ATOMS) {
      continue;
    }
    descriptors.push({
      centerAtomId: centerDescriptor.centerAtomId,
      parentAtomId,
      rootAtomId,
      subtreeAtomIds,
      heavyAtomCount
    });
  }
  return descriptors;
}

function descriptorsAreDisjoint(firstDescriptor, secondDescriptor) {
  const firstAtomIds = new Set(firstDescriptor.subtreeAtomIds);
  if (
    firstAtomIds.has(secondDescriptor.parentAtomId)
    || secondDescriptor.subtreeAtomIds.includes(firstDescriptor.parentAtomId)
  ) {
    return false;
  }
  return secondDescriptor.subtreeAtomIds.every(atomId => !firstAtomIds.has(atomId));
}

function rotateDescriptorSubtree(coords, descriptor, rotation) {
  const pivot = coords.get(descriptor.parentAtomId);
  if (!pivot) {
    return null;
  }
  const nextCoords = new Map(coords);
  for (const atomId of descriptor.subtreeAtomIds) {
    const position = coords.get(atomId);
    if (!position) {
      continue;
    }
    nextCoords.set(atomId, rotateAround(position, pivot, rotation));
  }
  return nextCoords;
}

function branchBend(coords, descriptor) {
  const parentPosition = coords.get(descriptor.parentAtomId);
  const centerPosition = coords.get(descriptor.centerAtomId);
  const rootPosition = coords.get(descriptor.rootAtomId);
  if (!parentPosition || !centerPosition || !rootPosition) {
    return null;
  }
  return angularDifference(
    angleOf(sub(centerPosition, parentPosition)),
    angleOf(sub(rootPosition, parentPosition))
  );
}

function candidateKeepsBranchBends(coords, descriptors) {
  for (const descriptor of descriptors) {
    const bend = branchBend(coords, descriptor);
    if (bend == null || bend < MIN_SAFE_BRANCH_BEND - DISTANCE_EPSILON || bend > MAX_SAFE_BRANCH_BEND + DISTANCE_EPSILON) {
      return false;
    }
  }
  return true;
}

function applyDescriptorRotations(coords, descriptorRotations) {
  let nextCoords = coords;
  for (const { descriptor, rotation } of descriptorRotations) {
    const rotatedCoords = rotateDescriptorSubtree(nextCoords, descriptor, rotation);
    if (!rotatedCoords) {
      return null;
    }
    nextCoords = rotatedCoords;
  }
  return nextCoords;
}

function auditCountsAcceptCleanCandidate(candidateAudit, baseAudit) {
  return (
    candidateAudit?.ok === true
    && (candidateAudit.bondLengthFailureCount ?? 0) <= (baseAudit?.bondLengthFailureCount ?? 0)
    && (candidateAudit.visibleHeavyBondCrossingCount ?? 0) <= (baseAudit?.visibleHeavyBondCrossingCount ?? 0)
    && (candidateAudit.collapsedMacrocycleCount ?? 0) <= (baseAudit?.collapsedMacrocycleCount ?? 0)
    && (candidateAudit.ringSubstituentReadabilityFailureCount ?? 0) <= (baseAudit?.ringSubstituentReadabilityFailureCount ?? 0)
    && !((candidateAudit.stereoContradiction ?? false) && !(baseAudit?.stereoContradiction ?? false))
  );
}

function scoreCandidate(candidate) {
  return (
    (candidate.resolvedOverlapClearancePenalty ?? 0) * 100
    +
    candidate.centerPenalty.maxDeviation * 1000
    + candidate.centerPenalty.totalDeviation * 100
    + candidate.totalRotation
    + candidate.movedHeavyAtomCount * CLEANUP_EPSILON
  );
}

function resolvedOverlapClearancePenalty(coords, baseOverlaps, bondLength) {
  const targetClearance = bondLength * RESOLVED_OVERLAP_CLEARANCE_FACTOR;
  let penalty = 0;
  for (const overlap of baseOverlaps ?? []) {
    const firstPosition = coords.get(overlap.firstAtomId);
    const secondPosition = coords.get(overlap.secondAtomId);
    if (!firstPosition || !secondPosition) {
      continue;
    }
    const clearance = Math.hypot(firstPosition.x - secondPosition.x, firstPosition.y - secondPosition.y);
    penalty += Math.max(0, targetClearance - clearance);
  }
  return penalty;
}

function findExactProjectedBranchClearanceCandidate(layoutGraph, inputCoords, options, baseAudit, baseOverlaps) {
  const bondLength = options.bondLength ?? layoutGraph.options.bondLength;
  let bestCandidate = null;
  for (const centerAtomId of inputCoords.keys()) {
    const centerDescriptor = isProjectedTetrahedralCenter(layoutGraph, inputCoords, centerAtomId);
    if (!centerDescriptor) {
      continue;
    }
    const descriptors = collectBranchClearanceDescriptors(
      layoutGraph,
      inputCoords,
      centerDescriptor,
      options.frozenAtomIds ?? null
    );
    if (descriptors.length < 2) {
      continue;
    }

    for (let firstIndex = 0; firstIndex < descriptors.length; firstIndex++) {
      for (let secondIndex = firstIndex + 1; secondIndex < descriptors.length; secondIndex++) {
        const firstDescriptor = descriptors[firstIndex];
        const secondDescriptor = descriptors[secondIndex];
        if (!descriptorsAreDisjoint(firstDescriptor, secondDescriptor)) {
          continue;
        }
        for (const firstRotation of BRANCH_CLEARANCE_ROTATION_STEPS) {
          for (const secondRotation of BRANCH_CLEARANCE_ROTATION_STEPS) {
            const candidateCoords = applyDescriptorRotations(inputCoords, [
              { descriptor: firstDescriptor, rotation: firstRotation },
              { descriptor: secondDescriptor, rotation: secondRotation }
            ]);
            if (!candidateCoords || !candidateKeepsBranchBends(candidateCoords, [firstDescriptor, secondDescriptor])) {
              continue;
            }
            const centerPenalty = projectedCenterPenalty(
              candidateCoords,
              centerDescriptor.centerAtomId,
              centerDescriptor.neighborAtomIds
            );
            if (
              !centerPenalty
              || centerPenalty.maxDeviation > centerDescriptor.penalty.maxDeviation + PRESENTATION_METRIC_EPSILON
              || centerPenalty.totalDeviation > centerDescriptor.penalty.totalDeviation + PRESENTATION_METRIC_EPSILON
            ) {
              continue;
            }
            const candidateAudit = auditLayout(layoutGraph, candidateCoords, {
              bondLength,
              bondValidationClasses: options.bondValidationClasses
            });
            if (!auditCountsAcceptCleanCandidate(candidateAudit, baseAudit)) {
              continue;
            }
            const candidate = {
              coords: candidateCoords,
              audit: candidateAudit,
              centerPenalty,
              descriptors: [firstDescriptor, secondDescriptor],
              rotations: [firstRotation, secondRotation],
              totalRotation: Math.abs(firstRotation) + Math.abs(secondRotation),
              movedHeavyAtomCount: firstDescriptor.heavyAtomCount + secondDescriptor.heavyAtomCount,
              resolvedOverlapClearancePenalty: resolvedOverlapClearancePenalty(candidateCoords, baseOverlaps, bondLength)
            };
            if (!bestCandidate || scoreCandidate(candidate) < scoreCandidate(bestCandidate) - PRESENTATION_METRIC_EPSILON) {
              bestCandidate = candidate;
            }
          }
        }
      }
    }
  }

  return bestCandidate;
}

function findDirectProjectedSlotClearanceCandidate(layoutGraph, inputCoords, options, baseAudit, baseOverlaps) {
  const bondLength = options.bondLength ?? layoutGraph.options.bondLength;
  let bestCandidate = null;
  for (const centerAtomId of inputCoords.keys()) {
    const descriptor = collectDirectSlotCenterDescriptor(
      layoutGraph,
      inputCoords,
      centerAtomId,
      options.frozenAtomIds ?? null
    );
    if (!descriptor || descriptor.penalty.maxDeviation <= MAX_PROJECTED_CENTER_DEVIATION) {
      continue;
    }

    for (const anchorRecord of descriptor.records) {
      for (let slotIndex = 0; slotIndex < 4; slotIndex++) {
        const slots = projectedCenterSlotAngles(anchorRecord.angle - (slotIndex * Math.PI) / 2);
        visitDirectSlotAssignments(descriptor.records, slots, assignments => {
          const directCoords = buildDirectSlotCandidateCoords(inputCoords, descriptor, assignments);
          if (!directCoords) {
            return;
          }
          const centerPenalty = projectedCenterPenalty(directCoords, descriptor.centerAtomId, descriptor.neighborAtomIds);
          if (!centerPenalty || centerPenalty.maxDeviation > MAX_PROJECTED_CENTER_DEVIATION) {
            return;
          }

          let candidateCoords = directCoords;
          let candidateAudit = auditLayout(layoutGraph, candidateCoords, {
            bondLength,
            bondValidationClasses: options.bondValidationClasses
          });
          let branchCandidate = null;
          if (!auditCountsAcceptCleanCandidate(candidateAudit, baseAudit)) {
            branchCandidate = findExactProjectedBranchClearanceCandidate(layoutGraph, candidateCoords, options, baseAudit, baseOverlaps);
            if (!branchCandidate) {
              return;
            }
            candidateCoords = branchCandidate.coords;
            candidateAudit = branchCandidate.audit;
          }
          if (!auditCountsAcceptCleanCandidate(candidateAudit, baseAudit)) {
            return;
          }

          const finalCenterPenalty = projectedCenterPenalty(candidateCoords, descriptor.centerAtomId, descriptor.neighborAtomIds);
          if (!finalCenterPenalty || finalCenterPenalty.maxDeviation > MAX_PROJECTED_CENTER_DEVIATION) {
            return;
          }
          const totalRotation = assignments.reduce((total, assignment) => total + Math.abs(assignment.rotation), 0)
            + (branchCandidate?.totalRotation ?? 0);
          const movedHeavyAtomCount = descriptor.records.reduce((total, record) => total + record.heavyAtomCount, 0)
            + (branchCandidate?.movedHeavyAtomCount ?? 0);
          const candidate = {
            coords: candidateCoords,
            audit: candidateAudit,
            centerPenalty: finalCenterPenalty,
            descriptors: [
              ...descriptor.records.map(record => ({
                subtreeAtomIds: record.subtreeAtomIds
              })),
              ...(branchCandidate?.descriptors ?? [])
            ],
            rotations: [
              ...assignments.map(assignment => assignment.rotation),
              ...(branchCandidate?.rotations ?? [])
            ],
            totalRotation,
            movedHeavyAtomCount,
            resolvedOverlapClearancePenalty: resolvedOverlapClearancePenalty(candidateCoords, baseOverlaps, bondLength)
          };
          if (!bestCandidate || scoreCandidate(candidate) < scoreCandidate(bestCandidate) - PRESENTATION_METRIC_EPSILON) {
            bestCandidate = candidate;
          }
        });
      }
    }
  }

  return bestCandidate;
}

/**
 * Clears symmetric projected-tetrahedral branch clashes by rotating either the
 * next bond down from exact center substituents or, for browser-specific
 * 60/120 slot collapses, direct substituent subtrees back onto a 90/180 cross.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} inputCoords - Starting coordinates.
 * @param {{bondLength?: number, frozenAtomIds?: Set<string>|null, bondValidationClasses?: Map<string, string>}} [options] - Cleanup options.
 * @returns {{coords: Map<string, {x: number, y: number}>, nudges: number, changed: boolean}} Retouch result.
 */
export function runProjectedTetrahedralBranchClearance(layoutGraph, inputCoords, options = {}) {
  const bondLength = options.bondLength ?? layoutGraph.options.bondLength;
  const baseOverlaps = findSevereOverlaps(layoutGraph, inputCoords, bondLength);
  if (baseOverlaps.length === 0) {
    return {
      coords: inputCoords,
      nudges: 0,
      changed: false
    };
  }

  const baseAudit = auditLayout(layoutGraph, inputCoords, {
    bondLength,
    bondValidationClasses: options.bondValidationClasses
  });
  const bestCandidate =
    findExactProjectedBranchClearanceCandidate(layoutGraph, inputCoords, options, baseAudit, baseOverlaps)
    ?? findDirectProjectedSlotClearanceCandidate(layoutGraph, inputCoords, options, baseAudit, baseOverlaps);

  if (!bestCandidate) {
    return {
      coords: inputCoords,
      nudges: 0,
      changed: false
    };
  }

  return {
    coords: bestCandidate.coords,
    nudges: bestCandidate.descriptors.length,
    changed: true,
    movedAtomIds: [...new Set(bestCandidate.descriptors.flatMap(descriptor => descriptor.subtreeAtomIds))],
    rotations: bestCandidate.rotations
  };
}

/** @module cleanup/presentation/ring-chain-unit-projection-retouch */

import { auditLayout } from '../../audit/audit.js';
import { findSevereOverlaps } from '../../audit/invariants.js';
import { centroidForAtomIds } from '../../geometry/vec2.js';
import { describePathLikeIsolatedRingChain } from '../../topology/isolated-ring-chain.js';
import { collectCutSubtree } from '../subtree-utils.js';

const SIDE_BRANCH_DESCENDANT_ROTATION_CANDIDATES = Object.freeze([
  0,
  ...Array.from({ length: 12 }, (_value, index) => ((index + 1) * Math.PI) / 12).flatMap(angle => (Math.abs(angle - Math.PI) <= 1e-9 ? [Math.PI] : [angle, -angle]))
]);
const NEIGHBOR_SIDE_BRANCH_RELIEF_ROTATIONS = Object.freeze([
  Math.PI / 72,
  -Math.PI / 72,
  Math.PI / 36,
  -Math.PI / 36,
  Math.PI / 24,
  -Math.PI / 24,
  Math.PI / 18,
  -Math.PI / 18,
  Math.PI / 12,
  -Math.PI / 12
]);
const INTERNAL_LIGAND_RELIEF_MAX_ROOT_DEVIATION = Math.PI / 180;
const HYPERVALENT_BRANCH_CENTER_ELEMENTS = new Set(['S', 'P', 'Se', 'As']);
const HYPERVALENT_CROSS_GEOMETRY_SCORE_WEIGHT = 1_000;
const SHARED_BACKBONE_LINKER_SCALE_CANDIDATES = Object.freeze([1.16, 1.18, 1.14, 1.2]);

function otherBondAtomId(bond, atomId) {
  return bond.a === atomId ? bond.b : bond.a;
}

function centroidOf(coords, atomIds) {
  return centroidForAtomIds(coords, atomIds);
}

function edgeBetween(ringChain, firstRingSystemId, secondRingSystemId) {
  return (
    (ringChain.edges ?? []).find(
      edge =>
        (edge.firstRingSystemId === firstRingSystemId && edge.secondRingSystemId === secondRingSystemId) ||
        (edge.firstRingSystemId === secondRingSystemId && edge.secondRingSystemId === firstRingSystemId)
    ) ?? null
  );
}

function orderedEdgeAttachment(edge, previousRingSystemId, nextRingSystemId) {
  if (!edge || ![1, 2].includes(edge.linkerAtomIds?.length ?? 0)) {
    return null;
  }
  if (edge.firstRingSystemId === previousRingSystemId && edge.secondRingSystemId === nextRingSystemId) {
    return {
      linkerAtomIds: edge.linkerAtomIds,
      previousAttachmentAtomId: edge.firstAttachmentAtomId,
      nextAttachmentAtomId: edge.secondAttachmentAtomId
    };
  }
  if (edge.secondRingSystemId === previousRingSystemId && edge.firstRingSystemId === nextRingSystemId) {
    return {
      linkerAtomIds: [...edge.linkerAtomIds].reverse(),
      previousAttachmentAtomId: edge.secondAttachmentAtomId,
      nextAttachmentAtomId: edge.firstAttachmentAtomId
    };
  }
  return null;
}

function orderedLinkEdges(ringChain) {
  const orderedRingSystemIds = ringChain.orderedRingSystemIds ?? [];
  const edges = [];
  for (let index = 1; index < orderedRingSystemIds.length; index++) {
    const edge = orderedEdgeAttachment(edgeBetween(ringChain, orderedRingSystemIds[index - 1], orderedRingSystemIds[index]), orderedRingSystemIds[index - 1], orderedRingSystemIds[index]);
    if (!edge) {
      return [];
    }
    edges.push(edge);
  }
  return edges;
}

function bondBetweenAtomIds(layoutGraph, firstAtomId, secondAtomId) {
  const key = firstAtomId < secondAtomId ? `${firstAtomId}:${secondAtomId}` : `${secondAtomId}:${firstAtomId}`;
  return layoutGraph.bondByAtomPair?.get(key) ?? null;
}

function relaxedLinkerBondValidationClasses(layoutGraph, ringChain, baseBondValidationClasses = null) {
  const bondValidationClasses = new Map(baseBondValidationClasses ?? []);
  for (const edge of ringChain.edges ?? []) {
    const atomPath = [edge.firstAttachmentAtomId, ...(edge.linkerAtomIds ?? []), edge.secondAttachmentAtomId];
    for (let index = 1; index < atomPath.length; index++) {
      const bond = bondBetweenAtomIds(layoutGraph, atomPath[index - 1], atomPath[index]);
      if (bond) {
        bondValidationClasses.set(bond.id, 'bridged');
      }
    }
  }
  return bondValidationClasses;
}

function ringUnitAtomIds(layoutGraph, inputCoords, ringSystem, ringAtomIds, linkerAtomIds, claimedAtomIds) {
  const atomIds = new Set();
  for (const atomId of ringSystem.atomIds ?? []) {
    atomIds.add(atomId);
  }

  for (const ringAtomId of ringSystem.atomIds ?? []) {
    for (const bond of layoutGraph.bondsByAtomId.get(ringAtomId) ?? []) {
      if (bond.kind !== 'covalent') {
        continue;
      }
      const neighborAtomId = otherBondAtomId(bond, ringAtomId);
      if (ringAtomIds.has(neighborAtomId) || linkerAtomIds.has(neighborAtomId)) {
        continue;
      }
      for (const subtreeAtomId of collectCutSubtree(layoutGraph, neighborAtomId, ringAtomId)) {
        if (!linkerAtomIds.has(subtreeAtomId)) {
          atomIds.add(subtreeAtomId);
        }
      }
    }
  }

  return [...atomIds]
    .filter(atomId => inputCoords.has(atomId))
    .filter(atomId => {
      if (claimedAtomIds.has(atomId)) {
        return false;
      }
      claimedAtomIds.add(atomId);
      return true;
    });
}

function normalizeAngle(angle) {
  let normalized = angle;
  while (normalized <= -Math.PI) {
    normalized += Math.PI * 2;
  }
  while (normalized > Math.PI) {
    normalized -= Math.PI * 2;
  }
  return normalized;
}

function normalizeVector(vector) {
  const length = Math.hypot(vector.x, vector.y);
  if (length <= 1e-9) {
    return null;
  }
  return {
    x: vector.x / length,
    y: vector.y / length
  };
}

function rotateVector(vector, angle) {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return {
    x: vector.x * cos - vector.y * sin,
    y: vector.x * sin + vector.y * cos
  };
}

function rotateRelative(position, origin, angle) {
  const dx = position.x - origin.x;
  const dy = position.y - origin.y;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return {
    x: dx * cos - dy * sin,
    y: dx * sin + dy * cos
  };
}

function shiftedRotatedSubtreeCoords(coords, subtreeAtomIds, origin, angle, shift) {
  const nextCoords = new Map(coords);
  for (const atomId of subtreeAtomIds) {
    const position = coords.get(atomId);
    if (!position) {
      continue;
    }
    const relativePosition = rotateRelative(position, origin, angle);
    nextCoords.set(atomId, {
      x: origin.x + relativePosition.x + shift.x,
      y: origin.y + relativePosition.y + shift.y
    });
  }
  return nextCoords;
}

function rotatedAtomsCoords(coords, atomIds, origin, angle) {
  if (Math.abs(angle) <= 1e-12 || atomIds.length === 0) {
    return coords;
  }
  const nextCoords = new Map(coords);
  for (const atomId of atomIds) {
    const position = coords.get(atomId);
    if (!position) {
      continue;
    }
    const relativePosition = rotateRelative(position, origin, angle);
    nextCoords.set(atomId, {
      x: origin.x + relativePosition.x,
      y: origin.y + relativePosition.y
    });
  }
  return nextCoords;
}

function addScaledVector(position, vector, scale) {
  return {
    x: position.x + vector.x * scale,
    y: position.y + vector.y * scale
  };
}

function subtractScaledVector(position, vector, scale) {
  return {
    x: position.x - vector.x * scale,
    y: position.y - vector.y * scale
  };
}

function ringNeighborIds(layoutGraph, ringSystem, atomId) {
  const ringAtomIds = new Set(ringSystem?.atomIds ?? []);
  return (layoutGraph.bondsByAtomId.get(atomId) ?? []).map(bond => otherBondAtomId(bond, atomId)).filter(neighborAtomId => ringAtomIds.has(neighborAtomId));
}

function localOutwardVector(layoutGraph, inputCoords, ringSystem, center, atomId) {
  const position = inputCoords.get(atomId);
  const neighborPositions = ringNeighborIds(layoutGraph, ringSystem, atomId)
    .map(neighborAtomId => inputCoords.get(neighborAtomId))
    .filter(Boolean);
  if (!position || neighborPositions.length < 2) {
    return null;
  }

  const firstNeighbor = normalizeVector({
    x: neighborPositions[0].x - position.x,
    y: neighborPositions[0].y - position.y
  });
  const secondNeighbor = normalizeVector({
    x: neighborPositions[1].x - position.x,
    y: neighborPositions[1].y - position.y
  });
  if (!firstNeighbor || !secondNeighbor) {
    return null;
  }

  const bisector = normalizeVector({
    x: firstNeighbor.x + secondNeighbor.x,
    y: firstNeighbor.y + secondNeighbor.y
  });
  const radial = normalizeVector({
    x: position.x - center.x,
    y: position.y - center.y
  });
  if (!bisector || !radial) {
    return radial;
  }
  return bisector.x * radial.x + bisector.y * radial.y >= 0 ? bisector : { x: -bisector.x, y: -bisector.y };
}

function rotationForRingUnit(inputCoords, center, previousAttachmentAtomId, nextAttachmentAtomId) {
  if (previousAttachmentAtomId && nextAttachmentAtomId) {
    const previousAttachment = inputCoords.get(previousAttachmentAtomId);
    const nextAttachment = inputCoords.get(nextAttachmentAtomId);
    if (previousAttachment && nextAttachment) {
      return normalizeAngle(-Math.atan2(nextAttachment.y - previousAttachment.y, nextAttachment.x - previousAttachment.x));
    }
  }
  if (nextAttachmentAtomId) {
    const nextAttachment = inputCoords.get(nextAttachmentAtomId);
    if (nextAttachment) {
      return normalizeAngle(-Math.atan2(nextAttachment.y - center.y, nextAttachment.x - center.x));
    }
  }
  if (previousAttachmentAtomId) {
    const previousAttachment = inputCoords.get(previousAttachmentAtomId);
    if (previousAttachment) {
      return normalizeAngle(Math.PI - Math.atan2(previousAttachment.y - center.y, previousAttachment.x - center.x));
    }
  }
  return 0;
}

function singleSideBranchRootAtomId(layoutGraph, inputCoords, anchorAtomId, ringAtomIds, linkerAtomIds) {
  const rootAtomIds = [];
  for (const bond of layoutGraph.bondsByAtomId.get(anchorAtomId) ?? []) {
    if (!bond || bond.kind !== 'covalent') {
      continue;
    }
    const rootAtomId = otherBondAtomId(bond, anchorAtomId);
    const rootAtom = layoutGraph.atoms.get(rootAtomId);
    if (!rootAtom || rootAtom.element === 'H' || !inputCoords.has(rootAtomId) || ringAtomIds.has(rootAtomId) || linkerAtomIds.has(rootAtomId)) {
      continue;
    }
    rootAtomIds.push(rootAtomId);
  }
  return rootAtomIds.length === 1 ? rootAtomIds[0] : null;
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

function auditScore(audit) {
  return (
    (audit.bondLengthFailureCount ?? 0) * 100_000_000 +
    (audit.severeOverlapCount ?? 0) * 10_000_000 +
    (audit.visibleHeavyBondCrossingCount ?? 0) * 1_000_000 +
    (audit.ringSubstituentReadabilityFailureCount ?? 0) * 100_000 +
    (audit.inwardRingSubstituentCount ?? 0) * 100_000 +
    (audit.outwardAxisRingSubstituentFailureCount ?? 0) * 100_000 +
    (audit.labelOverlapCount ?? 0) * 10_000 +
    (audit.severeOverlapPenalty ?? 0) * 1_000
  );
}

function visibleHeavyNeighborAtomIds(layoutGraph, coords, atomId) {
  return (layoutGraph.bondsByAtomId.get(atomId) ?? [])
    .map(bond => otherBondAtomId(bond, atomId))
    .filter(neighborAtomId => {
      const neighborAtom = layoutGraph.atoms.get(neighborAtomId);
      return neighborAtom && neighborAtom.element !== 'H' && coords.has(neighborAtomId);
    });
}

function angleBetweenPositions(firstPosition, centerPosition, secondPosition) {
  const firstVector = {
    x: firstPosition.x - centerPosition.x,
    y: firstPosition.y - centerPosition.y
  };
  const secondVector = {
    x: secondPosition.x - centerPosition.x,
    y: secondPosition.y - centerPosition.y
  };
  const denominator = Math.hypot(firstVector.x, firstVector.y) * Math.hypot(secondVector.x, secondVector.y);
  if (!(denominator > 0)) {
    return null;
  }
  const cosine = Math.max(-1, Math.min(1, (firstVector.x * secondVector.x + firstVector.y * secondVector.y) / denominator));
  return Math.acos(cosine);
}

function angularDifference(firstAngle, secondAngle) {
  const difference = Math.abs(normalizeAngle(firstAngle - secondAngle));
  return Math.min(difference, Math.PI * 2 - difference);
}

function sideBranchRootAngleDeviation(layoutGraph, coords, rootAtomId, targetAngle = (Math.PI * 2) / 3) {
  const neighborAtomIds = visibleHeavyNeighborAtomIds(layoutGraph, coords, rootAtomId);
  if (neighborAtomIds.length !== 2) {
    return 0;
  }
  const centerPosition = coords.get(rootAtomId);
  const firstPosition = coords.get(neighborAtomIds[0]);
  const secondPosition = coords.get(neighborAtomIds[1]);
  if (!centerPosition || !firstPosition || !secondPosition) {
    return 0;
  }
  const angle = angleBetweenPositions(firstPosition, centerPosition, secondPosition);
  return angle == null ? 0 : Math.abs(angle - targetAngle);
}

function permutationIndexes(count) {
  if (count === 0) {
    return [[]];
  }
  const result = [];
  const usedIndexes = new Set();
  const current = [];
  const visit = () => {
    if (current.length === count) {
      result.push([...current]);
      return;
    }
    for (let index = 0; index < count; index++) {
      if (usedIndexes.has(index)) {
        continue;
      }
      usedIndexes.add(index);
      current.push(index);
      visit();
      current.pop();
      usedIndexes.delete(index);
    }
  };
  visit();
  return result;
}

const THREE_LIGAND_PERMUTATIONS = Object.freeze(permutationIndexes(3));
const HYPERVALENT_CROSS_TARGET_OFFSETS = Object.freeze([Math.PI, Math.PI / 2, -Math.PI / 2]);

/**
 * Scores how closely a four-coordinate sulfate/phosphate-like branch keeps the
 * ligand opposite the ring-bound root at `180°` and the remaining ligands at a
 * perpendicular cross.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Coordinate map.
 * @param {string} rootAtomId - Branch root attached to the ring anchor.
 * @param {string} anchorAtomId - Ring anchor attached to the branch root.
 * @returns {number} Minimum summed angular deviation in radians.
 */
function hypervalentBranchCrossDeviation(layoutGraph, coords, rootAtomId, anchorAtomId) {
  const centerAtomId = visibleHeavyNeighborAtomIds(layoutGraph, coords, rootAtomId).find(neighborAtomId => neighborAtomId !== anchorAtomId) ?? null;
  const centerAtom = centerAtomId ? layoutGraph.atoms.get(centerAtomId) : null;
  const centerPosition = centerAtomId ? coords.get(centerAtomId) : null;
  const rootPosition = coords.get(rootAtomId);
  if (!centerAtom || !HYPERVALENT_BRANCH_CENTER_ELEMENTS.has(centerAtom.element) || !centerPosition || !rootPosition) {
    return 0;
  }

  const ligandAngles = visibleHeavyNeighborAtomIds(layoutGraph, coords, centerAtomId)
    .filter(ligandAtomId => ligandAtomId !== rootAtomId)
    .map(ligandAtomId => coords.get(ligandAtomId))
    .filter(Boolean)
    .map(position => Math.atan2(position.y - centerPosition.y, position.x - centerPosition.x));
  if (ligandAngles.length !== 3) {
    return 0;
  }

  const rootAngle = Math.atan2(rootPosition.y - centerPosition.y, rootPosition.x - centerPosition.x);
  let bestDeviation = Number.POSITIVE_INFINITY;
  for (const permutation of THREE_LIGAND_PERMUTATIONS) {
    let deviation = 0;
    for (let index = 0; index < permutation.length; index++) {
      deviation += angularDifference(normalizeAngle(ligandAngles[permutation[index]] - rootAngle), HYPERVALENT_CROSS_TARGET_OFFSETS[index]);
    }
    bestDeviation = Math.min(bestDeviation, deviation);
  }
  return bestDeviation;
}

function sideBranchCandidateScore(layoutGraph, coords, rootAtomId, anchorAtomId, audit) {
  return (
    auditScore(audit) +
    sideBranchRootAngleDeviation(layoutGraph, coords, rootAtomId) * 1_000 +
    hypervalentBranchCrossDeviation(layoutGraph, coords, rootAtomId, anchorAtomId) * HYPERVALENT_CROSS_GEOMETRY_SCORE_WEIGHT
  );
}

function exactRootAngleRotations(layoutGraph, coords, rootAtomId, anchorAtomId, targetAngle = (Math.PI * 2) / 3) {
  const rootPosition = coords.get(rootAtomId);
  const anchorPosition = coords.get(anchorAtomId);
  const descendantAtomIds = visibleHeavyNeighborAtomIds(layoutGraph, coords, rootAtomId).filter(neighborAtomId => neighborAtomId !== anchorAtomId);
  if (!rootPosition || !anchorPosition || descendantAtomIds.length !== 1) {
    return [];
  }
  const descendantPosition = coords.get(descendantAtomIds[0]);
  if (!descendantPosition) {
    return [];
  }
  const anchorAngle = Math.atan2(anchorPosition.y - rootPosition.y, anchorPosition.x - rootPosition.x);
  const descendantAngle = Math.atan2(descendantPosition.y - rootPosition.y, descendantPosition.x - rootPosition.x);
  return [normalizeAngle(anchorAngle + targetAngle - descendantAngle), normalizeAngle(anchorAngle - targetAngle - descendantAngle)];
}

function sideBranchDescendantAtomIds(layoutGraph, coords, rootAtomId, anchorAtomId) {
  const atomIds = new Set();
  for (const bond of layoutGraph.bondsByAtomId.get(rootAtomId) ?? []) {
    if (!bond || bond.kind !== 'covalent') {
      continue;
    }
    const neighborAtomId = otherBondAtomId(bond, rootAtomId);
    if (neighborAtomId === anchorAtomId) {
      continue;
    }
    for (const atomId of collectCutSubtree(layoutGraph, neighborAtomId, rootAtomId)) {
      if (coords.has(atomId)) {
        atomIds.add(atomId);
      }
    }
  }
  return [...atomIds];
}

function isRingAtom(layoutGraph, atomId) {
  return layoutGraph.ringAtomIdSet.has(atomId);
}

function nearestRingSideBranchCut(layoutGraph, coords, atomId, blockedAtomIds) {
  if (!coords.has(atomId) || isRingAtom(layoutGraph, atomId) || blockedAtomIds.has(atomId)) {
    return null;
  }
  const queue = [atomId];
  const seen = new Set([atomId]);
  let queueIndex = 0;
  while (queueIndex < queue.length && queueIndex < 24) {
    const currentAtomId = queue[queueIndex++];
    for (const bond of layoutGraph.bondsByAtomId.get(currentAtomId) ?? []) {
      if (!bond || bond.kind !== 'covalent') {
        continue;
      }
      const neighborAtomId = otherBondAtomId(bond, currentAtomId);
      if (!coords.has(neighborAtomId) || blockedAtomIds.has(neighborAtomId)) {
        continue;
      }
      const neighborAtom = layoutGraph.atoms.get(neighborAtomId);
      if (!neighborAtom || neighborAtom.element === 'H') {
        continue;
      }
      if (isRingAtom(layoutGraph, neighborAtomId)) {
        return {
          rootAtomId: currentAtomId,
          anchorAtomId: neighborAtomId
        };
      }
      if (!seen.has(neighborAtomId)) {
        seen.add(neighborAtomId);
        queue.push(neighborAtomId);
      }
    }
  }
  return null;
}

function bestNeighboringSideBranchReliefCoords(layoutGraph, inputCoords, rootAtomId, anchorAtomId, baseAudit, options) {
  const bondLength = options.bondLength ?? layoutGraph.options.bondLength;
  const activeAtomIds = new Set([rootAtomId, ...sideBranchDescendantAtomIds(layoutGraph, inputCoords, rootAtomId, anchorAtomId)]);
  const overlaps = findSevereOverlaps(layoutGraph, inputCoords, bondLength).filter(overlap => activeAtomIds.has(overlap.firstAtomId) !== activeAtomIds.has(overlap.secondAtomId));
  let best = null;
  for (const overlap of overlaps) {
    const externalAtomId = activeAtomIds.has(overlap.firstAtomId) ? overlap.secondAtomId : overlap.firstAtomId;
    const cut = nearestRingSideBranchCut(layoutGraph, inputCoords, externalAtomId, activeAtomIds);
    if (!cut) {
      continue;
    }
    const reliefAtomIds = [...collectCutSubtree(layoutGraph, cut.rootAtomId, cut.anchorAtomId)].filter(candidateAtomId => inputCoords.has(candidateAtomId));
    if (reliefAtomIds.length === 0 || reliefAtomIds.some(candidateAtomId => activeAtomIds.has(candidateAtomId) || isRingAtom(layoutGraph, candidateAtomId))) {
      continue;
    }
    const anchorPosition = inputCoords.get(cut.anchorAtomId);
    if (!anchorPosition) {
      continue;
    }
    for (const rotation of NEIGHBOR_SIDE_BRANCH_RELIEF_ROTATIONS) {
      const coords = rotatedAtomsCoords(inputCoords, reliefAtomIds, anchorPosition, rotation);
      const audit = auditLayout(layoutGraph, coords, {
        bondLength,
        bondValidationClasses: options.bondValidationClasses ?? null
      });
      if (!auditCountsDoNotWorsen(audit, baseAudit)) {
        continue;
      }
      const score = sideBranchCandidateScore(layoutGraph, coords, rootAtomId, anchorAtomId, audit) + Math.abs(rotation);
      if (!best || score < best.score - 1e-9) {
        best = {
          coords,
          audit,
          score
        };
      }
    }
  }
  return best;
}

function bestAuditedSideBranchCoords(layoutGraph, candidateCoords, rootAtomId, anchorAtomId, baseAudit, options) {
  const rootPosition = candidateCoords.get(rootAtomId);
  if (!rootPosition) {
    return null;
  }
  const descendantAtomIds = sideBranchDescendantAtomIds(layoutGraph, candidateCoords, rootAtomId, anchorAtomId);
  const rotationCandidates = [...exactRootAngleRotations(layoutGraph, candidateCoords, rootAtomId, anchorAtomId), ...SIDE_BRANCH_DESCENDANT_ROTATION_CANDIDATES];
  let best = null;
  for (const descendantRotation of rotationCandidates) {
    const coords = rotatedAtomsCoords(candidateCoords, descendantAtomIds, rootPosition, descendantRotation);
    const audit = auditLayout(layoutGraph, coords, {
      bondLength: options.bondLength,
      bondValidationClasses: options.bondValidationClasses ?? null
    });
    if (!auditCountsDoNotWorsen(audit, baseAudit)) {
      const internalRelief = bestInternalLigandReliefCoords(layoutGraph, coords, rootAtomId, anchorAtomId, baseAudit, options);
      const neighborRelief = bestNeighboringSideBranchReliefCoords(layoutGraph, coords, rootAtomId, anchorAtomId, baseAudit, options);
      const relief = [internalRelief, neighborRelief].filter(Boolean).sort((first, second) => first.score - second.score)[0] ?? null;
      if (!relief || (best && relief.score >= best.score - 1e-9)) {
        continue;
      }
      best = relief;
      continue;
    }
    const score = sideBranchCandidateScore(layoutGraph, coords, rootAtomId, anchorAtomId, audit);
    if (!best || score < best.score - 1e-9) {
      best = {
        coords,
        audit,
        score
      };
    }
    const internalRelief = bestInternalLigandReliefCoords(layoutGraph, coords, rootAtomId, anchorAtomId, baseAudit, options);
    if (internalRelief && internalRelief.score < best.score - 1e-9) {
      best = internalRelief;
    }
  }
  return best;
}

function bestInternalLigandReliefCoords(layoutGraph, inputCoords, rootAtomId, anchorAtomId, baseAudit, options) {
  if (sideBranchRootAngleDeviation(layoutGraph, inputCoords, rootAtomId) > INTERNAL_LIGAND_RELIEF_MAX_ROOT_DEVIATION) {
    return null;
  }
  const centerAtomId = visibleHeavyNeighborAtomIds(layoutGraph, inputCoords, rootAtomId).find(neighborAtomId => neighborAtomId !== anchorAtomId) ?? null;
  const centerAtom = centerAtomId ? layoutGraph.atoms.get(centerAtomId) : null;
  const centerPosition = centerAtomId ? inputCoords.get(centerAtomId) : null;
  if (!centerAtom || !HYPERVALENT_BRANCH_CENTER_ELEMENTS.has(centerAtom.element) || !centerPosition) {
    return null;
  }

  let best = null;
  const rootPosition = inputCoords.get(rootAtomId);
  const ligandAtomIds = visibleHeavyNeighborAtomIds(layoutGraph, inputCoords, centerAtomId).filter(ligandAtomId => ligandAtomId !== rootAtomId);
  if (rootPosition && ligandAtomIds.length === 3) {
    const rootAngle = Math.atan2(rootPosition.y - centerPosition.y, rootPosition.x - centerPosition.x);
    for (const permutation of THREE_LIGAND_PERMUTATIONS) {
      let coords = new Map(inputCoords);
      for (let index = 0; index < permutation.length; index++) {
        const ligandAtomId = ligandAtomIds[permutation[index]];
        const ligandPosition = coords.get(ligandAtomId);
        if (!ligandPosition) {
          continue;
        }
        const ligandSubtreeAtomIds = [...collectCutSubtree(layoutGraph, ligandAtomId, centerAtomId)].filter(atomId => coords.has(atomId));
        if (ligandSubtreeAtomIds.length === 0 || ligandSubtreeAtomIds.includes(rootAtomId) || ligandSubtreeAtomIds.includes(anchorAtomId)) {
          continue;
        }
        const ligandAngle = Math.atan2(ligandPosition.y - centerPosition.y, ligandPosition.x - centerPosition.x);
        const targetAngle = rootAngle + HYPERVALENT_CROSS_TARGET_OFFSETS[index];
        coords = rotatedAtomsCoords(coords, ligandSubtreeAtomIds, centerPosition, normalizeAngle(targetAngle - ligandAngle));
      }
      const audit = auditLayout(layoutGraph, coords, {
        bondLength: options.bondLength,
        bondValidationClasses: options.bondValidationClasses ?? null
      });
      if (!auditCountsDoNotWorsen(audit, baseAudit)) {
        continue;
      }
      const score = sideBranchCandidateScore(layoutGraph, coords, rootAtomId, anchorAtomId, audit);
      if (!best || score < best.score - 1e-9) {
        best = {
          coords,
          audit,
          score
        };
      }
    }
  }
  for (const ligandAtomId of visibleHeavyNeighborAtomIds(layoutGraph, inputCoords, centerAtomId)) {
    if (ligandAtomId === rootAtomId) {
      continue;
    }
    const ligandSubtreeAtomIds = [...collectCutSubtree(layoutGraph, ligandAtomId, centerAtomId)].filter(atomId => inputCoords.has(atomId));
    if (ligandSubtreeAtomIds.length === 0 || ligandSubtreeAtomIds.includes(rootAtomId) || ligandSubtreeAtomIds.includes(anchorAtomId)) {
      continue;
    }
    for (const ligandRotation of SIDE_BRANCH_DESCENDANT_ROTATION_CANDIDATES) {
      if (Math.abs(ligandRotation) <= 1e-12) {
        continue;
      }
      const coords = rotatedAtomsCoords(inputCoords, ligandSubtreeAtomIds, centerPosition, ligandRotation);
      const audit = auditLayout(layoutGraph, coords, {
        bondLength: options.bondLength,
        bondValidationClasses: options.bondValidationClasses ?? null
      });
      if (!auditCountsDoNotWorsen(audit, baseAudit)) {
        continue;
      }
      const score = sideBranchCandidateScore(layoutGraph, coords, rootAtomId, anchorAtomId, audit);
      if (!best || score < best.score - 1e-9) {
        best = {
          coords,
          audit,
          score
        };
      }
    }
  }
  return best;
}

function retouchRingSideBranches(layoutGraph, inputCoords, ringChain, ringSystemById, ringCenterBySystemId, ringAtomIds, linkerAtomIds, bondLength, options = {}) {
  let coords = inputCoords;
  let audit = options.auditCandidates
    ? auditLayout(layoutGraph, coords, {
        bondLength,
        bondValidationClasses: options.bondValidationClasses ?? null
      })
    : null;
  const retouchedAtomIds = new Set();
  const orderedRingSystemIds = ringChain.orderedRingSystemIds ?? [];

  for (let index = 0; index < orderedRingSystemIds.length; index++) {
    const ringSystem = ringSystemById.get(orderedRingSystemIds[index]);
    const center = ringCenterBySystemId.get(orderedRingSystemIds[index]);
    if (!ringSystem || !center) {
      continue;
    }

    for (const anchorAtomId of ringSystem.atomIds ?? []) {
      const rootAtomId = singleSideBranchRootAtomId(layoutGraph, coords, anchorAtomId, ringAtomIds, linkerAtomIds);
      if (!rootAtomId) {
        continue;
      }
      const subtreeAtomIds = [...collectCutSubtree(layoutGraph, rootAtomId, anchorAtomId)].filter(atomId => coords.has(atomId));
      if (subtreeAtomIds.length === 0 || subtreeAtomIds.some(atomId => ringAtomIds.has(atomId) || linkerAtomIds.has(atomId) || retouchedAtomIds.has(atomId))) {
        continue;
      }

      const anchorPosition = coords.get(anchorAtomId);
      const rootPosition = coords.get(rootAtomId);
      const outwardVector = localOutwardVector(layoutGraph, coords, ringSystem, center, anchorAtomId);
      if (!anchorPosition || !rootPosition || !outwardVector) {
        continue;
      }
      const currentVector = normalizeVector({
        x: rootPosition.x - anchorPosition.x,
        y: rootPosition.y - anchorPosition.y
      });
      if (!currentVector) {
        continue;
      }

      const angle = normalizeAngle(Math.atan2(outwardVector.y, outwardVector.x) - Math.atan2(currentVector.y, currentVector.x));
      const rotatedRoot = rotateRelative(rootPosition, anchorPosition, angle);
      const targetRoot = {
        x: anchorPosition.x + bondLength * outwardVector.x,
        y: anchorPosition.y + bondLength * outwardVector.y
      };
      const shift = {
        x: targetRoot.x - (anchorPosition.x + rotatedRoot.x),
        y: targetRoot.y - (anchorPosition.y + rotatedRoot.y)
      };
      const candidateCoords = shiftedRotatedSubtreeCoords(coords, subtreeAtomIds, anchorPosition, angle, shift);
      if (options.auditCandidates) {
        const bestCandidate = bestAuditedSideBranchCoords(layoutGraph, candidateCoords, rootAtomId, anchorAtomId, audit, {
          bondLength,
          bondValidationClasses: options.bondValidationClasses ?? null
        });
        if (!bestCandidate) {
          continue;
        }
        coords = bestCandidate.coords;
        audit = bestCandidate.audit;
      } else {
        coords = candidateCoords;
      }
      for (const atomId of subtreeAtomIds) {
        retouchedAtomIds.add(atomId);
      }
    }
  }

  return coords;
}

function ringSystemCentersFromCoords(coords, ringSystems) {
  const centers = new Map();
  for (const ringSystem of ringSystems ?? []) {
    const center = centroidOf(coords, ringSystem.atomIds ?? []);
    if (center) {
      centers.set(ringSystem.id, center);
    }
  }
  return centers;
}

function translateToInputCentroid(inputCoords, coords) {
  const inputCenter = centroidOf(inputCoords, inputCoords.keys());
  const candidateCenter = centroidOf(coords, coords.keys());
  if (!inputCenter || !candidateCenter) {
    return coords;
  }
  const dx = inputCenter.x - candidateCenter.x;
  const dy = inputCenter.y - candidateCenter.y;
  const translated = new Map();
  for (const [atomId, position] of coords) {
    translated.set(atomId, {
      x: position.x + dx,
      y: position.y + dy
    });
  }
  return translated;
}

function sharedBackboneAttachmentByRingSystemId(ringChain) {
  const orderedRingSystemIds = ringChain.orderedRingSystemIds ?? [];
  const attachmentsByRingSystemId = new Map();
  for (let index = 0; index < orderedRingSystemIds.length; index++) {
    const ringSystemId = orderedRingSystemIds[index];
    const previousEdge =
      index > 0 ? orderedEdgeAttachment(edgeBetween(ringChain, orderedRingSystemIds[index - 1], ringSystemId), orderedRingSystemIds[index - 1], ringSystemId) : null;
    const nextEdge =
      index < orderedRingSystemIds.length - 1 ? orderedEdgeAttachment(edgeBetween(ringChain, ringSystemId, orderedRingSystemIds[index + 1]), ringSystemId, orderedRingSystemIds[index + 1]) : null;
    const previousAttachmentAtomId = previousEdge?.nextAttachmentAtomId ?? null;
    const nextAttachmentAtomId = nextEdge?.previousAttachmentAtomId ?? null;
    const attachmentAtomId = previousAttachmentAtomId ?? nextAttachmentAtomId;
    if (!attachmentAtomId || (previousAttachmentAtomId && nextAttachmentAtomId && previousAttachmentAtomId !== nextAttachmentAtomId)) {
      return null;
    }
    attachmentsByRingSystemId.set(ringSystemId, attachmentAtomId);
  }
  return attachmentsByRingSystemId;
}

function buildSharedBackboneRingChainCoords(layoutGraph, inputCoords, ringChain, bondLength, options = {}) {
  const orderedRingSystemIds = ringChain.orderedRingSystemIds ?? [];
  const ringSystemById = new Map((ringChain.ringSystems ?? []).map(ringSystem => [ringSystem.id, ringSystem]));
  const linkEdges = orderedLinkEdges(ringChain);
  if (orderedRingSystemIds.length < 4 || linkEdges.length !== orderedRingSystemIds.length - 1) {
    return null;
  }
  const attachmentByRingSystemId = sharedBackboneAttachmentByRingSystemId(ringChain);
  if (!attachmentByRingSystemId) {
    return null;
  }

  const linkerScale = options.linkerScale ?? 1;
  const startSign = options.startSign ?? 1;
  const ringAtomIds = new Set((ringChain.ringSystems ?? []).flatMap(ringSystem => ringSystem.atomIds ?? []));
  const linkerAtomIds = new Set(linkEdges.flatMap(edge => edge.linkerAtomIds ?? []));
  const anchorByRingSystemId = new Map();
  let backboneX = 0;
  for (let index = 0; index < orderedRingSystemIds.length; index++) {
    const ringSystemId = orderedRingSystemIds[index];
    if (index > 0) {
      const edge = linkEdges[index - 1];
      backboneX += ((edge.linkerAtomIds?.length ?? 0) + 1) * bondLength * linkerScale;
    }
    anchorByRingSystemId.set(ringSystemId, {
      atomId: attachmentByRingSystemId.get(ringSystemId),
      position: { x: backboneX, y: 0 },
      sign: index % 2 === 0 ? startSign : -startSign
    });
  }

  const coords = new Map(inputCoords);
  const claimedAtomIds = new Set();
  for (const ringSystemId of orderedRingSystemIds) {
    const ringSystem = ringSystemById.get(ringSystemId);
    const anchor = anchorByRingSystemId.get(ringSystemId);
    const sourceAnchor = anchor ? inputCoords.get(anchor.atomId) : null;
    const sourceCenter = ringSystem ? centroidOf(inputCoords, ringSystem.atomIds ?? []) : null;
    if (!ringSystem || !anchor || !sourceAnchor || !sourceCenter) {
      return null;
    }
    const currentAngle = Math.atan2(sourceCenter.y - sourceAnchor.y, sourceCenter.x - sourceAnchor.x);
    const targetAngle = anchor.sign >= 0 ? Math.PI / 2 : -Math.PI / 2;
    const rotation = normalizeAngle(targetAngle - currentAngle);
    for (const atomId of ringUnitAtomIds(layoutGraph, inputCoords, ringSystem, ringAtomIds, linkerAtomIds, claimedAtomIds)) {
      const sourcePosition = inputCoords.get(atomId);
      if (!sourcePosition) {
        continue;
      }
      const relativePosition = rotateRelative(sourcePosition, sourceAnchor, rotation);
      coords.set(atomId, {
        x: anchor.position.x + relativePosition.x,
        y: anchor.position.y + relativePosition.y
      });
    }
  }

  for (let index = 1; index < orderedRingSystemIds.length; index++) {
    const edge = linkEdges[index - 1];
    const previousAnchor = anchorByRingSystemId.get(orderedRingSystemIds[index - 1]);
    const linkerAtomIdsForEdge = edge.linkerAtomIds ?? [];
    if (!previousAnchor || linkerAtomIdsForEdge.length === 0) {
      return null;
    }
    const step = ((linkerAtomIdsForEdge.length + 1) * bondLength * linkerScale) / (linkerAtomIdsForEdge.length + 1);
    for (let linkerIndex = 0; linkerIndex < linkerAtomIdsForEdge.length; linkerIndex++) {
      coords.set(linkerAtomIdsForEdge[linkerIndex], {
        x: previousAnchor.position.x + step * (linkerIndex + 1),
        y: previousAnchor.position.y
      });
    }
  }

  return translateToInputCentroid(inputCoords, coords);
}

function buildProjectedRingChainCoords(layoutGraph, inputCoords, ringChain, bondLength) {
  const orderedRingSystemIds = ringChain.orderedRingSystemIds ?? [];
  const ringSystemById = new Map((ringChain.ringSystems ?? []).map(ringSystem => [ringSystem.id, ringSystem]));
  const linkEdges = orderedLinkEdges(ringChain);
  if (orderedRingSystemIds.length < 4 || linkEdges.length !== orderedRingSystemIds.length - 1) {
    return null;
  }

  const previousAttachmentByRingSystemId = new Map();
  const nextAttachmentByRingSystemId = new Map();
  for (let index = 0; index < linkEdges.length; index++) {
    nextAttachmentByRingSystemId.set(orderedRingSystemIds[index], linkEdges[index].previousAttachmentAtomId);
    previousAttachmentByRingSystemId.set(orderedRingSystemIds[index + 1], linkEdges[index].nextAttachmentAtomId);
  }

  const ringAtomIds = new Set((ringChain.ringSystems ?? []).flatMap(ringSystem => ringSystem.atomIds ?? []));
  const linkerAtomIds = new Set(linkEdges.flatMap(edge => edge.linkerAtomIds ?? []));
  const claimedAtomIds = new Set();
  const relativePositionsByRingSystemId = new Map();
  const outwardVectorsByRingSystemId = new Map();
  const centers = [];

  for (const ringSystemId of orderedRingSystemIds) {
    const ringSystem = ringSystemById.get(ringSystemId);
    const center = ringSystem ? centroidOf(inputCoords, ringSystem.atomIds ?? []) : null;
    if (!ringSystem || !center) {
      return null;
    }
    centers.push(center);
    const rotation = rotationForRingUnit(inputCoords, center, previousAttachmentByRingSystemId.get(ringSystemId) ?? null, nextAttachmentByRingSystemId.get(ringSystemId) ?? null);
    const relativePositions = new Map();
    const outwardVectors = new Map();
    for (const attachmentAtomId of [previousAttachmentByRingSystemId.get(ringSystemId) ?? null, nextAttachmentByRingSystemId.get(ringSystemId) ?? null]) {
      if (!attachmentAtomId) {
        continue;
      }
      const outwardVector = localOutwardVector(layoutGraph, inputCoords, ringSystem, center, attachmentAtomId);
      if (outwardVector) {
        outwardVectors.set(attachmentAtomId, rotateVector(outwardVector, rotation));
      }
    }
    for (const atomId of ringUnitAtomIds(layoutGraph, inputCoords, ringSystem, ringAtomIds, linkerAtomIds, claimedAtomIds)) {
      const position = inputCoords.get(atomId);
      if (position) {
        relativePositions.set(atomId, rotateRelative(position, center, rotation));
      }
    }
    relativePositionsByRingSystemId.set(ringSystemId, relativePositions);
    outwardVectorsByRingSystemId.set(ringSystemId, outwardVectors);
  }

  const targetCenters = [{ x: 0, y: 0 }];
  const linkerPositionsByAtomId = new Map();
  for (let index = 1; index < orderedRingSystemIds.length; index++) {
    const edge = linkEdges[index - 1];
    const previousRingSystemId = orderedRingSystemIds[index - 1];
    const nextRingSystemId = orderedRingSystemIds[index];
    const previousRelativeAttachment = relativePositionsByRingSystemId.get(previousRingSystemId)?.get(edge.previousAttachmentAtomId);
    const nextRelativeAttachment = relativePositionsByRingSystemId.get(nextRingSystemId)?.get(edge.nextAttachmentAtomId);
    const previousOutwardVector = outwardVectorsByRingSystemId.get(previousRingSystemId)?.get(edge.previousAttachmentAtomId);
    const nextOutwardVector = outwardVectorsByRingSystemId.get(nextRingSystemId)?.get(edge.nextAttachmentAtomId);
    if (!previousRelativeAttachment || !nextRelativeAttachment || !previousOutwardVector || !nextOutwardVector) {
      return null;
    }

    const previousCenter = targetCenters[index - 1];
    const previousAttachmentPosition = {
      x: previousCenter.x + previousRelativeAttachment.x,
      y: previousCenter.y + previousRelativeAttachment.y
    };
    const previousLinkerPosition = addScaledVector(previousAttachmentPosition, previousOutwardVector, bondLength);
    let nextLinkerPosition = previousLinkerPosition;
    if ((edge.linkerAtomIds?.length ?? 0) === 2) {
      const linkerAxis =
        normalizeVector({
          x: previousOutwardVector.x - nextOutwardVector.x,
          y: previousOutwardVector.y - nextOutwardVector.y
        }) ?? previousOutwardVector;
      nextLinkerPosition = addScaledVector(previousLinkerPosition, linkerAxis, bondLength);
    }
    const nextAttachmentPosition = subtractScaledVector(nextLinkerPosition, nextOutwardVector, bondLength);
    const nextCenter = {
      x: nextAttachmentPosition.x - nextRelativeAttachment.x,
      y: nextAttachmentPosition.y - nextRelativeAttachment.y
    };
    if (!Number.isFinite(nextCenter.x) || !Number.isFinite(nextCenter.y)) {
      return null;
    }
    targetCenters.push(nextCenter);
    if (edge.linkerAtomIds?.length === 1) {
      linkerPositionsByAtomId.set(edge.linkerAtomIds[0], previousLinkerPosition);
    } else if (edge.linkerAtomIds?.length === 2) {
      linkerPositionsByAtomId.set(edge.linkerAtomIds[0], previousLinkerPosition);
      linkerPositionsByAtomId.set(edge.linkerAtomIds[1], nextLinkerPosition);
    } else {
      return null;
    }
  }

  const coords = new Map(inputCoords);
  const targetCenterByRingSystemId = new Map();
  for (let index = 0; index < orderedRingSystemIds.length; index++) {
    const targetCenter = targetCenters[index];
    targetCenterByRingSystemId.set(orderedRingSystemIds[index], targetCenter);
    for (const [atomId, relativePosition] of relativePositionsByRingSystemId.get(orderedRingSystemIds[index]) ?? []) {
      coords.set(atomId, {
        x: targetCenter.x + relativePosition.x,
        y: targetCenter.y + relativePosition.y
      });
    }
  }

  for (const [linkerAtomId, linkerPosition] of linkerPositionsByAtomId) {
    coords.set(linkerAtomId, linkerPosition);
  }

  const sideBranchCoords = retouchRingSideBranches(layoutGraph, coords, ringChain, ringSystemById, targetCenterByRingSystemId, ringAtomIds, linkerAtomIds, bondLength);

  return translateToInputCentroid(inputCoords, sideBranchCoords);
}

/**
 * Snaps single side branches on projected path-like isolated ring chains onto
 * each ring atom's local external bisector.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} inputCoords - Current coordinates.
 * @param {object} [options] - Retouch options.
 * @returns {{coords: Map<string, {x: number, y: number}>, changed: boolean, movedAtomIds: string[], audit: object|null}} Retouch result.
 */
export function runRingChainSideBranchExitRetouch(layoutGraph, inputCoords, options = {}) {
  const bondLength = options.bondLength ?? layoutGraph.options.bondLength;
  const bondValidationClasses = options.bondValidationClasses ?? null;
  for (const component of layoutGraph.components ?? []) {
    const ringChain = describePathLikeIsolatedRingChain(layoutGraph, component);
    if (!ringChain) {
      continue;
    }
    const ringSystemById = new Map((ringChain.ringSystems ?? []).map(ringSystem => [ringSystem.id, ringSystem]));
    const ringAtomIds = new Set((ringChain.ringSystems ?? []).flatMap(ringSystem => ringSystem.atomIds ?? []));
    const linkerAtomIds = new Set((ringChain.edges ?? []).flatMap(edge => edge.linkerAtomIds ?? []));
    const coords = retouchRingSideBranches(
      layoutGraph,
      inputCoords,
      ringChain,
      ringSystemById,
      ringSystemCentersFromCoords(inputCoords, ringChain.ringSystems),
      ringAtomIds,
      linkerAtomIds,
      bondLength,
      {
        auditCandidates: true,
        bondValidationClasses
      }
    );
    const movedAtomIds = [...coords.keys()].filter(atomId => {
      const previousPosition = inputCoords.get(atomId);
      const nextPosition = coords.get(atomId);
      return previousPosition && nextPosition && Math.hypot(nextPosition.x - previousPosition.x, nextPosition.y - previousPosition.y) > 1e-9;
    });
    return {
      coords,
      changed: movedAtomIds.length > 0,
      movedAtomIds,
      audit: auditLayout(layoutGraph, coords, {
        bondLength,
        bondValidationClasses
      })
    };
  }
  return {
    coords: inputCoords,
    changed: false,
    movedAtomIds: [],
    audit: auditLayout(layoutGraph, inputCoords, {
      bondLength,
      bondValidationClasses
    })
  };
}

/**
 * Rebuilds path-like isolated ring chains as rigid ring units on a single
 * projected backbone, preserving local ring geometry and re-solving the
 * short glycosidic linkers plus single side-branch exits at readable bond
 * lengths.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} inputCoords - Current coordinates.
 * @param {object} [options] - Retouch options.
 * @returns {{coords: Map<string, {x: number, y: number}>, changed: boolean, movedAtomIds: string[], audit: object|null, bondValidationClasses?: Map<string, string>}} Retouch result.
 */
export function runRingChainUnitProjectionRetouch(layoutGraph, inputCoords, options = {}) {
  const bondLength = options.bondLength ?? layoutGraph.options.bondLength;
  const bondValidationClasses = options.bondValidationClasses ?? null;
  for (const component of layoutGraph.components ?? []) {
    const ringChain = describePathLikeIsolatedRingChain(layoutGraph, component);
    if (!ringChain) {
      continue;
    }
    let bestCandidate = null;
    const sharedBackboneBondValidationClasses = relaxedLinkerBondValidationClasses(layoutGraph, ringChain, bondValidationClasses);
    for (const linkerScale of SHARED_BACKBONE_LINKER_SCALE_CANDIDATES) {
      for (const startSign of [1, -1]) {
        const coords = buildSharedBackboneRingChainCoords(layoutGraph, inputCoords, ringChain, bondLength, {
          linkerScale,
          startSign
        });
        if (!coords) {
          continue;
        }
        const audit = auditLayout(layoutGraph, coords, {
          bondLength,
          bondValidationClasses: sharedBackboneBondValidationClasses
        });
        const score = auditScore(audit);
        if (!bestCandidate || score < bestCandidate.score - 1e-9) {
          bestCandidate = {
            coords,
            audit,
            bondValidationClasses: sharedBackboneBondValidationClasses,
            score
          };
        }
        if (audit.ok) {
          break;
        }
      }
      if (bestCandidate?.audit?.ok) {
        break;
      }
    }

    if (!bestCandidate) {
      const coords = buildProjectedRingChainCoords(layoutGraph, inputCoords, ringChain, bondLength);
      if (!coords) {
        continue;
      }
      bestCandidate = {
        coords,
        audit: auditLayout(layoutGraph, coords, {
          bondLength,
          bondValidationClasses
        }),
        bondValidationClasses,
        score: null
      };
    }
    const coords = bestCandidate.coords;
    const movedAtomIds = [...coords.keys()].filter(atomId => {
      const previousPosition = inputCoords.get(atomId);
      const nextPosition = coords.get(atomId);
      return previousPosition && nextPosition && Math.hypot(nextPosition.x - previousPosition.x, nextPosition.y - previousPosition.y) > 1e-9;
    });
    return {
      coords,
      changed: movedAtomIds.length > 0,
      movedAtomIds,
      audit: bestCandidate.audit,
      bondValidationClasses: bestCandidate.bondValidationClasses
    };
  }
  return {
    coords: inputCoords,
    changed: false,
    movedAtomIds: [],
    audit: auditLayout(layoutGraph, inputCoords, {
      bondLength,
      bondValidationClasses
    })
  };
}

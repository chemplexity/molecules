/** @module cleanup/presentation/ring-chain-unit-projection-retouch */

import { auditLayout } from '../../audit/audit.js';
import { describePathLikeIsolatedRingChain } from '../../topology/isolated-ring-chain.js';
import { collectCutSubtree } from '../subtree-utils.js';

const SIDE_BRANCH_DESCENDANT_ROTATION_CANDIDATES = Object.freeze([
  0,
  ...Array.from({ length: 12 }, (_value, index) => ((index + 1) * Math.PI) / 12)
    .flatMap(angle => (Math.abs(angle - Math.PI) <= 1e-9 ? [Math.PI] : [angle, -angle]))
]);
const INTERNAL_LIGAND_RELIEF_MAX_ROOT_DEVIATION = Math.PI / 180;
const HYPERVALENT_BRANCH_CENTER_ELEMENTS = new Set(['S', 'P', 'Se', 'As']);

function otherBondAtomId(bond, atomId) {
  return bond.a === atomId ? bond.b : bond.a;
}

function centroidOf(coords, atomIds) {
  const positions = atomIds
    .map(atomId => coords.get(atomId))
    .filter(Boolean);
  if (positions.length === 0) {
    return null;
  }
  return {
    x: positions.reduce((sum, position) => sum + position.x, 0) / positions.length,
    y: positions.reduce((sum, position) => sum + position.y, 0) / positions.length
  };
}

function edgeBetween(ringChain, firstRingSystemId, secondRingSystemId) {
  return (ringChain.edges ?? []).find(edge =>
    (
      edge.firstRingSystemId === firstRingSystemId
      && edge.secondRingSystemId === secondRingSystemId
    )
    || (
      edge.firstRingSystemId === secondRingSystemId
      && edge.secondRingSystemId === firstRingSystemId
    )
  ) ?? null;
}

function orderedEdgeAttachment(edge, previousRingSystemId, nextRingSystemId) {
  if (!edge || edge.linkerAtomIds?.length !== 1) {
    return null;
  }
  if (edge.firstRingSystemId === previousRingSystemId && edge.secondRingSystemId === nextRingSystemId) {
    return {
      linkerAtomId: edge.linkerAtomIds[0],
      previousAttachmentAtomId: edge.firstAttachmentAtomId,
      nextAttachmentAtomId: edge.secondAttachmentAtomId
    };
  }
  if (edge.secondRingSystemId === previousRingSystemId && edge.firstRingSystemId === nextRingSystemId) {
    return {
      linkerAtomId: edge.linkerAtomIds[0],
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
    const edge = orderedEdgeAttachment(
      edgeBetween(ringChain, orderedRingSystemIds[index - 1], orderedRingSystemIds[index]),
      orderedRingSystemIds[index - 1],
      orderedRingSystemIds[index]
    );
    if (!edge) {
      return [];
    }
    edges.push(edge);
  }
  return edges;
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

function ringNeighborIds(layoutGraph, ringSystem, atomId) {
  const ringAtomIds = new Set(ringSystem?.atomIds ?? []);
  return (layoutGraph.bondsByAtomId.get(atomId) ?? [])
    .map(bond => otherBondAtomId(bond, atomId))
    .filter(neighborAtomId => ringAtomIds.has(neighborAtomId));
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
  return (bisector.x * radial.x + bisector.y * radial.y) >= 0
    ? bisector
    : { x: -bisector.x, y: -bisector.y };
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
    if (
      !rootAtom
      || rootAtom.element === 'H'
      || !inputCoords.has(rootAtomId)
      || ringAtomIds.has(rootAtomId)
      || linkerAtomIds.has(rootAtomId)
    ) {
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
    (audit.bondLengthFailureCount ?? 0) * 100_000_000
    + (audit.severeOverlapCount ?? 0) * 10_000_000
    + (audit.visibleHeavyBondCrossingCount ?? 0) * 1_000_000
    + (audit.ringSubstituentReadabilityFailureCount ?? 0) * 100_000
    + (audit.inwardRingSubstituentCount ?? 0) * 100_000
    + (audit.outwardAxisRingSubstituentFailureCount ?? 0) * 100_000
    + (audit.labelOverlapCount ?? 0) * 10_000
    + (audit.severeOverlapPenalty ?? 0) * 1_000
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
  const cosine = Math.max(-1, Math.min(1, ((firstVector.x * secondVector.x) + (firstVector.y * secondVector.y)) / denominator));
  return Math.acos(cosine);
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

function exactRootAngleRotations(layoutGraph, coords, rootAtomId, anchorAtomId, targetAngle = (Math.PI * 2) / 3) {
  const rootPosition = coords.get(rootAtomId);
  const anchorPosition = coords.get(anchorAtomId);
  const descendantAtomIds = visibleHeavyNeighborAtomIds(layoutGraph, coords, rootAtomId)
    .filter(neighborAtomId => neighborAtomId !== anchorAtomId);
  if (!rootPosition || !anchorPosition || descendantAtomIds.length !== 1) {
    return [];
  }
  const descendantPosition = coords.get(descendantAtomIds[0]);
  if (!descendantPosition) {
    return [];
  }
  const anchorAngle = Math.atan2(anchorPosition.y - rootPosition.y, anchorPosition.x - rootPosition.x);
  const descendantAngle = Math.atan2(descendantPosition.y - rootPosition.y, descendantPosition.x - rootPosition.x);
  return [
    normalizeAngle(anchorAngle + targetAngle - descendantAngle),
    normalizeAngle(anchorAngle - targetAngle - descendantAngle)
  ];
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

function bestAuditedSideBranchCoords(layoutGraph, candidateCoords, rootAtomId, anchorAtomId, baseAudit, options) {
  const rootPosition = candidateCoords.get(rootAtomId);
  if (!rootPosition) {
    return null;
  }
  const descendantAtomIds = sideBranchDescendantAtomIds(layoutGraph, candidateCoords, rootAtomId, anchorAtomId);
  const rotationCandidates = [
    ...exactRootAngleRotations(layoutGraph, candidateCoords, rootAtomId, anchorAtomId),
    ...SIDE_BRANCH_DESCENDANT_ROTATION_CANDIDATES
  ];
  let best = null;
  for (const descendantRotation of rotationCandidates) {
    const coords = rotatedAtomsCoords(candidateCoords, descendantAtomIds, rootPosition, descendantRotation);
    const audit = auditLayout(layoutGraph, coords, {
      bondLength: options.bondLength,
      bondValidationClasses: options.bondValidationClasses ?? null
    });
    if (!auditCountsDoNotWorsen(audit, baseAudit)) {
      const internalRelief = bestInternalLigandReliefCoords(layoutGraph, coords, rootAtomId, anchorAtomId, baseAudit, options);
      if (!internalRelief || (best && internalRelief.score >= best.score - 1e-9)) {
        continue;
      }
      best = internalRelief;
      continue;
    }
    const score = auditScore(audit) + (sideBranchRootAngleDeviation(layoutGraph, coords, rootAtomId) * 1_000);
    if (!best || score < best.score - 1e-9) {
      best = {
        coords,
        audit,
        score
      };
    }
  }
  return best;
}

function bestInternalLigandReliefCoords(layoutGraph, inputCoords, rootAtomId, anchorAtomId, baseAudit, options) {
  if (sideBranchRootAngleDeviation(layoutGraph, inputCoords, rootAtomId) > INTERNAL_LIGAND_RELIEF_MAX_ROOT_DEVIATION) {
    return null;
  }
  const centerAtomId = visibleHeavyNeighborAtomIds(layoutGraph, inputCoords, rootAtomId)
    .find(neighborAtomId => neighborAtomId !== anchorAtomId) ?? null;
  const centerAtom = centerAtomId ? layoutGraph.atoms.get(centerAtomId) : null;
  const centerPosition = centerAtomId ? inputCoords.get(centerAtomId) : null;
  if (!centerAtom || !HYPERVALENT_BRANCH_CENTER_ELEMENTS.has(centerAtom.element) || !centerPosition) {
    return null;
  }

  let best = null;
  for (const ligandAtomId of visibleHeavyNeighborAtomIds(layoutGraph, inputCoords, centerAtomId)) {
    if (ligandAtomId === rootAtomId) {
      continue;
    }
    const ligandSubtreeAtomIds = [...collectCutSubtree(layoutGraph, ligandAtomId, centerAtomId)]
      .filter(atomId => inputCoords.has(atomId));
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
      const score = auditScore(audit) + (sideBranchRootAngleDeviation(layoutGraph, coords, rootAtomId) * 1_000);
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

function retouchRingSideBranches(
  layoutGraph,
  inputCoords,
  ringChain,
  ringSystemById,
  ringCenterBySystemId,
  ringAtomIds,
  linkerAtomIds,
  bondLength,
  options = {}
) {
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
      const subtreeAtomIds = [...collectCutSubtree(layoutGraph, rootAtomId, anchorAtomId)]
        .filter(atomId => coords.has(atomId));
      if (
        subtreeAtomIds.length === 0
        || subtreeAtomIds.some(atomId => ringAtomIds.has(atomId) || linkerAtomIds.has(atomId) || retouchedAtomIds.has(atomId))
      ) {
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

      const angle = normalizeAngle(
        Math.atan2(outwardVector.y, outwardVector.x)
        - Math.atan2(currentVector.y, currentVector.x)
      );
      const rotatedRoot = rotateRelative(rootPosition, anchorPosition, angle);
      const targetRoot = {
        x: anchorPosition.x + (bondLength * outwardVector.x),
        y: anchorPosition.y + (bondLength * outwardVector.y)
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
  const inputCenter = centroidOf(inputCoords, [...inputCoords.keys()]);
  const candidateCenter = centroidOf(coords, [...coords.keys()]);
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
  const linkerAtomIds = new Set(linkEdges.map(edge => edge.linkerAtomId));
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
    const rotation = rotationForRingUnit(
      inputCoords,
      center,
      previousAttachmentByRingSystemId.get(ringSystemId) ?? null,
      nextAttachmentByRingSystemId.get(ringSystemId) ?? null
    );
    const relativePositions = new Map();
    const outwardVectors = new Map();
    for (const attachmentAtomId of [
      previousAttachmentByRingSystemId.get(ringSystemId) ?? null,
      nextAttachmentByRingSystemId.get(ringSystemId) ?? null
    ]) {
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
    const nextCenter = {
      x: previousCenter.x
        + previousRelativeAttachment.x
        - nextRelativeAttachment.x
        + bondLength * (previousOutwardVector.x - nextOutwardVector.x),
      y: previousCenter.y
        + previousRelativeAttachment.y
        - nextRelativeAttachment.y
        + bondLength * (previousOutwardVector.y - nextOutwardVector.y)
    };
    if (!Number.isFinite(nextCenter.x) || !Number.isFinite(nextCenter.y)) {
      return null;
    }
    targetCenters.push(nextCenter);
    linkerPositionsByAtomId.set(edge.linkerAtomId, {
      x: previousCenter.x + previousRelativeAttachment.x + bondLength * previousOutwardVector.x,
      y: previousCenter.y + previousRelativeAttachment.y + bondLength * previousOutwardVector.y
    });
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

  const sideBranchCoords = retouchRingSideBranches(
    layoutGraph,
    coords,
    ringChain,
    ringSystemById,
    targetCenterByRingSystemId,
    ringAtomIds,
    linkerAtomIds,
    bondLength
  );

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
      return (
        previousPosition
        && nextPosition
        && Math.hypot(nextPosition.x - previousPosition.x, nextPosition.y - previousPosition.y) > 1e-9
      );
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
 * single-atom glycosidic linkers plus single side-branch exits at valid bond
 * length.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} inputCoords - Current coordinates.
 * @param {object} [options] - Retouch options.
 * @returns {{coords: Map<string, {x: number, y: number}>, changed: boolean, movedAtomIds: string[], audit: object|null}} Retouch result.
 */
export function runRingChainUnitProjectionRetouch(layoutGraph, inputCoords, options = {}) {
  const bondLength = options.bondLength ?? layoutGraph.options.bondLength;
  const bondValidationClasses = options.bondValidationClasses ?? null;
  for (const component of layoutGraph.components ?? []) {
    const ringChain = describePathLikeIsolatedRingChain(layoutGraph, component);
    if (!ringChain) {
      continue;
    }
    const coords = buildProjectedRingChainCoords(layoutGraph, inputCoords, ringChain, bondLength);
    if (!coords) {
      continue;
    }
    const movedAtomIds = [...coords.keys()].filter(atomId => {
      const previousPosition = inputCoords.get(atomId);
      const nextPosition = coords.get(atomId);
      return (
        previousPosition
        && nextPosition
        && Math.hypot(nextPosition.x - previousPosition.x, nextPosition.y - previousPosition.y) > 1e-9
      );
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

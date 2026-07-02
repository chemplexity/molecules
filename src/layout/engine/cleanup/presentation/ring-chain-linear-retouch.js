/** @module cleanup/presentation/ring-chain-linear-retouch */

import { auditLayout } from '../../audit/audit.js';
import { add, angleOf, centroidForAtomIds, rotate, sub } from '../../geometry/vec2.js';
import { describePathLikeIsolatedRingChain } from '../../topology/isolated-ring-chain.js';
import { collectCutSubtree } from '../subtree-utils.js';

const MAX_LINEARIZATION_PASSES = 2;
const MIN_LINEARITY_IMPROVEMENT = 0.02;
const MIN_LINKER_EXIT_IMPROVEMENT_DEGREES = 1;
const ANGLE_CANDIDATE_DELTAS = Object.freeze([
  0,
  Math.PI / 36,
  -Math.PI / 36,
  Math.PI / 18,
  -Math.PI / 18,
  Math.PI / 12,
  -Math.PI / 12,
  Math.PI / 6,
  -Math.PI / 6,
  Math.PI / 4,
  -Math.PI / 4,
  Math.PI / 3,
  -Math.PI / 3,
  Math.PI / 2,
  -Math.PI / 2,
  Math.PI,
  -Math.PI
]);

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

function uniqueAngles(angles) {
  const seenKeys = new Set();
  const result = [];
  for (const angle of angles) {
    const normalized = normalizeAngle(angle);
    const key = normalized.toFixed(9);
    if (seenKeys.has(key)) {
      continue;
    }
    seenKeys.add(key);
    result.push(normalized);
  }
  return result;
}

function ringSystemCenter(coords, ringSystem) {
  return centroidForAtomIds(coords, ringSystem?.atomIds ?? []);
}

function orderedRingCenters(coords, ringChain) {
  const ringSystemById = new Map((ringChain.ringSystems ?? []).map(ringSystem => [ringSystem.id, ringSystem]));
  const centers = [];
  for (const ringSystemId of ringChain.orderedRingSystemIds ?? []) {
    const center = ringSystemCenter(coords, ringSystemById.get(ringSystemId));
    if (!center) {
      return [];
    }
    centers.push({
      ringSystemId,
      ...center
    });
  }
  return centers;
}

function terminalAxis(centers) {
  const firstCenter = centers[0] ?? null;
  const lastCenter = centers[centers.length - 1] ?? null;
  if (!firstCenter || !lastCenter) {
    return null;
  }
  const dx = lastCenter.x - firstCenter.x;
  const dy = lastCenter.y - firstCenter.y;
  const length = Math.hypot(dx, dy);
  if (length <= 1e-9) {
    return null;
  }
  return {
    origin: firstCenter,
    x: dx / length,
    y: dy / length,
    normalX: -dy / length,
    normalY: dx / length,
    angle: Math.atan2(dy, dx)
  };
}

function projectedRingCenterStats(centers, axis) {
  const projections = [];
  const offsets = [];
  for (const center of centers) {
    const dx = center.x - axis.origin.x;
    const dy = center.y - axis.origin.y;
    projections.push(dx * axis.x + dy * axis.y);
    offsets.push(dx * axis.normalX + dy * axis.normalY);
  }
  return {
    projections,
    offsetSpan: Math.max(...offsets) - Math.min(...offsets),
    projectionSpan: Math.max(...projections) - Math.min(...projections)
  };
}

function linearityScore(coords, ringChain) {
  const centers = orderedRingCenters(coords, ringChain);
  if (centers.length < 3) {
    return Number.POSITIVE_INFINITY;
  }
  const axis = terminalAxis(centers);
  if (!axis) {
    return Number.POSITIVE_INFINITY;
  }
  const { projections, offsetSpan, projectionSpan } = projectedRingCenterStats(centers, axis);
  let reverseProgress = 0;
  let segmentDeviation = 0;
  for (let index = 1; index < centers.length; index++) {
    reverseProgress += Math.max(0, projections[index - 1] - projections[index]);
    const segment = sub(centers[index], centers[index - 1]);
    segmentDeviation += Math.abs(Math.sin(normalizeAngle(angleOf(segment) - axis.angle)));
  }
  return offsetSpan / Math.max(projectionSpan, 1e-6) + reverseProgress * 10 + segmentDeviation / Math.max(centers.length - 1, 1);
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
  if (!edge || edge.linkerAtomIds?.length !== 1) {
    return null;
  }
  if (edge.firstRingSystemId === previousRingSystemId && edge.secondRingSystemId === nextRingSystemId) {
    return {
      linkerAtomId: edge.linkerAtomIds[0],
      nextAttachmentAtomId: edge.secondAttachmentAtomId
    };
  }
  if (edge.secondRingSystemId === previousRingSystemId && edge.firstRingSystemId === nextRingSystemId) {
    return {
      linkerAtomId: edge.linkerAtomIds[0],
      nextAttachmentAtomId: edge.firstAttachmentAtomId
    };
  }
  return null;
}

function orderedFullEdgeAttachment(edge, previousRingSystemId, nextRingSystemId) {
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

function rotateSubtree(inputCoords, pivot, subtreeAtomIds, angle) {
  const coords = new Map(inputCoords);
  for (const atomId of subtreeAtomIds) {
    const position = coords.get(atomId);
    if (!position) {
      continue;
    }
    coords.set(atomId, add(pivot, rotate(sub(position, pivot), angle)));
  }
  return coords;
}

function angleDegrees(firstPosition, centerPosition, secondPosition) {
  const firstVector = sub(firstPosition, centerPosition);
  const secondVector = sub(secondPosition, centerPosition);
  const denominator = Math.hypot(firstVector.x, firstVector.y) * Math.hypot(secondVector.x, secondVector.y);
  if (!(denominator > 0)) {
    return null;
  }
  const cosine = Math.max(-1, Math.min(1, (firstVector.x * secondVector.x + firstVector.y * secondVector.y) / denominator));
  return (Math.acos(cosine) * 180) / Math.PI;
}

function ringNeighborIds(layoutGraph, ringSystem, atomId) {
  const ringAtomIds = new Set(ringSystem?.atomIds ?? []);
  return (layoutGraph.bondsByAtomId.get(atomId) ?? []).map(bond => (bond.a === atomId ? bond.b : bond.a)).filter(neighborAtomId => ringAtomIds.has(neighborAtomId));
}

function linkerExitDeviationDegrees(layoutGraph, coords, ringChain) {
  const ringSystemById = new Map((ringChain.ringSystems ?? []).map(ringSystem => [ringSystem.id, ringSystem]));
  let maxDeviation = 0;
  const orderedRingSystemIds = ringChain.orderedRingSystemIds ?? [];
  for (let index = 1; index < orderedRingSystemIds.length; index++) {
    const previousRingSystemId = orderedRingSystemIds[index - 1];
    const nextRingSystemId = orderedRingSystemIds[index];
    const edge = orderedFullEdgeAttachment(edgeBetween(ringChain, previousRingSystemId, nextRingSystemId), previousRingSystemId, nextRingSystemId);
    if (!edge) {
      continue;
    }
    for (const [ringSystemId, attachmentAtomId] of [
      [previousRingSystemId, edge.previousAttachmentAtomId],
      [nextRingSystemId, edge.nextAttachmentAtomId]
    ]) {
      const attachmentPosition = coords.get(attachmentAtomId);
      const linkerPosition = coords.get(edge.linkerAtomId);
      const ringSystem = ringSystemById.get(ringSystemId);
      if (!attachmentPosition || !linkerPosition || !ringSystem) {
        continue;
      }
      for (const neighborAtomId of ringNeighborIds(layoutGraph, ringSystem, attachmentAtomId)) {
        const neighborPosition = coords.get(neighborAtomId);
        const angle = neighborPosition ? angleDegrees(neighborPosition, attachmentPosition, linkerPosition) : null;
        if (angle == null) {
          continue;
        }
        maxDeviation = Math.max(maxDeviation, Math.abs(angle - 120));
      }
    }
  }
  return maxDeviation;
}

function idealLinkerExitAngles(layoutGraph, coords, ringSystem, attachmentAtomId, linkerAtomId) {
  const attachmentPosition = coords.get(attachmentAtomId);
  const linkerPosition = coords.get(linkerAtomId);
  if (!attachmentPosition || !linkerPosition) {
    return [];
  }
  const neighborPositions = ringNeighborIds(layoutGraph, ringSystem, attachmentAtomId)
    .map(atomId => coords.get(atomId))
    .filter(Boolean);
  if (neighborPositions.length < 2) {
    return [];
  }
  let sumX = 0;
  let sumY = 0;
  for (const position of neighborPositions) {
    const vector = sub(position, attachmentPosition);
    const length = Math.hypot(vector.x, vector.y);
    if (!(length > 0)) {
      continue;
    }
    sumX += vector.x / length;
    sumY += vector.y / length;
  }
  if (Math.hypot(sumX, sumY) <= 1e-9) {
    return [];
  }
  const primaryAngle = Math.atan2(sumY, sumX);
  return uniqueAngles([primaryAngle, primaryAngle + Math.PI]);
}

function auditDoesNotWorsen(candidateAudit, baseAudit) {
  if (!candidateAudit || !baseAudit || (baseAudit.ok === true && candidateAudit.ok !== true)) {
    return false;
  }
  for (const key of [
    'bondLengthFailureCount',
    'severeOverlapCount',
    'visibleHeavyBondCrossingCount',
    'ringSubstituentReadabilityFailureCount',
    'inwardRingSubstituentCount',
    'outwardAxisRingSubstituentFailureCount',
    'labelOverlapCount'
  ]) {
    if ((candidateAudit[key] ?? 0) > (baseAudit[key] ?? 0)) {
      return false;
    }
  }
  return !((candidateAudit.stereoContradiction ?? false) && !(baseAudit.stereoContradiction ?? false));
}

function auditTieScore(audit) {
  return (
    audit.bondLengthFailureCount * 100_000_000 +
    audit.severeOverlapCount * 10_000_000 +
    (audit.visibleHeavyBondCrossingCount ?? 0) * 1_000_000 +
    (audit.ringSubstituentReadabilityFailureCount ?? 0) * 100_000 +
    audit.labelOverlapCount * 10_000 +
    audit.severeOverlapPenalty
  );
}

function candidateAnglesForEdge(coords, ringChain, edgeIndex) {
  const centers = orderedRingCenters(coords, ringChain);
  const axis = terminalAxis(centers);
  const previousCenter = centers[edgeIndex - 1] ?? null;
  const nextCenter = centers[edgeIndex] ?? null;
  if (!axis || !previousCenter || !nextCenter) {
    return [];
  }
  const alignmentAngle = normalizeAngle(axis.angle - angleOf(sub(nextCenter, previousCenter)));
  return uniqueAngles([0, alignmentAngle, ...ANGLE_CANDIDATE_DELTAS, ...ANGLE_CANDIDATE_DELTAS.map(delta => alignmentAngle + delta)]);
}

function bestLinearizedEdge(layoutGraph, inputCoords, ringChain, edgeIndex, options, baseAudit, baseScore) {
  const orderedRingSystemIds = ringChain.orderedRingSystemIds ?? [];
  const previousRingSystemId = orderedRingSystemIds[edgeIndex - 1];
  const nextRingSystemId = orderedRingSystemIds[edgeIndex];
  const attachment = orderedEdgeAttachment(edgeBetween(ringChain, previousRingSystemId, nextRingSystemId), previousRingSystemId, nextRingSystemId);
  const pivot = attachment ? inputCoords.get(attachment.linkerAtomId) : null;
  if (!attachment || !pivot) {
    return null;
  }
  const subtreeAtomIds = [...collectCutSubtree(layoutGraph, attachment.nextAttachmentAtomId, attachment.linkerAtomId)].filter(atomId => layoutGraph.atoms.has(atomId));
  if (subtreeAtomIds.length === 0) {
    return null;
  }

  let best = null;
  for (const angle of candidateAnglesForEdge(inputCoords, ringChain, edgeIndex)) {
    const coords = rotateSubtree(inputCoords, pivot, subtreeAtomIds, angle);
    const audit = auditLayout(layoutGraph, coords, {
      bondLength: options.bondLength,
      bondValidationClasses: options.bondValidationClasses
    });
    if (options.allowAuditWorsening !== true && !auditDoesNotWorsen(audit, baseAudit)) {
      continue;
    }
    const score = linearityScore(coords, ringChain);
    if (score > baseScore - MIN_LINEARITY_IMPROVEMENT) {
      continue;
    }
    const tieScore = auditTieScore(audit);
    if (!best || score < best.score - 1e-9 || (Math.abs(score - best.score) <= 1e-9 && tieScore < best.tieScore)) {
      best = {
        coords,
        audit,
        score,
        tieScore,
        movedAtomIds: subtreeAtomIds
      };
    }
  }
  return best;
}

function linkerExitCandidatesForAttachment(layoutGraph, coords, ringSystem, attachmentAtomId, linkerAtomId) {
  const attachmentPosition = coords.get(attachmentAtomId);
  const linkerPosition = coords.get(linkerAtomId);
  const targetAngles = idealLinkerExitAngles(layoutGraph, coords, ringSystem, attachmentAtomId, linkerAtomId);
  if (!attachmentPosition || !linkerPosition || targetAngles.length === 0) {
    return [];
  }
  const currentAngle = angleOf(sub(linkerPosition, attachmentPosition));
  return uniqueAngles(
    targetAngles.flatMap(targetAngle => [targetAngle - currentAngle, ...ANGLE_CANDIDATE_DELTAS.map(delta => targetAngle - currentAngle + delta)])
  );
}

function bestLinkerExitRetouch(layoutGraph, inputCoords, ringChain, options, baseAudit, baseExitDeviation) {
  const ringSystemById = new Map((ringChain.ringSystems ?? []).map(ringSystem => [ringSystem.id, ringSystem]));
  const orderedRingSystemIds = ringChain.orderedRingSystemIds ?? [];
  let best = null;
  for (let index = 1; index < orderedRingSystemIds.length; index++) {
    const previousRingSystemId = orderedRingSystemIds[index - 1];
    const nextRingSystemId = orderedRingSystemIds[index];
    const edge = orderedFullEdgeAttachment(edgeBetween(ringChain, previousRingSystemId, nextRingSystemId), previousRingSystemId, nextRingSystemId);
    if (!edge) {
      continue;
    }
    for (const [ringSystemId, attachmentAtomId] of [
      [previousRingSystemId, edge.previousAttachmentAtomId],
      [nextRingSystemId, edge.nextAttachmentAtomId]
    ]) {
      const ringSystem = ringSystemById.get(ringSystemId);
      const pivot = inputCoords.get(attachmentAtomId);
      if (!ringSystem || !pivot) {
        continue;
      }
      const subtreeAtomIds = [...collectCutSubtree(layoutGraph, edge.linkerAtomId, attachmentAtomId)].filter(atomId => layoutGraph.atoms.has(atomId));
      if (subtreeAtomIds.length === 0) {
        continue;
      }
      for (const angle of linkerExitCandidatesForAttachment(layoutGraph, inputCoords, ringSystem, attachmentAtomId, edge.linkerAtomId)) {
        const coords = rotateSubtree(inputCoords, pivot, subtreeAtomIds, angle);
        const audit = auditLayout(layoutGraph, coords, {
          bondLength: options.bondLength,
          bondValidationClasses: options.bondValidationClasses
        });
        if (options.allowAuditWorsening !== true && !auditDoesNotWorsen(audit, baseAudit)) {
          continue;
        }
        const exitDeviation = linkerExitDeviationDegrees(layoutGraph, coords, ringChain);
        if (exitDeviation > baseExitDeviation - MIN_LINKER_EXIT_IMPROVEMENT_DEGREES) {
          continue;
        }
        const lineScore = linearityScore(coords, ringChain);
        const tieScore = auditTieScore(audit);
        if (
          !best ||
          exitDeviation < best.exitDeviation - 1e-9 ||
          (Math.abs(exitDeviation - best.exitDeviation) <= 1e-9 && lineScore < best.lineScore - 1e-9) ||
          (Math.abs(exitDeviation - best.exitDeviation) <= 1e-9 && Math.abs(lineScore - best.lineScore) <= 1e-9 && tieScore < best.tieScore)
        ) {
          best = {
            coords,
            audit,
            exitDeviation,
            lineScore,
            tieScore,
            movedAtomIds: subtreeAtomIds
          };
        }
      }
    }
  }
  return best;
}

/**
 * Straightens path-like isolated ring chains by rotating downstream ring
 * subtrees around their single-atom linkers. Candidate moves are accepted only
 * when they improve the terminal-ring-linearity score without worsening the
 * layout audit, so local ring and substituent geometry remains intact.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} inputCoords - Current coordinates.
 * @param {object} [options] - Retouch options.
 * @returns {{coords: Map<string, {x: number, y: number}>, changed: boolean, movedAtomIds: string[], audit: object|null, linearityScore: number}} Retouch result.
 */
export function runRingChainLinearRetouch(layoutGraph, inputCoords, options = {}) {
  const bondLength = options.bondLength ?? layoutGraph.options.bondLength;
  const bondValidationClasses = options.bondValidationClasses ?? null;
  const maxPasses = options.maxPasses ?? MAX_LINEARIZATION_PASSES;
  let coords = inputCoords;
  let audit = auditLayout(layoutGraph, coords, {
    bondLength,
    bondValidationClasses
  });
  let changed = false;
  const movedAtomIds = [];

  for (let pass = 0; pass < maxPasses; pass++) {
    let movedThisPass = false;
    for (const component of layoutGraph.components ?? []) {
      const ringChain = describePathLikeIsolatedRingChain(layoutGraph, component);
      if (!ringChain || (ringChain.orderedRingSystemIds?.length ?? 0) < 4) {
        continue;
      }
      for (let edgeIndex = 1; edgeIndex < ringChain.orderedRingSystemIds.length; edgeIndex++) {
        const baseScore = linearityScore(coords, ringChain);
        const retouch = bestLinearizedEdge(
          layoutGraph,
          coords,
          ringChain,
          edgeIndex,
          {
            bondLength,
            bondValidationClasses,
            allowAuditWorsening: options.allowAuditWorsening === true
          },
          audit,
          baseScore
        );
        if (!retouch) {
          continue;
        }
        coords = retouch.coords;
        audit = retouch.audit;
        changed = true;
        movedThisPass = true;
        movedAtomIds.push(...retouch.movedAtomIds);
      }
      const baseExitDeviation = linkerExitDeviationDegrees(layoutGraph, coords, ringChain);
      const exitRetouch = bestLinkerExitRetouch(
        layoutGraph,
        coords,
        ringChain,
        {
          bondLength,
          bondValidationClasses,
          allowAuditWorsening: options.allowAuditWorsening === true
        },
        audit,
        baseExitDeviation
      );
      if (exitRetouch) {
        coords = exitRetouch.coords;
        audit = exitRetouch.audit;
        changed = true;
        movedThisPass = true;
        movedAtomIds.push(...exitRetouch.movedAtomIds);
      }
    }
    if (!movedThisPass) {
      break;
    }
  }

  return {
    coords,
    changed,
    movedAtomIds,
    audit,
    linearityScore: (() => {
      const component = layoutGraph.components?.[0] ?? null;
      const ringChain = component ? describePathLikeIsolatedRingChain(layoutGraph, component) : null;
      return ringChain ? linearityScore(coords, ringChain) : Number.POSITIVE_INFINITY;
    })()
  };
}

/** @module families/mixed */

import { angleOf, angularDifference, centroid, fromAngle, sub, add, rotate, wrapAngle } from '../geometry/vec2.js';
import { computeBounds } from '../geometry/bounds.js';
import { alignCoordsToFixed, reflectAcrossLine } from '../geometry/transforms.js';
import { nonSharedPath } from '../geometry/ring-path.js';
import { transformAttachedBlock } from '../placement/linkers.js';
import { auditLayout } from '../audit/audit.js';
import { measureRingSubstituentPresentationPenalty } from '../cleanup/presentation/ring-substituent.js';
import {
  directAttachedForeignRingJunctionContinuationAngle,
  findLayoutBond,
  isExactSmallRingExteriorContinuationEligible,
  isExactRingTrigonalBisectorEligible,
  isExactSimpleAcyclicContinuationEligible
} from '../placement/branch-placement/angle-selection.js';
import { assignBondValidationClass, resolvePlacementValidationClass } from '../placement/bond-validation.js';
import { chooseAttachmentAngle, measureSmallRingExteriorGapSpreadPenalty, placeRemainingBranches, smallRingExteriorTargetAngles } from '../placement/branch-placement.js';
import {
  findSevereOverlaps,
  measureFocusedPlacementCost,
  measureLayoutCost,
  measureRingSubstituentReadability,
  measureThreeHeavyContinuationDistortion
} from '../audit/invariants.js';
import { layoutAcyclicFamily } from './acyclic.js';
import { layoutBridgedFamily } from './bridged.js';
import {
  isBetterBridgedRescueForFusedSystem,
  layoutFusedCageKamadaKawai,
  layoutFusedFamily,
  shouldShortCircuitToFusedCageKk,
  shouldTryBridgedRescueForFusedSystem
} from './fused.js';
import { layoutIsolatedRingFamily } from './isolated-ring.js';
import { computeMacrocycleAngularBudgets, layoutMacrocycleFamily } from './macrocycle.js';
import { layoutSpiroFamily } from './spiro.js';
import { classifyRingSystemFamily } from '../model/scaffold-plan.js';
import { IMPROVEMENT_EPSILON, RING_SYSTEM_RESCUE_LIMITS } from '../constants.js';

const LINKER_ZIGZAG_TURN_ANGLE = Math.PI / 3;
const EXACT_TRIGONAL_CONTINUATION_ANGLE = (2 * Math.PI) / 3;
const MAX_RING_LINKER_ATOMS = 3;
const LINKED_RING_ROTATION_OFFSETS = [Math.PI / 3, -Math.PI / 3, (2 * Math.PI) / 3, -(2 * Math.PI) / 3, Math.PI];
const DIRECT_ATTACHMENT_ROTATION_OFFSETS = [0, Math.PI / 6, -Math.PI / 6, Math.PI / 3, -Math.PI / 3];
const DIRECT_ATTACHMENT_RING_ROTATION_OFFSETS = [0, Math.PI / 3, -Math.PI / 3, (2 * Math.PI) / 3, -(2 * Math.PI) / 3, Math.PI];
const DIRECT_ATTACHMENT_FINE_ANGLE_OFFSETS = [Math.PI / 12, -(Math.PI / 12)];
const DIRECT_ATTACHMENT_LOCAL_REFINEMENT_RING_ROTATION_OFFSETS = [0, Math.PI / 12, -(Math.PI / 12), Math.PI / 6, -(Math.PI / 6)];
const DIRECT_ATTACHMENT_MIN_JUNCTION_GAP = Math.PI / 3;
const ATTACHED_BLOCK_OUTWARD_READABILITY_PENALTY = 120;
const ATTACHED_BLOCK_INWARD_READABILITY_PENALTY = 360;
const EXACT_ATTACHMENT_SEARCH_HEAVY_ATOM_LIMIT = 50;
const SHARED_JUNCTION_LOCAL_OUTWARD_SPREAD_LIMIT = Math.PI / 6;
const SHARED_JUNCTION_STRAIGHT_CLEARANCE_LIMIT = Math.PI / 3;

function expandScoringFocusAtomIds(layoutGraph, atomIds, depth = 1) {
  const expandedAtomIds = new Set(atomIds);
  let frontierAtomIds = new Set(atomIds);

  for (let level = 0; level < depth; level++) {
    const nextFrontierAtomIds = new Set();
    for (const atomId of frontierAtomIds) {
      for (const bond of layoutGraph.bondsByAtomId.get(atomId) ?? []) {
        if (!bond || bond.kind !== 'covalent') {
          continue;
        }
        const neighborAtomId = bond.a === atomId ? bond.b : bond.a;
        if (expandedAtomIds.has(neighborAtomId)) {
          continue;
        }
        expandedAtomIds.add(neighborAtomId);
        nextFrontierAtomIds.add(neighborAtomId);
      }
    }
    frontierAtomIds = nextFrontierAtomIds;
    if (frontierAtomIds.size === 0) {
      break;
    }
  }

  return expandedAtomIds;
}

function compareCanonicalIds(firstAtomId, secondAtomId, canonicalAtomRank) {
  const firstRank = canonicalAtomRank.get(firstAtomId) ?? Number.MAX_SAFE_INTEGER;
  const secondRank = canonicalAtomRank.get(secondAtomId) ?? Number.MAX_SAFE_INTEGER;
  return firstRank - secondRank || String(firstAtomId).localeCompare(String(secondAtomId), 'en', { numeric: true });
}

function incidentRingOutwardAngles(layoutGraph, coords, anchorAtomId) {
  if (!coords.has(anchorAtomId)) {
    return [];
  }

  const anchorPosition = coords.get(anchorAtomId);
  return (layoutGraph.atomToRings.get(anchorAtomId) ?? []).flatMap(ring => {
    const placedRingPositions = ring.atomIds.filter(atomId => coords.has(atomId)).map(atomId => coords.get(atomId));
    if (placedRingPositions.length < 3) {
      return [];
    }
    return [angleOf(sub(anchorPosition, centroid(placedRingPositions)))];
  });
}

function largestAngularGapBisector(occupiedAngles) {
  const sortedAngles = [...occupiedAngles]
    .map(wrapAngle)
    .sort((firstAngle, secondAngle) => firstAngle - secondAngle)
    .filter((angle, index, angles) => index === 0 || angularDifference(angle, angles[index - 1]) > 1e-9);
  if (sortedAngles.length === 0) {
    return null;
  }

  let bestBisector = null;
  let bestGap = -Infinity;
  for (let index = 0; index < sortedAngles.length; index++) {
    const gapStart = sortedAngles[index];
    let gapEnd = sortedAngles[(index + 1) % sortedAngles.length];
    if (index + 1 === sortedAngles.length) {
      gapEnd += Math.PI * 2;
    }
    const gap = gapEnd - gapStart;
    if (gap > bestGap + 1e-9) {
      bestGap = gap;
      bestBisector = wrapAngle(gapStart + gap / 2);
    }
  }
  return bestBisector;
}

function directAttachmentLocalOutwardAngles(layoutGraph, coords, anchorAtomId, otherAtomId = null) {
  const anchorPosition = coords.get(anchorAtomId);
  if (!anchorPosition) {
    return [];
  }

  const outwardAngles = [];
  for (const ring of layoutGraph.atomToRings.get(anchorAtomId) ?? []) {
    if (otherAtomId && ring.atomIds.includes(otherAtomId)) {
      continue;
    }

    const ringNeighborAngles = [];
    for (const bond of layoutGraph.bondsByAtomId.get(anchorAtomId) ?? []) {
      if (!bond || bond.kind !== 'covalent') {
        continue;
      }
      const neighborAtomId = bond.a === anchorAtomId ? bond.b : bond.a;
      if (neighborAtomId === otherAtomId || !ring.atomIds.includes(neighborAtomId) || !coords.has(neighborAtomId)) {
        continue;
      }
      ringNeighborAngles.push(angleOf(sub(coords.get(neighborAtomId), anchorPosition)));
    }
    if (ringNeighborAngles.length !== 2) {
      continue;
    }

    const outwardAngle = largestAngularGapBisector(ringNeighborAngles);
    if (outwardAngle == null || outwardAngles.some(existingAngle => angularDifference(existingAngle, outwardAngle) <= 1e-9)) {
      continue;
    }
    outwardAngles.push(outwardAngle);
  }

  return outwardAngles;
}

function meanAngle(angles) {
  let sumX = 0;
  let sumY = 0;
  for (const angle of angles) {
    sumX += Math.cos(angle);
    sumY += Math.sin(angle);
  }
  return angleOf({ x: sumX, y: sumY });
}

function sharedJunctionTerminalLeafTargetAngle(layoutGraph, coords, anchorAtomId, childAtomId) {
  if (!coords.has(anchorAtomId) || !coords.has(childAtomId)) {
    return null;
  }

  const childAtom = layoutGraph.atoms.get(childAtomId);
  if (!childAtom || childAtom.element !== 'C' || childAtom.heavyDegree !== 1) {
    return null;
  }

  const anchorRings = layoutGraph.atomToRings.get(anchorAtomId) ?? [];
  if (anchorRings.length === 0) {
    return null;
  }

  const bond = layoutGraph.bondByAtomPair.get(
    anchorAtomId < childAtomId ? `${anchorAtomId}:${childAtomId}` : `${childAtomId}:${anchorAtomId}`
  );
  if (!bond || bond.kind !== 'covalent' || bond.inRing || bond.aromatic || (bond.order ?? 1) !== 1) {
    return null;
  }

  const anchorPosition = coords.get(anchorAtomId);
  const ringNeighborIds = layoutGraph.sourceMolecule.atoms.get(anchorAtomId)
    ?.getNeighbors(layoutGraph.sourceMolecule)
    .filter(
      neighborAtom =>
        neighborAtom
        && neighborAtom.name !== 'H'
        && neighborAtom.id !== childAtomId
        && coords.has(neighborAtom.id)
        && (layoutGraph.atomToRings.get(neighborAtom.id)?.length ?? 0) > 0
    )
    .map(neighborAtom => neighborAtom.id) ?? [];
  if (ringNeighborIds.length < 3) {
    return null;
  }

  const sharedJunctionNeighborIds = ringNeighborIds.filter(neighborAtomId => {
    const neighborRings = layoutGraph.atomToRings.get(neighborAtomId) ?? [];
    return neighborRings.filter(ring => anchorRings.includes(ring)).length > 1;
  });
  if (sharedJunctionNeighborIds.length !== 1 || !coords.has(sharedJunctionNeighborIds[0])) {
    return null;
  }

  const straightJunctionAngle = angleOf(sub(anchorPosition, coords.get(sharedJunctionNeighborIds[0])));
  const ringNeighborAngles = ringNeighborIds.map(neighborAtomId => angleOf(sub(coords.get(neighborAtomId), anchorPosition)));
  const straightJunctionClearance = Math.min(
    ...ringNeighborAngles.map(occupiedAngle => angularDifference(straightJunctionAngle, occupiedAngle))
  );
  const localOutwardAngles = incidentRingOutwardAngles(layoutGraph, coords, anchorAtomId);
  if (localOutwardAngles.length >= 2) {
    let localOutwardSpread = 0;
    for (let firstIndex = 0; firstIndex < localOutwardAngles.length; firstIndex++) {
      for (let secondIndex = firstIndex + 1; secondIndex < localOutwardAngles.length; secondIndex++) {
        localOutwardSpread = Math.max(
          localOutwardSpread,
          angularDifference(localOutwardAngles[firstIndex], localOutwardAngles[secondIndex])
        );
      }
    }
    if (
      localOutwardSpread <= SHARED_JUNCTION_LOCAL_OUTWARD_SPREAD_LIMIT + 1e-6
      && Math.min(...localOutwardAngles.map(angle => angularDifference(angle, straightJunctionAngle)))
        >= SHARED_JUNCTION_LOCAL_OUTWARD_SPREAD_LIMIT - 1e-6
    ) {
      return meanAngle(localOutwardAngles);
    }
  }

  return straightJunctionClearance >= SHARED_JUNCTION_STRAIGHT_CLEARANCE_LIMIT - 1e-6
    ? straightJunctionAngle
    : null;
}

function snapExactSharedJunctionTerminalLeaves(layoutGraph, coords, bondLength) {
  for (const anchorAtomId of coords.keys()) {
    if ((layoutGraph.atomToRings.get(anchorAtomId)?.length ?? 0) === 0) {
      continue;
    }
    for (const childAtom of layoutGraph.sourceMolecule.atoms.get(anchorAtomId)?.getNeighbors(layoutGraph.sourceMolecule) ?? []) {
      if (!childAtom || childAtom.name === 'H') {
        continue;
      }
      const childAtomId = childAtom.id;
      const targetAngle = sharedJunctionTerminalLeafTargetAngle(layoutGraph, coords, anchorAtomId, childAtomId);
      if (targetAngle == null) {
        continue;
      }
      coords.set(childAtomId, add(coords.get(anchorAtomId), fromAngle(targetAngle, bondLength)));
    }
  }
}

function ringSystemDescriptors(layoutGraph, ringSystem) {
  const ringIdSet = new Set(ringSystem.ringIds);
  const rings = layoutGraph.rings.filter(ring => ringIdSet.has(ring.id));
  const connections = layoutGraph.ringConnections.filter(connection => ringIdSet.has(connection.firstRingId) && ringIdSet.has(connection.secondRingId));
  return { rings, connections };
}

function ringSystemAdjacency(layoutGraph, ringSystem) {
  const { rings, connections } = ringSystemDescriptors(layoutGraph, ringSystem);
  const ringAdj = new Map(rings.map(ring => [ring.id, []]));
  const ringConnectionByPair = new Map();
  for (const connection of connections) {
    ringAdj.get(connection.firstRingId)?.push(connection.secondRingId);
    ringAdj.get(connection.secondRingId)?.push(connection.firstRingId);
    const key = connection.firstRingId < connection.secondRingId ? `${connection.firstRingId}:${connection.secondRingId}` : `${connection.secondRingId}:${connection.firstRingId}`;
    ringConnectionByPair.set(key, connection);
  }
  for (const neighbors of ringAdj.values()) {
    neighbors.sort((firstRingId, secondRingId) => firstRingId - secondRingId);
  }
  return { rings, connections, ringAdj, ringConnectionByPair };
}

function ringSystemConnectionKinds(layoutGraph, ringSystem) {
  const { connections } = ringSystemDescriptors(layoutGraph, ringSystem);
  const kinds = new Set();
  for (const connection of connections) {
    if (connection.kind) {
      kinds.add(connection.kind);
    }
  }
  return kinds;
}

function buildFusedRingBlocks(rings, ringAdj, ringConnectionByPair) {
  const ringById = new Map(rings.map(ring => [ring.id, ring]));
  const visitedRingIds = new Set();
  const blocks = [];

  for (const ring of rings) {
    if (visitedRingIds.has(ring.id)) {
      continue;
    }
    const blockRingIds = [];
    const stack = [ring.id];
    visitedRingIds.add(ring.id);

    while (stack.length > 0) {
      const currentRingId = stack.pop();
      blockRingIds.push(currentRingId);
      for (const neighborRingId of ringAdj.get(currentRingId) ?? []) {
        const key = currentRingId < neighborRingId ? `${currentRingId}:${neighborRingId}` : `${neighborRingId}:${currentRingId}`;
        if (ringConnectionByPair.get(key)?.kind !== 'fused' || visitedRingIds.has(neighborRingId)) {
          continue;
        }
        visitedRingIds.add(neighborRingId);
        stack.push(neighborRingId);
      }
    }

    blockRingIds.sort((firstRingId, secondRingId) => firstRingId - secondRingId);
    const blockRingIdSet = new Set(blockRingIds);
    const blockRings = blockRingIds.map(ringId => ringById.get(ringId)).filter(Boolean);
    const blockRingAdj = new Map(blockRingIds.map(ringId => [ringId, []]));
    const blockRingConnectionByPair = new Map();
    for (const ringId of blockRingIds) {
      for (const neighborRingId of ringAdj.get(ringId) ?? []) {
        const key = ringId < neighborRingId ? `${ringId}:${neighborRingId}` : `${neighborRingId}:${ringId}`;
        const connection = ringConnectionByPair.get(key);
        if (connection?.kind !== 'fused' || !blockRingIdSet.has(neighborRingId)) {
          continue;
        }
        blockRingAdj.get(ringId)?.push(neighborRingId);
        blockRingConnectionByPair.set(key, connection);
      }
    }
    for (const neighbors of blockRingAdj.values()) {
      neighbors.sort((firstRingId, secondRingId) => firstRingId - secondRingId);
    }

    blocks.push({
      id: blocks.length,
      ringIds: blockRingIds,
      rings: blockRings,
      ringAdj: blockRingAdj,
      ringConnectionByPair: blockRingConnectionByPair,
      atomIds: [...new Set(blockRings.flatMap(blockRing => blockRing.atomIds))]
    });
  }

  return blocks;
}

function compareCoordMapsDeterministically(firstCoords, secondCoords, canonicalAtomRank) {
  const atomIds = (firstCoords.size === secondCoords.size ? [...firstCoords.keys()] : [...new Set([...firstCoords.keys(), ...secondCoords.keys()])]).sort(
    (firstAtomId, secondAtomId) => compareCanonicalIds(firstAtomId, secondAtomId, canonicalAtomRank)
  );
  for (const atomId of atomIds) {
    const firstPosition = firstCoords.get(atomId);
    const secondPosition = secondCoords.get(atomId);
    if (!firstPosition && !secondPosition) {
      continue;
    }
    if (!firstPosition) {
      return 1;
    }
    if (!secondPosition) {
      return -1;
    }
    const roundedFirstX = Math.round(firstPosition.x * 1e6);
    const roundedSecondX = Math.round(secondPosition.x * 1e6);
    if (roundedFirstX !== roundedSecondX) {
      return roundedFirstX - roundedSecondX;
    }
    const roundedFirstY = Math.round(firstPosition.y * 1e6);
    const roundedSecondY = Math.round(secondPosition.y * 1e6);
    if (roundedFirstY !== roundedSecondY) {
      return roundedFirstY - roundedSecondY;
    }
  }
  return 0;
}

function buildHybridBlockGraph(blocks, ringConnectionByPair) {
  const blockByRingId = new Map();
  for (const block of blocks) {
    for (const ringId of block.ringIds) {
      blockByRingId.set(ringId, block.id);
    }
  }

  const blockAdj = new Map(blocks.map(block => [block.id, []]));
  const blockConnectionByPair = new Map();
  for (const connection of ringConnectionByPair.values()) {
    if (!connection || connection.kind === 'fused') {
      continue;
    }
    const firstBlockId = blockByRingId.get(connection.firstRingId);
    const secondBlockId = blockByRingId.get(connection.secondRingId);
    if (firstBlockId == null || secondBlockId == null || firstBlockId === secondBlockId) {
      continue;
    }
    const key = firstBlockId < secondBlockId ? `${firstBlockId}:${secondBlockId}` : `${secondBlockId}:${firstBlockId}`;
    if (blockConnectionByPair.has(key)) {
      return null;
    }
    blockAdj.get(firstBlockId)?.push(secondBlockId);
    blockAdj.get(secondBlockId)?.push(firstBlockId);
    blockConnectionByPair.set(key, connection);
  }
  for (const neighbors of blockAdj.values()) {
    neighbors.sort((firstBlockId, secondBlockId) => firstBlockId - secondBlockId);
  }

  return { blockAdj, blockConnectionByPair, blockByRingId };
}

function scoreHybridBlockPlacement(layoutGraph, candidateCoords, placedCoords, sharedAtomIds, bondLength) {
  const sharedAtomIdSet = new Set(sharedAtomIds);
  let severeOverlapCount = 0;
  let minDistance = Infinity;
  const threshold = bondLength * 0.55;

  for (const [candidateAtomId, candidatePosition] of candidateCoords) {
    if (sharedAtomIdSet.has(candidateAtomId)) {
      continue;
    }
    for (const [placedAtomId, placedPosition] of placedCoords) {
      if (sharedAtomIdSet.has(placedAtomId)) {
        continue;
      }
      const key = candidateAtomId < placedAtomId ? `${candidateAtomId}:${placedAtomId}` : `${placedAtomId}:${candidateAtomId}`;
      if (layoutGraph.bondedPairSet.has(key)) {
        continue;
      }
      const distanceBetween = Math.hypot(candidatePosition.x - placedPosition.x, candidatePosition.y - placedPosition.y);
      minDistance = Math.min(minDistance, distanceBetween);
      if (distanceBetween < threshold) {
        severeOverlapCount++;
      }
    }
  }

  return {
    severeOverlapCount,
    minDistance: Number.isFinite(minDistance) ? minDistance : Infinity
  };
}

function isBetterHybridBlockScore(candidateScore, incumbentScore) {
  if (!candidateScore) {
    return false;
  }
  if (!incumbentScore) {
    return true;
  }
  if (candidateScore.severeOverlapCount !== incumbentScore.severeOverlapCount) {
    return candidateScore.severeOverlapCount < incumbentScore.severeOverlapCount;
  }
  return candidateScore.minDistance > incumbentScore.minDistance;
}

function placeHybridSpiroBlock(layoutGraph, placedCoords, placedBlock, childBlock, childLayout, blockConnection, blockByRingId, bondLength) {
  const sharedAtomId = blockConnection.sharedAtomIds?.[0] ?? null;
  if (!sharedAtomId) {
    return null;
  }

  const parentRingId = blockByRingId.get(blockConnection.firstRingId) === placedBlock.id ? blockConnection.firstRingId : blockConnection.secondRingId;
  const parentRing = placedBlock.rings.find(ring => ring.id === parentRingId) ?? null;
  if (!parentRing) {
    return null;
  }

  const sharedPosition = placedCoords.get(sharedAtomId);
  const parentRingPositions = parentRing.atomIds.map(atomId => placedCoords.get(atomId)).filter(Boolean);
  if (!sharedPosition || parentRingPositions.length !== parentRing.atomIds.length) {
    return null;
  }

  const baseAngle = angleOf(sub(sharedPosition, centroid(parentRingPositions)));
  const offsets = [0, Math.PI / 6, Math.PI / 4];
  let bestCandidate = null;

  for (const offset of offsets) {
    for (const direction of [1, -1]) {
      const targetAngle = baseAngle + direction * offset;
      for (const mirror of [false, true]) {
        const transformedCoords = transformAttachedBlock(childLayout.coords, sharedAtomId, sharedPosition, targetAngle, { mirror });
        const score = scoreHybridBlockPlacement(layoutGraph, transformedCoords, placedCoords, [sharedAtomId], bondLength);
        if (!bestCandidate || isBetterHybridBlockScore(score, bestCandidate.score)) {
          bestCandidate = {
            coords: transformedCoords,
            score
          };
        }
      }
    }
  }

  return bestCandidate;
}

/**
 * Returns the two terminal atoms for one contiguous shared ring boundary segment.
 * @param {string[]} atomIds - Ordered cyclic ring atom IDs.
 * @param {string[]} sharedAtomIds - Shared ring-boundary atom IDs.
 * @returns {[string, string]|null} Segment endpoints or `null` when the shared boundary is not one contiguous segment.
 */
function sharedBoundarySegmentEndpoints(atomIds, sharedAtomIds) {
  const sharedAtomIdSet = new Set(sharedAtomIds);
  const sharedIndices = atomIds
    .map((atomId, index) => (sharedAtomIdSet.has(atomId) ? index : -1))
    .filter(index => index >= 0);
  if (sharedIndices.length < 2) {
    return null;
  }

  const sharedIndexSet = new Set(sharedIndices);
  const segmentEndpoints = [];
  for (const index of sharedIndices) {
    const previousShared = sharedIndexSet.has((index - 1 + atomIds.length) % atomIds.length);
    const nextShared = sharedIndexSet.has((index + 1) % atomIds.length);
    if (previousShared === nextShared) {
      continue;
    }
    segmentEndpoints.push(atomIds[index]);
  }

  return segmentEndpoints.length === 2 ? [segmentEndpoints[0], segmentEndpoints[1]] : null;
}

/**
 * Builds an exact mirrored-path candidate for a single child ring that shares a
 * contiguous multi-atom bridge with an already placed parent ring.
 * Reflecting the parent ring's non-shared arc across the shared endpoints keeps
 * all bridge atoms fixed while avoiding the collapsed regular-ring overlay that
 * a rigid single-ring alignment can otherwise produce.
 * @param {object} placedCoords - Already placed ring-block coordinates.
 * @param {object} placedBlock - Block that is already fixed in the hybrid layout.
 * @param {object} childBlock - Single-ring child block being attached.
 * @param {{sharedAtomIds?: string[], firstRingId: number, secondRingId: number}} blockConnection - Hybrid block connection descriptor.
 * @param {Map<number, number>} blockByRingId - Ring-to-block ownership map.
 * @returns {Map<string, {x: number, y: number}>|null} Mirrored child-ring coordinates or `null` when the topology is not eligible.
 */
function buildMirroredSingleRingBridgedCandidate(placedCoords, placedBlock, childBlock, blockConnection, blockByRingId) {
  if (childBlock.rings.length !== 1 || (blockConnection.sharedAtomIds?.length ?? 0) < 3) {
    return null;
  }

  const parentRingId = blockByRingId.get(blockConnection.firstRingId) === placedBlock.id ? blockConnection.firstRingId : blockConnection.secondRingId;
  const childRingId = parentRingId === blockConnection.firstRingId ? blockConnection.secondRingId : blockConnection.firstRingId;
  const parentRing = placedBlock.rings.find(ring => ring.id === parentRingId) ?? null;
  const childRing = childBlock.rings.find(ring => ring.id === childRingId) ?? null;
  if (!parentRing || !childRing) {
    return null;
  }

  const segmentEndpoints = sharedBoundarySegmentEndpoints(childRing.atomIds, blockConnection.sharedAtomIds ?? []);
  if (!segmentEndpoints) {
    return null;
  }
  const [firstSharedAtomId, secondSharedAtomId] = segmentEndpoints;
  if (!placedCoords.has(firstSharedAtomId) || !placedCoords.has(secondSharedAtomId)) {
    return null;
  }

  const parentPath = nonSharedPath(parentRing.atomIds, firstSharedAtomId, secondSharedAtomId);
  const childPath = nonSharedPath(childRing.atomIds, firstSharedAtomId, secondSharedAtomId);
  const sharedAtomIdSet = new Set(blockConnection.sharedAtomIds ?? []);
  if (
    parentPath.length !== childPath.length
    || childPath.length !== 4
    || parentPath.slice(1, -1).some(atomId => sharedAtomIdSet.has(atomId))
    || childPath.slice(1, -1).some(atomId => sharedAtomIdSet.has(atomId))
  ) {
    return null;
  }

  const firstSharedPosition = placedCoords.get(firstSharedAtomId);
  const secondSharedPosition = placedCoords.get(secondSharedAtomId);
  const mirroredCoords = new Map();
  for (const atomId of blockConnection.sharedAtomIds ?? []) {
    const position = placedCoords.get(atomId);
    if (!position) {
      return null;
    }
    mirroredCoords.set(atomId, position);
  }

  for (let index = 1; index < childPath.length - 1; index++) {
    const parentPathPosition = placedCoords.get(parentPath[index]);
    if (!parentPathPosition) {
      return null;
    }
    mirroredCoords.set(
      childPath[index],
      reflectAcrossLine(parentPathPosition, firstSharedPosition, secondSharedPosition)
    );
  }

  return mirroredCoords.size === childBlock.atomIds.length ? mirroredCoords : null;
}

function placeHybridBridgedBlock(layoutGraph, placedCoords, placedBlock, childBlock, childLayout, blockConnection, blockByRingId, bondLength) {
  const sharedAtomIds = (blockConnection.sharedAtomIds ?? []).filter(atomId => placedCoords.has(atomId) && childLayout.coords.has(atomId));
  if (sharedAtomIds.length < 2) {
    return null;
  }

  const fixedCoords = new Map(sharedAtomIds.map(atomId => [atomId, placedCoords.get(atomId)]));
  const aligned = alignCoordsToFixed(childLayout.coords, childBlock.atomIds, fixedCoords);
  let bestCandidate = {
    coords: aligned.coords,
    score: scoreHybridBlockPlacement(layoutGraph, aligned.coords, placedCoords, sharedAtomIds, bondLength)
  };

  if (bestCandidate.score.severeOverlapCount > 0) {
    const mirroredCoords = buildMirroredSingleRingBridgedCandidate(placedCoords, placedBlock, childBlock, blockConnection, blockByRingId);
    if (mirroredCoords) {
      const mirroredCandidate = {
        coords: mirroredCoords,
        score: scoreHybridBlockPlacement(layoutGraph, mirroredCoords, placedCoords, sharedAtomIds, bondLength)
      };
      if (isBetterHybridBlockScore(mirroredCandidate.score, bestCandidate.score)) {
        bestCandidate = mirroredCandidate;
      }
    }
  }

  return bestCandidate;
}

function layoutFusedConnectedHybridRingSystem(layoutGraph, rings, ringAdj, ringConnectionByPair, bondLength) {
  const blocks = buildFusedRingBlocks(rings, ringAdj, ringConnectionByPair);
  if (blocks.length === 0) {
    return null;
  }

  if (blocks.length === 1) {
    return layoutFusedFamily(rings, blocks[0].ringAdj, blocks[0].ringConnectionByPair, bondLength, { layoutGraph, templateId: null });
  }

  const blockGraph = buildHybridBlockGraph(blocks, ringConnectionByPair);
  if (!blockGraph || blockGraph.blockConnectionByPair.size !== blocks.length - 1) {
    return null;
  }

  const visitedBlockIds = new Set();
  const traversalQueue = [];
  const rootBlock = [...blocks].sort((firstBlock, secondBlock) => {
    if (secondBlock.atomIds.length !== firstBlock.atomIds.length) {
      return secondBlock.atomIds.length - firstBlock.atomIds.length;
    }
    return secondBlock.ringIds.length - firstBlock.ringIds.length;
  })[0];
  const rootLayout = layoutFusedFamily(rootBlock.rings, rootBlock.ringAdj, rootBlock.ringConnectionByPair, bondLength, {
    layoutGraph,
    templateId: null
  });
  if (!rootLayout || rootLayout.coords.size !== rootBlock.atomIds.length) {
    return null;
  }

  const coords = new Map(rootLayout.coords);
  const ringCenters = new Map();
  for (const ring of rootBlock.rings) {
    ringCenters.set(ring.id, centroid(ring.atomIds.map(atomId => coords.get(atomId))));
  }
  visitedBlockIds.add(rootBlock.id);
  traversalQueue.push(rootBlock.id);

  while (traversalQueue.length > 0) {
    const currentBlockId = traversalQueue.shift();
    const currentBlock = blocks.find(block => block.id === currentBlockId) ?? null;
    if (!currentBlock) {
      return null;
    }

    for (const neighborBlockId of blockGraph.blockAdj.get(currentBlockId) ?? []) {
      if (visitedBlockIds.has(neighborBlockId)) {
        continue;
      }
      const neighborBlock = blocks.find(block => block.id === neighborBlockId) ?? null;
      if (!neighborBlock) {
        return null;
      }
      const connectionKey = currentBlockId < neighborBlockId ? `${currentBlockId}:${neighborBlockId}` : `${neighborBlockId}:${currentBlockId}`;
      const blockConnection = blockGraph.blockConnectionByPair.get(connectionKey);
      const neighborLayout = layoutFusedFamily(neighborBlock.rings, neighborBlock.ringAdj, neighborBlock.ringConnectionByPair, bondLength, { layoutGraph, templateId: null });
      if (!blockConnection || !neighborLayout || neighborLayout.coords.size !== neighborBlock.atomIds.length) {
        return null;
      }

      let placedCandidate = null;
      if (blockConnection.kind === 'spiro') {
        placedCandidate = placeHybridSpiroBlock(layoutGraph, coords, currentBlock, neighborBlock, neighborLayout, blockConnection, blockGraph.blockByRingId, bondLength);
      } else if (blockConnection.kind === 'bridged') {
        placedCandidate = placeHybridBridgedBlock(layoutGraph, coords, currentBlock, neighborBlock, neighborLayout, blockConnection, blockGraph.blockByRingId, bondLength);
      }
      if (!placedCandidate) {
        return null;
      }

      for (const [atomId, position] of placedCandidate.coords) {
        coords.set(atomId, position);
      }
      for (const ring of neighborBlock.rings) {
        ringCenters.set(ring.id, centroid(ring.atomIds.map(atomId => coords.get(atomId))));
      }

      visitedBlockIds.add(neighborBlockId);
      traversalQueue.push(neighborBlockId);
    }
  }

  const atomIds = new Set(rings.flatMap(ring => ring.atomIds));
  if (coords.size !== atomIds.size) {
    return null;
  }

  return {
    coords,
    ringCenters,
    placementMode: 'constructed'
  };
}

function wrapRingSystemPlacementResult(layoutGraph, ringSystem, family, result, templateId = null) {
  if (!result) {
    return null;
  }
  return {
    family,
    validationClass: resolvePlacementValidationClass(family, result.placementMode, templateId),
    ...result
  };
}

function auditRingSystemPlacement(layoutGraph, ringSystem, placement, bondLength) {
  if (!placement || placement.coords.size !== ringSystem.atomIds.length) {
    return null;
  }
  const bondValidationClasses = assignBondValidationClass(layoutGraph, ringSystem.atomIds, placement.validationClass);
  return auditLayout(layoutGraph, placement.coords, {
    bondLength,
    bondValidationClasses
  });
}

function isBetterRingSystemPlacement(candidatePlacement, incumbentPlacement, candidateAudit, incumbentAudit, bondFirst = false) {
  if (!candidatePlacement || !candidateAudit) {
    return false;
  }
  if (!incumbentPlacement || !incumbentAudit) {
    return true;
  }
  if (bondFirst) {
    if (candidateAudit.bondLengthFailureCount !== incumbentAudit.bondLengthFailureCount) {
      return candidateAudit.bondLengthFailureCount < incumbentAudit.bondLengthFailureCount;
    }
    if (Math.abs(candidateAudit.maxBondLengthDeviation - incumbentAudit.maxBondLengthDeviation) > 1e-9) {
      return candidateAudit.maxBondLengthDeviation < incumbentAudit.maxBondLengthDeviation;
    }
    if (candidateAudit.severeOverlapCount !== incumbentAudit.severeOverlapCount) {
      return candidateAudit.severeOverlapCount < incumbentAudit.severeOverlapCount;
    }
  } else {
    if (candidateAudit.severeOverlapCount !== incumbentAudit.severeOverlapCount) {
      return candidateAudit.severeOverlapCount < incumbentAudit.severeOverlapCount;
    }
    if (candidateAudit.bondLengthFailureCount !== incumbentAudit.bondLengthFailureCount) {
      return candidateAudit.bondLengthFailureCount < incumbentAudit.bondLengthFailureCount;
    }
    if (Math.abs(candidateAudit.maxBondLengthDeviation - incumbentAudit.maxBondLengthDeviation) > 1e-9) {
      return candidateAudit.maxBondLengthDeviation < incumbentAudit.maxBondLengthDeviation;
    }
  }
  return candidatePlacement.placementMode !== incumbentPlacement.placementMode;
}

function shouldTryCompactBridgedRingSystemRescue(ringSystem, templateId, audit) {
  if (templateId || !audit) {
    return false;
  }
  return (
    ringSystem.atomIds.length <= RING_SYSTEM_RESCUE_LIMITS.compactBridgedAtomCount &&
    ringSystem.ringIds.length <= RING_SYSTEM_RESCUE_LIMITS.compactBridgedRingCount &&
    (audit.severeOverlapCount > 0 || audit.bondLengthFailureCount > 0)
  );
}

function shouldTryBridgedRingSystemRescue(ringSystem, templateId, audit) {
  if (templateId || !audit) {
    return false;
  }
  return (
    ringSystem.atomIds.length >= RING_SYSTEM_RESCUE_LIMITS.bridgedTemplateMissAtomCount &&
    ringSystem.ringIds.length >= RING_SYSTEM_RESCUE_LIMITS.bridgedTemplateMissRingCount &&
    (audit.severeOverlapCount > 0 || audit.bondLengthFailureCount > 0)
  );
}

/**
 * Lays out one ring system inside a mixed scaffold and resolves its audit class.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {object} ringSystem - Ring-system descriptor.
 * @param {number} bondLength - Target bond length.
 * @param {string|null} [templateId] - Matched template ID.
 * @returns {{family: string, validationClass: 'planar'|'bridged', coords: Map<string, {x: number, y: number}>, ringCenters: Map<number, {x: number, y: number}>, placementMode: string}|null} Ring-system layout result.
 */
function layoutRingSystem(layoutGraph, ringSystem, bondLength, templateId = null) {
  const family = classifyRingSystemFamily(layoutGraph, ringSystem);
  const { rings, connections, ringAdj, ringConnectionByPair } = ringSystemAdjacency(layoutGraph, ringSystem);
  if (family === 'isolated-ring') {
    return wrapRingSystemPlacementResult(layoutGraph, ringSystem, family, layoutIsolatedRingFamily(rings[0], bondLength, { layoutGraph, templateId }), templateId);
  }
  if (family === 'macrocycle') {
    return wrapRingSystemPlacementResult(layoutGraph, ringSystem, family, layoutMacrocycleFamily(rings, bondLength, { layoutGraph, templateId }), templateId);
  }
  if (family === 'bridged') {
    const connectionKinds = new Set(connections.map(connection => connection.kind).filter(Boolean));
    let bestPlacement = wrapRingSystemPlacementResult(layoutGraph, ringSystem, family, layoutBridgedFamily(rings, bondLength, { layoutGraph, templateId }), templateId);
    let bestAudit = auditRingSystemPlacement(layoutGraph, ringSystem, bestPlacement, bondLength);

    if (connectionKinds.has('fused') && (connectionKinds.has('spiro') || connectionKinds.has('bridged'))) {
      const hybridRescuePlacement = wrapRingSystemPlacementResult(
        layoutGraph,
        ringSystem,
        family,
        layoutFusedConnectedHybridRingSystem(layoutGraph, rings, ringAdj, ringConnectionByPair, bondLength),
        templateId
      );
      const hybridRescueAudit = auditRingSystemPlacement(layoutGraph, ringSystem, hybridRescuePlacement, bondLength);
      if (isBetterRingSystemPlacement(hybridRescuePlacement, bestPlacement, hybridRescueAudit, bestAudit, true)) {
        bestPlacement = hybridRescuePlacement;
        bestAudit = hybridRescueAudit;
      }
    }

    if (shouldTryCompactBridgedRingSystemRescue(ringSystem, templateId, bestAudit)) {
      const fusedRescuePlacement = wrapRingSystemPlacementResult(
        layoutGraph,
        ringSystem,
        family,
        layoutFusedFamily(rings, ringAdj, ringConnectionByPair, bondLength, { layoutGraph, templateId }),
        templateId
      );
      const fusedRescueAudit = auditRingSystemPlacement(layoutGraph, ringSystem, fusedRescuePlacement, bondLength);
      if (isBetterRingSystemPlacement(fusedRescuePlacement, bestPlacement, fusedRescueAudit, bestAudit, true)) {
        bestPlacement = fusedRescuePlacement;
        bestAudit = fusedRescueAudit;
      }
    }

    if (!shouldTryBridgedRingSystemRescue(ringSystem, templateId, bestAudit)) {
      return bestPlacement;
    }

    const spiroRescuePlacement = wrapRingSystemPlacementResult(
      layoutGraph,
      ringSystem,
      family,
      layoutSpiroFamily(rings, ringAdj, ringConnectionByPair, bondLength, { layoutGraph, templateId }),
      templateId
    );
    const spiroRescueAudit = auditRingSystemPlacement(layoutGraph, ringSystem, spiroRescuePlacement, bondLength);
    return isBetterRingSystemPlacement(spiroRescuePlacement, bestPlacement, spiroRescueAudit, bestAudit) ? spiroRescuePlacement : bestPlacement;
  }
  if (family === 'fused') {
    if (shouldShortCircuitToFusedCageKk(ringSystem.atomIds.length, ringSystem.ringIds.length, templateId)) {
      return wrapRingSystemPlacementResult(
        layoutGraph,
        ringSystem,
        family,
        layoutFusedCageKamadaKawai(rings, bondLength, { layoutGraph, templateId }) ??
          layoutFusedFamily(rings, ringAdj, ringConnectionByPair, bondLength, { layoutGraph, templateId }),
        templateId
      );
    }

    let bestPlacement = wrapRingSystemPlacementResult(
      layoutGraph,
      ringSystem,
      family,
      layoutFusedFamily(rings, ringAdj, ringConnectionByPair, bondLength, { layoutGraph, templateId }),
      templateId
    );
    let bestAudit = auditRingSystemPlacement(layoutGraph, ringSystem, bestPlacement, bondLength);
    if (shouldTryBridgedRescueForFusedSystem(ringSystem.atomIds.length, ringSystem.ringIds.length, templateId, bestAudit)) {
      const bridgedRescuePlacement = wrapRingSystemPlacementResult(
        layoutGraph,
        ringSystem,
        family,
        layoutBridgedFamily(rings, bondLength, { layoutGraph, templateId }),
        templateId
      );
      const bridgedRescueAudit = auditRingSystemPlacement(layoutGraph, ringSystem, bridgedRescuePlacement, bondLength);
      if (isBetterBridgedRescueForFusedSystem(bridgedRescueAudit, bestAudit)) {
        bestPlacement = bridgedRescuePlacement;
        bestAudit = bridgedRescueAudit;
      }

      const cageKkPlacement = wrapRingSystemPlacementResult(
        layoutGraph,
        ringSystem,
        family,
        layoutFusedCageKamadaKawai(rings, bondLength, { layoutGraph, templateId }),
        templateId
      );
      const cageKkAudit = auditRingSystemPlacement(layoutGraph, ringSystem, cageKkPlacement, bondLength);
      if (isBetterBridgedRescueForFusedSystem(cageKkAudit, bestAudit)) {
        bestPlacement = cageKkPlacement;
      }
    }
    return bestPlacement;
  }
  if (family === 'spiro') {
    return wrapRingSystemPlacementResult(
      layoutGraph,
      ringSystem,
      family,
      layoutSpiroFamily(rings, ringAdj, ringConnectionByPair, bondLength, { layoutGraph, templateId }),
      templateId
    );
  }
  return null;
}

/**
 * Scores one pending-ring attachment candidate. When a rigid pending ring can
 * dock through multiple already placed neighbors, prefer the anchor that does
 * not consume a stricter local ring-exit geometry that branch placement could
 * still realize later, such as exocyclic trigonal alkene roots or small-ring
 * exterior continuations.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {string} attachmentAtomId - Pending ring-system atom ID.
 * @param {string} parentAtomId - Already placed neighbor atom ID.
 * @returns {{sensitiveAttachmentPenalty: number, parentIsRingPenalty: number, attachmentRank: number, parentRank: number}} Attachment priority tuple.
 */
function pendingRingAttachmentPriority(layoutGraph, attachmentAtomId, parentAtomId) {
  const sensitiveAttachmentPenalty =
    (isExactRingTrigonalBisectorEligible(layoutGraph, attachmentAtomId, parentAtomId) ? 1 : 0)
    + (isExactSmallRingExteriorContinuationEligible(layoutGraph, attachmentAtomId, parentAtomId) ? 1 : 0);
  const parentIsRingPenalty = (layoutGraph.atomToRings.get(parentAtomId)?.length ?? 0) > 0 ? 0 : 1;
  return {
    sensitiveAttachmentPenalty,
    parentIsRingPenalty,
    attachmentRank: layoutGraph.canonicalAtomRank.get(attachmentAtomId) ?? Number.MAX_SAFE_INTEGER,
    parentRank: layoutGraph.canonicalAtomRank.get(parentAtomId) ?? Number.MAX_SAFE_INTEGER
  };
}

/**
 * Chooses the placed-parent bond used to dock a pending ring system onto the
 * current mixed-family layout.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {object} ringSystem - Pending ring-system descriptor.
 * @param {Set<string>} placedAtomIds - Already placed atom IDs.
 * @returns {{attachmentAtomId: string, parentAtomId: string}|null} Selected attachment bond or `null`.
 */
function findAttachmentBond(layoutGraph, ringSystem, placedAtomIds) {
  const ringAtomIdSet = new Set(ringSystem.atomIds);
  const orderedAtomIds = [...ringSystem.atomIds].sort((firstAtomId, secondAtomId) => compareCanonicalIds(firstAtomId, secondAtomId, layoutGraph.canonicalAtomRank));
  const candidates = [];
  for (const atomId of orderedAtomIds) {
    const atom = layoutGraph.sourceMolecule.atoms.get(atomId);
    if (!atom) {
      continue;
    }
    const orderedBondIds = [...atom.bonds].sort((firstBondId, secondBondId) => String(firstBondId).localeCompare(String(secondBondId), 'en', { numeric: true }));
    for (const bondId of orderedBondIds) {
      const bond = layoutGraph.sourceMolecule.bonds.get(bondId);
      if (!bond) {
        continue;
      }
      const otherAtomId = bond.getOtherAtom(atomId);
      if (ringAtomIdSet.has(otherAtomId) || !placedAtomIds.has(otherAtomId)) {
        continue;
      }
      candidates.push({
        attachmentAtomId: atomId,
        parentAtomId: otherAtomId
      });
    }
  }
  if (candidates.length === 0) {
    return null;
  }
  candidates.sort((firstCandidate, secondCandidate) => {
    const firstPriority = pendingRingAttachmentPriority(layoutGraph, firstCandidate.attachmentAtomId, firstCandidate.parentAtomId);
    const secondPriority = pendingRingAttachmentPriority(layoutGraph, secondCandidate.attachmentAtomId, secondCandidate.parentAtomId);
    return (
      firstPriority.sensitiveAttachmentPenalty - secondPriority.sensitiveAttachmentPenalty
      || firstPriority.parentIsRingPenalty - secondPriority.parentIsRingPenalty
      || firstPriority.attachmentRank - secondPriority.attachmentRank
      || firstPriority.parentRank - secondPriority.parentRank
      || compareCanonicalIds(firstCandidate.attachmentAtomId, secondCandidate.attachmentAtomId, layoutGraph.canonicalAtomRank)
      || compareCanonicalIds(firstCandidate.parentAtomId, secondCandidate.parentAtomId, layoutGraph.canonicalAtomRank)
    );
  });
  return candidates[0];
}

/**
 * Returns ring-system atom IDs in canonical order.
 * @param {Iterable<string>} atomIds - Atom IDs to sort.
 * @param {Map<string, number>} canonicalAtomRank - Canonical atom-rank map.
 * @returns {string[]} Canonically sorted atom IDs.
 */
function sortAtomIds(atomIds, canonicalAtomRank) {
  return [...atomIds].sort((firstAtomId, secondAtomId) => compareCanonicalIds(firstAtomId, secondAtomId, canonicalAtomRank));
}

/**
 * Detects the shortest short non-ring linker between a placed ring system and a pending ring system.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {object} pendingRingSystem - Pending ring-system descriptor.
 * @param {Set<number>} placedRingSystemIds - Already placed ring-system IDs.
 * @param {Set<string>} participantAtomIds - Visible component atom IDs.
 * @param {Map<string, number>} atomToRingSystemId - Atom-to-ring-system lookup.
 * @param {number} [maxLinkerAtoms] - Maximum internal non-ring linker atoms to consider.
 * @returns {{firstAttachmentAtomId: string, firstRingSystemId: number, chainAtomIds: string[], secondAttachmentAtomId: string}|null} Shortest linker descriptor.
 */
function findShortestRingLinker(layoutGraph, pendingRingSystem, placedRingSystemIds, participantAtomIds, atomToRingSystemId, maxLinkerAtoms = MAX_RING_LINKER_ATOMS) {
  const pendingRingAtomIds = new Set(pendingRingSystem.atomIds);
  const canonicalAtomRank = layoutGraph.canonicalAtomRank;
  const orderedPendingAttachmentIds = sortAtomIds(pendingRingSystem.atomIds, canonicalAtomRank);
  const queue = [];
  let queueHead = 0;
  const visited = new Map();

  for (const secondAttachmentAtomId of orderedPendingAttachmentIds) {
    const atom = layoutGraph.sourceMolecule.atoms.get(secondAttachmentAtomId);
    if (!atom) {
      continue;
    }
    const orderedNeighborIds = atom
      .getNeighbors(layoutGraph.sourceMolecule)
      .filter(neighborAtom => neighborAtom && participantAtomIds.has(neighborAtom.id))
      .map(neighborAtom => neighborAtom.id)
      .sort((firstAtomId, secondAtomId) => compareCanonicalIds(firstAtomId, secondAtomId, canonicalAtomRank));

    for (const neighborAtomId of orderedNeighborIds) {
      if (pendingRingAtomIds.has(neighborAtomId)) {
        continue;
      }
      const neighborRingSystemId = atomToRingSystemId.get(neighborAtomId);
      if (neighborRingSystemId != null) {
        if (placedRingSystemIds.has(neighborRingSystemId) && neighborRingSystemId !== pendingRingSystem.id) {
          return {
            firstAttachmentAtomId: neighborAtomId,
            firstRingSystemId: neighborRingSystemId,
            chainAtomIds: [],
            secondAttachmentAtomId
          };
        }
        continue;
      }

      const neighborAtom = layoutGraph.atoms.get(neighborAtomId);
      if (!neighborAtom || neighborAtom.element === 'H') {
        continue;
      }

      const visitKey = `${secondAttachmentAtomId}:${neighborAtomId}`;
      visited.set(visitKey, 1);
      queue.push({
        atomId: neighborAtomId,
        chainAtomIds: [neighborAtomId],
        secondAttachmentAtomId
      });
    }
  }

  while (queueHead < queue.length) {
    const current = queue[queueHead++];
    const atom = layoutGraph.sourceMolecule.atoms.get(current.atomId);
    if (!atom) {
      continue;
    }
    const orderedNeighborIds = atom
      .getNeighbors(layoutGraph.sourceMolecule)
      .filter(neighborAtom => neighborAtom && participantAtomIds.has(neighborAtom.id))
      .map(neighborAtom => neighborAtom.id)
      .sort((firstAtomId, secondAtomId) => compareCanonicalIds(firstAtomId, secondAtomId, canonicalAtomRank));

    for (const neighborAtomId of orderedNeighborIds) {
      if (neighborAtomId === current.secondAttachmentAtomId || current.chainAtomIds.includes(neighborAtomId)) {
        continue;
      }
      const neighborRingSystemId = atomToRingSystemId.get(neighborAtomId);
      if (neighborRingSystemId != null) {
        if (placedRingSystemIds.has(neighborRingSystemId) && neighborRingSystemId !== pendingRingSystem.id) {
          return {
            firstAttachmentAtomId: neighborAtomId,
            firstRingSystemId: neighborRingSystemId,
            chainAtomIds: [...current.chainAtomIds].reverse(),
            secondAttachmentAtomId: current.secondAttachmentAtomId
          };
        }
        continue;
      }

      if (current.chainAtomIds.length >= maxLinkerAtoms) {
        continue;
      }

      const neighborAtom = layoutGraph.atoms.get(neighborAtomId);
      if (!neighborAtom || neighborAtom.element === 'H') {
        continue;
      }

      const visitKey = `${current.secondAttachmentAtomId}:${neighborAtomId}`;
      const candidateLength = current.chainAtomIds.length + 1;
      if ((visited.get(visitKey) ?? Number.POSITIVE_INFINITY) <= candidateLength) {
        continue;
      }
      visited.set(visitKey, candidateLength);
      queue.push({
        atomId: neighborAtomId,
        chainAtomIds: [...current.chainAtomIds, neighborAtomId],
        secondAttachmentAtomId: current.secondAttachmentAtomId
      });
    }
  }

  return null;
}

/**
 * Builds the alternating segment directions for a short ring-to-ring linker.
 * @param {number} exitAngle - Outward angle from the first ring system.
 * @param {number} segmentCount - Number of bond segments from the first ring to the second ring.
 * @param {number} turnSign - Zigzag turn sign (`-1` or `1`).
 * @returns {number[]} Segment directions in radians.
 */
function linkerSegmentAngles(exitAngle, segmentCount, turnSign) {
  const segmentAngles = [];
  for (let index = 0; index < segmentCount; index++) {
    segmentAngles.push(index % 2 === 0 ? exitAngle : exitAngle + turnSign * LINKER_ZIGZAG_TURN_ANGLE);
  }
  return segmentAngles;
}

/**
 * Returns the outward exit angle for a ring-system attachment atom.
 * Single-ring perimeter atoms follow their local ring outward axis; fused/shared
 * atoms fall back to the whole ring-system centroid.
 * Pass `checkHeavyAtomLimit: true` when operating on a detached block layout to
 * skip the computation for molecules that exceed the exact-search atom limit.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Coordinate map (placed or detached block).
 * @param {object} ringSystem - Ring-system descriptor.
 * @param {string} attachmentAtomId - Attachment atom ID.
 * @param {{checkHeavyAtomLimit?: boolean}} [options] - Options object.
 * @returns {number|null} Outward exit angle in radians.
 */
function ringLinkerExitAngle(layoutGraph, coords, ringSystem, attachmentAtomId, { checkHeavyAtomLimit = false } = {}) {
  if (checkHeavyAtomLimit && (layoutGraph.traits.heavyAtomCount ?? 0) > EXACT_ATTACHMENT_SEARCH_HEAVY_ATOM_LIMIT) {
    return null;
  }
  const attachmentPosition = coords.get(attachmentAtomId);
  if (!attachmentPosition) {
    return null;
  }
  const attachmentRings = layoutGraph.atomToRings.get(attachmentAtomId) ?? [];
  if (attachmentRings.length === 1) {
    const ringPositions = attachmentRings[0].atomIds.map(atomId => coords.get(atomId)).filter(Boolean);
    if (ringPositions.length >= 3) {
      return angleOf(sub(attachmentPosition, centroid(ringPositions)));
    }
  }
  const ringSystemPositions = ringSystem.atomIds.map(atomId => coords.get(atomId)).filter(Boolean);
  return ringSystemPositions.length >= 3 ? angleOf(sub(attachmentPosition, centroid(ringSystemPositions))) : null;
}

/**
 * Returns whether a detected ring linker is a short single-bond connector suited
 * to the dedicated mixed-family linker placement path.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {object} firstRingSystem - Already placed ring-system descriptor.
 * @param {object} secondRingSystem - Pending ring-system descriptor.
 * @param {object} linker - Linker descriptor.
 * @returns {boolean} True when the linker should use the dedicated short-linker path.
 */
function isSupportedRingLinker(layoutGraph, firstRingSystem, secondRingSystem, linker) {
  const ringSystemIsAromatic = ringSystem => (layoutGraph.rings ?? []).filter(ring => ringSystem.ringIds.includes(ring.id)).every(ring => ring.aromatic);
  const ringSystemSupportsShortLinkerRoot = (ringSystem, { allowFused = false } = {}) => {
    const family = classifyRingSystemFamily(layoutGraph, ringSystem);
    if (family === 'isolated-ring') {
      return ringSystemIsAromatic(ringSystem);
    }
    if (!allowFused || family !== 'fused' || !ringSystemIsAromatic(ringSystem)) {
      return false;
    }
    const connectionKinds = ringSystemConnectionKinds(layoutGraph, ringSystem);
    return connectionKinds.size > 0 && [...connectionKinds].every(kind => kind === 'fused');
  };
  if (!ringSystemSupportsShortLinkerRoot(firstRingSystem, { allowFused: true }) || !ringSystemSupportsShortLinkerRoot(secondRingSystem)) {
    return false;
  }

  const pathAtomIds = [linker.firstAttachmentAtomId, ...linker.chainAtomIds, linker.secondAttachmentAtomId];
  for (let index = 0; index < pathAtomIds.length - 1; index++) {
    const [a, b] = [pathAtomIds[index], pathAtomIds[index + 1]];
    const bond = layoutGraph.bondByAtomPair.get(a < b ? `${a}:${b}` : `${b}:${a}`) ?? null;
    if (!bond || bond.aromatic || (bond.order ?? 1) !== 1) {
      return false;
    }
  }

  for (const chainAtomId of linker.chainAtomIds) {
    const chainAtom = layoutGraph.sourceMolecule.atoms.get(chainAtomId);
    const heavyNeighborCount = chainAtom?.getNeighbors(layoutGraph.sourceMolecule).filter(neighborAtom => neighborAtom && neighborAtom.name !== 'H').length ?? 0;
    if (heavyNeighborCount !== 2) {
      return false;
    }
  }
  return true;
}

/**
 * Builds candidate coordinates for a short ring-to-ring linker plus the attached ring system.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Current coordinate map.
 * @param {object} firstRingSystem - Already placed ring-system descriptor.
 * @param {object} linker - Linker descriptor.
 * @param {object} secondRingSystem - Pending ring-system descriptor.
 * @param {Map<string, {x: number, y: number}>} blockCoords - Pending ring-system coordinates.
 * @param {number} bondLength - Target bond length.
 * @param {number} turnSign - Zigzag turn sign (`-1` or `1`).
 * @param {boolean} mirror - Whether to mirror the attached ring block.
 * @param {number} [ringRotationOffset] - Additional rotation offset (radians) applied to the ring block around the attachment bond.
 * @returns {Map<string, {x: number, y: number}>} Candidate linker plus ring coordinates.
 */
function buildRingLinkerCandidate(layoutGraph, coords, firstRingSystem, linker, secondRingSystem, blockCoords, bondLength, turnSign, mirror, ringRotationOffset = 0) {
  const firstAttachmentPosition = coords.get(linker.firstAttachmentAtomId);
  const exitAngle = ringLinkerExitAngle(layoutGraph, coords, firstRingSystem, linker.firstAttachmentAtomId);
  const fallbackRingCenter = centroid(firstRingSystem.atomIds.map(atomId => coords.get(atomId)).filter(Boolean));
  const resolvedExitAngle = exitAngle ?? angleOf(sub(firstAttachmentPosition, fallbackRingCenter));
  const segmentAngles = linkerSegmentAngles(resolvedExitAngle, linker.chainAtomIds.length + 1, turnSign);
  const candidateCoords = new Map();
  let currentPosition = firstAttachmentPosition;

  for (let index = 0; index < segmentAngles.length; index++) {
    currentPosition = add(currentPosition, fromAngle(segmentAngles[index], bondLength));
    if (index < linker.chainAtomIds.length) {
      candidateCoords.set(linker.chainAtomIds[index], currentPosition);
    }
  }

  const detachedAttachmentPosition = blockCoords.get(linker.secondAttachmentAtomId);
  const detachedRingCenter = centroid([...blockCoords.values()]);
  const detachedCentroidAngle =
    detachedAttachmentPosition && detachedRingCenter
      ? angleOf(sub(detachedRingCenter, detachedAttachmentPosition))
      : 0;
  const detachedExitAngle = ringLinkerExitAngle(layoutGraph, blockCoords, secondRingSystem, linker.secondAttachmentAtomId, { checkHeavyAtomLimit: true });
  const outwardAlignmentOffset = detachedExitAngle == null ? 0 : detachedCentroidAngle - detachedExitAngle;
  const transformedRingCoords = transformAttachedBlock(
    blockCoords,
    linker.secondAttachmentAtomId,
    currentPosition,
    segmentAngles[segmentAngles.length - 1] + outwardAlignmentOffset + ringRotationOffset,
    {
      mirror
    }
  );
  for (const [atomId, position] of transformedRingCoords) {
    candidateCoords.set(atomId, position);
  }
  return candidateCoords;
}

function normalizeRotationOffset(offset) {
  let normalizedOffset = offset;
  while (normalizedOffset <= -Math.PI) {
    normalizedOffset += 2 * Math.PI;
  }
  while (normalizedOffset > Math.PI) {
    normalizedOffset -= 2 * Math.PI;
  }
  return normalizedOffset;
}

function describeDirectAttachmentExteriorContinuationAnchor(layoutGraph, attachmentAtomId) {
  if (!layoutGraph) {
    return null;
  }

  const atom = layoutGraph.atoms.get(attachmentAtomId);
  if (!atom || atom.element === 'H' || atom.aromatic || atom.heavyDegree !== 4) {
    return null;
  }

  const anchorRings = layoutGraph.atomToRings.get(attachmentAtomId) ?? [];
  if (anchorRings.length !== 1) {
    return null;
  }
  const ring = anchorRings[0];
  if ((ring?.atomIds?.length ?? 0) < 3 || (ring?.atomIds?.length ?? 0) > 5) {
    return null;
  }

  const ringNeighborIds = [];
  const exocyclicNeighborIds = [];
  for (const bond of layoutGraph.bondsByAtomId.get(attachmentAtomId) ?? []) {
    if (!bond || bond.kind !== 'covalent' || bond.aromatic || (bond.order ?? 1) !== 1) {
      return null;
    }
    const neighborAtomId = bond.a === attachmentAtomId ? bond.b : bond.a;
    const neighborAtom = layoutGraph.atoms.get(neighborAtomId);
    if (!neighborAtom || neighborAtom.element === 'H') {
      continue;
    }
    if (ring.atomIds.includes(neighborAtomId)) {
      ringNeighborIds.push(neighborAtomId);
      continue;
    }
    exocyclicNeighborIds.push(neighborAtomId);
  }

  return ringNeighborIds.length === 2 && exocyclicNeighborIds.length === 2 ? { ringNeighborIds, exocyclicNeighborIds } : null;
}

function exactDirectAttachmentRingRotationOffsets(layoutGraph, blockCoords, attachmentAtomId) {
  const descriptor = describeDirectAttachmentExteriorContinuationAnchor(layoutGraph, attachmentAtomId);
  const attachmentPosition = blockCoords.get(attachmentAtomId);
  if (!descriptor || !attachmentPosition) {
    return [];
  }

  const ringNeighborAngles = descriptor.ringNeighborIds
    .filter(neighborAtomId => blockCoords.has(neighborAtomId))
    .map(neighborAtomId => angleOf(sub(blockCoords.get(neighborAtomId), attachmentPosition)));
  if (ringNeighborAngles.length !== 2) {
    return [];
  }

  const currentAngle = angleOf(sub(centroid([...blockCoords.values()]), attachmentPosition));
  const targetAngles = smallRingExteriorTargetAngles(ringNeighborAngles, (layoutGraph.atomToRings.get(attachmentAtomId) ?? [])[0]?.atomIds?.length ?? 0);
  const rotationOffsets = [];
  for (const targetAngle of targetAngles) {
    const offset = normalizeRotationOffset(currentAngle - targetAngle);
    if (!rotationOffsets.some(candidateOffset => angularDifference(candidateOffset, offset) <= 1e-9)) {
      rotationOffsets.push(offset);
    }
  }
  return rotationOffsets;
}

function exactDirectAttachmentParentOutwardRotationOffsets(layoutGraph, blockCoords, attachmentAtomId, detachedExitAngle) {
  if (!blockCoords.get(attachmentAtomId) || detachedExitAngle == null) {
    return [];
  }

  const rotationOffsets = [];
  for (const outwardAngle of directAttachmentLocalOutwardAngles(layoutGraph, blockCoords, attachmentAtomId)) {
    const offset = normalizeRotationOffset(Math.PI + detachedExitAngle - outwardAngle);
    if (!rotationOffsets.some(candidateOffset => angularDifference(candidateOffset, offset) <= 1e-9)) {
      rotationOffsets.push(offset);
    }
  }
  return rotationOffsets;
}

/**
 * Returns exact ring-rotation offsets that center a direct-attached parent bond
 * on the strict trigonal-bisector exit defined by the attached block itself.
 * This gives exocyclic alkene roots and similar ring trigonal centers one
 * precise rescue pose instead of relying only on the coarse default rotation
 * menu.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} blockCoords - Detached attached-block coordinates.
 * @param {string} attachmentAtomId - Attached-block root atom ID.
 * @param {string} parentAtomId - Already placed parent atom ID.
 * @param {number} outwardAlignmentOffset - Base outward-axis alignment offset.
 * @returns {number[]} Exact ring-rotation offsets in radians.
 */
function exactDirectAttachmentTrigonalBisectorRotationOffsets(layoutGraph, blockCoords, attachmentAtomId, parentAtomId, outwardAlignmentOffset) {
  const attachmentPosition = blockCoords.get(attachmentAtomId);
  if (!attachmentPosition) {
    return [];
  }
  if (!directAttachmentTrigonalBisectorSensitivityAtAnchor(layoutGraph, blockCoords, attachmentAtomId, parentAtomId).strict) {
    return [];
  }

  const neighborPositions = [];
  for (const bond of layoutGraph.bondsByAtomId.get(attachmentAtomId) ?? []) {
    if (!bond || bond.kind !== 'covalent') {
      continue;
    }
    const neighborAtomId = bond.a === attachmentAtomId ? bond.b : bond.a;
    const neighborAtom = layoutGraph.atoms.get(neighborAtomId);
    if (!neighborAtom || neighborAtom.element === 'H' || neighborAtomId === parentAtomId || !blockCoords.has(neighborAtomId)) {
      continue;
    }
    neighborPositions.push(blockCoords.get(neighborAtomId));
  }
  if (neighborPositions.length !== 2) {
    return [];
  }

  const idealParentAngle = angleOf(sub(attachmentPosition, centroid(neighborPositions)));
  return [normalizeRotationOffset(Math.PI - outwardAlignmentOffset - idealParentAngle)];
}

function measureDirectAttachmentExteriorContinuationPenalty(layoutGraph, coords, candidateMeta = null) {
  const parentAtomId = candidateMeta?.parentAtomId ?? null;
  const attachmentAtomId = candidateMeta?.attachmentAtomId ?? null;
  const descriptor = describeDirectAttachmentExteriorContinuationAnchor(layoutGraph, attachmentAtomId);
  if (!descriptor || !parentAtomId || !coords.has(parentAtomId) || !coords.has(attachmentAtomId)) {
    return 0;
  }

  const attachmentPosition = coords.get(attachmentAtomId);
  const ringNeighborAngles = descriptor.ringNeighborIds
    .filter(neighborAtomId => coords.has(neighborAtomId))
    .map(neighborAtomId => angleOf(sub(coords.get(neighborAtomId), attachmentPosition)));
  if (ringNeighborAngles.length !== 2) {
    return 0;
  }

  const targetAngles = smallRingExteriorTargetAngles(ringNeighborAngles, (layoutGraph.atomToRings.get(attachmentAtomId) ?? [])[0]?.atomIds?.length ?? 0);
  const parentAngle = angleOf(sub(coords.get(parentAtomId), attachmentPosition));
  return Math.min(...targetAngles.map(targetAngle => angularDifference(parentAngle, targetAngle) ** 2));
}

function measureDirectAttachmentParentOutwardPenalty(layoutGraph, coords, candidateMeta = null) {
  const parentAtomId = candidateMeta?.parentAtomId ?? null;
  const attachmentAtomId = candidateMeta?.attachmentAtomId ?? null;
  if (!parentAtomId || !attachmentAtomId || !coords.has(parentAtomId) || !coords.has(attachmentAtomId)) {
    return 0;
  }

  const computePenaltyAtAnchor = (anchorAtomId, otherAtomId) => {
    const anchorRings = layoutGraph.atomToRings.get(anchorAtomId) ?? [];
    if (anchorRings.length === 0) {
      return 0;
    }

    const incidentRingAtomIds = new Set(anchorRings.flatMap(ring => ring.atomIds));
    const heavyExocyclicNeighborIds = [];
    for (const bond of layoutGraph.bondsByAtomId.get(anchorAtomId) ?? []) {
      if (!bond || bond.kind !== 'covalent') {
        continue;
      }
      const neighborAtomId = bond.a === anchorAtomId ? bond.b : bond.a;
      const neighborAtom = layoutGraph.atoms.get(neighborAtomId);
      if (!neighborAtom || neighborAtom.element === 'H' || incidentRingAtomIds.has(neighborAtomId)) {
        continue;
      }
      heavyExocyclicNeighborIds.push(neighborAtomId);
    }
    if (heavyExocyclicNeighborIds.length !== 1 || heavyExocyclicNeighborIds[0] !== otherAtomId) {
      return 0;
    }

    const anchorPosition = coords.get(anchorAtomId);
    const outwardAngles = [
      ...directAttachmentLocalOutwardAngles(layoutGraph, coords, anchorAtomId, otherAtomId),
      ...incidentRingOutwardAngles(layoutGraph, coords, anchorAtomId)
    ].filter((outwardAngle, index, angles) =>
      angles.findIndex(existingAngle => angularDifference(existingAngle, outwardAngle) <= 1e-9) === index
    );
    if (outwardAngles.length === 0) {
      return 0;
    }

    const otherAngle = angleOf(sub(coords.get(otherAtomId), anchorPosition));
    return Math.min(...outwardAngles.map(outwardAngle => angularDifference(otherAngle, outwardAngle) ** 2));
  };

  return computePenaltyAtAnchor(parentAtomId, attachmentAtomId) + computePenaltyAtAnchor(attachmentAtomId, parentAtomId);
}

/**
 * Penalizes directly attached ring candidates that pull a safe fused-junction
 * attachment off the exact continuation of the shared junction bond.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Candidate coordinate map.
 * @param {{parentAtomId?: string, attachmentAtomId?: string}|null} [candidateMeta] - Optional candidate attachment metadata.
 * @returns {number} Fused-junction continuation penalty.
 */
function measureDirectAttachmentFusedJunctionContinuationPenalty(layoutGraph, coords, candidateMeta = null) {
  const parentAtomId = candidateMeta?.parentAtomId ?? null;
  const attachmentAtomId = candidateMeta?.attachmentAtomId ?? null;
  if (!parentAtomId || !attachmentAtomId || !coords.has(parentAtomId) || !coords.has(attachmentAtomId)) {
    return 0;
  }

  const preferredAngle = directAttachedForeignRingJunctionContinuationAngle(layoutGraph, coords, parentAtomId, attachmentAtomId);
  if (preferredAngle == null) {
    return 0;
  }

  const attachmentAngle = angleOf(sub(coords.get(attachmentAtomId), coords.get(parentAtomId)));
  return angularDifference(attachmentAngle, preferredAngle) ** 2;
}

/**
 * Penalizes directly attached ring candidates that pull a precise divalent
 * linker off its ideal 120-degree continuation. This is the non-ring analogue
 * of the ring-outward parent penalty above: amides and similar conjugated
 * divalent linkers should keep their attached ring close to the exact
 * continuation slot when an overlap-free pose exists.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Candidate coordinate map.
 * @param {{parentAtomId?: string, attachmentAtomId?: string}|null} [candidateMeta] - Optional candidate attachment metadata.
 * @returns {number} Exact-continuation penalty.
 */
function measureDirectAttachmentExactContinuationPenalty(layoutGraph, coords, candidateMeta = null) {
  const parentAtomId = candidateMeta?.parentAtomId ?? null;
  const attachmentAtomId = candidateMeta?.attachmentAtomId ?? null;
  if (!parentAtomId || !attachmentAtomId || !coords.has(parentAtomId) || !coords.has(attachmentAtomId)) {
    return 0;
  }

  const placedHeavyNeighborIds = [];
  for (const bond of layoutGraph.bondsByAtomId.get(parentAtomId) ?? []) {
    if (!bond || bond.kind !== 'covalent') {
      continue;
    }
    const neighborAtomId = bond.a === parentAtomId ? bond.b : bond.a;
    if (neighborAtomId === attachmentAtomId) {
      continue;
    }
    const neighborAtom = layoutGraph.atoms.get(neighborAtomId);
    if (!neighborAtom || neighborAtom.element === 'H' || !coords.has(neighborAtomId)) {
      continue;
    }
    placedHeavyNeighborIds.push(neighborAtomId);
  }
  if (placedHeavyNeighborIds.length !== 1) {
    return 0;
  }

  const continuationParentAtomId = placedHeavyNeighborIds[0];
  if (!isExactSimpleAcyclicContinuationEligible(layoutGraph, parentAtomId, continuationParentAtomId, attachmentAtomId)) {
    return 0;
  }

  const parentAngle = angleOf(sub(coords.get(continuationParentAtomId), coords.get(parentAtomId)));
  const attachmentAngle = angleOf(sub(coords.get(attachmentAtomId), coords.get(parentAtomId)));
  return (angularDifference(parentAngle, attachmentAngle) - (2 * Math.PI) / 3) ** 2;
}

/**
 * Returns whether a direct-attached ring candidate should prioritise the
 * parent-side exact continuation ahead of a perfect child ring-outward exit.
 * Benzylic and similar methylene linkers read poorly when they flatten toward
 * 150 degrees just to keep the attached ring root exact.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {{parentAtomId?: string, attachmentAtomId?: string}|null} [candidateMeta] - Optional candidate attachment metadata.
 * @returns {boolean} True when the parent linker continuation should outrank child-root outward tie-breaks.
 */
function shouldPrioritizeDirectAttachmentExactContinuation(layoutGraph, candidateMeta = null) {
  return directAttachmentContinuationParentAtomId(layoutGraph, candidateMeta) != null;
}

/**
 * Returns the already placed heavy neighbor that defines the parent-side exact
 * continuation for a direct-attached ring candidate, or `null` when no such
 * continuation applies.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {{parentAtomId?: string, attachmentAtomId?: string}|null} [candidateMeta] - Optional candidate attachment metadata.
 * @returns {string|null} Continuation parent atom ID.
 */
function directAttachmentContinuationParentAtomId(layoutGraph, candidateMeta = null) {
  const parentAtomId = candidateMeta?.parentAtomId ?? null;
  const attachmentAtomId = candidateMeta?.attachmentAtomId ?? null;
  if (!parentAtomId || !attachmentAtomId) {
    return null;
  }

  const parentAtom = layoutGraph.atoms.get(parentAtomId);
  if (
    !parentAtom
    || parentAtom.element !== 'C'
    || parentAtom.aromatic
    || parentAtom.heavyDegree !== 2
    || (layoutGraph.atomToRings.get(parentAtomId)?.length ?? 0) > 0
  ) {
    return null;
  }

  const placedHeavyNeighborIds = [];
  for (const bond of layoutGraph.bondsByAtomId.get(parentAtomId) ?? []) {
    if (!bond || bond.kind !== 'covalent') {
      continue;
    }
    const neighborAtomId = bond.a === parentAtomId ? bond.b : bond.a;
    const neighborAtom = layoutGraph.atoms.get(neighborAtomId);
    if (!neighborAtom || neighborAtom.element === 'H') {
      continue;
    }
    placedHeavyNeighborIds.push(neighborAtomId);
  }
  if (placedHeavyNeighborIds.length !== 2) {
    return null;
  }

  const continuationParentAtomId = placedHeavyNeighborIds.find(neighborAtomId => neighborAtomId !== attachmentAtomId) ?? null;
  if (!continuationParentAtomId) {
    return null;
  }

  return isExactSimpleAcyclicContinuationEligible(layoutGraph, parentAtomId, continuationParentAtomId, attachmentAtomId)
    ? continuationParentAtomId
    : null;
}

function exactDirectAttachmentContinuationAngles(layoutGraph, coords, candidateMeta = null) {
  const parentAtomId = candidateMeta?.parentAtomId ?? null;
  const attachmentAtomId = candidateMeta?.attachmentAtomId ?? null;
  const continuationParentAtomId = directAttachmentContinuationParentAtomId(layoutGraph, candidateMeta);
  if (!parentAtomId || !attachmentAtomId || !continuationParentAtomId) {
    return [];
  }
  if (!coords.has(parentAtomId) || !coords.has(continuationParentAtomId)) {
    return [];
  }

  const parentAtom = layoutGraph.atoms.get(parentAtomId);
  if (
    !parentAtom
    || parentAtom.element !== 'C'
    || parentAtom.aromatic
    || parentAtom.heavyDegree !== 2
    || parentAtom.degree !== 3
  ) {
    return [];
  }

  const continuationBond = findLayoutBond(layoutGraph, parentAtomId, continuationParentAtomId);
  const attachmentBond = findLayoutBond(layoutGraph, parentAtomId, attachmentAtomId);
  if (
    !continuationBond
    || !attachmentBond
    || continuationBond.kind !== 'covalent'
    || attachmentBond.kind !== 'covalent'
    || continuationBond.aromatic
    || attachmentBond.aromatic
  ) {
    return [];
  }

  const continuationOrder = continuationBond.order ?? 1;
  const attachmentOrder = attachmentBond.order ?? 1;
  if (!(
    (continuationOrder === 1 && attachmentOrder >= 2)
    || (continuationOrder >= 2 && attachmentOrder === 1)
  )) {
    return [];
  }

  const parentPosition = coords.get(parentAtomId);
  const continuationAngle = angleOf(sub(coords.get(continuationParentAtomId), parentPosition));
  return [
    continuationAngle + EXACT_TRIGONAL_CONTINUATION_ANGLE,
    continuationAngle - EXACT_TRIGONAL_CONTINUATION_ANGLE
  ];
}

/**
 * Returns whether an anchor participates in a direct-attachment trigonal-bisector
 * preference, and whether that preference is strict or may bend slightly to
 * recover a cleaner attached-ring presentation.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Candidate coordinate map.
 * @param {string} anchorAtomId - Potential trigonal-bisector anchor atom ID.
 * @param {string} otherAtomId - Attached-block atom on the opposite side of the bond.
 * @returns {{eligible: boolean, strict: boolean, omittedHydrogen: boolean}} Sensitivity summary.
 */
function directAttachmentTrigonalBisectorSensitivityAtAnchor(layoutGraph, coords, anchorAtomId, otherAtomId) {
  if (!coords.has(anchorAtomId)) {
    return { eligible: false, strict: false, omittedHydrogen: false };
  }
  const anchorAtom = layoutGraph.atoms.get(anchorAtomId);
  if (!anchorAtom || anchorAtom.aromatic || anchorAtom.heavyDegree !== 3) {
    return { eligible: false, strict: false, omittedHydrogen: false };
  }
  const anchorRingCount = layoutGraph.atomToRings.get(anchorAtomId)?.length ?? 0;
  if (anchorRingCount > 0) {
    const strict = isExactRingTrigonalBisectorEligible(layoutGraph, anchorAtomId, otherAtomId);
    return { eligible: strict, strict, omittedHydrogen: false };
  }
  let nonAromaticMultipleBondCount = 0;
  let ringNeighborCount = 0;
  let qualifyingNeighborCount = 0;
  for (const bond of layoutGraph.bondsByAtomId.get(anchorAtomId) ?? []) {
    if (!bond || bond.kind !== 'covalent') {
      continue;
    }
    const neighborAtomId = bond.a === anchorAtomId ? bond.b : bond.a;
    const neighborAtom = layoutGraph.atoms.get(neighborAtomId);
    if (!neighborAtom || neighborAtom.element === 'H') {
      continue;
    }
    if (!bond.aromatic && (bond.order ?? 1) >= 2) {
      nonAromaticMultipleBondCount++;
    }
    if ((layoutGraph.atomToRings.get(neighborAtomId)?.length ?? 0) > 0) {
      ringNeighborCount++;
    }
    if (neighborAtomId !== otherAtomId && coords.has(neighborAtomId)) {
      qualifyingNeighborCount++;
    }
  }
  const strict = nonAromaticMultipleBondCount === 1 && qualifyingNeighborCount === 2;
  const omittedHydrogen =
    anchorAtom.degree === 4
    && ringNeighborCount >= 1
    && nonAromaticMultipleBondCount === 0
    && qualifyingNeighborCount === 2;
  return {
    eligible: strict || omittedHydrogen,
    strict,
    omittedHydrogen
  };
}

function isTrigonalBisectorEligibleAtAnchor(layoutGraph, coords, anchorAtomId, otherAtomId) {
  return directAttachmentTrigonalBisectorSensitivityAtAnchor(layoutGraph, coords, anchorAtomId, otherAtomId).eligible;
}

function summarizeDirectAttachmentTrigonalBisectorSensitivity(layoutGraph, coords, parentAtomId, attachmentAtomId) {
  if ((layoutGraph.traits.heavyAtomCount ?? 0) > EXACT_ATTACHMENT_SEARCH_HEAVY_ATOM_LIMIT) {
    return { eligible: false, strict: false, omittedHydrogen: false };
  }
  const parentSensitivity = !parentAtomId || !attachmentAtomId || !coords.has(parentAtomId)
    ? { eligible: false, strict: false, omittedHydrogen: false }
    : directAttachmentTrigonalBisectorSensitivityAtAnchor(layoutGraph, coords, parentAtomId, attachmentAtomId);
  const attachmentSensitivity = !parentAtomId || !attachmentAtomId || !coords.has(attachmentAtomId)
    ? { eligible: false, strict: false, omittedHydrogen: false }
    : directAttachmentTrigonalBisectorSensitivityAtAnchor(layoutGraph, coords, attachmentAtomId, parentAtomId);
  return {
    eligible: parentSensitivity.eligible || attachmentSensitivity.eligible,
    strict: parentSensitivity.strict || attachmentSensitivity.strict,
    omittedHydrogen: parentSensitivity.omittedHydrogen || attachmentSensitivity.omittedHydrogen
  };
}

function measureDirectAttachmentTrigonalBisectorPenalty(layoutGraph, coords, candidateMeta = null) {
  const parentAtomId = candidateMeta?.parentAtomId ?? null;
  const attachmentAtomId = candidateMeta?.attachmentAtomId ?? null;
  if ((layoutGraph.traits.heavyAtomCount ?? 0) > EXACT_ATTACHMENT_SEARCH_HEAVY_ATOM_LIMIT) {
    return 0;
  }
  if (!parentAtomId || !attachmentAtomId || !coords.has(parentAtomId) || !coords.has(attachmentAtomId)) {
    return 0;
  }

  const computePenaltyAtAnchor = (anchorAtomId, otherAtomId) => {
    if (!isTrigonalBisectorEligibleAtAnchor(layoutGraph, coords, anchorAtomId, otherAtomId)) {
      return 0;
    }
    const otherHeavyNeighborIds = [];
    for (const bond of layoutGraph.bondsByAtomId.get(anchorAtomId) ?? []) {
      if (!bond || bond.kind !== 'covalent') {
        continue;
      }
      const neighborAtomId = bond.a === anchorAtomId ? bond.b : bond.a;
      const neighborAtom = layoutGraph.atoms.get(neighborAtomId);
      if (!neighborAtom || neighborAtom.element === 'H' || neighborAtomId === otherAtomId || !coords.has(neighborAtomId)) {
        continue;
      }
      otherHeavyNeighborIds.push(neighborAtomId);
    }
    if (otherHeavyNeighborIds.length !== 2) {
      return 0;
    }
    const anchorPosition = coords.get(anchorAtomId);
    const idealAngle = angleOf(sub(anchorPosition, centroid(otherHeavyNeighborIds.map(neighborAtomId => coords.get(neighborAtomId)))));
    const attachmentAngle = angleOf(sub(coords.get(otherAtomId), anchorPosition));
    return angularDifference(attachmentAngle, idealAngle) ** 2;
  };

  return computePenaltyAtAnchor(parentAtomId, attachmentAtomId) + computePenaltyAtAnchor(attachmentAtomId, parentAtomId);
}

/**
 * Builds a small local refinement menu around an already selected direct-attached
 * ring-block pose. This lets omitted-h trigonal parents give back a small amount
 * of exact bisector alignment when that recovers a cleaner ring exit without
 * reopening overlaps.
 * @param {Map<string, {x: number, y: number}>} transformedCoords - Selected attached-block coordinates.
 * @param {{x: number, y: number}} parentPosition - Fixed parent atom position.
 * @param {string} attachmentAtomId - Attached-block root atom ID.
 * @param {number} bondLength - Target bond length.
 * @returns {Array<{attachmentAngleOffset: number, ringRotationOffset: number, transformedCoords: Map<string, {x: number, y: number}>}>} Local refinement candidates.
 */
function buildLocalDirectAttachmentRefinementCandidates(transformedCoords, parentPosition, attachmentAtomId, bondLength) {
  const attachmentPosition = transformedCoords.get(attachmentAtomId);
  if (!attachmentPosition || !parentPosition) {
    return [];
  }

  const baseAttachmentAngle = angleOf(sub(attachmentPosition, parentPosition));
  const candidates = [];
  for (const attachmentAngleOffset of DIRECT_ATTACHMENT_FINE_ANGLE_OFFSETS) {
    const targetAttachmentPosition = add(parentPosition, fromAngle(baseAttachmentAngle + attachmentAngleOffset, bondLength));
    for (const ringRotationOffset of DIRECT_ATTACHMENT_LOCAL_REFINEMENT_RING_ROTATION_OFFSETS) {
      const nextCoords = new Map();
      for (const [atomId, position] of transformedCoords) {
        if (atomId === attachmentAtomId) {
          nextCoords.set(atomId, targetAttachmentPosition);
          continue;
        }
        const shiftedPosition = sub(position, attachmentPosition);
        nextCoords.set(
          atomId,
          add(targetAttachmentPosition, rotate(shiftedPosition, attachmentAngleOffset + ringRotationOffset))
        );
      }
      candidates.push({
        attachmentAngleOffset,
        ringRotationOffset,
        transformedCoords: nextCoords
      });
    }
  }
  return candidates;
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

function isExactVisibleTrigonalContinuationEligible(layoutGraph, anchorAtomId, continuationParentAtomId, childAtomId) {
  if (!isExactSimpleAcyclicContinuationEligible(layoutGraph, anchorAtomId, continuationParentAtomId, childAtomId)) {
    return false;
  }

  const anchorAtom = layoutGraph.atoms.get(anchorAtomId);
  if (
    !anchorAtom
    || anchorAtom.element !== 'C'
    || anchorAtom.aromatic
    || anchorAtom.heavyDegree !== 2
    || anchorAtom.degree !== 3
  ) {
    return false;
  }

  const continuationBond = findLayoutBond(layoutGraph, anchorAtomId, continuationParentAtomId);
  const childBond = findLayoutBond(layoutGraph, anchorAtomId, childAtomId);
  if (
    !continuationBond
    || !childBond
    || continuationBond.kind !== 'covalent'
    || childBond.kind !== 'covalent'
    || continuationBond.aromatic
    || childBond.aromatic
  ) {
    return false;
  }

  const continuationOrder = continuationBond.order ?? 1;
  const childOrder = childBond.order ?? 1;
  return (
    (continuationOrder === 1 && childOrder >= 2)
    || (continuationOrder >= 2 && childOrder === 1)
  );
}

function buildExactVisibleTrigonalContinuationCandidates(layoutGraph, coords, anchorAtomId, continuationParentAtomId, childAtomId) {
  if (
    !coords.has(anchorAtomId)
    || !coords.has(continuationParentAtomId)
    || !coords.has(childAtomId)
    || !isExactVisibleTrigonalContinuationEligible(layoutGraph, anchorAtomId, continuationParentAtomId, childAtomId)
  ) {
    return [];
  }

  const subtreeAtomIds = collectCovalentSubtreeAtomIds(layoutGraph, childAtomId, anchorAtomId)
    .filter(atomId => atomId !== anchorAtomId && coords.has(atomId));
  if (subtreeAtomIds.length === 0) {
    return [];
  }

  const anchorPosition = coords.get(anchorAtomId);
  const currentChildAngle = angleOf(sub(coords.get(childAtomId), anchorPosition));
  const continuationAngle = angleOf(sub(coords.get(continuationParentAtomId), anchorPosition));
  const targetChildAngles = [
    continuationAngle + EXACT_TRIGONAL_CONTINUATION_ANGLE,
    continuationAngle - EXACT_TRIGONAL_CONTINUATION_ANGLE
  ];

  return targetChildAngles.flatMap(targetChildAngle => {
    const rotationAngle = wrapAngle(targetChildAngle - currentChildAngle);
    if (Math.abs(rotationAngle) <= 1e-9) {
      return [];
    }
    const transformedCoords = new Map();
    for (const atomId of subtreeAtomIds) {
      transformedCoords.set(atomId, add(anchorPosition, rotate(sub(coords.get(atomId), anchorPosition), rotationAngle)));
    }
    return [{
      transformedCoords,
      meta: {
        attachmentAtomId: childAtomId,
        parentAtomId: anchorAtomId,
        exactVisibleTrigonalContinuation: true,
        targetChildAngle
      }
    }];
  });
}

function snapExactVisibleTrigonalContinuations(layoutGraph, coords, participantAtomIds, bondLength) {
  const anchorAtomIds = [...participantAtomIds]
    .filter(atomId => coords.has(atomId))
    .sort((firstAtomId, secondAtomId) => compareCanonicalIds(firstAtomId, secondAtomId, layoutGraph.canonicalAtomRank));

  for (const anchorAtomId of anchorAtomIds) {
    const heavyNeighborIds = [];
    for (const bond of layoutGraph.bondsByAtomId.get(anchorAtomId) ?? []) {
      if (!bond || bond.kind !== 'covalent') {
        continue;
      }
      const neighborAtomId = bond.a === anchorAtomId ? bond.b : bond.a;
      const neighborAtom = layoutGraph.atoms.get(neighborAtomId);
      if (!neighborAtom || neighborAtom.element === 'H' || !coords.has(neighborAtomId)) {
        continue;
      }
      heavyNeighborIds.push(neighborAtomId);
    }
    if (heavyNeighborIds.length !== 2) {
      continue;
    }

    let bestCoords = coords;
    let bestScore = null;
    for (const [continuationParentAtomId, childAtomId] of [
      [heavyNeighborIds[0], heavyNeighborIds[1]],
      [heavyNeighborIds[1], heavyNeighborIds[0]]
    ]) {
      if (!isExactVisibleTrigonalContinuationEligible(layoutGraph, anchorAtomId, continuationParentAtomId, childAtomId)) {
        continue;
      }
      const candidateMeta = {
        attachmentAtomId: childAtomId,
        parentAtomId: anchorAtomId
      };
      const baseScore = measureAttachedBlockCandidateState(coords, coords, bondLength, layoutGraph, candidateMeta);
      if (baseScore.exactContinuationPenalty <= IMPROVEMENT_EPSILON) {
        continue;
      }
      if (!bestScore) {
        bestScore = baseScore;
      }

      const candidates = buildExactVisibleTrigonalContinuationCandidates(
        layoutGraph,
        coords,
        anchorAtomId,
        continuationParentAtomId,
        childAtomId
      );
      for (const candidate of candidates) {
        const candidateCoords = new Map(coords);
        for (const [atomId, position] of candidate.transformedCoords) {
          candidateCoords.set(atomId, position);
        }
        const candidateScore = measureAttachedBlockCandidateState(coords, candidateCoords, bondLength, layoutGraph, candidate.meta);
        let shouldReplaceBestCandidate =
          candidateScore.overlapCount === bestScore.overlapCount
          && candidateScore.readability.failingSubstituentCount === bestScore.readability.failingSubstituentCount
          && candidateScore.exactContinuationPenalty <= IMPROVEMENT_EPSILON
          && bestScore.exactContinuationPenalty > IMPROVEMENT_EPSILON;
        const comparison = compareAttachedBlockScores(candidateScore, bestScore);
        if (!shouldReplaceBestCandidate) {
          shouldReplaceBestCandidate = comparison < 0;
        }
        if (!shouldReplaceBestCandidate && comparison === 0) {
          ensureAttachedBlockLayoutCost(candidateScore, candidateCoords, layoutGraph, bondLength);
          ensureAttachedBlockLayoutCost(bestScore, bestCoords, layoutGraph, bondLength);
          if (candidateScore.totalCost < bestScore.totalCost - IMPROVEMENT_EPSILON) {
            shouldReplaceBestCandidate = true;
          } else if (
            Math.abs(candidateScore.totalCost - bestScore.totalCost) <= IMPROVEMENT_EPSILON
            && compareCoordMapsDeterministically(candidateCoords, bestCoords, layoutGraph.canonicalAtomRank) < 0
          ) {
            shouldReplaceBestCandidate = true;
          }
        }
        if (shouldReplaceBestCandidate) {
          bestCoords = candidateCoords;
          bestScore = candidateScore;
        }
      }
    }

    if (bestCoords !== coords) {
      coords.clear();
      for (const [atomId, position] of bestCoords) {
        coords.set(atomId, position);
      }
    }
  }
}

/**
 * Builds exact-continuation rescue candidates for direct-attached ring blocks
 * whose benzylic-style parent linker is already placed but too flat. The
 * parent atom and the whole attached block move together around the already
 * placed continuation parent so the linker can recover its exact 120-degree
 * bend without sacrificing the child block's internal orientation.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Current coordinate map.
 * @param {Map<string, {x: number, y: number}>} transformedCoords - Current attached-block coordinates.
 * @param {{parentAtomId?: string, attachmentAtomId?: string}|null} [candidateMeta] - Optional candidate attachment metadata.
 * @param {number} bondLength - Target bond length.
 * @returns {Array<{transformedCoords: Map<string, {x: number, y: number}>, meta: object}>} Parent-linker rescue candidates.
 */
function buildDirectAttachmentExactContinuationRescueCandidates(layoutGraph, coords, transformedCoords, candidateMeta = null, bondLength) {
  const parentAtomId = candidateMeta?.parentAtomId ?? null;
  const attachmentAtomId = candidateMeta?.attachmentAtomId ?? null;
  const continuationParentAtomId = directAttachmentContinuationParentAtomId(layoutGraph, candidateMeta);
  if (!parentAtomId || !attachmentAtomId || !continuationParentAtomId || !coords.has(parentAtomId) || !coords.has(continuationParentAtomId)) {
    return [];
  }

  const attachmentPosition = transformedCoords.get(attachmentAtomId) ?? coords.get(attachmentAtomId);
  if (!attachmentPosition) {
    return [];
  }

  const continuationParentPosition = coords.get(continuationParentAtomId);
  const parentPosition = coords.get(parentAtomId);
  const attachmentAngle = angleOf(sub(attachmentPosition, parentPosition));
  const subtreeAtomIds = collectCovalentSubtreeAtomIds(layoutGraph, parentAtomId, continuationParentAtomId)
    .filter(atomId => atomId === parentAtomId || transformedCoords.has(atomId) || coords.has(atomId));
  if (subtreeAtomIds.length === 0) {
    return [];
  }

  const rescueCandidates = [];
  for (const targetParentAngle of [attachmentAngle - LINKER_ZIGZAG_TURN_ANGLE, attachmentAngle + LINKER_ZIGZAG_TURN_ANGLE]) {
    const targetParentPosition = add(continuationParentPosition, fromAngle(targetParentAngle, bondLength));
    const delta = sub(targetParentPosition, parentPosition);
    if (Math.hypot(delta.x, delta.y) <= IMPROVEMENT_EPSILON) {
      continue;
    }

    const nextCoords = new Map();
    for (const atomId of subtreeAtomIds) {
      const currentPosition = transformedCoords.get(atomId) ?? coords.get(atomId);
      if (!currentPosition) {
        continue;
      }
      nextCoords.set(atomId, add(currentPosition, delta));
    }
    rescueCandidates.push({
      transformedCoords: nextCoords,
      meta: {
        ...candidateMeta,
        exactContinuationRescue: true,
        targetParentAngle
      }
    });
  }

  return rescueCandidates;
}

/**
 * Builds exact child-side trigonal-bisector rescue poses for one direct-attached
 * ring block by rotating the attached block around its fixed root atom. This
 * is narrower than the general rotation search and is only used after the main
 * candidate search still leaves a strict ring trigonal exit visibly skewed.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Current coordinate map.
 * @param {Map<string, {x: number, y: number}>} transformedCoords - Current attached-block coordinates.
 * @param {{parentAtomId?: string, attachmentAtomId?: string}|null} [candidateMeta] - Optional candidate metadata.
 * @returns {Array<{transformedCoords: Map<string, {x: number, y: number}>, meta: object}>} Exact trigonal rescue candidates.
 */
function buildDirectAttachmentExactTrigonalBisectorRescueCandidates(layoutGraph, coords, transformedCoords, candidateMeta = null) {
  const parentAtomId = candidateMeta?.parentAtomId ?? null;
  const attachmentAtomId = candidateMeta?.attachmentAtomId ?? null;
  if (!parentAtomId || !attachmentAtomId || !coords.has(parentAtomId) || !transformedCoords.has(attachmentAtomId)) {
    return [];
  }

  const candidateCoords = new Map(coords);
  for (const [atomId, position] of transformedCoords) {
    candidateCoords.set(atomId, position);
  }
  if (!directAttachmentTrigonalBisectorSensitivityAtAnchor(layoutGraph, candidateCoords, attachmentAtomId, parentAtomId).strict) {
    return [];
  }

  const attachmentPosition = candidateCoords.get(attachmentAtomId);
  const internalNeighborIds = [];
  for (const bond of layoutGraph.bondsByAtomId.get(attachmentAtomId) ?? []) {
    if (!bond || bond.kind !== 'covalent') {
      continue;
    }
    const neighborAtomId = bond.a === attachmentAtomId ? bond.b : bond.a;
    const neighborAtom = layoutGraph.atoms.get(neighborAtomId);
    if (!neighborAtom || neighborAtom.element === 'H' || neighborAtomId === parentAtomId || !candidateCoords.has(neighborAtomId)) {
      continue;
    }
    internalNeighborIds.push(neighborAtomId);
  }
  if (internalNeighborIds.length !== 2) {
    return [];
  }

  const idealParentAngle = angleOf(sub(
    attachmentPosition,
    centroid(internalNeighborIds.map(neighborAtomId => candidateCoords.get(neighborAtomId)))
  ));
  const currentParentAngle = angleOf(sub(candidateCoords.get(parentAtomId), attachmentPosition));
  const rotationAngle = wrapAngle(currentParentAngle - idealParentAngle);
  if (Math.abs(rotationAngle) <= 1e-9) {
    return [];
  }

  const rotatedAtomIds = collectCovalentSubtreeAtomIds(layoutGraph, attachmentAtomId, parentAtomId)
    .filter(atomId => atomId === attachmentAtomId || transformedCoords.has(atomId));
  if (rotatedAtomIds.length === 0) {
    return [];
  }

  const nextCoords = new Map(transformedCoords);
  for (const atomId of rotatedAtomIds) {
    if (atomId === attachmentAtomId) {
      nextCoords.set(atomId, attachmentPosition);
      continue;
    }
    const currentPosition = transformedCoords.get(atomId);
    if (!currentPosition) {
      continue;
    }
    nextCoords.set(
      atomId,
      add(attachmentPosition, rotate(sub(currentPosition, attachmentPosition), rotationAngle))
    );
  }

  return [{
    transformedCoords: nextCoords,
    meta: {
      ...candidateMeta,
      exactTrigonalBisectorRescue: true,
      rotationAngle
    }
  }];
}

function reflectPointAcrossAxis(point, origin, axisUnit) {
  const relativePoint = sub(point, origin);
  const projectedLength = relativePoint.x * axisUnit.x + relativePoint.y * axisUnit.y;
  const projectedPoint = {
    x: axisUnit.x * projectedLength,
    y: axisUnit.y * projectedLength
  };
  const perpendicularPoint = {
    x: relativePoint.x - projectedPoint.x,
    y: relativePoint.y - projectedPoint.y
  };
  return {
    x: origin.x + projectedPoint.x - perpendicularPoint.x,
    y: origin.y + projectedPoint.y - perpendicularPoint.y
  };
}

function buildMirroredParentSideSubtreeCandidates(layoutGraph, coords, transformedCoords, candidateMeta = null) {
  const parentAtomId = candidateMeta?.parentAtomId ?? null;
  const attachmentAtomId = candidateMeta?.attachmentAtomId ?? null;
  if (!parentAtomId || !attachmentAtomId) {
    return [];
  }

  const candidateCoords = new Map(coords);
  for (const [atomId, position] of transformedCoords) {
    candidateCoords.set(atomId, position);
  }

  const candidates = [];
  for (const bond of layoutGraph.bondsByAtomId.get(parentAtomId) ?? []) {
    if (!bond || bond.kind !== 'covalent') {
      continue;
    }
    const anchorAtomId = bond.a === parentAtomId ? bond.b : bond.a;
    const anchorAtom = layoutGraph.atoms.get(anchorAtomId);
    if (
      !anchorAtom
      || anchorAtom.element === 'H'
      || anchorAtomId === attachmentAtomId
      || anchorAtom.chirality
      || !candidateCoords.has(anchorAtomId)
    ) {
      continue;
    }

    for (const anchorBond of layoutGraph.bondsByAtomId.get(anchorAtomId) ?? []) {
      if (!anchorBond || anchorBond.kind !== 'covalent') {
        continue;
      }
      const rootAtomId = anchorBond.a === anchorAtomId ? anchorBond.b : anchorBond.a;
      const rootAtom = layoutGraph.atoms.get(rootAtomId);
      if (
        !rootAtom
        || rootAtom.element === 'H'
        || rootAtomId === parentAtomId
        || rootAtom.chirality
        || !candidateCoords.has(rootAtomId)
      ) {
        continue;
      }

      const subtreeAtomIds = collectCovalentSubtreeAtomIds(layoutGraph, rootAtomId, anchorAtomId);
      if (subtreeAtomIds.some(atomId => layoutGraph.atoms.get(atomId)?.chirality)) {
        continue;
      }
      const placedSubtreeAtomIds = subtreeAtomIds.filter(atomId => candidateCoords.has(atomId));
      if (placedSubtreeAtomIds.length === 0) {
        continue;
      }

      const axisVector = sub(candidateCoords.get(rootAtomId), candidateCoords.get(anchorAtomId));
      const axisLength = Math.hypot(axisVector.x, axisVector.y);
      if (axisLength <= IMPROVEMENT_EPSILON) {
        continue;
      }
      const axisUnit = {
        x: axisVector.x / axisLength,
        y: axisVector.y / axisLength
      };

      const mirroredCoords = new Map(transformedCoords);
      for (const atomId of placedSubtreeAtomIds) {
        mirroredCoords.set(
          atomId,
          reflectPointAcrossAxis(candidateCoords.get(atomId), candidateCoords.get(anchorAtomId), axisUnit)
        );
      }
      candidates.push({
        transformedCoords: mirroredCoords,
        meta: {
          ...candidateMeta,
          mirroredParentSubtreeAnchorAtomId: anchorAtomId,
          mirroredParentSubtreeRootAtomId: rootAtomId
        }
      });
    }
  }

  return candidates;
}

/**
 * Penalizes directly attached ring candidates that squeeze the new attachment
 * bond into a pinched gap around a crowded ring anchor. When four heavy bonds
 * meet at a ring junction, the directly attached ring should still preserve a
 * visibly open local slot instead of collapsing into a near-parallel exit.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Candidate coordinate map.
 * @param {{parentAtomId?: string, attachmentAtomId?: string}|null} [candidateMeta] - Optional candidate attachment metadata.
 * @returns {number} Junction crowding penalty.
 */
function measureDirectAttachmentJunctionCrowdingPenalty(layoutGraph, coords, candidateMeta = null) {
  const parentAtomId = candidateMeta?.parentAtomId ?? null;
  const attachmentAtomId = candidateMeta?.attachmentAtomId ?? null;
  if (!parentAtomId || !attachmentAtomId || !coords.has(parentAtomId) || !coords.has(attachmentAtomId)) {
    return 0;
  }
  if ((layoutGraph.atomToRings.get(parentAtomId)?.length ?? 0) === 0 || (layoutGraph.atomToRings.get(attachmentAtomId)?.length ?? 0) === 0) {
    return 0;
  }

  const parentPosition = coords.get(parentAtomId);
  const heavyNeighborAngles = [];
  for (const bond of layoutGraph.bondsByAtomId.get(parentAtomId) ?? []) {
    if (!bond || bond.kind !== 'covalent') {
      continue;
    }
    const neighborAtomId = bond.a === parentAtomId ? bond.b : bond.a;
    const neighborAtom = layoutGraph.atoms.get(neighborAtomId);
    if (!neighborAtom || neighborAtom.element === 'H' || !coords.has(neighborAtomId)) {
      continue;
    }
    heavyNeighborAngles.push({
      atomId: neighborAtomId,
      angle: angleOf(sub(coords.get(neighborAtomId), parentPosition))
    });
  }
  if (heavyNeighborAngles.length < 4) {
    return 0;
  }

  heavyNeighborAngles.sort((firstRecord, secondRecord) => firstRecord.angle - secondRecord.angle);
  const attachmentIndex = heavyNeighborAngles.findIndex(record => record.atomId === attachmentAtomId);
  if (attachmentIndex < 0) {
    return 0;
  }

  const attachmentRecord = heavyNeighborAngles[attachmentIndex];
  const previousRecord = heavyNeighborAngles[(attachmentIndex + heavyNeighborAngles.length - 1) % heavyNeighborAngles.length];
  const nextRecord = heavyNeighborAngles[(attachmentIndex + 1) % heavyNeighborAngles.length];
  const gapPenalty = gap => {
    const shortfall = DIRECT_ATTACHMENT_MIN_JUNCTION_GAP - gap;
    return shortfall > 0 ? shortfall ** 2 : 0;
  };
  return gapPenalty(angularDifference(attachmentRecord.angle, previousRecord.angle)) + gapPenalty(angularDifference(nextRecord.angle, attachmentRecord.angle));
}

function measureAttachedBlockCandidateState(baseCoords, candidateCoords, bondLength, layoutGraph, candidateMeta = null) {
  const changedAtomIds = [...candidateCoords.keys()].filter(atomId => {
    if (!baseCoords.has(atomId)) {
      return true;
    }
    const basePosition = baseCoords.get(atomId);
    const candidatePosition = candidateCoords.get(atomId);
    return Math.hypot(candidatePosition.x - basePosition.x, candidatePosition.y - basePosition.y) > 1e-9;
  });
  const scoringFocusAtomIds = expandScoringFocusAtomIds(layoutGraph, changedAtomIds);
  const readability = measureRingSubstituentReadability(layoutGraph, candidateCoords, {
    focusAtomIds: scoringFocusAtomIds
  });
  const overlapCount = findSevereOverlaps(layoutGraph, candidateCoords, bondLength).length;
  const fusedJunctionContinuationPenalty = measureDirectAttachmentFusedJunctionContinuationPenalty(layoutGraph, candidateCoords, candidateMeta);
  const exactContinuationPenalty = measureDirectAttachmentExactContinuationPenalty(layoutGraph, candidateCoords, candidateMeta);
  const parentOutwardPenalty = measureDirectAttachmentParentOutwardPenalty(layoutGraph, candidateCoords, candidateMeta);
  const trigonalBisectorPenalty = measureDirectAttachmentTrigonalBisectorPenalty(layoutGraph, candidateCoords, candidateMeta);
  const omittedHydrogenTrigonalPenalty = measureThreeHeavyContinuationDistortion(layoutGraph, candidateCoords, {
    focusAtomIds: scoringFocusAtomIds
  }).totalDeviation;
  const omittedHydrogenDirectAttachmentCompromisePenalty = candidateMeta?.parentAtomId && candidateMeta?.attachmentAtomId
    ? (() => {
        const sensitivity = summarizeDirectAttachmentTrigonalBisectorSensitivity(
          layoutGraph,
          candidateCoords,
          candidateMeta.parentAtomId,
          candidateMeta.attachmentAtomId
        );
        return sensitivity.omittedHydrogen ? omittedHydrogenTrigonalPenalty + parentOutwardPenalty : 0;
      })()
    : 0;
  const attachmentExteriorPenalty = measureDirectAttachmentExteriorContinuationPenalty(layoutGraph, candidateCoords, candidateMeta);
  const junctionCrowdingPenalty = measureDirectAttachmentJunctionCrowdingPenalty(layoutGraph, candidateCoords, candidateMeta);
  const smallRingExteriorPenalty = [...scoringFocusAtomIds].reduce(
    (sum, atomId) => sum + (candidateCoords.has(atomId) ? measureSmallRingExteriorGapSpreadPenalty(layoutGraph, candidateCoords, atomId) : 0),
    0
  );
  const shouldScoreIdealLeafPresentation =
    changedAtomIds.length <= 12 && (layoutGraph.traits.heavyAtomCount ?? 0) <= EXACT_ATTACHMENT_SEARCH_HEAVY_ATOM_LIMIT;
  const idealLeafPresentationPenalty = shouldScoreIdealLeafPresentation
    ? measureRingSubstituentPresentationPenalty(layoutGraph, candidateCoords, {
        focusAtomIds: scoringFocusAtomIds
      })
    : 0;

  return {
    overlapCount,
    fusedJunctionContinuationPenalty,
    parentOutwardPenalty,
    exactContinuationPenalty,
    trigonalBisectorPenalty,
    omittedHydrogenTrigonalPenalty,
    omittedHydrogenDirectAttachmentCompromisePenalty,
    attachmentExteriorPenalty,
    junctionCrowdingPenalty,
    presentationPenalty: (readability.totalOutwardDeviation ?? 0) + smallRingExteriorPenalty + idealLeafPresentationPenalty,
    idealLeafPresentationPenalty,
    smallRingExteriorPenalty,
    changedAtomIds,
    readability
  };
}

function mixedAttachedBlockWorkload(coords, primaryNonRingAtomIds) {
  return coords.size + primaryNonRingAtomIds.size;
}

function shouldSkipAttachedBlockBranchScoring(coords, primaryNonRingAtomIds) {
  return primaryNonRingAtomIds.size > 30 || mixedAttachedBlockWorkload(coords, primaryNonRingAtomIds) > EXACT_ATTACHMENT_SEARCH_HEAVY_ATOM_LIMIT + 20;
}

function canAcceptAttachedBlockPrescore(bestScore, runnerUpScore, coords, primaryNonRingAtomIds, bondLength) {
  const workload = mixedAttachedBlockWorkload(coords, primaryNonRingAtomIds);
  const shouldPreferCheapDecision =
    primaryNonRingAtomIds.size >= 8 || workload >= EXACT_ATTACHMENT_SEARCH_HEAVY_ATOM_LIMIT;
  if (!shouldPreferCheapDecision || !bestScore) {
    return false;
  }
  if (
    bestScore.overlapCount !== 0 ||
    bestScore.readability.failingSubstituentCount !== 0 ||
    bestScore.fusedJunctionContinuationPenalty > IMPROVEMENT_EPSILON ||
    bestScore.parentOutwardPenalty > IMPROVEMENT_EPSILON ||
    bestScore.exactContinuationPenalty > IMPROVEMENT_EPSILON ||
    bestScore.trigonalBisectorPenalty > IMPROVEMENT_EPSILON ||
    bestScore.attachmentExteriorPenalty > IMPROVEMENT_EPSILON ||
    bestScore.junctionCrowdingPenalty > IMPROVEMENT_EPSILON ||
    bestScore.presentationPenalty > 0.25
  ) {
    return false;
  }
  if (!runnerUpScore) {
    return true;
  }
  return (
    runnerUpScore.overlapCount > 0 ||
    runnerUpScore.readability.failingSubstituentCount > 0 ||
    runnerUpScore.fusedJunctionContinuationPenalty > IMPROVEMENT_EPSILON ||
    runnerUpScore.parentOutwardPenalty > IMPROVEMENT_EPSILON ||
    runnerUpScore.exactContinuationPenalty > IMPROVEMENT_EPSILON ||
    runnerUpScore.trigonalBisectorPenalty > IMPROVEMENT_EPSILON ||
    runnerUpScore.attachmentExteriorPenalty > IMPROVEMENT_EPSILON ||
    runnerUpScore.junctionCrowdingPenalty > IMPROVEMENT_EPSILON ||
    runnerUpScore.presentationPenalty > bestScore.presentationPenalty + 0.2 ||
    runnerUpScore.cost > bestScore.cost + bondLength * 0.2
  );
}

function attachedBlockFullScoringBeamLimit(coords, primaryNonRingAtomIds, candidateCount, forceFullScoring = false) {
  const workload = mixedAttachedBlockWorkload(coords, primaryNonRingAtomIds);
  if (forceFullScoring) {
    return candidateCount;
  }
  if (candidateCount <= 1) {
    return candidateCount;
  }
  if (primaryNonRingAtomIds.size >= 20 || workload >= EXACT_ATTACHMENT_SEARCH_HEAVY_ATOM_LIMIT + 20) {
    return 1;
  }
  if (primaryNonRingAtomIds.size >= 10 || workload >= EXACT_ATTACHMENT_SEARCH_HEAVY_ATOM_LIMIT) {
    return Math.min(2, candidateCount);
  }
  return candidateCount;
}

/**
 * Scores an attached-block orientation by placing the block plus the remaining
 * heavy non-ring branches into a temporary mixed-layout snapshot.
 * @param {Map<string, string[]>} adjacency - Component adjacency map.
 * @param {Map<string, number>} canonicalAtomRank - Canonical atom-rank map.
 * @param {Map<string, {x: number, y: number}>} coords - Current coordinate map.
 * @param {Set<string>} primaryNonRingAtomIds - Heavy non-ring atom IDs.
 * @param {Iterable<string>} placedAtomIds - Already placed atom IDs.
 * @param {Map<string, {x: number, y: number}>} transformedCoords - Candidate attached-block coordinates.
 * @param {number} bondLength - Target bond length.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {{angularBudgets?: Map<string, {centerAngle: number, minOffset: number, maxOffset: number}>}|null} [branchConstraints] - Optional branch-angle constraints keyed by anchor atom ID.
 * @param {{parentAtomId?: string, attachmentAtomId?: string}|null} [candidateMeta] - Optional candidate metadata for local junction tie-breaks.
 * @param {{prescore?: {coords: Map<string, {x: number, y: number}>}, placementContext?: object|null}} [options] - Optional scoring reuse state.
 * @returns {{layoutCost: number|null, totalCost: number|null, overlapCount: number, presentationPenalty: number, idealLeafPresentationPenalty: number, fusedJunctionContinuationPenalty: number, parentOutwardPenalty: number, exactContinuationPenalty: number, trigonalBisectorPenalty: number, omittedHydrogenTrigonalPenalty: number, omittedHydrogenDirectAttachmentCompromisePenalty: number, attachmentExteriorPenalty: number, junctionCrowdingPenalty: number, smallRingExteriorPenalty: number, changedAtomIds: string[], readability: {failingSubstituentCount: number, inwardSubstituentCount: number, outwardAxisFailureCount: number, totalOutwardDeviation: number, maxOutwardDeviation: number}}} Candidate layout score.
 */
function scoreAttachedBlockOrientation(
  adjacency,
  canonicalAtomRank,
  coords,
  primaryNonRingAtomIds,
  placedAtomIds,
  transformedCoords,
  bondLength,
  layoutGraph,
  branchConstraints = null,
  candidateMeta = null,
  options = {}
) {
  const candidateCoords = options.prescore?.coords ? new Map(options.prescore.coords) : new Map(coords);
  const candidateSeedAtomIds = new Set(placedAtomIds);

  for (const [atomId, position] of transformedCoords) {
    if (!options.prescore?.coords) {
      candidateCoords.set(atomId, position);
    }
    candidateSeedAtomIds.add(atomId);
  }

  if (!shouldSkipAttachedBlockBranchScoring(coords, primaryNonRingAtomIds)) {
    placeRemainingBranches(
      adjacency,
      canonicalAtomRank,
      candidateCoords,
      primaryNonRingAtomIds,
      [...candidateSeedAtomIds],
      bondLength,
      layoutGraph,
      branchConstraints,
      0,
      options.placementContext ?? null
    );
  }
  return {
    layoutCost: null,
    totalCost: null,
    ...measureAttachedBlockCandidateState(coords, candidateCoords, bondLength, layoutGraph, candidateMeta)
  };
}

function ensureAttachedBlockLayoutCost(candidateScore, candidateCoords, layoutGraph, bondLength) {
  if (candidateScore.layoutCost != null && candidateScore.totalCost != null) {
    return candidateScore;
  }

  const layoutCost =
    candidateScore.changedAtomIds.length >= 12
      ? measureFocusedPlacementCost(layoutGraph, candidateCoords, bondLength, candidateScore.changedAtomIds)
      : measureLayoutCost(layoutGraph, candidateCoords, bondLength);
  const readabilityPenalty =
    candidateScore.readability.outwardAxisFailureCount * ATTACHED_BLOCK_OUTWARD_READABILITY_PENALTY +
    candidateScore.readability.inwardSubstituentCount * ATTACHED_BLOCK_INWARD_READABILITY_PENALTY;
  candidateScore.layoutCost = layoutCost;
  candidateScore.totalCost =
    layoutCost +
    readabilityPenalty +
    candidateScore.fusedJunctionContinuationPenalty +
    candidateScore.parentOutwardPenalty +
    candidateScore.attachmentExteriorPenalty +
    candidateScore.trigonalBisectorPenalty +
    candidateScore.junctionCrowdingPenalty +
    candidateScore.smallRingExteriorPenalty;
  return candidateScore;
}

function compareAttachedBlockScores(cand, inc) {
  if (cand.overlapCount !== inc.overlapCount) {
    return cand.overlapCount - inc.overlapCount;
  }
  if (cand.readability.failingSubstituentCount !== inc.readability.failingSubstituentCount) {
    return cand.readability.failingSubstituentCount - inc.readability.failingSubstituentCount;
  }
  for (const key of ['fusedJunctionContinuationPenalty', 'parentOutwardPenalty', 'exactContinuationPenalty', 'trigonalBisectorPenalty', 'attachmentExteriorPenalty', 'junctionCrowdingPenalty', 'smallRingExteriorPenalty', 'presentationPenalty']) {
    if (Math.abs(cand[key] - inc[key]) > IMPROVEMENT_EPSILON) {
      return cand[key] - inc[key];
    }
  }
  return 0;
}

function compareOmittedHydrogenDirectAttachmentRefinementScores(cand, inc) {
  if (cand.overlapCount !== inc.overlapCount) {
    return cand.overlapCount - inc.overlapCount;
  }
  if (cand.readability.failingSubstituentCount !== inc.readability.failingSubstituentCount) {
    return cand.readability.failingSubstituentCount - inc.readability.failingSubstituentCount;
  }
  for (const key of ['fusedJunctionContinuationPenalty', 'parentOutwardPenalty', 'exactContinuationPenalty', 'trigonalBisectorPenalty', 'attachmentExteriorPenalty', 'junctionCrowdingPenalty']) {
    if (Math.abs(cand[key] - inc[key]) > IMPROVEMENT_EPSILON) {
      return cand[key] - inc[key];
    }
  }
  if (Math.abs(cand.omittedHydrogenDirectAttachmentCompromisePenalty - inc.omittedHydrogenDirectAttachmentCompromisePenalty) > IMPROVEMENT_EPSILON) {
    return cand.omittedHydrogenDirectAttachmentCompromisePenalty - inc.omittedHydrogenDirectAttachmentCompromisePenalty;
  }
  if (Math.abs(cand.presentationPenalty - inc.presentationPenalty) > IMPROVEMENT_EPSILON) {
    return cand.presentationPenalty - inc.presentationPenalty;
  }
  return 0;
}

/**
 * Compares exact trigonal-bisector rescue scores. Strict exact ring exits are
 * allowed to beat an incumbent that is already overlapping when they only cost
 * one extra transient overlap and otherwise materially improve the local
 * geometry.
 * @param {object} cand - Candidate rescue score.
 * @param {object} inc - Incumbent score.
 * @returns {number} Negative when the candidate wins, positive when it loses.
 */
function compareExactTrigonalBisectorRescueScores(cand, inc) {
  const candidateIsExact =
    cand.trigonalBisectorPenalty <= IMPROVEMENT_EPSILON
    && cand.parentOutwardPenalty <= IMPROVEMENT_EPSILON;
  const incumbentIsExact =
    inc.trigonalBisectorPenalty <= IMPROVEMENT_EPSILON
    && inc.parentOutwardPenalty <= IMPROVEMENT_EPSILON;
  if (
    candidateIsExact
    && !incumbentIsExact
    && inc.overlapCount > 0
    && cand.overlapCount <= Math.min(inc.overlapCount + 1, 2)
    && cand.readability.failingSubstituentCount <= inc.readability.failingSubstituentCount
    && cand.fusedJunctionContinuationPenalty <= inc.fusedJunctionContinuationPenalty + IMPROVEMENT_EPSILON
    && cand.exactContinuationPenalty <= inc.exactContinuationPenalty + IMPROVEMENT_EPSILON
    && cand.attachmentExteriorPenalty <= inc.attachmentExteriorPenalty + IMPROVEMENT_EPSILON
    && cand.junctionCrowdingPenalty <= inc.junctionCrowdingPenalty + IMPROVEMENT_EPSILON
  ) {
    return -1;
  }
  if (
    !candidateIsExact
    && incumbentIsExact
    && cand.overlapCount > 0
    && inc.overlapCount <= Math.min(cand.overlapCount + 1, 2)
    && inc.readability.failingSubstituentCount <= cand.readability.failingSubstituentCount
    && inc.fusedJunctionContinuationPenalty <= cand.fusedJunctionContinuationPenalty + IMPROVEMENT_EPSILON
    && inc.exactContinuationPenalty <= cand.exactContinuationPenalty + IMPROVEMENT_EPSILON
    && inc.attachmentExteriorPenalty <= cand.attachmentExteriorPenalty + IMPROVEMENT_EPSILON
    && inc.junctionCrowdingPenalty <= cand.junctionCrowdingPenalty + IMPROVEMENT_EPSILON
  ) {
    return 1;
  }
  return compareAttachedBlockScores(cand, inc);
}

/**
 * Selects the best fully scored attached-block orientation from a candidate set.
 * @param {Array<{transformedCoords: Map<string, {x: number, y: number}>}>} candidates - Candidate attached-block orientations.
 * @param {Map<string, string[]>} adjacency - Component adjacency map.
 * @param {Map<string, number>} canonicalAtomRank - Canonical atom-rank map.
 * @param {Map<string, {x: number, y: number}>} coords - Current coordinate map.
 * @param {Set<string>} primaryNonRingAtomIds - Heavy non-ring atom IDs.
 * @param {Iterable<string>} placedAtomIds - Already placed atom IDs.
 * @param {number} bondLength - Target bond length.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {{angularBudgets?: Map<string, {centerAngle: number, minOffset: number, maxOffset: number}>}|null} [branchConstraints] - Optional branch-angle constraints keyed by anchor atom ID.
 * @param {{forceFullScoring?: boolean, placementContext?: object|null}} [options] - Optional finalist-beam overrides and reusable branch-placement context.
 * @returns {{transformedCoords: Map<string, {x: number, y: number}>, score: {layoutCost: number|null, totalCost: number|null, overlapCount: number, presentationPenalty: number, exactContinuationPenalty: number, omittedHydrogenTrigonalPenalty: number, omittedHydrogenDirectAttachmentCompromisePenalty: number, readability: {failingSubstituentCount: number, inwardSubstituentCount: number, outwardAxisFailureCount: number, totalOutwardDeviation: number, maxOutwardDeviation: number}}, meta?: object}|null} Best scored candidate.
 */
function pickBestAttachedBlockOrientation(
  candidates,
  adjacency,
  canonicalAtomRank,
  coords,
  primaryNonRingAtomIds,
  placedAtomIds,
  bondLength,
  layoutGraph,
  branchConstraints = null,
  options = {}
) {
  if (candidates.length === 0) {
    return null;
  }

  const scoredCandidates = candidates.map(candidate => ({
    ...candidate,
    _prescore: candidate._prescore ?? preScoreAttachedBlockOrientation(coords, candidate.transformedCoords, bondLength, layoutGraph, candidate.meta ?? null)
  }));
  const [bestPrescoredCandidate, secondPrescoredCandidate] = scoredCandidates;
  if (
    options.forceFullScoring !== true &&
    options.disablePrescoreAcceptance !== true &&
    canAcceptAttachedBlockPrescore(
      bestPrescoredCandidate?._prescore ?? null,
      secondPrescoredCandidate?._prescore ?? null,
      coords,
      primaryNonRingAtomIds,
      bondLength
    )
  ) {
    return {
      transformedCoords: bestPrescoredCandidate.transformedCoords,
      score: bestPrescoredCandidate._prescore,
      meta: bestPrescoredCandidate.meta ?? null
    };
  }

  const finalists = scoredCandidates.slice(
    0,
    options.disableBeamReduction === true
      ? scoredCandidates.length
      : attachedBlockFullScoringBeamLimit(
          coords,
          primaryNonRingAtomIds,
          scoredCandidates.length,
          options.forceFullScoring === true
        )
  );
  let bestCandidate = null;
  let bestScore = null;

  for (const candidate of finalists) {
    const candidateScore = scoreAttachedBlockOrientation(
      adjacency,
      canonicalAtomRank,
      coords,
      primaryNonRingAtomIds,
      placedAtomIds,
      candidate.transformedCoords,
      bondLength,
      layoutGraph,
      branchConstraints,
      candidate.meta ?? null,
      {
        prescore: candidate._prescore ?? null,
        placementContext: options.placementContext ?? null
      }
    );
    const cmp = bestScore == null ? -1 : compareAttachedBlockScores(candidateScore, bestScore);
    let shouldReplaceBestCandidate = cmp < 0;
    if (!shouldReplaceBestCandidate && cmp === 0 && bestCandidate) {
      ensureAttachedBlockLayoutCost(candidateScore, candidate.transformedCoords, layoutGraph, bondLength);
      ensureAttachedBlockLayoutCost(bestScore, bestCandidate.transformedCoords, layoutGraph, bondLength);
      if (candidateScore.totalCost < bestScore.totalCost - IMPROVEMENT_EPSILON) {
        shouldReplaceBestCandidate = true;
      } else if (
        Math.abs(candidateScore.totalCost - bestScore.totalCost) <= IMPROVEMENT_EPSILON &&
        compareCoordMapsDeterministically(candidate.transformedCoords, bestCandidate.transformedCoords, layoutGraph.canonicalAtomRank) < 0
      ) {
        shouldReplaceBestCandidate = true;
      }
    }

    if (shouldReplaceBestCandidate) {
      bestCandidate = candidate;
      bestScore = candidateScore;
    }
    // Early exit: if the best score so far is already unimprovable on every primary
    // criterion (overlaps=0, no failing substituents, all penalties ≤ ε), no subsequent
    // candidate can win without reaching the totalCost tiebreaker — which is only a
    // cosmetic layout-cost difference not worth the cost of additional
    // placeRemainingBranches calls.
    if (
      bestScore.overlapCount === 0 &&
      bestScore.readability.failingSubstituentCount === 0 &&
      bestScore.fusedJunctionContinuationPenalty <= IMPROVEMENT_EPSILON &&
      bestScore.parentOutwardPenalty <= IMPROVEMENT_EPSILON &&
      bestScore.exactContinuationPenalty <= IMPROVEMENT_EPSILON &&
      bestScore.trigonalBisectorPenalty <= IMPROVEMENT_EPSILON &&
      bestScore.attachmentExteriorPenalty <= IMPROVEMENT_EPSILON &&
      bestScore.junctionCrowdingPenalty <= IMPROVEMENT_EPSILON &&
      bestScore.presentationPenalty <= IMPROVEMENT_EPSILON
    ) {
      break;
    }
  }

  return bestCandidate && bestScore ? { transformedCoords: bestCandidate.transformedCoords, score: bestScore, meta: bestCandidate.meta ?? null } : null;
}

/**
 * Builds a cheap local prescore for one attached-block orientation before the
 * more expensive full branch-placement scoring runs. This prescore still keeps
 * local ring-substituent readability in view so exact aromatic/root exits are
 * not pruned away just because a slightly worse-presented pose has a tighter
 * bounding box.
 * @param {Map<string, {x: number, y: number}>} coords - Current coordinate map.
 * @param {Map<string, {x: number, y: number}>} transformedCoords - Candidate attached-block coordinates.
 * @param {number} bondLength - Target bond length.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {{parentAtomId?: string, attachmentAtomId?: string}|null} [candidateMeta] - Optional candidate attachment metadata.
 * @returns {{coords: Map<string, {x: number, y: number}>, overlapCount: number, failingSubstituentCount: number, fusedJunctionContinuationPenalty: number, exactContinuationPenalty: number, trigonalBisectorPenalty: number, omittedHydrogenTrigonalPenalty: number, omittedHydrogenDirectAttachmentCompromisePenalty: number, presentationPenalty: number, cost: number}} Prescored candidate snapshot.
 */
function preScoreAttachedBlockOrientation(coords, transformedCoords, bondLength, layoutGraph, candidateMeta = null) {
  const candidateCoords = new Map(coords);
  for (const [atomId, position] of transformedCoords) {
    candidateCoords.set(atomId, position);
  }
  const measuredState = measureAttachedBlockCandidateState(coords, candidateCoords, bondLength, layoutGraph, candidateMeta);
  const bounds = computeBounds(candidateCoords, [...candidateCoords.keys()]);
  return {
    coords: candidateCoords,
    layoutCost: null,
    totalCost: null,
    ...measuredState,
    failingSubstituentCount: measuredState.readability.failingSubstituentCount,
    cost: bounds ? bounds.width + bounds.height : 0
  };
}

/**
 * Selects the most promising attached-block orientations for full scoring.
 * @param {Array<{transformedCoords: Map<string, {x: number, y: number}>, meta?: object}>} candidates - Raw attached-block candidates.
 * @param {Map<string, {x: number, y: number}>} coords - Current coordinate map.
 * @param {number} bondLength - Target bond length.
 * @param {object} layoutGraph - Layout graph shell.
 * @returns {Array<{transformedCoords: Map<string, {x: number, y: number}>, meta?: object}>} Candidates worth full scoring.
 */
function selectAttachedBlockCandidates(candidates, coords, bondLength, layoutGraph) {
  if (candidates.length <= 1) {
    return candidates;
  }

  const scoredCandidates = candidates.map(candidate => ({
    ...candidate,
    ...(candidate._prescore ?? preScoreAttachedBlockOrientation(coords, candidate.transformedCoords, bondLength, layoutGraph, candidate.meta ?? null))
  }));
  scoredCandidates.sort((firstCandidate, secondCandidate) => {
    if (firstCandidate.overlapCount !== secondCandidate.overlapCount) {
      return firstCandidate.overlapCount - secondCandidate.overlapCount;
    }
    if (firstCandidate.failingSubstituentCount !== secondCandidate.failingSubstituentCount) {
      return firstCandidate.failingSubstituentCount - secondCandidate.failingSubstituentCount;
    }
    if (Math.abs(firstCandidate.fusedJunctionContinuationPenalty - secondCandidate.fusedJunctionContinuationPenalty) > IMPROVEMENT_EPSILON) {
      return firstCandidate.fusedJunctionContinuationPenalty - secondCandidate.fusedJunctionContinuationPenalty;
    }
    if (Math.abs(firstCandidate.exactContinuationPenalty - secondCandidate.exactContinuationPenalty) > IMPROVEMENT_EPSILON) {
      return firstCandidate.exactContinuationPenalty - secondCandidate.exactContinuationPenalty;
    }
    if (Math.abs(firstCandidate.trigonalBisectorPenalty - secondCandidate.trigonalBisectorPenalty) > IMPROVEMENT_EPSILON) {
      return firstCandidate.trigonalBisectorPenalty - secondCandidate.trigonalBisectorPenalty;
    }
    if (Math.abs(firstCandidate.presentationPenalty - secondCandidate.presentationPenalty) > IMPROVEMENT_EPSILON) {
      return firstCandidate.presentationPenalty - secondCandidate.presentationPenalty;
    }
    if (Math.abs(firstCandidate.cost - secondCandidate.cost) > IMPROVEMENT_EPSILON) {
      return firstCandidate.cost - secondCandidate.cost;
    }
    return compareCoordMapsDeterministically(firstCandidate.transformedCoords, secondCandidate.transformedCoords, layoutGraph.canonicalAtomRank);
  });

  const [bestCandidate, secondCandidate] = scoredCandidates;
  if (!secondCandidate) {
    return [bestCandidate];
  }
  if (secondCandidate.overlapCount === bestCandidate.overlapCount) {
    return scoredCandidates.slice(0, Math.min(4, scoredCandidates.length));
  }
  if (secondCandidate.overlapCount > bestCandidate.overlapCount || secondCandidate.cost - bestCandidate.cost > bondLength * 0.25) {
    return [bestCandidate];
  }
  return scoredCandidates.slice(0, Math.min(4, scoredCandidates.length));
}

/**
 * Returns whether a ring system contains a ring trigonal center with a lone
 * exocyclic terminal multiple-bond leaf that benefits from exact presentation.
 * Small misses at imides, lactams, and related motifs are visually obvious, so
 * direct-attached ring blocks should search a small exact-pose rescue menu for
 * these cases before settling on a merely acceptable pose.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {object} ringSystem - Candidate attached ring system.
 * @returns {boolean} True when finer direct-attachment rotation search is warranted.
 */
function ringSystemHasExactLeafSensitiveTrigonalCenter(layoutGraph, ringSystem) {
  if (!ringSystem) {
    return false;
  }
  const ringAtomIdSet = new Set(ringSystem.atomIds);
  for (const atomId of ringSystem.atomIds) {
    const atom = layoutGraph.atoms.get(atomId);
    if (!atom || atom.aromatic || atom.heavyDegree !== 3) {
      continue;
    }
    const exocyclicHeavyBonds = (layoutGraph.bondsByAtomId.get(atomId) ?? [])
      .filter(bond => bond.kind === 'covalent' && !bond.inRing && !bond.aromatic)
      .map(bond => ({
        bond,
        neighborAtomId: bond.a === atomId ? bond.b : bond.a
      }))
      .filter(({ neighborAtomId }) => !ringAtomIdSet.has(neighborAtomId) && layoutGraph.atoms.get(neighborAtomId)?.element !== 'H');
    if (exocyclicHeavyBonds.length !== 1) {
      continue;
    }
    const [{ bond, neighborAtomId }] = exocyclicHeavyBonds;
    const neighborAtom = layoutGraph.atoms.get(neighborAtomId);
    if (neighborAtom && !neighborAtom.aromatic && (bond.order ?? 1) >= 2 && neighborAtom.heavyDegree === 1) {
      return true;
    }
  }
  return false;
}

/**
 * Splits non-ring participant atoms into heavy atoms and explicit hydrogens.
 * Mixed layouts attach pending ring systems after the initial branch-growth
 * pass, so explicit hydrogens should wait until those heavier attachments are
 * resolved to avoid claiming trigonal alkene slots too early.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Iterable<string>} atomIds - Atom IDs to classify.
 * @returns {{primaryAtomIds: Set<string>, deferredHydrogenAtomIds: Set<string>}} Classified non-ring atom IDs.
 */
function splitDeferredMixedHydrogens(layoutGraph, atomIds) {
  const primaryAtomIds = new Set();
  const deferredHydrogenAtomIds = new Set();

  for (const atomId of atomIds) {
    const atom = layoutGraph.atoms.get(atomId);
    if (atom?.element === 'H') {
      deferredHydrogenAtomIds.add(atomId);
      continue;
    }
    primaryAtomIds.add(atomId);
  }

  return { primaryAtomIds, deferredHydrogenAtomIds };
}

/**
 * Rotates a monosubstituted benzene root so its outgoing heavy substituent
 * axis is horizontal before mixed branch growth begins.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {object} ringSystem - Root ring-system descriptor.
 * @param {Map<string, {x: number, y: number}>} coords - Root ring coordinates.
 * @param {Set<string>} participantAtomIds - Visible component atom IDs.
 * @returns {Map<string, {x: number, y: number}>} Possibly rotated root coordinates.
 */
function orientSingleAttachmentBenzeneRoot(layoutGraph, ringSystem, coords, participantAtomIds) {
  const rootRings = layoutGraph.rings.filter(ring => ringSystem.ringIds.includes(ring.id));
  if (rootRings.length !== 1) {
    return coords;
  }

  const [ring] = rootRings;
  if (!ring.aromatic || ring.atomIds.length !== 6 || !ring.atomIds.every(atomId => layoutGraph.atoms.get(atomId)?.element === 'C')) {
    return coords;
  }

  const ringAtomIdSet = new Set(ring.atomIds);
  const heavyAttachmentAnchors = ring.atomIds.filter(atomId => {
    const atom = layoutGraph.sourceMolecule.atoms.get(atomId);
    if (!atom) {
      return false;
    }
    return atom
      .getNeighbors(layoutGraph.sourceMolecule)
      .some(neighborAtom => neighborAtom && neighborAtom.name !== 'H' && participantAtomIds.has(neighborAtom.id) && !ringAtomIdSet.has(neighborAtom.id));
  });

  if (heavyAttachmentAnchors.length !== 1) {
    return coords;
  }

  const anchorAtomId = heavyAttachmentAnchors[0];
  const ringCenter = centroid([...coords.values()]);
  const anchorPosition = coords.get(anchorAtomId);
  const anchorVector = anchorPosition ? sub(anchorPosition, ringCenter) : null;
  if (!anchorVector || Math.hypot(anchorVector.x, anchorVector.y) <= 1e-6) {
    return coords;
  }

  const currentAngle = angleOf(anchorVector);
  const targetAngle = anchorVector.x >= 0 ? 0 : Math.PI;
  const rotationAngle = targetAngle - currentAngle;
  if (Math.abs(rotationAngle) <= 1e-6) {
    return coords;
  }

  const rotatedCoords = new Map();
  for (const [atomId, position] of coords) {
    rotatedCoords.set(atomId, add(ringCenter, rotate(sub(position, ringCenter), rotationAngle)));
  }
  return rotatedCoords;
}

/**
 * Returns the cached layout for a pending secondary ring system.
 * @param {Map<number, {family: string, validationClass: 'planar'|'bridged', coords: Map<string, {x: number, y: number}>, ringCenters: Map<number, {x: number, y: number}>, placementMode: string}|null>} cache - Pending-ring layout cache.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {{ringSystem: object, templateId?: string|null}} pendingRingSystem - Pending ring-system entry.
 * @param {number} bondLength - Target bond length.
 * @returns {{family: string, validationClass: 'planar'|'bridged', coords: Map<string, {x: number, y: number}>, ringCenters: Map<number, {x: number, y: number}>, placementMode: string}|null} Cached or computed layout.
 */
function getPendingRingLayout(cache, layoutGraph, pendingRingSystem, bondLength) {
  if (!cache.has(pendingRingSystem.ringSystem.id)) {
    cache.set(pendingRingSystem.ringSystem.id, layoutRingSystem(layoutGraph, pendingRingSystem.ringSystem, bondLength, pendingRingSystem.templateId));
  }
  return cache.get(pendingRingSystem.ringSystem.id) ?? null;
}

/**
 * Initializes the root scaffold and shared mutable state for mixed-family placement.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {object} component - Connected-component descriptor.
 * @param {Map<string, string[]>} adjacency - Component adjacency map.
 * @param {object} scaffoldPlan - Scaffold plan.
 * @param {number} bondLength - Target bond length.
 * @param {{conservativeAttachmentScoring?: boolean}|null} [options] - Optional mixed-family placement overrides.
 * @returns {{finalResult?: {family: string, supported: boolean, atomIds: string[], coords: Map<string, {x: number, y: number}>, bondValidationClasses: Map<string, 'planar'|'bridged'>}, state?: object}} Initialization result.
 */
function initializeRootScaffold(layoutGraph, component, adjacency, scaffoldPlan, bondLength, options = null) {
  const participantAtomIds = new Set(
    component.atomIds.filter(atomId => {
      const atom = layoutGraph.atoms.get(atomId);
      return atom && !(layoutGraph.options.suppressH && atom.element === 'H' && !atom.visible);
    })
  );
  const coords = new Map();
  const placedAtomIds = new Set();
  const bondValidationClasses = new Map();
  const atomToRingSystemId = layoutGraph.atomToRingSystemId;
  const ringSystemById = new Map(layoutGraph.ringSystems.map(ringSystem => [ringSystem.id, ringSystem]));
  const root = scaffoldPlan.rootScaffold;

  if (root.type === 'acyclic') {
    const acyclicCoords = layoutAcyclicFamily(adjacency, participantAtomIds, layoutGraph.canonicalAtomRank, bondLength, { layoutGraph });
    return {
      finalResult: {
        family: 'mixed',
        supported: true,
        atomIds: [...participantAtomIds],
        coords: acyclicCoords,
        bondValidationClasses: assignBondValidationClass(layoutGraph, participantAtomIds, 'planar', bondValidationClasses)
      }
    };
  }

  const rootRingSystem = layoutGraph.ringSystems.find(ringSystem => `ring-system:${ringSystem.id}` === root.id);
  const rootLayout = rootRingSystem ? layoutRingSystem(layoutGraph, rootRingSystem, bondLength, root.templateId ?? null) : null;
  if (!rootLayout) {
    return {
      finalResult: {
        family: 'mixed',
        supported: false,
        atomIds: [...participantAtomIds],
        coords,
        bondValidationClasses
      }
    };
  }
  const rootCoords = orientSingleAttachmentBenzeneRoot(layoutGraph, rootRingSystem, rootLayout.coords, participantAtomIds);
  for (const [atomId, position] of rootCoords) {
    coords.set(atomId, position);
    placedAtomIds.add(atomId);
  }
  const placedRingSystemIds = new Set([rootRingSystem.id]);
  assignBondValidationClass(layoutGraph, rootRingSystem.atomIds, rootLayout.validationClass, bondValidationClasses);
  const macrocycleBranchConstraints =
    rootLayout.family === 'macrocycle'
      ? {
          angularBudgets: computeMacrocycleAngularBudgets(
            layoutGraph.rings.filter(ring => rootRingSystem.ringIds.includes(ring.id)),
            coords,
            layoutGraph,
            participantAtomIds
          )
        }
      : null;

  const nonRingAtomIds = new Set([...participantAtomIds].filter(atomId => !layoutGraph.ringSystems.some(ringSystem => ringSystem.atomIds.includes(atomId))));
  const { primaryAtomIds: primaryNonRingAtomIds, deferredHydrogenAtomIds } = splitDeferredMixedHydrogens(layoutGraph, nonRingAtomIds);
  const pendingRingLayoutCache = new Map();
  const pendingRingSystems = scaffoldPlan.placementSequence
    .filter(entry => entry.kind === 'ring-system' && entry.candidateId !== root.id)
    .map(entry => {
      const ringSystem = layoutGraph.ringSystems.find(candidateRingSystem => `ring-system:${candidateRingSystem.id}` === entry.candidateId);
      return ringSystem ? { ringSystem, templateId: entry.templateId ?? null } : null;
    })
    .filter(Boolean);

  return {
    state: {
      participantAtomIds,
      coords,
      placedAtomIds,
      bondValidationClasses,
      atomToRingSystemId,
      ringSystemById,
      placedRingSystemIds,
      macrocycleBranchConstraints,
      nonRingAtomIds,
      primaryNonRingAtomIds,
      deferredHydrogenAtomIds,
      pendingRingLayoutCache,
      pendingRingSystems,
      branchPlacementContext: {},
      mixedOptions: options ?? null
    }
  };
}

function markMixedBranchPlacementContextDirty(state) {
  if (!state?.branchPlacementContext) {
    state.branchPlacementContext = {};
  }
  state.branchPlacementContext.needsResync = true;
}

function placeMixedBranches(layoutGraph, adjacency, bondLength, state, atomIdsToPlace) {
  if (!atomIdsToPlace || atomIdsToPlace.size === 0) {
    return;
  }
  placeRemainingBranches(
    adjacency,
    layoutGraph.canonicalAtomRank,
    state.coords,
    atomIdsToPlace,
    [...state.placedAtomIds],
    bondLength,
    layoutGraph,
    state.macrocycleBranchConstraints,
    0,
    state.branchPlacementContext ?? null
  );
  for (const atomId of atomIdsToPlace) {
    if (state.coords.has(atomId)) {
      state.placedAtomIds.add(atomId);
    }
  }
}

/**
 * Attaches pending ring systems and grows primary non-ring branches until no
 * further mixed-family progress is possible.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, string[]>} adjacency - Component adjacency map.
 * @param {number} bondLength - Target bond length.
 * @param {object} state - Mutable mixed-family placement state.
 * @returns {void}
 */
function attachPendingRingSystems(layoutGraph, adjacency, bondLength, state) {
  const {
    participantAtomIds,
    coords,
    placedAtomIds,
    bondValidationClasses,
    atomToRingSystemId,
    ringSystemById,
    placedRingSystemIds,
    macrocycleBranchConstraints,
    primaryNonRingAtomIds,
    pendingRingLayoutCache
  } = state;
  let pendingRingSystems = [...state.pendingRingSystems];

  let progressed = true;
  while (progressed) {
    progressed = false;
    const remainingAfterLinkers = [];
    for (const pendingRingSystem of pendingRingSystems) {
      const linker = findShortestRingLinker(layoutGraph, pendingRingSystem.ringSystem, placedRingSystemIds, participantAtomIds, atomToRingSystemId);
      if (!linker || linker.chainAtomIds.some(atomId => coords.has(atomId))) {
        remainingAfterLinkers.push(pendingRingSystem);
        continue;
      }
      const firstRingSystem = ringSystemById.get(linker.firstRingSystemId);
      const blockLayout = getPendingRingLayout(pendingRingLayoutCache, layoutGraph, pendingRingSystem, bondLength);
      if (!firstRingSystem || !blockLayout || !isSupportedRingLinker(layoutGraph, firstRingSystem, pendingRingSystem.ringSystem, linker)) {
        remainingAfterLinkers.push(pendingRingSystem);
        continue;
      }

      const turnSigns = linker.chainAtomIds.length === 0 ? [1] : [-1, 1];
      let bestCandidateCoords = null;
      const rawCandidates = [];
      const allowExpandedRingLinkerRotations =
        (layoutGraph.traits.heavyAtomCount ?? 0) <= EXACT_ATTACHMENT_SEARCH_HEAVY_ATOM_LIMIT && pendingRingSystem.ringSystem.atomIds.length <= 18;
      for (const turnSign of turnSigns) {
        for (const mirror of [false, true]) {
          rawCandidates.push({
            transformedCoords: buildRingLinkerCandidate(
              layoutGraph,
              coords,
              firstRingSystem,
              linker,
              pendingRingSystem.ringSystem,
              blockLayout.coords,
              bondLength,
              turnSign,
              mirror
            )
          });
        }
      }
      for (const candidate of rawCandidates) {
        candidate._prescore = preScoreAttachedBlockOrientation(coords, candidate.transformedCoords, bondLength, layoutGraph, candidate.meta ?? null);
      }
      const defaultOverlapFree = rawCandidates.some(candidate => candidate._prescore.overlapCount === 0);
      if (!defaultOverlapFree && allowExpandedRingLinkerRotations) {
        for (const turnSign of turnSigns) {
          for (const mirror of [false, true]) {
            for (const ringRotationOffset of LINKED_RING_ROTATION_OFFSETS) {
              rawCandidates.push({
                transformedCoords: buildRingLinkerCandidate(
                  layoutGraph,
                  coords,
                  firstRingSystem,
                  linker,
                  pendingRingSystem.ringSystem,
                  blockLayout.coords,
                  bondLength,
                  turnSign,
                  mirror,
                  ringRotationOffset
                )
              });
            }
          }
        }
      }
      const bestCandidate = pickBestAttachedBlockOrientation(
        selectAttachedBlockCandidates(rawCandidates, coords, bondLength, layoutGraph),
        adjacency,
        layoutGraph.canonicalAtomRank,
        coords,
        primaryNonRingAtomIds,
        placedAtomIds,
        bondLength,
        layoutGraph,
        macrocycleBranchConstraints,
        {
          placementContext: state.branchPlacementContext,
          disablePrescoreAcceptance: state.mixedOptions?.conservativeAttachmentScoring === true,
          disableBeamReduction: state.mixedOptions?.conservativeAttachmentScoring === true
        }
      );
      bestCandidateCoords = bestCandidate?.transformedCoords ?? null;

      if (!bestCandidateCoords) {
        remainingAfterLinkers.push(pendingRingSystem);
        continue;
      }

      for (const [atomId, position] of bestCandidateCoords) {
        coords.set(atomId, position);
        placedAtomIds.add(atomId);
      }
      markMixedBranchPlacementContextDirty(state);
      placedRingSystemIds.add(pendingRingSystem.ringSystem.id);
      assignBondValidationClass(layoutGraph, pendingRingSystem.ringSystem.atomIds, blockLayout.validationClass, bondValidationClasses);
      progressed = true;
    }
    pendingRingSystems = remainingAfterLinkers;

    const sizeBeforeBranches = coords.size;
    placeMixedBranches(layoutGraph, adjacency, bondLength, state, primaryNonRingAtomIds);
    if (coords.size > sizeBeforeBranches) {
      progressed = true;
    }

    const remainingAfterAttachments = [];
    for (const pendingRingSystem of pendingRingSystems) {
      const attachment = findAttachmentBond(layoutGraph, pendingRingSystem.ringSystem, placedAtomIds);
      if (!attachment) {
        remainingAfterAttachments.push(pendingRingSystem);
        continue;
      }
      const blockLayout = getPendingRingLayout(pendingRingLayoutCache, layoutGraph, pendingRingSystem, bondLength);
      if (!blockLayout) {
        remainingAfterAttachments.push(pendingRingSystem);
        continue;
      }
      const parentPosition = coords.get(attachment.parentAtomId);
      const placedPositions = [];
      for (const atomId of placedAtomIds) {
        const pos = coords.get(atomId);
        if (pos) {
          placedPositions.push(pos);
        }
      }
      const placedCentroid = centroid(placedPositions);
      const preferredAngle = angleOf(sub(parentPosition, placedCentroid));
      const attachmentAngle = chooseAttachmentAngle(
        adjacency,
        coords,
        attachment.parentAtomId,
        participantAtomIds,
        preferredAngle,
        layoutGraph,
        attachment.attachmentAtomId,
        macrocycleBranchConstraints
      );
      const detachedAttachmentPosition = blockLayout.coords.get(attachment.attachmentAtomId);
      const detachedRingCenter = centroid([...blockLayout.coords.values()]);
      const detachedCentroidAngle =
        detachedAttachmentPosition && detachedRingCenter
          ? angleOf(sub(detachedRingCenter, detachedAttachmentPosition))
          : 0;
      const detachedExitAngle = ringLinkerExitAngle(
        layoutGraph,
        blockLayout.coords,
        pendingRingSystem.ringSystem,
        attachment.attachmentAtomId,
        { checkHeavyAtomLimit: true }
      );
      const outwardAlignmentOffset = detachedExitAngle == null ? 0 : detachedCentroidAngle - detachedExitAngle;
      const directAttachmentRingRotationOffsets = [...DIRECT_ATTACHMENT_RING_ROTATION_OFFSETS];
      const exactDirectAttachmentOffsets = [
        ...exactDirectAttachmentRingRotationOffsets(layoutGraph, blockLayout.coords, attachment.attachmentAtomId),
        ...exactDirectAttachmentTrigonalBisectorRotationOffsets(
          layoutGraph,
          blockLayout.coords,
          attachment.attachmentAtomId,
          attachment.parentAtomId,
          outwardAlignmentOffset
        ),
        ...exactDirectAttachmentParentOutwardRotationOffsets(
          layoutGraph,
          blockLayout.coords,
          attachment.attachmentAtomId,
          detachedExitAngle
        )
      ];
      for (const rotationOffset of exactDirectAttachmentOffsets) {
        if (!directAttachmentRingRotationOffsets.some(candidateOffset => angularDifference(candidateOffset, rotationOffset) <= 1e-9)) {
          directAttachmentRingRotationOffsets.push(rotationOffset);
        }
      }
      const buildDirectAttachmentCandidate = (resolvedAttachmentAngle, mirror, ringRotationOffset = 0) => {
        const resolvedTargetPosition = add(parentPosition, fromAngle(resolvedAttachmentAngle, bondLength));
        return {
          transformedCoords: transformAttachedBlock(
            blockLayout.coords,
            attachment.attachmentAtomId,
            resolvedTargetPosition,
            resolvedAttachmentAngle + outwardAlignmentOffset + ringRotationOffset,
            {
              mirror
            }
          ),
          meta: {
            attachmentAngle: resolvedAttachmentAngle,
            attachmentAtomId: attachment.attachmentAtomId,
            mirror,
            parentAtomId: attachment.parentAtomId,
            ringRotationOffset
          }
        };
      };
      const exactContinuationAttachmentAngles = exactDirectAttachmentContinuationAngles(
        layoutGraph,
        coords,
        {
          attachmentAtomId: attachment.attachmentAtomId,
          parentAtomId: attachment.parentAtomId
        }
      );
      const rawAttachedBlockCandidates = [buildDirectAttachmentCandidate(attachmentAngle, false), buildDirectAttachmentCandidate(attachmentAngle, true)];
      for (const exactAttachmentAngle of exactContinuationAttachmentAngles) {
        if (rawAttachedBlockCandidates.some(candidate => angularDifference(candidate.meta?.attachmentAngle ?? 0, exactAttachmentAngle) <= 1e-9)) {
          continue;
        }
        rawAttachedBlockCandidates.push(
          buildDirectAttachmentCandidate(exactAttachmentAngle, false),
          buildDirectAttachmentCandidate(exactAttachmentAngle, true)
        );
      }
      let bestAttachedBlockCandidate = pickBestAttachedBlockOrientation(
        selectAttachedBlockCandidates(rawAttachedBlockCandidates, coords, bondLength, layoutGraph),
        adjacency,
        layoutGraph.canonicalAtomRank,
        coords,
        primaryNonRingAtomIds,
        placedAtomIds,
        bondLength,
        layoutGraph,
        macrocycleBranchConstraints,
        {
          placementContext: state.branchPlacementContext,
          disablePrescoreAcceptance: state.mixedOptions?.conservativeAttachmentScoring === true,
          disableBeamReduction: state.mixedOptions?.conservativeAttachmentScoring === true
        }
      );
      const allowExpandedDirectAttachmentRotations =
        (layoutGraph.traits.heavyAtomCount ?? 0) <= EXACT_ATTACHMENT_SEARCH_HEAVY_ATOM_LIMIT && pendingRingSystem.ringSystem.atomIds.length <= 18;
      const smallRingExteriorDirectAttachmentDescriptor = describeDirectAttachmentExteriorContinuationAnchor(layoutGraph, attachment.parentAtomId);
      const exactSmallRingExteriorDirectAttachment = smallRingExteriorDirectAttachmentDescriptor?.exocyclicNeighborIds.includes(attachment.attachmentAtomId) ?? false;
      const exactLeafSensitiveDirectAttachment = ringSystemHasExactLeafSensitiveTrigonalCenter(layoutGraph, pendingRingSystem.ringSystem);
      const directAttachmentTrigonalSensitivity = summarizeDirectAttachmentTrigonalBisectorSensitivity(
        layoutGraph,
        coords,
        attachment.parentAtomId,
        attachment.attachmentAtomId
      );
      const lockDirectAttachmentAngle = directAttachmentTrigonalSensitivity.strict || directAttachmentTrigonalSensitivity.omittedHydrogen;
      const allowOmittedHydrogenDirectAttachmentCompromise =
        directAttachmentTrigonalSensitivity.omittedHydrogen &&
        !layoutGraph.atoms.get(attachment.parentAtomId)?.chirality &&
        !layoutGraph.atoms.get(attachment.attachmentAtomId)?.chirality &&
        (
          (bestAttachedBlockCandidate?.score.readability.failingSubstituentCount ?? 0) > 0 ||
          (bestAttachedBlockCandidate?.score.parentOutwardPenalty ?? 0) > IMPROVEMENT_EPSILON
        );
      const idealLeafExpansionThreshold = exactLeafSensitiveDirectAttachment ? 0.2 : 0.5;
      const shouldExpandForSensitiveOverlap =
        (bestAttachedBlockCandidate?.score.overlapCount ?? 0) > 0 &&
        (exactLeafSensitiveDirectAttachment || directAttachmentTrigonalSensitivity.eligible || exactSmallRingExteriorDirectAttachment);
      if (
        allowExpandedDirectAttachmentRotations &&
        (shouldExpandForSensitiveOverlap ||
          (bestAttachedBlockCandidate?.score.readability.failingSubstituentCount ?? 0) > 0 ||
          (bestAttachedBlockCandidate?.score.fusedJunctionContinuationPenalty ?? 0) > IMPROVEMENT_EPSILON ||
          (bestAttachedBlockCandidate?.score.parentOutwardPenalty ?? 0) > IMPROVEMENT_EPSILON ||
          (bestAttachedBlockCandidate?.score.trigonalBisectorPenalty ?? 0) > IMPROVEMENT_EPSILON ||
          (bestAttachedBlockCandidate?.score.attachmentExteriorPenalty ?? 0) > IMPROVEMENT_EPSILON ||
          (bestAttachedBlockCandidate?.score.idealLeafPresentationPenalty ?? 0) > idealLeafExpansionThreshold ||
          (bestAttachedBlockCandidate?.score.junctionCrowdingPenalty ?? 0) > IMPROVEMENT_EPSILON ||
          (bestAttachedBlockCandidate?.score.smallRingExteriorPenalty ?? 0) > IMPROVEMENT_EPSILON)
      ) {
        const allowLockedOmittedHydrogenAngleExpansion =
          directAttachmentTrigonalSensitivity.omittedHydrogen &&
          !layoutGraph.atoms.get(attachment.parentAtomId)?.chirality &&
          !layoutGraph.atoms.get(attachment.attachmentAtomId)?.chirality &&
          (bestAttachedBlockCandidate?.score.parentOutwardPenalty ?? 0) > IMPROVEMENT_EPSILON &&
          (layoutGraph.atomToRings.get(attachment.attachmentAtomId)?.length ?? 0) > 0;
        const directAttachmentAngleOffsets =
          lockDirectAttachmentAngle && !allowLockedOmittedHydrogenAngleExpansion
            ? [0]
            : DIRECT_ATTACHMENT_ROTATION_OFFSETS;
        const expandedRingRotationOffsets = [...directAttachmentRingRotationOffsets];
        const expandedCandidates = [...rawAttachedBlockCandidates];
        for (const mirror of [false, true]) {
          for (const attachmentAngleOffset of directAttachmentAngleOffsets) {
            for (const ringRotationOffset of expandedRingRotationOffsets) {
              if (Math.abs(attachmentAngleOffset) <= IMPROVEMENT_EPSILON && Math.abs(ringRotationOffset) <= IMPROVEMENT_EPSILON) {
                continue;
              }
              expandedCandidates.push(buildDirectAttachmentCandidate(attachmentAngle + attachmentAngleOffset, mirror, ringRotationOffset));
            }
          }
        }
        for (const exactAttachmentAngle of exactContinuationAttachmentAngles) {
          for (const mirror of [false, true]) {
            for (const ringRotationOffset of expandedRingRotationOffsets) {
              if (
                Math.abs(ringRotationOffset) <= IMPROVEMENT_EPSILON
                && rawAttachedBlockCandidates.some(candidate => (
                  candidate.meta?.mirror === mirror
                  && angularDifference(candidate.meta?.attachmentAngle ?? 0, exactAttachmentAngle) <= 1e-9
                ))
              ) {
                continue;
              }
              expandedCandidates.push(buildDirectAttachmentCandidate(exactAttachmentAngle, mirror, ringRotationOffset));
            }
          }
        }
        const shouldProbeMirroredParentSubtrees =
          directAttachmentTrigonalSensitivity.omittedHydrogen &&
          !layoutGraph.atoms.get(attachment.parentAtomId)?.chirality &&
          !layoutGraph.atoms.get(attachment.attachmentAtomId)?.chirality;
        const candidatePool = shouldProbeMirroredParentSubtrees
          ? [
              ...expandedCandidates,
              ...expandedCandidates.flatMap(candidate =>
                buildMirroredParentSideSubtreeCandidates(layoutGraph, coords, candidate.transformedCoords, candidate.meta ?? null)
              )
            ]
          : expandedCandidates;
        const shouldScoreAllExpandedDirectAttachmentCandidates =
          (bestAttachedBlockCandidate?.score.overlapCount ?? 0) > 0 ||
          (bestAttachedBlockCandidate?.score.readability.failingSubstituentCount ?? 0) > 0 ||
          (bestAttachedBlockCandidate?.score.parentOutwardPenalty ?? 0) > IMPROVEMENT_EPSILON ||
          (bestAttachedBlockCandidate?.score.trigonalBisectorPenalty ?? 0) > IMPROVEMENT_EPSILON ||
          (bestAttachedBlockCandidate?.score.attachmentExteriorPenalty ?? 0) > IMPROVEMENT_EPSILON ||
          exactSmallRingExteriorDirectAttachment;
        bestAttachedBlockCandidate = pickBestAttachedBlockOrientation(
          shouldScoreAllExpandedDirectAttachmentCandidates ? candidatePool : selectAttachedBlockCandidates(candidatePool, coords, bondLength, layoutGraph),
          adjacency,
          layoutGraph.canonicalAtomRank,
          coords,
          primaryNonRingAtomIds,
          placedAtomIds,
          bondLength,
          layoutGraph,
          macrocycleBranchConstraints,
          {
            forceFullScoring: shouldScoreAllExpandedDirectAttachmentCandidates,
            placementContext: state.branchPlacementContext,
            disablePrescoreAcceptance: state.mixedOptions?.conservativeAttachmentScoring === true,
            disableBeamReduction: state.mixedOptions?.conservativeAttachmentScoring === true
          }
        );
      }
      if (
        allowOmittedHydrogenDirectAttachmentCompromise &&
        bestAttachedBlockCandidate?.transformedCoords &&
        (
          (bestAttachedBlockCandidate?.score.readability.failingSubstituentCount ?? 0) > 0 ||
          (bestAttachedBlockCandidate?.score.omittedHydrogenTrigonalPenalty ?? 0) > 0.2 ||
          (bestAttachedBlockCandidate?.score.parentOutwardPenalty ?? 0) > IMPROVEMENT_EPSILON
        )
      ) {
        const localRefinementCandidates = buildLocalDirectAttachmentRefinementCandidates(
          bestAttachedBlockCandidate.transformedCoords,
          parentPosition,
          attachment.attachmentAtomId,
          bondLength
        );
        if (localRefinementCandidates.length > 0) {
          let refinedBestCandidate = bestAttachedBlockCandidate;
          let refinedBestScore = bestAttachedBlockCandidate.score;
          for (const candidate of localRefinementCandidates) {
            const candidateMeta = {
              attachmentAtomId: attachment.attachmentAtomId,
              parentAtomId: attachment.parentAtomId,
              attachmentAngleOffset: candidate.attachmentAngleOffset,
              ringRotationOffset: candidate.ringRotationOffset,
              localRefinement: true
            };
            const candidateScore = scoreAttachedBlockOrientation(
              adjacency,
              layoutGraph.canonicalAtomRank,
              coords,
              primaryNonRingAtomIds,
              placedAtomIds,
              candidate.transformedCoords,
              bondLength,
              layoutGraph,
              macrocycleBranchConstraints,
              candidateMeta,
              {
                placementContext: state.branchPlacementContext
              }
            );
            const comparison = compareOmittedHydrogenDirectAttachmentRefinementScores(candidateScore, refinedBestScore);
            if (comparison < 0) {
              refinedBestCandidate = {
                transformedCoords: candidate.transformedCoords,
                meta: candidateMeta,
                score: candidateScore
              };
              refinedBestScore = candidateScore;
              continue;
            }
            if (comparison === 0) {
              ensureAttachedBlockLayoutCost(candidateScore, candidate.transformedCoords, layoutGraph, bondLength);
              ensureAttachedBlockLayoutCost(refinedBestScore, refinedBestCandidate.transformedCoords, layoutGraph, bondLength);
              if (candidateScore.totalCost < refinedBestScore.totalCost - IMPROVEMENT_EPSILON) {
                refinedBestCandidate = {
                  transformedCoords: candidate.transformedCoords,
                  meta: candidateMeta,
                  score: candidateScore
                };
                refinedBestScore = candidateScore;
              }
            }
          }
          if (refinedBestCandidate) {
            bestAttachedBlockCandidate = refinedBestCandidate;
          }
        }
      }
      if (
        bestAttachedBlockCandidate?.transformedCoords
        && (bestAttachedBlockCandidate?.score.trigonalBisectorPenalty ?? 0) > IMPROVEMENT_EPSILON
      ) {
        const exactTrigonalBisectorRescueCandidates = buildDirectAttachmentExactTrigonalBisectorRescueCandidates(
          layoutGraph,
          coords,
          bestAttachedBlockCandidate.transformedCoords,
          bestAttachedBlockCandidate.meta ?? {
            attachmentAtomId: attachment.attachmentAtomId,
            parentAtomId: attachment.parentAtomId
          }
        );
        if (exactTrigonalBisectorRescueCandidates.length > 0) {
          let rescueBestCandidate = bestAttachedBlockCandidate;
          let rescueBestScore = bestAttachedBlockCandidate.score;
          for (const candidate of exactTrigonalBisectorRescueCandidates) {
            const candidateScore = scoreAttachedBlockOrientation(
              adjacency,
              layoutGraph.canonicalAtomRank,
              coords,
              primaryNonRingAtomIds,
              placedAtomIds,
              candidate.transformedCoords,
              bondLength,
              layoutGraph,
              macrocycleBranchConstraints,
              candidate.meta ?? null,
              {
                placementContext: state.branchPlacementContext
              }
            );
            const comparison = compareExactTrigonalBisectorRescueScores(candidateScore, rescueBestScore);
            if (comparison < 0) {
              rescueBestCandidate = {
                transformedCoords: candidate.transformedCoords,
                meta: candidate.meta ?? null,
                score: candidateScore
              };
              rescueBestScore = candidateScore;
              continue;
            }
            if (comparison === 0 && rescueBestCandidate) {
              ensureAttachedBlockLayoutCost(candidateScore, candidate.transformedCoords, layoutGraph, bondLength);
              ensureAttachedBlockLayoutCost(rescueBestScore, rescueBestCandidate.transformedCoords, layoutGraph, bondLength);
              if (candidateScore.totalCost < rescueBestScore.totalCost - IMPROVEMENT_EPSILON) {
                rescueBestCandidate = {
                  transformedCoords: candidate.transformedCoords,
                  meta: candidate.meta ?? null,
                  score: candidateScore
                };
                rescueBestScore = candidateScore;
              }
            }
          }
          if (rescueBestCandidate) {
            bestAttachedBlockCandidate = rescueBestCandidate;
          }
        }
      }
      if (
        bestAttachedBlockCandidate?.transformedCoords
        && shouldPrioritizeDirectAttachmentExactContinuation(layoutGraph, bestAttachedBlockCandidate.meta ?? {
          attachmentAtomId: attachment.attachmentAtomId,
          parentAtomId: attachment.parentAtomId
        })
        && (bestAttachedBlockCandidate?.score.exactContinuationPenalty ?? 0) > IMPROVEMENT_EPSILON
      ) {
        const exactContinuationRescueCandidates = buildDirectAttachmentExactContinuationRescueCandidates(
          layoutGraph,
          coords,
          bestAttachedBlockCandidate.transformedCoords,
          bestAttachedBlockCandidate.meta ?? {
            attachmentAtomId: attachment.attachmentAtomId,
            parentAtomId: attachment.parentAtomId
          },
          bondLength
        );
        if (exactContinuationRescueCandidates.length > 0) {
          const rescueBestCandidate = pickBestAttachedBlockOrientation(
            [
              {
                transformedCoords: bestAttachedBlockCandidate.transformedCoords,
                meta: bestAttachedBlockCandidate.meta ?? {
                  attachmentAtomId: attachment.attachmentAtomId,
                  parentAtomId: attachment.parentAtomId
                }
              },
              ...exactContinuationRescueCandidates
            ],
            adjacency,
            layoutGraph.canonicalAtomRank,
            coords,
            primaryNonRingAtomIds,
            placedAtomIds,
            bondLength,
            layoutGraph,
            macrocycleBranchConstraints,
            {
              forceFullScoring: true,
              disableBeamReduction: true,
              placementContext: state.branchPlacementContext
            }
          );
          if (rescueBestCandidate) {
            bestAttachedBlockCandidate = rescueBestCandidate;
          }
        }
      }
      const bestAttachedBlock = bestAttachedBlockCandidate?.transformedCoords ?? null;
      if (!bestAttachedBlock) {
        remainingAfterAttachments.push(pendingRingSystem);
        continue;
      }
      for (const [atomId, position] of bestAttachedBlock) {
        coords.set(atomId, position);
        placedAtomIds.add(atomId);
      }
      markMixedBranchPlacementContextDirty(state);
      placedRingSystemIds.add(pendingRingSystem.ringSystem.id);
      assignBondValidationClass(layoutGraph, pendingRingSystem.ringSystem.atomIds, blockLayout.validationClass, bondValidationClasses);
      progressed = true;
    }
    pendingRingSystems = remainingAfterAttachments;
  }

  state.pendingRingSystems = pendingRingSystems;
}

/**
 * Finalizes mixed-family placement by placing remaining non-ring atoms and
 * returning the assembled mixed-family result.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, string[]>} adjacency - Component adjacency map.
 * @param {number} bondLength - Target bond length.
 * @param {object} state - Mutable mixed-family placement state.
 * @returns {{family: string, supported: boolean, atomIds: string[], coords: Map<string, {x: number, y: number}>, bondValidationClasses: Map<string, 'planar'|'bridged'>}} Final mixed placement result.
 */
function finalizeMixedPlacement(layoutGraph, adjacency, bondLength, state) {
  const { participantAtomIds, coords, placedAtomIds, bondValidationClasses, nonRingAtomIds, primaryNonRingAtomIds, deferredHydrogenAtomIds } = state;

  placeMixedBranches(layoutGraph, adjacency, bondLength, state, primaryNonRingAtomIds);
  if ((state.pendingRingSystems?.length ?? 0) > 0) {
    attachPendingRingSystems(layoutGraph, adjacency, bondLength, state);
  }
  snapExactVisibleTrigonalContinuations(layoutGraph, coords, participantAtomIds, bondLength);
  markMixedBranchPlacementContextDirty(state);
  snapExactSharedJunctionTerminalLeaves(layoutGraph, coords, bondLength);
  markMixedBranchPlacementContextDirty(state);
  if (deferredHydrogenAtomIds.size > 0) {
    placeMixedBranches(layoutGraph, adjacency, bondLength, state, deferredHydrogenAtomIds);
  }
  for (const atomId of nonRingAtomIds) {
    if (coords.has(atomId)) {
      placedAtomIds.add(atomId);
    }
  }

  const supported = [...participantAtomIds].every(atomId => coords.has(atomId));
  return {
    family: 'mixed',
    supported,
    atomIds: [...participantAtomIds],
    coords,
    bondValidationClasses: assignBondValidationClass(layoutGraph, participantAtomIds, 'planar', bondValidationClasses, { overwrite: false })
  };
}

/**
 * Places a mixed component by selecting a root scaffold, growing acyclic
 * connectors from it, and attaching secondary ring systems once they become
 * reachable from the placed region.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {object} component - Connected-component descriptor.
 * @param {Map<string, string[]>} adjacency - Component adjacency map.
 * @param {object} scaffoldPlan - Scaffold plan.
 * @param {number} bondLength - Target bond length.
 * @param {{conservativeAttachmentScoring?: boolean}|null} [options] - Optional mixed-family placement overrides.
 * @returns {{family: string, supported: boolean, atomIds: string[], coords: Map<string, {x: number, y: number}>, bondValidationClasses: Map<string, 'planar'|'bridged'>}} Mixed placement result.
 */
export function layoutMixedFamily(layoutGraph, component, adjacency, scaffoldPlan, bondLength, options = null) {
  const initialization = initializeRootScaffold(layoutGraph, component, adjacency, scaffoldPlan, bondLength, options);
  if (initialization.finalResult) {
    return initialization.finalResult;
  }

  attachPendingRingSystems(layoutGraph, adjacency, bondLength, initialization.state);
  return finalizeMixedPlacement(layoutGraph, adjacency, bondLength, initialization.state);
}

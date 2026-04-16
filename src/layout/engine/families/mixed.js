/** @module families/mixed */

import { angleOf, centroid, fromAngle, sub, add, rotate } from '../geometry/vec2.js';
import { computeBounds } from '../geometry/bounds.js';
import { alignCoordsToFixed } from '../geometry/transforms.js';
import { transformAttachedBlock } from '../placement/linkers.js';
import { auditLayout } from '../audit/audit.js';
import { assignBondValidationClass, resolvePlacementValidationClass } from '../placement/bond-validation.js';
import { chooseAttachmentAngle, placeRemainingBranches } from '../placement/substituents.js';
import { findSevereOverlaps, measureFocusedPlacementCost, measureLayoutCost } from '../audit/invariants.js';
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
const MAX_RING_LINKER_ATOMS = 3;

function compareCanonicalIds(firstAtomId, secondAtomId, canonicalAtomRank) {
  const firstRank = canonicalAtomRank.get(firstAtomId) ?? Number.MAX_SAFE_INTEGER;
  const secondRank = canonicalAtomRank.get(secondAtomId) ?? Number.MAX_SAFE_INTEGER;
  return firstRank - secondRank || String(firstAtomId).localeCompare(String(secondAtomId), 'en', { numeric: true });
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
  return { rings, ringAdj, ringConnectionByPair };
}

function ringSystemConnectionKinds(layoutGraph, ringSystem) {
  const { connections } = ringSystemDescriptors(layoutGraph, ringSystem);
  return new Set(connections.map(connection => connection.kind).filter(Boolean));
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
  const atomIds = [...new Set([...firstCoords.keys(), ...secondCoords.keys()])]
    .sort((firstAtomId, secondAtomId) => compareCanonicalIds(firstAtomId, secondAtomId, canonicalAtomRank));
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

  const parentRingId = blockByRingId.get(blockConnection.firstRingId) === placedBlock.id
    ? blockConnection.firstRingId
    : blockConnection.secondRingId;
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
        const transformedCoords = transformAttachedBlock(
          childLayout.coords,
          sharedAtomId,
          sharedPosition,
          targetAngle,
          { mirror }
        );
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

function placeHybridBridgedBlock(layoutGraph, placedCoords, childBlock, childLayout, blockConnection, bondLength) {
  const sharedAtomIds = (blockConnection.sharedAtomIds ?? []).filter(atomId => placedCoords.has(atomId) && childLayout.coords.has(atomId));
  if (sharedAtomIds.length < 2) {
    return null;
  }

  const fixedCoords = new Map(sharedAtomIds.map(atomId => [atomId, placedCoords.get(atomId)]));
  const aligned = alignCoordsToFixed(childLayout.coords, childBlock.atomIds, fixedCoords);
  return {
    coords: aligned.coords,
    score: scoreHybridBlockPlacement(layoutGraph, aligned.coords, placedCoords, sharedAtomIds, bondLength)
  };
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
      const neighborLayout = layoutFusedFamily(
        neighborBlock.rings,
        neighborBlock.ringAdj,
        neighborBlock.ringConnectionByPair,
        bondLength,
        { layoutGraph, templateId: null }
      );
      if (!blockConnection || !neighborLayout || neighborLayout.coords.size !== neighborBlock.atomIds.length) {
        return null;
      }

      let placedCandidate = null;
      if (blockConnection.kind === 'spiro') {
        placedCandidate = placeHybridSpiroBlock(
          layoutGraph,
          coords,
          currentBlock,
          neighborBlock,
          neighborLayout,
          blockConnection,
          blockGraph.blockByRingId,
          bondLength
        );
      } else if (blockConnection.kind === 'bridged') {
        placedCandidate = placeHybridBridgedBlock(
          layoutGraph,
          coords,
          neighborBlock,
          neighborLayout,
          blockConnection,
          bondLength
        );
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

function isBetterRingSystemPlacement(candidatePlacement, incumbentPlacement, candidateAudit, incumbentAudit) {
  if (!candidatePlacement || !candidateAudit) {
    return false;
  }
  if (!incumbentPlacement || !incumbentAudit) {
    return true;
  }
  if (candidateAudit.severeOverlapCount !== incumbentAudit.severeOverlapCount) {
    return candidateAudit.severeOverlapCount < incumbentAudit.severeOverlapCount;
  }
  if (candidateAudit.bondLengthFailureCount !== incumbentAudit.bondLengthFailureCount) {
    return candidateAudit.bondLengthFailureCount < incumbentAudit.bondLengthFailureCount;
  }
  if (Math.abs(candidateAudit.maxBondLengthDeviation - incumbentAudit.maxBondLengthDeviation) > 1e-9) {
    return candidateAudit.maxBondLengthDeviation < incumbentAudit.maxBondLengthDeviation;
  }
  return candidatePlacement.placementMode !== incumbentPlacement.placementMode;
}

function isBetterBondFirstRingSystemPlacement(candidatePlacement, incumbentPlacement, candidateAudit, incumbentAudit) {
  if (!candidatePlacement || !candidateAudit) {
    return false;
  }
  if (!incumbentPlacement || !incumbentAudit) {
    return true;
  }
  if (candidateAudit.bondLengthFailureCount !== incumbentAudit.bondLengthFailureCount) {
    return candidateAudit.bondLengthFailureCount < incumbentAudit.bondLengthFailureCount;
  }
  if (Math.abs(candidateAudit.maxBondLengthDeviation - incumbentAudit.maxBondLengthDeviation) > 1e-9) {
    return candidateAudit.maxBondLengthDeviation < incumbentAudit.maxBondLengthDeviation;
  }
  if (candidateAudit.severeOverlapCount !== incumbentAudit.severeOverlapCount) {
    return candidateAudit.severeOverlapCount < incumbentAudit.severeOverlapCount;
  }
  return candidatePlacement.placementMode !== incumbentPlacement.placementMode;
}

function shouldTryCompactBridgedRingSystemRescue(ringSystem, templateId, audit) {
  if (templateId || !audit) {
    return false;
  }
  return (
    ringSystem.atomIds.length <= RING_SYSTEM_RESCUE_LIMITS.compactBridgedAtomCount
    && ringSystem.ringIds.length <= RING_SYSTEM_RESCUE_LIMITS.compactBridgedRingCount
    && (audit.severeOverlapCount > 0 || audit.bondLengthFailureCount > 0)
  );
}

function shouldTryBridgedRingSystemRescue(ringSystem, templateId, audit) {
  if (templateId || !audit) {
    return false;
  }
  return (
    ringSystem.atomIds.length >= RING_SYSTEM_RESCUE_LIMITS.bridgedTemplateMissAtomCount
    && ringSystem.ringIds.length >= RING_SYSTEM_RESCUE_LIMITS.bridgedTemplateMissRingCount
    && (audit.severeOverlapCount > 0 || audit.bondLengthFailureCount > 0)
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
  const { rings, ringAdj, ringConnectionByPair } = ringSystemAdjacency(layoutGraph, ringSystem);
  if (family === 'isolated-ring') {
    return wrapRingSystemPlacementResult(layoutGraph, ringSystem, family, layoutIsolatedRingFamily(rings[0], bondLength, { layoutGraph, templateId }), templateId);
  }
  if (family === 'macrocycle') {
    return wrapRingSystemPlacementResult(layoutGraph, ringSystem, family, layoutMacrocycleFamily(rings, bondLength, { layoutGraph, templateId }), templateId);
  }
  if (family === 'bridged') {
    const connectionKinds = ringSystemConnectionKinds(layoutGraph, ringSystem);
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
      if (isBetterBondFirstRingSystemPlacement(hybridRescuePlacement, bestPlacement, hybridRescueAudit, bestAudit)) {
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
      if (isBetterBondFirstRingSystemPlacement(fusedRescuePlacement, bestPlacement, fusedRescueAudit, bestAudit)) {
        bestPlacement = fusedRescuePlacement;
        bestAudit = fusedRescueAudit;
      }
    }

    if (!shouldTryBridgedRingSystemRescue(ringSystem, templateId, bestAudit)) {
      return bestPlacement;
    }

    const spiroRescuePlacement = wrapRingSystemPlacementResult(layoutGraph, ringSystem, family, layoutSpiroFamily(rings, ringAdj, ringConnectionByPair, bondLength, { layoutGraph, templateId }), templateId);
    const spiroRescueAudit = auditRingSystemPlacement(layoutGraph, ringSystem, spiroRescuePlacement, bondLength);
    return isBetterRingSystemPlacement(spiroRescuePlacement, bestPlacement, spiroRescueAudit, bestAudit)
      ? spiroRescuePlacement
      : bestPlacement;
  }
  if (family === 'fused') {
    if (shouldShortCircuitToFusedCageKk(ringSystem.atomIds.length, ringSystem.ringIds.length, templateId)) {
      return wrapRingSystemPlacementResult(
        layoutGraph,
        ringSystem,
        family,
        layoutFusedCageKamadaKawai(rings, bondLength, { layoutGraph, templateId })
          ?? layoutFusedFamily(rings, ringAdj, ringConnectionByPair, bondLength, { layoutGraph, templateId }),
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
    return wrapRingSystemPlacementResult(layoutGraph, ringSystem, family, layoutSpiroFamily(rings, ringAdj, ringConnectionByPair, bondLength, { layoutGraph, templateId }), templateId);
  }
  return null;
}

function findAttachmentBond(layoutGraph, ringSystem, placedAtomIds) {
  const ringAtomIdSet = new Set(ringSystem.atomIds);
  const orderedAtomIds = [...ringSystem.atomIds].sort((firstAtomId, secondAtomId) => compareCanonicalIds(firstAtomId, secondAtomId, layoutGraph.canonicalAtomRank));
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
      return {
        attachmentAtomId: atomId,
        parentAtomId: otherAtomId
      };
    }
  }
  return null;
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
 * Returns the bond object between two atom IDs when present.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {string} firstAtomId - First atom ID.
 * @param {string} secondAtomId - Second atom ID.
 * @returns {object|null} Matching bond or `null`.
 */
function bondBetweenAtomIds(layoutGraph, firstAtomId, secondAtomId) {
  const key = firstAtomId < secondAtomId ? `${firstAtomId}:${secondAtomId}` : `${secondAtomId}:${firstAtomId}`;
  return layoutGraph.bondByAtomPair.get(key) ?? null;
}

/**
 * Returns the preferred outward exit angle for a ring-system attachment atom.
 * Single-ring perimeter atoms should follow their local ring outward axis,
 * while fused/shared atoms fall back to the whole ring-system centroid.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Current coordinate map.
 * @param {object} ringSystem - Ring-system descriptor.
 * @param {string} attachmentAtomId - Attachment atom ID.
 * @returns {number|null} Preferred outward exit angle in radians.
 */
function preferredRingLinkerExitAngle(layoutGraph, coords, ringSystem, attachmentAtomId) {
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
  if (
    !ringSystemSupportsShortLinkerRoot(firstRingSystem, { allowFused: true }) ||
    !ringSystemSupportsShortLinkerRoot(secondRingSystem)
  ) {
    return false;
  }

  const pathAtomIds = [linker.firstAttachmentAtomId, ...linker.chainAtomIds, linker.secondAttachmentAtomId];
  for (let index = 0; index < pathAtomIds.length - 1; index++) {
    const bond = bondBetweenAtomIds(layoutGraph, pathAtomIds[index], pathAtomIds[index + 1]);
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
 * @param {Map<string, {x: number, y: number}>} blockCoords - Pending ring-system coordinates.
 * @param {number} bondLength - Target bond length.
 * @param {number} turnSign - Zigzag turn sign (`-1` or `1`).
 * @param {boolean} mirror - Whether to mirror the attached ring block.
 * @returns {Map<string, {x: number, y: number}>} Candidate linker plus ring coordinates.
 */
function buildRingLinkerCandidate(layoutGraph, coords, firstRingSystem, linker, blockCoords, bondLength, turnSign, mirror) {
  const firstAttachmentPosition = coords.get(linker.firstAttachmentAtomId);
  const exitAngle = preferredRingLinkerExitAngle(layoutGraph, coords, firstRingSystem, linker.firstAttachmentAtomId);
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

  const transformedRingCoords = transformAttachedBlock(blockCoords, linker.secondAttachmentAtomId, currentPosition, segmentAngles[segmentAngles.length - 1], { mirror });
  for (const [atomId, position] of transformedRingCoords) {
    candidateCoords.set(atomId, position);
  }
  return candidateCoords;
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
 * @returns {number} Candidate layout cost.
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
  branchConstraints = null
) {
  const candidateCoords = new Map([...coords.entries()].map(([atomId, position]) => [atomId, { ...position }]));
  const candidateSeedAtomIds = new Set(placedAtomIds);

  for (const [atomId, position] of transformedCoords) {
    candidateCoords.set(atomId, { ...position });
    candidateSeedAtomIds.add(atomId);
  }

  placeRemainingBranches(adjacency, canonicalAtomRank, candidateCoords, primaryNonRingAtomIds, [...candidateSeedAtomIds], bondLength, layoutGraph, branchConstraints);
  const changedAtomIds = [...candidateCoords.keys()].filter(atomId => !coords.has(atomId));
  if (changedAtomIds.length >= 12) {
    return measureFocusedPlacementCost(layoutGraph, candidateCoords, bondLength, changedAtomIds);
  }
  return measureLayoutCost(layoutGraph, candidateCoords, bondLength);
}

/**
 * Builds a cheap local prescore for one attached-block orientation before the
 * more expensive full branch-placement scoring runs.
 * @param {Map<string, {x: number, y: number}>} coords - Current coordinate map.
 * @param {Map<string, {x: number, y: number}>} transformedCoords - Candidate attached-block coordinates.
 * @param {number} bondLength - Target bond length.
 * @param {object} layoutGraph - Layout graph shell.
 * @returns {{coords: Map<string, {x: number, y: number}>, overlapCount: number, cost: number}} Prescored candidate snapshot.
 */
function preScoreAttachedBlockOrientation(coords, transformedCoords, bondLength, layoutGraph) {
  const candidateCoords = new Map([...coords.entries()].map(([atomId, position]) => [atomId, { ...position }]));
  for (const [atomId, position] of transformedCoords) {
    candidateCoords.set(atomId, { ...position });
  }
  const bounds = computeBounds(candidateCoords, [...candidateCoords.keys()]);
  return {
    coords: candidateCoords,
    overlapCount: findSevereOverlaps(layoutGraph, candidateCoords, bondLength).length,
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
    ...preScoreAttachedBlockOrientation(coords, candidate.transformedCoords, bondLength, layoutGraph)
  }));
  scoredCandidates.sort((firstCandidate, secondCandidate) => {
    if (firstCandidate.overlapCount !== secondCandidate.overlapCount) {
      return firstCandidate.overlapCount - secondCandidate.overlapCount;
    }
    if (Math.abs(firstCandidate.cost - secondCandidate.cost) > IMPROVEMENT_EPSILON) {
      return firstCandidate.cost - secondCandidate.cost;
    }
    return compareCoordMapsDeterministically(
      firstCandidate.transformedCoords,
      secondCandidate.transformedCoords,
      layoutGraph.canonicalAtomRank
    );
  });

  const [bestCandidate, secondCandidate] = scoredCandidates;
  if (!secondCandidate) {
    return [bestCandidate];
  }
  if (secondCandidate.overlapCount > bestCandidate.overlapCount || secondCandidate.cost - bestCandidate.cost > bondLength * 0.25) {
    return [bestCandidate];
  }
  return scoredCandidates.slice(0, Math.min(2, scoredCandidates.length));
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
 * @returns {{finalResult?: {family: string, supported: boolean, atomIds: string[], coords: Map<string, {x: number, y: number}>, bondValidationClasses: Map<string, 'planar'|'bridged'>}, state?: object}} Initialization result.
 */
function initializeRootScaffold(layoutGraph, component, adjacency, scaffoldPlan, bondLength) {
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
      pendingRingSystems
    }
  };
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
      let bestCandidateCost = Number.POSITIVE_INFINITY;
      const rawCandidates = [];
      for (const turnSign of turnSigns) {
        for (const mirror of [false, true]) {
          rawCandidates.push({
            transformedCoords: buildRingLinkerCandidate(layoutGraph, coords, firstRingSystem, linker, blockLayout.coords, bondLength, turnSign, mirror)
          });
        }
      }
      for (const candidate of selectAttachedBlockCandidates(rawCandidates, coords, bondLength, layoutGraph)) {
        const candidateCost = scoreAttachedBlockOrientation(
          adjacency,
          layoutGraph.canonicalAtomRank,
          coords,
          primaryNonRingAtomIds,
          placedAtomIds,
          candidate.transformedCoords,
          bondLength,
          layoutGraph,
          macrocycleBranchConstraints
        );
      if (
        candidateCost < bestCandidateCost - IMPROVEMENT_EPSILON
        || (
          Math.abs(candidateCost - bestCandidateCost) <= IMPROVEMENT_EPSILON
          && bestCandidateCoords
          && compareCoordMapsDeterministically(
            candidate.transformedCoords,
            bestCandidateCoords,
            layoutGraph.canonicalAtomRank
          ) < 0
        )
        || bestCandidateCoords == null
      ) {
        bestCandidateCost = candidateCost;
        bestCandidateCoords = candidate.transformedCoords;
      }
      }

      if (!bestCandidateCoords) {
        remainingAfterLinkers.push(pendingRingSystem);
        continue;
      }

      for (const [atomId, position] of bestCandidateCoords) {
        coords.set(atomId, position);
        placedAtomIds.add(atomId);
      }
      placedRingSystemIds.add(pendingRingSystem.ringSystem.id);
      assignBondValidationClass(layoutGraph, pendingRingSystem.ringSystem.atomIds, blockLayout.validationClass, bondValidationClasses);
      progressed = true;
    }
    pendingRingSystems = remainingAfterLinkers;

    const sizeBeforeBranches = coords.size;
    placeRemainingBranches(adjacency, layoutGraph.canonicalAtomRank, coords, primaryNonRingAtomIds, [...placedAtomIds], bondLength, layoutGraph, macrocycleBranchConstraints);
    for (const atomId of primaryNonRingAtomIds) {
      if (coords.has(atomId)) {
        placedAtomIds.add(atomId);
      }
    }
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
      const placedCentroid = centroid([...placedAtomIds].map(atomId => coords.get(atomId)).filter(Boolean));
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
      const targetPosition = add(parentPosition, fromAngle(attachmentAngle, bondLength));
      const candidateOrientations = selectAttachedBlockCandidates(
        [
          {
            transformedCoords: transformAttachedBlock(blockLayout.coords, attachment.attachmentAtomId, targetPosition, attachmentAngle)
          },
          {
            transformedCoords: transformAttachedBlock(blockLayout.coords, attachment.attachmentAtomId, targetPosition, attachmentAngle, { mirror: true })
          }
        ],
        coords,
        bondLength,
        layoutGraph
      );
      let bestAttachedBlock = null;
      let bestAttachedBlockCost = Number.POSITIVE_INFINITY;
      for (const candidate of candidateOrientations) {
        const candidateCost = scoreAttachedBlockOrientation(
          adjacency,
          layoutGraph.canonicalAtomRank,
          coords,
          primaryNonRingAtomIds,
          placedAtomIds,
          candidate.transformedCoords,
          bondLength,
          layoutGraph,
          macrocycleBranchConstraints
        );
        if (
          candidateCost < bestAttachedBlockCost - IMPROVEMENT_EPSILON
          || (
            Math.abs(candidateCost - bestAttachedBlockCost) <= IMPROVEMENT_EPSILON
            && bestAttachedBlock
            && compareCoordMapsDeterministically(
              candidate.transformedCoords,
              bestAttachedBlock,
              layoutGraph.canonicalAtomRank
            ) < 0
          )
          || bestAttachedBlock == null
        ) {
          bestAttachedBlockCost = candidateCost;
          bestAttachedBlock = candidate.transformedCoords;
        }
      }
      if (!bestAttachedBlock) {
        remainingAfterAttachments.push(pendingRingSystem);
        continue;
      }
      for (const [atomId, position] of bestAttachedBlock) {
        coords.set(atomId, position);
        placedAtomIds.add(atomId);
      }
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
  const { participantAtomIds, coords, placedAtomIds, bondValidationClasses, macrocycleBranchConstraints, nonRingAtomIds, primaryNonRingAtomIds, deferredHydrogenAtomIds } = state;

  placeRemainingBranches(adjacency, layoutGraph.canonicalAtomRank, coords, primaryNonRingAtomIds, [...placedAtomIds], bondLength, layoutGraph, macrocycleBranchConstraints);
  for (const atomId of primaryNonRingAtomIds) {
    if (coords.has(atomId)) {
      placedAtomIds.add(atomId);
    }
  }
  if ((state.pendingRingSystems?.length ?? 0) > 0) {
    attachPendingRingSystems(layoutGraph, adjacency, bondLength, state);
  }
  if (deferredHydrogenAtomIds.size > 0) {
    placeRemainingBranches(adjacency, layoutGraph.canonicalAtomRank, coords, deferredHydrogenAtomIds, [...placedAtomIds], bondLength, layoutGraph, macrocycleBranchConstraints);
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
 * @returns {{family: string, supported: boolean, atomIds: string[], coords: Map<string, {x: number, y: number}>, bondValidationClasses: Map<string, 'planar'|'bridged'>}} Mixed placement result.
 */
export function layoutMixedFamily(layoutGraph, component, adjacency, scaffoldPlan, bondLength) {
  const initialization = initializeRootScaffold(layoutGraph, component, adjacency, scaffoldPlan, bondLength);
  if (initialization.finalResult) {
    return initialization.finalResult;
  }

  attachPendingRingSystems(layoutGraph, adjacency, bondLength, initialization.state);
  return finalizeMixedPlacement(layoutGraph, adjacency, bondLength, initialization.state);
}

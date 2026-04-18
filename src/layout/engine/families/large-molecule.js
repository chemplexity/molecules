/** @module families/large-molecule */

import { add, angleOf, centroid, normalize, rotate, sub } from '../geometry/vec2.js';
import { computeBounds } from '../geometry/bounds.js';
import { buildAtomGrid, computeSubtreeOverlapCost } from '../audit/invariants.js';
import { auditLayout } from '../audit/audit.js';
import { compareCanonicalAtomIds } from '../topology/canonical-order.js';
import { chooseAttachmentAngle } from '../placement/branch-placement.js';
import { refineStitchedBlock } from '../placement/block-stitching.js';
import { assignBondValidationClass, mergeBondValidationClasses } from '../placement/bond-validation.js';
import { buildSliceAdjacency, createAtomSlice, layoutAtomSlice } from '../placement/atom-slice.js';

const LARGE_MOLECULE_LAYOUT_LIMITS = Object.freeze({
  rootRetryOverlapFloor: 4,
  rootRetryBlockCountFloor: 6,
  rootRetryRepulsionMoveCeiling: 64,
  maxAlternateRootCandidates: 1
});

const PACKING_ROTATION_ANGLES = Object.freeze([
  -Math.PI / 2,
  -Math.PI / 3,
  -Math.PI / 6,
  Math.PI / 6,
  Math.PI / 3,
  Math.PI / 2
]);
const OVERLAP_RESOLUTION_ROTATION_ANGLES = Object.freeze([
  ...PACKING_ROTATION_ANGLES,
  Math.PI
]);

function countHeavyAtoms(layoutGraph, atomIds) {
  return atomIds.filter(atomId => layoutGraph.sourceMolecule.atoms.get(atomId)?.name !== 'H').length;
}

/**
 * Counts the visible participant atoms that still contribute to block layout cost.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {string[]} atomIds - Candidate atom IDs.
 * @returns {number} Visible participant atom count.
 */
function countParticipantAtoms(layoutGraph, atomIds) {
  return atomIds.filter(atomId => {
    const atom = layoutGraph.atoms.get(atomId);
    return atom && !(layoutGraph.options.suppressH && atom.element === 'H' && !atom.visible);
  }).length;
}

function participantThresholdFor(threshold) {
  return Math.max(48, Math.floor(threshold.heavyAtomCount * 0.8));
}

function countRingSystems(layoutGraph, atomIds) {
  const atomIdSet = new Set(atomIds);
  return layoutGraph.ringSystems.filter(ringSystem => ringSystem.atomIds.every(atomId => atomIdSet.has(atomId))).length;
}

function isCuttableBond(layoutGraph, bond, atomIdSet) {
  if (!atomIdSet.has(bond.a) || !atomIdSet.has(bond.b)) {
    return false;
  }
  if (bond.kind !== 'covalent' || bond.order !== 1 || bond.aromatic || bond.inRing) {
    return false;
  }
  const firstAtom = layoutGraph.sourceMolecule.atoms.get(bond.a);
  const secondAtom = layoutGraph.sourceMolecule.atoms.get(bond.b);
  if (!firstAtom || !secondAtom || firstAtom.name === 'H' || secondAtom.name === 'H') {
    return false;
  }
  return true;
}

function splitBlockAtomIds(layoutGraph, atomIds, blockedBondId) {
  const adjacency = buildSliceAdjacency(layoutGraph, atomIds, {
    includeBond(bond) {
      return bond.id !== blockedBondId;
    }
  });
  const startAtomId = atomIds[0];
  const visited = new Set([startAtomId]);
  const queue = [startAtomId];
  let queueHead = 0;
  while (queueHead < queue.length) {
    const atomId = queue[queueHead++];
    for (const neighborAtomId of adjacency.get(atomId) ?? []) {
      if (visited.has(neighborAtomId)) {
        continue;
      }
      visited.add(neighborAtomId);
      queue.push(neighborAtomId);
    }
  }
  if (visited.size === atomIds.length) {
    return null;
  }
  const leftAtomIds = atomIds.filter(atomId => visited.has(atomId));
  const rightAtomIds = atomIds.filter(atomId => !visited.has(atomId));
  return [leftAtomIds, rightAtomIds];
}

/**
 * Chooses the best cut bond for a large block using heavy, ring, and visible
 * participant balance so explicit-H-rich peptide fragments keep splitting.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {string[]} atomIds - Candidate block atom IDs.
 * @param {{heavyAtomCount: number, ringSystemCount: number}} threshold - Large-molecule thresholds.
 * @returns {{bond: object, leftAtomIds: string[], rightAtomIds: string[], score: number}|null} Best cut candidate.
 */
function selectBestCut(layoutGraph, atomIds, threshold) {
  const atomIdSet = new Set(atomIds);
  const candidates = [];
  const visitedBondIds = new Set();

  for (const atomId of atomIds) {
    for (const bond of layoutGraph.bondsByAtomId.get(atomId) ?? []) {
      if (visitedBondIds.has(bond.id)) {
        continue;
      }
      visitedBondIds.add(bond.id);
      if (!isCuttableBond(layoutGraph, bond, atomIdSet)) {
        continue;
      }
      const split = splitBlockAtomIds(layoutGraph, atomIds, bond.id);
      if (!split) {
        continue;
      }
      const [leftAtomIds, rightAtomIds] = split;
      const leftHeavyCount = countHeavyAtoms(layoutGraph, leftAtomIds);
      const rightHeavyCount = countHeavyAtoms(layoutGraph, rightAtomIds);
      if (leftHeavyCount < 3 || rightHeavyCount < 3) {
        continue;
      }
      const leftParticipantCount = countParticipantAtoms(layoutGraph, leftAtomIds);
      const rightParticipantCount = countParticipantAtoms(layoutGraph, rightAtomIds);
      const leftRingSystems = countRingSystems(layoutGraph, leftAtomIds);
      const rightRingSystems = countRingSystems(layoutGraph, rightAtomIds);
      const participantThreshold = participantThresholdFor(threshold);
      const oversizePenalty =
        Math.max(0, leftHeavyCount - threshold.heavyAtomCount) +
        Math.max(0, rightHeavyCount - threshold.heavyAtomCount) +
        Math.max(0, leftParticipantCount - participantThreshold) +
        Math.max(0, rightParticipantCount - participantThreshold);
      const balancePenalty = Math.abs(leftParticipantCount - rightParticipantCount);
      const ringBonus = leftRingSystems > 0 && rightRingSystems > 0 ? 100 : 0;
      const score = ringBonus - oversizePenalty * 10 - balancePenalty;
      candidates.push({
        bond,
        leftAtomIds,
        rightAtomIds,
        score
      });
    }
  }

  candidates.sort((firstCandidate, secondCandidate) => {
    if (secondCandidate.score !== firstCandidate.score) {
      return secondCandidate.score - firstCandidate.score;
    }
    return String(firstCandidate.bond.id).localeCompare(String(secondCandidate.bond.id), 'en', { numeric: true });
  });

  return candidates[0] ?? null;
}

/**
 * Creates a balanced large-molecule block descriptor.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {string[]} atomIds - Block atom IDs.
 * @param {string} id - Synthetic block ID.
 * @returns {{id: string, atomIds: string[], canonicalSignature: string, heavyAtomCount: number, participantCount: number, ringSystemCount: number}} Block descriptor.
 */
function createBlock(layoutGraph, atomIds, id) {
  const sortedAtomIds = [...atomIds].sort((firstAtomId, secondAtomId) => compareCanonicalAtomIds(firstAtomId, secondAtomId, layoutGraph.canonicalAtomRank));
  const slice = createAtomSlice(layoutGraph, sortedAtomIds, id);
  return {
    ...slice,
    heavyAtomCount: countHeavyAtoms(layoutGraph, sortedAtomIds),
    participantCount: countParticipantAtoms(layoutGraph, sortedAtomIds),
    ringSystemCount: countRingSystems(layoutGraph, sortedAtomIds)
  };
}

/**
 * Returns whether a large block still needs to be partitioned further.
 * @param {{heavyAtomCount: number, participantCount: number, ringSystemCount: number}} block - Block descriptor.
 * @param {{heavyAtomCount: number, ringSystemCount: number}} threshold - Large-molecule thresholds.
 * @returns {boolean} True when the block is still oversized.
 */
function isOversized(block, threshold) {
  return (
    block.heavyAtomCount > threshold.heavyAtomCount
    || block.participantCount > participantThresholdFor(threshold)
    || block.ringSystemCount > threshold.ringSystemCount
  );
}

function partitionBlocks(layoutGraph, component, threshold) {
  let nextBlockId = 0;
  let blocks = [createBlock(layoutGraph, component.atomIds, `block:${nextBlockId++}`)];
  const cutBonds = [];
  let changed = true;

  while (changed) {
    changed = false;
    const nextBlocks = [];

    for (const block of blocks) {
      if (!isOversized(block, threshold)) {
        nextBlocks.push(block);
        continue;
      }
      const selectedCut = selectBestCut(layoutGraph, block.atomIds, threshold);
      if (!selectedCut) {
        nextBlocks.push(block);
        continue;
      }
      const leftBlock = createBlock(layoutGraph, selectedCut.leftAtomIds, `block:${nextBlockId++}`);
      const rightBlock = createBlock(layoutGraph, selectedCut.rightAtomIds, `block:${nextBlockId++}`);
      nextBlocks.push(leftBlock, rightBlock);
      cutBonds.push({
        id: selectedCut.bond.id,
        firstAtomId: selectedCut.bond.a,
        secondAtomId: selectedCut.bond.b
      });
      changed = true;
    }

    blocks = nextBlocks;
  }

  return { blocks, cutBonds };
}

function rankRootBlocks(blocks) {
  return [...blocks].sort((firstBlock, secondBlock) => {
    if (secondBlock.ringSystemCount !== firstBlock.ringSystemCount) {
      return secondBlock.ringSystemCount - firstBlock.ringSystemCount;
    }
    if (secondBlock.heavyAtomCount !== firstBlock.heavyAtomCount) {
      return secondBlock.heavyAtomCount - firstBlock.heavyAtomCount;
    }
    return firstBlock.canonicalSignature.localeCompare(secondBlock.canonicalSignature, 'en', { numeric: true });
  });
}

function buildBlockAdjacency(blocks, cutBonds) {
  const adjacency = new Map(blocks.map(block => [block.id, []]));
  const blockIdByAtomId = new Map();
  for (const block of blocks) {
    for (const atomId of block.atomIds) {
      blockIdByAtomId.set(atomId, block.id);
    }
  }
  for (const cutBond of cutBonds) {
    const firstBlockId = blockIdByAtomId.get(cutBond.firstAtomId);
    const secondBlockId = blockIdByAtomId.get(cutBond.secondAtomId);
    if (!firstBlockId || !secondBlockId || firstBlockId === secondBlockId) {
      continue;
    }
    adjacency.get(firstBlockId)?.push({ neighborBlockId: secondBlockId, cutBond });
    adjacency.get(secondBlockId)?.push({ neighborBlockId: firstBlockId, cutBond });
  }
  return adjacency;
}

/**
 * Returns the visible participant atom IDs for large-molecule placement.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {string[]} atomIds - Candidate atom IDs.
 * @returns {string[]} Visible participant atom IDs.
 */
function participantAtomIdsFor(layoutGraph, atomIds) {
  return atomIds.filter(atomId => {
    const atom = layoutGraph.atoms.get(atomId);
    return atom && !(layoutGraph.options.suppressH && atom.element === 'H' && !atom.visible);
  });
}

/**
 * Returns a breadth-first traversal order rooted at the requested attachment atom.
 * @param {Map<string, string[]>} adjacency - Slice adjacency map.
 * @param {string[]} atomIds - Traversal atom IDs.
 * @param {string|null} startAtomId - Preferred traversal root.
 * @returns {string[]} BFS traversal order.
 */
function breadthFirstOrder(adjacency, atomIds, startAtomId) {
  const remainingAtomIds = atomIds.filter(Boolean);
  if (remainingAtomIds.length === 0) {
    return [];
  }

  const atomIdSet = new Set(remainingAtomIds);
  const visited = new Set();
  const order = [];
  const seedSet = new Set();
  const seeds = [];
  if (startAtomId && atomIdSet.has(startAtomId)) {
    seeds.push(startAtomId);
    seedSet.add(startAtomId);
  }
  for (const atomId of remainingAtomIds) {
    if (!seedSet.has(atomId)) {
      seeds.push(atomId);
      seedSet.add(atomId);
    }
  }

  for (const seedAtomId of seeds) {
    if (visited.has(seedAtomId)) {
      continue;
    }
    const queue = [seedAtomId];
    visited.add(seedAtomId);
    let queueHead = 0;

    while (queueHead < queue.length) {
      const atomId = queue[queueHead++];
      order.push(atomId);
      for (const neighborAtomId of adjacency.get(atomId) ?? []) {
        if (!atomIdSet.has(neighborAtomId) || visited.has(neighborAtomId)) {
          continue;
        }
        visited.add(neighborAtomId);
        queue.push(neighborAtomId);
      }
    }
  }

  return order;
}

/**
 * Places a block on a simple horizontal line using BFS connectivity order.
 * @param {Map<string, string[]>} adjacency - Slice adjacency map.
 * @param {string[]} atomIds - Block atom IDs.
 * @param {string|null} startAtomId - Preferred BFS root / attachment atom.
 * @param {number} bondLength - Target bond length.
 * @returns {Map<string, {x: number, y: number}>} Linear fallback coordinates.
 */
function layoutLinearFallbackCoords(adjacency, atomIds, startAtomId, bondLength) {
  const order = breadthFirstOrder(adjacency, atomIds, startAtomId);
  const coords = new Map();
  for (let index = 0; index < order.length; index++) {
    coords.set(order[index], { x: index * bondLength, y: 0 });
  }
  return coords;
}

/**
 * Returns the overlap distances between two block bounding boxes.
 * @param {{minX: number, maxX: number, minY: number, maxY: number}|null} firstBounds - First bounds.
 * @param {{minX: number, maxX: number, minY: number, maxY: number}|null} secondBounds - Second bounds.
 * @returns {{overlapX: number, overlapY: number}} Overlap distances; non-positive means no overlap.
 */
function measureBlockOverlap(firstBounds, secondBounds) {
  if (!firstBounds || !secondBounds) {
    return { overlapX: 0, overlapY: 0 };
  }
  return {
    overlapX: Math.min(firstBounds.maxX, secondBounds.maxX) - Math.max(firstBounds.minX, secondBounds.minX),
    overlapY: Math.min(firstBounds.maxY, secondBounds.maxY) - Math.max(firstBounds.minY, secondBounds.minY)
  };
}

/**
 * Returns a rigid translation direction that pushes one block away from another.
 * @param {{centerX: number, centerY: number}} movableBounds - Bounds for the movable block.
 * @param {{centerX: number, centerY: number}} fixedBounds - Bounds for the fixed block.
 * @returns {{x: number, y: number}} Unit translation direction.
 */
function overlapPushDirection(movableBounds, fixedBounds) {
  const direction = normalize({
    x: movableBounds.centerX - fixedBounds.centerX,
    y: movableBounds.centerY - fixedBounds.centerY
  });
  if (Math.hypot(direction.x, direction.y) <= 1e-12) {
    return { x: 1, y: 0 };
  }
  return direction;
}

function blockOverlapPenalty(firstBounds, secondBounds) {
  const { overlapX, overlapY } = measureBlockOverlap(firstBounds, secondBounds);
  return overlapX > 0 && overlapY > 0 ? overlapX * overlapY : 0;
}

function blockBoundsArea(boundsByBlockId) {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;

  for (const bounds of boundsByBlockId.values()) {
    if (!bounds) {
      continue;
    }
    minX = Math.min(minX, bounds.minX);
    maxX = Math.max(maxX, bounds.maxX);
    minY = Math.min(minY, bounds.minY);
    maxY = Math.max(maxY, bounds.maxY);
  }

  if (!Number.isFinite(minX) || !Number.isFinite(minY)) {
    return 0;
  }
  return (maxX - minX) * (maxY - minY);
}

function totalBlockOverlapPenalty(blockIds, boundsByBlockId) {
  let penalty = 0;
  for (let firstIndex = 0; firstIndex < blockIds.length; firstIndex++) {
    for (let secondIndex = firstIndex + 1; secondIndex < blockIds.length; secondIndex++) {
      penalty += blockOverlapPenalty(boundsByBlockId.get(blockIds[firstIndex]), boundsByBlockId.get(blockIds[secondIndex]));
    }
  }
  return penalty;
}

function trackedBlockOverlapPenalty(blockIds, boundsByBlockId, trackedBlockIdSet, overrideBoundsByBlockId = null) {
  let penalty = 0;
  for (let firstIndex = 0; firstIndex < blockIds.length; firstIndex++) {
    for (let secondIndex = firstIndex + 1; secondIndex < blockIds.length; secondIndex++) {
      const firstBlockId = blockIds[firstIndex];
      const secondBlockId = blockIds[secondIndex];
      if (!trackedBlockIdSet.has(firstBlockId) && !trackedBlockIdSet.has(secondBlockId)) {
        continue;
      }
      penalty += blockOverlapPenalty(
        overrideBoundsByBlockId?.get(firstBlockId) ?? boundsByBlockId.get(firstBlockId),
        overrideBoundsByBlockId?.get(secondBlockId) ?? boundsByBlockId.get(secondBlockId)
      );
    }
  }
  return penalty;
}

function isVisiblePackingAtom(layoutGraph, atomId) {
  const atom = layoutGraph.atoms.get(atomId);
  if (!atom) {
    return false;
  }
  if (layoutGraph.options.suppressH && atom.element === 'H') {
    return false;
  }
  return true;
}

function atomIdsForBlocks(blockAtomIdsById, blockIds) {
  const atomIds = [];
  for (const blockId of blockIds) {
    atomIds.push(...(blockAtomIdsById.get(blockId) ?? []));
  }
  return atomIds;
}

function totalAtomClashPenalty(layoutGraph, coords, blockAtomIdsById, bondLength, atomGrid) {
  let penalty = 0;
  for (const atomIds of blockAtomIdsById.values()) {
    penalty += computeSubtreeOverlapCost(layoutGraph, coords, atomIds, null, bondLength, { atomGrid });
  }
  return penalty / 2;
}

function updateAtomGridForMovedAtoms(layoutGraph, atomGrid, previousCoords, nextCoords, movedAtomIds) {
  const nextAtomGrid = atomGrid.clone();
  for (const atomId of movedAtomIds) {
    if (!isVisiblePackingAtom(layoutGraph, atomId)) {
      continue;
    }
    const previousPosition = previousCoords.get(atomId);
    if (previousPosition) {
      nextAtomGrid.remove(atomId, previousPosition);
    }
  }
  for (const atomId of movedAtomIds) {
    if (!isVisiblePackingAtom(layoutGraph, atomId)) {
      continue;
    }
    const nextPosition = nextCoords.get(atomId);
    if (nextPosition) {
      nextAtomGrid.insert(atomId, nextPosition);
    }
  }
  return nextAtomGrid;
}

function buildPackingState(layoutGraph, coords, blockAtomIdsById, bondLength, options = {}) {
  const blockIds = [...blockAtomIdsById.keys()];
  const boundsByBlockId = new Map();
  for (const blockId of blockIds) {
    boundsByBlockId.set(blockId, computeBounds(coords, blockAtomIdsById.get(blockId) ?? []));
  }
  const atomGrid = options.includeAtomClashPenalty ? buildAtomGrid(layoutGraph, coords, bondLength) : null;
  return {
    coords,
    blockIds,
    boundsByBlockId,
    area: blockBoundsArea(boundsByBlockId),
    overlapPenalty: totalBlockOverlapPenalty(blockIds, boundsByBlockId),
    atomGrid,
    atomClashPenalty: atomGrid ? totalAtomClashPenalty(layoutGraph, coords, blockAtomIdsById, bondLength, atomGrid) : 0
  };
}

function updatePackingState(layoutGraph, packingState, coords, affectedBlockIds, blockAtomIdsById, bondLength) {
  const affectedBlockIdSet = new Set(affectedBlockIds);
  if (affectedBlockIdSet.size === 0) {
    return {
      ...packingState,
      coords
    };
  }

  const affectedBoundsByBlockId = new Map();
  for (const blockId of affectedBlockIds) {
    affectedBoundsByBlockId.set(blockId, computeBounds(coords, blockAtomIdsById.get(blockId) ?? []));
  }
  const nextBoundsByBlockId = new Map(packingState.boundsByBlockId);
  for (const [blockId, bounds] of affectedBoundsByBlockId) {
    nextBoundsByBlockId.set(blockId, bounds);
  }

  const currentAffectedPenalty = trackedBlockOverlapPenalty(
    packingState.blockIds,
    packingState.boundsByBlockId,
    affectedBlockIdSet
  );
  const nextAffectedPenalty = trackedBlockOverlapPenalty(
    packingState.blockIds,
    packingState.boundsByBlockId,
    affectedBlockIdSet,
    affectedBoundsByBlockId
  );
  let nextAtomGrid = packingState.atomGrid;
  let nextAtomClashPenalty = packingState.atomClashPenalty;

  if (packingState.atomGrid) {
    const affectedAtomIds = atomIdsForBlocks(blockAtomIdsById, affectedBlockIds);
    nextAtomGrid = updateAtomGridForMovedAtoms(layoutGraph, packingState.atomGrid, packingState.coords, coords, affectedAtomIds);
    const currentAffectedAtomClashPenalty = computeSubtreeOverlapCost(layoutGraph, packingState.coords, affectedAtomIds, null, bondLength, {
      atomGrid: packingState.atomGrid
    });
    const nextAffectedAtomClashPenalty = computeSubtreeOverlapCost(layoutGraph, coords, affectedAtomIds, null, bondLength, {
      atomGrid: nextAtomGrid
    });
    nextAtomClashPenalty = packingState.atomClashPenalty - currentAffectedAtomClashPenalty + nextAffectedAtomClashPenalty;
  }

  return {
    coords,
    blockIds: packingState.blockIds,
    boundsByBlockId: nextBoundsByBlockId,
    area: blockBoundsArea(nextBoundsByBlockId),
    overlapPenalty: packingState.overlapPenalty - currentAffectedPenalty + nextAffectedPenalty,
    atomGrid: nextAtomGrid,
    atomClashPenalty: nextAtomClashPenalty
  };
}

function packingCostForState(packingState, bondLength, overlapPenaltyMultiplier) {
  return packingState.area + packingState.overlapPenalty * bondLength * overlapPenaltyMultiplier + packingState.atomClashPenalty * (overlapPenaltyMultiplier / 50);
}

function buildBlockSubtreeMaps(blockAtomIdsById, childBlocksByParentId) {
  const subtreeBlockIdsByBlockId = new Map();
  const subtreeAtomIdsByBlockId = new Map();

  function visit(blockId) {
    if (subtreeBlockIdsByBlockId.has(blockId)) {
      return;
    }

    const subtreeBlockIds = [blockId];
    const subtreeAtomIds = [...(blockAtomIdsById.get(blockId) ?? [])];
    for (const childBlockId of childBlocksByParentId.get(blockId) ?? []) {
      visit(childBlockId);
      subtreeBlockIds.push(...(subtreeBlockIdsByBlockId.get(childBlockId) ?? []));
      subtreeAtomIds.push(...(subtreeAtomIdsByBlockId.get(childBlockId) ?? []));
    }
    subtreeBlockIdsByBlockId.set(blockId, subtreeBlockIds);
    subtreeAtomIdsByBlockId.set(blockId, subtreeAtomIds);
  }

  for (const blockId of blockAtomIdsById.keys()) {
    visit(blockId);
  }

  return { subtreeBlockIdsByBlockId, subtreeAtomIdsByBlockId };
}

/**
 * Builds rigid subtree cleanup descriptors for non-root stitched blocks so
 * overlap cleanup can rotate whole large-molecule subtrees instead of nudging
 * individual backbone atoms.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, string[]>} blockAtomIdsById - Placed block atom IDs by block ID.
 * @param {Map<string, string[]>} childBlocksByParentId - Child block IDs by parent block ID.
 * @param {Map<string, string>} attachmentAtomByBlockId - Parent attachment atom ID by child block ID.
 * @param {Map<string, string>} rootAtomByBlockId - Child attachment atom ID by child block ID.
 * @returns {Map<string, Array<{anchorAtomId: string, rootAtomId: string, subtreeAtomIds: string[]}>>} Cleanup descriptors keyed by member atom ID.
 */
function buildCleanupRigidSubtreesByAtomId(layoutGraph, blockAtomIdsById, childBlocksByParentId, attachmentAtomByBlockId, rootAtomByBlockId) {
  const descriptorsByAtomId = new Map();
  const totalPlacedAtomCount = [...blockAtomIdsById.values()].reduce((sum, atomIds) => sum + atomIds.length, 0);
  const { subtreeAtomIdsByBlockId } = buildBlockSubtreeMaps(blockAtomIdsById, childBlocksByParentId);

  for (const [blockId, anchorAtomId] of attachmentAtomByBlockId) {
    const rootAtomId = rootAtomByBlockId.get(blockId);
    const subtreeAtomIds = subtreeAtomIdsByBlockId.get(blockId) ?? [];
    if (!anchorAtomId || !rootAtomId || subtreeAtomIds.length === 0 || subtreeAtomIds.length >= totalPlacedAtomCount) {
      continue;
    }
    if (subtreeAtomIds.some(atomId => layoutGraph.fixedCoords.has(atomId))) {
      continue;
    }

    const descriptor = {
      anchorAtomId,
      rootAtomId,
      subtreeAtomIds: [...subtreeAtomIds]
    };

    for (const atomId of descriptor.subtreeAtomIds) {
      const descriptors = descriptorsByAtomId.get(atomId) ?? [];
      descriptors.push(descriptor);
      descriptorsByAtomId.set(atomId, descriptors);
    }
  }

  for (const descriptors of descriptorsByAtomId.values()) {
    descriptors.sort((firstDescriptor, secondDescriptor) => {
      if (firstDescriptor.subtreeAtomIds.length !== secondDescriptor.subtreeAtomIds.length) {
        return firstDescriptor.subtreeAtomIds.length - secondDescriptor.subtreeAtomIds.length;
      }
      if (firstDescriptor.rootAtomId !== secondDescriptor.rootAtomId) {
        return firstDescriptor.rootAtomId.localeCompare(secondDescriptor.rootAtomId, 'en', { numeric: true });
      }
      return firstDescriptor.anchorAtomId.localeCompare(secondDescriptor.anchorAtomId, 'en', { numeric: true });
    });
  }

  return descriptorsByAtomId;
}

function buildBlockDepthMap(rootBlockId, childBlocksByParentId) {
  const depthByBlockId = new Map([[rootBlockId, 0]]);
  const queue = [rootBlockId];
  let queueHead = 0;

  while (queueHead < queue.length) {
    const blockId = queue[queueHead++];
    const depth = depthByBlockId.get(blockId) ?? 0;
    for (const childBlockId of childBlocksByParentId.get(blockId) ?? []) {
      if (depthByBlockId.has(childBlockId)) {
        continue;
      }
      depthByBlockId.set(childBlockId, depth + 1);
      queue.push(childBlockId);
    }
  }

  return depthByBlockId;
}

/**
 * Rotates a stitched block subtree rigidly around its parent attachment atom.
 * @param {Map<string, {x: number, y: number}>} inputCoords - Current coordinate map.
 * @param {string[]} subtreeAtomIds - Atom IDs in the rotating subtree.
 * @param {string} anchorAtomId - Fixed parent attachment atom ID.
 * @param {number} angle - Rotation angle in radians.
 * @returns {Map<string, {x: number, y: number}>} Rotated coordinate map.
 */
function rotateBlockSubtree(inputCoords, subtreeAtomIds, anchorAtomId, angle) {
  const anchorPosition = inputCoords.get(anchorAtomId);
  if (!anchorPosition) {
    return inputCoords;
  }

  const coords = new Map(inputCoords);
  for (const atomId of subtreeAtomIds) {
    const position = coords.get(atomId);
    if (!position) {
      continue;
    }
    coords.set(atomId, add(anchorPosition, rotate(sub(position, anchorPosition), angle)));
  }
  return coords;
}

function chooseMovableBlockId(firstBlockId, secondBlockId, rootBlockId, blockAtomIdsById, depthByBlockId) {
  if (firstBlockId === rootBlockId) {
    return secondBlockId;
  }
  if (secondBlockId === rootBlockId) {
    return firstBlockId;
  }

  const firstDepth = depthByBlockId.get(firstBlockId) ?? 0;
  const secondDepth = depthByBlockId.get(secondBlockId) ?? 0;
  if (firstDepth !== secondDepth) {
    return firstDepth > secondDepth ? firstBlockId : secondBlockId;
  }

  const firstSize = (blockAtomIdsById.get(firstBlockId) ?? []).length;
  const secondSize = (blockAtomIdsById.get(secondBlockId) ?? []).length;
  if (firstSize !== secondSize) {
    return firstSize < secondSize ? firstBlockId : secondBlockId;
  }

  return firstBlockId;
}

function orderedOverlapRotationAngles(movableBounds, fixedBounds, anchorPosition) {
  if (!movableBounds || !fixedBounds || !anchorPosition) {
    return [...OVERLAP_RESOLUTION_ROTATION_ANGLES];
  }

  const pushDirection = overlapPushDirection(movableBounds, fixedBounds);
  const currentVector = {
    x: movableBounds.centerX - anchorPosition.x,
    y: movableBounds.centerY - anchorPosition.y
  };
  const cross = currentVector.x * pushDirection.y - currentVector.y * pushDirection.x;
  if (Math.abs(cross) <= 1e-9) {
    return [...OVERLAP_RESOLUTION_ROTATION_ANGLES];
  }

  const preferredSign = cross > 0 ? 1 : -1;
  return [...OVERLAP_RESOLUTION_ROTATION_ANGLES].sort((firstAngle, secondAngle) => {
    const firstPenalty = Math.sign(firstAngle) === preferredSign ? 0 : 1;
    const secondPenalty = Math.sign(secondAngle) === preferredSign ? 0 : 1;
    if (firstPenalty !== secondPenalty) {
      return firstPenalty - secondPenalty;
    }
    return Math.abs(firstAngle) - Math.abs(secondAngle);
  });
}

function auditLargeMoleculePlacement(layoutGraph, placement, bondLength) {
  return auditLayout(layoutGraph, placement.coords, {
    bondLength,
    bondValidationClasses: placement.bondValidationClasses
  });
}

function isBetterLargeMoleculePlacement(candidateAudit, incumbentAudit) {
  if (!candidateAudit) {
    return false;
  }
  if (!incumbentAudit) {
    return true;
  }
  if (candidateAudit.bondLengthFailureCount !== incumbentAudit.bondLengthFailureCount) {
    return candidateAudit.bondLengthFailureCount < incumbentAudit.bondLengthFailureCount;
  }
  if (candidateAudit.severeOverlapCount !== incumbentAudit.severeOverlapCount) {
    return candidateAudit.severeOverlapCount < incumbentAudit.severeOverlapCount;
  }
  if (Math.abs(candidateAudit.maxBondLengthDeviation - incumbentAudit.maxBondLengthDeviation) > 1e-6) {
    return candidateAudit.maxBondLengthDeviation < incumbentAudit.maxBondLengthDeviation;
  }
  return false;
}

function shouldRetryWithAlternateRoot(placement, placementAudit, rankedRootBlocks, options) {
  if (options.forceAlternateRootRetry) {
    return Boolean(placement && placementAudit && rankedRootBlocks.length >= 2);
  }
  if (options.disableAlternateRootRetry) {
    return false;
  }
  if (!placement || !placementAudit || rankedRootBlocks.length < 2) {
    return false;
  }
  return (
    placement.blockCount >= LARGE_MOLECULE_LAYOUT_LIMITS.rootRetryBlockCountFloor
    && placement.repulsionMoveCount <= LARGE_MOLECULE_LAYOUT_LIMITS.rootRetryRepulsionMoveCeiling
    && placementAudit.bondLengthFailureCount === 0
    && placementAudit.severeOverlapCount >= LARGE_MOLECULE_LAYOUT_LIMITS.rootRetryOverlapFloor
  );
}

/**
 * Compacts a stitched block layout by rotating child subtrees around their
 * parent attachment atoms when doing so lowers the global packing cost.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} inputCoords - Current coordinate map.
 * @param {Map<string, string[]>} blockAtomIdsById - Placed block atom IDs by block ID.
 * @param {Map<string, string[]>} childBlocksByParentId - Child block IDs by parent block ID.
 * @param {Map<string, string>} attachmentAtomByBlockId - Parent attachment atom ID by child block ID.
 * @param {string} rootBlockId - Fixed root block ID.
 * @param {number} bondLength - Target bond length.
 * @returns {{coords: Map<string, {x: number, y: number}>, rotationMoveCount: number}} Compacted coordinates and accepted rotation count.
 */
function compactBlockRotations(layoutGraph, inputCoords, blockAtomIdsById, childBlocksByParentId, attachmentAtomByBlockId, rootBlockId, bondLength) {
  let packingState = buildPackingState(layoutGraph, new Map(inputCoords), blockAtomIdsById, bondLength, {
    includeAtomClashPenalty: true
  });
  let rotationMoveCount = 0;
  const candidateBlockIds = packingState.blockIds.filter(blockId => blockId !== rootBlockId);
  const { subtreeBlockIdsByBlockId, subtreeAtomIdsByBlockId } = buildBlockSubtreeMaps(blockAtomIdsById, childBlocksByParentId);

  for (let pass = 0; pass < 6; pass++) {
    let movedThisPass = false;
    for (const blockId of candidateBlockIds) {
      const anchorAtomId = attachmentAtomByBlockId.get(blockId);
      if (!anchorAtomId) {
        continue;
      }

      const subtreeBlockIds = subtreeBlockIdsByBlockId.get(blockId) ?? [blockId];
      const subtreeAtomIds = subtreeAtomIdsByBlockId.get(blockId) ?? [];
      const baseCost = packingCostForState(packingState, bondLength, 100);
      let bestState = null;
      let bestCost = baseCost;

      for (const angle of PACKING_ROTATION_ANGLES) {
        const rotatedCoords = rotateBlockSubtree(packingState.coords, subtreeAtomIds, anchorAtomId, angle);
        const rotatedState = updatePackingState(layoutGraph, packingState, rotatedCoords, subtreeBlockIds, blockAtomIdsById, bondLength);
        const rotatedCost = packingCostForState(rotatedState, bondLength, 100);
        if (rotatedCost + 1e-6 < bestCost) {
          bestState = rotatedState;
          bestCost = rotatedCost;
        }
      }

      if (bestState) {
        packingState = bestState;
        rotationMoveCount++;
        movedThisPass = true;
      }
    }
    if (!movedThisPass) {
      break;
    }
  }

  return { coords: packingState.coords, rotationMoveCount };
}

/**
 * Resolves overlapping stitched blocks by rotating non-root subtrees around
 * their attachment anchors so stitched cut bonds keep their target lengths.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} inputCoords - Current coordinate map.
 * @param {Map<string, string[]>} blockAtomIdsById - Placed block atom IDs by block ID.
 * @param {Map<string, string[]>} childBlocksByParentId - Child block IDs by parent block ID.
 * @param {Map<string, string>} attachmentAtomByBlockId - Parent attachment atom ID by child block ID.
 * @param {string} rootBlockId - Fixed root block ID.
 * @param {number} bondLength - Target bond length.
 * @returns {{coords: Map<string, {x: number, y: number}>, repulsionMoveCount: number}} Updated coordinates and accepted overlap-resolution move count.
 */
function repelOverlappingBlocks(layoutGraph, inputCoords, blockAtomIdsById, childBlocksByParentId, attachmentAtomByBlockId, rootBlockId, bondLength) {
  let packingState = buildPackingState(layoutGraph, new Map(inputCoords), blockAtomIdsById, bondLength);
  let repulsionMoveCount = 0;
  const blockIds = packingState.blockIds;
  const depthByBlockId = buildBlockDepthMap(rootBlockId, childBlocksByParentId);
  const { subtreeBlockIdsByBlockId, subtreeAtomIdsByBlockId } = buildBlockSubtreeMaps(blockAtomIdsById, childBlocksByParentId);

  for (let pass = 0; pass < 8; pass++) {
    let movedThisPass = false;
    for (let firstIndex = 0; firstIndex < blockIds.length; firstIndex++) {
      for (let secondIndex = firstIndex + 1; secondIndex < blockIds.length; secondIndex++) {
        const firstBlockId = blockIds[firstIndex];
        const secondBlockId = blockIds[secondIndex];
        const firstBounds = packingState.boundsByBlockId.get(firstBlockId);
        const secondBounds = packingState.boundsByBlockId.get(secondBlockId);
        const { overlapX, overlapY } = measureBlockOverlap(firstBounds, secondBounds);
        if (overlapX <= 0 || overlapY <= 0) {
          continue;
        }

        const baseCost = packingCostForState(packingState, bondLength, 200);
        const basePairOverlap = overlapX * overlapY;
        let bestState = null;
        let bestCost = baseCost;
        let bestPairOverlap = basePairOverlap;

        const preferredMovableBlockId = chooseMovableBlockId(firstBlockId, secondBlockId, rootBlockId, blockAtomIdsById, depthByBlockId);
        const movableBlockIds = [preferredMovableBlockId, preferredMovableBlockId === firstBlockId ? secondBlockId : firstBlockId]
          .filter((blockId, index, list) => blockId !== rootBlockId && list.indexOf(blockId) === index && attachmentAtomByBlockId.has(blockId));

        for (const movableBlockId of movableBlockIds) {
          const fixedBlockId = movableBlockId === firstBlockId ? secondBlockId : firstBlockId;
          const movableBounds = movableBlockId === firstBlockId ? firstBounds : secondBounds;
          const fixedBounds = fixedBlockId === firstBlockId ? firstBounds : secondBounds;
          const anchorAtomId = attachmentAtomByBlockId.get(movableBlockId);
          const subtreeBlockIds = subtreeBlockIdsByBlockId.get(movableBlockId) ?? [movableBlockId];
          const subtreeAtomIds = subtreeAtomIdsByBlockId.get(movableBlockId) ?? [];

          for (const angle of orderedOverlapRotationAngles(movableBounds, fixedBounds, packingState.coords.get(anchorAtomId))) {
            const rotatedCoords = rotateBlockSubtree(packingState.coords, subtreeAtomIds, anchorAtomId, angle);
            const rotatedState = updatePackingState(layoutGraph, packingState, rotatedCoords, subtreeBlockIds, blockAtomIdsById, bondLength);
            const rotatedFirstBounds = rotatedState.boundsByBlockId.get(firstBlockId);
            const rotatedSecondBounds = rotatedState.boundsByBlockId.get(secondBlockId);
            const { overlapX: rotatedOverlapX, overlapY: rotatedOverlapY } = measureBlockOverlap(rotatedFirstBounds, rotatedSecondBounds);
            const rotatedPairOverlap = rotatedOverlapX > 0 && rotatedOverlapY > 0 ? rotatedOverlapX * rotatedOverlapY : 0;
            const rotatedCost = packingCostForState(rotatedState, bondLength, 200);
            if (
              rotatedPairOverlap + 1e-6 < bestPairOverlap
              || (rotatedPairOverlap <= bestPairOverlap + 1e-6 && rotatedCost + 1e-6 < bestCost)
            ) {
              bestState = rotatedState;
              bestCost = rotatedCost;
              bestPairOverlap = rotatedPairOverlap;
            }
          }
        }

        if (!bestState) {
          continue;
        }
        packingState = bestState;
        repulsionMoveCount++;
        movedThisPass = true;
      }
    }
    if (!movedThisPass) {
      break;
    }
  }

  return { coords: packingState.coords, repulsionMoveCount };
}

/**
 * Lays out a large connected component by partitioning it into balanced blocks,
 * placing each block with the organic slice engine, then rigidly stitching
 * child blocks onto a root block through their cut bonds.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {object} component - Connected-component descriptor.
 * @param {number} bondLength - Target bond length.
 * @param {{sliceLayouter?: (layoutGraph: object, block: {id: string, atomIds: string[], canonicalSignature?: string}, bondLength: number) => {family?: string, supported: boolean, atomIds: string[], coords: Map<string, {x: number, y: number}>, bondValidationClasses?: Map<string, 'planar'|'bridged'>}}} [options] - Optional family overrides for testing or fallback control.
 * @param {boolean} [options.disableRotationPacking] - Disables rigid subtree rotation packing for test comparisons.
 * @param {boolean} [options.disableAlternateRootRetry] - Disables the alternate-root retry for overlap-heavy bond-clean placements.
 * @param {boolean} [options.forceAlternateRootRetry] - Forces one alternate-root retry for test coverage.
 * @param {{id: string, atomIds: string[], canonicalSignature: string, heavyAtomCount: number, participantCount: number, ringSystemCount: number}|null} [options.rootBlock] - Optional explicit root block override.
 * @returns {{coords: Map<string, {x: number, y: number}>, placementMode: string, blockCount: number, refinedStitchCount: number, linearFallbackCount: number, rootFallbackUsed: boolean, repulsionMoveCount: number, rotationMoveCount: number, rootBlockId: string, rootRetryAttemptCount: number, rootRetryUsed: boolean, bondValidationClasses: Map<string, 'planar'|'bridged'>, cleanupRigidSubtreesByAtomId?: Map<string, Array<{anchorAtomId: string, rootAtomId: string, subtreeAtomIds: string[]}>>}|null} Placement result.
 */
export function layoutLargeMoleculeFamily(layoutGraph, component, bondLength, options = {}) {
  const threshold = layoutGraph.options.largeMoleculeThreshold;
  const { blocks, cutBonds } = partitionBlocks(layoutGraph, component, threshold);
  if (blocks.length <= 1) {
    return null;
  }

  const sliceLayouter = options.sliceLayouter ?? layoutAtomSlice;
  const blockById = new Map(blocks.map(block => [block.id, block]));
  const blockAdjacency = buildBlockAdjacency(blocks, cutBonds);
  const rankedRootBlocks = rankRootBlocks(blocks);
  const rootBlock = options.rootBlock ?? rankedRootBlocks[0] ?? null;
  if (!rootBlock) {
    return null;
  }

  const participantAtomIds = participantAtomIdsFor(layoutGraph, component.atomIds);
  const participantAtomIdSet = new Set(participantAtomIds);
  const fullAdjacency = buildSliceAdjacency(layoutGraph, participantAtomIds);
  const rootLayout = sliceLayouter(layoutGraph, rootBlock, bondLength);
  if (!rootLayout.supported) {
    const rootStartAtomId = rootBlock.atomIds.find(atomId => participantAtomIdSet.has(atomId)) ?? participantAtomIds[0] ?? null;
    return {
      coords: layoutLinearFallbackCoords(fullAdjacency, participantAtomIds, rootStartAtomId, bondLength),
      placementMode: 'block-linear-fallback',
      blockCount: blocks.length,
      refinedStitchCount: 0,
      linearFallbackCount: 1,
      rootFallbackUsed: true,
      repulsionMoveCount: 0,
      rotationMoveCount: 0,
      rootBlockId: rootBlock.id,
      rootRetryAttemptCount: 0,
      rootRetryUsed: false,
      bondValidationClasses: assignBondValidationClass(layoutGraph, participantAtomIds, 'planar'),
      cleanupRigidSubtreesByAtomId: new Map()
    };
  }

  const coords = new Map(rootLayout.coords);
  const bondValidationClasses = new Map();
  const placedBlockAtomIds = new Map([[rootBlock.id, rootBlock.atomIds.filter(atomId => participantAtomIdSet.has(atomId))]]);
  mergeBondValidationClasses(bondValidationClasses, rootLayout.bondValidationClasses);
  const placedBlockIds = new Set([rootBlock.id]);
  const childBlocksByParentId = new Map();
  const attachmentAtomByBlockId = new Map();
  const rootAtomByBlockId = new Map();
  const queue = [rootBlock.id];
  let refinedStitchCount = 0;
  let linearFallbackCount = 0;

  while (queue.length > 0) {
    const currentBlockId = queue.shift();
    for (const { neighborBlockId, cutBond } of blockAdjacency.get(currentBlockId) ?? []) {
      if (placedBlockIds.has(neighborBlockId)) {
        continue;
      }

      const parentBlock = blockById.get(currentBlockId);
      const childBlock = blockById.get(neighborBlockId);
      if (!parentBlock || !childBlock) {
        continue;
      }

      const parentContainsFirst = parentBlock.atomIds.includes(cutBond.firstAtomId);
      const parentAtomId = parentContainsFirst ? cutBond.firstAtomId : cutBond.secondAtomId;
      const childAtomId = parentContainsFirst ? cutBond.secondAtomId : cutBond.firstAtomId;
      const parentPosition = coords.get(parentAtomId);
      const placedCentroid = centroid([...coords.values()]);
      const preferredAngle = angleOf(sub(parentPosition, placedCentroid));
      const attachmentAngle = chooseAttachmentAngle(fullAdjacency, coords, parentAtomId, participantAtomIdSet, preferredAngle, layoutGraph, childAtomId);
      const childParticipantAtomIds = childBlock.atomIds.filter(atomId => participantAtomIdSet.has(atomId));
      const childLayout = sliceLayouter(layoutGraph, childBlock, bondLength);
      const childCoords = childLayout.supported
        ? childLayout.coords
        : layoutLinearFallbackCoords(buildSliceAdjacency(layoutGraph, childParticipantAtomIds), childParticipantAtomIds, childAtomId, bondLength);
      if (!childLayout.supported) {
        linearFallbackCount++;
      }
      const refinedChild = refineStitchedBlock(childCoords, childParticipantAtomIds, childAtomId, parentPosition, attachmentAngle, bondLength, coords);
      const transformedChild = refinedChild.coords;
      if (Math.abs(refinedChild.angle - attachmentAngle) > 1e-6) {
        refinedStitchCount++;
      }

      for (const [atomId, position] of transformedChild) {
        coords.set(atomId, position);
      }
      if (childLayout.supported) {
        mergeBondValidationClasses(bondValidationClasses, childLayout.bondValidationClasses);
      } else {
        assignBondValidationClass(layoutGraph, childParticipantAtomIds, 'planar', bondValidationClasses, { overwrite: false });
      }
      const childBlocks = childBlocksByParentId.get(parentBlock.id) ?? [];
      childBlocks.push(childBlock.id);
      childBlocksByParentId.set(parentBlock.id, childBlocks);
      attachmentAtomByBlockId.set(childBlock.id, parentAtomId);
      rootAtomByBlockId.set(childBlock.id, childAtomId);
      placedBlockAtomIds.set(childBlock.id, childParticipantAtomIds);
      placedBlockIds.add(childBlock.id);
      queue.push(childBlock.id);
    }
  }

  const cleanupRigidSubtreesByAtomId = buildCleanupRigidSubtreesByAtomId(
    layoutGraph,
    placedBlockAtomIds,
    childBlocksByParentId,
    attachmentAtomByBlockId,
    rootAtomByBlockId
  );
  const repulsion = repelOverlappingBlocks(layoutGraph, coords, placedBlockAtomIds, childBlocksByParentId, attachmentAtomByBlockId, rootBlock.id, bondLength);
  const packed = options.disableRotationPacking
    ? { coords: repulsion.coords, rotationMoveCount: 0 }
    : compactBlockRotations(layoutGraph, repulsion.coords, placedBlockAtomIds, childBlocksByParentId, attachmentAtomByBlockId, rootBlock.id, bondLength);
  const primaryPlacement = {
    coords: packed.coords,
    placementMode: 'block-stitched',
    blockCount: blocks.length,
    refinedStitchCount,
    linearFallbackCount,
    rootFallbackUsed: false,
    repulsionMoveCount: repulsion.repulsionMoveCount,
    rotationMoveCount: packed.rotationMoveCount,
    rootBlockId: rootBlock.id,
    rootRetryAttemptCount: 0,
    rootRetryUsed: false,
    bondValidationClasses: assignBondValidationClass(layoutGraph, participantAtomIds, 'planar', bondValidationClasses, { overwrite: false }),
    cleanupRigidSubtreesByAtomId
  };

  if (options.rootBlock || !shouldRetryWithAlternateRoot(primaryPlacement, auditLargeMoleculePlacement(layoutGraph, primaryPlacement, bondLength), rankedRootBlocks, options)) {
    return primaryPlacement;
  }

  let bestPlacement = primaryPlacement;
  let bestAudit = auditLargeMoleculePlacement(layoutGraph, primaryPlacement, bondLength);
  let rootRetryAttemptCount = 0;
  const alternateRootBlocks = rankedRootBlocks.slice(1, 1 + LARGE_MOLECULE_LAYOUT_LIMITS.maxAlternateRootCandidates);

  for (const alternateRootBlock of alternateRootBlocks) {
    rootRetryAttemptCount++;
    const alternatePlacement = layoutLargeMoleculeFamily(layoutGraph, component, bondLength, {
      ...options,
      disableAlternateRootRetry: true,
      rootBlock: alternateRootBlock
    });
    if (!alternatePlacement) {
      continue;
    }
    const alternateAudit = auditLargeMoleculePlacement(layoutGraph, alternatePlacement, bondLength);
    if (isBetterLargeMoleculePlacement(alternateAudit, bestAudit)) {
      bestPlacement = alternatePlacement;
      bestAudit = alternateAudit;
    }
  }

  return {
    ...bestPlacement,
    rootRetryAttemptCount,
    rootRetryUsed: bestPlacement.rootBlockId !== primaryPlacement.rootBlockId
  };
}

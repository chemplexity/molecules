/** @module families/large-molecule */

import { angleOf, centroid, sub } from '../geometry/vec2.js';
import { compareCanonicalAtomIds } from '../topology/canonical-order.js';
import { chooseAttachmentAngle } from '../placement/substituents.js';
import { refineStitchedBlock } from '../placement/block-stitching.js';
import { buildSliceAdjacency, createAtomSlice, layoutAtomSlice } from '../placement/atom-slice.js';

function countHeavyAtoms(layoutGraph, atomIds) {
  return atomIds.filter(atomId => layoutGraph.sourceMolecule.atoms.get(atomId)?.name !== 'H').length;
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

function selectBestCut(layoutGraph, atomIds, threshold) {
  const atomIdSet = new Set(atomIds);
  const candidates = [];

  for (const bond of layoutGraph.bonds.values()) {
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
    const leftRingSystems = countRingSystems(layoutGraph, leftAtomIds);
    const rightRingSystems = countRingSystems(layoutGraph, rightAtomIds);
    const oversizePenalty = Math.max(0, leftHeavyCount - threshold.heavyAtomCount) + Math.max(0, rightHeavyCount - threshold.heavyAtomCount);
    const balancePenalty = Math.abs(leftHeavyCount - rightHeavyCount);
    const ringBonus = leftRingSystems > 0 && rightRingSystems > 0 ? 100 : 0;
    const score = ringBonus - (oversizePenalty * 10) - balancePenalty;
    candidates.push({
      bond,
      leftAtomIds,
      rightAtomIds,
      score
    });
  }

  candidates.sort((firstCandidate, secondCandidate) => {
    if (secondCandidate.score !== firstCandidate.score) {
      return secondCandidate.score - firstCandidate.score;
    }
    return String(firstCandidate.bond.id).localeCompare(String(secondCandidate.bond.id), 'en', { numeric: true });
  });

  return candidates[0] ?? null;
}

function createBlock(layoutGraph, atomIds, id) {
  const sortedAtomIds = [...atomIds].sort((firstAtomId, secondAtomId) => compareCanonicalAtomIds(firstAtomId, secondAtomId, layoutGraph.canonicalAtomRank));
  const slice = createAtomSlice(layoutGraph, sortedAtomIds, id);
  return {
    ...slice,
    heavyAtomCount: countHeavyAtoms(layoutGraph, sortedAtomIds),
    ringSystemCount: countRingSystems(layoutGraph, sortedAtomIds)
  };
}

function isOversized(block, threshold) {
  return block.heavyAtomCount > threshold.heavyAtomCount || block.ringSystemCount > threshold.ringSystemCount;
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

function chooseRootBlock(blocks) {
  return [...blocks].sort((firstBlock, secondBlock) => {
    if (secondBlock.ringSystemCount !== firstBlock.ringSystemCount) {
      return secondBlock.ringSystemCount - firstBlock.ringSystemCount;
    }
    if (secondBlock.heavyAtomCount !== firstBlock.heavyAtomCount) {
      return secondBlock.heavyAtomCount - firstBlock.heavyAtomCount;
    }
    return firstBlock.canonicalSignature.localeCompare(secondBlock.canonicalSignature, 'en', { numeric: true });
  })[0] ?? null;
}

function buildBlockAdjacency(blocks, cutBonds) {
  const adjacency = new Map(blocks.map(block => [block.id, []]));
  for (const cutBond of cutBonds) {
    const firstBlock = blocks.find(block => block.atomIds.includes(cutBond.firstAtomId));
    const secondBlock = blocks.find(block => block.atomIds.includes(cutBond.secondAtomId));
    if (!firstBlock || !secondBlock || firstBlock.id === secondBlock.id) {
      continue;
    }
    adjacency.get(firstBlock.id)?.push({ neighborBlockId: secondBlock.id, cutBond });
    adjacency.get(secondBlock.id)?.push({ neighborBlockId: firstBlock.id, cutBond });
  }
  return adjacency;
}

/**
 * Lays out a large connected component by partitioning it into balanced blocks,
 * placing each block with the organic slice engine, then rigidly stitching
 * child blocks onto a root block through their cut bonds.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {object} component - Connected-component descriptor.
 * @param {number} bondLength - Target bond length.
 * @returns {{coords: Map<string, {x: number, y: number}>, placementMode: string, blockCount: number, refinedStitchCount: number}|null} Placement result.
 */
export function layoutLargeMoleculeFamily(layoutGraph, component, bondLength) {
  const threshold = layoutGraph.options.largeMoleculeThreshold;
  const { blocks, cutBonds } = partitionBlocks(layoutGraph, component, threshold);
  if (blocks.length <= 1) {
    return null;
  }

  const blockById = new Map(blocks.map(block => [block.id, block]));
  const blockAdjacency = buildBlockAdjacency(blocks, cutBonds);
  const rootBlock = chooseRootBlock(blocks);
  if (!rootBlock) {
    return null;
  }

  const rootLayout = layoutAtomSlice(layoutGraph, rootBlock, bondLength);
  if (!rootLayout.supported) {
    return null;
  }

  const fullAdjacency = buildSliceAdjacency(layoutGraph, component.atomIds);
  const participantAtomIds = new Set(component.atomIds.filter(atomId => {
    const atom = layoutGraph.atoms.get(atomId);
    return atom && !(layoutGraph.options.suppressH && atom.element === 'H' && !atom.visible);
  }));
  const coords = new Map(rootLayout.coords);
  const placedBlockIds = new Set([rootBlock.id]);
  const queue = [rootBlock.id];
  let refinedStitchCount = 0;

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
      const childLayout = layoutAtomSlice(layoutGraph, childBlock, bondLength);
      if (!childLayout.supported) {
        return null;
      }

      const parentPosition = coords.get(parentAtomId);
      const placedCentroid = centroid([...coords.values()]);
      const preferredAngle = angleOf(sub(parentPosition, placedCentroid));
      const attachmentAngle = chooseAttachmentAngle(fullAdjacency, coords, parentAtomId, participantAtomIds, preferredAngle, layoutGraph);
      const refinedChild = refineStitchedBlock(
        childLayout.coords,
        childBlock.atomIds,
        childAtomId,
        parentPosition,
        attachmentAngle,
        bondLength,
        coords
      );
      const transformedChild = refinedChild.coords;
      if (Math.abs(refinedChild.angle - attachmentAngle) > 1e-6) {
        refinedStitchCount++;
      }

      for (const [atomId, position] of transformedChild) {
        coords.set(atomId, position);
      }
      placedBlockIds.add(childBlock.id);
      queue.push(childBlock.id);
    }
  }

  return {
    coords,
    placementMode: 'block-stitched',
    blockCount: blocks.length,
    refinedStitchCount
  };
}

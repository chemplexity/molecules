/** @module cleanup/local-rotation */

import { add, angleOf, fromAngle, rotate, sub } from '../geometry/vec2.js';
import { measureLayoutCost } from '../audit/invariants.js';

const DISCRETE_ROTATION_ANGLES = Array.from({ length: 24 }, (_, index) => (index * Math.PI) / 12);

function buildPlacedAdjacency(layoutGraph, coords) {
  const adjacency = new Map();
  for (const atomId of coords.keys()) {
    adjacency.set(atomId, []);
  }
  for (const bond of layoutGraph.bonds.values()) {
    if (!coords.has(bond.a) || !coords.has(bond.b) || bond.kind !== 'covalent') {
      continue;
    }
    adjacency.get(bond.a)?.push(bond.b);
    adjacency.get(bond.b)?.push(bond.a);
  }
  return adjacency;
}

function movableTerminalSubtrees(layoutGraph, coords) {
  const adjacency = buildPlacedAdjacency(layoutGraph, coords);
  const result = [];
  for (const [atomId, neighbors] of adjacency) {
    const atom = layoutGraph.atoms.get(atomId);
    if (!atom || atom.element === 'H' || atom.heavyDegree !== 1) {
      continue;
    }
    const heavyNeighbors = neighbors.filter(neighborAtomId => layoutGraph.atoms.get(neighborAtomId)?.element !== 'H');
    if (heavyNeighbors.length !== 1) {
      continue;
    }
    const anchorAtomId = heavyNeighbors[0];
    const pairKey = atomId < anchorAtomId ? `${atomId}:${anchorAtomId}` : `${anchorAtomId}:${atomId}`;
    const bond = layoutGraph.bondByAtomPair.get(pairKey);
    if (!bond || bond.inRing || bond.order > 2) {
      continue;
    }
    const subtreeAtomIds = [atomId, ...neighbors.filter(neighborAtomId => neighborAtomId !== anchorAtomId)];
    result.push({ atomId, anchorAtomId, subtreeAtomIds });
  }
  for (const [atomId, neighbors] of adjacency) {
    const atom = layoutGraph.atoms.get(atomId);
    if (!atom || atom.element === 'H' || atom.heavyDegree !== 2 || atom.degree !== 2) {
      continue;
    }
    const heavyNeighbors = neighbors.filter(neighborAtomId => layoutGraph.atoms.get(neighborAtomId)?.element !== 'H');
    if (heavyNeighbors.length !== 2) {
      continue;
    }
    let anchorAtomId = null;
    let branchRootAtomId = null;
    for (const candidateNeighborAtomId of heavyNeighbors) {
      const pairKey = atomId < candidateNeighborAtomId ? `${atomId}:${candidateNeighborAtomId}` : `${candidateNeighborAtomId}:${atomId}`;
      const bond = layoutGraph.bondByAtomPair.get(pairKey);
      if (!bond || bond.inRing) {
        anchorAtomId = null;
        branchRootAtomId = null;
        break;
      }
      if ((bond.order ?? 1) === 1) {
        anchorAtomId = candidateNeighborAtomId;
      } else if ((bond.order ?? 1) >= 2) {
        branchRootAtomId = candidateNeighborAtomId;
      }
    }
    if (!anchorAtomId || !branchRootAtomId) {
      continue;
    }
    const branchRootAtom = layoutGraph.atoms.get(branchRootAtomId);
    if (!branchRootAtom || branchRootAtom.heavyDegree !== 1) {
      continue;
    }
    result.push({ atomId, anchorAtomId, subtreeAtomIds: [atomId, branchRootAtomId] });
  }
  return result;
}

/**
 * Runs a conservative local cleanup pass by rotating leaf atoms around their
 * anchors when doing so lowers the global layout cost.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} inputCoords - Coordinate map.
 * @param {object} [options] - Cleanup options.
 * @param {number} [options.maxPasses] - Maximum cleanup passes.
 * @param {number} [options.epsilon] - Minimum accepted improvement.
 * @param {number} [options.bondLength] - Target bond length.
 * @returns {{coords: Map<string, {x: number, y: number}>, passes: number, improvement: number}} Cleanup result.
 */
export function runLocalCleanup(layoutGraph, inputCoords, options = {}) {
  const maxPasses = options.maxPasses ?? layoutGraph.options.maxCleanupPasses;
  const epsilon = options.epsilon ?? 1e-3;
  const bondLength = options.bondLength ?? layoutGraph.options.bondLength;
  const coords = new Map([...inputCoords.entries()].map(([atomId, position]) => [atomId, { ...position }]));
  let currentCost = measureLayoutCost(layoutGraph, coords, bondLength);
  let totalImprovement = 0;
  let passes = 0;

  while (passes < maxPasses) {
    passes++;
    let bestMove = null;

    for (const { atomId, anchorAtomId, subtreeAtomIds } of movableTerminalSubtrees(layoutGraph, coords)) {
      const anchorPosition = coords.get(anchorAtomId);
      const rootPosition = coords.get(atomId);
      if (!anchorPosition) {
        continue;
      }
      if (!rootPosition) {
        continue;
      }
      const currentAngle = angleOf(sub(rootPosition, anchorPosition));
      const currentRadius = Math.hypot(rootPosition.x - anchorPosition.x, rootPosition.y - anchorPosition.y) || bondLength;
      for (const angle of DISCRETE_ROTATION_ANGLES) {
        const candidateCoords = new Map(coords);
        const rotatedRoot = add(anchorPosition, fromAngle(angle, currentRadius));
        const rotation = angle - currentAngle;
        candidateCoords.set(atomId, rotatedRoot);
        for (const subtreeAtomId of subtreeAtomIds) {
          if (subtreeAtomId === atomId) {
            continue;
          }
          const subtreePosition = coords.get(subtreeAtomId);
          if (!subtreePosition) {
            continue;
          }
          const relativePosition = sub(subtreePosition, rootPosition);
          candidateCoords.set(subtreeAtomId, add(rotatedRoot, rotate(relativePosition, rotation)));
        }
        const candidateCost = measureLayoutCost(layoutGraph, candidateCoords, bondLength);
        const improvement = currentCost - candidateCost;
        if (improvement > epsilon && (!bestMove || improvement > bestMove.improvement)) {
          bestMove = {
            positions: subtreeAtomIds.map(subtreeAtomId => [subtreeAtomId, candidateCoords.get(subtreeAtomId)]),
            cost: candidateCost,
            improvement
          };
        }
      }
    }

    if (!bestMove) {
      passes--;
      break;
    }

    for (const [atomId, position] of bestMove.positions) {
      coords.set(atomId, position);
    }
    currentCost = bestMove.cost;
    totalImprovement += bestMove.improvement;
  }

  return {
    coords,
    passes,
    improvement: totalImprovement
  };
}

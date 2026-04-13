/** @module cleanup/local-rotation */

import { CLEANUP_EPSILON, DISTANCE_EPSILON } from '../constants.js';
import { add, angleOf, fromAngle, rotate, sub } from '../geometry/vec2.js';
import { pointInPolygon } from '../geometry/polygon.js';
import { buildAtomGrid, computeAtomDistortionCost, computeSubtreeOverlapCost } from '../audit/invariants.js';
import { collectCutSubtree } from './subtree-utils.js';

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

/**
 * Collects movable terminal subtrees from the currently placed covalent graph.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Current coordinate map.
 * @returns {Array<{atomId: string, anchorAtomId: string, subtreeAtomIds: string[]}>} Rotatable terminal subtrees.
 */
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
    result.push({
      atomId,
      anchorAtomId,
      subtreeAtomIds: [...collectCutSubtree(layoutGraph, atomId, anchorAtomId)].filter(subtreeAtomId => coords.has(subtreeAtomId))
    });
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
    result.push({
      atomId,
      anchorAtomId,
      subtreeAtomIds: [...collectCutSubtree(layoutGraph, atomId, anchorAtomId)].filter(subtreeAtomId => coords.has(subtreeAtomId))
    });
  }
  return result;
}

/**
 * Returns geminal subtree pairs that share the same rotation anchor.
 * @param {Array<{atomId: string, anchorAtomId: string, subtreeAtomIds: string[]}>} terminalSubtrees - Individual movable terminal subtrees.
 * @returns {Array<{anchorAtomId: string, firstSubtree: {atomId: string, anchorAtomId: string, subtreeAtomIds: string[]}, secondSubtree: {atomId: string, anchorAtomId: string, subtreeAtomIds: string[]}, subtreeAtomIds: string[]}>} Geminal subtree pairs.
 */
function geminalSubtreePairs(terminalSubtrees) {
  const subtreesByAnchor = new Map();
  for (const subtree of terminalSubtrees) {
    const anchorSubtrees = subtreesByAnchor.get(subtree.anchorAtomId) ?? [];
    anchorSubtrees.push(subtree);
    subtreesByAnchor.set(subtree.anchorAtomId, anchorSubtrees);
  }

  const pairs = [];
  for (const [anchorAtomId, anchorSubtrees] of subtreesByAnchor) {
    if (anchorSubtrees.length < 2) {
      continue;
    }
    for (let firstIndex = 0; firstIndex < anchorSubtrees.length - 1; firstIndex++) {
      for (let secondIndex = firstIndex + 1; secondIndex < anchorSubtrees.length; secondIndex++) {
        const firstSubtree = anchorSubtrees[firstIndex];
        const secondSubtree = anchorSubtrees[secondIndex];
        pairs.push({
          anchorAtomId,
          firstSubtree,
          secondSubtree,
          subtreeAtomIds: [...new Set([...firstSubtree.subtreeAtomIds, ...secondSubtree.subtreeAtomIds])]
        });
      }
    }
  }
  return pairs;
}

/**
 * Computes the approximate inward ring-core vector for a ring anchor by summing
 * the vectors from the anchor to the centroids of each incident ring.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Current coordinate map.
 * @param {string} anchorAtomId - Anchor atom id.
 * @returns {{x: number, y: number}|null} Inward ring-core vector, or null when unavailable.
 */
function computeRingInteriorVector(layoutGraph, coords, anchorAtomId) {
  const anchorPosition = coords.get(anchorAtomId);
  const anchorRings = layoutGraph.atomToRings.get(anchorAtomId) ?? [];
  if (!anchorPosition || anchorRings.length === 0) {
    return null;
  }

  let inwardX = 0;
  let inwardY = 0;
  let countedRings = 0;
  for (const ring of anchorRings) {
    let centroidX = 0;
    let centroidY = 0;
    let countedAtoms = 0;
    for (const ringAtomId of ring.atomIds) {
      const ringPosition = coords.get(ringAtomId);
      if (!ringPosition) {
        continue;
      }
      centroidX += ringPosition.x;
      centroidY += ringPosition.y;
      countedAtoms++;
    }
    if (countedAtoms === 0) {
      continue;
    }
    inwardX += (centroidX / countedAtoms) - anchorPosition.x;
    inwardY += (centroidY / countedAtoms) - anchorPosition.y;
    countedRings++;
  }

  if (countedRings === 0 || Math.hypot(inwardX, inwardY) <= DISTANCE_EPSILON) {
    return null;
  }
  return { x: inwardX, y: inwardY };
}

/**
 * Returns the number of incident ring polygons containing a candidate branch root.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Current coordinate map.
 * @param {string} anchorAtomId - Anchor atom id.
 * @param {{x: number, y: number}} position - Candidate branch-root position.
 * @returns {number} Number of incident ring faces containing the position.
 */
function containingIncidentRingCount(layoutGraph, coords, anchorAtomId, position) {
  let containingRingCount = 0;
  for (const ring of layoutGraph.atomToRings.get(anchorAtomId) ?? []) {
    const polygon = ring.atomIds.map(ringAtomId => coords.get(ringAtomId)).filter(Boolean);
    if (polygon.length >= 3 && pointInPolygon(position, polygon)) {
      containingRingCount++;
    }
  }
  return containingRingCount;
}

/**
 * Returns whether a cleanup candidate would flip a ring substituent from the
 * outside of the ring system toward the ring interior.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Current coordinate map.
 * @param {string} anchorAtomId - Anchor atom id.
 * @param {{x: number, y: number}} currentRootPosition - Current subtree-root position.
 * @param {{x: number, y: number}} candidateRootPosition - Candidate subtree-root position.
 * @param {number} tolerance - Small dot-product tolerance for near-tangent cases.
 * @returns {boolean} True when the candidate flips an outward substituent inward.
 */
function flipsRingSubstituentInward(layoutGraph, coords, anchorAtomId, currentRootPosition, candidateRootPosition, tolerance) {
  if (containingIncidentRingCount(layoutGraph, coords, anchorAtomId, candidateRootPosition)
    > containingIncidentRingCount(layoutGraph, coords, anchorAtomId, currentRootPosition)) {
    return true;
  }
  const anchorPosition = coords.get(anchorAtomId);
  const inwardVector = computeRingInteriorVector(layoutGraph, coords, anchorAtomId);
  if (!anchorPosition || !inwardVector) {
    return false;
  }

  const currentVector = sub(currentRootPosition, anchorPosition);
  const candidateVector = sub(candidateRootPosition, anchorPosition);
  const currentDot = currentVector.x * inwardVector.x + currentVector.y * inwardVector.y;
  const candidateDot = candidateVector.x * inwardVector.x + candidateVector.y * inwardVector.y;
  return currentDot <= tolerance && candidateDot > tolerance;
}

/**
 * Returns whether the atom should be tracked in the visible-geometry atom grid.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {string} atomId - Atom identifier.
 * @returns {boolean} True when the atom is visible and should be tracked.
 */
function shouldTrackVisibleAtom(layoutGraph, atomId) {
  return layoutGraph.atoms.get(atomId)?.visible === true;
}

/**
 * Applies moved atom positions onto the working atom grid in place.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {import('../geometry/atom-grid.js').AtomGrid} atomGrid - Working atom grid.
 * @param {Map<string, {x: number, y: number}>} coords - Current coordinate map before mutation.
 * @param {Array<[string, {x: number, y: number}]>} movedPositions - Accepted moved positions.
 * @returns {void}
 */
function updateAtomGridForMove(layoutGraph, atomGrid, coords, movedPositions) {
  for (const [atomId, nextPosition] of movedPositions) {
    if (!shouldTrackVisibleAtom(layoutGraph, atomId)) {
      continue;
    }
    const previousPosition = coords.get(atomId);
    if (previousPosition) {
      atomGrid.remove(atomId, previousPosition);
    }
    atomGrid.insert(atomId, nextPosition);
  }
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
 * @param {import('../geometry/atom-grid.js').AtomGrid} [options.baseAtomGrid] - Optional reusable base atom grid.
 * @returns {{coords: Map<string, {x: number, y: number}>, passes: number, improvement: number}} Cleanup result.
 */
export function runLocalCleanup(layoutGraph, inputCoords, options = {}) {
  const maxPasses = options.maxPasses ?? layoutGraph.options.maxCleanupPasses;
  const epsilon = options.epsilon ?? CLEANUP_EPSILON;
  const bondLength = options.bondLength ?? layoutGraph.options.bondLength;
  const coords = new Map([...inputCoords.entries()].map(([atomId, position]) => [atomId, { ...position }]));
  let totalImprovement = 0;
  let passes = 0;
  const terminalSubtrees = movableTerminalSubtrees(layoutGraph, coords);
  const geminalPairs = geminalSubtreePairs(terminalSubtrees);
  const atomGrid = options.baseAtomGrid?.clone() ?? buildAtomGrid(layoutGraph, coords, bondLength);

  while (passes < maxPasses) {
    passes++;
    let bestMove = null;
    const inwardFlipTolerance = bondLength * bondLength * 0.02;

    for (const { atomId, anchorAtomId, subtreeAtomIds } of terminalSubtrees) {
      const anchorPosition = coords.get(anchorAtomId);
      const rootPosition = coords.get(atomId);
      if (!anchorPosition || !rootPosition) {
        continue;
      }
      const currentAngle = angleOf(sub(rootPosition, anchorPosition));
      const currentRadius = Math.hypot(rootPosition.x - anchorPosition.x, rootPosition.y - anchorPosition.y) || bondLength;

      // Compute base costs for this subtree (O(k·n)). Used to evaluate each rotation
      // candidate cheaply without a full O(n²) measureLayoutCost call.
      const baseOverlapCost = computeSubtreeOverlapCost(layoutGraph, coords, subtreeAtomIds, null, bondLength, { atomGrid });
      const baseAnchorDistortion = computeAtomDistortionCost(layoutGraph, coords, anchorAtomId, null);

      for (const angle of DISCRETE_ROTATION_ANGLES) {
        const rotatedRoot = add(anchorPosition, fromAngle(angle, currentRadius));
        const rotation = angle - currentAngle;
        if (flipsRingSubstituentInward(layoutGraph, coords, anchorAtomId, rootPosition, rotatedRoot, inwardFlipTolerance)) {
          continue;
        }

        // Build new positions for the subtree without copying the whole coords map.
        const newPositions = new Map([[atomId, rotatedRoot]]);
        for (const subtreeAtomId of subtreeAtomIds) {
          if (subtreeAtomId === atomId) {
            continue;
          }
          const subtreePosition = coords.get(subtreeAtomId);
          if (!subtreePosition) {
            continue;
          }
          newPositions.set(subtreeAtomId, add(rotatedRoot, rotate(sub(subtreePosition, rootPosition), rotation)));
        }

        // Improvement = overlap delta + anchor distortion delta (all O(k·n), no full O(n²) call).
        const newOverlapCost = computeSubtreeOverlapCost(layoutGraph, coords, subtreeAtomIds, newPositions, bondLength, { atomGrid });
        const newAnchorDistortion = computeAtomDistortionCost(layoutGraph, coords, anchorAtomId, newPositions);
        const improvement = (baseOverlapCost - newOverlapCost) + (baseAnchorDistortion - newAnchorDistortion);
        if (improvement > epsilon && (!bestMove || improvement > bestMove.improvement)) {
          bestMove = {
            positions: [...newPositions.entries()],
            improvement
          };
        }
      }
    }

    if (!bestMove) {
      for (const { anchorAtomId, firstSubtree, secondSubtree, subtreeAtomIds } of geminalPairs) {
        const anchorPosition = coords.get(anchorAtomId);
        const firstRootPosition = coords.get(firstSubtree.atomId);
        const secondRootPosition = coords.get(secondSubtree.atomId);
        if (!anchorPosition || !firstRootPosition || !secondRootPosition) {
          continue;
        }

        const firstCurrentAngle = angleOf(sub(firstRootPosition, anchorPosition));
        const firstCurrentRadius = Math.hypot(firstRootPosition.x - anchorPosition.x, firstRootPosition.y - anchorPosition.y) || bondLength;
        const secondCurrentRadius = Math.hypot(secondRootPosition.x - anchorPosition.x, secondRootPosition.y - anchorPosition.y) || bondLength;
        const baseOverlapCost = computeSubtreeOverlapCost(layoutGraph, coords, subtreeAtomIds, null, bondLength, { atomGrid });
        const baseAnchorDistortion = computeAtomDistortionCost(layoutGraph, coords, anchorAtomId, null);

        for (const angle of DISCRETE_ROTATION_ANGLES) {
          const rotation = angle - firstCurrentAngle;
          const rotatedFirstRoot = add(anchorPosition, fromAngle(angle, firstCurrentRadius));
          const rotatedSecondRoot = add(anchorPosition, fromAngle(angleOf(sub(secondRootPosition, anchorPosition)) + rotation, secondCurrentRadius));
          if (
            flipsRingSubstituentInward(layoutGraph, coords, anchorAtomId, firstRootPosition, rotatedFirstRoot, inwardFlipTolerance)
            || flipsRingSubstituentInward(layoutGraph, coords, anchorAtomId, secondRootPosition, rotatedSecondRoot, inwardFlipTolerance)
          ) {
            continue;
          }

          const newPositions = new Map([
            [firstSubtree.atomId, rotatedFirstRoot],
            [secondSubtree.atomId, rotatedSecondRoot]
          ]);

          for (const subtreeAtomId of firstSubtree.subtreeAtomIds) {
            if (subtreeAtomId === firstSubtree.atomId) {
              continue;
            }
            const subtreePosition = coords.get(subtreeAtomId);
            if (!subtreePosition) {
              continue;
            }
            newPositions.set(subtreeAtomId, add(rotatedFirstRoot, rotate(sub(subtreePosition, firstRootPosition), rotation)));
          }
          for (const subtreeAtomId of secondSubtree.subtreeAtomIds) {
            if (subtreeAtomId === secondSubtree.atomId) {
              continue;
            }
            const subtreePosition = coords.get(subtreeAtomId);
            if (!subtreePosition) {
              continue;
            }
            newPositions.set(subtreeAtomId, add(rotatedSecondRoot, rotate(sub(subtreePosition, secondRootPosition), rotation)));
          }

          const newOverlapCost = computeSubtreeOverlapCost(layoutGraph, coords, subtreeAtomIds, newPositions, bondLength, { atomGrid });
          const newAnchorDistortion = computeAtomDistortionCost(layoutGraph, coords, anchorAtomId, newPositions);
          const improvement = (baseOverlapCost - newOverlapCost) + (baseAnchorDistortion - newAnchorDistortion);
          if (improvement > epsilon && (!bestMove || improvement > bestMove.improvement)) {
            bestMove = {
              positions: [...newPositions.entries()],
              improvement
            };
          }
        }
      }
    }

    if (!bestMove) {
      passes--;
      break;
    }

    updateAtomGridForMove(layoutGraph, atomGrid, coords, bestMove.positions);
    for (const [atomId, position] of bestMove.positions) {
      coords.set(atomId, position);
    }
    totalImprovement += bestMove.improvement;
  }

  return {
    coords,
    passes,
    improvement: totalImprovement
  };
}

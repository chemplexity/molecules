/** @module cleanup/local-rotation */

import { add, angleOf, fromAngle, rotate, sub } from '../geometry/vec2.js';
import { pointInPolygon } from '../geometry/polygon.js';
import { computeAtomDistortionCost, computeSubtreeOverlapCost } from '../audit/invariants.js';

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

  if (countedRings === 0 || Math.hypot(inwardX, inwardY) <= 1e-6) {
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
  let totalImprovement = 0;
  let passes = 0;
  const terminalSubtrees = movableTerminalSubtrees(layoutGraph, coords);

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
      const baseOverlapCost = computeSubtreeOverlapCost(layoutGraph, coords, subtreeAtomIds, null, bondLength);
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
        const newOverlapCost = computeSubtreeOverlapCost(layoutGraph, coords, subtreeAtomIds, newPositions, bondLength);
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
      passes--;
      break;
    }

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

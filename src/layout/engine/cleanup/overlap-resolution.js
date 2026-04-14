/** @module cleanup/overlap-resolution */

import { buildAtomGrid, computeAtomDistortionCost, computeSubtreeOverlapCost, findSevereOverlaps } from '../audit/invariants.js';
import { collectCutSubtree } from './subtree-utils.js';
import { ANGLE_EPSILON, IMPROVEMENT_EPSILON, NUMERIC_EPSILON } from '../constants.js';

const RIGID_SUBTREE_ROTATION_ANGLES = Array.from({ length: 24 }, (_, index) => (index * Math.PI) / 12);
const LARGE_RIGID_SUBTREE_COMPONENT_ATOM_COUNT = 24;
const LARGE_RIGID_SUBTREE_SIZE = 6;

function isFixedAtom(layoutGraph, atomId) {
  return layoutGraph.options.preserveFixed !== false && layoutGraph.fixedCoords.has(atomId);
}

function atomPairKey(firstAtomId, secondAtomId) {
  return firstAtomId < secondAtomId ? `${firstAtomId}:${secondAtomId}` : `${secondAtomId}:${firstAtomId}`;
}

/**
 * Collects the small singly attached ring subtrees that can be moved rigidly during overlap cleanup.
 * @param {object} layoutGraph - Layout graph shell.
 * @returns {Map<string, {anchorAtomId: string, rootAtomId: string, subtreeAtomIds: string[]}>} Rigid-subtree descriptor by member atom ID.
 */
export function collectRigidPendantRingSubtrees(layoutGraph) {
  const descriptorsByAtomId = new Map();
  const ringAtomIds = new Set((layoutGraph.rings ?? []).flatMap(ring => ring.atomIds));
  const totalAtomCount = layoutGraph.atoms?.size ?? 0;
  if (ringAtomIds.size === 0 || totalAtomCount === 0) {
    return descriptorsByAtomId;
  }

  for (const bond of layoutGraph.bonds?.values?.() ?? []) {
    if (!bond || bond.kind !== 'covalent' || bond.inRing || (bond.order ?? 1) !== 1) {
      continue;
    }

    for (const [anchorAtomId, rootAtomId] of [
      [bond.a, bond.b],
      [bond.b, bond.a]
    ]) {
      const subtreeAtomIds = collectCutSubtree(layoutGraph, rootAtomId, anchorAtomId);
      if (subtreeAtomIds.has(anchorAtomId) || subtreeAtomIds.size >= totalAtomCount) {
        continue;
      }
      const heavyAtomCount = [...subtreeAtomIds].filter(atomId => layoutGraph.atoms.get(atomId)?.element !== 'H').length;
      if (heavyAtomCount === 0 || heavyAtomCount > 14) {
        continue;
      }
      if (![...subtreeAtomIds].some(atomId => ringAtomIds.has(atomId))) {
        continue;
      }
      if ([...subtreeAtomIds].some(atomId => layoutGraph.fixedCoords.has(atomId))) {
        continue;
      }

      const descriptor = {
        anchorAtomId,
        rootAtomId,
        subtreeAtomIds: [...subtreeAtomIds]
      };
      for (const atomId of descriptor.subtreeAtomIds) {
        const existingDescriptor = descriptorsByAtomId.get(atomId);
        if (!existingDescriptor || descriptor.subtreeAtomIds.length < existingDescriptor.subtreeAtomIds.length) {
          descriptorsByAtomId.set(atomId, descriptor);
        }
      }
    }
  }

  return descriptorsByAtomId;
}

/**
 * Scores how disposable an atom is during overlap cleanup.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {string} atomId - Atom identifier.
 * @returns {number} Higher scores mean the atom is safer to move.
 */
function movePreference(layoutGraph, atomId) {
  const atom = layoutGraph.atoms.get(atomId);
  if (!atom) {
    return 0;
  }
  if (atom.element === 'H') {
    return 4;
  }
  if (atom.heavyDegree <= 1) {
    return 3;
  }
  if (atom.heavyDegree === 2) {
    return 2;
  }
  return 1;
}

/**
 * Chooses which atom in an overlap pair should move.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {string} firstAtomId - First overlapping atom ID.
 * @param {string} secondAtomId - Second overlapping atom ID.
 * @param {boolean} firstFixed - Whether the first atom is fixed.
 * @param {boolean} secondFixed - Whether the second atom is fixed.
 * @returns {{mode: 'first'|'second'|'both', scale: number}|null} Move strategy, or null when neither atom can move.
 */
function chooseMoveStrategy(layoutGraph, firstAtomId, secondAtomId, firstFixed, secondFixed) {
  if (firstFixed && secondFixed) {
    return null;
  }
  if (firstFixed) {
    return { mode: 'second', scale: 2 };
  }
  if (secondFixed) {
    return { mode: 'first', scale: 2 };
  }

  const firstPreference = movePreference(layoutGraph, firstAtomId);
  const secondPreference = movePreference(layoutGraph, secondAtomId);
  if (firstPreference > secondPreference) {
    return { mode: 'first', scale: 2 };
  }
  if (secondPreference > firstPreference) {
    return { mode: 'second', scale: 2 };
  }
  return { mode: 'both', scale: 1 };
}

/**
 * Returns the unique heavy-atom anchor for a terminal substituent.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {string} atomId - Atom identifier.
 * @returns {string|null} Anchor atom ID, or null when the atom is not singly anchored.
 */
function singleHeavyAnchorAtomId(layoutGraph, atomId) {
  const heavyNeighborIds = [];
  for (const bond of layoutGraph.bondsByAtomId?.get(atomId) ?? []) {
    if (!bond || bond.kind !== 'covalent') {
      continue;
    }
    const neighborAtomId = bond.a === atomId ? bond.b : bond.a;
    const neighborAtom = layoutGraph.atoms.get(neighborAtomId);
    if (!neighborAtom || neighborAtom.element === 'H') {
      continue;
    }
    heavyNeighborIds.push(neighborAtomId);
  }
  return heavyNeighborIds.length === 1 ? heavyNeighborIds[0] : null;
}

/**
 * Rotates a 2D vector around the origin.
 * @param {{x: number, y: number}} vector - Input vector.
 * @param {number} angle - Rotation angle in radians.
 * @returns {{x: number, y: number}} Rotated vector.
 */
function rotateVector(vector, angle) {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return {
    x: vector.x * cos - vector.y * sin,
    y: vector.x * sin + vector.y * cos
  };
}

/**
 * Applies a rigid subtree move and updates the atom grid in place.
 * @param {Map<string, {x: number, y: number}>} coords - Current coordinate map.
 * @param {AtomGrid} atomGrid - Spatial atom grid.
 * @param {Map<string, {x: number, y: number}>} newPositions - Replacement subtree coordinates.
 * @returns {void}
 */
function applyRigidSubtreeMove(coords, atomGrid, newPositions) {
  for (const [atomId, newPosition] of newPositions) {
    const previousPosition = coords.get(atomId);
    if (!previousPosition) {
      continue;
    }
    atomGrid.remove(atomId, previousPosition);
    previousPosition.x = newPosition.x;
    previousPosition.y = newPosition.y;
    atomGrid.insert(atomId, previousPosition);
  }
}

/**
 * Returns the rotation angles to evaluate for a rigid pendant subtree move.
 * Larger/crowded layouts use a coarser sampling so we do not brute-force the
 * full 24-angle set on every sugar-like subtree overlap.
 * @param {number} subtreeSize - Number of atoms in the rigid subtree.
 * @param {number} visibleAtomCount - Visible laid-out atom count.
 * @returns {number[]} Rotation angles in radians.
 */
function rigidSubtreeCandidateAngles(subtreeSize, visibleAtomCount) {
  if (subtreeSize < LARGE_RIGID_SUBTREE_SIZE && visibleAtomCount < LARGE_RIGID_SUBTREE_COMPONENT_ATOM_COUNT) {
    return RIGID_SUBTREE_ROTATION_ANGLES;
  }

  const coarseAngles = RIGID_SUBTREE_ROTATION_ANGLES.filter((_, index) => index % 2 === 0);
  const refineAngles = new Set();
  for (const coarseAngle of coarseAngles) {
    refineAngles.add(coarseAngle);
  }
  return [...refineAngles];
}

/**
 * Attempts to clear an overlap by rotating a singly attached ring subtree as a rigid body.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Current coordinate map.
 * @param {AtomGrid} atomGrid - Spatial atom grid.
 * @param {{anchorAtomId: string, rootAtomId: string, subtreeAtomIds: string[]}|undefined} descriptor - Candidate rigid-subtree descriptor.
 * @param {string} movingAtomId - Overlapping atom within the subtree.
 * @param {string} opposingAtomId - Opposing overlapping atom.
 * @param {number} bondLength - Target bond length.
 * @param {number} threshold - Severe-overlap threshold.
 * @param {number} visibleAtomCount - Visible laid-out atom count.
 * @returns {{positions: Map<string, {x: number, y: number}>, improvement: number, resolvedDistance: number}|null} Best rigid-subtree move, or null.
 */
function bestRigidSubtreeMove(layoutGraph, coords, atomGrid, descriptor, movingAtomId, opposingAtomId, bondLength, threshold, visibleAtomCount) {
  if (!descriptor || !descriptor.subtreeAtomIds.includes(movingAtomId) || descriptor.subtreeAtomIds.includes(opposingAtomId)) {
    return null;
  }

  const anchorPosition = coords.get(descriptor.anchorAtomId);
  const rootPosition = coords.get(descriptor.rootAtomId);
  const movingPosition = coords.get(movingAtomId);
  const opposingPosition = coords.get(opposingAtomId);
  if (!anchorPosition || !rootPosition || !movingPosition || !opposingPosition) {
    return null;
  }

  const currentRootVector = {
    x: rootPosition.x - anchorPosition.x,
    y: rootPosition.y - anchorPosition.y
  };
  const currentRootAngle = Math.atan2(currentRootVector.y, currentRootVector.x);
  const baseOverlapCost = computeSubtreeOverlapCost(layoutGraph, coords, descriptor.subtreeAtomIds, null, bondLength, { atomGrid });
  const baseAnchorDistortion = computeAtomDistortionCost(layoutGraph, coords, descriptor.anchorAtomId, null);
  let bestMove = null;

  for (const candidateAngle of rigidSubtreeCandidateAngles(descriptor.subtreeAtomIds.length, visibleAtomCount)) {
    const rotation = candidateAngle - currentRootAngle;
    if (Math.abs(rotation) <= ANGLE_EPSILON) {
      continue;
    }

    const newPositions = new Map();
    for (const subtreeAtomId of descriptor.subtreeAtomIds) {
      const subtreePosition = coords.get(subtreeAtomId);
      if (!subtreePosition) {
        continue;
      }
      const relativeVector = {
        x: subtreePosition.x - anchorPosition.x,
        y: subtreePosition.y - anchorPosition.y
      };
      const rotatedVector = rotateVector(relativeVector, rotation);
      newPositions.set(subtreeAtomId, {
        x: anchorPosition.x + rotatedVector.x,
        y: anchorPosition.y + rotatedVector.y
      });
    }

    const movedAtomPosition = newPositions.get(movingAtomId);
    if (!movedAtomPosition) {
      continue;
    }
    const resolvedDistance = Math.hypot(movedAtomPosition.x - opposingPosition.x, movedAtomPosition.y - opposingPosition.y);
    if (resolvedDistance < threshold) {
      continue;
    }

    const newOverlapCost = computeSubtreeOverlapCost(layoutGraph, coords, descriptor.subtreeAtomIds, newPositions, bondLength, { atomGrid });
    const newAnchorDistortion = computeAtomDistortionCost(layoutGraph, coords, descriptor.anchorAtomId, newPositions);
    const improvement = baseOverlapCost - newOverlapCost + (baseAnchorDistortion - newAnchorDistortion);
    if (improvement <= IMPROVEMENT_EPSILON) {
      continue;
    }

    if (
      !bestMove ||
      improvement > bestMove.improvement + IMPROVEMENT_EPSILON ||
      (Math.abs(improvement - bestMove.improvement) <= IMPROVEMENT_EPSILON && resolvedDistance > bestMove.resolvedDistance + IMPROVEMENT_EPSILON)
    ) {
      bestMove = {
        positions: newPositions,
        improvement,
        resolvedDistance
      };
    }
  }

  return bestMove;
}

/**
 * Keeps singly anchored substituents on their original bond-length circle during nudges.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Current coordinate map.
 * @param {string} atomId - Atom being moved.
 * @param {{x: number, y: number}} tentativePosition - Tentative moved position.
 * @param {string} opposingAtomId - Atom that triggered the overlap.
 * @param {number} threshold - Target nonbonded separation.
 * @returns {{x: number, y: number}} Constrained moved position.
 */
function constrainSingleAtomMove(layoutGraph, coords, atomId, tentativePosition, opposingAtomId, threshold) {
  const anchorAtomId = singleHeavyAnchorAtomId(layoutGraph, atomId);
  if (!anchorAtomId) {
    return tentativePosition;
  }
  const anchorPosition = coords.get(anchorAtomId);
  const currentPosition = coords.get(atomId);
  const opposingPosition = coords.get(opposingAtomId);
  if (!anchorPosition || !currentPosition) {
    return tentativePosition;
  }
  if (!opposingPosition) {
    return tentativePosition;
  }

  const radius = Math.hypot(currentPosition.x - anchorPosition.x, currentPosition.y - anchorPosition.y);
  if (radius <= NUMERIC_EPSILON) {
    return tentativePosition;
  }
  const currentVector = {
    x: currentPosition.x - anchorPosition.x,
    y: currentPosition.y - anchorPosition.y
  };
  const tentativeShift = Math.hypot(tentativePosition.x - currentPosition.x, tentativePosition.y - currentPosition.y);
  if (tentativeShift <= NUMERIC_EPSILON) {
    return tentativePosition;
  }
  const minimumNonbondedDistance = candidatePosition => {
    let minimumDistance = Number.POSITIVE_INFINITY;
    for (const [otherAtomId, otherPosition] of coords) {
      if (otherAtomId === atomId || otherAtomId === anchorAtomId || layoutGraph.bondedPairSet?.has(atomPairKey(atomId, otherAtomId))) {
        continue;
      }
      minimumDistance = Math.min(minimumDistance, Math.hypot(candidatePosition.x - otherPosition.x, candidatePosition.y - otherPosition.y));
    }
    return Number.isFinite(minimumDistance) ? minimumDistance : Number.POSITIVE_INFINITY;
  };
  const baseStep = Math.max(tentativeShift / radius, Math.PI / 18);
  let bestCandidate = null;

  for (const multiplier of [1, 1.5, 2, 3]) {
    const step = Math.min(baseStep * multiplier, Math.PI / 2);
    for (const direction of [-1, 1]) {
      const rotated = rotateVector(currentVector, step * direction);
      const candidatePosition = {
        x: anchorPosition.x + rotated.x,
        y: anchorPosition.y + rotated.y
      };
      const opposingDistance = Math.hypot(candidatePosition.x - opposingPosition.x, candidatePosition.y - opposingPosition.y);
      const nonbondedDistance = minimumNonbondedDistance(candidatePosition);
      const clearsThreshold = opposingDistance >= threshold;
      if (!bestCandidate) {
        bestCandidate = { position: candidatePosition, opposingDistance, nonbondedDistance, step, clearsThreshold };
        continue;
      }
      if (clearsThreshold !== bestCandidate.clearsThreshold) {
        if (clearsThreshold) {
          bestCandidate = { position: candidatePosition, opposingDistance, nonbondedDistance, step, clearsThreshold };
        }
        continue;
      }
      if (clearsThreshold) {
        if (nonbondedDistance > bestCandidate.nonbondedDistance + NUMERIC_EPSILON) {
          bestCandidate = { position: candidatePosition, opposingDistance, nonbondedDistance, step, clearsThreshold };
          continue;
        }
        if (
          Math.abs(nonbondedDistance - bestCandidate.nonbondedDistance) <= NUMERIC_EPSILON &&
          (step < bestCandidate.step - NUMERIC_EPSILON || (Math.abs(step - bestCandidate.step) <= NUMERIC_EPSILON && opposingDistance > bestCandidate.opposingDistance))
        ) {
          bestCandidate = { position: candidatePosition, opposingDistance, nonbondedDistance, step, clearsThreshold };
        }
      } else if (
        opposingDistance > bestCandidate.opposingDistance + NUMERIC_EPSILON ||
        (Math.abs(opposingDistance - bestCandidate.opposingDistance) <= NUMERIC_EPSILON && nonbondedDistance > bestCandidate.nonbondedDistance)
      ) {
        bestCandidate = { position: candidatePosition, opposingDistance, nonbondedDistance, step, clearsThreshold };
      }
    }
  }

  return bestCandidate?.position ?? tentativePosition;
}

/**
 * Resolves the most severe nonbonded overlaps with a conservative nudge pass.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} inputCoords - Coordinate map.
 * @param {object} [options] - Overlap-resolution options.
 * @param {number} [options.bondLength] - Target bond length.
 * @param {number} [options.maxPasses] - Maximum overlap passes.
 * @param {number} [options.thresholdFactor] - Overlap target as a bond-length multiple, clamped to the audit severe-overlap floor.
 * @returns {{coords: Map<string, {x: number, y: number}>, moves: number}} Updated coordinates and move count.
 */
export function resolveOverlaps(layoutGraph, inputCoords, options = {}) {
  const bondLength = options.bondLength ?? layoutGraph.options.bondLength;
  const maxPasses = options.maxPasses ?? 5;
  const threshold = bondLength * Math.max(options.thresholdFactor ?? 0.45, 0.55);
  const coords = new Map([...inputCoords.entries()].map(([atomId, position]) => [atomId, { ...position }]));
  const atomGrid = buildAtomGrid(layoutGraph, coords, bondLength);
  const rigidSubtreesByAtomId = options.rigidSubtreesByAtomId ?? collectRigidPendantRingSubtrees(layoutGraph);
  const visibleAtomCount = options.visibleAtomCount ?? [...layoutGraph.atoms.values()].filter(atom => atom.visible).length;
  let moves = 0;

  for (let pass = 0; pass < maxPasses; pass++) {
    const overlaps = findSevereOverlaps(layoutGraph, coords, bondLength, { atomGrid });
    if (overlaps.length === 0) {
      break;
    }

    let movedThisPass = false;
    for (const overlap of overlaps) {
      const firstPosition = coords.get(overlap.firstAtomId);
      const secondPosition = coords.get(overlap.secondAtomId);
      if (!firstPosition || !secondPosition) {
        continue;
      }

      const dx = secondPosition.x - firstPosition.x;
      const dy = secondPosition.y - firstPosition.y;
      const distance = Math.hypot(dx, dy) || 1;
      const deficit = threshold - overlap.distance;
      if (deficit <= 0) {
        continue;
      }
      const ux = dx / distance;
      const uy = dy / distance;
      const delta = deficit / 2 + bondLength * 0.02;

      const firstFixed = isFixedAtom(layoutGraph, overlap.firstAtomId);
      const secondFixed = isFixedAtom(layoutGraph, overlap.secondAtomId);
      const strategy = chooseMoveStrategy(layoutGraph, overlap.firstAtomId, overlap.secondAtomId, firstFixed, secondFixed);
      if (!strategy) {
        continue;
      }

      const firstRigidMove = bestRigidSubtreeMove(
        layoutGraph,
        coords,
        atomGrid,
        rigidSubtreesByAtomId.get(overlap.firstAtomId),
        overlap.firstAtomId,
        overlap.secondAtomId,
        bondLength,
        threshold,
        visibleAtomCount
      );
      const secondRigidMove = bestRigidSubtreeMove(
        layoutGraph,
        coords,
        atomGrid,
        rigidSubtreesByAtomId.get(overlap.secondAtomId),
        overlap.secondAtomId,
        overlap.firstAtomId,
        bondLength,
        threshold,
        visibleAtomCount
      );
      const rigidMove = !firstRigidMove
        ? secondRigidMove
        : !secondRigidMove
          ? firstRigidMove
          : firstRigidMove.improvement >= secondRigidMove.improvement
            ? firstRigidMove
            : secondRigidMove;
      if (rigidMove) {
        applyRigidSubtreeMove(coords, atomGrid, rigidMove.positions);
        moves++;
        movedThisPass = true;
        break;
      }

      if (strategy.mode === 'second') {
        const previousSecondPosition = { ...secondPosition };
        const constrainedPosition = constrainSingleAtomMove(
          layoutGraph,
          coords,
          overlap.secondAtomId,
          {
            x: secondPosition.x + ux * delta * strategy.scale,
            y: secondPosition.y + uy * delta * strategy.scale
          },
          overlap.firstAtomId,
          threshold
        );
        secondPosition.x = constrainedPosition.x;
        secondPosition.y = constrainedPosition.y;
        atomGrid.remove(overlap.secondAtomId, previousSecondPosition);
        atomGrid.insert(overlap.secondAtomId, secondPosition);
      } else if (strategy.mode === 'first') {
        const previousFirstPosition = { ...firstPosition };
        const constrainedPosition = constrainSingleAtomMove(
          layoutGraph,
          coords,
          overlap.firstAtomId,
          {
            x: firstPosition.x - ux * delta * strategy.scale,
            y: firstPosition.y - uy * delta * strategy.scale
          },
          overlap.secondAtomId,
          threshold
        );
        firstPosition.x = constrainedPosition.x;
        firstPosition.y = constrainedPosition.y;
        atomGrid.remove(overlap.firstAtomId, previousFirstPosition);
        atomGrid.insert(overlap.firstAtomId, firstPosition);
      } else {
        const previousFirstPosition = { ...firstPosition };
        const previousSecondPosition = { ...secondPosition };
        firstPosition.x -= ux * delta;
        firstPosition.y -= uy * delta;
        secondPosition.x += ux * delta;
        secondPosition.y += uy * delta;
        atomGrid.remove(overlap.firstAtomId, previousFirstPosition);
        atomGrid.remove(overlap.secondAtomId, previousSecondPosition);
        atomGrid.insert(overlap.firstAtomId, firstPosition);
        atomGrid.insert(overlap.secondAtomId, secondPosition);
      }
      moves++;
      movedThisPass = true;
    }

    if (!movedThisPass) {
      break;
    }
  }

  return { coords, moves };
}

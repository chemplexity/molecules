/** @module cleanup/overlap-resolution */

import { findSevereOverlaps } from '../audit/invariants.js';

function isFixedAtom(layoutGraph, atomId) {
  return layoutGraph.options.preserveFixed !== false && layoutGraph.fixedCoords.has(atomId);
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
    x: (vector.x * cos) - (vector.y * sin),
    y: (vector.x * sin) + (vector.y * cos)
  };
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
  if (radius <= 1e-12) {
    return tentativePosition;
  }
  const currentVector = {
    x: currentPosition.x - anchorPosition.x,
    y: currentPosition.y - anchorPosition.y
  };
  const tentativeShift = Math.hypot(tentativePosition.x - currentPosition.x, tentativePosition.y - currentPosition.y);
  if (tentativeShift <= 1e-12) {
    return tentativePosition;
  }
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
      const opposingDistance = Math.hypot(
        candidatePosition.x - opposingPosition.x,
        candidatePosition.y - opposingPosition.y
      );
      const clearsThreshold = opposingDistance >= threshold;
      if (!bestCandidate) {
        bestCandidate = { position: candidatePosition, opposingDistance, step, clearsThreshold };
        continue;
      }
      if (clearsThreshold !== bestCandidate.clearsThreshold) {
        if (clearsThreshold) {
          bestCandidate = { position: candidatePosition, opposingDistance, step, clearsThreshold };
        }
        continue;
      }
      if (clearsThreshold) {
        if (step < bestCandidate.step - 1e-12
          || (Math.abs(step - bestCandidate.step) <= 1e-12 && opposingDistance > bestCandidate.opposingDistance)) {
          bestCandidate = { position: candidatePosition, opposingDistance, step, clearsThreshold };
        }
      } else if (opposingDistance > bestCandidate.opposingDistance) {
        bestCandidate = { position: candidatePosition, opposingDistance, step, clearsThreshold };
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
  let moves = 0;

  for (let pass = 0; pass < maxPasses; pass++) {
    const overlaps = findSevereOverlaps(layoutGraph, coords, bondLength);
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
      const delta = (deficit / 2) + (bondLength * 0.02);

      const firstFixed = isFixedAtom(layoutGraph, overlap.firstAtomId);
      const secondFixed = isFixedAtom(layoutGraph, overlap.secondAtomId);
      const strategy = chooseMoveStrategy(
        layoutGraph,
        overlap.firstAtomId,
        overlap.secondAtomId,
        firstFixed,
        secondFixed
      );
      if (!strategy) {
        continue;
      }

      if (strategy.mode === 'second') {
        const constrainedPosition = constrainSingleAtomMove(layoutGraph, coords, overlap.secondAtomId, {
          x: secondPosition.x + (ux * delta * strategy.scale),
          y: secondPosition.y + (uy * delta * strategy.scale)
        }, overlap.firstAtomId, threshold);
        secondPosition.x = constrainedPosition.x;
        secondPosition.y = constrainedPosition.y;
      } else if (strategy.mode === 'first') {
        const constrainedPosition = constrainSingleAtomMove(layoutGraph, coords, overlap.firstAtomId, {
          x: firstPosition.x - (ux * delta * strategy.scale),
          y: firstPosition.y - (uy * delta * strategy.scale)
        }, overlap.secondAtomId, threshold);
        firstPosition.x = constrainedPosition.x;
        firstPosition.y = constrainedPosition.y;
      } else {
        firstPosition.x -= ux * delta;
        firstPosition.y -= uy * delta;
        secondPosition.x += ux * delta;
        secondPosition.y += uy * delta;
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

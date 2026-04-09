/** @module cleanup/overlap-resolution */

import { findSevereOverlaps } from '../audit/invariants.js';

function isFixedAtom(layoutGraph, atomId) {
  return layoutGraph.options.preserveFixed !== false && layoutGraph.fixedCoords.has(atomId);
}

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
 * Resolves the most severe nonbonded overlaps with a conservative nudge pass.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} inputCoords - Coordinate map.
 * @param {object} [options] - Overlap-resolution options.
 * @param {number} [options.bondLength] - Target bond length.
 * @param {number} [options.maxPasses] - Maximum overlap passes.
 * @returns {{coords: Map<string, {x: number, y: number}>, moves: number}} Updated coordinates and move count.
 */
export function resolveOverlaps(layoutGraph, inputCoords, options = {}) {
  const bondLength = options.bondLength ?? layoutGraph.options.bondLength;
  const maxPasses = options.maxPasses ?? 2;
  const threshold = bondLength * 0.55;
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
      if (firstFixed && secondFixed) {
        continue;
      }

      if (firstFixed || (!secondFixed && movePreference(layoutGraph, overlap.secondAtomId) > movePreference(layoutGraph, overlap.firstAtomId))) {
        secondPosition.x += ux * (firstFixed ? delta * 2 : delta);
        secondPosition.y += uy * (firstFixed ? delta * 2 : delta);
      } else if (secondFixed) {
        firstPosition.x -= ux * delta * 2;
        firstPosition.y -= uy * delta * 2;
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

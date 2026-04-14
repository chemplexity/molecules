/** @module cleanup/bridged-bond-tidy */

import { normalize, scale, sub } from '../geometry/vec2.js';

const DEFAULT_MAX_ITERATIONS = 4;
const MIN_STRETCH_FACTOR = 1.16;
const MOVEMENT_DAMPING = 0.45;

function atomTouchesAromaticRing(layoutGraph, atomId) {
  return (layoutGraph.atomToRings.get(atomId) ?? []).some(ring => ring.aromatic);
}

function atomRingCount(layoutGraph, atomId) {
  return layoutGraph.atomToRings.get(atomId)?.length ?? 0;
}

function atomMobility(layoutGraph, atomId) {
  if (layoutGraph.fixedCoords.has(atomId)) {
    return 0;
  }
  const atom = layoutGraph.atoms.get(atomId);
  if (!atom || atom.element === 'H' || atom.visible === false) {
    return 0;
  }
  if (atom.aromatic || atomTouchesAromaticRing(layoutGraph, atomId)) {
    return 0;
  }
  const ringCount = atomRingCount(layoutGraph, atomId);
  return 1 / (1 + atom.heavyDegree + ringCount * 1.5);
}

function shouldTidyBond(layoutGraph, bond, coords, bondLength) {
  if (!bond || bond.kind !== 'covalent' || bond.aromatic || (bond.order ?? 1) !== 1) {
    return false;
  }
  const firstAtom = layoutGraph.atoms.get(bond.a);
  const secondAtom = layoutGraph.atoms.get(bond.b);
  if (!firstAtom || !secondAtom || firstAtom.element === 'H' || secondAtom.element === 'H') {
    return false;
  }
  if (firstAtom.aromatic || secondAtom.aromatic || atomTouchesAromaticRing(layoutGraph, bond.a) || atomTouchesAromaticRing(layoutGraph, bond.b)) {
    return false;
  }
  if (firstAtom.visible === false || secondAtom.visible === false) {
    return false;
  }
  if (atomRingCount(layoutGraph, bond.a) === 0 || atomRingCount(layoutGraph, bond.b) === 0) {
    return false;
  }
  const firstPosition = coords.get(bond.a);
  const secondPosition = coords.get(bond.b);
  if (!firstPosition || !secondPosition) {
    return false;
  }
  return Math.hypot(secondPosition.x - firstPosition.x, secondPosition.y - firstPosition.y) > bondLength * MIN_STRETCH_FACTOR;
}

/**
 * Contracts overstretched local single bonds inside bridged ring systems without
 * rerunning full cleanup. The pass favors moving the less-connected endpoint so
 * dense cages stay readable while remaining close to the existing scaffold.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} inputCoords - Coordinate map.
 * @param {object} [options] - Tidy options.
 * @param {number} [options.bondLength] - Target bond length.
 * @param {number} [options.maxIterations] - Iteration budget.
 * @returns {{coords: Map<string, {x: number, y: number}>, nudges: number, iterations: number}} Tidied coordinates and correction stats.
 */
export function runBridgedBondTidy(layoutGraph, inputCoords, options = {}) {
  const bondLength = options.bondLength ?? layoutGraph.options.bondLength;
  const maxIterations = options.maxIterations ?? DEFAULT_MAX_ITERATIONS;
  const coords = new Map([...inputCoords.entries()].map(([atomId, position]) => [atomId, { ...position }]));
  let nudges = 0;
  let iterations = 0;

  for (let iteration = 0; iteration < maxIterations; iteration++) {
    const displacements = new Map();
    const counts = new Map();

    for (const bond of layoutGraph.bonds.values()) {
      if (!shouldTidyBond(layoutGraph, bond, coords, bondLength)) {
        continue;
      }
      const firstPosition = coords.get(bond.a);
      const secondPosition = coords.get(bond.b);
      const vector = sub(secondPosition, firstPosition);
      const currentLength = Math.hypot(vector.x, vector.y);
      const excess = currentLength - bondLength;
      if (excess <= 1e-6) {
        continue;
      }

      const direction = normalize(vector);
      const firstMobility = atomMobility(layoutGraph, bond.a);
      const secondMobility = atomMobility(layoutGraph, bond.b);
      const totalMobility = firstMobility + secondMobility;
      if (totalMobility <= 1e-6) {
        continue;
      }

      const firstShare = secondMobility / totalMobility;
      const secondShare = firstMobility / totalMobility;
      const firstDelta = scale(direction, excess * firstShare * MOVEMENT_DAMPING);
      const secondDelta = scale(direction, -excess * secondShare * MOVEMENT_DAMPING);

      displacements.set(
        bond.a,
        displacements.has(bond.a)
          ? {
              x: displacements.get(bond.a).x + firstDelta.x,
              y: displacements.get(bond.a).y + firstDelta.y
            }
          : firstDelta
      );
      displacements.set(
        bond.b,
        displacements.has(bond.b)
          ? {
              x: displacements.get(bond.b).x + secondDelta.x,
              y: displacements.get(bond.b).y + secondDelta.y
            }
          : secondDelta
      );
      counts.set(bond.a, (counts.get(bond.a) ?? 0) + 1);
      counts.set(bond.b, (counts.get(bond.b) ?? 0) + 1);
    }

    if (displacements.size === 0) {
      break;
    }

    let moved = false;
    for (const [atomId, delta] of displacements) {
      const count = counts.get(atomId) ?? 1;
      const position = coords.get(atomId);
      if (!position) {
        continue;
      }
      const nextPosition = {
        x: position.x + delta.x / count,
        y: position.y + delta.y / count
      };
      if (Math.hypot(nextPosition.x - position.x, nextPosition.y - position.y) <= 1e-6) {
        continue;
      }
      coords.set(atomId, nextPosition);
      nudges++;
      moved = true;
    }

    if (!moved) {
      break;
    }
    iterations++;
  }

  return { coords, nudges, iterations };
}

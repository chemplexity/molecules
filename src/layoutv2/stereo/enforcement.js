/** @module stereo/enforcement */

import { measureLayoutCost } from '../audit/invariants.js';
import { actualAlkeneStereo } from './ez.js';

function ringAtomIdSet(layoutGraph) {
  const atomIds = new Set();
  for (const ring of layoutGraph.rings ?? []) {
    for (const atomId of ring.atomIds) {
      atomIds.add(atomId);
    }
  }
  return atomIds;
}

function collectSideAtoms(layoutGraph, startAtomId, blockedAtomId) {
  const sideAtomIds = new Set();
  const seen = new Set([blockedAtomId]);
  const queue = [startAtomId];

  while (queue.length > 0) {
    const atomId = queue.shift();
    if (seen.has(atomId)) {
      continue;
    }
    seen.add(atomId);
    sideAtomIds.add(atomId);

    const atom = layoutGraph.sourceMolecule.atoms.get(atomId);
    if (!atom) {
      continue;
    }
    for (const neighborAtom of atom.getNeighbors(layoutGraph.sourceMolecule)) {
      if (neighborAtom && !seen.has(neighborAtom.id)) {
        queue.push(neighborAtom.id);
      }
    }
  }

  return sideAtomIds;
}

function countHeavyAtoms(layoutGraph, atomIds, coords) {
  let count = 0;
  for (const atomId of atomIds) {
    if (coords && !coords.has(atomId)) {
      continue;
    }
    if (layoutGraph.atoms.get(atomId)?.element !== 'H') {
      count++;
    }
  }
  return count;
}

/**
 * Measures the maximum pairwise heavy-atom span in a coordinate set.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Coordinate map.
 * @returns {number} Maximum squared heavy-atom distance.
 */
function measureHeavyAtomSpan(layoutGraph, coords) {
  const heavyPositions = [];
  for (const [atomId, position] of coords) {
    if (layoutGraph.atoms.get(atomId)?.element === 'H') {
      continue;
    }
    heavyPositions.push(position);
  }

  let maxDistanceSquared = 0;
  for (let firstIndex = 0; firstIndex < heavyPositions.length; firstIndex++) {
    const firstPosition = heavyPositions[firstIndex];
    for (let secondIndex = firstIndex + 1; secondIndex < heavyPositions.length; secondIndex++) {
      const secondPosition = heavyPositions[secondIndex];
      const dx = secondPosition.x - firstPosition.x;
      const dy = secondPosition.y - firstPosition.y;
      maxDistanceSquared = Math.max(maxDistanceSquared, (dx * dx) + (dy * dy));
    }
  }

  return maxDistanceSquared;
}

function reflectPointAcrossLine(position, firstPoint, secondPoint) {
  const dx = secondPoint.x - firstPoint.x;
  const dy = secondPoint.y - firstPoint.y;
  const lengthSquared = (dx * dx) + (dy * dy);
  if (lengthSquared < 1e-12) {
    return { ...position };
  }

  const projectionScale = (((position.x - firstPoint.x) * dx) + ((position.y - firstPoint.y) * dy)) / lengthSquared;
  const projection = {
    x: firstPoint.x + (projectionScale * dx),
    y: firstPoint.y + (projectionScale * dy)
  };
  return {
    x: (2 * projection.x) - position.x,
    y: (2 * projection.y) - position.y
  };
}

function reflectSideCoords(coords, sideAtomIds, firstAtomId, secondAtomId) {
  const firstPoint = coords.get(firstAtomId);
  const secondPoint = coords.get(secondAtomId);
  if (!firstPoint || !secondPoint) {
    return null;
  }

  const reflectedCoords = new Map();
  for (const atomId of sideAtomIds) {
    const position = coords.get(atomId);
    if (!position) {
      continue;
    }
    reflectedCoords.set(atomId, reflectPointAcrossLine(position, firstPoint, secondPoint));
  }
  return reflectedCoords;
}

function countMatchedStereo(layoutGraph, coords, stereoBonds) {
  let count = 0;
  for (const bond of stereoBonds) {
    const targetStereo = layoutGraph.sourceMolecule.getEZStereo?.(bond.id) ?? null;
    if (targetStereo && actualAlkeneStereo(layoutGraph, coords, bond) === targetStereo) {
      count++;
    }
  }
  return count;
}

/**
 * Enforces acyclic E/Z alkene geometry by reflecting one side of a mismatched
 * double bond across its bond axis. Candidate reflections are ranked by total
 * matched alkene-stereo count, then heavy-atom span, then layout cost, then
 * moved heavy-atom count.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} inputCoords - Coordinate map.
 * @param {object} [options] - Enforcement options.
 * @param {number} [options.bondLength] - Target bond length.
 * @returns {{coords: Map<string, {x: number, y: number}>, reflections: number}} Updated coordinates and reflection count.
 */
export function enforceAcyclicEZStereo(layoutGraph, inputCoords, options = {}) {
  const bondLength = options.bondLength ?? layoutGraph.options.bondLength;
  let coords = new Map([...inputCoords.entries()].map(([atomId, position]) => [atomId, { ...position }]));
  const ringAtomIds = ringAtomIdSet(layoutGraph);
  const stereoBonds = [...layoutGraph.bonds.values()].filter(bond =>
    bond.kind === 'covalent' &&
    !bond.aromatic &&
    (bond.order ?? 1) === 2 &&
    !ringAtomIds.has(bond.a) &&
    !ringAtomIds.has(bond.b) &&
    (layoutGraph.sourceMolecule.getEZStereo?.(bond.id) ?? null) != null
  );

  if (stereoBonds.length === 0) {
    return { coords, reflections: 0 };
  }

  let reflections = 0;

  for (let pass = 0; pass < stereoBonds.length; pass++) {
    let changed = false;

    for (const bond of stereoBonds) {
      const targetStereo = layoutGraph.sourceMolecule.getEZStereo?.(bond.id) ?? null;
      const actualStereo = actualAlkeneStereo(layoutGraph, coords, bond);
      if (!targetStereo || actualStereo == null || actualStereo === targetStereo) {
        continue;
      }

      let bestCandidate = null;
      for (const sideAtomIds of [collectSideAtoms(layoutGraph, bond.a, bond.b), collectSideAtoms(layoutGraph, bond.b, bond.a)]) {
        const reflectedSide = reflectSideCoords(coords, sideAtomIds, bond.a, bond.b);
        if (!reflectedSide || reflectedSide.size === 0) {
          continue;
        }

        const candidateCoords = new Map([...coords.entries()].map(([atomId, position]) => [atomId, { ...position }]));
        for (const [atomId, position] of reflectedSide) {
          candidateCoords.set(atomId, position);
        }

        if (actualAlkeneStereo(layoutGraph, candidateCoords, bond) !== targetStereo) {
          continue;
        }

        const candidate = {
          coords: candidateCoords,
          matchedStereoCount: countMatchedStereo(layoutGraph, candidateCoords, stereoBonds),
          heavyAtomSpan: measureHeavyAtomSpan(layoutGraph, candidateCoords),
          layoutCost: measureLayoutCost(layoutGraph, candidateCoords, bondLength),
          heavyAtomCount: countHeavyAtoms(layoutGraph, sideAtomIds, candidateCoords)
        };

        if (
          !bestCandidate ||
          candidate.matchedStereoCount > bestCandidate.matchedStereoCount ||
          (candidate.matchedStereoCount === bestCandidate.matchedStereoCount &&
            candidate.heavyAtomSpan > bestCandidate.heavyAtomSpan + 1e-6) ||
          (candidate.matchedStereoCount === bestCandidate.matchedStereoCount &&
            Math.abs(candidate.heavyAtomSpan - bestCandidate.heavyAtomSpan) <= 1e-6 &&
            candidate.layoutCost < bestCandidate.layoutCost - 1e-6) ||
          (candidate.matchedStereoCount === bestCandidate.matchedStereoCount &&
            Math.abs(candidate.heavyAtomSpan - bestCandidate.heavyAtomSpan) <= 1e-6 &&
            Math.abs(candidate.layoutCost - bestCandidate.layoutCost) <= 1e-6 &&
            candidate.heavyAtomCount < bestCandidate.heavyAtomCount)
        ) {
          bestCandidate = candidate;
        }
      }

      if (!bestCandidate) {
        continue;
      }

      coords = bestCandidate.coords;
      reflections++;
      changed = true;
    }

    if (!changed) {
      break;
    }
  }

  return { coords, reflections };
}

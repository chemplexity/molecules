/** @module layout/coords2d/stereo-enforcement */

import { _reflectPoint, rotateAround, pointToSegmentDistance } from './geom2d.js';
import { _layoutNeighbors, _layoutCompareAtomIds } from './neighbor-ordering.js';
import { countHeavyAtoms } from './refinement-context.js';
import { actualAlkeneStereoFromCoords, backboneTurnSign, collectAllRefinementChainPaths } from './refinement-issues.js';
export { backboneTurnSign } from './refinement-issues.js';
import { reflectSubtreeCoords } from './projection-transforms.js';

/**
 * Finds the longest acyclic heavy-atom path through the molecule, preferring paths with fewer ring atoms.
 *
 * @param {Object} molecule - The molecule graph
 * @returns {{ path: string[], ringCount: number, score: number }|null} Best path info, or null if fewer than 2 heavy atoms
 */
export function findPreferredBackbonePath(molecule) {
  const heavyIds = [...molecule.atoms.keys()].filter(id => molecule.atoms.get(id)?.name !== 'H');
  if (heavyIds.length < 2) {
    return null;
  }

  const ringAtoms = new Set(molecule.getRings().flat());
  let best = null;

  for (const startId of heavyIds) {
    const prev = new Map([[startId, null]]);
    const queue = [startId];
    let queueHead = 0;
    while (queueHead < queue.length) {
      const cur = queue[queueHead++];
      for (const nb of _layoutNeighbors(molecule, cur)) {
        if (molecule.atoms.get(nb)?.name === 'H' || prev.has(nb)) {
          continue;
        }
        prev.set(nb, cur);
        queue.push(nb);
      }
    }

    for (const endId of heavyIds) {
      if (endId === startId || !prev.has(endId)) {
        continue;
      }
      const path = [];
      for (let cur = endId; cur != null; cur = prev.get(cur)) {
        path.push(cur);
      }
      path.reverse();

      const ringCount = path.filter(id => ringAtoms.has(id)).length;
      const score = path.length - ringCount * 0.6;
      if (
        !best ||
        score > best.score ||
        (score === best.score && ringCount < best.ringCount) ||
        (score === best.score && ringCount === best.ringCount && path.length > best.path.length)
      ) {
        best = { path, ringCount, score };
      }
    }
  }

  return best;
}

/**
 * Straightens the preferred backbone path into an alternating zigzag by reflecting suffixes
 * that turn in the same direction as the preceding segment.
 * Only acts on all-acyclic paths of 8+ atoms that cover at least 45% of heavy atoms.
 *
 * @param {Object} molecule - The molecule graph
 * @param {Map<string, {x: number, y: number}>} coords - Atom coordinates (mutated in place)
 * @param {{ path: string[], ringCount: number }|null} pathInfo - Result from findPreferredBackbonePath
 * @returns {boolean} True if any straightening was applied
 */
export function straightenPreferredBackbone(molecule, coords, pathInfo) {
  if (!pathInfo) {
    return false;
  }

  const heavyCount = [...molecule.atoms.keys()].filter(id => molecule.atoms.get(id)?.name !== 'H').length;
  if (pathInfo.ringCount !== 0 || pathInfo.path.length < 8 || pathInfo.path.length < Math.ceil(heavyCount * 0.45)) {
    return false;
  }

  let previousSign = null;
  for (let i = 1; i < pathInfo.path.length - 1; i++) {
    const centerId = pathInfo.path[i];
    if (molecule.atoms.get(centerId)?.name === 'H') {
      continue;
    }

    let sign = backboneTurnSign(coords, pathInfo.path[i - 1], centerId, pathInfo.path[i + 1]);
    if (sign === 0) {
      continue;
    }
    if (previousSign == null) {
      previousSign = sign;
      continue;
    }

    const desiredSign = -previousSign;
    if (sign !== desiredSign) {
      const fixedA = coords.get(pathInfo.path[i - 1]);
      const fixedB = coords.get(centerId);
      if (fixedA && fixedB) {
        const suffixAtoms = collectSideAtoms(molecule, centerId, pathInfo.path[i - 1]);
        for (const atomId of suffixAtoms) {
          const pos = coords.get(atomId);
          if (pos) {
            coords.set(atomId, _reflectPoint(pos, fixedA, fixedB));
          }
        }
      }
      sign = backboneTurnSign(coords, pathInfo.path[i - 1], centerId, pathInfo.path[i + 1]);
    }
    previousSign = sign === 0 ? desiredSign : sign;
  }

  // Second pass: normalize every backbone bond-angle to exactly 120°.
  // The reflection-based sign pass above may leave some turns at non-120° angles
  // (e.g. 150°) when a reflection moves an atom off the ideal hexagonal grid.
  // Rotating the "next" suffix around each backbone atom corrects the magnitude
  // while preserving the alternating-sign pattern established by the first pass.
  for (let i = 1; i < pathInfo.path.length - 1; i++) {
    const centerId = pathInfo.path[i];
    const prevId = pathInfo.path[i - 1];
    const nextId = pathInfo.path[i + 1];

    const centerPos = coords.get(centerId);
    const prevPos = coords.get(prevId);
    const nextPos = coords.get(nextId);
    if (!centerPos || !prevPos || !nextPos) {
      continue;
    }

    const prevDir = Math.atan2(prevPos.y - centerPos.y, prevPos.x - centerPos.x);
    const nextDir = Math.atan2(nextPos.y - centerPos.y, nextPos.x - centerPos.x);
    let diff = nextDir - prevDir;
    while (diff > Math.PI) {
      diff -= 2 * Math.PI;
    }
    while (diff <= -Math.PI) {
      diff += 2 * Math.PI;
    }

    // Skip collinear (straight-line) backbone segments — no turn to normalise.
    if (Math.abs(diff) < 1e-4) {
      continue;
    }

    const target = (Math.PI * 2) / 3; // 120° in radians
    const rotation = (diff > 0 ? target : -target) - diff;
    if (Math.abs(rotation) < 1e-6) {
      continue;
    }

    const suffixAtoms = collectSideAtoms(molecule, centerId, prevId);
    const cosR = Math.cos(rotation);
    const sinR = Math.sin(rotation);
    for (const atomId of suffixAtoms) {
      if (atomId === centerId) {
        continue;
      }
      const pos = coords.get(atomId);
      if (!pos) {
        continue;
      }
      const dx = pos.x - centerPos.x;
      const dy = pos.y - centerPos.y;
      coords.set(atomId, {
        x: centerPos.x + dx * cosR - dy * sinR,
        y: centerPos.y + dx * sinR + dy * cosR
      });
    }
  }

  return true;
}

/**
 * Collects all atoms reachable from startId without crossing blockedId (no frozen-atom restriction).
 *
 * @param {Object} molecule - The molecule graph
 * @param {string} startId - Atom ID to begin traversal from
 * @param {string} blockedId - Atom ID acting as the traversal boundary
 * @returns {Set<string>} Set of atom IDs on the startId side of the bond
 */
export function collectSideAtoms(molecule, startId, blockedId) {
  const side = new Set();
  const queue = [startId];
  const seen = new Set([blockedId]);
  let queueHead = 0;
  while (queueHead < queue.length) {
    const cur = queue[queueHead++];
    if (seen.has(cur)) {
      continue;
    }
    seen.add(cur);
    side.add(cur);
    for (const nb of _layoutNeighbors(molecule, cur)) {
      if (!seen.has(nb)) {
        queue.push(nb);
      }
    }
  }
  return side;
}

/**
 * Enforces the target E/Z stereo configuration of all acyclic double bonds by reflecting
 * one substituent side across the bond axis when the current geometry is incorrect.
 * Chooses the reflection candidate that maximises matched stereo count, then chain span, then clearance.
 *
 * @param {Object} molecule - The molecule graph
 * @param {Map<string, {x: number, y: number}>} coords - Atom coordinates (mutated in place)
 * @param {object} [options]
 * @param {boolean} [options.preserveLongChainSpan=false] - Reject moves that reduce long-chain end-to-end span
 * @param {number} [options.maxLongChainSpanLoss=0] - Tolerated span loss when preserveLongChainSpan is true
 * @returns {void}
 */
export function enforceAcyclicEZStereo(molecule, coords, { preserveLongChainSpan = false, maxLongChainSpanLoss = 0 } = {}) {
  const ringAtomIds = new Set(molecule.getRings().flat());
  const heavyIds = [...molecule.atoms.keys()].filter(atomId => molecule.atoms.get(atomId)?.name !== 'H');
  const bondedHeavyPairs = new Set(
    [...molecule.bonds.values()]
      .filter(bond => bond.atoms.every(atomId => molecule.atoms.get(atomId)?.name !== 'H'))
      .map(bond => {
        const [aId, bId] = bond.atoms;
        return aId < bId ? `${aId}\0${bId}` : `${bId}\0${aId}`;
      })
  );
  const chainPaths = collectAllRefinementChainPaths(molecule, {
    heavyIds,
    cycleData: { ringAtomIds }
  });

  const stereoBonds = [...molecule.bonds.values()].filter(bond => {
    if (bond.properties.aromatic || (bond.properties.order ?? 1) !== 2) {
      return false;
    }
    const [aId, bId] = bond.atoms;
    return molecule.getEZStereo(bond.id) != null && !ringAtomIds.has(aId) && !ringAtomIds.has(bId);
  });

  const maxPasses = Math.max(1, stereoBonds.length * 2);

  const matchedStereoCount = currentCoords =>
    stereoBonds.reduce((count, currentBond) => {
      const target = molecule.getEZStereo(currentBond.id);
      return count + (actualAlkeneStereoFromCoords(molecule, currentCoords, currentBond) === target ? 1 : 0);
    }, 0);

  const heavyClearanceScore = currentCoords => {
    let minDist = Infinity;
    for (let i = 0; i < heavyIds.length; i++) {
      const aId = heavyIds[i];
      const aPos = currentCoords.get(aId);
      if (!aPos) {
        continue;
      }
      for (let j = i + 1; j < heavyIds.length; j++) {
        const bId = heavyIds[j];
        const key = aId < bId ? `${aId}\0${bId}` : `${bId}\0${aId}`;
        if (bondedHeavyPairs.has(key)) {
          continue;
        }
        const bPos = currentCoords.get(bId);
        if (!bPos) {
          continue;
        }
        const dist = Math.hypot(aPos.x - bPos.x, aPos.y - bPos.y);
        if (dist < minDist) {
          minDist = dist;
        }
      }
    }
    return minDist;
  };

  const longChainSpanScore = currentCoords =>
    chainPaths.reduce((sum, path) => {
      if (path.length < 10) {
        return sum;
      }
      const startPos = currentCoords.get(path[0]);
      if (!startPos) {
        return sum;
      }
      const terminalIds = [path[path.length - 1], path[path.length - 2]].filter(Boolean);
      let best = 0;
      for (const atomId of terminalIds) {
        const pos = currentCoords.get(atomId);
        if (!pos) {
          continue;
        }
        const dist = Math.hypot(startPos.x - pos.x, startPos.y - pos.y);
        if (dist > best) {
          best = dist;
        }
      }
      return sum + best;
    }, 0);

  for (let pass = 0; pass < maxPasses; pass++) {
    let changed = false;
    const currentSpanScore = preserveLongChainSpan ? longChainSpanScore(coords) : -Infinity;

    for (const bond of stereoBonds) {
      const targetStereo = molecule.getEZStereo(bond.id);
      const actualStereo = actualAlkeneStereoFromCoords(molecule, coords, bond);
      if (actualStereo == null || actualStereo === targetStereo) {
        continue;
      }

      const [aId, bId] = bond.atoms;
      const sideA = collectSideAtoms(molecule, aId, bId);
      const sideB = collectSideAtoms(molecule, bId, aId);
      const candidates = [
        { side: sideA, heavyCount: countHeavyAtoms(molecule, sideA) },
        { side: sideB, heavyCount: countHeavyAtoms(molecule, sideB) }
      ];

      let bestCandidate = null;
      for (const candidate of candidates) {
        const reflected = reflectSubtreeCoords(coords, candidate.side, aId, bId);
        const candidateCoords = new Map(coords);
        for (const [atomId, pos] of reflected) {
          candidateCoords.set(atomId, pos);
        }
        if (actualAlkeneStereoFromCoords(molecule, candidateCoords, bond) !== targetStereo) {
          continue;
        }

        const score = matchedStereoCount(candidateCoords);
        const span = longChainSpanScore(candidateCoords);
        const clearance = heavyClearanceScore(candidateCoords);
        if (preserveLongChainSpan && span + maxLongChainSpanLoss + 1e-6 < currentSpanScore) {
          continue;
        }
        if (
          !bestCandidate ||
          score > bestCandidate.score ||
          (score === bestCandidate.score && span > bestCandidate.span + 1e-6) ||
          (score === bestCandidate.score && Math.abs(span - bestCandidate.span) <= 1e-6 && clearance > bestCandidate.clearance + 1e-6) ||
          (score === bestCandidate.score &&
            Math.abs(span - bestCandidate.span) <= 1e-6 &&
            Math.abs(clearance - bestCandidate.clearance) <= 1e-6 &&
            candidate.heavyCount < bestCandidate.heavyCount)
        ) {
          bestCandidate = { reflected, score, span, clearance, heavyCount: candidate.heavyCount };
        }
      }

      if (!bestCandidate) {
        continue;
      }

      for (const [atomId, pos] of bestCandidate.reflected) {
        coords.set(atomId, pos);
      }
      changed = true;
    }

    if (!changed) {
      break;
    }
  }
}

/**
 * Rotates substituents around each acyclic multiple bond to minimise atom clashes and bond-atom crowding,
 * choosing the best small-angle delta from a fixed candidate set (0, ±π/6, ±π/3).
 *
 * @param {Object} molecule - The molecule graph
 * @param {Map<string, {x: number, y: number}>} coords - Atom coordinates (mutated in place)
 * @param {number} bondLength - Target bond length used for distance thresholds
 * @returns {void}
 */
export function optimizeAcyclicMultipleBondSubtrees(molecule, coords, bondLength) {
  const isH = id => molecule.atoms.get(id)?.name === 'H';
  const heavyDegree = id => _layoutNeighbors(molecule, id).filter(nb => !isH(nb)).length;
  const deltas = [0, -Math.PI / 3, -Math.PI / 6, Math.PI / 6, Math.PI / 3];

  const scoreRotation = (pivotId, movingId, sideAtoms, rotatedCoords, delta) => {
    let score = Math.abs(delta) * 0.25;
    const pivotPos = coords.get(pivotId);
    const movingPos = rotatedCoords.get(movingId);
    if (!pivotPos || !movingPos) {
      return Infinity;
    }

    const bondedToPivot = new Set(_layoutNeighbors(molecule, pivotId));
    const bondedToMoving = new Set(_layoutNeighbors(molecule, movingId));
    const nearThresh = bondLength * 0.9;
    const clashThresh = bondLength * 0.65;

    for (const [movedId, movedPos] of rotatedCoords) {
      const movedAtom = molecule.atoms.get(movedId);
      if (!movedAtom || movedAtom.name === 'H') {
        continue;
      }
      for (const [otherId, otherPos] of coords) {
        if (sideAtoms.has(otherId) || !otherPos) {
          continue;
        }
        const otherAtom = molecule.atoms.get(otherId);
        if (!otherAtom || otherAtom.name === 'H') {
          continue;
        }
        if (movedId === movingId && otherId === pivotId) {
          continue;
        }

        const dist = Math.hypot(movedPos.x - otherPos.x, movedPos.y - otherPos.y);
        if (dist < clashThresh) {
          score += 200 + (clashThresh - dist) * 200;
        } else if (dist < nearThresh) {
          score += (nearThresh - dist) * 12;
        }
      }
    }

    for (const [otherId, otherPos] of coords) {
      if (!otherPos || sideAtoms.has(otherId) || otherId === pivotId || otherId === movingId) {
        continue;
      }
      if (bondedToPivot.has(otherId) || bondedToMoving.has(otherId)) {
        continue;
      }
      const otherAtom = molecule.atoms.get(otherId);
      if (!otherAtom || otherAtom.name === 'H') {
        continue;
      }
      const thresh = otherAtom.name === 'C' ? bondLength * 0.3 : bondLength * 0.5;
      const dist = pointToSegmentDistance(otherPos, pivotPos, movingPos);
      if (dist < thresh) {
        score += otherAtom.name === 'C' ? 4 : 20;
        score += (thresh - dist) * (otherAtom.name === 'C' ? 8 : 40);
      }
    }

    return score;
  };

  for (const [, bond] of molecule.bonds) {
    const order = bond.properties.order ?? 1;
    if (bond.properties.aromatic || order < 2) {
      continue;
    }

    const [aId, bId] = bond.atoms;
    const aSide = collectSideAtoms(molecule, aId, bId);
    const bSide = collectSideAtoms(molecule, bId, aId);
    const candidates = [
      { pivotId: aId, movingId: bId, sideAtoms: bSide },
      { pivotId: bId, movingId: aId, sideAtoms: aSide }
    ].filter(
      ({ pivotId, movingId, sideAtoms }) =>
        coords.has(pivotId) && coords.has(movingId) && sideAtoms.size > 1 && sideAtoms.size <= molecule.atomCount - sideAtoms.size && heavyDegree(movingId) > 1
    );

    for (const { pivotId, movingId, sideAtoms } of candidates) {
      const pivotPos = coords.get(pivotId);
      if (!pivotPos) {
        continue;
      }

      let bestDelta = 0;
      let bestCoords = new Map([...sideAtoms].map(id => [id, coords.get(id)]).filter(([, pos]) => Boolean(pos)));
      let bestScore = scoreRotation(pivotId, movingId, sideAtoms, bestCoords, 0);

      for (const delta of deltas.slice(1)) {
        const rotated = new Map();
        for (const id of sideAtoms) {
          const pos = coords.get(id);
          if (pos) {
            rotated.set(id, rotateAround(pos, pivotPos, delta));
          }
        }
        const score = scoreRotation(pivotId, movingId, sideAtoms, rotated, delta);
        if (score + 1e-6 < bestScore) {
          bestScore = score;
          bestDelta = delta;
          bestCoords = rotated;
        }
      }

      if (bestDelta !== 0) {
        for (const [id, pos] of bestCoords) {
          coords.set(id, pos);
        }
      }
    }
  }
}

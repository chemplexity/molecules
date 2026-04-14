/** @module geometry/kk-layout */

import { DISTANCE_EPSILON, NUMERIC_EPSILON } from '../constants.js';
import { circumradiusForRegularPolygon } from './polygon.js';
import { centroid, vec } from './vec2.js';

function buildRestrictedAdjacency(molecule, atomIds) {
  const atomIdSet = new Set(atomIds);
  const adjacency = new Map(atomIds.map(atomId => [atomId, []]));
  for (const bond of molecule.bonds.values()) {
    const [firstAtomId, secondAtomId] = bond.atoms;
    if (!atomIdSet.has(firstAtomId) || !atomIdSet.has(secondAtomId)) {
      continue;
    }
    adjacency.get(firstAtomId)?.push(secondAtomId);
    adjacency.get(secondAtomId)?.push(firstAtomId);
  }
  return adjacency;
}

/**
 * Returns the flat-array index for a square matrix entry.
 * @param {number} rowIndex - Matrix row.
 * @param {number} columnIndex - Matrix column.
 * @param {number} count - Matrix width.
 * @returns {number} Flat-array index.
 */
function matrixIndex(rowIndex, columnIndex, count) {
  return rowIndex * count + columnIndex;
}

/**
 * Returns whether every distance-matrix entry is finite.
 * @param {Float64Array} matrix - Flat distance matrix.
 * @returns {boolean} True when all entries are finite.
 */
function hasFiniteMatrixEntries(matrix) {
  for (let index = 0; index < matrix.length; index++) {
    if (!Number.isFinite(matrix[index])) {
      return false;
    }
  }
  return true;
}

function buildDistanceMatrix(atomIds, adjacency) {
  const count = atomIds.length;
  const indexOf = new Map(atomIds.map((atomId, index) => [atomId, index]));
  const matrix = new Float64Array(count * count);
  matrix.fill(Infinity);

  for (let rowIndex = 0; rowIndex < count; rowIndex++) {
    matrix[matrixIndex(rowIndex, rowIndex, count)] = 0;
    const startAtomId = atomIds[rowIndex];
    const queue = [startAtomId];
    let queueHead = 0;

    while (queueHead < queue.length) {
      const currentAtomId = queue[queueHead++];
      const currentIndex = indexOf.get(currentAtomId);
      for (const nextAtomId of adjacency.get(currentAtomId) ?? []) {
        const nextIndex = indexOf.get(nextAtomId);
        const nextMatrixIndex = matrixIndex(rowIndex, nextIndex, count);
        if (matrix[nextMatrixIndex] !== Infinity) {
          continue;
        }
        matrix[nextMatrixIndex] = matrix[matrixIndex(rowIndex, currentIndex, count)] + 1;
        queue.push(nextAtomId);
      }
    }
  }

  return matrix;
}

/**
 * Returns whether a seed coordinate is finite and usable.
 * @param {{x: number, y: number}|undefined} position - Candidate seed position.
 * @returns {boolean} True when the position can seed KK placement.
 */
function hasFinitePosition(position) {
  return !!position && Number.isFinite(position.x) && Number.isFinite(position.y);
}

/**
 * Computes the Kamada-Kawai gradient contribution on one node from one spring pair.
 * @param {{x: number, y: number}} origin - Node whose gradient is being evaluated.
 * @param {{x: number, y: number}} other - Other node in the spring pair.
 * @param {number} spring - Spring strength for the pair.
 * @param {number} target - Target pair length.
 * @returns {{x: number, y: number}} Gradient contribution vector.
 */
function pairGradientContribution(origin, other, spring, target) {
  const dx = origin.x - other.x;
  const dy = origin.y - other.y;
  const edgeLength = Math.max(Math.hypot(dx, dy), DISTANCE_EPSILON);
  const factor = spring * (1 - target / edgeLength);
  return {
    x: factor * dx,
    y: factor * dy
  };
}

/**
 * Builds an initial KK coordinate set from fixed atoms, seeded existing coords,
 * and a circular fallback for any unseeded atoms.
 * @param {string[]} atomIds - Atom IDs included in the layout.
 * @param {Map<string, {x: number, y: number}>} coords - Seed/fixed coordinate map.
 * @param {Set<string>} pinnedAtomIds - Atom IDs that should remain fixed.
 * @param {{x: number, y: number}} center - Target layout center.
 * @param {number} bondLength - Target bond length.
 * @returns {{positions: Array<{x: number, y: number}>, seededAtomIds: Set<string>}} Initial positions and seeded-atom ids.
 */
function initializePositions(atomIds, coords, pinnedAtomIds, center, bondLength) {
  const count = atomIds.length;
  const radius = circumradiusForRegularPolygon(Math.max(count, 3), bondLength);
  const step = (2 * Math.PI) / Math.max(count, 1);
  const seededAtomIds = new Set();
  const seededPoints = [];

  for (const atomId of atomIds) {
    const seededPosition = coords.get(atomId);
    if (hasFinitePosition(seededPosition)) {
      seededPoints.push(seededPosition);
    }
  }
  const fallbackCenter = seededPoints.length > 0 ? centroid(seededPoints) : center;
  const positions = atomIds.map((atomId, index) => {
    const seededPosition = coords.get(atomId);
    if (pinnedAtomIds.has(atomId)) {
      return { x: seededPosition.x, y: seededPosition.y };
    }
    if (hasFinitePosition(seededPosition)) {
      seededAtomIds.add(atomId);
      return { x: seededPosition.x, y: seededPosition.y };
    }
    return {
      x: fallbackCenter.x + Math.cos(index * step) * radius,
      y: fallbackCenter.y + Math.sin(index * step) * radius
    };
  });
  return { positions, seededAtomIds };
}

function recenterFreePositions(positions, atomIds, pinnedAtomIds, targetCenter) {
  const freePoints = atomIds.map((atomId, index) => (pinnedAtomIds.has(atomId) ? null : positions[index])).filter(Boolean);
  if (freePoints.length === 0) {
    return;
  }
  const currentCenter = centroid(freePoints);
  const shiftX = targetCenter.x - currentCenter.x;
  const shiftY = targetCenter.y - currentCenter.y;
  for (let index = 0; index < atomIds.length; index++) {
    if (pinnedAtomIds.has(atomIds[index])) {
      continue;
    }
    positions[index].x += shiftX;
    positions[index].y += shiftY;
  }
}

/**
 * Solves a damped 2x2 Newton step for a single Kamada-Kawai node update.
 * @param {number} dxx - Hessian xx term.
 * @param {number} dxy - Hessian xy term.
 * @param {number} dyy - Hessian yy term.
 * @param {number} gradientX - Energy gradient x component.
 * @param {number} gradientY - Energy gradient y component.
 * @returns {{moveX: number, moveY: number}} The proposed step.
 */
function solveDampedNewtonStep(dxx, dxy, dyy, gradientX, gradientY) {
  const hessianScale = Math.abs(dxx) + Math.abs(dyy) + Math.abs(dxy) + NUMERIC_EPSILON;
  let lambda = Math.max(NUMERIC_EPSILON, hessianScale * 1e-4);

  for (let attempt = 0; attempt < 8; attempt++) {
    const dampedDxx = dxx + lambda;
    const dampedDyy = dyy + lambda;
    const det = dampedDxx * dampedDyy - dxy * dxy;
    if (Number.isFinite(det) && Math.abs(det) > NUMERIC_EPSILON) {
      const moveX = (-dampedDyy * gradientX + dxy * gradientY) / det;
      const moveY = (dxy * gradientX - dampedDxx * gradientY) / det;
      if (Number.isFinite(moveX) && Number.isFinite(moveY)) {
        return { moveX, moveY };
      }
    }
    lambda *= 10;
  }

  const fallbackScale = Math.max(hessianScale, DISTANCE_EPSILON);
  return {
    moveX: -gradientX / fallbackScale,
    moveY: -gradientY / fallbackScale
  };
}

/**
 * Returns whether a Kamada-Kawai coordinate set clears basic validity gates.
 * @param {object} molecule - Molecule-like graph.
 * @param {string[]} atomIds - Atom IDs included in the layout.
 * @param {Map<string, {x: number, y: number}>} coords - Candidate coordinates.
 * @param {number} bondLength - Target bond length.
 * @returns {boolean} True when the layout is acceptable.
 */
export function isKamadaKawaiLayoutAcceptable(molecule, atomIds, coords, bondLength) {
  const atomIdSet = new Set(atomIds);
  for (const atomId of atomIds) {
    const position = coords.get(atomId);
    if (!position || !Number.isFinite(position.x) || !Number.isFinite(position.y)) {
      return false;
    }
  }

  for (const bond of molecule.bonds.values()) {
    const [firstAtomId, secondAtomId] = bond.atoms;
    if (!atomIdSet.has(firstAtomId) || !atomIdSet.has(secondAtomId)) {
      continue;
    }
    const firstAtom = molecule.atoms.get(firstAtomId);
    const secondAtom = molecule.atoms.get(secondAtomId);
    if (!firstAtom || !secondAtom || firstAtom.name === 'H' || secondAtom.name === 'H') {
      continue;
    }
    const firstPosition = coords.get(firstAtomId);
    const secondPosition = coords.get(secondAtomId);
    const edgeLength = Math.hypot(secondPosition.x - firstPosition.x, secondPosition.y - firstPosition.y);
    if (edgeLength > bondLength * 1.5) {
      return false;
    }
  }

  const bondedPairs = new Set();
  for (const bond of molecule.bonds.values()) {
    const [a, b] = bond.atoms;
    bondedPairs.add(a < b ? `${a}:${b}` : `${b}:${a}`);
  }

  const heavyAtomIds = atomIds.filter(atomId => molecule.atoms.get(atomId)?.name !== 'H');
  for (let firstIndex = 0; firstIndex < heavyAtomIds.length; firstIndex++) {
    const firstAtomId = heavyAtomIds[firstIndex];
    const firstPosition = coords.get(firstAtomId);
    for (let secondIndex = firstIndex + 1; secondIndex < heavyAtomIds.length; secondIndex++) {
      const secondAtomId = heavyAtomIds[secondIndex];
      const secondPosition = coords.get(secondAtomId);
      const isBonded = bondedPairs.has(firstAtomId < secondAtomId ? `${firstAtomId}:${secondAtomId}` : `${secondAtomId}:${firstAtomId}`);
      if (isBonded) {
        continue;
      }
      if (Math.hypot(secondPosition.x - firstPosition.x, secondPosition.y - firstPosition.y) < 0.5) {
        return false;
      }
    }
  }

  return true;
}

/**
 * Lays out a small bridged component using a copied Kamada-Kawai relaxation.
 * @param {object} molecule - Molecule-like graph.
 * @param {string[]} atomIds - Atom IDs to place.
 * @param {object} [options] - Layout options.
 * @param {Map<string, {x: number, y: number}>} [options.coords] - Seed coordinates.
 * @param {string[]} [options.pinnedAtomIds] - Atom IDs to keep fixed.
 * @param {{x: number, y: number}} [options.center] - Target layout center.
 * @param {number} [options.bondLength] - Target bond length.
 * @param {number} [options.maxComponentSize] - Size cutoff.
 * @param {number} [options.threshold] - Outer convergence threshold.
 * @param {number} [options.innerThreshold] - Inner convergence threshold.
 * @param {number} [options.maxIterations] - Outer iteration cap.
 * @param {number} [options.maxInnerIterations] - Inner iteration cap.
 * @param {boolean} [options.incrementalEnergyUpdates] - Whether to update KK gradients incrementally after a node move.
 * @returns {{coords: Map<string, {x: number, y: number}>, converged: boolean, energy: number, ok: boolean, skipped: boolean}} KK layout result.
 */
export function layoutKamadaKawai(
  molecule,
  atomIds,
  {
    coords = new Map(),
    pinnedAtomIds = [],
    center = vec(0, 0),
    bondLength = 1.5,
    maxComponentSize = 64,
    threshold = 0.1,
    innerThreshold = 0.1,
    maxIterations = 20000,
    maxInnerIterations = 50,
    incrementalEnergyUpdates = true
  } = {}
) {
  if (atomIds.length > maxComponentSize) {
    return {
      coords: new Map(coords),
      converged: false,
      energy: Infinity,
      ok: false,
      skipped: true
    };
  }

  const pinnedAtomIdSet = new Set(pinnedAtomIds);
  const adjacency = buildRestrictedAdjacency(molecule, atomIds);
  const distanceMatrix = buildDistanceMatrix(atomIds, adjacency);
  if (!hasFiniteMatrixEntries(distanceMatrix)) {
    return {
      coords: new Map(coords),
      converged: false,
      energy: Infinity,
      ok: false,
      skipped: true
    };
  }

  const count = atomIds.length;
  const { positions, seededAtomIds } = initializePositions(atomIds, coords, pinnedAtomIdSet, center, bondLength);
  if (pinnedAtomIdSet.size === 0 && seededAtomIds.size === 0) {
    recenterFreePositions(positions, atomIds, pinnedAtomIdSet, center);
  }
  const effectiveMaxIterations = seededAtomIds.size > 0 ? Math.min(maxIterations, 5000) : maxIterations;

  const targetLength = new Float64Array(count * count);
  const springStrength = new Float64Array(count * count);
  const energyX = new Float64Array(count);
  const energyY = new Float64Array(count);

  for (let firstIndex = 0; firstIndex < count; firstIndex++) {
    for (let secondIndex = 0; secondIndex < count; secondIndex++) {
      const entryIndex = matrixIndex(firstIndex, secondIndex, count);
      const pathDistance = distanceMatrix[entryIndex];
      if (firstIndex === secondIndex || pathDistance === 0) {
        continue;
      }
      targetLength[entryIndex] = bondLength * pathDistance;
      springStrength[entryIndex] = bondLength / (pathDistance * pathDistance);
    }
  }

  function updateEnergy(index) {
    let sumX = 0;
    let sumY = 0;
    const origin = positions[index];
    for (let otherIndex = 0; otherIndex < count; otherIndex++) {
      const entryIndex = matrixIndex(index, otherIndex, count);
      if (index === otherIndex || springStrength[entryIndex] === 0) {
        continue;
      }
      const contribution = pairGradientContribution(origin, positions[otherIndex], springStrength[entryIndex], targetLength[entryIndex]);
      sumX += contribution.x;
      sumY += contribution.y;
    }
    energyX[index] = sumX;
    energyY[index] = sumY;
  }

  function updateAllEnergy() {
    for (let index = 0; index < count; index++) {
      updateEnergy(index);
    }
  }

  function nodeEnergy(index) {
    return energyX[index] * energyX[index] + energyY[index] * energyY[index];
  }

  function highestEnergyNode() {
    let bestIndex = -1;
    let bestEnergy = -Infinity;
    for (let index = 0; index < count; index++) {
      if (pinnedAtomIdSet.has(atomIds[index])) {
        continue;
      }
      const energy = nodeEnergy(index);
      if (energy > bestEnergy) {
        bestEnergy = energy;
        bestIndex = index;
      }
    }
    return { index: bestIndex, energy: bestEnergy };
  }

  function updatePosition(index) {
    let dxx = 0;
    let dyy = 0;
    let dxy = 0;
    const origin = positions[index];
    const previousPosition = { x: origin.x, y: origin.y };

    for (let otherIndex = 0; otherIndex < count; otherIndex++) {
      const entryIndex = matrixIndex(index, otherIndex, count);
      if (index === otherIndex || springStrength[entryIndex] === 0) {
        continue;
      }
      const other = positions[otherIndex];
      const dx = origin.x - other.x;
      const dy = origin.y - other.y;
      const distSq = Math.max(dx * dx + dy * dy, DISTANCE_EPSILON * DISTANCE_EPSILON);
      const denom = Math.pow(distSq, 1.5);
      const target = targetLength[entryIndex];
      const spring = springStrength[entryIndex];
      dxx += spring * (1 - (target * dy * dy) / denom);
      dyy += spring * (1 - (target * dx * dx) / denom);
      dxy += spring * ((target * dx * dy) / denom);
    }

    if (Math.abs(dxx) < DISTANCE_EPSILON) {
      dxx = 0.1;
    }
    if (Math.abs(dyy) < DISTANCE_EPSILON) {
      dyy = 0.1;
    }

    let { moveX, moveY } = solveDampedNewtonStep(dxx, dxy, dyy, energyX[index], energyY[index]);

    const step = Math.hypot(moveX, moveY);
    if (step > bondLength) {
      const stepScale = bondLength / step;
      moveX *= stepScale;
      moveY *= stepScale;
    }

    positions[index].x += moveX;
    positions[index].y += moveY;
    if (!incrementalEnergyUpdates) {
      updateAllEnergy();
      return;
    }

    updateEnergy(index);
    for (let otherIndex = 0; otherIndex < count; otherIndex++) {
      const entryIndex = matrixIndex(otherIndex, index, count);
      if (index === otherIndex || springStrength[entryIndex] === 0) {
        continue;
      }
      const other = positions[otherIndex];
      const oldContribution = pairGradientContribution(other, previousPosition, springStrength[entryIndex], targetLength[entryIndex]);
      const newContribution = pairGradientContribution(other, positions[index], springStrength[entryIndex], targetLength[entryIndex]);
      energyX[otherIndex] += newContribution.x - oldContribution.x;
      energyY[otherIndex] += newContribution.y - oldContribution.y;
    }
  }

  updateAllEnergy();

  let currentEnergy = Infinity;
  let iteration = 0;
  while (iteration < effectiveMaxIterations) {
    iteration++;
    const { index, energy } = highestEnergyNode();
    currentEnergy = energy;
    if (index < 0 || !Number.isFinite(energy) || energy <= threshold) {
      break;
    }
    let innerEnergy = energy;
    let innerIteration = 0;
    while (innerIteration < maxInnerIterations && innerEnergy > innerThreshold) {
      innerIteration++;
      updatePosition(index);
      innerEnergy = nodeEnergy(index);
    }
  }

  const resultCoords = new Map(coords);
  for (let index = 0; index < count; index++) {
    resultCoords.set(atomIds[index], { x: positions[index].x, y: positions[index].y });
  }

  return {
    coords: resultCoords,
    converged: Number.isFinite(currentEnergy) && currentEnergy <= threshold,
    energy: currentEnergy,
    ok: isKamadaKawaiLayoutAcceptable(molecule, atomIds, resultCoords, bondLength),
    skipped: false
  };
}

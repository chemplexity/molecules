/** @module layout/coords2d/kk-layout */

import { vec2, circumradius, centroid } from './geom2d.js';

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

function buildDistanceMatrix(atomIds, adjacency) {
  const length = atomIds.length;
  const indexOf = new Map(atomIds.map((atomId, index) => [atomId, index]));
  const matrix = Array.from({ length }, () => Array(length).fill(Infinity));

  for (let i = 0; i < length; i++) {
    matrix[i][i] = 0;
    const startAtomId = atomIds[i];
    const queue = [startAtomId];
    let queueHead = 0;
    while (queueHead < queue.length) {
      const currentAtomId = queue[queueHead++];
      const currentIndex = indexOf.get(currentAtomId);
      for (const nextAtomId of adjacency.get(currentAtomId) ?? []) {
        const nextIndex = indexOf.get(nextAtomId);
        if (matrix[i][nextIndex] !== Infinity) {
          continue;
        }
        matrix[i][nextIndex] = matrix[i][currentIndex] + 1;
        queue.push(nextAtomId);
      }
    }
  }

  return matrix;
}

function initializePositions(atomIds, coords, pinnedAtomIds, center, bondLength) {
  const length = atomIds.length;
  const radius = circumradius(Math.max(length, 3), bondLength);
  const step = (2 * Math.PI) / Math.max(length, 1);
  const positions = atomIds.map((atomId, index) => {
    if (pinnedAtomIds.has(atomId)) {
      const pinned = coords.get(atomId);
      return { x: pinned.x, y: pinned.y };
    }
    return {
      x: center.x + Math.cos(index * step) * radius,
      y: center.y + Math.sin(index * step) * radius
    };
  });
  return positions;
}

function recenterFreePositions(positions, atomIds, pinnedAtomIds, targetCenter) {
  const freeAtomIds = atomIds.filter(atomId => !pinnedAtomIds.has(atomId));
  if (freeAtomIds.length === 0) {
    return;
  }
  const currentCenter = centroid(freeAtomIds, new Map(atomIds.map((atomId, index) => [atomId, positions[index]])));
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

export function evaluateKamadaKawaiLayout(molecule, atomIds, coords, bondLength) {
  const atomIdSet = new Set(atomIds);
  for (const atomId of atomIds) {
    const pos = coords.get(atomId);
    if (!pos || !Number.isFinite(pos.x) || !Number.isFinite(pos.y)) {
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
    const firstPos = coords.get(firstAtomId);
    const secondPos = coords.get(secondAtomId);
    const distance = Math.hypot(secondPos.x - firstPos.x, secondPos.y - firstPos.y);
    if (distance > bondLength * 1.5) {
      return false;
    }
  }

  const heavyAtomIds = atomIds.filter(atomId => molecule.atoms.get(atomId)?.name !== 'H');
  for (let i = 0; i < heavyAtomIds.length; i++) {
    const firstAtomId = heavyAtomIds[i];
    const firstPos = coords.get(firstAtomId);
    for (let j = i + 1; j < heavyAtomIds.length; j++) {
      const secondAtomId = heavyAtomIds[j];
      const secondPos = coords.get(secondAtomId);
      const isBonded = molecule.atoms.get(firstAtomId)?.bonds.some(bondId => {
        const bond = molecule.bonds.get(bondId);
        return bond && bond.atoms.includes(secondAtomId);
      });
      if (isBonded) {
        continue;
      }
      if (Math.hypot(secondPos.x - firstPos.x, secondPos.y - firstPos.y) < 0.5) {
        return false;
      }
    }
  }

  return true;
}

export function layoutBridgedComponentKK(
  molecule,
  atomIds,
  {
    coords = new Map(),
    pinnedAtomIds = [],
    center = vec2(0, 0),
    bondLength = 1.5,
    maxComponentSize = 32,
    threshold = 0.1,
    innerThreshold = 0.1,
    maxIterations = 20000,
    maxInnerIterations = 50,
    maxEnergy = 1e9
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
  if (distanceMatrix.some(row => row.some(distance => !Number.isFinite(distance)))) {
    return {
      coords: new Map(coords),
      converged: false,
      energy: Infinity,
      ok: false,
      skipped: true
    };
  }
  const length = atomIds.length;
  const positions = initializePositions(atomIds, coords, pinnedAtomIdSet, center, bondLength);
  if (pinnedAtomIdSet.size === 0) {
    recenterFreePositions(positions, atomIds, pinnedAtomIdSet, center);
  }

  const targetLength = Array.from({ length }, () => Array(length).fill(0));
  const springStrength = Array.from({ length }, () => Array(length).fill(0));
  const energyX = new Float64Array(length);
  const energyY = new Float64Array(length);
  const energyMatrix = Array.from({ length }, () => Array.from({ length }, () => [0, 0]));

  for (let i = 0; i < length; i++) {
    for (let j = 0; j < length; j++) {
      if (i === j || !Number.isFinite(distanceMatrix[i][j]) || distanceMatrix[i][j] === 0) {
        continue;
      }
      targetLength[i][j] = bondLength * distanceMatrix[i][j];
      springStrength[i][j] = bondLength / (distanceMatrix[i][j] * distanceMatrix[i][j]);
    }
  }

  function updateEnergyFor(index) {
    let sumX = 0;
    let sumY = 0;
    const ux = positions[index].x;
    const uy = positions[index].y;
    for (let j = 0; j < length; j++) {
      if (index === j || springStrength[index][j] === 0) {
        energyMatrix[index][j] = [0, 0];
        continue;
      }
      const vx = positions[j].x;
      const vy = positions[j].y;
      const dx = ux - vx;
      const dy = uy - vy;
      const dist = Math.hypot(dx, dy) || 1e-9;
      const factor = springStrength[index][j] * (1 - targetLength[index][j] / dist);
      const ex = factor * dx;
      const ey = factor * dy;
      energyMatrix[index][j] = [ex, ey];
      sumX += ex;
      sumY += ey;
    }
    energyX[index] = sumX;
    energyY[index] = sumY;
  }

  for (let i = 0; i < length; i++) {
    updateEnergyFor(i);
  }

  function nodeEnergy(index) {
    return energyX[index] * energyX[index] + energyY[index] * energyY[index];
  }

  function highestEnergyNode() {
    let bestIndex = -1;
    let bestEnergy = -Infinity;
    for (let i = 0; i < length; i++) {
      if (pinnedAtomIdSet.has(atomIds[i])) {
        continue;
      }
      const energy = nodeEnergy(i);
      if (energy > bestEnergy) {
        bestEnergy = energy;
        bestIndex = i;
      }
    }
    return {
      index: bestIndex,
      energy: bestEnergy
    };
  }

  function updatePosition(index) {
    let dxx = 0;
    let dyy = 0;
    let dxy = 0;
    const ux = positions[index].x;
    const uy = positions[index].y;

    for (let i = 0; i < length; i++) {
      if (i === index || springStrength[index][i] === 0) {
        continue;
      }
      const vx = positions[i].x;
      const vy = positions[i].y;
      const dx = ux - vx;
      const dy = uy - vy;
      const distSq = dx * dx + dy * dy || 1e-9;
      const dist = Math.sqrt(distSq);
      const denom = Math.pow(distSq, 1.5);
      const target = targetLength[index][i];
      const spring = springStrength[index][i];
      dxx += spring * (1 - (target * dy * dy) / denom);
      dyy += spring * (1 - (target * dx * dx) / denom);
      dxy += spring * ((target * dx * dy) / denom);
    }

    if (Math.abs(dxx) < 1e-6) {
      dxx = 0.1;
    }
    if (Math.abs(dyy) < 1e-6) {
      dyy = 0.1;
    }

    const dex = energyX[index];
    const dey = energyY[index];
    const det = dxx * dyy - dxy * dxy;
    let moveX;
    let moveY;
    if (Math.abs(det) < 1e-6) {
      moveX = -dex * 0.1;
      moveY = -dey * 0.1;
    } else {
      moveX = (-dyy * dex + dxy * dey) / det;
      moveY = (dxy * dex - dxx * dey) / det;
    }

    const step = Math.hypot(moveX, moveY);
    if (step > bondLength) {
      const scale = bondLength / step;
      moveX *= scale;
      moveY *= scale;
    }

    positions[index].x += moveX;
    positions[index].y += moveY;

    for (let i = 0; i < length; i++) {
      updateEnergyFor(i);
    }
  }

  let currentMaxEnergy = maxEnergy;
  let iteration = 0;
  while (currentMaxEnergy > threshold && iteration < maxIterations) {
    iteration++;
    const { index, energy } = highestEnergyNode();
    if (index < 0 || !Number.isFinite(energy)) {
      break;
    }
    currentMaxEnergy = energy;
    let delta = energy;
    let innerIteration = 0;
    while (delta > innerThreshold && innerIteration < maxInnerIterations) {
      innerIteration++;
      updatePosition(index);
      delta = nodeEnergy(index);
    }
  }

  const resultCoords = new Map(coords);
  for (let i = 0; i < length; i++) {
    resultCoords.set(atomIds[i], vec2(positions[i].x, positions[i].y));
  }

  return {
    coords: resultCoords,
    converged: currentMaxEnergy <= threshold,
    energy: currentMaxEnergy,
    ok: evaluateKamadaKawaiLayout(molecule, atomIds, resultCoords, bondLength)
  };
}

/** @module orientation */

import { morganRanks } from '../../algorithms/morgan.js';

function vec(x, y) {
  return { x, y };
}

function rotateAround(point, origin, angle) {
  const dx = point.x - origin.x;
  const dy = point.y - origin.y;
  const cosA = Math.cos(angle);
  const sinA = Math.sin(angle);
  return vec(origin.x + dx * cosA - dy * sinA, origin.y + dx * sinA + dy * cosA);
}

function rotateCoords(coords, origin, angle) {
  if (Math.abs(angle) < 1e-9) {
    return;
  }
  const entries = [...coords.entries()];
  for (const [atomId, position] of entries) {
    coords.set(atomId, rotateAround(position, origin, angle));
  }
}

function compareAtomIds(molecule, ranks, firstAtomId, secondAtomId) {
  const firstAtom = molecule.atoms.get(firstAtomId);
  const secondAtom = molecule.atoms.get(secondAtomId);
  const firstIsHydrogen = firstAtom?.name === 'H' ? 1 : 0;
  const secondIsHydrogen = secondAtom?.name === 'H' ? 1 : 0;
  if (firstIsHydrogen !== secondIsHydrogen) {
    return firstIsHydrogen - secondIsHydrogen;
  }

  const firstRank = ranks?.get(firstAtomId);
  const secondRank = ranks?.get(secondAtomId);
  if (firstRank != null && secondRank != null && firstRank !== secondRank) {
    return firstRank - secondRank;
  }
  if (firstRank != null && secondRank == null) {
    return -1;
  }
  if (firstRank == null && secondRank != null) {
    return 1;
  }

  const firstAtomicNumber = firstAtom?.properties.protons ?? 0;
  const secondAtomicNumber = secondAtom?.properties.protons ?? 0;
  if (firstAtomicNumber !== secondAtomicNumber) {
    return firstAtomicNumber - secondAtomicNumber;
  }

  const firstCharge = firstAtom?.getCharge() ?? 0;
  const secondCharge = secondAtom?.getCharge() ?? 0;
  if (firstCharge !== secondCharge) {
    return firstCharge - secondCharge;
  }

  return String(firstAtomId).localeCompare(String(secondAtomId));
}

function orderedNeighborIds(molecule, atomId, ranks) {
  const atom = molecule.atoms.get(atomId);
  if (!atom) {
    return [];
  }
  return atom
    .getNeighbors(molecule)
    .map(neighbor => neighbor.id)
    .sort((firstAtomId, secondAtomId) => compareAtomIds(molecule, ranks, firstAtomId, secondAtomId));
}

/**
 * Finds the longest heavy-atom backbone path, preferring paths that stay out of rings.
 * @param {import('../core/Molecule.js').Molecule} molecule - Molecule graph.
 * @returns {{path: string[], ringCount: number, score: number}|null} Best path info.
 */
export function findPreferredBackbonePath(molecule) {
  const heavyAtomIds = [...molecule.atoms.keys()].filter(atomId => molecule.atoms.get(atomId)?.name !== 'H');
  if (heavyAtomIds.length < 2) {
    return null;
  }

  const ringAtomIds = new Set(molecule.getRings().flat());
  const ranks = morganRanks(molecule);
  let bestPath = null;

  for (const startAtomId of heavyAtomIds) {
    const previousAtomIds = new Map([[startAtomId, null]]);
    const queue = [startAtomId];
    let queueIndex = 0;
    while (queueIndex < queue.length) {
      const currentAtomId = queue[queueIndex++];
      for (const neighborAtomId of orderedNeighborIds(molecule, currentAtomId, ranks)) {
        if (molecule.atoms.get(neighborAtomId)?.name === 'H' || previousAtomIds.has(neighborAtomId)) {
          continue;
        }
        previousAtomIds.set(neighborAtomId, currentAtomId);
        queue.push(neighborAtomId);
      }
    }

    for (const endAtomId of heavyAtomIds) {
      if (endAtomId === startAtomId || !previousAtomIds.has(endAtomId)) {
        continue;
      }
      const path = [];
      for (let currentAtomId = endAtomId; currentAtomId != null; currentAtomId = previousAtomIds.get(currentAtomId)) {
        path.push(currentAtomId);
      }
      path.reverse();
      const ringCount = path.filter(atomId => ringAtomIds.has(atomId)).length;
      const score = path.length - ringCount * 0.6;
      if (
        !bestPath ||
        score > bestPath.score ||
        (score === bestPath.score && ringCount < bestPath.ringCount) ||
        (score === bestPath.score && ringCount === bestPath.ringCount && path.length > bestPath.path.length)
      ) {
        bestPath = { path, ringCount, score };
      }
    }
  }

  return bestPath;
}

function trimTerminalPeripheralHeteroEndpoints(path, molecule) {
  if (!Array.isArray(path) || path.length < 3 || !molecule) {
    return path;
  }

  let startIndex = 0;
  let endIndex = path.length - 1;
  const isTerminalPeripheralHetero = atomId => {
    const atom = molecule.atoms.get(atomId);
    if (!atom || atom.name === 'H' || atom.name === 'C') {
      return false;
    }
    const heavyDegree = atom.getNeighbors(molecule).filter(neighbor => neighbor.name !== 'H').length;
    return heavyDegree <= 1;
  };

  while (endIndex - startIndex + 1 >= 3 && isTerminalPeripheralHetero(path[startIndex])) {
    startIndex++;
  }
  while (endIndex - startIndex + 1 >= 3 && isTerminalPeripheralHetero(path[endIndex])) {
    endIndex--;
  }
  return path.slice(startIndex, endIndex + 1);
}

function isLandscapeChainBond(molecule, firstAtomId, secondAtomId) {
  const bond = molecule.getBond(firstAtomId, secondAtomId);
  const order = bond?.properties.order ?? 1;
  return Boolean(bond && !bond.properties.aromatic && (order === 1 || order === 2));
}

function longestNonRingLandscapePath(molecule) {
  const ringAtomIds = new Set(molecule.getRings().flat());
  const heavyAtomIds = [...molecule.atoms.keys()].filter(atomId => {
    const atom = molecule.atoms.get(atomId);
    return atom && atom.name !== 'H' && !ringAtomIds.has(atomId);
  });
  if (heavyAtomIds.length < 2) {
    return null;
  }

  const adjacency = new Map();
  for (const atomId of heavyAtomIds) {
    const atom = molecule.atoms.get(atomId);
    const neighborAtomIds = atom
      .getNeighbors(molecule)
      .filter(neighbor => neighbor.name !== 'H' && !ringAtomIds.has(neighbor.id))
      .filter(neighbor => isLandscapeChainBond(molecule, atomId, neighbor.id))
      .map(neighbor => neighbor.id);
    adjacency.set(atomId, neighborAtomIds);
  }

  let bestPath = null;
  const nonCarbonCount = path => path.reduce((count, atomId) => count + (molecule.atoms.get(atomId)?.name === 'C' ? 0 : 1), 0);
  const comparePaths = (candidatePath, incumbentPath) => {
    if (!incumbentPath) {
      return 1;
    }
    if (candidatePath.length !== incumbentPath.length) {
      return candidatePath.length - incumbentPath.length;
    }
    return nonCarbonCount(incumbentPath) - nonCarbonCount(candidatePath);
  };

  for (const startAtomId of heavyAtomIds) {
    const previousAtomIds = new Map([[startAtomId, null]]);
    const queue = [startAtomId];
    let queueIndex = 0;
    while (queueIndex < queue.length) {
      const currentAtomId = queue[queueIndex++];
      for (const neighborAtomId of adjacency.get(currentAtomId) ?? []) {
        if (previousAtomIds.has(neighborAtomId)) {
          continue;
        }
        previousAtomIds.set(neighborAtomId, currentAtomId);
        queue.push(neighborAtomId);
      }
    }

    for (const endAtomId of heavyAtomIds) {
      if (endAtomId === startAtomId || !previousAtomIds.has(endAtomId)) {
        continue;
      }
      const path = [];
      for (let currentAtomId = endAtomId; currentAtomId != null; currentAtomId = previousAtomIds.get(currentAtomId)) {
        path.push(currentAtomId);
      }
      path.reverse();
      if (comparePaths(path, bestPath) > 0) {
        bestPath = path;
      }
    }
  }

  return bestPath;
}

function landscapePathMinLength(molecule) {
  return molecule.getRings().length > 0 ? 6 : 8;
}

function orientationPathScore(path, molecule) {
  if (!path?.length) {
    return -Infinity;
  }

  const ringAtomIds = new Set(molecule.getRings().flat());
  const endpoints = [path[0], path[path.length - 1]];
  const ringAnchoredEndpoints = endpoints.reduce((count, atomId) => {
    const atom = molecule.atoms.get(atomId);
    if (!atom) {
      return count;
    }
    return count + (atom.getNeighbors(molecule).some(neighbor => neighbor.name !== 'H' && ringAtomIds.has(neighbor.id)) ? 1 : 0);
  }, 0);
  const terminalLeafEndpoints = endpoints.reduce((count, atomId) => {
    const atom = molecule.atoms.get(atomId);
    if (!atom) {
      return count;
    }
    const heavyDegree = atom.getNeighbors(molecule).filter(neighbor => neighbor.name !== 'H').length;
    return count + (heavyDegree <= 1 ? 1 : 0);
  }, 0);

  return path.length + ringAnchoredEndpoints * 1.5 - terminalLeafEndpoints * 0.25;
}

function preferredLandscapeOrientationPath(molecule) {
  const preferredBackbone = findPreferredBackbonePath(molecule);
  const longestNonRingPath = trimTerminalPeripheralHeteroEndpoints(longestNonRingLandscapePath(molecule), molecule);
  const preferLongerPath = candidatePath => {
    if (!candidatePath?.length) {
      return longestNonRingPath?.length >= 2 ? longestNonRingPath : null;
    }
    if (!longestNonRingPath?.length || orientationPathScore(candidatePath, molecule) >= orientationPathScore(longestNonRingPath, molecule)) {
      return candidatePath;
    }
    return longestNonRingPath;
  };

  if (!preferredBackbone?.path?.length) {
    return longestNonRingPath?.length >= 2 ? longestNonRingPath : null;
  }

  const trimmedPath = trimTerminalPeripheralHeteroEndpoints(preferredBackbone.path, molecule);
  if (trimmedPath.length < 2) {
    return longestNonRingPath?.length >= 2 ? longestNonRingPath : null;
  }
  if (preferredBackbone.ringCount === 0) {
    return preferLongerPath(trimmedPath);
  }

  const ringAtomIds = new Set(molecule.getRings().flat());
  let bestRun = null;
  let currentRun = [];
  const commitRun = () => {
    if (currentRun.length >= 2 && (!bestRun || currentRun.length > bestRun.length)) {
      bestRun = [...currentRun];
    }
    currentRun = [];
  };

  for (const atomId of trimmedPath) {
    if (ringAtomIds.has(atomId)) {
      commitRun();
      continue;
    }
    currentRun.push(atomId);
  }
  commitRun();
  return preferLongerPath(bestRun);
}

/**
 * Rotates all atoms in `coords` so the preferred horizontal axis is horizontal.
 * @param {Map<string, {x: number, y: number}>} coords - Coordinate map mutated in place.
 * @param {import('../../core/Molecule.js').Molecule} molecule - Molecule graph.
 * @returns {void}
 */
export function normalizeOrientation(coords, molecule) {
  if (coords.size < 2) {
    return;
  }

  const heavyAtomIds = [...coords.keys()].filter(atomId => molecule.atoms.has(atomId) && molecule.atoms.get(atomId).name !== 'H');
  if (heavyAtomIds.length < 2) {
    return;
  }

  const orientPath = preferredLandscapeOrientationPath(molecule);
  if (orientPath && orientPath.length >= landscapePathMinLength(molecule)) {
    const start = coords.get(orientPath[0]);
    const end = coords.get(orientPath[orientPath.length - 1]);
    if (start && end) {
      const angle = Math.atan2(end.y - start.y, end.x - start.x);
      if (Math.abs(angle) >= 1e-6) {
        let sumX = 0;
        let sumY = 0;
        for (const atomId of heavyAtomIds) {
          const point = coords.get(atomId);
          sumX += point.x;
          sumY += point.y;
        }
        rotateCoords(coords, vec(sumX / heavyAtomIds.length, sumY / heavyAtomIds.length), -angle);
      }

      let sumX = 0;
      let sumY = 0;
      for (const atomId of heavyAtomIds) {
        const point = coords.get(atomId);
        sumX += point.x;
        sumY += point.y;
      }
      const centerX = sumX / heavyAtomIds.length;
      const centerY = sumY / heavyAtomIds.length;
      let minX = Infinity;
      let maxX = -Infinity;
      let minY = Infinity;
      let maxY = -Infinity;
      for (const atomId of heavyAtomIds) {
        const point = coords.get(atomId);
        if (!point) {
          continue;
        }
        if (point.x < minX) {
          minX = point.x;
        }
        if (point.x > maxX) {
          maxX = point.x;
        }
        if (point.y < minY) {
          minY = point.y;
        }
        if (point.y > maxY) {
          maxY = point.y;
        }
      }
      if (maxY - minY > maxX - minX) {
        rotateCoords(coords, vec(centerX, centerY), Math.PI / 2);
      }
      return;
    }
  }

  let sumX = 0;
  let sumY = 0;
  for (const atomId of heavyAtomIds) {
    const point = coords.get(atomId);
    sumX += point.x;
    sumY += point.y;
  }
  const centerX = sumX / heavyAtomIds.length;
  const centerY = sumY / heavyAtomIds.length;

  let inertiaXX = 0;
  let inertiaYY = 0;
  let inertiaXY = 0;
  for (const atomId of heavyAtomIds) {
    const point = coords.get(atomId);
    const dx = point.x - centerX;
    const dy = point.y - centerY;
    inertiaXX += dy * dy;
    inertiaYY += dx * dx;
    inertiaXY -= dx * dy;
  }

  const angle0 = 0.5 * Math.atan2(2 * inertiaXY, inertiaXX - inertiaYY);
  const inertia0 = inertiaXX * Math.cos(angle0) ** 2 + inertiaYY * Math.sin(angle0) ** 2 + inertiaXY * Math.sin(2 * angle0);
  const inertia1 = inertiaXX + inertiaYY - inertia0;
  let elongationAxis = inertia0 <= inertia1 ? angle0 : angle0 + Math.PI / 2;
  if (elongationAxis > Math.PI / 2) {
    elongationAxis -= Math.PI;
  }
  if (elongationAxis <= -Math.PI / 2) {
    elongationAxis += Math.PI;
  }

  if (Math.abs(elongationAxis) > 1e-6) {
    const entries = [...coords.entries()];
    const cosA = Math.cos(-elongationAxis);
    const sinA = Math.sin(-elongationAxis);
    for (const [atomId, position] of entries) {
      const dx = position.x - centerX;
      const dy = position.y - centerY;
      coords.set(atomId, vec(centerX + dx * cosA - dy * sinA, centerY + dx * sinA + dy * cosA));
    }
  }

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const atomId of heavyAtomIds) {
    const point = coords.get(atomId);
    if (!point) {
      continue;
    }
    if (point.x < minX) {
      minX = point.x;
    }
    if (point.x > maxX) {
      maxX = point.x;
    }
    if (point.y < minY) {
      minY = point.y;
    }
    if (point.y > maxY) {
      maxY = point.y;
    }
  }
  if (maxY - minY > maxX - minX) {
    rotateCoords(coords, vec(centerX, centerY), Math.PI / 2);
  }

  const rings = molecule.getRings();
  if (rings.length > 0) {
    const ringAtomIds = new Set(rings.flatMap(ring => ring));
    let ringSumX = 0;
    let ringCount = 0;
    for (const atomId of ringAtomIds) {
      const point = coords.get(atomId);
      if (point && molecule.atoms.get(atomId)?.name !== 'H') {
        ringSumX += point.x;
        ringCount++;
      }
    }
    if (ringCount > 0 && ringSumX / ringCount < centerX - 1e-6) {
      rotateCoords(coords, vec(centerX, centerY), Math.PI);
    }
  }
}

/**
 * Returns true when the molecule should prefer landscape orientation.
 * @param {import('../../core/Molecule.js').Molecule} molecule - Molecule graph.
 * @returns {boolean} True when landscape orientation is preferred.
 */
export function shouldPreferFinalLandscapeOrientation(molecule) {
  const preferredBackbone = findPreferredBackbonePath(molecule);
  if (preferredBackbone && preferredBackbone.ringCount === 0 && preferredBackbone.path.length >= 8) {
    return true;
  }
  const orientPath = preferredLandscapeOrientationPath(molecule);
  return Boolean(orientPath && orientPath.length >= landscapePathMinLength(molecule));
}

/**
 * Applies the final landscape-leveling pass for a fresh layout. This first
 * re-orients the molecule onto its preferred horizontal frame, then snaps the
 * result onto the natural bond-angle lattice, and finally quarter-turns the
 * leveled pose only if it still remains taller than wide.
 * @param {Map<string, {x: number, y: number}>} coords - Coordinate map mutated in place.
 * @param {import('../../core/Molecule.js').Molecule} molecule - Molecule graph.
 * @returns {boolean} True when the pass changed the displayed orientation.
 */
export function ensureLandscapeOrientation(coords, molecule) {
  const heavyAtomIds = [...coords.keys()].filter(atomId => molecule.atoms.has(atomId) && molecule.atoms.get(atomId)?.name !== 'H');
  if (heavyAtomIds.length < 2) {
    return false;
  }

  const beforePositions = new Map(
    heavyAtomIds.map(atomId => [atomId, { ...coords.get(atomId) }])
  );

  normalizeOrientation(coords, molecule);
  levelCoords(coords, molecule);

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let sumX = 0;
  let sumY = 0;
  for (const atomId of heavyAtomIds) {
    const point = coords.get(atomId);
    if (!point) {
      continue;
    }
    minX = Math.min(minX, point.x);
    maxX = Math.max(maxX, point.x);
    minY = Math.min(minY, point.y);
    maxY = Math.max(maxY, point.y);
    sumX += point.x;
    sumY += point.y;
  }

  if (maxY - minY > maxX - minX) {
    rotateCoords(coords, vec(sumX / heavyAtomIds.length, sumY / heavyAtomIds.length), Math.PI / 2);
  }

  return heavyAtomIds.some(atomId => {
    const before = beforePositions.get(atomId);
    const after = coords.get(atomId);
    return Math.abs(after.x - before.x) > 1e-6 || Math.abs(after.y - before.y) > 1e-6;
  });
}

/**
 * Rotates coordinates so bond directions snap closely to each bond's natural angular grid.
 * @param {Map<string, {x: number, y: number}>} coords - Coordinate map mutated in place.
 * @param {import('../../core/Molecule.js').Molecule} molecule - Molecule graph.
 * @returns {void}
 */
export function levelCoords(coords, molecule) {
  const heavyAtomIds = [...coords.keys()].filter(atomId => molecule.atoms.has(atomId) && molecule.atoms.get(atomId)?.name !== 'H');
  if (heavyAtomIds.length < 2) {
    return;
  }

  const bondGrid = new Map();
  for (const ring of molecule.getRings()) {
    const increment = Math.PI / ring.length;
    for (let index = 0; index < ring.length; index++) {
      const bond = molecule.getBond(ring[index], ring[(index + 1) % ring.length]);
      if (!bond) {
        continue;
      }
      const existingIncrement = bondGrid.get(bond.id);
      if (existingIncrement === undefined || increment < existingIncrement) {
        bondGrid.set(bond.id, increment);
      }
    }
  }

  const bondData = [];
  const seenBondIds = new Set();
  for (const atomId of heavyAtomIds) {
    const firstPoint = coords.get(atomId);
    if (!firstPoint) {
      continue;
    }
    const atom = molecule.atoms.get(atomId);
    if (!atom) {
      continue;
    }
    for (const bondId of atom.bonds) {
      if (seenBondIds.has(bondId)) {
        continue;
      }
      seenBondIds.add(bondId);
      const bond = molecule.bonds.get(bondId);
      if (!bond) {
        continue;
      }
      const otherAtomId = bond.getOtherAtom(atomId);
      if (!otherAtomId || molecule.atoms.get(otherAtomId)?.name === 'H') {
        continue;
      }
      const secondPoint = coords.get(otherAtomId);
      if (!secondPoint) {
        continue;
      }
      let angle = Math.atan2(secondPoint.y - firstPoint.y, secondPoint.x - firstPoint.x);
      if (angle < 0) {
        angle += Math.PI;
      }
      if (angle >= Math.PI) {
        angle -= Math.PI;
      }
      bondData.push({ angle, increment: bondGrid.get(bondId) ?? Math.PI / 6 });
    }
  }

  if (bondData.length === 0) {
    return;
  }

  const tiltPenalty = 1e-4;
  function score(rotation) {
    let total = 0;
    for (const { angle, increment } of bondData) {
      let deviation = (((angle + rotation) % increment) + increment) % increment;
      if (deviation > increment / 2) {
        deviation -= increment;
      }
      total += deviation * deviation;
    }
    return total + tiltPenalty * rotation * rotation;
  }

  const candidateRotations = new Set([0]);
  for (const { angle, increment } of bondData) {
    const multiple = Math.round(angle / increment);
    for (let delta = -1; delta <= 1; delta++) {
      let rotation = (multiple + delta) * increment - angle;
      rotation = rotation - Math.PI * Math.round(rotation / Math.PI);
      candidateRotations.add(rotation);
    }
  }

  let bestRotation = 0;
  let bestScore = score(0);
  for (const rotation of candidateRotations) {
    const rotationScore = score(rotation);
    if (rotationScore < bestScore - 1e-10) {
      bestScore = rotationScore;
      bestRotation = rotation;
    }
  }

  if (Math.abs(bestRotation) < (0.5 * Math.PI) / 180) {
    return;
  }

  let sumX = 0;
  let sumY = 0;
  for (const atomId of heavyAtomIds) {
    const point = coords.get(atomId);
    sumX += point.x;
    sumY += point.y;
  }
  rotateCoords(coords, vec(sumX / heavyAtomIds.length, sumY / heavyAtomIds.length), bestRotation);
}

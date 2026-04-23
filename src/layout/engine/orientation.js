/** @module orientation */

import { morganRanks } from '../../algorithms/morgan.js';
import { analyzeRings } from './topology/ring-analysis.js';
import { computeBounds } from './geometry/bounds.js';

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

function deviationFromHorizontalAxis(angle) {
  let normalized = angle % Math.PI;
  if (normalized > Math.PI / 2) {
    normalized -= Math.PI;
  }
  if (normalized <= -Math.PI / 2) {
    normalized += Math.PI;
  }
  return normalized;
}

function collectBondIdsAlongPath(molecule, atomIds) {
  if (!Array.isArray(atomIds) || atomIds.length < 2) {
    return new Set();
  }

  const bondIds = new Set();
  for (let index = 0; index < atomIds.length - 1; index++) {
    const bond = molecule.getBond(atomIds[index], atomIds[index + 1]);
    if (bond) {
      bondIds.add(bond.id);
    }
  }
  return bondIds;
}

function shouldPreserveWholeMoleculeLeveling(molecule, heavyAtomIds) {
  const rings = molecule.getRings();
  if (rings.length < 3 || heavyAtomIds.length < 18) {
    return false;
  }

  const ringAtomIds = new Set(rings.flat());
  const ringHeavyCount = heavyAtomIds.reduce((count, atomId) => count + (ringAtomIds.has(atomId) ? 1 : 0), 0);
  return ringHeavyCount / heavyAtomIds.length >= 0.5;
}

const BROAD_SLAB_LEVEL_LOCK_MIN_ASPECT_RATIO = 1.25;
const EXISTING_LANDSCAPE_SCAFFOLD_MIN_SHARE = 0.2;

/**
 * Returns whether an already-landscape broad slab contains a sizeable
 * multi-ring scaffold that is already level and should not be rotated.
 * @param {Map<string, {x: number, y: number}>} coords - Coordinate map.
 * @param {import('../../core/Molecule.js').Molecule} molecule - Molecule graph.
 * @param {string[]} heavyAtomIds - Visible heavy-atom ids.
 * @returns {boolean} True when the current landscape scaffold should be preserved.
 */
function shouldPreserveExistingLandscapeScaffold(coords, molecule, heavyAtomIds) {
  if (!shouldPreserveWholeMoleculeLeveling(molecule, heavyAtomIds)) {
    return false;
  }

  const bounds = computeBounds(coords, heavyAtomIds);
  if (!bounds) {
    return false;
  }
  const { width, height } = bounds;
  if (height > width / BROAD_SLAB_LEVEL_LOCK_MIN_ASPECT_RATIO) {
    return false;
  }

  const minimumScaffoldSize = Math.max(8, Math.ceil(heavyAtomIds.length * EXISTING_LANDSCAPE_SCAFFOLD_MIN_SHARE));
  const heavyAtomIdSet = new Set(heavyAtomIds);
  const { ringSystems } = analyzeRings(molecule, morganRanks(molecule));
  return ringSystems.some(ringSystem => {
    if (ringSystem.ringIds.length < 2) {
      return false;
    }
    const visibleAtomIds = ringSystem.atomIds.filter(atomId => heavyAtomIdSet.has(atomId) && coords.has(atomId));
    if (visibleAtomIds.length < minimumScaffoldSize) {
      return false;
    }
    const ringBounds = computeBounds(coords, visibleAtomIds);
    return ringBounds != null && ringBounds.width >= ringBounds.height;
  });
}

function preferredPathBondWeight(molecule, orientPath) {
  if (!Array.isArray(orientPath) || orientPath.length < 5) {
    return 1;
  }

  const ringAtomIds = new Set(molecule.getRings().flat());
  const nonRingAtomCount = orientPath.reduce((count, atomId) => count + (ringAtomIds.has(atomId) ? 0 : 1), 0);
  if (nonRingAtomCount < 5) {
    return 1;
  }

  return 1 + Math.min(4, nonRingAtomCount - 3);
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

function heavyAtomCount(molecule) {
  let count = 0;
  for (const atom of molecule.atoms.values()) {
    if (atom?.name !== 'H') {
      count++;
    }
  }
  return count;
}

function landscapePathMinLength(molecule, orientPath = null) {
  if (molecule.getRings().length === 0) {
    return 8;
  }
  if (Array.isArray(orientPath) && orientPath.length >= 3) {
    const ringAtomIds = new Set(molecule.getRings().flat());
    const ringAtomCount = orientPath.reduce((count, atomId) => count + (ringAtomIds.has(atomId) ? 1 : 0), 0);
    if (ringAtomCount === 0) {
      return Math.max(3, Math.min(6, Math.ceil(heavyAtomCount(molecule) / 5)));
    }
  }
  return 6;
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
  if (shouldPreserveExistingLandscapeScaffold(coords, molecule, heavyAtomIds)) {
    return;
  }

  const orientPath = preferredLandscapeOrientationPath(molecule);
  const hasPreferredLandscapeFrame = Boolean(orientPath && orientPath.length >= landscapePathMinLength(molecule, orientPath));
  if (hasPreferredLandscapeFrame) {
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

  const fallbackBounds = computeBounds(coords, heavyAtomIds);
  if (fallbackBounds && fallbackBounds.height > fallbackBounds.width) {
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
  return Boolean(orientPath && orientPath.length >= landscapePathMinLength(molecule, orientPath));
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
  const orientPath = preferredLandscapeOrientationPath(molecule);
  const hasPreferredLandscapeFrame = Boolean(orientPath && orientPath.length >= landscapePathMinLength(molecule, orientPath));

  const beforePositions = new Map(heavyAtomIds.map(atomId => [atomId, { ...coords.get(atomId) }]));

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

  if (!hasPreferredLandscapeFrame && maxY - minY > maxX - minX) {
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
  if (shouldPreserveExistingLandscapeScaffold(coords, molecule, heavyAtomIds)) {
    return;
  }

  let preferredAxisAngle = null;
  let preferredPathBondIds = new Set();
  let preferredPathWeight = 1;
  const orientPath = preferredLandscapeOrientationPath(molecule);
  if (orientPath && orientPath.length >= landscapePathMinLength(molecule, orientPath)) {
    const start = coords.get(orientPath[0]);
    const end = coords.get(orientPath[orientPath.length - 1]);
    if (start && end) {
      preferredAxisAngle = Math.atan2(end.y - start.y, end.x - start.x);
      preferredPathBondIds = collectBondIdsAlongPath(molecule, orientPath);
      preferredPathWeight = preferredPathBondWeight(molecule, orientPath);
    }
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
      bondData.push({
        angle,
        increment: bondGrid.get(bondId) ?? Math.PI / 6,
        preferredPath: preferredPathBondIds.has(bondId)
      });
    }
  }

  if (bondData.length === 0) {
    return;
  }

  const tiltPenalty = 1e-4;
  const preferredAxisPenalty = 1;
  function score(rotation) {
    let total = 0;
    for (const { angle, increment, preferredPath } of bondData) {
      let deviation = (((angle + rotation) % increment) + increment) % increment;
      if (deviation > increment / 2) {
        deviation -= increment;
      }
      total += (preferredPath ? preferredPathWeight : 1) * deviation * deviation;
    }
    if (preferredAxisAngle != null) {
      const axisDeviation = deviationFromHorizontalAxis(preferredAxisAngle + rotation);
      total += preferredAxisPenalty * axisDeviation * axisDeviation;
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

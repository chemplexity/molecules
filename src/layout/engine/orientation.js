/** @module orientation */

import { morganRanks } from '../../algorithms/morgan.js';
import { analyzeRings } from './topology/ring-analysis.js';
import { computeBounds } from './geometry/bounds.js';
import { rotateAround } from './geometry/transforms.js';
import { centroidForAtomIds, vec } from './geometry/vec2.js';

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

function ringAtomIdsForMolecule(molecule) {
  if (molecule._layoutOrientationRingAtomIds instanceof Set && molecule._layoutOrientationRingAtomIdsVersion === molecule._topologyVersion) {
    return molecule._layoutOrientationRingAtomIds;
  }
  const ringAtomIds = new Set(molecule.getRings().flat());
  molecule._layoutOrientationRingAtomIds = ringAtomIds;
  molecule._layoutOrientationRingAtomIdsVersion = molecule._topologyVersion;
  return ringAtomIds;
}

function ringSystemsForMolecule(molecule) {
  if (Array.isArray(molecule._layoutOrientationRingSystems) && molecule._layoutOrientationRingSystemsVersion === molecule._topologyVersion) {
    return molecule._layoutOrientationRingSystems;
  }
  if (Array.isArray(molecule._layoutGraphRingSystems) && molecule._layoutGraphRingSystemsVersion === molecule._topologyVersion) {
    molecule._layoutOrientationRingSystems = molecule._layoutGraphRingSystems;
    molecule._layoutOrientationRingSystemsVersion = molecule._topologyVersion;
    return molecule._layoutOrientationRingSystems;
  }
  const { ringSystems } = analyzeRings(molecule, morganRanks(molecule));
  molecule._layoutOrientationRingSystems = ringSystems;
  molecule._layoutOrientationRingSystemsVersion = molecule._topologyVersion;
  return ringSystems;
}

function shouldPreserveWholeMoleculeLeveling(molecule, heavyAtomIds) {
  const rings = molecule.getRings();
  if (rings.length < 3 || heavyAtomIds.length < 18) {
    return false;
  }

  const ringAtomIds = ringAtomIdsForMolecule(molecule);
  const ringHeavyCount = heavyAtomIds.reduce((count, atomId) => count + (ringAtomIds.has(atomId) ? 1 : 0), 0);
  return ringHeavyCount / heavyAtomIds.length >= 0.5;
}

const BROAD_SLAB_LEVEL_LOCK_MIN_ASPECT_RATIO = 1.25;
const EXISTING_LANDSCAPE_SCAFFOLD_MIN_SHARE = 0.2;
const EXISTING_LANDSCAPE_SCAFFOLD_LEVEL_TOLERANCE = Math.PI / 180;

function principalAxisAngleForAtomIds(coords, atomIds) {
  if (!Array.isArray(atomIds) || atomIds.length < 2) {
    return null;
  }

  let sumX = 0;
  let sumY = 0;
  for (const atomId of atomIds) {
    const point = coords.get(atomId);
    if (!point) {
      return null;
    }
    sumX += point.x;
    sumY += point.y;
  }
  const inv = 1 / atomIds.length;
  const centerX = sumX * inv;
  const centerY = sumY * inv;

  let inertiaXX = 0;
  let inertiaYY = 0;
  let inertiaXY = 0;
  for (const atomId of atomIds) {
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
  return inertia0 <= inertia1 ? angle0 : angle0 + Math.PI / 2;
}

function largeMultiRingScaffoldAtomSets(coords, molecule, heavyAtomIds) {
  if (!shouldPreserveWholeMoleculeLeveling(molecule, heavyAtomIds)) {
    return [];
  }
  const heavyAtomIdSet = new Set(heavyAtomIds);
  const minimumScaffoldSize = Math.max(8, Math.ceil(heavyAtomIds.length * EXISTING_LANDSCAPE_SCAFFOLD_MIN_SHARE));
  return ringSystemsForMolecule(molecule)
    .filter(ringSystem => ringSystem.ringIds.length >= 2)
    .map(ringSystem => ringSystem.atomIds.filter(atomId => heavyAtomIdSet.has(atomId) && coords.has(atomId)))
    .filter(atomIds => atomIds.length >= minimumScaffoldSize);
}

function minimumLargeMultiRingScaffoldDeviation(coords, molecule, heavyAtomIds) {
  const deviations = largeMultiRingScaffoldAtomSets(coords, molecule, heavyAtomIds)
    .map(atomIds => principalAxisAngleForAtomIds(coords, atomIds))
    .filter(axisAngle => axisAngle != null)
    .map(axisAngle => Math.abs(deviationFromHorizontalAxis(axisAngle)));
  return deviations.length > 0 ? Math.min(...deviations) : null;
}

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
  return ringSystemsForMolecule(molecule).some(ringSystem => {
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

function rotatedSubsetCoords(coords, atomIds, origin, rotation) {
  const rotatedCoords = new Map(coords);
  for (const atomId of atomIds) {
    const point = coords.get(atomId);
    if (point) {
      rotatedCoords.set(atomId, rotateAround(point, origin, rotation));
    }
  }
  return rotatedCoords;
}

function bestLandscapeRotationPreservingLevelScaffold(coords, molecule, heavyAtomIds) {
  const currentDeviation = minimumLargeMultiRingScaffoldDeviation(coords, molecule, heavyAtomIds);
  if (currentDeviation == null || currentDeviation > EXISTING_LANDSCAPE_SCAFFOLD_LEVEL_TOLERANCE) {
    return null;
  }

  const origin = centroidForAtomIds(coords, heavyAtomIds);
  if (!origin) {
    return null;
  }
  let best = null;

  for (let step = -5; step <= 6; step++) {
    if (step === 0) {
      continue;
    }
    const rotation = (step * Math.PI) / 6;
    const candidateCoords = rotatedSubsetCoords(coords, heavyAtomIds, origin, rotation);
    const bounds = computeBounds(candidateCoords, heavyAtomIds);
    if (!bounds || bounds.width < bounds.height) {
      continue;
    }
    const deviation = minimumLargeMultiRingScaffoldDeviation(candidateCoords, molecule, heavyAtomIds);
    if (deviation == null || deviation > EXISTING_LANDSCAPE_SCAFFOLD_LEVEL_TOLERANCE) {
      continue;
    }
    const score = deviation * 1000 + Math.abs(rotation);
    if (!best || score < best.score) {
      best = { rotation, score };
    }
  }

  return best?.rotation ?? null;
}

function preferredPathBondWeight(molecule, orientPath) {
  if (!Array.isArray(orientPath) || orientPath.length < 5) {
    return 1;
  }

  const ringAtomIds = ringAtomIdsForMolecule(molecule);
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

function orderedHeavyAdjacencyIndexes(molecule, heavyAtomIds, atomIndexById, ranks) {
  return heavyAtomIds.map(atomId => {
    const neighborIndexes = [];
    for (const neighborAtomId of orderedNeighborIds(molecule, atomId, ranks)) {
      const neighborIndex = atomIndexById.get(neighborAtomId);
      if (neighborIndex !== undefined) {
        neighborIndexes.push(neighborIndex);
      }
    }
    return neighborIndexes;
  });
}

function cloneBackbonePathResult(result) {
  return result ? { path: [...result.path], ringCount: result.ringCount, score: result.score } : null;
}

/**
 * Finds the longest heavy-atom backbone path, preferring paths that stay out of rings.
 * @param {import('../core/Molecule.js').Molecule} molecule - Molecule graph.
 * @returns {{path: string[], ringCount: number, score: number}|null} Best path info.
 */
export function findPreferredBackbonePath(molecule) {
  if (molecule._layoutPreferredBackbonePathVersion === molecule._topologyVersion) {
    return cloneBackbonePathResult(molecule._layoutPreferredBackbonePath ?? null);
  }
  const heavyAtomIds = [...molecule.atoms.keys()].filter(atomId => molecule.atoms.get(atomId)?.name !== 'H');
  if (heavyAtomIds.length < 2) {
    molecule._layoutPreferredBackbonePath = null;
    molecule._layoutPreferredBackbonePathVersion = molecule._topologyVersion;
    return null;
  }

  const ringAtomIds = ringAtomIdsForMolecule(molecule);
  const ranks = morganRanks(molecule);
  const atomIndexById = new Map(heavyAtomIds.map((atomId, index) => [atomId, index]));
  const adjacency = orderedHeavyAdjacencyIndexes(molecule, heavyAtomIds, atomIndexById, ranks);
  const ringFlags = Uint8Array.from(heavyAtomIds, atomId => (ringAtomIds.has(atomId) ? 1 : 0));
  const previousIndexes = new Int32Array(heavyAtomIds.length);
  const depthByIndex = new Int32Array(heavyAtomIds.length);
  const ringCountByIndex = new Int32Array(heavyAtomIds.length);
  const seenStamps = new Int32Array(heavyAtomIds.length);
  const queue = new Int32Array(heavyAtomIds.length);
  let stamp = 0;
  let bestPath = null;

  for (let startIndex = 0; startIndex < heavyAtomIds.length; startIndex++) {
    stamp++;
    seenStamps[startIndex] = stamp;
    previousIndexes[startIndex] = -1;
    depthByIndex[startIndex] = 0;
    ringCountByIndex[startIndex] = ringFlags[startIndex];
    let queueHead = 0;
    let queueTail = 0;
    queue[queueTail++] = startIndex;

    while (queueHead < queueTail) {
      const currentIndex = queue[queueHead++];
      for (const neighborIndex of adjacency[currentIndex] ?? []) {
        if (seenStamps[neighborIndex] === stamp) {
          continue;
        }
        seenStamps[neighborIndex] = stamp;
        previousIndexes[neighborIndex] = currentIndex;
        depthByIndex[neighborIndex] = depthByIndex[currentIndex] + 1;
        ringCountByIndex[neighborIndex] = ringCountByIndex[currentIndex] + ringFlags[neighborIndex];
        queue[queueTail++] = neighborIndex;
      }
    }

    for (let endIndex = 0; endIndex < heavyAtomIds.length; endIndex++) {
      if (endIndex === startIndex || seenStamps[endIndex] !== stamp) {
        continue;
      }
      const pathLength = depthByIndex[endIndex] + 1;
      const ringCount = ringCountByIndex[endIndex];
      const score = pathLength - ringCount * 0.6;
      if (
        !bestPath ||
        score > bestPath.score ||
        (score === bestPath.score && ringCount < bestPath.ringCount) ||
        (score === bestPath.score && ringCount === bestPath.ringCount && pathLength > bestPath.path.length)
      ) {
        const path = [];
        for (let currentIndex = endIndex; currentIndex >= 0; currentIndex = previousIndexes[currentIndex]) {
          path.push(heavyAtomIds[currentIndex]);
        }
        path.reverse();
        bestPath = { path, ringCount, score };
      }
    }
  }

  molecule._layoutPreferredBackbonePath = cloneBackbonePathResult(bestPath);
  molecule._layoutPreferredBackbonePathVersion = molecule._topologyVersion;
  return cloneBackbonePathResult(bestPath);
}

function trimTerminalPeripheralHeteroEndpoints(path, molecule) {
  if (!Array.isArray(path) || path.length < 3 || !molecule) {
    return path;
  }

  const rings = molecule.getRings();
  const enableLargeRingChainTailTrim = rings.length >= 4 && heavyAtomCount(molecule) >= 40;
  const ringAtomIds = enableLargeRingChainTailTrim ? ringAtomIdsForMolecule(molecule) : new Set();
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
  /**
   * Returns whether an endpoint belongs to a terminal acyclic sidechain that
   * should not define the whole-molecule landscape axis for ring-decorated
   * peptide-scale layouts.
   * @param {string} atomId - Endpoint atom ID.
   * @returns {boolean} True when the endpoint is a trimmable sidechain atom.
   */
  const isTerminalAcyclicSidechainAtom = atomId => {
    if (!enableLargeRingChainTailTrim || ringAtomIds.has(atomId)) {
      return false;
    }
    const atom = molecule.atoms.get(atomId);
    if (!atom || atom.name === 'H') {
      return false;
    }
    const heavyNeighbors = atom.getNeighbors(molecule).filter(neighbor => neighbor.name !== 'H');
    if (atom.name === 'C') {
      const hasCarbonylOxygen = heavyNeighbors.some(neighbor => {
        const bond = molecule.getBond(atomId, neighbor.id);
        return neighbor.name === 'O' && (bond?.properties.order ?? 1) >= 2;
      });
      if (hasCarbonylOxygen) {
        return false;
      }
      const nitrogenNeighborCount = heavyNeighbors.reduce((count, neighbor) => count + (neighbor.name === 'N' ? 1 : 0), 0);
      return heavyNeighbors.length <= 2 || nitrogenNeighborCount >= 2;
    }
    return heavyNeighbors.length <= 2;
  };
  const isTrimmableEndpoint = atomId => isTerminalPeripheralHetero(atomId) || isTerminalAcyclicSidechainAtom(atomId);

  while (endIndex - startIndex + 1 >= 3 && isTrimmableEndpoint(path[startIndex])) {
    startIndex++;
  }
  while (endIndex - startIndex + 1 >= 3 && isTrimmableEndpoint(path[endIndex])) {
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
  if (molecule._layoutLongestNonRingLandscapePathVersion === molecule._topologyVersion) {
    return molecule._layoutLongestNonRingLandscapePath ? [...molecule._layoutLongestNonRingLandscapePath] : null;
  }
  const ringAtomIds = ringAtomIdsForMolecule(molecule);
  const heavyAtomIds = [...molecule.atoms.keys()].filter(atomId => {
    const atom = molecule.atoms.get(atomId);
    return atom && atom.name !== 'H' && !ringAtomIds.has(atomId);
  });
  if (heavyAtomIds.length < 2) {
    molecule._layoutLongestNonRingLandscapePath = null;
    molecule._layoutLongestNonRingLandscapePathVersion = molecule._topologyVersion;
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

  molecule._layoutLongestNonRingLandscapePath = bestPath ? [...bestPath] : null;
  molecule._layoutLongestNonRingLandscapePathVersion = molecule._topologyVersion;
  return bestPath ? [...bestPath] : null;
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
    const ringAtomIds = ringAtomIdsForMolecule(molecule);
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

  const ringAtomIds = ringAtomIdsForMolecule(molecule);
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
  if (molecule._layoutPreferredLandscapeOrientationPathVersion === molecule._topologyVersion) {
    return molecule._layoutPreferredLandscapeOrientationPath ? [...molecule._layoutPreferredLandscapeOrientationPath] : null;
  }
  const preferredBackbone = findPreferredBackbonePath(molecule);
  const longestNonRingPath = trimTerminalPeripheralHeteroEndpoints(longestNonRingLandscapePath(molecule), molecule);
  const cacheResult = path => {
    molecule._layoutPreferredLandscapeOrientationPath = path?.length ? [...path] : null;
    molecule._layoutPreferredLandscapeOrientationPathVersion = molecule._topologyVersion;
    return path?.length ? [...path] : null;
  };
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
    return cacheResult(longestNonRingPath?.length >= 2 ? longestNonRingPath : null);
  }

  const trimmedPath = trimTerminalPeripheralHeteroEndpoints(preferredBackbone.path, molecule);
  if (trimmedPath.length < 2) {
    return cacheResult(longestNonRingPath?.length >= 2 ? longestNonRingPath : null);
  }
  if (preferredBackbone.ringCount === 0) {
    return cacheResult(preferLongerPath(trimmedPath));
  }

  const ringAtomIds = ringAtomIdsForMolecule(molecule);
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
  return cacheResult(preferLongerPath(bestRun));
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
        const origin = centroidForAtomIds(coords, heavyAtomIds);
        if (origin) {
          rotateCoords(coords, origin, -angle);
        }
      }
      return;
    }
  }

  const center = centroidForAtomIds(coords, heavyAtomIds);
  if (!center) {
    return;
  }
  const centerX = center.x;

  const fallbackBounds = computeBounds(coords, heavyAtomIds);
  if (fallbackBounds && fallbackBounds.height > fallbackBounds.width) {
    rotateCoords(coords, center, bestLandscapeRotationPreservingLevelScaffold(coords, molecule, heavyAtomIds) ?? Math.PI / 2);
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
      rotateCoords(coords, center, Math.PI);
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
        preferredPath: preferredPathBondIds.has(bondId),
        ringBond: bondGrid.has(bondId)
      });
    }
  }

  if (bondData.length === 0) {
    return;
  }

  const tiltPenalty = 1e-4;
  const preferredAxisPenalty = 1;
  const horizontalRingBondPenalty = 0.25;
  function score(rotation) {
    let total = 0;
    for (const { angle, increment, preferredPath, ringBond } of bondData) {
      let deviation = (((angle + rotation) % increment) + increment) % increment;
      if (deviation > increment / 2) {
        deviation -= increment;
      }
      total += (preferredPath ? preferredPathWeight : 1) * deviation * deviation;
      if (ringBond) {
        total += horizontalRingBondPenalty * deviationFromHorizontalAxis(angle + rotation) ** 2;
      }
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

  const origin = centroidForAtomIds(coords, heavyAtomIds);
  if (!origin) {
    return;
  }
  rotateCoords(coords, origin, bestRotation);
}

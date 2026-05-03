/** @module families/bridge-projection */

import { angleOf, distance, rotate, sub } from '../geometry/vec2.js';
import { compareCanonicalAtomIds } from '../topology/canonical-order.js';
import { pickBridgeheads } from '../topology/bridgeheads.js';

export { pickBridgeheads } from '../topology/bridgeheads.js';

export const BRIDGE_PROJECTION_FACTORS = Object.freeze({
  maxProjectedPathCount: 12,
  singleAtomClampMarginFactor: 0.35,
  layerSpacingFactor: 0.45,
  singleAtomBaseHeightFactor: 0.9,
  pathArcBaseAmplitudeFactor: 0.95,
  meanSeedBiasFactor: 0.3,
  meanSeedBiasClampFactor: 0.5
});

function buildAdjacency(layoutGraph, atomIds) {
  const atomIdSet = new Set(atomIds);
  const adjacency = new Map(atomIds.map(atomId => [atomId, []]));
  for (const bond of layoutGraph.bonds.values()) {
    if (bond.kind !== 'covalent' || !atomIdSet.has(bond.a) || !atomIdSet.has(bond.b)) {
      continue;
    }
    adjacency.get(bond.a)?.push(bond.b);
    adjacency.get(bond.b)?.push(bond.a);
  }
  for (const [atomId, neighbors] of adjacency) {
    neighbors.sort((firstAtomId, secondAtomId) => compareCanonicalAtomIds(firstAtomId, secondAtomId, layoutGraph.canonicalAtomRank));
    adjacency.set(atomId, neighbors);
  }
  return adjacency;
}

function clamp(value, minValue, maxValue) {
  return Math.max(minValue, Math.min(maxValue, value));
}

function quadraticPoint(firstPoint, controlPoint, secondPoint, t) {
  const oneMinusT = 1 - t;
  return {
    x: oneMinusT * oneMinusT * firstPoint.x + 2 * oneMinusT * t * controlPoint.x + t * t * secondPoint.x,
    y: oneMinusT * oneMinusT * firstPoint.y + 2 * oneMinusT * t * controlPoint.y + t * t * secondPoint.y
  };
}

/**
 * Returns the minimum bridgehead span for readable projection lanes. Dense
 * theta-like bridged systems with three or more long paths collapse when their
 * bridgeheads keep the compact KK distance, so use the shortest path length as
 * a bounded lower span before laying out the lanes.
 * @param {string[][]} paths - Enumerated bridgehead-to-bridgehead paths.
 * @param {number} bondLength - Target bond length.
 * @returns {number} Minimum bridgehead span.
 */
function bridgeProjectionMinimumSpan(paths, bondLength) {
  const defaultSpan = bondLength * 1.6;
  if (paths.length < 3) {
    return defaultSpan;
  }
  const shortestSegmentCount = Math.min(...paths.map(path => path.length - 1).filter(segmentCount => segmentCount > 0));
  if (!Number.isFinite(shortestSegmentCount) || shortestSegmentCount < 3) {
    return defaultSpan;
  }
  return Math.max(defaultSpan, bondLength * Math.min(shortestSegmentCount * 0.95, 3.25));
}

/**
 * Returns whether a three-path bridged system should reserve a center lane for
 * its shortest path. This keeps theta-like saturated cores from stacking both
 * outer paths on the same side of a shared bridge run.
 * @param {string[][]} sortedPaths - Bridge paths sorted by internal atom count.
 * @returns {boolean} True when balanced center/outer lane projection applies.
 */
function shouldUseBalancedThetaProjection(sortedPaths) {
  return sortedPaths.length === 3 && sortedPaths[0].length - 1 >= 3;
}

/**
 * Returns the covalent segment counts for bridgehead-to-bridgehead paths.
 * @param {string[][]} paths - Enumerated bridge paths.
 * @returns {number[]} Positive path segment counts.
 */
function bridgePathSegmentCounts(paths) {
  return paths.map(path => path.length - 1).filter(segmentCount => segmentCount > 0);
}

/**
 * Returns the shortest bridge path segment count.
 * @param {string[][]} paths - Enumerated bridge paths.
 * @returns {number} Shortest segment count, or infinity for empty path sets.
 */
function shortestBridgePathSegmentCount(paths) {
  const segmentCounts = bridgePathSegmentCounts(paths);
  return segmentCounts.length === 0 ? Number.POSITIVE_INFINITY : Math.min(...segmentCounts);
}

/**
 * Returns whether path lengths describe a balanced long theta graph.
 * @param {string[][]} paths - Enumerated bridge paths.
 * @returns {boolean} True when three long paths differ by at most one segment.
 */
function isBalancedLongThetaPathSet(paths) {
  const segmentCounts = bridgePathSegmentCounts(paths).sort((firstCount, secondCount) => firstCount - secondCount);
  return (
    segmentCounts.length === 3
    && segmentCounts[0] >= 3
    && segmentCounts[2] - segmentCounts[0] <= 1
  );
}

/**
 * Counts covalent heavy neighbors inside a candidate bridged atom set.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {string} atomId - Atom ID to inspect.
 * @param {Set<string>} atomIdSet - Candidate bridged atom IDs.
 * @returns {number} Internal heavy-neighbor count.
 */
function bridgeProjectionInternalHeavyDegree(layoutGraph, atomId, atomIdSet) {
  let degree = 0;
  for (const bond of layoutGraph.bondsByAtomId.get(atomId) ?? []) {
    if (!bond || bond.kind !== 'covalent') {
      continue;
    }
    const neighborAtomId = bond.a === atomId ? bond.b : bond.a;
    const neighborAtom = layoutGraph.atoms.get(neighborAtomId);
    if (atomIdSet.has(neighborAtomId) && neighborAtom && neighborAtom.element !== 'H') {
      degree++;
    }
  }
  return degree;
}

/**
 * Scores balanced theta bridgehead candidates by path compactness.
 * @param {string[][]} paths - Enumerated bridge paths.
 * @returns {number} Lower is better.
 */
function balancedLongThetaBridgeheadScore(paths) {
  const segmentCounts = bridgePathSegmentCounts(paths);
  return Math.max(...segmentCounts) * 100 + segmentCounts.reduce((sum, count) => sum + count, 0);
}

/**
 * Selects an alternate bridgehead pair for long theta-like systems when the
 * default degree-ranked pair contains a tiny shortcut path. This keeps the
 * global bridgehead picker stable for compact fused cyclopropane cases while
 * allowing true three-lane bridged cores to project around their shared run.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {string[]} atomIds - Bridged component atom IDs.
 * @param {[string, string]} defaultBridgeheadAtomIds - Default bridgehead pair.
 * @returns {[string, string]} Bridgehead pair to use for projection.
 */
function selectProjectionBridgeheads(layoutGraph, atomIds, defaultBridgeheadAtomIds) {
  const defaultPaths = enumerateBridgePaths(layoutGraph, atomIds, defaultBridgeheadAtomIds, {
    maxPathCount: BRIDGE_PROJECTION_FACTORS.maxProjectedPathCount + 1
  });
  if (isBalancedLongThetaPathSet(defaultPaths) || shortestBridgePathSegmentCount(defaultPaths) >= 3) {
    return defaultBridgeheadAtomIds;
  }

  const atomIdSet = new Set(atomIds);
  const candidateAtomIds = atomIds
    .filter(atomId =>
      bridgeProjectionInternalHeavyDegree(layoutGraph, atomId, atomIdSet) >= 3
      && (layoutGraph.atomToRings.get(atomId)?.length ?? 0) > 1
    )
    .sort((firstAtomId, secondAtomId) => compareCanonicalAtomIds(firstAtomId, secondAtomId, layoutGraph.canonicalAtomRank));
  let bestPair = defaultBridgeheadAtomIds;
  let bestScore = Number.POSITIVE_INFINITY;

  for (let firstIndex = 0; firstIndex < candidateAtomIds.length; firstIndex++) {
    for (let secondIndex = firstIndex + 1; secondIndex < candidateAtomIds.length; secondIndex++) {
      const candidatePair = [candidateAtomIds[firstIndex], candidateAtomIds[secondIndex]];
      if (
        (candidatePair[0] === defaultBridgeheadAtomIds[0] && candidatePair[1] === defaultBridgeheadAtomIds[1])
        || (candidatePair[0] === defaultBridgeheadAtomIds[1] && candidatePair[1] === defaultBridgeheadAtomIds[0])
      ) {
        continue;
      }
      const candidatePaths = enumerateBridgePaths(layoutGraph, atomIds, candidatePair, {
        maxPathCount: BRIDGE_PROJECTION_FACTORS.maxProjectedPathCount + 1
      });
      if (!isBalancedLongThetaPathSet(candidatePaths)) {
        continue;
      }
      const candidateScore = balancedLongThetaBridgeheadScore(candidatePaths);
      if (candidateScore < bestScore) {
        bestPair = candidatePair;
        bestScore = candidateScore;
      }
    }
  }

  return bestPair;
}

/**
 * Enumerates simple covalent paths between two bridgeheads inside a bridged component.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {string[]} atomIds - Bridged component atom IDs.
 * @param {[string, string]} bridgeheadAtomIds - Chosen bridgehead pair.
 * @param {object} [options] - Enumeration options.
 * @param {number} [options.maxPathCount] - Maximum number of paths to collect before stopping.
 * @returns {string[][]} Canonically ordered simple paths.
 */
export function enumerateBridgePaths(layoutGraph, atomIds, bridgeheadAtomIds, options = {}) {
  const [startAtomId, endAtomId] = bridgeheadAtomIds;
  const adjacency = buildAdjacency(layoutGraph, atomIds);
  const paths = [];
  const seenSignatures = new Set();
  const maxPathCount = Number.isFinite(options.maxPathCount) ? Math.max(1, Math.trunc(options.maxPathCount)) : Number.POSITIVE_INFINITY;

  function dfs(atomId, visited, path) {
    if (paths.length >= maxPathCount) {
      return true;
    }
    if (atomId === endAtomId) {
      const signature = path.join('>');
      if (!seenSignatures.has(signature)) {
        seenSignatures.add(signature);
        paths.push([...path]);
      }
      return paths.length >= maxPathCount;
    }
    for (const neighborAtomId of adjacency.get(atomId) ?? []) {
      if (visited.has(neighborAtomId)) {
        continue;
      }
      visited.add(neighborAtomId);
      path.push(neighborAtomId);
      const shouldStop = dfs(neighborAtomId, visited, path);
      path.pop();
      visited.delete(neighborAtomId);
      if (shouldStop) {
        return true;
      }
    }
    return false;
  }

  dfs(startAtomId, new Set([startAtomId]), [startAtomId]);
  return paths.sort((firstPath, secondPath) => {
    if (firstPath.length !== secondPath.length) {
      return firstPath.length - secondPath.length;
    }
    const firstSignature = firstPath.join('>');
    const secondSignature = secondPath.join('>');
    return firstSignature.localeCompare(secondSignature, 'en', { numeric: true });
  });
}

/**
 * Rotates and recenters a bridged seed so the bridgehead chord is horizontal.
 * @param {Map<string, {x: number, y: number}>} seedCoords - Seed coordinate map.
 * @param {[string, string]} bridgeheadAtomIds - Chosen bridgehead pair.
 * @returns {{coords: Map<string, {x: number, y: number}>, headDistance: number}} Oriented coordinate map and bridgehead distance.
 */
export function orientBridgedSeed(seedCoords, bridgeheadAtomIds) {
  const [firstHeadId, secondHeadId] = bridgeheadAtomIds;
  const firstHead = seedCoords.get(firstHeadId);
  const secondHead = seedCoords.get(secondHeadId);
  if (!firstHead || !secondHead) {
    return { coords: new Map(seedCoords), headDistance: 0 };
  }

  const midpoint = { x: (firstHead.x + secondHead.x) / 2, y: (firstHead.y + secondHead.y) / 2 };
  const rotation = -angleOf(sub(secondHead, firstHead));
  const oriented = new Map();
  for (const [atomId, position] of seedCoords) {
    const rotated = rotate(sub(position, midpoint), rotation);
    oriented.set(atomId, rotated);
  }
  const orientedFirstHead = oriented.get(firstHeadId);
  const orientedSecondHead = oriented.get(secondHeadId);
  if (orientedFirstHead && orientedSecondHead && orientedFirstHead.x > orientedSecondHead.x) {
    for (const [atomId, position] of oriented) {
      oriented.set(atomId, { x: -position.x, y: position.y });
    }
  }

  return {
    coords: oriented,
    headDistance: distance(oriented.get(firstHeadId), oriented.get(secondHeadId))
  };
}

/**
 * Projects bridge paths onto more publication-like stepped and arced shapes.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {string[]} atomIds - Bridged component atom IDs.
 * @param {Map<string, {x: number, y: number}>} seedCoords - Seed coordinate map, usually from KK.
 * @param {number} bondLength - Target bond length.
 * @returns {{coords: Map<string, {x: number, y: number}>, bridgeheadAtomIds: [string, string]|null, pathCount: number}} Projected coordinates and summary.
 */
export function projectBridgePaths(layoutGraph, atomIds, seedCoords, bondLength) {
  const defaultBridgeheadAtomIds = pickBridgeheads(layoutGraph, atomIds);
  if (!defaultBridgeheadAtomIds) {
    return {
      coords: new Map(seedCoords),
      bridgeheadAtomIds: null,
      pathCount: 0
    };
  }
  const bridgeheadAtomIds = selectProjectionBridgeheads(layoutGraph, atomIds, defaultBridgeheadAtomIds);

  const oriented = orientBridgedSeed(seedCoords, bridgeheadAtomIds);
  const coords = new Map(oriented.coords);
  const maxProjectedPathCount = BRIDGE_PROJECTION_FACTORS.maxProjectedPathCount;
  const paths = enumerateBridgePaths(layoutGraph, atomIds, bridgeheadAtomIds, {
    maxPathCount: maxProjectedPathCount + 1
  });
  if (paths.length <= 1) {
    return {
      coords,
      bridgeheadAtomIds,
      pathCount: paths.length
    };
  }
  if (paths.length > maxProjectedPathCount) {
    return {
      coords,
      bridgeheadAtomIds,
      pathCount: paths.length
    };
  }

  const [firstHeadId, secondHeadId] = bridgeheadAtomIds;
  const firstHead = coords.get(firstHeadId);
  const secondHead = coords.get(secondHeadId);
  const midpointX = (firstHead.x + secondHead.x) / 2;
  const minimumSpan = bridgeProjectionMinimumSpan(paths, bondLength);
  const headDistance = Math.max(oriented.headDistance, minimumSpan);
  coords.set(firstHeadId, { x: -headDistance / 2, y: 0 });
  coords.set(secondHeadId, { x: headDistance / 2, y: 0 });
  const leftHead = coords.get(firstHeadId);
  const rightHead = coords.get(secondHeadId);

  const sideUsage = new Map([
    [-1, 0],
    [1, 0]
  ]);
  const sortedPaths = [...paths].sort((firstPath, secondPath) => {
    const firstInternalCount = firstPath.length - 2;
    const secondInternalCount = secondPath.length - 2;
    if (firstInternalCount !== secondInternalCount) {
      return firstInternalCount - secondInternalCount;
    }
    return firstPath.join('>').localeCompare(secondPath.join('>'), 'en', { numeric: true });
  });

  for (let pathIndex = 0; pathIndex < sortedPaths.length; pathIndex++) {
    const path = sortedPaths[pathIndex];
    const internalAtomIds = path.slice(1, -1);
    const internalCount = internalAtomIds.length;
    if (internalCount === 0) {
      continue;
    }

    const meanSeedY = internalAtomIds.reduce((sum, atomId) => sum + (oriented.coords.get(atomId)?.y ?? 0), 0) / internalCount;
    const meanSeedX = internalAtomIds.reduce((sum, atomId) => sum + (oriented.coords.get(atomId)?.x ?? 0), 0) / internalCount;
    let preferredSide = meanSeedY > 1e-6 ? 1 : meanSeedY < -1e-6 ? -1 : pathIndex % 2 === 0 ? 1 : -1;
    const oppositeSide = preferredSide === 1 ? -1 : 1;
    if ((sideUsage.get(preferredSide) ?? 0) > (sideUsage.get(oppositeSide) ?? 0) + 1) {
      preferredSide = oppositeSide;
    }
    const useBalancedThetaProjection = shouldUseBalancedThetaProjection(sortedPaths);
    let side = preferredSide;
    if (useBalancedThetaProjection) {
      if (pathIndex === 0) {
        side = 0;
      } else if (pathIndex === 2) {
        const previousOuterPath = sortedPaths[1];
        const previousInternalAtomIds = previousOuterPath.slice(1, -1);
        const previousMeanSeedY = previousInternalAtomIds.reduce((sum, atomId) => sum + (oriented.coords.get(atomId)?.y ?? 0), 0) / previousInternalAtomIds.length;
        const previousSide = previousMeanSeedY < -1e-6 ? -1 : 1;
        side = -previousSide;
      }
    }
    const layer = side === 0 ? 0 : sideUsage.get(side) ?? 0;
    if (side !== 0) {
      sideUsage.set(side, layer + 1);
    }

    if (internalCount === 1) {
      const clampedX = clamp(
        meanSeedX,
        -headDistance / 2 + bondLength * BRIDGE_PROJECTION_FACTORS.singleAtomClampMarginFactor,
        headDistance / 2 - bondLength * BRIDGE_PROJECTION_FACTORS.singleAtomClampMarginFactor
      );
      const y = side * bondLength * (BRIDGE_PROJECTION_FACTORS.singleAtomBaseHeightFactor + layer * BRIDGE_PROJECTION_FACTORS.layerSpacingFactor);
      coords.set(internalAtomIds[0], { x: clampedX, y });
      continue;
    }
    if (side === 0) {
      for (let internalIndex = 0; internalIndex < internalAtomIds.length; internalIndex++) {
        const t = (internalIndex + 1) / (internalCount + 1);
        coords.set(internalAtomIds[internalIndex], {
          x: leftHead.x + (rightHead.x - leftHead.x) * t,
          y: 0
        });
      }
      continue;
    }

    const xBias = clamp(
      (meanSeedX - midpointX) * BRIDGE_PROJECTION_FACTORS.meanSeedBiasFactor,
      -bondLength * BRIDGE_PROJECTION_FACTORS.meanSeedBiasClampFactor,
      bondLength * BRIDGE_PROJECTION_FACTORS.meanSeedBiasClampFactor
    );
    const amplitude =
      side *
      bondLength *
      (BRIDGE_PROJECTION_FACTORS.pathArcBaseAmplitudeFactor +
        (internalCount - 1) * BRIDGE_PROJECTION_FACTORS.meanSeedBiasFactor +
        layer * BRIDGE_PROJECTION_FACTORS.layerSpacingFactor);
    const controlPoint = {
      x: midpointX + xBias,
      y: amplitude
    };
    for (let internalIndex = 0; internalIndex < internalAtomIds.length; internalIndex++) {
      const t = (internalIndex + 1) / (internalCount + 1);
      coords.set(internalAtomIds[internalIndex], quadraticPoint(leftHead, controlPoint, rightHead, t));
    }
  }

  return {
    coords,
    bridgeheadAtomIds,
    pathCount: paths.length
  };
}

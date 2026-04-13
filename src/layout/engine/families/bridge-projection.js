/** @module families/bridge-projection */

import { angleOf, distance, rotate, sub } from '../geometry/vec2.js';
import { BRIDGE_PROJECTION_FACTORS } from '../constants.js';
import { compareCanonicalAtomIds } from '../topology/canonical-order.js';
import { pickBridgeheads } from '../topology/bridgeheads.js';

export { pickBridgeheads } from '../topology/bridgeheads.js';

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
    x: (oneMinusT * oneMinusT * firstPoint.x) + (2 * oneMinusT * t * controlPoint.x) + (t * t * secondPoint.x),
    y: (oneMinusT * oneMinusT * firstPoint.y) + (2 * oneMinusT * t * controlPoint.y) + (t * t * secondPoint.y)
  };
}

/**
 * Enumerates simple covalent paths between two bridgeheads inside a bridged component.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {string[]} atomIds - Bridged component atom IDs.
 * @param {[string, string]} bridgeheadAtomIds - Chosen bridgehead pair.
 * @returns {string[][]} Canonically ordered simple paths.
 */
export function enumerateBridgePaths(layoutGraph, atomIds, bridgeheadAtomIds) {
  const [startAtomId, endAtomId] = bridgeheadAtomIds;
  const adjacency = buildAdjacency(layoutGraph, atomIds);
  const paths = [];
  const seenSignatures = new Set();

  function dfs(atomId, visited, path) {
    if (atomId === endAtomId) {
      const signature = path.join('>');
      if (!seenSignatures.has(signature)) {
        seenSignatures.add(signature);
        paths.push([...path]);
      }
      return;
    }
    for (const neighborAtomId of adjacency.get(atomId) ?? []) {
      if (visited.has(neighborAtomId)) {
        continue;
      }
      visited.add(neighborAtomId);
      path.push(neighborAtomId);
      dfs(neighborAtomId, visited, path);
      path.pop();
      visited.delete(neighborAtomId);
    }
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
  const bridgeheadAtomIds = pickBridgeheads(layoutGraph, atomIds);
  if (!bridgeheadAtomIds) {
    return {
      coords: new Map(seedCoords),
      bridgeheadAtomIds: null,
      pathCount: 0
    };
  }

  const oriented = orientBridgedSeed(seedCoords, bridgeheadAtomIds);
  const coords = new Map(oriented.coords);
  const paths = enumerateBridgePaths(layoutGraph, atomIds, bridgeheadAtomIds);
  if (paths.length <= 1) {
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
  const minimumSpan = bondLength * 1.6;
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
    let preferredSide = meanSeedY > 1e-6 ? 1 : meanSeedY < -1e-6 ? -1 : (pathIndex % 2 === 0 ? 1 : -1);
    const oppositeSide = preferredSide === 1 ? -1 : 1;
    if ((sideUsage.get(preferredSide) ?? 0) > (sideUsage.get(oppositeSide) ?? 0) + 1) {
      preferredSide = oppositeSide;
    }
    const side = preferredSide;
    const layer = sideUsage.get(side) ?? 0;
    sideUsage.set(side, layer + 1);

    if (internalCount === 1) {
      const clampedX = clamp(
        meanSeedX,
        (-headDistance / 2) + (bondLength * BRIDGE_PROJECTION_FACTORS.singleAtomClampMarginFactor),
        (headDistance / 2) - (bondLength * BRIDGE_PROJECTION_FACTORS.singleAtomClampMarginFactor)
      );
      const y = side * bondLength * (
        BRIDGE_PROJECTION_FACTORS.singleAtomBaseHeightFactor
        + (layer * BRIDGE_PROJECTION_FACTORS.layerSpacingFactor)
      );
      coords.set(internalAtomIds[0], { x: clampedX, y });
      continue;
    }

    const xBias = clamp(
      (meanSeedX - midpointX) * BRIDGE_PROJECTION_FACTORS.meanSeedBiasFactor,
      -bondLength * BRIDGE_PROJECTION_FACTORS.meanSeedBiasClampFactor,
      bondLength * BRIDGE_PROJECTION_FACTORS.meanSeedBiasClampFactor
    );
    const amplitude = side * bondLength * (
      BRIDGE_PROJECTION_FACTORS.pathArcBaseAmplitudeFactor
      + ((internalCount - 1) * BRIDGE_PROJECTION_FACTORS.meanSeedBiasFactor)
      + (layer * BRIDGE_PROJECTION_FACTORS.layerSpacingFactor)
    );
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

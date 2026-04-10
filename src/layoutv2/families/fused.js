/** @module families/fused */

import { apothemForRegularPolygon } from '../geometry/polygon.js';
import { add, angleOf, centroid, distance, fromAngle, midpoint, normalize, perpLeft, scale, sub, wrapAngle } from '../geometry/vec2.js';
import { computeFusedAxis, orientCoordsHorizontally, rebuildRingCenters } from '../scaffold/orientation.js';
import { placeTemplateCoords } from '../scaffold/template-placement.js';

function traversePath(atomIds, startAtomId, endAtomId, step) {
  const count = atomIds.length;
  let index = atomIds.indexOf(startAtomId);
  const result = [startAtomId];
  while (atomIds[index] !== endAtomId) {
    index = (index + step + count) % count;
    result.push(atomIds[index]);
  }
  return result;
}

function nonSharedPath(atomIds, firstSharedAtomId, secondSharedAtomId) {
  const forward = traversePath(atomIds, firstSharedAtomId, secondSharedAtomId, 1);
  const backward = traversePath(atomIds, firstSharedAtomId, secondSharedAtomId, -1);
  return forward.length >= backward.length ? forward : backward;
}

/**
 * Returns whether the fused ring-adjacency graph contains a cycle.
 * @param {object[]} rings - Ring descriptors.
 * @param {Map<number, number[]>} ringAdj - Ring adjacency map.
 * @returns {boolean} True when the fused system has a re-entrant fused cycle.
 */
function hasFusedAdjacencyCycle(rings, ringAdj) {
  const visited = new Set();

  function visit(ringId, parentRingId) {
    visited.add(ringId);
    for (const neighborRingId of ringAdj.get(ringId) ?? []) {
      if (neighborRingId === parentRingId) {
        continue;
      }
      if (visited.has(neighborRingId)) {
        return true;
      }
      if (visit(neighborRingId, ringId)) {
        return true;
      }
    }
    return false;
  }

  for (const ring of rings) {
    if (visited.has(ring.id)) {
      continue;
    }
    if (visit(ring.id, null)) {
      return true;
    }
  }
  return false;
}

/**
 * Relaxes cyclic constructed fused layouts so multiply shared junction atoms
 * satisfy all of their in-system bond-length constraints simultaneously.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {string[]} ringAtomIds - Atom IDs in the fused system.
 * @param {Map<string, {x: number, y: number}>} inputCoords - Current coordinate map.
 * @param {number} bondLength - Target bond length.
 * @param {object} [options] - Relaxation options.
 * @param {number} [options.iterations] - Maximum relaxation passes.
 * @param {number} [options.damping] - Per-pass damping factor.
 * @returns {Map<string, {x: number, y: number}>} Relaxed coordinates.
 */
function relaxConstructedFusedCoords(layoutGraph, ringAtomIds, inputCoords, bondLength, options = {}) {
  const coords = new Map([...inputCoords.entries()].map(([atomId, position]) => [atomId, { ...position }]));
  const ringAtomIdSet = new Set(ringAtomIds);
  const iterations = options.iterations ?? 25;
  const damping = options.damping ?? 0.5;

  for (let iteration = 0; iteration < iterations; iteration++) {
    const nextPositions = new Map();
    for (const atomId of ringAtomIds) {
      const atom = layoutGraph.atoms.get(atomId);
      const currentPosition = coords.get(atomId);
      if (!atom || atom.element === 'H' || !currentPosition) {
        continue;
      }

      const targets = [];
      for (const bond of layoutGraph.bondsByAtomId.get(atomId) ?? []) {
        if (!bond || bond.kind !== 'covalent') {
          continue;
        }
        const neighborAtomId = bond.a === atomId ? bond.b : bond.a;
        if (!ringAtomIdSet.has(neighborAtomId)) {
          continue;
        }
        const neighborPosition = coords.get(neighborAtomId);
        if (!neighborPosition) {
          continue;
        }
        let dx = currentPosition.x - neighborPosition.x;
        let dy = currentPosition.y - neighborPosition.y;
        const magnitude = Math.hypot(dx, dy);
        if (magnitude <= 1e-12) {
          continue;
        }
        dx /= magnitude;
        dy /= magnitude;
        targets.push({
          x: neighborPosition.x + (dx * bondLength),
          y: neighborPosition.y + (dy * bondLength)
        });
      }

      if (targets.length === 0) {
        continue;
      }
      const averageTarget = targets.reduce((sum, position) => ({
        x: sum.x + position.x,
        y: sum.y + position.y
      }), { x: 0, y: 0 });
      averageTarget.x /= targets.length;
      averageTarget.y /= targets.length;
      nextPositions.set(atomId, {
        x: (currentPosition.x * (1 - damping)) + (averageTarget.x * damping),
        y: (currentPosition.y * (1 - damping)) + (averageTarget.y * damping)
      });
    }

    for (const [atomId, position] of nextPositions) {
      coords.set(atomId, position);
    }
  }

  return coords;
}

/**
 * Places a fused ring system by growing regular polygons across shared edges.
 * @param {object[]} rings - Ring descriptors in the target fused system.
 * @param {Map<number, number[]>} ringAdj - Ring adjacency map.
 * @param {Map<string, object>} ringConnectionByPair - Pair-keyed ring connection map.
 * @param {number} bondLength - Target bond length.
 * @param {{layoutGraph?: object, templateId?: string|null}} [options] - Placement options.
 * @returns {{coords: Map<string, {x: number, y: number}>, ringCenters: Map<number, {x: number, y: number}>}} Placement result.
 */
export function layoutFusedFamily(rings, ringAdj, ringConnectionByPair, bondLength, options = {}) {
  const templateAtomIds = [...new Set(rings.flatMap(ring => ring.atomIds))];
  const templateCoords = options.layoutGraph ? placeTemplateCoords(options.layoutGraph, options.templateId, templateAtomIds, bondLength) : null;
  const coords = new Map();
  const ringCenters = new Map();
  if (rings.length === 0) {
    return { coords, ringCenters, placementMode: 'constructed' };
  }
  if (templateCoords) {
    const templateRingCenters = new Map();
    for (const [atomId, position] of templateCoords) {
      coords.set(atomId, position);
    }
    for (const ring of rings) {
      templateRingCenters.set(ring.id, centroid(ring.atomIds.map(atomId => coords.get(atomId))));
    }
    const orientedCoords = orientCoordsHorizontally(coords, computeFusedAxis(templateRingCenters));
    return {
      coords: orientedCoords,
      ringCenters: rebuildRingCenters(rings, orientedCoords),
      placementMode: 'template'
    };
  }

  const rootRing = rings[0];
  const rootStep = (2 * Math.PI) / rootRing.atomIds.length;
  const rootRadius = bondLength / (2 * Math.sin(Math.PI / rootRing.atomIds.length));
  for (let index = 0; index < rootRing.atomIds.length; index++) {
    coords.set(rootRing.atomIds[index], add({ x: 0, y: 0 }, fromAngle(Math.PI / 2 + (index * rootStep), rootRadius)));
  }
  ringCenters.set(rootRing.id, centroid(rootRing.atomIds.map(atomId => coords.get(atomId))));

  const ringById = new Map(rings.map(ring => [ring.id, ring]));
  const placedRingIds = new Set([rootRing.id]);
  const queue = [rootRing.id];

  while (queue.length > 0) {
    const currentRingId = queue.shift();
    const currentCenter = ringCenters.get(currentRingId);
    for (const neighborRingId of ringAdj.get(currentRingId) ?? []) {
      if (placedRingIds.has(neighborRingId)) {
        continue;
      }
      const connectionKey = currentRingId < neighborRingId ? `${currentRingId}:${neighborRingId}` : `${neighborRingId}:${currentRingId}`;
      const connection = ringConnectionByPair.get(connectionKey);
      if (!connection || connection.kind !== 'fused') {
        continue;
      }
      const neighborRing = ringById.get(neighborRingId);
      const [firstSharedAtomId, secondSharedAtomId] = connection.sharedAtomIds;
      const firstPosition = coords.get(firstSharedAtomId);
      const secondPosition = coords.get(secondSharedAtomId);
      if (!firstPosition || !secondPosition || !currentCenter) {
        continue;
      }

      const edgeMidpoint = midpoint(firstPosition, secondPosition);
      const edgeDirection = normalize(sub(secondPosition, firstPosition));
      let normal = normalize(perpLeft(edgeDirection));
      if (distance(add(edgeMidpoint, normal), currentCenter) < distance(add(edgeMidpoint, scale(normal, -1)), currentCenter)) {
        normal = scale(normal, -1);
      }
      const centerOffset = apothemForRegularPolygon(neighborRing.atomIds.length, bondLength);
      const neighborCenter = add(edgeMidpoint, scale(normal, centerOffset));
      ringCenters.set(neighborRing.id, neighborCenter);

      const path = nonSharedPath(neighborRing.atomIds, firstSharedAtomId, secondSharedAtomId);
      const angleA = angleOf(sub(firstPosition, neighborCenter));
      const angleB = angleOf(sub(secondPosition, neighborCenter));
      const shortDelta = wrapAngle(angleB - angleA);
      const stepSign = shortDelta >= 0 ? -1 : 1;
      const step = stepSign * ((2 * Math.PI) / neighborRing.atomIds.length);

      coords.set(firstSharedAtomId, firstPosition);
      coords.set(secondSharedAtomId, secondPosition);
      for (let index = 1; index < path.length - 1; index++) {
        coords.set(path[index], add(neighborCenter, fromAngle(angleA + (index * step), rootRadiusForSize(neighborRing.atomIds.length, bondLength))));
      }

      placedRingIds.add(neighborRing.id);
      queue.push(neighborRing.id);
    }
  }

  let orientedCoords = orientCoordsHorizontally(coords, computeFusedAxis(ringCenters));
  if (options.layoutGraph && hasFusedAdjacencyCycle(rings, ringAdj)) {
    const relaxedCoords = relaxConstructedFusedCoords(
      options.layoutGraph,
      templateAtomIds,
      orientedCoords,
      bondLength
    );
    orientedCoords = orientCoordsHorizontally(
      relaxedCoords,
      computeFusedAxis(rebuildRingCenters(rings, relaxedCoords))
    );
  }
  return {
    coords: orientedCoords,
    ringCenters: rebuildRingCenters(rings, orientedCoords),
    placementMode: 'constructed'
  };
}

function rootRadiusForSize(size, bondLength) {
  return bondLength / (2 * Math.sin(Math.PI / size));
}

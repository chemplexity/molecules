/** @module families/fused */

import { BRIDGED_KK_LIMITS } from '../constants.js';
import { layoutKamadaKawai } from '../geometry/kk-layout.js';
import { apothemForRegularPolygon } from '../geometry/polygon.js';
import { add, angleOf, centroid, distance, fromAngle, midpoint, normalize, perpLeft, scale, sub, wrapAngle } from '../geometry/vec2.js';
import { computeFusedAxis, orientCoordsHorizontally, rebuildRingCenters } from '../scaffold/orientation.js';
import { nonSharedPath } from '../geometry/ring-path.js';
import { placeTemplateCoords } from '../templates/placement.js';
import { auditLayout } from '../audit/audit.js';
import { assignBondValidationClass } from '../placement/bond-validation.js';

const FUSED_RESCUE_LIMITS = Object.freeze({
  compactCageMaxAtomCount: 20,
  compactCageMinRingCount: 6,
  largeCageMinRingCount: 10,
  kkMaxComponentSize: 128,
  maxRescueOverlapPenalty: 2,
  giantCageMinAtomCount: 48,
  giantCageMinRingCount: 24
});

/**
 * Returns whether a fused system should try the bridged/KK rescue path.
 * Dense fused cages and compact high-ring-count cages often behave more like
 * non-planar polyhedra than planar fused polycycles, so let them compete
 * against the bridged fallback when the planar fused placement is bond-dirty.
 * @param {number} atomCount - Fused-system atom count.
 * @param {number} ringCount - Fused-system ring count.
 * @param {string|null} templateId - Matched template ID.
 * @param {object|null} audit - Fused placement audit.
 * @returns {boolean} True when a bridged rescue should be attempted.
 */
export function shouldTryBridgedRescueForFusedSystem(atomCount, ringCount, templateId, audit) {
  if (templateId || !audit || audit.bondLengthFailureCount <= 0) {
    return false;
  }
  return (
    (atomCount <= FUSED_RESCUE_LIMITS.compactCageMaxAtomCount && ringCount >= FUSED_RESCUE_LIMITS.compactCageMinRingCount)
    || ringCount >= FUSED_RESCUE_LIMITS.largeCageMinRingCount
    || ringCount >= Math.ceil(atomCount / 2)
  );
}

/**
 * Returns whether a giant dense fused cage should skip the planar fused pass
 * and go directly to the atom-graph cage KK construction.
 * @param {number} atomCount - Fused-system atom count.
 * @param {number} ringCount - Fused-system ring count.
 * @param {string|null} templateId - Matched template ID.
 * @returns {boolean} True when the giant cage should use direct KK first.
 */
export function shouldShortCircuitToFusedCageKk(atomCount, ringCount, templateId) {
  if (templateId) {
    return false;
  }
  return (
    atomCount >= FUSED_RESCUE_LIMITS.giantCageMinAtomCount
    && ringCount >= FUSED_RESCUE_LIMITS.giantCageMinRingCount
    && ringCount >= Math.ceil(atomCount / 2)
  );
}

/**
 * Returns whether a bridged rescue placement should replace the fused result.
 * The rescue is bond-first but still refuses candidates that introduce a large
 * overlap spike over the incumbent fused placement.
 * @param {object|null} candidateAudit - Bridged rescue audit.
 * @param {object|null} incumbentAudit - Fused placement audit.
 * @returns {boolean} True when the rescue should win.
 */
export function isBetterBridgedRescueForFusedSystem(candidateAudit, incumbentAudit) {
  if (!candidateAudit || !incumbentAudit) {
    return false;
  }
  if (
    candidateAudit.severeOverlapCount
    > incumbentAudit.severeOverlapCount + FUSED_RESCUE_LIMITS.maxRescueOverlapPenalty
  ) {
    return false;
  }
  if (candidateAudit.bondLengthFailureCount !== incumbentAudit.bondLengthFailureCount) {
    return candidateAudit.bondLengthFailureCount < incumbentAudit.bondLengthFailureCount;
  }
  if (Math.abs(candidateAudit.maxBondLengthDeviation - incumbentAudit.maxBondLengthDeviation) > 1e-9) {
    return candidateAudit.maxBondLengthDeviation < incumbentAudit.maxBondLengthDeviation;
  }
  return candidateAudit.severeOverlapCount < incumbentAudit.severeOverlapCount;
}

function fusedKamadaKawaiSeeds(layoutGraph, atomIds) {
  const coords = new Map();
  const pinnedAtomIds = [];
  if (!layoutGraph) {
    return { coords, pinnedAtomIds };
  }

  for (const atomId of atomIds) {
    const fixedPosition = layoutGraph.fixedCoords.get(atomId);
    if (fixedPosition) {
      coords.set(atomId, { ...fixedPosition });
      pinnedAtomIds.push(atomId);
      continue;
    }
    const existingPosition = layoutGraph.options.existingCoords.get(atomId);
    if (existingPosition) {
      coords.set(atomId, { ...existingPosition });
    }
  }

  return { coords, pinnedAtomIds };
}

function scaleCoordsAboutCentroid(inputCoords, scaleFactor) {
  if (Math.abs(scaleFactor - 1) <= 1e-9) {
    return new Map([...inputCoords.entries()].map(([atomId, position]) => [atomId, { ...position }]));
  }
  const center = centroid([...inputCoords.values()]);
  const coords = new Map();
  for (const [atomId, position] of inputCoords) {
    coords.set(atomId, {
      x: center.x + (position.x - center.x) * scaleFactor,
      y: center.y + (position.y - center.y) * scaleFactor
    });
  }
  return coords;
}

function auditFusedCageCandidate(layoutGraph, atomIds, coords, bondLength) {
  const bondValidationClasses = assignBondValidationClass(layoutGraph, atomIds, 'bridged');
  return auditLayout(layoutGraph, coords, {
    bondLength,
    bondValidationClasses
  });
}

function isBetterFusedCageCandidate(candidateAudit, incumbentAudit) {
  if (!candidateAudit) {
    return false;
  }
  if (!incumbentAudit) {
    return true;
  }
  const bondImprovement = incumbentAudit.bondLengthFailureCount - candidateAudit.bondLengthFailureCount;
  if (bondImprovement > 0) {
    const allowedOverlapIncrease =
      bondImprovement >= 24 ? 16
        : bondImprovement >= 12 ? 10
          : 4;
    if (candidateAudit.severeOverlapCount > incumbentAudit.severeOverlapCount + allowedOverlapIncrease) {
      return false;
    }
    return true;
  }
  if (candidateAudit.severeOverlapCount !== incumbentAudit.severeOverlapCount) {
    return candidateAudit.severeOverlapCount < incumbentAudit.severeOverlapCount;
  }
  if (candidateAudit.bondLengthFailureCount !== incumbentAudit.bondLengthFailureCount) {
    return candidateAudit.bondLengthFailureCount < incumbentAudit.bondLengthFailureCount;
  }
  return candidateAudit.maxBondLengthDeviation < incumbentAudit.maxBondLengthDeviation;
}

/**
 * Places a giant fused cage directly on the atom graph with Kamada-Kawai
 * instead of assuming a planar fused-ring scaffold.
 * @param {object[]} rings - Ring descriptors in the fused system.
 * @param {number} bondLength - Target bond length.
 * @param {{layoutGraph?: object}} [options] - Placement options.
 * @returns {{coords: Map<string, {x: number, y: number}>, ringCenters: Map<number, {x: number, y: number}>, placementMode: string}|null} Placement result.
 */
export function layoutFusedCageKamadaKawai(rings, bondLength, options = {}) {
  if (rings.length === 0 || !options.layoutGraph) {
    return null;
  }

  const atomIdSet = new Set(rings.flatMap(ring => ring.atomIds));
  const atomIds = [...options.layoutGraph.atoms.keys()].filter(atomId => atomIdSet.has(atomId));
  const kkSeeds = fusedKamadaKawaiSeeds(options.layoutGraph, atomIds);
  const kkResult = layoutKamadaKawai(options.layoutGraph.sourceMolecule, atomIds, {
    bondLength,
    coords: kkSeeds.coords,
    pinnedAtomIds: kkSeeds.pinnedAtomIds,
    maxComponentSize: FUSED_RESCUE_LIMITS.kkMaxComponentSize,
    threshold: BRIDGED_KK_LIMITS.threshold,
    innerThreshold: BRIDGED_KK_LIMITS.threshold,
    maxIterations: BRIDGED_KK_LIMITS.largeMaxIterations,
    maxInnerIterations: BRIDGED_KK_LIMITS.largeMaxInnerIterations
  });
  if (kkResult.coords.size !== atomIds.length) {
    return null;
  }

  let bestCoords = orientCoordsHorizontally(
    kkResult.coords,
    computeFusedAxis(rebuildRingCenters(rings, kkResult.coords))
  );
  let bestAudit = auditFusedCageCandidate(options.layoutGraph, atomIds, bestCoords, bondLength);

  const relaxedCoords = relaxConstructedFusedCoords(options.layoutGraph, atomIds, kkResult.coords, bondLength, {
    iterations: 30,
    damping: 0.5
  });
  const regularizedCoords = regularizeConstructedFusedCoords(rings, relaxedCoords, bondLength, {
    iterations: 18,
    damping: 0.45
  });
  for (const scaleFactor of [1, 1.05, 1.1]) {
    const scaledCoords = scaleCoordsAboutCentroid(regularizedCoords, scaleFactor);
    const orientedCoords = orientCoordsHorizontally(
      scaledCoords,
      computeFusedAxis(rebuildRingCenters(rings, scaledCoords))
    );
    const candidateAudit = auditFusedCageCandidate(options.layoutGraph, atomIds, orientedCoords, bondLength);
    if (isBetterFusedCageCandidate(candidateAudit, bestAudit)) {
      bestCoords = orientedCoords;
      bestAudit = candidateAudit;
    }
  }

  const ringCenters = new Map();
  for (const ring of rings) {
    ringCenters.set(ring.id, centroid(ring.atomIds.map(atomId => bestCoords.get(atomId))));
  }
  return {
    coords: bestCoords,
    ringCenters,
    placementMode: 'kamada-kawai-cage'
  };
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
 * Returns the ideal center-to-center distance for two fused rings that share an edge.
 * @param {number} firstRingSize - First ring size.
 * @param {number} secondRingSize - Second ring size.
 * @param {number} bondLength - Target bond length.
 * @returns {number} Ideal fused-ring center separation.
 */
function fusedCenterDistance(firstRingSize, secondRingSize, bondLength) {
  return apothemForRegularPolygon(firstRingSize, bondLength) + apothemForRegularPolygon(secondRingSize, bondLength);
}

/**
 * Selects the central ring for a pericondensed fused system.
 * @param {object[]} rings - Ring descriptors.
 * @param {Map<number, number[]>} ringAdj - Ring adjacency map.
 * @returns {object} Central ring descriptor.
 */
function selectPericondensedCentralRing(rings, ringAdj) {
  return [...rings].sort((firstRing, secondRing) => {
    const degreeDelta = (ringAdj.get(secondRing.id)?.length ?? 0) - (ringAdj.get(firstRing.id)?.length ?? 0);
    if (degreeDelta !== 0) {
      return degreeDelta;
    }
    if (firstRing.size !== secondRing.size) {
      return firstRing.size - secondRing.size;
    }
    return firstRing.id - secondRing.id;
  })[0];
}

/**
 * Returns the next pericondensed shell ring to place.
 * @param {object[]} rings - Ring descriptors.
 * @param {Map<number, number[]>} ringAdj - Ring adjacency map.
 * @param {Set<number>} placedRingIds - Already placed ring IDs.
 * @returns {object|null} Next ring to place or null.
 */
function nextPericondensedShellRing(rings, ringAdj, placedRingIds) {
  const pendingRings = rings.filter(ring => !placedRingIds.has(ring.id));
  if (pendingRings.length === 0) {
    return null;
  }
  return pendingRings.sort((firstRing, secondRing) => {
    const firstPlacedNeighbors = (ringAdj.get(firstRing.id) ?? []).filter(neighborRingId => placedRingIds.has(neighborRingId)).length;
    const secondPlacedNeighbors = (ringAdj.get(secondRing.id) ?? []).filter(neighborRingId => placedRingIds.has(neighborRingId)).length;
    if (secondPlacedNeighbors !== firstPlacedNeighbors) {
      return secondPlacedNeighbors - firstPlacedNeighbors;
    }
    if ((ringAdj.get(secondRing.id)?.length ?? 0) !== (ringAdj.get(firstRing.id)?.length ?? 0)) {
      return (ringAdj.get(secondRing.id)?.length ?? 0) - (ringAdj.get(firstRing.id)?.length ?? 0);
    }
    if (firstRing.size !== secondRing.size) {
      return firstRing.size - secondRing.size;
    }
    return firstRing.id - secondRing.id;
  })[0];
}

/**
 * Estimates a neighboring fused-ring center from one already placed shared edge.
 * @param {object} currentRing - Already placed ring descriptor.
 * @param {object} neighborRing - Neighbor ring descriptor.
 * @param {{sharedAtomIds: string[]}} connection - Fused connection descriptor.
 * @param {Map<number, {x: number, y: number}>} ringCenters - Ring-center map.
 * @param {Map<string, {x: number, y: number}>} coords - Current atom coordinate map.
 * @param {number} bondLength - Target bond length.
 * @returns {{x: number, y: number}|null} Estimated neighbor center.
 */
function estimateNeighborCenter(currentRing, neighborRing, connection, ringCenters, coords, bondLength) {
  const currentCenter = ringCenters.get(currentRing.id);
  const [firstSharedAtomId, secondSharedAtomId] = connection.sharedAtomIds;
  const firstPosition = coords.get(firstSharedAtomId);
  const secondPosition = coords.get(secondSharedAtomId);
  if (!currentCenter || !firstPosition || !secondPosition) {
    return null;
  }

  const edgeMidpoint = midpoint(firstPosition, secondPosition);
  const edgeDirection = normalize(sub(secondPosition, firstPosition));
  let normal = normalize(perpLeft(edgeDirection));
  if (distance(add(edgeMidpoint, normal), currentCenter) < distance(add(edgeMidpoint, scale(normal, -1)), currentCenter)) {
    normal = scale(normal, -1);
  }
  return add(edgeMidpoint, scale(normal, fusedCenterDistance(currentRing.atomIds.length, neighborRing.atomIds.length, bondLength)));
}

/**
 * Places one pericondensed shell ring from the currently available shared edge geometry.
 * @param {object} neighborRing - Ring descriptor being placed.
 * @param {{sharedAtomIds: string[]}} connection - Fused connection descriptor.
 * @param {{x: number, y: number}} neighborCenter - Chosen neighbor-ring center.
 * @param {Map<string, {x: number, y: number}>} coords - Mutable atom coordinate map.
 * @returns {void}
 */
function placePericondensedShellRing(neighborRing, connection, neighborCenter, coords) {
  const [firstSharedAtomId, secondSharedAtomId] = connection.sharedAtomIds;
  const firstPosition = coords.get(firstSharedAtomId);
  const secondPosition = coords.get(secondSharedAtomId);
  if (!firstPosition || !secondPosition) {
    return;
  }

  const path = nonSharedPath(neighborRing.atomIds, firstSharedAtomId, secondSharedAtomId);
  const angleA = angleOf(sub(firstPosition, neighborCenter));
  const angleB = angleOf(sub(secondPosition, neighborCenter));
  const shortDelta = wrapAngle(angleB - angleA);
  const stepSign = shortDelta >= 0 ? -1 : 1;
  const step = stepSign * ((2 * Math.PI) / neighborRing.atomIds.length);
  const radius = rootRadiusForSize(neighborRing.atomIds.length, distance(firstPosition, secondPosition));

  coords.set(firstSharedAtomId, firstPosition);
  coords.set(secondSharedAtomId, secondPosition);
  for (let index = 1; index < path.length - 1; index++) {
    coords.set(path[index], add(neighborCenter, fromAngle(angleA + index * step, radius)));
  }
}

/**
 * Relaxes pericondensed ring centers toward ideal fused center distances.
 * @param {object[]} rings - Ring descriptors.
 * @param {Map<number, number[]>} ringAdj - Ring adjacency map.
 * @param {Map<number, {x: number, y: number}>} inputRingCenters - Current ring centers.
 * @param {number} bondLength - Target bond length.
 * @param {object} [options] - Relaxation options.
 * @param {number} [options.iterations] - Maximum relaxation passes.
 * @param {number} [options.damping] - Per-pass damping factor.
 * @returns {Map<number, {x: number, y: number}>} Relaxed ring-center map.
 */
function relaxPericondensedRingCenters(rings, ringAdj, inputRingCenters, bondLength, options = {}) {
  const ringById = new Map(rings.map(ring => [ring.id, ring]));
  const ringCenters = new Map([...inputRingCenters.entries()].map(([ringId, center]) => [ringId, { ...center }]));
  const iterations = options.iterations ?? 30;
  const damping = options.damping ?? 0.4;

  for (let iteration = 0; iteration < iterations; iteration++) {
    const nextCenters = new Map();
    for (const ring of rings) {
      const currentCenter = ringCenters.get(ring.id);
      if (!currentCenter) {
        continue;
      }

      const targets = [];
      for (const neighborRingId of ringAdj.get(ring.id) ?? []) {
        const neighborCenter = ringCenters.get(neighborRingId);
        const neighborRing = ringById.get(neighborRingId);
        if (!neighborCenter || !neighborRing) {
          continue;
        }
        let direction = sub(currentCenter, neighborCenter);
        if (Math.hypot(direction.x, direction.y) <= 1e-9) {
          direction = fromAngle((2 * Math.PI * (ring.id + 1)) / Math.max(rings.length, 3), 1);
        }
        direction = normalize(direction);
        targets.push(add(neighborCenter, scale(direction, fusedCenterDistance(ring.atomIds.length, neighborRing.atomIds.length, bondLength))));
      }

      if (targets.length === 0) {
        continue;
      }

      const averageTarget = centroid(targets);
      nextCenters.set(ring.id, {
        x: currentCenter.x * (1 - damping) + averageTarget.x * damping,
        y: currentCenter.y * (1 - damping) + averageTarget.y * damping
      });
    }

    for (const [ringId, center] of nextCenters) {
      ringCenters.set(ringId, center);
    }
  }

  return ringCenters;
}

/**
 * Rebuilds pericondensed atom coordinates from relaxed ring centers by averaging
 * ideal regular-polygon target positions for each incident ring.
 * @param {object[]} rings - Ring descriptors.
 * @param {Map<number, {x: number, y: number}>} ringCenters - Ring-center map.
 * @param {Map<string, {x: number, y: number}>} inputCoords - Current atom coordinates.
 * @param {number} bondLength - Target bond length.
 * @returns {Map<string, {x: number, y: number}>} Reconstructed atom coordinates.
 */
function redistributePericondensedAtoms(rings, ringCenters, inputCoords, bondLength) {
  const coords = new Map([...inputCoords.entries()].map(([atomId, position]) => [atomId, { ...position }]));
  const targetSums = new Map();
  const targetCounts = new Map();

  for (const ring of rings) {
    const ringCenter = ringCenters.get(ring.id);
    if (!ringCenter) {
      continue;
    }
    const radius = rootRadiusForSize(ring.atomIds.length, bondLength);
    const currentAngles = ring.atomIds.map(atomId => {
      const position = coords.get(atomId);
      return position ? angleOf(sub(position, ringCenter)) : 0;
    });
    const step = (2 * Math.PI) / ring.atomIds.length;
    let bestTargets = null;
    let bestError = Number.POSITIVE_INFINITY;

    for (const direction of [1, -1]) {
      const offsetVector = currentAngles.reduce(
        (sum, angle, index) => {
          const offset = angle - direction * index * step;
          return {
            x: sum.x + Math.cos(offset),
            y: sum.y + Math.sin(offset)
          };
        },
        { x: 0, y: 0 }
      );
      const baseAngle = Math.atan2(offsetVector.y, offsetVector.x);
      const targets = ring.atomIds.map((atomId, index) => {
        const target = add(ringCenter, fromAngle(baseAngle + direction * index * step, radius));
        const actual = coords.get(atomId);
        const error = actual ? (target.x - actual.x) ** 2 + (target.y - actual.y) ** 2 : 0;
        return { atomId, target, error };
      });
      const totalError = targets.reduce((sum, target) => sum + target.error, 0);
      if (totalError < bestError) {
        bestError = totalError;
        bestTargets = targets;
      }
    }

    for (const { atomId, target } of bestTargets ?? []) {
      const sum = targetSums.get(atomId) ?? { x: 0, y: 0 };
      sum.x += target.x;
      sum.y += target.y;
      targetSums.set(atomId, sum);
      targetCounts.set(atomId, (targetCounts.get(atomId) ?? 0) + 1);
    }
  }

  for (const [atomId, sum] of targetSums) {
    const count = targetCounts.get(atomId) ?? 0;
    if (count > 0) {
      coords.set(atomId, {
        x: sum.x / count,
        y: sum.y / count
      });
    }
  }

  return coords;
}

/**
 * Places a cyclic fused adjacency system by growing rings shell-by-shell from
 * a central ring, then relaxing ring centers and rebuilding ideal polygons.
 * @param {object[]} rings - Ring descriptors in the fused system.
 * @param {Map<number, number[]>} ringAdj - Ring adjacency map.
 * @param {Map<string, object>} ringConnectionByPair - Pair-keyed ring connection map.
 * @param {number} bondLength - Target bond length.
 * @returns {{coords: Map<string, {x: number, y: number}>, ringCenters: Map<number, {x: number, y: number}>, placementMode: string}} Placement result.
 */
function layoutPericondensedSystem(rings, ringAdj, ringConnectionByPair, bondLength) {
  const coords = new Map();
  const ringCenters = new Map();
  const ringById = new Map(rings.map(ring => [ring.id, ring]));
  const rootRing = selectPericondensedCentralRing(rings, ringAdj);
  const rootStep = (2 * Math.PI) / rootRing.atomIds.length;
  const rootRadius = rootRadiusForSize(rootRing.atomIds.length, bondLength);

  for (let index = 0; index < rootRing.atomIds.length; index++) {
    coords.set(rootRing.atomIds[index], fromAngle(Math.PI / 2 + index * rootStep, rootRadius));
  }
  ringCenters.set(rootRing.id, { x: 0, y: 0 });

  const placedRingIds = new Set([rootRing.id]);
  while (placedRingIds.size < rings.length) {
    const nextRing = nextPericondensedShellRing(rings, ringAdj, placedRingIds);
    if (!nextRing) {
      break;
    }
    const placedNeighbors = (ringAdj.get(nextRing.id) ?? [])
      .filter(neighborRingId => placedRingIds.has(neighborRingId))
      .map(neighborRingId => ({
        ring: ringById.get(neighborRingId),
        connection: ringConnectionByPair.get(nextRing.id < neighborRingId ? `${nextRing.id}:${neighborRingId}` : `${neighborRingId}:${nextRing.id}`)
      }))
      .filter(({ ring, connection }) => ring && connection);

    const centerCandidates = placedNeighbors.map(({ ring, connection }) => estimateNeighborCenter(ring, nextRing, connection, ringCenters, coords, bondLength)).filter(Boolean);
    if (centerCandidates.length === 0) {
      break;
    }

    const nextCenter = centroid(centerCandidates);
    ringCenters.set(nextRing.id, nextCenter);
    placePericondensedShellRing(nextRing, placedNeighbors[0].connection, nextCenter, coords);
    placedRingIds.add(nextRing.id);
  }

  const relaxedRingCenters = relaxPericondensedRingCenters(rings, ringAdj, ringCenters, bondLength);
  const reconstructedCoords = redistributePericondensedAtoms(rings, relaxedRingCenters, coords, bondLength);
  const regularizedCoords = regularizeConstructedFusedCoords(rings, reconstructedCoords, bondLength, {
    iterations: 18,
    damping: 0.45
  });
  const orientedCoords = orientCoordsHorizontally(regularizedCoords, computeFusedAxis(rebuildRingCenters(rings, regularizedCoords)));

  return {
    coords: orientedCoords,
    ringCenters: rebuildRingCenters(rings, orientedCoords),
    placementMode: 'pericondensed'
  };
}

/**
 * Fits an ideal regular-polygon target for one placed ring.
 * @param {object} ring - Ring descriptor.
 * @param {Map<string, {x: number, y: number}>} coords - Current coordinate map.
 * @param {number} bondLength - Target bond length.
 * @returns {Map<string, {x: number, y: number}>|null} Ideal target positions, or null when incomplete.
 */
function fitRegularRingTargets(ring, coords, bondLength) {
  const positions = ring.atomIds.map(atomId => coords.get(atomId));
  if (positions.some(position => !position)) {
    return null;
  }

  const center = centroid(positions);
  const step = (2 * Math.PI) / ring.atomIds.length;
  const radius = rootRadiusForSize(ring.atomIds.length, bondLength);
  const actualAngles = positions.map(position => angleOf(sub(position, center)));
  let bestTargets = null;
  let bestError = Number.POSITIVE_INFINITY;

  for (const direction of [1, -1]) {
    const offsetVector = actualAngles.reduce(
      (sum, angle, index) => {
        const offset = angle - direction * index * step;
        return {
          x: sum.x + Math.cos(offset),
          y: sum.y + Math.sin(offset)
        };
      },
      { x: 0, y: 0 }
    );
    const baseAngle = Math.atan2(offsetVector.y, offsetVector.x);
    const targets = new Map();
    let error = 0;

    for (let index = 0; index < ring.atomIds.length; index++) {
      const target = add(center, fromAngle(baseAngle + direction * index * step, radius));
      const actual = positions[index];
      error += (target.x - actual.x) ** 2 + (target.y - actual.y) ** 2;
      targets.set(ring.atomIds[index], target);
    }

    if (error < bestError) {
      bestError = error;
      bestTargets = targets;
    }
  }

  return bestTargets;
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
          x: neighborPosition.x + dx * bondLength,
          y: neighborPosition.y + dy * bondLength
        });
      }

      if (targets.length === 0) {
        continue;
      }
      const averageTarget = targets.reduce(
        (sum, position) => ({
          x: sum.x + position.x,
          y: sum.y + position.y
        }),
        { x: 0, y: 0 }
      );
      averageTarget.x /= targets.length;
      averageTarget.y /= targets.length;
      nextPositions.set(atomId, {
        x: currentPosition.x * (1 - damping) + averageTarget.x * damping,
        y: currentPosition.y * (1 - damping) + averageTarget.y * damping
      });
    }

    for (const [atomId, position] of nextPositions) {
      coords.set(atomId, position);
    }
  }

  return coords;
}

/**
 * Regularizes cyclic fused systems toward ideal constituent ring polygons while
 * preserving the overall constructed fused topology.
 * @param {object[]} rings - Ring descriptors in the fused system.
 * @param {Map<string, {x: number, y: number}>} inputCoords - Current coordinate map.
 * @param {number} bondLength - Target bond length.
 * @param {object} [options] - Regularization options.
 * @param {number} [options.iterations] - Maximum regularization passes.
 * @param {number} [options.damping] - Per-pass damping factor.
 * @returns {Map<string, {x: number, y: number}>} Regularized coordinates.
 */
function regularizeConstructedFusedCoords(rings, inputCoords, bondLength, options = {}) {
  const coords = new Map([...inputCoords.entries()].map(([atomId, position]) => [atomId, { ...position }]));
  const iterations = options.iterations ?? 12;
  const damping = options.damping ?? 0.35;

  for (let iteration = 0; iteration < iterations; iteration++) {
    const targetSums = new Map();
    const targetCounts = new Map();

    for (const ring of rings) {
      const targets = fitRegularRingTargets(ring, coords, bondLength);
      if (!targets) {
        continue;
      }
      for (const [atomId, position] of targets) {
        const sum = targetSums.get(atomId) ?? { x: 0, y: 0 };
        sum.x += position.x;
        sum.y += position.y;
        targetSums.set(atomId, sum);
        targetCounts.set(atomId, (targetCounts.get(atomId) ?? 0) + 1);
      }
    }

    for (const [atomId, sum] of targetSums) {
      const count = targetCounts.get(atomId) ?? 0;
      const current = coords.get(atomId);
      if (!current || count <= 0) {
        continue;
      }
      const target = {
        x: sum.x / count,
        y: sum.y / count
      };
      coords.set(atomId, {
        x: current.x * (1 - damping) + target.x * damping,
        y: current.y * (1 - damping) + target.y * damping
      });
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
  if (hasFusedAdjacencyCycle(rings, ringAdj)) {
    return layoutPericondensedSystem(rings, ringAdj, ringConnectionByPair, bondLength);
  }

  const rootRing = rings[0];
  const rootStep = (2 * Math.PI) / rootRing.atomIds.length;
  const rootRadius = bondLength / (2 * Math.sin(Math.PI / rootRing.atomIds.length));
  for (let index = 0; index < rootRing.atomIds.length; index++) {
    coords.set(rootRing.atomIds[index], add({ x: 0, y: 0 }, fromAngle(Math.PI / 2 + index * rootStep, rootRadius)));
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
        coords.set(path[index], add(neighborCenter, fromAngle(angleA + index * step, rootRadiusForSize(neighborRing.atomIds.length, bondLength))));
      }

      placedRingIds.add(neighborRing.id);
      queue.push(neighborRing.id);
    }
  }

  let orientedCoords = orientCoordsHorizontally(coords, computeFusedAxis(ringCenters));
  if (options.layoutGraph) {
    const relaxedCoords = relaxConstructedFusedCoords(options.layoutGraph, templateAtomIds, orientedCoords, bondLength);
    const regularizedCoords = regularizeConstructedFusedCoords(rings, relaxedCoords, bondLength);
    orientedCoords = orientCoordsHorizontally(regularizedCoords, computeFusedAxis(rebuildRingCenters(rings, regularizedCoords)));
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

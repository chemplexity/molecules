/** @module families/macrocycle */

import { add, angleOf, centroid, distance, fromAngle, midpoint, normalize, perpLeft, rotate, scale, sub, vec, wrapAngle } from '../geometry/vec2.js';
import { apothemForRegularPolygon } from '../geometry/polygon.js';
import { ellipsePerimeterPoints, macrocycleAspectRatio, solveEllipseScale } from '../geometry/ellipse.js';
import { placeTemplateCoords } from '../templates/placement.js';
import { ringConnectionKey } from '../model/ring-connection.js';

/**
 * Rebuilds ring centers from already placed ring coordinates.
 * @param {object[]} rings - Ring descriptors in the target system.
 * @param {Map<string, {x: number, y: number}>} coords - Placed atom coordinates.
 * @returns {Map<number, {x: number, y: number}>} Ring centers keyed by ring ID.
 */
function buildRingCentersFromCoords(rings, coords) {
  const ringCenters = new Map();
  for (const ring of rings) {
    const ringPoints = ring.atomIds.map(atomId => coords.get(atomId)).filter(Boolean);
    if (ringPoints.length === ring.atomIds.length) {
      ringCenters.set(ring.id, centroid(ringPoints));
    }
  }
  return ringCenters;
}

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
 * Normalizes an angle into the signed `(-pi, pi]` range.
 * @param {number} angle - Input angle in radians.
 * @returns {number} Wrapped signed angle.
 */
function normalizeSignedAngle(angle) {
  let wrappedAngle = angle;
  while (wrappedAngle > Math.PI) {
    wrappedAngle -= 2 * Math.PI;
  }
  while (wrappedAngle <= -Math.PI) {
    wrappedAngle += 2 * Math.PI;
  }
  return wrappedAngle;
}

/**
 * Returns whether a ring atom carries a visible heavy non-ring substituent.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {string} atomId - Ring atom ID.
 * @param {Set<string>} participantAtomIds - Visible component atom IDs.
 * @param {Set<string>} ringAtomIds - Ring atom IDs.
 * @returns {boolean} True when the ring atom has a visible heavy exocyclic branch.
 */
function hasVisibleHeavyBranch(layoutGraph, atomId, participantAtomIds, ringAtomIds) {
  const atom = layoutGraph.sourceMolecule.atoms.get(atomId);
  if (!atom) {
    return false;
  }
  return atom
    .getNeighbors(layoutGraph.sourceMolecule)
    .some(neighborAtom => neighborAtom && neighborAtom.name !== 'H' && participantAtomIds.has(neighborAtom.id) && !ringAtomIds.has(neighborAtom.id));
}

/**
 * Groups consecutive branch-bearing macrocycle atoms into cyclic runs.
 * @param {string[]} ringAtomIds - Macrocycle ring atom IDs in perimeter order.
 * @param {Set<string>} branchBearingAtomIds - Branch-bearing ring atom IDs.
 * @returns {string[][]} Consecutive branch-bearing runs in ring order.
 */
function branchBearingRuns(ringAtomIds, branchBearingAtomIds) {
  if (branchBearingAtomIds.size === 0) {
    return [];
  }

  const ringSize = ringAtomIds.length;
  const startIndex = ringAtomIds.findIndex((atomId, index) => branchBearingAtomIds.has(atomId) && !branchBearingAtomIds.has(ringAtomIds[(index - 1 + ringSize) % ringSize]));
  const orderedStartIndex = startIndex >= 0 ? startIndex : ringAtomIds.findIndex(atomId => branchBearingAtomIds.has(atomId));
  if (orderedStartIndex < 0) {
    return [];
  }

  const runs = [];
  let currentRun = [];
  for (let offset = 0; offset < ringSize; offset++) {
    const atomId = ringAtomIds[(orderedStartIndex + offset) % ringSize];
    if (branchBearingAtomIds.has(atomId)) {
      currentRun.push(atomId);
      continue;
    }
    if (currentRun.length > 0) {
      runs.push(currentRun);
      currentRun = [];
    }
  }
  if (currentRun.length > 0) {
    runs.push(currentRun);
  }

  return runs;
}

/**
 * Chooses the preferred side of the outward macrocycle budget for each branch-bearing atom.
 * Dense consecutive branch runs alternate preferred sides so adjacent substituents do not collapse onto the same exterior ray.
 * @param {string[]} ringAtomIds - Macrocycle ring atom IDs in perimeter order.
 * @param {Set<string>} branchBearingAtomIds - Branch-bearing ring atom IDs.
 * @returns {Map<string, 'previous'|'next'|null>} Preferred budget side per branch-bearing atom.
 */
function preferredBudgetSides(ringAtomIds, branchBearingAtomIds) {
  const sideByAtomId = new Map();
  const runs = branchBearingRuns(ringAtomIds, branchBearingAtomIds);
  const ringSize = ringAtomIds.length;

  for (const run of runs) {
    if (run.length === 1) {
      const atomId = run[0];
      const atomIndex = ringAtomIds.indexOf(atomId);
      const previousAtomId = ringAtomIds[(atomIndex - 1 + ringSize) % ringSize];
      const nextAtomId = ringAtomIds[(atomIndex + 1) % ringSize];
      const previousHasBranch = branchBearingAtomIds.has(previousAtomId);
      const nextHasBranch = branchBearingAtomIds.has(nextAtomId);
      if (previousHasBranch && !nextHasBranch) {
        sideByAtomId.set(atomId, 'next');
      } else if (nextHasBranch && !previousHasBranch) {
        sideByAtomId.set(atomId, 'previous');
      } else {
        sideByAtomId.set(atomId, null);
      }
      continue;
    }

    for (let index = 0; index < run.length; index++) {
      sideByAtomId.set(run[index], index % 2 === 0 ? 'previous' : 'next');
    }
  }

  return sideByAtomId;
}

/**
 * Computes outward branch-angle budgets for atoms on the primary macrocycle ring.
 * Each budget is the exterior arc centered on the ring-outward direction, with
 * dense adjacent branch sites shrinking the available side of the arc and
 * contributing a side preference when adjacent substituents should fan apart.
 * @param {object[]} rings - Ring descriptors in the macrocycle system.
 * @param {Map<string, {x: number, y: number}>} coords - Placed ring coordinates.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Set<string>} participantAtomIds - Visible component atom IDs.
 * @returns {Map<string, {centerAngle: number, minOffset: number, maxOffset: number, preferredAngle: number}>} Macrocycle branch-angle budgets by anchor atom ID.
 */
export function computeMacrocycleAngularBudgets(rings, coords, layoutGraph, participantAtomIds) {
  const primaryRing = [...rings].sort((firstRing, secondRing) => secondRing.size - firstRing.size || firstRing.id - secondRing.id)[0];
  if (!primaryRing || primaryRing.size < 12) {
    return new Map();
  }

  const ringPositions = primaryRing.atomIds.map(atomId => coords.get(atomId)).filter(Boolean);
  if (ringPositions.length !== primaryRing.atomIds.length) {
    return new Map();
  }

  const ringCenter = centroid(ringPositions);
  const ringAtomIds = new Set(primaryRing.atomIds);
  const budgets = new Map();
  const branchBearingAtomIds = new Set(primaryRing.atomIds.filter(atomId => hasVisibleHeavyBranch(layoutGraph, atomId, participantAtomIds, ringAtomIds)));
  const preferredSides = preferredBudgetSides(primaryRing.atomIds, branchBearingAtomIds);

  for (let index = 0; index < primaryRing.atomIds.length; index++) {
    const atomId = primaryRing.atomIds[index];
    if (!branchBearingAtomIds.has(atomId)) {
      continue;
    }
    const atomPosition = coords.get(atomId);
    const previousAtomId = primaryRing.atomIds[(index - 1 + primaryRing.atomIds.length) % primaryRing.atomIds.length];
    const nextAtomId = primaryRing.atomIds[(index + 1) % primaryRing.atomIds.length];
    const previousAngle = angleOf(sub(coords.get(previousAtomId), atomPosition));
    const nextAngle = angleOf(sub(coords.get(nextAtomId), atomPosition));
    const outwardAngle = angleOf(sub(atomPosition, ringCenter));
    let previousBoundaryOffset = normalizeSignedAngle(previousAngle - outwardAngle) / 2;
    let nextBoundaryOffset = normalizeSignedAngle(nextAngle - outwardAngle) / 2;

    if (branchBearingAtomIds.has(previousAtomId)) {
      previousBoundaryOffset *= 0.5;
    }
    if (branchBearingAtomIds.has(nextAtomId)) {
      nextBoundaryOffset *= 0.5;
    }
    const preferredSide = preferredSides.get(atomId) ?? null;
    const preferredOffset = preferredSide === 'previous' ? previousBoundaryOffset / 2 : preferredSide === 'next' ? nextBoundaryOffset / 2 : 0;

    budgets.set(atomId, {
      centerAngle: outwardAngle,
      minOffset: Math.min(previousBoundaryOffset, nextBoundaryOffset),
      maxOffset: Math.max(previousBoundaryOffset, nextBoundaryOffset),
      preferredAngle: wrapAngle(outwardAngle + preferredOffset)
    });
  }

  return budgets;
}

/**
 * Computes the circumcenter of three points.
 * @param {{x: number, y: number}} p0 - First point.
 * @param {{x: number, y: number}} p1 - Second point.
 * @param {{x: number, y: number}} p2 - Third point.
 * @returns {{x: number, y: number}|null} Circumcenter, or null if points are collinear.
 */
function circumcenterOf3(p0, p1, p2) {
  const ax = p1.x - p0.x;
  const ay = p1.y - p0.y;
  const bx = p2.x - p0.x;
  const by = p2.y - p0.y;
  const D = 2 * (ax * by - ay * bx);
  if (Math.abs(D) < 1e-10) {
    return null;
  }
  const m0 = ax * ax + ay * ay;
  const m1 = bx * bx + by * by;
  return {
    x: (by * m0 - ay * m1) / D + p0.x,
    y: (ax * m1 - bx * m0) / D + p0.y
  };
}

/**
 * Fits a fixed-radius regular polygon to the already placed atoms of a ring and
 * returns predicted coordinates for every atom in ring order.
 * This is more stable than a raw circumcenter fit when only 1-2 atoms remain
 * unplaced or when overlapping macrocycles have already distorted the shared anchors.
 * @param {object} ring - Ring descriptor.
 * @param {Map<string, {x: number, y: number}>} coords - Existing atom coordinates.
 * @param {number} radius - Target circumradius for the ring.
 * @returns {{predicted: Map<string, {x: number, y: number}>, score: number}|null} Best-fit prediction or null when insufficient anchors exist.
 */
function fitRegularPolygonToPlacedAtoms(ring, coords, radius) {
  const placed = ring.atomIds.flatMap((atomId, index) => {
    const point = coords.get(atomId);
    return point ? [{ atomId, index, point }] : [];
  });
  if (placed.length < 3) {
    return null;
  }

  const observedCentroid = centroid(placed.map(entry => entry.point));
  let best = null;
  const angleStep = (2 * Math.PI) / ring.atomIds.length;

  for (const rotationSign of [1, -1]) {
    const templateEntries = placed.map(entry => ({
      ...entry,
      templatePoint: fromAngle(rotationSign * entry.index * angleStep, radius)
    }));
    const templateCentroid = centroid(templateEntries.map(entry => entry.templatePoint));
    let dot = 0;
    let cross = 0;
    for (const entry of templateEntries) {
      const templateOffset = sub(entry.templatePoint, templateCentroid);
      const observedOffset = sub(entry.point, observedCentroid);
      dot += templateOffset.x * observedOffset.x + templateOffset.y * observedOffset.y;
      cross += templateOffset.x * observedOffset.y - templateOffset.y * observedOffset.x;
    }

    const rotation = Math.atan2(cross, dot);
    const predicted = new Map();
    for (let index = 0; index < ring.atomIds.length; index++) {
      const templatePoint = fromAngle(rotationSign * index * angleStep, radius);
      predicted.set(
        ring.atomIds[index],
        add(observedCentroid, rotate(sub(templatePoint, templateCentroid), rotation))
      );
    }

    let score = 0;
    for (const entry of placed) {
      const guess = predicted.get(entry.atomId);
      const dx = guess.x - entry.point.x;
      const dy = guess.y - entry.point.y;
      score += dx * dx + dy * dy;
    }

    if (!best || score < best.score) {
      best = { predicted, score };
    }
  }

  return best;
}

/**
 * Grows secondary fused rings outward from a macrocycle using shared-edge projection.
 * Handles connections with exactly 2 shared atoms using the same algorithm as layoutFusedFamily.
 * @param {object[]} rings - All ring descriptors in the ring system.
 * @param {object} primaryRing - The primary macrocycle ring.
 * @param {Map<string, {x: number, y: number}>} coords - Coordinate map to extend (mutated in place).
 * @param {number} bondLength - Target bond length.
 * @param {object} layoutGraph - Layout graph shell.
 */
function growFusedRingsFromMacrocycle(rings, primaryRing, coords, bondLength, layoutGraph) {
  const ringById = new Map(rings.map(ring => [ring.id, ring]));
  const systemRingIds = new Set(rings.map(ring => ring.id));
  const systemConnections = layoutGraph.ringConnections.filter(conn => systemRingIds.has(conn.firstRingId) && systemRingIds.has(conn.secondRingId));

  const ringAdj = new Map(rings.map(ring => [ring.id, []]));
  const connectionByPair = new Map();
  for (const conn of systemConnections) {
    ringAdj.get(conn.firstRingId)?.push(conn.secondRingId);
    ringAdj.get(conn.secondRingId)?.push(conn.firstRingId);
    connectionByPair.set(ringConnectionKey(conn.firstRingId, conn.secondRingId), conn);
  }

  // Initialize from all rings that are already fully placed in coords (not just the primary ring),
  // so a second call after growRemainingRingAtoms can reach fused neighbors of circumcircle-placed rings.
  const ringCenters = new Map();
  const placedRingIds = new Set();
  const queue = [];
  for (const ring of rings) {
    const points = ring.atomIds.map(id => coords.get(id)).filter(Boolean);
    if (points.length === ring.atomIds.length) {
      placedRingIds.add(ring.id);
      ringCenters.set(ring.id, centroid(points));
      queue.push(ring.id);
    }
  }
  if (!placedRingIds.has(primaryRing.id)) {
    const primaryPoints = primaryRing.atomIds.map(id => coords.get(id)).filter(Boolean);
    const primaryCenter = primaryPoints.length > 0 ? centroid(primaryPoints) : { x: 0, y: 0 };
    ringCenters.set(primaryRing.id, primaryCenter);
    placedRingIds.add(primaryRing.id);
    queue.push(primaryRing.id);
  }

  while (queue.length > 0) {
    const currentRingId = queue.shift();
    const currentCenter = ringCenters.get(currentRingId);

    for (const neighborRingId of ringAdj.get(currentRingId) ?? []) {
      if (placedRingIds.has(neighborRingId)) {
        continue;
      }
      const conn = connectionByPair.get(ringConnectionKey(currentRingId, neighborRingId));
      if (!conn || conn.sharedAtomIds.length !== 2) {
        continue;
      }
      const neighborRing = ringById.get(neighborRingId);
      const [firstSharedAtomId, secondSharedAtomId] = conn.sharedAtomIds;
      const firstPosition = coords.get(firstSharedAtomId);
      const secondPosition = coords.get(secondSharedAtomId);
      if (!firstPosition || !secondPosition || !currentCenter) {
        continue;
      }

      const edgeMidpt = midpoint(firstPosition, secondPosition);
      const edgeDir = normalize(sub(secondPosition, firstPosition));
      let normal = normalize(perpLeft(edgeDir));
      if (distance(add(edgeMidpt, normal), currentCenter) < distance(add(edgeMidpt, scale(normal, -1)), currentCenter)) {
        normal = scale(normal, -1);
      }

      const centerOffset = apothemForRegularPolygon(neighborRing.atomIds.length, bondLength);
      const neighborCenter = add(edgeMidpt, scale(normal, centerOffset));
      ringCenters.set(neighborRingId, neighborCenter);

      const radius = bondLength / (2 * Math.sin(Math.PI / neighborRing.atomIds.length));
      const path = nonSharedPath(neighborRing.atomIds, firstSharedAtomId, secondSharedAtomId);
      const angleA = angleOf(sub(firstPosition, neighborCenter));
      const angleB = angleOf(sub(secondPosition, neighborCenter));
      const shortDelta = wrapAngle(angleB - angleA);
      const stepSign = shortDelta >= 0 ? -1 : 1;
      const step = stepSign * ((2 * Math.PI) / neighborRing.atomIds.length);

      for (let index = 1; index < path.length - 1; index++) {
        if (!coords.has(path[index])) {
          coords.set(path[index], add(neighborCenter, fromAngle(angleA + index * step, radius)));
        }
      }

      placedRingIds.add(neighborRingId);
      queue.push(neighborRingId);
    }
  }
}

/**
 * Completes any ring that has at least 3 placed atoms by fitting a fixed-radius
 * regular polygon to the anchors and placing the remaining atoms at the expected
 * angular positions. Falls back to a circumcenter estimate for lightly anchored rings.
 * Iterates until no further progress is made.
 * @param {object[]} rings - All ring descriptors in the ring system.
 * @param {Map<string, {x: number, y: number}>} coords - Coordinate map to extend (mutated in place).
 * @param {number} bondLength - Target bond length.
 */
function growRemainingRingAtoms(rings, coords, bondLength) {
  let progressed = true;
  while (progressed) {
    progressed = false;
    for (const ring of rings) {
      const n = ring.atomIds.length;
      const unplacedIds = ring.atomIds.filter(id => !coords.has(id));
      if (unplacedIds.length === 0) {
        continue;
      }
      const placedIds = ring.atomIds.filter(id => coords.has(id));
      if (placedIds.length < 3) {
        continue;
      }

      // Fit circumcircle from 3 spread-out placed atoms for best accuracy
      let center = null;
      for (let i = 0; i < placedIds.length - 2 && !center; i++) {
        center = circumcenterOf3(coords.get(placedIds[i]), coords.get(placedIds[i + 1]), coords.get(placedIds[i + 2]));
      }
      if (!center) {
        center = centroid(placedIds.map(id => coords.get(id)));
      }

      const radius = bondLength / (2 * Math.sin(Math.PI / n));

      if (unplacedIds.length <= 2 || placedIds.length >= 4) {
        const fitted = fitRegularPolygonToPlacedAtoms(ring, coords, radius);
        if (fitted) {
          for (const atomId of unplacedIds) {
            coords.set(atomId, fitted.predicted.get(atomId));
            progressed = true;
          }
          continue;
        }
      }

      const step = (2 * Math.PI) / n;
      const firstPlacedIdx = ring.atomIds.findIndex(id => coords.has(id));
      const firstAngle = angleOf(sub(coords.get(ring.atomIds[firstPlacedIdx]), center));

      // Determine rotation direction from the first 2 placed atoms
      let rotSign = 1;
      for (let offset = 1; offset < n; offset++) {
        const checkIdx = (firstPlacedIdx + offset) % n;
        if (!coords.has(ring.atomIds[checkIdx])) {
          continue;
        }
        const actual = angleOf(sub(coords.get(ring.atomIds[checkIdx]), center));
        const diffFwd = Math.abs(wrapAngle(actual - wrapAngle(firstAngle + offset * step)));
        const diffBwd = Math.abs(wrapAngle(actual - wrapAngle(firstAngle - offset * step)));
        rotSign = diffFwd <= diffBwd ? 1 : -1;
        break;
      }

      for (const atomId of unplacedIds) {
        const index = ring.atomIds.indexOf(atomId);
        const offset = index - firstPlacedIdx;
        coords.set(atomId, add(center, fromAngle(wrapAngle(firstAngle + rotSign * offset * step), radius)));
        progressed = true;
      }
    }
  }
}

/**
 * Places a macrocycle on a horizontally stretched ellipse with bond lengths
 * scaled to the target average edge length.
 * @param {object[]} rings - Ring descriptors in the macrocycle system.
 * @param {number} bondLength - Target bond length.
 * @param {{center?: {x: number, y: number}, layoutGraph?: object, templateId?: string|null}} [options] - Placement options.
 * @returns {{coords: Map<string, {x: number, y: number}>, ringCenters: Map<number, {x: number, y: number}>, placementMode: string}|null} Placement result.
 */
export function layoutMacrocycleFamily(rings, bondLength, options = {}) {
  const primaryRing = [...rings].sort((firstRing, secondRing) => secondRing.size - firstRing.size || firstRing.id - secondRing.id)[0];
  if (!primaryRing || primaryRing.size < 12) {
    return null;
  }

  const templateAtomIds = [...new Set(rings.flatMap(ring => ring.atomIds))];
  const templateCoords = options.layoutGraph ? placeTemplateCoords(options.layoutGraph, options.templateId, templateAtomIds, bondLength) : null;
  if (templateCoords) {
    return {
      coords: templateCoords,
      ringCenters: buildRingCentersFromCoords(rings, templateCoords),
      placementMode: 'template'
    };
  }

  const center = options.center ?? vec(0, 0);
  const startAngle = Math.PI / 2;
  const aspectRatio = macrocycleAspectRatio(primaryRing.size);
  const baseScale = solveEllipseScale(primaryRing.size, bondLength, aspectRatio, startAngle);
  const semiMajor = baseScale * aspectRatio;
  const semiMinor = baseScale / aspectRatio;
  const coords = new Map();
  const perimeterPoints = ellipsePerimeterPoints(center, primaryRing.atomIds.length, semiMajor, semiMinor, startAngle);

  for (let index = 0; index < primaryRing.atomIds.length; index++) {
    coords.set(primaryRing.atomIds[index], perimeterPoints[index]);
  }

  if (rings.length > 1 && options.layoutGraph) {
    // Alternate fused-edge projection (2-atom connections) and partial-ring completion (3+ shared atoms)
    // until no further progress. A second fused pass catches rings reachable only after regular-polygon
    // completion has placed their bridging neighbors.
    let prevSize;
    do {
      prevSize = coords.size;
      growFusedRingsFromMacrocycle(rings, primaryRing, coords, bondLength, options.layoutGraph);
      growRemainingRingAtoms(rings, coords, bondLength);
    } while (coords.size > prevSize);
  }

  return {
    coords,
    ringCenters: buildRingCentersFromCoords(rings, coords),
    placementMode: 'ellipse'
  };
}

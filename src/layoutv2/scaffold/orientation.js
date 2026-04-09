/** @module scaffold/orientation */

import { centroid, rotate, sub } from '../geometry/vec2.js';

function covarianceAxis(points) {
  if (points.length < 2) {
    return 0;
  }
  const center = centroid(points);
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (const point of points) {
    const dx = point.x - center.x;
    const dy = point.y - center.y;
    sxx += dx * dx;
    syy += dy * dy;
    sxy += dx * dy;
  }
  if (Math.abs(sxy) <= 1e-12 && Math.abs(sxx - syy) <= 1e-12) {
    return 0;
  }
  return 0.5 * Math.atan2(2 * sxy, sxx - syy);
}

/**
 * Computes the principal fused-system axis from ring centers.
 * @param {Map<number, {x: number, y: number}>} ringCenters - Ring-center map.
 * @returns {number} Principal axis angle in radians.
 */
export function computeFusedAxis(ringCenters) {
  return covarianceAxis([...ringCenters.values()]);
}

/**
 * Rotates coordinates around their centroid so the supplied axis becomes horizontal.
 * @param {Map<string, {x: number, y: number}>} coords - Coordinate map.
 * @param {number} axisAngle - Current axis angle in radians.
 * @returns {Map<string, {x: number, y: number}>} Reoriented coordinates.
 */
export function orientCoordsHorizontally(coords, axisAngle) {
  const center = centroid([...coords.values()]);
  const rotated = new Map();
  for (const [atomId, position] of coords) {
    rotated.set(atomId, {
      ...rotate(sub(position, center), -axisAngle)
    });
  }
  return rotated;
}

/**
 * Recomputes ring centers from the provided coordinates.
 * @param {object[]} rings - Ring descriptors.
 * @param {Map<string, {x: number, y: number}>} coords - Coordinate map.
 * @returns {Map<number, {x: number, y: number}>} Updated ring-center map.
 */
export function rebuildRingCenters(rings, coords) {
  const ringCenters = new Map();
  for (const ring of rings) {
    ringCenters.set(ring.id, centroid(ring.atomIds.map(atomId => coords.get(atomId)).filter(Boolean)));
  }
  return ringCenters;
}

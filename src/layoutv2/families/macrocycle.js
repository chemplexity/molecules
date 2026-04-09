/** @module families/macrocycle */

import { centroid, vec } from '../geometry/vec2.js';
import { ellipsePoint, macrocycleAspectRatio, solveEllipseScale } from '../geometry/ellipse.js';

/**
 * Places a macrocycle on a horizontally stretched ellipse with bond lengths
 * scaled to the target average edge length.
 * @param {object[]} rings - Ring descriptors in the macrocycle system.
 * @param {number} bondLength - Target bond length.
 * @param {{center?: {x: number, y: number}}} [options] - Placement options.
 * @returns {{coords: Map<string, {x: number, y: number}>, ringCenters: Map<number, {x: number, y: number}>, placementMode: string}|null} Placement result.
 */
export function layoutMacrocycleFamily(rings, bondLength, options = {}) {
  const primaryRing = [...rings].sort((firstRing, secondRing) => secondRing.size - firstRing.size || firstRing.id - secondRing.id)[0];
  if (!primaryRing || primaryRing.size < 12) {
    return null;
  }

  const center = options.center ?? vec(0, 0);
  const startAngle = Math.PI / 2;
  const aspectRatio = macrocycleAspectRatio(primaryRing.size);
  const baseScale = solveEllipseScale(primaryRing.size, bondLength, aspectRatio, startAngle);
  const semiMajor = baseScale * aspectRatio;
  const semiMinor = baseScale / aspectRatio;
  const step = (2 * Math.PI) / primaryRing.atomIds.length;
  const coords = new Map();

  for (let index = 0; index < primaryRing.atomIds.length; index++) {
    coords.set(
      primaryRing.atomIds[index],
      ellipsePoint(center, semiMajor, semiMinor, startAngle + (index * step))
    );
  }

  const ringCenters = new Map();
  for (const ring of rings) {
    const ringPoints = ring.atomIds.map(atomId => coords.get(atomId)).filter(Boolean);
    if (ringPoints.length === ring.atomIds.length) {
      ringCenters.set(ring.id, centroid(ringPoints));
    }
  }

  return {
    coords,
    ringCenters,
    placementMode: 'ellipse'
  };
}

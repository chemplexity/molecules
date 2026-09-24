/** @module geometry/constrained-ring */

import { alignCoordsToFixed, reflectAcrossLine } from './transforms.js';
import { auditLayout } from '../audit/audit.js';

/**
 * Places a partially anchored isolated ring using bounded distance projection.
 * Fixed positions seed the solve and are never moved; only free endpoints absorb
 * bond corrections. Two mirrored starts and both sweep orders reduce foldovers.
 * Infeasible constraints remain explicit in the returned geometry and audit.
 * @param {object} layoutGraph - Layout graph with fixed-coordinate options.
 * @param {object} ring - Ring descriptor in perimeter order.
 * @param {Map<string, {x: number, y: number}>} seed - Unconstrained ring seed.
 * @param {number} bondLength - Requested bond length.
 * @returns {Map<string, {x: number, y: number}>|null} Constrained ring, or null when inapplicable.
 */
export function placeConstrainedRing(layoutGraph, ring, seed, bondLength) {
  if (!layoutGraph || layoutGraph.options.preserveFixed === false) {
    return null;
  }
  const ids = ring.atomIds;
  const fixedIds = ids.filter(id => layoutGraph.fixedCoords.has(id));
  if (fixedIds.length < 3) {
    return null;
  }
  const fixed = new Set(fixedIds);
  const aligned = alignCoordsToFixed(seed, ids, layoutGraph.fixedCoords).coords;
  const first = layoutGraph.fixedCoords.get(fixedIds[0]);
  const second = layoutGraph.fixedCoords.get(fixedIds[1]);
  let best = null;
  let bestScore = null;
  for (const mirror of [false, true]) {
    for (const reverse of [false, true]) {
      const coords = new Map(ids.map(id => {
        const position = fixed.has(id) ? layoutGraph.fixedCoords.get(id) : mirror ? reflectAcrossLine(aligned.get(id), first, second) : aligned.get(id);
        return [id, { ...position }];
      }));
      for (let iteration = 0; iteration < 512; iteration++) {
        let maxCorrection = 0;
        for (let step = 0; step < ids.length; step++) {
          const index = reverse ? ids.length - 1 - step : step;
          const aId = ids[index];
          const bId = ids[(index + 1) % ids.length];
          const a = coords.get(aId);
          const b = coords.get(bId);
          const movable = Number(!fixed.has(aId)) + Number(!fixed.has(bId));
          if (movable === 0) {
            continue;
          }
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const distance = Math.hypot(dx, dy);
          const correction = (distance - bondLength) / movable;
          const ux = distance > 1e-12 ? dx / distance : Math.cos((index * 2 * Math.PI) / ids.length);
          const uy = distance > 1e-12 ? dy / distance : Math.sin((index * 2 * Math.PI) / ids.length);
          if (!fixed.has(aId)) {
            a.x += ux * correction;
            a.y += uy * correction;
          }
          if (!fixed.has(bId)) {
            b.x -= ux * correction;
            b.y -= uy * correction;
          }
          maxCorrection = Math.max(maxCorrection, Math.abs(correction));
        }
        if (maxCorrection <= bondLength * 1e-10) {
          break;
        }
      }
      const audit = auditLayout(layoutGraph, coords, { bondLength });
      const score = [audit.severeOverlapCount, audit.visibleHeavyBondCrossingFailureCount, audit.bondLengthFailureCount, audit.maxBondLengthDeviation];
      const difference = bestScore ? score.findIndex((value, index) => value !== bestScore[index]) : -1;
      if (!bestScore || (difference >= 0 && score[difference] < bestScore[difference])) {
        best = coords;
        bestScore = score;
      }
    }
  }
  return best;
}

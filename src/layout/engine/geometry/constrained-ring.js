/** @module geometry/constrained-ring */

import { alignCoordsToFixed, reflectAcrossLine } from './transforms.js';
import { auditLayout } from '../audit/audit.js';

/**
 * Seeds the two free ring paths as equal-edge circular arcs on opposite sides
 * of the anchor chord, avoiding global scaling of a large ring to a short chord.
 * @param {string[]} ids - Ring perimeter order.
 * @param {string[]} fixedIds - Two anchor IDs.
 * @param {Map<string, {x: number, y: number}>} fixedCoords - Anchor coordinates.
 * @param {number} bondLength - Edge length.
 * @returns {Map<string, {x: number, y: number}>|null} Feasible arc seed or null.
 */
function twoAnchorRingSeed(ids, fixedIds, fixedCoords, bondLength) {
  const firstIndex = ids.indexOf(fixedIds[0]);
  const ordered = [...ids.slice(firstIndex), ...ids.slice(0, firstIndex)];
  const split = ordered.indexOf(fixedIds[1]);
  const first = fixedCoords.get(fixedIds[0]);
  const second = fixedCoords.get(fixedIds[1]);
  const chord = Math.hypot(second.x - first.x, second.y - first.y);
  if (chord <= bondLength * 1e-12 || chord > Math.min(split, ids.length - split) * bondLength) {
    return null;
  }
  const coords = new Map();
  const paths = [ordered.slice(0, split + 1), [ordered[0], ...ordered.slice(split).reverse()]];
  for (const [side, path] of paths.entries()) {
    const edges = path.length - 1;
    let low = 0;
    let high = 2 * Math.PI / edges;
    for (let iteration = 0; iteration < 64 && edges > 1; iteration++) {
      const angle = (low + high) / 2;
      const span = bondLength * Math.sin(edges * angle / 2) / Math.sin(angle / 2);
      if (span > chord) {
        low = angle;
      } else {
        high = angle;
      }
    }
    const turn = edges === 1 ? 0 : (side === 0 ? 1 : -1) * (low + high) / 2;
    const initial = Math.atan2(second.y - first.y, second.x - first.x) - (edges - 1) * turn / 2;
    let position = { ...first };
    coords.set(path[0], position);
    for (let index = 1; index < edges; index++) {
      const angle = initial + (index - 1) * turn;
      position = { x: position.x + bondLength * Math.cos(angle), y: position.y + bondLength * Math.sin(angle) };
      coords.set(path[index], position);
    }
    coords.set(path[edges], { ...second });
  }
  return coords;
}

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
  return placeConstrainedRingSystem(layoutGraph, [ring], seed, bondLength);
}

/**
 * Solves shared ring edges together with fixed atoms pinned from initialization.
 * Uses four starts per mode and at most 512 projection sweeps. Projected cages
 * also try seed lengths and, up to 64 atoms, bounded bond intervals with pair
 * clearance. Each unique perimeter edge is visited once per sweep.
 * @param {object} layoutGraph - Layout graph containing explicit constraints.
 * @param {object[]} rings - Rings with perimeter-ordered atom IDs.
 * @param {Map<string, {x: number, y: number}>} seed - Complete system seed.
 * @param {number} bondLength - Target length for every perimeter edge.
 * @param {object} [options] - Constraint-solving options.
 * @param {number} [options.minFixedAtoms] - Minimum anchor count (default three); macrocycles and bridged systems opt into two-anchor solving.
 * @param {{minBondLengthFactor: number, maxBondLengthFactor: number}} [options.seedBondLimits] - Add projected seed-length and bounded-interval candidates.
 * @param {Map<string, string>} [options.bondValidationClasses] - Placement-specific validation classes used to rank candidates.
 * @returns {Map<string, {x: number, y: number}>|null} Constrained coordinates or null when inapplicable.
 */
export function placeConstrainedRingSystem(layoutGraph, rings, seed, bondLength, options = {}) {
  if (!layoutGraph || layoutGraph.options.preserveFixed === false) {
    return null;
  }
  const ids = [...new Set(rings.flatMap(ring => ring.atomIds))];
  const fixedIds = ids.filter(id => layoutGraph.fixedCoords.has(id));
  if (fixedIds.length < Math.max(2, options.minFixedAtoms ?? 3)) {
    return null;
  }
  if (ids.some(id => !seed.has(id))) {
    return null;
  }
  const edges = [];
  const seenEdges = new Set();
  for (const ring of rings) {
    for (let index = 0; index < ring.atomIds.length; index++) {
      const a = ring.atomIds[index];
      const b = ring.atomIds[(index + 1) % ring.atomIds.length];
      const key = JSON.stringify([a, b].sort());
      if (!seenEdges.has(key)) {
        seenEdges.add(key);
        const seedLength = Math.hypot(seed.get(a).x - seed.get(b).x, seed.get(a).y - seed.get(b).y);
        const targetLength = options.seedBondLimits
          ? Math.max(bondLength * options.seedBondLimits.minBondLengthFactor, Math.min(bondLength * options.seedBondLimits.maxBondLengthFactor, seedLength))
          : bondLength;
        edges.push([a, b, targetLength]);
      }
    }
  }
  const fixed = new Set(fixedIds);
  const arcSeed = rings.length === 1 && fixedIds.length === 2 ? twoAnchorRingSeed(ids, fixedIds, layoutGraph.fixedCoords, bondLength) : null;
  const aligned = arcSeed ?? alignCoordsToFixed(seed, ids, layoutGraph.fixedCoords).coords;
  const first = layoutGraph.fixedCoords.get(fixedIds[0]);
  const second = layoutGraph.fixedCoords.get(fixedIds[1]);
  let best = null;
  let bestScore = null;
  const modes = options.seedBondLimits ? (ids.length <= 64 ? ['ideal', 'seed', 'interval'] : ['ideal', 'seed']) : ['ideal'];
  for (const mode of modes) {
    for (const mirror of [false, true]) {
      for (const reverse of [false, true]) {
        const coords = new Map(
          ids.map(id => {
            const position = fixed.has(id) ? layoutGraph.fixedCoords.get(id) : mirror ? reflectAcrossLine(aligned.get(id), first, second) : aligned.get(id);
            return [id, { ...position }];
          })
        );
        for (let iteration = 0; iteration < 512; iteration++) {
          let maxCorrection = 0;
          for (let step = 0; step < edges.length; step++) {
            const index = reverse ? edges.length - 1 - step : step;
            const [aId, bId, targetLength] = edges[index];
            const a = coords.get(aId);
            const b = coords.get(bId);
            const movable = Number(!fixed.has(aId)) + Number(!fixed.has(bId));
            if (movable === 0) {
              continue;
            }
            const dx = b.x - a.x;
            const dy = b.y - a.y;
            const distance = Math.hypot(dx, dy);
            const target =
              mode === 'interval'
                ? Math.max(bondLength * options.seedBondLimits.minBondLengthFactor, Math.min(bondLength * options.seedBondLimits.maxBondLengthFactor, distance))
                : mode === 'seed'
                  ? targetLength
                  : bondLength;
            const correction = (distance - target) / movable;
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
          if (mode === 'interval') {
            for (let i = 0; i < ids.length; i++) {
              for (let j = i + 1; j < ids.length; j++) {
                const aId = ids[i];
                const bId = ids[j];
                if (seenEdges.has(JSON.stringify([aId, bId].sort()))) {
                  continue;
                }
                const movable = Number(!fixed.has(aId)) + Number(!fixed.has(bId));
                if (!movable) {
                  continue;
                }
                const a = coords.get(aId);
                const b = coords.get(bId);
                const dx = b.x - a.x;
                const dy = b.y - a.y;
                const distance = Math.hypot(dx, dy);
                const correction = Math.min(0, distance - bondLength * 0.6) / movable;
                const ux = distance > 1e-12 ? dx / distance : 1;
                const uy = distance > 1e-12 ? dy / distance : 0;
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
            }
          }
          if (maxCorrection <= bondLength * 1e-10) {
            break;
          }
        }
        const audit = auditLayout(layoutGraph, coords, { bondLength, bondValidationClasses: options.bondValidationClasses });
        const score = [audit.severeOverlapCount, audit.visibleHeavyBondCrossingFailureCount, audit.bondLengthFailureCount, audit.maxBondLengthDeviation];
        const difference = bestScore ? score.findIndex((value, index) => value !== bestScore[index]) : -1;
        if (!bestScore || (difference >= 0 && score[difference] < bestScore[difference])) {
          best = coords;
          bestScore = score;
        }
      }
    }
  }
  return best;
}

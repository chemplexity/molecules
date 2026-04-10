/** @module families/acyclic */

import { add, fromAngle } from '../geometry/vec2.js';
import { compareCanonicalAtomIds } from '../topology/canonical-order.js';
import { placeRemainingBranches } from '../placement/branch-placement.js';
import { enforceAcyclicEZStereo } from '../stereo/enforcement.js';

const ZIGZAG_STEP_ANGLE = Math.PI / 6;
const STEP_ANGLE_EPSILON = 1e-9;

/**
 * Returns the bond order between two atoms in the layout graph.
 * @param {object|null} layoutGraph - Layout graph shell.
 * @param {string} firstAtomId - First atom ID.
 * @param {string} secondAtomId - Second atom ID.
 * @returns {number} Bond order or `1` when no explicit bond is found.
 */
function bondOrderBetween(layoutGraph, firstAtomId, secondAtomId) {
  if (!layoutGraph) {
    return 1;
  }
  for (const bond of layoutGraph.bonds.values()) {
    if ((bond.a === firstAtomId && bond.b === secondAtomId) || (bond.a === secondAtomId && bond.b === firstAtomId)) {
      return bond.order ?? 1;
    }
  }
  return 1;
}

/**
 * Returns whether a backbone center should preserve the incoming direction
 * instead of flipping the zigzag sign.
 * @param {object|null} layoutGraph - Layout graph shell.
 * @param {string|null|undefined} previousAtomId - Previous backbone atom ID.
 * @param {string|null|undefined} atomId - Current backbone atom ID.
 * @param {string|null|undefined} nextAtomId - Next backbone atom ID.
 * @returns {boolean} True when the center is linear.
 */
function isLinearCentre(layoutGraph, previousAtomId, atomId, nextAtomId) {
  if (!layoutGraph || previousAtomId == null || atomId == null || nextAtomId == null) {
    return false;
  }
  const previousBondOrder = bondOrderBetween(layoutGraph, previousAtomId, atomId);
  const nextBondOrder = bondOrderBetween(layoutGraph, atomId, nextAtomId);
  return previousBondOrder >= 3 || nextBondOrder >= 3 || (previousBondOrder >= 2 && nextBondOrder >= 2);
}

/**
 * Returns whether an atom participates in any sp2-like bond.
 * @param {object|null} layoutGraph - Layout graph shell.
 * @param {string} atomId - Atom ID.
 * @returns {boolean} True when the atom has a double or aromatic bond.
 */
function hasSp2Bond(layoutGraph, atomId) {
  if (!layoutGraph) {
    return false;
  }
  for (const bond of layoutGraph.bonds.values()) {
    if (bond.a !== atomId && bond.b !== atomId) {
      continue;
    }
    if (bond.aromatic || (bond.order ?? 1) >= 2) {
      return true;
    }
  }
  return false;
}

/**
 * Identifies backbone centers whose zigzag sign should stay constant through a
 * conjugated sp2 segment.
 * @param {object|null} layoutGraph - Layout graph shell.
 * @param {string[]} backbone - Backbone atom IDs in placement order.
 * @returns {Set<string>} Backbone atom IDs that should preserve the incoming turn.
 */
function findConjugatedBackboneCenters(layoutGraph, backbone) {
  const conjugatedCenterIds = new Set();
  if (!layoutGraph || backbone.length < 3) {
    return conjugatedCenterIds;
  }

  const sp2BackboneAtomIds = backbone.filter(atomId => hasSp2Bond(layoutGraph, atomId));
  const sp2BackboneSet = new Set(sp2BackboneAtomIds);
  for (let index = 1; index < backbone.length - 1; index++) {
    const atomId = backbone[index];
    if (!sp2BackboneSet.has(atomId)) {
      continue;
    }
    if (sp2BackboneSet.has(backbone[index - 1]) || sp2BackboneSet.has(backbone[index + 1])) {
      conjugatedCenterIds.add(atomId);
    }
  }

  return conjugatedCenterIds;
}

function isPreferredBackboneEndpoint(layoutGraph, adjacency, atomId, atomIdsToPlace) {
  if (!layoutGraph) {
    return true;
  }
  const atom = layoutGraph.atoms.get(atomId);
  if (!atom || atom.element !== 'O') {
    return true;
  }
  const neighbors = [...(adjacency.get(atomId) ?? [])].filter(neighborAtomId => atomIdsToPlace.has(neighborAtomId));
  if (neighbors.length !== 1) {
    return true;
  }
  return bondOrderBetween(layoutGraph, atomId, neighbors[0]) < 2;
}

function sortedNeighbors(adjacency, atomId, canonicalAtomRank) {
  return [...(adjacency.get(atomId) ?? [])].sort((firstAtomId, secondAtomId) => compareCanonicalAtomIds(firstAtomId, secondAtomId, canonicalAtomRank));
}

function breadthFirstFarthest(adjacency, canonicalAtomRank, startAtomId, atomIdsToPlace, layoutGraph = null) {
  const visited = new Set([startAtomId]);
  const parent = new Map([[startAtomId, null]]);
  const distance = new Map([[startAtomId, 0]]);
  const queue = [startAtomId];
  let queueHead = 0;
  let farthestAtomId = startAtomId;
  let farthestPreferredAtomId = isPreferredBackboneEndpoint(layoutGraph, adjacency, startAtomId, atomIdsToPlace) ? startAtomId : null;

  while (queueHead < queue.length) {
    const atomId = queue[queueHead++];
    const currentDistance = distance.get(atomId);
    if (
      currentDistance > distance.get(farthestAtomId) ||
      (currentDistance === distance.get(farthestAtomId) && compareCanonicalAtomIds(atomId, farthestAtomId, canonicalAtomRank) < 0)
    ) {
      farthestAtomId = atomId;
    }
    if (isPreferredBackboneEndpoint(layoutGraph, adjacency, atomId, atomIdsToPlace)) {
      if (
        farthestPreferredAtomId == null ||
        currentDistance > distance.get(farthestPreferredAtomId) ||
        (currentDistance === distance.get(farthestPreferredAtomId) &&
          compareCanonicalAtomIds(atomId, farthestPreferredAtomId, canonicalAtomRank) < 0)
      ) {
        farthestPreferredAtomId = atomId;
      }
    }
    for (const neighborAtomId of sortedNeighbors(adjacency, atomId, canonicalAtomRank)) {
      if (!atomIdsToPlace.has(neighborAtomId) || visited.has(neighborAtomId)) {
        continue;
      }
      visited.add(neighborAtomId);
      parent.set(neighborAtomId, atomId);
      distance.set(neighborAtomId, currentDistance + 1);
      queue.push(neighborAtomId);
    }
  }

  return { farthestAtomId: farthestPreferredAtomId ?? farthestAtomId, parent, distance };
}

function longestBackbonePath(adjacency, canonicalAtomRank, atomIdsToPlace, layoutGraph = null) {
  const preferredSeedAtomIds = [...atomIdsToPlace].filter(atomId => isPreferredBackboneEndpoint(layoutGraph, adjacency, atomId, atomIdsToPlace));
  const seedAtomId = (preferredSeedAtomIds.length > 0 ? preferredSeedAtomIds : [...atomIdsToPlace])
    .sort((firstAtomId, secondAtomId) => compareCanonicalAtomIds(firstAtomId, secondAtomId, canonicalAtomRank))[0];
  const firstPass = breadthFirstFarthest(adjacency, canonicalAtomRank, seedAtomId, atomIdsToPlace, layoutGraph);
  const secondPass = breadthFirstFarthest(adjacency, canonicalAtomRank, firstPass.farthestAtomId, atomIdsToPlace, layoutGraph);
  const path = [];
  let cursor = secondPass.farthestAtomId;
  while (cursor != null) {
    path.push(cursor);
    cursor = secondPass.parent.get(cursor) ?? null;
  }
  return path.reverse();
}

/**
 * Places an acyclic component using a horizontal longest-backbone scaffold and
 * recursive branch placement for the remaining atoms.
 * @param {Map<string, string[]>} adjacency - Component adjacency map.
 * @param {Set<string>} atomIdsToPlace - Atom IDs to place.
 * @param {Map<string, number>} canonicalAtomRank - Canonical atom rank map.
 * @param {number} bondLength - Target bond length.
 * @param {object} [options] - Family-layout options.
 * @param {object|null} [options.layoutGraph] - Layout graph shell.
 * @returns {Map<string, {x: number, y: number}>} Coordinate map.
 */
export function layoutAcyclicFamily(adjacency, atomIdsToPlace, canonicalAtomRank, bondLength, options = {}) {
  const layoutGraph = options.layoutGraph ?? null;
  const coords = new Map();
  const atomCount = atomIdsToPlace.size;
  if (atomCount === 0) {
    return coords;
  }
  if (atomCount === 1) {
    coords.set([...atomIdsToPlace][0], { x: 0, y: 0 });
    return coords;
  }

  const backbone = longestBackbonePath(adjacency, canonicalAtomRank, atomIdsToPlace, layoutGraph);
  const conjugatedCenterIds = findConjugatedBackboneCenters(layoutGraph, backbone);
  if (backbone.length === 2) {
    coords.set(backbone[0], { x: 0, y: 0 });
    coords.set(backbone[1], { x: bondLength, y: 0 });
    placeRemainingBranches(adjacency, canonicalAtomRank, coords, atomIdsToPlace, backbone, bondLength, layoutGraph);
    return layoutGraph
      ? enforceAcyclicEZStereo(layoutGraph, coords, { bondLength }).coords
      : coords;
  }

  coords.set(backbone[0], { x: 0, y: 0 });
  let previousStepAngle = ZIGZAG_STEP_ANGLE;
  let conjugatedStepSign = Math.sign(previousStepAngle) || 1;
  for (let index = 1; index < backbone.length; index++) {
    let stepAngle = index % 2 === 1 ? ZIGZAG_STEP_ANGLE : -ZIGZAG_STEP_ANGLE;
    const currentCenterAtomId = backbone[index - 1];
    if (index > 1 && isLinearCentre(layoutGraph, backbone[index - 2], currentCenterAtomId, backbone[index])) {
      stepAngle = previousStepAngle;
    } else if (conjugatedCenterIds.has(currentCenterAtomId)) {
      if (Math.abs(previousStepAngle) <= STEP_ANGLE_EPSILON) {
        stepAngle = conjugatedStepSign * ZIGZAG_STEP_ANGLE;
      } else {
        conjugatedStepSign = Math.sign(previousStepAngle) || conjugatedStepSign || 1;
        stepAngle = 0;
      }
    }
    coords.set(backbone[index], add(coords.get(backbone[index - 1]), fromAngle(stepAngle, bondLength)));
    if (Math.abs(stepAngle) > STEP_ANGLE_EPSILON) {
      conjugatedStepSign = Math.sign(stepAngle) || conjugatedStepSign || 1;
    }
    previousStepAngle = stepAngle;
  }

  const yValues = [...coords.values()].map(position => position.y);
  const yMidpoint = (Math.min(...yValues) + Math.max(...yValues)) / 2;
  if (Math.abs(yMidpoint) > 1e-9) {
    for (const [atomId, position] of coords) {
      coords.set(atomId, { x: position.x, y: position.y - yMidpoint });
    }
  }

  placeRemainingBranches(adjacency, canonicalAtomRank, coords, atomIdsToPlace, backbone, bondLength, layoutGraph);
  return layoutGraph
    ? enforceAcyclicEZStereo(layoutGraph, coords, { bondLength }).coords
    : coords;
}

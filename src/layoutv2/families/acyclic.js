/** @module families/acyclic */

import { add, fromAngle, rotate, sub } from '../geometry/vec2.js';
import { actualAlkeneStereo } from '../stereo/ez.js';
import { compareCanonicalAtomIds } from '../topology/canonical-order.js';
import { describeCrossLikeHypervalentCenter, placeRemainingBranches } from '../placement/branch-placement.js';
import { enforceAcyclicEZStereo } from '../stereo/enforcement.js';

const ZIGZAG_STEP_ANGLE = Math.PI / 6;
const TRIGONAL_TARGET_ANGLE = (2 * Math.PI) / 3;
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
  if (previousBondOrder >= 3 || nextBondOrder >= 3 || (previousBondOrder >= 2 && nextBondOrder >= 2)) {
    return true;
  }

  const crossLikeCenter = describeCrossLikeHypervalentCenter(layoutGraph, atomId);
  return crossLikeCenter != null
    && crossLikeCenter.singleNeighborIds.includes(previousAtomId)
    && crossLikeCenter.singleNeighborIds.includes(nextAtomId);
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
 * Collects the atoms on one side of a bond without crossing the blocked atom.
 * @param {object|null} layoutGraph - Layout graph shell.
 * @param {string} startAtomId - Atom ID at the traversed side of the bond.
 * @param {string} blockedAtomId - Atom ID acting as the traversal boundary.
 * @returns {Set<string>} Atom IDs reachable from `startAtomId`.
 */
function collectSideAtomIds(layoutGraph, startAtomId, blockedAtomId) {
  const sideAtomIds = new Set();
  if (!layoutGraph) {
    return sideAtomIds;
  }

  const queue = [startAtomId];
  const seen = new Set([blockedAtomId]);
  let queueHead = 0;
  while (queueHead < queue.length) {
    const atomId = queue[queueHead++];
    if (seen.has(atomId)) {
      continue;
    }
    seen.add(atomId);
    sideAtomIds.add(atomId);

    const atom = layoutGraph.sourceMolecule.atoms.get(atomId);
    if (!atom) {
      continue;
    }
    for (const neighborAtom of atom.getNeighbors(layoutGraph.sourceMolecule)) {
      if (neighborAtom && !seen.has(neighborAtom.id)) {
        queue.push(neighborAtom.id);
      }
    }
  }

  return sideAtomIds;
}

/**
 * Collects explicitly configured acyclic alkene stereo bonds in the current layout graph.
 * @param {object|null} layoutGraph - Layout graph shell.
 * @returns {object[]} Stereo-tracked acyclic double bonds.
 */
function acyclicStereoBonds(layoutGraph) {
  if (!layoutGraph) {
    return [];
  }

  const ringAtomIds = new Set();
  for (const ring of layoutGraph.rings ?? []) {
    for (const atomId of ring.atomIds) {
      ringAtomIds.add(atomId);
    }
  }

  return [...layoutGraph.bonds.values()].filter(bond =>
    bond.kind === 'covalent' &&
    !bond.aromatic &&
    (bond.order ?? 1) === 2 &&
    !ringAtomIds.has(bond.a) &&
    !ringAtomIds.has(bond.b) &&
    (layoutGraph.sourceMolecule.getEZStereo?.(bond.id) ?? null) != null
  );
}

/**
 * Counts how many tracked acyclic alkene stereo bonds match their target configuration.
 * @param {object|null} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Coordinate map.
 * @param {object[]} stereoBonds - Stereo-tracked acyclic double bonds.
 * @returns {number} Matched stereo-bond count.
 */
function countMatchedStereo(layoutGraph, coords, stereoBonds) {
  if (!layoutGraph) {
    return 0;
  }

  let matchedBondCount = 0;
  for (const bond of stereoBonds) {
    const targetStereo = layoutGraph.sourceMolecule.getEZStereo?.(bond.id) ?? null;
    if (targetStereo && actualAlkeneStereo(layoutGraph, coords, bond) === targetStereo) {
      matchedBondCount++;
    }
  }
  return matchedBondCount;
}

/**
 * Measures the current maximum span across the chosen backbone path.
 * @param {Map<string, {x: number, y: number}>} coords - Coordinate map.
 * @param {string[]} backbone - Backbone atom IDs in placement order.
 * @returns {number} Maximum squared backbone-atom distance.
 */
function measureBackboneSpan(coords, backbone) {
  let maxDistanceSquared = 0;
  for (let firstIndex = 0; firstIndex < backbone.length; firstIndex++) {
    const firstPosition = coords.get(backbone[firstIndex]);
    if (!firstPosition) {
      continue;
    }
    for (let secondIndex = firstIndex + 1; secondIndex < backbone.length; secondIndex++) {
      const secondPosition = coords.get(backbone[secondIndex]);
      if (!secondPosition) {
        continue;
      }
      const dx = secondPosition.x - firstPosition.x;
      const dy = secondPosition.y - firstPosition.y;
      maxDistanceSquared = Math.max(maxDistanceSquared, (dx * dx) + (dy * dy));
    }
  }
  return maxDistanceSquared;
}

/**
 * Returns whether a backbone center should read as a strict trigonal turn in an
 * acyclic depiction.
 * @param {object|null} layoutGraph - Layout graph shell.
 * @param {string|null|undefined} previousAtomId - Previous backbone atom ID.
 * @param {string|null|undefined} atomId - Center backbone atom ID.
 * @param {string|null|undefined} nextAtomId - Next backbone atom ID.
 * @returns {boolean} True when the center should be normalized to 120 degrees.
 */
function isTrigonalBackboneCentre(layoutGraph, previousAtomId, atomId, nextAtomId) {
  return !isLinearCentre(layoutGraph, previousAtomId, atomId, nextAtomId) && hasSp2Bond(layoutGraph, atomId);
}

/**
 * Rotates downstream acyclic backbone suffixes so strict trigonal centers land
 * at ideal 120-degree bond angles while preserving the current turn sign.
 * @param {object|null} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Coordinate map.
 * @param {string[]} backbone - Backbone atom IDs in placement order.
 * @returns {Map<string, {x: number, y: number}>} Coordinate map with normalized trigonal turns.
 */
function normalizeBackboneTrigonalAngles(layoutGraph, coords, backbone) {
  if (!layoutGraph || backbone.length < 3) {
    return coords;
  }

  const stereoBonds = acyclicStereoBonds(layoutGraph);
  const idealBackboneSpan = Math.max(0, (backbone.length - 1) * layoutGraph.options.bondLength);
  if (
    stereoBonds.length >= 3 &&
    idealBackboneSpan > 0 &&
    (measureBackboneSpan(coords, backbone) / (idealBackboneSpan * idealBackboneSpan)) >= 0.7
  ) {
    return coords;
  }

  let previousTurnSign = 0;
  for (let index = 1; index < backbone.length - 1; index++) {
    const previousAtomId = backbone[index - 1];
    const centerAtomId = backbone[index];
    const nextAtomId = backbone[index + 1];
    if (!isTrigonalBackboneCentre(layoutGraph, previousAtomId, centerAtomId, nextAtomId)) {
      continue;
    }

    const centerPosition = coords.get(centerAtomId);
    const previousPosition = coords.get(previousAtomId);
    const nextPosition = coords.get(nextAtomId);
    if (!centerPosition || !previousPosition || !nextPosition) {
      continue;
    }

    const previousDirection = Math.atan2(previousPosition.y - centerPosition.y, previousPosition.x - centerPosition.x);
    const nextDirection = Math.atan2(nextPosition.y - centerPosition.y, nextPosition.x - centerPosition.x);
    const currentTurn = normalizeSignedAngle(nextDirection - previousDirection);
    const currentTurnSign = Math.sign(currentTurn) || previousTurnSign || (index % 2 === 1 ? -1 : 1);
    const movedAtomIds = collectSideAtomIds(layoutGraph, nextAtomId, centerAtomId);
    const candidateTurnSigns = stereoBonds.length > 0 ? [currentTurnSign, -currentTurnSign] : [currentTurnSign];
    let bestCandidate = null;

    for (const candidateTurnSign of candidateTurnSigns) {
      const targetTurn = candidateTurnSign * TRIGONAL_TARGET_ANGLE;
      const rotationAngle = targetTurn - currentTurn;
      const candidateCoords = new Map([...coords.entries()].map(([atomId, position]) => [atomId, { ...position }]));
      if (Math.abs(rotationAngle) > 1e-6) {
        for (const atomId of movedAtomIds) {
          const position = candidateCoords.get(atomId);
          if (!position) {
            continue;
          }
          candidateCoords.set(atomId, add(centerPosition, rotate(sub(position, centerPosition), rotationAngle)));
        }
      }

      const candidate = {
        coords: candidateCoords,
        turnSign: candidateTurnSign,
        matchedStereoCount: countMatchedStereo(layoutGraph, candidateCoords, stereoBonds),
        backboneSpan: measureBackboneSpan(candidateCoords, backbone),
        rotationMagnitude: Math.abs(rotationAngle)
      };

      if (
        !bestCandidate ||
        candidate.matchedStereoCount > bestCandidate.matchedStereoCount ||
        (candidate.matchedStereoCount === bestCandidate.matchedStereoCount &&
          candidate.backboneSpan > bestCandidate.backboneSpan + 1e-6) ||
        (candidate.matchedStereoCount === bestCandidate.matchedStereoCount &&
          Math.abs(candidate.backboneSpan - bestCandidate.backboneSpan) <= 1e-6 &&
          candidate.rotationMagnitude < bestCandidate.rotationMagnitude - 1e-6)
      ) {
        bestCandidate = candidate;
      }
    }

    if (!bestCandidate) {
      continue;
    }
    coords.clear();
    for (const [atomId, position] of bestCandidate.coords) {
      coords.set(atomId, position);
    }
    previousTurnSign = bestCandidate.turnSign;
  }

  return coords;
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
  if (!layoutGraph) {
    return coords;
  }

  const stereoEnforced = enforceAcyclicEZStereo(layoutGraph, coords, { bondLength }).coords;
  return normalizeBackboneTrigonalAngles(layoutGraph, stereoEnforced, backbone);
}

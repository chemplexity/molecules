/** @module families/acyclic */

import { add, angleOf, centroid, fromAngle, length, rotate, sub, wrapAngle } from '../geometry/vec2.js';
import { cloneCoords } from '../geometry/transforms.js';
import { actualAlkeneStereo } from '../stereo/ez.js';
import { compareCanonicalAtomIds } from '../topology/canonical-order.js';
import { describeCrossLikeHypervalentCenter, placeRemainingBranches } from '../placement/branch-placement.js';
import {
  isExactVisibleTrigonalBisectorEligible,
  shouldPreferOmittedHydrogenTrigonalBisector
} from '../placement/branch-placement/angle-selection.js';
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
  const key = firstAtomId < secondAtomId ? `${firstAtomId}:${secondAtomId}` : `${secondAtomId}:${firstAtomId}`;
  return layoutGraph.bondByAtomPair.get(key)?.order ?? 1;
}

/**
 * Returns whether a cross-like hypervalent descriptor includes an explicit
 * hydrogen single-bond ligand. These centers read as a visible heavy-atom
 * trigonal fan once hydrogens are suppressed, so the acyclic backbone should
 * not force two heavy single bonds onto the same straight axis.
 * @param {object|null} layoutGraph - Layout graph shell.
 * @param {{singleNeighborIds: string[]}|null} crossLikeCenter - Hypervalent center descriptor.
 * @returns {boolean} True when one single-bond ligand is hydrogen.
 */
function hasExplicitHydrogenSingleLigand(layoutGraph, crossLikeCenter) {
  return Boolean(
    layoutGraph
    && crossLikeCenter
    && crossLikeCenter.singleNeighborIds.some(neighborAtomId => layoutGraph.atoms.get(neighborAtomId)?.element === 'H')
  );
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
  return (
    crossLikeCenter != null
    && !hasExplicitHydrogenSingleLigand(layoutGraph, crossLikeCenter)
    && crossLikeCenter.singleNeighborIds.includes(previousAtomId)
    && crossLikeCenter.singleNeighborIds.includes(nextAtomId)
  );
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
  for (const bond of layoutGraph.bondsByAtomId.get(atomId) ?? []) {
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

  return [...layoutGraph.bonds.values()].filter(
    bond =>
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
      maxDistanceSquared = Math.max(maxDistanceSquared, dx * dx + dy * dy);
    }
  }
  return maxDistanceSquared;
}

/**
 * Returns whether a backbone center should read as a strict trigonal turn in an
 * acyclic depiction. Besides explicit sp2 centers, this includes planar
 * tertiary nitrogens whose off-backbone branch is conjugated to a carbonyl,
 * aryl, or sulfonyl-like hypervalent neighbor.
 * @param {object|null} layoutGraph - Layout graph shell.
 * @param {string|null|undefined} previousAtomId - Previous backbone atom ID.
 * @param {string|null|undefined} atomId - Center backbone atom ID.
 * @param {string|null|undefined} nextAtomId - Next backbone atom ID.
 * @returns {boolean} True when the center should be normalized to 120 degrees.
 */
function isTrigonalBackboneCentre(layoutGraph, previousAtomId, atomId, nextAtomId) {
  if (isLinearCentre(layoutGraph, previousAtomId, atomId, nextAtomId)) {
    return false;
  }
  if (hasSp2Bond(layoutGraph, atomId)) {
    return true;
  }
  if (!layoutGraph || previousAtomId == null || atomId == null || nextAtomId == null) {
    return false;
  }
  if (shouldPreferOmittedHydrogenTrigonalBisector(layoutGraph, atomId)) {
    return true;
  }

  return (layoutGraph.bondsByAtomId.get(atomId) ?? [])
    .map(bond => (bond.a === atomId ? bond.b : bond.a))
    .some(neighborAtomId => (
      neighborAtomId !== previousAtomId
      && neighborAtomId !== nextAtomId
      && isExactVisibleTrigonalBisectorEligible(layoutGraph, atomId, neighborAtomId)
    ));
}

/**
 * Returns whether a saturated carbon backbone center should keep an exact
 * zigzag bend after neighboring conjugated centers have been normalized.
 * @param {object|null} layoutGraph - Layout graph shell.
 * @param {string|null|undefined} previousAtomId - Previous backbone atom ID.
 * @param {string|null|undefined} atomId - Center backbone atom ID.
 * @param {string|null|undefined} nextAtomId - Next backbone atom ID.
 * @returns {boolean} True when the center should be restored to a 120-degree zigzag.
 */
function isSaturatedBackboneZigzagCentre(layoutGraph, previousAtomId, atomId, nextAtomId) {
  if (!layoutGraph || previousAtomId == null || atomId == null || nextAtomId == null) {
    return false;
  }
  if (isLinearCentre(layoutGraph, previousAtomId, atomId, nextAtomId) || hasSp2Bond(layoutGraph, atomId)) {
    return false;
  }

  const atom = layoutGraph.atoms.get(atomId);
  if (
    !atom
    || atom.element !== 'C'
    || atom.aromatic
    || atom.heavyDegree !== 2
    || (layoutGraph.atomToRings.get(atomId)?.length ?? 0) > 0
  ) {
    return false;
  }

  return bondOrderBetween(layoutGraph, previousAtomId, atomId) === 1
    && bondOrderBetween(layoutGraph, atomId, nextAtomId) === 1
    && (hasSp2Bond(layoutGraph, previousAtomId) || hasSp2Bond(layoutGraph, nextAtomId));
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
  if (stereoBonds.length >= 3 && idealBackboneSpan > 0 && measureBackboneSpan(coords, backbone) / (idealBackboneSpan * idealBackboneSpan) >= 0.7) {
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
    const currentTurn = wrapAngle(nextDirection - previousDirection);
    const currentTurnSign = Math.sign(currentTurn) || previousTurnSign || (index % 2 === 1 ? -1 : 1);
    const movedAtomIds = collectSideAtomIds(layoutGraph, nextAtomId, centerAtomId);
    const sideRootAtomId = (layoutGraph.bondsByAtomId.get(centerAtomId) ?? [])
      .map(bond => (bond.a === centerAtomId ? bond.b : bond.a))
      .find(neighborAtomId => {
        const bondOrder = bondOrderBetween(layoutGraph, centerAtomId, neighborAtomId);
        const neighborAtom = layoutGraph.atoms.get(neighborAtomId);
        return neighborAtomId !== previousAtomId
          && neighborAtomId !== nextAtomId
          && !!neighborAtom
          && neighborAtom.element !== 'H'
          && bondOrder === 1
          && coords.has(neighborAtomId);
      }) ?? null;
    const candidateTurnSigns = stereoBonds.length > 0 ? [currentTurnSign, -currentTurnSign] : [currentTurnSign];
    const sideRootAtomIds = sideRootAtomId ? collectSideAtomIds(layoutGraph, sideRootAtomId, centerAtomId) : null;
    let bestCandidate = null;

    for (const candidateTurnSign of candidateTurnSigns) {
      const targetTurn = candidateTurnSign * TRIGONAL_TARGET_ANGLE;
      const rotationAngle = targetTurn - currentTurn;
      const candidateCoords = cloneCoords(coords);
      if (Math.abs(rotationAngle) > 1e-6) {
        for (const atomId of movedAtomIds) {
          const position = candidateCoords.get(atomId);
          if (!position) {
            continue;
          }
          candidateCoords.set(atomId, add(centerPosition, rotate(sub(position, centerPosition), rotationAngle)));
        }
      }
      if (sideRootAtomId && sideRootAtomIds && candidateCoords.has(sideRootAtomId)) {
        const targetAngle = angleOf(sub(centerPosition, centroid([previousPosition, candidateCoords.get(nextAtomId)])));
        const currentRootAngle = angleOf(sub(candidateCoords.get(sideRootAtomId), centerPosition));
        rotateSubtreeAroundCenter(
          candidateCoords,
          sideRootAtomIds,
          centerPosition,
          wrapAngle(targetAngle - currentRootAngle)
        );
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
        (candidate.matchedStereoCount === bestCandidate.matchedStereoCount && candidate.backboneSpan > bestCandidate.backboneSpan + 1e-6) ||
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

/**
 * Rotates downstream acyclic backbone suffixes so saturated two-heavy carbon
 * centers next to conjugated segments keep normal 120-degree zigzag bends.
 * Trigonal normalization can otherwise leave the adjacent methylene at a
 * visually over-straight 150-degree angle while preserving all bond lengths.
 * @param {object|null} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Coordinate map.
 * @param {string[]} backbone - Backbone atom IDs in placement order.
 * @returns {Map<string, {x: number, y: number}>} Coordinate map with normalized saturated bends.
 */
function normalizeBackboneSaturatedZigzagAngles(layoutGraph, coords, backbone) {
  if (!layoutGraph || backbone.length < 3) {
    return coords;
  }

  const stereoBonds = acyclicStereoBonds(layoutGraph);
  const idealBackboneSpan = Math.max(0, (backbone.length - 1) * layoutGraph.options.bondLength);
  if (stereoBonds.length >= 3 && idealBackboneSpan > 0 && measureBackboneSpan(coords, backbone) / (idealBackboneSpan * idealBackboneSpan) >= 0.7) {
    return coords;
  }

  let previousTurnSign = 0;
  for (let index = 1; index < backbone.length - 1; index++) {
    const previousAtomId = backbone[index - 1];
    const centerAtomId = backbone[index];
    const nextAtomId = backbone[index + 1];
    if (!isSaturatedBackboneZigzagCentre(layoutGraph, previousAtomId, centerAtomId, nextAtomId)) {
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
    const currentTurn = wrapAngle(nextDirection - previousDirection);
    if (Math.abs(Math.abs(currentTurn) - TRIGONAL_TARGET_ANGLE) <= 1e-6) {
      previousTurnSign = Math.sign(currentTurn) || previousTurnSign;
      continue;
    }

    const currentTurnSign = Math.sign(currentTurn) || previousTurnSign || (index % 2 === 1 ? -1 : 1);
    const movedAtomIds = collectSideAtomIds(layoutGraph, nextAtomId, centerAtomId);
    const candidateTurnSigns = stereoBonds.length > 0 ? [currentTurnSign, -currentTurnSign] : [currentTurnSign];
    let bestCandidate = null;

    for (const candidateTurnSign of candidateTurnSigns) {
      const targetTurn = candidateTurnSign * TRIGONAL_TARGET_ANGLE;
      const rotationAngle = targetTurn - currentTurn;
      const candidateCoords = cloneCoords(coords);
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
        (candidate.matchedStereoCount === bestCandidate.matchedStereoCount && candidate.backboneSpan > bestCandidate.backboneSpan + 1e-6) ||
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

/**
 * Returns whether a multiple-bond neighbor is a terminal heavy-atom leaf.
 * @param {object|null} layoutGraph - Layout graph shell.
 * @param {string} centerAtomId - Candidate trigonal center atom ID.
 * @param {object} bond - Incident bond descriptor.
 * @returns {boolean} True when the neighbor is a terminal multiple-bond leaf.
 */
function isTerminalMultipleBondLeafNeighbor(layoutGraph, centerAtomId, bond) {
  if (!layoutGraph || !bond || bond.kind !== 'covalent' || bond.aromatic || (bond.order ?? 1) < 2) {
    return false;
  }
  const neighborAtomId = bond.a === centerAtomId ? bond.b : bond.a;
  const neighborAtom = layoutGraph.atoms.get(neighborAtomId);
  return !!neighborAtom && neighborAtom.element !== 'H' && neighborAtom.heavyDegree === 1;
}

function isTerminalLinearMultipleBondRoot(layoutGraph, centerAtomId, bond) {
  if (!layoutGraph || !bond || bond.kind !== 'covalent' || bond.aromatic || (bond.order ?? 1) !== 1) {
    return false;
  }
  const rootAtomId = bond.a === centerAtomId ? bond.b : bond.a;
  const rootAtom = layoutGraph.atoms.get(rootAtomId);
  if (!rootAtom || rootAtom.element === 'H' || rootAtom.aromatic || rootAtom.heavyDegree !== 2) {
    return false;
  }

  const continuationBonds = (layoutGraph.bondsByAtomId.get(rootAtomId) ?? []).filter(candidateBond => {
    if (candidateBond === bond || candidateBond.kind !== 'covalent' || candidateBond.aromatic) {
      return false;
    }
    const neighborAtomId = candidateBond.a === rootAtomId ? candidateBond.b : candidateBond.a;
    const neighborAtom = layoutGraph.atoms.get(neighborAtomId);
    return !!neighborAtom && neighborAtom.element !== 'H';
  });
  if (continuationBonds.length !== 1) {
    return false;
  }

  const continuationBond = continuationBonds[0];
  if ((continuationBond.order ?? 1) < 2) {
    return false;
  }
  const terminalAtomId = continuationBond.a === rootAtomId ? continuationBond.b : continuationBond.a;
  const terminalAtom = layoutGraph.atoms.get(terminalAtomId);
  return !!terminalAtom && terminalAtom.element !== 'H' && terminalAtom.heavyDegree === 1;
}

function rotateSubtreeAroundCenter(coords, movedAtomIds, centerPosition, rotationAngle) {
  if (Math.abs(rotationAngle) <= 1e-6) {
    return;
  }
  for (const atomId of movedAtomIds) {
    const position = coords.get(atomId);
    if (!position) {
      continue;
    }
    coords.set(atomId, add(centerPosition, rotate(sub(position, centerPosition), rotationAngle)));
  }
}

function minimumExternalDistanceSquared(coords, movedAtomIds, excludedAtomIds) {
  let minimumDistanceSquared = Number.POSITIVE_INFINITY;
  for (const atomId of movedAtomIds) {
    const position = coords.get(atomId);
    if (!position) {
      continue;
    }
    for (const [otherAtomId, otherPosition] of coords) {
      if (excludedAtomIds.has(otherAtomId)) {
        continue;
      }
      const dx = otherPosition.x - position.x;
      const dy = otherPosition.y - position.y;
      const distanceSquared = dx * dx + dy * dy;
      if (distanceSquared < minimumDistanceSquared) {
        minimumDistanceSquared = distanceSquared;
      }
    }
  }
  return minimumDistanceSquared;
}

/**
 * Re-snaps non-backbone single-bond roots that continue into a terminal
 * multiple bond so they keep the exact remaining trigonal slot after backbone
 * normalization. Backbone continuations are intentionally skipped here so the
 * chosen zig-zag path keeps its normalized geometry and the terminal
 * multiple-bond leaf can be re-snapped separately.
 * @param {object|null} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Coordinate map.
 * @param {string[]} [backbone] - Backbone atom IDs in placement order.
 * @returns {Map<string, {x: number, y: number}>} Updated coordinate map.
 */
function realignTrigonalLinearSubstituentRoots(layoutGraph, coords, backbone = []) {
  if (!layoutGraph) {
    return coords;
  }
  const backboneAtomIds = new Set(backbone);

  for (const atom of layoutGraph.atoms.values()) {
    if (!coords.has(atom.id) || atom.element === 'H') {
      continue;
    }
    const heavyBonds = (layoutGraph.bondsByAtomId.get(atom.id) ?? []).filter(bond => {
      if (bond.kind !== 'covalent') {
        return false;
      }
      const neighborAtomId = bond.a === atom.id ? bond.b : bond.a;
      const neighborAtom = layoutGraph.atoms.get(neighborAtomId);
      return !!neighborAtom && neighborAtom.element !== 'H' && coords.has(neighborAtomId);
    });
    if (heavyBonds.length !== 3) {
      continue;
    }

    const primaryBond = heavyBonds.find(bond => !bond.aromatic && (bond.order ?? 1) >= 2) ?? null;
    if (!primaryBond) {
      continue;
    }
    const rootBonds = heavyBonds.filter(bond => {
      if (bond === primaryBond || !isTerminalLinearMultipleBondRoot(layoutGraph, atom.id, bond)) {
        return false;
      }
      const rootAtomId = bond.a === atom.id ? bond.b : bond.a;
      return !(backboneAtomIds.has(atom.id) && backboneAtomIds.has(rootAtomId));
    });
    if (rootBonds.length === 0) {
      continue;
    }

    const centerPosition = coords.get(atom.id);
    const primaryAtomId = primaryBond.a === atom.id ? primaryBond.b : primaryBond.a;
    const primaryPosition = coords.get(primaryAtomId);
    if (!centerPosition || !primaryPosition) {
      continue;
    }
    const baseAngle = angleOf(sub(primaryPosition, centerPosition));
    const assignments = rootBonds.map(bond => {
      const rootAtomId = bond.a === atom.id ? bond.b : bond.a;
      const rootPosition = coords.get(rootAtomId);
      if (!rootPosition) {
        return null;
      }
      return {
        rootAtomId,
        currentAngle: angleOf(sub(rootPosition, centerPosition)),
        movedAtomIds: collectSideAtomIds(layoutGraph, rootAtomId, atom.id)
      };
    }).filter(Boolean);
    if (assignments.length === 0) {
      continue;
    }

    let targetAngles;
    if (assignments.length === 1) {
      const assignment = assignments[0];
      const excludedAtomIds = new Set([atom.id, ...assignment.movedAtomIds]);
      const candidateTargetAngles = [baseAngle + TRIGONAL_TARGET_ANGLE, baseAngle - TRIGONAL_TARGET_ANGLE].map(targetAngle => {
        const candidateCoords = cloneCoords(coords);
        rotateSubtreeAroundCenter(
          candidateCoords,
          assignment.movedAtomIds,
          centerPosition,
          wrapAngle(targetAngle - assignment.currentAngle)
        );
        return {
          targetAngle,
          rotationMagnitude: Math.abs(wrapAngle(targetAngle - assignment.currentAngle)),
          minimumDistanceSquared: minimumExternalDistanceSquared(candidateCoords, assignment.movedAtomIds, excludedAtomIds)
        };
      });
      candidateTargetAngles.sort((firstCandidate, secondCandidate) => {
        if (Math.abs(firstCandidate.minimumDistanceSquared - secondCandidate.minimumDistanceSquared) > 1e-6) {
          return secondCandidate.minimumDistanceSquared - firstCandidate.minimumDistanceSquared;
        }
        return firstCandidate.rotationMagnitude - secondCandidate.rotationMagnitude;
      });
      targetAngles = [candidateTargetAngles[0].targetAngle];
    } else {
      const positiveTarget = baseAngle + TRIGONAL_TARGET_ANGLE;
      const negativeTarget = baseAngle - TRIGONAL_TARGET_ANGLE;
      const directCost =
        Math.abs(wrapAngle(assignments[0].currentAngle - positiveTarget))
        + Math.abs(wrapAngle(assignments[1].currentAngle - negativeTarget));
      const swappedCost =
        Math.abs(wrapAngle(assignments[0].currentAngle - negativeTarget))
        + Math.abs(wrapAngle(assignments[1].currentAngle - positiveTarget));
      targetAngles = directCost <= swappedCost
        ? [positiveTarget, negativeTarget]
        : [negativeTarget, positiveTarget];
    }

    for (let index = 0; index < assignments.length; index++) {
      const assignment = assignments[index];
      rotateSubtreeAroundCenter(
        coords,
        assignment.movedAtomIds,
        centerPosition,
        wrapAngle(targetAngles[index] - assignment.currentAngle)
      );
    }
  }

  return coords;
}

/**
 * Re-snaps visible single-bond roots on non-ring trigonal centers so the
 * multiple bond plus the remaining visible branches land on exact 120-degree
 * spacings after backbone normalization has finished. This preserves the
 * chosen backbone while fixing side roots that would otherwise stay on a
 * skewed 90/150 split.
 * @param {object|null} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Coordinate map.
 * @param {string[]} [backbone] - Backbone atom IDs in placement order. Defaults to an empty list.
 * @param {Iterable<string>|null} [targetAtomIds] - Optional subset of center atom IDs to realign.
 * @returns {Map<string, {x: number, y: number}>} Updated coordinate map.
 */
export function realignVisibleTrigonalSingleBondRoots(layoutGraph, coords, backbone = [], targetAtomIds = null) {
  if (!layoutGraph) {
    return coords;
  }
  const backboneAtomIds = new Set(backbone);
  const targetAtomIdSet = targetAtomIds == null ? null : new Set(targetAtomIds);

  for (const atom of layoutGraph.atoms.values()) {
    if (
      (targetAtomIdSet != null && !targetAtomIdSet.has(atom.id))
      || !coords.has(atom.id)
      || atom.element === 'H'
      || atom.element !== 'C'
      || atom.aromatic
      || atom.heavyDegree !== 3
      || (layoutGraph.atomToRings.get(atom.id)?.length ?? 0) > 0
    ) {
      continue;
    }

    const heavyBonds = (layoutGraph.bondsByAtomId.get(atom.id) ?? []).filter(bond => {
      if (bond.kind !== 'covalent') {
        return false;
      }
      const neighborAtomId = bond.a === atom.id ? bond.b : bond.a;
      const neighborAtom = layoutGraph.atoms.get(neighborAtomId);
      return !!neighborAtom && neighborAtom.element !== 'H' && coords.has(neighborAtomId);
    });
    if (heavyBonds.length !== 3) {
      continue;
    }

    const primaryBonds = heavyBonds.filter(bond => !bond.aromatic && (bond.order ?? 1) >= 2);
    if (primaryBonds.length !== 1) {
      continue;
    }

    const primaryBond = primaryBonds[0];
    const rootBonds = heavyBonds.filter(bond => {
      if (bond === primaryBond || bond.aromatic || (bond.order ?? 1) !== 1) {
        return false;
      }
      const rootAtomId = bond.a === atom.id ? bond.b : bond.a;
      return !(backboneAtomIds.has(atom.id) && backboneAtomIds.has(rootAtomId));
    });
    if (rootBonds.length === 0) {
      continue;
    }

    const centerPosition = coords.get(atom.id);
    const primaryAtomId = primaryBond.a === atom.id ? primaryBond.b : primaryBond.a;
    const primaryPosition = coords.get(primaryAtomId);
    if (!centerPosition || !primaryPosition) {
      continue;
    }
    const baseAngle = angleOf(sub(primaryPosition, centerPosition));
    const assignments = rootBonds.map(bond => {
      const rootAtomId = bond.a === atom.id ? bond.b : bond.a;
      const rootPosition = coords.get(rootAtomId);
      if (!rootPosition) {
        return null;
      }
      return {
        rootAtomId,
        currentAngle: angleOf(sub(rootPosition, centerPosition)),
        movedAtomIds: collectSideAtomIds(layoutGraph, rootAtomId, atom.id)
      };
    }).filter(Boolean);
    if (assignments.length === 0) {
      continue;
    }

    let targetAngles;
    if (assignments.length === 1) {
      const signedOffset = wrapAngle(assignments[0].currentAngle - baseAngle);
      targetAngles = [baseAngle + (signedOffset >= 0 ? TRIGONAL_TARGET_ANGLE : -TRIGONAL_TARGET_ANGLE)];
    } else {
      const positiveTarget = baseAngle + TRIGONAL_TARGET_ANGLE;
      const negativeTarget = baseAngle - TRIGONAL_TARGET_ANGLE;
      const directCost =
        Math.abs(wrapAngle(assignments[0].currentAngle - positiveTarget))
        + Math.abs(wrapAngle(assignments[1].currentAngle - negativeTarget));
      const swappedCost =
        Math.abs(wrapAngle(assignments[0].currentAngle - negativeTarget))
        + Math.abs(wrapAngle(assignments[1].currentAngle - positiveTarget));
      targetAngles = directCost <= swappedCost
        ? [positiveTarget, negativeTarget]
        : [negativeTarget, positiveTarget];
    }

    for (let index = 0; index < assignments.length; index++) {
      const assignment = assignments[index];
      rotateSubtreeAroundCenter(
        coords,
        assignment.movedAtomIds,
        centerPosition,
        wrapAngle(targetAngles[index] - assignment.currentAngle)
      );
    }
  }

  return coords;
}

/**
 * Re-snaps non-backbone single-bond branches on planar conjugated tertiary
 * nitrogens to the exact remaining trigonal bisector after backbone
 * normalization has moved neighboring conjugated segments.
 * @param {object|null} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Coordinate map.
 * @param {string[]} [backbone] - Backbone atom IDs in placement order.
 * @returns {Map<string, {x: number, y: number}>} Updated coordinate map.
 */
function realignConjugatedNitrogenSingleBondRoots(layoutGraph, coords, backbone = []) {
  if (!layoutGraph) {
    return coords;
  }
  const backboneAtomIds = new Set(backbone);

  for (const atom of layoutGraph.atoms.values()) {
    if (
      !coords.has(atom.id)
      || atom.element !== 'N'
      || atom.aromatic
      || atom.heavyDegree !== 3
      || atom.degree !== 3
      || (layoutGraph.atomToRings.get(atom.id)?.length ?? 0) > 0
    ) {
      continue;
    }

    const heavyBonds = (layoutGraph.bondsByAtomId.get(atom.id) ?? []).filter(bond => {
      if (!bond || bond.kind !== 'covalent' || bond.aromatic || (bond.order ?? 1) !== 1) {
        return false;
      }
      const neighborAtomId = bond.a === atom.id ? bond.b : bond.a;
      const neighborAtom = layoutGraph.atoms.get(neighborAtomId);
      return !!neighborAtom && neighborAtom.element !== 'H' && coords.has(neighborAtomId);
    });
    if (heavyBonds.length !== 3) {
      continue;
    }

    const rootBonds = heavyBonds.filter(bond => {
      const rootAtomId = bond.a === atom.id ? bond.b : bond.a;
      return !(backboneAtomIds.has(atom.id) && backboneAtomIds.has(rootAtomId))
        && isExactVisibleTrigonalBisectorEligible(layoutGraph, atom.id, rootAtomId);
    });
    if (rootBonds.length !== 1) {
      continue;
    }

    const rootAtomId = rootBonds[0].a === atom.id ? rootBonds[0].b : rootBonds[0].a;
    const centerPosition = coords.get(atom.id);
    const rootPosition = coords.get(rootAtomId);
    const otherPositions = heavyBonds
      .map(bond => (bond.a === atom.id ? bond.b : bond.a))
      .filter(neighborAtomId => neighborAtomId !== rootAtomId)
      .map(neighborAtomId => coords.get(neighborAtomId))
      .filter(Boolean);
    if (!centerPosition || !rootPosition || otherPositions.length !== 2) {
      continue;
    }

    const targetAngle = angleOf(sub(centerPosition, centroid(otherPositions)));
    const currentAngle = angleOf(sub(rootPosition, centerPosition));
    rotateSubtreeAroundCenter(
      coords,
      collectSideAtomIds(layoutGraph, rootAtomId, atom.id),
      centerPosition,
      wrapAngle(targetAngle - currentAngle)
    );
  }

  return coords;
}

/**
 * Re-snaps terminal multiple-bond leaves on trigonal centers to the exact
 * outward bisector after backbone normalization has rotated one side of the
 * conjugated system. This keeps carbonyl oxygens and terminal alkene carbons
 * on ideal 120-degree depictions instead of leaving them slightly canted.
 * @param {object|null} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Coordinate map.
 * @param {number} bondLength - Target bond length.
 * @returns {Map<string, {x: number, y: number}>} Updated coordinate map.
 */
function realignTerminalMultipleBondLeaves(layoutGraph, coords, bondLength) {
  if (!layoutGraph) {
    return coords;
  }

  for (const atom of layoutGraph.atoms.values()) {
    if (!coords.has(atom.id) || atom.element === 'H') {
      continue;
    }
    const heavyBonds = (layoutGraph.bondsByAtomId.get(atom.id) ?? []).filter(bond => {
      if (bond.kind !== 'covalent') {
        return false;
      }
      const neighborAtomId = bond.a === atom.id ? bond.b : bond.a;
      const neighborAtom = layoutGraph.atoms.get(neighborAtomId);
      return !!neighborAtom && neighborAtom.element !== 'H' && coords.has(neighborAtomId);
    });
    if (heavyBonds.length !== 3) {
      continue;
    }

    const terminalMultipleBondLeafBonds = heavyBonds.filter(bond => isTerminalMultipleBondLeafNeighbor(layoutGraph, atom.id, bond));
    if (terminalMultipleBondLeafBonds.length !== 1) {
      continue;
    }

    const leafBond = terminalMultipleBondLeafBonds[0];
    const leafAtomId = leafBond.a === atom.id ? leafBond.b : leafBond.a;
    const otherNeighborIds = heavyBonds
      .map(bond => (bond.a === atom.id ? bond.b : bond.a))
      .filter(neighborAtomId => neighborAtomId !== leafAtomId);
    if (otherNeighborIds.length !== 2) {
      continue;
    }

    const centerPosition = coords.get(atom.id);
    const otherPositions = otherNeighborIds.map(neighborAtomId => coords.get(neighborAtomId)).filter(Boolean);
    if (otherPositions.length !== 2) {
      continue;
    }
    const outwardVector = sub(centerPosition, centroid(otherPositions));
    if (length(outwardVector) <= STEP_ANGLE_EPSILON) {
      continue;
    }

    coords.set(leafAtomId, add(centerPosition, fromAngle(angleOf(outwardVector), bondLength)));
  }

  return coords;
}

/**
 * Returns whether an atom is a terminal hetero leaf attached by a single bond
 * to a cross-like hypervalent center that continues into a larger heavy-atom
 * backbone beyond the center.
 * @param {object|null} layoutGraph - Layout graph shell.
 * @param {Map<string, string[]>} adjacency - Component adjacency map.
 * @param {string} atomId - Candidate endpoint atom ID.
 * @param {Set<string>} atomIdsToPlace - Atom IDs to place.
 * @returns {boolean} True when the atom should not anchor the acyclic backbone.
 */
function isTerminalCrossLikeHypervalentLeaf(layoutGraph, adjacency, atomId, atomIdsToPlace) {
  if (!layoutGraph) {
    return false;
  }
  const atom = layoutGraph.atoms.get(atomId);
  if (!atom || atom.element === 'H' || atom.element === 'C') {
    return false;
  }
  const neighbors = [...(adjacency.get(atomId) ?? [])].filter(neighborAtomId => atomIdsToPlace.has(neighborAtomId));
  if (neighbors.length !== 1 || bondOrderBetween(layoutGraph, atomId, neighbors[0]) !== 1) {
    return false;
  }

  const crossLikeCenter = describeCrossLikeHypervalentCenter(layoutGraph, neighbors[0]);
  if (crossLikeCenter == null || !crossLikeCenter.singleNeighborIds.includes(atomId)) {
    return false;
  }

  const centerNeighborIds = [...new Set([...crossLikeCenter.singleNeighborIds, ...crossLikeCenter.multipleNeighborIds])].filter(
    neighborAtomId => neighborAtomId !== atomId && atomIdsToPlace.has(neighborAtomId)
  );
  return centerNeighborIds.some(neighborAtomId => {
    const neighborAtom = layoutGraph.atoms.get(neighborAtomId);
    return !!neighborAtom && neighborAtom.element !== 'H' && (neighborAtom.heavyDegree ?? 0) > 1;
  });
}

/**
 * Returns whether an atom should be favored as a backbone endpoint during
 * acyclic longest-path selection.
 * @param {object|null} layoutGraph - Layout graph shell.
 * @param {Map<string, string[]>} adjacency - Component adjacency map.
 * @param {string} atomId - Candidate endpoint atom ID.
 * @param {Set<string>} atomIdsToPlace - Atom IDs to place.
 * @returns {boolean} True when the atom is a preferred backbone endpoint.
 */
function isPreferredBackboneEndpoint(layoutGraph, adjacency, atomId, atomIdsToPlace) {
  if (!layoutGraph) {
    return true;
  }
  if (isTerminalCrossLikeHypervalentLeaf(layoutGraph, adjacency, atomId, atomIdsToPlace)) {
    return false;
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
        (currentDistance === distance.get(farthestPreferredAtomId) && compareCanonicalAtomIds(atomId, farthestPreferredAtomId, canonicalAtomRank) < 0)
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
  const seedAtomId = (preferredSeedAtomIds.length > 0 ? preferredSeedAtomIds : [...atomIdsToPlace]).sort((firstAtomId, secondAtomId) =>
    compareCanonicalAtomIds(firstAtomId, secondAtomId, canonicalAtomRank)
  )[0];
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

  const heavyBackboneAtomIds = new Set(
    [...atomIdsToPlace].filter(atomId => {
      const atom = layoutGraph?.atoms.get(atomId);
      return atom ? atom.element !== 'H' : true;
    })
  );
  const backboneAtomIds = heavyBackboneAtomIds.size >= 2 ? heavyBackboneAtomIds : atomIdsToPlace;
  const backbone = longestBackbonePath(adjacency, canonicalAtomRank, backboneAtomIds, layoutGraph);
  const conjugatedCenterIds = findConjugatedBackboneCenters(layoutGraph, backbone);
  if (backbone.length === 2) {
    coords.set(backbone[0], { x: 0, y: 0 });
    coords.set(backbone[1], { x: bondLength, y: 0 });
    placeRemainingBranches(adjacency, canonicalAtomRank, coords, atomIdsToPlace, backbone, bondLength, layoutGraph);
    return layoutGraph ? enforceAcyclicEZStereo(layoutGraph, coords, { bondLength }).coords : coords;
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
  const trigonalNormalized = normalizeBackboneTrigonalAngles(layoutGraph, stereoEnforced, backbone);
  const saturatedZigzagNormalized = normalizeBackboneSaturatedZigzagAngles(layoutGraph, trigonalNormalized, backbone);
  const visibleRootsRealigned = realignVisibleTrigonalSingleBondRoots(layoutGraph, saturatedZigzagNormalized, backbone);
  const nitrogenRootsRealigned = realignConjugatedNitrogenSingleBondRoots(layoutGraph, visibleRootsRealigned, backbone);
  const linearRootsRealigned = realignTrigonalLinearSubstituentRoots(layoutGraph, nitrogenRootsRealigned, backbone);
  return realignTerminalMultipleBondLeaves(layoutGraph, linearRootsRealigned, bondLength);
}

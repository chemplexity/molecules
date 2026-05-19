/** @module cleanup/ligand-angle-tidy */

import { add, angleOf, angularDifference, centroid, distance, fromAngle, sub } from '../geometry/vec2.js';
import { compareCanonicalAtomIds } from '../topology/canonical-order.js';
import { organometallicArrangementSpecs, organometallicGeometryKind } from '../families/organometallic-geometry.js';

const ANGLE_THRESHOLD = Math.PI / 18;
const CENTER_RECENTER_MIN_IMPROVEMENT = Math.PI / 9;
const CENTER_RECENTER_MAX_MOVE_FACTOR = 0.75;
const CENTER_RECENTER_MIN_LIGAND_DISTANCE_FACTOR = 0.4;

/**
 * Returns whether the requested atom is a supported visible metal center.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {string} atomId - Atom identifier.
 * @returns {boolean} True when the atom is a visible d-block metal.
 */
function isVisibleMetalCenter(layoutGraph, atomId) {
  const atom = layoutGraph.sourceMolecule.atoms.get(atomId);
  if (!atom || atom.name === 'H') {
    return false;
  }
  const group = atom.properties.group ?? 0;
  return group >= 3 && group <= 12;
}

/**
 * Returns the direct non-hydrogen ligand atoms currently attached to a metal center.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {string} metalAtomId - Metal atom identifier.
 * @param {Map<string, {x: number, y: number}>} coords - Coordinate map.
 * @returns {string[]} Direct ligand atom IDs in deterministic order.
 */
function directLigandAtomIds(layoutGraph, metalAtomId, coords) {
  const ligandAtomIds = [];
  for (const bond of layoutGraph.bondsByAtomId.get(metalAtomId) ?? []) {
    const ligandAtomId = bond.a === metalAtomId ? bond.b : bond.a;
    const ligandAtom = layoutGraph.atoms.get(ligandAtomId);
    if (!ligandAtom || ligandAtom.element === 'H' || !coords.has(ligandAtomId)) {
      continue;
    }
    ligandAtomIds.push(ligandAtomId);
  }
  return ligandAtomIds.sort((firstAtomId, secondAtomId) => compareCanonicalAtomIds(firstAtomId, secondAtomId, layoutGraph.canonicalAtomRank));
}

/**
 * Returns the ideal cleanup angles for the requested simple coordination geometry.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {string} metalAtomId - Metal atom identifier.
 * @param {number} ligandCount - Number of direct ligands.
 * @returns {number[]} Ideal ligand angles in radians.
 */
function idealLigandAngles(layoutGraph, metalAtomId, ligandCount) {
  const element = layoutGraph.sourceMolecule.atoms.get(metalAtomId)?.name ?? '';
  const geometryKind = organometallicGeometryKind(element, ligandCount);
  const specs = organometallicArrangementSpecs(geometryKind, ligandCount);
  if (specs.length !== ligandCount || geometryKind === 'generic') {
    return [];
  }
  return specs.map(spec => spec.angle);
}

/**
 * Finds the lowest-cost one-to-one mapping between current ligands and ideal angles.
 * @param {number[]} currentAngles - Current ligand angles.
 * @param {number[]} idealAngles - Ideal ligand angles.
 * @returns {number[]} Ideal-angle index assigned to each current ligand index.
 */
function assignIdealAngles(currentAngles, idealAngles) {
  let bestAssignment = [];
  let bestCost = Infinity;

  /**
   * Explores assignments recursively.
   * @param {number} index - Current ligand index.
   * @param {Set<number>} used - Already assigned ideal indices.
   * @param {number[]} assignment - Partial assignment.
   * @param {number} cost - Current accumulated cost.
   * @returns {void}
   */
  function search(index, used, assignment, cost) {
    if (cost >= bestCost) {
      return;
    }
    if (index === currentAngles.length) {
      bestCost = cost;
      bestAssignment = [...assignment];
      return;
    }
    for (let idealIndex = 0; idealIndex < idealAngles.length; idealIndex++) {
      if (used.has(idealIndex)) {
        continue;
      }
      used.add(idealIndex);
      assignment[index] = idealIndex;
      search(index + 1, used, assignment, cost + angularDifference(currentAngles[index], idealAngles[idealIndex]) ** 2);
      used.delete(idealIndex);
    }
  }

  search(0, new Set(), [], 0);
  return bestAssignment;
}

/**
 * Measures how far an unordered ligand fan is from equal angular separation.
 * @param {number[]} angles - Ligand angles around the metal center.
 * @returns {number} Total absolute angular-gap deviation in radians.
 */
function ligandSeparationDeviation(angles) {
  if (angles.length < 2) {
    return 0;
  }
  const sortedAngles = [...angles].sort((firstAngle, secondAngle) => firstAngle - secondAngle);
  const idealStep = (2 * Math.PI) / sortedAngles.length;
  let deviation = 0;
  for (let index = 0; index < sortedAngles.length; index++) {
    const nextAngle = sortedAngles[(index + 1) % sortedAngles.length] + (index === sortedAngles.length - 1 ? 2 * Math.PI : 0);
    deviation += Math.abs(nextAngle - sortedAngles[index] - idealStep);
  }
  return deviation;
}

/**
 * Returns current direct-ligand angles for one metal center.
 * @param {string[]} ligandAtomIds - Direct ligand atom IDs.
 * @param {{x: number, y: number}} metalPosition - Metal coordinate.
 * @param {Map<string, {x: number, y: number}>} coords - Coordinate map.
 * @returns {number[]} Ligand angles in radians.
 */
function ligandAnglesAroundMetal(ligandAtomIds, metalPosition, coords) {
  return ligandAtomIds.map(atomId => angleOf(sub(coords.get(atomId), metalPosition)));
}

/**
 * Returns whether the direct ligands are ring-like or chelating enough that the
 * metal should move to them, instead of dragging ligand subtrees around.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {string[]} ligandAtomIds - Direct ligand atom IDs.
 * @returns {boolean} True when ligand positions should be treated as the fixed pocket.
 */
function hasChelatingLigandPocket(layoutGraph, ligandAtomIds) {
  return (
    ligandAtomIds.filter(atomId => {
      const atom = layoutGraph.atoms.get(atomId);
      return atom && (atom.heavyDegree ?? 0) > 1;
    }).length >= 2
  );
}

/**
 * Finds a safe center position for a distorted four-coordinate chelated metal.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {string[]} ligandAtomIds - Direct ligand atom IDs.
 * @param {{x: number, y: number}} metalPosition - Current metal position.
 * @param {Map<string, {x: number, y: number}>} coords - Coordinate map.
 * @param {number} bondLength - Target bond length.
 * @param {number} angleThreshold - Minimum improvement threshold.
 * @returns {{position: {x: number, y: number}, beforeDeviation: number, afterDeviation: number}|null} Candidate center shift.
 */
function centeredMetalPositionCandidate(layoutGraph, ligandAtomIds, metalPosition, coords, bondLength, angleThreshold) {
  if (ligandAtomIds.length !== 4 || !hasChelatingLigandPocket(layoutGraph, ligandAtomIds)) {
    return null;
  }
  const ligandPositions = ligandAtomIds.map(atomId => coords.get(atomId));
  if (ligandPositions.some(position => !position)) {
    return null;
  }
  const candidatePosition = centroid(ligandPositions);
  const displacement = distance(metalPosition, candidatePosition);
  if (displacement <= 1e-9 || displacement > bondLength * CENTER_RECENTER_MAX_MOVE_FACTOR) {
    return null;
  }
  const minCandidateLigandDistance = Math.min(...ligandPositions.map(position => distance(candidatePosition, position)));
  if (minCandidateLigandDistance < bondLength * CENTER_RECENTER_MIN_LIGAND_DISTANCE_FACTOR) {
    return null;
  }
  const beforeDeviation = ligandSeparationDeviation(ligandAnglesAroundMetal(ligandAtomIds, metalPosition, coords));
  const afterDeviation = ligandSeparationDeviation(ligandAnglesAroundMetal(ligandAtomIds, candidatePosition, coords));
  if (afterDeviation > beforeDeviation - Math.max(angleThreshold, CENTER_RECENTER_MIN_IMPROVEMENT)) {
    return null;
  }
  return {
    position: candidatePosition,
    beforeDeviation,
    afterDeviation
  };
}

/**
 * Measures metal-ligand presentation deviation for cleanup-stage tie-breaking.
 * Four-coordinate centers are scored by angular separation so chelated metal
 * pockets can improve without imposing a global drawing orientation.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Coordinate map.
 * @returns {number} Total ligand-angle deviation in radians.
 */
export function measureLigandAngleDeviation(layoutGraph, coords) {
  let totalDeviation = 0;
  for (const metalAtomId of [...coords.keys()].filter(atomId => isVisibleMetalCenter(layoutGraph, atomId))) {
    const metalPosition = coords.get(metalAtomId);
    const ligandAtomIds = directLigandAtomIds(layoutGraph, metalAtomId, coords);
    if (!metalPosition || ligandAtomIds.length < 2) {
      continue;
    }
    const currentAngles = ligandAnglesAroundMetal(ligandAtomIds, metalPosition, coords);
    if (ligandAtomIds.length === 4) {
      totalDeviation += ligandSeparationDeviation(currentAngles);
      continue;
    }
    const idealAngles = idealLigandAngles(layoutGraph, metalAtomId, ligandAtomIds.length);
    if (idealAngles.length !== ligandAtomIds.length || idealAngles.length === 0) {
      continue;
    }
    const assignment = assignIdealAngles(currentAngles, idealAngles);
    for (let index = 0; index < ligandAtomIds.length; index++) {
      totalDeviation += angularDifference(currentAngles[index], idealAngles[assignment[index]]);
    }
  }
  return totalDeviation;
}

/**
 * Returns whether the current layout contains a simple metal center with a
 * movable terminal ligand that materially deviates from its ideal arrangement.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Coordinate map.
 * @param {{angleThreshold?: number}} [options] - Optional threshold overrides.
 * @returns {boolean} True when the tidy should run.
 */
export function hasLigandAngleTidyNeed(layoutGraph, coords, options = {}) {
  const angleThreshold = options.angleThreshold ?? ANGLE_THRESHOLD;
  const bondLength = options.bondLength ?? layoutGraph.options.bondLength;

  for (const metalAtomId of [...coords.keys()].filter(atomId => isVisibleMetalCenter(layoutGraph, atomId))) {
    const metalPosition = coords.get(metalAtomId);
    const ligandAtomIds = directLigandAtomIds(layoutGraph, metalAtomId, coords);
    const idealAngles = idealLigandAngles(layoutGraph, metalAtomId, ligandAtomIds.length);
    const centerCandidate = centeredMetalPositionCandidate(layoutGraph, ligandAtomIds, metalPosition, coords, bondLength, angleThreshold);
    if (centerCandidate) {
      return true;
    }
    if (idealAngles.length !== ligandAtomIds.length || idealAngles.length === 0) {
      continue;
    }

    const currentAngles = ligandAtomIds.map(atomId => angleOf(sub(coords.get(atomId), metalPosition)));
    const assignment = assignIdealAngles(currentAngles, idealAngles);
    for (let index = 0; index < ligandAtomIds.length; index++) {
      const ligandAtomId = ligandAtomIds[index];
      const ligandAtom = layoutGraph.atoms.get(ligandAtomId);
      if (!ligandAtom || ligandAtom.heavyDegree > 1) {
        continue;
      }
      const targetAngle = idealAngles[assignment[index]];
      if (angularDifference(currentAngles[index], targetAngle) > angleThreshold) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Tidies simple metal-ligand angles back toward their ideal projected geometry.
 * The hook only moves direct simple ligands so it does not drag larger ligand fragments through a rigid-body transform.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} inputCoords - Coordinate map.
 * @param {object} [options] - Tidy options.
 * @param {number} [options.maxIterations] - Iteration budget.
 * @returns {{coords: Map<string, {x: number, y: number}>, nudges: number, iterations: number}} Tidied coordinates and correction stats.
 */
export function runLigandAngleTidy(layoutGraph, inputCoords, options = {}) {
  const maxIterations = options.maxIterations ?? 2;
  const angleThreshold = options.angleThreshold ?? ANGLE_THRESHOLD;
  const bondLength = options.bondLength ?? layoutGraph.options.bondLength;
  const coords = new Map([...inputCoords.entries()].map(([atomId, position]) => [atomId, { ...position }]));
  let nudges = 0;
  let iterations = 0;

  for (let iteration = 0; iteration < maxIterations; iteration++) {
    let moved = false;
    for (const metalAtomId of [...coords.keys()].filter(atomId => isVisibleMetalCenter(layoutGraph, atomId))) {
      let metalPosition = coords.get(metalAtomId);
      const ligandAtomIds = directLigandAtomIds(layoutGraph, metalAtomId, coords);
      const idealAngles = idealLigandAngles(layoutGraph, metalAtomId, ligandAtomIds.length);
      const centerCandidate = centeredMetalPositionCandidate(layoutGraph, ligandAtomIds, metalPosition, coords, bondLength, angleThreshold);
      if (centerCandidate) {
        coords.set(metalAtomId, centerCandidate.position);
        metalPosition = centerCandidate.position;
        nudges++;
        moved = true;
      }
      if (idealAngles.length !== ligandAtomIds.length || idealAngles.length === 0) {
        continue;
      }
      const currentAngles = ligandAtomIds.map(atomId => angleOf(sub(coords.get(atomId), metalPosition)));
      const assignment = assignIdealAngles(currentAngles, idealAngles);
      for (let index = 0; index < ligandAtomIds.length; index++) {
        const ligandAtomId = ligandAtomIds[index];
        const ligandAtom = layoutGraph.atoms.get(ligandAtomId);
        if (!ligandAtom || ligandAtom.heavyDegree > 1) {
          continue;
        }
        const targetAngle = idealAngles[assignment[index]];
        if (angularDifference(currentAngles[index], targetAngle) <= angleThreshold) {
          continue;
        }
        const bondLength = distance(metalPosition, coords.get(ligandAtomId));
        coords.set(ligandAtomId, add(metalPosition, fromAngle(targetAngle, bondLength)));
        nudges++;
        moved = true;
      }
    }
    if (!moved) {
      break;
    }
    iterations++;
  }

  return { coords, nudges, iterations };
}

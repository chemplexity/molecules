/** @module cleanup/ligand-angle-tidy */

import { add, angleOf, distance, fromAngle, sub } from '../geometry/vec2.js';
import { compareCanonicalAtomIds } from '../topology/canonical-order.js';

const SQUARE_PLANAR_ELEMENTS = new Set(['Pd', 'Pt']);
const TETRAHEDRAL_ELEMENTS = new Set(['Zn', 'Cd', 'Hg']);
const OCTAHEDRAL_ELEMENTS = new Set(['Co', 'Rh', 'Ir', 'Ru', 'Os']);

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
  return ligandAtomIds.sort((firstAtomId, secondAtomId) =>
    compareCanonicalAtomIds(firstAtomId, secondAtomId, layoutGraph.canonicalAtomRank)
  );
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
  if (ligandCount === 2) {
    return [0, Math.PI];
  }
  if (ligandCount === 4 && SQUARE_PLANAR_ELEMENTS.has(element)) {
    return [Math.PI / 2, 0, -Math.PI / 2, Math.PI];
  }
  if (ligandCount === 4 && TETRAHEDRAL_ELEMENTS.has(element)) {
    return [(2 * Math.PI) / 3, Math.PI / 3, -Math.PI / 6, (-5 * Math.PI) / 6];
  }
  if (ligandCount === 6 && OCTAHEDRAL_ELEMENTS.has(element)) {
    return [Math.PI / 2, 0, -Math.PI / 2, Math.PI, Math.PI / 4, (-3 * Math.PI) / 4];
  }
  return [];
}

/**
 * Returns the wrapped absolute angular distance between two directions.
 * @param {number} firstAngle - First angle in radians.
 * @param {number} secondAngle - Second angle in radians.
 * @returns {number} Absolute shortest-path angular distance.
 */
function angularDistance(firstAngle, secondAngle) {
  const rawDelta = Math.abs(firstAngle - secondAngle) % (Math.PI * 2);
  return Math.min(rawDelta, (Math.PI * 2) - rawDelta);
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
      search(
        index + 1,
        used,
        assignment,
        cost + (angularDistance(currentAngles[index], idealAngles[idealIndex]) ** 2)
      );
      used.delete(idealIndex);
    }
  }

  search(0, new Set(), [], 0);
  return bestAssignment;
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
  const angleThreshold = Math.PI / 18;
  const coords = new Map([...inputCoords.entries()].map(([atomId, position]) => [atomId, { ...position }]));
  let nudges = 0;
  let iterations = 0;

  for (let iteration = 0; iteration < maxIterations; iteration++) {
    let moved = false;
    for (const metalAtomId of [...coords.keys()].filter(atomId => isVisibleMetalCenter(layoutGraph, atomId))) {
      const metalPosition = coords.get(metalAtomId);
      const ligandAtomIds = directLigandAtomIds(layoutGraph, metalAtomId, coords);
      const idealAngles = idealLigandAngles(layoutGraph, metalAtomId, ligandAtomIds.length);
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
        if (angularDistance(currentAngles[index], targetAngle) <= angleThreshold) {
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

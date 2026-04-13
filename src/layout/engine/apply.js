/** @module apply */

import { createLayoutGraph } from './model/layout-graph.js';
import { pickWedgeAssignments } from './stereo/wedge-selection.js';

function clearAutoDisplayStereo(bond) {
  if (!bond?.properties?.display || bond.properties.display.manual === true) {
    return;
  }
  delete bond.properties.display.as;
  delete bond.properties.display.centerId;
  delete bond.properties.display.manual;
  if (Object.keys(bond.properties.display).length === 0) {
    delete bond.properties.display;
  }
}

function setDisplayStereo(bond, type, centerId = null, manual = false) {
  if (!bond) {
    return;
  }
  bond.properties.display ??= {};
  bond.properties.display.as = type;
  if (centerId) {
    bond.properties.display.centerId = centerId;
  } else {
    delete bond.properties.display.centerId;
  }
  if (manual) {
    bond.properties.display.manual = true;
  } else {
    delete bond.properties.display.manual;
  }
}

/**
 * Collects all renderer-facing wedge/dash assignments from a layout result.
 * Stereo assignments are computed if missing; extra display assignments are
 * appended without overriding explicit stereochemical wedges on the same bond.
 * @param {object} molecule - Target molecule graph.
 * @param {Map<string, {x: number, y: number}>} coords - Coordinate map.
 * @param {object|null} result - Optional layout result.
 * @returns {Array<{bondId: string, type: 'wedge'|'dash', centerId?: string, manual?: boolean}>} Display assignments.
 */
function collectDisplayAssignments(molecule, coords, result) {
  const layoutGraph = result?.layoutGraph ?? createLayoutGraph(molecule);
  const stereoAssignments = Array.isArray(result?.metadata?.stereo?.assignments)
    ? result.metadata.stereo.assignments
    : pickWedgeAssignments(layoutGraph, coords).assignments;
  const extraAssignments = Array.isArray(result?.metadata?.displayAssignments)
    ? result.metadata.displayAssignments
    : [];
  const assignments = [...stereoAssignments];
  const assignedBondIds = new Set(assignments.map(({ bondId }) => bondId));

  for (const assignment of extraAssignments) {
    if (assignedBondIds.has(assignment.bondId)) {
      continue;
    }
    assignments.push(assignment);
  }

  return assignments;
}

function resolveCoordsInput(coordsOrResult) {
  if (coordsOrResult instanceof Map) {
    return {
      coords: coordsOrResult,
      result: null
    };
  }
  if (coordsOrResult && coordsOrResult.coords instanceof Map) {
    return {
      coords: coordsOrResult.coords,
      result: coordsOrResult
    };
  }
  throw new TypeError('coordsOrResult must be a coordinate Map or a layout result object with a coords Map.');
}

function resolveOptions(result, options) {
  const inferredRefine = result?.metadata?.refine === true;
  const hiddenHydrogenMode = options.hiddenHydrogenMode ?? 'coincident';
  if (hiddenHydrogenMode !== 'inherit' && hiddenHydrogenMode !== 'coincident') {
    throw new RangeError(`hiddenHydrogenMode must be 'inherit' or 'coincident', got ${JSON.stringify(hiddenHydrogenMode)}.`);
  }
  return {
    preserveExisting: options.preserveExisting ?? inferredRefine,
    clearUnplaced: options.clearUnplaced ?? false,
    syncStereoDisplay: options.syncStereoDisplay ?? false,
    hiddenHydrogenMode
  };
}

function applyHiddenHydrogenMode(molecule, coords, hiddenHydrogenMode, preserveExisting, clearUnplaced) {
  let appliedCount = 0;
  let preservedCount = 0;
  let clearedCount = 0;

  for (const atom of molecule.atoms.values()) {
    if (atom.name !== 'H' || atom.visible !== false) {
      continue;
    }
    if (coords.has(atom.id)) {
      const position = coords.get(atom.id);
      atom.x = position.x;
      atom.y = position.y;
      appliedCount++;
      continue;
    }

    if (hiddenHydrogenMode === 'coincident') {
      const parent = atom.getNeighbors(molecule).find(neighbor => neighbor && neighbor.x != null && neighbor.y != null);
      if (parent) {
        atom.x = parent.x;
        atom.y = parent.y;
        appliedCount++;
        continue;
      }
    }

    if (preserveExisting && Number.isFinite(atom.x) && Number.isFinite(atom.y)) {
      preservedCount++;
      continue;
    }
    if (clearUnplaced) {
      atom.x = null;
      atom.y = null;
      clearedCount++;
    }
  }

  return { appliedCount, preservedCount, clearedCount };
}

function syncAppliedStereoDisplay(molecule, coords, result) {
  const assignments = collectDisplayAssignments(molecule, coords, result);

  for (const bond of molecule.bonds.values()) {
    clearAutoDisplayStereo(bond);
  }

  for (const assignment of assignments) {
    const bond = molecule.bonds.get(assignment.bondId);
    if (!bond) {
      continue;
    }
    if (bond.properties.display?.manual === true && assignment.manual !== true) {
      continue;
    }
    setDisplayStereo(bond, assignment.type, assignment.centerId, assignment.manual === true);
  }

  return new Map(assignments.map(({ bondId, type }) => [bondId, type]));
}

/**
 * Applies a coordinate map or layout result back onto an existing molecule.
 * This bridge mutates `atom.x`/`atom.y` on the target molecule without changing
 * chemistry or graph topology.
 * @param {object} molecule - Target molecule graph.
 * @param {Map<string, {x: number, y: number}>|object} coordsOrResult - Coordinate map or full layout result.
 * @param {object} [options] - Application options.
 * @param {boolean} [options.preserveExisting] - Preserve coordinates for atoms missing from the incoming map.
 * @param {boolean} [options.clearUnplaced] - Clear stale coordinates on atoms that are not placed.
 * @param {boolean} [options.syncStereoDisplay] - Populate renderer-facing wedge/dash display metadata.
 * @param {'inherit'|'coincident'} [options.hiddenHydrogenMode] - How hidden hydrogens should receive coordinates.
 * @returns {{molecule: object, appliedAtomCount: number, preservedAtomCount: number, clearedAtomCount: number, stereoBondCount: number, stereoMap: Map<string, string>}} Application summary.
 */
export function applyCoords(molecule, coordsOrResult, options = {}) {
  if (!molecule || typeof molecule !== 'object' || !(molecule.atoms instanceof Map)) {
    throw new TypeError('molecule must be a Molecule-like object with an atoms Map.');
  }

  const { coords, result } = resolveCoordsInput(coordsOrResult);
  const resolved = resolveOptions(result, options);
  let appliedAtomCount = 0;
  let preservedAtomCount = 0;
  let clearedAtomCount = 0;

  for (const atom of molecule.atoms.values()) {
    const position = coords.get(atom.id);
    if (position) {
      atom.x = position.x;
      atom.y = position.y;
      appliedAtomCount++;
      continue;
    }
    if (atom.name === 'H' && atom.visible === false) {
      continue;
    }
    if (resolved.preserveExisting && Number.isFinite(atom.x) && Number.isFinite(atom.y)) {
      preservedAtomCount++;
      continue;
    }
    if (resolved.clearUnplaced) {
      atom.x = null;
      atom.y = null;
      clearedAtomCount++;
    }
  }

  const hiddenHydrogenSummary = applyHiddenHydrogenMode(
    molecule,
    coords,
    resolved.hiddenHydrogenMode,
    resolved.preserveExisting,
    resolved.clearUnplaced
  );
  appliedAtomCount += hiddenHydrogenSummary.appliedCount;
  preservedAtomCount += hiddenHydrogenSummary.preservedCount;
  clearedAtomCount += hiddenHydrogenSummary.clearedCount;

  const stereoMap = resolved.syncStereoDisplay ? syncAppliedStereoDisplay(molecule, coords, result) : new Map();
  return {
    molecule,
    appliedAtomCount,
    preservedAtomCount,
    clearedAtomCount,
    stereoBondCount: stereoMap.size,
    stereoMap
  };
}

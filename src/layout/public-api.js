/** @module layout/public-api */

import { applyCoords } from './engine/apply.js';
import { generateCoords as generateEngineCoords, refineCoords as refineEngineCoords } from './engine/api.js';

function buildEngineOptions(options = {}) {
  return {
    suppressH: options.suppressH ?? true,
    bondLength: options.bondLength ?? 1.5,
    maxCleanupPasses: options.maxCleanupPasses ?? options.maxPasses ?? 6,
    finalLandscapeOrientation: options.finalLandscapeOrientation ?? true
  };
}

function readPlacedCoords(molecule, { suppressH = false } = {}) {
  const coords = new Map();
  if (!molecule?.atoms) {
    return coords;
  }
  for (const atom of molecule.atoms.values()) {
    if (suppressH && atom.name === 'H') {
      continue;
    }
    if (Number.isFinite(atom.x) && Number.isFinite(atom.y)) {
      coords.set(atom.id, { x: atom.x, y: atom.y });
    }
  }
  return coords;
}

/**
 * Generate coordinates with the engine and write them back onto the molecule.
 * @param {import('../core/Molecule.js').Molecule} molecule - The molecule graph to lay out.
 * @param {object} [options] - Layout options forwarded through the public layout API.
 * @param {boolean} [options.suppressH] - Whether to hide hydrogens before layout.
 * @param {number} [options.bondLength] - Requested target bond length in angstroms.
 * @param {number} [options.maxCleanupPasses] - Maximum cleanup passes for the engine.
 * @param {number} [options.maxPasses] - Legacy alias for `maxCleanupPasses`.
 * @param {boolean} [options.finalLandscapeOrientation] - Whether to apply the final whole-molecule leveling pass.
 * @returns {Map<number, {x: number, y: number}>} The placed coordinates keyed by atom id.
 */
export function generateCoords(molecule, options = {}) {
  if (!molecule?.atoms) {
    return new Map();
  }
  const engineOptions = buildEngineOptions(options);
  if (engineOptions.suppressH) {
    molecule.hideHydrogens();
  }
  const result = generateEngineCoords(molecule, engineOptions);
  applyCoords(molecule, result, {
    clearUnplaced: true,
    hiddenHydrogenMode: 'coincident',
    syncStereoDisplay: true
  });
  return result.coords;
}

/**
 * Refine existing coordinates with the engine and write the updated placement back onto the molecule.
 * This forwards the molecule's current atom positions as `existingCoords`
 * hints to the engine refinement entrypoint rather than selecting a separate
 * cleanup-only pipeline.
 * @param {import('../core/Molecule.js').Molecule} molecule - The molecule graph to lay out.
 * @param {object} [options] - Layout options forwarded through the public layout API.
 * @param {boolean} [options.suppressH] - Whether to hide hydrogens before layout.
 * @param {number} [options.bondLength] - Requested target bond length in angstroms.
 * @param {number} [options.maxCleanupPasses] - Maximum cleanup passes for the engine.
 * @param {number} [options.maxPasses] - Legacy alias for `maxCleanupPasses`.
 * @param {boolean} [options.finalLandscapeOrientation] - Whether to apply the final whole-molecule leveling pass.
 * @param {Set<number>} [options.touchedAtoms] - Atom ids that should be treated as locally edited during refinement.
 * @param {Set<number>} [options.touchedBonds] - Bond ids that should be treated as locally edited during refinement.
 * @returns {Map<number, {x: number, y: number}>} The placed coordinates keyed by atom id.
 */
export function refineExistingCoords(molecule, options = {}) {
  if (!molecule?.atoms) {
    return new Map();
  }
  const engineOptions = buildEngineOptions(options);
  if (engineOptions.suppressH) {
    molecule.hideHydrogens();
  }
  const existingCoords = readPlacedCoords(molecule, { suppressH: engineOptions.suppressH });
  if (existingCoords.size === 0) {
    return existingCoords;
  }
  const result = refineEngineCoords(molecule, {
    ...engineOptions,
    existingCoords,
    touchedAtoms: options.touchedAtoms,
    touchedBonds: options.touchedBonds
  });
  applyCoords(molecule, result, {
    preserveExisting: true,
    hiddenHydrogenMode: 'coincident',
    syncStereoDisplay: true
  });
  return result.coords;
}

/**
 * Generate 2D coordinates for `mol` then refine them.
 * @param {import('../core/Molecule.js').Molecule} mol - The molecule graph.
 * @param {object} [options] - Configuration options.
 * @param {boolean} [options.suppressH] - Whether to suppress hydrogen display.
 * @param {number} [options.bondLength] - Configuration sub-option.
 * @param {number} [options.maxPasses] - Configuration sub-option.
 * @param {boolean} [options.finalLandscapeOrientation] - Whether to apply the final whole-molecule leveling pass.
 * @param {boolean} [options.freezeRings] - Configuration sub-option.
 * @param {boolean} [options.freezeChiralCenters] - Configuration sub-option.
 * @param {boolean} [options.allowBranchReflect] - Configuration sub-option.
 * @returns {void} Coordinates are written directly onto the atoms in `mol`.
 */
export function generateAndRefine2dCoords(
  mol,
  {
    suppressH = true,
    bondLength = 1.5,
    maxPasses = 6,
    finalLandscapeOrientation = true,
    freezeRings = true,
    freezeChiralCenters = false,
    allowBranchReflect = true
  } = {}
) {
  generateCoords(mol, { suppressH, bondLength, finalLandscapeOrientation });
  return refineExistingCoords(mol, {
    suppressH,
    bondLength,
    maxPasses,
    finalLandscapeOrientation,
    freezeRings,
    freezeChiralCenters,
    allowBranchReflect
  });
}

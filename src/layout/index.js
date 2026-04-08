/** @module layout */

import { generateCoords, refineExistingCoords } from './coords2d.js';

export { generateCoords, refineExistingCoords } from './coords2d.js';

/**
 * Generate 2D coordinates for `mol` then refine them.
 * @param {import('../core/Molecule.js').Molecule} mol - The molecule graph.
 * @param {object} [options] - Configuration options.
 * @param {boolean} [options.suppressH] - Whether to suppress hydrogen display.
 * @param {number} [options.bondLength] - Configuration sub-option.
 * @param {number} [options.maxPasses] - Configuration sub-option.
 * @param {boolean} [options.freezeRings] - Configuration sub-option.
 * @param {boolean} [options.freezeChiralCenters] - Configuration sub-option.
 * @param {boolean} [options.allowBranchReflect] - Configuration sub-option.
 * @returns {void} Coordinates are written directly onto the atoms in `mol`.
 */
export function generateAndRefine2dCoords(
  mol,
  { suppressH = true, bondLength = 1.5, maxPasses = 6, freezeRings = true, freezeChiralCenters = false, allowBranchReflect = true } = {}
) {
  generateCoords(mol, { suppressH, bondLength });
  refineExistingCoords(mol, { bondLength, maxPasses, freezeRings, freezeChiralCenters, allowBranchReflect });
}

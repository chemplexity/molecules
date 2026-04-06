/** @module layout */

import { generateCoords, refineExistingCoords } from './coords2d.js';

export { generateCoords, refineExistingCoords } from './coords2d.js';

/**
 * Generate 2D coordinates for `mol` then refine them.
 *
 * @param {import('../core/Molecule.js').Molecule} mol
 * @param {object} [options]
 * @param {boolean} [options.suppressH=true]
 * @param {number}  [options.bondLength=1.5]
 * @param {number}  [options.maxPasses=6]
 * @param {boolean} [options.freezeRings=true]
 * @param {boolean} [options.freezeChiralCenters=false]
 * @param {boolean} [options.allowBranchReflect=true]
 * @returns {void} Coordinates are written directly onto the atoms in `mol`.
 */
export function generateAndRefine2dCoords(
  mol,
  { suppressH = true, bondLength = 1.5, maxPasses = 6, freezeRings = true, freezeChiralCenters = false, allowBranchReflect = true } = {}
) {
  generateCoords(mol, { suppressH, bondLength });
  refineExistingCoords(mol, { bondLength, maxPasses, freezeRings, freezeChiralCenters, allowBranchReflect });
}

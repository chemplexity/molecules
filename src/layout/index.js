/** @module layout */

import { generateCoords, refineExistingCoords } from './coords2d.js';

export { generateCoords, refineExistingCoords } from './coords2d.js';

/**
 * Generate 2D coordinates for `mol` then refine them.
 *
 * @param {import('../core/Molecule.js').Molecule} mol
 * @param {object} [opts]
 * @param {boolean} [opts.suppressH=true]
 * @param {number}  [opts.bondLength=1.5]
 * @param {number}  [opts.maxPasses=6]
 * @param {boolean} [opts.freezeRings=true]
 * @param {boolean} [opts.freezeChiralCenters=false]
 * @param {boolean} [opts.allowBranchReflect=true]
 */
export function generateAndRefine2dCoords(
  mol,
  {
    suppressH = true,
    bondLength = 1.5,
    maxPasses = 6,
    freezeRings = true,
    freezeChiralCenters = false,
    allowBranchReflect = true
  } = {}
) {
  generateCoords(mol, { suppressH, bondLength });
  refineExistingCoords(mol, { bondLength, maxPasses, freezeRings, freezeChiralCenters, allowBranchReflect });
}

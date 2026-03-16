/** @module descriptors/molecular */

/**
 * Computes the molecular formula as a map of element symbol → atom count.
 * Delegates to {@link Molecule#getFormula}.
 *
 * @param {import('../core/Molecule.js').Molecule} molecule
 * @returns {Object.<string, number>}
 */
export function molecularFormula(molecule) {
  return molecule.getFormula();
}

/**
 * Computes the molecular mass (g/mol).
 * Delegates to {@link Molecule#getMass}.
 *
 * @param {import('../core/Molecule.js').Molecule} molecule
 * @returns {number}
 */
export function molecularMass(molecule) {
  return molecule.getMass();
}

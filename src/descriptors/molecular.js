/** @module descriptors/molecular */

/**
 * Computes the molecular formula as a map of element symbol → atom count.
 * Delegates to {@link Molecule#getFormula}.
 * @param {import('../core/Molecule.js').Molecule} molecule - The molecule graph.
 * @returns {Record<string, number>} The computed result.
 */
export function molecularFormula(molecule) {
  return molecule.getFormula();
}

/**
 * Computes the molecular mass (g/mol).
 * Delegates to {@link Molecule#getMass}.
 * @param {import('../core/Molecule.js').Molecule} molecule - The molecule graph.
 * @returns {number} The computed numeric value.
 */
export function molecularMass(molecule) {
  return molecule.getMass();
}

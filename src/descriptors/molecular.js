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

/**
 * Computes the elemental difference between two molecules.
 * Returns a formatted string such as "+O" or "-H2O".
 * @param {import('../core/Molecule.js').Molecule} moleculeA - The first molecule.
 * @param {import('../core/Molecule.js').Molecule} moleculeB - The second molecule.
 * @returns {string} The formatted elemental delta.
 */
export function computeFormulaDelta(moleculeA, moleculeB) {
  const formA = moleculeA.getFormula();
  const formB = moleculeB.getFormula();

  const delta = {};
  for (const element of Object.keys(formA)) {
    delta[element] = (delta[element] || 0) - formA[element];
  }
  for (const element of Object.keys(formB)) {
    delta[element] = (delta[element] || 0) + formB[element];
  }

  // Use Hill-like sorting: C, then H, then alphabetical
  const sortKeys = (a, b) => {
    if (a === 'C' && b !== 'C') return -1;
    if (b === 'C' && a !== 'C') return 1;
    if (a === 'H' && b !== 'H') return -1;
    if (b === 'H' && a !== 'H') return 1;
    return a.localeCompare(b);
  };

  const keys = Object.keys(delta).sort(sortKeys);

  const adds = [];
  const subs = [];

  for (const el of keys) {
    const diff = delta[el];
    if (diff > 0) adds.push(`${el}${diff > 1 ? diff : ''}`);
    if (diff < 0) subs.push(`${el}${Math.abs(diff) > 1 ? Math.abs(diff) : ''}`);
  }

  const parts = [];
  if (adds.length > 0) parts.push(`+${adds.join('')}`);
  if (subs.length > 0) parts.push(`-${subs.join('')}`);

  return parts.join(' ');
}

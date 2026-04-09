/** @module topology/metal-centers */

/**
 * Returns whether an atom descriptor or source atom should be treated as a metal center.
 * @param {object|null|undefined} atom - Atom-like object.
 * @returns {boolean} True when the atom is a transition-metal style center.
 */
export function isMetalAtom(atom) {
  if (!atom) {
    return false;
  }
  const group = atom.properties?.group ?? atom.group ?? 0;
  const element = atom.name ?? atom.element ?? null;
  if (element === 'H') {
    return false;
  }
  return group >= 3 && group <= 12;
}

/**
 * Returns the atom ids of metal centers in a molecule graph.
 * @param {object} molecule - Molecule-like graph.
 * @returns {string[]} Metal-center atom ids.
 */
export function findMetalCenterIds(molecule) {
  return [...molecule.atoms.values()]
    .filter(atom => isMetalAtom(atom))
    .map(atom => atom.id);
}

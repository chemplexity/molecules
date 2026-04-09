/** @module model/layout-atom */

/**
 * Creates a layout-oriented atom descriptor from a molecule atom.
 * @param {object} atom - Source atom.
 * @param {object} molecule - Molecule-like graph.
 * @returns {object} Layout atom descriptor.
 */
export function createLayoutAtom(atom, molecule) {
  let heavyDegree = 0;
  let explicitHydrogenCount = 0;
  for (const bondId of atom.bonds) {
    const bond = molecule.bonds.get(bondId);
    if (!bond) {
      continue;
    }
    const neighbor = molecule.atoms.get(bond.getOtherAtom(atom.id));
    if (!neighbor) {
      continue;
    }
    if (neighbor.name === 'H') {
      explicitHydrogenCount++;
    } else {
      heavyDegree++;
    }
  }
  return {
    id: atom.id,
    element: atom.name,
    charge: typeof atom.getCharge === 'function' ? atom.getCharge() : (atom.properties.charge ?? 0),
    aromatic: (typeof atom.isAromatic === 'function' && atom.isAromatic()) || atom.properties.aromatic === true,
    radical: typeof atom.getRadical === 'function' ? atom.getRadical() : (atom.properties.radical ?? 0),
    chirality: typeof atom.getChirality === 'function' ? atom.getChirality() : (atom.properties.chirality ?? null),
    atomMap: typeof atom.getAtomMap === 'function' ? atom.getAtomMap() : (atom.properties.reaction?.atomMap ?? null),
    visible: atom.visible !== false,
    degree: atom.bonds.length,
    heavyDegree,
    explicitHydrogenCount,
    x: atom.x ?? null,
    y: atom.y ?? null,
    z: atom.z ?? null
  };
}

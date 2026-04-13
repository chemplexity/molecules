/** @module model/layout-bond */

function cloneDisplayHint(display) {
  if (!display || typeof display !== 'object') {
    return null;
  }
  return { ...display };
}

/**
 * Creates a layout-oriented bond descriptor from a molecule bond.
 * @param {object} bond - Source bond.
 * @param {object} molecule - Molecule-like graph.
 * @returns {object} Layout bond descriptor.
 */
export function createLayoutBond(bond, molecule) {
  return {
    id: bond.id,
    a: bond.atoms[0],
    b: bond.atoms[1],
    order: typeof bond.getOrder === 'function' ? bond.getOrder() : (bond.properties.order ?? 1),
    aromatic: bond.properties.aromatic === true,
    stereo: typeof bond.getStereo === 'function' ? bond.getStereo() : (bond.properties.stereo ?? null),
    kind: typeof bond.getKind === 'function' ? bond.getKind() : (bond.properties.kind ?? 'covalent'),
    localizedOrder: bond.properties.localizedOrder ?? null,
    inRing: typeof bond.isInRing === 'function' ? bond.isInRing(molecule) : false,
    displayHint: cloneDisplayHint(bond.properties.display)
  };
}

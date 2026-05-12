/** @module cleanup/bond-utils */

/**
 * Returns all visible heavy covalent bonds incident to atomId:
 * covalent, non-hydrogen neighbor, present in coords.
 * @param {object} layoutGraph
 * @param {Map} coords
 * @param {string} atomId
 * @returns {{ bond: object, neighborAtomId: string }[]}
 */
export function visibleHeavyCovalentBonds(layoutGraph, coords, atomId) {
  const bonds = [];
  for (const bond of layoutGraph.bondsByAtomId.get(atomId) ?? []) {
    if (!bond || bond.kind !== 'covalent') {
      continue;
    }
    const neighborAtomId = bond.a === atomId ? bond.b : bond.a;
    const neighborAtom = layoutGraph.atoms.get(neighborAtomId);
    if (!neighborAtom || neighborAtom.element === 'H' || !coords.has(neighborAtomId)) {
      continue;
    }
    bonds.push({ bond, neighborAtomId });
  }
  return bonds;
}

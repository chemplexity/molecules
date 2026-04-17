/** @module algorithms/scaffold */

const ORGANIC_SUBSET_IMPLICIT_VALENCE = Object.freeze({
  B: 3,
  C: 4,
  N: 3,
  O: 2,
  P: 3,
  S: 2,
  F: 1,
  Cl: 1,
  Br: 1,
  I: 1
});

function _countRetainedHeavyBondOrder(scaffold, atomId) {
  const atom = scaffold.atoms.get(atomId);
  if (!atom) {
    return 0;
  }
  let heavyBondOrder = 0;
  for (const bondId of atom.bonds) {
    const bond = scaffold.bonds.get(bondId);
    if (!bond) {
      continue;
    }
    const other = scaffold.atoms.get(bond.getOtherAtom(atomId));
    if (!other || other.name === 'H') {
      continue;
    }
    heavyBondOrder += bond.properties.aromatic ? 1.5 : (bond.properties.order ?? 1);
  }
  return heavyBondOrder;
}

function _normalizeScaffoldHydrogens(scaffold) {
  const retainedAtomIds = [...scaffold.atoms.keys()];
  for (const atomId of retainedAtomIds) {
    const atom = scaffold.atoms.get(atomId);
    if (!atom || atom.name === 'H') {
      continue;
    }
    if ((atom.properties.charge ?? 0) !== 0) {
      continue;
    }
    const targetValence = ORGANIC_SUBSET_IMPLICIT_VALENCE[atom.name];
    if (targetValence == null) {
      continue;
    }
    const heavyBondOrder = _countRetainedHeavyBondOrder(scaffold, atomId);
    const hydrogenCount = Math.max(0, Math.round((targetValence - heavyBondOrder) * 1000) / 1000);
    const roundedHydrogenCount = Math.round(hydrogenCount);
    if (Math.abs(hydrogenCount - roundedHydrogenCount) > 1e-6 || roundedHydrogenCount === 0) {
      continue;
    }
    for (let index = 0; index < roundedHydrogenCount; index++) {
      const hydrogen = scaffold.addAtom(null, 'H', {}, { recompute: false });
      hydrogen.visible = false;
      hydrogen.x = atom.x;
      hydrogen.y = atom.y;
      hydrogen.z = atom.z;
      scaffold.addBond(null, atomId, hydrogen.id, { order: 1 }, false);
    }
  }
  scaffold._recomputeProperties();
}

/**
 * Extracts the maximum spanning backbone (longest path) of an acyclic molecule.
 * Used as a fallback when Murcko scaffold derivation completely dissolves an acyclic structure.
 * @private
 * @param {import('../core/Molecule.js').Molecule} molecule - The input acyclic molecule.
 * @returns {import('../core/Molecule.js').Molecule} The acyclic backbone.
 */
function _extractAcyclicBackbone(molecule) {
  const backbone = molecule.clone();
  
  // 1. Remove all explicit hydrogens
  for (const [atomId, atom] of [...backbone.atoms.entries()]) {
    if (atom.name === 'H') {
      backbone.removeAtom(atomId);
    }
  }

  // 2. Iteratively prune terminal NON-CARBON atoms to remove decorators (like =O, -Cl)
  // but cleanly retain carbon branching.
  let changed = true;
  while (changed) {
    changed = false;
    for (const [atomId, atom] of [...backbone.atoms.entries()]) {
      if (backbone.atoms.size > 1 && backbone.getDegree(atomId) <= 1 && atom.name !== 'C') {
        backbone.removeAtom(atomId);
        changed = true;
      }
    }
  }

  // 3. Strip all double/triple bonds to normalize the topological carbon skeleton
  for (const bond of backbone.bonds.values()) {
    bond.properties.order = 1;
    bond.properties.aromatic = false;
  }

  _normalizeScaffoldHydrogens(backbone);
  backbone.resetIds();
  return backbone;
}

/**
 * Extracts the Murcko Scaffold from a given molecule by iteratively
 * removing terminal atoms (degree <= 1) until only rings and linker
 * chains remain. Acyclic molecules will be reduced to an empty graph.
 * @param {import('../core/Molecule.js').Molecule} molecule - The input molecule.
 * @returns {import('../core/Molecule.js').Molecule} A new molecule representing the Murcko scaffold.
 */
export function extractMurckoScaffold(molecule) {
  const scaffold = molecule.clone();
  let changed = true;

  while (changed) {
    changed = false;
    // Iterate over atom IDs. We must collect them first since we mutate the map during the loop.
    for (const atomId of [...scaffold.atoms.keys()]) {
      if (scaffold.getDegree(atomId) <= 1) {
        scaffold.removeAtom(atomId);
        changed = true;
      }
    }
  }

  // Intercept pure acyclic destruction to map an explicit backbone
  if (scaffold.atoms.size === 0 && molecule.atoms.size > 0) {
    return _extractAcyclicBackbone(molecule);
  }

  // Restore serializer-compatible hidden hydrogens so canonical SMILES for the
  // resulting scaffold uses ordinary organic-subset atoms (e.g. `C1CCCCC1`
  // instead of `[C]1[C][C][C][C][C]1`) after side chains have been pruned.
  _normalizeScaffoldHydrogens(scaffold);

  // Normalize sequential IDs for clean output comparisons and serialization
  scaffold.resetIds();

  return scaffold;
}

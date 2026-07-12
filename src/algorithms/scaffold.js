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

function _clonePlainObject(value) {
  if (value == null) {
    return {};
  }
  return typeof structuredClone === 'function' ? structuredClone(value) : JSON.parse(JSON.stringify(value));
}

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

function _isTerminalMultipleBondHeteroatom(molecule, atomId, bond) {
  const atom = molecule.atoms.get(atomId);
  if (!atom || atom.name === 'H' || atom.name === 'C') {
    return false;
  }
  if ((atom.bonds?.length ?? 0) !== 1) {
    return false;
  }
  if (bond.properties?.aromatic) {
    return false;
  }
  return (bond.properties?.order ?? 1) >= 2;
}

function _copyAtomCoordinates(sourceAtom, targetAtom) {
  targetAtom.visible = sourceAtom.visible;
  targetAtom.x = sourceAtom.x;
  targetAtom.y = sourceAtom.y;
  targetAtom.z = sourceAtom.z;
  targetAtom.tags = [...(sourceAtom.tags ?? [])];
}

function _restoreExocyclicMultipleBondHeteroatoms(scaffold, molecule) {
  let restored = false;
  for (const bond of molecule.bonds.values()) {
    if (bond.properties?.aromatic || (bond.properties?.order ?? 1) < 2) {
      continue;
    }
    const [atomAId, atomBId] = bond.atoms;
    const atomAInScaffold = scaffold.atoms.has(atomAId);
    const atomBInScaffold = scaffold.atoms.has(atomBId);
    const terminalAtomId = atomAInScaffold && !atomBInScaffold ? atomBId : atomBInScaffold && !atomAInScaffold ? atomAId : null;
    const anchorAtomId = terminalAtomId === atomAId ? atomBId : terminalAtomId === atomBId ? atomAId : null;
    if (!terminalAtomId || !anchorAtomId || !_isTerminalMultipleBondHeteroatom(molecule, terminalAtomId, bond)) {
      continue;
    }
    const sourceAtom = molecule.atoms.get(terminalAtomId);
    const restoredAtom = scaffold.addAtom(terminalAtomId, sourceAtom.name, _clonePlainObject(sourceAtom.properties), { recompute: false });
    _copyAtomCoordinates(sourceAtom, restoredAtom);
    scaffold.addBond(bond.id, anchorAtomId, terminalAtomId, _clonePlainObject(bond.properties), false);
    restored = true;
  }
  if (restored) {
    scaffold._recomputeProperties();
  }
}

function _copyHeavyAtomIntoScaffold(scaffold, molecule, atomId) {
  if (scaffold.atoms.has(atomId)) {
    return scaffold.atoms.get(atomId);
  }
  const sourceAtom = molecule.atoms.get(atomId);
  if (!sourceAtom || sourceAtom.name === 'H') {
    return null;
  }
  const restoredAtom = scaffold.addAtom(atomId, sourceAtom.name, _clonePlainObject(sourceAtom.properties), { recompute: false });
  _copyAtomCoordinates(sourceAtom, restoredAtom);
  return restoredAtom;
}

function _collectPrunedBranchHeavyAtoms(molecule, startAtomId, scaffoldAtomIds) {
  const heavyAtomIds = new Set();
  const stack = [startAtomId];

  while (stack.length > 0) {
    const atomId = stack.pop();
    if (scaffoldAtomIds.has(atomId) || heavyAtomIds.has(atomId)) {
      continue;
    }
    const atom = molecule.atoms.get(atomId);
    if (!atom || atom.name === 'H') {
      continue;
    }
    heavyAtomIds.add(atomId);
    for (const bondId of atom.bonds ?? []) {
      const bond = molecule.bonds.get(bondId);
      const otherId = bond?.getOtherAtom(atomId);
      if (otherId && !scaffoldAtomIds.has(otherId)) {
        stack.push(otherId);
      }
    }
  }

  return heavyAtomIds;
}

function _restoreLargeSubstituentBackbones(scaffold, molecule, { minSubstituentHeavyAtoms = 4 } = {}) {
  const scaffoldAtomIds = new Set(scaffold.atoms.keys());
  const restoredBranches = new Set();
  let restored = false;

  for (const bond of molecule.bonds.values()) {
    const [atomAId, atomBId] = bond.atoms;
    const atomAInScaffold = scaffoldAtomIds.has(atomAId);
    const atomBInScaffold = scaffoldAtomIds.has(atomBId);
    if (atomAInScaffold === atomBInScaffold) {
      continue;
    }

    const branchStartId = atomAInScaffold ? atomBId : atomAId;
    if (restoredBranches.has(branchStartId)) {
      continue;
    }

    const branchAtomIds = _collectPrunedBranchHeavyAtoms(molecule, branchStartId, scaffoldAtomIds);
    if (branchAtomIds.size < minSubstituentHeavyAtoms) {
      continue;
    }

    for (const atomId of branchAtomIds) {
      restoredBranches.add(atomId);
      _copyHeavyAtomIntoScaffold(scaffold, molecule, atomId);
    }

    for (const sourceBond of molecule.bonds.values()) {
      const [sourceAId, sourceBId] = sourceBond.atoms;
      const keepA = scaffold.atoms.has(sourceAId) || branchAtomIds.has(sourceAId);
      const keepB = scaffold.atoms.has(sourceBId) || branchAtomIds.has(sourceBId);
      if (!keepA || !keepB || scaffold.bonds.has(sourceBond.id)) {
        continue;
      }
      const atomA = molecule.atoms.get(sourceAId);
      const atomB = molecule.atoms.get(sourceBId);
      if (atomA?.name === 'H' || atomB?.name === 'H') {
        continue;
      }
      scaffold.addBond(sourceBond.id, sourceAId, sourceBId, _clonePlainObject(sourceBond.properties), false);
      restored = true;
    }
  }

  if (restored) {
    scaffold._recomputeProperties();
  }
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

function _clearScaffoldStereo(scaffold) {
  for (const atom of scaffold.atoms.values()) {
    atom.setChirality(null);
  }
  for (const bond of scaffold.bonds.values()) {
    bond.properties.stereo = null;
    if (bond.properties.display) {
      delete bond.properties.display.as;
      delete bond.properties.display.centerId;
      delete bond.properties.display.manual;
      if (Object.keys(bond.properties.display).length === 0) {
        delete bond.properties.display;
      }
    }
  }
}

/**
 * Extracts the maximum spanning backbone (longest path) of an acyclic molecule.
 * Used as a fallback when Murcko scaffold derivation completely dissolves an acyclic structure.
 * @private
 * @param {import('../core/Molecule.js').Molecule} molecule - The input acyclic molecule.
 * @param {object} [options] - Scaffold extraction options.
 * @param {boolean} [options.preserveExocyclicMultipleBonds] - Whether to keep terminal exocyclic multiple-bond heteroatoms. Defaults to false.
 * @returns {import('../core/Molecule.js').Molecule} The acyclic backbone.
 */
function _extractAcyclicBackbone(molecule, { preserveExocyclicMultipleBonds = false } = {}) {
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

  if (preserveExocyclicMultipleBonds) {
    _restoreExocyclicMultipleBondHeteroatoms(backbone, molecule);
  }

  _clearScaffoldStereo(backbone);
  _normalizeScaffoldHydrogens(backbone);
  backbone.resetIds();
  return backbone;
}

/**
 * Extracts the Murcko Scaffold from a given molecule by iteratively
 * removing terminal atoms (degree <= 1) until only rings and linker
 * chains remain. Acyclic molecules will be reduced to an empty graph.
 * @param {import('../core/Molecule.js').Molecule} molecule - The input molecule.
 * @param {object} [options] - Scaffold extraction options.
 * @param {boolean} [options.preserveExocyclicMultipleBonds] - Whether to keep terminal heteroatoms attached by multiple bonds to retained scaffold atoms.
 * @param {boolean} [options.preserveLargeSubstituentBackbones] - Whether to keep substantial acyclic branches attached to retained scaffold atoms.
 * @param {number} [options.minSubstituentHeavyAtoms] - Minimum non-H branch size restored when `preserveLargeSubstituentBackbones` is enabled.
 * @returns {import('../core/Molecule.js').Molecule} A new molecule representing the Murcko scaffold.
 */
export function extractMurckoScaffold(
  molecule,
  { preserveExocyclicMultipleBonds = false, preserveLargeSubstituentBackbones = false, minSubstituentHeavyAtoms = 4 } = {}
) {
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
    return _extractAcyclicBackbone(molecule, { preserveExocyclicMultipleBonds });
  }

  if (preserveExocyclicMultipleBonds) {
    _restoreExocyclicMultipleBondHeteroatoms(scaffold, molecule);
  }
  if (preserveLargeSubstituentBackbones) {
    _restoreLargeSubstituentBackbones(scaffold, molecule, { minSubstituentHeavyAtoms });
  }

  // Restore serializer-compatible hidden hydrogens so canonical SMILES for the
  // resulting scaffold uses ordinary organic-subset atoms (e.g. `C1CCCCC1`
  // instead of `[C]1[C][C][C][C][C]1`) after side chains have been pruned.
  _clearScaffoldStereo(scaffold);
  _normalizeScaffoldHydrogens(scaffold);

  // Normalize sequential IDs for clean output comparisons and serialization
  scaffold.resetIds();

  return scaffold;
}

/** @module core/molecule-fragment */

import { Molecule } from './Molecule.js';

function clonePlain(value) {
  if (value == null || typeof value !== 'object') {
    return value;
  }
  return JSON.parse(JSON.stringify(value));
}

function finiteOrNull(value) {
  return Number.isFinite(value) ? value : null;
}

function normalizeIdSet(ids) {
  if (ids == null) {
    return null;
  }
  return new Set([...ids].filter(id => id != null).map(String));
}

function fragmentCoordinateAtoms(mol, atomIds) {
  const atoms = [...atomIds].map(id => mol.atoms.get(id)).filter(atom => atom && Number.isFinite(atom.x) && Number.isFinite(atom.y));
  return atoms.length > 0 ? atoms : [...atomIds].map(id => mol.atoms.get(id)).filter(Boolean);
}

function computeCenter(mol, atomIds) {
  const atoms = fragmentCoordinateAtoms(mol, atomIds);
  let x = 0;
  let y = 0;
  let z = 0;
  let zCount = 0;
  let count = 0;
  for (const atom of atoms) {
    if (!Number.isFinite(atom.x) || !Number.isFinite(atom.y)) {
      continue;
    }
    x += atom.x;
    y += atom.y;
    if (Number.isFinite(atom.z)) {
      z += atom.z;
      zCount += 1;
    }
    count += 1;
  }
  return {
    x: count > 0 ? x / count : 0,
    y: count > 0 ? y / count : 0,
    z: zCount > 0 ? z / zCount : 0
  };
}

function addAttachedHiddenHydrogens(mol, atomIds, bondIds) {
  for (const atomId of [...atomIds]) {
    const atom = mol.atoms.get(atomId);
    if (!atom || atom.name === 'H') {
      continue;
    }
    for (const bondId of atom.bonds ?? []) {
      const bond = mol.bonds.get(bondId);
      const otherId = bond?.getOtherAtom(atomId);
      const other = otherId ? mol.atoms.get(otherId) : null;
      if (other?.name === 'H' && other.visible === false) {
        atomIds.add(other.id);
        bondIds.add(bond.id);
      }
    }
  }
}

function selectedFragmentIds(mol, options = {}) {
  const selectedAtomIds = normalizeIdSet(options.atomIds);
  const selectedBondIds = normalizeIdSet(options.bondIds);
  const copyWholeMolecule = (selectedAtomIds == null || selectedAtomIds.size === 0) && (selectedBondIds == null || selectedBondIds.size === 0);
  const atomIds = copyWholeMolecule ? new Set(mol.atoms.keys()) : new Set(selectedAtomIds ?? []);
  const bondIds = copyWholeMolecule ? new Set(mol.bonds.keys()) : new Set(selectedBondIds ?? []);

  for (const bondId of [...bondIds]) {
    const bond = mol.bonds.get(bondId);
    if (!bond) {
      bondIds.delete(bondId);
      continue;
    }
    atomIds.add(bond.atoms[0]);
    atomIds.add(bond.atoms[1]);
  }

  if (options.includeInterSelectedBonds !== false) {
    for (const bond of mol.bonds.values()) {
      if (atomIds.has(bond.atoms[0]) && atomIds.has(bond.atoms[1])) {
        bondIds.add(bond.id);
      }
    }
  }

  if (options.includeAttachedHiddenHydrogens !== false) {
    addAttachedHiddenHydrogens(mol, atomIds, bondIds);
  }

  for (const atomId of [...atomIds]) {
    if (!mol.atoms.has(atomId)) {
      atomIds.delete(atomId);
    }
  }
  for (const bondId of [...bondIds]) {
    const bond = mol.bonds.get(bondId);
    if (!bond || !atomIds.has(bond.atoms[0]) || !atomIds.has(bond.atoms[1])) {
      bondIds.delete(bondId);
    }
  }

  return { atomIds, bondIds, copyWholeMolecule };
}

function remapBondProperties(properties, atomIdMap) {
  const copy = clonePlain(properties) ?? {};
  if (copy.display?.centerId != null && atomIdMap.has(copy.display.centerId)) {
    copy.display.centerId = atomIdMap.get(copy.display.centerId);
  }
  return copy;
}

/**
 * Creates a serializable molecule fragment from a selected subgraph or the full molecule.
 * @param {Molecule} mol - Source molecule.
 * @param {object} [options] - Fragment options.
 * @param {Iterable<string>|null} [options.atomIds] - Selected atom ids. Empty with no bonds copies the whole molecule.
 * @param {Iterable<string>|null} [options.bondIds] - Selected bond ids.
 * @param {boolean} [options.includeInterSelectedBonds] - Includes bonds whose endpoints are both selected; defaults to true.
 * @param {boolean} [options.includeAttachedHiddenHydrogens] - Includes hidden hydrogens attached to copied heavy atoms; defaults to true.
 * @returns {object|null} Fragment payload, or null if no atoms are copyable.
 */
export function createMoleculeFragment(mol, options = {}) {
  if (!mol?.atoms || !mol?.bonds) {
    return null;
  }
  const { atomIds, bondIds, copyWholeMolecule } = selectedFragmentIds(mol, options);
  if (atomIds.size === 0) {
    return null;
  }

  const center = computeCenter(mol, atomIds);
  const atoms = [...atomIds].map(id => {
    const atom = mol.atoms.get(id);
    return {
      id: atom.id,
      name: atom.name,
      properties: clonePlain(atom.properties) ?? {},
      tags: [...(atom.tags ?? [])],
      visible: atom.visible,
      x: finiteOrNull(atom.x),
      y: finiteOrNull(atom.y),
      z: finiteOrNull(atom.z),
      dx: Number.isFinite(atom.x) ? atom.x - center.x : 0,
      dy: Number.isFinite(atom.y) ? atom.y - center.y : 0,
      dz: Number.isFinite(atom.z) ? atom.z - center.z : 0
    };
  });

  const bonds = [...bondIds].map(id => {
    const bond = mol.bonds.get(id);
    return {
      id: bond.id,
      atoms: [...bond.atoms],
      properties: clonePlain(bond.properties) ?? {},
      tags: [...(bond.tags ?? [])]
    };
  });

  const ringFills =
    typeof mol.getRingFills === 'function'
      ? mol.getRingFills().filter(fill => (fill.atomIds ?? []).every(atomId => atomIds.has(atomId))).map(fill => ({ ...fill, atomIds: [...fill.atomIds] }))
      : [];

  return {
    version: 1,
    kind: 'molecule-fragment',
    copyWholeMolecule,
    center,
    atoms,
    bonds,
    ringFills
  };
}

/**
 * Instantiates a fragment into a new molecule with fresh atom and bond IDs.
 * @param {object} fragment - Fragment created by {@link createMoleculeFragment}.
 * @param {object} [options] - Placement options.
 * @param {{x:number,y:number,z?:number}} [options.center] - Target center.
 * @returns {{mol: Molecule, atomIdMap: Map<string,string>, bondIdMap: Map<string,string>, atomIds: string[], bondIds: string[]}|null} Instantiated fragment metadata, or null when the fragment is invalid.
 */
export function instantiateMoleculeFragment(fragment, options = {}) {
  const mol = new Molecule();
  return mergeMoleculeFragment(mol, fragment, options);
}

/**
 * Merges a fragment into an existing molecule using fresh atom and bond IDs.
 * @param {Molecule} targetMol - Molecule to mutate.
 * @param {object} fragment - Fragment created by {@link createMoleculeFragment}.
 * @param {object} [options] - Placement options.
 * @param {{x:number,y:number,z?:number}} [options.center] - Target center.
 * @returns {{mol: Molecule, atomIdMap: Map<string,string>, bondIdMap: Map<string,string>, atomIds: string[], bondIds: string[]}|null} Merged fragment metadata, or null when the fragment is invalid.
 */
export function mergeMoleculeFragment(targetMol, fragment, options = {}) {
  if (!targetMol?.atoms || !Array.isArray(fragment?.atoms) || fragment.atoms.length === 0) {
    return null;
  }
  const center = {
    x: Number.isFinite(options.center?.x) ? options.center.x : fragment.center?.x ?? 0,
    y: Number.isFinite(options.center?.y) ? options.center.y : fragment.center?.y ?? 0,
    z: Number.isFinite(options.center?.z) ? options.center.z : fragment.center?.z ?? 0
  };
  const atomIdMap = new Map();
  const bondIdMap = new Map();
  const addedAtomIds = [];
  const addedBondIds = [];

  for (const sourceAtom of fragment.atoms) {
    const atom = targetMol.addAtom(null, sourceAtom.name, clonePlain(sourceAtom.properties) ?? {}, { recompute: false });
    atom.tags = [...(sourceAtom.tags ?? [])];
    atom.visible = sourceAtom.visible !== false;
    atom.x = center.x + (Number.isFinite(sourceAtom.dx) ? sourceAtom.dx : 0);
    atom.y = center.y + (Number.isFinite(sourceAtom.dy) ? sourceAtom.dy : 0);
    atom.z = center.z + (Number.isFinite(sourceAtom.dz) ? sourceAtom.dz : 0);
    atomIdMap.set(sourceAtom.id, atom.id);
    addedAtomIds.push(atom.id);
  }

  for (const sourceBond of fragment.bonds ?? []) {
    const atomA = atomIdMap.get(sourceBond.atoms?.[0]);
    const atomB = atomIdMap.get(sourceBond.atoms?.[1]);
    if (!atomA || !atomB) {
      continue;
    }
    const bond = targetMol.addBond(null, atomA, atomB, remapBondProperties(sourceBond.properties, atomIdMap), false);
    bond.tags = [...(sourceBond.tags ?? [])];
    bondIdMap.set(sourceBond.id, bond.id);
    addedBondIds.push(bond.id);
  }

  if (typeof targetMol.setRingFill === 'function') {
    for (const fill of fragment.ringFills ?? []) {
      const atomIds = (fill.atomIds ?? []).map(atomId => atomIdMap.get(atomId)).filter(Boolean);
      if (atomIds.length === fill.atomIds?.length) {
        targetMol.setRingFill(atomIds, { color: fill.color, opacity: fill.opacity });
      }
    }
  }

  targetMol._rebuildBondIndex?.();
  targetMol._recomputeProperties?.();
  return {
    mol: targetMol,
    atomIdMap,
    bondIdMap,
    atomIds: addedAtomIds,
    bondIds: addedBondIds
  };
}

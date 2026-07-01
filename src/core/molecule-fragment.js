/** @module core/molecule-fragment */

import { Molecule } from './Molecule.js';
import { getImplicitHydrogenChargeAdjustment } from './Atom.js';
import elements from '../data/elements.js';

const HYDROGEN_FRAGMENT_PROPERTIES = Object.freeze({
  ...elements.H,
  charge: 0,
  radical: 0,
  aromatic: false
});

function clonePlain(value) {
  if (value == null || typeof value !== 'object') {
    return value;
  }
  return JSON.parse(JSON.stringify(value));
}

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function finiteOrNull(value) {
  return finiteNumber(value);
}

function normalizeIdSet(ids) {
  if (ids == null) {
    return null;
  }
  return new Set([...ids].filter(id => id != null).map(String));
}

function fragmentCoordinateAtoms(mol, atomIds, visibleAtomIds = null) {
  const centeredAtomIds = visibleAtomIds?.size > 0 ? visibleAtomIds : atomIds;
  const atoms = [...centeredAtomIds].map(id => mol.atoms.get(id)).filter(atom => atom && finiteNumber(atom.x) != null && finiteNumber(atom.y) != null);
  return atoms.length > 0 ? atoms : [...atomIds].map(id => mol.atoms.get(id)).filter(Boolean);
}

function computeCenter(mol, atomIds, visibleAtomIds = null) {
  const atoms = fragmentCoordinateAtoms(mol, atomIds, visibleAtomIds);
  let x = 0;
  let y = 0;
  let z = 0;
  let zCount = 0;
  let count = 0;
  for (const atom of atoms) {
    const atomX = finiteNumber(atom.x);
    const atomY = finiteNumber(atom.y);
    const atomZ = finiteNumber(atom.z);
    if (atomX == null || atomY == null) {
      continue;
    }
    x += atomX;
    y += atomY;
    if (atomZ != null) {
      z += atomZ;
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

function computePositionCenter(atomIds, positions, visibleAtomIds = null) {
  const centeredAtomIds = visibleAtomIds?.size > 0 ? visibleAtomIds : atomIds;
  let x = 0;
  let y = 0;
  let count = 0;
  for (const atomId of centeredAtomIds) {
    const point = positions?.get?.(atomId);
    const pointX = finiteNumber(point?.x);
    const pointY = finiteNumber(point?.y);
    if (pointX == null || pointY == null) {
      continue;
    }
    x += pointX;
    y += pointY;
    count++;
  }
  return count > 0 ? { x: x / count, y: y / count } : null;
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

  return { atomIds, bondIds, copyWholeMolecule, selectedAtomIds };
}

function visibleFragmentAtomIds(mol, atomIds, selectedAtomIds) {
  const visibleAtomIds = new Set();
  for (const atomId of atomIds) {
    const atom = mol.atoms.get(atomId);
    if (!atom) {
      continue;
    }
    if (atom.visible !== false || selectedAtomIds?.has(atomId)) {
      visibleAtomIds.add(atomId);
    }
  }
  return visibleAtomIds;
}

function copiedBondOrderForAtom(mol, atomId, bondIds) {
  let bondOrder = 0;
  for (const bondId of bondIds) {
    const bond = mol.bonds.get(bondId);
    if (!bond || !bond.atoms.includes(atomId)) {
      continue;
    }
    bondOrder += Math.floor(bond.properties?.order ?? 1);
  }
  return bondOrder;
}

function carbonHydrogenCapCount(mol, atomId, bondIds) {
  const atom = mol.atoms.get(atomId);
  if (!atom || atom.name !== 'C' || atom.isAromatic?.()) {
    return 0;
  }
  const charge = atom.properties?.charge ?? 0;
  const radical = atom.properties?.radical ?? 0;
  const targetValence = 4 + getImplicitHydrogenChargeAdjustment(14, charge) - radical;
  return Math.max(0, targetValence - copiedBondOrderForAtom(mol, atomId, bondIds));
}

function uniqueFragmentId(prefix, usedIds) {
  let index = 1;
  let id = `${prefix}${index}`;
  while (usedIds.has(id)) {
    index++;
    id = `${prefix}${index}`;
  }
  usedIds.add(id);
  return id;
}

function createCarbonHydrogenCaps(mol, atomIds, bondIds, enabled) {
  if (!enabled) {
    return { atoms: [], bonds: [] };
  }
  const usedAtomIds = new Set(atomIds);
  const usedBondIds = new Set(bondIds);
  const atoms = [];
  const bonds = [];
  for (const atomId of atomIds) {
    const capCount = carbonHydrogenCapCount(mol, atomId, bondIds);
    if (capCount === 0) {
      continue;
    }
    const parent = mol.atoms.get(atomId);
    for (let index = 0; index < capCount; index++) {
      const hydrogenId = uniqueFragmentId(`__implicit_H_${atomId}_`, usedAtomIds);
      const bondId = uniqueFragmentId(`__implicit_H_bond_${atomId}_`, usedBondIds);
      atoms.push({
        id: hydrogenId,
        name: 'H',
        properties: { ...HYDROGEN_FRAGMENT_PROPERTIES },
        tags: [],
        visible: false,
        x: finiteOrNull(parent.x),
        y: finiteOrNull(parent.y),
        z: finiteOrNull(parent.z),
        dx: 0,
        dy: 0,
        dz: 0
      });
      bonds.push({
        id: bondId,
        atoms: [atomId, hydrogenId],
        properties: { order: 1 },
        tags: []
      });
    }
  }
  return { atoms, bonds };
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
 * @param {boolean} [options.includeAttachedHiddenHydrogens] - Includes/caps hydrogens attached to copied heavy atoms; defaults to true.
 * @param {Map<string, {x:number,y:number}>|null} [options.forceAtomPositions] - Optional force-layout atom positions to preserve for force paste previews.
 * @returns {object|null} Fragment payload, or null if no atoms are copyable.
 */
export function createMoleculeFragment(mol, options = {}) {
  if (!mol?.atoms || !mol?.bonds) {
    return null;
  }
  const { atomIds, bondIds, copyWholeMolecule, selectedAtomIds } = selectedFragmentIds(mol, options);
  if (atomIds.size === 0) {
    return null;
  }

  const visibleAtomIds = visibleFragmentAtomIds(mol, atomIds, selectedAtomIds);
  const center = computeCenter(mol, atomIds, visibleAtomIds);
  const forceAtomPositions = options.forceAtomPositions instanceof Map ? options.forceAtomPositions : null;
  const forceCenter = computePositionCenter(atomIds, forceAtomPositions, visibleAtomIds);
  const hydrogenCaps = createCarbonHydrogenCaps(mol, atomIds, bondIds, options.includeAttachedHiddenHydrogens !== false);
  const atoms = [...atomIds].map(id => {
    const atom = mol.atoms.get(id);
    const forcePoint = forceAtomPositions?.get(atom.id) ?? null;
    const atomX = finiteNumber(atom.x);
    const atomY = finiteNumber(atom.y);
    const atomZ = finiteNumber(atom.z);
    const forceX = finiteNumber(forcePoint?.x);
    const forceY = finiteNumber(forcePoint?.y);
    return {
      id: atom.id,
      name: atom.name,
      properties: clonePlain(atom.properties) ?? {},
      tags: [...(atom.tags ?? [])],
      visible: visibleAtomIds.has(atom.id),
      x: atomX,
      y: atomY,
      z: atomZ,
      dx: atomX != null ? atomX - center.x : 0,
      dy: atomY != null ? atomY - center.y : 0,
      dz: atomZ != null ? atomZ - center.z : 0,
      forceDx: forceCenter && forceX != null ? forceX - forceCenter.x : null,
      forceDy: forceCenter && forceY != null ? forceY - forceCenter.y : null
    };
  }).concat(hydrogenCaps.atoms);

  const bonds = [...bondIds].map(id => {
    const bond = mol.bonds.get(id);
    return {
      id: bond.id,
      atoms: [...bond.atoms],
      properties: clonePlain(bond.properties) ?? {},
      tags: [...(bond.tags ?? [])]
    };
  }).concat(hydrogenCaps.bonds);

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
  const centerX = finiteNumber(options.center?.x) ?? finiteNumber(fragment.center?.x) ?? 0;
  const centerY = finiteNumber(options.center?.y) ?? finiteNumber(fragment.center?.y) ?? 0;
  const centerZ = finiteNumber(options.center?.z) ?? finiteNumber(fragment.center?.z) ?? 0;
  const center = {
    x: centerX,
    y: centerY,
    z: centerZ
  };
  const atomIdMap = new Map();
  const bondIdMap = new Map();
  const addedAtomIds = [];
  const addedBondIds = [];

  for (const sourceAtom of fragment.atoms) {
    const atom = targetMol.addAtom(null, sourceAtom.name, clonePlain(sourceAtom.properties) ?? {}, { recompute: false });
    atom.tags = [...(sourceAtom.tags ?? [])];
    atom.visible = sourceAtom.visible !== false;
    atom.x = center.x + (finiteNumber(sourceAtom.dx) ?? 0);
    atom.y = center.y + (finiteNumber(sourceAtom.dy) ?? 0);
    atom.z = center.z + (finiteNumber(sourceAtom.dz) ?? 0);
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

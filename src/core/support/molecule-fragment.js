/** @module core/support/molecule-fragment */

import { Molecule } from '../Molecule.js';
import { getImplicitHydrogenChargeAdjustment } from '../Atom.js';
import elements from '../../data/elements.js';
import { DISPLAYED_STEREO_CARDINAL_AXIS_SECTOR_TOLERANCE, synthesizeDisplayedStereoHydrogenPosition } from '../../layout/engine/stereo/wedge-geometry.js';

const HYDROGEN_FRAGMENT_PROPERTIES = Object.freeze({
  ...elements.H,
  charge: 0,
  radical: 0,
  aromatic: false
});
const DEFAULT_HIDDEN_STEREO_HYDROGEN_BOND_LENGTH = 1.5 * 0.75;

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

function pointForAtom(atom, atomPositions = null) {
  const position = atomPositions?.get?.(atom?.id);
  const positionedX = finiteNumber(position?.x);
  const positionedY = finiteNumber(position?.y);
  if (positionedX != null && positionedY != null) {
    return {
      x: positionedX,
      y: positionedY,
      z: finiteNumber(atom?.z)
    };
  }
  const atomX = finiteNumber(atom?.x);
  const atomY = finiteNumber(atom?.y);
  if (atomX == null || atomY == null) {
    return null;
  }
  return {
    x: atomX,
    y: atomY,
    z: finiteNumber(atom?.z)
  };
}

function fragmentCoordinateAtoms(mol, atomIds, visibleAtomIds = null, atomPositions = null) {
  const centeredAtomIds = visibleAtomIds?.size > 0 ? visibleAtomIds : atomIds;
  const atoms = [...centeredAtomIds]
    .map(id => mol.atoms.get(id))
    .map(atom => ({ atom, point: pointForAtom(atom, atomPositions) }))
    .filter(entry => entry.atom && entry.point);
  return atoms.length > 0
    ? atoms
    : [...atomIds]
        .map(id => mol.atoms.get(id))
        .map(atom => ({ atom, point: pointForAtom(atom, atomPositions) }))
        .filter(entry => entry.atom && entry.point);
}

function computeCenter(mol, atomIds, visibleAtomIds = null, atomPositions = null) {
  const atoms = fragmentCoordinateAtoms(mol, atomIds, visibleAtomIds, atomPositions);
  let x = 0;
  let y = 0;
  let z = 0;
  let zCount = 0;
  let count = 0;
  for (const { point } of atoms) {
    const atomX = finiteNumber(point.x);
    const atomY = finiteNumber(point.y);
    const atomZ = finiteNumber(point.z);
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

function incidentRingPolygonsForAtom(mol, atomId) {
  return (mol.getRings?.() ?? [])
    .filter(ringAtomIds => ringAtomIds.includes(atomId))
    .map(ringAtomIds =>
      ringAtomIds
        .map(ringAtomId => pointForAtom(mol.atoms.get(ringAtomId)))
        .filter(Boolean)
        .map(point => ({ x: point.x, y: point.y }))
    )
    .filter(polygon => polygon.length >= 3);
}

function averagePlacedBondLength(mol) {
  let total = 0;
  let count = 0;
  for (const bond of mol?.bonds?.values?.() ?? []) {
    const atomA = mol.atoms.get(bond.atoms?.[0]);
    const atomB = mol.atoms.get(bond.atoms?.[1]);
    if (!atomA || !atomB || atomA.name === 'H' || atomB.name === 'H') {
      continue;
    }
    const pointA = pointForAtom(atomA);
    const pointB = pointForAtom(atomB);
    if (!pointA || !pointB) {
      continue;
    }
    const distance = Math.hypot(pointB.x - pointA.x, pointB.y - pointA.y);
    if (distance <= 1e-6) {
      continue;
    }
    total += distance;
    count++;
  }
  return count > 0 ? total / count : null;
}

function hiddenStereoHydrogenBondLength(mol, options = {}) {
  const configured = finiteNumber(options.hiddenStereoHydrogenBondLength);
  if (configured != null && configured > 0) {
    return configured;
  }
  const average = averagePlacedBondLength(mol);
  return average != null ? average * 0.75 : DEFAULT_HIDDEN_STEREO_HYDROGEN_BOND_LENGTH;
}

function hiddenStereoHydrogenDisplayPositions(mol, options = {}) {
  const positions = options.atomPositions instanceof Map ? new Map(options.atomPositions) : new Map();
  const bondLength = hiddenStereoHydrogenBondLength(mol, options);
  for (const atom of mol?.atoms?.values?.() ?? []) {
    if (atom.name !== 'H') {
      continue;
    }
    const neighbors = atom.getNeighbors?.(mol) ?? [];
    if (neighbors.length !== 1) {
      continue;
    }
    const parent = neighbors[0];
    if (!parent || !parent.getChirality?.()) {
      continue;
    }
    const parentPoint = pointForAtom(parent);
    const atomPoint = pointForAtom(atom);
    if (!parentPoint || !atomPoint) {
      continue;
    }
    const bond = mol.getBond?.(atom.id, parent.id);
    const hasDisplayedStereo = !!bond?.properties?.display?.as;
    const hasCoincidentCoords = Math.abs(atomPoint.x - parentPoint.x) <= 1e-6 && Math.abs(atomPoint.y - parentPoint.y) <= 1e-6;
    if (atom.visible !== false && !(hasDisplayedStereo && hasCoincidentCoords)) {
      continue;
    }
    const knownNeighbors = parent
      .getNeighbors(mol)
      .filter(neighbor => neighbor.id !== atom.id)
      .map(neighbor => pointForAtom(neighbor))
      .filter(Boolean)
      .map(point => ({ x: point.x, y: point.y }));
    const protectedAtomIds = new Set([atom.id, parent.id, ...parent.getNeighbors(mol).map(neighbor => neighbor.id)]);
    const avoidPositions = [...mol.atoms.values()]
      .filter(candidateAtom => !protectedAtomIds.has(candidateAtom.id) && candidateAtom.visible !== false)
      .map(candidateAtom => pointForAtom(candidateAtom))
      .filter(Boolean)
      .map(point => ({ x: point.x, y: point.y }));
    positions.set(
      atom.id,
      synthesizeDisplayedStereoHydrogenPosition(parentPoint, knownNeighbors, bondLength, {
        incidentRingPolygons: incidentRingPolygonsForAtom(mol, parent.id),
        avoidPositions,
        minimumAvoidanceDistance: bondLength * 0.45,
        cardinalAxisSectorTolerance: hasDisplayedStereo ? DISPLAYED_STEREO_CARDINAL_AXIS_SECTOR_TOLERANCE : undefined
      })
    );
  }
  return positions.size > 0 ? positions : null;
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
 * @param {Map<string, {x:number,y:number}>|null} [options.atomPositions] - Optional 2D/display atom positions to preserve for fragment geometry.
 * @param {Map<string, {x:number,y:number}>|null} [options.forceAtomPositions] - Optional force-layout atom positions to preserve for force paste previews.
 * @param {number} [options.hiddenStereoHydrogenBondLength] - Optional projected stereo-hydrogen display bond length.
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
  const atomPositions = hiddenStereoHydrogenDisplayPositions(mol, options);
  const center = computeCenter(mol, atomIds, visibleAtomIds, atomPositions);
  const forceAtomPositions = options.forceAtomPositions instanceof Map ? options.forceAtomPositions : null;
  const forceCenter = computePositionCenter(atomIds, forceAtomPositions, visibleAtomIds);
  const hydrogenCaps = createCarbonHydrogenCaps(mol, atomIds, bondIds, options.includeAttachedHiddenHydrogens !== false);
  const atoms = [...atomIds]
    .map(id => {
      const atom = mol.atoms.get(id);
      const atomPoint = pointForAtom(atom, atomPositions);
      const forcePoint = forceAtomPositions?.get(atom.id) ?? null;
      const atomX = finiteNumber(atomPoint?.x);
      const atomY = finiteNumber(atomPoint?.y);
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
    })
    .concat(hydrogenCaps.atoms);

  const bonds = [...bondIds]
    .map(id => {
      const bond = mol.bonds.get(id);
      return {
        id: bond.id,
        atoms: [...bond.atoms],
        properties: clonePlain(bond.properties) ?? {},
        tags: [...(bond.tags ?? [])]
      };
    })
    .concat(hydrogenCaps.bonds);

  const ringFills =
    typeof mol.getRingFills === 'function'
      ? mol
          .getRingFills()
          .filter(fill => (fill.atomIds ?? []).every(atomId => atomIds.has(atomId)))
          .map(fill => ({ ...fill, atomIds: [...fill.atomIds] }))
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

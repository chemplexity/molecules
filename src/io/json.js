/** @module io/json */

import { Molecule } from '../core/Molecule.js';

function clonePlain(value, fallback) {
  if (value === undefined) {
    return fallback;
  }
  return JSON.parse(JSON.stringify(value));
}

/**
 * Serialises a complete molecule document, including coordinates, metadata,
 * chemistry properties, and renderer-facing graphic properties.
 * @param {Molecule} molecule - The molecule graph.
 * @returns {string} The result string.
 */
export function toJSON(molecule) {
  return JSON.stringify({
    id: molecule.id,
    uuid: molecule.uuid,
    name: molecule.name,
    tags: clonePlain(molecule.tags, []),
    properties: clonePlain(molecule.properties, {}),
    atoms: [...molecule.atoms.entries()].map(([id, atom]) => ({
      id,
      uuid: atom.uuid,
      name: atom.name,
      tags: clonePlain(atom.tags, []),
      x: atom.x,
      y: atom.y,
      z: atom.z,
      visible: atom.visible,
      properties: clonePlain(atom.properties, {})
    })),
    bonds: [...molecule.bonds.entries()].map(([id, bond]) => ({
      id,
      uuid: bond.uuid,
      atoms: [...bond.atoms],
      tags: clonePlain(bond.tags, []),
      properties: clonePlain(bond.properties, {})
    }))
  });
}

/**
 * Deserialises a molecule from a JSON string produced by {@link toJSON}.
 * Existing minimal `{atoms, bonds}` documents remain supported.
 * @param {string} json - The json value.
 * @returns {Molecule} The resulting molecule.
 */
export function fromJSON(json) {
  const data = JSON.parse(json);
  if (!data || !Array.isArray(data.atoms) || !Array.isArray(data.bonds)) {
    throw new TypeError('Molecule JSON must contain atoms and bonds arrays.');
  }
  const mol = new Molecule(data.id ?? null);

  for (const a of data.atoms) {
    const properties = clonePlain(a.properties, {});
    const atom = mol.addAtom(a.id, a.name, properties, { recompute: false });
    Object.assign(atom.properties, properties);
    if (a.uuid != null) {
      atom.uuid = a.uuid;
    }
    atom.tags = clonePlain(a.tags, []);
    if ('x' in a) {
      atom.x = a.x;
    }
    if ('y' in a) {
      atom.y = a.y;
    }
    if ('z' in a) {
      atom.z = a.z;
    }
    if ('visible' in a) {
      atom.visible = a.visible;
    }
  }

  for (const b of data.bonds) {
    if (mol.atoms.has(b.atoms[0]) && mol.atoms.has(b.atoms[1])) {
      const properties = clonePlain(b.properties, {});
      const bond = mol.addBond(b.id ?? null, b.atoms[0], b.atoms[1], properties, false);
      Object.assign(bond.properties, properties);
      if (b.uuid != null) {
        bond.uuid = b.uuid;
      }
      bond.tags = clonePlain(b.tags, []);
    }
  }

  mol._recomputeProperties();
  if (data.uuid != null) {
    mol.uuid = data.uuid;
  }
  if ('name' in data) {
    mol.name = data.name;
  }
  mol.tags = clonePlain(data.tags, []);
  if (data.properties && typeof data.properties === 'object') {
    mol.properties = clonePlain(data.properties, {});
  }
  return mol;
}

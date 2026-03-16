/** @module io/json */

import { Molecule } from '../core/Molecule.js';

/**
 * Serialises a molecule to a plain JSON string.
 *
 * @param {Molecule} molecule
 * @returns {string}
 */
export function toJSON(molecule) {
  return JSON.stringify({
    atoms: [...molecule.atoms.entries()].map(([id, atom]) => ({
      id,
      name: atom.name,
      bonds: atom.bonds,
      properties: atom.properties
    })),
    bonds: [...molecule.bonds.entries()].map(([id, bond]) => ({
      id,
      atoms: bond.atoms,
      properties: bond.properties
    }))
  });
}

/**
 * Deserialises a molecule from a JSON string produced by {@link toJSON}.
 *
 * @param {string} json
 * @returns {Molecule}
 */
export function fromJSON(json) {
  const data = JSON.parse(json);
  const mol = new Molecule();

  for (const a of data.atoms) {
    mol.addAtom(a.id, a.name, a.properties ?? {});
  }

  for (const b of data.bonds) {
    if (mol.atoms.has(b.atoms[0]) && mol.atoms.has(b.atoms[1])) {
      mol.addBond(b.id, b.atoms[0], b.atoms[1], b.properties ?? {});
    }
  }

  return mol;
}

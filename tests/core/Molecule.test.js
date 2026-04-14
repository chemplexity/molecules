import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Molecule } from '../../src/core/Molecule.js';

describe('Molecule.resetIds', () => {
  it('normalizes atom and bond string IDs to an integer sequence', () => {
    const mol = new Molecule();

    // Add atoms with messy namespace IDs typical of SMIRKS transformations
    mol.addAtom('_rxn_product__0:C1', 'C');
    mol.addAtom('_rxn_product__0:O2', 'O');
    mol.addAtom('_rxn_product__0:H3', 'H');

    // Add bonds with messy namespace IDs
    mol.addBond('weird_bond_1', '_rxn_product__0:C1', '_rxn_product__0:O2', {}, false);
    mol.addBond('weird_bond_2', '_rxn_product__0:O2', '_rxn_product__0:H3', {}, false);

    mol.resetIds();

    const atomIds = Array.from(mol.atoms.keys()).sort();
    const bondIds = Array.from(mol.bonds.keys()).sort();

    assert.deepEqual(atomIds, ['0', '1', '2']);
    assert.deepEqual(bondIds, ['0', '1']);

    const c = mol.atoms.get('0');
    const o = mol.atoms.get('1');
    const h = mol.atoms.get('2');

    // Ensure ids on the objects themselves are updated
    assert.equal(c.id, '0');
    assert.equal(o.id, '1');
    assert.equal(h.id, '2');

    // Ensure atom.bonds references are updated
    assert.deepEqual(c.bonds, ['0']);
    assert.deepEqual(o.bonds.sort(), ['0', '1']);
    assert.deepEqual(h.bonds, ['1']);

    const b0 = mol.bonds.get('0');
    const b1 = mol.bonds.get('1');

    // Ensure bond ids and bond.atoms references are updated
    assert.equal(b0.id, '0');
    assert.equal(b1.id, '1');
    assert.deepEqual(b0.atoms, ['0', '1']);
    assert.deepEqual(b1.atoms, ['1', '2']);

    // Ensure next generator IDs are properly advanced
    assert.equal(mol._nextAtomId, 3);
    assert.equal(mol._nextBondId, 2);

    // Ensure the internal index rebuilt its keys
    assert.equal(mol._bondIndex.get('0,1'), '0');
    assert.equal(mol._bondIndex.get('1,2'), '1');
  });
});

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { createMoleculeFragment, instantiateMoleculeFragment, mergeMoleculeFragment } from '../../src/core/molecule-fragment.js';
import { parseSMILES } from '../../src/io/smiles.js';

describe('molecule fragments', () => {
  it('copies a selected subgraph with inter-selected bonds and fresh ids', () => {
    const mol = parseSMILES('CCO');
    mol.atoms.get('C1').x = 0;
    mol.atoms.get('C1').y = 0;
    mol.atoms.get('C2').x = 1.5;
    mol.atoms.get('C2').y = 0;
    mol.atoms.get('O3').x = 3;
    mol.atoms.get('O3').y = 0;

    const fragment = createMoleculeFragment(mol, { atomIds: ['C1', 'C2'], includeAttachedHiddenHydrogens: false });
    assert.deepEqual(
      fragment.atoms.map(atom => atom.id),
      ['C1', 'C2']
    );
    assert.equal(fragment.bonds.length, 1);

    const pasted = mergeMoleculeFragment(mol, fragment, { center: { x: 10, y: 5 } });

    assert.notEqual(pasted.atomIdMap.get('C1'), 'C1');
    assert.notEqual(pasted.bondIdMap.get(fragment.bonds[0].id), fragment.bonds[0].id);
    assert.equal(pasted.mol.atoms.get(pasted.atomIdMap.get('C1')).x, 9.25);
    assert.equal(pasted.mol.atoms.get(pasted.atomIdMap.get('C2')).x, 10.75);
    assert.equal(pasted.mol.atoms.get(pasted.atomIdMap.get('C1')).y, 5);
  });

  it('copies the full molecule when no selection is provided', () => {
    const mol = parseSMILES('CCO');
    const fragment = createMoleculeFragment(mol);

    assert.equal(fragment.copyWholeMolecule, true);
    assert.equal(fragment.atoms.length, mol.atoms.size);
    assert.equal(fragment.bonds.length, mol.bonds.size);
  });

  it('merges fragments into an existing molecule without colliding with existing ids', () => {
    const target = parseSMILES('C');
    const source = parseSMILES('CO');
    source.atoms.get('C1').x = -1;
    source.atoms.get('C1').y = 0;
    source.atoms.get('O2').x = 1;
    source.atoms.get('O2').y = 0;
    const fragment = createMoleculeFragment(source, { includeAttachedHiddenHydrogens: false });

    const result = mergeMoleculeFragment(target, fragment, { center: { x: 4, y: 2 } });

    assert.equal(target.atoms.has('C1'), true);
    assert.equal(result.atomIds.length, fragment.atoms.length);
    assert.equal(new Set(result.atomIds).size, result.atomIds.length);
    assert.equal(result.atomIds.includes('C1'), false);
    assert.equal(target.bonds.has(result.bondIds[0]), true);
  });

  it('preserves copied atom, bond, and ring-fill styles with remapped atom ids', () => {
    const mol = parseSMILES('C1CCCCC1');
    for (const [index, atom] of [...mol.atoms.values()].entries()) {
      atom.x = Math.cos((index / 6) * Math.PI * 2);
      atom.y = Math.sin((index / 6) * Math.PI * 2);
    }
    mol.atoms.get('C1').setStyle({ color: '#ff0000', opacity: 0.5 });
    mol.bonds.get('1').setStyle({ color: '#00ff00', opacity: 0.4 });
    mol.setRingFill(['C1', 'C2', 'C3', 'C4', 'C5', 'C6'], { color: '#3366ff', opacity: 0.25 });

    const fragment = createMoleculeFragment(mol, { includeAttachedHiddenHydrogens: false });
    const pasted = instantiateMoleculeFragment(fragment, { center: { x: 0, y: 0 } });
    const remappedC1 = pasted.atomIdMap.get('C1');
    const remappedBond = pasted.bondIdMap.get('1');

    assert.deepEqual(pasted.mol.atoms.get(remappedC1).properties.style, { color: '#ff0000', opacity: 0.5 });
    assert.deepEqual(pasted.mol.bonds.get(remappedBond).properties.style, { color: '#00ff00', opacity: 0.4 });
    assert.equal(pasted.mol.getRingFills().length, 1);
    assert.equal(pasted.mol.getRingFills()[0].atomIds.includes(remappedC1), true);
  });
});

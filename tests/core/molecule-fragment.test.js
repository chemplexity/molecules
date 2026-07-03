import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { createMoleculeFragment, instantiateMoleculeFragment, mergeMoleculeFragment } from '../../src/core/molecule-fragment.js';
import { parseSMILES } from '../../src/io/smiles.js';
import { validateValence } from '../../src/validation/valence.js';

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

  it('preserves fragment offsets when source coordinates are numeric strings', () => {
    const mol = parseSMILES('CC');
    mol.atoms.get('C1').x = '0';
    mol.atoms.get('C1').y = '0';
    mol.atoms.get('C2').x = '1.5';
    mol.atoms.get('C2').y = '0';

    const fragment = createMoleculeFragment(mol, { atomIds: ['C1', 'C2'], includeAttachedHiddenHydrogens: false });
    const copiedC1 = fragment.atoms.find(atom => atom.id === 'C1');
    const copiedC2 = fragment.atoms.find(atom => atom.id === 'C2');
    const pasted = instantiateMoleculeFragment(fragment, { center: { x: '10', y: '5' } });

    assert.equal(copiedC1.dx, -0.75);
    assert.equal(copiedC2.dx, 0.75);
    assert.equal(pasted.mol.atoms.get(pasted.atomIdMap.get('C1')).x, 9.25);
    assert.equal(pasted.mol.atoms.get(pasted.atomIdMap.get('C2')).x, 10.75);
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

  it('centers fragments on visible atoms while carrying hidden hydrogens for labels', () => {
    const mol = parseSMILES('c1ccc2[nH]ccc2c1');
    mol.atoms.get('N5').x = 10;
    mol.atoms.get('N5').y = 20;
    mol.atoms.get('H6').x = 10;
    mol.atoms.get('H6').y = 21;

    const fragment = createMoleculeFragment(mol, { atomIds: ['N5'] });
    const copiedNitrogen = fragment.atoms.find(atom => atom.id === 'N5');
    const copiedHydrogen = fragment.atoms.find(atom => atom.id === 'H6');

    assert.equal(copiedNitrogen.visible, true);
    assert.equal(copiedHydrogen.visible, false);
    assert.equal(copiedNitrogen.dx, 0);
    assert.equal(copiedNitrogen.dy, 0);
    assert.equal(copiedHydrogen.dx, 0);
    assert.equal(copiedHydrogen.dy, 1);
  });

  it('keeps explicitly copied hidden hydrogens visible in the fragment', () => {
    const mol = parseSMILES('c1ccc2[nH]ccc2c1');
    mol.atoms.get('H6').x = 2;
    mol.atoms.get('H6').y = 3;

    const fragment = createMoleculeFragment(mol, { atomIds: ['H6'] });
    const copiedHydrogen = fragment.atoms.find(atom => atom.id === 'H6');

    assert.equal(copiedHydrogen.visible, true);
    assert.equal(copiedHydrogen.dx, 0);
    assert.equal(copiedHydrogen.dy, 0);
  });

  it('copies displayed stereo hydrogens at their projected endpoint instead of the parent coordinate', () => {
    const mol = parseSMILES('C[C@H](F)Cl');
    mol.atoms.get('C1').x = -1.5;
    mol.atoms.get('C1').y = 0;
    mol.atoms.get('C2').x = 0;
    mol.atoms.get('C2').y = 0;
    mol.atoms.get('H3').x = 0;
    mol.atoms.get('H3').y = 0;
    mol.atoms.get('F4').x = 0.75;
    mol.atoms.get('F4').y = 1.3;
    mol.atoms.get('Cl5').x = 0.75;
    mol.atoms.get('Cl5').y = -1.3;
    mol.atoms.get('H3').visible = true;
    mol.getBond('C2', 'H3').properties.display = { as: 'wedge', centerId: 'C2' };

    const fragment = createMoleculeFragment(mol, { atomIds: ['C2', 'H3'], includeAttachedHiddenHydrogens: false });
    const copiedCenter = fragment.atoms.find(atom => atom.id === 'C2');
    const copiedHydrogen = fragment.atoms.find(atom => atom.id === 'H3');
    const pasted = instantiateMoleculeFragment(fragment, { center: { x: 10, y: 10 } });
    const pastedCenter = pasted.mol.atoms.get(pasted.atomIdMap.get('C2'));
    const pastedHydrogen = pasted.mol.atoms.get(pasted.atomIdMap.get('H3'));

    assert.equal(copiedHydrogen.visible, true);
    assert.ok(Math.hypot(copiedHydrogen.x - copiedCenter.x, copiedHydrogen.y - copiedCenter.y) > 0.5);
    assert.ok(Math.hypot(pastedHydrogen.x - pastedCenter.x, pastedHydrogen.y - pastedCenter.y) > 0.5);
  });

  it('preserves force-layout offsets for copied hydrogens', () => {
    const mol = parseSMILES('c1ccc2[nH]ccc2c1');
    mol.atoms.get('N5').x = 0;
    mol.atoms.get('N5').y = 0;
    mol.atoms.get('H6').x = 0;
    mol.atoms.get('H6').y = 0;

    const fragment = createMoleculeFragment(mol, {
      atomIds: ['N5'],
      forceAtomPositions: new Map([
        ['N5', { x: 120, y: 80 }],
        ['H6', { x: 120, y: 55 }]
      ])
    });
    const copiedNitrogen = fragment.atoms.find(atom => atom.id === 'N5');
    const copiedHydrogen = fragment.atoms.find(atom => atom.id === 'H6');

    assert.equal(copiedNitrogen.forceDx, 0);
    assert.equal(copiedNitrogen.forceDy, 0);
    assert.equal(copiedHydrogen.forceDx, 0);
    assert.equal(copiedHydrogen.forceDy, -25);
  });

  it('caps copied carbon fragments with hidden hydrogens so pasted carbons are valence-complete', () => {
    const mol = parseSMILES('CCC');
    mol.atoms.get('C1').x = 0;
    mol.atoms.get('C1').y = 0;
    mol.atoms.get('C2').x = 1.5;
    mol.atoms.get('C2').y = 0;

    const fragment = createMoleculeFragment(mol, { atomIds: ['C1', 'C2'] });
    const carbonCapAtoms = fragment.atoms.filter(atom => atom.name === 'H' && atom.visible === false);
    const pasted = instantiateMoleculeFragment(fragment, { center: { x: 0, y: 0 } });
    const pastedWarningAtomIds = new Set(validateValence(pasted.mol).map(warning => warning.atomId));

    assert.equal(carbonCapAtoms.length, 6);
    for (const atom of carbonCapAtoms) {
      assert.equal(atom.properties.protons, 1);
      assert.equal(atom.properties.electrons, 1);
    }
    for (const atomId of pasted.atomIds) {
      const atom = pasted.mol.atoms.get(atomId);
      if (atom.name === 'C') {
        assert.equal(pastedWarningAtomIds.has(atomId), false);
      }
    }
  });
});

import test from 'node:test';
import assert from 'node:assert/strict';

import { parseSMILES } from '../../src/io/smiles.js';
import { applyCoords } from '../../src/layout/engine/apply.js';
import { generateCoords } from '../../src/layout/engine/api.js';
import { labelHalfH, syncDisplayStereo } from '../../src/layout/mol2d-helpers.js';

test('labelHalfH reserves extra descent for subscripted atom labels', () => {
  assert.ok(labelHalfH('NH2', 11) > labelHalfH('NH', 11));
  assert.ok(labelHalfH('CH3', 14) > labelHalfH('CH', 14));
});

test('syncDisplayStereo uses distinct bonds for adjacent hidden-hydrogen stereocenters', () => {
  const mol = parseSMILES('CCCN(CCC)C(=O)c1cc(C)cc(c1)C(=O)N[C@@H](Cc2cc(F)cc(F)c2)[C@H](O)[C@@H]3NCCN(Cc4ccccc4)C3=O');
  const layoutResult = generateCoords(mol, { suppressH: true, bondLength: 1.5 });
  applyCoords(mol, layoutResult, {
    clearUnplaced: true,
    hiddenHydrogenMode: 'coincident'
  });
  mol.hideHydrogens();

  const stereoMap = syncDisplayStereo(mol);
  const assignments = [...mol.bonds.values()]
    .filter(bond => bond.properties.display?.as === 'wedge' || bond.properties.display?.as === 'dash')
    .map(bond => ({
      bondId: bond.id,
      type: bond.properties.display.as,
      centerId: bond.properties.display.centerId
    }));
  const assignmentByCenter = new Map(assignments.map(assignment => [assignment.centerId, assignment]));

  assert.equal(stereoMap.size, 3);
  assert.equal(assignments.length, 3);
  assert.notEqual(assignmentByCenter.get('C31')?.bondId, assignmentByCenter.get('C34')?.bondId);
});

test('syncDisplayStereo prefers a visible heavy substituent over a hidden stereochemical hydrogen', () => {
  const mol = parseSMILES('C[C@H](F)Cl');
  const layoutResult = generateCoords(mol, { suppressH: true, bondLength: 1.5 });
  applyCoords(mol, layoutResult, {
    clearUnplaced: true,
    hiddenHydrogenMode: 'coincident'
  });
  mol.hideHydrogens();

  const stereoMap = syncDisplayStereo(mol);

  assert.equal(stereoMap.size, 1);
  const [bondId] = [...stereoMap.keys()];
  assert.notEqual(bondId, '3');
  assert.equal(mol.bonds.get(bondId).properties.display?.centerId, 'C2');
  assert.equal(mol.bonds.get('3').properties.display, undefined);
});

test('syncDisplayStereo drops stale automatic wedges after a center stops being stereogenic', () => {
  const mol = parseSMILES('C([C@@H]1[C@H]([C@@H]([C@H](C(O1)O)O)O)O)O');
  const layoutResult = generateCoords(mol, { suppressH: true, bondLength: 1.5 });
  applyCoords(mol, layoutResult, {
    clearUnplaced: true,
    hiddenHydrogenMode: 'coincident',
    syncStereoDisplay: true
  });
  const previousStereoMap = syncDisplayStereo(mol);
  assert.ok(mol.bonds.get('7').properties.display?.centerId === 'C8');
  assert.ok(mol.bonds.get('8').properties.display?.centerId === 'C6');

  const editedBond = mol.getBond('C6', 'C8');
  editedBond.properties.order = 2;
  editedBond.properties.aromatic = false;
  mol.clearStereoAnnotations(editedBond.atoms);
  const nextStereoMap = syncDisplayStereo(mol, previousStereoMap);

  assert.equal(mol.atoms.get('C6').getChirality(), null);
  assert.equal(mol.atoms.get('C8').getChirality(), null);
  assert.equal(mol.bonds.get('7').properties.display, undefined);
  assert.equal(mol.bonds.get('8').properties.display, undefined);
  assert.deepEqual(
    [...nextStereoMap.entries()].sort(),
    [
      ['0', 'dash'],
      ['9', 'wedge']
    ]
  );
});

test('syncDisplayStereo preserves projected metal wedge and dash hints for 2D cobalt rendering', () => {
  const mol = parseSMILES('[Co+3](N)(N)(N)(N)(N)N');
  const layoutResult = generateCoords(mol, { suppressH: true, bondLength: 1.5 });
  applyCoords(mol, layoutResult, {
    clearUnplaced: true,
    hiddenHydrogenMode: 'coincident',
    syncStereoDisplay: true
  });

  const before = [...mol.bonds.values()]
    .filter(bond => bond.properties.display?.as === 'wedge' || bond.properties.display?.as === 'dash')
    .map(bond => [bond.id, bond.properties.display.as, bond.properties.display.centerId])
    .sort();
  const stereoMap = syncDisplayStereo(mol);
  const after = [...mol.bonds.values()]
    .filter(bond => bond.properties.display?.as === 'wedge' || bond.properties.display?.as === 'dash')
    .map(bond => [bond.id, bond.properties.display.as, bond.properties.display.centerId])
    .sort();

  assert.equal(before.length, 4);
  assert.deepEqual(after, before);
  assert.deepEqual([...stereoMap.entries()].sort(), before.map(([bondId, type]) => [bondId, type]).sort());
});

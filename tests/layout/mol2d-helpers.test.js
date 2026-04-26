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

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { applyCoords } from '../../src/layoutv2/apply.js';
import { generateCoords, refineCoords } from '../../src/layoutv2/api.js';
import {
  makeEthane,
  makeHiddenHydrogenStereocenter,
  makeProjectedOctahedralCobaltComplex,
  makeProjectedTetrahedralZincComplex
} from './support/molecules.js';

describe('layoutv2/apply', () => {
  it('applies a full layout result onto molecule atom coordinates', () => {
    const molecule = makeEthane();
    const result = generateCoords(molecule);
    const summary = applyCoords(molecule, result);

    assert.equal(summary.appliedAtomCount, 2);
    const xs = [molecule.atoms.get('a0').x, molecule.atoms.get('a1').x].sort((firstValue, secondValue) => firstValue - secondValue);
    const ys = [molecule.atoms.get('a0').y, molecule.atoms.get('a1').y];
    assert.deepEqual(xs, [0, 1.5]);
    assert.deepEqual([...new Set(ys)], [0]);
  });

  it('preserves existing coordinates for untouched atoms during refinement application', () => {
    const molecule = makeEthane();
    molecule.atoms.get('a0').x = 9;
    molecule.atoms.get('a0').y = 4;
    molecule.atoms.get('a1').x = 11;
    molecule.atoms.get('a1').y = 4;
    const result = refineCoords(molecule, {
      existingCoords: new Map([['a0', { x: 0, y: 0 }]]),
      touchedAtoms: new Set(['a0'])
    });
    result.coords = new Map([['a0', { x: 1, y: 2 }]]);

    const summary = applyCoords(molecule, result);
    assert.equal(summary.appliedAtomCount, 1);
    assert.equal(summary.preservedAtomCount, 1);
    assert.deepEqual({ x: molecule.atoms.get('a0').x, y: molecule.atoms.get('a0').y }, { x: 1, y: 2 });
    assert.deepEqual({ x: molecule.atoms.get('a1').x, y: molecule.atoms.get('a1').y }, { x: 11, y: 4 });
  });

  it('can clear stale coordinates for atoms omitted from the incoming map', () => {
    const molecule = makeEthane();
    molecule.atoms.get('a0').x = 9;
    molecule.atoms.get('a0').y = 4;
    molecule.atoms.get('a1').x = 11;
    molecule.atoms.get('a1').y = 4;

    const summary = applyCoords(molecule, new Map([['a0', { x: 1, y: 2 }]]), {
      clearUnplaced: true
    });

    assert.equal(summary.appliedAtomCount, 1);
    assert.equal(summary.clearedAtomCount, 1);
    assert.deepEqual({ x: molecule.atoms.get('a0').x, y: molecule.atoms.get('a0').y }, { x: 1, y: 2 });
    assert.equal(molecule.atoms.get('a1').x, null);
    assert.equal(molecule.atoms.get('a1').y, null);
  });

  it('can place hidden hydrogens coincident with their parent atom', () => {
    const molecule = makeHiddenHydrogenStereocenter();
    const summary = applyCoords(molecule, new Map([
      ['c0', { x: 0, y: 0 }],
      ['f0', { x: 1.4, y: 0.1 }],
      ['cl0', { x: -0.6, y: 1.2 }],
      ['br0', { x: -1.1, y: -0.8 }]
    ]), {
      hiddenHydrogenMode: 'coincident'
    });

    assert.equal(summary.appliedAtomCount, 5);
    assert.deepEqual(
      { x: molecule.atoms.get('h0').x, y: molecule.atoms.get('h0').y },
      { x: molecule.atoms.get('c0').x, y: molecule.atoms.get('c0').y }
    );
  });

  it('can sync renderer-facing stereo display assignments from applied coordinates', () => {
    const molecule = makeHiddenHydrogenStereocenter();
    const summary = applyCoords(molecule, new Map([
      ['c0', { x: 0, y: 0 }],
      ['f0', { x: 1.4, y: 0.1 }],
      ['cl0', { x: -0.6, y: 1.2 }],
      ['br0', { x: -1.1, y: -0.8 }]
    ]), {
      syncStereoDisplay: true
    });

    assert.equal(summary.stereoBondCount, 1);
    const [bondId, type] = [...summary.stereoMap.entries()][0];
    assert.ok(type === 'wedge' || type === 'dash');
    const bond = molecule.bonds.get(bondId);
    assert.ok(bond.properties.display);
    assert.equal(bond.properties.display.centerId, 'c0');
  });

  it('can sync renderer-facing projected metal wedge and dash assignments from a layout result', () => {
    const molecule = makeProjectedTetrahedralZincComplex();
    const result = generateCoords(molecule, { suppressH: true });
    const summary = applyCoords(molecule, result, {
      syncStereoDisplay: true
    });
    const projectedAssignments = [...summary.stereoMap.entries()]
      .filter(([, type]) => type === 'wedge' || type === 'dash');

    assert.equal(result.metadata.displayAssignmentCount, 2);
    assert.equal(projectedAssignments.length, 2);
    assert.deepEqual(
      projectedAssignments.map(([, type]) => type).sort(),
      ['dash', 'wedge']
    );
    for (const [bondId] of projectedAssignments) {
      const bond = molecule.bonds.get(bondId);
      assert.equal(bond.properties.display.centerId, 'Zn1');
    }
  });

  it('can sync renderer-facing projected octahedral metal wedge and dash assignments from a layout result', () => {
    const molecule = makeProjectedOctahedralCobaltComplex();
    const result = generateCoords(molecule, { suppressH: true });
    const summary = applyCoords(molecule, result, {
      syncStereoDisplay: true
    });
    const projectedAssignments = [...summary.stereoMap.entries()]
      .filter(([, type]) => type === 'wedge' || type === 'dash');

    assert.equal(result.metadata.displayAssignmentCount, 2);
    assert.equal(projectedAssignments.length, 2);
    assert.deepEqual(
      projectedAssignments.map(([, type]) => type).sort(),
      ['dash', 'wedge']
    );
    for (const [bondId] of projectedAssignments) {
      const bond = molecule.bonds.get(bondId);
      assert.equal(bond.properties.display.centerId, 'Co1');
    }
  });
});

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Molecule } from '../../../src/core/index.js';
import { createLayoutBond } from '../../../src/layoutv2/model/layout-bond.js';
import { makeCyclohexane } from '../support/molecules.js';

describe('layoutv2/model/layout-bond', () => {
  it('creates a layout-oriented bond descriptor and clones display hints', () => {
    const molecule = new Molecule();
    molecule.addAtom('a0', 'C');
    molecule.addAtom('a1', 'N');
    const bond = molecule.addBond('b0', 'a0', 'a1', {
      order: 2,
      stereo: '/',
      kind: 'coordinate',
      display: { as: 'wedge', centerId: 'a0', manual: true }
    }, false);
    const layoutBond = createLayoutBond(bond, molecule);
    assert.equal(layoutBond.id, 'b0');
    assert.equal(layoutBond.a, 'a0');
    assert.equal(layoutBond.b, 'a1');
    assert.equal(layoutBond.order, 2);
    assert.equal(layoutBond.stereo, '/');
    assert.equal(layoutBond.kind, 'coordinate');
    assert.equal(layoutBond.inRing, false);
    assert.deepEqual(layoutBond.displayHint, { as: 'wedge', centerId: 'a0', manual: true });
    layoutBond.displayHint.as = 'dash';
    assert.equal(bond.properties.display.as, 'wedge');
  });

  it('marks ring bonds as in-ring', () => {
    const molecule = makeCyclohexane();
    const bond = molecule.bonds.get('b0');
    assert.equal(createLayoutBond(bond, molecule).inRing, true);
  });
});

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { assignComponentRoles, getConnectedComponents } from '../../../src/layoutv2/topology/components.js';
import { computeCanonicalAtomRanks } from '../../../src/layoutv2/topology/canonical-order.js';
import { makeEthane } from '../support/molecules.js';

describe('layoutv2/topology/components', () => {
  it('collects connected components with stable ordering and signatures', () => {
    const molecule = makeEthane();
    molecule.addAtom('na', 'Na', { charge: 1 });
    const components = getConnectedComponents(molecule, computeCanonicalAtomRanks(molecule));
    assert.equal(components.length, 2);
    assert.deepEqual(components[0].atomIds, ['a0', 'a1']);
    assert.equal(components[0].heavyAtomCount, 2);
    assert.deepEqual(components[1].atomIds, ['na']);
    assert.equal(components[1].netCharge, 1);
    assert.match(components[0].canonicalSignature, /^2\|/);
  });

  it('assigns principal, counter-ion, solvent-like, and spectator roles', () => {
    const components = assignComponentRoles([
      { id: 0, heavyAtomCount: 8, netCharge: 0, atomIds: ['a0'] },
      { id: 1, heavyAtomCount: 1, netCharge: -1, atomIds: ['a1'] },
      { id: 2, heavyAtomCount: 1, netCharge: 0, atomIds: ['a2'] },
      { id: 3, heavyAtomCount: 4, netCharge: 0, atomIds: ['a3'] }
    ]);
    assert.deepEqual(components.map(component => component.role), ['principal', 'counter-ion', 'solvent-like', 'spectator']);
  });
});

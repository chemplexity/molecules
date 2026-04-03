import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { parseSMILES } from '../../src/io/index.js';
import { generateResonanceStructures } from '../../src/algorithms/index.js';
import { prepareResonanceStateForStructuralEdit, shouldPreserveResonanceForClickTarget } from '../../src/app/render/resonance.js';

function mockTarget(matches = new Set()) {
  return {
    closest(selector) {
      return selector
        .split(',')
        .map(part => part.trim())
        .some(part => matches.has(part))
        ? {}
        : null;
    }
  };
}

describe('shouldPreserveResonanceForClickTarget', () => {
  it('preserves resonance view for toolbar mode controls like pan/select/erase', () => {
    assert.equal(shouldPreserveResonanceForClickTarget(mockTarget(new Set(['#clean-controls']))), true);
  });

  it('preserves resonance view for plot interactions like selecting atoms or regions', () => {
    assert.equal(shouldPreserveResonanceForClickTarget(mockTarget(new Set(['#plot']))), true);
  });

  it('preserves resonance view for draw tools and atom palette clicks', () => {
    assert.equal(shouldPreserveResonanceForClickTarget(mockTarget(new Set(['#draw-tools']))), true);
    assert.equal(shouldPreserveResonanceForClickTarget(mockTarget(new Set(['#atom-selector']))), true);
  });

  it('preserves resonance view for clicks inside the resonance table itself', () => {
    assert.equal(shouldPreserveResonanceForClickTarget(mockTarget(new Set(['#resonance-table']))), true);
  });

  it('allows ordinary outside clicks to reset the active resonance view', () => {
    assert.equal(shouldPreserveResonanceForClickTarget(mockTarget()), false);
  });
});

describe('prepareResonanceStateForStructuralEdit', () => {
  it('clears stale resonance tables before a structural edit starts', () => {
    const mol = parseSMILES('CC=O');
    generateResonanceStructures(mol);
    mol.setResonanceState(2);

    const result = prepareResonanceStateForStructuralEdit(mol);

    assert.equal(result.resonanceCleared, true);
    assert.equal(!!mol.properties.resonance, false);

    const carbonyl = [...mol.bonds.values()].find(bond => {
      const [a1, a2] = bond.getAtomObjects(mol);
      return (a1.name === 'C' && a2.name === 'O') || (a1.name === 'O' && a2.name === 'C');
    });
    assert.ok(carbonyl);
    assert.equal(carbonyl.properties.order, 2);
  });
});

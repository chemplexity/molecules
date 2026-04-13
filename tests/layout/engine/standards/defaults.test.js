import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { defaultPolicy } from '../../../../src/layout/engine/standards/defaults.js';

describe('layout/engine/standards/defaults', () => {
  it('returns the expected default standards-inspired policy bundle', () => {
    assert.deepEqual(defaultPolicy(), {
      preferredBondAngleFamily: 'standard',
      allowRingDistortion: false,
      bridgedMode: 'template-first',
      macrocycleMode: 'ellipse',
      orientationBias: 'horizontal',
      labelClearanceMode: 'estimate',
      stereoPriority: 'readability',
      fragmentPackingMode: 'principal-right',
      organometallicMode: 'ligand-first',
      postCleanupHooks: []
    });
  });

  it('returns a fresh policy object on each call', () => {
    const first = defaultPolicy();
    const second = defaultPolicy();
    first.orientationBias = 'reaction-flow';
    assert.equal(second.orientationBias, 'horizontal');
  });
});

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolvePolicy } from '../../../src/layoutv2/standards/profile-policy.js';

describe('layoutv2/standards/profile-policy', () => {
  it('returns profile-specific policy adjustments', () => {
    assert.equal(resolvePolicy('macrocycle').macrocycleMode, 'ellipse');
    assert.equal(resolvePolicy('reaction-fragment').orientationBias, 'reaction-flow');
    assert.equal(resolvePolicy('large-molecule').fragmentPackingMode, 'principal-auto');
  });

  it('applies trait-driven fragment and organometallic overrides', () => {
    const policy = resolvePolicy('organic-publication', {
      containsMetal: true,
      hasDisconnectedComponents: true,
      principalIsTall: true
    });
    assert.equal(policy.organometallicMode, 'ligand-first');
    assert.equal(policy.fragmentPackingMode, 'principal-below');
  });
});

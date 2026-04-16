import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolvePolicy } from '../../../../src/layout/engine/standards/profile-policy.js';

describe('layout/engine/standards/profile-policy', () => {
  it('returns profile-specific policy adjustments', () => {
    assert.equal(resolvePolicy('macrocycle').macrocycleMode, 'ellipse');
    assert.deepEqual(resolvePolicy('macrocycle').postCleanupHooks, ['ring-perimeter-correction', 'ring-terminal-hetero-tidy']);
    assert.deepEqual(resolvePolicy('organometallic').postCleanupHooks, ['ligand-angle-tidy']);
    assert.equal(resolvePolicy('reaction-fragment').orientationBias, 'reaction-flow');
    assert.equal(resolvePolicy('large-molecule').fragmentPackingMode, 'principal-auto');
  });

  it('applies trait-driven fragment and organometallic overrides', () => {
    const policy = resolvePolicy('organic-publication', {
      primaryFamily: 'macrocycle',
      containsMetal: true,
      containsOrthogonalHypervalentCenter: true,
      hasDisconnectedComponents: true,
      principalIsTall: true
    });
    assert.deepEqual(policy.postCleanupHooks.sort(), ['hypervalent-angle-tidy', 'ligand-angle-tidy', 'ring-perimeter-correction', 'ring-terminal-hetero-tidy']);
    assert.equal(policy.organometallicMode, 'ligand-first');
    assert.equal(policy.fragmentPackingMode, 'principal-below');
  });
});

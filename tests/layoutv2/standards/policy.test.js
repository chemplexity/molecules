import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { resolvePolicy } from '../../../src/layoutv2/standards/policy.js';

describe('layoutv2/standards/policy', () => {
  it('resolves a standards-inspired policy bundle from profile and traits', () => {
    const policy = resolvePolicy('organic-publication', {
      primaryFamily: 'bridged',
      containsMetal: false,
      hasDisconnectedComponents: true,
      principalIsTall: true
    });

    assert.equal(policy.bridgedMode, 'template-first');
    assert.equal(policy.fragmentPackingMode, 'principal-below');
  });

  it('keeps ligand-first handling for organometallic cases', () => {
    const policy = resolvePolicy('organic-publication', {
      containsMetal: true
    });

    assert.equal(policy.organometallicMode, 'ligand-first');
  });
});

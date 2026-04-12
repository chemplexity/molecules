import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  ANGLE_EPSILON,
  CLEANUP_EPSILON,
  COMPONENT_ROLE_ORDER,
  DEFAULT_BOND_LENGTH,
  DEFAULT_LARGE_MOLECULE_THRESHOLD,
  DEFAULT_MAX_CLEANUP_PASSES,
  DEFAULT_PROFILE,
  DISTANCE_EPSILON,
  IMPROVEMENT_EPSILON,
  LABEL_WIDTH_FACTORS,
  LAYOUT_PROFILES,
  NUMERIC_EPSILON
} from '../../src/layoutv2/constants.js';

describe('layoutv2/constants', () => {
  it('exposes the expected milestone-1 defaults', () => {
    assert.equal(DEFAULT_BOND_LENGTH, 1.5);
    assert.equal(DEFAULT_PROFILE, 'organic-publication');
    assert.equal(DEFAULT_MAX_CLEANUP_PASSES, 6);
    assert.equal(DISTANCE_EPSILON, 1e-6);
    assert.equal(ANGLE_EPSILON, 1e-9);
    assert.equal(IMPROVEMENT_EPSILON, 1e-6);
    assert.equal(NUMERIC_EPSILON, 1e-12);
    assert.equal(CLEANUP_EPSILON, 1e-3);
    assert.equal(LABEL_WIDTH_FACTORS.get(1), 1.0);
    assert.equal(LABEL_WIDTH_FACTORS.get(2), 1.6);
    assert.equal(LABEL_WIDTH_FACTORS.get(3), 2.1);
    assert.deepEqual(DEFAULT_LARGE_MOLECULE_THRESHOLD, {
      heavyAtomCount: 120,
      ringSystemCount: 10,
      blockCount: 16
    });
    assert.deepEqual(LAYOUT_PROFILES, [
      'organic-publication',
      'macrocycle',
      'organometallic',
      'large-molecule',
      'reaction-fragment'
    ]);
  });

  it('freezes the exported defaults and role orderings', () => {
    assert.equal(Object.isFrozen(DEFAULT_LARGE_MOLECULE_THRESHOLD), true);
    assert.equal(Object.isFrozen(LAYOUT_PROFILES), true);
    assert.equal(Object.isFrozen(COMPONENT_ROLE_ORDER), true);
    assert.equal(COMPONENT_ROLE_ORDER.principal, 0);
    assert.equal(COMPONENT_ROLE_ORDER['counter-ion'], 1);
  });
});

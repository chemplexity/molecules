import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  ANGLE_EPSILON,
  AUDIT_PLANAR_VALIDATION,
  BRANCH_CLEARANCE_FLOOR_FACTOR,
  BRIDGED_VALIDATION,
  CLEANUP_EPSILON,
  COMPONENT_ROLE_ORDER,
  DEFAULT_BOND_LENGTH,
  DEFAULT_LARGE_MOLECULE_THRESHOLD,
  DEFAULT_MAX_CLEANUP_PASSES,
  DEFAULT_PROFILE,
  DISTANCE_EPSILON,
  IMPROVEMENT_EPSILON,
  LABEL_CLEARANCE_NUDGE_FACTOR,
  LABEL_CLEARANCE_PADDING_FACTOR,
  LABEL_WIDTH_FACTORS,
  LAYOUT_PROFILES,
  NUMERIC_EPSILON,
  OCTAHEDRAL_PROJECTED_EQUATOR_ANGLE,
  RING_PERIMETER_MAX_DEVIATION_FACTOR,
  SEVERE_OVERLAP_FACTOR,
  TRIGONAL_BIPYRAMIDAL_EQUATOR_ANGLE,
  TEMPLATE_PLANAR_VALIDATION
} from '../../../src/layout/engine/constants.js';
import { BRIDGE_PROJECTION_FACTORS } from '../../../src/layout/engine/families/bridge-projection.js';

describe('layout/engine/constants', () => {
  it('exposes the expected milestone-1 defaults', () => {
    assert.equal(DEFAULT_BOND_LENGTH, 1.5);
    assert.equal(DEFAULT_PROFILE, 'organic-publication');
    assert.equal(DEFAULT_MAX_CLEANUP_PASSES, 6);
    assert.equal(DISTANCE_EPSILON, 1e-6);
    assert.equal(ANGLE_EPSILON, 1e-9);
    assert.equal(IMPROVEMENT_EPSILON, 1e-6);
    assert.equal(NUMERIC_EPSILON, 1e-12);
    assert.equal(CLEANUP_EPSILON, 1e-3);
    assert.equal(SEVERE_OVERLAP_FACTOR, 0.55);
    assert.equal(BRANCH_CLEARANCE_FLOOR_FACTOR, 0.55);
    assert.equal(LABEL_CLEARANCE_PADDING_FACTOR, 0.08);
    assert.equal(LABEL_CLEARANCE_NUDGE_FACTOR, 0.2);
    assert.equal(RING_PERIMETER_MAX_DEVIATION_FACTOR, 0.15);
    assert.equal(LABEL_WIDTH_FACTORS.get(1), 1.0);
    assert.equal(LABEL_WIDTH_FACTORS.get(2), 1.6);
    assert.equal(LABEL_WIDTH_FACTORS.get(3), 2.1);
    assert.deepEqual(AUDIT_PLANAR_VALIDATION, {
      minBondLengthFactor: 0.95,
      maxBondLengthFactor: 1.05,
      maxMeanDeviation: 0.05,
      maxSevereOverlapCount: 0
    });
    assert.deepEqual(TEMPLATE_PLANAR_VALIDATION, {
      minBondLengthFactor: 0.98,
      maxBondLengthFactor: 1.02,
      maxMeanDeviation: 0.02,
      maxSevereOverlapCount: 0
    });
    assert.deepEqual(BRIDGED_VALIDATION, {
      minBondLengthFactor: 0.7,
      maxBondLengthFactor: 1.4,
      maxMeanDeviation: 0.35,
      maxSevereOverlapCount: 0
    });
    assert.deepEqual(BRIDGE_PROJECTION_FACTORS, {
      maxProjectedPathCount: 12,
      singleAtomClampMarginFactor: 0.35,
      layerSpacingFactor: 0.45,
      singleAtomBaseHeightFactor: 0.9,
      pathArcBaseAmplitudeFactor: 0.95,
      meanSeedBiasFactor: 0.3,
      meanSeedBiasClampFactor: 0.5
    });
    assert.equal(OCTAHEDRAL_PROJECTED_EQUATOR_ANGLE, Math.PI / 6);
    assert.equal(TRIGONAL_BIPYRAMIDAL_EQUATOR_ANGLE, Math.PI / 6);
    assert.deepEqual(DEFAULT_LARGE_MOLECULE_THRESHOLD, {
      heavyAtomCount: 120,
      ringSystemCount: 10,
      blockCount: 16
    });
    assert.deepEqual(LAYOUT_PROFILES, ['organic-publication', 'macrocycle', 'organometallic', 'large-molecule', 'reaction-fragment']);
  });

  it('freezes the exported defaults and role orderings', () => {
    assert.equal(Object.isFrozen(DEFAULT_LARGE_MOLECULE_THRESHOLD), true);
    assert.equal(Object.isFrozen(LAYOUT_PROFILES), true);
    assert.equal(Object.isFrozen(COMPONENT_ROLE_ORDER), true);
    assert.equal(Object.isFrozen(AUDIT_PLANAR_VALIDATION), true);
    assert.equal(Object.isFrozen(TEMPLATE_PLANAR_VALIDATION), true);
    assert.equal(Object.isFrozen(BRIDGED_VALIDATION), true);
    assert.equal(Object.isFrozen(BRIDGE_PROJECTION_FACTORS), true);
    assert.equal(COMPONENT_ROLE_ORDER.principal, 0);
    assert.equal(COMPONENT_ROLE_ORDER['counter-ion'], 1);
  });
});

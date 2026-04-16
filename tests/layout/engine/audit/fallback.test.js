import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { recommendFallback } from '../../../../src/layout/engine/audit/fallback.js';

describe('layout/engine/audit/fallback', () => {
  it('suggests a generic fallback mode when severe overlaps are present', () => {
    const fallback = recommendFallback({
      bondLengthFailureCount: 0,
      severeOverlapCount: 1,
      collapsedMacrocycleCount: 0,
      stereoContradiction: false,
      bridgedReadabilityFailure: false
    });
    assert.equal(fallback.mode, 'generic-scaffold');
    assert.deepEqual(fallback.reasons, ['severe-overlaps']);
  });

  it('surfaces bond-length failures even when overlaps are absent', () => {
    const fallback = recommendFallback({
      bondLengthFailureCount: 3,
      severeOverlapCount: 0,
      collapsedMacrocycleCount: 0,
      stereoContradiction: false,
      bridgedReadabilityFailure: false
    });
    assert.equal(fallback.mode, 'generic-scaffold');
    assert.deepEqual(fallback.reasons, ['bond-length-failures']);
  });

  it('keeps bond-length failures visible alongside overlap failures', () => {
    const fallback = recommendFallback({
      bondLengthFailureCount: 2,
      severeOverlapCount: 1,
      collapsedMacrocycleCount: 0,
      stereoContradiction: false,
      bridgedReadabilityFailure: false
    });
    assert.equal(fallback.mode, 'generic-scaffold');
    assert.deepEqual(fallback.reasons, ['bond-length-failures', 'severe-overlaps']);
  });
});

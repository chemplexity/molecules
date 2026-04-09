import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { recommendFallback } from '../../../src/layoutv2/audit/fallback.js';

describe('layoutv2/audit/fallback', () => {
  it('suggests a generic fallback mode when severe overlaps are present', () => {
    const fallback = recommendFallback({
      severeOverlapCount: 1,
      collapsedMacrocycleCount: 0,
      stereoContradiction: false,
      bridgedReadabilityFailure: false
    });
    assert.equal(fallback.mode, 'generic-scaffold');
    assert.deepEqual(fallback.reasons, ['severe-overlaps']);
  });
});

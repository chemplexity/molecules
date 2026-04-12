import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  candidateTemplatePriority,
  compareFallbackScaffolds
} from '../../../src/layoutv2/scaffold/fallback-scaffold.js';

describe('layoutv2/scaffold/fallback-scaffold', () => {
  it('prefers larger and more template-backed candidates deterministically', () => {
    const candidates = [
      { atomCount: 6, ringCount: 1, templateMatch: null, aromaticRingCount: 1, family: 'isolated-ring', signature: 'b' },
      { atomCount: 10, ringCount: 2, templateMatch: { priority: 40 }, aromaticRingCount: 2, family: 'fused', signature: 'a' }
    ];
    candidates.sort(compareFallbackScaffolds);
    assert.equal(candidates[0].family, 'fused');
  });

  it('uses template priority before aromaticity and family tie-breakers', () => {
    const candidates = [
      { atomCount: 9, ringCount: 2, templateMatch: null, aromaticRingCount: 2, family: 'fused', signature: 'later' },
      { atomCount: 9, ringCount: 2, templateMatch: { priority: 35 }, aromaticRingCount: 1, family: 'isolated-ring', signature: 'earlier' }
    ];

    candidates.sort(compareFallbackScaffolds);

    assert.equal(candidateTemplatePriority(candidates[0]), 35);
    assert.equal(candidates[0].signature, 'earlier');
  });
});

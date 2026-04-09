import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { compareFallbackScaffolds } from '../../../src/layoutv2/scaffold/fallback-scaffold.js';

describe('layoutv2/scaffold/fallback-scaffold', () => {
  it('prefers larger and more template-backed candidates deterministically', () => {
    const candidates = [
      { atomCount: 6, ringCount: 1, templateMatch: null, aromaticRingCount: 1, family: 'isolated-ring', signature: 'b' },
      { atomCount: 10, ringCount: 2, templateMatch: { priority: 40 }, aromaticRingCount: 2, family: 'fused', signature: 'a' }
    ];
    candidates.sort(compareFallbackScaffolds);
    assert.equal(candidates[0].family, 'fused');
  });
});

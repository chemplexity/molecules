import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { findMacrocycleRings, isMacrocycleRing } from '../../../src/layoutv2/topology/macrocycles.js';

describe('layoutv2/topology/macrocycles', () => {
  it('detects macrocycle rings by size threshold', () => {
    assert.equal(isMacrocycleRing({ size: 12 }), true);
    assert.equal(isMacrocycleRing({ size: 11 }), false);
  });

  it('filters a ring list down to macrocycles', () => {
    const result = findMacrocycleRings([
      { id: 0, size: 6 },
      { id: 1, size: 12 },
      { id: 2, size: 14 }
    ]);
    assert.deepEqual(result.map(ring => ring.id), [1, 2]);
  });
});

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { tidySymmetry } from '../../../src/layoutv2/cleanup/symmetry-tidy.js';

describe('layoutv2/cleanup/symmetry-tidy', () => {
  it('snaps tiny near-axis noise back to exact zero', () => {
    const result = tidySymmetry(new Map([
      ['a0', { x: 1e-7, y: -1e-7 }],
      ['a1', { x: 1, y: 2 }]
    ]), { epsilon: 1e-6 });
    assert.deepEqual(result.coords.get('a0'), { x: 0, y: 0 });
    assert.ok(result.snappedCount >= 2);
  });
});

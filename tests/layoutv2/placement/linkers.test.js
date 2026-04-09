import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { transformAttachedBlock } from '../../../src/layoutv2/placement/linkers.js';

describe('layoutv2/placement/linkers', () => {
  it('rigidly transforms an attached block to a requested target position and angle', () => {
    const transformed = transformAttachedBlock(new Map([
      ['a0', { x: 0, y: 0 }],
      ['a1', { x: 1, y: 0 }]
    ]), 'a0', { x: 4, y: 0 }, Math.PI / 2);

    assert.deepEqual(transformed.get('a0'), { x: 4, y: 0 });
    assert.ok(Math.abs(transformed.get('a1').x - 4) < 1e-6);
    assert.ok(transformed.get('a1').y > 0.9);
  });
});

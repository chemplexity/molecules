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

  it('can mirror an attached block across the attachment axis', () => {
    const coords = new Map([
      ['a0', { x: 0, y: 0 }],
      ['a1', { x: 2, y: 0 }],
      ['a2', { x: 2, y: 1 }]
    ]);
    const unmirrored = transformAttachedBlock(coords, 'a0', { x: 2, y: 0 }, 0);
    const mirrored = transformAttachedBlock(coords, 'a0', { x: 2, y: 0 }, 0, { mirror: true });

    assert.deepEqual(mirrored.get('a0'), { x: 2, y: 0 });
    assert.ok(Math.abs(mirrored.get('a1').x - unmirrored.get('a1').x) < 1e-6);
    assert.ok(Math.abs(mirrored.get('a1').y + unmirrored.get('a1').y) < 1e-6);
    assert.ok(Math.abs(mirrored.get('a2').x - unmirrored.get('a2').x) < 1e-6);
    assert.ok(Math.abs(mirrored.get('a2').y + unmirrored.get('a2').y) < 1e-6);
  });
});

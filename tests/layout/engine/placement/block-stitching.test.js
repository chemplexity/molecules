import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { refineStitchedBlock, stitchChildBlock } from '../../../../src/layout/engine/placement/block-stitching.js';

describe('layout/engine/placement/block-stitching', () => {
  it('stitches a child block onto the target bond direction and length', () => {
    const childCoords = new Map([
      ['c0', { x: 0, y: 0 }],
      ['c1', { x: 1.5, y: 0 }]
    ]);
    const transformed = stitchChildBlock(childCoords, ['c0', 'c1'], 'c0', { x: 0, y: 0 }, Math.PI / 2, 1.5);
    assert.ok(Math.abs(transformed.get('c0').x - 0) < 1e-6);
    assert.ok(Math.abs(transformed.get('c0').y - 1.5) < 1e-6);
    assert.ok(Math.abs(transformed.get('c1').x - 0) < 1e-6);
    assert.ok(Math.abs(transformed.get('c1').y - 3) < 1e-6);
  });

  it('can locally refine a stitched child away from nearby placed atoms', () => {
    const childCoords = new Map([
      ['c0', { x: 0, y: 0 }],
      ['c1', { x: 1.5, y: 0 }]
    ]);
    const placedCoords = new Map([
      ['p0', { x: 0, y: 0 }],
      ['p1', { x: 0, y: 3.1 }]
    ]);

    const refined = refineStitchedBlock(
      childCoords,
      ['c0', 'c1'],
      'c0',
      { x: 0, y: 0 },
      Math.PI / 2,
      1.5,
      placedCoords
    );

    assert.notEqual(refined.angle, Math.PI / 2);
    assert.ok(Math.abs(refined.coords.get('c1').x) > 1e-3);
  });
});

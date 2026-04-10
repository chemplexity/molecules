import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  computeFusedAxis,
  orientCoordsHorizontally,
  rebuildRingCenters
} from '../../../src/layoutv2/scaffold/orientation.js';
import { computeBounds } from '../../../src/layoutv2/geometry/bounds.js';

describe('layoutv2/scaffold/orientation', () => {
  it('computes a principal fused axis and rotates it horizontal', () => {
    const ringCenters = new Map([
      [0, { x: -1, y: -1 }],
      [1, { x: 1, y: 1 }]
    ]);
    const axis = computeFusedAxis(ringCenters);
    assert.ok(Math.abs(axis - (Math.PI / 4)) < 0.1);

    const coords = new Map([
      ['a0', { x: -1, y: -1 }],
      ['a1', { x: 1, y: 1 }]
    ]);
    const rotated = orientCoordsHorizontally(coords, axis);
    assert.ok(Math.abs(rotated.get('a0').y - rotated.get('a1').y) < 1e-6);
  });

  it('rebuilds ring centers from rotated coordinates', () => {
    const centers = rebuildRingCenters([{ id: 1, atomIds: ['a0', 'a1'] }], new Map([
      ['a0', { x: -1, y: 0 }],
      ['a1', { x: 1, y: 0 }]
    ]));
    assert.deepEqual(centers.get(1), { x: 0, y: 0 });
  });

  it('applies a quarter-turn guard when the oriented layout is taller than wide', () => {
    const coords = new Map([
      ['a0', { x: -0.5, y: -3 }],
      ['a1', { x: 0.5, y: -3 }],
      ['a2', { x: -0.5, y: 3 }],
      ['a3', { x: 0.5, y: 3 }]
    ]);
    const rotated = orientCoordsHorizontally(coords, 0);
    const bounds = computeBounds(rotated, [...rotated.keys()]);

    assert.ok(bounds);
    assert.ok(bounds.width >= bounds.height);
  });
});

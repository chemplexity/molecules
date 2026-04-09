import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { alignCoordsToFixed } from '../../../src/layoutv2/geometry/transforms.js';

describe('layoutv2/geometry/transforms', () => {
  it('returns unanchored coordinates when no fixed atoms are present', () => {
    const coords = new Map([['a0', { x: 0, y: 0 }]]);
    const result = alignCoordsToFixed(coords, ['a0'], new Map());
    assert.equal(result.anchored, false);
    assert.equal(result.coords, coords);
  });

  it('translates coordinates onto a single fixed atom', () => {
    const coords = new Map([
      ['a0', { x: 0, y: 0 }],
      ['a1', { x: 1.5, y: 0 }]
    ]);
    const result = alignCoordsToFixed(coords, ['a0', 'a1'], new Map([['a0', { x: 5, y: 5 }]]));
    assert.equal(result.anchored, true);
    assert.deepEqual(result.coords.get('a0'), { x: 5, y: 5 });
    assert.deepEqual(result.coords.get('a1'), { x: 6.5, y: 5 });
  });

  it('uses a rigid similarity transform when two fixed atoms are present', () => {
    const coords = new Map([
      ['a0', { x: 0, y: 0 }],
      ['a1', { x: 1, y: 0 }]
    ]);
    const result = alignCoordsToFixed(coords, ['a0', 'a1'], new Map([
      ['a0', { x: 1, y: 1 }],
      ['a1', { x: 1, y: 3 }]
    ]));
    assert.ok(Math.abs(result.coords.get('a0').x - 1) < 1e-9);
    assert.ok(Math.abs(result.coords.get('a0').y - 1) < 1e-9);
    assert.ok(Math.abs(result.coords.get('a1').x - 1) < 1e-9);
    assert.ok(Math.abs(result.coords.get('a1').y - 3) < 1e-9);
  });
});

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { alignCoordsToFixed } from '../../../../src/layout/engine/geometry/transforms.js';

describe('layout/engine/geometry/transforms', () => {
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

  it('chooses the mirrored handedness when extra fixed atoms prove it matches existing geometry better', () => {
    const coords = new Map([
      ['a0', { x: 0, y: 0 }],
      ['a1', { x: 1, y: 0 }],
      ['a2', { x: 2, y: 1 }]
    ]);
    const result = alignCoordsToFixed(coords, ['a0', 'a1', 'a2'], new Map([
      ['a0', { x: 10, y: 0 }],
      ['a1', { x: 11, y: 0 }],
      ['a2', { x: 12, y: -1 }]
    ]));

    assert.ok(Math.abs(result.coords.get('a2').x - 12) < 1e-9);
    assert.ok(Math.abs(result.coords.get('a2').y + 1) < 1e-9);
  });
});

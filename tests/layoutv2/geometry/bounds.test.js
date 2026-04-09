import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { computeBounds, translateCoords } from '../../../src/layoutv2/geometry/bounds.js';

describe('layoutv2/geometry/bounds', () => {
  it('computes bounds for selected coordinates', () => {
    const coords = new Map([
      ['a0', { x: -1, y: 2 }],
      ['a1', { x: 3, y: -2 }]
    ]);
    assert.deepEqual(computeBounds(coords, ['a0', 'a1']), {
      minX: -1,
      maxX: 3,
      minY: -2,
      maxY: 2,
      width: 4,
      height: 4,
      centerX: 1,
      centerY: 0
    });
    assert.equal(computeBounds(coords, ['missing']), null);
  });

  it('returns translated coordinate copies', () => {
    const coords = new Map([['a0', { x: 1, y: 2 }]]);
    const translated = translateCoords(coords, ['a0'], 3, -1);
    assert.deepEqual(translated.get('a0'), { x: 4, y: 1 });
    assert.deepEqual(coords.get('a0'), { x: 1, y: 2 });
  });
});

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { coordOverlayWithOverride, coordOverlayWithOverrides } from '../../../../src/layout/engine/geometry/coord-overlay.js';

describe('layout/engine/geometry/coord-overlay', () => {
  it('iterates base keys directly when overrides only replace existing atoms', () => {
    const baseCoords = new Map([
      ['a', { x: 0, y: 0 }],
      ['b', { x: 1, y: 0 }]
    ]);
    const overlay = coordOverlayWithOverride(baseCoords, 'b', { x: 2, y: 3 });

    assert.equal(overlay.size, 2);
    assert.deepEqual([...overlay.keys()], ['a', 'b']);
    assert.deepEqual(
      [...overlay.values()],
      [
        { x: 0, y: 0 },
        { x: 2, y: 3 }
      ]
    );
    assert.deepEqual(
      [...overlay.entries()],
      [
        ['a', { x: 0, y: 0 }],
        ['b', { x: 2, y: 3 }]
      ]
    );
    assert.deepEqual(
      overlay.toMap(),
      new Map([
        ['a', { x: 0, y: 0 }],
        ['b', { x: 2, y: 3 }]
      ])
    );
  });

  it('appends override-only atoms after base keys', () => {
    const baseCoords = new Map([['a', { x: 0, y: 0 }]]);
    const overlay = coordOverlayWithOverrides(
      baseCoords,
      new Map([
        ['b', { x: 1, y: 0 }],
        ['a', { x: 2, y: 0 }]
      ])
    );

    assert.equal(overlay.size, 2);
    assert.deepEqual([...overlay.keys()], ['a', 'b']);
    assert.deepEqual(
      [...overlay.entries()],
      [
        ['a', { x: 2, y: 0 }],
        ['b', { x: 1, y: 0 }]
      ]
    );
  });

  it('flattens nested overlays while preserving the latest override', () => {
    const baseCoords = new Map([
      ['a', { x: 0, y: 0 }],
      ['b', { x: 1, y: 0 }]
    ]);
    const firstOverlay = coordOverlayWithOverride(baseCoords, 'a', { x: 2, y: 0 });
    const secondOverlay = coordOverlayWithOverrides(
      firstOverlay,
      new Map([
        ['a', { x: 3, y: 0 }],
        ['c', { x: 4, y: 0 }]
      ])
    );

    assert.equal(secondOverlay.size, 3);
    assert.deepEqual([...secondOverlay.keys()], ['a', 'b', 'c']);
    assert.deepEqual(
      [...secondOverlay.entries()],
      [
        ['a', { x: 3, y: 0 }],
        ['b', { x: 1, y: 0 }],
        ['c', { x: 4, y: 0 }]
      ]
    );
  });
});

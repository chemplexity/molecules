import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  minimumSectorAngle,
  synthesizeHydrogenPosition
} from '../../../src/layoutv2/stereo/wedge-geometry.js';

describe('layoutv2/stereo/wedge-geometry', () => {
  it('synthesizes a hidden-hydrogen position opposite known substituents', () => {
    const position = synthesizeHydrogenPosition({ x: 0, y: 0 }, [{ x: 1, y: 0 }, { x: 0, y: 1 }], 1.5);
    assert.ok(position.x < 0 || position.y < 0);
  });

  it('computes the minimum sector angle around a stereocenter', () => {
    const sector = minimumSectorAngle(
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      [{ x: 0, y: 1 }, { x: -1, y: 0 }]
    );
    assert.ok(sector > 1);
  });
});

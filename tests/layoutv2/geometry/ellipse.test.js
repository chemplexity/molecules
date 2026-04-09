import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { averageEllipseChordLength, ellipsePoint, macrocycleAspectRatio, solveEllipseScale } from '../../../src/layoutv2/geometry/ellipse.js';

describe('layoutv2/geometry/ellipse', () => {
  it('returns points on the requested ellipse', () => {
    const point = ellipsePoint({ x: 1, y: 2 }, 4, 2, Math.PI / 2);
    assert.ok(Math.abs(point.x - 1) < 1e-6);
    assert.ok(Math.abs(point.y - 4) < 1e-6);
  });

  it('solves an ellipse scale whose average chord length matches the target', () => {
    const aspectRatio = macrocycleAspectRatio(12);
    const scale = solveEllipseScale(12, 1.5, aspectRatio, Math.PI / 2);
    const average = averageEllipseChordLength(12, scale * aspectRatio, scale / aspectRatio, Math.PI / 2);

    assert.ok(Math.abs(average - 1.5) < 1e-3);
  });
});

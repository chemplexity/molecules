import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { averageEllipseChordLength, ellipsePoint, macrocycleAspectRatio, solveEllipseScale } from '../../../../src/layout/engine/geometry/ellipse.js';

describe('layout/engine/geometry/ellipse', () => {
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

  it('uses a stepped aspect-ratio calibration for larger macrocycles', () => {
    assert.equal(macrocycleAspectRatio(12), 1.0);
    assert.equal(macrocycleAspectRatio(16), 1.15);
    assert.equal(macrocycleAspectRatio(20), 1.30);
    assert.equal(macrocycleAspectRatio(26), 1.50);
    assert.equal(macrocycleAspectRatio(40), 1.71);
    assert.equal(macrocycleAspectRatio(60), 1.80);
  });
});

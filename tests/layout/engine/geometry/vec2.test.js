import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  add,
  angleOf,
  angularDifference,
  centroid,
  distance,
  fromAngle,
  length,
  midpoint,
  normalize,
  perpLeft,
  rotate,
  scale,
  sub,
  vec,
  wrapAngle
} from '../../../../src/layout/engine/geometry/vec2.js';

describe('layout/engine/geometry/vec2', () => {
  it('performs basic vector arithmetic', () => {
    assert.deepEqual(vec(1, 2), { x: 1, y: 2 });
    assert.deepEqual(add({ x: 1, y: 2 }, { x: 3, y: 4 }), { x: 4, y: 6 });
    assert.deepEqual(sub({ x: 5, y: 4 }, { x: 2, y: 1 }), { x: 3, y: 3 });
    assert.deepEqual(scale({ x: 2, y: -3 }, 2), { x: 4, y: -6 });
    assert.equal(length({ x: 3, y: 4 }), 5);
    assert.equal(distance({ x: 0, y: 0 }, { x: 3, y: 4 }), 5);
    assert.deepEqual(midpoint({ x: 0, y: 0 }, { x: 2, y: 2 }), { x: 1, y: 1 });
  });

  it('supports normalization, rotation, centroids, and angular helpers', () => {
    const normalized = normalize({ x: 0, y: 5 });
    assert.ok(Math.abs(normalized.x) < 1e-9);
    assert.ok(Math.abs(normalized.y - 1) < 1e-9);
    assert.deepEqual(normalize({ x: 0, y: 0 }), { x: 0, y: 0 });

    const rotated = rotate({ x: 1, y: 0 }, Math.PI / 2);
    assert.ok(Math.abs(rotated.x) < 1e-9);
    assert.ok(Math.abs(rotated.y - 1) < 1e-9);
    assert.deepEqual(perpLeft({ x: 2, y: 3 }), { x: -3, y: 2 });
    assert.deepEqual(centroid([{ x: 0, y: 0 }, { x: 2, y: 2 }]), { x: 1, y: 1 });
    assert.ok(Math.abs(angleOf(fromAngle(Math.PI / 3, 2)) - (Math.PI / 3)) < 1e-9);
    assert.ok(Math.abs(wrapAngle(3 * Math.PI) - Math.PI) < 1e-9);
    assert.ok(Math.abs(angularDifference(Math.PI / 6, (11 * Math.PI) / 6) - (Math.PI / 3)) < 1e-9);
  });

  it('handles zero-length normalization and exact angle-wrap boundaries stably', () => {
    assert.deepEqual(normalize({ x: 1e-20, y: -1e-20 }), { x: 0, y: 0 });
    assert.equal(wrapAngle(-Math.PI), Math.PI);
    assert.equal(wrapAngle(Math.PI), Math.PI);
    assert.equal(wrapAngle(3 * Math.PI), Math.PI);
  });

  it('keeps angularDifference symmetric across wrap boundaries', () => {
    const firstAngle = Math.PI / 6;
    const secondAngle = (11 * Math.PI) / 6;

    assert.ok(Math.abs(angularDifference(firstAngle, secondAngle) - angularDifference(secondAngle, firstAngle)) < 1e-12);
    assert.equal(angularDifference(Math.PI, -Math.PI), 0);
    assert.equal(angularDifference(0, 0), 0);
  });
});

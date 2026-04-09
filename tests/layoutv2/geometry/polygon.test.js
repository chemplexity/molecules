import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  apothemForRegularPolygon,
  circumradiusForRegularPolygon,
  placeRegularPolygon
} from '../../../src/layoutv2/geometry/polygon.js';
import { distance } from '../../../src/layoutv2/geometry/vec2.js';

describe('layoutv2/geometry/polygon', () => {
  it('computes regular-polygon radii from edge length', () => {
    assert.ok(Math.abs(circumradiusForRegularPolygon(6, 1.5) - 1.5) < 1e-9);
    assert.ok(Math.abs(apothemForRegularPolygon(6, 1.5) - (1.5 * Math.cos(Math.PI / 6))) < 1e-9);
    assert.throws(() => circumradiusForRegularPolygon(2, 1.5), RangeError);
  });

  it('places a regular polygon with the requested bond length', () => {
    const coords = placeRegularPolygon(['a0', 'a1', 'a2', 'a3', 'a4', 'a5'], { x: 0, y: 0 }, 1.5);
    assert.equal(coords.size, 6);
    assert.ok(Math.abs(distance(coords.get('a0'), coords.get('a1')) - 1.5) < 1e-6);
    assert.ok(Math.abs(distance(coords.get('a2'), coords.get('a3')) - 1.5) < 1e-6);
  });
});

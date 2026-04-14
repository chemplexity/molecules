import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  apothemForRegularPolygon,
  countPointInPolygons,
  circumradiusForRegularPolygon,
  placeRegularPolygon,
  pointInPolygon
} from '../../../../src/layout/engine/geometry/polygon.js';
import { distance } from '../../../../src/layout/engine/geometry/vec2.js';

describe('layout/engine/geometry/polygon', () => {
  it('computes regular-polygon radii from edge length', () => {
    assert.ok(Math.abs(circumradiusForRegularPolygon(6, 1.5) - 1.5) < 1e-9);
    assert.ok(Math.abs(apothemForRegularPolygon(6, 1.5) - 1.5 * Math.cos(Math.PI / 6)) < 1e-9);
    assert.throws(() => circumradiusForRegularPolygon(2, 1.5), RangeError);
  });

  it('places a regular polygon with the requested bond length', () => {
    const coords = placeRegularPolygon(['a0', 'a1', 'a2', 'a3', 'a4', 'a5'], { x: 0, y: 0 }, 1.5);
    assert.equal(coords.size, 6);
    assert.ok(Math.abs(distance(coords.get('a0'), coords.get('a1')) - 1.5) < 1e-6);
    assert.ok(Math.abs(distance(coords.get('a2'), coords.get('a3')) - 1.5) < 1e-6);
  });

  it('detects whether a point lies inside a polygon', () => {
    const polygon = [
      { x: -1, y: -1 },
      { x: 1, y: -1 },
      { x: 1, y: 1 },
      { x: -1, y: 1 }
    ];

    assert.equal(pointInPolygon({ x: 0, y: 0 }, polygon), true);
    assert.equal(pointInPolygon({ x: 2, y: 0 }, polygon), false);
  });

  it('counts how many polygons contain the requested point', () => {
    const polygons = [
      [
        { x: -2, y: -2 },
        { x: 2, y: -2 },
        { x: 2, y: 2 },
        { x: -2, y: 2 }
      ],
      [
        { x: -1, y: -1 },
        { x: 1, y: -1 },
        { x: 1, y: 1 },
        { x: -1, y: 1 }
      ],
      [
        { x: 3, y: 3 },
        { x: 4, y: 3 },
        { x: 4, y: 4 },
        { x: 3, y: 4 }
      ]
    ];

    assert.equal(countPointInPolygons(polygons, { x: 0, y: 0 }), 2);
    assert.equal(countPointInPolygons(polygons, { x: 3.5, y: 3.5 }), 1);
    assert.equal(countPointInPolygons(polygons, { x: 10, y: 10 }), 0);
  });

  it('returns false for degenerate polygons and keeps edge handling stable', () => {
    const square = [
      { x: -1, y: -1 },
      { x: 1, y: -1 },
      { x: 1, y: 1 },
      { x: -1, y: 1 }
    ];
    const degenerate = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 2, y: 0 }
    ];

    assert.equal(pointInPolygon({ x: 0, y: 0 }, degenerate), false);
    assert.equal(pointInPolygon({ x: -1, y: 0 }, square), true);
    assert.equal(pointInPolygon({ x: 1, y: 0 }, square), false);
    assert.equal(pointInPolygon({ x: 1, y: 1 }, square), false);
  });

  it('ignores degenerate polygons when counting containment hits', () => {
    const polygons = [
      [
        { x: -2, y: -2 },
        { x: 2, y: -2 },
        { x: 2, y: 2 },
        { x: -2, y: 2 }
      ],
      [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 2, y: 0 }
      ]
    ];

    assert.equal(countPointInPolygons(polygons, { x: 0, y: 0 }), 1);
  });
});

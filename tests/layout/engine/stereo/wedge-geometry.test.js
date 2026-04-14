import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { minimumSectorAngle, synthesizeHydrogenPosition } from '../../../../src/layout/engine/stereo/wedge-geometry.js';
import { pointInPolygon } from '../../../../src/layout/engine/geometry/polygon.js';

describe('layout/engine/stereo/wedge-geometry', () => {
  it('synthesizes a hidden-hydrogen position opposite known substituents', () => {
    const position = synthesizeHydrogenPosition(
      { x: 0, y: 0 },
      [
        { x: 1, y: 0 },
        { x: 0, y: 1 }
      ],
      1.5
    );
    assert.ok(position.x < 0 || position.y < 0);
  });

  it('computes the minimum sector angle around a stereocenter', () => {
    const sector = minimumSectorAngle({ x: 0, y: 0 }, { x: 1, y: 0 }, [
      { x: 0, y: 1 },
      { x: -1, y: 0 }
    ]);
    assert.ok(sector > 1);
  });

  it('keeps synthesized hidden hydrogens out of incident ring faces when possible', () => {
    const position = synthesizeHydrogenPosition(
      { x: 0, y: 0 },
      [
        { x: 1, y: 0 },
        { x: -0.4, y: 0.9 },
        { x: -0.4, y: -0.9 }
      ],
      1.2,
      {
        incidentRingPolygons: [
          [
            { x: -0.8, y: -0.7 },
            { x: 0.9, y: -0.4 },
            { x: 0.9, y: 0.4 },
            { x: -0.8, y: 0.7 }
          ]
        ]
      }
    );

    assert.equal(
      pointInPolygon(position, [
        { x: -0.8, y: -0.7 },
        { x: 0.9, y: -0.4 },
        { x: 0.9, y: 0.4 },
        { x: -0.8, y: 0.7 }
      ]),
      false
    );
  });
});

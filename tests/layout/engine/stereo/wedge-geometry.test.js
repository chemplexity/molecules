import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  DISPLAYED_STEREO_CARDINAL_AXIS_SECTOR_TOLERANCE,
  minimumSectorAngle,
  synthesizeHydrogenPosition
} from '../../../../src/layout/engine/stereo/wedge-geometry.js';
import { pointInPolygon } from '../../../../src/layout/engine/geometry/polygon.js';
import { angleOf, sub } from '../../../../src/layout/engine/geometry/vec2.js';

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

  it('keeps displayed stereo hydrogens in exterior side sectors for fused ring stereocenters', () => {
    const c17Position = { x: 7.58, y: 1.07 };
    const c17HydrogenPosition = synthesizeHydrogenPosition(
      c17Position,
      [
        { x: 8.96, y: -0.05 },
        { x: 8.12, y: 2.73 },
        { x: 6.01, y: 0.59 }
      ],
      1.125,
      {
        preferCardinalAxes: true,
        incidentRingPolygons: [
          [
            { x: 8.85, y: 1.46 },
            { x: 7.81, y: 0.15 },
            { x: 8.96, y: -0.05 },
            { x: 7.58, y: 1.07 },
            { x: 8.12, y: 2.73 }
          ],
          [
            { x: 6.01, y: 0.59 },
            { x: 6.65, y: -0.73 },
            { x: 7.81, y: 0.15 },
            { x: 8.96, y: -0.05 },
            { x: 7.58, y: 1.07 }
          ]
        ]
      }
    );
    const c21Position = { x: 7.81, y: 0.15 };
    const c21HydrogenPosition = synthesizeHydrogenPosition(
      c21Position,
      [
        { x: 8.96, y: -0.05 },
        { x: 8.85, y: 1.46 },
        { x: 6.65, y: -0.73 }
      ],
      1.125,
      {
        preferCardinalAxes: true,
        incidentRingPolygons: [
          [
            { x: 8.85, y: 1.46 },
            { x: 7.81, y: 0.15 },
            { x: 8.96, y: -0.05 },
            { x: 7.58, y: 1.07 },
            { x: 8.12, y: 2.73 }
          ],
          [
            { x: 6.01, y: 0.59 },
            { x: 6.65, y: -0.73 },
            { x: 7.81, y: 0.15 },
            { x: 8.96, y: -0.05 },
            { x: 7.58, y: 1.07 }
          ]
        ]
      }
    );

    const c17Angle = angleOf(sub(c17HydrogenPosition, c17Position));
    const c21Angle = angleOf(sub(c21HydrogenPosition, c21Position));
    assert.ok(c17Angle > 2.0 && c17Angle < 2.6, `expected the C17 hydrogen to project to the upper-left exterior side, got ${((c17Angle * 180) / Math.PI).toFixed(1)} degrees`);
    assert.ok(c21Angle < -1.0 && c21Angle > -1.6, `expected the C21 hydrogen to project to the lower exterior side, got ${((c21Angle * 180) / Math.PI).toFixed(1)} degrees`);
  });

  it('snaps display hydrogens to exact cardinal axes when that stays nearly as open', () => {
    const unit = angleDegrees => ({
      x: Math.cos((angleDegrees * Math.PI) / 180),
      y: Math.sin((angleDegrees * Math.PI) / 180)
    });
    const position = synthesizeHydrogenPosition(
      { x: 0, y: 0 },
      [unit(150), unit(18), unit(-90)],
      1.5,
      { preferCardinalAxes: true }
    );

    assert.ok(Math.abs(position.x) <= 1e-6, 'expected the snapped display hydrogen to stay on the vertical axis');
    assert.ok(position.y > 1, 'expected the snapped display hydrogen to project upward');
  });

  it('lets displayed stereo hydrogens use a slightly stronger cardinal snap to stay exactly vertical', () => {
    const unit = angleDegrees => ({
      x: Math.cos((angleDegrees * Math.PI) / 180),
      y: Math.sin((angleDegrees * Math.PI) / 180)
    });
    const knownPositions = [unit(-18), unit(180), unit(90)];
    const unconstrainedPosition = synthesizeHydrogenPosition(
      { x: 0, y: 0 },
      knownPositions,
      1.5,
      { preferCardinalAxes: true }
    );
    const displayedStereoPosition = synthesizeHydrogenPosition(
      { x: 0, y: 0 },
      knownPositions,
      1.5,
      {
        preferCardinalAxes: true,
        cardinalAxisSectorTolerance: DISPLAYED_STEREO_CARDINAL_AXIS_SECTOR_TOLERANCE
      }
    );

    assert.ok(Math.abs(unconstrainedPosition.x) > 1e-3, 'expected the default snap to stay slightly off-axis');
    assert.ok(Math.abs(displayedStereoPosition.x) <= 1e-6, 'expected displayed stereo hydrogens to snap onto the vertical axis');
    assert.ok(displayedStereoPosition.y < -1, 'expected the displayed stereo hydrogen to project downward');
  });
});

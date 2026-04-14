import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  bondOverlayPlacementHitsBlockers,
  buildBondOverlayBlockerSegments,
  pickHydrogenBondOverlayPlacement,
  pickBondOverlayLabelPlacement
} from '../../../src/app/render/bond-overlay-placement.js';

describe('app/render/bond-overlay-placement', () => {
  it('pushes bond-length labels clear of triple-bond parallel strokes', () => {
    const blockerSegments = buildBondOverlayBlockerSegments({
      start: { x: 0, y: 0 },
      end: { x: 100, y: 0 },
      order: 3,
      bondOffset: 7
    });
    const placement = pickBondOverlayLabelPlacement({
      start: { x: 0, y: 0 },
      end: { x: 100, y: 0 },
      label: '1.20',
      fontSize: 10,
      preferredSide: 1,
      blockerSegments,
      baseOffset: 14
    });

    assert.equal(bondOverlayPlacementHitsBlockers(placement, blockerSegments), false);
    assert.ok(Math.abs(placement.cy) > 14, 'expected triple-bond label to move farther from the bond than the old default offset');
  });

  it('keeps bond-length labels off hashed stereo bond fans', () => {
    const blockerSegments = buildBondOverlayBlockerSegments({
      start: { x: 0, y: 0 },
      end: { x: 100, y: 0 },
      stereoType: 'dash',
      wedgeHalfWidth: 6,
      wedgeDashes: 6
    });
    const placement = pickBondOverlayLabelPlacement({
      start: { x: 0, y: 0 },
      end: { x: 100, y: 0 },
      label: '1.43',
      fontSize: 10,
      preferredSide: 1,
      blockerSegments,
      baseOffset: 14
    });

    assert.equal(bondOverlayPlacementHitsBlockers(placement, blockerSegments), false);
    assert.ok(placement.cy > 0, 'expected dashed-bond label to stay on a clean side of the stereo hash fan');
  });

  it('avoids nearby re-entrant bridged bond blockers instead of sitting on the midpoint', () => {
    const blockerSegments = [
      ...buildBondOverlayBlockerSegments({
        start: { x: 0, y: 0 },
        end: { x: 100, y: 0 },
        order: 1
      }),
      { x1: 38, y1: 10, x2: 63, y2: 28 }
    ];
    const placement = pickBondOverlayLabelPlacement({
      start: { x: 0, y: 0 },
      end: { x: 100, y: 0 },
      label: '1.54',
      fontSize: 10,
      preferredSide: 1,
      blockerSegments,
      baseOffset: 14
    });

    assert.equal(bondOverlayPlacementHitsBlockers(placement, blockerSegments), false);
    assert.ok(placement.cy > 20, 'expected bridged-bond label to move well clear of the blocked bridged-bond region');
  });

  it('anchors hydrogen bond-length labels above the hydrogen atom instead of at the bond midpoint', () => {
    const placement = pickHydrogenBondOverlayPlacement({
      hydrogenPoint: { x: 30, y: 40 },
      otherPoint: { x: 30, y: 20 },
      label: '1.09',
      fontSize: 10,
      hydrogenRadius: 7
    });

    assert.ok(placement.cy > 40, 'expected downward X-H bond label below the hydrogen atom');
    assert.ok(Math.abs(placement.cx - 30) < 1e-6, 'expected vertical X-H bond label to stay centered on the bond plane');
  });

  it('anchors upward-pointing hydrogen bond-length labels on the outward side of the hydrogen atom', () => {
    const placement = pickHydrogenBondOverlayPlacement({
      hydrogenPoint: { x: 30, y: 20 },
      otherPoint: { x: 30, y: 40 },
      label: '1.09',
      fontSize: 10,
      hydrogenRadius: 7
    });

    assert.ok(placement.cy < 20, 'expected upward X-H bond label above the hydrogen atom');
    assert.ok(Math.abs(placement.cx - 30) < 1e-6, 'expected vertical X-H bond label to stay centered on the bond plane');
  });

  it('pushes hydrogen bond-length labels farther out when the hydrogen label box is already occupied', () => {
    const placement = pickHydrogenBondOverlayPlacement({
      hydrogenPoint: { x: 30, y: 40 },
      otherPoint: { x: 30, y: 20 },
      label: '1.09',
      fontSize: 10,
      hydrogenRadius: 7,
      placedBoxes: [{ cx: 30, cy: 49, hw: 8, hh: 6 }]
    });

    assert.ok(placement.cy > 55, 'expected crowded X-H bond label to move farther away from the hydrogen atom');
  });
});

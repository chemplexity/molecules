import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  atomNumberingLabelDistance,
  multipleBondAnnotationBlockerAngles,
  multipleBondSideBlockerAngle,
  pickAtomAnnotationAngle,
  pickAtomAnnotationPlacement
} from '../../../src/app/render/atom-numbering.js';

function boxesOverlap(a, b, padding = 3) {
  return Math.abs(a.cx - b.cx) < a.hw + b.hw + padding && Math.abs(a.cy - b.cy) < a.hh + b.hh + padding;
}

describe('pickAtomAnnotationAngle', () => {
  it('uses the fallback angle when nothing is blocked', () => {
    assert.equal(pickAtomAnnotationAngle([]), -Math.PI / 4);
  });

  it('moves away from a blocked fallback sector', () => {
    const angle = pickAtomAnnotationAngle([{ angle: -Math.PI / 4, spread: 0.9 }]);
    assert.ok(Math.abs(angle + Math.PI / 4) > 1.2);
  });
});

describe('atomNumberingLabelDistance', () => {
  it('adds clearance for larger fonts and multi-digit labels', () => {
    assert.ok(atomNumberingLabelDistance(14, '12') > atomNumberingLabelDistance(10, '1'));
  });
});

describe('pickAtomAnnotationPlacement', () => {
  it('moves hydrogen atom numbers off an occupied outward X-H overlay slot', () => {
    const overlayBox = { cx: 30, cy: 53, hw: 12, hh: 6 };
    const options = {
      center: { x: 30, y: 40 },
      label: '7',
      fontSize: 10,
      blockedSectors: [{ angle: -Math.PI / 2, spread: 0.4 }]
    };

    const baselinePlacement = pickAtomAnnotationPlacement(options);
    const avoidedPlacement = pickAtomAnnotationPlacement({
      ...options,
      placedBoxes: [overlayBox]
    });

    assert.ok(baselinePlacement.cy > options.center.y, 'expected the unconstrained hydrogen number to prefer the outward side opposite the bond');
    assert.equal(boxesOverlap(avoidedPlacement, overlayBox), false);
    assert.ok(
      avoidedPlacement.angle !== baselinePlacement.angle ||
        Math.hypot(avoidedPlacement.cx - options.center.x, avoidedPlacement.cy - options.center.y) > Math.hypot(baselinePlacement.cx - options.center.x, baselinePlacement.cy - options.center.y)
    );
  });

  it('steps outward when an atom label box surrounds the default annotation radius', () => {
    const center = { x: 100, y: 100 };
    const atomLabelBox = { cx: 96, cy: 100, hw: 18, hh: 12 };
    const placement = pickAtomAnnotationPlacement({
      center,
      label: '9',
      fontSize: 10,
      placedBoxes: [atomLabelBox]
    });

    assert.equal(boxesOverlap(placement, atomLabelBox), false);
    assert.ok(Math.hypot(placement.cx - center.x, placement.cy - center.y) > atomNumberingLabelDistance(10, '9'));
  });
});

describe('multipleBondSideBlockerAngle', () => {
  it('points into the occupied offset side of a multiple bond', () => {
    const upper = multipleBondSideBlockerAngle({ x: 0, y: 0 }, { x: 10, y: 0 }, 1);
    const lower = multipleBondSideBlockerAngle({ x: 0, y: 0 }, { x: 10, y: 0 }, -1);
    assert.ok(upper > 0 && upper < Math.PI / 2);
    assert.ok(lower < 0 && lower > -Math.PI / 2);
  });
});

describe('multipleBondAnnotationBlockerAngles', () => {
  it('blocks both side lanes for terminal triple bonds and terminal double bonds', () => {
    const tripleAngles = multipleBondAnnotationBlockerAngles({ x: 0, y: 0 }, { x: 10, y: 0 }, { order: 3 });
    const terminalDoubleAngles = multipleBondAnnotationBlockerAngles({ x: 0, y: 0 }, { x: 10, y: 0 }, { order: 2, terminal: true });
    const internalDoubleAngles = multipleBondAnnotationBlockerAngles({ x: 0, y: 0 }, { x: 10, y: 0 }, { order: 2, side: -1 });

    assert.equal(tripleAngles.length, 2);
    assert.ok(tripleAngles.some(angle => angle > 0) && tripleAngles.some(angle => angle < 0));
    assert.equal(terminalDoubleAngles.length, 2);
    assert.ok(terminalDoubleAngles.some(angle => angle > 0) && terminalDoubleAngles.some(angle => angle < 0));
    assert.equal(internalDoubleAngles.length, 1);
    assert.ok(internalDoubleAngles[0] < 0);
  });
});

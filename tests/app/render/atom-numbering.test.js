import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { atomNumberingLabelDistance, multipleBondSideBlockerAngle, pickAtomAnnotationAngle } from '../../../src/app/render/atom-numbering.js';

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

describe('multipleBondSideBlockerAngle', () => {
  it('points into the occupied offset side of a multiple bond', () => {
    const upper = multipleBondSideBlockerAngle({ x: 0, y: 0 }, { x: 10, y: 0 }, 1);
    const lower = multipleBondSideBlockerAngle({ x: 0, y: 0 }, { x: 10, y: 0 }, -1);
    assert.ok(upper > 0 && upper < Math.PI / 2);
    assert.ok(lower < 0 && lower > -Math.PI / 2);
  });
});

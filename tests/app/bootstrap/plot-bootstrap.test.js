import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { atomBBoxFallback, enLabelColor } from '../../../src/app/bootstrap/plot-bootstrap.js';

describe('plot-bootstrap helpers', () => {
  it('computes an atom bounding box fallback', () => {
    const bbox = atomBBoxFallback([
      { x: -2, y: 5 },
      { x: 4, y: -1 },
      { x: 0, y: 3 }
    ]);

    assert.deepEqual(bbox, {
      minX: -2,
      maxX: 4,
      minY: -1,
      maxY: 5,
      cx: 1,
      cy: 2
    });
  });

  it('maps EN values to clamped label colors', () => {
    assert.equal(enLabelColor(-1), 'rgb(50,50,50)');
    assert.equal(enLabelColor(0), 'rgb(50,50,50)');
    assert.equal(enLabelColor(1), 'rgb(230,20,10)');
    assert.equal(enLabelColor(2), 'rgb(230,20,10)');
  });
});

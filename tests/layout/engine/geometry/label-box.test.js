import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { parseSMILES } from '../../../../src/io/smiles.js';
import { createLayoutGraph } from '../../../../src/layout/engine/model/layout-graph.js';
import { atomLabelText, estimateLabelHalfSize, findLabelOverlaps } from '../../../../src/layout/engine/geometry/label-box.js';

describe('layout/engine/geometry/label-box', () => {
  it('estimates wider boxes for multi-character labels', () => {
    const oxygen = estimateLabelHalfSize('O', 1.5);
    const chlorine = estimateLabelHalfSize('Cl', 1.5);
    const bromine = estimateLabelHalfSize('Br', 1.5);

    assert.ok(oxygen);
    assert.ok(chlorine);
    assert.ok(bromine);
    assert.ok(chlorine.halfWidth > oxygen.halfWidth);
    assert.ok(bromine.halfWidth > oxygen.halfWidth);
  });

  it('omits attached hydrogen atoms from label-box collection', () => {
    assert.equal(atomLabelText({ element: 'H', charge: 0, heavyDegree: 1 }), '');
  });

  it('detects overlaps that only appear once multi-character widths are respected', () => {
    const graph = createLayoutGraph(parseSMILES('Cl.Br'), { suppressH: true });
    const coords = new Map([
      ['Cl1', { x: 0, y: 0 }],
      ['Br2', { x: 0.9, y: 0 }]
    ]);

    const overlaps = findLabelOverlaps(graph, coords, graph.options.bondLength);

    assert.equal(overlaps.length, 1);
    assert.deepEqual([overlaps[0].firstAtomId, overlaps[0].secondAtomId].sort(), ['Br2', 'Cl1']);
  });
});

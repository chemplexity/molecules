import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { Molecule } from '../../../../src/core/index.js';
import { parseSMILES } from '../../../../src/io/smiles.js';
import { createLayoutGraph } from '../../../../src/layout/engine/model/layout-graph.js';
import { atomLabelText, collectLabelBoxes, estimateLabelHalfSize, findLabelOverlaps, hasAnyLabelOverlap, summarizeLabelOverlaps } from '../../../../src/layout/engine/geometry/label-box.js';

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

  it('preserves label collection order for overlaps found by geometric sweep', () => {
    const molecule = new Molecule();
    molecule.addAtom('br', 'Br');
    molecule.addAtom('cl', 'Cl');
    molecule.addAtom('o', 'O');
    const graph = createLayoutGraph(molecule, { suppressH: true });
    const coords = new Map([
      ['br', { x: 1, y: 0 }],
      ['cl', { x: 0, y: 0 }],
      ['o', { x: 0.45, y: 0 }]
    ]);

    const overlaps = findLabelOverlaps(graph, coords, graph.options.bondLength);
    const labelBoxes = collectLabelBoxes(graph, coords, graph.options.bondLength);
    const summary = summarizeLabelOverlaps(labelBoxes, graph.options.bondLength * 0.08);

    assert.equal(hasAnyLabelOverlap(labelBoxes, graph.options.bondLength * 0.08), true);
    assert.deepEqual(summary, {
      pairCount: overlaps.length,
      totalPenalty: overlaps.reduce((sum, overlap) => sum + overlap.overlapX + overlap.overlapY, 0),
      maxPenalty: Math.max(...overlaps.map(overlap => overlap.overlapX + overlap.overlapY))
    });
    assert.deepEqual(
      overlaps.map(overlap => [overlap.firstAtomId, overlap.secondAtomId]),
      [
        ['br', 'cl'],
        ['br', 'o'],
        ['cl', 'o']
      ]
    );
  });
});

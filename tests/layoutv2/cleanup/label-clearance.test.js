import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { parseSMILES } from '../../../src/io/smiles.js';
import { findSevereOverlaps } from '../../../src/layoutv2/audit/invariants.js';
import { applyLabelClearance } from '../../../src/layoutv2/cleanup/label-clearance.js';
import { createLayoutGraph } from '../../../src/layoutv2/model/layout-graph.js';
import { makeChain } from '../support/molecules.js';

describe('layoutv2/cleanup/label-clearance', () => {
  it('nudges overlapping labeled terminal atoms when estimated boxes collide', () => {
    const molecule = makeChain(2, 'O');
    const graph = createLayoutGraph(molecule, {
      labelMetrics: {
        averageCharWidth: 1,
        textHeight: 0.8
      }
    });
    const result = applyLabelClearance(graph, new Map([
      ['a0', { x: 0, y: 0 }],
      ['a1', { x: 0.1, y: 0 }]
    ]), {
      bondLength: graph.options.bondLength,
      labelMetrics: graph.options.labelMetrics
    });

    assert.ok(result.nudges >= 1);
  });

  it('rejects label nudges that would introduce a severe heavy-atom overlap', () => {
    const molecule = parseSMILES('C1=CC=C(C=C1)C(C(=O)O)(N)P(=O)(O)O');
    const graph = createLayoutGraph(molecule, { suppressH: true });
    const inputCoords = new Map([
      ['C1', { x: 1.299038105676659, y: 1.875000000000001 }],
      ['C2', { x: 1.2990381056766584, y: 0.3750000000000008 }],
      ['C6', { x: 2.598076211353317, y: 2.625000000000001 }],
      ['C3', { x: 2.5980762113533165, y: -0.3749999999999998 }],
      ['C5', { x: 3.897114317029976, y: 1.8749999999999996 }],
      ['C4', { x: 3.897114317029975, y: 0 }],
      ['C7', { x: 5.196152422706632, y: -0.75 }],
      ['C8', { x: 6.49519052838329, y: -1.5000000000000004 }],
      ['N11', { x: 5.946152422706633, y: 0.5490381056766576 }],
      ['P12', { x: 4.446152422706631, y: -2.0490381056766576 }],
      ['O9', { x: 7.794228634059948, y: -0.7500000000000016 }],
      ['O10', { x: 6.495190528383289, y: -3.0000000000000004 }],
      ['O13', { x: 5.907776724869913, y: -2.087413803513376 }],
      ['O14', { x: 3.6961524227066307, y: -3.3480762113533156 }],
      ['O15', { x: 3.682105942410437, y: -0.8024221781329121 }]
    ]);

    const result = applyLabelClearance(graph, inputCoords, {
      bondLength: graph.options.bondLength,
      labelMetrics: graph.options.labelMetrics
    });

    assert.equal(findSevereOverlaps(graph, result.coords, graph.options.bondLength).length, 0);
  });
});

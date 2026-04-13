import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { Molecule } from '../../../../src/core/index.js';
import { parseSMILES } from '../../../../src/io/smiles.js';
import { findSevereOverlaps } from '../../../../src/layout/engine/audit/invariants.js';
import { applyLabelClearance } from '../../../../src/layout/engine/cleanup/label-clearance.js';
import { findLabelOverlaps } from '../../../../src/layout/engine/geometry/label-box.js';
import { createLayoutGraph } from '../../../../src/layout/engine/model/layout-graph.js';
import { makeChain } from '../support/molecules.js';

describe('layout/engine/cleanup/label-clearance', () => {
  /**
   * Sums the scalar overlap penalty across label-overlap records.
   * @param {Array<{overlapX: number, overlapY: number}>} overlaps - Label-overlap records.
   * @returns {number} Total overlap penalty.
   */
  const totalLabelPenalty = overlaps => overlaps.reduce((sum, overlap) => sum + overlap.overlapX + overlap.overlapY, 0);

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

  it('clears overlapping multi-character halogen labels', () => {
    const molecule = new Molecule();
    molecule.addAtom('Cl1', 'Cl');
    molecule.addAtom('Br2', 'Br');
    const graph = createLayoutGraph(molecule, { suppressH: true });
    const overlappingCoords = new Map([
      ['Cl1', { x: 0, y: 0 }],
      ['Br2', { x: 0.9, y: 0 }]
    ]);

    const before = findLabelOverlaps(graph, overlappingCoords, graph.options.bondLength);
    assert.equal(before.length, 1);

    const cleared = applyLabelClearance(graph, overlappingCoords, {
      bondLength: graph.options.bondLength,
      labelMetrics: graph.options.labelMetrics
    });

    const after = findLabelOverlaps(graph, cleared.coords, graph.options.bondLength);
    assert.equal(after.length, 0);
    assert.ok(cleared.nudges >= 1);
  });

  it('clears overlapping chlorine labels in a terminal dihalide fragment', () => {
    const graph = createLayoutGraph(parseSMILES('Cl.Cl'), { suppressH: true });
    const overlappingCoords = new Map([
      ['Cl1', { x: 0, y: 0 }],
      ['Cl2', { x: 0.9, y: 0 }]
    ]);

    const before = findLabelOverlaps(graph, overlappingCoords, graph.options.bondLength);
    assert.equal(before.length, 1);

    const cleared = applyLabelClearance(graph, overlappingCoords, {
      bondLength: graph.options.bondLength,
      labelMetrics: graph.options.labelMetrics
    });

    const after = findLabelOverlaps(graph, cleared.coords, graph.options.bondLength);
    assert.equal(after.length, 0);
    assert.ok(cleared.nudges >= 1);
    assert.ok(totalLabelPenalty(after) < totalLabelPenalty(before));
  });

  it('rejects a label nudge that would worsen the attached heavy-bond deviation', () => {
    const molecule = new Molecule();
    molecule.addAtom('C1', 'C');
    molecule.addAtom('O2', 'O');
    molecule.addAtom('Cl3', 'Cl');
    molecule.addBond('b0', 'C1', 'O2', {}, false);
    const graph = createLayoutGraph(molecule, { suppressH: true });
    const overlappingCoords = new Map([
      ['C1', { x: 0, y: 0 }],
      ['Cl3', { x: 1.4, y: 0 }],
      ['O2', { x: 1.5, y: 0 }]
    ]);

    const result = applyLabelClearance(graph, overlappingCoords, {
      bondLength: graph.options.bondLength,
      labelMetrics: graph.options.labelMetrics
    });

    assert.equal(result.nudges, 0);
    assert.deepEqual(result.coords.get('O2'), overlappingCoords.get('O2'));
  });

  it('returns early when no collected labels overlap', () => {
    const graph = createLayoutGraph(parseSMILES('CCO'), { suppressH: true });
    const coords = new Map([
      ['C1', { x: 0, y: 0 }],
      ['C2', { x: 1.5, y: 0 }],
      ['O3', { x: 3, y: 0 }]
    ]);

    const result = applyLabelClearance(graph, coords, {
      bondLength: graph.options.bondLength,
      labelMetrics: graph.options.labelMetrics
    });

    assert.equal(result.nudges, 0);
    assert.deepEqual([...result.coords.entries()], [...coords.entries()]);
  });
});

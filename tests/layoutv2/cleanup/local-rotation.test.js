import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Molecule } from '../../../src/core/index.js';
import { parseSMILES } from '../../../src/io/smiles.js';
import { createLayoutGraph } from '../../../src/layoutv2/model/layout-graph.js';
import { runLocalCleanup } from '../../../src/layoutv2/cleanup/local-rotation.js';
import { measureLayoutCost } from '../../../src/layoutv2/audit/invariants.js';

function makeBranchedFixture() {
  const molecule = new Molecule();
  molecule.addAtom('a0', 'C');
  molecule.addAtom('a1', 'C');
  molecule.addAtom('a2', 'C');
  molecule.addBond('b0', 'a0', 'a1', {}, false);
  molecule.addBond('b1', 'a1', 'a2', {}, false);
  return molecule;
}

describe('layoutv2/cleanup/local-rotation', () => {
  it('rotates a leaf atom when doing so lowers overlap cost', () => {
    const graph = createLayoutGraph(makeBranchedFixture());
    const coords = new Map([
      ['a0', { x: 0, y: 0 }],
      ['a1', { x: 1.5, y: 0 }],
      ['a2', { x: 0.2, y: 0 }]
    ]);
    const before = measureLayoutCost(graph, coords, 1.5);
    const result = runLocalCleanup(graph, coords, { maxPasses: 2, bondLength: 1.5 });
    const after = measureLayoutCost(graph, result.coords, 1.5);
    assert.ok(after < before);
    assert.ok(result.improvement > 0);
    assert.ok(result.passes > 0);
  });

  it('rotates a terminal heavy-atom subtree instead of only lone leaf atoms', () => {
    const molecule = parseSMILES('OP(O)O');
    const graph = createLayoutGraph(molecule, { suppressH: true });
    const coords = new Map([
      ['O1', { x: 0, y: 0 }],
      ['P2', { x: 1.5, y: 0 }],
      ['O3', { x: 2.1, y: 0.1 }],
      ['O4', { x: 2.15, y: -0.1 }],
      ['H5', { x: 2.7, y: 0.1 }],
      ['H6', { x: 2.75, y: -0.1 }]
    ]);
    const before = measureLayoutCost(graph, coords, 1.5);
    const result = runLocalCleanup(graph, coords, { maxPasses: 6, bondLength: 1.5 });
    const after = measureLayoutCost(graph, result.coords, 1.5);

    assert.ok(after < before);
    assert.ok(result.passes > 0);
  });

  it('rotates a linear terminal subgroup around a single bond when that improves trigonal readability', () => {
    const molecule = parseSMILES('N#CC(C#N)=C(C#N)C#N');
    const graph = createLayoutGraph(molecule, { suppressH: true });
    const coords = new Map([
      ['C2', { x: 5.196152422706632, y: -1.1250000000000002 }],
      ['C4', { x: 3.897114317029974, y: 1.125 }],
      ['C7', { x: 1.299038105676658, y: -1.875 }],
      ['C9', { x: 1.8480762113533165, y: 0.174038105676658 }],
      ['C3', { x: 3.897114317029974, y: -0.3750000000000002 }],
      ['C6', { x: 2.598076211353316, y: -1.125 }],
      ['N1', { x: 6.49519052838329, y: -1.875 }],
      ['N5', { x: 3.897114317029974, y: 2.625 }],
      ['N8', { x: 0, y: -2.625 }],
      ['N10', { x: 1.098076211353317, y: 1.473076211353316 }]
    ]);
    const before = measureLayoutCost(graph, coords, 1.5);
    const result = runLocalCleanup(graph, coords, { maxPasses: 8, bondLength: 1.5 });
    const after = measureLayoutCost(graph, result.coords, 1.5);

    assert.ok(after < before);
    assert.ok(result.passes > 0);
    assert.notDeepEqual(result.coords.get('C7'), coords.get('C7'));
  });
});

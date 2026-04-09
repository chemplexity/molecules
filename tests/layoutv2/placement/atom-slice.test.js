import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createLayoutGraph } from '../../../src/layoutv2/model/layout-graph.js';
import { buildSliceAdjacency, createAtomSlice, layoutAtomSlice } from '../../../src/layoutv2/placement/atom-slice.js';
import { makeMethylbenzene, makeOrganometallic } from '../support/molecules.js';

describe('layoutv2/placement/atom-slice', () => {
  it('lays out a full organic slice with the shared family dispatch', () => {
    const graph = createLayoutGraph(makeMethylbenzene());
    const component = createAtomSlice(graph, graph.components[0].atomIds, 'slice:organic');
    const result = layoutAtomSlice(graph, component, graph.options.bondLength);
    assert.equal(result.supported, true);
    assert.equal(result.family, 'mixed');
    assert.equal(result.coords.size, 7);
  });

  it('can build covalent-only adjacency for a ligand slice', () => {
    const graph = createLayoutGraph(makeOrganometallic());
    const adjacency = buildSliceAdjacency(graph, ['n1', 'c1'], {
      includeBond(bond) {
        return bond.kind === 'covalent';
      }
    });
    assert.deepEqual(adjacency.get('n1'), ['c1']);
    assert.deepEqual(adjacency.get('c1'), ['n1']);
  });
});

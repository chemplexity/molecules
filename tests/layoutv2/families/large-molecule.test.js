import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createLayoutGraph } from '../../../src/layoutv2/model/layout-graph.js';
import { layoutLargeMoleculeFamily } from '../../../src/layoutv2/families/large-molecule.js';
import { makeLargePolyaryl } from '../support/molecules.js';

describe('layoutv2/families/large-molecule', () => {
  it('partitions and stitches a multi-block organic component', () => {
    const graph = createLayoutGraph(makeLargePolyaryl(), {
      largeMoleculeThreshold: {
        heavyAtomCount: 12,
        ringSystemCount: 2,
        blockCount: 16
      }
    });
    const result = layoutLargeMoleculeFamily(graph, graph.components[0], graph.options.bondLength);
    assert.equal(result.placementMode, 'block-stitched');
    assert.equal(result.coords.size, 34);
    assert.ok(result.blockCount > 1);
    assert.equal(typeof result.refinedStitchCount, 'number');
    assert.ok(result.coords.has('a0'));
    assert.ok(result.coords.has('b0'));
    assert.ok(result.coords.has('e0'));
  });
});

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { createLayoutGraph } from '../../../src/layoutv2/model/layout-graph.js';
import { pickBridgeheads } from '../../../src/layoutv2/topology/bridgeheads.js';
import { makeNorbornane } from '../support/molecules.js';

describe('layoutv2/topology/bridgeheads', () => {
  it('picks the highest-degree canonical bridgehead pair', () => {
    const graph = createLayoutGraph(makeNorbornane());
    assert.deepEqual(pickBridgeheads(graph, [...graph.atoms.keys()]), ['a0', 'a1']);
  });
});

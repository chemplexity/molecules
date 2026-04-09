import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { createLayoutGraph } from '../../../src/layoutv2/model/layout-graph.js';
import { chooseScaffoldPlan } from '../../../src/layoutv2/scaffold/choose-scaffold.js';
import { makeNaphthylbenzene } from '../support/molecules.js';

describe('layoutv2/scaffold/choose-scaffold', () => {
  it('chooses the root scaffold for a mixed connected component', () => {
    const graph = createLayoutGraph(makeNaphthylbenzene());
    const plan = chooseScaffoldPlan(graph, graph.components[0]);
    assert.equal(plan.rootScaffold.family, 'fused');
  });
});

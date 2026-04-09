import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { createLayoutGraph } from '../../../src/layoutv2/model/layout-graph.js';
import { findTemplateMatch } from '../../../src/layoutv2/scaffold/template-match.js';
import { makeBenzene } from '../support/molecules.js';

describe('layoutv2/scaffold/template-match', () => {
  it('finds the expected scaffold template for benzene', () => {
    const graph = createLayoutGraph(makeBenzene());
    const match = findTemplateMatch(graph, {
      type: 'ring-system',
      family: 'isolated-ring',
      atomIds: graph.rings[0].atomIds,
      atomCount: graph.rings[0].atomIds.length,
      bondCount: 6,
      ringCount: 1
    });
    assert.equal(match?.id, 'benzene');
  });
});

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { createLayoutGraph } from '../../../src/layoutv2/model/layout-graph.js';
import { resolveOverlaps } from '../../../src/layoutv2/cleanup/overlap-resolution.js';
import { makeDisconnectedEthanes } from '../support/molecules.js';

describe('layoutv2/cleanup/overlap-resolution', () => {
  it('nudges severe overlaps apart before local cleanup', () => {
    const graph = createLayoutGraph(makeDisconnectedEthanes());
    const result = resolveOverlaps(graph, new Map([
      ['a0', { x: 0, y: 0 }],
      ['c0', { x: 0.1, y: 0 }]
    ]), { bondLength: graph.options.bondLength });
    assert.ok(result.moves > 0);
    assert.ok(result.coords.get('c0').x > 0.1);
  });
});

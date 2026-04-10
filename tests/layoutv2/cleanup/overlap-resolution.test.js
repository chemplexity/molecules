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

  it('honors larger configured overlap targets above the audit floor', () => {
    const graph = createLayoutGraph(makeDisconnectedEthanes());
    const initialCoords = new Map([
      ['a0', { x: 0, y: 0 }],
      ['c0', { x: 0.3, y: 0 }]
    ]);
    const defaultResult = resolveOverlaps(graph, initialCoords, {
      bondLength: graph.options.bondLength
    });
    const widerTarget = resolveOverlaps(graph, initialCoords, {
      bondLength: graph.options.bondLength,
      thresholdFactor: 0.7
    });
    const defaultSeparation = defaultResult.coords.get('c0').x - defaultResult.coords.get('a0').x;
    const widerSeparation = widerTarget.coords.get('c0').x - widerTarget.coords.get('a0').x;

    assert.ok(widerSeparation > defaultSeparation);
  });
});

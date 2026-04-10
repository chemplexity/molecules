import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { createLayoutGraph } from '../../../src/layoutv2/model/layout-graph.js';
import { resolveOverlaps } from '../../../src/layoutv2/cleanup/overlap-resolution.js';
import { makeDisconnectedEthanes } from '../support/molecules.js';

describe('layoutv2/cleanup/overlap-resolution', () => {
  it('moves the more disposable atom without stretching the less movable partner', () => {
    const graph = {
      options: { bondLength: 1.5, preserveFixed: true },
      fixedCoords: new Map(),
      atoms: new Map([
        ['anchor', { id: 'anchor', element: 'C', heavyDegree: 3 }],
        ['leaf', { id: 'leaf', element: 'C', heavyDegree: 1 }],
        ['core', { id: 'core', element: 'C', heavyDegree: 3 }]
      ]),
      bondedPairSet: new Set(['anchor:leaf']),
      bondsByAtomId: new Map([
        ['anchor', [{ a: 'anchor', b: 'leaf', kind: 'covalent' }]],
        ['leaf', [{ a: 'anchor', b: 'leaf', kind: 'covalent' }]],
        ['core', []]
      ])
    };
    const inputCoords = new Map([
      ['anchor', { x: -1.5, y: 0 }],
      ['leaf', { x: 0, y: 0 }],
      ['core', { x: 0.1, y: 0 }]
    ]);

    const result = resolveOverlaps(graph, inputCoords, { bondLength: 1.5 });
    const anchorPosition = result.coords.get('anchor');
    const leafPosition = result.coords.get('leaf');
    const originalDistance = Math.hypot(inputCoords.get('leaf').x - inputCoords.get('core').x, inputCoords.get('leaf').y - inputCoords.get('core').y);
    const resolvedDistance = Math.hypot(leafPosition.x - result.coords.get('core').x, leafPosition.y - result.coords.get('core').y);

    assert.ok(result.moves > 0);
    assert.equal(result.coords.get('core').x, 0.1);
    assert.ok(resolvedDistance > originalDistance);
    assert.ok(Math.abs(Math.hypot(leafPosition.x - anchorPosition.x, leafPosition.y - anchorPosition.y) - 1.5) < 1e-9);
  });

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

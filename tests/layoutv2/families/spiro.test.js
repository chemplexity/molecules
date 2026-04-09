import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createLayoutGraph } from '../../../src/layoutv2/model/layout-graph.js';
import { layoutSpiroFamily } from '../../../src/layoutv2/families/spiro.js';
import { makeSpiro } from '../support/molecules.js';

describe('layoutv2/families/spiro', () => {
  it('lays out a spiro ring pair around the shared atom', () => {
    const rings = [
      { id: 0, atomIds: ['a0', 'a1', 'a2', 'a3', 'a4'] },
      { id: 1, atomIds: ['a4', 'a5', 'a6', 'a7', 'a8'] }
    ];
    const ringAdj = new Map([
      [0, [1]],
      [1, [0]]
    ]);
    const ringConnectionByPair = new Map([['0:1', {
      firstRingId: 0,
      secondRingId: 1,
      sharedAtomIds: ['a4'],
      kind: 'spiro'
    }]]);
    const result = layoutSpiroFamily(rings, ringAdj, ringConnectionByPair, 1.5);
    assert.equal(result.coords.size, 9);
    assert.equal(result.coords.has('a4'), true);
    assert.notDeepEqual(result.ringCenters.get(0), result.ringCenters.get(1));
  });

  it('uses template placement when a matched spiro scaffold is provided', () => {
    const graph = createLayoutGraph(makeSpiro());
    const ringAdj = new Map(graph.rings.map(ring => [ring.id, []]));
    const ringConnectionByPair = new Map();
    for (const connection of graph.ringConnections) {
      if (connection.kind !== 'spiro') {
        continue;
      }
      ringAdj.get(connection.firstRingId)?.push(connection.secondRingId);
      ringAdj.get(connection.secondRingId)?.push(connection.firstRingId);
      const key = connection.firstRingId < connection.secondRingId
        ? `${connection.firstRingId}:${connection.secondRingId}`
        : `${connection.secondRingId}:${connection.firstRingId}`;
      ringConnectionByPair.set(key, connection);
    }
    const result = layoutSpiroFamily(graph.rings, ringAdj, ringConnectionByPair, graph.options.bondLength, { layoutGraph: graph, templateId: 'spiro-5-5' });
    assert.equal(result.placementMode, 'template');
  });
});

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createLayoutGraph } from '../../../src/layoutv2/model/layout-graph.js';
import { layoutFusedFamily } from '../../../src/layoutv2/families/fused.js';
import { distance } from '../../../src/layoutv2/geometry/vec2.js';
import { makeNaphthalene } from '../support/molecules.js';

describe('layoutv2/families/fused', () => {
  it('lays out a simple fused two-ring system across the shared edge', () => {
    const rings = [
      { id: 0, atomIds: ['a0', 'a1', 'a2', 'a3', 'a4', 'a5'] },
      { id: 1, atomIds: ['a4', 'a5', 'a9', 'a8', 'a7', 'a6'] }
    ];
    const ringAdj = new Map([
      [0, [1]],
      [1, [0]]
    ]);
    const ringConnectionByPair = new Map([['0:1', {
      firstRingId: 0,
      secondRingId: 1,
      sharedAtomIds: ['a4', 'a5'],
      kind: 'fused'
    }]]);
    const result = layoutFusedFamily(rings, ringAdj, ringConnectionByPair, 1.5);
    assert.equal(result.coords.size, 10);
    assert.ok(Math.abs(distance(result.coords.get('a4'), result.coords.get('a5')) - 1.5) < 1e-6);
    assert.notDeepEqual(result.ringCenters.get(0), result.ringCenters.get(1));
  });

  it('uses template placement when a matched fused scaffold is provided', () => {
    const graph = createLayoutGraph(makeNaphthalene());
    const ringAdj = new Map(graph.rings.map(ring => [ring.id, []]));
    const ringConnectionByPair = new Map();
    for (const connection of graph.ringConnections) {
      if (connection.kind !== 'fused') {
        continue;
      }
      ringAdj.get(connection.firstRingId)?.push(connection.secondRingId);
      ringAdj.get(connection.secondRingId)?.push(connection.firstRingId);
      const key = connection.firstRingId < connection.secondRingId
        ? `${connection.firstRingId}:${connection.secondRingId}`
        : `${connection.secondRingId}:${connection.firstRingId}`;
      ringConnectionByPair.set(key, connection);
    }
    const result = layoutFusedFamily(graph.rings, ringAdj, ringConnectionByPair, graph.options.bondLength, { layoutGraph: graph, templateId: 'naphthalene' });
    assert.equal(result.placementMode, 'template');
  });
});

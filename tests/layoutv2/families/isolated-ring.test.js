import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createLayoutGraph } from '../../../src/layoutv2/model/layout-graph.js';
import { layoutIsolatedRingFamily } from '../../../src/layoutv2/families/isolated-ring.js';
import { distance } from '../../../src/layoutv2/geometry/vec2.js';
import { makeBenzene } from '../support/molecules.js';

describe('layoutv2/families/isolated-ring', () => {
  it('lays out a regular isolated ring', () => {
    const ring = { id: 0, atomIds: ['a0', 'a1', 'a2', 'a3', 'a4', 'a5'] };
    const result = layoutIsolatedRingFamily(ring, 1.5);
    assert.equal(result.coords.size, 6);
    assert.equal(result.ringCenters.size, 1);
    assert.ok(Math.abs(distance(result.coords.get('a0'), result.coords.get('a1')) - 1.5) < 1e-6);
  });

  it('uses template placement when a matched scaffold is provided', () => {
    const graph = createLayoutGraph(makeBenzene());
    const result = layoutIsolatedRingFamily(graph.rings[0], graph.options.bondLength, { layoutGraph: graph, templateId: 'benzene' });
    assert.equal(result.placementMode, 'template');
  });
});

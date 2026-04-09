import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createLayoutGraph } from '../../../src/layoutv2/model/layout-graph.js';
import { layoutBridgedFamily } from '../../../src/layoutv2/families/bridged.js';
import { makeAdamantane, makeBicyclo222, makeNorbornane, makeUnmatchedBridgedCage } from '../support/molecules.js';

describe('layoutv2/families/bridged', () => {
  it('places a matched bridged scaffold through template coordinates', () => {
    const graph = createLayoutGraph(makeNorbornane());
    const result = layoutBridgedFamily(graph.rings, graph.options.bondLength, { layoutGraph: graph, templateId: 'norbornane' });
    assert.equal(result.placementMode, 'template');
    assert.equal(result.coords.size, 7);
    assert.equal(result.ringCenters.size, 2);
  });

  it('falls back to Kamada-Kawai when no bridged template match is provided', () => {
    const graph = createLayoutGraph(makeUnmatchedBridgedCage());
    const result = layoutBridgedFamily(graph.rings, graph.options.bondLength, { layoutGraph: graph, templateId: null });
    assert.equal(result.placementMode, 'projected-kamada-kawai');
    assert.equal(result.coords.size, 6);
    assert.ok(result.coords.get('a0').x < result.coords.get('a1').x);
    assert.ok(Math.abs(result.coords.get('a0').y) < 1e-6);
    assert.ok(Math.abs(result.coords.get('a1').y) < 1e-6);
  });

  it('places larger bridged cages from their templates too', () => {
    const bicycloGraph = createLayoutGraph(makeBicyclo222());
    const bicycloResult = layoutBridgedFamily(bicycloGraph.rings, bicycloGraph.options.bondLength, { layoutGraph: bicycloGraph, templateId: 'bicyclo-2-2-2' });
    assert.equal(bicycloResult.coords.size, 8);

    const adamantaneGraph = createLayoutGraph(makeAdamantane());
    const adamantaneResult = layoutBridgedFamily(adamantaneGraph.rings, adamantaneGraph.options.bondLength, { layoutGraph: adamantaneGraph, templateId: 'adamantane' });
    assert.equal(adamantaneResult.coords.size, 10);
  });
});

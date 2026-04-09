import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createLayoutGraph } from '../../../src/layoutv2/model/layout-graph.js';
import { distance } from '../../../src/layoutv2/geometry/vec2.js';
import { placeTemplateCoords } from '../../../src/layoutv2/templates/placement.js';
import { makeAdamantane, makeBenzene, makeBicyclo222, makeNaphthalene, makeNorbornane, makeSpiro } from '../support/molecules.js';

describe('layoutv2/templates/placement', () => {
  it('places an isolated aromatic ring from a matched scaffold template', () => {
    const graph = createLayoutGraph(makeBenzene());
    const coords = placeTemplateCoords(graph, 'benzene', graph.ringSystems[0].atomIds, graph.options.bondLength);
    assert.equal(coords.size, 6);
    assert.ok(Math.abs(distance(coords.get('a0'), coords.get('a1')) - graph.options.bondLength) < 1e-6);
  });

  it('places a fused aromatic scaffold from the naphthalene template', () => {
    const graph = createLayoutGraph(makeNaphthalene());
    const coords = placeTemplateCoords(graph, 'naphthalene', graph.ringSystems[0].atomIds, graph.options.bondLength);
    assert.equal(coords.size, 10);
    assert.ok(Math.abs(coords.get('a4').x - coords.get('a5').x) < 1e-6);
  });

  it('places the supported spiro template too', () => {
    const graph = createLayoutGraph(makeSpiro());
    const coords = placeTemplateCoords(graph, 'spiro-5-5', graph.ringSystems[0].atomIds, graph.options.bondLength);
    assert.equal(coords.size, 9);
    assert.equal(coords.has('a4'), true);
  });

  it('places a bridged norbornane scaffold from its template', () => {
    const graph = createLayoutGraph(makeNorbornane());
    const coords = placeTemplateCoords(graph, 'norbornane', graph.ringSystems[0].atomIds, graph.options.bondLength);
    assert.equal(coords.size, 7);
    assert.equal(coords.has('a6'), true);
  });

  it('places the larger bicyclo and adamantane cage templates too', () => {
    const bicycloGraph = createLayoutGraph(makeBicyclo222());
    const bicycloCoords = placeTemplateCoords(bicycloGraph, 'bicyclo-2-2-2', bicycloGraph.ringSystems[0].atomIds, bicycloGraph.options.bondLength);
    assert.equal(bicycloCoords.size, 8);
    assert.equal(bicycloCoords.has('a7'), true);

    const adamantaneGraph = createLayoutGraph(makeAdamantane());
    const adamantaneCoords = placeTemplateCoords(adamantaneGraph, 'adamantane', adamantaneGraph.ringSystems[0].atomIds, adamantaneGraph.options.bondLength);
    assert.equal(adamantaneCoords.size, 10);
    assert.equal(adamantaneCoords.has('a9'), true);
  });
});

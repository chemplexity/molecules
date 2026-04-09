import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { createLayoutGraph } from '../../../src/layoutv2/model/layout-graph.js';
import { placeTemplateCoords } from '../../../src/layoutv2/scaffold/template-placement.js';
import { makeBenzene } from '../support/molecules.js';

describe('layoutv2/scaffold/template-placement', () => {
  it('places a matched benzene scaffold onto existing atom ids', () => {
    const graph = createLayoutGraph(makeBenzene());
    const coords = placeTemplateCoords(graph, 'benzene', graph.rings[0].atomIds, graph.options.bondLength);
    assert.equal(coords.size, 6);
  });
});

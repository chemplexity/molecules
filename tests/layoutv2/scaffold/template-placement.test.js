import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { parseSMILES } from '../../../src/io/smiles.js';
import { createLayoutGraph } from '../../../src/layoutv2/model/layout-graph.js';
import { placeTemplateCoords } from '../../../src/layoutv2/scaffold/template-placement.js';
import { getTemplateById, getTemplateCoords } from '../../../src/layoutv2/templates/library.js';
import { makeBenzene } from '../support/molecules.js';

describe('layoutv2/scaffold/template-placement', () => {
  it('places a matched benzene scaffold onto existing atom ids', () => {
    const graph = createLayoutGraph(makeBenzene());
    const coords = placeTemplateCoords(graph, 'benzene', graph.rings[0].atomIds, graph.options.bondLength);
    assert.equal(coords.size, 6);
  });

  it('places the indole nitrogen at its expected template position', () => {
    const molecule = parseSMILES('Cc1ccc2[nH]ccc2c1');
    const graph = createLayoutGraph(molecule);
    const ringSystem = graph.ringSystems[0];
    const coords = placeTemplateCoords(graph, 'indole', ringSystem.atomIds, graph.options.bondLength);
    const expectedCoords = getTemplateCoords(getTemplateById('indole'), graph.options.bondLength);

    assert.ok(coords);
    assert.ok(expectedCoords);

    const placedNitrogen = coords.get('N6');
    const expectedNitrogen = expectedCoords.get('a0');
    assert.ok(placedNitrogen);
    assert.ok(expectedNitrogen);
    assert.ok(Math.hypot(
      placedNitrogen.x - expectedNitrogen.x,
      placedNitrogen.y - expectedNitrogen.y
    ) < graph.options.bondLength * 0.01);
  });
});

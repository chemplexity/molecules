import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseSMILES } from '../../../src/io/smiles.js';
import { layoutMacrocycleFamily } from '../../../src/layoutv2/families/macrocycle.js';
import { createLayoutGraph } from '../../../src/layoutv2/model/layout-graph.js';
import { computeBounds } from '../../../src/layoutv2/geometry/bounds.js';
import { makeMacrocycle } from '../support/molecules.js';

describe('layoutv2/families/macrocycle', () => {
  it('lays out a simple macrocycle on an ellipse with full coordinates', () => {
    const graph = createLayoutGraph(makeMacrocycle());
    const result = layoutMacrocycleFamily(graph.rings, graph.options.bondLength);
    assert.equal(result.placementMode, 'ellipse');
    assert.equal(result.coords.size, 12);
    assert.equal(result.ringCenters.size, 1);

    const bounds = computeBounds(result.coords, graph.rings[0].atomIds);
    assert.ok(bounds.width > 0);
    assert.ok(bounds.height > 0);
    assert.ok(Math.abs(bounds.width - bounds.height) < 0.25);
  });

  it('uses a more elongated oval for larger macrocycles', () => {
    const graph = createLayoutGraph(makeMacrocycle(24));
    const result = layoutMacrocycleFamily(graph.rings, graph.options.bondLength);
    const bounds = computeBounds(result.coords, graph.rings[0].atomIds);

    assert.ok(bounds.width / bounds.height > 1.4);
  });

  it('uses template geometry when a matched macrocycle template is available', () => {
    const graph = createLayoutGraph(parseSMILES('C1=CC2=CC3=CC=C(N3)C=C4C=CC(=N4)C=C5C=CC(=N5)C=C1N2'));
    const result = layoutMacrocycleFamily(graph.rings, graph.options.bondLength, {
      layoutGraph: graph,
      templateId: 'porphine'
    });

    assert.equal(result.placementMode, 'template');
    assert.equal(result.coords.size, 24);
    assert.equal(result.ringCenters.size, 5);
    const bounds = computeBounds(result.coords, graph.ringSystems[0].atomIds);
    assert.ok(Math.abs(bounds.width - bounds.height) < 1e-6);
  });
});

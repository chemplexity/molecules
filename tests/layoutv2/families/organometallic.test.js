import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createLayoutGraph } from '../../../src/layoutv2/model/layout-graph.js';
import { layoutOrganometallicFamily } from '../../../src/layoutv2/families/organometallic.js';
import { makeBisLigatedOrganometallic, makeOrganometallic } from '../support/molecules.js';

describe('layoutv2/families/organometallic', () => {
  it('lays out a simple metal-ligand fragment through the ligand-first path', () => {
    const graph = createLayoutGraph(makeOrganometallic());
    const result = layoutOrganometallicFamily(graph, graph.components[0], graph.options.bondLength);
    assert.equal(result.placementMode, 'ligand-first');
    assert.equal(result.coords.size, 3);
    assert.notDeepEqual(result.coords.get('ru'), result.coords.get('n1'));
  });

  it('spreads multiple ligands around the metal center deterministically', () => {
    const graph = createLayoutGraph(makeBisLigatedOrganometallic());
    const result = layoutOrganometallicFamily(graph, graph.components[0], graph.options.bondLength);
    assert.equal(result.coords.size, 5);
    const metal = result.coords.get('ru');
    const firstLigand = result.coords.get('n1');
    const secondLigand = result.coords.get('n2');
    assert.ok(firstLigand.x > metal.x || secondLigand.x > metal.x);
    assert.ok(firstLigand.x < metal.x || secondLigand.x < metal.x);
  });
});

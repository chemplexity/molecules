import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createLayoutGraph } from '../../../../src/layout/engine/model/layout-graph.js';
import { makeNaphthalene, makeOrganometallic } from '../support/molecules.js';

describe('layout/engine/model/layout-graph', () => {
  it('creates the topology-ready layout graph shell for a fused ring system', () => {
    const molecule = makeNaphthalene();
    const graph = createLayoutGraph(molecule, {
      fixedCoords: new Map([['a0', { x: 0, y: 0 }]])
    });
    assert.equal(graph.atoms.size, 10);
    assert.equal(graph.bonds.size, 11);
    assert.equal(graph.rings.length, 2);
    assert.equal(graph.ringSystems.length, 1);
    assert.equal(graph.ringConnections.length, 1);
    assert.equal(graph.ringConnections[0].kind, 'fused');
    assert.equal(graph.fixedCoords.size, 1);
    assert.equal(graph.traits.heavyAtomCount, 10);
    assert.equal(graph.traits.bridgedRingConnectionCount, 0);
  });

  it('derives hydrogen-visibility and metal traits from the source molecule', () => {
    const molecule = makeOrganometallic();
    molecule.addAtom('h0', 'H');
    molecule.addBond('bh0', 'c1', 'h0', {}, false);
    molecule.atoms.get('h0').visible = false;
    const graph = createLayoutGraph(molecule);
    assert.equal(graph.traits.containsMetal, true);
    assert.equal(graph.traits.hiddenHydrogenCount, 1);
    assert.equal(graph.traits.visibleHydrogenCount, 0);
  });
});

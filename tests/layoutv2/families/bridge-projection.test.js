import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createLayoutGraph } from '../../../src/layoutv2/model/layout-graph.js';
import { enumerateBridgePaths, pickBridgeheads, projectBridgePaths } from '../../../src/layoutv2/families/bridge-projection.js';
import { layoutKamadaKawai } from '../../../src/layoutv2/geometry/kk-layout.js';
import { makeNorbornane, makeUnmatchedBridgedCage } from '../support/molecules.js';

describe('layoutv2/families/bridge-projection', () => {
  it('picks the highest-degree bridgehead pair deterministically', () => {
    const graph = createLayoutGraph(makeUnmatchedBridgedCage());
    assert.deepEqual(pickBridgeheads(graph, [...graph.atoms.keys()]), ['a0', 'a1']);
  });

  it('enumerates simple bridge paths between the chosen bridgeheads', () => {
    const graph = createLayoutGraph(makeNorbornane());
    const paths = enumerateBridgePaths(graph, [...graph.atoms.keys()], ['a0', 'a1']);
    assert.deepEqual(paths, [
      ['a0', 'a6', 'a1'],
      ['a0', 'a2', 'a3', 'a1'],
      ['a0', 'a4', 'a5', 'a1']
    ]);
  });

  it('projects unmatched bridged seeds into a horizontal bridgehead frame with split bridge faces', () => {
    const graph = createLayoutGraph(makeUnmatchedBridgedCage());
    const atomIds = [...graph.atoms.keys()];
    const kk = layoutKamadaKawai(graph.sourceMolecule, atomIds, { bondLength: graph.options.bondLength });
    assert.equal(kk.ok, true);

    const projected = projectBridgePaths(graph, atomIds, kk.coords, graph.options.bondLength);
    assert.deepEqual(projected.bridgeheadAtomIds, ['a0', 'a1']);
    assert.equal(projected.pathCount, 4);
    assert.ok(Math.abs(projected.coords.get('a0').y) < 1e-6);
    assert.ok(Math.abs(projected.coords.get('a1').y) < 1e-6);
    assert.ok(projected.coords.get('a0').x < projected.coords.get('a1').x);

    const internalYs = ['a2', 'a3', 'a4', 'a5'].map(atomId => projected.coords.get(atomId).y);
    assert.ok(internalYs.some(value => value > 0.1));
    assert.ok(internalYs.some(value => value < -0.1));
  });
});

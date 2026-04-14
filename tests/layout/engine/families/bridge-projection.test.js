import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseSMILES } from '../../../../src/io/smiles.js';
import { BRIDGE_PROJECTION_FACTORS } from '../../../../src/layout/engine/constants.js';
import { createLayoutGraph } from '../../../../src/layout/engine/model/layout-graph.js';
import { enumerateBridgePaths, pickBridgeheads, projectBridgePaths } from '../../../../src/layout/engine/families/bridge-projection.js';
import { layoutKamadaKawai } from '../../../../src/layout/engine/geometry/kk-layout.js';
import { makeNorbornane, makeUnmatchedBridgedCage } from '../support/molecules.js';

describe('layout/engine/families/bridge-projection', () => {
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

  it('skips bridge-face projection when a dense cage produces too many bridgehead paths', () => {
    const mol = parseSMILES(
      'COC(=O)C1=C2Nc3ccccc3[C@@]24CCN5[C@@H]6O[C@]78[C@H]9C[C@]%10%11CCO[C@H]%10CCN%12CC[C@]7([C@H]%11%12)c%13cccc(OC)c%13N8C[C@]6(C9)[C@@H]%14OCC[C@]%14(C1)[C@@H]45'
    );
    mol.hideHydrogens();
    const graph = createLayoutGraph(mol, { suppressH: true, bondLength: 1.5 });
    const atomIds = [...new Set(graph.rings.flatMap(ring => ring.atomIds))];
    const bridgeheadAtomIds = pickBridgeheads(graph, atomIds);
    const kk = layoutKamadaKawai(graph.sourceMolecule, atomIds, { bondLength: graph.options.bondLength });
    assert.equal(kk.ok, true);

    const orientedSeed = projectBridgePaths(graph, atomIds, kk.coords, graph.options.bondLength);

    assert.deepEqual(orientedSeed.bridgeheadAtomIds, bridgeheadAtomIds);
    assert.equal(orientedSeed.pathCount, BRIDGE_PROJECTION_FACTORS.maxProjectedPathCount + 1);
    assert.ok(Math.abs(orientedSeed.coords.get(bridgeheadAtomIds[0]).y) < 1e-6);
    assert.ok(Math.abs(orientedSeed.coords.get(bridgeheadAtomIds[1]).y) < 1e-6);

    const bridgeBondLength = Math.hypot(
      orientedSeed.coords.get('N17').x - orientedSeed.coords.get('C58').x,
      orientedSeed.coords.get('N17').y - orientedSeed.coords.get('C58').y
    );
    assert.ok(bridgeBondLength < graph.options.bondLength * 3);
  });
});

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { layoutAcyclicFamily } from '../../../src/layoutv2/families/acyclic.js';
import { createLayoutGraph } from '../../../src/layoutv2/model/layout-graph.js';
import { actualAlkeneStereo } from '../../../src/layoutv2/stereo/ez.js';
import { computeCanonicalAtomRanks } from '../../../src/layoutv2/topology/canonical-order.js';
import { distance, sub } from '../../../src/layoutv2/geometry/vec2.js';
import { parseSMILES } from '../../../src/io/smiles.js';
import { makeBut2Yne, makeChain, makeDimethylSulfone } from '../support/molecules.js';

function buildAdjacency(layoutGraph, atomIds) {
  const adjacency = new Map([...atomIds].map(atomId => [atomId, []]));
  for (const bond of layoutGraph.bonds.values()) {
    if (!atomIds.has(bond.a) || !atomIds.has(bond.b)) {
      continue;
    }
    adjacency.get(bond.a).push(bond.b);
    adjacency.get(bond.b).push(bond.a);
  }
  return adjacency;
}

describe('layoutv2/families/acyclic', () => {
  it('lays out an acyclic chain on a zigzag backbone', () => {
    const molecule = makeChain(4);
    const adjacency = new Map([
      ['a0', ['a1']],
      ['a1', ['a0', 'a2']],
      ['a2', ['a1', 'a3']],
      ['a3', ['a2']]
    ]);
    const atomIdsToPlace = new Set(['a0', 'a1', 'a2', 'a3']);
    const coords = layoutAcyclicFamily(adjacency, atomIdsToPlace, computeCanonicalAtomRanks(molecule), 1.5);
    assert.equal(coords.size, 4);
    const xValues = [...coords.values()].map(position => position.x).sort((firstValue, secondValue) => firstValue - secondValue);
    assert.ok(xValues[3] > xValues[0]);
    assert.ok(new Set([...coords.values()].map(position => position.y.toFixed(3))).size > 1);
    assert.ok(Math.abs(distance(coords.get('a1'), coords.get('a2')) - 1.5) < 1e-6);
    assert.ok(Math.abs(distance(coords.get('a0'), coords.get('a1')) - 1.5) < 1e-6);
  });

  it('keeps internal alkyne backbones linear through the triple bond', () => {
    const graph = createLayoutGraph(makeBut2Yne());
    const atomIdsToPlace = new Set(graph.components[0].atomIds);
    const coords = layoutAcyclicFamily(buildAdjacency(graph, atomIdsToPlace), atomIdsToPlace, graph.canonicalAtomRank, graph.options.bondLength, { layoutGraph: graph });
    const firstBond = sub(coords.get('a1'), coords.get('a0'));
    const secondBond = sub(coords.get('a2'), coords.get('a1'));
    const thirdBond = sub(coords.get('a3'), coords.get('a2'));
    const firstSecondCross = firstBond.x * secondBond.y - firstBond.y * secondBond.x;
    const secondThirdCross = secondBond.x * thirdBond.y - secondBond.y * thirdBond.x;

    assert.ok(Math.abs(firstSecondCross) < 1e-6);
    assert.ok(Math.abs(secondThirdCross) < 1e-6);
  });

  it('keeps sulfone oxygens off the main carbon-sulfur-carbon axis', () => {
    const graph = createLayoutGraph(makeDimethylSulfone());
    const atomIdsToPlace = new Set(graph.components[0].atomIds);
    const coords = layoutAcyclicFamily(buildAdjacency(graph, atomIdsToPlace), atomIdsToPlace, graph.canonicalAtomRank, graph.options.bondLength, { layoutGraph: graph });
    const sulfurPosition = coords.get('s0');
    const carbonAxis = sub(coords.get('c1'), coords.get('c0'));
    const firstOxo = sub(coords.get('o0'), sulfurPosition);
    const secondOxo = sub(coords.get('o1'), sulfurPosition);
    const axisLength = Math.hypot(carbonAxis.x, carbonAxis.y);
    const firstAlignment = Math.abs((carbonAxis.x * firstOxo.x + carbonAxis.y * firstOxo.y) / (axisLength * Math.hypot(firstOxo.x, firstOxo.y)));
    const secondAlignment = Math.abs((carbonAxis.x * secondOxo.x + carbonAxis.y * secondOxo.y) / (axisLength * Math.hypot(secondOxo.x, secondOxo.y)));

    assert.ok(firstAlignment < 0.8);
    assert.ok(secondAlignment < 0.8);
  });

  it('enforces configured E/Z stereo for acyclic alkenes', () => {
    const cases = [
      { smiles: 'F/C=C/F', expectedStereo: 'E' },
      { smiles: 'F/C=C\\F', expectedStereo: 'Z' }
    ];

    for (const testCase of cases) {
      const graph = createLayoutGraph(parseSMILES(testCase.smiles));
      const atomIdsToPlace = new Set(graph.components[0].atomIds);
      const coords = layoutAcyclicFamily(
        buildAdjacency(graph, atomIdsToPlace),
        atomIdsToPlace,
        graph.canonicalAtomRank,
        graph.options.bondLength,
        { layoutGraph: graph }
      );
      const alkeneBond = [...graph.bonds.values()].find(bond => bond.order === 2);

      assert.ok(alkeneBond);
      assert.equal(actualAlkeneStereo(graph, coords, alkeneBond), testCase.expectedStereo);
    }
  });
});

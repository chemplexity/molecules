import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { layoutAcyclicFamily } from '../../../src/layoutv2/families/acyclic.js';
import { createLayoutGraph } from '../../../src/layoutv2/model/layout-graph.js';
import { runPipeline } from '../../../src/layoutv2/pipeline.js';
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

/**
 * Returns a linear traversal order for a simple backbone adjacency map.
 * @param {Map<string, string[]>} adjacency - Backbone adjacency map.
 * @returns {string[]} Linearized backbone path.
 */
function linearBackbonePath(adjacency) {
  const endpointIds = [...adjacency.entries()]
    .filter(([, neighborAtomIds]) => neighborAtomIds.length <= 1)
    .map(([atomId]) => atomId)
    .sort();
  const path = [];
  let previousAtomId = null;
  let currentAtomId = endpointIds[0] ?? [...adjacency.keys()].sort()[0];

  while (currentAtomId != null) {
    path.push(currentAtomId);
    const nextAtomId = (adjacency.get(currentAtomId) ?? []).find(atomId => atomId !== previousAtomId) ?? null;
    previousAtomId = currentAtomId;
    currentAtomId = nextAtomId;
  }

  return path;
}

/**
 * Returns the bond order between two atoms in a layout graph.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {string} firstAtomId - First atom ID.
 * @param {string} secondAtomId - Second atom ID.
 * @returns {number} Bond order or `1` when no explicit bond is found.
 */
function bondOrderBetween(layoutGraph, firstAtomId, secondAtomId) {
  for (const bond of layoutGraph.bonds.values()) {
    if ((bond.a === firstAtomId && bond.b === secondAtomId) || (bond.a === secondAtomId && bond.b === firstAtomId)) {
      return bond.order ?? 1;
    }
  }
  return 1;
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

  it('keeps allene and cumulene centers linear through adjacent double bonds', () => {
    const smilesCases = ['CC=C=CC', 'C=C=C=C'];

    for (const smiles of smilesCases) {
      const graph = createLayoutGraph(parseSMILES(smiles));
      const atomIdsToPlace = new Set(graph.components[0].atomIds);
      const adjacency = buildAdjacency(graph, atomIdsToPlace);
      const path = linearBackbonePath(adjacency);
      const coords = layoutAcyclicFamily(adjacency, atomIdsToPlace, graph.canonicalAtomRank, graph.options.bondLength, { layoutGraph: graph });

      for (let index = 1; index < path.length - 1; index++) {
        const previousBondOrder = bondOrderBetween(graph, path[index - 1], path[index]);
        const nextBondOrder = bondOrderBetween(graph, path[index], path[index + 1]);
        const isLinearCenter = previousBondOrder >= 3 || nextBondOrder >= 3 || (previousBondOrder >= 2 && nextBondOrder >= 2);
        if (!isLinearCenter) {
          continue;
        }
        const incomingBond = sub(coords.get(path[index]), coords.get(path[index - 1]));
        const outgoingBond = sub(coords.get(path[index + 1]), coords.get(path[index]));
        const cross = incomingBond.x * outgoingBond.y - incomingBond.y * outgoingBond.x;
        assert.ok(Math.abs(cross) < 1e-6, `${smiles} should stay linear at ${path[index]}`);
      }
    }
  });

  it('keeps conjugated diene backbones bending in one overall direction', () => {
    const graph = createLayoutGraph(parseSMILES('C=CC=C'), { suppressH: true });
    const atomIdsToPlace = new Set(graph.components[0].atomIds.filter(atomId => graph.atoms.get(atomId)?.element !== 'H'));
    const adjacency = buildAdjacency(graph, atomIdsToPlace);
    const path = linearBackbonePath(adjacency);
    const coords = layoutAcyclicFamily(adjacency, atomIdsToPlace, graph.canonicalAtomRank, graph.options.bondLength, { layoutGraph: graph });
    const firstDeltaY = coords.get(path[1]).y - coords.get(path[0]).y;
    const secondDeltaY = coords.get(path[2]).y - coords.get(path[1]).y;
    const thirdDeltaY = coords.get(path[3]).y - coords.get(path[2]).y;

    assert.ok(Math.abs(firstDeltaY) > 0.1);
    assert.ok(Math.abs(secondDeltaY) < 0.1);
    assert.ok(Math.abs(thirdDeltaY) > 0.1);
    assert.ok(
      Math.sign(firstDeltaY) === Math.sign(thirdDeltaY),
      'expected the diene backbone to keep bending to the same side through the conjugated segment'
    );
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

  it('enforces configured E/Z stereo for final acyclic pipeline output', () => {
    const cases = [
      { smiles: 'F/C=C/F', expectedStereo: 'E' },
      { smiles: 'F/C=C\\F', expectedStereo: 'Z' }
    ];

    for (const testCase of cases) {
      const result = runPipeline(parseSMILES(testCase.smiles));
      const alkeneBond = [...result.layoutGraph.bonds.values()].find(bond => bond.order === 2);

      assert.ok(alkeneBond);
      assert.equal(actualAlkeneStereo(result.layoutGraph, result.coords, alkeneBond), testCase.expectedStereo);
    }
  });
});

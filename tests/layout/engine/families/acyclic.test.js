import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { layoutAcyclicFamily } from '../../../../src/layout/engine/families/acyclic.js';
import { createLayoutGraph } from '../../../../src/layout/engine/model/layout-graph.js';
import { runPipeline } from '../../../../src/layout/engine/pipeline.js';
import { actualAlkeneStereo } from '../../../../src/layout/engine/stereo/ez.js';
import { computeCanonicalAtomRanks } from '../../../../src/layout/engine/topology/canonical-order.js';
import { angleOf, angularDifference, distance, sub } from '../../../../src/layout/engine/geometry/vec2.js';
import { parseSMILES } from '../../../../src/io/smiles.js';
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

/**
 * Returns the backbone turn sign at a path center from placed coordinates.
 * @param {Map<string, {x: number, y: number}>} coords - Coordinate map.
 * @param {string} previousAtomId - Previous atom ID.
 * @param {string} centerAtomId - Center atom ID.
 * @param {string} nextAtomId - Next atom ID.
 * @returns {number} Signed turn direction (`-1`, `0`, `1`).
 */
function backboneTurnSign(coords, previousAtomId, centerAtomId, nextAtomId) {
  const incoming = sub(coords.get(previousAtomId), coords.get(centerAtomId));
  const outgoing = sub(coords.get(nextAtomId), coords.get(centerAtomId));
  const cross = incoming.x * outgoing.y - incoming.y * outgoing.x;
  return Math.sign(cross);
}

/**
 * Returns the backbone bond angle at a path center in degrees.
 * @param {Map<string, {x: number, y: number}>} coords - Coordinate map.
 * @param {string} previousAtomId - Previous atom ID.
 * @param {string} centerAtomId - Center atom ID.
 * @param {string} nextAtomId - Next atom ID.
 * @returns {number} Bond angle in degrees.
 */
function backboneAngle(coords, previousAtomId, centerAtomId, nextAtomId) {
  const incoming = sub(coords.get(previousAtomId), coords.get(centerAtomId));
  const outgoing = sub(coords.get(nextAtomId), coords.get(centerAtomId));
  const denominator = Math.hypot(incoming.x, incoming.y) * Math.hypot(outgoing.x, outgoing.y) || 1;
  const cosine = Math.max(-1, Math.min(1, (incoming.x * outgoing.x + incoming.y * outgoing.y) / denominator));
  return Math.acos(cosine) * (180 / Math.PI);
}

describe('layout/engine/families/acyclic', () => {
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

  it('keeps conjugated diene backbones at trigonal angles with a transoid default turn pattern', () => {
    const graph = createLayoutGraph(parseSMILES('C=CC=C'), { suppressH: true });
    const atomIdsToPlace = new Set(graph.components[0].atomIds.filter(atomId => graph.atoms.get(atomId)?.element !== 'H'));
    const adjacency = buildAdjacency(graph, atomIdsToPlace);
    const path = linearBackbonePath(adjacency);
    const coords = layoutAcyclicFamily(adjacency, atomIdsToPlace, graph.canonicalAtomRank, graph.options.bondLength, { layoutGraph: graph });
    const firstTurn = backboneTurnSign(coords, path[0], path[1], path[2]);
    const secondTurn = backboneTurnSign(coords, path[1], path[2], path[3]);
    const firstAngle = backboneAngle(coords, path[0], path[1], path[2]);
    const secondAngle = backboneAngle(coords, path[1], path[2], path[3]);

    assert.ok(Math.abs(firstAngle - 120) < 1e-6);
    assert.ok(Math.abs(secondAngle - 120) < 1e-6);
    assert.notEqual(firstTurn, 0);
    assert.notEqual(secondTurn, 0);
    assert.equal(firstTurn, -secondTurn, 'expected the default diene depiction to alternate turn direction across the conjugated segment');
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

  it('keeps sulfate sulfur in a cross-like arrangement', () => {
    const graph = createLayoutGraph(parseSMILES('[O-]S(=O)(=O)[O-]'));
    const atomIdsToPlace = new Set(graph.components[0].atomIds);
    const coords = layoutAcyclicFamily(buildAdjacency(graph, atomIdsToPlace), atomIdsToPlace, graph.canonicalAtomRank, graph.options.bondLength, { layoutGraph: graph });
    const sulfurId = [...graph.atoms.values()].find(atom => atom.element === 'S')?.id;
    const sulfurPosition = sulfurId ? coords.get(sulfurId) : null;
    const singleAngles = [];
    const multipleAngles = [];

    assert.ok(sulfurId);
    assert.ok(sulfurPosition);

    for (const bond of graph.bondsByAtomId.get(sulfurId) ?? []) {
      const neighborAtomId = bond.a === sulfurId ? bond.b : bond.a;
      const neighborPosition = coords.get(neighborAtomId);
      assert.ok(neighborPosition);
      const angle = angleOf(sub(neighborPosition, sulfurPosition));
      if ((bond.order ?? 1) === 1) {
        singleAngles.push(angle);
      } else {
        multipleAngles.push(angle);
      }
    }

    assert.equal(singleAngles.length, 2);
    assert.equal(multipleAngles.length, 2);
    assert.ok(Math.abs(angularDifference(singleAngles[0], singleAngles[1]) - Math.PI) < 1e-6);
    assert.ok(Math.abs(angularDifference(multipleAngles[0], multipleAngles[1]) - Math.PI) < 1e-6);
    for (const singleAngle of singleAngles) {
      for (const multipleAngle of multipleAngles) {
        assert.ok(Math.abs(angularDifference(singleAngle, multipleAngle) - Math.PI / 2) < 1e-6);
      }
    }
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

  it('keeps configured E and Z alkenes at trigonal 120-degree bond angles', () => {
    const cases = [
      { smiles: 'C/C=C/C', expectedStereo: 'E' },
      { smiles: 'C/C=C\\C', expectedStereo: 'Z' }
    ];

    for (const testCase of cases) {
      const result = runPipeline(parseSMILES(testCase.smiles), { suppressH: true });
      const alkeneBond = [...result.layoutGraph.bonds.values()].find(bond => bond.order === 2);
      const adjacency = buildAdjacency(
        result.layoutGraph,
        new Set(result.layoutGraph.components[0].atomIds.filter(atomId => result.layoutGraph.atoms.get(atomId)?.element !== 'H'))
      );
      const path = linearBackbonePath(adjacency);

      assert.ok(alkeneBond);
      assert.equal(actualAlkeneStereo(result.layoutGraph, result.coords, alkeneBond), testCase.expectedStereo);
      assert.ok(Math.abs(backboneAngle(result.coords, path[0], path[1], path[2]) - 120) < 1e-6);
      assert.ok(Math.abs(backboneAngle(result.coords, path[1], path[2], path[3]) - 120) < 1e-6);
    }
  });

  it('keeps long explicitly stereo polyenes extended instead of curling them into a compact spiral', () => {
    const graph = createLayoutGraph(parseSMILES('CC\\C=C/C\\C=C/C\\C=C/C\\C=C/C\\C=C/C\\C=C/CCC(=O)O'), {
      suppressH: true
    });
    const atomIdsToPlace = new Set(graph.components[0].atomIds.filter(atomId => graph.atoms.get(atomId)?.element !== 'H'));
    const coords = layoutAcyclicFamily(buildAdjacency(graph, atomIdsToPlace), atomIdsToPlace, graph.canonicalAtomRank, graph.options.bondLength, { layoutGraph: graph });
    const xValues = [...coords.values()].map(position => position.x);
    const yValues = [...coords.values()].map(position => position.y);
    const width = Math.max(...xValues) - Math.min(...xValues);
    const height = Math.max(...yValues) - Math.min(...yValues);
    const stereoChecks = [...graph.bonds.values()]
      .filter(bond => (bond.order ?? 1) === 2 && graph.sourceMolecule.getEZStereo?.(bond.id))
      .map(bond => actualAlkeneStereo(graph, coords, bond));

    assert.ok(width > height * 6, `expected an extended polyene layout, got width ${width.toFixed(3)} and height ${height.toFixed(3)}`);
    assert.ok(height < 4, `expected the long fatty-acid polyene to stay fairly shallow, got height ${height.toFixed(3)}`);
    assert.ok(stereoChecks.every(stereo => stereo === 'Z'));
  });
});

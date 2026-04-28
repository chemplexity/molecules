import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createLayoutGraph } from '../../../../src/layout/engine/model/layout-graph.js';
import { layoutBridgedFamily } from '../../../../src/layout/engine/families/bridged.js';
import { parseSMILES } from '../../../../src/io/smiles.js';
import { findSevereOverlaps } from '../../../../src/layout/engine/audit/invariants.js';
import { BRIDGED_VALIDATION } from '../../../../src/layout/engine/constants.js';
import { angleOf, angularDifference, distance, sub } from '../../../../src/layout/engine/geometry/vec2.js';
import { makeAdamantane, makeBicyclo222, makeNorbornane, makeUnmatchedBridgedCage } from '../support/molecules.js';

/**
 * Asserts that a bridged-family placement stays finite and free of severe overlaps,
 * with optional bridged-template bond-length validation.
 * @param {object} graph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Bridged placement coordinates.
 * @param {{strictBondLengths?: boolean}} [options] - Optional validation settings.
 * @returns {void}
 */
function assertBridgedLayoutQuality(graph, coords, options = {}) {
  const strictBondLengths = options.strictBondLengths ?? true;
  const minBondLength = graph.options.bondLength * BRIDGED_VALIDATION.minBondLengthFactor;
  const maxBondLength = graph.options.bondLength * BRIDGED_VALIDATION.maxBondLengthFactor;

  for (const position of coords.values()) {
    assert.equal(Number.isFinite(position.x), true);
    assert.equal(Number.isFinite(position.y), true);
  }
  assert.equal(findSevereOverlaps(graph, coords, graph.options.bondLength).length, 0);
  if (!strictBondLengths) {
    return;
  }
  for (const bond of graph.bonds.values()) {
    if (bond.kind !== 'covalent') {
      continue;
    }
    const firstPosition = coords.get(bond.a);
    const secondPosition = coords.get(bond.b);
    if (!firstPosition || !secondPosition) {
      continue;
    }
    const bondDistance = distance(firstPosition, secondPosition);
    assert.ok(bondDistance >= minBondLength);
    assert.ok(bondDistance <= maxBondLength);
  }
}

/**
 * Returns the internal angle for one atom in a placed ring.
 * @param {object} ring - Ring descriptor.
 * @param {Map<string, {x: number, y: number}>} coords - Coordinate map.
 * @param {string} atomId - Ring atom ID to inspect.
 * @returns {number} Internal angle in radians.
 */
function ringInternalAngle(ring, coords, atomId) {
  const index = ring.atomIds.indexOf(atomId);
  const atomPosition = coords.get(atomId);
  const previousPosition = coords.get(ring.atomIds[(index - 1 + ring.atomIds.length) % ring.atomIds.length]);
  const nextPosition = coords.get(ring.atomIds[(index + 1) % ring.atomIds.length]);
  return angularDifference(
    angleOf(sub(previousPosition, atomPosition)),
    angleOf(sub(nextPosition, atomPosition))
  );
}

describe('layout/engine/families/bridged', () => {
  it('places a matched bridged scaffold through template coordinates', () => {
    const graph = createLayoutGraph(makeNorbornane());
    const result = layoutBridgedFamily(graph.rings, graph.options.bondLength, { layoutGraph: graph, templateId: 'norbornane' });
    assert.equal(result.placementMode, 'template');
    assert.equal(result.coords.size, 7);
    assert.equal(result.ringCenters.size, 2);
    assertBridgedLayoutQuality(graph, result.coords);
  });

  it('falls back to Kamada-Kawai when no bridged template match is provided', () => {
    const graph = createLayoutGraph(makeUnmatchedBridgedCage());
    const result = layoutBridgedFamily(graph.rings, graph.options.bondLength, { layoutGraph: graph, templateId: null });
    assert.equal(result.placementMode, 'projected-kamada-kawai');
    assert.equal(result.coords.size, 6);
    assert.ok(result.coords.get('a0').x < result.coords.get('a1').x);
    assert.ok(Math.abs(result.coords.get('a0').y) < 1e-6);
    assert.ok(Math.abs(result.coords.get('a1').y) < 1e-6);
    assertBridgedLayoutQuality(graph, result.coords, { strictBondLengths: false });
  });

  it('uses mirrored existing coordinates to preserve the projected fallback orientation', () => {
    const baseGraph = createLayoutGraph(makeUnmatchedBridgedCage());
    const baseResult = layoutBridgedFamily(baseGraph.rings, baseGraph.options.bondLength, {
      layoutGraph: baseGraph,
      templateId: null
    });
    const mirroredExistingCoords = new Map([...baseResult.coords.entries()].map(([atomId, position]) => [atomId, { x: position.x, y: -position.y }]));
    const seededGraph = createLayoutGraph(makeUnmatchedBridgedCage(), {
      existingCoords: mirroredExistingCoords
    });
    const seededResult = layoutBridgedFamily(seededGraph.rings, seededGraph.options.bondLength, {
      layoutGraph: seededGraph,
      templateId: null
    });

    assert.equal(Math.sign(seededResult.coords.get('a4').y), Math.sign(mirroredExistingCoords.get('a4').y));
    assert.equal(Math.sign(seededResult.coords.get('a5').y), Math.sign(mirroredExistingCoords.get('a5').y));
  });

  it('keeps the KK seed when bridge projection would collapse compact fused-bridged systems', () => {
    const graph = createLayoutGraph(
      parseSMILES('N[C@@H](Cc1ccccc1)C(=O)N2C[C@H]3C[C@@H](C2)C4=CC=CC(=O)N4C3'),
      { suppressH: true }
    );
    const bridgedRingSystem = graph.ringSystems.find(ringSystem => ringSystem.ringIds.length === 3);
    assert.ok(bridgedRingSystem);
    const rings = graph.rings.filter(ring => bridgedRingSystem.ringIds.includes(ring.id));
    const result = layoutBridgedFamily(rings, graph.options.bondLength, {
      layoutGraph: graph,
      templateId: null
    });

    assert.equal(result.placementMode, 'projected-kamada-kawai');
    assertBridgedLayoutQuality(graph, result.coords);
    assert.ok(
      distance(result.coords.get('C22'), result.coords.get('N27')) > graph.options.bondLength * 1.5,
      'expected the fused lactam bridge projection to keep C22 and N27 visually separated'
    );
  });

  it('keeps saturated bridged six-rings exact when routing a shared bridge run', () => {
    const graph = createLayoutGraph(
      parseSMILES('CC12COC(C1)C(CC#N)C[NH2+]2'),
      { suppressH: true }
    );
    const bridgedRingSystem = graph.ringSystems.find(ringSystem => ringSystem.ringIds.length === 2);
    assert.ok(bridgedRingSystem);
    const rings = graph.rings.filter(ring => bridgedRingSystem.ringIds.includes(ring.id));
    const result = layoutBridgedFamily(rings, graph.options.bondLength, {
      layoutGraph: graph,
      templateId: null
    });
    const sixRing = rings.find(ring => !ring.aromatic && ring.atomIds.length === 6);
    assert.ok(sixRing);

    assert.equal(result.placementMode, 'projected-kamada-kawai');
    assertBridgedLayoutQuality(graph, result.coords);
    for (let index = 0; index < sixRing.atomIds.length; index++) {
      const atomId = sixRing.atomIds[index];
      const nextAtomId = sixRing.atomIds[(index + 1) % sixRing.atomIds.length];
      assert.ok(
        Math.abs(distance(result.coords.get(atomId), result.coords.get(nextAtomId)) - graph.options.bondLength) < 1e-6,
        `expected ${atomId}-${nextAtomId} to keep target bond length`
      );
      assert.ok(
        Math.abs(ringInternalAngle(sixRing, result.coords, atomId) - (2 * Math.PI) / 3) < 1e-6,
        `expected ${atomId} to keep a regular six-ring angle`
      );
    }
  });

  it('places larger bridged cages from their templates too', () => {
    const bicycloGraph = createLayoutGraph(makeBicyclo222());
    const bicycloResult = layoutBridgedFamily(bicycloGraph.rings, bicycloGraph.options.bondLength, { layoutGraph: bicycloGraph, templateId: 'bicyclo-2-2-2' });
    assert.equal(bicycloResult.coords.size, 8);
    assertBridgedLayoutQuality(bicycloGraph, bicycloResult.coords);

    const adamantaneGraph = createLayoutGraph(makeAdamantane());
    const adamantaneResult = layoutBridgedFamily(adamantaneGraph.rings, adamantaneGraph.options.bondLength, { layoutGraph: adamantaneGraph, templateId: 'adamantane' });
    assert.equal(adamantaneResult.coords.size, 10);
    assertBridgedLayoutQuality(adamantaneGraph, adamantaneResult.coords);
  });
});

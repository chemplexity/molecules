import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseSMILES } from '../../../../src/io/smiles.js';
import { findSevereOverlaps, measureBondLengthDeviation } from '../../../../src/layout/engine/audit/invariants.js';
import { AUDIT_PLANAR_VALIDATION } from '../../../../src/layout/engine/constants.js';
import { createLayoutGraph } from '../../../../src/layout/engine/model/layout-graph.js';
import { auditLayout } from '../../../../src/layout/engine/audit/audit.js';
import { assignBondValidationClass } from '../../../../src/layout/engine/placement/bond-validation.js';
import {
  layoutFusedCageKamadaKawai,
  layoutFusedFamily,
  shouldShortCircuitToFusedCageKk,
  shouldTryBridgedRescueForFusedSystem
} from '../../../../src/layout/engine/families/fused.js';
import { distance } from '../../../../src/layout/engine/geometry/vec2.js';
import { makeNaphthalene } from '../support/molecules.js';

/**
 * Builds fused-ring adjacency and connection lookup maps from a layout graph.
 * @param {object} graph - Layout graph shell.
 * @returns {{ringAdj: Map<number, number[]>, ringConnectionByPair: Map<string, object>}} Fused topology maps.
 */
function fusedTopology(graph) {
  const ringAdj = new Map(graph.rings.map(ring => [ring.id, []]));
  const ringConnectionByPair = new Map();
  for (const connection of graph.ringConnections) {
    if (connection.kind !== 'fused') {
      continue;
    }
    ringAdj.get(connection.firstRingId)?.push(connection.secondRingId);
    ringAdj.get(connection.secondRingId)?.push(connection.firstRingId);
    const key = connection.firstRingId < connection.secondRingId ? `${connection.firstRingId}:${connection.secondRingId}` : `${connection.secondRingId}:${connection.firstRingId}`;
    ringConnectionByPair.set(key, connection);
  }
  return { ringAdj, ringConnectionByPair };
}

/**
 * Asserts that a fused-family placement stays within planar validation tolerances.
 * @param {object} graph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Fused placement coordinates.
 * @returns {void}
 */
function assertPlanarLayoutQuality(graph, coords) {
  const bondStats = measureBondLengthDeviation(graph, coords, graph.options.bondLength);
  assert.equal(findSevereOverlaps(graph, coords, graph.options.bondLength).length, 0);
  assert.ok(bondStats.failingBondCount <= AUDIT_PLANAR_VALIDATION.maxSevereOverlapCount);
  assert.ok(
    bondStats.maxDeviation <=
      graph.options.bondLength * Math.max(Math.abs(1 - AUDIT_PLANAR_VALIDATION.minBondLengthFactor), Math.abs(AUDIT_PLANAR_VALIDATION.maxBondLengthFactor - 1))
  );
}

describe('layout/engine/families/fused', () => {
  it('lays out a simple fused two-ring system across the shared edge', () => {
    const rings = [
      { id: 0, atomIds: ['a0', 'a1', 'a2', 'a3', 'a4', 'a5'] },
      { id: 1, atomIds: ['a4', 'a5', 'a9', 'a8', 'a7', 'a6'] }
    ];
    const ringAdj = new Map([
      [0, [1]],
      [1, [0]]
    ]);
    const ringConnectionByPair = new Map([
      [
        '0:1',
        {
          firstRingId: 0,
          secondRingId: 1,
          sharedAtomIds: ['a4', 'a5'],
          kind: 'fused'
        }
      ]
    ]);
    const result = layoutFusedFamily(rings, ringAdj, ringConnectionByPair, 1.5);
    assert.equal(result.coords.size, 10);
    assert.ok(Math.abs(distance(result.coords.get('a4'), result.coords.get('a5')) - 1.5) < 1e-6);
    assert.notDeepEqual(result.ringCenters.get(0), result.ringCenters.get(1));
  });

  it('uses template placement when a matched fused scaffold is provided', () => {
    const graph = createLayoutGraph(makeNaphthalene());
    const { ringAdj, ringConnectionByPair } = fusedTopology(graph);
    const result = layoutFusedFamily(graph.rings, ringAdj, ringConnectionByPair, graph.options.bondLength, { layoutGraph: graph, templateId: 'naphthalene' });
    assert.equal(result.placementMode, 'template');
  });

  it('lays out coronene through the pericondensed fused path with one central ring and a symmetric outer shell', () => {
    const graph = createLayoutGraph(parseSMILES('c1cc2ccc3ccc4ccc5ccc6ccc1c1c2c3c4c5c61'));
    const { ringAdj, ringConnectionByPair } = fusedTopology(graph);
    const result = layoutFusedFamily(graph.rings, ringAdj, ringConnectionByPair, graph.options.bondLength, { layoutGraph: graph });
    const sortedCenters = [...result.ringCenters.values()].map(center => Math.hypot(center.x, center.y)).sort((firstValue, secondValue) => firstValue - secondValue);
    const centralRadius = sortedCenters[0];
    const outerRadii = sortedCenters.slice(1);
    const outerMean = outerRadii.reduce((sum, radius) => sum + radius, 0) / outerRadii.length;
    const maxOuterDeviation = outerRadii.reduce((maxDeviation, radius) => Math.max(maxDeviation, Math.abs(radius - outerMean)), 0);

    assert.equal(result.placementMode, 'pericondensed');
    assert.ok(centralRadius < graph.options.bondLength * 0.2);
    assert.ok(maxOuterDeviation < graph.options.bondLength * 0.15);
  });

  it('tries bridged rescue heuristics for large high-ring-count fused cages even when they are not compact', () => {
    assert.equal(
      shouldTryBridgedRescueForFusedSystem(40, 11, null, { bondLengthFailureCount: 29 }),
      true
    );
    assert.equal(
      shouldTryBridgedRescueForFusedSystem(40, 11, 'template-id', { bondLengthFailureCount: 29 }),
      false
    );
    assert.equal(
      shouldTryBridgedRescueForFusedSystem(40, 11, null, { bondLengthFailureCount: 0 }),
      false
    );
  });

  it('short-circuits only giant dense no-template fused cages to the cage KK path', () => {
    assert.equal(shouldShortCircuitToFusedCageKk(60, 31, null), true);
    assert.equal(shouldShortCircuitToFusedCageKk(20, 12, null), false);
    assert.equal(shouldShortCircuitToFusedCageKk(60, 31, 'template-id'), false);
  });

  it('can lay out giant fullerene-like fused cages through the atom-level cage KK rescue', () => {
    const graph = createLayoutGraph(
      parseSMILES('C12=C3C4=C5C6=C1C7=C8C9=C1C%10=C%11C(=C29)C3=C2C3=C4C4=C5C5=C9C6=C7C6=C7C8=C1C1=C8C%10=C%10C%11=C2C2=C3C3=C4C4=C5C5=C%11C%12=C(C6=C95)C7=C1C1=C%12C5=C%11C4=C3C3=C5C(=C81)C%10=C23'),
      { suppressH: true }
    );
    const result = layoutFusedCageKamadaKawai(graph.rings, graph.options.bondLength, { layoutGraph: graph });
    const bondValidationClasses = assignBondValidationClass(
      graph,
      graph.ringSystems[0].atomIds,
      'bridged'
    );
    const audit = auditLayout(graph, result.coords, {
      bondLength: graph.options.bondLength,
      bondValidationClasses
    });

    assert.ok(result);
    assert.equal(result.placementMode, 'kamada-kawai-cage');
    assert.equal(result.coords.size, graph.ringSystems[0].atomIds.length);
    assert.ok(audit.bondLengthFailureCount <= 15);
    assert.ok(audit.maxBondLengthDeviation < 0.75);
  });

  it('keeps linear anthracene-like fused systems horizontally oriented and audit-clean', () => {
    const graph = createLayoutGraph(parseSMILES('c1ccc2cc3ccccc3cc2c1'));
    const { ringAdj, ringConnectionByPair } = fusedTopology(graph);
    const result = layoutFusedFamily(graph.rings, ringAdj, ringConnectionByPair, graph.options.bondLength, { layoutGraph: graph });
    const centers = [...result.ringCenters.values()];
    const ySpread = Math.max(...centers.map(center => center.y)) - Math.min(...centers.map(center => center.y));

    assert.equal(result.coords.size, graph.ringSystems[0].atomIds.length);
    assert.ok(ySpread < graph.options.bondLength * 0.2);
    assertPlanarLayoutQuality(graph, result.coords);
  });

  it('keeps angular phenanthrene-like fused systems non-collinear and audit-clean', () => {
    const graph = createLayoutGraph(parseSMILES('c1ccc2c(c1)ccc1ccccc12'));
    const { ringAdj, ringConnectionByPair } = fusedTopology(graph);
    const result = layoutFusedFamily(graph.rings, ringAdj, ringConnectionByPair, graph.options.bondLength, { layoutGraph: graph });
    const centers = [...result.ringCenters.values()];
    const ySpread = Math.max(...centers.map(center => center.y)) - Math.min(...centers.map(center => center.y));

    assert.equal(result.coords.size, graph.ringSystems[0].atomIds.length);
    assert.ok(ySpread > graph.options.bondLength * 0.3);
    assertPlanarLayoutQuality(graph, result.coords);
  });
});

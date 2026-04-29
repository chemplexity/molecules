import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseSMILES } from '../../../../src/io/smiles.js';
import { createLayoutGraph } from '../../../../src/layout/engine/model/layout-graph.js';
import { layoutSpiroFamily } from '../../../../src/layout/engine/families/spiro.js';
import { runPipeline } from '../../../../src/layout/engine/pipeline.js';
import { sub } from '../../../../src/layout/engine/geometry/vec2.js';
import { makeSpiro } from '../support/molecules.js';

/**
 * Computes twice the signed triangle area formed by three ring centers.
 * @param {{x: number, y: number}} firstPoint - First point.
 * @param {{x: number, y: number}} secondPoint - Second point.
 * @param {{x: number, y: number}} thirdPoint - Third point.
 * @returns {number} Absolute doubled area.
 */
function doubledTriangleArea(firstPoint, secondPoint, thirdPoint) {
  return Math.abs((secondPoint.x - firstPoint.x) * (thirdPoint.y - firstPoint.y) - (secondPoint.y - firstPoint.y) * (thirdPoint.x - firstPoint.x));
}

function buildSpiroAdjacency(layoutGraph) {
  const ringAdj = new Map(layoutGraph.rings.map(ring => [ring.id, []]));
  const ringConnectionByPair = new Map();

  for (const connection of layoutGraph.ringConnections) {
    if (connection.kind !== 'spiro') {
      continue;
    }
    ringAdj.get(connection.firstRingId)?.push(connection.secondRingId);
    ringAdj.get(connection.secondRingId)?.push(connection.firstRingId);
    const key =
      connection.firstRingId < connection.secondRingId ? `${connection.firstRingId}:${connection.secondRingId}` : `${connection.secondRingId}:${connection.firstRingId}`;
    ringConnectionByPair.set(key, connection);
  }

  return { ringAdj, ringConnectionByPair };
}

function bondAngleAtAtom(coords, centerAtomId, firstNeighborAtomId, secondNeighborAtomId) {
  const firstVector = sub(coords.get(firstNeighborAtomId), coords.get(centerAtomId));
  const secondVector = sub(coords.get(secondNeighborAtomId), coords.get(centerAtomId));
  const denominator = Math.hypot(firstVector.x, firstVector.y) * Math.hypot(secondVector.x, secondVector.y);
  const cosine = Math.max(-1, Math.min(1, ((firstVector.x * secondVector.x) + (firstVector.y * secondVector.y)) / denominator));
  return Math.acos(cosine);
}

describe('layout/engine/families/spiro', () => {
  it('lays out a spiro ring pair around the shared atom', () => {
    const rings = [
      { id: 0, atomIds: ['a0', 'a1', 'a2', 'a3', 'a4'] },
      { id: 1, atomIds: ['a4', 'a5', 'a6', 'a7', 'a8'] }
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
          sharedAtomIds: ['a4'],
          kind: 'spiro'
        }
      ]
    ]);
    const result = layoutSpiroFamily(rings, ringAdj, ringConnectionByPair, 1.5);
    assert.equal(result.coords.size, 9);
    assert.equal(result.coords.has('a4'), true);
    assert.notDeepEqual(result.ringCenters.get(0), result.ringCenters.get(1));
  });

  it('uses template placement when a matched spiro scaffold is provided', () => {
    const graph = createLayoutGraph(makeSpiro());
    const ringAdj = new Map(graph.rings.map(ring => [ring.id, []]));
    const ringConnectionByPair = new Map();
    for (const connection of graph.ringConnections) {
      if (connection.kind !== 'spiro') {
        continue;
      }
      ringAdj.get(connection.firstRingId)?.push(connection.secondRingId);
      ringAdj.get(connection.secondRingId)?.push(connection.firstRingId);
      const key =
        connection.firstRingId < connection.secondRingId ? `${connection.firstRingId}:${connection.secondRingId}` : `${connection.secondRingId}:${connection.firstRingId}`;
      ringConnectionByPair.set(key, connection);
    }
    const result = layoutSpiroFamily(graph.rings, ringAdj, ringConnectionByPair, graph.options.bondLength, { layoutGraph: graph, templateId: 'spiro-5-5' });
    assert.equal(result.placementMode, 'template');
  });

  it('fans a dispiro chain instead of stacking successive ring centers collinearly', () => {
    const graph = createLayoutGraph(parseSMILES('C1CCC2(C1)CC1(CCCC1)C2'), { suppressH: true });
    const { ringAdj, ringConnectionByPair } = buildSpiroAdjacency(graph);

    const result = layoutSpiroFamily(graph.rings, ringAdj, ringConnectionByPair, graph.options.bondLength, { layoutGraph: graph });
    const centers = [...result.ringCenters.values()];

    assert.equal(result.placementMode, 'constructed-path');
    assert.equal(centers.length, 3);
    assert.ok(doubledTriangleArea(centers[0], centers[1], centers[2]) > 1, 'expected a three-ring spiro chain to fan out rather than stay nearly collinear');
  });

  it('places small cyclobutyl and cyclopropyl spiro rings outward from a larger parent ring', () => {
    const smiles = 'CC1CC11C[NH2+]CC2(CCC2)C1';
    const graph = createLayoutGraph(parseSMILES(smiles), { suppressH: true });
    const { ringAdj, ringConnectionByPair } = buildSpiroAdjacency(graph);
    const result = layoutSpiroFamily(graph.rings, ringAdj, ringConnectionByPair, graph.options.bondLength, { layoutGraph: graph });
    const pipelineResult = runPipeline(parseSMILES(smiles), {
      suppressH: true,
      auditTelemetry: true,
      finalLandscapeOrientation: true
    });

    const assertSmallRingExits = (coords, label) => {
      const cyclopropylExitAngles = [
        bondAngleAtAtom(coords, 'C4', 'C2', 'C13'),
        bondAngleAtAtom(coords, 'C4', 'C2', 'C5'),
        bondAngleAtAtom(coords, 'C4', 'C3', 'C13'),
        bondAngleAtAtom(coords, 'C4', 'C3', 'C5')
      ];
      const cyclobutylExitAngles = [
        bondAngleAtAtom(coords, 'C9', 'C10', 'C13'),
        bondAngleAtAtom(coords, 'C9', 'C10', 'C8'),
        bondAngleAtAtom(coords, 'C9', 'C12', 'C13'),
        bondAngleAtAtom(coords, 'C9', 'C12', 'C8')
      ];

      assert.ok(
        Math.min(...cyclopropylExitAngles) >= Math.PI / 3 - 1e-6,
        `expected ${label} cyclopropyl exits to clear the parent ring by at least 60 degrees, got ${(Math.min(...cyclopropylExitAngles) * 180 / Math.PI).toFixed(2)}`
      );
      assert.ok(
        Math.min(...cyclobutylExitAngles) >= Math.PI / 3 - 1e-6,
        `expected ${label} cyclobutyl exits to clear the parent ring by at least 60 degrees, got ${(Math.min(...cyclobutylExitAngles) * 180 / Math.PI).toFixed(2)}`
      );
    };

    assert.equal(result.placementMode, 'constructed');
    assertSmallRingExits(result.coords, 'spiro placement');
    assertSmallRingExits(pipelineResult.coords, 'pipeline layout');
    assert.equal(pipelineResult.metadata.audit.ok, true);
  });

  it('keeps equal-size spiro path rings from pinching shared-atom exits together', () => {
    const smiles = 'CC1CC11CCCC2(CCCOC2)C1';
    const graph = createLayoutGraph(parseSMILES(smiles), { suppressH: true });
    const { ringAdj, ringConnectionByPair } = buildSpiroAdjacency(graph);
    const result = layoutSpiroFamily(graph.rings, ringAdj, ringConnectionByPair, graph.options.bondLength, { layoutGraph: graph });
    const pipelineResult = runPipeline(parseSMILES(smiles), {
      suppressH: true,
      auditTelemetry: true,
      finalLandscapeOrientation: true
    });

    const assertSpiroJunctionExits = (coords, label) => {
      const sixMemberJunctionAngles = [
        bondAngleAtAtom(coords, 'C8', 'C13', 'C14'),
        bondAngleAtAtom(coords, 'C8', 'C13', 'C7'),
        bondAngleAtAtom(coords, 'C8', 'C9', 'C14'),
        bondAngleAtAtom(coords, 'C8', 'C9', 'C7')
      ];
      const cyclopropaneJunctionAngles = [
        bondAngleAtAtom(coords, 'C4', 'C14', 'C2'),
        bondAngleAtAtom(coords, 'C4', 'C14', 'C3'),
        bondAngleAtAtom(coords, 'C4', 'C5', 'C2'),
        bondAngleAtAtom(coords, 'C4', 'C5', 'C3')
      ];

      assert.ok(
        Math.min(...sixMemberJunctionAngles) >= Math.PI / 3 - 1e-6,
        `expected ${label} six-member spiro exits to stay at least 60 degrees apart`
      );
      assert.ok(
        Math.min(...cyclopropaneJunctionAngles) >= Math.PI / 2 - 1e-6,
        `expected ${label} cyclopropane spiro exits to stay centered in the exterior gap`
      );
    };

    assert.equal(result.placementMode, 'constructed-path');
    assertSpiroJunctionExits(result.coords, 'spiro placement');
    assertSpiroJunctionExits(pipelineResult.coords, 'pipeline layout');
    assert.equal(pipelineResult.metadata.audit.ok, true);
  });
});

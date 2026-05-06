import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createLayoutGraph } from '../../../../src/layout/engine/model/layout-graph.js';
import { layoutBridgedFamily } from '../../../../src/layout/engine/families/bridged.js';
import { parseSMILES } from '../../../../src/io/smiles.js';
import { runPipeline } from '../../../../src/layout/engine/pipeline.js';
import { auditLayout } from '../../../../src/layout/engine/audit/audit.js';
import { findSevereOverlaps, findVisibleHeavyBondCrossings } from '../../../../src/layout/engine/audit/invariants.js';
import { assignBondValidationClass } from '../../../../src/layout/engine/placement/bond-validation.js';
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

/**
 * Asserts that compact saturated rings stay close to regular ring bond lengths
 * and angles after bridged placement.
 * @param {object} graph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Coordinate map.
 * @param {string} label - Diagnostic label for assertion messages.
 * @returns {void}
 */
function assertCompactSaturatedRingShape(graph, coords, label) {
  const maxBondDeviation = graph.options.bondLength * 0.04;
  const maxAngleDeviation = (10 * Math.PI) / 180;

  for (const ring of graph.rings) {
    const targetAngle = Math.PI - (2 * Math.PI) / ring.atomIds.length;
    for (let index = 0; index < ring.atomIds.length; index++) {
      const atomId = ring.atomIds[index];
      const nextAtomId = ring.atomIds[(index + 1) % ring.atomIds.length];
      assert.ok(
        Math.abs(distance(coords.get(atomId), coords.get(nextAtomId)) - graph.options.bondLength) < maxBondDeviation,
        `expected ${label} ${atomId}-${nextAtomId} to keep compact saturated ring bond length`
      );
      assert.ok(
        Math.abs(ringInternalAngle(ring, coords, atomId) - targetAngle) < maxAngleDeviation,
        `expected ${label} ${atomId} to avoid visibly deformed ring angles`
      );
    }
  }
}

/**
 * Measures the largest regular-ring bond and angle deviations in a bridged layout.
 * @param {object} graph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Coordinate map.
 * @returns {{maxBondDeviation: number, maxAngleDeviation: number}} Ring-shape deviation summary.
 */
function bridgedRingShapeMetrics(graph, coords) {
  let maxBondDeviation = 0;
  let maxAngleDeviation = 0;

  for (const ring of graph.rings) {
    const targetAngle = Math.PI - (2 * Math.PI) / ring.atomIds.length;
    for (let index = 0; index < ring.atomIds.length; index++) {
      const atomId = ring.atomIds[index];
      const nextAtomId = ring.atomIds[(index + 1) % ring.atomIds.length];
      maxBondDeviation = Math.max(
        maxBondDeviation,
        Math.abs(distance(coords.get(atomId), coords.get(nextAtomId)) - graph.options.bondLength)
      );
      maxAngleDeviation = Math.max(
        maxAngleDeviation,
        Math.abs(ringInternalAngle(ring, coords, atomId) - targetAngle)
      );
    }
  }

  return {
    maxBondDeviation,
    maxAngleDeviation
  };
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

  it('regularizes compact saturated fused-spiro bridged rings after KK placement', () => {
    const smiles = 'CCC12C[NH2+]CC11CCCCC1CCC2';
    const graph = createLayoutGraph(parseSMILES(smiles), { suppressH: true });
    const result = layoutBridgedFamily(graph.rings, graph.options.bondLength, {
      layoutGraph: graph,
      templateId: null
    });
    const pipelineResult = runPipeline(parseSMILES(smiles), {
      suppressH: true,
      auditTelemetry: true,
      finalLandscapeOrientation: true
    });

    assert.equal(result.placementMode, 'projected-kamada-kawai');
    assertBridgedLayoutQuality(graph, result.coords);
    assertCompactSaturatedRingShape(graph, result.coords, 'bridged placement');
    assert.equal(pipelineResult.metadata.audit.ok, true);
    assertCompactSaturatedRingShape(graph, pipelineResult.coords, 'pipeline layout');
  });

  it('keeps compact fused-spiro bridged ether rings regular through mixed placement', () => {
    const smiles = 'COC1CCC2(C)CCCOC22OCCC12';
    const graph = createLayoutGraph(parseSMILES(smiles), { suppressH: true });
    const bridgedRingSystem = graph.ringSystems.find(ringSystem => ringSystem.ringIds.length === 3);
    assert.ok(bridgedRingSystem);
    const rings = graph.rings.filter(ring => bridgedRingSystem.ringIds.includes(ring.id));
    const result = layoutBridgedFamily(rings, graph.options.bondLength, {
      layoutGraph: graph,
      templateId: null
    });
    const pipelineResult = runPipeline(parseSMILES(smiles), {
      suppressH: true,
      auditTelemetry: true,
      finalLandscapeOrientation: true
    });

    assert.equal(result.placementMode, 'projected-kamada-kawai');
    assertBridgedLayoutQuality(graph, result.coords);
    assertCompactSaturatedRingShape(graph, result.coords, 'bridged placement');
    assert.equal(pipelineResult.metadata.audit.ok, true);
    assertCompactSaturatedRingShape(graph, pipelineResult.coords, 'pipeline layout');
  });

  it('keeps compact bridged ether cage projection from stretching ring bonds', () => {
    const graph = createLayoutGraph(parseSMILES('CC1CC2C(O)C(C1)C1OCCOC2CC1C'), {
      suppressH: true
    });
    const result = layoutBridgedFamily(graph.rings, graph.options.bondLength, {
      layoutGraph: graph,
      templateId: null
    });
    const audit = auditLayout(graph, result.coords, {
      bondLength: graph.options.bondLength,
      bondValidationClasses: assignBondValidationClass(graph, graph.ringSystems[0].atomIds, 'bridged')
    });

    assert.equal(result.placementMode, 'projected-kamada-kawai');
    assert.equal(audit.severeOverlapCount, 0);
    assert.ok(
      audit.bondLengthFailureCount <= 1,
      `expected compact bridged ether cage to avoid multiple stretched ring bonds, got ${audit.bondLengthFailureCount}`
    );
    assert.ok(
      audit.maxBondLengthDeviation < graph.options.bondLength * 0.5,
      `expected compact bridged ether cage bond deviation to stay bounded, got ${audit.maxBondLengthDeviation.toFixed(3)}`
    );
  });

  it('balances compact fused-spiro bridged heterorings without bond failures', () => {
    const smiles = 'CC1OC2=NCC(=N)NC3=NCC(C)CC23O1';
    const graph = createLayoutGraph(parseSMILES(smiles), { suppressH: true });
    const result = layoutBridgedFamily(graph.rings, graph.options.bondLength, {
      layoutGraph: graph,
      templateId: null
    });
    const pipelineResult = runPipeline(parseSMILES(smiles), {
      suppressH: true,
      auditTelemetry: true,
      finalLandscapeOrientation: true
    });
    const bridgedShape = bridgedRingShapeMetrics(graph, result.coords);
    const pipelineShape = bridgedRingShapeMetrics(graph, pipelineResult.coords);
    const maxVisibleAngleDeviation = (10 * Math.PI) / 180;
    const maxSafeBondDeviation = graph.options.bondLength * 0.05;

    assert.equal(result.placementMode, 'projected-kamada-kawai');
    assertBridgedLayoutQuality(graph, result.coords);
    assert.ok(
      bridgedShape.maxAngleDeviation < maxVisibleAngleDeviation,
      'expected bridged placement to distribute fused-spiro angle strain below the visible kink threshold'
    );
    assert.ok(
      bridgedShape.maxBondDeviation < maxSafeBondDeviation,
      'expected bridged placement to keep balanced junction bonds within standard audit tolerance'
    );
    assert.equal(pipelineResult.metadata.audit.ok, true);
    assert.ok(
      pipelineShape.maxAngleDeviation < maxVisibleAngleDeviation,
      'expected full pipeline to preserve balanced fused-spiro ring angles'
    );
    assert.ok(
      pipelineShape.maxBondDeviation < maxSafeBondDeviation,
      'expected full pipeline to preserve balanced fused-spiro bond lengths'
    );
  });

  it('balances saturated fused-spiro bridged cages with a constrained triple-ring junction', () => {
    const smiles = 'C[NH+]1CC2CCCN3CC(=O)CCCCC23C1';
    const graph = createLayoutGraph(parseSMILES(smiles), { suppressH: true });
    const result = layoutBridgedFamily(graph.rings, graph.options.bondLength, {
      layoutGraph: graph,
      templateId: null
    });
    const pipelineResult = runPipeline(parseSMILES(smiles), {
      suppressH: true,
      auditTelemetry: true,
      finalLandscapeOrientation: true
    });
    const bridgedShape = bridgedRingShapeMetrics(graph, result.coords);
    const pipelineShape = bridgedRingShapeMetrics(graph, pipelineResult.coords);
    const maxConstrainedJunctionAngleDeviation = (11.5 * Math.PI) / 180;
    const maxSafeBondDeviation = graph.options.bondLength * 0.05;

    assert.equal(result.placementMode, 'projected-kamada-kawai');
    assertBridgedLayoutQuality(graph, result.coords);
    assert.ok(
      bridgedShape.maxBondDeviation < maxSafeBondDeviation,
      'expected bridged placement to remove visible stretched-bond ring deformation'
    );
    assert.ok(
      bridgedShape.maxAngleDeviation < maxConstrainedJunctionAngleDeviation,
      'expected bridged placement to balance unavoidable triple-junction angle strain'
    );
    assert.equal(pipelineResult.metadata.audit.ok, true);
    assert.ok(
      pipelineShape.maxBondDeviation < maxSafeBondDeviation,
      'expected full pipeline to preserve balanced bridged bond lengths'
    );
    assert.ok(
      pipelineShape.maxAngleDeviation < maxConstrainedJunctionAngleDeviation,
      'expected full pipeline to preserve balanced triple-junction ring angles'
    );
  });

  it('uses a compact spiro-bridged oxetane template without crossed cage bonds', () => {
    const smiles = 'N#CC1CC2(C1)C1CCC2O1';
    const graph = createLayoutGraph(parseSMILES(smiles), { suppressH: true });
    const bridgedRingSystem = graph.ringSystems.find(ringSystem => ringSystem.ringIds.length === 3);
    assert.ok(bridgedRingSystem);
    const rings = graph.rings.filter(ring => bridgedRingSystem.ringIds.includes(ring.id));
    const result = layoutBridgedFamily(rings, graph.options.bondLength, {
      layoutGraph: graph,
      templateId: 'spiro-bridged-oxetane'
    });
    const pipelineResult = runPipeline(parseSMILES(smiles), {
      suppressH: true,
      auditTelemetry: true,
      finalLandscapeOrientation: true
    });
    const ringShape = bridgedRingShapeMetrics(graph, result.coords);
    const cyclobutylRing = graph.rings.find(ring => (
      ring.atomIds.length === 4
      && ['C3', 'C4', 'C5', 'C6'].every(atomId => ring.atomIds.includes(atomId))
    ));
    const maxCompactCageBondDeviation = graph.options.bondLength * 0.27;
    const maxCyclobutylBondDeviation = graph.options.bondLength * 0.04;
    const maxCyclobutylAngleDeviation = (5 * Math.PI) / 180;

    assert.ok(cyclobutylRing);
    assert.equal(result.placementMode, 'template');
    assertBridgedLayoutQuality(graph, result.coords);
    assert.deepEqual(findVisibleHeavyBondCrossings(graph, result.coords), []);
    assert.ok(
      ringShape.maxBondDeviation < maxCompactCageBondDeviation,
      'expected compact oxetane cage template to avoid visibly deformed ring bonds'
    );
    for (let index = 0; index < cyclobutylRing.atomIds.length; index++) {
      const atomId = cyclobutylRing.atomIds[index];
      const nextAtomId = cyclobutylRing.atomIds[(index + 1) % cyclobutylRing.atomIds.length];
      assert.ok(
        Math.abs(distance(result.coords.get(atomId), result.coords.get(nextAtomId)) - graph.options.bondLength) < maxCyclobutylBondDeviation,
        `expected compact oxetane cage template to keep cyclobutyl ${atomId}-${nextAtomId} balanced`
      );
      assert.ok(
        Math.abs(ringInternalAngle(cyclobutylRing, result.coords, atomId) - Math.PI / 2) < maxCyclobutylAngleDeviation,
        `expected compact oxetane cage template to keep cyclobutyl ${atomId} square`
      );
    }
    assert.equal(pipelineResult.metadata.audit.ok, true);
    assert.deepEqual(findVisibleHeavyBondCrossings(pipelineResult.layoutGraph, pipelineResult.coords), []);
  });

  it('uses a sulfonyl azatricyclo cage template without crossed cage bonds', () => {
    const smiles = 'CC12C[NH+](C1)C1C2C1S([O-])(=O)=O';
    const graph = createLayoutGraph(parseSMILES(smiles), { suppressH: true });
    const bridgedRingSystem = graph.ringSystems.find(ringSystem => ringSystem.ringIds.length === 3);
    assert.ok(bridgedRingSystem);
    const rings = graph.rings.filter(ring => bridgedRingSystem.ringIds.includes(ring.id));
    const result = layoutBridgedFamily(rings, graph.options.bondLength, {
      layoutGraph: graph,
      templateId: 'sulfonyl-azatricyclo-cage'
    });
    const pipelineResult = runPipeline(parseSMILES(smiles), {
      suppressH: true,
      auditTelemetry: true,
      finalLandscapeOrientation: true
    });

    assert.equal(result.placementMode, 'template');
    assertBridgedLayoutQuality(graph, result.coords);
    assert.deepEqual(findVisibleHeavyBondCrossings(graph, result.coords), []);
    assert.equal(pipelineResult.metadata.audit.ok, true);
    assert.deepEqual(findVisibleHeavyBondCrossings(pipelineResult.layoutGraph, pipelineResult.coords), []);
  });

  it('keeps long theta-like bridged ring paths separated from exocyclic substituents', () => {
    const smiles = 'CCOC(C)(C)C1NCC2OCC1NC(=O)O2';
    const graph = createLayoutGraph(parseSMILES(smiles), { suppressH: true });
    const bridgedRingSystem = graph.ringSystems.find(ringSystem => ringSystem.ringIds.length === 2);
    assert.ok(bridgedRingSystem);
    const rings = graph.rings.filter(ring => bridgedRingSystem.ringIds.includes(ring.id));
    const result = layoutBridgedFamily(rings, graph.options.bondLength, {
      layoutGraph: graph,
      templateId: null
    });
    const pipelineResult = runPipeline(parseSMILES(smiles), {
      suppressH: true,
      auditTelemetry: true,
      finalLandscapeOrientation: true
    });
    const bridgedShape = bridgedRingShapeMetrics(graph, result.coords);
    const pipelineShape = bridgedRingShapeMetrics(graph, pipelineResult.coords);
    const maxReadableBondDeviation = graph.options.bondLength * 0.22;

    assert.equal(result.placementMode, 'projected-kamada-kawai');
    assertBridgedLayoutQuality(graph, result.coords);
    assert.deepEqual(findVisibleHeavyBondCrossings(graph, result.coords), []);
    assert.ok(
      bridgedShape.maxBondDeviation < maxReadableBondDeviation,
      'expected bridged projection to avoid visibly stretched ring bonds'
    );
    assert.equal(pipelineResult.metadata.audit.ok, true);
    assert.deepEqual(findVisibleHeavyBondCrossings(pipelineResult.layoutGraph, pipelineResult.coords), []);
    assert.ok(
      pipelineShape.maxBondDeviation < maxReadableBondDeviation,
      'expected full pipeline to preserve the less deformed bridged ring shape'
    );
    assert.ok(
      distance(pipelineResult.coords.get('C6'), pipelineResult.coords.get('O16')) > graph.options.bondLength * 0.85,
      'expected the geminal methyl leaf to clear the carbonyl oxygen after branch placement'
    );
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

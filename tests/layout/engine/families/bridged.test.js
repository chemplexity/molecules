import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createLayoutGraph } from '../../../../src/layout/engine/model/layout-graph.js';
import { buildScaffoldPlan } from '../../../../src/layout/engine/model/scaffold-plan.js';
import { layoutBridgedFamily } from '../../../../src/layout/engine/families/bridged.js';
import { parseSMILES } from '../../../../src/io/smiles.js';
import { runPipeline } from '../../../../src/layout/engine/pipeline.js';
import { auditLayout } from '../../../../src/layout/engine/audit/audit.js';
import { findSevereOverlaps, findVisibleHeavyBondCrossings } from '../../../../src/layout/engine/audit/invariants.js';
import { assignBondValidationClass } from '../../../../src/layout/engine/placement/bond-validation.js';
import { BRIDGED_VALIDATION } from '../../../../src/layout/engine/constants.js';
import { angleOf, angularDifference, distance, sub } from '../../../../src/layout/engine/geometry/vec2.js';
import { pointInPolygon } from '../../../../src/layout/engine/geometry/polygon.js';
import { makeAdamantane, makeBicyclo222, makeNorbornane, makeUnmatchedBridgedCage } from '../support/molecules.js';

const RUN_LAYOUT_STRESS_TESTS = process.env.RUN_LAYOUT_STRESS === '1';
const stressIt = RUN_LAYOUT_STRESS_TESTS ? it : it.skip;

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
  return angularDifference(angleOf(sub(previousPosition, atomPosition)), angleOf(sub(nextPosition, atomPosition)));
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
      assert.ok(Math.abs(ringInternalAngle(ring, coords, atomId) - targetAngle) < maxAngleDeviation, `expected ${label} ${atomId} to avoid visibly deformed ring angles`);
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
      maxBondDeviation = Math.max(maxBondDeviation, Math.abs(distance(coords.get(atomId), coords.get(nextAtomId)) - graph.options.bondLength));
      maxAngleDeviation = Math.max(maxAngleDeviation, Math.abs(ringInternalAngle(ring, coords, atomId) - targetAngle));
    }
  }

  return {
    maxBondDeviation,
    maxAngleDeviation
  };
}

/**
 * Returns the angle at the center atom between two neighboring atoms.
 * @param {Map<string, {x: number, y: number}>} coords - Coordinate map.
 * @param {string} centerAtomId - Center atom ID.
 * @param {string} firstAtomId - First neighboring atom ID.
 * @param {string} secondAtomId - Second neighboring atom ID.
 * @returns {number} Angle in degrees.
 */
function angleAtAtom(coords, centerAtomId, firstAtomId, secondAtomId) {
  return (
    angularDifference(
      angleOf(sub(coords.get(firstAtomId), coords.get(centerAtomId))),
      angleOf(sub(coords.get(secondAtomId), coords.get(centerAtomId)))
    ) *
    (180 / Math.PI)
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

  it('keeps quaternary ammonium norbornane exits on near-orthogonal bridgehead slots', () => {
    const result = runPipeline(parseSMILES('CCC1CC2(CC1CC2CC)C(C)(C)[NH3+]'), {
      suppressH: true,
      auditTelemetry: true,
      finalLandscapeOrientation: true
    });
    const c12Angles = ['C5', 'C13', 'C14', 'N15']
      .map(atomId => ((angleOf(sub(result.coords.get(atomId), result.coords.get('C12'))) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2))
      .sort((first, second) => first - second);
    const c12Separations = c12Angles.map((angle, index) => (c12Angles[(index + 1) % c12Angles.length] - angle + Math.PI * 2) % (Math.PI * 2));

    assert.equal(result.metadata.primaryFamily, 'bridged');
    assert.equal(result.metadata.mixedMode, true);
    assert.equal(result.metadata.audit.ok, true);
    assert.equal(result.metadata.audit.severeOverlapCount, 0);
    assert.equal(result.metadata.audit.bondLengthFailureCount, 0);
    assert.equal(result.metadata.audit.fallback.mode, null);
    assert.ok(
      Math.max(...c12Separations.map(angle => Math.abs(angle - Math.PI / 2))) < Math.PI / 180,
      `expected C12 branch slots near 90 degrees, got ${c12Separations.map(angle => ((angle * 180) / Math.PI).toFixed(2)).join(', ')}`
    );
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
    const graph = createLayoutGraph(parseSMILES('N[C@@H](Cc1ccccc1)C(=O)N2C[C@H]3C[C@@H](C2)C4=CC=CC(=O)N4C3'), { suppressH: true });
    const bridgedRingSystem = graph.ringSystems.find(ringSystem => ringSystem.ringIds.length === 3);
    assert.ok(bridgedRingSystem);
    const rings = graph.rings.filter(ring => bridgedRingSystem.ringIds.includes(ring.id));
    const result = layoutBridgedFamily(rings, graph.options.bondLength, {
      layoutGraph: graph,
      templateId: null
    });

    assert.equal(result.placementMode, 'projected-kamada-kawai');
    assertBridgedLayoutQuality(graph, result.coords);
    assert.ok(distance(result.coords.get('C22'), result.coords.get('N27')) > graph.options.bondLength * 1.5, 'expected the fused lactam bridge projection to keep C22 and N27 visually separated');
  });

  it('keeps saturated bridged six-rings exact when routing a shared bridge run', () => {
    const graph = createLayoutGraph(parseSMILES('CC12COC(C1)C(CC#N)C[NH2+]2'), { suppressH: true });
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
      assert.ok(Math.abs(distance(result.coords.get(atomId), result.coords.get(nextAtomId)) - graph.options.bondLength) < 1e-6, `expected ${atomId}-${nextAtomId} to keep target bond length`);
      assert.ok(Math.abs(ringInternalAngle(sixRing, result.coords, atomId) - (2 * Math.PI) / 3) < 1e-6, `expected ${atomId} to keep a regular six-ring angle`);
    }
  });

  it('uses the homoadamantane template for compact saturated cages', () => {
    const smiles = 'C1(CC2(CC3(CC1CC(C2)C3)))';
    const graph = createLayoutGraph(parseSMILES(smiles), { suppressH: true });
    const scaffoldPlan = buildScaffoldPlan(graph, graph.components[0]);
    const result = layoutBridgedFamily(graph.rings, graph.options.bondLength, {
      layoutGraph: graph,
      templateId: scaffoldPlan.rootScaffold.templateId
    });
    const pipelineResult = runPipeline(parseSMILES(smiles), {
      suppressH: true,
      auditTelemetry: true,
      finalLandscapeOrientation: true
    });
    const assertLaneAnglesReadable = (coords, label) => {
      const laneAngles = [angleAtAtom(coords, 'C4', 'C3', 'C5'), angleAtAtom(coords, 'C8', 'C7', 'C9')];
      assert.ok(Math.min(...laneAngles) > 80, `expected ${label} bridge-lane vertices to stay open, got ${laneAngles.map(angle => angle.toFixed(2)).join(', ')}`);
      assert.ok(Math.max(...laneAngles) < 150, `expected ${label} bridge-lane vertices to avoid flat corners, got ${laneAngles.map(angle => angle.toFixed(2)).join(', ')}`);
    };

    assert.equal(scaffoldPlan.rootScaffold.templateId, 'homoadamantane-core');
    assert.equal(result.placementMode, 'template');
    assertBridgedLayoutQuality(graph, result.coords);
    assert.deepEqual(findVisibleHeavyBondCrossings(graph, result.coords), []);
    assertLaneAnglesReadable(result.coords, 'bridged placement');
    assert.equal(pipelineResult.metadata.audit.ok, true);
    assert.equal(pipelineResult.metadata.audit.visibleHeavyBondCrossingCount, 0);
    assert.equal(pipelineResult.metadata.audit.bondLengthFailureCount, 0);
    assert.ok(pipelineResult.metadata.audit.maxBondLengthDeviation < graph.options.bondLength * 0.18);
    assertLaneAnglesReadable(pipelineResult.coords, 'pipeline layout');
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
    assert.ok(audit.bondLengthFailureCount <= 1, `expected compact bridged ether cage to avoid multiple stretched ring bonds, got ${audit.bondLengthFailureCount}`);
    assert.ok(audit.maxBondLengthDeviation < graph.options.bondLength * 0.5, `expected compact bridged ether cage bond deviation to stay bounded, got ${audit.maxBondLengthDeviation.toFixed(3)}`);
  });

  it('seeds compact 5-5-4 bridged ether cages from the small ring', () => {
    const graph = createLayoutGraph(parseSMILES('C1OC2C3OCC12CO3'), {
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
    assert.equal(audit.ok, true);
    assert.equal(audit.severeOverlapCount, 0);
    assert.equal(audit.labelOverlapCount, 0);
    assert.equal(audit.bondLengthFailureCount, 0);
    assert.equal(audit.fallback.mode, null);
  });

  it('constructs aromatic-capped 5-5-4 bridged heterocycles without pinching the N ring', () => {
    const smiles = 'COC1=COC2=C1C1CN2C1';
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
    const fourRing = rings.find(ring => ring.atomIds.length === 4 && ring.atomIds.includes('N10'));
    const bridgedFiveRing = rings.find(ring => ring.atomIds.length === 5 && !ring.aromatic && ring.atomIds.includes('N10'));
    assert.ok(fourRing);
    assert.ok(bridgedFiveRing);
    const assertReadableNRingAngles = (coords, label) => {
      const fourRingAngles = fourRing.atomIds.map(atomId => ringInternalAngle(fourRing, coords, atomId) * (180 / Math.PI));
      const bridgedFiveRingAngles = bridgedFiveRing.atomIds.map(atomId => ringInternalAngle(bridgedFiveRing, coords, atomId) * (180 / Math.PI));
      assert.ok(Math.min(...fourRingAngles) > 85, `expected ${label} four-ring angles to avoid sharp N-ring corners, got ${fourRingAngles.map(angle => angle.toFixed(2)).join(', ')}`);
      assert.ok(Math.max(...fourRingAngles) < 95, `expected ${label} four-ring angles to stay square, got ${fourRingAngles.map(angle => angle.toFixed(2)).join(', ')}`);
      assert.ok(Math.min(...bridgedFiveRingAngles) > 85, `expected ${label} bridged five-ring to avoid pinched corners, got ${bridgedFiveRingAngles.map(angle => angle.toFixed(2)).join(', ')}`);
      assert.ok(Math.max(...bridgedFiveRingAngles) < 130, `expected ${label} bridged five-ring to avoid flattened corners, got ${bridgedFiveRingAngles.map(angle => angle.toFixed(2)).join(', ')}`);
    };

    assert.equal(result.placementMode, 'constructed-aromatic-capped-5-5-4');
    assertBridgedLayoutQuality(graph, result.coords);
    assertReadableNRingAngles(result.coords, 'constructed layout');
    assert.equal(pipelineResult.metadata.audit.ok, true);
    assertReadableNRingAngles(pipelineResult.coords, 'pipeline layout');
    assert.deepEqual(findVisibleHeavyBondCrossings(pipelineResult.layoutGraph, pipelineResult.coords), []);
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
    assert.ok(bridgedShape.maxAngleDeviation < maxVisibleAngleDeviation, 'expected bridged placement to distribute fused-spiro angle strain below the visible kink threshold');
    assert.ok(bridgedShape.maxBondDeviation < maxSafeBondDeviation, 'expected bridged placement to keep balanced junction bonds within standard audit tolerance');
    assert.equal(pipelineResult.metadata.audit.ok, true);
    assert.ok(pipelineShape.maxAngleDeviation < maxVisibleAngleDeviation, 'expected full pipeline to preserve balanced fused-spiro ring angles');
    assert.ok(pipelineShape.maxBondDeviation < maxSafeBondDeviation, 'expected full pipeline to preserve balanced fused-spiro bond lengths');
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
    assert.ok(bridgedShape.maxBondDeviation < maxSafeBondDeviation, 'expected bridged placement to remove visible stretched-bond ring deformation');
    assert.ok(bridgedShape.maxAngleDeviation < maxConstrainedJunctionAngleDeviation, 'expected bridged placement to balance unavoidable triple-junction angle strain');
    assert.equal(pipelineResult.metadata.audit.ok, true);
    assert.ok(pipelineShape.maxBondDeviation < maxSafeBondDeviation, 'expected full pipeline to preserve balanced bridged bond lengths');
    assert.ok(pipelineShape.maxAngleDeviation < maxConstrainedJunctionAngleDeviation, 'expected full pipeline to preserve balanced triple-junction ring angles');
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
    const cyclobutylRing = graph.rings.find(ring => ring.atomIds.length === 4 && ['C3', 'C4', 'C5', 'C6'].every(atomId => ring.atomIds.includes(atomId)));
    const maxCompactCageBondDeviation = graph.options.bondLength * 0.27;
    const maxCyclobutylBondDeviation = graph.options.bondLength * 0.04;
    const maxCyclobutylAngleDeviation = (5 * Math.PI) / 180;

    assert.ok(cyclobutylRing);
    assert.equal(result.placementMode, 'template');
    assertBridgedLayoutQuality(graph, result.coords);
    assert.deepEqual(findVisibleHeavyBondCrossings(graph, result.coords), []);
    assert.ok(ringShape.maxBondDeviation < maxCompactCageBondDeviation, 'expected compact oxetane cage template to avoid visibly deformed ring bonds');
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

  it('uses a sulfonyl cyclopentenyl azocane template so the five-member ring stays structured', () => {
    const smiles = 'CC1=C2CS(=O)(=O)C1C(CCNC2(C)C)C=O';
    const graph = createLayoutGraph(parseSMILES(smiles), { suppressH: true });
    const bridgedRingSystem = graph.ringSystems.find(ringSystem => ringSystem.ringIds.length === 2);
    assert.ok(bridgedRingSystem);
    const rings = graph.rings.filter(ring => bridgedRingSystem.ringIds.includes(ring.id));
    const result = layoutBridgedFamily(rings, graph.options.bondLength, {
      layoutGraph: graph,
      templateId: 'sulfonyl-cyclopentenyl-azocane-core'
    });
    const pipelineResult = runPipeline(parseSMILES(smiles), {
      suppressH: true,
      auditTelemetry: true,
      finalLandscapeOrientation: true
    });
    const cyclopentenylRing = { atomIds: ['C8', 'C2', 'C3', 'C4', 'S5'] };
    const upperContourAtomIds = ['C3', 'C13', 'N12', 'C11', 'C10', 'C9', 'C8'];
    const assertCyclopentenylRing = (coords, label) => {
      for (const atomId of cyclopentenylRing.atomIds) {
        const angle = ringInternalAngle(cyclopentenylRing, coords, atomId);
        assert.ok(Math.abs(angle - (3 * Math.PI) / 5) < 1e-6, `expected ${label} ${atomId} cyclopentenyl angle to stay at 108 degrees, got ${((angle * 180) / Math.PI).toFixed(2)}`);
      }
    };
    const assertAzocaneOuterContour = (coords, label, toleranceDegrees) => {
      const upperContourRing = { atomIds: upperContourAtomIds };
      const upperContourAngles = upperContourAtomIds.map(atomId => ringInternalAngle(upperContourRing, coords, atomId) * (180 / Math.PI));
      const upperContourPolygon = upperContourAtomIds.map(atomId => coords.get(atomId));
      for (const angle of upperContourAngles) {
        assert.ok(Math.abs(angle - 128.571) < toleranceDegrees, `expected ${label} azocane outer contour to stay heptagonal, got ${upperContourAngles.map(candidate => candidate.toFixed(2)).join(', ')}`);
      }
      assert.equal(pointInPolygon(coords.get('C2'), upperContourPolygon), true);
    };

    assert.equal(result.placementMode, 'template');
    assertBridgedLayoutQuality(graph, result.coords);
    assertCyclopentenylRing(result.coords, 'template layout');
    assertAzocaneOuterContour(result.coords, 'template layout', 1);
    assert.equal(pipelineResult.metadata.audit.ok, true);
    assertCyclopentenylRing(pipelineResult.coords, 'pipeline layout');
    assertAzocaneOuterContour(pipelineResult.coords, 'pipeline layout', 5);
    assert.deepEqual(findVisibleHeavyBondCrossings(pipelineResult.layoutGraph, pipelineResult.coords), []);
  });

  stressIt('uses a hydroxy alkyl bicyclohexene template so the compact five-ring stays structured', () => {
    const smiles = 'CCC1(O)C2C(CN(C)C)C1(CC)C=C2C';
    const graph = createLayoutGraph(parseSMILES(smiles), { suppressH: true });
    const bridgedRingSystem = graph.ringSystems.find(ringSystem => ringSystem.ringIds.length === 2);
    assert.ok(bridgedRingSystem);
    const rings = graph.rings.filter(ring => bridgedRingSystem.ringIds.includes(ring.id));
    const result = layoutBridgedFamily(rings, graph.options.bondLength, {
      layoutGraph: graph,
      templateId: 'hydroxy-alkyl-bicyclohexene-core'
    });
    const pipelineResult = runPipeline(parseSMILES(smiles), {
      suppressH: true,
      auditTelemetry: true,
      finalLandscapeOrientation: true
    });
    const cyclopentenylRing = { atomIds: ['C15', 'C14', 'C11', 'C3', 'C5'] };
    const assertCyclopentenylRing = (coords, label) => {
      const angles = cyclopentenylRing.atomIds.map(atomId => ringInternalAngle(cyclopentenylRing, coords, atomId) * (180 / Math.PI));
      assert.ok(Math.min(...angles) > 80, `expected ${label} cyclopentenyl ring to avoid pinched corners, got ${angles.map(angle => angle.toFixed(2)).join(', ')}`);
      assert.ok(Math.max(...angles) < 145, `expected ${label} cyclopentenyl ring to avoid flattened corners, got ${angles.map(angle => angle.toFixed(2)).join(', ')}`);
      for (const atomId of cyclopentenylRing.atomIds) {
        const nextAtomId = cyclopentenylRing.atomIds[(cyclopentenylRing.atomIds.indexOf(atomId) + 1) % cyclopentenylRing.atomIds.length];
        const bondDistance = distance(coords.get(atomId), coords.get(nextAtomId));
        assert.ok(
          bondDistance >= graph.options.bondLength * BRIDGED_VALIDATION.minBondLengthFactor && bondDistance <= graph.options.bondLength * BRIDGED_VALIDATION.maxBondLengthFactor,
          `expected ${label} ${atomId}-${nextAtomId} cyclopentenyl bond to stay readable, got ${bondDistance.toFixed(3)}`
        );
      }
    };

    assert.equal(result.placementMode, 'template');
    assertBridgedLayoutQuality(graph, result.coords);
    assertCyclopentenylRing(result.coords, 'template layout');
    assert.equal(pipelineResult.metadata.audit.ok, true);
    assertCyclopentenylRing(pipelineResult.coords, 'pipeline layout');
    assert.ok(findVisibleHeavyBondCrossings(pipelineResult.layoutGraph, pipelineResult.coords).every(crossing => crossing.firstAtomIds.includes('C7') || crossing.secondAtomIds.includes('C7')));
  });

  stressIt('uses a quinuclidinium oxygen-exit template so charged six-rings stay structured', () => {
    const smiles = 'NC(=O)C[N+]12CCC(CC1)C(C2)OC(=O)C1(CCCCCC1)C1=CC=CC=C1';
    const graph = createLayoutGraph(parseSMILES(smiles), { suppressH: true });
    const bridgedRingSystem = graph.ringSystems.find(ringSystem => ringSystem.ringIds.length === 2);
    assert.ok(bridgedRingSystem);
    const rings = graph.rings.filter(ring => bridgedRingSystem.ringIds.includes(ring.id));
    const result = layoutBridgedFamily(rings, graph.options.bondLength, {
      layoutGraph: graph,
      templateId: 'quinuclidinium-oxygen-exit'
    });
    const pipelineResult = runPipeline(parseSMILES(smiles), {
      suppressH: true,
      auditTelemetry: true,
      finalLandscapeOrientation: true
    });
    const assertQuinuclidiniumRings = (coords, label) => {
      for (const ring of rings) {
        const angles = ring.atomIds.map(atomId => ringInternalAngle(ring, coords, atomId) * (180 / Math.PI));
        assert.ok(Math.min(...angles) > 75, `expected ${label} quinuclidinium ring to avoid pinched corners, got ${angles.map(angle => angle.toFixed(2)).join(', ')}`);
        assert.ok(Math.max(...angles) < 160, `expected ${label} quinuclidinium ring to avoid flattened corners, got ${angles.map(angle => angle.toFixed(2)).join(', ')}`);
      }
    };

    assert.equal(result.placementMode, 'template');
    assertBridgedLayoutQuality(graph, result.coords);
    assertQuinuclidiniumRings(result.coords, 'template layout');
    assert.equal(pipelineResult.metadata.audit.ok, true);
    assertQuinuclidiniumRings(pipelineResult.coords, 'pipeline layout');
    assert.deepEqual(findVisibleHeavyBondCrossings(pipelineResult.layoutGraph, pipelineResult.coords), []);
  });

  it('uses a scopolamine epoxide template so the oxirane cap stays outside the tropane cage', () => {
    const smiles = 'O.Br.CN1[C@@H]2C[C@H](C[C@H]1[C@@H]3O[C@H]23)OC(=O)[C@H](CO)c4ccccc4';
    const graph = createLayoutGraph(parseSMILES(smiles), { suppressH: true });
    const bridgedRingSystem = graph.ringSystems.find(ringSystem => ringSystem.atomIds.includes('O15'));
    assert.ok(bridgedRingSystem);
    const rings = graph.rings.filter(ring => bridgedRingSystem.ringIds.includes(ring.id));
    const result = layoutBridgedFamily(rings, graph.options.bondLength, {
      layoutGraph: graph,
      templateId: 'scopolamine-epoxide-core'
    });
    const pipelineResult = runPipeline(parseSMILES(smiles), {
      suppressH: true,
      auditTelemetry: true,
      finalLandscapeOrientation: true
    });
    const sixRing = rings.find(ring => ring.size === 6);
    const oxiraneRing = rings.find(ring => ring.size === 3);
    assert.ok(sixRing);
    assert.ok(oxiraneRing);
    const assertScopolamineCore = (coords, label) => {
      const sixRingAngles = sixRing.atomIds.map(atomId => ringInternalAngle(sixRing, coords, atomId) * (180 / Math.PI));
      const oxiraneAngles = oxiraneRing.atomIds.map(atomId => ringInternalAngle(oxiraneRing, coords, atomId) * (180 / Math.PI));
      assert.ok(
        sixRingAngles.every(angle => Math.abs(angle - 120) < 0.05),
        `expected ${label} tropane six-ring to stay regular, got ${sixRingAngles.map(angle => angle.toFixed(2)).join(', ')}`
      );
      assert.ok(
        oxiraneAngles.every(angle => Math.abs(angle - 60) < 0.05),
        `expected ${label} oxirane cap to stay equilateral, got ${oxiraneAngles.map(angle => angle.toFixed(2)).join(', ')}`
      );
      assert.ok(distance(coords.get('N4'), coords.get('O15')) > graph.options.bondLength * 1.25, `expected ${label} oxirane oxygen to clear the tertiary nitrogen`);
    };

    assert.equal(result.placementMode, 'template');
    assertBridgedLayoutQuality(graph, result.coords);
    assertScopolamineCore(result.coords, 'template layout');
    assert.deepEqual(findVisibleHeavyBondCrossings(graph, result.coords), []);
    assert.equal(pipelineResult.metadata.audit.ok, true);
    assert.equal(pipelineResult.metadata.audit.severeOverlapCount, 0);
    assert.equal(pipelineResult.metadata.audit.labelOverlapCount, 0);
    assert.equal(pipelineResult.metadata.audit.visibleHeavyBondCrossingCount, 0);
    assert.equal(pipelineResult.metadata.audit.fallback.mode, null);
    assertScopolamineCore(pipelineResult.coords, 'pipeline layout');
    assert.deepEqual(findVisibleHeavyBondCrossings(pipelineResult.layoutGraph, pipelineResult.coords), []);
  });

  stressIt('uses a bridged oxadecalin template so substituted ether cages stay open', () => {
    const smiles = 'CC1CC2COC(C)C(C1)C(C)(C)C2CCO';
    const graph = createLayoutGraph(parseSMILES(smiles), { suppressH: true });
    const bridgedRingSystem = graph.ringSystems.find(ringSystem => ringSystem.ringIds.length === 2);
    assert.ok(bridgedRingSystem);
    const rings = graph.rings.filter(ring => bridgedRingSystem.ringIds.includes(ring.id));
    const result = layoutBridgedFamily(rings, graph.options.bondLength, {
      layoutGraph: graph,
      templateId: 'bridged-oxadecalin-core'
    });
    const pipelineResult = runPipeline(parseSMILES(smiles), {
      suppressH: true,
      auditTelemetry: true,
      finalLandscapeOrientation: true
    });
    const assertOxadecalinRings = (coords, label) => {
      for (const ring of rings) {
        const angles = ring.atomIds.map(atomId => ringInternalAngle(ring, coords, atomId) * (180 / Math.PI));
        assert.ok(Math.min(...angles) > 105, `expected ${label} oxadecalin ring to avoid collapsed corners, got ${angles.map(angle => angle.toFixed(2)).join(', ')}`);
        assert.ok(Math.max(...angles) < 155, `expected ${label} oxadecalin ring to avoid folded-back corners, got ${angles.map(angle => angle.toFixed(2)).join(', ')}`);
      }
    };

    assert.equal(result.placementMode, 'template');
    assertBridgedLayoutQuality(graph, result.coords);
    assertOxadecalinRings(result.coords, 'template layout');
    assert.equal(pipelineResult.metadata.audit.ok, true);
    assert.equal(pipelineResult.metadata.audit.severeOverlapCount, 0);
    assert.equal(pipelineResult.metadata.audit.bondLengthFailureCount, 0);
    assert.equal(pipelineResult.metadata.audit.fallback.mode, null);
    assertOxadecalinRings(pipelineResult.coords, 'pipeline layout');
  });

  it('uses an aza-oxa cyclopropyl oxetane template so compact tetracyclic rings stay open', () => {
    const smiles = 'CCCC1C2C3N2CC(O)C32OCC12';
    const graph = createLayoutGraph(parseSMILES(smiles), { suppressH: true });
    const bridgedRingSystem = graph.ringSystems.find(ringSystem => ringSystem.ringIds.length === 4);
    assert.ok(bridgedRingSystem);
    const rings = graph.rings.filter(ring => bridgedRingSystem.ringIds.includes(ring.id));
    const result = layoutBridgedFamily(rings, graph.options.bondLength, {
      layoutGraph: graph,
      templateId: 'aza-oxa-cyclopropyl-oxetane-core'
    });
    const pipelineResult = runPipeline(parseSMILES(smiles), {
      suppressH: true,
      auditTelemetry: true,
      finalLandscapeOrientation: true
    });
    const assertOpenCompactCage = (coords, label) => {
      for (const ring of rings) {
        const angles = ring.atomIds.map(atomId => ringInternalAngle(ring, coords, atomId) * (180 / Math.PI));
        assert.ok(Math.min(...angles) > 45, `expected ${label} compact tetracyclic ring to avoid pinched corners, got ${angles.map(angle => angle.toFixed(2)).join(', ')}`);
        assert.ok(Math.max(...angles) < 150, `expected ${label} compact tetracyclic ring to avoid folded-back corners, got ${angles.map(angle => angle.toFixed(2)).join(', ')}`);
      }
    };

    assert.equal(result.placementMode, 'template');
    assertBridgedLayoutQuality(graph, result.coords);
    assertOpenCompactCage(result.coords, 'template layout');
    assert.deepEqual(findVisibleHeavyBondCrossings(graph, result.coords), []);
    assert.equal(pipelineResult.metadata.audit.ok, true);
    assert.equal(pipelineResult.metadata.audit.fallback.mode, null);
    assertOpenCompactCage(pipelineResult.coords, 'pipeline layout');
    assert.deepEqual(findVisibleHeavyBondCrossings(pipelineResult.layoutGraph, pipelineResult.coords), []);
  });

  it('uses a cyano formyl acetal bridged template so saturated acetal cages stay open', () => {
    const smiles = 'CC1CC2CC1(C#N)C1(COC(CO2)O1)C=O';
    const graph = createLayoutGraph(parseSMILES(smiles), { suppressH: true });
    const bridgedRingSystem = graph.ringSystems.find(ringSystem => ringSystem.ringIds.length === 3);
    assert.ok(bridgedRingSystem);
    const rings = graph.rings.filter(ring => bridgedRingSystem.ringIds.includes(ring.id));
    const result = layoutBridgedFamily(rings, graph.options.bondLength, {
      layoutGraph: graph,
      templateId: 'cyano-formyl-acetal-bridged-core'
    });
    const pipelineResult = runPipeline(parseSMILES(smiles), {
      suppressH: true,
      auditTelemetry: true,
      finalLandscapeOrientation: true
    });
    const assertOpenAcetalCage = (coords, label) => {
      for (const ring of rings) {
        const isCarbocycle = ring.atomIds.length === 5 && ring.atomIds.includes('C2') && ring.atomIds.includes('C3');
        const limits = ring.atomIds.length === 8 ? { min: 90, max: 160 } : isCarbocycle ? { min: 100, max: 116 } : { min: 90, max: 146 };
        const angles = ring.atomIds.map(atomId => ringInternalAngle(ring, coords, atomId) * (180 / Math.PI));
        assert.ok(Math.min(...angles) > limits.min, `expected ${label} ring ${ring.id} to avoid pinched corners, got ${angles.map(angle => angle.toFixed(2)).join(', ')}`);
        assert.ok(Math.max(...angles) < limits.max, `expected ${label} ring ${ring.id} to avoid folded-back corners, got ${angles.map(angle => angle.toFixed(2)).join(', ')}`);
      }
    };

    assert.equal(result.placementMode, 'template');
    assertBridgedLayoutQuality(graph, result.coords);
    assertOpenAcetalCage(result.coords, 'template layout');
    assert.deepEqual(findVisibleHeavyBondCrossings(graph, result.coords), []);
    assert.equal(pipelineResult.metadata.audit.ok, true);
    assert.equal(pipelineResult.metadata.audit.fallback.mode, null);
    assertOpenAcetalCage(pipelineResult.coords, 'pipeline layout');
    assert.deepEqual(findVisibleHeavyBondCrossings(pipelineResult.layoutGraph, pipelineResult.coords), []);
  });

  it('uses an aminonitrile oxabicyclobutane template so the compact five-four cage stays open', () => {
    const smiles = 'CCC12CC(C1)(OC2C[NH3+])C(N)C#N';
    const graph = createLayoutGraph(parseSMILES(smiles), { suppressH: true });
    const bridgedRingSystem = graph.ringSystems.find(ringSystem => ringSystem.ringIds.length === 2);
    assert.ok(bridgedRingSystem);
    const rings = graph.rings.filter(ring => bridgedRingSystem.ringIds.includes(ring.id));
    const result = layoutBridgedFamily(rings, graph.options.bondLength, {
      layoutGraph: graph,
      templateId: 'aminonitrile-oxabicyclobutane-core'
    });
    const pipelineResult = runPipeline(parseSMILES(smiles), {
      suppressH: true,
      auditTelemetry: true
    });
    const assertOpenFiveFourCage = (coords, label) => {
      for (const ring of rings) {
        const angles = ring.atomIds.map(atomId => ringInternalAngle(ring, coords, atomId) * (180 / Math.PI));
        const limits = ring.atomIds.length === 4 ? { min: 80, max: 105 } : { min: 90, max: 125 };
        assert.ok(Math.min(...angles) > limits.min, `expected ${label} ring ${ring.id} to avoid pinched corners, got ${angles.map(angle => angle.toFixed(2)).join(', ')}`);
        assert.ok(Math.max(...angles) < limits.max, `expected ${label} ring ${ring.id} to avoid folded-back corners, got ${angles.map(angle => angle.toFixed(2)).join(', ')}`);
      }
    };

    assert.equal(result.placementMode, 'template');
    assertBridgedLayoutQuality(graph, result.coords);
    assertOpenFiveFourCage(result.coords, 'template layout');
    assert.deepEqual(findVisibleHeavyBondCrossings(graph, result.coords), []);
    assert.equal(pipelineResult.metadata.audit.ok, true);
    assert.equal(pipelineResult.metadata.audit.fallback.mode, null);
    assertOpenFiveFourCage(pipelineResult.coords, 'pipeline layout');
    assert.deepEqual(findVisibleHeavyBondCrossings(pipelineResult.layoutGraph, pipelineResult.coords), []);
  });

  it('uses an alkynyl dicyano oxabicyclobutane template so compact five-four cages keep readable angles', () => {
    const smiles = 'CC#CC1C2OC(CC#N)(C#N)C1C2O';
    const graph = createLayoutGraph(parseSMILES(smiles), { suppressH: true });
    const scaffoldPlan = buildScaffoldPlan(graph, graph.components[0]);
    const bridgedRingSystem = graph.ringSystems.find(ringSystem => ringSystem.ringIds.length === 2);
    assert.ok(bridgedRingSystem);
    const rings = graph.rings.filter(ring => bridgedRingSystem.ringIds.includes(ring.id));
    const result = layoutBridgedFamily(rings, graph.options.bondLength, {
      layoutGraph: graph,
      templateId: scaffoldPlan.rootScaffold.templateId
    });
    const pipelineResult = runPipeline(parseSMILES(smiles), {
      suppressH: true,
      auditTelemetry: true
    });
    const assertReadableFiveFourCage = (coords, label) => {
      for (const ring of rings) {
        const angles = ring.atomIds.map(atomId => ringInternalAngle(ring, coords, atomId) * (180 / Math.PI));
        const limits = ring.atomIds.length === 4 ? { min: 80, max: 105 } : { min: 90, max: 125 };
        assert.ok(Math.min(...angles) > limits.min, `expected ${label} ring ${ring.id} to avoid pinched corners, got ${angles.map(angle => angle.toFixed(2)).join(', ')}`);
        assert.ok(Math.max(...angles) < limits.max, `expected ${label} ring ${ring.id} to avoid folded-back corners, got ${angles.map(angle => angle.toFixed(2)).join(', ')}`);
      }
    };

    assert.equal(scaffoldPlan.rootScaffold.templateId, 'alkynyl-dicyano-oxabicyclobutane-core');
    assert.equal(result.placementMode, 'template');
    assertBridgedLayoutQuality(graph, result.coords);
    assertReadableFiveFourCage(result.coords, 'template layout');
    assert.equal(pipelineResult.metadata.audit.ok, true);
    assert.equal(pipelineResult.metadata.audit.fallback.mode, null);
    assertReadableFiveFourCage(pipelineResult.coords, 'pipeline layout');
  });

  it('uses an alkyl oxabicyclobutane template so compact five-four ether cages stay structured', () => {
    const smiles = 'CCC12CC(C)(CO1)C2CCS(=O)(=O)N(C)C';
    const graph = createLayoutGraph(parseSMILES(smiles), { suppressH: true });
    const scaffoldPlan = buildScaffoldPlan(graph, graph.components[0]);
    const bridgedRingSystem = graph.ringSystems.find(ringSystem => ringSystem.ringIds.length === 2);
    assert.ok(bridgedRingSystem);
    const rings = graph.rings.filter(ring => bridgedRingSystem.ringIds.includes(ring.id));
    const result = layoutBridgedFamily(rings, graph.options.bondLength, {
      layoutGraph: graph,
      templateId: scaffoldPlan.rootScaffold.templateId
    });
    const pipelineResult = runPipeline(parseSMILES(smiles), {
      suppressH: true,
      auditTelemetry: true
    });
    const assertOpenFiveFourEtherCage = (coords, label) => {
      for (const ring of rings) {
        const angles = ring.atomIds.map(atomId => ringInternalAngle(ring, coords, atomId) * (180 / Math.PI));
        const limits = ring.atomIds.length === 4 ? { min: 80, max: 105 } : { min: 90, max: 125 };
        assert.ok(Math.min(...angles) > limits.min, `expected ${label} ring ${ring.id} to avoid pinched corners, got ${angles.map(angle => angle.toFixed(2)).join(', ')}`);
        assert.ok(Math.max(...angles) < limits.max, `expected ${label} ring ${ring.id} to avoid folded-back corners, got ${angles.map(angle => angle.toFixed(2)).join(', ')}`);
        for (let index = 0; index < ring.atomIds.length; index++) {
          const atomId = ring.atomIds[index];
          const nextAtomId = ring.atomIds[(index + 1) % ring.atomIds.length];
          assert.ok(
            Math.abs(distance(coords.get(atomId), coords.get(nextAtomId)) - graph.options.bondLength) < graph.options.bondLength * 0.22,
            `expected ${label} ${atomId}-${nextAtomId} to avoid visible ring stretch`
          );
        }
      }
    };

    assert.equal(scaffoldPlan.rootScaffold.templateId, 'alkyl-oxabicyclobutane-core');
    assert.equal(result.placementMode, 'template');
    assertBridgedLayoutQuality(graph, result.coords);
    assertOpenFiveFourEtherCage(result.coords, 'template layout');
    assert.deepEqual(findVisibleHeavyBondCrossings(graph, result.coords), []);
    assert.equal(pipelineResult.metadata.audit.ok, true);
    assert.equal(pipelineResult.metadata.audit.fallback.mode, null);
    assertOpenFiveFourEtherCage(pipelineResult.coords, 'pipeline layout');
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
    assert.ok(bridgedShape.maxBondDeviation < maxReadableBondDeviation, 'expected bridged projection to avoid visibly stretched ring bonds');
    assert.equal(pipelineResult.metadata.audit.ok, true);
    assert.deepEqual(findVisibleHeavyBondCrossings(pipelineResult.layoutGraph, pipelineResult.coords), []);
    assert.ok(pipelineShape.maxBondDeviation < maxReadableBondDeviation, 'expected full pipeline to preserve the less deformed bridged ring shape');
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

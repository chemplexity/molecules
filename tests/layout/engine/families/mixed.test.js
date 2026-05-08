import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseSMILES } from '../../../../src/io/index.js';
import { auditLayout } from '../../../../src/layout/engine/audit/audit.js';
import { findSevereOverlaps, findVisibleHeavyBondCrossings, measureRingSubstituentReadability } from '../../../../src/layout/engine/audit/invariants.js';
import { pointInPolygon } from '../../../../src/layout/engine/geometry/polygon.js';
import { computeIncidentRingOutwardAngles } from '../../../../src/layout/engine/geometry/ring-direction.js';
import { createLayoutGraph } from '../../../../src/layout/engine/model/layout-graph.js';
import { buildScaffoldPlan } from '../../../../src/layout/engine/model/scaffold-plan.js';
import { layoutMixedFamily } from '../../../../src/layout/engine/families/mixed.js';
import { generateCoords } from '../../../../src/layout/engine/api.js';
import { runPipeline } from '../../../../src/layout/engine/pipeline.js';
import { add, angleOf, angularDifference, centroid, distance, fromAngle, sub } from '../../../../src/layout/engine/geometry/vec2.js';
import { measureSmallRingExteriorGapSpreadPenalty, smallRingExteriorTargetAngles } from '../../../../src/layout/engine/placement/branch-placement.js';
import { measureTerminalRingCarbonylLeafContactPenalty } from '../../../../src/layout/engine/cleanup/presentation/ring-substituent.js';
import {
  makeBibenzyl,
  makeBiphenyl,
  makeButylbenzene,
  makeEthylbenzene,
  makeMacrocycleWithSubstituent,
  makeMethylnaphthalene,
  makeMethylbenzene,
  makePhenylacetylene
} from '../support/molecules.js';

const MIXED_BRANCH_STRESS_TIMEOUT_MS = 60000;

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
 * Returns heavy ring substituents whose placed endpoint falls inside an incident ring face.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Coordinate map.
 * @returns {Array<{atomId: string, childId: string}>} Invalid inward substituents.
 */
function inwardRingSubstituents(layoutGraph, coords) {
  const ringAtomSet = new Set(layoutGraph.ringSystems[0]?.atomIds ?? []);
  const invalid = [];

  for (const atomId of layoutGraph.ringSystems[0]?.atomIds ?? []) {
    const atom = layoutGraph.sourceMolecule.atoms.get(atomId);
    if (!atom) {
      continue;
    }
    const heavyChildren = atom
      .getNeighbors(layoutGraph.sourceMolecule)
      .filter(neighbor => neighbor && neighbor.name !== 'H' && !ringAtomSet.has(neighbor.id))
      .map(neighbor => neighbor.id);
    if (heavyChildren.length !== 1) {
      continue;
    }
    const childId = heavyChildren[0];
    const childPosition = coords.get(childId);
    const insideIncidentRing = (layoutGraph.atomToRings.get(atomId) ?? []).some(ring =>
      pointInPolygon(
        childPosition,
        ring.atomIds.map(ringAtomId => coords.get(ringAtomId))
      )
    );
    if (insideIncidentRing) {
      invalid.push({ atomId, childId });
    }
  }

  return invalid;
}

/**
 * Returns the sorted pairwise bond-angle separations around a placed atom.
 * @param {Map<string, string[]>} adjacency - Component adjacency map.
 * @param {Map<string, {x: number, y: number}>} coords - Coordinate map.
 * @param {string} atomId - Atom ID to inspect.
 * @returns {number[]} Sorted angular separations in radians.
 */
function sortedNeighborSeparations(adjacency, coords, atomId) {
  const atomPosition = coords.get(atomId);
  const neighborAngles = (adjacency.get(atomId) ?? [])
    .filter(neighborAtomId => coords.has(neighborAtomId))
    .map(neighborAtomId => angleOf(sub(coords.get(neighborAtomId), atomPosition)))
    .sort((firstAngle, secondAngle) => firstAngle - secondAngle);
  const separations = [];

  for (let index = 0; index < neighborAngles.length; index++) {
    const currentAngle = neighborAngles[index];
    const nextAngle = neighborAngles[(index + 1) % neighborAngles.length];
    const rawGap = nextAngle - currentAngle;
    separations.push(rawGap > 0 ? rawGap : rawGap + Math.PI * 2);
  }

  return separations.sort((firstSeparation, secondSeparation) => firstSeparation - secondSeparation);
}

function sortedHeavyNeighborSeparations(adjacency, coords, atomId, layoutGraph) {
  const atomPosition = coords.get(atomId);
  const neighborAngles = (adjacency.get(atomId) ?? [])
    .filter(neighborAtomId => coords.has(neighborAtomId) && layoutGraph.atoms.get(neighborAtomId)?.element !== 'H')
    .map(neighborAtomId => angleOf(sub(coords.get(neighborAtomId), atomPosition)))
    .sort((firstAngle, secondAngle) => firstAngle - secondAngle);
  const separations = [];

  for (let index = 0; index < neighborAngles.length; index++) {
    const currentAngle = neighborAngles[index];
    const nextAngle = neighborAngles[(index + 1) % neighborAngles.length];
    const rawGap = nextAngle - currentAngle;
    separations.push(rawGap > 0 ? rawGap : rawGap + Math.PI * 2);
  }

  return separations.sort((firstSeparation, secondSeparation) => firstSeparation - secondSeparation);
}

function exteriorSpreadAnchorMetrics(result, ringSize) {
  const graph = result.layoutGraph;
  const adjacency = buildAdjacency(graph, new Set(graph.components[0].atomIds));

  for (const [atomId, atom] of graph.atoms) {
    if (!atom || atom.element === 'H' || atom.aromatic || atom.heavyDegree !== 4 || !result.coords.has(atomId)) {
      continue;
    }

    const rings = graph.atomToRings.get(atomId) ?? [];
    if (rings.length !== 1) {
      continue;
    }
    const ring = rings[0];
    if (ring?.aromatic || ring.atomIds.length !== ringSize) {
      continue;
    }

    const ringAtomIds = new Set(ring.atomIds);
    const ringNeighborIds = [];
    const exocyclicNeighborIds = [];
    let eligible = true;
    for (const bond of graph.bondsByAtomId.get(atomId) ?? []) {
      if (!bond || bond.kind !== 'covalent' || bond.aromatic || (bond.order ?? 1) !== 1) {
        eligible = false;
        break;
      }
      const neighborAtomId = bond.a === atomId ? bond.b : bond.a;
      const neighborAtom = graph.atoms.get(neighborAtomId);
      if (!neighborAtom || neighborAtom.element === 'H') {
        continue;
      }
      if (ringAtomIds.has(neighborAtomId)) {
        ringNeighborIds.push(neighborAtomId);
        continue;
      }
      exocyclicNeighborIds.push(neighborAtomId);
    }
    if (!eligible || ringNeighborIds.length !== 2 || exocyclicNeighborIds.length !== 2) {
      continue;
    }
    if (![...ringNeighborIds, ...exocyclicNeighborIds].every(neighborAtomId => result.coords.has(neighborAtomId))) {
      continue;
    }

    const centerPosition = result.coords.get(atomId);
    const ringNeighborAngles = ringNeighborIds.map(neighborAtomId => angleOf(sub(result.coords.get(neighborAtomId), centerPosition)));
    const targetAngles = smallRingExteriorTargetAngles(ringNeighborAngles, ringSize);
    if (targetAngles.length !== 2) {
      continue;
    }
    const exocyclicAngles = exocyclicNeighborIds.map(neighborAtomId => angleOf(sub(result.coords.get(neighborAtomId), centerPosition)));
    const alignedDeviation = [
      angularDifference(exocyclicAngles[0], targetAngles[0]),
      angularDifference(exocyclicAngles[1], targetAngles[1])
    ];
    const swappedDeviation = [
      angularDifference(exocyclicAngles[0], targetAngles[1]),
      angularDifference(exocyclicAngles[1], targetAngles[0])
    ];

    return {
      anchorAtomId: atomId,
      ringNeighborIds,
      exocyclicNeighborIds,
      maxTargetDeviation: Math.min(Math.max(...alignedDeviation), Math.max(...swappedDeviation)),
      separations: sortedHeavyNeighborSeparations(adjacency, result.coords, atomId, graph)
    };
  }

  return null;
}

/**
 * Returns the smaller bond angle at a center atom between two neighbors.
 * @param {Map<string, {x: number, y: number}>} coords - Coordinate map.
 * @param {string} centerAtomId - Center atom ID.
 * @param {string} firstNeighborAtomId - First neighbor atom ID.
 * @param {string} secondNeighborAtomId - Second neighbor atom ID.
 * @returns {number} Smaller bond angle in radians.
 */
function bondAngleAtAtom(coords, centerAtomId, firstNeighborAtomId, secondNeighborAtomId) {
  const centerPosition = coords.get(centerAtomId);
  const firstAngle = angleOf(sub(coords.get(firstNeighborAtomId), centerPosition));
  const secondAngle = angleOf(sub(coords.get(secondNeighborAtomId), centerPosition));
  return angularDifference(firstAngle, secondAngle);
}

function sharedRingCount(layoutGraph, firstAtomId, secondAtomId) {
  const firstRings = layoutGraph.atomToRings.get(firstAtomId) ?? [];
  const secondRings = layoutGraph.atomToRings.get(secondAtomId) ?? [];
  return secondRings.filter(ring => firstRings.includes(ring)).length;
}

function directAttachedRingJunctionDeviation(layoutGraph, coords, anchorAtomId, childAtomId) {
  const anchorRings = layoutGraph.atomToRings.get(anchorAtomId) ?? [];
  const ringNeighborIds = layoutGraph.sourceMolecule.atoms.get(anchorAtomId)
    ?.getNeighbors(layoutGraph.sourceMolecule)
    .filter(neighborAtom => neighborAtom && neighborAtom.name !== 'H' && neighborAtom.id !== childAtomId && (layoutGraph.atomToRings.get(neighborAtom.id)?.length ?? 0) > 0)
    .map(neighborAtom => neighborAtom.id) ?? [];
  const sharedJunctionNeighborId = ringNeighborIds.find(neighborAtomId => {
    const neighborRings = layoutGraph.atomToRings.get(neighborAtomId) ?? [];
    return neighborRings.filter(ring => anchorRings.includes(ring)).length > 1;
  });
  if (!sharedJunctionNeighborId) {
    return null;
  }

  const straightJunctionAngle = angleOf(sub(coords.get(anchorAtomId), coords.get(sharedJunctionNeighborId)));
  const childAngle = angleOf(sub(coords.get(childAtomId), coords.get(anchorAtomId)));
  return angularDifference(childAngle, straightJunctionAngle);
}

function bestLocalRingDeviation(layoutGraph, coords, anchorAtomId, childAtomId) {
  const childAngle = angleOf(sub(coords.get(childAtomId), coords.get(anchorAtomId)));
  return Math.min(...computeIncidentRingOutwardAngles(layoutGraph, anchorAtomId, atomId => coords.get(atomId) ?? null).map(outwardAngle => (
    angularDifference(childAngle, outwardAngle)
  )));
}

function measureResultRingMetrics(result, ring, targetAngleDegrees = 120) {
  let maxBondDeviation = 0;
  let maxAngleDeviation = 0;
  for (let index = 0; index < ring.atomIds.length; index++) {
    const atomId = ring.atomIds[index];
    const previousAtomId = ring.atomIds[(index - 1 + ring.atomIds.length) % ring.atomIds.length];
    const nextAtomId = ring.atomIds[(index + 1) % ring.atomIds.length];
    const ringBondLength = distance(result.coords.get(atomId), result.coords.get(nextAtomId));
    const ringAngle = (bondAngleAtAtom(result.coords, atomId, previousAtomId, nextAtomId) * 180) / Math.PI;
    maxBondDeviation = Math.max(maxBondDeviation, Math.abs(ringBondLength - result.layoutGraph.options.bondLength));
    maxAngleDeviation = Math.max(maxAngleDeviation, Math.abs(ringAngle - targetAngleDegrees));
  }
  return { maxBondDeviation, maxAngleDeviation };
}

describe('layout/engine/families/mixed', () => {
  it('lays out a ring scaffold plus acyclic substituent through the mixed orchestrator', () => {
    const graph = createLayoutGraph(makeMethylbenzene());
    const component = graph.components[0];
    const plan = buildScaffoldPlan(graph, component);
    const result = layoutMixedFamily(graph, component, buildAdjacency(graph, new Set(component.atomIds)), plan, graph.options.bondLength);
    assert.equal(result.family, 'mixed');
    assert.equal(result.supported, true);
    assert.equal(result.coords.size, 7);
    assert.ok(result.coords.has('a6'));
  });

  it('lays out an alkyl substituent off a ring without keeping the chain flat', () => {
    const graph = createLayoutGraph(makeEthylbenzene());
    const component = graph.components[0];
    const plan = buildScaffoldPlan(graph, component);
    const result = layoutMixedFamily(graph, component, buildAdjacency(graph, new Set(component.atomIds)), plan, graph.options.bondLength);
    const firstBond = sub(result.coords.get('a6'), result.coords.get('a0'));
    const secondBond = sub(result.coords.get('a7'), result.coords.get('a6'));
    const cross = firstBond.x * secondBond.y - firstBond.y * secondBond.x;

    assert.equal(result.supported, true);
    assert.ok(result.coords.has('a6'));
    assert.ok(result.coords.has('a7'));
    assert.ok(Math.abs(cross) > 0.2);
  });

  it('points a longer alkyl substituent outward from the ring and keeps the chain zigzagged', () => {
    const graph = createLayoutGraph(makeButylbenzene());
    const component = graph.components[0];
    const plan = buildScaffoldPlan(graph, component);
    const result = layoutMixedFamily(graph, component, buildAdjacency(graph, new Set(component.atomIds)), plan, graph.options.bondLength);
    const ringAnchor = result.coords.get('a0');
    const ringNeighborCenter = centroid([result.coords.get('a1'), result.coords.get('a5')]);
    const outward = sub(ringAnchor, ringNeighborCenter);
    const firstBond = sub(result.coords.get('a6'), ringAnchor);
    const secondBond = sub(result.coords.get('a7'), result.coords.get('a6'));
    const thirdBond = sub(result.coords.get('a8'), result.coords.get('a7'));
    const outwardDot = outward.x * firstBond.x + outward.y * firstBond.y;
    const chainCross = secondBond.x * thirdBond.y - secondBond.y * thirdBond.x;

    assert.equal(result.supported, true);
    assert.ok(outwardDot > 0.5);
    assert.ok(Math.abs(chainCross) > 0.2);
  });

  it('keeps cyclopropyl-adjacent mixed alkyl tails on a 120-degree zigzag instead of flattening them straight', () => {
    const smiles = 'CCC1(CC1)C1(CC[NH2+]1)C(C)O';
    const graph = createLayoutGraph(parseSMILES(smiles), {
      suppressH: true,
      finalLandscapeOrientation: true
    });
    const component = graph.components[0];
    const result = layoutMixedFamily(graph, component, buildAdjacency(graph, new Set(component.atomIds)), buildScaffoldPlan(graph, component), graph.options.bondLength);
    const mixedBend = bondAngleAtAtom(result.coords, 'C2', 'C1', 'C3');
    const pipelineResult = runPipeline(parseSMILES(smiles), {
      suppressH: true,
      finalLandscapeOrientation: true,
      auditTelemetry: true
    });
    const pipelineBend = bondAngleAtAtom(pipelineResult.coords, 'C2', 'C1', 'C3');

    assert.equal(result.supported, true);
    assert.ok(
      Math.abs(mixedBend - ((Math.PI * 2) / 3)) < 1e-6,
      `expected mixed placement to keep the cyclopropyl-adjacent tail at 120 degrees, got ${((mixedBend * 180) / Math.PI).toFixed(2)} degrees`
    );
    assert.equal(pipelineResult.metadata.audit.ok, true);
    assert.ok(
      Math.abs(pipelineBend - ((Math.PI * 2) / 3)) < 1e-6,
      `expected the full pipeline to keep the cyclopropyl-adjacent tail at 120 degrees, got ${((pipelineBend * 180) / Math.PI).toFixed(2)} degrees`
    );
  });

  it('keeps the reported ethylamino ring substituent on alternating zigzag slots', () => {
    const smiles = 'CCNC1CN2C(C)=NC(C)C2(CCN)C1O';
    const graph = createLayoutGraph(parseSMILES(smiles), { suppressH: true });
    const component = graph.components[0];
    const mixedResult = layoutMixedFamily(graph, component, buildAdjacency(graph, new Set(component.atomIds)), buildScaffoldPlan(graph, component), graph.options.bondLength);
    const pipelineResult = runPipeline(parseSMILES(smiles), {
      suppressH: true,
      auditTelemetry: true
    });

    const assertEthylaminoZigzag = (coords, label) => {
      const firstVector = sub(coords.get('N3'), coords.get('C4'));
      const secondVector = sub(coords.get('C2'), coords.get('N3'));
      const thirdVector = sub(coords.get('C1'), coords.get('C2'));
      const firstTurn = firstVector.x * secondVector.y - firstVector.y * secondVector.x;
      const secondTurn = secondVector.x * thirdVector.y - secondVector.y * thirdVector.x;
      const amineBend = bondAngleAtAtom(coords, 'N3', 'C4', 'C2');
      const ethylBend = bondAngleAtAtom(coords, 'C2', 'N3', 'C1');
      const bridgeTailFirstVector = sub(coords.get('C13'), coords.get('C12'));
      const bridgeTailSecondVector = sub(coords.get('C14'), coords.get('C13'));
      const bridgeTailThirdVector = sub(coords.get('N15'), coords.get('C14'));
      const bridgeTailFirstTurn = bridgeTailFirstVector.x * bridgeTailSecondVector.y - bridgeTailFirstVector.y * bridgeTailSecondVector.x;
      const bridgeTailSecondTurn = bridgeTailSecondVector.x * bridgeTailThirdVector.y - bridgeTailSecondVector.y * bridgeTailThirdVector.x;
      const bridgeTailBend = bondAngleAtAtom(coords, 'C13', 'C12', 'C14');
      const bridgeTailAmineBend = bondAngleAtAtom(coords, 'C14', 'C13', 'N15');

      assert.ok(
        Math.abs(amineBend - ((2 * Math.PI) / 3)) < 1e-6,
        `expected ${label} C4-N3-C2 to stay at 120 degrees, got ${((amineBend * 180) / Math.PI).toFixed(2)}`
      );
      assert.ok(
        Math.abs(ethylBend - ((2 * Math.PI) / 3)) < 1e-6,
        `expected ${label} N3-C2-C1 to stay at 120 degrees, got ${((ethylBend * 180) / Math.PI).toFixed(2)}`
      );
      assert.ok(
        Math.sign(firstTurn) === -Math.sign(secondTurn)
        && Math.abs(firstTurn) > 0.2
        && Math.abs(secondTurn) > 0.2,
        `expected ${label} C4-N3-C2-C1 to alternate turns instead of placing the ethylamino chain straight`
      );
      assert.ok(
        bridgeTailBend <= ((5 * Math.PI) / 6) + 1e-6,
        `expected ${label} C12-C13-C14 to bend into a zigzag instead of staying straight, got ${((bridgeTailBend * 180) / Math.PI).toFixed(2)}`
      );
      assert.ok(
        Math.abs(bridgeTailAmineBend - ((2 * Math.PI) / 3)) < 1e-6,
        `expected ${label} C13-C14-N15 to stay at 120 degrees, got ${((bridgeTailAmineBend * 180) / Math.PI).toFixed(2)}`
      );
      assert.ok(
        Math.sign(bridgeTailFirstTurn) === -Math.sign(bridgeTailSecondTurn)
        && Math.abs(bridgeTailFirstTurn) > 0.2
        && Math.abs(bridgeTailSecondTurn) > 0.2,
        `expected ${label} C12-C13-C14-N15 to alternate turns instead of placing the aminoethyl chain straight`
      );
    };

    assert.equal(mixedResult.supported, true);
    assertEthylaminoZigzag(mixedResult.coords, 'mixed layout');
    assertEthylaminoZigzag(pipelineResult.coords, 'pipeline layout');
    assert.equal(pipelineResult.metadata.audit.ok, true);
  });

  it('keeps uncrowded propylcyclohexane tails on the primary alternating zigzag slot when both zigzag candidates are open', () => {
    const graph = createLayoutGraph(parseSMILES('CCCC1CCCCC1'), { suppressH: true });
    const component = graph.components[0];
    const result = layoutMixedFamily(graph, component, buildAdjacency(graph, new Set(component.atomIds)), buildScaffoldPlan(graph, component), graph.options.bondLength);
    const anchorPosition = result.coords.get('C2');
    const parentPosition = result.coords.get('C3');
    const parentContextPosition = result.coords.get('C4');
    const childPosition = result.coords.get('C1');
    const previousVector = sub(parentPosition, parentContextPosition);
    const incomingVector = sub(anchorPosition, parentPosition);
    const previousTurn = Math.sign((previousVector.x * incomingVector.y) - (previousVector.y * incomingVector.x));
    const forwardAngle = angleOf(incomingVector);
    const candidateAngles = [forwardAngle + (Math.PI / 3), forwardAngle - (Math.PI / 3)];
    const alternatingCandidateAngle = candidateAngles.find(candidateAngle => {
      const candidateVector = fromAngle(candidateAngle, 1);
      const candidateTurn = Math.sign((incomingVector.x * candidateVector.y) - (incomingVector.y * candidateVector.x));
      return candidateTurn === -previousTurn;
    });
    const mirroredCandidateAngle = candidateAngles.find(candidateAngle => candidateAngle !== alternatingCandidateAngle);
    const alternatingCandidatePosition = add(anchorPosition, fromAngle(alternatingCandidateAngle, graph.options.bondLength));
    const mirroredCandidatePosition = add(anchorPosition, fromAngle(mirroredCandidateAngle, graph.options.bondLength));

    assert.equal(result.supported, true);
    assert.ok(
      distance(childPosition, alternatingCandidatePosition) < 1e-6,
      'expected the uncrowded tail to stay on the primary alternating zigzag slot when that preferred slot is already open'
    );
    assert.ok(
      distance(childPosition, mirroredCandidatePosition) > 1e-3,
      'expected the mirrored zigzag slot to stay a fallback instead of displacing the primary uncrowded zigzag preference'
    );
  });

  it('prefers the alkyl-tail continuation slot that extends away from the placed scaffold context', () => {
    const graph = createLayoutGraph(parseSMILES('CC(C)CCCC(C)C1CCC2C3C(CC=C4C3(CCC5C4CCC(C5)O)C)CC2C1C(=O)OC'), {
      suppressH: true
    });
    const component = graph.components[0];
    const result = layoutMixedFamily(graph, component, buildAdjacency(graph, new Set(component.atomIds)), buildScaffoldPlan(graph, component), graph.options.bondLength);
    const anchorPosition = result.coords.get('C4');
    const parentPosition = result.coords.get('C5');
    const parentContextPosition = result.coords.get('C6');
    const childPosition = result.coords.get('C2');
    const forwardAngle = angleOf(sub(anchorPosition, parentPosition));
    const candidatePositions = [
      add(anchorPosition, fromAngle(forwardAngle + (Math.PI / 3), graph.options.bondLength)),
      add(anchorPosition, fromAngle(forwardAngle - (Math.PI / 3), graph.options.bondLength))
    ];
    const bestExtensionDistance = Math.max(...candidatePositions.map(candidatePosition => distance(candidatePosition, parentContextPosition)));

    assert.equal(result.supported, true);
    assert.ok(
      Math.abs(distance(childPosition, parentContextPosition) - bestExtensionDistance) < 1e-6,
      'expected the interior alkyl-tail continuation to take the slot that extends farther away from the placed parent-side scaffold context'
    );
  });

  it('keeps ring-adjacent bulky alkyl branch points trigonal while clearing aryl-substituent clashes', () => {
    const smiles = 'CCC(C(C)C)C1=C(O)C(C(CC)C(C)C)=C(C(CC)C(C)C)C(O)=C1C(CC)C(C)C';
    const pipelineResult = runPipeline(parseSMILES(smiles), {
      suppressH: true,
      auditTelemetry: true,
      finalLandscapeOrientation: true
    });
    const graph = pipelineResult.layoutGraph;
    const adjacency = buildAdjacency(graph, new Set(graph.components[0].atomIds));
    const exactFanAtomIds = ['C3', 'C4', 'C7', 'C26', 'C27'];
    const readability = measureRingSubstituentReadability(graph, pipelineResult.coords);

    assert.equal(pipelineResult.metadata.audit.ok, true);
    for (const atomId of exactFanAtomIds) {
      const separations = sortedHeavyNeighborSeparations(adjacency, pipelineResult.coords, atomId, graph);
      assert.equal(separations.length, 3);
      for (const separation of separations) {
        assert.ok(
          Math.abs(separation - ((2 * Math.PI) / 3)) < 1e-6,
          `expected ${atomId} to keep a 120-degree heavy-atom fan, got ${((separation * 180) / Math.PI).toFixed(2)}`
        );
      }
    }
    assert.ok(
      readability.maxOutwardDeviation <= 1e-6,
      `expected aryl exits to remain exact, got ${((readability.maxOutwardDeviation * 180) / Math.PI).toFixed(2)} degrees`
    );
  });

  it('lays out fused mixed scaffolds with long perfluoroalkyl tails without stalling branch placement', () => {
    const graph = createLayoutGraph(parseSMILES('FC(F)(F)c1cc(nc2N=CN(Cc3cn(CCC(F)(F)C(F)(F)C(F)(F)C(F)(F)C(F)(F)C(F)(F)C(F)(F)C(F)(F)F)nn3)C(=O)c12)c4ccccc4'), {
      suppressH: true
    });
    const component = graph.components[0];
    const plan = buildScaffoldPlan(graph, component);
    const start = Date.now();
    const result = layoutMixedFamily(graph, component, buildAdjacency(graph, new Set(component.atomIds)), plan, graph.options.bondLength);
    const elapsed = Date.now() - start;

    assert.equal(result.family, 'mixed');
    assert.equal(result.supported, true);
    assert.equal(result.coords.size, component.atomIds.length);
    assert.ok(
      elapsed < MIXED_BRANCH_STRESS_TIMEOUT_MS,
      `expected the mixed perfluoroalkyl layout to stay below the branch-search budget on the full-suite host, got ${elapsed}ms`
    );
  });

  it('lays out nucleotide-like fused mixed scaffolds without timing out in branch placement', () => {
    const graph = createLayoutGraph(
      parseSMILES('C[C@](O)(CC(O)=O)CC(=O)SCCNC(=O)CCNC(=O)[C@H](O)C(C)(C)COP(O)(=O)OP(O)(=O)OC[C@H]1O[C@H]([C@H](O)[C@@H]1OP(O)(O)=O)N1C=NC2=C(N)N=CN=C12'),
      { suppressH: true }
    );
    const component = graph.components[0];
    const plan = buildScaffoldPlan(graph, component);
    const start = Date.now();
    const result = layoutMixedFamily(graph, component, buildAdjacency(graph, new Set(component.atomIds)), plan, graph.options.bondLength);
    const elapsed = Date.now() - start;

    assert.equal(result.family, 'mixed');
    assert.equal(result.supported, true);
    assert.equal(result.coords.size, result.atomIds.length);
    assert.ok(
      elapsed < MIXED_BRANCH_STRESS_TIMEOUT_MS,
      `expected the mixed nucleotide layout to stay comfortably below the stress-test budget, got ${elapsed}ms`
    );
  });

  it('lays out peptide-like isolated-ring mixed scaffolds without stalling local branch scoring', () => {
    const graph = createLayoutGraph(
      parseSMILES('CC(C)C[C@H](NC(=O)[C@@H](NC(=O)[C@H](Cc1ccccc1)NC(=O)C)[C@@H](C)O)C(=O)N[C@@H](CC(=O)O)C(=O)N[C@@H](C)C(=O)N[C@@H](CC(=O)O)C(=O)N[C@@H](Cc2ccccc2)C(=O)O'),
      { suppressH: true }
    );
    const component = graph.components[0];
    const plan = buildScaffoldPlan(graph, component);
    const start = Date.now();
    const result = layoutMixedFamily(graph, component, buildAdjacency(graph, new Set(component.atomIds)), plan, graph.options.bondLength);
    const elapsed = Date.now() - start;

    assert.equal(result.family, 'mixed');
    assert.equal(result.supported, true);
    assert.equal(result.coords.size, result.atomIds.length);
    assert.ok(
      elapsed < MIXED_BRANCH_STRESS_TIMEOUT_MS,
      `expected the mixed peptide layout to stay below the exploratory branch-search budget on the full-suite host, got ${elapsed}ms`
    );
  });

  it('lays out the stress-test peptide outlier without stalling sibling permutation scoring', () => {
    const graph = createLayoutGraph(
      parseSMILES('CNCC(=O)N[C@@H](CCCN=C(N)N)C(=O)N[C@@H](C(C)C)C(=O)N[C@@H](Cc1ccc(S)cc1)C(=O)N[C@@H](C(C)C)C(=O)N[C@@H](Cc2c[nH]cn2)C(=O)N3CCC[C@@H]3C(=O)N[C@@H](Cc4ccccc4)C(=O)O'),
      { suppressH: true }
    );
    const component = graph.components[0];
    const plan = buildScaffoldPlan(graph, component);
    const start = Date.now();
    const result = layoutMixedFamily(graph, component, buildAdjacency(graph, new Set(component.atomIds)), plan, graph.options.bondLength);
    const elapsed = Date.now() - start;

    assert.equal(result.family, 'mixed');
    assert.equal(result.supported, true);
    assert.equal(result.coords.size, result.atomIds.length);
    assert.ok(
      elapsed < MIXED_BRANCH_STRESS_TIMEOUT_MS,
      `expected the mixed peptide outlier to stay below the local branch-search budget on the full-suite host, got ${elapsed}ms`
    );
  });

  it('rescues compact bridged mixed roots with a fused fallback when the KK placement is bond-dirty', () => {
    const graph = createLayoutGraph(
      parseSMILES('OC(=O)[C@@]12CC3CC(C1)[C@H](Oc4ccc(cc4)C(=O)NCCNC(=O)c5ccc(cc5)c6ccccc6)C(C3)C2'),
      { suppressH: true }
    );
    const component = graph.components[0];
    const plan = buildScaffoldPlan(graph, component);
    const result = layoutMixedFamily(graph, component, buildAdjacency(graph, new Set(component.atomIds)), plan, graph.options.bondLength);
    const audit = auditLayout(graph, result.coords, {
      bondLength: graph.options.bondLength,
      bondValidationClasses: result.bondValidationClasses
    });

    assert.equal(plan.rootScaffold.family, 'bridged');
    assert.equal(result.family, 'mixed');
    assert.equal(result.supported, true);
    assert.equal(audit.bondLengthFailureCount, 0);
    assert.equal(audit.severeOverlapCount, 0);
    assert.ok(audit.maxBondLengthDeviation < 0.35);
  });

  it('rescues fused-plus-spiro bridged hybrids by laying out fused blocks before spiro attachment', () => {
    const graph = createLayoutGraph(
      parseSMILES('COC(=O)c1cc2c([nH]1)C(=O)C=C3N(C[C@H]4C[C@@]234)C(=O)c5cc6c([nH]5)C(=O)C=C7N(C[C@H]8C[C@@]678)C(=O)OC(C)(C)C'),
      { suppressH: true }
    );
    const component = graph.components[0];
    const plan = buildScaffoldPlan(graph, component);
    const result = layoutMixedFamily(graph, component, buildAdjacency(graph, new Set(component.atomIds)), plan, graph.options.bondLength);
    const audit = auditLayout(graph, result.coords, {
      bondLength: graph.options.bondLength,
      bondValidationClasses: result.bondValidationClasses
    });

    assert.equal(plan.rootScaffold.family, 'bridged');
    assert.equal(result.family, 'mixed');
    assert.equal(result.supported, true);
    assert.equal(audit.bondLengthFailureCount, 0);
    assert.equal(audit.severeOverlapCount, 0);
    assert.ok(audit.maxBondLengthDeviation < 1e-6);
  });

  it('rescues bridged-plus-fused hybrids by aligning fused blocks across the bridged shared-atom set', () => {
    const graph = createLayoutGraph(
      parseSMILES('CC12CC1CC1=CC(CCC(C)(C)C2)=CS1'),
      { suppressH: true }
    );
    const component = graph.components[0];
    const plan = buildScaffoldPlan(graph, component);
    const result = layoutMixedFamily(graph, component, buildAdjacency(graph, new Set(component.atomIds)), plan, graph.options.bondLength);
    const audit = auditLayout(graph, result.coords, {
      bondLength: graph.options.bondLength,
      bondValidationClasses: result.bondValidationClasses
    });

    assert.equal(plan.rootScaffold.family, 'bridged');
    assert.equal(result.family, 'mixed');
    assert.equal(result.supported, true);
    assert.equal(audit.severeOverlapCount, 0);
    assert.ok(audit.bondLengthFailureCount <= 5);
    assert.ok(audit.maxBondLengthDeviation < 0.3);
  });

  it('places separated bridged child arcs inside fused cyclohexane parents without anchor overlap', () => {
    const smiles = 'CCC1CC2[NH2+]CC1C1=CC(C)=CC=C21';
    const graph = createLayoutGraph(parseSMILES(smiles), { suppressH: true });
    const component = graph.components[0];
    const plan = buildScaffoldPlan(graph, component);
    const result = layoutMixedFamily(graph, component, buildAdjacency(graph, new Set(component.atomIds)), plan, graph.options.bondLength);
    const audit = auditLayout(graph, result.coords, {
      bondLength: graph.options.bondLength,
      bondValidationClasses: result.bondValidationClasses
    });
    const cyclohexaneRing = graph.rings[1];
    const cyclohexanePolygon = cyclohexaneRing.atomIds.map(atomId => result.coords.get(atomId));
    const pipelineResult = runPipeline(parseSMILES(smiles), {
      suppressH: true,
      auditTelemetry: true
    });
    const pipelineCyclohexaneRing = pipelineResult.layoutGraph.rings[1];
    const pipelineCyclohexanePolygon = pipelineCyclohexaneRing.atomIds.map(atomId => pipelineResult.coords.get(atomId));

    assert.equal(plan.rootScaffold.family, 'bridged');
    assert.equal(result.supported, true);
    assert.equal(audit.ok, true);
    assert.equal(pointInPolygon(result.coords.get('N6'), cyclohexanePolygon), true);
    assert.equal(pointInPolygon(result.coords.get('C8'), cyclohexanePolygon), true);
    assert.ok(distance(result.coords.get('N6'), result.coords.get('C4')) > graph.options.bondLength * 0.55);
    assert.ok(distance(result.coords.get('C8'), result.coords.get('C3')) > graph.options.bondLength * 0.55);
    assert.equal(pipelineResult.metadata.audit.ok, true);
    assert.equal(pointInPolygon(pipelineResult.coords.get('N6'), pipelineCyclohexanePolygon), true);
    assert.equal(pointInPolygon(pipelineResult.coords.get('C8'), pipelineCyclohexanePolygon), true);
  });

  it('keeps a bridgehead ethyl chain outside the fused ring while relieving adjacent methyl leaves', () => {
    const smiles = 'CCC12CCCC3=C1C(CC[NH2+]C2(C)C)=CO3';
    const result = runPipeline(parseSMILES(smiles), {
      suppressH: true,
      auditTelemetry: true
    });
    const graph = result.layoutGraph;
    const c2Position = result.coords.get('C2');
    const incidentC3Rings = graph.atomToRings.get('C3') ?? [];
    const c3RingNeighborIds = ['C8', 'C14', 'C4'];
    const c3ExitAngle = angleOf(sub(c2Position, result.coords.get('C3')));
    const minRingBondSeparation = Math.min(
      ...c3RingNeighborIds.map(neighborAtomId =>
        angularDifference(c3ExitAngle, angleOf(sub(result.coords.get(neighborAtomId), result.coords.get('C3'))))
      )
    );

    assert.equal(result.metadata.audit.ok, true);
    for (const ring of incidentC3Rings) {
      assert.equal(
        pointInPolygon(c2Position, ring.atomIds.map(atomId => result.coords.get(atomId))),
        false
      );
    }
    assert.ok(minRingBondSeparation > Math.PI / 6, `expected C3 ethyl exit to clear ring bonds, got ${(minRingBondSeparation * 180 / Math.PI).toFixed(2)} degrees`);
  });

  it('keeps an ethynyl substituent pointing outward and linear from the ring', () => {
    const graph = createLayoutGraph(makePhenylacetylene());
    const component = graph.components[0];
    const plan = buildScaffoldPlan(graph, component);
    const result = layoutMixedFamily(graph, component, buildAdjacency(graph, new Set(component.atomIds)), plan, graph.options.bondLength);
    const ringAnchor = result.coords.get('a0');
    const ringNeighborCenter = centroid([result.coords.get('a1'), result.coords.get('a5')]);
    const outward = sub(ringAnchor, ringNeighborCenter);
    const firstBond = sub(result.coords.get('a6'), ringAnchor);
    const secondBond = sub(result.coords.get('a7'), result.coords.get('a6'));
    const outwardDot = outward.x * firstBond.x + outward.y * firstBond.y;
    const chainCross = firstBond.x * secondBond.y - firstBond.y * secondBond.x;
    const chainDot = firstBond.x * secondBond.x + firstBond.y * secondBond.y;

    assert.equal(result.supported, true);
    assert.ok(outwardDot > 0.5);
    assert.ok(Math.abs(chainCross) < 1e-6);
    assert.ok(chainDot > 0);
  });

  it('keeps a single-attached benzene root oriented so the outgoing heavy substituent reads horizontally', () => {
    const graph = createLayoutGraph(parseSMILES('C1=CC=C(C=C1)C2(C3CC3)C(=O)NC(=O)N2'), { suppressH: true });
    const component = graph.components[0];
    const plan = buildScaffoldPlan(graph, component);
    const result = layoutMixedFamily(graph, component, buildAdjacency(graph, new Set(component.atomIds)), plan, graph.options.bondLength);
    const benzene = graph.rings.find(ring => ring.aromatic && ring.atomIds.length === 6);
    const benzeneAtomIdSet = new Set(benzene?.atomIds ?? []);
    const anchorAtomId = benzene?.atomIds.find(atomId => {
      const atom = graph.sourceMolecule.atoms.get(atomId);
      if (!atom) {
        return false;
      }
      return atom.getNeighbors(graph.sourceMolecule).some(neighborAtom => neighborAtom && neighborAtom.name !== 'H' && !benzeneAtomIdSet.has(neighborAtom.id));
    });
    const anchorPosition = anchorAtomId ? result.coords.get(anchorAtomId) : null;
    const childAtomId = anchorAtomId
      ? graph.sourceMolecule.atoms
          .get(anchorAtomId)
          ?.getNeighbors(graph.sourceMolecule)
          .find(neighborAtom => neighborAtom && neighborAtom.name !== 'H' && !benzeneAtomIdSet.has(neighborAtom.id))?.id
      : null;
    const childPosition = childAtomId ? result.coords.get(childAtomId) : null;
    const outgoingAngle = anchorPosition && childPosition ? angleOf(sub(childPosition, anchorPosition)) : null;
    const horizontalDeviation = outgoingAngle == null ? Number.POSITIVE_INFINITY : Math.min(angularDifference(outgoingAngle, 0), angularDifference(outgoingAngle, Math.PI));

    assert.equal(result.supported, true);
    assert.ok(anchorAtomId, 'expected a monosubstituted benzene anchor');
    assert.ok(childAtomId, 'expected a heavy substituent attached to the benzene anchor');
    assert.ok(horizontalDeviation < 0.2, `expected the benzene substituent bond to read nearly horizontal, got ${horizontalDeviation.toFixed(3)} rad`);
  });

  it('keeps reported ester alkoxy oxygens on the strict 120-degree continuation angle', () => {
    const graph = createLayoutGraph(parseSMILES('COC(=O)C1=NC=C(S1)C(C)=O'), { suppressH: true });
    const component = graph.components[0];
    const plan = buildScaffoldPlan(graph, component);
    const result = layoutMixedFamily(graph, component, buildAdjacency(graph, new Set(component.atomIds)), plan, graph.options.bondLength);
    const alkoxyAngle = bondAngleAtAtom(result.coords, 'O2', 'C1', 'C3');

    assert.equal(result.supported, true);
    assert.ok(Math.abs(alkoxyAngle - (2 * Math.PI) / 3) < 0.05, `expected ester alkoxy angle near 120 degrees, got ${((alkoxyAngle * 180) / Math.PI).toFixed(2)}`);
  });

  it('keeps a reported carboxylate oxygen clear of a neighboring cyclohexane ring', () => {
    const smiles = 'CCC(N(C(=O)C1CCC(C)CC1)C1=C(CC(=C1)C#CC(C)(C)C)C([O-])=O)C(=O)N1CCCC1';
    const result = runPipeline(parseSMILES(smiles), {
      suppressH: true,
      auditTelemetry: true,
      finalLandscapeOrientation: true
    });
    const graph = result.layoutGraph;
    const audit = auditLayout(graph, result.coords, { bondLength: graph.options.bondLength });
    const cyclohexaneRingAtomIds = ['C7', 'C8', 'C9', 'C10', 'C12', 'C13'];
    const carboxylateClearance = Math.min(
      ...cyclohexaneRingAtomIds.map(atomId => distance(result.coords.get('O26'), result.coords.get(atomId)))
    );
    const carboxylateInsideCyclohexane = pointInPolygon(
      result.coords.get('O26'),
      cyclohexaneRingAtomIds.map(atomId => result.coords.get(atomId))
    );
    const ringExitAngle = bondAngleAtAtom(result.coords, 'C5', 'N4', 'C7');
    const carboxylateAngle = bondAngleAtAtom(result.coords, 'C25', 'C15', 'O26');

    assert.equal(audit.ok, true);
    assert.equal(carboxylateInsideCyclohexane, false);
    assert.ok(
      carboxylateClearance > graph.options.bondLength * 0.75,
      `expected O26 to stay clear of the neighboring cyclohexane ring, got ${carboxylateClearance.toFixed(3)}`
    );
    assert.ok(Math.abs(ringExitAngle - (2 * Math.PI) / 3) < Math.PI / 18, `expected C5 ring exit near 120 degrees, got ${((ringExitAngle * 180) / Math.PI).toFixed(2)}`);
    assert.ok(Math.abs(carboxylateAngle - (2 * Math.PI) / 3) < 1e-6, `expected C25 carboxylate fan to stay exact, got ${((carboxylateAngle * 180) / Math.PI).toFixed(2)}`);
  });

  it('keeps a fused-ring methyl substituent outside the ring system', () => {
    const graph = createLayoutGraph(makeMethylnaphthalene());
    const component = graph.components[0];
    const plan = buildScaffoldPlan(graph, component);
    const result = layoutMixedFamily(graph, component, buildAdjacency(graph, new Set(component.atomIds)), plan, graph.options.bondLength);
    const ringCenter = centroid(['a0', 'a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7', 'a8', 'a9'].map(atomId => result.coords.get(atomId)));
    const outward = sub(result.coords.get('a0'), ringCenter);
    const methylBond = sub(result.coords.get('a10'), result.coords.get('a0'));
    const outwardDot = outward.x * methylBond.x + outward.y * methylBond.y;

    assert.equal(result.supported, true);
    assert.ok(outwardDot > 0.5);
  });

  it('places the reported sulfur-ring fused methyl substituents on the exact local outward axis', () => {
    const graph = createLayoutGraph(parseSMILES('CC1=CSC2=C1C1=C(CNCC(=O)C1)C=C2C'), { suppressH: true });
    const component = graph.components[0];
    const plan = buildScaffoldPlan(graph, component);
    const result = layoutMixedFamily(graph, component, buildAdjacency(graph, new Set(component.atomIds)), plan, graph.options.bondLength);
    const checkedAnchors = [];

    for (const atomId of component.atomIds) {
      if ((graph.atomToRings.get(atomId)?.length ?? 0) === 0) {
        continue;
      }
      const atom = graph.sourceMolecule.atoms.get(atomId);
      const terminalCarbonLeafChildren = atom
        ?.getNeighbors(graph.sourceMolecule)
        .filter(neighborAtom =>
          neighborAtom
          && neighborAtom.name === 'C'
          && (graph.atomToRings.get(neighborAtom.id)?.length ?? 0) === 0
          && (graph.atoms.get(neighborAtom.id)?.heavyDegree ?? 0) === 1
        )
        .map(neighborAtom => neighborAtom.id) ?? [];
      if (terminalCarbonLeafChildren.length !== 1) {
        continue;
      }

      const childAngle = angleOf(sub(result.coords.get(terminalCarbonLeafChildren[0]), result.coords.get(atomId)));
      const bestLocalDeviation = Math.min(
        ...graph.rings
          .filter(ring => ring.atomIds.includes(atomId))
          .map(ring => angularDifference(childAngle, angleOf(sub(result.coords.get(atomId), centroid(ring.atomIds.map(ringAtomId => result.coords.get(ringAtomId)))))))
      );
      checkedAnchors.push({ atomId, bestLocalDeviation });
      assert.ok(bestLocalDeviation < 1e-6, `expected ${atomId} terminal methyl to follow the exact local outward angle, got ${bestLocalDeviation.toFixed(6)} rad`);
    }

    assert.equal(result.supported, true);
    assert.equal(checkedAnchors.length, 2, `expected two sulfur-ring methyl anchors, checked ${checkedAnchors.length}`);
  });

  it('keeps the reported morphinan middle cyclohexane exact while preserving the bridgehead methyl slot', () => {
    const smiles = 'CCC(C)(O)CC[C@@H]1[C@H]2Cc3ccc(O)cc3[C@@]1(C)CCN2C.CS(=O)(=O)O';
    const graph = createLayoutGraph(parseSMILES(smiles), { suppressH: true });
    const component = graph.components.find(candidateComponent => candidateComponent.atomIds.includes('C20'));
    assert.ok(component, 'expected the fused-ring component to be present');
    const adjacency = buildAdjacency(graph, new Set(component?.atomIds ?? []));
    const mixedResult = layoutMixedFamily(graph, component, adjacency, buildScaffoldPlan(graph, component), graph.options.bondLength);
    const pipelineResult = runPipeline(parseSMILES(smiles), {
      suppressH: true,
      auditTelemetry: true
    });
    const anchorAtomId = 'C20';
    const childAtomId = 'C21';
    const childAngle = angleOf(sub(mixedResult.coords.get(childAtomId), mixedResult.coords.get(anchorAtomId)));
    const ringNeighborIds = graph.sourceMolecule.atoms.get(anchorAtomId)
      ?.getNeighbors(graph.sourceMolecule)
      .filter(neighborAtom => neighborAtom && neighborAtom.name !== 'H' && neighborAtom.id !== childAtomId && (graph.atomToRings.get(neighborAtom.id)?.length ?? 0) > 0)
      .map(neighborAtom => neighborAtom.id) ?? [];
    const sharedJunctionNeighborId = ringNeighborIds.find(neighborAtomId => sharedRingCount(graph, anchorAtomId, neighborAtomId) > 1);
    const straightJunctionAngle = sharedJunctionNeighborId ? angleOf(sub(mixedResult.coords.get(anchorAtomId), mixedResult.coords.get(sharedJunctionNeighborId))) : null;
    const mixedDeviation = bestLocalRingDeviation(graph, mixedResult.coords, anchorAtomId, childAtomId);
    const pipelineDeviation = bestLocalRingDeviation(pipelineResult.layoutGraph, pipelineResult.coords, anchorAtomId, childAtomId);
    const mixedAudit = auditLayout(graph, mixedResult.coords, {
      bondLength: graph.options.bondLength,
      bondValidationClasses: mixedResult.bondValidationClasses
    });
    let maxPipelineRingBondDeviation = 0;
    let middleCyclohexaneMaxBondDeviation = 0;
    let middleCyclohexaneMaxAngleDeviation = 0;
    let aromaticMaxBondDeviation = 0;
    let aromaticMinBondLength = Number.POSITIVE_INFINITY;
    let aromaticMaxBondLength = 0;
    let aromaticMaxAngleDeviation = 0;
    for (const ring of pipelineResult.layoutGraph.rings) {
      for (let index = 0; index < ring.atomIds.length; index++) {
        const atomId = ring.atomIds[index];
        const previousAtomId = ring.atomIds[(index - 1 + ring.atomIds.length) % ring.atomIds.length];
        const nextAtomId = ring.atomIds[(index + 1) % ring.atomIds.length];
        const ringBondLength = distance(pipelineResult.coords.get(atomId), pipelineResult.coords.get(nextAtomId));
        const ringAngle = (bondAngleAtAtom(pipelineResult.coords, atomId, previousAtomId, nextAtomId) * 180) / Math.PI;
        maxPipelineRingBondDeviation = Math.max(maxPipelineRingBondDeviation, Math.abs(ringBondLength - pipelineResult.layoutGraph.options.bondLength));
        if (ring.atomIds.includes('C20') && ring.atomIds.includes('C12') && ring.atomIds.includes('C13')) {
          middleCyclohexaneMaxBondDeviation = Math.max(
            middleCyclohexaneMaxBondDeviation,
            Math.abs(ringBondLength - pipelineResult.layoutGraph.options.bondLength)
          );
          middleCyclohexaneMaxAngleDeviation = Math.max(middleCyclohexaneMaxAngleDeviation, Math.abs(ringAngle - 120));
        }
        if (ring.aromatic) {
          aromaticMaxBondDeviation = Math.max(aromaticMaxBondDeviation, Math.abs(ringBondLength - pipelineResult.layoutGraph.options.bondLength));
          aromaticMinBondLength = Math.min(aromaticMinBondLength, ringBondLength);
          aromaticMaxBondLength = Math.max(aromaticMaxBondLength, ringBondLength);
          aromaticMaxAngleDeviation = Math.max(aromaticMaxAngleDeviation, Math.abs(ringAngle - 120));
        }
      }
    }

    assert.equal(mixedResult.supported, true);
    assert.notEqual(straightJunctionAngle, null);
    assert.ok(
      angularDifference(childAngle, straightJunctionAngle) < 1e-6,
      `expected the bridgehead methyl to preserve the compact bridge projection slot, got ${angularDifference(childAngle, straightJunctionAngle).toFixed(6)} rad`
    );
    assert.ok(mixedDeviation < 0.9, `expected the bridgehead methyl to stay in the bridgehead exterior sector, got ${mixedDeviation.toFixed(6)} rad`);
    assert.ok(pipelineDeviation < 0.9, `expected the full pipeline to keep the bridgehead methyl in the bridgehead exterior sector, got ${pipelineDeviation.toFixed(6)} rad`);
    assert.ok(maxPipelineRingBondDeviation < 0.15, `expected compact bridged ring bonds to stay near template geometry, got max deviation ${maxPipelineRingBondDeviation.toFixed(3)}`);
    assert.ok(middleCyclohexaneMaxBondDeviation < 1e-6, `expected the morphinan middle cyclohexane bonds to be exact, got max deviation ${middleCyclohexaneMaxBondDeviation.toFixed(6)}`);
    assert.ok(middleCyclohexaneMaxAngleDeviation < 1e-6, `expected the morphinan middle cyclohexane angles to be exact, got max deviation ${middleCyclohexaneMaxAngleDeviation.toFixed(6)} degrees`);
    assert.ok(aromaticMaxBondDeviation < 0.08, `expected the fused benzene bond lengths to stay nearly regular, got max deviation ${aromaticMaxBondDeviation.toFixed(3)}`);
    assert.ok(aromaticMaxBondLength - aromaticMinBondLength < 1e-6, `expected the fused benzene bond lengths to be uniform, got spread ${(aromaticMaxBondLength - aromaticMinBondLength).toFixed(6)}`);
    assert.ok(aromaticMaxAngleDeviation < 1e-6, `expected the fused benzene angles to be exact, got max deviation ${aromaticMaxAngleDeviation.toFixed(6)} degrees`);
    assert.equal(mixedAudit.bondLengthFailureCount, 0);
    assert.equal(pipelineResult.metadata.audit.severeOverlapCount, 0);
    assert.equal(pipelineResult.metadata.audit.bondLengthFailureCount, 0);
    assert.equal(pipelineResult.metadata.audit.ok, true);
  });

  it('keeps the one-carbon morphinan bridge variant from deforming the fused cyclohexane core', () => {
    const smiles = 'CCC(C)(O)CC[C@@H]1[C@H]2Cc3ccc(O)cc3[C@@]1(C)CCCN2C';
    const result = runPipeline(parseSMILES(smiles), {
      suppressH: true,
      auditTelemetry: true
    });
    const middleCyclohexane = result.layoutGraph.rings.find(ring =>
      ring.atomIds.includes('C20') && ring.atomIds.includes('C12') && ring.atomIds.includes('C13')
    );
    const fusedBenzene = result.layoutGraph.rings.find(ring => ring.aromatic && ring.atomIds.includes('C13') && ring.atomIds.includes('C19'));
    const bridgeRing = result.layoutGraph.rings.find(ring => ring.atomIds.includes('N25') && ring.atomIds.includes('C24'));

    assert.ok(middleCyclohexane, 'expected the middle morphinan cyclohexane ring');
    assert.ok(fusedBenzene, 'expected the fused morphinan benzene ring');
    assert.ok(bridgeRing, 'expected the one-carbon bridge ring');

    const ringMetrics = ring => {
      let maxBondDeviation = 0;
      let maxAngleDeviation = 0;
      for (let index = 0; index < ring.atomIds.length; index++) {
        const atomId = ring.atomIds[index];
        const previousAtomId = ring.atomIds[(index - 1 + ring.atomIds.length) % ring.atomIds.length];
        const nextAtomId = ring.atomIds[(index + 1) % ring.atomIds.length];
        const ringBondLength = distance(result.coords.get(atomId), result.coords.get(nextAtomId));
        const ringAngle = (bondAngleAtAtom(result.coords, atomId, previousAtomId, nextAtomId) * 180) / Math.PI;
        maxBondDeviation = Math.max(maxBondDeviation, Math.abs(ringBondLength - result.layoutGraph.options.bondLength));
        maxAngleDeviation = Math.max(maxAngleDeviation, Math.abs(ringAngle - 120));
      }
      return { maxBondDeviation, maxAngleDeviation };
    };
    const middleMetrics = ringMetrics(middleCyclohexane);
    const benzeneMetrics = ringMetrics(fusedBenzene);
    const bridgeMetrics = ringMetrics(bridgeRing);

    assert.equal(result.metadata.audit.ok, true);
    assert.equal(result.metadata.audit.severeOverlapCount, 0);
    assert.equal(result.metadata.audit.bondLengthFailureCount, 0);
    assert.ok(middleMetrics.maxBondDeviation < 1e-6, `expected the middle cyclohexane bonds to be exact, got ${middleMetrics.maxBondDeviation.toFixed(6)}`);
    assert.ok(middleMetrics.maxAngleDeviation < 1e-6, `expected the middle cyclohexane angles to be exact, got ${middleMetrics.maxAngleDeviation.toFixed(6)} degrees`);
    assert.ok(benzeneMetrics.maxBondDeviation < 1e-6, `expected the fused benzene bonds to be exact, got ${benzeneMetrics.maxBondDeviation.toFixed(6)}`);
    assert.ok(benzeneMetrics.maxAngleDeviation < 1e-6, `expected the fused benzene angles to be exact, got ${benzeneMetrics.maxAngleDeviation.toFixed(6)} degrees`);
    assert.ok(bridgeMetrics.maxBondDeviation < 1e-6, `expected the expanded bridge ring bonds to stay exact, got ${bridgeMetrics.maxBondDeviation.toFixed(6)}`);
  });

  it('keeps the long morphinan bridge variant exact without pushing the alcohol tail through the core', () => {
    const smiles = 'CCC(C)(O)CC[C@@H]1[C@H]2Cc3ccc(O)cc3[C@@]1(C)CCCCCCCN2C';
    const result = runPipeline(parseSMILES(smiles), {
      suppressH: true,
      auditTelemetry: true
    });
    const middleCyclohexane = result.layoutGraph.rings.find(ring =>
      ring.atomIds.includes('C20') && ring.atomIds.includes('C12') && ring.atomIds.includes('C13')
    );
    const fusedBenzene = result.layoutGraph.rings.find(ring => ring.aromatic && ring.atomIds.includes('C13') && ring.atomIds.includes('C19'));
    const bridgeRing = result.layoutGraph.rings.find(ring => ring.atomIds.includes('N29') && ring.atomIds.includes('C28'));

    assert.ok(middleCyclohexane, 'expected the middle morphinan cyclohexane ring');
    assert.ok(fusedBenzene, 'expected the fused morphinan benzene ring');
    assert.ok(bridgeRing, 'expected the long morphinan bridge ring');

    const middleMetrics = measureResultRingMetrics(result, middleCyclohexane);
    const benzeneMetrics = measureResultRingMetrics(result, fusedBenzene);
    const bridgeMetrics = measureResultRingMetrics(result, bridgeRing);

    assert.equal(result.metadata.audit.ok, true);
    assert.equal(result.metadata.audit.severeOverlapCount, 0);
    assert.equal(result.metadata.audit.bondLengthFailureCount, 0);
    assert.ok(middleMetrics.maxBondDeviation < 1e-6, `expected the middle cyclohexane bonds to be exact, got ${middleMetrics.maxBondDeviation.toFixed(6)}`);
    assert.ok(middleMetrics.maxAngleDeviation < 1e-6, `expected the middle cyclohexane angles to be exact, got ${middleMetrics.maxAngleDeviation.toFixed(6)} degrees`);
    assert.ok(benzeneMetrics.maxBondDeviation < 1e-6, `expected the fused benzene bonds to be exact, got ${benzeneMetrics.maxBondDeviation.toFixed(6)}`);
    assert.ok(benzeneMetrics.maxAngleDeviation < 1e-6, `expected the fused benzene angles to be exact, got ${benzeneMetrics.maxAngleDeviation.toFixed(6)} degrees`);
    assert.ok(bridgeMetrics.maxBondDeviation < 1e-6, `expected the long bridge ring bonds to stay exact, got ${bridgeMetrics.maxBondDeviation.toFixed(6)}`);
  });

  it('keeps the six-carbon morphinan bridge variant from stretching the middle cyclohexane', () => {
    const smiles = 'CCC(C)(O)CC[C@@H]1[C@H]2Cc3ccc(O)cc3[C@@]1(C)CCCCCCN2C';
    const result = runPipeline(parseSMILES(smiles), {
      suppressH: true,
      auditTelemetry: true
    });
    const middleCyclohexane = result.layoutGraph.rings.find(ring =>
      ring.atomIds.includes('C20') && ring.atomIds.includes('C12') && ring.atomIds.includes('C13')
    );
    const fusedBenzene = result.layoutGraph.rings.find(ring => ring.aromatic && ring.atomIds.includes('C13') && ring.atomIds.includes('C19'));
    const bridgeRing = result.layoutGraph.rings.find(ring => ring.atomIds.includes('N28') && ring.atomIds.includes('C27'));

    assert.ok(middleCyclohexane, 'expected the middle morphinan cyclohexane ring');
    assert.ok(fusedBenzene, 'expected the fused morphinan benzene ring');
    assert.ok(bridgeRing, 'expected the six-carbon morphinan bridge ring');

    const middleMetrics = measureResultRingMetrics(result, middleCyclohexane);
    const benzeneMetrics = measureResultRingMetrics(result, fusedBenzene);
    const bridgeMetrics = measureResultRingMetrics(result, bridgeRing);

    assert.equal(result.metadata.audit.ok, true);
    assert.equal(result.metadata.audit.severeOverlapCount, 0);
    assert.equal(result.metadata.audit.bondLengthFailureCount, 0);
    assert.ok(middleMetrics.maxBondDeviation < 1e-6, `expected the middle cyclohexane bonds to be exact, got ${middleMetrics.maxBondDeviation.toFixed(6)}`);
    assert.ok(middleMetrics.maxAngleDeviation < 1e-6, `expected the middle cyclohexane angles to be exact, got ${middleMetrics.maxAngleDeviation.toFixed(6)} degrees`);
    assert.ok(benzeneMetrics.maxBondDeviation < 1e-6, `expected the fused benzene bonds to be exact, got ${benzeneMetrics.maxBondDeviation.toFixed(6)}`);
    assert.ok(benzeneMetrics.maxAngleDeviation < 1e-6, `expected the fused benzene angles to be exact, got ${benzeneMetrics.maxAngleDeviation.toFixed(6)} degrees`);
    assert.ok(bridgeMetrics.maxBondDeviation < 1e-6, `expected the six-carbon bridge ring bonds to stay exact, got ${bridgeMetrics.maxBondDeviation.toFixed(6)}`);
  });

  it('keeps directly attached cyclohexyl blocks on the local outward ring axis instead of leaving the attachment tangential', () => {
    const smiles = '[H][C@@](CC1CCCCC1)(NC1=NC2=CC=CC=C2O1)C(=O)NCCNC1=CC=C(OC)C=C1';
    const graph = createLayoutGraph(parseSMILES(smiles), { suppressH: true });
    const component = graph.components[0];
    const adjacency = buildAdjacency(graph, new Set(component.atomIds));
    const mixedResult = layoutMixedFamily(graph, component, adjacency, buildScaffoldPlan(graph, component), graph.options.bondLength);
    const pipelineResult = runPipeline(parseSMILES(smiles), {
      suppressH: true,
      auditTelemetry: true
    });
    const anchorAtomId = 'C4';
    const childAtomId = 'C3';
    const mixedDeviation = bestLocalRingDeviation(graph, mixedResult.coords, anchorAtomId, childAtomId);
    const pipelineDeviation = bestLocalRingDeviation(pipelineResult.layoutGraph, pipelineResult.coords, anchorAtomId, childAtomId);

    assert.equal(mixedResult.supported, true);
    assert.ok(mixedDeviation < 1e-6, `expected the cyclohexyl attachment to follow the exact local outward ring axis in mixed placement, got ${mixedDeviation.toFixed(6)} rad`);
    assert.ok(pipelineDeviation < 1e-6, `expected the full pipeline to keep the cyclohexyl attachment on the exact local outward ring axis, got ${pipelineDeviation.toFixed(6)} rad`);
    assert.equal(pipelineResult.metadata.audit.ok, true);
  });

  it('spreads crowded saturated ring branches through the exterior gap instead of pinching them against ring bonds', () => {
    const graph = createLayoutGraph(parseSMILES('CCC1C(C)C(N)(C(C)OC(C)=O)C(N)C1O'), { suppressH: true });
    const component = graph.components[0];
    const adjacency = buildAdjacency(graph, new Set(component.atomIds));
    const plan = buildScaffoldPlan(graph, component);
    const result = layoutMixedFamily(graph, component, adjacency, plan, graph.options.bondLength);
    const audit = auditLayout(graph, result.coords, { bondLength: graph.options.bondLength });
    const ringAtomSet = new Set(graph.ringSystems[0]?.atomIds ?? []);
    const crowdedRingAtomId = component.atomIds.find(atomId => {
      if (!ringAtomSet.has(atomId)) {
        return false;
      }
      const neighbors = graph.sourceMolecule.atoms.get(atomId)?.getNeighbors(graph.sourceMolecule).filter(neighborAtom => neighborAtom && neighborAtom.name !== 'H') ?? [];
      const ringNeighborCount = neighbors.filter(neighborAtom => ringAtomSet.has(neighborAtom.id)).length;
      const exocyclicHeavyCount = neighbors.filter(neighborAtom => !ringAtomSet.has(neighborAtom.id)).length;
      return ringNeighborCount === 2 && exocyclicHeavyCount === 2;
    });

    assert.equal(result.supported, true);
    assert.ok(crowdedRingAtomId, 'expected a saturated ring atom with two exocyclic heavy branches');
    assert.equal(audit.severeOverlapCount, 0);

    const separations = sortedNeighborSeparations(adjacency, result.coords, crowdedRingAtomId);
    assert.equal(separations.length, 4, `expected four placed heavy-neighbor separations at ${crowdedRingAtomId}`);
    assert.ok(separations[0] > 1.3, `expected ${crowdedRingAtomId} to avoid pinched branch gaps, got minimum separation ${((separations[0] * 180) / Math.PI).toFixed(2)} degrees`);
    assert.ok(separations[3] < 2.1, `expected ${crowdedRingAtomId} to avoid a giant exterior branch gap, got maximum separation ${((separations[3] * 180) / Math.PI).toFixed(2)} degrees`);
  });

  it('keeps bulky cyclohexyl methyl leaves outside crowded saturated rings', () => {
    const smiles = 'CC(C)(O)C(=O)C1=CC=C(COC(=O)NCC2(C)CC(CC(C)(C)C2)NC(=O)OCC2=CC=C(C=C2)C(=O)C(C)(C)O)C=C1';
    const result = runPipeline(parseSMILES(smiles), {
      suppressH: true,
      auditTelemetry: true,
      finalLandscapeOrientation: true
    });
    const graph = result.layoutGraph;
    const component = graph.components[0];
    const adjacency = buildAdjacency(graph, new Set(component.atomIds));
    const audit = auditLayout(graph, result.coords, { bondLength: graph.options.bondLength });
    const cyclohexylRing = graph.atomToRings.get('C22')?.[0] ?? null;
    const methylLeafPosition = result.coords.get('C24');
    const esterLinkerOxygenPosition = result.coords.get('O12');
    const minimumMethylClearance = Math.min(
      distance(methylLeafPosition, result.coords.get('C21')),
      distance(methylLeafPosition, result.coords.get('C23')),
      distance(methylLeafPosition, result.coords.get('C25'))
    );
    const separations = sortedNeighborSeparations(adjacency, result.coords, 'C22');

    assert.equal(result.metadata.mixedMode, true);
    assert.equal(audit.ok, true);
    assert.equal(audit.severeOverlapCount, 0);
    assert.ok(cyclohexylRing, 'expected the crowded cyclohexyl ring to be detected');
    assert.equal(
      pointInPolygon(
        methylLeafPosition,
        cyclohexylRing.atomIds.map(atomId => result.coords.get(atomId))
      ),
      false,
      'expected the methyl leaf to stay outside the saturated ring face'
    );
    assert.equal(separations.length, 4, 'expected four placed heavy-neighbor separations at the crowded ring atom');
    assert.ok(
      separations[0] > 1.3,
      `expected the crowded ring atom to avoid pinched methyl gaps, got minimum separation ${((separations[0] * 180) / Math.PI).toFixed(2)} degrees`
    );
    assert.ok(
      minimumMethylClearance > graph.options.bondLength * 1.2,
      `expected the methyl leaf to clear neighboring heavy atoms, got minimum clearance ${minimumMethylClearance.toFixed(3)}`
    );
    assert.ok(
      distance(methylLeafPosition, esterLinkerOxygenPosition) > graph.options.bondLength * 1.4,
      `expected the methyl leaf to clear the ester linker oxygen, got ${distance(methylLeafPosition, esterLinkerOxygenPosition).toFixed(3)}`
    );
  });

  it('restores cyclopropane exterior fans after mixed linker placement adds the second branch', () => {
    const result = runPipeline(parseSMILES('CC1=C(COC2(C)CC2[NH3+])SN=N1'), {
      suppressH: true,
      auditTelemetry: true
    });
    const metrics = exteriorSpreadAnchorMetrics(result, 3);
    const exocyclicSpread = bondAngleAtAtom(result.coords, 'C6', 'O5', 'C7');

    assert.equal(result.metadata.mixedMode, true);
    assert.equal(result.metadata.audit.ok, true);
    assert.ok(metrics, 'expected a cyclopropane atom with two exocyclic heavy branches');
    assert.equal(metrics.anchorAtomId, 'C6');
    assert.ok(
      metrics.maxTargetDeviation < 1e-6,
      `expected C6 exocyclic branches on the exact cyclopropane exterior targets, got max deviation ${((metrics.maxTargetDeviation * 180) / Math.PI).toFixed(2)} degrees`
    );
    assert.ok(
      Math.abs(exocyclicSpread - (5 * Math.PI / 9)) < 1e-6,
      `expected the C6 ether/methyl gap to be 100 degrees, got ${((exocyclicSpread * 180) / Math.PI).toFixed(2)} degrees`
    );
  });

  it('centers direct-attached cyclopropyl roots on fused parent exterior slots', () => {
    const smiles = 'CCN1CC2CC(C2)(C2CC2)C1=O';
    const graph = createLayoutGraph(parseSMILES(smiles), { suppressH: true });
    const component = graph.components[0];
    const plan = buildScaffoldPlan(graph, component);
    const mixedResult = layoutMixedFamily(graph, component, buildAdjacency(graph, new Set(component.atomIds)), plan, graph.options.bondLength);
    const pipelineResult = runPipeline(parseSMILES(smiles), {
      suppressH: true,
      auditTelemetry: true
    });
    const assertCyclopropylRoot = (layoutGraph, coords, bondValidationClasses, label) => {
      const audit = auditLayout(layoutGraph, coords, {
        bondLength: layoutGraph.options.bondLength,
        bondValidationClasses
      });
      const parentDeviation = bestLocalRingDeviation(layoutGraph, coords, 'C7', 'C9');
      const childDeviation = bestLocalRingDeviation(layoutGraph, coords, 'C9', 'C7');
      const parentAngles = [
        bondAngleAtAtom(coords, 'C7', 'C8', 'C9'),
        bondAngleAtAtom(coords, 'C7', 'C9', 'C12'),
        bondAngleAtAtom(coords, 'C7', 'C9', 'C6')
      ];
      const childAngles = [
        bondAngleAtAtom(coords, 'C9', 'C7', 'C10'),
        bondAngleAtAtom(coords, 'C9', 'C7', 'C11')
      ];

      assert.equal(audit.ok, true, `expected ${label} to pass layout audit`);
      assert.ok(parentDeviation < 1e-6, `expected ${label} C7-C9 to follow a fused-parent exterior slot, got ${((parentDeviation * 180) / Math.PI).toFixed(2)} degrees`);
      assert.ok(childDeviation < 1e-6, `expected ${label} C9-C7 to follow the cyclopropyl root outward axis, got ${((childDeviation * 180) / Math.PI).toFixed(2)} degrees`);
      assert.ok(
        Math.max(...parentAngles) <= (5 * Math.PI) / 6 + 1e-6,
        `expected ${label} C7 cyclopropyl exit not to go straight through a ring bond, got ${parentAngles.map(angle => ((angle * 180) / Math.PI).toFixed(2)).join(', ')} degrees`
      );
      for (const angle of childAngles) {
        assert.ok(
          Math.abs(angle - (5 * Math.PI) / 6) < 1e-6,
          `expected ${label} cyclopropyl root angles near 150 degrees, got ${((angle * 180) / Math.PI).toFixed(2)}`
        );
      }
    };

    assert.equal(mixedResult.supported, true);
    assertCyclopropylRoot(graph, mixedResult.coords, mixedResult.bondValidationClasses, 'mixed layout');
    assertCyclopropylRoot(pipelineResult.layoutGraph, pipelineResult.coords, pipelineResult.bondValidationClasses, 'pipeline layout');
  });

  it('backs off saturated-ring exterior fan restoration when the exact linked-ring slot would overlap', () => {
    const result = runPipeline(parseSMILES('CC1=CC(CC2(CN3C=CN=C3)OCC(C)(C)CO2)=CC(C)=C1'), {
      suppressH: true,
      auditTelemetry: true,
      finalLandscapeOrientation: true
    });
    const audit = auditLayout(result.layoutGraph, result.coords, { bondLength: result.layoutGraph.options.bondLength });
    const exocyclicSpread = bondAngleAtAtom(result.coords, 'C6', 'C7', 'C5');
    const linkerBend = bondAngleAtAtom(result.coords, 'C7', 'C6', 'N8');
    const exteriorPenalty = measureSmallRingExteriorGapSpreadPenalty(result.layoutGraph, result.coords, 'C6');

    assert.equal(result.metadata.mixedMode, true);
    assert.equal(audit.ok, true);
    assert.ok(
      exocyclicSpread > 1.3,
      `expected the saturated ring's two exocyclic branches to avoid a pinched linked-ring angle, got ${((exocyclicSpread * 180) / Math.PI).toFixed(2)} degrees`
    );
    assert.ok(
      exteriorPenalty < 1e-3,
      `expected the linked-ring fan to stay close to the saturated-ring exterior slots, got penalty ${exteriorPenalty.toExponential(3)}`
    );
    assert.ok(
      Math.abs(linkerBend - (2 * Math.PI) / 3) < 1e-6,
      `expected the moved linker root to preserve a 120-degree bend, got ${((linkerBend * 180) / Math.PI).toFixed(2)} degrees`
    );
  });

  it('lets saturated-ring exterior fans trade symmetry for a clean benzylic linker bend', () => {
    const smiles = 'N[C@@H](O)O[C@H]1CC2=CC=CC=C2C1[C@H]1CN[C@](<C[C@@H](O)[C@@H](CC2=CC=CC=C2)NC(=O)O[C@@H]2CCOC2>)(CC2=CC=CC=C2)C1=O';
    const graph = createLayoutGraph(parseSMILES(smiles), { suppressH: true });
    const component = graph.components[0];
    const mixedResult = layoutMixedFamily(
      graph,
      component,
      buildAdjacency(graph, new Set(component.atomIds)),
      buildScaffoldPlan(graph, component),
      graph.options.bondLength
    );
    const pipelineResult = runPipeline(parseSMILES(smiles), {
      suppressH: true,
      auditTelemetry: true
    });

    const assertLinkerBend = (layoutGraph, coords, label) => {
      const audit = auditLayout(layoutGraph, coords, { bondLength: layoutGraph.options.bondLength });
      const linkerBend = bondAngleAtAtom(coords, 'C44', 'C20', 'C45');
      const exteriorPenalty = measureSmallRingExteriorGapSpreadPenalty(layoutGraph, coords, 'C20');

      assert.equal(audit.ok, true, `expected ${label} to pass layout audit`);
      assert.ok(
        Math.abs(linkerBend - (2 * Math.PI) / 3) < 1e-6,
        `expected ${label} C20-C44-C45 to stay at 120 degrees, got ${((linkerBend * 180) / Math.PI).toFixed(2)}`
      );
      assert.ok(
        exteriorPenalty < 0.35,
        `expected ${label} saturated-ring exterior tradeoff to stay bounded, got penalty ${exteriorPenalty.toFixed(3)}`
      );
    };

    assert.equal(mixedResult.supported, true);
    assertLinkerBend(graph, mixedResult.coords, 'mixed layout');
    assertLinkerBend(pipelineResult.layoutGraph, pipelineResult.coords, 'pipeline layout');
    assert.equal(pipelineResult.metadata.audit.ok, true);
  });

  it('moves larger late-grown cyclobutane branches onto the exact exterior slot when they crowd an aryl ring', () => {
    const smiles = 'NC1=NC=C(C=N1)C1=CC=C(C=C1)C1(CCC1)C(=N)N=C(O)C1=CC=C(N=C1)N1CC[NH2+]CC1';
    const result = runPipeline(parseSMILES(smiles), {
      suppressH: true,
      auditTelemetry: true,
      finalLandscapeOrientation: true
    });
    const graph = result.layoutGraph;
    const adjacency = buildAdjacency(graph, new Set(graph.components[0].atomIds));
    const exteriorPenalty = measureSmallRingExteriorGapSpreadPenalty(graph, result.coords, 'C14');
    const separations = sortedHeavyNeighborSeparations(adjacency, result.coords, 'C14', graph);
    const imineNitrogenClearance = distance(result.coords.get('N19'), result.coords.get('C10'));

    assert.equal(result.metadata.audit.ok, true);
    assert.ok(
      exteriorPenalty < 1e-9,
      `expected the cyclobutane quaternary branch fan to land on exact exterior slots, got penalty ${exteriorPenalty.toExponential(3)}`
    );
    assert.ok(
      separations.every(separation => Math.abs(separation - Math.PI / 2) < 1e-6),
      `expected the C14 heavy branches to occupy four exterior quadrants, got ${separations.map(separation => ((separation * 180) / Math.PI).toFixed(2)).join(', ')} degrees`
    );
    assert.ok(
      imineNitrogenClearance > graph.options.bondLength * 0.75,
      `expected the terminal imine nitrogen to clear the aryl ring, got ${imineNitrogenClearance.toFixed(3)}`
    );
  });

  it('rotates a crowded nitrile-bearing quaternary branch into a clean tetrahedral slot so the nitrile stays linear', () => {
    const graph = createLayoutGraph(parseSMILES('CC(CC1CC(N)C(=N)NC1=N)C(C)(N)C#N'), { suppressH: true });
    const component = graph.components[0];
    const adjacency = buildAdjacency(graph, new Set(component.atomIds));
    const plan = buildScaffoldPlan(graph, component);
    const result = layoutMixedFamily(graph, component, adjacency, plan, graph.options.bondLength);
    const separations = sortedNeighborSeparations(adjacency, result.coords, 'C13');
    const nitrileAngle = bondAngleAtAtom(result.coords, 'C16', 'C13', 'N17');

    assert.equal(result.supported, true);
    assert.equal(separations.length, 4, 'expected the quaternary nitrile center to place four heavy neighbors');
    assert.ok(
      separations.every(separation => Math.abs(separation - (Math.PI / 2)) < 0.05),
      `expected the quaternary center to use clean tetrahedral-like quadrants, got ${separations.map(separation => ((separation * 180) / Math.PI).toFixed(2)).join(', ')} degrees`
    );
    assert.ok(Math.abs(nitrileAngle - Math.PI) < 1e-6, `expected the nitrile branch to stay linear, got ${((nitrileAngle * 180) / Math.PI).toFixed(2)} degrees`);
  });

  it('keeps tert-butyl methyl leaves exact while straightening the neighboring attached-ring root', () => {
    const result = runPipeline(parseSMILES('CC(C)(C)C1CCCCC1(C)C1CCCOC1'), {
      suppressH: true,
      auditTelemetry: true
    });
    const graph = result.layoutGraph;
    const adjacency = buildAdjacency(graph, new Set(graph.components[0].atomIds));
    const separations = sortedHeavyNeighborSeparations(adjacency, result.coords, 'C2', graph);
    const attachedRingRootDeviation = bestLocalRingDeviation(graph, result.coords, 'C12', 'C10');
    const c10Position = result.coords.get('C10');
    const c10RingNeighborAngles = ['C5', 'C9'].map(neighborAtomId =>
      angleOf(sub(result.coords.get(neighborAtomId), c10Position))
    );
    const c10ExteriorTargets = smallRingExteriorTargetAngles(c10RingNeighborAngles, 6);
    const c10ExocyclicAngles = ['C11', 'C12'].map(neighborAtomId =>
      angleOf(sub(result.coords.get(neighborAtomId), c10Position))
    );
    const c10AlignedExteriorDeviation = Math.max(
      angularDifference(c10ExocyclicAngles[0], c10ExteriorTargets[0]),
      angularDifference(c10ExocyclicAngles[1], c10ExteriorTargets[1])
    );
    const c10SwappedExteriorDeviation = Math.max(
      angularDifference(c10ExocyclicAngles[0], c10ExteriorTargets[1]),
      angularDifference(c10ExocyclicAngles[1], c10ExteriorTargets[0])
    );
    const c10ExteriorDeviation = Math.min(c10AlignedExteriorDeviation, c10SwappedExteriorDeviation);

    assert.equal(result.metadata.audit.ok, true);
    assert.equal(separations.length, 4, 'expected the tert-butyl center to place four heavy neighbors');
    assert.ok(
      separations.every(separation => Math.abs(separation - (Math.PI / 2)) < 1e-6),
      `expected the tert-butyl center to use projected-tetrahedral quadrants, got ${separations.map(separation => ((separation * 180) / Math.PI).toFixed(2)).join(', ')} degrees`
    );
    assert.ok(
      attachedRingRootDeviation < 1e-6,
      `expected C12-C10 to follow the attached oxane ring outward axis, got ${((attachedRingRootDeviation * 180) / Math.PI).toFixed(2)} degrees`
    );
    assert.ok(
      c10ExteriorDeviation < Math.PI / 15,
      `expected C10 exocyclic exits to stay near the ring exterior slots, got ${((c10ExteriorDeviation * 180) / Math.PI).toFixed(2)} degrees`
    );
    assert.ok(distance(result.coords.get('C3'), result.coords.get('C13')) > 1.2, 'expected the tert-butyl methyl leaf to clear the attached oxane ring');
    assert.ok(distance(result.coords.get('C11'), result.coords.get('C12')) > 1.5, 'expected the parent methyl leaf to clear the attached oxane root');
  });

  it('keeps diaryl difluoromethyl linkers on clean projected-tetrahedral quadrants', () => {
    const graph = createLayoutGraph(parseSMILES('NC(=O)C1=CC=CC(=C1)C1=CC=C(NCC(F)(F)C2=CC=CC=N2)N=N1'), { suppressH: true });
    const component = graph.components[0];
    const adjacency = buildAdjacency(graph, new Set(component.atomIds));
    const plan = buildScaffoldPlan(graph, component);
    const result = layoutMixedFamily(graph, component, adjacency, plan, graph.options.bondLength);
    const separations = sortedHeavyNeighborSeparations(adjacency, result.coords, 'C16', graph);

    assert.equal(result.supported, true);
    assert.equal(separations.length, 4, 'expected the difluoromethyl linker center to place four heavy neighbors');
    assert.ok(
      separations.every(separation => Math.abs(separation - (Math.PI / 2)) < 0.05),
      `expected the difluoromethyl linker to use projected-tetrahedral quadrants, got ${separations.map(separation => ((separation * 180) / Math.PI).toFixed(2)).join(', ')} degrees`
    );
  });

  it('snaps diaryl amino alcohol ring roots onto exact aromatic outward axes after overlap cleanup', () => {
    const smiles = 'CC[C@@H](O)C(C[C@@H](C)N(C)C)(C1=CC=CC=C1)C1=CC=CC=C1';
    const result = runPipeline(parseSMILES(smiles), {
      suppressH: true,
      auditTelemetry: true,
      finalLandscapeOrientation: true
    });
    const graph = result.layoutGraph;
    const firstRingRootDeviation = bestLocalRingDeviation(graph, result.coords, 'C14', 'C6');
    const secondRingRootDeviation = bestLocalRingDeviation(graph, result.coords, 'C20', 'C6');

    assert.equal(result.metadata.audit.ok, true);
    assert.ok(
      firstRingRootDeviation < 1e-6,
      `expected the first phenyl root to keep an exact aromatic outward exit, got ${((firstRingRootDeviation * 180) / Math.PI).toFixed(2)} degrees`
    );
    assert.ok(
      secondRingRootDeviation < 1e-6,
      `expected the second phenyl root to keep an exact aromatic outward exit, got ${((secondRingRootDeviation * 180) / Math.PI).toFixed(2)} degrees`
    );
    for (const [name, angle] of [
      ['C6-C14-C15', bondAngleAtAtom(result.coords, 'C14', 'C6', 'C15')],
      ['C6-C14-C19', bondAngleAtAtom(result.coords, 'C14', 'C6', 'C19')],
      ['C15-C14-C19', bondAngleAtAtom(result.coords, 'C14', 'C15', 'C19')],
      ['C6-C20-C21', bondAngleAtAtom(result.coords, 'C20', 'C6', 'C21')],
      ['C6-C20-C25', bondAngleAtAtom(result.coords, 'C20', 'C6', 'C25')],
      ['C21-C20-C25', bondAngleAtAtom(result.coords, 'C20', 'C21', 'C25')]
    ]) {
      assert.ok(
        Math.abs(angle - ((2 * Math.PI) / 3)) < 1e-6,
        `expected ${name} to stay at 120 degrees, got ${((angle * 180) / Math.PI).toFixed(2)}`
      );
    }
  });

  it('compresses crowded terminal CF3 tripods while keeping the diaryl center on projected quadrants', () => {
    const smiles = 'CC1=CC(=CC=C1C([O-])=O)C(=O)NC1=CC=CC(=C1)C(C1=CC=C(O)C(NC(=O)C2=CC=C(C([O-])=O)C(C)=C2)=C1)(C(F)(F)F)C(F)(F)F';
    const result = runPipeline(parseSMILES(smiles), {
      suppressH: true,
      auditTelemetry: true
    });
    const graph = result.layoutGraph;
    const adjacency = buildAdjacency(graph, new Set(graph.components[0].atomIds));
    const c20Separations = sortedHeavyNeighborSeparations(adjacency, result.coords, 'C20', graph);
    const c41Separations = sortedHeavyNeighborSeparations(adjacency, result.coords, 'C41', graph);
    const c45Separations = sortedHeavyNeighborSeparations(adjacency, result.coords, 'C45', graph);

    assert.equal(result.metadata.audit.ok, true);
    assert.equal(c20Separations.length, 4, 'expected the diaryl bis-CF3 center to place four heavy neighbors');
    assert.ok(
      c20Separations.every(separation => Math.abs(separation - (Math.PI / 2)) < 1e-6),
      `expected C20 to keep projected-tetrahedral quadrants, got ${c20Separations.map(separation => ((separation * 180) / Math.PI).toFixed(2)).join(', ')} degrees`
    );
    assert.ok(
      c41Separations[0] >= Math.PI / 3 - 1e-6 && c45Separations[0] >= Math.PI / 3 - 1e-6,
      `expected the CF3 terminal leaves to keep readable compressed fans, got ${((c41Separations[0] * 180) / Math.PI).toFixed(2)} and ${((c45Separations[0] * 180) / Math.PI).toFixed(2)} degrees`
    );
    assert.ok(distance(result.coords.get('C22'), result.coords.get('F48')) > graph.options.bondLength * 0.85, 'expected the lower CF3 leaf to clear the adjacent aryl carbon');
    assert.ok(distance(result.coords.get('C40'), result.coords.get('F43')) > graph.options.bondLength * 0.85, 'expected the upper CF3 leaf to clear the adjacent aryl carbon');
  });

  it('uses presentation-aware mixed-root retry for cyclopropyl bis-pyridyl CF3 scaffolds', () => {
    const smiles = 'CN(C)C=C1C(C(F)(F)F)C1(CC(=O)C1=CC=CN=C1)C(=O)C1(CC(=O)C2=CC=CN=C2)C(C1=CN(C)C)C(F)(F)F';
    const result = runPipeline(parseSMILES(smiles), {
      suppressH: true,
      auditTelemetry: true
    });
    const graph = result.layoutGraph;
    const lowerPyridylAtomIds = ['C27', 'C28', 'C29', 'C30', 'N31', 'C32'];
    const closestLowerPyridylContact = Math.min(
      ...lowerPyridylAtomIds.map(atomId => distance(result.coords.get('F42'), result.coords.get(atomId)))
    );
    const c12Angle = bondAngleAtAtom(result.coords, 'C12', 'C11', 'C13');
    const c24Angle = bondAngleAtAtom(result.coords, 'C24', 'C23', 'C25');

    assert.equal(result.metadata.audit.ok, true);
    assert.equal(findVisibleHeavyBondCrossings(graph, result.coords).length, 0);
    assert.ok(
      Math.abs(c12Angle - ((2 * Math.PI) / 3)) < 1e-6,
      `expected the upper cyclopropyl carbonyl linker to keep a 120-degree bend, got ${((c12Angle * 180) / Math.PI).toFixed(2)}`
    );
    assert.ok(
      Math.abs(c24Angle - ((2 * Math.PI) / 3)) < 1e-6,
      `expected the lower cyclopropyl carbonyl linker to keep a 120-degree bend, got ${((c24Angle * 180) / Math.PI).toFixed(2)}`
    );
    assert.ok(
      closestLowerPyridylContact > graph.options.bondLength * 0.85,
      `expected the lower CF3 fluorine to clear the pyridyl ring, got ${closestLowerPyridylContact.toFixed(3)}`
    );
  });

  it('retries mixed roots when an audit-clean polyaryl chain leaves a skewed direct ring exit', () => {
    const smiles = 'COC1CN(CCO1)C1=CC=C(C=N1)C1=NC=CC=C1NC1=C2C(F)=CC(F)=CC2=NC(=C1C)C1=CC=CC=N1';
    const graph = createLayoutGraph(parseSMILES(smiles), { suppressH: true });
    const component = graph.components[0];
    const plan = buildScaffoldPlan(graph, component);
    const mixedResult = layoutMixedFamily(graph, component, buildAdjacency(graph, new Set(component.atomIds)), plan, graph.options.bondLength);
    const pipelineResult = runPipeline(parseSMILES(smiles), {
      suppressH: true,
      auditTelemetry: true,
      finalLandscapeOrientation: true
    });

    const assertC15Fan = (coords, label) => {
      for (const [firstAtomId, secondAtomId] of [
        ['C12', 'C20'],
        ['C12', 'N16'],
        ['C20', 'N16']
      ]) {
        const angle = bondAngleAtAtom(coords, 'C15', firstAtomId, secondAtomId);
        assert.ok(
          Math.abs(angle - ((2 * Math.PI) / 3)) < 1e-6,
          `expected ${label} ${firstAtomId}-C15-${secondAtomId} to stay at 120 degrees, got ${((angle * 180) / Math.PI).toFixed(2)}`
        );
      }
    };

    assert.equal(mixedResult.supported, true);
    assert.equal(mixedResult.rootRetryUsed, true);
    assert.equal(mixedResult.rootScaffoldId, 'ring-system:3');
    assertC15Fan(mixedResult.coords, 'mixed layout');
    assert.equal(pipelineResult.metadata.audit.ok, true);
    assert.equal(pipelineResult.metadata.audit.severeOverlapCount, 0);
    assertC15Fan(pipelineResult.coords, 'pipeline layout');
  });

  it('retries mixed roots when a terminal aromatic methyl exact slot is blocked by a neighboring phenyl', () => {
    const smiles = 'COc1ccc2c(n1)c(C(=O)N3CCNCC3)c(Cc4cccc(F)c4C)n2c5ccccc5';
    const graph = createLayoutGraph(parseSMILES(smiles), { suppressH: true });
    const component = graph.components[0];
    const plan = buildScaffoldPlan(graph, component);
    const mixedResult = layoutMixedFamily(graph, component, buildAdjacency(graph, new Set(component.atomIds)), plan, graph.options.bondLength);
    const pipelineResult = runPipeline(parseSMILES(smiles), {
      suppressH: true,
      auditTelemetry: true,
      finalLandscapeOrientation: true
    });

    const assertExactArylExits = (layoutGraph, coords, label) => {
      for (const [anchorAtomId, childAtomId] of [
        ['C20', 'C19'],
        ['C24', 'F25'],
        ['C26', 'C27']
      ]) {
        const deviation = bestLocalRingDeviation(layoutGraph, coords, anchorAtomId, childAtomId);
        assert.ok(
          deviation < 1e-6,
          `expected ${label} ${anchorAtomId}-${childAtomId} to follow the exact local aromatic outward axis, got ${((deviation * 180) / Math.PI).toFixed(2)} degrees`
        );
      }
      for (const [firstAtomId, secondAtomId] of [
        ['C20', 'C24'],
        ['C20', 'C27'],
        ['C24', 'C27']
      ]) {
        const angle = bondAngleAtAtom(coords, 'C26', firstAtomId, secondAtomId);
        assert.ok(
          Math.abs(angle - ((2 * Math.PI) / 3)) < 1e-6,
          `expected ${label} ${firstAtomId}-C26-${secondAtomId} to stay at 120 degrees, got ${((angle * 180) / Math.PI).toFixed(2)}`
        );
      }
    };

    assert.equal(mixedResult.supported, true);
    if (mixedResult.rootRetryUsed === true) {
      assert.equal(mixedResult.rootScaffoldId, 'ring-system:2');
    }
    assertExactArylExits(graph, mixedResult.coords, 'mixed layout');
    assert.equal(pipelineResult.metadata.audit.ok, true);
    assert.equal(pipelineResult.metadata.audit.severeOverlapCount, 0);
    assert.equal(findVisibleHeavyBondCrossings(pipelineResult.layoutGraph, pipelineResult.coords).length, 0);
    assertExactArylExits(pipelineResult.layoutGraph, pipelineResult.coords, 'pipeline layout');
  });

  it('keeps triaryl sulfoxide indole exits trigonal and overlap-free', () => {
    const smiles = 'C[S+]([O-])c1ccc(cc1)c2cc(c3ccncc3C)c([nH]2)c4ccc(F)cc4';
    const result = runPipeline(parseSMILES(smiles), {
      suppressH: true,
      auditTelemetry: true
    });
    const c18Angles = [
      bondAngleAtAtom(result.coords, 'C18', 'C13', 'C17'),
      bondAngleAtAtom(result.coords, 'C18', 'C13', 'C19'),
      bondAngleAtAtom(result.coords, 'C18', 'C17', 'C19')
    ];

    assert.equal(result.metadata.audit.ok, true);
    assert.equal(result.metadata.audit.severeOverlapCount, 0);
    assert.equal(findVisibleHeavyBondCrossings(result.layoutGraph, result.coords).length, 0);
    assert.ok(
      c18Angles.every(angle => Math.abs(angle - ((2 * Math.PI) / 3)) < 1e-6),
      `expected C18 to keep an exact 120-degree aromatic fan, got ${c18Angles.map(angle => ((angle * 180) / Math.PI).toFixed(2)).join(', ')} degrees`
    );
  });

  it('keeps imide-attached phenyl roots trigonal by rotating compact acyclic sidechains away', () => {
    const smiles = 'CSc1ccccc1C2C(C(=O)C(C)C)C(=O)C(=O)N2c3ccc(cc3)c4csc(C)c4';
    const result = runPipeline(parseSMILES(smiles), {
      suppressH: true,
      auditTelemetry: true,
      finalLandscapeOrientation: true
    });
    const c21Angles = [
      bondAngleAtAtom(result.coords, 'C21', 'C26', 'N20'),
      bondAngleAtAtom(result.coords, 'C21', 'C26', 'C22'),
      bondAngleAtAtom(result.coords, 'C21', 'N20', 'C22')
    ];
    const c3Angles = [
      bondAngleAtAtom(result.coords, 'C3', 'S2', 'C4'),
      bondAngleAtAtom(result.coords, 'C3', 'S2', 'C8'),
      bondAngleAtAtom(result.coords, 'C3', 'C4', 'C8')
    ];
    const c3S2Distance = distance(result.coords.get('C3'), result.coords.get('S2'));
    const c1S2Distance = distance(result.coords.get('C1'), result.coords.get('S2'));

    assert.equal(result.metadata.audit.ok, true);
    assert.equal(result.metadata.audit.severeOverlapCount, 0);
    assert.equal(findVisibleHeavyBondCrossings(result.layoutGraph, result.coords).length, 0);
    assert.ok(
      c21Angles.every(angle => Math.abs(angle - ((2 * Math.PI) / 3)) < 1e-6),
      `expected C21 to keep an exact 120-degree aromatic fan, got ${c21Angles.map(angle => ((angle * 180) / Math.PI).toFixed(2)).join(', ')} degrees`
    );
    assert.ok(
      c3Angles.every(angle => Math.abs(angle - ((2 * Math.PI) / 3)) < 1e-6),
      `expected C3 to keep an exact 120-degree aromatic fan, got ${c3Angles.map(angle => ((angle * 180) / Math.PI).toFixed(2)).join(', ')} degrees`
    );
    assert.ok(
      Math.abs(c3S2Distance - result.layoutGraph.options.bondLength * 0.8) < 1e-6,
      `expected C3-S2 to be shortened into the exact sidechain slot, got ${c3S2Distance.toFixed(3)}`
    );
    assert.ok(
      Math.abs(c1S2Distance - result.layoutGraph.options.bondLength) < 1e-6,
      `expected internal C1-S2 sidechain length to remain unchanged, got ${c1S2Distance.toFixed(3)}`
    );
  });

  it('previews pending heteroring roots before assigning crowded tetrahedral branch slots', () => {
    const smiles = 'CC(C1=NC(=CS1)C1=CC=C(C=C1)C#N)C(O)(C[N+]1(CCOC(=O)N2CCCC2C[NH3+])C=NC=N1)C1=CC(F)=CC=C1F';
    const result = runPipeline(parseSMILES(smiles), { suppressH: true });
    const graph = result.layoutGraph;
    const adjacency = buildAdjacency(graph, new Set(graph.components[0].atomIds));
    const c16Separations = sortedHeavyNeighborSeparations(adjacency, result.coords, 'C16', graph);
    const n19Separations = sortedHeavyNeighborSeparations(adjacency, result.coords, 'N19', graph);
    const c20N36Distance = distance(result.coords.get('C20'), result.coords.get('N36'));
    const c1C20Distance = distance(result.coords.get('C1'), result.coords.get('C20'));

    assert.equal(result.metadata.audit.ok, true);
    assert.ok(
      c16Separations.every(separation => Math.abs(separation - (Math.PI / 2)) < 1e-6),
      `expected C16 to keep projected branch quadrants, got ${c16Separations.map(separation => ((separation * 180) / Math.PI).toFixed(2)).join(', ')} degrees`
    );
    assert.ok(
      n19Separations[0] > 4 * Math.PI / 9,
      `expected the imidazolium-side branch to avoid pinching against ring bonds, got minimum N19 separation ${((n19Separations[0] * 180) / Math.PI).toFixed(2)} degrees`
    );
    assert.ok(c20N36Distance > graph.options.bondLength * 0.8, `expected C20/N36 to clear, got ${c20N36Distance.toFixed(3)}`);
    assert.ok(c1C20Distance > graph.options.bondLength * 0.8, `expected C1/C20 to clear, got ${c1C20Distance.toFixed(3)}`);
  });

  it('fans six-member-ring geminal difluoro substituents across the ring exterior gap', () => {
    const smiles = 'NC(=O)C1=CC=C(NC2CCCC(F)(F)C2[NH3+])N=C1NC1=CC=CN=C1';
    const graph = createLayoutGraph(parseSMILES(smiles), { suppressH: true });
    const component = graph.components[0];
    const adjacency = buildAdjacency(graph, new Set(component.atomIds));
    const plan = buildScaffoldPlan(graph, component);
    const mixedResult = layoutMixedFamily(graph, component, adjacency, plan, graph.options.bondLength);
    const pipelineResult = runPipeline(parseSMILES(smiles), { suppressH: true });

    const exteriorGapMetrics = coords => {
      const centerAtomId = 'C13';
      const centerPosition = coords.get(centerAtomId);
      const ringNeighborAngles = ['C12', 'C16'].map(atomId => angleOf(sub(coords.get(atomId), centerPosition)));
      const targetAngles = smallRingExteriorTargetAngles(ringNeighborAngles, 6);
      const exocyclicAngles = ['F14', 'F15'].map(atomId => angleOf(sub(coords.get(atomId), centerPosition)));
      const alignedDeviation = [
        angularDifference(exocyclicAngles[0], targetAngles[0]),
        angularDifference(exocyclicAngles[1], targetAngles[1])
      ];
      const swappedDeviation = [
        angularDifference(exocyclicAngles[0], targetAngles[1]),
        angularDifference(exocyclicAngles[1], targetAngles[0])
      ];
      const chosenDeviation = alignedDeviation.reduce((sum, deviation) => sum + deviation, 0)
        <= swappedDeviation.reduce((sum, deviation) => sum + deviation, 0)
        ? alignedDeviation
        : swappedDeviation;
      return {
        separations: sortedNeighborSeparations(adjacency, coords, centerAtomId),
        maxTargetDeviation: Math.max(...chosenDeviation)
      };
    };

    const mixedMetrics = exteriorGapMetrics(mixedResult.coords);
    const pipelineMetrics = exteriorGapMetrics(pipelineResult.coords);

    assert.equal(mixedResult.supported, true);
    assert.ok(
      mixedMetrics.separations[0] > 1.3,
      `expected the mixed layout to avoid pinched 60-degree difluoro gaps, got minimum separation ${((mixedMetrics.separations[0] * 180) / Math.PI).toFixed(2)} degrees`
    );
    assert.ok(
      mixedMetrics.maxTargetDeviation < 1e-6,
      `expected the mixed layout to place the geminal difluoros on the exact six-member exterior-gap targets, got max deviation ${((mixedMetrics.maxTargetDeviation * 180) / Math.PI).toFixed(2)} degrees`
    );
    assert.ok(
      pipelineMetrics.separations[0] > 1.3,
      `expected the full pipeline to avoid pinched 60-degree difluoro gaps, got minimum separation ${((pipelineMetrics.separations[0] * 180) / Math.PI).toFixed(2)} degrees`
    );
    assert.ok(
      pipelineMetrics.maxTargetDeviation < 1e-6,
      `expected the full pipeline to place the geminal difluoros on the exact six-member exterior-gap targets, got max deviation ${((pipelineMetrics.maxTargetDeviation * 180) / Math.PI).toFixed(2)} degrees`
    );
  });

  it('preserves crowded fluorinated cyclohexyl exterior fans through cleanup', () => {
    const smiles = 'FC1(F)CCCC(N=C=O)(C(C2(CCCC(F)(F)C2(F)F)N=C=O)C2(CCCC(F)(F)C2(F)F)N=C=O)C1(F)F';
    const result = runPipeline(parseSMILES(smiles), {
      suppressH: true,
      auditTelemetry: true,
      finalLandscapeOrientation: true
    });
    const graph = result.layoutGraph;
    const adjacency = buildAdjacency(graph, new Set(graph.components[0].atomIds));
    const exactExteriorAnchorIds = ['C38', 'C32', 'C16', 'C19', 'C2', 'C29'];
    const centralFanSeparations = sortedHeavyNeighborSeparations(adjacency, result.coords, 'C11', graph);
    const c7Separations = sortedHeavyNeighborSeparations(adjacency, result.coords, 'C7', graph);
    const isocyanateAngles = [
      bondAngleAtAtom(result.coords, 'C36', 'N35', 'O37'),
      bondAngleAtAtom(result.coords, 'C23', 'N22', 'O24'),
      bondAngleAtAtom(result.coords, 'C9', 'N8', 'O10')
    ];

    for (const atomId of exactExteriorAnchorIds) {
      const exteriorPenalty = measureSmallRingExteriorGapSpreadPenalty(graph, result.coords, atomId);
      assert.ok(
        exteriorPenalty < 1e-9,
        `expected ${atomId} saturated-ring exterior fan to stay exact, got penalty ${exteriorPenalty.toExponential(3)}`
      );
    }
    assert.ok(
      centralFanSeparations.every(separation => Math.abs(separation - (2 * Math.PI) / 3) < 1e-6),
      `expected C11 ring-link fan to stay trigonal, got ${centralFanSeparations.map(separation => ((separation * 180) / Math.PI).toFixed(2)).join(', ')} degrees`
    );
    assert.ok(
      c7Separations[0] >= Math.PI / 4 - 1e-6,
      `expected C7 isocyanate/ring exit fan to stay bounded while clearing overlaps, got minimum separation ${((c7Separations[0] * 180) / Math.PI).toFixed(2)} degrees`
    );
    for (const angle of isocyanateAngles) {
      assert.ok(
        Math.abs(angle - Math.PI) < 1e-6,
        `expected crowded ring-attached isocyanate arms to stay linear, got ${((angle * 180) / Math.PI).toFixed(2)} degrees`
      );
    }
    assert.equal(result.metadata.audit.ok, true);
    assert.equal(result.metadata.audit.severeOverlapCount, 0);
    assert.equal(result.metadata.audit.bondLengthFailureCount, 0);
    assert.equal(result.metadata.audit.ringSubstituentReadabilityFailureCount, 0);
    assert.equal(result.metadata.audit.outwardAxisRingSubstituentFailureCount, 0);
  });

  it('places direct-attached aryl branches on six-member saturated-ring exterior slots', () => {
    const smiles = 'FC(F)(F)C(=O)OC1C[NH2+]CC1N1CCC(CC1)(OC(=O)C(F)(F)F)C1=CC=CC=C1';
    const result = runPipeline(parseSMILES(smiles), {
      suppressH: true,
      auditTelemetry: true
    });
    const graph = result.layoutGraph;
    const adjacency = buildAdjacency(graph, new Set(graph.components[0].atomIds));
    const centerAtomId = 'C17';
    const centerPosition = result.coords.get(centerAtomId);
    const ringNeighborAngles = ['C18', 'C16'].map(atomId => angleOf(sub(result.coords.get(atomId), centerPosition)));
    const targetAngles = smallRingExteriorTargetAngles(ringNeighborAngles, 6);
    const exocyclicAngles = ['O20', 'C27'].map(atomId => angleOf(sub(result.coords.get(atomId), centerPosition)));
    const alignedDeviation = [
      angularDifference(exocyclicAngles[0], targetAngles[0]),
      angularDifference(exocyclicAngles[1], targetAngles[1])
    ];
    const swappedDeviation = [
      angularDifference(exocyclicAngles[0], targetAngles[1]),
      angularDifference(exocyclicAngles[1], targetAngles[0])
    ];
    const maxTargetDeviation = Math.min(Math.max(...alignedDeviation), Math.max(...swappedDeviation));
    const separations = sortedHeavyNeighborSeparations(adjacency, result.coords, centerAtomId, graph);

    assert.equal(result.metadata.audit.ok, true);
    assert.ok(
      maxTargetDeviation < 1e-6,
      `expected C17 ester and aryl exits on the exact six-member exterior targets, got max deviation ${((maxTargetDeviation * 180) / Math.PI).toFixed(2)} degrees`
    );
    assert.ok(
      separations[0] > 1.3,
      `expected C17 to avoid a pinched ester/aryl gap, got minimum separation ${((separations[0] * 180) / Math.PI).toFixed(2)} degrees`
    );
  });

  it('places direct-attached aryl branches on seven-member saturated-ring exterior slots', () => {
    const smiles = 'FC(F)(F)C(=O)OC1C[NH2+]CC1N1CCCC(CC1)(OC(=O)C(F)(F)F)C1=C(F)C(F)=C(F)C(F)=C1(F)';
    const result = runPipeline(parseSMILES(smiles), {
      suppressH: true,
      auditTelemetry: true
    });
    const graph = result.layoutGraph;
    const adjacency = buildAdjacency(graph, new Set(graph.components[0].atomIds));
    const centerAtomId = 'C18';
    const centerPosition = result.coords.get(centerAtomId);
    const ringNeighborAngles = ['C19', 'C17'].map(atomId => angleOf(sub(result.coords.get(atomId), centerPosition)));
    const targetAngles = smallRingExteriorTargetAngles(ringNeighborAngles, 7);
    const exocyclicAngles = ['O21', 'C28'].map(atomId => angleOf(sub(result.coords.get(atomId), centerPosition)));
    const alignedDeviation = [
      angularDifference(exocyclicAngles[0], targetAngles[0]),
      angularDifference(exocyclicAngles[1], targetAngles[1])
    ];
    const swappedDeviation = [
      angularDifference(exocyclicAngles[0], targetAngles[1]),
      angularDifference(exocyclicAngles[1], targetAngles[0])
    ];
    const maxTargetDeviation = Math.min(Math.max(...alignedDeviation), Math.max(...swappedDeviation));
    const separations = sortedHeavyNeighborSeparations(adjacency, result.coords, centerAtomId, graph);

    assert.equal(result.metadata.audit.ok, true);
    assert.ok(
      maxTargetDeviation < 1e-6,
      `expected C18 ester and aryl exits on the exact seven-member exterior targets, got max deviation ${((maxTargetDeviation * 180) / Math.PI).toFixed(2)} degrees`
    );
    assert.ok(
      separations[0] > 1.3,
      `expected C18 to avoid a pinched ester/aryl gap, got minimum separation ${((separations[0] * 180) / Math.PI).toFixed(2)} degrees`
    );
  });

  it('keeps direct-attached aryl branches on five-member saturated-ring exterior slots beside CF3 tripods', () => {
    const smiles = 'FC(F)(F)CNC(=O)C1CN(C1)C1=CC=C(C=C1)C1=NOC(C1)(C1=CC(Cl)=C(Cl)C(Cl)=C1)C(F)(F)F';
    const result = runPipeline(parseSMILES(smiles), {
      suppressH: true,
      auditTelemetry: true,
      finalLandscapeOrientation: true
    });
    const graph = result.layoutGraph;
    const adjacency = buildAdjacency(graph, new Set(graph.components[0].atomIds));
    const centerAtomId = 'C22';
    const centerPosition = result.coords.get(centerAtomId);
    const ringNeighborAngles = ['C23', 'O21'].map(atomId => angleOf(sub(result.coords.get(atomId), centerPosition)));
    const targetAngles = smallRingExteriorTargetAngles(ringNeighborAngles, 5);
    const exocyclicAngles = ['C24', 'C33'].map(atomId => angleOf(sub(result.coords.get(atomId), centerPosition)));
    const alignedDeviation = [
      angularDifference(exocyclicAngles[0], targetAngles[0]),
      angularDifference(exocyclicAngles[1], targetAngles[1])
    ];
    const swappedDeviation = [
      angularDifference(exocyclicAngles[0], targetAngles[1]),
      angularDifference(exocyclicAngles[1], targetAngles[0])
    ];
    const maxTargetDeviation = Math.min(Math.max(...alignedDeviation), Math.max(...swappedDeviation));
    const separations = sortedHeavyNeighborSeparations(adjacency, result.coords, centerAtomId, graph);
    const arylRootDeviation = bestLocalRingDeviation(graph, result.coords, 'C24', centerAtomId);
    const cf3FanSeparations = sortedHeavyNeighborSeparations(adjacency, result.coords, 'C33', graph);

    assert.equal(result.metadata.audit.ok, true);
    assert.ok(
      maxTargetDeviation < 1e-6,
      `expected C22 aryl and CF3 exits on the exact five-member exterior targets, got max deviation ${((maxTargetDeviation * 180) / Math.PI).toFixed(2)} degrees`
    );
    assert.ok(
      separations[0] > 1.3,
      `expected C22 to avoid a pinched aryl/CF3 gap, got minimum separation ${((separations[0] * 180) / Math.PI).toFixed(2)} degrees`
    );
    assert.ok(
      arylRootDeviation < 1e-6,
      `expected the chlorophenyl root to stay exact by relieving the CF3 leaf, got ${((arylRootDeviation * 180) / Math.PI).toFixed(2)} degrees`
    );
    assert.ok(
      cf3FanSeparations[0] >= Math.PI / 3 - 1e-6,
      `expected the CF3 leaf relief to keep a readable terminal fan, got minimum separation ${((cf3FanSeparations[0] * 180) / Math.PI).toFixed(2)} degrees`
    );
    assert.ok(
      distance(result.coords.get('C32'), result.coords.get('F34')) > graph.options.bondLength * 0.7,
      'expected the relieved CF3 fluorine to clear the exact chlorophenyl root'
    );
  });

  it('keeps sibling direct-attached aryl branches on five-member saturated-ring exterior slots', () => {
    const smiles = '[O-]C(=O)C1=CC=CC=C1OC1=CC=C(C=C1)C1(C2=CC=CC=C2C2=CC=CC=C12)C1=CC=C(OC2=CC=CC=C2N(=O)=O)C=C1';
    const result = runPipeline(parseSMILES(smiles), {
      suppressH: true,
      auditTelemetry: true
    });
    const graph = result.layoutGraph;
    const adjacency = buildAdjacency(graph, new Set(graph.components[0].atomIds));
    const centerAtomId = 'C17';
    const centerPosition = result.coords.get(centerAtomId);
    const ringNeighborAngles = ['C29', 'C18'].map(atomId => angleOf(sub(result.coords.get(atomId), centerPosition)));
    const targetAngles = smallRingExteriorTargetAngles(ringNeighborAngles, 5);
    const exocyclicAngles = ['C14', 'C30'].map(atomId => angleOf(sub(result.coords.get(atomId), centerPosition)));
    const alignedDeviation = [
      angularDifference(exocyclicAngles[0], targetAngles[0]),
      angularDifference(exocyclicAngles[1], targetAngles[1])
    ];
    const swappedDeviation = [
      angularDifference(exocyclicAngles[0], targetAngles[1]),
      angularDifference(exocyclicAngles[1], targetAngles[0])
    ];
    const maxTargetDeviation = Math.min(Math.max(...alignedDeviation), Math.max(...swappedDeviation));
    const separations = sortedHeavyNeighborSeparations(adjacency, result.coords, centerAtomId, graph);

    assert.equal(result.metadata.audit.ok, true);
    assert.ok(
      maxTargetDeviation < 1e-6,
      `expected C17 aryl exits on exact five-member exterior targets, got max deviation ${((maxTargetDeviation * 180) / Math.PI).toFixed(2)} degrees`
    );
    assert.ok(
      separations[0] > 1.3,
      `expected C17 to avoid a pinched diaryl gap, got minimum separation ${((separations[0] * 180) / Math.PI).toFixed(2)} degrees`
    );
    assert.ok(
      distance(result.coords.get('C13'), result.coords.get('C45')) > graph.options.bondLength * 0.8,
      'expected the sibling aryl rings to clear the C13/C45 overlap'
    );

    const expectedCarboxylateAngle = (2 * Math.PI) / 3;
    for (const [label, angle] of [
      ['O3-C2-C4', bondAngleAtAtom(result.coords, 'C2', 'O3', 'C4')],
      ['O3-C2-O1', bondAngleAtAtom(result.coords, 'C2', 'O3', 'O1')],
      ['C4-C2-O1', bondAngleAtAtom(result.coords, 'C2', 'C4', 'O1')]
    ]) {
      assert.ok(
        Math.abs(angle - expectedCarboxylateAngle) < 1e-6,
        `expected the carboxylate fan to stay trigonal at ${label}, got ${((angle * 180) / Math.PI).toFixed(2)} degrees`
      );
    }
  });

  it('generalizes direct-attached aryl exterior slots beyond seven-member saturated rings', () => {
    const smiles = 'FC(F)(F)C(=O)OC1C[NH2+]CC1N1CCCCC(CC1)(OC(=O)C(F)(F)F)C1=C(F)C(F)=C(F)C(F)=C1(F)';
    const result = runPipeline(parseSMILES(smiles), {
      suppressH: true,
      auditTelemetry: true
    });
    const metrics = exteriorSpreadAnchorMetrics(result, 8);

    assert.equal(result.metadata.audit.ok, true);
    assert.ok(metrics, 'expected an eight-member saturated-ring exterior spread anchor');
    assert.ok(
      metrics.maxTargetDeviation < 1e-6,
      `expected ${metrics.anchorAtomId} exits on exact exterior targets, got max deviation ${((metrics.maxTargetDeviation * 180) / Math.PI).toFixed(2)} degrees`
    );
    assert.ok(
      metrics.separations[0] > 1.3,
      `expected ${metrics.anchorAtomId} to avoid a pinched ester/aryl gap, got minimum separation ${((metrics.separations[0] * 180) / Math.PI).toFixed(2)} degrees`
    );
  });

  it('rotates saturated six-member ring blocks so diaryl quaternary anchors keep open exterior angles', () => {
    const smiles = 'ClC1=CC=C(C=C1)C1(CCNCC1)C1=CC=C(C=C1)C1=C2N=CNC2=NC=N1';
    const graph = createLayoutGraph(parseSMILES(smiles), { suppressH: true });
    const component = graph.components[0];
    const adjacency = buildAdjacency(graph, new Set(component.atomIds));
    const result = runPipeline(parseSMILES(smiles), {
      suppressH: true,
      finalLandscapeOrientation: true
    });
    const audit = auditLayout(result.layoutGraph, result.coords, { bondLength: result.layoutGraph.options.bondLength });
    const separations = sortedHeavyNeighborSeparations(adjacency, result.coords, 'C8', graph);

    assert.equal(audit.severeOverlapCount, 0);
    assert.equal(separations.length, 4, 'expected C8 to keep four visible heavy-neighbor directions');
    assert.ok(
      separations[0] > 1.3,
      `expected C8 to avoid a pinched diaryl/ring gap, got minimum separation ${((separations[0] * 180) / Math.PI).toFixed(2)} degrees`
    );
    assert.ok(
      separations[3] < 2.2,
      `expected C8 to avoid one giant compensating gap, got maximum separation ${((separations[3] * 180) / Math.PI).toFixed(2)} degrees`
    );
  });

  it('does not force mono-fluoro benzylic linkers off their standard trigonal continuation', () => {
    const graph = createLayoutGraph(parseSMILES('NC(=O)C1=CC=CC(=C1)C1=CC=C(NCC(F)C2=CC=CC=N2)N=N1'), { suppressH: true });
    const component = graph.components[0];
    const adjacency = buildAdjacency(graph, new Set(component.atomIds));
    const plan = buildScaffoldPlan(graph, component);
    const result = layoutMixedFamily(graph, component, adjacency, plan, graph.options.bondLength);
    const linkerAngle = bondAngleAtAtom(result.coords, 'C16', 'C15', 'C18');

    assert.equal(result.supported, true);
    assert.ok(
      Math.abs(linkerAngle - ((2 * Math.PI) / 3)) < 0.05,
      `expected the mono-fluoro linker to stay near a 120-degree trigonal continuation, got ${((linkerAngle * 180) / Math.PI).toFixed(2)} degrees`
    );
  });

  it('keeps a heavy ring substituent on the outward axis even when the anchor also carries an explicit hydrogen', () => {
    const graph = createLayoutGraph(parseSMILES('CC1CCCCC1'), { suppressH: true });
    const component = graph.components[0];
    const plan = buildScaffoldPlan(graph, component);
    const result = layoutMixedFamily(graph, component, buildAdjacency(graph, new Set(component.atomIds)), plan, graph.options.bondLength);
    const ring = graph.rings[0];
    const ringAtomSet = new Set(ring.atomIds);
    const ringCenter = centroid(ring.atomIds.map(atomId => result.coords.get(atomId)));
    let anchorAtomId = null;
    let heavyChildAtomId = null;
    let hydrogenChildIds = [];

    for (const atomId of ring.atomIds) {
      const atom = graph.sourceMolecule.atoms.get(atomId);
      const heavyChildren = atom
        .getNeighbors(graph.sourceMolecule)
        .filter(neighborAtom => neighborAtom && neighborAtom.name !== 'H' && !ringAtomSet.has(neighborAtom.id))
        .map(neighborAtom => neighborAtom.id);
      const hydrogenChildren = atom
        .getNeighbors(graph.sourceMolecule)
        .filter(neighborAtom => neighborAtom?.name === 'H')
        .map(neighborAtom => neighborAtom.id);
      if (heavyChildren.length === 1 && hydrogenChildren.length > 0) {
        anchorAtomId = atomId;
        heavyChildAtomId = heavyChildren[0];
        hydrogenChildIds = hydrogenChildren;
        break;
      }
    }

    assert.equal(result.supported, true);
    assert.ok(anchorAtomId, 'expected a ring anchor with one heavy substituent and at least one explicit hydrogen');
    const outwardAngle = angleOf(sub(result.coords.get(anchorAtomId), ringCenter));
    const heavyAngle = angleOf(sub(result.coords.get(heavyChildAtomId), result.coords.get(anchorAtomId)));
    const heavyDeviation = angularDifference(heavyAngle, outwardAngle);
    const hydrogenDeviations = hydrogenChildIds.map(hydrogenAtomId =>
      angularDifference(angleOf(sub(result.coords.get(hydrogenAtomId), result.coords.get(anchorAtomId))), outwardAngle)
    );

    assert.ok(heavyDeviation < 0.4, `expected heavy substituent to stay near the ring outward axis, got ${heavyDeviation.toFixed(3)} rad`);
    assert.ok(
      hydrogenDeviations.every(deviation => deviation > heavyDeviation),
      'expected explicit hydrogens to yield to the heavier substituent'
    );
  });

  it('keeps explicit-hydrogen-bearing substituents on the steroid nucleus aligned to their local ring outward directions', () => {
    const graph = createLayoutGraph(parseSMILES('CC(C)CCCC(C)C1CCC2C3C(CC=C4C3(CCC5C4CCC(C5)O)C)CC2C1C(=O)OC'), { suppressH: true });
    const component = graph.components[0];
    const plan = buildScaffoldPlan(graph, component);
    const result = layoutMixedFamily(graph, component, buildAdjacency(graph, new Set(component.atomIds)), plan, graph.options.bondLength);
    const ringAtomSet = new Set(graph.ringSystems[0].atomIds);
    const checkedAnchors = [];

    for (const atomId of graph.ringSystems[0].atomIds) {
      const atom = graph.sourceMolecule.atoms.get(atomId);
      const heavyChildren = atom
        .getNeighbors(graph.sourceMolecule)
        .filter(neighborAtom => neighborAtom && neighborAtom.name !== 'H' && !ringAtomSet.has(neighborAtom.id))
        .map(neighborAtom => neighborAtom.id);
      const hydrogenChildren = atom
        .getNeighbors(graph.sourceMolecule)
        .filter(neighborAtom => neighborAtom?.name === 'H')
        .map(neighborAtom => neighborAtom.id);
      if (heavyChildren.length !== 1 || hydrogenChildren.length === 0) {
        continue;
      }
      const heavyAngle = angleOf(sub(result.coords.get(heavyChildren[0]), result.coords.get(atomId)));
      const bestLocalDeviation = Math.min(
        ...graph.rings
          .filter(ring => ring.atomIds.includes(atomId))
          .map(ring => angularDifference(heavyAngle, angleOf(sub(result.coords.get(atomId), centroid(ring.atomIds.map(ringAtomId => result.coords.get(ringAtomId)))))))
      );
      checkedAnchors.push({ atomId, bestLocalDeviation });
      assert.ok(bestLocalDeviation < 0.4, `expected ${atomId} substituent to follow a local outward ring direction, got ${bestLocalDeviation.toFixed(3)} rad`);
    }

    assert.ok(checkedAnchors.length >= 3, 'expected multiple explicit-hydrogen-bearing ring substituents to be checked');
  });

  it('places the terminal steroid alcohol on the exact local ring-outward angle when that direction is already safe', () => {
    const graph = createLayoutGraph(parseSMILES('CC(C)CCCC(C)C1CCC2C3C(CC=C4C3(CCC5C4CCC(C5)O)C)CC2C1C(=O)N'), { suppressH: true });
    const component = graph.components[0];
    const plan = buildScaffoldPlan(graph, component);
    const result = layoutMixedFamily(graph, component, buildAdjacency(graph, new Set(component.atomIds)), plan, graph.options.bondLength);
    const ringAtomSet = new Set(graph.ringSystems[0].atomIds);
    let bestLocalDeviation = null;

    for (const atomId of graph.ringSystems[0].atomIds) {
      const atom = graph.sourceMolecule.atoms.get(atomId);
      const oxygenChildren = atom
        .getNeighbors(graph.sourceMolecule)
        .filter(neighborAtom => neighborAtom && neighborAtom.name === 'O' && !ringAtomSet.has(neighborAtom.id))
        .map(neighborAtom => neighborAtom.id);
      if (oxygenChildren.length !== 1) {
        continue;
      }
      const oxygenAngle = angleOf(sub(result.coords.get(oxygenChildren[0]), result.coords.get(atomId)));
      bestLocalDeviation = Math.min(
        ...graph.rings
          .filter(ring => ring.atomIds.includes(atomId))
          .map(ring => angularDifference(oxygenAngle, angleOf(sub(result.coords.get(atomId), centroid(ring.atomIds.map(ringAtomId => result.coords.get(ringAtomId)))))))
      );
      break;
    }

    assert.notEqual(bestLocalDeviation, null);
    assert.ok(bestLocalDeviation < 1e-6, `expected terminal alcohol to follow the exact local outward angle, got ${bestLocalDeviation?.toFixed(6)} rad`);
  });

  it('keeps the reported fused-ring bug-case substituents outside incident ring faces', () => {
    const firstGraph = createLayoutGraph(parseSMILES('C[C@]12CC[C@H]3[C@@H](CC[C@@H]4CC(=O)CC[C@]34C)[C@@H]1CC[C@@H]2O'), { suppressH: true });
    const secondGraph = createLayoutGraph(parseSMILES('C1CCC2C3CCC4=CC(=O)CCC4(C3CCC12C)C'), { suppressH: true });
    const firstComponent = firstGraph.components[0];
    const secondComponent = secondGraph.components[0];
    const firstResult = layoutMixedFamily(
      firstGraph,
      firstComponent,
      buildAdjacency(firstGraph, new Set(firstComponent.atomIds)),
      buildScaffoldPlan(firstGraph, firstComponent),
      firstGraph.options.bondLength
    );
    const secondResult = layoutMixedFamily(
      secondGraph,
      secondComponent,
      buildAdjacency(secondGraph, new Set(secondComponent.atomIds)),
      buildScaffoldPlan(secondGraph, secondComponent),
      secondGraph.options.bondLength
    );

    assert.deepEqual(inwardRingSubstituents(firstGraph, firstResult.coords), []);
    assert.deepEqual(inwardRingSubstituents(secondGraph, secondResult.coords), []);
  });

  it('keeps safe fused-junction substituents on the exact continuation of the shared junction bond', () => {
    const graph = createLayoutGraph(
      parseSMILES('C[C@@]1(C[C@@H](O)[C@@]2(O)C=CO[C@@H](O[C@H]3O[C@@H](CO)[C@@H](O)[C@@H](O)[C@@H]3O)[C@@H]12)OC(=O)\\C=C/c4ccccc4'),
      { suppressH: true }
    );
    const component = graph.components[0];
    const result = layoutMixedFamily(graph, component, buildAdjacency(graph, new Set(component.atomIds)), buildScaffoldPlan(graph, component), graph.options.bondLength);
    const anchorAtomId = 'C7';
    const heavyChildAtomId = 'O8';
    const ringNeighborIds = graph.sourceMolecule.atoms.get(anchorAtomId)
      .getNeighbors(graph.sourceMolecule)
      .filter(neighborAtom => neighborAtom && neighborAtom.name !== 'H' && neighborAtom.id !== heavyChildAtomId && (graph.atomToRings.get(neighborAtom.id)?.length ?? 0) > 0)
      .map(neighborAtom => neighborAtom.id);
    const sharedJunctionNeighborId = ringNeighborIds.find(neighborAtomId => sharedRingCount(graph, anchorAtomId, neighborAtomId) > 1);
    const straightJunctionAngle = angleOf(sub(result.coords.get(anchorAtomId), result.coords.get(sharedJunctionNeighborId)));
    const substituentAngle = angleOf(sub(result.coords.get(heavyChildAtomId), result.coords.get(anchorAtomId)));

    assert.equal(ringNeighborIds.length, 3);
    assert.equal(sharedJunctionNeighborId, 'C31');
    assert.ok(
      angularDifference(substituentAngle, straightJunctionAngle) < 1e-6,
      `expected fused-junction substituent to continue straight off the shared junction bond, got ${angularDifference(substituentAngle, straightJunctionAngle).toFixed(6)} rad`
    );
  });

  it('keeps ring-adjacent long ester tails on the open side of the carbonyl', () => {
    const smiles = 'OC[C@H]1O[C@@H](O[C@H]2[C@@H](O)[C@H](O)[C@@H](CO)O[C@H]2O)[C@H](O)[C@@H](O)[C@@H]1OC(=O)CCCCCC';
    const graph = createLayoutGraph(parseSMILES(smiles), { suppressH: true });
    const component = graph.components[0];
    const mixedResult = layoutMixedFamily(graph, component, buildAdjacency(graph, new Set(component.atomIds)), buildScaffoldPlan(graph, component), graph.options.bondLength);
    const pipelineResult = runPipeline(parseSMILES(smiles), {
      suppressH: true,
      auditTelemetry: true
    });

    const assertOpenEsterTail = (coords, label) => {
      for (const [name, angle] of [
        ['O33-C34-O35', bondAngleAtAtom(coords, 'C34', 'O33', 'O35')],
        ['O33-C34-C36', bondAngleAtAtom(coords, 'C34', 'O33', 'C36')],
        ['O35-C34-C36', bondAngleAtAtom(coords, 'C34', 'O35', 'C36')]
      ]) {
        assert.ok(
          Math.abs(angle - ((2 * Math.PI) / 3)) < 1e-6,
          `expected ${label} ${name} to stay exact at 120 degrees, got ${((angle * 180) / Math.PI).toFixed(2)}`
        );
      }
      const tailClearance = distance(coords.get('C36'), coords.get('O30'));
      const terminalOxygenClearance = distance(coords.get('O35'), coords.get('O30'));
      assert.ok(
        tailClearance > terminalOxygenClearance + graph.options.bondLength,
        `expected ${label} ester tail to take the open carbonyl slot, got tail ${tailClearance.toFixed(2)} vs oxygen ${terminalOxygenClearance.toFixed(2)}`
      );
    };

    assert.equal(mixedResult.supported, true);
    assertOpenEsterTail(mixedResult.coords, 'mixed layout');
    assertOpenEsterTail(pipelineResult.coords, 'pipeline layout');
    assert.equal(pipelineResult.metadata.audit.ok, true);
  });

  it('preserves terminal alkyne linearity through attached-ring fallback cleanup', () => {
    const smiles = 'CC1CCC(CNC(C)=O)(C1C)C(C)(C)C#C';
    const graph = createLayoutGraph(parseSMILES(smiles), { suppressH: true });
    const component = graph.components[0];
    const mixedResult = layoutMixedFamily(graph, component, buildAdjacency(graph, new Set(component.atomIds)), buildScaffoldPlan(graph, component), graph.options.bondLength);
    const pipelineResult = runPipeline(parseSMILES(smiles), {
      suppressH: true,
      auditTelemetry: true
    });

    const assertLinearAlkyne = (coords, label) => {
      const alkyneAngle = bondAngleAtAtom(coords, 'C16', 'C13', 'C17');
      assert.ok(
        Math.abs(alkyneAngle - Math.PI) < 1e-6,
        `expected ${label} C13-C16-C17 to stay linear, got ${((alkyneAngle * 180) / Math.PI).toFixed(2)} degrees`
      );
    };
    const assertExteriorRingSpread = (coords, label) => {
      const centerPosition = coords.get('C5');
      const ringNeighborAngles = ['C4', 'C11'].map(atomId => angleOf(sub(coords.get(atomId), centerPosition)));
      const targetAngles = smallRingExteriorTargetAngles(ringNeighborAngles, 5);
      const exocyclicAngles = ['C6', 'C13'].map(atomId => angleOf(sub(coords.get(atomId), centerPosition)));
      const alignedDeviation = [
        angularDifference(exocyclicAngles[0], targetAngles[0]),
        angularDifference(exocyclicAngles[1], targetAngles[1])
      ];
      const swappedDeviation = [
        angularDifference(exocyclicAngles[0], targetAngles[1]),
        angularDifference(exocyclicAngles[1], targetAngles[0])
      ];
      const maxExteriorDeviation = Math.min(
        Math.max(...alignedDeviation),
        Math.max(...swappedDeviation)
      );
      assert.ok(
        maxExteriorDeviation < 1e-6,
        `expected ${label} C5 substituents to stay on the cyclopentane exterior targets, got ${((maxExteriorDeviation * 180) / Math.PI).toFixed(2)} degrees`
      );
    };

    assert.equal(mixedResult.supported, true);
    assertLinearAlkyne(mixedResult.coords, 'mixed layout');
    assertLinearAlkyne(pipelineResult.coords, 'pipeline layout');
    assertExteriorRingSpread(mixedResult.coords, 'mixed layout');
    assertExteriorRingSpread(pipelineResult.coords, 'pipeline layout');
    assert.equal(pipelineResult.metadata.audit.ok, true);
  });

  it('preserves clean aryl carboxyl exits while attached-ring fallback evaluates a neighboring ring block', () => {
    const result = runPipeline(parseSMILES('OC(=O)C1=CC(C(O)=O)=C(C=C1)C1=C2C=C(F)C(=O)C=C2OC2=CC(O)=C(F)C=C12'), {
      suppressH: true,
      auditTelemetry: true
    });
    const firstCarboxylAngle = bondAngleAtAtom(result.coords, 'C6', 'C7', 'C10');
    const secondCarboxylAngle = bondAngleAtAtom(result.coords, 'C6', 'C7', 'C5');
    const compressedCarboxylLeafFirstAngle = bondAngleAtAtom(result.coords, 'C7', 'C6', 'O8');
    const compressedCarboxylLeafSecondAngle = bondAngleAtAtom(result.coords, 'C7', 'O8', 'O9');
    const firstAttachedRingAngle = bondAngleAtAtom(result.coords, 'C10', 'C13', 'C6');
    const secondAttachedRingAngle = bondAngleAtAtom(result.coords, 'C10', 'C13', 'C11');
    const firstAttachedRingRootAngle = bondAngleAtAtom(result.coords, 'C13', 'C30', 'C10');
    const secondAttachedRingRootAngle = bondAngleAtAtom(result.coords, 'C13', 'C14', 'C10');
    const compressedCarboxylLeafLength = distance(result.coords.get('C7'), result.coords.get('O8'));

    assert.ok(
      Math.abs(firstCarboxylAngle - ((2 * Math.PI) / 3)) < 1e-6,
      `expected C7-C6-C10 to stay exact at 120 degrees, got ${((firstCarboxylAngle * 180) / Math.PI).toFixed(2)}`
    );
    assert.ok(
      Math.abs(secondCarboxylAngle - ((2 * Math.PI) / 3)) < 1e-6,
      `expected C7-C6-C5 to stay exact at 120 degrees, got ${((secondCarboxylAngle * 180) / Math.PI).toFixed(2)}`
    );
    assert.ok(
      Math.abs(compressedCarboxylLeafFirstAngle - ((2 * Math.PI) / 3)) < 1e-6,
      `expected C6-C7-O8 to stay exact at 120 degrees, got ${((compressedCarboxylLeafFirstAngle * 180) / Math.PI).toFixed(2)}`
    );
    assert.ok(
      Math.abs(compressedCarboxylLeafSecondAngle - ((2 * Math.PI) / 3)) < 1e-6,
      `expected O8-C7-O9 to stay exact at 120 degrees, got ${((compressedCarboxylLeafSecondAngle * 180) / Math.PI).toFixed(2)}`
    );
    assert.ok(
      compressedCarboxylLeafLength < 0.85 && compressedCarboxylLeafLength > 0.8,
      `expected C7-O8 to compress locally while clearing the exact slot, got ${compressedCarboxylLeafLength.toFixed(3)}`
    );
    assert.ok(
      Math.abs(firstAttachedRingAngle - ((2 * Math.PI) / 3)) < 1e-6,
      `expected C13-C10-C6 to stay exact at 120 degrees, got ${((firstAttachedRingAngle * 180) / Math.PI).toFixed(2)}`
    );
    assert.ok(
      Math.abs(secondAttachedRingAngle - ((2 * Math.PI) / 3)) < 1e-6,
      `expected C13-C10-C11 to stay exact at 120 degrees, got ${((secondAttachedRingAngle * 180) / Math.PI).toFixed(2)}`
    );
    assert.ok(
      Math.abs(firstAttachedRingRootAngle - ((2 * Math.PI) / 3)) < 1e-6,
      `expected C30-C13-C10 to stay exact at 120 degrees, got ${((firstAttachedRingRootAngle * 180) / Math.PI).toFixed(2)}`
    );
    assert.ok(
      Math.abs(secondAttachedRingRootAngle - ((2 * Math.PI) / 3)) < 1e-6,
      `expected C14-C13-C10 to stay exact at 120 degrees, got ${((secondAttachedRingRootAngle * 180) / Math.PI).toFixed(2)}`
    );
    assert.equal(result.metadata.audit.ok, true);
  });

  it('keeps direct-attached foreign ring exits on the exact fused-junction continuation through the full pipeline', () => {
    const result = runPipeline(parseSMILES('CC1=NC=C(O1)C12CC(O)CCC1(C)CCN2'), {
      suppressH: true,
      auditTelemetry: true
    });
    const directAttachedRingDeviation = directAttachedRingJunctionDeviation(result.layoutGraph, result.coords, 'C7', 'C5');
    const terminalMethylDeviation = directAttachedRingJunctionDeviation(result.layoutGraph, result.coords, 'C13', 'C14');

    assert.notEqual(directAttachedRingDeviation, null);
    assert.notEqual(terminalMethylDeviation, null);
    assert.equal(result.metadata.audit.severeOverlapCount, 0);
    assert.ok(
      directAttachedRingDeviation < 1e-6,
      `expected the direct-attached oxazole exit to stay on the exact shared-junction continuation, got ${((directAttachedRingDeviation * 180) / Math.PI).toFixed(2)} degrees`
    );
    assert.ok(
      terminalMethylDeviation < 1e-6,
      `expected the fused-junction methyl to stay on the exact shared-junction continuation, got ${((terminalMethylDeviation * 180) / Math.PI).toFixed(2)} degrees`
    );
  });

  it('keeps terminal methyl leaves aligned with tight fused-junction continuations', () => {
    const result = runPipeline(parseSMILES('CC12COCC([NH3+])CC1CC1=C(CO2)C=CS1'), {
      suppressH: true,
      auditTelemetry: true
    });
    const terminalMethylDeviation = directAttachedRingJunctionDeviation(result.layoutGraph, result.coords, 'C2', 'C1');

    assert.notEqual(terminalMethylDeviation, null);
    assert.equal(result.metadata.audit.ok, true);
    assert.equal(result.metadata.audit.severeOverlapCount, 0);
    assert.ok(
      terminalMethylDeviation < 1e-6,
      `expected the terminal methyl to stay on the exact shared-junction continuation, got ${((terminalMethylDeviation * 180) / Math.PI).toFixed(2)} degrees`
    );
  });

  it('keeps three-shared-atom bridged single-ring hybrids from collapsing their two-atom child arc onto the parent block', () => {
    const smiles = 'CN1C=C2C(=N1)C1OC2(C)CC1C(O)CC#N';
    const graph = createLayoutGraph(parseSMILES(smiles), { suppressH: true });
    const component = graph.components[0];
    const adjacency = buildAdjacency(graph, new Set(component.atomIds));
    const mixedResult = layoutMixedFamily(graph, component, adjacency, buildScaffoldPlan(graph, component), graph.options.bondLength);
    const mixedAudit = auditLayout(graph, mixedResult.coords, { bondLength: graph.options.bondLength });
    const pipelineResult = runPipeline(parseSMILES(smiles), {
      suppressH: true,
      auditTelemetry: true
    });
    const mixedDeviation = bestLocalRingDeviation(graph, mixedResult.coords, 'C12', 'C13');
    const pipelineDeviation = bestLocalRingDeviation(pipelineResult.layoutGraph, pipelineResult.coords, 'C12', 'C13');
    const mixedArcGap = distance(mixedResult.coords.get('C4'), mixedResult.coords.get('C11'));
    const pipelineArcGap = distance(pipelineResult.coords.get('C4'), pipelineResult.coords.get('C11'));

    assert.equal(mixedResult.supported, true);
    assert.equal(mixedAudit.severeOverlapCount, 0);
    assert.ok(mixedArcGap > 2, `expected the mixed bridged child arc to stay separated from the parent block, got ${mixedArcGap.toFixed(3)}`);
    assert.ok(
      mixedDeviation < 1e-6,
      `expected the mixed bridged child-ring substituent to follow the exact local outward axis, got ${mixedDeviation.toFixed(6)} rad`
    );
    assert.equal(pipelineResult.metadata.audit.ok, true);
    assert.ok(pipelineArcGap > 2, `expected the full pipeline bridged child arc to stay separated from the parent block, got ${pipelineArcGap.toFixed(3)}`);
    assert.ok(
      pipelineDeviation < 1e-6,
      `expected the full pipeline bridged child-ring substituent to follow the exact local outward axis, got ${pipelineDeviation.toFixed(6)} rad`
    );
  });

  it('keeps a crowded five-member-ring ring junction on the aromatic outward axis while putting the second heavy branch in the remaining exterior slot', () => {
    const graph = createLayoutGraph(parseSMILES('C1=CC=C(C=C1)C2(C3CC3)C(=O)NC(=O)N2'), { suppressH: true });
    const component = graph.components[0];
    const adjacency = buildAdjacency(graph, new Set(component.atomIds));
    const result = layoutMixedFamily(graph, component, adjacency, buildScaffoldPlan(graph, component), graph.options.bondLength);
    const centerAtomId = 'C7';
    const centerPosition = result.coords.get(centerAtomId);
    const aromaticAnchorAtomId = 'C4';
    const ringNeighborAngles = ['C11', 'N16'].map(neighborAtomId =>
      angleOf(sub(result.coords.get(neighborAtomId), centerPosition))
    );
    const targetAngles = smallRingExteriorTargetAngles(ringNeighborAngles, 5);
    const remainingExteriorDeviation = Math.min(
      ...targetAngles.map(targetAngle => angularDifference(angleOf(sub(result.coords.get('C8'), centerPosition)), targetAngle))
    );
    const benzeneCentroid = centroid(['C1', 'C2', 'C3', 'C4', 'C5', 'C6'].map(atomId => result.coords.get(atomId)));
    const aromaticOutwardAngle = angleOf(sub(result.coords.get(aromaticAnchorAtomId), benzeneCentroid));
    const aromaticExitAngle = angleOf(sub(result.coords.get(centerAtomId), result.coords.get(aromaticAnchorAtomId)));

    assert.equal(result.supported, true);
    assert.ok(
      angularDifference(aromaticExitAngle, aromaticOutwardAngle) < 1e-6,
      `expected the aryl attachment at ${aromaticAnchorAtomId} to stay on its benzene outward axis, got deviation ${((angularDifference(aromaticExitAngle, aromaticOutwardAngle) * 180) / Math.PI).toFixed(2)} degrees`
    );
    assert.ok(
      remainingExteriorDeviation <= Math.PI / 6 + 1e-6,
      `expected the second heavy branch at ${centerAtomId} to stay inside the five-member exterior fan, got deviation ${((remainingExteriorDeviation * 180) / Math.PI).toFixed(2)} degrees`
    );
  });

  it('defers explicit hydrogens until attached ring blocks can finish an exocyclic alkene trigonal center', () => {
    const graph = createLayoutGraph(parseSMILES('CC(C)CCCC(C)C1CCC2C1(CCCC2=CC=C3CC(CCC3=C)O)C'), { suppressH: true });
    const component = graph.components[0];
    const adjacency = buildAdjacency(graph, new Set(component.atomIds));
    const result = layoutMixedFamily(graph, component, adjacency, buildScaffoldPlan(graph, component), graph.options.bondLength);
    const separations = sortedNeighborSeparations(adjacency, result.coords, 'C19');

    assert.equal(result.supported, true);
    assert.equal(separations.length, 3);
    for (const separation of separations) {
      assert.ok(Math.abs(separation - (2 * Math.PI) / 3) < 0.05, `expected C19 trigonal separations near 120 degrees, got ${((separation * 180) / Math.PI).toFixed(2)}`);
    }
  });

  it('chooses the mirrored attached-ring orientation when it gives an exocyclic alkene a cleaner trigonal geometry', () => {
    const graph = createLayoutGraph(parseSMILES('CC(C)CCCC(C)C1CCC2C1(CCCC2=CC=C3CC(CCC3=C)O)C'), { suppressH: true });
    const component = graph.components[0];
    const adjacency = buildAdjacency(graph, new Set(component.atomIds));
    const result = layoutMixedFamily(graph, component, adjacency, buildScaffoldPlan(graph, component), graph.options.bondLength);
    const separations = sortedNeighborSeparations(adjacency, result.coords, 'C25');

    assert.equal(result.supported, true);
    assert.equal(separations.length, 3);
    for (const separation of separations) {
      assert.ok(Math.abs(separation - (2 * Math.PI) / 3) < 0.05, `expected C25 trigonal separations near 120 degrees, got ${((separation * 180) / Math.PI).toFixed(2)}`);
    }
  });

  it('keeps the reported fused indole alkene attachment on a clean trigonal root angle through mixed placement and the full pipeline', () => {
    const smiles = 'Cc1[nH]c2ccccc2c1\\C=C\\c3c[nH]c4ccccc34';
    const graph = createLayoutGraph(parseSMILES(smiles), { suppressH: true });
    const component = graph.components[0];
    const adjacency = buildAdjacency(graph, new Set(component.atomIds));
    const mixedResult = layoutMixedFamily(graph, component, adjacency, buildScaffoldPlan(graph, component), graph.options.bondLength);
    const pipelineResult = runPipeline(parseSMILES(smiles), {
      suppressH: true,
      auditTelemetry: true
    });
    const mixedAttachmentAngle = bondAngleAtAtom(mixedResult.coords, 'C13', 'C12', 'C14');
    const pipelineAttachmentAngle = bondAngleAtAtom(pipelineResult.coords, 'C13', 'C12', 'C14');

    assert.equal(mixedResult.supported, true);
    assert.ok(
      Math.abs(mixedAttachmentAngle - ((2 * Math.PI) / 3)) < 1e-6,
      `expected the mixed-placement alkene root at C13 to stay exact, got ${((mixedAttachmentAngle * 180) / Math.PI).toFixed(2)} degrees`
    );
    assert.ok(
      Math.abs(pipelineAttachmentAngle - ((2 * Math.PI) / 3)) < 1e-6,
      `expected the final alkene root at C13 to stay exact, got ${((pipelineAttachmentAngle * 180) / Math.PI).toFixed(2)} degrees`
    );
    assert.equal(pipelineResult.metadata.audit.severeOverlapCount, 0);
  });

  it('keeps simple stilbene aryl alkene roots exact while aligning attached ring blocks by their local outward axes', () => {
    const graph = createLayoutGraph(parseSMILES('c1ccccc1\\C=C\\c2ccccc2'), { suppressH: true });
    const component = graph.components[0];
    const adjacency = buildAdjacency(graph, new Set(component.atomIds));
    const result = layoutMixedFamily(graph, component, adjacency, buildScaffoldPlan(graph, component), graph.options.bondLength);
    const leftAttachmentAngle = bondAngleAtAtom(result.coords, 'C6', 'C5', 'C7');
    const rightAttachmentAngle = bondAngleAtAtom(result.coords, 'C9', 'C8', 'C10');

    assert.equal(result.supported, true);
    assert.ok(Math.abs(leftAttachmentAngle - ((2 * Math.PI) / 3)) < 1e-6, `expected C6 to stay exact, got ${((leftAttachmentAngle * 180) / Math.PI).toFixed(2)} degrees`);
    assert.ok(Math.abs(rightAttachmentAngle - ((2 * Math.PI) / 3)) < 1e-6, `expected C9 to stay exact, got ${((rightAttachmentAngle * 180) / Math.PI).toFixed(2)} degrees`);
  });

  it('keeps an exocyclic alkene exit centered between the two ring bonds when a pending attached ring would otherwise skew it to one side', () => {
    const smiles = 'CC\\C(=C/1\\N=C(OC1=O)c2ccc(Cl)cc2Cl)\\N3CCC[C@H]3C(=O)N[C@@H](<Cc4ccc(O)cc4>)C(=O)N';
    const graph = createLayoutGraph(parseSMILES(smiles), { suppressH: true });
    const component = graph.components[0];
    const adjacency = buildAdjacency(graph, new Set(component.atomIds));
    const mixedResult = layoutMixedFamily(graph, component, adjacency, buildScaffoldPlan(graph, component), graph.options.bondLength);
    const pipelineResult = runPipeline(parseSMILES(smiles), { suppressH: true, auditTelemetry: true });

    for (const [label, coords] of [['mixed', mixedResult.coords], ['pipeline', pipelineResult.coords]]) {
      const c3FirstAngle = bondAngleAtAtom(coords, 'C3', 'C2', 'C4');
      const c3SecondAngle = bondAngleAtAtom(coords, 'C3', 'C2', 'N18');
      const c3ThirdAngle = bondAngleAtAtom(coords, 'C3', 'C4', 'N18');
      const firstAngle = bondAngleAtAtom(coords, 'C4', 'C8', 'C3');
      const secondAngle = bondAngleAtAtom(coords, 'C4', 'N5', 'C3');
      const firstAttachmentAngle = bondAngleAtAtom(coords, 'C10', 'C11', 'C6');
      const secondAttachmentAngle = bondAngleAtAtom(coords, 'C10', 'C16', 'C6');
      const amideAngle = bondAngleAtAtom(coords, 'N26', 'C24', 'C27');
      if (label === 'pipeline') {
        assert.ok(
          Math.abs(c3SecondAngle - c3ThirdAngle) < 1e-6
          && c3SecondAngle > ((7 * Math.PI) / 12),
          `expected the ${label} visible trigonal center at C3 to keep the N18 branch centered instead of collapsing to a 90/150 split, got ${((c3FirstAngle * 180) / Math.PI).toFixed(2)}, ${((c3SecondAngle * 180) / Math.PI).toFixed(2)}, and ${((c3ThirdAngle * 180) / Math.PI).toFixed(2)} degrees`
        );
      }
      assert.ok(
        Math.abs(firstAngle - secondAngle) < 1e-6,
        `expected the ${label} alkene exit to stay centered between the C4 ring bonds, got ${((firstAngle * 180) / Math.PI).toFixed(2)} and ${((secondAngle * 180) / Math.PI).toFixed(2)} degrees`
      );
      assert.ok(
        Math.abs(firstAttachmentAngle - secondAttachmentAngle) < 1e-6,
        `expected the ${label} chlorophenyl attachment at C10 to stay symmetric, got ${((firstAttachmentAngle * 180) / Math.PI).toFixed(2)} and ${((secondAttachmentAngle * 180) / Math.PI).toFixed(2)} degrees`
      );
      assert.ok(
        Math.abs(amideAngle - ((2 * Math.PI) / 3)) < 1e-6,
        `expected the ${label} amide-side N26 angle to stay at 120 degrees, got ${((amideAngle * 180) / Math.PI).toFixed(2)} degrees`
      );
    }

    assert.equal(mixedResult.supported, true);
    assert.equal(pipelineResult.metadata.audit.severeOverlapCount, 0);
    assert.equal(pipelineResult.metadata.audit.ok, true);
  });

  it('keeps oxime ether nitrogens bent in crowded fused mixed scaffolds', () => {
    const smiles = 'COC1=CC(=O)C2=C(O)C3=C(C(=O)C4(CCC5=CC6=C(C(=O)NC(C=NOCC7=CC=C(Cl)C=C7)=C6)C(O)=C45)C3=O)C(O)=C2C1=O';
    const graph = createLayoutGraph(parseSMILES(smiles), { suppressH: true });
    const component = graph.components[0];
    const adjacency = buildAdjacency(graph, new Set(component.atomIds));
    const mixedResult = layoutMixedFamily(graph, component, adjacency, buildScaffoldPlan(graph, component), graph.options.bondLength);
    const pipelineResult = runPipeline(parseSMILES(smiles), {
      suppressH: true,
      auditTelemetry: true
    });

    for (const [label, coords] of [['mixed', mixedResult.coords], ['pipeline', pipelineResult.coords]]) {
      const oximeAngle = bondAngleAtAtom(coords, 'N26', 'C25', 'O27');
      assert.ok(
        Math.abs(oximeAngle - ((2 * Math.PI) / 3)) < 1e-6,
        `expected the ${label} oxime ether N26 angle to stay at 120 degrees, got ${((oximeAngle * 180) / Math.PI).toFixed(2)} degrees`
      );
    }

    assert.equal(mixedResult.supported, true);
    assert.equal(pipelineResult.metadata.audit.ok, true);
  });

  it('lays out directly attached ring systems in deterministic sequence', () => {
    const graph = createLayoutGraph(makeBiphenyl());
    const component = graph.components[0];
    const plan = buildScaffoldPlan(graph, component);
    const result = layoutMixedFamily(graph, component, buildAdjacency(graph, new Set(component.atomIds)), plan, graph.options.bondLength);
    const firstRingCenter = centroid(['a0', 'a1', 'a2', 'a3', 'a4', 'a5'].map(atomId => result.coords.get(atomId)));
    const secondRingCenter = centroid(['b0', 'b1', 'b2', 'b3', 'b4', 'b5'].map(atomId => result.coords.get(atomId)));
    const linkerAxis = angleOf(sub(result.coords.get('b0'), result.coords.get('a0')));
    const centerAxis = angleOf(sub(secondRingCenter, firstRingCenter));
    assert.equal(result.supported, true);
    assert.equal(result.coords.size, 12);
    assert.ok(result.coords.has('a0'));
    assert.ok(result.coords.has('b0'));
    assert.ok(angularDifference(linkerAxis, centerAxis) < 0.15, 'expected directly linked phenyl rings to share a straight centroid axis');
  });

  it('lays out a chain-linked second ring system after the connector becomes reachable', () => {
    const graph = createLayoutGraph(makeBibenzyl());
    const component = graph.components[0];
    const plan = buildScaffoldPlan(graph, component);
    const result = layoutMixedFamily(graph, component, buildAdjacency(graph, new Set(component.atomIds)), plan, graph.options.bondLength);
    const firstAngle = bondAngleAtAtom(result.coords, 'c0', 'a0', 'c1');
    const secondAngle = bondAngleAtAtom(result.coords, 'c1', 'c0', 'b0');
    assert.equal(result.supported, true);
    assert.equal(result.coords.size, 14);
    assert.ok(result.coords.has('c0'));
    assert.ok(result.coords.has('c1'));
    assert.ok(result.coords.has('b0'));
    assert.ok(Math.abs(firstAngle - (2 * Math.PI) / 3) < 0.2, `expected first bibenzyl linker angle near 120 degrees, got ${((firstAngle * 180) / Math.PI).toFixed(2)}`);
    assert.ok(Math.abs(secondAngle - (2 * Math.PI) / 3) < 0.2, `expected second bibenzyl linker angle near 120 degrees, got ${((secondAngle * 180) / Math.PI).toFixed(2)}`);
  });

  it('lays out a methylene-linked second ring with a standard 120-degree linker angle', () => {
    const graph = createLayoutGraph(parseSMILES('c1ccccc1Cc1ccccc1'), { suppressH: true });
    const component = graph.components[0];
    const plan = buildScaffoldPlan(graph, component);
    const result = layoutMixedFamily(graph, component, buildAdjacency(graph, new Set(component.atomIds)), plan, graph.options.bondLength);
    const linkerAtomId = 'C7';
    const firstRingAttachmentAtomId = 'C6';
    const secondRingAttachmentAtomId = 'C8';
    const linkerAngle = bondAngleAtAtom(result.coords, linkerAtomId, firstRingAttachmentAtomId, secondRingAttachmentAtomId);

    assert.equal(result.supported, true);
    assert.ok(Math.abs(linkerAngle - (2 * Math.PI) / 3) < 0.2, `expected diphenylmethane linker angle near 120 degrees, got ${((linkerAngle * 180) / Math.PI).toFixed(2)}`);
  });

  it('keeps crowded direct aryl roots exact while keeping the benzoyl fan bounded', () => {
    const smiles = 'CC(=CCC12Oc3cc(O)ccc3C1(O)Oc4cc(O)c([C@H]5C=C(C)CC([C@H]5C(=O)c6ccc(O)cc6O)c7ccc(O)cc7O)c(O)c4C2=O)C';
    const result = runPipeline(parseSMILES(smiles), {
      suppressH: true,
      auditTelemetry: true
    });
    const coords = result.coords;
    const expectedTrigonal = (2 * Math.PI) / 3;
    const exactTolerance = 1e-6;
    const assertExactTrigonalCenter = (centerAtomId, neighborAtomIds) => {
      for (let firstIndex = 0; firstIndex < neighborAtomIds.length; firstIndex++) {
        for (let secondIndex = firstIndex + 1; secondIndex < neighborAtomIds.length; secondIndex++) {
          const angle = bondAngleAtAtom(coords, centerAtomId, neighborAtomIds[firstIndex], neighborAtomIds[secondIndex]);
          assert.ok(
            Math.abs(angle - expectedTrigonal) < exactTolerance,
            `expected ${centerAtomId} ${neighborAtomIds[firstIndex]}-${neighborAtomIds[secondIndex]} angle near 120 degrees, got ${((angle * 180) / Math.PI).toFixed(2)}`
          );
        }
      }
    };

    assert.equal(result.metadata.audit.ok, true);
    assertExactTrigonalCenter('C41', ['C28', 'C47', 'C42']);
    assertExactTrigonalCenter('C21', ['C19', 'C22', 'C49']);
    assertExactTrigonalCenter('C39', ['C33', 'C38', 'O40']);
    assertExactTrigonalCenter('C49', ['C21', 'O50', 'C51']);
    assertExactTrigonalCenter('C52', ['C5', 'O53', 'C51']);
    const bridgeHydroxylAngle = bondAngleAtAtom(coords, 'C14', 'C5', 'O15');
    assert.ok(
      Math.abs(bridgeHydroxylAngle - Math.PI) <= Math.PI / 30 + 1e-6,
      `expected C14-O15 bridge hydroxyl to stay near straight, got ${((bridgeHydroxylAngle * 180) / Math.PI).toFixed(2)} degrees`
    );

    const carbonylAngles = [
      bondAngleAtAtom(coords, 'C31', 'O32', 'C33'),
      bondAngleAtAtom(coords, 'C31', 'O32', 'C29'),
      bondAngleAtAtom(coords, 'C31', 'C33', 'C29')
    ].map(angle => (angle * 180) / Math.PI);
    assert.ok(
      Math.min(...carbonylAngles) >= 75 - 1e-6,
      `expected C31 benzoyl fan to stay bounded while C49 is exact, got ${carbonylAngles.map(angle => angle.toFixed(2)).join(', ')}`
    );
    assert.ok(
      Math.max(...carbonylAngles) <= 165 + 1e-6,
      `expected C31 benzoyl fan not to over-open beyond the accepted local relief, got ${carbonylAngles.map(angle => angle.toFixed(2)).join(', ')}`
    );
  });

  it('keeps fused lactone systems joined through a methylene linker on a standard bend', () => {
    const smiles = 'OC1=C(CC2=C(O)C3=C(OC2=O)C=CC=C3)C(=O)OC2=C1C=CC=C2';
    const graph = createLayoutGraph(parseSMILES(smiles), { suppressH: true });
    const component = graph.components[0];
    const plan = buildScaffoldPlan(graph, component);
    const mixedResult = layoutMixedFamily(graph, component, buildAdjacency(graph, new Set(component.atomIds)), plan, graph.options.bondLength);
    const pipelineResult = runPipeline(parseSMILES(smiles), {
      suppressH: true,
      auditTelemetry: true
    });
    const pipelineWithHydrogens = runPipeline(parseSMILES(smiles), {
      auditTelemetry: true
    });
    const mixedLinkerAngle = bondAngleAtAtom(mixedResult.coords, 'C4', 'C3', 'C5');
    const pipelineLinkerAngle = bondAngleAtAtom(pipelineResult.coords, 'C4', 'C3', 'C5');
    const assertC2HydroxyGeometry = (coords, label) => {
      const hydroxyDeviation = bestLocalRingDeviation(graph, coords, 'C2', 'O1');
      const firstHydroxyAngle = bondAngleAtAtom(coords, 'C2', 'C3', 'O1');
      const secondHydroxyAngle = bondAngleAtAtom(coords, 'C2', 'C21', 'O1');

      assert.ok(hydroxyDeviation < 1e-6, `expected ${label} C2-O1 to follow the exact local ring-outward angle, got ${hydroxyDeviation.toFixed(6)} rad`);
      assert.ok(Math.abs(firstHydroxyAngle - (2 * Math.PI) / 3) < 0.05, `expected ${label} C3-C2-O1 near 120 degrees, got ${((firstHydroxyAngle * 180) / Math.PI).toFixed(2)}`);
      assert.ok(Math.abs(secondHydroxyAngle - (2 * Math.PI) / 3) < 0.05, `expected ${label} C21-C2-O1 near 120 degrees, got ${((secondHydroxyAngle * 180) / Math.PI).toFixed(2)}`);
    };
    const assertC17CarbonylGeometry = (coords, label) => {
      const firstCarbonylAngle = bondAngleAtAtom(coords, 'C17', 'C3', 'O18');
      const secondCarbonylAngle = bondAngleAtAtom(coords, 'C17', 'O19', 'O18');
      const ringCarbonylAngle = bondAngleAtAtom(coords, 'C17', 'C3', 'O19');
      const neighboringCarbonylClearance = distance(coords.get('O18'), coords.get('O12'));

      assert.ok(Math.abs(firstCarbonylAngle - (2 * Math.PI) / 3) < 0.05, `expected ${label} C3-C17-O18 near 120 degrees, got ${((firstCarbonylAngle * 180) / Math.PI).toFixed(2)}`);
      assert.ok(Math.abs(secondCarbonylAngle - (2 * Math.PI) / 3) < 0.05, `expected ${label} O19-C17-O18 near 120 degrees, got ${((secondCarbonylAngle * 180) / Math.PI).toFixed(2)}`);
      assert.ok(Math.abs(ringCarbonylAngle - (2 * Math.PI) / 3) < 0.05, `expected ${label} C3-C17-O19 near 120 degrees, got ${((ringCarbonylAngle * 180) / Math.PI).toFixed(2)}`);
      assert.ok(neighboringCarbonylClearance > graph.options.bondLength * 0.8, `expected ${label} C17 carbonyl leaf to stay clear of the neighboring lactone oxygen, got ${neighboringCarbonylClearance.toFixed(3)}`);
    };
    const assertLinkedRingExitGeometry = (coords, label) => {
      const firstLinkerExitAngle = bondAngleAtAtom(coords, 'C3', 'C2', 'C4');
      const secondLinkerExitAngle = bondAngleAtAtom(coords, 'C3', 'C4', 'C17');
      const firstRingAngle = bondAngleAtAtom(coords, 'C3', 'C2', 'C17');
      const firstPendingExitAngle = bondAngleAtAtom(coords, 'C5', 'C4', 'C6');
      const secondPendingExitAngle = bondAngleAtAtom(coords, 'C5', 'C4', 'C11');
      const secondRingAngle = bondAngleAtAtom(coords, 'C5', 'C6', 'C11');
      const maxExitDeviation = Math.max(
        Math.abs(firstLinkerExitAngle - (2 * Math.PI) / 3),
        Math.abs(secondLinkerExitAngle - (2 * Math.PI) / 3),
        Math.abs(firstPendingExitAngle - (2 * Math.PI) / 3),
        Math.abs(secondPendingExitAngle - (2 * Math.PI) / 3)
      );

      assert.ok(maxExitDeviation < 0.2, `expected ${label} C3/C5 linker exits to share the bridge distortion instead of leaving a 100/140 split, got ${((firstLinkerExitAngle * 180) / Math.PI).toFixed(2)}, ${((secondLinkerExitAngle * 180) / Math.PI).toFixed(2)}, ${((firstPendingExitAngle * 180) / Math.PI).toFixed(2)}, and ${((secondPendingExitAngle * 180) / Math.PI).toFixed(2)} degrees`);
      assert.ok(Math.abs(firstRingAngle - (2 * Math.PI) / 3) < 0.05, `expected ${label} C2-C3-C17 near 120 degrees, got ${((firstRingAngle * 180) / Math.PI).toFixed(2)}`);
      assert.ok(Math.abs(secondRingAngle - (2 * Math.PI) / 3) < 0.05, `expected ${label} C6-C5-C11 near 120 degrees, got ${((secondRingAngle * 180) / Math.PI).toFixed(2)}`);
    };
    const assertC4VisibleHydrogenSpread = (coords, label) => {
      const centerPosition = coords.get('C4');
      const neighborAngles = ['C3', 'C5', 'H27', 'H28'].map(atomId => angleOf(sub(coords.get(atomId), centerPosition)));
      let minSeparation = Infinity;
      let maxSeparation = 0;
      for (let firstIndex = 0; firstIndex < neighborAngles.length; firstIndex++) {
        for (let secondIndex = firstIndex + 1; secondIndex < neighborAngles.length; secondIndex++) {
          const separation = angularDifference(neighborAngles[firstIndex], neighborAngles[secondIndex]);
          minSeparation = Math.min(minSeparation, separation);
          maxSeparation = Math.max(maxSeparation, separation);
        }
      }

      assert.ok(minSeparation > 7 * Math.PI / 18, `expected ${label} C4 hydrogens to avoid collapsed projected-tetrahedral slots, got minimum separation ${((minSeparation * 180) / Math.PI).toFixed(2)} degrees`);
      assert.ok(maxSeparation < 17 * Math.PI / 18, `expected ${label} C4 hydrogens to avoid flat projected-tetrahedral slots, got maximum separation ${((maxSeparation * 180) / Math.PI).toFixed(2)} degrees`);
    };

    assert.equal(mixedResult.supported, true);
    assert.ok(Math.abs(mixedLinkerAngle - (2 * Math.PI) / 3) < 0.05, `expected mixed fused-lactone linker angle near 120 degrees, got ${((mixedLinkerAngle * 180) / Math.PI).toFixed(2)}`);
    assertC2HydroxyGeometry(mixedResult.coords, 'mixed');
    assertC17CarbonylGeometry(mixedResult.coords, 'mixed');
    assertLinkedRingExitGeometry(mixedResult.coords, 'mixed');
    assert.equal(pipelineResult.metadata.audit.ok, true);
    assert.ok(Math.abs(pipelineLinkerAngle - (2 * Math.PI) / 3) < 0.05, `expected full-pipeline fused-lactone linker angle near 120 degrees, got ${((pipelineLinkerAngle * 180) / Math.PI).toFixed(2)}`);
    assertC2HydroxyGeometry(pipelineResult.coords, 'full-pipeline');
    assertC17CarbonylGeometry(pipelineResult.coords, 'full-pipeline');
    assertLinkedRingExitGeometry(pipelineResult.coords, 'full-pipeline');
    assert.equal(pipelineWithHydrogens.metadata.audit.ok, true);
    assert.ok(Math.abs(bondAngleAtAtom(pipelineWithHydrogens.coords, 'C4', 'C3', 'C5') - (2 * Math.PI) / 3) < 0.05, `expected visible-H full-pipeline fused-lactone linker angle near 120 degrees, got ${((bondAngleAtAtom(pipelineWithHydrogens.coords, 'C4', 'C3', 'C5') * 180) / Math.PI).toFixed(2)}`);
    assertC4VisibleHydrogenSpread(pipelineWithHydrogens.coords, 'visible-H full-pipeline');
  });

  it('keeps fused aryl cyclobutyl methylene linkers bent instead of straight', () => {
    const smiles = 'FC1=CC=CC(CC2C(CC3=CC=C(CC4(CCC4)NS(=O)=O)C=C23)[NH+]2CCC2)=C1';
    const result = runPipeline(parseSMILES(smiles), {
      auditTelemetry: true
    });
    const linkerAngle = bondAngleAtAtom(result.coords, 'C15', 'C14', 'C16');

    assert.equal(result.metadata.audit.ok, true);
    assert.ok(Math.abs(linkerAngle - (2 * Math.PI) / 3) < 0.05, `expected C14-C15-C16 to keep a visible 120-degree bend, got ${((linkerAngle * 180) / Math.PI).toFixed(2)} degrees`);
  });

  it('keeps asymmetric fused-heteroaryl benzyl linkers on the standard 120-degree zigzag instead of pinching them to 60 degrees', () => {
    const graph = createLayoutGraph(parseSMILES('[H][C@@](CC)(CO)NC1=NC2=C(C=NN2C(NCC2=CC=CC=C2)=N1)C(C)C'), { suppressH: true });
    const component = graph.components[0];
    const plan = buildScaffoldPlan(graph, component);
    const result = layoutMixedFamily(graph, component, buildAdjacency(graph, new Set(component.atomIds)), plan, graph.options.bondLength);
    const fusedAttachmentRing = (graph.atomToRings.get('C15') ?? [])[0];
    const fusedAttachmentOutwardAngle = angleOf(sub(
      result.coords.get('C15'),
      centroid(fusedAttachmentRing.atomIds.map(atomId => result.coords.get(atomId)).filter(Boolean))
    ));
    const fusedExitAngle = angleOf(sub(result.coords.get('N16'), result.coords.get('C15')));
    const firstLinkerAngle = bondAngleAtAtom(result.coords, 'N16', 'C15', 'C17');
    const benzylicLinkerAngle = bondAngleAtAtom(result.coords, 'C17', 'N16', 'C18');
    const ringAttachmentAngle = bondAngleAtAtom(result.coords, 'C18', 'C17', 'C19');

    assert.equal(result.supported, true);
    assert.ok(angularDifference(fusedExitAngle, fusedAttachmentOutwardAngle) < 1e-6, 'expected fused heteroaryl linker root to follow the local ring outward axis');
    assert.ok(Math.abs(firstLinkerAngle - (2 * Math.PI) / 3) < 0.05, `expected fused-root linker angle near 120 degrees, got ${((firstLinkerAngle * 180) / Math.PI).toFixed(2)}`);
    assert.ok(Math.abs(benzylicLinkerAngle - (2 * Math.PI) / 3) < 0.05, `expected benzylic linker angle near 120 degrees, got ${((benzylicLinkerAngle * 180) / Math.PI).toFixed(2)}`);
    assert.ok(Math.abs(ringAttachmentAngle - (2 * Math.PI) / 3) < 0.05, `expected aromatic attachment angle near 120 degrees, got ${((ringAttachmentAngle * 180) / Math.PI).toFixed(2)}`);
  });

  it('keeps fused imide N16 benzyl exits exact and outward', () => {
    const smiles = 'CONC(=O)NC1=CC=C(C=C1)C1=CN2N(CC3=CC=CC=C3F)C(=O)N(C(=O)C2=C1C[NH+](C)C)C1=CC=C(OC)N=N1';
    const graph = createLayoutGraph(parseSMILES(smiles), { suppressH: true });
    const component = graph.components[0];
    const plan = buildScaffoldPlan(graph, component);
    const mixedResult = layoutMixedFamily(graph, component, buildAdjacency(graph, new Set(component.atomIds)), plan, graph.options.bondLength);
    const pipelineResult = runPipeline(parseSMILES(smiles), {
      suppressH: true,
      auditTelemetry: true
    });
    const appPathMolecule = parseSMILES(smiles);
    appPathMolecule.hideHydrogens();
    const appPathResult = generateCoords(appPathMolecule, {
      suppressH: true,
      auditTelemetry: true
    });

    const assertN16Geometry = (layoutGraph, coords, label) => {
      const ring = (layoutGraph.atomToRings.get('N16') ?? [])
        .find(candidateRing => candidateRing.atomIds.includes('C25') && candidateRing.atomIds.includes('N15'));
      assert.ok(ring, `expected ${label} to keep the imide ring containing N16`);

      const ringCenter = centroid(ring.atomIds.map(atomId => coords.get(atomId)).filter(Boolean));
      const outwardAngle = angleOf(sub(coords.get('N16'), ringCenter));
      const benzylAngle = angleOf(sub(coords.get('C17'), coords.get('N16')));
      const firstAngle = bondAngleAtAtom(coords, 'N16', 'C17', 'C25');
      const secondAngle = bondAngleAtAtom(coords, 'N16', 'C17', 'N15');
      const thirdAngle = bondAngleAtAtom(coords, 'N16', 'C25', 'N15');

      assert.ok(
        angularDifference(benzylAngle, outwardAngle) < 1e-6,
        `expected ${label} N16-C17 to follow the imide ring outward axis, got ${((angularDifference(benzylAngle, outwardAngle) * 180) / Math.PI).toFixed(2)} degrees`
      );
      for (const [name, angle] of [
        ['C17-N16-C25', firstAngle],
        ['C17-N16-N15', secondAngle],
        ['C25-N16-N15', thirdAngle]
      ]) {
        assert.ok(
          Math.abs(angle - ((2 * Math.PI) / 3)) < 1e-6,
          `expected ${label} ${name} to stay exact at 120 degrees, got ${((angle * 180) / Math.PI).toFixed(2)}`
        );
      }
    };

    assert.equal(mixedResult.supported, true);
    assertN16Geometry(graph, mixedResult.coords, 'mixed layout');
    assert.equal(pipelineResult.metadata.audit.ok, true);
    assertN16Geometry(pipelineResult.layoutGraph, pipelineResult.coords, 'pipeline layout');
    assert.equal(appPathResult.metadata.audit.ok, true);
    assertN16Geometry(appPathResult.layoutGraph, appPathResult.coords, 'hidden-H app layout');
  });

  it('keeps reported chlorophenyl amide linkers on the exact aromatic outward axis with near-ideal local amide geometry', () => {
    const graph = createLayoutGraph(parseSMILES('CC1=NC(NC2=NC=C(S2)C(=O)NC2=C(C)C=CC=C2Cl)=CC(=N1)N1CCN(CCO)CC1'), { suppressH: true });
    const component = graph.components[0];
    const plan = buildScaffoldPlan(graph, component);
    const result = layoutMixedFamily(graph, component, buildAdjacency(graph, new Set(component.atomIds)), plan, graph.options.bondLength);
    const chlorophenylRing = (graph.atomToRings.get('C14') ?? [])[0];
    const chlorophenylOutwardAngle = angleOf(sub(
      result.coords.get('C14'),
      centroid(chlorophenylRing.atomIds.map(atomId => result.coords.get(atomId)).filter(Boolean))
    ));
    const linkerDeviation = angularDifference(chlorophenylOutwardAngle, angleOf(sub(result.coords.get('N13'), result.coords.get('C14'))));
    const firstTrigonalAngle = bondAngleAtAtom(result.coords, 'C14', 'N13', 'C15');
    const secondTrigonalAngle = bondAngleAtAtom(result.coords, 'C14', 'N13', 'C20');
    const thirdTrigonalAngle = bondAngleAtAtom(result.coords, 'C14', 'C15', 'C20');
    const carbonylFirstAngle = bondAngleAtAtom(result.coords, 'C11', 'C9', 'O12');
    const carbonylSecondAngle = bondAngleAtAtom(result.coords, 'C11', 'C9', 'N13');
    const carbonylThirdAngle = bondAngleAtAtom(result.coords, 'C11', 'O12', 'N13');
    const amideNitrogenAngle = bondAngleAtAtom(result.coords, 'N13', 'C11', 'C14');

    assert.equal(result.supported, true);
    assert.ok(linkerDeviation < 1e-6, `expected the chlorophenyl amide root to follow the exact aromatic outward axis, got ${linkerDeviation.toFixed(6)} rad`);
    assert.ok(Math.abs(firstTrigonalAngle - (2 * Math.PI) / 3) < 1e-6, `expected N13-C14-C15 to stay at 120 degrees, got ${((firstTrigonalAngle * 180) / Math.PI).toFixed(2)}`);
    assert.ok(Math.abs(secondTrigonalAngle - (2 * Math.PI) / 3) < 1e-6, `expected N13-C14-C20 to stay at 120 degrees, got ${((secondTrigonalAngle * 180) / Math.PI).toFixed(2)}`);
    assert.ok(Math.abs(thirdTrigonalAngle - (2 * Math.PI) / 3) < 1e-6, `expected C15-C14-C20 to stay at 120 degrees, got ${((thirdTrigonalAngle * 180) / Math.PI).toFixed(2)}`);
    assert.ok(Math.abs(carbonylFirstAngle - (2 * Math.PI) / 3) < 0.06, `expected C9-C11-O12 to stay near 120 degrees, got ${((carbonylFirstAngle * 180) / Math.PI).toFixed(2)}`);
    assert.ok(Math.abs(carbonylSecondAngle - (2 * Math.PI) / 3) < 0.06, `expected C9-C11-N13 to stay near 120 degrees, got ${((carbonylSecondAngle * 180) / Math.PI).toFixed(2)}`);
    assert.ok(Math.abs(carbonylThirdAngle - (2 * Math.PI) / 3) < 0.06, `expected O12-C11-N13 to stay near 120 degrees, got ${((carbonylThirdAngle * 180) / Math.PI).toFixed(2)}`);
    assert.ok(Math.abs(amideNitrogenAngle - (2 * Math.PI) / 3) < 0.06, `expected C11-N13-C14 to stay near 120 degrees, got ${((amideNitrogenAngle * 180) / Math.PI).toFixed(2)}`);
  });

  it('keeps omitted-h direct-attached piperidine roots on the exact local ring outward bisector', () => {
    const smiles = 'COc1cccc(F)c1C(=O)Nc2c[nH]nc2C(=O)NC3CCNCC3';
    const graph = createLayoutGraph(parseSMILES(smiles), { suppressH: true });
    const component = graph.components[0];
    const plan = buildScaffoldPlan(graph, component);
    const mixedResult = layoutMixedFamily(graph, component, buildAdjacency(graph, new Set(component.atomIds)), plan, graph.options.bondLength);
    const pipelineResult = runPipeline(parseSMILES(smiles), { suppressH: true });

    const assertRootGeometry = (coords, label) => {
      const rootAngle = angleOf(sub(coords.get('N21'), coords.get('C22')));
      const outwardAngle = angleOf(sub(
        coords.get('C22'),
        centroid(['C23', 'C27'].map(atomId => coords.get(atomId)))
      ));
      const firstAngle = bondAngleAtAtom(coords, 'C22', 'N21', 'C23');
      const secondAngle = bondAngleAtAtom(coords, 'C22', 'N21', 'C27');

      assert.ok(
        angularDifference(rootAngle, outwardAngle) < 1e-6,
        `expected ${label} N21-C22 to follow the exact piperidine-root outward bisector`
      );
      assert.ok(
        Math.abs(firstAngle - secondAngle) < 1e-6,
        `expected ${label} N21-C22-C23 and N21-C22-C27 to match, got ${((firstAngle * 180) / Math.PI).toFixed(2)} and ${((secondAngle * 180) / Math.PI).toFixed(2)}`
      );
      assert.ok(
        Math.abs(firstAngle - (2 * Math.PI) / 3) < 1e-6,
        `expected ${label} N21-C22-C23 to stay at 120 degrees, got ${((firstAngle * 180) / Math.PI).toFixed(2)}`
      );
    };

    assert.equal(mixedResult.supported, true);
    assertRootGeometry(mixedResult.coords, 'mixed layout');
    assertRootGeometry(pipelineResult.coords, 'pipeline layout');
  });

  it('uses the clean acyclic zigzag side for direct-attached heteroaryl roots', () => {
    const smiles = 'CC(=O)SCCN(CCC1=CC=CC=C1)C(=O)NCCN1C=CN=C1';
    const graph = createLayoutGraph(parseSMILES(smiles), { suppressH: true });
    const component = graph.components[0];
    const plan = buildScaffoldPlan(graph, component);
    const mixedResult = layoutMixedFamily(graph, component, buildAdjacency(graph, new Set(component.atomIds)), plan, graph.options.bondLength);
    const pipelineResult = runPipeline(parseSMILES(smiles), {
      suppressH: true,
      auditTelemetry: true
    });

    const assertHeteroarylRoot = (layoutGraph, coords, label) => {
      const ring = (layoutGraph.atomToRings.get('N21') ?? [])[0];
      const adjacency = buildAdjacency(layoutGraph, new Set(layoutGraph.components[0].atomIds));
      const outwardAngle = angleOf(sub(
        coords.get('N21'),
        centroid(ring.atomIds.map(atomId => coords.get(atomId)).filter(Boolean))
      ));
      const parentAngle = angleOf(sub(coords.get('C20'), coords.get('N21')));
      const separations = sortedHeavyNeighborSeparations(adjacency, coords, 'N21', layoutGraph);

      assert.ok(
        angularDifference(parentAngle, outwardAngle) < 1e-6,
        `expected ${label} C20-N21 to follow the imidazole N outward axis, got ${((angularDifference(parentAngle, outwardAngle) * 180) / Math.PI).toFixed(2)} degrees`
      );
      assert.ok(Math.abs(separations[0] - (3 * Math.PI) / 5) < 1e-6);
      assert.ok(Math.abs(separations[1] - (7 * Math.PI) / 10) < 1e-6);
      assert.ok(Math.abs(separations[2] - (7 * Math.PI) / 10) < 1e-6);
    };

    assert.equal(mixedResult.supported, true);
    assertHeteroarylRoot(graph, mixedResult.coords, 'mixed layout');
    assert.equal(pipelineResult.metadata.audit.ok, true);
    assertHeteroarylRoot(pipelineResult.layoutGraph, pipelineResult.coords, 'pipeline layout');
  });

  it('flips the dimethoxybenzyl ring while balancing the C3 ester and C5 anchor', () => {
    const smiles = 'COC(=O)C1N(CC2=CC=CC(OC)=C2OC)C(=NC(O)=C1[O-])C1=CSC=C1NC(=O)[N-]S(=O)(=O)C1=CC=CC=C1Cl';
    const graph = createLayoutGraph(parseSMILES(smiles), { suppressH: true });
    const component = graph.components[0];
    const plan = buildScaffoldPlan(graph, component);
    const mixedResult = layoutMixedFamily(graph, component, buildAdjacency(graph, new Set(component.atomIds)), plan, graph.options.bondLength);
    const pipelineResult = runPipeline(parseSMILES(smiles), {
      suppressH: true,
      auditTelemetry: true
    });

    const assertC8Exit = (coords, label) => {
      const firstRingAngle = bondAngleAtAtom(coords, 'C8', 'C15', 'C7');
      const secondRingAngle = bondAngleAtAtom(coords, 'C8', 'C9', 'C7');
      const expectedAngle = (2 * Math.PI) / 3;

      assert.ok(
        Math.abs(firstRingAngle - expectedAngle) < 1e-6,
        `expected ${label} C15-C8-C7 to be 120 degrees, got ${((firstRingAngle * 180) / Math.PI).toFixed(2)} degrees`
      );
      assert.ok(
        Math.abs(secondRingAngle - expectedAngle) < 1e-6,
        `expected ${label} C9-C8-C7 to be 120 degrees, got ${((secondRingAngle * 180) / Math.PI).toFixed(2)} degrees`
      );
    };
    const assertC3Ester = (coords, label) => {
      const maxDeviation = 12.1 * Math.PI / 180;
      for (const [firstNeighborAtomId, secondNeighborAtomId] of [
        ['O2', 'O4'],
        ['O2', 'C5'],
        ['O4', 'C5']
      ]) {
        const angle = bondAngleAtAtom(coords, 'C3', firstNeighborAtomId, secondNeighborAtomId);
        assert.ok(
          Math.abs(angle - ((2 * Math.PI) / 3)) <= maxDeviation,
          `expected ${label} ${firstNeighborAtomId}-C3-${secondNeighborAtomId} to stay within 12 degrees of 120, got ${((angle * 180) / Math.PI).toFixed(2)} degrees`
        );
      }
    };
    const assertC5Anchor = (coords, label) => {
      const maxDeviation = 12.1 * Math.PI / 180;
      for (const [firstNeighborAtomId, secondNeighborAtomId] of [
        ['C3', 'N6'],
        ['C3', 'C22'],
        ['N6', 'C22']
      ]) {
        const angle = bondAngleAtAtom(coords, 'C5', firstNeighborAtomId, secondNeighborAtomId);
        assert.ok(
          Math.abs(angle - ((2 * Math.PI) / 3)) <= maxDeviation,
          `expected ${label} ${firstNeighborAtomId}-C5-${secondNeighborAtomId} to stay within 12 degrees of 120, got ${((angle * 180) / Math.PI).toFixed(2)} degrees`
        );
      }
    };

    assert.equal(mixedResult.supported, true);
    assertC8Exit(mixedResult.coords, 'mixed layout');
    assertC3Ester(mixedResult.coords, 'mixed layout');
    assertC5Anchor(mixedResult.coords, 'mixed layout');
    assert.equal(pipelineResult.metadata.audit.ok, true);
    assertC8Exit(pipelineResult.coords, 'pipeline layout');
    assertC3Ester(pipelineResult.coords, 'pipeline layout');
    assertC5Anchor(pipelineResult.coords, 'pipeline layout');
  });

  it('snaps aryl carbonyl exits onto the exact aromatic outward bisector', () => {
    const smiles = 'COC1=CC=C(C(=O)N(CCC(C)C)C(CC2=CC=CC=C2C[NH+]2CCCC2)C2=NC3=CC=CC=C3N2)C(Cl)=C1OC';
    const graph = createLayoutGraph(parseSMILES(smiles), { suppressH: true });
    const component = graph.components[0];
    const plan = buildScaffoldPlan(graph, component);
    const mixedResult = layoutMixedFamily(graph, component, buildAdjacency(graph, new Set(component.atomIds)), plan, graph.options.bondLength);
    const pipelineResult = runPipeline(parseSMILES(smiles), {
      suppressH: true,
      auditTelemetry: true
    });

    const assertC6CarbonylExit = (coords, label) => {
      for (const [name, angle] of [
        ['C5-C6-C7', bondAngleAtAtom(coords, 'C6', 'C5', 'C7')],
        ['C7-C6-C39', bondAngleAtAtom(coords, 'C6', 'C7', 'C39')],
        ['C6-C7-O8', bondAngleAtAtom(coords, 'C7', 'C6', 'O8')],
        ['C6-C7-N9', bondAngleAtAtom(coords, 'C7', 'C6', 'N9')],
        ['O8-C7-N9', bondAngleAtAtom(coords, 'C7', 'O8', 'N9')]
      ]) {
        assert.ok(
          Math.abs(angle - ((2 * Math.PI) / 3)) < 1e-6,
          `expected ${label} ${name} to stay at 120 degrees, got ${((angle * 180) / Math.PI).toFixed(2)}`
        );
      }
    };

    assert.equal(mixedResult.supported, true);
    assertC6CarbonylExit(mixedResult.coords, 'mixed layout');
    assert.equal(pipelineResult.metadata.audit.ok, true);
    assertC6CarbonylExit(pipelineResult.coords, 'pipeline layout');
  });

  it('keeps the amide-linked piperidine on the parent trigonal bisector while making C6 exact too', () => {
    const smiles = 'C[NH+]1CCC(CC1)N(C(=O)C1CCC1)C1=CC=CC(NC(=O)C2=CC=C(F)C=C2Cl)=C1';
    const graph = createLayoutGraph(parseSMILES(smiles), { suppressH: true });
    const component = graph.components[0];
    const plan = buildScaffoldPlan(graph, component);
    const mixedResult = layoutMixedFamily(graph, component, buildAdjacency(graph, new Set(component.atomIds)), plan, graph.options.bondLength);
    const pipelineResult = runPipeline(parseSMILES(smiles), { suppressH: true });

    const assertParentTrigonalBridge = (coords, label) => {
      const ringReadability = measureRingSubstituentReadability(graph, coords);
      const n9ToC6Angle = angleOf(sub(coords.get('C6'), coords.get('N9')));
      const trigonalBisector = angleOf(sub(
        coords.get('N9'),
        centroid(['C10', 'C16'].map(atomId => coords.get(atomId)))
      ));
      const c6ToN9Angle = angleOf(sub(coords.get('N9'), coords.get('C6')));
      const c6OutwardBisector = angleOf(sub(
        coords.get('C6'),
        centroid(['C5', 'C7'].map(atomId => coords.get(atomId)))
      ));
      const firstAngle = bondAngleAtAtom(coords, 'N9', 'C10', 'C16');
      const secondAngle = bondAngleAtAtom(coords, 'N9', 'C10', 'C6');
      const thirdAngle = bondAngleAtAtom(coords, 'N9', 'C16', 'C6');
      const c6FirstAngle = bondAngleAtAtom(coords, 'C6', 'C5', 'N9');
      const c6SecondAngle = bondAngleAtAtom(coords, 'C6', 'C7', 'N9');

      assert.equal(ringReadability.failingSubstituentCount, 0, `expected ${label} to avoid linked-ring readability failures`);
      assert.ok(
        angularDifference(n9ToC6Angle, trigonalBisector) < 1e-6,
        `expected ${label} N9-C6 to follow the exact parent trigonal bisector`
      );
      assert.ok(
        Math.abs(firstAngle - (2 * Math.PI) / 3) < 1e-6,
        `expected ${label} C10-N9-C16 to stay at 120 degrees, got ${((firstAngle * 180) / Math.PI).toFixed(2)}`
      );
      assert.ok(
        Math.abs(secondAngle - (2 * Math.PI) / 3) < 1e-6,
        `expected ${label} C10-N9-C6 to stay at 120 degrees, got ${((secondAngle * 180) / Math.PI).toFixed(2)}`
      );
      assert.ok(
        Math.abs(thirdAngle - (2 * Math.PI) / 3) < 1e-6,
        `expected ${label} C16-N9-C6 to stay at 120 degrees, got ${((thirdAngle * 180) / Math.PI).toFixed(2)}`
      );
      assert.ok(
        angularDifference(c6ToN9Angle, c6OutwardBisector) < 1e-6,
        `expected ${label} C6-N9 to follow the exact local ring-outward bisector`
      );
      assert.ok(
        Math.abs(c6FirstAngle - (2 * Math.PI) / 3) < 1e-6,
        `expected ${label} C5-C6-N9 to stay at 120 degrees, got ${((c6FirstAngle * 180) / Math.PI).toFixed(2)}`
      );
      assert.ok(
        Math.abs(c6SecondAngle - (2 * Math.PI) / 3) < 1e-6,
        `expected ${label} C7-C6-N9 to stay at 120 degrees, got ${((c6SecondAngle * 180) / Math.PI).toFixed(2)}`
      );
    };

    assert.equal(mixedResult.supported, true);
    assertParentTrigonalBridge(mixedResult.coords, 'mixed layout');
    assertParentTrigonalBridge(pipelineResult.coords, 'pipeline layout');
  });

  it('keeps direct-attached heteroaryl amide carbonyl roots exact while the heteroaryl root stays on its ring outward axis', () => {
    const smiles = 'Fc1ccccc1N(CC(=O)NC2CCCCC2)C(=O)c3csnn3';
    const graph = createLayoutGraph(parseSMILES(smiles), { suppressH: true });
    const component = graph.components[0];
    const plan = buildScaffoldPlan(graph, component);
    const mixedResult = layoutMixedFamily(graph, component, buildAdjacency(graph, new Set(component.atomIds)), plan, graph.options.bondLength);
    const pipelineResult = runPipeline(parseSMILES(smiles), { suppressH: true });

    const assertAttachmentGeometry = (layoutGraph, coords, label) => {
      const firstAngle = bondAngleAtAtom(coords, 'C19', 'N8', 'O20');
      const secondAngle = bondAngleAtAtom(coords, 'C19', 'N8', 'C21');
      const thirdAngle = bondAngleAtAtom(coords, 'C19', 'O20', 'C21');
      const ringExitDeviation = bestLocalRingDeviation(layoutGraph, coords, 'C21', 'C19');

      assert.ok(
        Math.abs(firstAngle - (2 * Math.PI) / 3) < 1e-6,
        `expected ${label} N8-C19-O20 to stay at 120 degrees, got ${((firstAngle * 180) / Math.PI).toFixed(2)}`
      );
      assert.ok(
        Math.abs(secondAngle - (2 * Math.PI) / 3) < 1e-6,
        `expected ${label} N8-C19-C21 to stay at 120 degrees, got ${((secondAngle * 180) / Math.PI).toFixed(2)}`
      );
      assert.ok(
        Math.abs(thirdAngle - (2 * Math.PI) / 3) < 1e-6,
        `expected ${label} O20-C19-C21 to stay at 120 degrees, got ${((thirdAngle * 180) / Math.PI).toFixed(2)}`
      );
      assert.ok(
        ringExitDeviation < 1e-6,
        `expected ${label} C21 root to keep the exact local ring outward exit for C19, got ${((ringExitDeviation * 180) / Math.PI).toFixed(2)} degrees`
      );
    };

    assert.equal(mixedResult.supported, true);
    assertAttachmentGeometry(graph, mixedResult.coords, 'mixed layout');
    assertAttachmentGeometry(pipelineResult.layoutGraph, pipelineResult.coords, 'pipeline layout');
  });

  it('keeps short heteroamide ring linkers on a clean 120-degree continuation when a carbonyl carbon sits inside the linker path', () => {
    const smiles = 'CCNC(=O)[C@@H]1C[C@H](<CN1C\\C(=C\\C)\\C>)NC(=O)c2cnc(O)cn2';
    const graph = createLayoutGraph(parseSMILES(smiles), { suppressH: true });
    const component = graph.components[0];
    const plan = buildScaffoldPlan(graph, component);
    const mixedResult = layoutMixedFamily(graph, component, buildAdjacency(graph, new Set(component.atomIds)), plan, graph.options.bondLength);
    const pipelineResult = runPipeline(parseSMILES(smiles), { suppressH: true });

    const assertLinkerGeometry = (coords, label) => {
      const amideNitrogenAngle = bondAngleAtAtom(coords, 'N18', 'C9', 'C19');
      const carbonylFirstAngle = bondAngleAtAtom(coords, 'C19', 'C21', 'N18');
      const carbonylSecondAngle = bondAngleAtAtom(coords, 'C19', 'O20', 'N18');

      assert.ok(Math.abs(amideNitrogenAngle - (2 * Math.PI) / 3) < 1e-6, `expected ${label} C9-N18-C19 to stay at 120 degrees, got ${((amideNitrogenAngle * 180) / Math.PI).toFixed(2)}`);
      assert.ok(Math.abs(carbonylFirstAngle - (2 * Math.PI) / 3) < 1e-6, `expected ${label} C21-C19-N18 to stay at 120 degrees, got ${((carbonylFirstAngle * 180) / Math.PI).toFixed(2)}`);
      assert.ok(Math.abs(carbonylSecondAngle - (2 * Math.PI) / 3) < 1e-6, `expected ${label} O20-C19-N18 to stay at 120 degrees, got ${((carbonylSecondAngle * 180) / Math.PI).toFixed(2)}`);
    };

    assert.equal(mixedResult.supported, true);
    assertLinkerGeometry(mixedResult.coords, 'mixed layout');
    assertLinkerGeometry(pipelineResult.coords, 'pipeline layout');
  });

  it('keeps adjacent amide carbonyl centers exact after mixed placement finishes attaching pending rings', () => {
    const smiles = 'CC(C)[C@@H](NC(=O)C1=CC=C(C=C1)C(=O)NCC(O)=O)C(=O)N1CCC[C@@H]1C(=O)N[C@H](C(C)C)C(=O)C(F)(F)F';
    const graph = createLayoutGraph(parseSMILES(smiles), { suppressH: true });
    const component = graph.components[0];
    const plan = buildScaffoldPlan(graph, component);
    const mixedResult = layoutMixedFamily(graph, component, buildAdjacency(graph, new Set(component.atomIds)), plan, graph.options.bondLength);
    const pipelineResult = runPipeline(parseSMILES(smiles), { suppressH: true, auditTelemetry: true, finalLandscapeOrientation: true });

    const assertCarbonylGeometry = (coords, label, centerAtomId, firstNeighborAtomId, secondNeighborAtomId, thirdNeighborAtomId) => {
      const firstAngle = bondAngleAtAtom(coords, centerAtomId, firstNeighborAtomId, secondNeighborAtomId);
      const secondAngle = bondAngleAtAtom(coords, centerAtomId, firstNeighborAtomId, thirdNeighborAtomId);
      const thirdAngle = bondAngleAtAtom(coords, centerAtomId, secondNeighborAtomId, thirdNeighborAtomId);

      assert.ok(Math.abs(firstAngle - ((2 * Math.PI) / 3)) < 1e-6, `expected ${label} ${firstNeighborAtomId}-${centerAtomId}-${secondNeighborAtomId} to stay at 120 degrees, got ${((firstAngle * 180) / Math.PI).toFixed(2)}`);
      assert.ok(Math.abs(secondAngle - ((2 * Math.PI) / 3)) < 1e-6, `expected ${label} ${firstNeighborAtomId}-${centerAtomId}-${thirdNeighborAtomId} to stay at 120 degrees, got ${((secondAngle * 180) / Math.PI).toFixed(2)}`);
      assert.ok(Math.abs(thirdAngle - ((2 * Math.PI) / 3)) < 1e-6, `expected ${label} ${secondNeighborAtomId}-${centerAtomId}-${thirdNeighborAtomId} to stay at 120 degrees, got ${((thirdAngle * 180) / Math.PI).toFixed(2)}`);
    };

    const assertThreeHeavyCenter = (coords, label) => {
      const firstAngle = bondAngleAtAtom(coords, 'C4', 'C2', 'N6');
      const secondAngle = bondAngleAtAtom(coords, 'C4', 'C2', 'C22');
      const thirdAngle = bondAngleAtAtom(coords, 'C4', 'N6', 'C22');

      assert.ok(Math.abs(firstAngle - ((2 * Math.PI) / 3)) < 1e-6, `expected ${label} C2-C4-N6 to stay at 120 degrees, got ${((firstAngle * 180) / Math.PI).toFixed(2)}`);
      assert.ok(Math.abs(secondAngle - ((2 * Math.PI) / 3)) < 1e-6, `expected ${label} C2-C4-C22 to stay at 120 degrees, got ${((secondAngle * 180) / Math.PI).toFixed(2)}`);
      assert.ok(Math.abs(thirdAngle - ((2 * Math.PI) / 3)) < 1e-6, `expected ${label} N6-C4-C22 to stay at 120 degrees, got ${((thirdAngle * 180) / Math.PI).toFixed(2)}`);
    };

    assert.equal(mixedResult.supported, true);
    assertCarbonylGeometry(mixedResult.coords, 'mixed layout', 'C22', 'C4', 'O23', 'N24');
    assertCarbonylGeometry(mixedResult.coords, 'mixed layout', 'C7', 'N6', 'O8', 'C9');
    assertThreeHeavyCenter(mixedResult.coords, 'mixed layout');
    assertCarbonylGeometry(pipelineResult.coords, 'pipeline layout', 'C22', 'C4', 'O23', 'N24');
    assertCarbonylGeometry(pipelineResult.coords, 'pipeline layout', 'C7', 'N6', 'O8', 'C9');
    assertThreeHeavyCenter(pipelineResult.coords, 'pipeline layout');
    assert.equal(pipelineResult.metadata.audit.ok, true);
  });

  it('clears terminal amide carbonyl leaves from neighboring aryl rings while preserving saturated-ring fans', () => {
    const smiles = 'CC1=CC=C2C=C(CC3=CC=C(O)C=C3)C=C(C2=C1)[N+]1(NCC(=O)N2CC(=O)NCC12)C(=O)NCC1=CC=CC=C1';
    const graph = createLayoutGraph(parseSMILES(smiles), { suppressH: true });
    const component = graph.components[0];
    const plan = buildScaffoldPlan(graph, component);
    const mixedResult = layoutMixedFamily(graph, component, buildAdjacency(graph, new Set(component.atomIds)), plan, graph.options.bondLength);
    const pipelineResult = runPipeline(parseSMILES(smiles), {
      suppressH: true,
      auditTelemetry: true,
      finalLandscapeOrientation: true
    });

    const assertCarbonylClearance = (layoutGraph, coords, label) => {
      const audit = auditLayout(layoutGraph, coords, { bondLength: layoutGraph.options.bondLength });
      const carbonylClearance = distance(coords.get('O33'), coords.get('C16'));
      const ringFanPenalty = measureSmallRingExteriorGapSpreadPenalty(layoutGraph, coords, 'N20');
      const branchGap = bondAngleAtAtom(coords, 'N20', 'C17', 'C32');
      const carbonylFanDeviation = Math.max(
        ...[
          bondAngleAtAtom(coords, 'C32', 'N20', 'O33'),
          bondAngleAtAtom(coords, 'C32', 'N20', 'N34'),
          bondAngleAtAtom(coords, 'C32', 'O33', 'N34')
        ].map(angle => Math.abs(angle - ((2 * Math.PI) / 3)))
      );
      const visibleCrossings = findVisibleHeavyBondCrossings(layoutGraph, coords, {
        bondLength: layoutGraph.options.bondLength
      });

      assert.equal(audit.ok, true, `expected ${label} to pass layout audit`);
      assert.equal(visibleCrossings.length, 0, `expected ${label} to avoid visible heavy-bond crossings`);
      assert.ok(
        carbonylClearance > layoutGraph.options.bondLength * 0.75,
        `expected ${label} terminal amide oxygen to clear the neighboring aryl carbon, got ${carbonylClearance.toFixed(3)}`
      );
      assert.ok(
        ringFanPenalty < 0.55,
        `expected ${label} cationic saturated-ring fan to stay balanced, got ${ringFanPenalty.toFixed(3)}`
      );
      assert.ok(
        branchGap > (4 * Math.PI) / 9,
        `expected ${label} carbonyl branch to keep a readable exterior gap, got ${((branchGap * 180) / Math.PI).toFixed(2)} degrees`
      );
      assert.ok(
        carbonylFanDeviation < Math.PI / 6,
        `expected ${label} C32 carbonyl fan to stay readable, got ${((carbonylFanDeviation * 180) / Math.PI).toFixed(2)} degrees max deviation`
      );
    };

    assert.equal(mixedResult.supported, true);
    assertCarbonylClearance(graph, mixedResult.coords, 'mixed layout');
    assertCarbonylClearance(pipelineResult.layoutGraph, pipelineResult.coords, 'pipeline layout');
  });

  it('rechecks terminal carbonyl leaves after attached-ring fallback moves a crowded benzyl ring', () => {
    const result = runPipeline(
      parseSMILES('CC(=O)N(C(=O)C(N)CC([O-])=O)C(CC1=CC=CC=C1)(N1C(=O)[N-]C(C1=O)C1=CC=C(C[NH3+])C=C1)C(=O)NCCCC[NH3+]'),
      {
        suppressH: true,
        auditTelemetry: true,
        finalLandscapeOrientation: true
      }
    );
    const { layoutGraph, coords } = result;
    const carbonylClearance = distance(coords.get('O38'), coords.get('C15'));
    const carbonylBondLength = distance(coords.get('C37'), coords.get('O38'));
    const carbonylAngleDeviation = Math.max(
      Math.abs(bondAngleAtAtom(coords, 'C37', 'C13', 'O38') - ((2 * Math.PI) / 3)),
      Math.abs(bondAngleAtAtom(coords, 'C37', 'N39', 'O38') - ((2 * Math.PI) / 3))
    );

    assert.equal(result.metadata.audit.ok, true);
    assert.equal(findSevereOverlaps(layoutGraph, coords, layoutGraph.options.bondLength).length, 0);
    assert.equal(
      findVisibleHeavyBondCrossings(layoutGraph, coords, { bondLength: layoutGraph.options.bondLength }).length,
      0,
      'expected terminal carbonyl leaves to avoid visible heavy-bond crossings after attached-ring fallback'
    );
    assert.ok(
      carbonylClearance >= layoutGraph.options.bondLength * 0.6 - 1e-6,
      `expected O38 to clear C15 after the benzyl ring rotates, got ${carbonylClearance.toFixed(3)}`
    );
    assert.ok(
      carbonylBondLength >= layoutGraph.options.bondLength * 0.4 - 1e-6,
      `expected compressed O38 bond to stay above the accepted carbonyl floor, got ${carbonylBondLength.toFixed(3)}`
    );
    assert.ok(
      carbonylAngleDeviation < 1e-6,
      `expected compressed C37=O38 direction to remain exactly trigonal, got ${((carbonylAngleDeviation * 180) / Math.PI).toFixed(3)} degrees`
    );
  });

  it('shortens crowded ring carbonyl leaves while keeping their fans exact', () => {
    const result = runPipeline(
      parseSMILES('COc1ccc(cc1)C2=C(C(=O)c3c(O)cc(O)cc3O2)C4=C(Oc5cc(O)cc(O)c5C4=O)c6ccc(OC)cc6'),
      {
        suppressH: true,
        auditTelemetry: true,
        finalLandscapeOrientation: true
      }
    );
    const { layoutGraph, coords } = result;
    const bondLength = layoutGraph.options.bondLength;
    const assertExactCarbonylFan = (centerAtomId, leafAtomId, firstRingAtomId, secondRingAtomId) => {
      for (const [firstAtomId, secondAtomId] of [
        [firstRingAtomId, leafAtomId],
        [firstRingAtomId, secondRingAtomId],
        [leafAtomId, secondRingAtomId]
      ]) {
        const angle = bondAngleAtAtom(coords, centerAtomId, firstAtomId, secondAtomId);
        assert.ok(
          Math.abs(angle - ((2 * Math.PI) / 3)) < 1e-6,
          `expected ${firstAtomId}-${centerAtomId}-${secondAtomId} to stay exact at 120 degrees, got ${((angle * 180) / Math.PI).toFixed(2)}`
        );
      }
      assert.ok(
        distance(coords.get(centerAtomId), coords.get(leafAtomId)) < bondLength,
        `expected ${centerAtomId}=${leafAtomId} to shorten below the standard bond length`
      );
      assert.ok(
        distance(coords.get(centerAtomId), coords.get(leafAtomId)) >= bondLength * 0.4 - 1e-6,
        `expected ${centerAtomId}=${leafAtomId} to stay above the accepted carbonyl compression floor`
      );
    };

    assert.equal(result.metadata.audit.ok, true);
    assertExactCarbonylFan('C11', 'O12', 'C10', 'C13');
    assertExactCarbonylFan('C33', 'O34', 'C22', 'C32');
    for (const [firstAtomId, secondAtomId] of [
      ['C23', 'C42'],
      ['C23', 'C36'],
      ['C42', 'C36']
    ]) {
      const angle = bondAngleAtAtom(coords, 'C35', firstAtomId, secondAtomId);
      assert.ok(
        Math.abs(angle - ((2 * Math.PI) / 3)) < 1e-6,
        `expected ${firstAtomId}-C35-${secondAtomId} to stay exact at 120 degrees, got ${((angle * 180) / Math.PI).toFixed(2)}`
      );
    }
  });

  it('keeps the reported anisole ether exit exact when pending attached-ring carbonyl resnaps are optional', () => {
    const smiles = 'COc1cc([C@H](CC=C(C)C)OC(=O)c2ccccn2)c(OC)c3\\C(=N\\O)\\C=C\\C(=N/O)\\c13';
    const graph = createLayoutGraph(parseSMILES(smiles), { suppressH: true });
    const component = graph.components[0];
    const plan = buildScaffoldPlan(graph, component);
    const mixedResult = layoutMixedFamily(graph, component, buildAdjacency(graph, new Set(component.atomIds)), plan, graph.options.bondLength);
    const pipelineResult = runPipeline(parseSMILES(smiles), { suppressH: true, auditTelemetry: true });

    const assertEtherExit = (layoutGraph, coords, label) => {
      const ringExitDeviation = bestLocalRingDeviation(layoutGraph, coords, 'C22', 'O23');
      const etherAngle = bondAngleAtAtom(coords, 'O23', 'C22', 'C24');

      assert.ok(
        ringExitDeviation < 1e-6,
        `expected ${label} C22-O23 to stay on the exact local ring outward axis, got ${((ringExitDeviation * 180) / Math.PI).toFixed(2)} degrees`
      );
      assert.ok(
        Math.abs(etherAngle - ((2 * Math.PI) / 3)) < 1e-6,
        `expected ${label} C22-O23-C24 to stay at 120 degrees, got ${((etherAngle * 180) / Math.PI).toFixed(2)}`
      );
    };

    assert.equal(mixedResult.supported, true);
    assertEtherExit(graph, mixedResult.coords, 'mixed layout');
    assertEtherExit(pipelineResult.layoutGraph, pipelineResult.coords, 'pipeline layout');
    assert.equal(pipelineResult.metadata.audit.ok, true);
  });

  it('keeps hidden-h tri-substituted stereocenters on a visible trigonal spread', () => {
    const graph = createLayoutGraph(parseSMILES('[H][C@](CC)(C1=CC=CC=C1)C1=C(O)C2=C(CCCCC2)OC1=O'), { suppressH: true });
    const component = graph.components[0];
    const plan = buildScaffoldPlan(graph, component);
    const mixedResult = layoutMixedFamily(graph, component, buildAdjacency(graph, new Set(component.atomIds)), plan, graph.options.bondLength);
    const pipelineResult = runPipeline(parseSMILES('[H][C@](CC)(C1=CC=CC=C1)C1=C(O)C2=C(CCCCC2)OC1=O'), { suppressH: true });

    const assertTrigonalCenter = (coords, label) => {
      const firstAngle = bondAngleAtAtom(coords, 'C2', 'C3', 'C5');
      const secondAngle = bondAngleAtAtom(coords, 'C2', 'C3', 'C11');
      const thirdAngle = bondAngleAtAtom(coords, 'C2', 'C5', 'C11');
      for (const [name, angle] of [['C3-C2-C5', firstAngle], ['C3-C2-C11', secondAngle], ['C5-C2-C11', thirdAngle]]) {
        assert.ok(
          Math.abs(angle - ((2 * Math.PI) / 3)) < 0.05,
          `expected ${label} ${name} to stay near 120 degrees when the fourth substituent is a hidden hydrogen, got ${((angle * 180) / Math.PI).toFixed(2)}`
        );
      }
    };

    assert.equal(mixedResult.supported, true);
    assertTrigonalCenter(mixedResult.coords, 'mixed layout');
    assertTrigonalCenter(pipelineResult.coords, 'pipeline layout');
  });

  it('keeps non-ring sugar sidechain hidden-h centers exact while clearing downstream aryl rings', () => {
    const smiles = 'CO[C@H]1[C@H](O[C@@H]2OC(C)(C)O[C@H]12)[C@H](CC(=O)N)N(Cc3ccccc3O)C(=O)Nc4ccc(C)c(Cl)c4';
    const graph = createLayoutGraph(parseSMILES(smiles), { suppressH: true });
    const component = graph.components[0];
    const plan = buildScaffoldPlan(graph, component);
    const mixedResult = layoutMixedFamily(graph, component, buildAdjacency(graph, new Set(component.atomIds)), plan, graph.options.bondLength);
    const pipelineResult = runPipeline(parseSMILES(smiles), { suppressH: true, auditTelemetry: true });

    const assertHiddenHydrogenFan = (coords, label) => {
      for (const [firstNeighborAtomId, secondNeighborAtomId] of [['C5', 'C19'], ['C5', 'N23'], ['C19', 'N23']]) {
        const angle = bondAngleAtAtom(coords, 'C17', firstNeighborAtomId, secondNeighborAtomId);
        assert.ok(
          Math.abs(angle - ((2 * Math.PI) / 3)) < 1e-6,
          `expected ${label} ${firstNeighborAtomId}-C17-${secondNeighborAtomId} to keep an exact suppressed-H fan, got ${((angle * 180) / Math.PI).toFixed(2)} degrees`
        );
      }
    };
    const assertLinkedArylBend = (coords, label) => {
      const c24Angle = bondAngleAtAtom(coords, 'C24', 'N23', 'C25');
      assert.ok(
        Math.abs(c24Angle - ((2 * Math.PI) / 3)) < Math.PI / 9,
        `expected ${label} N23-C24-C25 to stay visibly bent near 120 degrees, got ${((c24Angle * 180) / Math.PI).toFixed(2)} degrees`
      );
      for (const [firstNeighborAtomId, secondNeighborAtomId] of [['C17', 'C24'], ['C17', 'C32'], ['C24', 'C32']]) {
        const angle = bondAngleAtAtom(coords, 'N23', firstNeighborAtomId, secondNeighborAtomId);
        assert.ok(
          Math.abs(angle - ((2 * Math.PI) / 3)) < Math.PI / 12,
          `expected ${label} ${firstNeighborAtomId}-N23-${secondNeighborAtomId} to remain close to trigonal while opening C24, got ${((angle * 180) / Math.PI).toFixed(2)} degrees`
        );
      }
    };

    assert.equal(mixedResult.supported, true);
    assertHiddenHydrogenFan(mixedResult.coords, 'mixed layout');
    assertLinkedArylBend(mixedResult.coords, 'mixed layout');
    assert.equal(auditLayout(graph, mixedResult.coords, { bondLength: graph.options.bondLength }).ok, true);
    assertHiddenHydrogenFan(pipelineResult.coords, 'pipeline layout');
    assertLinkedArylBend(pipelineResult.coords, 'pipeline layout');
    assert.equal(pipelineResult.metadata.audit.ok, true);
  });

  it('keeps benzylic attached phenyl exits exact while preserving the visible hidden-h methyl spreads', () => {
    const smiles = 'CC(COC1=CC=CC=C1)NC(C)C(O)C1=CC=C(O)C=C1';
    const graph = createLayoutGraph(parseSMILES(smiles), { suppressH: true });
    const component = graph.components[0];
    const plan = buildScaffoldPlan(graph, component);
    const mixedResult = layoutMixedFamily(graph, component, buildAdjacency(graph, new Set(component.atomIds)), plan, graph.options.bondLength);
    const pipelineResult = runPipeline(parseSMILES(smiles), { suppressH: true });
    const attachedPhenylRing = (graph.atomToRings.get('C16') ?? [])[0];

    const assertBalancedAttachment = (coords, label) => {
      const outwardAngle = angleOf(sub(
        coords.get('C16'),
        centroid(attachedPhenylRing.atomIds.map(atomId => coords.get(atomId)).filter(Boolean))
      ));
      const exitAngle = angleOf(sub(coords.get('C14'), coords.get('C16')));
      const leftMethylFirstAngle = bondAngleAtAtom(coords, 'C2', 'C1', 'N11');
      const leftMethylSecondAngle = bondAngleAtAtom(coords, 'C2', 'C1', 'C3');
      const leftMethylThirdAngle = bondAngleAtAtom(coords, 'C2', 'N11', 'C3');
      const amineMethylFirstAngle = bondAngleAtAtom(coords, 'C12', 'C13', 'N11');
      const amineMethylSecondAngle = bondAngleAtAtom(coords, 'C12', 'C13', 'C14');
      const amineMethylThirdAngle = bondAngleAtAtom(coords, 'C12', 'N11', 'C14');
      const alcoholFirstAngle = bondAngleAtAtom(coords, 'C14', 'C12', 'O15');
      const alcoholSecondAngle = bondAngleAtAtom(coords, 'C14', 'C12', 'C16');
      const alcoholThirdAngle = bondAngleAtAtom(coords, 'C14', 'O15', 'C16');

      assert.ok(
        angularDifference(outwardAngle, exitAngle) < 1e-6,
        `expected ${label} attached phenyl exit to stay on the exact local aromatic outward axis, got ${((angularDifference(outwardAngle, exitAngle) * 180) / Math.PI).toFixed(2)}`
      );
      for (const [name, angle] of [
        ['C1-C2-N11', leftMethylFirstAngle],
        ['C1-C2-C3', leftMethylSecondAngle],
        ['N11-C2-C3', leftMethylThirdAngle],
        ['C13-C12-N11', amineMethylFirstAngle],
        ['C13-C12-C14', amineMethylSecondAngle],
        ['N11-C12-C14', amineMethylThirdAngle]
      ]) {
        assert.ok(
          Math.abs(angle - ((2 * Math.PI) / 3)) < 1e-6,
          `expected ${label} ${name} to stay exact at 120 degrees, got ${((angle * 180) / Math.PI).toFixed(2)}`
        );
      }
      for (const [name, angle] of [
        ['C12-C14-O15', alcoholFirstAngle],
        ['C12-C14-C16', alcoholSecondAngle],
        ['O15-C14-C16', alcoholThirdAngle]
      ]) {
        assert.ok(
          Math.abs(angle - ((2 * Math.PI) / 3)) < 1e-6,
          `expected ${label} ${name} to stay exact at 120 degrees, got ${((angle * 180) / Math.PI).toFixed(2)}`
        );
      }
    };

    assert.equal(mixedResult.supported, true);
    assertBalancedAttachment(mixedResult.coords, 'mixed layout');
    assertBalancedAttachment(pipelineResult.coords, 'pipeline layout');
    assert.equal(pipelineResult.metadata.audit.ok, true);
    assert.equal(pipelineResult.metadata.audit.ringSubstituentReadabilityFailureCount, 0);
  });

  it('swaps direct-attached aryl roots with sibling slots when a chiral hidden-h parent would otherwise bend the ring exit', () => {
    const smiles = 'C[C@@H](O[C@H]1OCCN(CC2=NC(=O)N(N2)P(O)(O)=O)[C@H]1C1=CC=C(F)C=C1)C1=CC(=CC(=C1)C(F)(F)F)C(F)(F)F';
    const graph = createLayoutGraph(parseSMILES(smiles), { suppressH: true });
    const component = graph.components[0];
    const plan = buildScaffoldPlan(graph, component);
    const mixedResult = layoutMixedFamily(graph, component, buildAdjacency(graph, new Set(component.atomIds)), plan, graph.options.bondLength);
    const pipelineResult = runPipeline(parseSMILES(smiles), {
      suppressH: true,
      auditTelemetry: true
    });

    const assertExactArylExit = (coords, label) => {
      for (const [name, angle] of [
        ['C2-C31-C36', bondAngleAtAtom(coords, 'C31', 'C2', 'C36')],
        ['C2-C31-C32', bondAngleAtAtom(coords, 'C31', 'C2', 'C32')],
        ['C36-C31-C32', bondAngleAtAtom(coords, 'C31', 'C36', 'C32')],
        ['O4-C2-C31', bondAngleAtAtom(coords, 'C2', 'O4', 'C31')],
        ['C31-C2-C1', bondAngleAtAtom(coords, 'C2', 'C31', 'C1')],
        ['O4-C2-C1', bondAngleAtAtom(coords, 'C2', 'O4', 'C1')]
      ]) {
        assert.ok(
          Math.abs(angle - ((2 * Math.PI) / 3)) < 1e-6,
          `expected ${label} ${name} to stay exact at 120 degrees, got ${((angle * 180) / Math.PI).toFixed(2)}`
        );
      }
    };

    assert.equal(mixedResult.supported, true);
    assertExactArylExit(mixedResult.coords, 'mixed layout');
    assertExactArylExit(pipelineResult.coords, 'pipeline layout');
    assert.equal(pipelineResult.metadata.audit.ok, true);
    assert.equal(pipelineResult.metadata.audit.ringSubstituentReadabilityFailureCount, 0);
  });

  it('keeps crowded chiral omitted-h phenyl roots exact by shifting the parent slot', () => {
    const smiles = '[H][C@]12SCC(CSC3=NN=NN3C)=C(N1C(=O)[C@@]2([H])NC(=O)[C@H](<NC(=O)C1=C(O)C=C(C)N=C1>)C1=CC=C(O)C=C1)C(O)=O';
    const graph = createLayoutGraph(parseSMILES(smiles), { suppressH: true });
    const component = graph.components[0];
    const plan = buildScaffoldPlan(graph, component);
    const mixedResult = layoutMixedFamily(graph, component, buildAdjacency(graph, new Set(component.atomIds)), plan, graph.options.bondLength);
    const pipelineResult = runPipeline(parseSMILES(smiles), {
      suppressH: true,
      auditTelemetry: true
    });
    const phenylRing = (graph.atomToRings.get('C36') ?? [])[0];

    const assertExactPhenylExit = (coords, label) => {
      const outwardAngle = angleOf(sub(
        coords.get('C36'),
        centroid(phenylRing.atomIds.map(atomId => coords.get(atomId)).filter(Boolean))
      ));
      const parentAngle = angleOf(sub(coords.get('C23'), coords.get('C36')));
      assert.ok(
        angularDifference(outwardAngle, parentAngle) < 1e-6,
        `expected ${label} C36-C23 to follow the phenyl outward axis, got ${((angularDifference(outwardAngle, parentAngle) * 180) / Math.PI).toFixed(2)} degrees`
      );
      assert.ok(
        Math.abs(bondAngleAtAtom(coords, 'C36', 'C23', 'C37') - ((2 * Math.PI) / 3)) < 1e-6,
        `expected ${label} C23-C36-C37 to stay at 120 degrees`
      );
      assert.ok(
        Math.abs(bondAngleAtAtom(coords, 'C36', 'C23', 'C42') - ((2 * Math.PI) / 3)) < 1e-6,
        `expected ${label} C23-C36-C42 to stay at 120 degrees`
      );
      for (const [name, angle] of [
        ['C21-C23-N25', bondAngleAtAtom(coords, 'C23', 'C21', 'N25')],
        ['C21-C23-C36', bondAngleAtAtom(coords, 'C23', 'C21', 'C36')],
        ['N25-C23-C36', bondAngleAtAtom(coords, 'C23', 'N25', 'C36')]
      ]) {
        assert.ok(
          Math.abs(angle - ((2 * Math.PI) / 3)) < 1e-6,
          `expected ${label} ${name} to stay at 120 degrees, got ${((angle * 180) / Math.PI).toFixed(2)}`
        );
      }
    };

    assert.equal(mixedResult.supported, true);
    assertExactPhenylExit(mixedResult.coords, 'mixed layout');
    assertExactPhenylExit(pipelineResult.coords, 'pipeline layout');
    assert.equal(pipelineResult.metadata.audit.ok, true);
    assert.equal(pipelineResult.metadata.audit.ringSubstituentReadabilityFailureCount, 0);
  });

  it('keeps reported thio, benzyl, and linked-pyridyl ring exits exact through mixed placement and the full pipeline', () => {
    const smiles = 'CSC1=NN2C(=O)C=C(N=C2N1Cc3cccc(Cl)c3Cl)c4ccncc4';
    const graph = createLayoutGraph(parseSMILES(smiles), { suppressH: true });
    const component = graph.components[0];
    const plan = buildScaffoldPlan(graph, component);
    const mixedResult = layoutMixedFamily(graph, component, buildAdjacency(graph, new Set(component.atomIds)), plan, graph.options.bondLength);
    const pipelineResult = runPipeline(parseSMILES(smiles), {
      suppressH: true,
      auditTelemetry: true
    });
    const thioRing = (graph.atomToRings.get('C3') ?? [])[0];
    const dichlorophenylRing = (graph.atomToRings.get('C14') ?? [])[0];
    const pyridylRing = (graph.atomToRings.get('C22') ?? [])[0];

    const assertExactExits = (coords, label) => {
      const thioOutwardAngle = angleOf(sub(
        coords.get('C3'),
        centroid(thioRing.atomIds.map(atomId => coords.get(atomId)).filter(Boolean))
      ));
      const dichlorophenylOutwardAngle = angleOf(sub(
        coords.get('C14'),
        centroid(dichlorophenylRing.atomIds.map(atomId => coords.get(atomId)).filter(Boolean))
      ));
      const pyridylOutwardAngle = angleOf(sub(
        coords.get('C22'),
        centroid(pyridylRing.atomIds.map(atomId => coords.get(atomId)).filter(Boolean))
      ));
      const thioDeviation = angularDifference(thioOutwardAngle, angleOf(sub(coords.get('S2'), coords.get('C3'))));
      const dichlorophenylDeviation = angularDifference(dichlorophenylOutwardAngle, angleOf(sub(coords.get('C13'), coords.get('C14'))));
      const pyridylDeviation = angularDifference(pyridylOutwardAngle, angleOf(sub(coords.get('C9'), coords.get('C22'))));
      const benzylFirstAngle = bondAngleAtAtom(coords, 'C14', 'C13', 'C15');
      const benzylSecondAngle = bondAngleAtAtom(coords, 'C14', 'C13', 'C20');
      const benzylThirdAngle = bondAngleAtAtom(coords, 'C14', 'C15', 'C20');
      const benzylicLinkerAngle = bondAngleAtAtom(coords, 'C13', 'N12', 'C14');
      const pyridylFirstAngle = bondAngleAtAtom(coords, 'C22', 'C9', 'C23');
      const pyridylSecondAngle = bondAngleAtAtom(coords, 'C22', 'C9', 'C27');
      const pyridylThirdAngle = bondAngleAtAtom(coords, 'C22', 'C23', 'C27');
      const fusedPyridylFirstAngle = bondAngleAtAtom(coords, 'C9', 'C8', 'C22');
      const fusedPyridylSecondAngle = bondAngleAtAtom(coords, 'C9', 'N10', 'C22');

      assert.ok(
        thioDeviation < 1e-6,
        `expected ${label} thio exit to stay on the exact fused-ring outward axis, got ${((thioDeviation * 180) / Math.PI).toFixed(2)}`
      );
      assert.ok(
        dichlorophenylDeviation < 1e-6,
        `expected ${label} benzylic dichlorophenyl exit to stay on the exact aromatic outward axis, got ${((dichlorophenylDeviation * 180) / Math.PI).toFixed(2)}`
      );
      assert.ok(
        pyridylDeviation < 1e-6,
        `expected ${label} linked pyridyl root to stay on the exact aromatic outward axis, got ${((pyridylDeviation * 180) / Math.PI).toFixed(2)}`
      );
      for (const [name, angle] of [
        ['N12-C13-C14', benzylicLinkerAngle],
        ['C13-C14-C15', benzylFirstAngle],
        ['C13-C14-C20', benzylSecondAngle],
        ['C15-C14-C20', benzylThirdAngle],
        ['C9-C22-C23', pyridylFirstAngle],
        ['C9-C22-C27', pyridylSecondAngle],
        ['C23-C22-C27', pyridylThirdAngle],
        ['C8-C9-C22', fusedPyridylFirstAngle],
        ['N10-C9-C22', fusedPyridylSecondAngle]
      ]) {
        assert.ok(
          Math.abs(angle - ((2 * Math.PI) / 3)) < 1e-6,
          `expected ${label} ${name} to stay exact at 120 degrees, got ${((angle * 180) / Math.PI).toFixed(2)}`
        );
      }
    };

    assert.equal(mixedResult.supported, true);
    assertExactExits(mixedResult.coords, 'mixed layout');
    assertExactExits(pipelineResult.coords, 'pipeline layout');
    assert.equal(pipelineResult.metadata.audit.ok, true);
    assert.equal(pipelineResult.metadata.audit.ringSubstituentReadabilityFailureCount, 0);
  });

  it('keeps long-chain quinoline ring roots exact on aromatic outward exits', () => {
    const smiles = 'C[C@H](CCCNCCCCCCNc1ccnc2cc(Cl)ccc12)[C@H]3CC[C@H]4[C@@H]5[C@@H](C[C@@H]6C[C@H](CC[C@]6(C)[C@H]5C[C@H](OC(=O)C)[C@]34C)NCCCCCCNc7ccnc8cc(Cl)ccc78)OC(=O)C';
    const graph = createLayoutGraph(parseSMILES(smiles), { suppressH: true });
    const component = graph.components[0];
    const plan = buildScaffoldPlan(graph, component);
    const mixedResult = layoutMixedFamily(graph, component, buildAdjacency(graph, new Set(component.atomIds)), plan, graph.options.bondLength);
    const pipelineResult = runPipeline(parseSMILES(smiles), {
      suppressH: true,
      auditTelemetry: true
    });

    const assertExactQuinolineExits = (layoutGraph, coords, label) => {
      for (const { centerAtomId, parentAtomId, ringNeighborAtomIds } of [
        { centerAtomId: 'C15', parentAtomId: 'N14', ringNeighborAtomIds: ['C25', 'C16'] },
        { centerAtomId: 'C65', parentAtomId: 'N64', ringNeighborAtomIds: ['C75', 'C66'] }
      ]) {
        const outwardAngles = computeIncidentRingOutwardAngles(layoutGraph, centerAtomId, atomId => coords.get(atomId) ?? null);
        const parentAngle = angleOf(sub(coords.get(parentAtomId), coords.get(centerAtomId)));
        const parentDeviation = Math.min(...outwardAngles.map(outwardAngle => angularDifference(parentAngle, outwardAngle)));

        assert.equal(outwardAngles.length, 1, `expected ${label} ${centerAtomId} to have one local aromatic outward axis`);
        assert.ok(
          parentDeviation < 1e-6,
          `expected ${label} ${centerAtomId}-${parentAtomId} to stay on the exact aromatic outward axis, got ${((parentDeviation * 180) / Math.PI).toFixed(2)} degrees`
        );
        for (const [name, angle] of [
          [`${parentAtomId}-${centerAtomId}-${ringNeighborAtomIds[0]}`, bondAngleAtAtom(coords, centerAtomId, parentAtomId, ringNeighborAtomIds[0])],
          [`${parentAtomId}-${centerAtomId}-${ringNeighborAtomIds[1]}`, bondAngleAtAtom(coords, centerAtomId, parentAtomId, ringNeighborAtomIds[1])],
          [`${ringNeighborAtomIds[0]}-${centerAtomId}-${ringNeighborAtomIds[1]}`, bondAngleAtAtom(coords, centerAtomId, ringNeighborAtomIds[0], ringNeighborAtomIds[1])]
        ]) {
          assert.ok(
            Math.abs(angle - ((2 * Math.PI) / 3)) < 1e-6,
            `expected ${label} ${name} to stay exact at 120 degrees, got ${((angle * 180) / Math.PI).toFixed(2)}`
          );
        }
      }
    };

    assert.equal(mixedResult.supported, true);
    assertExactQuinolineExits(graph, mixedResult.coords, 'mixed layout');
    assertExactQuinolineExits(pipelineResult.layoutGraph, pipelineResult.coords, 'pipeline layout');
    assert.equal(pipelineResult.metadata.audit.ok, true);
    assert.equal(pipelineResult.metadata.audit.ringSubstituentReadabilityFailureCount, 0);
  });

  it('rotates directly attached ring blocks around the parent bond when that clears multiple outward-axis failures at once', () => {
    const smiles = 'CCN(C1CCC(CC1)[NH+](C)CC1=CC=CC(OCCOC)=C1)C1=CC(Cl)=CC(C(=O)NCC2=C(C)NC(C)=CC2=O)=C1C';
    const graph = createLayoutGraph(parseSMILES(smiles), { suppressH: true });
    const component = graph.components[0];
    const plan = buildScaffoldPlan(graph, component);
    const result = layoutMixedFamily(graph, component, buildAdjacency(graph, new Set(component.atomIds)), plan, graph.options.bondLength);
    const pipelineResult = runPipeline(parseSMILES(smiles), {
      suppressH: true,
      auditTelemetry: true
    });
    const audit = auditLayout(graph, result.coords, { bondLength: graph.options.bondLength, bondValidationClasses: result.bondValidationClasses });
    const attachmentRing = (graph.atomToRings.get('C25') ?? [])[0];
    const chlorineRing = (graph.atomToRings.get('C27') ?? [])[0];
    const methylRing = (graph.atomToRings.get('C44') ?? [])[0];
    const attachmentOutwardAngle = angleOf(sub(
      result.coords.get('C25'),
      centroid(attachmentRing.atomIds.map(atomId => result.coords.get(atomId)).filter(Boolean))
    ));
    const chlorineOutwardAngle = angleOf(sub(
      result.coords.get('C27'),
      centroid(chlorineRing.atomIds.map(atomId => result.coords.get(atomId)).filter(Boolean))
    ));
    const methylOutwardAngle = angleOf(sub(
      result.coords.get('C44'),
      centroid(methylRing.atomIds.map(atomId => result.coords.get(atomId)).filter(Boolean))
    ));
    const attachmentDeviation = angularDifference(attachmentOutwardAngle, angleOf(sub(result.coords.get('N3'), result.coords.get('C25'))));
    const chlorineDeviation = angularDifference(chlorineOutwardAngle, angleOf(sub(result.coords.get('Cl28'), result.coords.get('C27'))));
    const methylDeviation = angularDifference(methylOutwardAngle, angleOf(sub(result.coords.get('C45'), result.coords.get('C44'))));
    const assertAnilinoNitrogenSpread = (coords, label) => {
      for (const [name, angle] of [
        ['C4-N3-C25', bondAngleAtAtom(coords, 'N3', 'C4', 'C25')],
        ['C4-N3-C2', bondAngleAtAtom(coords, 'N3', 'C4', 'C2')],
        ['C25-N3-C2', bondAngleAtAtom(coords, 'N3', 'C25', 'C2')]
      ]) {
        assert.ok(
          Math.abs(angle - ((2 * Math.PI) / 3)) < 1e-6,
          `expected ${label} anilino ${name} to stay at 120 degrees, got ${((angle * 180) / Math.PI).toFixed(2)}`
        );
      }
    };

    assert.equal(result.supported, true);
    assert.equal(audit.ringSubstituentReadabilityFailureCount, 0);
    assert.equal(pipelineResult.metadata.audit.ok, true);
    assert.ok(attachmentDeviation < 1e-6, `expected the attached-ring root bond to follow the local outward axis, got ${attachmentDeviation.toFixed(6)} rad`);
    assert.ok(chlorineDeviation < 1e-6, `expected the chlorine substituent to follow the local outward axis, got ${chlorineDeviation.toFixed(6)} rad`);
    assert.ok(methylDeviation < 1e-6, `expected the nearby methyl substituent to follow the local outward axis, got ${methylDeviation.toFixed(6)} rad`);
    assertAnilinoNitrogenSpread(result.coords, 'mixed layout');
    assertAnilinoNitrogenSpread(pipelineResult.coords, 'pipeline layout');
  });

  it('keeps terminal leaves on the remaining trigonal slot at planar tertiary nitrogens beside attached rings', () => {
    const smiles = 'CN(C1CCS(=O)(=O)C1)C2=C(NC(=O)C)C(=O)c3ccccc3C2=O';
    const graph = createLayoutGraph(parseSMILES(smiles), { suppressH: true });
    const component = graph.components[0];
    const plan = buildScaffoldPlan(graph, component);
    const mixedResult = layoutMixedFamily(graph, component, buildAdjacency(graph, new Set(component.atomIds)), plan, graph.options.bondLength);
    const pipelineResult = runPipeline(parseSMILES(smiles), {
      suppressH: true,
      auditTelemetry: true
    });
    const assertN2Spread = (coords, label) => {
      for (const [name, angle] of [
        ['C3-N2-C10', bondAngleAtAtom(coords, 'N2', 'C3', 'C10')],
        ['C3-N2-C1', bondAngleAtAtom(coords, 'N2', 'C3', 'C1')],
        ['C10-N2-C1', bondAngleAtAtom(coords, 'N2', 'C10', 'C1')]
      ]) {
        assert.ok(
          Math.abs(angle - ((2 * Math.PI) / 3)) < 1e-6,
          `expected ${label} ${name} to stay at 120 degrees, got ${((angle * 180) / Math.PI).toFixed(2)}`
        );
      }
    };

    assert.equal(mixedResult.supported, true);
    assertN2Spread(mixedResult.coords, 'mixed layout');
    assertN2Spread(pipelineResult.coords, 'pipeline layout');
    assert.equal(pipelineResult.metadata.audit.ok, true);
  });

  it('keeps secondary anilino direct-attached phenyls on hidden-h trigonal slots', () => {
    const smiles = '[H][C@@](NC1=CC(C)=CC=C1C(C)=O)(C(N)=O)C1=C(Br)C=CC=C1Br';
    const graph = createLayoutGraph(parseSMILES(smiles), { suppressH: true });
    const component = graph.components[0];
    const plan = buildScaffoldPlan(graph, component);
    const mixedResult = layoutMixedFamily(graph, component, buildAdjacency(graph, new Set(component.atomIds)), plan, graph.options.bondLength);
    const pipelineResult = runPipeline(parseSMILES(smiles), {
      suppressH: true,
      auditTelemetry: true,
      finalLandscapeOrientation: true
    });
    const assertN3HiddenHSpread = (coords, label) => {
      for (const [name, angle] of [
        ['C2-N3-C4', bondAngleAtAtom(coords, 'N3', 'C2', 'C4')],
        ['C2-N3-H25', bondAngleAtAtom(coords, 'N3', 'C2', 'H25')],
        ['C4-N3-H25', bondAngleAtAtom(coords, 'N3', 'C4', 'H25')]
      ]) {
        assert.ok(
          Math.abs(angle - ((2 * Math.PI) / 3)) < 1e-6,
          `expected ${label} ${name} to stay at 120 degrees, got ${((angle * 180) / Math.PI).toFixed(2)}`
        );
      }
    };

    assert.equal(mixedResult.supported, true);
    assertN3HiddenHSpread(mixedResult.coords, 'mixed layout');
    assertN3HiddenHSpread(pipelineResult.coords, 'pipeline layout');
    assert.equal(pipelineResult.metadata.audit.ok, true);
    assert.equal(pipelineResult.metadata.audit.severeOverlapCount, 0);
  });

  it('uses alternate imine aryl slots before snapping downstream biphenyl roots', () => {
    const smiles = 'CC(=NC1=CC=CC=C1C1=CC=CC=C1)C1=CC=CC(=N1)C(C)=NC1=CC=CC=C1C1=CC=CC=C1';
    const graph = createLayoutGraph(parseSMILES(smiles), { suppressH: true });
    const component = graph.components[0];
    const plan = buildScaffoldPlan(graph, component);
    const mixedResult = layoutMixedFamily(graph, component, buildAdjacency(graph, new Set(component.atomIds)), plan, graph.options.bondLength);
    const pipelineResult = runPipeline(parseSMILES(smiles), {
      suppressH: true,
      auditTelemetry: true
    });
    const assertCleanImineBiphenylChain = (layoutGraph, coords, bondValidationClasses, label) => {
      const audit = auditLayout(layoutGraph, coords, {
        bondLength: layoutGraph.options.bondLength,
        bondValidationClasses
      });
      const readability = measureRingSubstituentReadability(layoutGraph, coords);

      assert.equal(audit.ok, true, `expected ${label} to pass layout audit`);
      assert.equal(readability.failingSubstituentCount, 0, `expected ${label} ring substituents to stay readable`);
      for (const [name, angle] of [
        ['C2-N3-C4', bondAngleAtAtom(coords, 'N3', 'C2', 'C4')],
        ['C22-N24-C25', bondAngleAtAtom(coords, 'N24', 'C22', 'C25')],
        ['C15-C10-C9', bondAngleAtAtom(coords, 'C10', 'C15', 'C9')],
        ['C11-C10-C9', bondAngleAtAtom(coords, 'C10', 'C11', 'C9')],
        ['C36-C31-C30', bondAngleAtAtom(coords, 'C31', 'C36', 'C30')],
        ['C32-C31-C30', bondAngleAtAtom(coords, 'C31', 'C32', 'C30')]
      ]) {
        assert.ok(
          Math.abs(angle - ((2 * Math.PI) / 3)) < 1e-6,
          `expected ${label} ${name} to stay at 120 degrees, got ${((angle * 180) / Math.PI).toFixed(2)}`
        );
      }
      assert.ok(
        distance(coords.get('C1'), coords.get('C15')) > layoutGraph.options.bondLength * 0.75,
        `expected ${label} left imine methyl to clear the downstream biphenyl ortho carbon`
      );
      assert.ok(
        distance(coords.get('C23'), coords.get('C32')) > layoutGraph.options.bondLength * 0.75,
        `expected ${label} right imine methyl to clear the downstream biphenyl ortho carbon`
      );
    };

    assert.equal(mixedResult.supported, true);
    assertCleanImineBiphenylChain(graph, mixedResult.coords, mixedResult.bondValidationClasses, 'mixed layout');
    assert.equal(pipelineResult.metadata.audit.ok, true);
    assertCleanImineBiphenylChain(pipelineResult.layoutGraph, pipelineResult.coords, pipelineResult.bondValidationClasses, 'pipeline layout');
  });

  it('mirrors direct-attached halophenyl blocks so terminal labels clear neighboring rings', () => {
    const smiles = 'Fc1ccccc1C2=NC(NC(=O)c3ccc[nH]3)C(=O)Nc4ccccc24';
    const result = runPipeline(parseSMILES(smiles), {
      suppressH: true,
      auditTelemetry: true
    });
    const graph = result.layoutGraph;
    const fluorineAtomId = 'F1';
    const fluorineNeighborId = (graph.bondsByAtomId.get(fluorineAtomId) ?? [])
      .map(bond => (bond.a === fluorineAtomId ? bond.b : bond.a))
      .find(atomId => graph.atoms.get(atomId)?.element !== 'H');
    const fluorophenylRing = (graph.atomToRings.get(fluorineNeighborId) ?? [])[0];
    const excludedAtomIds = new Set([fluorineAtomId, ...(fluorophenylRing?.atomIds ?? [])]);
    const bondedToFluorineAtomIds = new Set((graph.bondsByAtomId.get(fluorineAtomId) ?? [])
      .map(bond => (bond.a === fluorineAtomId ? bond.b : bond.a)));
    let closestScaffoldDistance = Number.POSITIVE_INFINITY;

    for (const [atomId, atom] of graph.atoms) {
      if (
        !atom
        || atom.element === 'H'
        || excludedAtomIds.has(atomId)
        || bondedToFluorineAtomIds.has(atomId)
        || !result.coords.has(atomId)
      ) {
        continue;
      }
      closestScaffoldDistance = Math.min(
        closestScaffoldDistance,
        distance(result.coords.get(fluorineAtomId), result.coords.get(atomId))
      );
    }

    assert.equal(result.metadata.audit.ok, true);
    assert.ok(
      closestScaffoldDistance > graph.options.bondLength * 0.75,
      `expected ortho fluorine label to clear the neighboring scaffold, got ${closestScaffoldDistance.toFixed(3)}`
    );
  });

  it('keeps crowded terminal aryl fluorine leaves on the exact local ring-outward axis', () => {
    const smiles = 'FC1=CC=CC(=C1)C1=CC(=CC=C1C1=CC(=CC(=C1)C(F)(F)F)C(F)(F)F)C(=O)N1CCC(C1)C1=CC=CN=C1';
    const graph = createLayoutGraph(parseSMILES(smiles), { suppressH: true });
    const component = graph.components[0];
    const plan = buildScaffoldPlan(graph, component);
    const mixedResult = layoutMixedFamily(graph, component, buildAdjacency(graph, new Set(component.atomIds)), plan, graph.options.bondLength);
    const pipelineResult = runPipeline(parseSMILES(smiles), {
      suppressH: true,
      auditTelemetry: true
    });
    const assertC2Fluorine = (layoutGraph, coords, bondValidationClasses, label) => {
      const audit = auditLayout(layoutGraph, coords, {
        bondLength: layoutGraph.options.bondLength,
        bondValidationClasses
      });
      const fluorineDeviation = bestLocalRingDeviation(layoutGraph, coords, 'C2', 'F1');
      const firstFluorineAngle = bondAngleAtAtom(coords, 'C2', 'C7', 'F1');
      const secondFluorineAngle = bondAngleAtAtom(coords, 'C2', 'C3', 'F1');

      assert.equal(audit.ok, true, `expected ${label} to pass layout audit`);
      assert.ok(
        fluorineDeviation < 1e-6,
        `expected ${label} C2-F1 to follow the exact local ring-outward axis, got ${((fluorineDeviation * 180) / Math.PI).toFixed(2)} degrees`
      );
      assert.ok(
        Math.abs(firstFluorineAngle - ((2 * Math.PI) / 3)) < 1e-6,
        `expected ${label} C7-C2-F1 near 120 degrees, got ${((firstFluorineAngle * 180) / Math.PI).toFixed(2)}`
      );
      assert.ok(
        Math.abs(secondFluorineAngle - ((2 * Math.PI) / 3)) < 1e-6,
        `expected ${label} C3-C2-F1 near 120 degrees, got ${((secondFluorineAngle * 180) / Math.PI).toFixed(2)}`
      );
      assert.ok(
        distance(coords.get('F1'), coords.get('F23')) > layoutGraph.options.bondLength * 0.55,
        `expected ${label} neighboring CF3 fluorine to clear the restored C2-F1 slot`
      );
    };

    assert.equal(mixedResult.supported, true);
    assertC2Fluorine(graph, mixedResult.coords, mixedResult.bondValidationClasses, 'mixed layout');
    assertC2Fluorine(pipelineResult.layoutGraph, pipelineResult.coords, pipelineResult.bondValidationClasses, 'pipeline layout');
  });

  it('keeps terminal aryl fluorine angles readable while backing crowded ring carbonyl oxygens off nearby rings', () => {
    const smiles = 'OC1CCC(CC1)NC(=O)[C@@H]2NC3(CCCCC3)[C@]4([C@H]2c5cccc(Cl)c5F)C(=O)Nc6cc(Cl)ccc46';
    const result = runPipeline(parseSMILES(smiles), {
      suppressH: true,
      auditTelemetry: true,
      finalLandscapeOrientation: true
    });
    const bondLength = result.layoutGraph.options.bondLength;
    const fluorineAngles = [
      bondAngleAtAtom(result.coords, 'C29', 'C23', 'F30'),
      bondAngleAtAtom(result.coords, 'C29', 'C27', 'F30')
    ];
    const spiroJunctionAngles = [
      ['C14', 'C40'],
      ['C14', 'C21'],
      ['C14', 'C31'],
      ['C40', 'C21'],
      ['C40', 'C31'],
      ['C21', 'C31']
    ].map(([firstAtomId, secondAtomId]) => bondAngleAtAtom(result.coords, 'C20', firstAtomId, secondAtomId));
    const terminalRingCarbonylContactPenalty = measureTerminalRingCarbonylLeafContactPenalty(
      result.layoutGraph,
      result.coords,
      { bondLength }
    );

    assert.equal(result.metadata.audit.ok, true);
    for (const angle of fluorineAngles) {
      assert.ok(
        Math.abs(angle - ((2 * Math.PI) / 3)) <= Math.PI / 28,
        `expected the terminal aryl fluorine fan near 120 degrees, got ${((angle * 180) / Math.PI).toFixed(2)}`
      );
    }
    assert.ok(
      Math.min(...spiroJunctionAngles) >= Math.PI * 0.4,
      `expected the spiro junction ring blocks to stay separated at C20, got minimum angle ${((Math.min(...spiroJunctionAngles) * 180) / Math.PI).toFixed(2)} degrees`
    );
    assert.equal(terminalRingCarbonylContactPenalty, 0);
    assert.ok(
      distance(result.coords.get('O32'), result.coords.get('C23')) > bondLength * 0.75,
      'expected the terminal ring carbonyl oxygen to clear the neighboring aromatic carbon'
    );
    assert.ok(
      distance(result.coords.get('O32'), result.coords.get('C21')) > bondLength * 0.65,
      'expected the terminal ring carbonyl oxygen to keep readable clearance from the adjacent ring atom'
    );
  });

  it('keeps terminal chlorophenyl C29 angles exact on fused tricyclic scaffolds', () => {
    const smiles = 'COc1ccc(cc1)C2CC3=C(C(Nc4cc(C)ccc4N3)c5c(F)cccc5Cl)C(=O)C2';
    const graph = createLayoutGraph(parseSMILES(smiles), { suppressH: true });
    const component = graph.components[0];
    const plan = buildScaffoldPlan(graph, component);
    const mixedResult = layoutMixedFamily(graph, component, buildAdjacency(graph, new Set(component.atomIds)), plan, graph.options.bondLength);
    const pipelineResult = runPipeline(parseSMILES(smiles), {
      suppressH: true,
      auditTelemetry: true,
      finalLandscapeOrientation: true
    });
    const assertTerminalChlorophenylFan = (layoutGraph, coords, bondValidationClasses, label) => {
      const audit = auditLayout(layoutGraph, coords, {
        bondLength: layoutGraph.options.bondLength,
        bondValidationClasses
      });
      const c29Angles = [
        bondAngleAtAtom(coords, 'C29', 'C23', 'C28'),
        bondAngleAtAtom(coords, 'C29', 'C23', 'Cl30'),
        bondAngleAtAtom(coords, 'C29', 'C28', 'Cl30')
      ];

      assert.equal(audit.ok, true, `expected ${label} to pass layout audit`);
      for (const angle of c29Angles) {
        assert.ok(
          Math.abs(angle - ((2 * Math.PI) / 3)) < 1e-6,
          `expected ${label} C29 chlorophenyl fan to stay exact, got ${((angle * 180) / Math.PI).toFixed(2)} degrees`
        );
      }
    };

    assert.equal(mixedResult.supported, true);
    assertTerminalChlorophenylFan(graph, mixedResult.coords, mixedResult.bondValidationClasses, 'mixed layout');
    assertTerminalChlorophenylFan(pipelineResult.layoutGraph, pipelineResult.coords, pipelineResult.bondValidationClasses, 'pipeline layout');
  });

  it('keeps compact carbonyl roots exact on non-aromatic trigonal ring anchors', () => {
    const smiles = 'CN([C@H](CN1CCCC1)c2cccc(NC(=O)C\\N=C(/S)\\N=C\\3/C=CC(=C4c5ccc(O)cc5Oc6cc(O)ccc46)C(=C3)C(=O)O)c2)C(=O)Cc7ccc(Cl)c(Cl)c7';
    const graph = createLayoutGraph(parseSMILES(smiles), { suppressH: true });
    const component = graph.components[0];
    const plan = buildScaffoldPlan(graph, component);
    const mixedResult = layoutMixedFamily(graph, component, buildAdjacency(graph, new Set(component.atomIds)), plan, graph.options.bondLength);
    const pipelineResult = runPipeline(parseSMILES(smiles), {
      suppressH: true,
      auditTelemetry: true,
      finalLandscapeOrientation: true
    });
    const assertCarbonylRootExact = (layoutGraph, coords, bondValidationClasses, label) => {
      const audit = auditLayout(layoutGraph, coords, {
        bondLength: layoutGraph.options.bondLength,
        bondValidationClasses
      });
      const rootAngles = [
        bondAngleAtAtom(coords, 'C44', 'C27', 'C45'),
        bondAngleAtAtom(coords, 'C44', 'C27', 'C46'),
        bondAngleAtAtom(coords, 'C44', 'C45', 'C46')
      ];

      assert.equal(audit.ok, true, `expected ${label} to pass layout audit`);
      for (const angle of rootAngles) {
        assert.ok(
          Math.abs(angle - ((2 * Math.PI) / 3)) < 1e-6,
          `expected ${label} C44 carbonyl root fan to stay exact, got ${((angle * 180) / Math.PI).toFixed(2)} degrees`
        );
      }
      assert.ok(
        distance(coords.get('C46'), coords.get('O47')) >= layoutGraph.options.bondLength * 0.5,
        `expected ${label} carbonyl oxygen compression to stay readable`
      );
    };

    assert.equal(mixedResult.supported, true);
    assertCarbonylRootExact(graph, mixedResult.coords, mixedResult.bondValidationClasses, 'mixed layout');
    assertCarbonylRootExact(pipelineResult.layoutGraph, pipelineResult.coords, pipelineResult.bondValidationClasses, 'pipeline layout');
  });

  it('retries an alternate mixed root when the default aromatic root leaves overlapping ring-linker geometry', () => {
    const smiles = 'COC1=CC(=CC(OC)=C1OC)C(F)(F)C(=O)N1CCCC[C@H]1C(=O)O[C@@H](CCCC1=CC=CC=C1)CCCC1=CN=CC=C1';
    const graph = createLayoutGraph(parseSMILES(smiles), { suppressH: true });
    const component = graph.components[0];
    const plan = buildScaffoldPlan(graph, component);
    const result = layoutMixedFamily(graph, component, buildAdjacency(graph, new Set(component.atomIds)), plan, graph.options.bondLength);
    const audit = auditLayout(graph, result.coords, {
      bondLength: graph.options.bondLength,
      bondValidationClasses: result.bondValidationClasses
    });

    assert.equal(plan.rootScaffold.id, 'ring-system:2');
    assert.equal(result.supported, true);
    assert.ok(
      result.rootRetryUsed || result.rootScaffoldId === plan.rootScaffold.id,
      'expected the mixed root selection to end on a clean scaffold, whether that comes from the default root or an alternate-root retry'
    );
    if (result.rootRetryUsed) {
      assert.ok((result.rootRetryAttemptCount ?? 0) >= 1);
    } else {
      assert.equal(result.rootRetryAttemptCount ?? 0, 0);
    }
    assert.equal(audit.severeOverlapCount, 0);
    assert.equal(audit.labelOverlapCount, 0);
    assert.ok(Math.abs(bondAngleAtAtom(result.coords, 'C3', 'O2', 'C4') - ((2 * Math.PI) / 3)) < 1e-6);
    assert.ok(Math.abs(bondAngleAtAtom(result.coords, 'C3', 'O2', 'C10') - ((2 * Math.PI) / 3)) < 1e-6);
    assert.ok(Math.abs(bondAngleAtAtom(result.coords, 'C16', 'C13', 'O17') - ((2 * Math.PI) / 3)) < 1e-6);
    assert.ok(Math.abs(bondAngleAtAtom(result.coords, 'C16', 'C13', 'N18') - ((2 * Math.PI) / 3)) < 1e-6);
    assert.ok(Math.abs(bondAngleAtAtom(result.coords, 'C16', 'O17', 'N18') - ((2 * Math.PI) / 3)) < 1e-6);
    assert.ok(Math.abs(bondAngleAtAtom(result.coords, 'N18', 'C16', 'C23') - ((2 * Math.PI) / 3)) < 1e-6);
    assert.ok(Math.abs(bondAngleAtAtom(result.coords, 'N18', 'C16', 'C19') - ((2 * Math.PI) / 3)) < 1e-6);
    assert.ok(Math.abs(bondAngleAtAtom(result.coords, 'C23', 'N18', 'C25') - ((2 * Math.PI) / 3)) < 1e-6);
    assert.ok(Math.abs(bondAngleAtAtom(result.coords, 'C23', 'C22', 'C25') - ((2 * Math.PI) / 3)) < 1e-6);
    assert.ok(Math.abs(bondAngleAtAtom(result.coords, 'C5', 'C6', 'C13') - ((2 * Math.PI) / 3)) < 1e-6);
    assert.ok(Math.abs(bondAngleAtAtom(result.coords, 'C5', 'C4', 'C13') - ((2 * Math.PI) / 3)) < 1e-6);
    assert.ok(Math.abs(bondAngleAtAtom(result.coords, 'C13', 'C5', 'C16') - (Math.PI / 2)) < 1e-6);
    assert.ok(Math.abs(bondAngleAtAtom(result.coords, 'C13', 'F14', 'F15') - (Math.PI / 2)) < 0.04);
  });

  it('reserves exact attached-ring space before growing crowded carbonyl branches', () => {
    const smiles = 'Cc1ccc(CC(CN)(Cc2ccc(C)cc2)C(=O)N[C@@H](<CCCCNC(=N)N>)C(=O)N)cc1';
    const result = runPipeline(parseSMILES(smiles), { suppressH: true });
    const audit = result.metadata.audit;
    const bondLength = result.layoutGraph.options.bondLength;
    const crowdedRingOxygenDistance = distance(result.coords.get('C17'), result.coords.get('O19'));

    assert.equal(audit.ok, true);
    assert.ok(
      crowdedRingOxygenDistance > bondLength * 0.7,
      `expected C17-O19 to clear the visible overlap pocket, got ${crowdedRingOxygenDistance.toFixed(3)}`
    );
    for (const [name, angle] of [
      ['C10-C11-C12', bondAngleAtAtom(result.coords, 'C11', 'C10', 'C12')],
      ['C10-C11-C17', bondAngleAtAtom(result.coords, 'C11', 'C10', 'C17')],
      ['C12-C11-C17', bondAngleAtAtom(result.coords, 'C11', 'C12', 'C17')],
      ['C7-C18-O19', bondAngleAtAtom(result.coords, 'C18', 'C7', 'O19')],
      ['C7-C18-N20', bondAngleAtAtom(result.coords, 'C18', 'C7', 'N20')],
      ['O19-C18-N20', bondAngleAtAtom(result.coords, 'C18', 'O19', 'N20')]
    ]) {
      assert.ok(
        Math.abs(angle - ((2 * Math.PI) / 3)) < 1e-6,
        `expected ${name} to stay at 120 degrees, got ${((angle * 180) / Math.PI).toFixed(2)}`
      );
    }
  });

  it('reserves the opposite projected slot for deferred aryl roots on alcohol-bearing diaryl centers', () => {
    const smiles = 'COC1=C(C=C2C(C=CC=C2C(O)(CC[NH+](C)C)C2=C(F)C=CC=C2F)=N1)C1=CC=CC=C1';
    const graph = createLayoutGraph(parseSMILES(smiles), { suppressH: true });
    const component = graph.components[0];
    const plan = buildScaffoldPlan(graph, component);
    const mixedResult = layoutMixedFamily(graph, component, buildAdjacency(graph, new Set(component.atomIds)), plan, graph.options.bondLength);
    const pipelineResult = runPipeline(parseSMILES(smiles), {
      suppressH: true,
      auditTelemetry: true
    });

    const assertProjectedC12Hub = (layoutGraph, coords, bondValidationClasses, label) => {
      const audit = auditLayout(layoutGraph, coords, {
        bondLength: layoutGraph.options.bondLength,
        bondValidationClasses
      });

      assert.equal(audit.severeOverlapCount, 0, `expected ${label} to clear the C15-side aryl overlap`);
      for (const [name, angle, targetAngle] of [
        ['O13-C12-C14', bondAngleAtAtom(coords, 'C12', 'O13', 'C14'), Math.PI],
        ['C20-C12-C11', bondAngleAtAtom(coords, 'C12', 'C20', 'C11'), Math.PI],
        ['O13-C12-C20', bondAngleAtAtom(coords, 'C12', 'O13', 'C20'), Math.PI / 2],
        ['O13-C12-C11', bondAngleAtAtom(coords, 'C12', 'O13', 'C11'), Math.PI / 2],
        ['C14-C12-C20', bondAngleAtAtom(coords, 'C12', 'C14', 'C20'), Math.PI / 2],
        ['C14-C12-C11', bondAngleAtAtom(coords, 'C12', 'C14', 'C11'), Math.PI / 2]
      ]) {
        assert.ok(
          Math.abs(angle - targetAngle) < 1e-6,
          `expected ${label} ${name} to stay projected, got ${((angle * 180) / Math.PI).toFixed(2)} degrees`
        );
      }
      assert.ok(
        distance(coords.get('C15'), coords.get('C21')) > layoutGraph.options.bondLength * 0.85,
        `expected ${label} C15-side chain to clear the fluorophenyl ortho carbon`
      );
      assert.ok(
        bestLocalRingDeviation(layoutGraph, coords, 'C21', 'F22') < 1e-6,
        `expected ${label} F22 to keep the exact local C21 ring-outward slot`
      );
      assert.ok(
        Math.abs(bondAngleAtAtom(coords, 'C21', 'C20', 'F22') - ((2 * Math.PI) / 3)) < 1e-6,
        `expected ${label} C20-C21-F22 to stay at 120 degrees`
      );
    };

    assert.equal(mixedResult.supported, true);
    assertProjectedC12Hub(graph, mixedResult.coords, mixedResult.bondValidationClasses, 'mixed layout');
    assert.equal(pipelineResult.metadata.audit.ok, true);
    assertProjectedC12Hub(pipelineResult.layoutGraph, pipelineResult.coords, pipelineResult.bondValidationClasses, 'pipeline layout');
  });

  it('keeps methoxy triaryl thiazinone centers on projected tetrahedral slots', () => {
    const smiles = 'COC(CN1CCS(=O)C(=CC2=CC=C(Cl)C=C2)C1=O)(C1=CC=C(Cl)C=C1)C1=CC=C(Cl)C=C1';
    const graph = createLayoutGraph(parseSMILES(smiles), { suppressH: true });
    const component = graph.components[0];
    const plan = buildScaffoldPlan(graph, component);
    const mixedResult = layoutMixedFamily(graph, component, buildAdjacency(graph, new Set(component.atomIds)), plan, graph.options.bondLength);
    const pipelineResult = runPipeline(parseSMILES(smiles), {
      suppressH: true,
      auditTelemetry: true,
      finalLandscapeOrientation: true
    });

    const assertProjectedC3 = (layoutGraph, coords, bondValidationClasses, label) => {
      const adjacency = buildAdjacency(layoutGraph, new Set(layoutGraph.components[0].atomIds));
      const audit = auditLayout(layoutGraph, coords, {
        bondLength: layoutGraph.options.bondLength,
        bondValidationClasses
      });
      const separations = sortedHeavyNeighborSeparations(adjacency, coords, 'C3', layoutGraph);

      assert.equal(audit.ok, true, `expected ${label} to stay audit-clean`);
      assert.deepEqual(findVisibleHeavyBondCrossings(layoutGraph, coords), [], `expected ${label} to avoid visible bond crossings`);
      assert.equal(separations.length, 4, `expected four visible heavy neighbors around C3 in ${label}`);
      for (const separation of separations) {
        assert.ok(
          Math.abs(separation - (Math.PI / 2)) < 1e-6,
          `expected ${label} C3 neighbors to keep projected tetrahedral slots, got ${((separation * 180) / Math.PI).toFixed(2)} degrees`
        );
      }
    };

    assert.equal(mixedResult.supported, true);
    assertProjectedC3(graph, mixedResult.coords, mixedResult.bondValidationClasses, 'mixed layout');
    assert.equal(pipelineResult.metadata.audit.ok, true);
    assertProjectedC3(pipelineResult.layoutGraph, pipelineResult.coords, pipelineResult.bondValidationClasses, 'pipeline layout');
  });

  it('defers terminal methyl leaves on planar nitrogens until pending rings can claim trigonal slots', () => {
    const smiles = 'COc1cc2ccccc2cc1C(=O)OCC(=O)N(C)C3=C(N)N(Cc4ccccc4)C(=O)NC3=O';
    const result = runPipeline(parseSMILES(smiles), { suppressH: true, auditTelemetry: true });
    const graph = result.layoutGraph;
    const adjacency = buildAdjacency(graph, new Set(graph.components[0].atomIds));
    const separations = sortedHeavyNeighborSeparations(adjacency, result.coords, 'N19', graph);

    assert.equal(result.metadata.audit.ok, true);
    assert.equal(separations.length, 3, 'expected three visible heavy neighbors around N19');
    for (const separation of separations) {
      assert.ok(
        Math.abs(separation - ((2 * Math.PI) / 3)) < 1e-6,
        `expected N19 to keep a planar trigonal spread, got ${((separation * 180) / Math.PI).toFixed(2)} degrees`
      );
    }
  });

  it('reserves projected side slots on saturated parents before a second attached ring arrives', () => {
    const smiles = 'CC(=O)Nc1cccc(c1)c2csc(n2)C(C)(O)c3cccc(F)c3';
    const graph = createLayoutGraph(parseSMILES(smiles), { suppressH: true });
    const component = graph.components[0];
    const plan = buildScaffoldPlan(graph, component);
    const mixedResult = layoutMixedFamily(graph, component, buildAdjacency(graph, new Set(component.atomIds)), plan, graph.options.bondLength);
    const pipelineResult = runPipeline(parseSMILES(smiles), { suppressH: true, auditTelemetry: true });

    const assertProjectedCenter = (coords, layoutGraph, label) => {
      const adjacency = buildAdjacency(layoutGraph, new Set(layoutGraph.components[0].atomIds));
      const separations = sortedHeavyNeighborSeparations(adjacency, coords, 'C16', layoutGraph);
      assert.equal(separations.length, 4, `expected four visible heavy neighbors around C16 in ${label}`);
      for (const separation of separations) {
        assert.ok(
          Math.abs(separation - (Math.PI / 2)) < 1e-6,
          `expected ${label} C16 neighbors to keep projected side slots, got ${((separation * 180) / Math.PI).toFixed(2)} degrees`
        );
      }
      assert.ok(
        Math.abs(bondAngleAtAtom(coords, 'C16', 'C14', 'C19') - Math.PI) < 1e-6,
        `expected ${label} attached rings at C16 to stay opposite`
      );
    };

    assert.equal(mixedResult.supported, true);
    assertProjectedCenter(mixedResult.coords, graph, 'mixed layout');
    assert.equal(pipelineResult.metadata.audit.ok, true);
    assertProjectedCenter(pipelineResult.coords, pipelineResult.layoutGraph, 'pipeline layout');
  });

  it('keeps parent-side mirrored subtrees fixed during direct-attached ring refinement', () => {
    const smiles = 'CCCCP(=O)(C(=O)C1=C(CC)C=C(CC)C=C1CC)C(=O)C1=C(CC)C=C(CC)C=C1CC';
    const result = runPipeline(parseSMILES(smiles), { suppressH: true, auditTelemetry: true });
    const targetBondLength = result.layoutGraph.options.bondLength;

    assert.equal(result.metadata.audit.ok, true);
    assert.equal(result.metadata.audit.bondLengthFailureCount, 0);
    assert.ok(
      Math.abs(distance(result.coords.get('P5'), result.coords.get('C7')) - targetBondLength) < 1e-6,
      'expected direct-attached ring refinement to preserve the P5-C7 parent-side bond length'
    );
    assert.ok(
      Math.abs(distance(result.coords.get('P5'), result.coords.get('C21')) - targetBondLength) < 1e-6,
      'expected the opposite phosphine oxide carbonyl arm to keep target bond length'
    );
    for (const [centerAtomId, firstNeighborAtomId, secondNeighborAtomId] of [
      ['C7', 'P5', 'O8'],
      ['C7', 'P5', 'C9'],
      ['C7', 'O8', 'C9'],
      ['C10', 'C9', 'C11'],
      ['C10', 'C11', 'C13'],
      ['C32', 'C23', 'C33'],
      ['C32', 'C31', 'C33']
    ]) {
      assert.ok(
        Math.abs(bondAngleAtAtom(result.coords, centerAtomId, firstNeighborAtomId, secondNeighborAtomId) - (2 * Math.PI) / 3) < 1e-6,
        `expected ${centerAtomId} aryl ethyl exit to stay at 120 degrees`
      );
    }
  });

  it('mirrors compact fused-bridged child rings outside the parent face', () => {
    const smiles = 'CC1=C(CO)C2=CC3CC(OC=N3)OC2C1';
    const graph = createLayoutGraph(parseSMILES(smiles), { suppressH: true });
    const component = graph.components[0];
    const mixedResult = layoutMixedFamily(
      graph,
      component,
      buildAdjacency(graph, new Set(component.atomIds)),
      buildScaffoldPlan(graph, component),
      graph.options.bondLength
    );
    const pipelineResult = runPipeline(parseSMILES(smiles), {
      suppressH: true,
      auditTelemetry: true,
      finalLandscapeOrientation: true
    });

    const assertFusedChildOutsideParent = (layoutGraph, coords, label) => {
      const parentRing = layoutGraph.rings[0];
      const fusedChildRing = layoutGraph.rings[2];
      const childCentroid = centroid(fusedChildRing.atomIds.map(atomId => coords.get(atomId)));
      assert.equal(
        pointInPolygon(
          childCentroid,
          parentRing.atomIds.map(atomId => coords.get(atomId))
        ),
        false,
        `expected ${label} fused child ring to sit outside the larger parent face`
      );
    };

    const mixedAudit = auditLayout(graph, mixedResult.coords, {
      bondLength: graph.options.bondLength,
      bondValidationClasses: mixedResult.bondValidationClasses
    });

    assert.equal(mixedResult.supported, true);
    assert.equal(mixedAudit.ok, true);
    assertFusedChildOutsideParent(graph, mixedResult.coords, 'mixed layout');
    assert.equal(pipelineResult.metadata.audit.ok, true);
    assertFusedChildOutsideParent(pipelineResult.layoutGraph, pipelineResult.coords, 'pipeline layout');
  });

  it('restores fused cyclopropane caps outside the parent ring face', () => {
    const smiles = 'CC12COC(=O)C(N1)C1CC21';
    const graph = createLayoutGraph(parseSMILES(smiles), { suppressH: true });
    const component = graph.components[0];
    const mixedResult = layoutMixedFamily(
      graph,
      component,
      buildAdjacency(graph, new Set(component.atomIds)),
      buildScaffoldPlan(graph, component),
      graph.options.bondLength
    );
    const pipelineResult = runPipeline(parseSMILES(smiles), {
      suppressH: true,
      auditTelemetry: true
    });

    const assertCyclopropaneCapOutsideParent = (layoutGraph, coords, label) => {
      const cyclopropaneRing = layoutGraph.rings.find(ring => ring.atomIds.length === 3 && ring.atomIds.includes('C10'));
      assert.ok(cyclopropaneRing, `expected ${label} to contain the C10 cyclopropane ring`);
      const connection = layoutGraph.ringConnections.find(candidateConnection => (
        candidateConnection.kind === 'fused'
        && candidateConnection.sharedAtomIds.length === 2
        && (
          candidateConnection.firstRingId === cyclopropaneRing.id
          || candidateConnection.secondRingId === cyclopropaneRing.id
        )
      ));
      assert.ok(connection, `expected ${label} cyclopropane ring to share a fused edge`);
      const parentRingId = connection.firstRingId === cyclopropaneRing.id
        ? connection.secondRingId
        : connection.firstRingId;
      const parentRing = layoutGraph.rings.find(ring => ring.id === parentRingId);
      assert.ok(parentRing, `expected ${label} cyclopropane ring to have a fused parent`);
      const capAtomId = cyclopropaneRing.atomIds.find(atomId => !connection.sharedAtomIds.includes(atomId));
      assert.equal(capAtomId, 'C10');
      assert.equal(
        pointInPolygon(
          coords.get(capAtomId),
          parentRing.atomIds.map(atomId => coords.get(atomId))
        ),
        false,
        `expected ${label} C10 cap to sit outside the fused parent ring`
      );
      for (const sharedAtomId of connection.sharedAtomIds) {
        assert.ok(
          Math.abs(distance(coords.get(capAtomId), coords.get(sharedAtomId)) - layoutGraph.options.bondLength) < 1e-6,
          `expected ${label} C10-${sharedAtomId} cyclopropane bond to keep target length`
        );
      }
    };

    const mixedAudit = auditLayout(graph, mixedResult.coords, {
      bondLength: graph.options.bondLength,
      bondValidationClasses: mixedResult.bondValidationClasses
    });

    assert.equal(mixedResult.supported, true);
    assert.equal(mixedAudit.ok, true);
    assertCyclopropaneCapOutsideParent(graph, mixedResult.coords, 'mixed layout');
    assert.equal(pipelineResult.metadata.audit.ok, true);
    assertCyclopropaneCapOutsideParent(pipelineResult.layoutGraph, pipelineResult.coords, 'pipeline layout');
  });

  it('rotates terminal carbon ring leaves away from later attached-ring bond crossings', () => {
    const smiles = 'COC1=CC=C(C2=C1NC(C1CCCC1)N2C)C1(CC2=CC=NC=C2)C(=O)C2=CC=C(OCC3=CC=CC=C3)C=C2C1=O';
    const result = runPipeline(parseSMILES(smiles), {
      suppressH: true,
      auditTelemetry: true,
      finalLandscapeOrientation: true
    });
    const adjacency = buildAdjacency(result.layoutGraph, new Set(result.layoutGraph.components[0].atomIds));
    const n16Separations = sortedHeavyNeighborSeparations(adjacency, result.coords, 'N16', result.layoutGraph);

    assert.equal(result.metadata.audit.ok, true);
    assert.deepEqual(findVisibleHeavyBondCrossings(result.layoutGraph, result.coords), []);
    assert.ok(
      distance(result.coords.get('C17'), result.coords.get('C20')) > result.layoutGraph.options.bondLength * 0.65,
      'expected the shortened terminal methyl bond to keep readable clearance from the attached pyridyl root'
    );
    assert.ok(
      distance(result.coords.get('C17'), result.coords.get('C25')) > result.layoutGraph.options.bondLength * 0.6,
      'expected the terminal methyl carbon to keep readable clearance from the crossed pyridyl edge'
    );
    assert.ok(
      distance(result.coords.get('N16'), result.coords.get('C17')) < result.layoutGraph.options.bondLength * 0.75,
      'expected the N16 methyl bond to shorten instead of swinging into a bad fan angle'
    );
    assert.ok(
      n16Separations[0] > (5 * Math.PI) / 9,
      `expected the N16 methyl fan to stay readable after crossing relief, got minimum separation ${((n16Separations[0] * 180) / Math.PI).toFixed(2)} degrees`
    );
  });

  it('stretches blocked bridgehead terminal methyl leaves to keep ammonium fans readable', () => {
    const smiles = 'Cc1ccc(F)cc1C(O)(C[C@H]2C[C@H]3CC[C@@H](C2)[N+]3(C)C)c4cc(F)ccc4C';
    const result = runPipeline(parseSMILES(smiles), {
      suppressH: true,
      auditTelemetry: true,
      finalLandscapeOrientation: true
    });
    const adjacency = buildAdjacency(result.layoutGraph, new Set(result.layoutGraph.components[0].atomIds));
    const n22Separations = sortedHeavyNeighborSeparations(adjacency, result.coords, 'N22', result.layoutGraph);
    const methylBondLengths = ['C23', 'C24'].map(atomId => distance(result.coords.get('N22'), result.coords.get(atomId)));

    assert.equal(result.metadata.audit.ok, true);
    assert.ok(
      n22Separations[0] >= (11 * Math.PI) / 36 - 1e-6,
      `expected the bridgehead ammonium methyl fan to keep at least 55 degrees, got ${((n22Separations[0] * 180) / Math.PI).toFixed(2)} degrees`
    );
    assert.ok(
      Math.max(...methylBondLengths) > result.layoutGraph.options.bondLength * 1.1,
      'expected one blocked terminal methyl bond to stretch out of the bridge core'
    );
    assert.ok(
      distance(result.coords.get('C23'), result.coords.get('C18')) > result.layoutGraph.options.bondLength * 0.55,
      'expected the stretched terminal methyl carbon to keep readable clearance from the bridge atom'
    );
  });

  it('keeps hydroxymethyl continuations bent when projected parent slots are crowded', () => {
    const smiles = 'CC(N)C(O)C(O)(CO)C1=C(C)C(=N)N=NS1';
    const result = runPipeline(parseSMILES(smiles), { suppressH: true, auditTelemetry: true });
    const hydroxymethylAngle = bondAngleAtAtom(result.coords, 'C8', 'C6', 'O9');

    assert.equal(result.metadata.audit.ok, true);
    assert.ok(
      Math.abs(hydroxymethylAngle - ((2 * Math.PI) / 3)) < 1e-6,
      `expected hydroxymethyl continuation to stay at 120 degrees, got ${((hydroxymethylAngle * 180) / Math.PI).toFixed(2)} degrees`
    );
  });

  it('lays out a macrocycle root scaffold plus substituent through the mixed orchestrator', () => {
    const graph = createLayoutGraph(makeMacrocycleWithSubstituent());
    const component = graph.components[0];
    const plan = buildScaffoldPlan(graph, component);
    const result = layoutMixedFamily(graph, component, buildAdjacency(graph, new Set(component.atomIds)), plan, graph.options.bondLength);
    assert.equal(result.supported, true);
    assert.equal(result.coords.size, 13);
    assert.ok(result.coords.has('a0'));
    assert.ok(result.coords.has('a12'));
  });
});

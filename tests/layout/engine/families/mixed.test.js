import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseSMILES } from '../../../../src/io/index.js';
import { auditLayout } from '../../../../src/layout/engine/audit/audit.js';
import { measureRingSubstituentReadability } from '../../../../src/layout/engine/audit/invariants.js';
import { pointInPolygon } from '../../../../src/layout/engine/geometry/polygon.js';
import { computeIncidentRingOutwardAngles } from '../../../../src/layout/engine/geometry/ring-direction.js';
import { createLayoutGraph } from '../../../../src/layout/engine/model/layout-graph.js';
import { buildScaffoldPlan } from '../../../../src/layout/engine/model/scaffold-plan.js';
import { layoutMixedFamily } from '../../../../src/layout/engine/families/mixed.js';
import { runPipeline } from '../../../../src/layout/engine/pipeline.js';
import { add, angleOf, angularDifference, centroid, distance, fromAngle, sub } from '../../../../src/layout/engine/geometry/vec2.js';
import { smallRingExteriorTargetAngles } from '../../../../src/layout/engine/placement/branch-placement.js';
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
    assert.ok(elapsed < 10000, `expected the mixed layout to finish comfortably under 10s, got ${elapsed}ms`);
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
    assert.ok(elapsed < 4200, `expected the mixed nucleotide layout to stay comfortably below the stress-test budget, got ${elapsed}ms`);
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
    assert.ok(elapsed < 15000, `expected the mixed peptide layout to stay below the exploratory branch-search budget on the full-suite host, got ${elapsed}ms`);
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
    assert.ok(elapsed < 5000, `expected the mixed peptide outlier to stay below the local branch-search budget, got ${elapsed}ms`);
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

  it('keeps the reported fused bridgehead methyl on the local outward ring axis through mixed placement and the full pipeline', () => {
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

    assert.equal(mixedResult.supported, true);
    assert.notEqual(straightJunctionAngle, null);
    assert.ok(mixedDeviation < 1e-6, `expected the bridgehead methyl to follow a local ring outward axis, got ${mixedDeviation.toFixed(6)} rad`);
    assert.ok(
      angularDifference(childAngle, straightJunctionAngle) > 0.9,
      `expected the bridgehead methyl to reject the shared-junction straight-through slot, got ${angularDifference(childAngle, straightJunctionAngle).toFixed(6)} rad`
    );
    assert.ok(pipelineDeviation < 1e-6, `expected the full pipeline to keep the bridgehead methyl on the local outward axis, got ${pipelineDeviation.toFixed(6)} rad`);
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

  it('rotates directly attached ring blocks around the parent bond when that clears multiple outward-axis failures at once', () => {
    const graph = createLayoutGraph(parseSMILES('CCN(C1CCC(CC1)[NH+](C)CC1=CC=CC(OCCOC)=C1)C1=CC(Cl)=CC(C(=O)NCC2=C(C)NC(C)=CC2=O)=C1C'), { suppressH: true });
    const component = graph.components[0];
    const plan = buildScaffoldPlan(graph, component);
    const result = layoutMixedFamily(graph, component, buildAdjacency(graph, new Set(component.atomIds)), plan, graph.options.bondLength);
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

    assert.equal(result.supported, true);
    assert.equal(audit.ringSubstituentReadabilityFailureCount, 0);
    assert.ok(attachmentDeviation < 1e-6, `expected the attached-ring root bond to follow the local outward axis, got ${attachmentDeviation.toFixed(6)} rad`);
    assert.ok(chlorineDeviation < 1e-6, `expected the chlorine substituent to follow the local outward axis, got ${chlorineDeviation.toFixed(6)} rad`);
    assert.ok(methylDeviation < 1e-6, `expected the nearby methyl substituent to follow the local outward axis, got ${methylDeviation.toFixed(6)} rad`);
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

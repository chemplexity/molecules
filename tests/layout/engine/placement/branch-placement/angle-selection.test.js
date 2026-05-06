import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseSMILES } from '../../../../../src/io/smiles.js';
import { createLayoutGraph } from '../../../../../src/layout/engine/model/layout-graph.js';
import {
  chooseContinuationAngle,
  isExactRingOutwardEligibleSubstituent,
  isExactSimpleAcyclicContinuationEligible,
  isExactVisibleTrigonalBisectorEligible
} from '../../../../../src/layout/engine/placement/branch-placement/angle-selection.js';
import { angularDifference, fromAngle } from '../../../../../src/layout/engine/geometry/vec2.js';

function degrees(value) {
  return (value * Math.PI) / 180;
}

describe('layout/engine/placement/branch-placement/angle-selection', () => {
  it('treats simple divalent carbon linkers as exact-continuation candidates', () => {
    const graph = createLayoutGraph(parseSMILES('NC(CC1=CNC=N1)C(O)=O'), { suppressH: true });

    assert.equal(isExactSimpleAcyclicContinuationEligible(graph, 'C3', 'C4', 'C2'), true);
    assert.equal(isExactSimpleAcyclicContinuationEligible(graph, 'C2', 'C3', 'C9'), false);
  });

  it('treats conjugated amide nitrogens as exact-continuation candidates', () => {
    const graph = createLayoutGraph(parseSMILES('CC1=NC(NC2=NC=C(S2)C(=O)NC2=C(C)C=CC=C2Cl)=CC(=N1)N1CCN(CCO)CC1'), { suppressH: true });

    assert.equal(isExactSimpleAcyclicContinuationEligible(graph, 'N13', 'C11', 'C14'), true);
    assert.equal(isExactSimpleAcyclicContinuationEligible(graph, 'N25', 'C23', 'C26'), false);
  });

  it('treats aryl ether oxygens as exact-continuation candidates for alkyl chains', () => {
    const graph = createLayoutGraph(parseSMILES('CCOC1=CSC2=C1NC(OC2=O)=NCCO'), { suppressH: true });

    assert.equal(isExactSimpleAcyclicContinuationEligible(graph, 'O3', 'C4', 'C2'), true);
  });

  it('treats visible non-ring trigonal carbons as exact bisector candidates for their last single-bond branch', () => {
    const graph = createLayoutGraph(parseSMILES('CC\\C(=C/1\\N=C(OC1=O)c2ccc(Cl)cc2Cl)\\N3CCC[C@H]3C(=O)N[C@@H](<Cc4ccc(O)cc4>)C(=O)N'), { suppressH: true });

    assert.equal(isExactVisibleTrigonalBisectorEligible(graph, 'C3', 'N18'), true);
    assert.equal(isExactVisibleTrigonalBisectorEligible(graph, 'C3', 'C4'), false);
  });

  it('treats planar conjugated tertiary nitrogens as exact bisector candidates', () => {
    const conjugatedGraph = createLayoutGraph(parseSMILES('CCCC(O)CN=CN(C)C(C)C(C)=NO'), { suppressH: true });
    const acylHydrazineGraph = createLayoutGraph(parseSMILES('CCCCC([NH3+])C(=O)CN(NC(=O)C(C[NH3+])OC1=CC=CC=C1)C(C1=CC=CC=C1)C1=CC=CC=C1'), { suppressH: true });
    const arylConjugatedGraph = createLayoutGraph(parseSMILES('CCN(C1CCC(CC1)[NH+](C)CC1=CC=CC(OCCOC)=C1)C1=CC(Cl)=CC(C(=O)NCC2=C(C)NC(C)=CC2=O)=C1C'), { suppressH: true });
    const sulfonylConjugatedGraph = createLayoutGraph(parseSMILES('CC(C)N(S(C)(=O)=O)S(C)(=O)=O'), { suppressH: true });
    const ringAmideGraph = createLayoutGraph(parseSMILES('CS(=O)(=O)c1cn[nH]c1C2CCCCN2C(=O)Cc3cccnc3'), { suppressH: true });
    const saturatedGraph = createLayoutGraph(parseSMILES('CN(C)C'), { suppressH: true });
    const saturatedNitrogenId = [...saturatedGraph.atoms.values()].find(atom => atom.element === 'N')?.id;
    const saturatedMethylId = (saturatedGraph.bondsByAtomId.get(saturatedNitrogenId) ?? [])
      .map(bond => bond.a === saturatedNitrogenId ? bond.b : bond.a)
      .find(atomId => saturatedGraph.atoms.get(atomId)?.element === 'C');

    assert.equal(isExactVisibleTrigonalBisectorEligible(conjugatedGraph, 'N9', 'C10'), true);
    assert.equal(isExactVisibleTrigonalBisectorEligible(acylHydrazineGraph, 'N11', 'C26'), true);
    assert.equal(isExactVisibleTrigonalBisectorEligible(arylConjugatedGraph, 'N3', 'C25'), true);
    assert.equal(isExactVisibleTrigonalBisectorEligible(sulfonylConjugatedGraph, 'N4', 'S9'), true);
    assert.equal(isExactVisibleTrigonalBisectorEligible(ringAmideGraph, 'N16', 'C17'), true);
    assert.equal(isExactVisibleTrigonalBisectorEligible(ringAmideGraph, 'N16', 'C11'), false);
    assert.ok(saturatedNitrogenId);
    assert.ok(saturatedMethylId);
    assert.equal(isExactVisibleTrigonalBisectorEligible(saturatedGraph, saturatedNitrogenId, saturatedMethylId), false);
  });

  it('limits exact ring-outward placement to rigid carbon roots instead of flexible chain carbons', () => {
    const flexibleGraph = createLayoutGraph(parseSMILES('C1=C(NC=N1)CC(C(=O)N[C@@H](CCCCN)C(=O)O)NC(=O)CN'), { suppressH: true });
    const nitrileGraph = createLayoutGraph(parseSMILES('N#Cc1ccccc1'), { suppressH: true });
    const methylGraph = createLayoutGraph(parseSMILES('Cc1ccccc1'), { suppressH: true });
    const ringConstrainedGraph = createLayoutGraph(parseSMILES('CC(N1CC(C)(C[NH3+])C1)C1=C(C)C=C(C)N1'), { suppressH: true });
    const saturatedRingGraph = createLayoutGraph(parseSMILES('CC(C)CCCC(C)C1CCC2C3C(CC=C4C3(CCC5C4CCC(C5)O)C)CC2C1'), { suppressH: true });
    const heteroarylCarbonylMethyleneGraph = createLayoutGraph(parseSMILES('O=C(Cn1ncc2C(=O)Oc3ccccc3c12)N4CCC(CC4)N5CCCCC5'), { suppressH: true });

    assert.equal(isExactRingOutwardEligibleSubstituent(flexibleGraph, 'C2', 'C6'), false);

    const nitrileCarbonAtomId = [...nitrileGraph.atoms.values()].find(atom =>
      atom.element === 'C'
      && atom.heavyDegree === 2
      && (nitrileGraph.atomToRings.get(atom.id)?.length ?? 0) === 0
      && (nitrileGraph.bondsByAtomId.get(atom.id) ?? []).some(bond => !bond.aromatic && (bond.order ?? 1) === 3)
    )?.id;
    const nitrileAnchorAtomId = (nitrileGraph.bondsByAtomId.get(nitrileCarbonAtomId) ?? [])
      .map(bond => (bond.a === nitrileCarbonAtomId ? bond.b : bond.a))
      .find(atomId => (nitrileGraph.atomToRings.get(atomId)?.length ?? 0) > 0);
    assert.ok(nitrileCarbonAtomId);
    assert.ok(nitrileAnchorAtomId);
    assert.equal(isExactRingOutwardEligibleSubstituent(nitrileGraph, nitrileAnchorAtomId, nitrileCarbonAtomId), true);

    const methylAtomId = [...methylGraph.atoms.values()].find(atom =>
      atom.element === 'C'
      && atom.heavyDegree === 1
      && (methylGraph.atomToRings.get(atom.id)?.length ?? 0) === 0
    )?.id;
    const methylAnchorAtomId = (methylGraph.bondsByAtomId.get(methylAtomId) ?? [])
      .map(bond => (bond.a === methylAtomId ? bond.b : bond.a))
      .find(atomId => (methylGraph.atomToRings.get(atomId)?.length ?? 0) > 0);
    assert.ok(methylAtomId);
    assert.ok(methylAnchorAtomId);
    assert.equal(isExactRingOutwardEligibleSubstituent(methylGraph, methylAnchorAtomId, methylAtomId), true);

    assert.equal(isExactRingOutwardEligibleSubstituent(ringConstrainedGraph, 'C11', 'C2'), true);
    assert.equal(isExactRingOutwardEligibleSubstituent(saturatedRingGraph, 'C9', 'C7'), true);
    assert.equal(isExactRingOutwardEligibleSubstituent(heteroarylCarbonylMethyleneGraph, 'N4', 'C3'), true);
  });

  it('keeps continuation search on exact and snapped angles before opening fine offsets', () => {
    const anchorPosition = { x: 0, y: 0 };
    const coords = new Map([
      ['A0', anchorPosition],
      ['N1', fromAngle(degrees(330), 1)],
      ['N2', fromAngle(degrees(180), 1)]
    ]);

    const angle = chooseContinuationAngle(
      anchorPosition,
      1,
      coords,
      [degrees(330), degrees(180)],
      [degrees(10)],
      [0],
      new Set(['A0']),
      null,
      [],
      true,
      true
    );

    assert.ok(
      angularDifference(angle, degrees(10)) < 1e-6,
      `expected the specific preferred angle before fine rescue, got ${((angle * 180) / Math.PI).toFixed(2)}°`
    );
  });

  it('opens fine continuation offsets only when the specific-angle pool has no safe candidate', () => {
    const anchorPosition = { x: 0, y: 0 };
    const coords = new Map([
      ['A0', anchorPosition],
      ['N1', fromAngle(degrees(345), 1)],
      ['N2', fromAngle(degrees(180), 1)]
    ]);

    const angle = chooseContinuationAngle(
      anchorPosition,
      1,
      coords,
      [degrees(345), degrees(180)],
      [degrees(10)],
      [0],
      new Set(['A0']),
      null,
      [],
      true,
      true
    );

    assert.ok(
      angularDifference(angle, degrees(40)) < 1e-6,
      `expected fine preferred rescue once the specific pool is blocked, got ${((angle * 180) / Math.PI).toFixed(2)}°`
    );
  });
});

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseSMILES } from '../../../../../src/io/smiles.js';
import { createLayoutGraph } from '../../../../../src/layout/engine/model/layout-graph.js';
import {
  isExactRingOutwardEligibleSubstituent,
  isExactSimpleAcyclicContinuationEligible
} from '../../../../../src/layout/engine/placement/branch-placement/angle-selection.js';

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

  it('limits exact ring-outward placement to rigid carbon roots instead of flexible chain carbons', () => {
    const flexibleGraph = createLayoutGraph(parseSMILES('C1=C(NC=N1)CC(C(=O)N[C@@H](CCCCN)C(=O)O)NC(=O)CN'), { suppressH: true });
    const nitrileGraph = createLayoutGraph(parseSMILES('N#Cc1ccccc1'), { suppressH: true });
    const methylGraph = createLayoutGraph(parseSMILES('Cc1ccccc1'), { suppressH: true });
    const saturatedRingGraph = createLayoutGraph(parseSMILES('CC(C)CCCC(C)C1CCC2C3C(CC=C4C3(CCC5C4CCC(C5)O)C)CC2C1'), { suppressH: true });

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

    assert.equal(isExactRingOutwardEligibleSubstituent(saturatedRingGraph, 'C9', 'C7'), true);
  });
});

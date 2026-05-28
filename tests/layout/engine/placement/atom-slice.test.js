import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseSMILES } from '../../../../src/io/index.js';
import { auditLayout } from '../../../../src/layout/engine/audit/audit.js';
import { createLayoutGraph } from '../../../../src/layout/engine/model/layout-graph.js';
import { buildSliceAdjacency, createAtomSlice, layoutAtomSlice } from '../../../../src/layout/engine/placement/atom-slice.js';
import { makeMethylbenzene, makeOrganometallic } from '../support/molecules.js';

describe('layout/engine/placement/atom-slice', () => {
  it('lays out a full organic slice with the shared family dispatch', () => {
    const graph = createLayoutGraph(makeMethylbenzene());
    const component = createAtomSlice(graph, graph.components[0].atomIds, 'slice:organic');
    const result = layoutAtomSlice(graph, component, graph.options.bondLength);
    assert.equal(result.supported, true);
    assert.equal(result.family, 'mixed');
    assert.equal(result.coords.size, 7);
  });

  it('can build covalent-only adjacency for a ligand slice', () => {
    const graph = createLayoutGraph(makeOrganometallic());
    const adjacency = buildSliceAdjacency(graph, ['n1', 'c1'], {
      includeBond(bond) {
        return bond.kind === 'covalent';
      }
    });
    assert.deepEqual(adjacency.get('n1'), ['c1']);
    assert.deepEqual(adjacency.get('c1'), ['n1']);
  });

  it('uses fused ring atoms, not visible hydrogens, when gating compact cage rescue', () => {
    const graph = createLayoutGraph(parseSMILES('C1CC2=C3C1CN1CCC4C5C4C1C3C5C2'), {
      suppressH: true
    });
    const result = layoutAtomSlice(graph, graph.components[0], graph.options.bondLength);
    const audit = auditLayout(graph, result.coords, {
      bondLength: graph.options.bondLength,
      bondValidationClasses: result.bondValidationClasses
    });

    assert.equal(result.family, 'fused');
    assert.equal(result.placementMode, 'kamada-kawai-cage');
    assert.equal(audit.ok, true);
    assert.equal(audit.bondLengthFailureCount, 0);
    assert.equal(audit.severeOverlapCount, 0);
  });

  it('rescues compact tetracyclic fused cages inside mixed slices', () => {
    const graph = createLayoutGraph(parseSMILES('CCC1C2CC3NC(=N)C(OC1=N)C1C3C21'), {
      suppressH: true
    });
    const result = layoutAtomSlice(graph, graph.components[0], graph.options.bondLength);
    const audit = auditLayout(graph, result.coords, {
      bondLength: graph.options.bondLength,
      bondValidationClasses: result.bondValidationClasses
    });

    assert.equal(result.family, 'mixed');
    assert.equal(result.placementMode ?? null, null);
    assert.equal(audit.ok, true);
    assert.equal(audit.bondLengthFailureCount, 0);
    assert.equal(audit.severeOverlapCount, 0);
  });

  it('rescues tiny tricyclic fused cages through the cage KK path', () => {
    const graph = createLayoutGraph(parseSMILES('CN1CC2(O)C3CC1(C#N)C23'), {
      suppressH: true
    });
    const result = layoutAtomSlice(graph, graph.components[0], graph.options.bondLength);
    const audit = auditLayout(graph, result.coords, {
      bondLength: graph.options.bondLength,
      bondValidationClasses: result.bondValidationClasses
    });

    assert.equal(result.family, 'mixed');
    assert.ok([...result.bondValidationClasses.values()].includes('bridged'));
    assert.equal(audit.ok, true);
    assert.equal(audit.bondLengthFailureCount, 0);
    assert.equal(audit.severeOverlapCount, 0);
  });

  it('rescues nine-atom tricyclic fused cages through the cage KK path', () => {
    const graph = createLayoutGraph(parseSMILES('CC12OC3C1C2CCNC3=[NH2+]'), {
      suppressH: true
    });
    const result = layoutAtomSlice(graph, graph.components[0], graph.options.bondLength);
    const audit = auditLayout(graph, result.coords, {
      bondLength: graph.options.bondLength,
      bondValidationClasses: result.bondValidationClasses
    });

    assert.equal(result.family, 'mixed');
    assert.ok([...result.bondValidationClasses.values()].includes('bridged'));
    assert.equal(audit.ok, true);
    assert.equal(audit.bondLengthFailureCount, 0);
    assert.equal(audit.severeOverlapCount, 0);
  });

  it('keeps an overlap-free bridged rescue over a lower-deviation overlapped cage rescue', () => {
    const graph = createLayoutGraph(parseSMILES('CN1CC2C3C(C13)C(CO)NC2S(O)(=O)=O'), {
      suppressH: true
    });
    const result = layoutAtomSlice(graph, graph.components[0], graph.options.bondLength);
    const audit = auditLayout(graph, result.coords, {
      bondLength: graph.options.bondLength,
      bondValidationClasses: result.bondValidationClasses
    });

    assert.equal(result.family, 'mixed');
    assert.equal(audit.ok, true);
    assert.equal(audit.bondLengthFailureCount, 0);
    assert.equal(audit.severeOverlapCount, 0);
  });
});

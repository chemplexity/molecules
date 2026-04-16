import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseSMILES } from '../../../../src/io/index.js';
import { auditLayout } from '../../../../src/layout/engine/audit/audit.js';
import { createLayoutGraph } from '../../../../src/layout/engine/model/layout-graph.js';
import { layoutSupportedComponents } from '../../../../src/layout/engine/placement/component-layout.js';
import {
  makeBibenzyl,
  makeBisLigatedOrganometallic,
  makeDisconnectedEthanes,
  makeLargePolyaryl,
  makeMacrocycle,
  makeMacrocycleWithSubstituent,
  makeMethylnaphthalene,
  makeMethylbenzene,
  makeNorbornane,
  makeOrganometallic,
  makeUnmatchedBridgedCage
} from '../support/molecules.js';

describe('layout/engine/placement/component-layout', () => {
  it('lays out supported components including ring scaffolds with substituents', () => {
    const graph = createLayoutGraph(makeMethylbenzene());
    const result = layoutSupportedComponents(graph);
    assert.equal(result.placedComponentCount, 1);
    assert.equal(result.unplacedComponentCount, 0);
    assert.ok(result.coords.has('a6'));
    assert.deepEqual(result.placedFamilies, ['mixed']);
    assert.ok([...result.bondValidationClasses.values()].every(validationClass => validationClass === 'planar'));
  });

  it('lays out a mixed component with chain-linked ring systems', () => {
    const graph = createLayoutGraph(makeBibenzyl());
    const result = layoutSupportedComponents(graph);
    assert.equal(result.placedComponentCount, 1);
    assert.equal(result.unplacedComponentCount, 0);
    assert.ok(result.coords.has('b0'));
    assert.ok(result.coords.has('c0'));
  });

  it('lays out a simple macrocycle component directly', () => {
    const graph = createLayoutGraph(makeMacrocycle());
    const result = layoutSupportedComponents(graph);
    assert.equal(result.placedComponentCount, 1);
    assert.equal(result.unplacedComponentCount, 0);
    assert.equal(result.coords.size, 12);
    assert.deepEqual(result.placedFamilies, ['macrocycle']);
  });

  it('lays out a macrocycle with a substituent through the mixed path', () => {
    const graph = createLayoutGraph(makeMacrocycleWithSubstituent());
    const result = layoutSupportedComponents(graph);
    assert.equal(result.placedComponentCount, 1);
    assert.equal(result.unplacedComponentCount, 0);
    assert.equal(result.coords.size, 13);
    assert.deepEqual(result.placedFamilies, ['mixed']);
    assert.ok(result.cleanupRigidSubtreesByAtomId instanceof Map);
    assert.ok(result.cleanupRigidSubtreesByAtomId.has('a12'));
    assert.deepEqual(
      result.cleanupRigidSubtreesByAtomId.get('a12')?.map(descriptor => ({
        anchorAtomId: descriptor.anchorAtomId,
        rootAtomId: descriptor.rootAtomId,
        subtreeAtomIds: descriptor.subtreeAtomIds
      })),
      [
        {
          anchorAtomId: 'a0',
          rootAtomId: 'a12',
          subtreeAtomIds: ['a12']
        }
      ]
    );
  });

  it('lays out a simple organometallic component through the ligand-first path', () => {
    const graph = createLayoutGraph(makeOrganometallic());
    const result = layoutSupportedComponents(graph);
    assert.equal(result.placedComponentCount, 1);
    assert.equal(result.unplacedComponentCount, 0);
    assert.equal(result.coords.size, 3);
    assert.deepEqual(result.placedFamilies, ['organometallic']);
    assert.ok(result.cleanupRigidSubtreesByAtomId instanceof Map);
    assert.ok(result.cleanupRigidSubtreesByAtomId.has('n1'));
    assert.deepEqual(
      result.cleanupRigidSubtreesByAtomId.get('n1')?.map(descriptor => ({
        anchorAtomId: descriptor.anchorAtomId,
        rootAtomId: descriptor.rootAtomId,
        subtreeAtomIds: descriptor.subtreeAtomIds
      })),
      [
        {
          anchorAtomId: 'ru',
          rootAtomId: 'n1',
          subtreeAtomIds: ['n1', 'c1']
        }
      ]
    );
  });

  it('adds rigid cleanup descriptors for fused mixed substituent branches', () => {
    const graph = createLayoutGraph(makeMethylnaphthalene());
    const result = layoutSupportedComponents(graph);
    assert.equal(result.placedComponentCount, 1);
    assert.equal(result.unplacedComponentCount, 0);
    assert.deepEqual(result.placedFamilies, ['mixed']);
    assert.ok(result.cleanupRigidSubtreesByAtomId instanceof Map);
    assert.ok(result.cleanupRigidSubtreesByAtomId.has('a10'));
    assert.deepEqual(
      result.cleanupRigidSubtreesByAtomId.get('a10')?.map(descriptor => ({
        anchorAtomId: descriptor.anchorAtomId,
        rootAtomId: descriptor.rootAtomId,
        subtreeAtomIds: descriptor.subtreeAtomIds
      })),
      [
        {
          anchorAtomId: 'a0',
          rootAtomId: 'a10',
          subtreeAtomIds: ['a10']
        }
      ]
    );
  });

  it('adds one rigid cleanup descriptor per organometallic ligand branch', () => {
    const graph = createLayoutGraph(makeBisLigatedOrganometallic());
    const result = layoutSupportedComponents(graph);
    assert.equal(result.placedComponentCount, 1);
    assert.equal(result.unplacedComponentCount, 0);
    assert.deepEqual(result.placedFamilies, ['organometallic']);
    assert.ok(result.cleanupRigidSubtreesByAtomId.has('n1'));
    assert.ok(result.cleanupRigidSubtreesByAtomId.has('n2'));
    assert.deepEqual(result.cleanupRigidSubtreesByAtomId.get('n1')?.[0]?.subtreeAtomIds, ['n1', 'c1']);
    assert.deepEqual(result.cleanupRigidSubtreesByAtomId.get('n2')?.[0]?.subtreeAtomIds, ['n2', 'c2']);
  });

  it('rescues large cobalt corrins through the fused ring-system path when mixed placement is bond-dirty', () => {
    const graph = createLayoutGraph(
      parseSMILES(
        '[C@@H]12N3C4=C([N]([Co+]567(N8C9=C(C%10=[N]5C([C@H]([C@]%10(C)CC(N)=O)CCC(N)=O)=CC5=[N]6C([C@H](C5(C)C)CCC(N)=O)=C(C5=[N]7[C@H]([C@@H]([C@@]5(C)CCC(=O)NCC(C)OP([O-])(=O)O[C@@H]([C@H]1O)[C@@H](CO)O2)CC(N)=O)[C@]8([C@@]([C@@H]9CCC(N)=O)(C)CC(N)=O)C)C)C)C)=C3)C=C(C(C)=C4)C'
      ),
      { suppressH: true }
    );
    const result = layoutSupportedComponents(graph);
    const audit = auditLayout(graph, result.coords, {
      bondLength: graph.options.bondLength,
      bondValidationClasses: result.bondValidationClasses
    });

    assert.deepEqual(result.placedFamilies, ['fused']);
    assert.ok(audit.severeOverlapCount <= 2);
    assert.ok(audit.bondLengthFailureCount <= 1);
    assert.ok(audit.maxBondLengthDeviation < 0.9);
  });

  it('lays out a large organic component through block partitioning and stitching', () => {
    const graph = createLayoutGraph(makeLargePolyaryl(), {
      largeMoleculeThreshold: {
        heavyAtomCount: 12,
        ringSystemCount: 2,
        blockCount: 16
      }
    });
    const result = layoutSupportedComponents(graph);
    assert.equal(result.placedComponentCount, 1);
    assert.equal(result.unplacedComponentCount, 0);
    assert.equal(result.coords.size, 34);
    assert.deepEqual(result.placedFamilies, ['large-molecule']);
    assert.ok(result.cleanupRigidSubtreesByAtomId instanceof Map);
    assert.ok(result.cleanupRigidSubtreesByAtomId.size > 0);
  });

  it('lays out a supported bridged component when a template is available', () => {
    const graph = createLayoutGraph(makeNorbornane());
    const result = layoutSupportedComponents(graph);
    assert.equal(result.placedComponentCount, 1);
    assert.equal(result.unplacedComponentCount, 0);
    assert.equal(result.coords.size, 7);
    assert.deepEqual(result.placedFamilies, ['bridged']);
    assert.ok([...result.bondValidationClasses.values()].every(validationClass => validationClass === 'bridged'));
  });

  it('lays out a bridged component through the KK fallback when no template exists', () => {
    const graph = createLayoutGraph(makeUnmatchedBridgedCage());
    const result = layoutSupportedComponents(graph);
    assert.equal(result.placedComponentCount, 1);
    assert.equal(result.unplacedComponentCount, 0);
    assert.equal(result.coords.size, 6);
    assert.deepEqual(result.placedFamilies, ['bridged']);
    assert.ok([...result.bondValidationClasses.values()].every(validationClass => validationClass === 'bridged'));
  });

  it('preserves untouched disconnected components exactly during refinement placement', () => {
    const graph = createLayoutGraph(makeDisconnectedEthanes(), {
      existingCoords: new Map([
        ['a0', { x: 0, y: 0 }],
        ['a1', { x: 1.5, y: 0 }],
        ['c0', { x: 10, y: 3 }],
        ['c1', { x: 11.5, y: 3 }]
      ]),
      touchedAtoms: new Set(['a0'])
    });
    const result = layoutSupportedComponents(graph);

    assert.equal(result.placedComponentCount, 2);
    assert.equal(result.preservedComponentCount, 1);
    assert.deepEqual(result.coords.get('c0'), { x: 10, y: 3 });
    assert.deepEqual(result.coords.get('c1'), { x: 11.5, y: 3 });
    assert.ok(result.placedFamilies.includes('preserved'));
    assert.ok(result.frozenAtomIds instanceof Set);
    assert.equal(result.frozenAtomIds.has('c0'), true);
    assert.equal(result.frozenAtomIds.has('c1'), true);
    assert.equal(result.frozenAtomIds.has('a0'), false);
  });
});

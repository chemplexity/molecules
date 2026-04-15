import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createLayoutGraph } from '../../../../src/layout/engine/model/layout-graph.js';
import { layoutSupportedComponents } from '../../../../src/layout/engine/placement/component-layout.js';
import {
  makeBibenzyl,
  makeDisconnectedEthanes,
  makeLargePolyaryl,
  makeMacrocycle,
  makeMacrocycleWithSubstituent,
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
  });

  it('lays out a simple organometallic component through the ligand-first path', () => {
    const graph = createLayoutGraph(makeOrganometallic());
    const result = layoutSupportedComponents(graph);
    assert.equal(result.placedComponentCount, 1);
    assert.equal(result.unplacedComponentCount, 0);
    assert.equal(result.coords.size, 3);
    assert.deepEqual(result.placedFamilies, ['organometallic']);
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
  });
});

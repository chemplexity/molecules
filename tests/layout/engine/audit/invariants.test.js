import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Molecule } from '../../../../src/core/index.js';
import { parseSMILES } from '../../../../src/io/smiles.js';
import { createLayoutGraph } from '../../../../src/layout/engine/model/layout-graph.js';
import {
  buildAtomGrid,
  computeSubtreeOverlapCost,
  detectCollapsedMacrocycles,
  findSevereOverlaps,
  measureBondLengthDeviation,
  measureLabelOverlap,
  measureLayoutState,
  measureLayoutCost,
  measureTrigonalDistortion
} from '../../../../src/layout/engine/audit/invariants.js';
import { runPipeline } from '../../../../src/layout/engine/pipeline.js';
import { makeMacrocycle } from '../support/molecules.js';

describe('layout/engine/audit/invariants', () => {
  it('finds severe nonbonded overlaps in a coordinate set', () => {
    const molecule = new Molecule();
    molecule.addAtom('a0', 'C');
    molecule.addAtom('a1', 'C');
    molecule.addAtom('a2', 'C');
    molecule.addBond('b0', 'a0', 'a1', {}, false);
    const graph = createLayoutGraph(molecule);
    const coords = new Map([
      ['a0', { x: 0, y: 0 }],
      ['a1', { x: 1.5, y: 0 }],
      ['a2', { x: 0.2, y: 0 }]
    ]);
    const overlaps = findSevereOverlaps(graph, coords, 1.5);
    assert.equal(overlaps.length, 1);
    assert.equal(overlaps[0].firstAtomId, 'a0');
    assert.equal(overlaps[0].secondAtomId, 'a2');
  });

  it('returns the same severe overlaps when backed by a spatial atom grid', () => {
    const molecule = new Molecule();
    molecule.addAtom('a0', 'C');
    molecule.addAtom('a1', 'C');
    molecule.addAtom('a2', 'C');
    molecule.addAtom('a3', 'C');
    molecule.addBond('b0', 'a0', 'a1', {}, false);
    const graph = createLayoutGraph(molecule);
    const coords = new Map([
      ['a0', { x: 0, y: 0 }],
      ['a1', { x: 1.5, y: 0 }],
      ['a2', { x: 0.2, y: 0 }],
      ['a3', { x: 3.5, y: 0 }]
    ]);

    const direct = findSevereOverlaps(graph, coords, 1.5);
    const viaGrid = findSevereOverlaps(graph, coords, 1.5, {
      atomGrid: buildAtomGrid(graph, coords, 1.5)
    });

    assert.deepEqual(viaGrid, direct);
  });

  it('returns the same subtree overlap cost when backed by a spatial atom grid', () => {
    const molecule = new Molecule();
    molecule.addAtom('a0', 'C');
    molecule.addAtom('a1', 'C');
    molecule.addAtom('a2', 'C');
    molecule.addAtom('a3', 'C');
    molecule.addBond('b0', 'a0', 'a1', {}, false);
    molecule.addBond('b1', 'a1', 'a2', {}, false);
    const graph = createLayoutGraph(molecule);
    const coords = new Map([
      ['a0', { x: 0, y: 0 }],
      ['a1', { x: 1.5, y: 0 }],
      ['a2', { x: 2.9, y: 0.1 }],
      ['a3', { x: 1.8, y: 0.2 }]
    ]);
    const atomGrid = buildAtomGrid(graph, coords, 1.5);
    let queryCount = 0;
    const originalQueryRadius = atomGrid.queryRadius.bind(atomGrid);
    atomGrid.queryRadius = function trackedQueryRadius(position, radius) {
      queryCount++;
      return originalQueryRadius(position, radius);
    };

    const direct = computeSubtreeOverlapCost(graph, coords, ['a1', 'a2'], null, 1.5);
    const viaGrid = computeSubtreeOverlapCost(graph, coords, ['a1', 'a2'], null, 1.5, {
      atomGrid
    });

    assert.equal(viaGrid, direct);
    assert.ok(queryCount > 0);
  });

  it('ignores hydrogen-only overlaps when suppressH is enabled', () => {
    const result = runPipeline(parseSMILES('C1CCCCC1'), { suppressH: true });
    const overlaps = findSevereOverlaps(result.layoutGraph, result.coords, result.layoutGraph.options.bondLength);
    assert.equal(overlaps.length, 0);
  });

  it('measures bond-length deviation and macrocycle collapse', () => {
    const macrocycle = makeMacrocycle();
    const graph = createLayoutGraph(macrocycle);
    const coords = new Map(graph.rings[0].atomIds.map((atomId, index) => [atomId, { x: index * 0.2, y: 0 }]));
    const bondStats = measureBondLengthDeviation(graph, coords, 1.5);
    assert.ok(bondStats.maxDeviation > 0.5);
    assert.deepEqual(detectCollapsedMacrocycles(graph, coords, 1.5), [graph.rings[0].id]);
    assert.ok(measureLayoutCost(graph, coords, 1.5) > 0);
  });

  it('penalizes distorted three-coordinate unsaturated centers', () => {
    const molecule = new Molecule();
    molecule.addAtom('c0', 'C');
    molecule.addAtom('c1', 'C');
    molecule.addAtom('c2', 'C');
    molecule.addAtom('c3', 'C');
    molecule.addBond('b0', 'c0', 'c1', { order: 2 }, false);
    molecule.addBond('b1', 'c1', 'c2', {}, false);
    molecule.addBond('b2', 'c1', 'c3', {}, false);
    const graph = createLayoutGraph(molecule);
    const trigonalCoords = new Map([
      ['c1', { x: 0, y: 0 }],
      ['c0', { x: -1.299038105676658, y: -0.75 }],
      ['c2', { x: 1.299038105676658, y: -0.75 }],
      ['c3', { x: 0, y: 1.5 }]
    ]);
    const distortedCoords = new Map([
      ['c1', { x: 0, y: 0 }],
      ['c0', { x: -1.299038105676658, y: -0.75 }],
      ['c2', { x: 1.299038105676658, y: -0.75 }],
      ['c3', { x: -1.299038105676658, y: 0.75 }]
    ]);

    const trigonalDistortion = measureTrigonalDistortion(graph, trigonalCoords);
    const distorted = measureTrigonalDistortion(graph, distortedCoords);

    assert.equal(trigonalDistortion.centerCount, 1);
    assert.ok(distorted.totalDeviation > trigonalDistortion.totalDeviation);
    assert.ok(measureLayoutCost(graph, distortedCoords, 1.5) > measureLayoutCost(graph, trigonalCoords, 1.5));
  });

  it('counts overlapping multi-character labels in the layout cost model', () => {
    const graph = createLayoutGraph(parseSMILES('Cl.Br'), { suppressH: true });
    const overlappingCoords = new Map([
      ['Cl1', { x: 0, y: 0 }],
      ['Br2', { x: 0.9, y: 0 }]
    ]);
    const separatedCoords = new Map([
      ['Cl1', { x: 0, y: 0 }],
      ['Br2', { x: 2.5, y: 0 }]
    ]);

    const overlapStats = measureLabelOverlap(graph, overlappingCoords, graph.options.bondLength);

    assert.equal(overlapStats.pairCount, 1);
    assert.ok(overlapStats.totalPenalty > 0);
    assert.ok(measureLayoutCost(graph, overlappingCoords, graph.options.bondLength) > measureLayoutCost(graph, separatedCoords, graph.options.bondLength));
  });

  it('returns a combined layout state consistent with separate overlap and cost measurements', () => {
    const graph = createLayoutGraph(parseSMILES('Cl.Br'), { suppressH: true });
    const coords = new Map([
      ['Cl1', { x: 0, y: 0 }],
      ['Br2', { x: 0.9, y: 0 }]
    ]);

    const layoutState = measureLayoutState(graph, coords, graph.options.bondLength);

    assert.equal(layoutState.overlapCount, findSevereOverlaps(graph, coords, graph.options.bondLength).length);
    assert.equal(layoutState.cost, measureLayoutCost(graph, coords, graph.options.bondLength));
    assert.equal(layoutState.overlaps.length, layoutState.overlapCount);
  });
});

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Molecule } from '../../../src/core/index.js';
import { parseSMILES } from '../../../src/io/smiles.js';
import { createLayoutGraph } from '../../../src/layoutv2/model/layout-graph.js';
import { detectCollapsedMacrocycles, findSevereOverlaps, measureBondLengthDeviation, measureLayoutCost, measureTrigonalDistortion } from '../../../src/layoutv2/audit/invariants.js';
import { runPipeline } from '../../../src/layoutv2/pipeline.js';
import { makeMacrocycle } from '../support/molecules.js';

describe('layoutv2/audit/invariants', () => {
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
});

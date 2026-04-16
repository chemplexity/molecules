import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseSMILES } from '../../../../src/io/smiles.js';
import { createLayoutGraph } from '../../../../src/layout/engine/model/layout-graph.js';
import { runPipeline } from '../../../../src/layout/engine/pipeline.js';
import { pickWedgeAssignments } from '../../../../src/layout/engine/stereo/wedge-selection.js';
import { makeHiddenHydrogenStereocenter } from '../support/molecules.js';

describe('layout/engine/stereo/wedge-selection', () => {
  it('assigns a heavy-atom wedge bond even when one substituent is a hidden hydrogen', () => {
    const graph = createLayoutGraph(makeHiddenHydrogenStereocenter());
    const summary = pickWedgeAssignments(
      graph,
      new Map([
        ['c0', { x: 0, y: 0 }],
        ['f0', { x: 1.4, y: 0.1 }],
        ['cl0', { x: -0.6, y: 1.2 }],
        ['br0', { x: -1.1, y: -0.8 }]
      ])
    );

    assert.equal(summary.chiralCenterCount, 1);
    assert.equal(summary.assignedCenterCount, 1);
    assert.equal(summary.unassignedCenterCount, 0);
    assert.ok(summary.assignments[0]);
    assert.equal(summary.assignments[0].centerId, 'c0');
    assert.notEqual(summary.assignments[0].bondId, 'b3');
    assert.ok(summary.assignments[0].type === 'wedge' || summary.assignments[0].type === 'dash');
  });

  it('preserves a manual wedge or dash assignment on the selected center', () => {
    const molecule = makeHiddenHydrogenStereocenter();
    molecule.bonds.get('b1').properties.display = { as: 'dash', centerId: 'c0', manual: true };
    const graph = createLayoutGraph(molecule);
    const summary = pickWedgeAssignments(
      graph,
      new Map([
        ['c0', { x: 0, y: 0 }],
        ['f0', { x: 1.4, y: 0.1 }],
        ['cl0', { x: -0.6, y: 1.2 }],
        ['br0', { x: -1.1, y: -0.8 }]
      ])
    );

    assert.equal(summary.assignedCenterCount, 1);
    assert.deepEqual(summary.assignments, [
      {
        bondId: 'b1',
        type: 'dash',
        centerId: 'c0',
        manual: true
      }
    ]);
  });

  it('assigns a heavy-atom wedge bond for implicit-hydrogen stereocenters', () => {
    const molecule = parseSMILES('CC[C@]1(SC(=O)C=C1O)\\C=C/2\\C=C/CCCCC2');
    const coords = runPipeline(molecule, { suppressH: true }).coords;
    const graph = createLayoutGraph(molecule, { suppressH: true, bondLength: 1.5 });
    const summary = pickWedgeAssignments(graph, coords);

    assert.equal(summary.chiralCenterCount, 1);
    assert.equal(summary.assignedCenterCount, 1);
    assert.equal(summary.unassignedCenterCount, 0);
    assert.deepEqual(summary.missingCenterIds, []);
    assert.ok(summary.assignments[0]);
    assert.equal(summary.assignments[0].centerId, 'C3');
    assert.ok(!summary.assignments[0].bondId.startsWith('implicit-h:'));
    assert.ok(summary.assignments[0].type === 'wedge' || summary.assignments[0].type === 'dash');
  });

  it('does not count unsupported annotated centers as unassigned stereo failures', () => {
    const molecule = parseSMILES('[H][C@@]1(O)CC(=O)[C@@]([H])(C\\C=C\\CCCC(O)=O)[C@]1([H])\\C=C\\C(=O)CCCCC');
    const result = runPipeline(molecule, { suppressH: true });
    const graph = createLayoutGraph(molecule, { suppressH: true, bondLength: 1.5 });
    const summary = pickWedgeAssignments(graph, result.coords);

    assert.equal(summary.annotatedCenterCount, 3);
    assert.equal(summary.chiralCenterCount, 2);
    assert.equal(summary.assignedCenterCount, 2);
    assert.equal(summary.unassignedCenterCount, 0);
    assert.equal(summary.unsupportedCenterCount, 1);
    assert.deepEqual(summary.unsupportedCenterIds, ['C7']);
    assert.deepEqual(summary.missingCenterIds, []);
  });
});

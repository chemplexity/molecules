import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createLayoutGraph } from '../../../../src/layout/engine/model/layout-graph.js';
import { pickWedgeAssignments } from '../../../../src/layout/engine/stereo/wedge-selection.js';
import { makeHiddenHydrogenStereocenter } from '../support/molecules.js';

describe('layout/engine/stereo/wedge-selection', () => {
  it('assigns a heavy-atom wedge bond even when one substituent is a hidden hydrogen', () => {
    const graph = createLayoutGraph(makeHiddenHydrogenStereocenter());
    const summary = pickWedgeAssignments(graph, new Map([
      ['c0', { x: 0, y: 0 }],
      ['f0', { x: 1.4, y: 0.1 }],
      ['cl0', { x: -0.6, y: 1.2 }],
      ['br0', { x: -1.1, y: -0.8 }]
    ]));

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
    const summary = pickWedgeAssignments(graph, new Map([
      ['c0', { x: 0, y: 0 }],
      ['f0', { x: 1.4, y: 0.1 }],
      ['cl0', { x: -0.6, y: 1.2 }],
      ['br0', { x: -1.1, y: -0.8 }]
    ]));

    assert.equal(summary.assignedCenterCount, 1);
    assert.deepEqual(summary.assignments, [{
      bondId: 'b1',
      type: 'dash',
      centerId: 'c0',
      manual: true
    }]);
  });
});

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createLayoutGraph } from '../../../src/layoutv2/model/layout-graph.js';
import { auditLayout } from '../../../src/layoutv2/audit/audit.js';
import { inspectEZStereo } from '../../../src/layoutv2/stereo/ez.js';
import { makeEAlkene, makeEthane, makeMacrocycle } from '../support/molecules.js';

describe('layoutv2/audit/audit', () => {
  it('reports a clean simple layout as passing audit', () => {
    const graph = createLayoutGraph(makeEthane());
    const coords = new Map([
      ['a0', { x: 0, y: 0 }],
      ['a1', { x: 1.5, y: 0 }]
    ]);
    const audit = auditLayout(graph, coords);
    assert.equal(audit.ok, true);
    assert.equal(audit.severeOverlapCount, 0);
    assert.equal(audit.collapsedMacrocycleCount, 0);
  });

  it('flags collapsed macrocycles and severe overlap conditions', () => {
    const graph = createLayoutGraph(makeMacrocycle());
    const coords = new Map(graph.rings[0].atomIds.map(atomId => [atomId, { x: 0, y: 0 }]));
    const audit = auditLayout(graph, coords);
    assert.equal(audit.ok, false);
    assert.ok(audit.severeOverlapCount > 0);
    assert.ok(audit.collapsedMacrocycleCount > 0);
  });

  it('treats contradicted alkene stereo as an audit failure', () => {
    const graph = createLayoutGraph(makeEAlkene());
    const coords = new Map([
      ['F1', { x: -1, y: 1 }],
      ['C2', { x: 0, y: 0 }],
      ['C3', { x: 1.5, y: 0 }],
      ['F4', { x: 2.5, y: 1 }],
      ['H5', { x: -0.5, y: -1 }],
      ['H6', { x: 2, y: -1 }]
    ]);
    const ez = inspectEZStereo(graph, coords);
    const audit = auditLayout(graph, coords, {
      stereo: {
        ezViolationCount: ez.violationCount,
        chiralCenterCount: 0,
        unassignedCenterCount: 0
      }
    });

    assert.equal(audit.ok, false);
    assert.equal(audit.stereoContradiction, true);
  });

  it('reports per-bond bridged validation classes in bond-length audit stats', () => {
    const graph = createLayoutGraph(makeEthane());
    const coords = new Map([
      ['a0', { x: 0, y: 0 }],
      ['a1', { x: 1.8, y: 0 }]
    ]);

    const planarAudit = auditLayout(graph, coords);
    const bridgedAudit = auditLayout(graph, coords, {
      bondValidationClasses: new Map([['b0', 'bridged']])
    });

    assert.equal(planarAudit.bondLengthFailureCount, 1);
    assert.equal(bridgedAudit.bondLengthFailureCount, 0);
  });
});

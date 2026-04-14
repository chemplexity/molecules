import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createLayoutGraph } from '../../../../src/layout/engine/model/layout-graph.js';
import { inspectEZStereo } from '../../../../src/layout/engine/stereo/ez.js';
import { makeEAlkene } from '../support/molecules.js';

describe('layout/engine/stereo/ez', () => {
  it('accepts coordinate geometry that matches the encoded E alkene', () => {
    const graph = createLayoutGraph(makeEAlkene());
    const summary = inspectEZStereo(
      graph,
      new Map([
        ['F1', { x: -1, y: 1 }],
        ['C2', { x: 0, y: 0 }],
        ['C3', { x: 1.5, y: 0 }],
        ['F4', { x: 2.5, y: -1 }],
        ['H5', { x: -0.5, y: -1 }],
        ['H6', { x: 2, y: 1 }]
      ])
    );

    assert.equal(summary.checkedBondCount, 1);
    assert.equal(summary.resolvedBondCount, 1);
    assert.equal(summary.violationCount, 0);
    assert.equal(summary.checks[0].actual, 'E');
    assert.equal(summary.checks[0].ok, true);
  });

  it('flags a contradiction when coordinates imply the wrong alkene geometry', () => {
    const graph = createLayoutGraph(makeEAlkene());
    const summary = inspectEZStereo(
      graph,
      new Map([
        ['F1', { x: -1, y: 1 }],
        ['C2', { x: 0, y: 0 }],
        ['C3', { x: 1.5, y: 0 }],
        ['F4', { x: 2.5, y: 1 }],
        ['H5', { x: -0.5, y: -1 }],
        ['H6', { x: 2, y: -1 }]
      ])
    );

    assert.equal(summary.checkedBondCount, 1);
    assert.equal(summary.resolvedBondCount, 1);
    assert.equal(summary.violationCount, 1);
    assert.equal(summary.checks[0].actual, 'Z');
    assert.equal(summary.checks[0].ok, false);
  });
});

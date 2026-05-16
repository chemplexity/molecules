import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseSMILES } from '../../../../src/io/smiles.js';
import { createLayoutGraph } from '../../../../src/layout/engine/model/layout-graph.js';
import { runPipeline } from '../../../../src/layout/engine/pipeline.js';
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

  it('tracks unsupported annotated ring double bonds without counting them as contradictions', () => {
    const graph = createLayoutGraph(parseSMILES('C1CC/C=C/CC1'), { suppressH: true, bondLength: 1.5 });
    const coords = runPipeline(parseSMILES('C1CC/C=C\\CC1'), { suppressH: true }).coords;
    const summary = inspectEZStereo(
      graph,
      coords
    );

    assert.equal(summary.checkedBondCount, 1);
    assert.equal(summary.supportedCheckCount, 0);
    assert.equal(summary.unsupportedCheckCount, 1);
    assert.equal(summary.violationCount, 0);
    assert.equal(summary.checks[0].actual, 'Z');
    assert.equal(summary.checks[0].supported, false);
    assert.equal(summary.checks[0].ok, true);
  });

  it('does not count cyclic E/Z contradictions for incomplete ring-system coordinates', () => {
    const graph = createLayoutGraph(
      parseSMILES(String.raw`CC[C@H](C)[C@@H]1O[C@]2(CC[C@@H]1C)C[C@H]3C[C@H](C\C=C(/C)\[C@@H](O[C@H]4C[C@H](OC)[C@H](O[C@H]5C[C@H](OC)[C@H](O)[C@H](C)O5)[C@H](C)O4)[C@@H](C)\C=C\C=C6CO[C@@H]7[C@@H](O)C(=C[C@H](C(=O)O3)[C@@]67O)C)O2`),
      { suppressH: true, bondLength: 1.5 }
    );
    const summary = inspectEZStereo(
      graph,
      new Map([
        ['C21', { x: 0, y: 1 }],
        ['C22', { x: 0, y: 0 }],
        ['C23', { x: 1.5, y: 0 }],
        ['C25', { x: 1.5, y: 1 }]
      ])
    );
    const partiallyPlacedCheck = summary.checks.find(check => check.bondId === '9');

    assert.equal(summary.violationCount, 0);
    assert.equal(partiallyPlacedCheck.actual, 'Z');
    assert.equal(partiallyPlacedCheck.supported, false);
    assert.equal(partiallyPlacedCheck.ok, true);
  });
});

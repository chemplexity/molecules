import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { parseSMILES } from '../../../src/io/smiles.js';
import { runPipeline } from '../../../src/layoutv2/pipeline.js';
import { createLayoutGraph } from '../../../src/layoutv2/model/layout-graph.js';
import { inspectEZStereo } from '../../../src/layoutv2/stereo/ez.js';
import { enforceAcyclicEZStereo } from '../../../src/layoutv2/stereo/enforcement.js';

/**
 * Returns a fresh layout graph for the given SMILES string.
 * @param {string} smiles - Molecule SMILES.
 * @returns {object} Layout graph shell.
 */
function graphFor(smiles) {
  return createLayoutGraph(parseSMILES(smiles), { suppressH: true, bondLength: 1.5 });
}

/**
 * Returns pipeline coordinates for the given SMILES string.
 * @param {string} smiles - Molecule SMILES.
 * @returns {Map<string, {x: number, y: number}>} Placed coordinates.
 */
function coordsFor(smiles) {
  return runPipeline(parseSMILES(smiles), { suppressH: true }).coords;
}

describe('layoutv2/stereo/enforcement', () => {
  it('reflects one side of a medium-ring alkene to enforce trans geometry', () => {
    const graph = graphFor('C1CCC/C=C/CCC1');
    const wrongCoords = coordsFor('C1CCC/C=C\\CCC1');
    const before = inspectEZStereo(graph, wrongCoords);

    assert.equal(before.violationCount, 1);
    assert.equal(before.checks[0].actual, 'Z');

    const enforced = enforceAcyclicEZStereo(graph, wrongCoords, { bondLength: 1.5 });
    const after = inspectEZStereo(graph, enforced.coords);

    assert.ok(enforced.reflections > 0);
    assert.equal(after.violationCount, 0);
    assert.equal(after.checks[0].actual, 'E');
  });

  it('leaves already-correct cis medium-ring alkenes unchanged', () => {
    const graph = graphFor('C1CCC/C=C\\CCC1');
    const correctCoords = coordsFor('C1CCC/C=C\\CCC1');
    const before = inspectEZStereo(graph, correctCoords);
    const enforced = enforceAcyclicEZStereo(graph, correctCoords, { bondLength: 1.5 });
    const after = inspectEZStereo(graph, enforced.coords);

    assert.equal(before.violationCount, 0);
    assert.equal(enforced.reflections, 0);
    assert.equal(after.violationCount, 0);
    assert.deepEqual([...enforced.coords.entries()], [...correctCoords.entries()]);
  });

  it('skips impossible small-ring trans alkene enforcement below the ring-size guard', () => {
    const graph = graphFor('C1CC/C=C/CC1');
    const wrongCoords = coordsFor('C1CC/C=C\\CC1');
    const enforced = enforceAcyclicEZStereo(graph, wrongCoords, { bondLength: 1.5 });
    const after = inspectEZStereo(graph, enforced.coords);

    assert.equal(enforced.reflections, 0);
    assert.equal(after.violationCount, 1);
    assert.equal(after.checks[0].actual, 'Z');
  });
});

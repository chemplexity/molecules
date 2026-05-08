import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { parseSMILES } from '../../../../src/io/smiles.js';
import { classifyFamily, runPipeline } from '../../../../src/layout/engine/pipeline.js';
import { normalizeOptions } from '../../../../src/layout/engine/options.js';
import { resolveProfile } from '../../../../src/layout/engine/profile.js';
import { resolvePolicy } from '../../../../src/layout/engine/standards/profile-policy.js';
import { createLayoutGraph, createLayoutGraphFromNormalized } from '../../../../src/layout/engine/model/layout-graph.js';
import { layoutSupportedComponents } from '../../../../src/layout/engine/placement/component-layout.js';
import { runUnifiedCleanup } from '../../../../src/layout/engine/cleanup/unified-cleanup.js';
import { applyLabelClearance } from '../../../../src/layout/engine/cleanup/label-clearance.js';
import { tidySymmetry } from '../../../../src/layout/engine/cleanup/symmetry-tidy.js';
import { findSevereOverlaps } from '../../../../src/layout/engine/audit/invariants.js';
import { inspectEZStereo } from '../../../../src/layout/engine/stereo/ez.js';
import { enforceAcyclicEZStereo } from '../../../../src/layout/engine/stereo/enforcement.js';

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

/**
 * Returns the graph and coordinates just before the pipeline stereo-rescue pass.
 * @param {string} smiles - Molecule SMILES.
 * @returns {{graph: object, coords: Map<string, {x: number, y: number}>, bondLength: number}} Pre-stereo state.
 */
function _preStereoStageFor(smiles) {
  const molecule = parseSMILES(smiles);
  const options = normalizeOptions({ suppressH: true });
  const graph = createLayoutGraphFromNormalized(molecule, options);
  const familySummary = classifyFamily(graph);
  const policy = resolvePolicy(resolveProfile(options.profile), {
    ...graph.traits,
    ...familySummary
  });
  const placement = layoutSupportedComponents(graph, policy);
  const cleanup = runUnifiedCleanup(graph, placement.coords, {
    maxPasses: options.maxCleanupPasses,
    epsilon: options.bondLength * 0.001,
    bondLength: options.bondLength,
    protectLargeMoleculeBackbone: false,
    protectBondIntegrity: false,
    cleanupRigidSubtreesByAtomId: placement.cleanupRigidSubtreesByAtomId,
    frozenAtomIds: placement.frozenAtomIds
  });
  const labelClearance = applyLabelClearance(graph, cleanup.coords, {
    bondLength: options.bondLength,
    labelMetrics: options.labelMetrics
  });
  const symmetryTidy = tidySymmetry(labelClearance.coords, {
    epsilon: options.bondLength * 0.01,
    layoutGraph: graph
  });

  return {
    graph,
    coords: symmetryTidy.coords,
    bondLength: options.bondLength
  };
}

describe('layout/engine/stereo/enforcement', () => {
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
    assert.equal(after.violationCount, 0);
    assert.equal(after.supportedCheckCount, 0);
    assert.equal(after.unsupportedCheckCount, 1);
    assert.equal(after.checks[0].actual, 'Z');
    assert.equal(after.checks[0].supported, false);
  });

  it('chooses an overlap-free E/Z rescue for crowded styryl fused-ring systems', () => {
    const smiles = String.raw`COc1c(O)ccc2O\C(=C/c3cccc(C)c3)\c4c(ccc5NC(C)(C)C=C(C)c45)c12`;
    const { graph, coords, bondLength } = _preStereoStageFor(smiles);
    const before = inspectEZStereo(graph, coords);
    const enforced = enforceAcyclicEZStereo(graph, coords, { bondLength });
    const after = inspectEZStereo(graph, enforced.coords);
    const pipelineResult = runPipeline(parseSMILES(smiles), { suppressH: true });

    assert.equal(before.violationCount, 1);
    assert.equal(findSevereOverlaps(graph, coords, bondLength).length, 0);
    assert.ok(enforced.reflections > 0);
    assert.equal(after.violationCount, 0);
    assert.equal(findSevereOverlaps(graph, enforced.coords, bondLength).length, 0);
    assert.equal(pipelineResult.metadata.audit.severeOverlapCount, 0);
    assert.equal(pipelineResult.metadata.stereo.ezViolationCount, 0);
    assert.ok(
      Math.hypot(
        enforced.coords.get('C14').x - enforced.coords.get('C28').x,
        enforced.coords.get('C14').y - enforced.coords.get('C28').y
      ) > bondLength,
      'expected the styryl phenyl ring to avoid stacking C14 onto the fused core C28'
    );
  });
});

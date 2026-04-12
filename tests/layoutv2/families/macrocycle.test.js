import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseSMILES } from '../../../src/io/smiles.js';
import { computeMacrocycleAngularBudgets, layoutMacrocycleFamily } from '../../../src/layoutv2/families/macrocycle.js';
import { createLayoutGraph } from '../../../src/layoutv2/model/layout-graph.js';
import { computeBounds } from '../../../src/layoutv2/geometry/bounds.js';
import { makeMacrocycle, makeMacrocycleWithSubstituent } from '../support/molecules.js';

/**
 * Normalizes an angle into the signed `(-pi, pi]` range.
 * @param {number} angle - Input angle.
 * @returns {number} Wrapped signed angle.
 */
function normalizeSignedAngle(angle) {
  let wrappedAngle = angle;
  while (wrappedAngle > Math.PI) {
    wrappedAngle -= 2 * Math.PI;
  }
  while (wrappedAngle <= -Math.PI) {
    wrappedAngle += 2 * Math.PI;
  }
  return wrappedAngle;
}

describe('layoutv2/families/macrocycle', () => {
  it('lays out a simple macrocycle on an ellipse with full coordinates', () => {
    const graph = createLayoutGraph(makeMacrocycle());
    const result = layoutMacrocycleFamily(graph.rings, graph.options.bondLength);
    assert.equal(result.placementMode, 'ellipse');
    assert.equal(result.coords.size, 12);
    assert.equal(result.ringCenters.size, 1);

    const bounds = computeBounds(result.coords, graph.rings[0].atomIds);
    assert.ok(bounds.width > 0);
    assert.ok(bounds.height > 0);
    assert.ok(Math.abs(bounds.width - bounds.height) < 0.25);
  });

  it('uses a more elongated oval for larger macrocycles', () => {
    const graph = createLayoutGraph(makeMacrocycle(24));
    const result = layoutMacrocycleFamily(graph.rings, graph.options.bondLength);
    const bounds = computeBounds(result.coords, graph.rings[0].atomIds);

    assert.ok(bounds.width / bounds.height > 1.4);
  });

  it('uses template geometry when a matched macrocycle template is available', () => {
    const graph = createLayoutGraph(parseSMILES('C1=CC2=CC3=CC=C(N3)C=C4C=CC(=N4)C=C5C=CC(=N5)C=C1N2'));
    const result = layoutMacrocycleFamily(graph.rings, graph.options.bondLength, {
      layoutGraph: graph,
      templateId: 'porphine'
    });

    assert.equal(result.placementMode, 'template');
    assert.equal(result.coords.size, 24);
    assert.equal(result.ringCenters.size, 5);
    const bounds = computeBounds(result.coords, graph.ringSystems[0].atomIds);
    assert.ok(Math.abs(bounds.width - bounds.height) < 1e-6);
  });

  it('computes outward angular budgets for branch-bearing macrocycle atoms and shrinks dense adjacent sites', () => {
    const sparseGraph = createLayoutGraph(makeMacrocycleWithSubstituent(), { suppressH: true });
    const sparseLayout = layoutMacrocycleFamily(sparseGraph.rings, sparseGraph.options.bondLength);
    const sparseBudgets = computeMacrocycleAngularBudgets(
      sparseGraph.rings,
      sparseLayout.coords,
      sparseGraph,
      new Set(sparseGraph.components[0].atomIds)
    );

    const denseMolecule = makeMacrocycle();
    denseMolecule.addAtom('x0', 'C');
    denseMolecule.addAtom('x1', 'C');
    denseMolecule.addBond('x0b', 'a0', 'x0', {}, false);
    denseMolecule.addBond('x1b', 'a1', 'x1', {}, false);
    const denseGraph = createLayoutGraph(denseMolecule, { suppressH: true });
    const denseLayout = layoutMacrocycleFamily(denseGraph.rings, denseGraph.options.bondLength);
    const denseBudgets = computeMacrocycleAngularBudgets(
      denseGraph.rings,
      denseLayout.coords,
      denseGraph,
      new Set(denseGraph.components[0].atomIds)
    );
    const sparseBudget = sparseBudgets.get('a0');
    const denseBudget = denseBudgets.get('a0');
    const sparseWidth = sparseBudget.maxOffset - sparseBudget.minOffset;
    const denseWidth = denseBudget.maxOffset - denseBudget.minOffset;

    assert.ok(sparseBudget, 'expected a sparse macrocycle budget at a0');
    assert.ok(denseBudget, 'expected a dense macrocycle budget at a0');
    assert.ok(sparseWidth > 0, 'expected a positive sparse budget width');
    assert.ok(denseWidth > 0, 'expected a positive dense budget width');
    assert.ok(denseWidth < sparseWidth, 'expected adjacent branch-bearing atoms to shrink the available macrocycle branch budget');
  });

  it('assigns opposite preferred branch sides to adjacent dense macrocycle substituent sites', () => {
    const denseMolecule = makeMacrocycle();
    denseMolecule.addAtom('x0', 'C');
    denseMolecule.addAtom('x1', 'C');
    denseMolecule.addBond('x0b', 'a0', 'x0', {}, false);
    denseMolecule.addBond('x1b', 'a1', 'x1', {}, false);
    const graph = createLayoutGraph(denseMolecule, { suppressH: true });
    const ringLayout = layoutMacrocycleFamily(graph.rings, graph.options.bondLength);
    const budgets = computeMacrocycleAngularBudgets(
      graph.rings,
      ringLayout.coords,
      graph,
      new Set(graph.components[0].atomIds)
    );
    const firstBudget = budgets.get('a0');
    const secondBudget = budgets.get('a1');
    const firstPreferredOffset = normalizeSignedAngle(firstBudget.preferredAngle - firstBudget.centerAngle);
    const secondPreferredOffset = normalizeSignedAngle(secondBudget.preferredAngle - secondBudget.centerAngle);

    assert.ok(firstBudget, 'expected a dense macrocycle budget at a0');
    assert.ok(secondBudget, 'expected a dense macrocycle budget at a1');
    assert.ok(firstPreferredOffset !== 0, 'expected a0 to prefer one side of the macrocycle budget');
    assert.ok(secondPreferredOffset !== 0, 'expected a1 to prefer one side of the macrocycle budget');
    assert.ok(firstPreferredOffset * secondPreferredOffset < 0, 'expected adjacent dense sites to prefer opposite sides');
  });
});

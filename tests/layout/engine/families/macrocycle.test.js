import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseSMILES } from '../../../../src/io/smiles.js';
import { findSevereOverlaps, measureBondLengthDeviation } from '../../../../src/layout/engine/audit/invariants.js';
import { AUDIT_PLANAR_VALIDATION } from '../../../../src/layout/engine/constants.js';
import { generateCoords } from '../../../../src/layout/engine/api.js';
import { computeMacrocycleAngularBudgets, layoutMacrocycleFamily } from '../../../../src/layout/engine/families/macrocycle.js';
import { createLayoutGraph } from '../../../../src/layout/engine/model/layout-graph.js';
import { computeBounds } from '../../../../src/layout/engine/geometry/bounds.js';
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

/**
 * Asserts that a macrocycle-family placement stays within planar validation tolerances.
 * @param {object} graph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Macrocycle placement coordinates.
 * @returns {void}
 */
function assertMacrocycleLayoutQuality(graph, coords) {
  const bondStats = measureBondLengthDeviation(graph, coords, graph.options.bondLength);
  assert.equal(findSevereOverlaps(graph, coords, graph.options.bondLength).length, 0);
  assert.ok(bondStats.failingBondCount <= AUDIT_PLANAR_VALIDATION.maxSevereOverlapCount);
}

function bondDistance(coords, firstAtomId, secondAtomId) {
  const firstPosition = coords.get(firstAtomId);
  const secondPosition = coords.get(secondAtomId);
  return Math.hypot(secondPosition.x - firstPosition.x, secondPosition.y - firstPosition.y);
}

function bondAngleDegrees(coords, centerAtomId, firstAtomId, secondAtomId) {
  const centerPosition = coords.get(centerAtomId);
  const firstPosition = coords.get(firstAtomId);
  const secondPosition = coords.get(secondAtomId);
  const firstVector = {
    x: firstPosition.x - centerPosition.x,
    y: firstPosition.y - centerPosition.y
  };
  const secondVector = {
    x: secondPosition.x - centerPosition.x,
    y: secondPosition.y - centerPosition.y
  };
  const denominator = Math.hypot(firstVector.x, firstVector.y) * Math.hypot(secondVector.x, secondVector.y);
  const cosine = Math.max(-1, Math.min(1, (firstVector.x * secondVector.x + firstVector.y * secondVector.y) / denominator));
  return Math.acos(cosine) * 180 / Math.PI;
}

describe('layout/engine/families/macrocycle', () => {
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
    assertMacrocycleLayoutQuality(graph, result.coords);
  });

  it('uses a more elongated oval for larger macrocycles', () => {
    const graph = createLayoutGraph(makeMacrocycle(24));
    const result = layoutMacrocycleFamily(graph.rings, graph.options.bondLength);
    const bounds = computeBounds(result.coords, graph.rings[0].atomIds);

    assert.ok(bounds.width / bounds.height > 1.4);
    assertMacrocycleLayoutQuality(graph, result.coords);
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
    assertMacrocycleLayoutQuality(graph, result.coords);
  });

  it('keeps a minimum-size macrocycle within bond-length tolerance and free of severe overlaps', () => {
    const graph = createLayoutGraph(makeMacrocycle(12));
    const result = layoutMacrocycleFamily(graph.rings, graph.options.bondLength);

    assert.equal(result.coords.size, 12);
    assertMacrocycleLayoutQuality(graph, result.coords);
  });

  it('keeps the primary macrocycle ring clean when exocyclic branches are present', () => {
    const graph = createLayoutGraph(makeMacrocycleWithSubstituent(), { suppressH: true });
    const result = layoutMacrocycleFamily(graph.rings, graph.options.bondLength);

    assert.equal(result.coords.size, graph.rings[0].atomIds.length);
    assertMacrocycleLayoutQuality(graph, result.coords);
  });

  it('avoids catastrophic ring-completion blowups for nearly fully shared fused macrocycle rings', () => {
    const graph = createLayoutGraph(
      parseSMILES(
        'CC(C)[C@H]1NC(=O)c2cc3cc(c2)C(=O)NC[C@H](NC(=O)[C@@H](C)NC(=O)[C@H](C)NC(=O)[C@H](CCCNC(=N)N)NC(=O)[C@H](Cc4ccc5ccccc5c4)NC(=O)[C@H]6CCCCN6C(=O)[C@H](NC(=O)[C@H](Cc7ccc(F)cc7)NC1=O)[C@H](C)O)C(=O)N[C@@H](Cc8ccccc8)C(=O)N[C@@H](Cc9ccc%10ccccc%10c9)C(=O)N[C@@H](CCCNC(=N)N)C(=O)N[C@@H](CCCNC(=N)N)C(=O)N[C@@H](CCCNC(=N)N)C(=O)N[C@@H](CCCNC(=N)N)C(=O)N[C@@H](CNC3=O)C(=O)N[C@@H](CCCCN)C(=O)O'
      ),
      { suppressH: true }
    );
    const rings = graph.ringSystems[0].ringIds.map(id => graph.rings.find(ring => ring.id === id));
    const result = layoutMacrocycleFamily(rings, graph.options.bondLength, { layoutGraph: graph });
    const bondStats = measureBondLengthDeviation(graph, result.coords, graph.options.bondLength);

    assert.equal(result.placementMode, 'ellipse');
    assert.ok(result.coords.has('C10'));
    assert.ok(Number.isFinite(result.coords.get('C10').x));
    assert.ok(Number.isFinite(result.coords.get('C10').y));
    assert.ok(bondStats.maxDeviation < 1, `expected fused macrocycle completion to avoid catastrophic bond blowups, got ${bondStats.maxDeviation}`);
  });

  it('keeps multi-atom fused aryl arcs on macrocycle roots at normal bond lengths', () => {
    const smiles = 'OCC1OC(OC2=CC=C3CCCCC(O)CCC4=CC=C(OC2=C3)C=C4)C(O)C(O)C1O';
    for (const suppressH of [true, false]) {
      const result = generateCoords(parseSMILES(smiles), { suppressH, bondLength: 1.5 });

      assert.equal(result.metadata.audit.ok, true);
      assert.equal(result.metadata.audit.bondLengthFailureCount, 0);
      assert.equal(findSevereOverlaps(result.layoutGraph, result.coords, result.layoutGraph.options.bondLength).length, 0);
      for (const [firstAtomId, secondAtomId] of [
        ['C7', 'C24'],
        ['C9', 'C10'],
        ['C19', 'C27'],
        ['C22', 'C26']
      ]) {
        assert.ok(
          Math.abs(bondDistance(result.coords, firstAtomId, secondAtomId) - result.layoutGraph.options.bondLength) < 0.05,
          `expected ${firstAtomId}-${secondAtomId} to stay attached to the fused aryl arc`
        );
      }
      for (const ring of result.layoutGraph.rings.filter(candidateRing => candidateRing.aromatic)) {
        for (let index = 0; index < ring.atomIds.length; index++) {
          const centerAtomId = ring.atomIds[index];
          const previousAtomId = ring.atomIds[(index - 1 + ring.atomIds.length) % ring.atomIds.length];
          const nextAtomId = ring.atomIds[(index + 1) % ring.atomIds.length];
          assert.ok(
            Math.abs(bondAngleDegrees(result.coords, centerAtomId, previousAtomId, nextAtomId) - 120) < 1,
            `expected aromatic angle at ${centerAtomId} to stay hexagonal`
          );
        }
      }
      const c24BridgeAngleDeviation = Math.max(
        Math.abs(bondAngleDegrees(result.coords, 'C24', 'C7', 'O23') - 120),
        Math.abs(bondAngleDegrees(result.coords, 'C24', 'C25', 'O23') - 120)
      );
      assert.ok(c24BridgeAngleDeviation < 5, 'expected the aryl-ether bridge to exit C24 outside the lower aromatic ring');
      assert.ok(
        bondDistance(result.coords, 'O6', 'C22') > result.layoutGraph.options.bondLength * 2,
        'expected the glycoside linker oxygen to stay clear of the upper aromatic ring'
      );
      assert.ok(
        bondDistance(result.coords, 'C24', 'O23') < result.layoutGraph.options.bondLength * 1.25,
        'expected the lower aryl-ether bridge bond to stay visually attached'
      );
    }
  });

  it('computes outward angular budgets for branch-bearing macrocycle atoms and shrinks dense adjacent sites', () => {
    const sparseGraph = createLayoutGraph(makeMacrocycleWithSubstituent(), { suppressH: true });
    const sparseLayout = layoutMacrocycleFamily(sparseGraph.rings, sparseGraph.options.bondLength);
    const sparseBudgets = computeMacrocycleAngularBudgets(sparseGraph.rings, sparseLayout.coords, sparseGraph, new Set(sparseGraph.components[0].atomIds));

    const denseMolecule = makeMacrocycle();
    denseMolecule.addAtom('x0', 'C');
    denseMolecule.addAtom('x1', 'C');
    denseMolecule.addBond('x0b', 'a0', 'x0', {}, false);
    denseMolecule.addBond('x1b', 'a1', 'x1', {}, false);
    const denseGraph = createLayoutGraph(denseMolecule, { suppressH: true });
    const denseLayout = layoutMacrocycleFamily(denseGraph.rings, denseGraph.options.bondLength);
    const denseBudgets = computeMacrocycleAngularBudgets(denseGraph.rings, denseLayout.coords, denseGraph, new Set(denseGraph.components[0].atomIds));
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
    const budgets = computeMacrocycleAngularBudgets(graph.rings, ringLayout.coords, graph, new Set(graph.components[0].atomIds));
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

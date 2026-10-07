import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseSMILES } from '../../../../src/io/smiles.js';
import { generateCoords } from '../../../../src/layout/engine/api.js';
import { auditLayout } from '../../../../src/layout/engine/audit/audit.js';
import { findVisibleHeavyBondCrossings } from '../../../../src/layout/engine/audit/invariants.js';
import { createLayoutGraph } from '../../../../src/layout/engine/model/layout-graph.js';
import { selectAttachedRingMirrors } from '../../../../src/layout/engine/placement/attached-ring-mirrors.js';
import { distance } from '../../../../src/layout/engine/geometry/vec2.js';
import { AUDIT_CORPUS } from '../support/audit-corpus.js';

const PORPHYRINOID = AUDIT_CORPUS.find(entry => entry.sourceIndex === 2781).smiles;
let unreflectedLayout;

/**
 * Builds independent graph state around a naturally crossed placement.
 * @param {object} [options] - Graph options.
 * @returns {{graph: object, coords: Map<string, {x: number, y: number}>}} Dirty fixture.
 */
function dirtyFixture(options = {}) {
  unreflectedLayout ??= generateCoords(parseSMILES(PORPHYRINOID), { allowBranchReflect: false });
  return {
    graph: createLayoutGraph(parseSMILES(PORPHYRINOID), { suppressH: true, ...options }),
    coords: structuredClone(unreflectedLayout.coords)
  };
}

/**
 * Asserts the fixed layout without weakening the scaffold's existing limits.
 * @param {object} result - Generated layout.
 * @param {number} [bondLength] - Requested scale.
 * @returns {void}
 */
function assertClean(result, bondLength = 1.5) {
  const audit = result.metadata.audit;
  assert.equal(audit.ok, true);
  for (const key of [
    'severeOverlapCount',
    'visibleHeavyBondCrossingCount',
    'bondLengthFailureCount',
    'labelOverlapCount',
    'ringSubstituentReadabilityFailureCount',
    'missingCoordinateCount',
    'nonfiniteCoordinateCount'
  ]) {
    assert.equal(audit[key], 0, key);
  }
  assert.equal(audit.stereoContradiction, false);
  assert.ok(audit.maxBondLengthDeviation <= (0.334827 / 1.5) * bondLength);
}

describe('completed attached-ring mirror selection', () => {
  for (const bondLength of [0.75, 1.5, 3]) {
    it(`clears the phenol branch crossing at bond length ${bondLength}`, () => {
      assertClean(generateCoords(parseSMILES(PORPHYRINOID), { bondLength }), bondLength);
    });
  }

  for (const [name, smiles] of [
    ['methoxy', `C${PORPHYRINOID}`],
    ['amino', PORPHYRINOID.replace('Oc1', 'Nc1')]
  ]) {
    it(`also clears the crossing with a neighboring ${name} substituent`, () => {
      assertClean(generateCoords(parseSMILES(smiles)));
    });
  }

  it('is deterministic across fresh molecule instances', () => {
    const first = generateCoords(parseSMILES(PORPHYRINOID));
    const second = generateCoords(parseSMILES(PORPHYRINOID));
    assertClean(first);
    assertClean(second);
    assert.deepEqual(second.coords, first.coords);
  });

  it('reflects only the pendant ring branch and preserves every bond length', () => {
    const { graph, coords } = dirtyFixture();
    const original = structuredClone(coords);
    const baseAudit = auditLayout(graph, coords);
    assert.equal(baseAudit.visibleHeavyBondCrossingCount, 1);
    const result = selectAttachedRingMirrors(graph, coords, new Map(), 1.5);
    assert.equal(result.mirrors, 1);
    assert.deepEqual(coords, original);
    assert.equal(result.coords.size, coords.size);
    const audit = auditLayout(graph, result.coords);
    assert.equal(audit.visibleHeavyBondCrossingCount, 0);
    for (const key of ['severeOverlapCount', 'labelOverlapCount', 'ringSubstituentReadabilityFailureCount']) {
      assert.equal(audit[key], 0);
    }
    // The raw graph has no projection classes; do not reclassify core bonds.
    assert.equal(audit.bondLengthFailureCount, baseAudit.bondLengthFailureCount);
    assert.ok(audit.maxBondLengthDeviation <= baseAudit.maxBondLengthDeviation + 1e-9);
    for (const bond of graph.bonds.values()) {
      if (coords.has(bond.a) && coords.has(bond.b)) {
        assert.ok(Math.abs(distance(coords.get(bond.a), coords.get(bond.b)) - distance(result.coords.get(bond.a), result.coords.get(bond.b))) < 1e-9);
      }
    }
    const core = graph.ringSystems.find(system => system.ringIds.some(id => graph.ringById.get(id).size >= 12));
    for (const id of core.atomIds) {
      assert.deepEqual(result.coords.get(id), coords.get(id));
    }
  });

  it('honors disabled reflections', () => {
    const { graph, coords } = dirtyFixture({ allowBranchReflect: false });
    const result = selectAttachedRingMirrors(graph, coords, new Map(), 1.5);
    assert.equal(result.mirrors, 0);
    assert.equal(result.coords, coords);
  });

  it('does not move a fixed atom on the crossed phenol branch', () => {
    const { graph, coords } = dirtyFixture();
    const crossing = findVisibleHeavyBondCrossings(graph, coords)[0];
    const bonds = [graph.bonds.get(crossing.firstBondId), graph.bonds.get(crossing.secondBondId)];
    const oxygenId = bonds.flatMap(bond => [bond.a, bond.b]).find(id => graph.atoms.get(id).element === 'O');
    assert.ok(oxygenId);
    graph.fixedCoords.set(oxygenId, coords.get(oxygenId));
    const result = selectAttachedRingMirrors(graph, coords, new Map(), 1.5);
    assert.equal(result.mirrors, 0);
    assert.equal(result.coords, coords);
  });

  it('skips branches carrying stereochemical annotations', () => {
    for (const annotation of ['atom', 'bond']) {
      const { graph, coords } = dirtyFixture();
      // Exercise the conservative annotation guard independently of perception.
      for (const atom of graph.atoms.values()) {
        if (annotation === 'atom') {
          atom.chirality = '@';
        }
      }
      if (annotation === 'bond') {
        for (const bond of graph.bonds.values()) {
          bond.stereo = '/';
        }
      }
      const result = selectAttachedRingMirrors(graph, coords, new Map(), 1.5);
      assert.equal(result.mirrors, 0);
      assert.equal(result.coords, coords);
    }
  });

  it('keeps clean layouts unchanged', () => {
    for (const smiles of ['c1ccccc1-c1cccc(O)c1', 'CC', 'C1CCCCC1']) {
      const layout = generateCoords(parseSMILES(smiles));
      const result = selectAttachedRingMirrors(layout.layoutGraph, layout.coords, new Map(), 1.5);
      assert.equal(result.mirrors, 0);
      assert.equal(result.coords, layout.coords);
    }
  });

  it('does not expand the search beyond its molecule-size budget', () => {
    const { graph, coords } = dirtyFixture();
    graph.traits.heavyAtomCount = 97;
    const result = selectAttachedRingMirrors(graph, coords, new Map(), 1.5);
    assert.equal(result.mirrors, 0);
    assert.equal(result.coords, coords);
  });
});

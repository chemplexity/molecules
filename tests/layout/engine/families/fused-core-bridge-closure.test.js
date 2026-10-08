import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseSMILES } from '../../../../src/io/smiles.js';
import { generateCoords } from '../../../../src/layout/engine/api.js';
import { auditLayout } from '../../../../src/layout/engine/audit/audit.js';
import { createLayoutGraph } from '../../../../src/layout/engine/model/layout-graph.js';
import { regularizeFusedAromaticCyclohexaneCores } from '../../../../src/layout/engine/families/bridged.js';
import { layoutKamadaKawai } from '../../../../src/layout/engine/geometry/kk-layout.js';
import { distance } from '../../../../src/layout/engine/geometry/vec2.js';
import { assignBondValidationClass } from '../../../../src/layout/engine/placement/bond-validation.js';
import { AUDIT_CORPUS } from '../support/audit-corpus.js';

const CAGE = AUDIT_CORPUS.find(entry => entry.sourceIndex === 29465).smiles;

/**
 * Checks complete cage geometry using the existing projected interpretation.
 * @param {object} result - Generated layout.
 * @param {number} [bondLength] - Target length.
 * @returns {void}
 */
function assertClean(result, bondLength = 1.5) {
  const audit = result.metadata.audit;
  assert.equal(audit.ok, true);
  for (const key of [
    'severeOverlapCount',
    'bondLengthFailureCount',
    'visibleHeavyBondCrossingFailureCount',
    'labelOverlapCount',
    'ringSubstituentReadabilityFailureCount',
    'missingCoordinateCount',
    'nonfiniteCoordinateCount'
  ]) {
    assert.equal(audit[key], 0, key);
  }
  // One internal bridge crossing is part of this cage's projection, not a
  // newly exempted planar branch. Preserve the existing corpus deviation cap.
  assert.ok(audit.visibleHeavyBondCrossingCount <= 1);
  assert.ok(audit.maxBondLengthDeviation <= (0.53 * bondLength) / 1.5);
  assert.equal(audit.stereoContradiction, false);
}

/**
 * Produces an unregularized, independently computed compact cage seed.
 * @returns {{graph: object, rings: object[], ids: string[], seed: Map<string, {x: number, y: number}>, classes: Map<string, string>}} Fixture.
 */
function seedFixture() {
  const graph = createLayoutGraph(parseSMILES(CAGE), { suppressH: true });
  const rings = graph.ringSystems[0].ringIds.map(id => graph.ringById.get(id));
  const ids = [...new Set(rings.flatMap(ring => ring.atomIds))];
  const seed = layoutKamadaKawai(graph.sourceMolecule, ids, { bondLength: 1.5 }).coords;
  return { graph, rings, ids, seed, classes: assignBondValidationClass(graph, ids, 'bridged') };
}

describe('coupled bridge closure around a fused aromatic core', () => {
  for (const bondLength of [0.75, 1.5, 3]) {
    it(`preserves cage bonds at scale ${bondLength}`, () => {
      assertClean(generateCoords(parseSMILES(CAGE), { bondLength }), bondLength);
    });
  }

  for (const [name, smiles] of [
    ['short phenol tail', `O${CAGE.slice(CAGE.indexOf('C1=CC='))}`],
    ['ethyl ammonium branch', CAGE.replace('[N+]3(C)', '[N+]3(CC)')],
    ['stereochemical side chain', CAGE.replace('CC(NC', 'C[C@H](NC')]
  ]) {
    it(`keeps the cage sound with a ${name}`, () => {
      const result = generateCoords(parseSMILES(smiles));
      assertClean(result);
      if (name === 'stereochemical side chain') {
        assert.equal(result.metadata.stereo.unassignedCenterCount, 0);
        assert.ok(result.metadata.stereo.assignedCenterCount > 0);
      }
    });
  }

  it('is deterministic with fresh molecules', () => {
    const first = generateCoords(parseSMILES(CAGE));
    const second = generateCoords(parseSMILES(CAGE));
    assertClean(first);
    assertClean(second);
    assert.deepEqual(second.coords, first.coords);
  });

  it('regularizes the fused pair without breaking coupled closure edges or mutating input', () => {
    const { graph, rings, ids, seed, classes } = seedFixture();
    const original = structuredClone(seed);
    const originalClasses = new Map(classes);
    const coords = regularizeFusedAromaticCyclohexaneCores(graph, rings, ids, seed, 1.5);
    const audit = auditLayout(graph, coords, { bondLength: 1.5, bondValidationClasses: classes });
    assert.equal(audit.ok, true);
    assert.ok(audit.maxBondLengthDeviation <= 0.37500001);
    assert.deepEqual(seed, original);
    assert.deepEqual(classes, originalClasses);
    assert.equal(graph.fixedCoords.size, 0);
    assert.equal(coords.size, seed.size);
    const aromatic = rings.find(ring => ring.aromatic);
    const fused = rings.find(ring => !ring.aromatic && ring.size === 6 && ring.atomIds.filter(id => aromatic.atomIds.includes(id)).length === 2);
    assert.ok(fused);
    for (const ring of [aromatic, fused]) {
      for (let i = 0; i < ring.atomIds.length; i++) {
        const a = coords.get(ring.atomIds[i]);
        const b = coords.get(ring.atomIds[(i + 1) % ring.atomIds.length]);
        assert.ok(Math.abs(distance(a, b) - 1.5) < 1e-8);
      }
    }
  });

  it('leaves explicitly fixed cage coordinates untouched', () => {
    const { graph, rings, ids, seed } = seedFixture();
    const original = structuredClone(seed);
    for (const [id, position] of seed) {
      graph.fixedCoords.set(id, { ...position });
    }
    const coords = regularizeFusedAromaticCyclohexaneCores(graph, rings, ids, seed, 1.5);
    assert.deepEqual(coords, original);
    assert.deepEqual(graph.fixedCoords, original);
  });

  it('keeps ordinary fused and simple projected-ring controls clean', () => {
    for (const smiles of ['c1ccc2c(c1)CCCC2', 'C1CC2CCC1C2', 'CC']) {
      const result = generateCoords(parseSMILES(smiles));
      assert.equal(result.metadata.audit.ok, true);
      assert.equal(result.metadata.audit.bondLengthFailureCount, 0);
    }
  });
});

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseSMILES } from '../../../../src/io/smiles.js';
import { generateCoords } from '../../../../src/layout/engine/api.js';

const AMINO_CAGE = 'CC1(O)CC2CC(N)C1(C)C1OCCC21';

/**
 * Checks an outward-readable compact cage without relaxing projected validation.
 * @param {object} result - Generated layout.
 * @param {number} bondLength - Requested scale.
 * @returns {void}
 */
function assertCleanCage(result, bondLength) {
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
  assert.equal(audit.stereoContradiction, false);
  assert.equal(audit.fallback.mode, null);
  assert.ok(audit.maxBondLengthDeviation <= bondLength * 0.25 + 1e-8);
  assert.ok(audit.visibleHeavyBondCrossingCount <= 2);
}

describe('compact hybrid scaffold branch exits', () => {
  for (const substituent of ['N', 'O', 'F', '[NH3+]', 'NC']) {
    for (const bondLength of [0.75, 1.5, 3]) {
      it(`keeps the ${substituent} exit readable at scale ${bondLength}`, () => {
        const smiles = AMINO_CAGE.replace('(N)', `(${substituent})`);
        const result = generateCoords(parseSMILES(smiles), { bondLength, auditTelemetry: true });
        assertCleanCage(result, bondLength);
        assert.equal(result.metadata.placementAudit.ringSubstituentReadabilityFailureCount, 0);
        assert.equal(result.metadata.placementAudit.bondLengthFailureCount, 0);
      });
    }
  }

  it('is deterministic and does not mutate the input molecule', () => {
    const molecule = parseSMILES(AMINO_CAGE);
    const before = [...molecule.atoms].map(([id, atom]) => [id, atom.x, atom.y]);
    const first = generateCoords(molecule);
    const second = generateCoords(parseSMILES(AMINO_CAGE));
    assertCleanCage(first, 1.5);
    assert.deepEqual(second.coords, first.coords);
    assert.deepEqual(
      [...molecule.atoms].map(([id, atom]) => [id, atom.x, atom.y]),
      before
    );
  });

  it('also repairs unanchored layouts with fixed preservation disabled', () => {
    assertCleanCage(generateCoords(parseSMILES(AMINO_CAGE), { preserveFixed: false }), 1.5);
  });

  for (const bondLength of [0.75, 1.5, 3]) {
    it(`preserves the stereochemical cage's bond quality at scale ${bondLength}`, () => {
      const smiles = 'CCN1C(=O)NC(=O)[C@@]12CC[C@@]3(O)[C@H]4Cc5ccc(O)cc5[C@@]3(CCN4CC6CC6)C2';
      const result = generateCoords(parseSMILES(smiles), { bondLength });
      const audit = result.metadata.audit;
      assert.equal(audit.ok, true);
      assert.equal(audit.severeOverlapCount, 0);
      assert.equal(audit.bondLengthFailureCount, 0);
      assert.equal(audit.visibleHeavyBondCrossingFailureCount, 0);
      assert.equal(audit.ringSubstituentReadabilityFailureCount, 0);
      assert.equal(audit.stereoContradiction, false);
      assert.ok(audit.maxBondLengthDeviation <= (0.5784 / 1.5) * bondLength);
      assert.ok(audit.meanBondLengthDeviation <= (0.1832 / 1.5) * bondLength);
    });
  }

  it('does not mutate supplied fixed-coordinate constraints', () => {
    const molecule = parseSMILES(AMINO_CAGE);
    const generated = generateCoords(molecule);
    const fixedCoords = new Map([...generated.coords].filter(([id]) => molecule.atoms.get(id).name !== 'H'));
    const before = structuredClone(fixedCoords);
    const result = generateCoords(parseSMILES(AMINO_CAGE), { fixedCoords });
    assert.deepEqual(fixedCoords, before);
    assert.deepEqual(result.layoutGraph.fixedCoords, before);
  });

  it('keeps ordinary ring, spiro, and projected cage controls clean', () => {
    for (const smiles of ['NC1CCCCC1', 'OC1CCC2(CC1)CCCC2', 'C1CC2CCC1C2', 'CC12C3C4C1C5C2C3C45', 'CC']) {
      const result = generateCoords(parseSMILES(smiles));
      assert.equal(result.metadata.audit.ok, true, smiles);
      assert.equal(result.metadata.audit.bondLengthFailureCount, 0, smiles);
      assert.equal(result.metadata.audit.visibleHeavyBondCrossingFailureCount, 0, smiles);
    }
  });
});

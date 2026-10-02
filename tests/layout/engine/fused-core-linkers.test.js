import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseSMILES } from '../../../src/io/smiles.js';
import { generateCoords, refineCoords } from '../../../src/layout/engine/api.js';

const protectedSugar = 'CO[C@H]1O[C@@H]([C@@H](N=[N+]=[N-])C(=O)OCc2ccccc2)[C@@H](OCc3ccccc3)[C@@]4(OCc5ccccc5)[C@H](CO[C@@H]14)OCc6ccccc6';

/**
 * Checks hard geometry and outward ring exits without fixing an incidental pose.
 * @param {object} result - Completed engine result.
 * @returns {void}
 */
function assertClean(result) {
  const audit = result.metadata.audit;
  assert.equal(audit.ok, true);
  assert.equal(audit.severeOverlapCount, 0);
  assert.equal(audit.visibleHeavyBondCrossingFailureCount, 0);
  assert.equal(audit.bondLengthFailureCount, 0);
  assert.equal(audit.ringSubstituentReadabilityFailureCount, 0);
  assert.equal(audit.stereoContradiction, false);
  assert.equal(audit.missingCoordinateCount, 0);
  assert.equal(audit.nonfiniteCoordinateCount, 0);
}

describe('short linkers from non-aromatic fused cores', () => {
  for (const bondLength of [0.75, 1.5, 3]) {
    it(`keeps protected sugar branches separated at bond length ${bondLength}`, () => {
      const molecule = parseSMILES(protectedSugar);
      const result = generateCoords(molecule, { bondLength });
      assertClean(result);
      assert.ok(result.metadata.audit.maxBondLengthDeviation < 1e-6);
      assertClean(refineCoords(molecule, { bondLength, existingCoords: result.coords }));
    });
  }

  it('is deterministic for the protected sugar', () => {
    const molecule = parseSMILES(protectedSugar);
    assert.deepEqual(generateCoords(molecule).coords, generateCoords(molecule).coords);
  });

  for (const smiles of [
    'C1CCC2CC(OCC3=CC=CC=C3)CCC2C1',
    'c1ccc2cc(OCC3=CC=CC=C3)ccc2c1',
    'C1CCCCC1OCC2=CC=CC=C2',
    'C1CC2CCC1C2OCC3=CC=CC=C3'
  ]) {
    it(`retains clean geometry for linker control ${smiles}`, () => {
      assertClean(generateCoords(parseSMILES(smiles)));
    });
  }
});

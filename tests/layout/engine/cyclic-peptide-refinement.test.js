import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseSMILES } from '../../../src/io/index.js';
import { generateCoords, refineCoords } from '../../../src/layout/engine/api.js';

/**
 * Builds a cyclic peptide with repeated side chains.
 * @param {number} count - Residue count.
 * @param {string} side - Side-chain SMILES.
 * @returns {string} Cyclic peptide SMILES.
 */
function cyclicPeptide(count, side) {
  return `O=C1${`N[C@@H](${side})C(=O)`.repeat(count - 1)}N[C@@H]1${side}`;
}

describe('cyclic peptide refinement', () => {
  for (const count of [4, 5, 8]) {
    it(`preserves clean geometry for ${count} tryptophan residues`, () => {
      const molecule = parseSMILES(cyclicPeptide(count, 'Cc2c[nH]c3ccccc23'));
      const generated = generateCoords(molecule);
      assert.equal(generated.metadata.audit.ok, true);
      const snapshot = structuredClone(generated.coords);
      const visibility = [...molecule.atoms.values()].map(atom => atom.visible);
      const refined = refineCoords(molecule, { existingCoords: generated.coords });
      assert.equal(refined.metadata.audit.bondLengthFailureCount, 0);
      assert.equal(refined.metadata.audit.ok, true);
      assert.deepEqual(generated.coords, snapshot);
      assert.deepEqual(
        [...molecule.atoms.values()].map(atom => atom.visible),
        visibility
      );
      for (const [id, atom] of molecule.atoms) {
        if (atom.name !== 'H') {
          const position = refined.coords.get(id);
          assert.ok(Number.isFinite(position?.x) && Number.isFinite(position?.y));
        }
      }
    });
  }
  for (const side of ['C', 'Cc2ccccc2', 'Cc2c[nH]c3ccccc23']) {
    for (const bondLength of [0.75, 3]) {
      it(`keeps scaled cyclic ${side} geometry clean at ${bondLength}`, () => {
        const molecule = parseSMILES(cyclicPeptide(5, side));
        const generated = generateCoords(molecule, { bondLength });
        assert.equal(generated.metadata.audit.ok, true);
        for (const entrypoint of [generateCoords, refineCoords]) {
          const result = entrypoint(molecule, { bondLength, existingCoords: generated.coords });
          assert.equal(result.metadata.audit.ok, true);
          assert.equal(result.metadata.audit.missingCoordinateCount, 0);
          const repeated = refineCoords(molecule, { bondLength, existingCoords: result.coords });
          assert.equal(repeated.metadata.audit.ok, true);
        }
      });
    }
  }

  it('still places a genuinely missing heavy atom during refinement', () => {
    const molecule = parseSMILES('c1cc[nH]c1');
    const generated = generateCoords(molecule);
    const existingCoords = new Map(generated.coords);
    const heavyId = [...molecule.atoms].find(([, atom]) => atom.name !== 'H')[0];
    existingCoords.delete(heavyId);
    const result = refineCoords(molecule, { existingCoords });
    assert.ok(Number.isFinite(result.coords.get(heavyId)?.x));
    assert.ok(Number.isFinite(result.coords.get(heavyId)?.y));
    assert.equal(result.metadata.audit.missingCoordinateCount, 0);
  });
});

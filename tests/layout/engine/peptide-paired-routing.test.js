import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseSMILES } from '../../../src/io/index.js';
import { generateCoords } from '../../../src/layout/engine/api.js';
import { bugMolecules } from '../../../examples/bug-molecules.js';

/**
 * Reproduces the deterministic 13-residue discovery sweep.
 * @param {number} seed - Unsigned generator seed.
 * @returns {string} Peptide SMILES with terminal glycine.
 */
function peptideSmiles(seed) {
  const chains = ['C', 'C(C)C', 'CC(C)C', 'CO', 'C(C)O', 'CC(=O)O', 'CCC(=O)O', 'CCCCN', 'CCCNC(=N)N', 'Cc1ccccc1', 'Cc1ccc(O)cc1', 'Cc1c[nH]c2ccccc12', 'Cc1cnc[nH]1', 'CC(=O)N', 'CCC(=O)N', 'CCSC'];
  let state = seed;
  const sequence = Array.from({ length: 12 }, () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return chains[Math.floor((state / 4294967296) * chains.length)];
  });
  return `N${sequence.map(side => `[C@@H](${side})C(=O)N`).join('')}CC(=O)O`;
}

describe('peptide paired routing', () => {
  it('clears the coupled overlap and crossing in the discovery peptide', () => {
    const result = generateCoords(parseSMILES(peptideSmiles(20)));
    assert.equal(result.metadata.audit.severeOverlapCount, 0);
    assert.equal(result.metadata.audit.visibleHeavyBondCrossingFailureCount, 0);
    assert.equal(result.metadata.audit.ok, true);
    assert.equal(result.metadata.audit.missingCoordinateCount, 0);
    assert.equal(result.metadata.audit.nonfiniteCoordinateCount, 0);
    assert.ok(bugMolecules.includes(peptideSmiles(20)));
    const repeated = generateCoords(parseSMILES(peptideSmiles(20)));
    assert.deepEqual(repeated.coords, result.coords);
  });
  for (const bondLength of [0.75, 3]) {
    it(`clears the same defects at bond length ${bondLength}`, () => {
      const molecule = parseSMILES(peptideSmiles(20));
      const result = generateCoords(molecule, { bondLength });
      assert.equal(result.metadata.audit.ok, true);
      assert.equal(result.metadata.audit.visibleHeavyBondCrossingCount, 0);
      assert.equal(result.metadata.audit.missingCoordinateCount, 0);
      for (const [id, atom] of molecule.atoms) {
        if (atom.name !== 'H') {
          assert.ok(Number.isFinite(result.coords.get(id)?.x) && Number.isFinite(result.coords.get(id)?.y));
        }
      }
      const anchors = structuredClone(result.coords);
      const anchored = generateCoords(molecule, { bondLength, existingCoords: result.coords, fixedCoords: anchors });
      assert.deepEqual(anchored.coords, anchors);
      assert.deepEqual(result.coords, anchors);
    });
  }
  for (const seed of [19, 21, 24]) {
    it(`preserves clean nearby peptide seed ${seed}`, () => {
      const result = generateCoords(parseSMILES(peptideSmiles(seed)));
      assert.equal(result.metadata.audit.ok, true);
      assert.equal(result.metadata.audit.visibleHeavyBondCrossingCount, 0);
    });
  }
});

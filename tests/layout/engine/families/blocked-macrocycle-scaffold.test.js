import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseSMILES } from '../../../../src/io/smiles.js';
import { generateCoords } from '../../../../src/layout/engine/api.js';
import { AUDIT_CORPUS } from '../support/audit-corpus.js';

const MACROCYCLE = AUDIT_CORPUS.find(entry => entry.sourceIndex === 11097).smiles;

/**
 * Checks that branch clearance does not sacrifice closure, stereo, or lengths.
 * @param {object} result - Generated layout.
 * @param {number} bondLength - Requested bond length.
 * @returns {void}
 */
function assertCleanMacrocycle(result, bondLength) {
  const audit = result.metadata.audit;
  assert.equal(audit.ok, true);
  for (const field of [
    'severeOverlapCount',
    'visibleHeavyBondCrossingCount',
    'visibleHeavyBondCrossingFailureCount',
    'bondLengthFailureCount',
    'labelOverlapCount',
    'ringSubstituentReadabilityFailureCount',
    'collapsedMacrocycleCount',
    'missingCoordinateCount',
    'nonfiniteCoordinateCount'
  ]) {
    assert.equal(audit[field], 0, field);
  }
  assert.equal(audit.stereoContradiction, false);
  assert.equal(audit.fallback.mode, null);
  assert.ok(audit.maxBondLengthDeviation <= bondLength * 0.16 + 1e-8);
}

describe('blocked macrocycle scaffold placement', () => {
  for (const [name, smiles] of [
    ['original', MACROCYCLE],
    ['ethoxy substituent', MACROCYCLE.replace(/^CO/, 'CCO')],
    ['piperazine substituent', MACROCYCLE.replace('N4CCOCC4', 'N4CCNCC4')]
  ]) {
    for (const bondLength of [0.75, 1.5, 3]) {
      it(`clears ${name} branches at scale ${bondLength}`, () => {
        const result = generateCoords(parseSMILES(smiles), { bondLength, auditTelemetry: true });
        assertCleanMacrocycle(result, bondLength);
        // At larger scales ordinary branch cleanup clears one temporary contact.
        assert.ok(result.metadata.placementAudit.visibleHeavyBondCrossingCount <= 1);
        assert.equal(result.metadata.placementAudit.bondLengthFailureCount, 0);
      });
    }
  }

  it('is deterministic and leaves the source molecule unchanged', () => {
    const molecule = parseSMILES(MACROCYCLE);
    const before = [...molecule.atoms].map(([id, atom]) => [id, atom.x, atom.y, atom.chirality]);
    const first = generateCoords(molecule);
    assertCleanMacrocycle(first, 1.5);
    assert.deepEqual(generateCoords(parseSMILES(MACROCYCLE)).coords, first.coords);
    assert.deepEqual(
      [...molecule.atoms].map(([id, atom]) => [id, atom.x, atom.y, atom.chirality]),
      before
    );
  });

  it('works with user-anchor preservation disabled', () => {
    assertCleanMacrocycle(generateCoords(parseSMILES(MACROCYCLE), { preserveFixed: false }), 1.5);
  });

  it('preserves fully anchored simple macrocycle coordinates', () => {
    const smiles = 'C1CCCCCCCCCCC1';
    const molecule = parseSMILES(smiles);
    const first = generateCoords(molecule);
    const fixedCoords = new Map([...first.coords].filter(([id]) => molecule.atoms.get(id).name !== 'H'));
    const before = structuredClone(fixedCoords);
    const result = generateCoords(parseSMILES(smiles), { fixedCoords });
    for (const [id, point] of before) {
      assert.deepEqual(result.coords.get(id), point);
    }
    assert.deepEqual(fixedCoords, before);
    assert.equal(result.metadata.audit.fixedCoordinateViolationCount, 0);
  });

  it('keeps ordinary rings, macrocycles, and projected cages clean', () => {
    for (const smiles of ['CC', 'NC1CCCCC1', 'C1CCCCCCCCCCC1', 'OC1CCCCCCCCCCCCCCC1', 'C1CC2CCC1C2']) {
      assert.equal(generateCoords(parseSMILES(smiles)).metadata.audit.ok, true, smiles);
    }
  });
});

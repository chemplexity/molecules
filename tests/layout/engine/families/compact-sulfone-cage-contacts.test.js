import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { bugMolecules } from '../../../../examples/bug-molecules.js';
import { parseSMILES } from '../../../../src/io/smiles.js';
import { generateCoords, refineCoords } from '../../../../src/layout/engine/api.js';

const SULFONE_CAGE = 'CCN1CC2CNS(=O)(=O)C1C1C(C2N)N1C';
const SULFUR_FREE_CONTROL = 'CCN1CC2CNCC1C1C(C2N)N1C';
const RING_OPENED_CONTROL = 'CCNCC1CNS(=O)(=O)CC2C(C1N)N2C';

/**
 * Asserts that a compact cage retains complete, readable projected geometry.
 * @param {object} result - Generated or refined layout result.
 * @returns {void}
 */
function assertCleanCompleteCage(result) {
  const audit = result.metadata.audit;
  assert.equal(audit.ok, true);
  assert.equal(audit.severeOverlapCount, 0);
  assert.equal(audit.visibleHeavyBondCrossingFailureCount, 0);
  assert.equal(audit.bondLengthFailureCount, 0);
  assert.equal(audit.labelOverlapCount, 0);
  assert.equal(audit.ringSubstituentReadabilityFailureCount, 0);
  assert.equal(audit.missingCoordinateCount, 0);
  assert.equal(audit.nonfiniteCoordinateCount, 0);
  assert.equal(audit.stereoContradiction, false);
  assert.equal(audit.fallback.mode, null);
  for (const [atomId, atom] of result.layoutGraph.atoms) {
    if (atom.element === 'H') {
      continue;
    }
    const position = result.coords.get(atomId);
    assert.ok(position, `expected coordinates for heavy atom ${atomId}`);
    assert.equal(Number.isFinite(position.x), true);
    assert.equal(Number.isFinite(position.y), true);
  }
}

describe('compact sulfone cage contact clearance', () => {
  for (const bondLength of [0.75, 1.5, 3]) {
    for (const suppressH of [true, false]) {
      it(`separates the symmetric cage contacts through refinement at scale ${bondLength} with suppressH=${suppressH}`, () => {
        const molecule = parseSMILES(SULFONE_CAGE);
        const generated = generateCoords(molecule, { bondLength, suppressH, auditTelemetry: true });
        const generatedBefore = structuredClone(generated.coords);
        const refined = refineCoords(molecule, {
          bondLength,
          suppressH,
          existingCoords: generated.coords,
          auditTelemetry: true
        });

        assertCleanCompleteCage(generated);
        assertCleanCompleteCage(refined);
        assert.deepEqual(generated.coords, generatedBefore);
      });
    }
  }

  it('keeps sulfur-free and ring-opened controls clean across scales', () => {
    for (const smiles of [SULFUR_FREE_CONTROL, RING_OPENED_CONTROL]) {
      for (const bondLength of [0.75, 1.5, 3]) {
        const generated = generateCoords(parseSMILES(smiles), { bondLength, auditTelemetry: true });
        const refined = refineCoords(parseSMILES(smiles), {
          bondLength,
          existingCoords: generated.coords,
          auditTelemetry: true
        });
        assertCleanCompleteCage(generated);
        assertCleanCompleteCage(refined);
      }
    }
  });

  it('is cataloged and deterministic across fresh parses', () => {
    assert.ok(bugMolecules.includes(SULFONE_CAGE));
    const first = generateCoords(parseSMILES(SULFONE_CAGE), { auditTelemetry: true });
    const second = generateCoords(parseSMILES(SULFONE_CAGE), { auditTelemetry: true });

    assertCleanCompleteCage(first);
    assert.deepEqual(second.coords, first.coords);
  });

  it('preserves a fixed cage anchor without mutating the constraint map', () => {
    const initial = generateCoords(parseSMILES(SULFONE_CAGE));
    const fixedCoords = new Map([['C11', { ...initial.coords.get('C11') }]]);
    const before = structuredClone(fixedCoords);
    const anchored = generateCoords(parseSMILES(SULFONE_CAGE), { fixedCoords, auditTelemetry: true });

    assertCleanCompleteCage(anchored);
    assert.deepEqual(fixedCoords, before);
    assert.deepEqual(anchored.layoutGraph.fixedCoords, before);
    assert.deepEqual(anchored.coords.get('C11'), before.get('C11'));
  });
});

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { bugMolecules } from '../../../../examples/bug-molecules.js';
import { parseSMILES } from '../../../../src/io/smiles.js';
import { generateCoords, refineCoords } from '../../../../src/layout/engine/api.js';

const BRIDGED_CARBAMATE = 'CCC1(O)C2CC(C#C)C(=O)C1NC(=O)OC2';
const METHYL_CONTROL = 'CC1(O)C2CC(C#C)C(=O)C1NC(=O)OC2';
const UNBRANCHED_CONTROL = 'C1(O)C2CC(C#C)C(=O)C1NC(=O)OC2';
const DEOXY_CONTROL = 'CCC1C2CC(C#C)C(=O)C1NC(=O)OC2';

/**
 * Asserts that a layout is complete and free of audit failures.
 * @param {object} result - Generated or refined layout result.
 * @returns {void}
 */
function assertCleanCompleteLayout(result) {
  const audit = result.metadata.audit;
  assert.equal(audit.ok, true);
  assert.equal(audit.severeOverlapCount, 0);
  assert.equal(audit.visibleHeavyBondCrossingFailureCount, 0);
  assert.equal(audit.bondLengthFailureCount, 0);
  assert.equal(audit.labelOverlapCount, 0);
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

describe('bridged carbamate branch clearance', () => {
  for (const bondLength of [0.75, 1.5, 3]) {
    for (const suppressH of [true, false]) {
      it(`keeps the ethyl and hydroxyl branches outside the cage at scale ${bondLength} with suppressH=${suppressH}`, () => {
        const molecule = parseSMILES(BRIDGED_CARBAMATE);
        const generated = generateCoords(molecule, { bondLength, suppressH, auditTelemetry: true });
        const generatedBefore = structuredClone(generated.coords);
        const refined = refineCoords(molecule, {
          bondLength,
          suppressH,
          existingCoords: generated.coords,
          auditTelemetry: true
        });

        assertCleanCompleteLayout(generated);
        assertCleanCompleteLayout(refined);
        assert.deepEqual(generated.coords, generatedBefore);
      });
    }
  }

  it('keeps nearby branch and heteroatom controls clean', () => {
    for (const smiles of [METHYL_CONTROL, UNBRANCHED_CONTROL, DEOXY_CONTROL]) {
      assertCleanCompleteLayout(generateCoords(parseSMILES(smiles), { auditTelemetry: true }));
    }
  });

  it('preserves a fixed cage anchor without mutating the constraint map', () => {
    const initial = generateCoords(parseSMILES(BRIDGED_CARBAMATE));
    const fixedCoords = new Map([['C12', { ...initial.coords.get('C12') }]]);
    const before = structuredClone(fixedCoords);
    const anchored = generateCoords(parseSMILES(BRIDGED_CARBAMATE), { fixedCoords, auditTelemetry: true });

    assertCleanCompleteLayout(anchored);
    assert.deepEqual(fixedCoords, before);
    assert.deepEqual(anchored.layoutGraph.fixedCoords, before);
    assert.deepEqual(anchored.coords.get('C12'), before.get('C12'));
  });

  it('is cataloged and deterministic across fresh parses', () => {
    assert.ok(bugMolecules.includes(BRIDGED_CARBAMATE));
    const first = generateCoords(parseSMILES(BRIDGED_CARBAMATE));
    const second = generateCoords(parseSMILES(BRIDGED_CARBAMATE));

    assertCleanCompleteLayout(first);
    assert.deepEqual(second.coords, first.coords);
  });
});

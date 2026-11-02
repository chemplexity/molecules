import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { bugMolecules } from '../../../../examples/bug-molecules.js';
import { parseSMILES } from '../../../../src/io/smiles.js';
import { generateCoords, refineCoords } from '../../../../src/layout/engine/api.js';

const DILACTONE_CAGE = 'C[C@H]1C2[C@@H](OC1=O)[C@H](O)[C@]13[C@@H]4OC(=O)[C@]21O[C@@H]1OC(=O)[C@H](O)[C@]31[C@@H]([C@H]4O)C(C)(C)C';
const METHYL_CONTROL = 'C[C@H]1C2[C@@H](OC1=O)[C@H](O)[C@]13[C@@H]4OC(=O)[C@]21O[C@@H]1OC(=O)[C@H](O)[C@]31[C@@H]([C@H]4O)C';

/**
 * Checks that a compact projected cage remains complete and audit-clean.
 * @param {object} result - Generated or refined layout result.
 * @returns {void}
 */
function assertCleanCage(result) {
  const audit = result.metadata.audit;
  assert.equal(audit.ok, true);
  assert.equal(audit.severeOverlapCount, 0);
  assert.equal(audit.bondLengthFailureCount, 0);
  assert.equal(audit.visibleHeavyBondCrossingFailureCount, 0);
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
    assert.ok(position && Number.isFinite(position.x) && Number.isFinite(position.y), atomId);
  }
}

describe('compact fused-cage overlap rescue', () => {
  for (const [name, smiles] of [
    ['dilactone cage', DILACTONE_CAGE],
    ['methyl control', METHYL_CONTROL]
  ]) {
    for (const bondLength of [0.75, 1.5, 3]) {
      it(`keeps the ${name} clean through refinement at scale ${bondLength}`, () => {
        const generated = generateCoords(parseSMILES(smiles), { bondLength, auditTelemetry: true });
        const refined = refineCoords(parseSMILES(smiles), {
          bondLength,
          existingCoords: generated.coords,
          auditTelemetry: true
        });

        assertCleanCage(generated);
        assertCleanCage(refined);
      });
    }
  }

  it('is cataloged and deterministic across fresh parses', () => {
    assert.ok(bugMolecules.includes(DILACTONE_CAGE));
    const first = generateCoords(parseSMILES(DILACTONE_CAGE));
    const second = generateCoords(parseSMILES(DILACTONE_CAGE));

    assertCleanCage(first);
    assert.deepEqual(second.coords, first.coords);
  });

  it('also repairs an unanchored cage when fixed preservation is disabled', () => {
    assertCleanCage(generateCoords(parseSMILES(DILACTONE_CAGE), { preserveFixed: false }));
  });

  it('preserves explicit cage anchors without mutating the constraint map', () => {
    const generated = generateCoords(parseSMILES(DILACTONE_CAGE));
    const fixedCoords = new Map([
      ['C13', { ...generated.coords.get('C13') }],
      ['C19', { ...generated.coords.get('C19') }]
    ]);
    const before = structuredClone(fixedCoords);
    const anchored = generateCoords(parseSMILES(DILACTONE_CAGE), { fixedCoords, auditTelemetry: true });

    assertCleanCage(anchored);
    assert.deepEqual(fixedCoords, before);
    assert.deepEqual(anchored.layoutGraph.fixedCoords, before);
    for (const [atomId, position] of before) {
      assert.deepEqual(anchored.coords.get(atomId), position);
    }
  });
});

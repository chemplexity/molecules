import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { bugMolecules } from '../../../../examples/bug-molecules.js';
import { parseSMILES } from '../../../../src/io/smiles.js';
import { generateCoords, refineCoords } from '../../../../src/layout/engine/api.js';

const HETEROCYCLIC_CAGE = 'C1OC2CC3(CNC4=CON=C34)C1O2';
const CARBOCYCLIC_CONTROL = 'C1OC2CC3(CNC4=CON=C34)C1C2';
const SATURATED_CONTROL = 'C1OC2CC3(CNCC3)C1O2';

/**
 * Checks that a compact bridged cage remains complete and audit-clean.
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

describe('compact bridged-cage bond retension', () => {
  for (const [name, smiles] of [
    ['heterocyclic cage', HETEROCYCLIC_CAGE],
    ['carbocyclic control', CARBOCYCLIC_CONTROL],
    ['saturated control', SATURATED_CONTROL]
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
    assert.ok(bugMolecules.includes(HETEROCYCLIC_CAGE));
    const first = generateCoords(parseSMILES(HETEROCYCLIC_CAGE));
    const second = generateCoords(parseSMILES(HETEROCYCLIC_CAGE));

    assertCleanCage(first);
    assert.deepEqual(second.coords, first.coords);
  });

  it('also repairs an unanchored cage when fixed preservation is disabled', () => {
    assertCleanCage(generateCoords(parseSMILES(HETEROCYCLIC_CAGE), { preserveFixed: false }));
  });

  it('preserves explicit cage anchors without mutating the constraint map', () => {
    const generated = generateCoords(parseSMILES(HETEROCYCLIC_CAGE));
    const fixedCoords = new Map([
      ['C1', { ...generated.coords.get('C1') }],
      ['O2', { ...generated.coords.get('O2') }]
    ]);
    const before = structuredClone(fixedCoords);
    const anchored = generateCoords(parseSMILES(HETEROCYCLIC_CAGE), { fixedCoords, auditTelemetry: true });

    assertCleanCage(anchored);
    assert.deepEqual(fixedCoords, before);
    assert.deepEqual(anchored.layoutGraph.fixedCoords, before);
    for (const [atomId, position] of before) {
      assert.deepEqual(anchored.coords.get(atomId), position);
    }
  });
});

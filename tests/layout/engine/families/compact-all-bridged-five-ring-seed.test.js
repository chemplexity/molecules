import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { bugMolecules } from '../../../../examples/bug-molecules.js';
import { parseSMILES } from '../../../../src/io/smiles.js';
import { generateCoords, refineCoords } from '../../../../src/layout/engine/api.js';

const SUBSTITUTED_CAGE = 'CCC1(O)CCC23CCCC12N1CCC3(C)C1';
const CONTROLS = ['C1(O)CCC23CCCC12N1CCC3(C)C1', 'CCC1CCC23CCCC12N1CCC3(C)C1', 'CC1(O)CCC23CCCC12N1CCC3(C)C1'];

function assertCleanCage(result) {
  const audit = result.metadata.audit;
  assert.equal(audit.ok, true);
  assert.equal(audit.severeOverlapCount, 0);
  assert.equal(audit.bondLengthFailureCount, 0);
  assert.equal(audit.visibleHeavyBondCrossingFailureCount, 0);
  assert.equal(audit.visibleHeavyBondCrossingCount, 2);
  assert.equal(audit.labelOverlapCount, 0);
  assert.equal(audit.ringSubstituentReadabilityFailureCount, 0);
  assert.equal(audit.missingCoordinateCount, 0);
  assert.equal(audit.nonfiniteCoordinateCount, 0);
  assert.equal(audit.stereoContradiction, false);
  assert.equal(audit.fallback.mode, null);
}

describe('compact all-bridged five-ring seed ordering', () => {
  for (const [name, smiles] of [['substituted cage', SUBSTITUTED_CAGE], ...CONTROLS.map((smiles, index) => [`control ${index + 1}`, smiles])]) {
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

  it('is cataloged and deterministic without mutating the input molecule', () => {
    assert.ok(bugMolecules.includes(SUBSTITUTED_CAGE));
    const molecule = parseSMILES(SUBSTITUTED_CAGE);
    const before = [...molecule.atoms].map(([id, atom]) => [id, atom.x, atom.y]);
    const first = generateCoords(molecule);
    const second = generateCoords(parseSMILES(SUBSTITUTED_CAGE));

    assertCleanCage(first);
    assert.deepEqual(second.coords, first.coords);
    assert.deepEqual(
      [...molecule.atoms].map(([id, atom]) => [id, atom.x, atom.y]),
      before
    );
  });

  it('also keeps the unanchored cage clean when fixed preservation is disabled', () => {
    assertCleanCage(generateCoords(parseSMILES(SUBSTITUTED_CAGE), { preserveFixed: false }));
  });

  it('preserves explicit cage anchors without mutating the constraint map', () => {
    const generated = generateCoords(parseSMILES(SUBSTITUTED_CAGE));
    const fixedCoords = new Map([
      ['C3', { ...generated.coords.get('C3') }],
      ['C11', { ...generated.coords.get('C11') }]
    ]);
    const before = structuredClone(fixedCoords);
    const anchored = generateCoords(parseSMILES(SUBSTITUTED_CAGE), { fixedCoords, auditTelemetry: true });

    assertCleanCage(anchored);
    assert.deepEqual(fixedCoords, before);
    assert.deepEqual(anchored.layoutGraph.fixedCoords, before);
    for (const [atomId, position] of before) {
      assert.deepEqual(anchored.coords.get(atomId), position);
    }
  });
});

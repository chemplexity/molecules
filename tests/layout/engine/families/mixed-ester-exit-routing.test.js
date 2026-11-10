import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { bugMolecules } from '../../../../examples/bug-molecules.js';
import { parseSMILES } from '../../../../src/io/smiles.js';
import { generateCoords, refineCoords } from '../../../../src/layout/engine/api.js';
import { assertFiniteHeavyCoordinates } from '../support/layout-assertions.js';

const BRIDGED_MACROLIDE = 'CCCCC\\C=C\\C=C/C(=O)O[C@H]1[C@H](O)[C@@H](C)[C@@](C)(CCC(=C)C=C)[C@@H]2C[C@@H](O)C=C3[C@@H](OC(=O)C)O[C@H](OC(=O)C)[C@@]123';
const DEACYLATED_CONTROL = 'O[C@H]1[C@H](O)[C@@H](C)[C@@](C)(CCC(=C)C=C)[C@@H]2C[C@@H](O)C=C3[C@@H](OC(=O)C)O[C@H](OC(=O)C)[C@@]123';
const ORDINARY_DIESTER_CONTROL = 'CC(=O)O[C@H]1CCCCC1OC(=O)C';

/**
 * Requires a complete, clean layout with every configured stereo target kept.
 * @param {object} result - Generated or refined layout result.
 * @param {number} expectedChiralCenters - Expected annotated center count.
 * @returns {void}
 */
function assertCleanStereoLayout(result, expectedChiralCenters) {
  assertFiniteHeavyCoordinates(result);
  const audit = result.metadata.audit;
  assert.equal(audit.ok, true);
  assert.equal(audit.severeOverlapCount, 0);
  assert.equal(audit.visibleHeavyBondCrossingFailureCount, 0);
  assert.equal(audit.bondLengthFailureCount, 0);
  assert.equal(audit.missingCoordinateCount, 0);
  assert.equal(audit.nonfiniteCoordinateCount, 0);
  assert.equal(audit.labelOverlapCount, 0);
  assert.equal(audit.ringSubstituentReadabilityFailureCount, 0);
  assert.equal(audit.stereoContradiction, false);
  assert.equal(result.metadata.stereo.ezViolationCount, 0);
  assert.equal(result.metadata.stereo.annotatedCenterCount, expectedChiralCenters);
  assert.equal(result.metadata.stereo.assignedCenterCount, expectedChiralCenters);
  assert.equal(result.metadata.stereo.unassignedCenterCount, 0);
}

describe('paired ester-exit routing around bridged macrolides', () => {
  for (const bondLength of [0.75, 1.5, 3]) {
    for (const suppressH of [true, false]) {
      it(`keeps both ester exits uncrossed through refinement at scale ${bondLength} with suppressH=${suppressH}`, () => {
        const molecule = parseSMILES(BRIDGED_MACROLIDE);
        const sourceBefore = [...molecule.atoms].map(([id, atom]) => [id, atom.x, atom.y, atom.chirality]);
        const generated = generateCoords(molecule, { bondLength, suppressH, auditTelemetry: true });
        assertCleanStereoLayout(generated, 9);

        const generatedBefore = structuredClone(generated.coords);
        const refined = refineCoords(parseSMILES(BRIDGED_MACROLIDE), {
          bondLength,
          suppressH,
          auditTelemetry: true,
          existingCoords: generated.coords
        });
        assertCleanStereoLayout(refined, 9);
        assert.deepEqual(generated.coords, generatedBefore);
        assert.deepEqual(
          [...molecule.atoms].map(([id, atom]) => [id, atom.x, atom.y, atom.chirality]),
          sourceBefore
        );
      });
    }
  }

  it('is deterministic across fresh parses', () => {
    assert.ok(bugMolecules.includes(BRIDGED_MACROLIDE));
    const first = generateCoords(parseSMILES(BRIDGED_MACROLIDE));
    const second = generateCoords(parseSMILES(BRIDGED_MACROLIDE));
    assertCleanStereoLayout(first, 9);
    assert.deepEqual(second.coords, first.coords);
  });

  it('preserves explicit core anchors and the constraint map', () => {
    const initial = generateCoords(parseSMILES(BRIDGED_MACROLIDE));
    const fixedCoords = new Map(['C13', 'C44'].map(atomId => [atomId, { ...initial.coords.get(atomId) }]));
    const before = structuredClone(fixedCoords);
    const result = generateCoords(parseSMILES(BRIDGED_MACROLIDE), { fixedCoords });

    assertCleanStereoLayout(result, 9);
    assert.deepEqual(fixedCoords, before);
    for (const [atomId, position] of fixedCoords) {
      assert.deepEqual(result.coords.get(atomId), position);
    }
  });

  it('leaves clean deacylated and ordinary diester controls clean across scales', () => {
    for (const smiles of [DEACYLATED_CONTROL, ORDINARY_DIESTER_CONTROL]) {
      for (const bondLength of [0.75, 1.5, 3]) {
        const generated = generateCoords(parseSMILES(smiles), { bondLength });
        const refined = refineCoords(parseSMILES(smiles), { bondLength, existingCoords: generated.coords });
        const expectedChiralCenters = smiles === DEACYLATED_CONTROL ? 9 : 1;
        assertCleanStereoLayout(generated, expectedChiralCenters);
        assertCleanStereoLayout(refined, expectedChiralCenters);
      }
    }
  });
});

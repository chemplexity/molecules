import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { bugMolecules } from '../../../../examples/bug-molecules.js';
import { parseSMILES } from '../../../../src/io/smiles.js';
import { generateCoords, refineCoords } from '../../../../src/layout/engine/api.js';
import { assertFiniteHeavyCoordinates } from '../support/layout-assertions.js';

{
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
    assertFiniteHeavyCoordinates(result);
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
}

{
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
    assertFiniteHeavyCoordinates(result);
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
}

{
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
    assertFiniteHeavyCoordinates(result);
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
}

{
  const SUBSTITUTED_AMINO_CAGE = 'CCC(O)C1C2C(N)CN1CC2C(C)N(C)C';
  const ISOLATED_AMINO_CAGE = 'C1C2C(N)CN1CC2C(C)N(C)C';

  /**
   * Requires complete, bond-clean projected geometry for an amino cage.
   * @param {object} result - Generated or refined layout result.
   * @param {number} expectedProjectedCrossings - Expected accepted raw crossing count.
   * @returns {void}
   */
  function assertCleanAminoCage(result, expectedProjectedCrossings) {
    const audit = result.metadata.audit;
    assert.equal(audit.ok, true);
    assert.equal(audit.severeOverlapCount, 0);
    assert.equal(audit.visibleHeavyBondCrossingCount, expectedProjectedCrossings);
    assert.equal(audit.visibleHeavyBondCrossingFailureCount, 0);
    assert.equal(audit.bondLengthFailureCount, 0);
    assert.equal(audit.labelOverlapCount, 0);
    assert.equal(audit.ringSubstituentReadabilityFailureCount, 0);
    assert.equal(audit.missingCoordinateCount, 0);
    assert.equal(audit.nonfiniteCoordinateCount, 0);
    assert.equal(audit.stereoContradiction, false);
    assert.equal(audit.fallback.mode, null);
    assertFiniteHeavyCoordinates(result);
  }

  describe('compact shared-path amino-cage projection', () => {
    for (const bondLength of [0.75, 1.5, 3]) {
      for (const suppressH of [true, false]) {
        it(`keeps substituted cage bonds sound through refinement at scale ${bondLength} with suppressH=${suppressH}`, () => {
          const molecule = parseSMILES(SUBSTITUTED_AMINO_CAGE);
          const sourceBefore = [...molecule.atoms].map(([atomId, atom]) => [atomId, atom.x, atom.y]);
          const generated = generateCoords(molecule, { bondLength, suppressH, auditTelemetry: true });
          const generatedBefore = structuredClone(generated.coords);
          const refined = refineCoords(parseSMILES(SUBSTITUTED_AMINO_CAGE), {
            bondLength,
            suppressH,
            existingCoords: generated.coords,
            auditTelemetry: true
          });

          assert.equal(generated.metadata.stageTelemetry.stageAudits.placement.bondLengthFailureCount, 0);
          assertCleanAminoCage(generated, 1);
          assertCleanAminoCage(refined, 1);
          assert.ok(refined.metadata.audit.bondLengthFailureCount <= generated.metadata.audit.bondLengthFailureCount);
          assert.ok(refined.metadata.audit.severeOverlapCount <= generated.metadata.audit.severeOverlapCount);
          assert.deepEqual(generated.coords, generatedBefore);
          assert.deepEqual(
            [...molecule.atoms].map(([atomId, atom]) => [atomId, atom.x, atom.y]),
            sourceBefore
          );
        });
      }
    }

    it('keeps the isolated amino-cage control clean across scales and hydrogen modes', () => {
      for (const bondLength of [0.75, 1.5, 3]) {
        for (const suppressH of [true, false]) {
          const generated = generateCoords(parseSMILES(ISOLATED_AMINO_CAGE), { bondLength, suppressH, auditTelemetry: true });
          const refined = refineCoords(parseSMILES(ISOLATED_AMINO_CAGE), {
            bondLength,
            suppressH,
            existingCoords: generated.coords,
            auditTelemetry: true
          });
          assertCleanAminoCage(generated, 0);
          assertCleanAminoCage(refined, 0);
        }
      }
    });

    it('is deterministic across fresh parses', () => {
      assert.ok(bugMolecules.includes(SUBSTITUTED_AMINO_CAGE));
      const first = generateCoords(parseSMILES(SUBSTITUTED_AMINO_CAGE), { auditTelemetry: true });
      const second = generateCoords(parseSMILES(SUBSTITUTED_AMINO_CAGE), { auditTelemetry: true });

      assertCleanAminoCage(first, 1);
      assert.deepEqual(second.coords, first.coords);
    });

    it('preserves an explicit cage anchor without mutating the constraint map', () => {
      const initial = generateCoords(parseSMILES(SUBSTITUTED_AMINO_CAGE));
      const fixedCoords = new Map([['C6', { ...initial.coords.get('C6') }]]);
      const before = structuredClone(fixedCoords);
      const anchored = generateCoords(parseSMILES(SUBSTITUTED_AMINO_CAGE), { fixedCoords, auditTelemetry: true });

      assertCleanAminoCage(anchored, 1);
      assert.deepEqual(fixedCoords, before);
      assert.deepEqual(anchored.layoutGraph.fixedCoords, before);
      assert.deepEqual(anchored.coords.get('C6'), before.get('C6'));
    });
  });
}

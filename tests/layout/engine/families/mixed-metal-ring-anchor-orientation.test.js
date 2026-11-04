import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseSMILES } from '../../../../src/io/smiles.js';
import { generateCoords, refineCoords } from '../../../../src/layout/engine/api.js';

const COBALT_MACROCYCLE = String.raw`OC[C@H]1O[C@@H]([C@H](O)[C@@H]1OP(O)(=O)O[C@]([H])(C)CNC(=O)CC[C@]1(C)[C@@H](CC(=O)N)[C@@]2([H])N([Co]C#N)\C1=C(C)/C1=N/C(=C\C3=N\C(=C(C)/C4=N[C@]2(C)[C@@](C)(CC(=O)N)[C@@H]4CCC(=O)N)\[C@@](C)(CC(=O)N)[C@@H]3CCC(=O)N)/C(C)(C)[C@@H]1CCC(=O)N)N1C=NC2=CC(C)=C(C)C=C12`;
const COBALT_MACROCYCLE_WITHOUT_CYANIDE = COBALT_MACROCYCLE.replace('[Co]C#N', '[Co]');
const COBALT_MACROCYCLE_WITH_METHYL = COBALT_MACROCYCLE.replace('[Co]C#N', '[Co]C');

/**
 * Verifies the public geometry contract for the cobalt macrocycle.
 * @param {object} molecule - Parsed source molecule.
 * @param {object} result - Layout result.
 * @returns {void}
 */
function assertCleanCompleteCobaltLayout(molecule, result) {
  assert.equal(result.metadata.audit.ok, true);
  assert.equal(result.metadata.audit.severeOverlapCount, 0);
  assert.equal(result.metadata.audit.visibleHeavyBondCrossingCount, 0);
  assert.equal(result.metadata.audit.visibleHeavyBondCrossingFailureCount, 0);
  assert.equal(result.metadata.audit.bondLengthFailureCount, 0);
  assert.equal(result.metadata.audit.labelOverlapCount, 0);
  assert.equal(result.metadata.audit.ringSubstituentReadabilityFailureCount, 0);
  assert.equal(result.metadata.audit.stereoContradiction, false);
  assert.equal(result.metadata.audit.missingCoordinateCount, 0);
  assert.equal(result.metadata.audit.nonfiniteCoordinateCount, 0);
  assert.equal(result.metadata.stereo.ezViolationCount, 0);
  assert.equal(result.metadata.stereo.annotatedCenterCount, 14);
  assert.equal(result.metadata.stereo.assignedCenterCount, 14);

  for (const atom of molecule.atoms.values()) {
    if (atom.name === 'H') {
      continue;
    }
    const position = result.coords.get(atom.id);
    assert.ok(position, `expected coordinates for heavy atom ${atom.id}`);
    assert.equal(Number.isFinite(position.x), true);
    assert.equal(Number.isFinite(position.y), true);
  }
}

describe('mixed metal ring-anchor orientation', () => {
  for (const bondLength of [0.75, 1.5, 3]) {
    for (const suppressH of [true, false]) {
      it(`keeps the cobalt macrocycle clean through refinement at ${bondLength} with suppressH=${suppressH}`, () => {
        const generatedMolecule = parseSMILES(COBALT_MACROCYCLE);
        const generated = generateCoords(generatedMolecule, { bondLength, suppressH, auditTelemetry: true });
        assertCleanCompleteCobaltLayout(generatedMolecule, generated);

        const existingCoordsBefore = structuredClone(generated.coords);
        const refinedMolecule = parseSMILES(COBALT_MACROCYCLE);
        const refined = refineCoords(refinedMolecule, {
          bondLength,
          suppressH,
          existingCoords: generated.coords,
          auditTelemetry: true
        });
        assertCleanCompleteCobaltLayout(refinedMolecule, refined);
        assert.deepEqual(generated.coords, existingCoordsBefore);
      });
    }
  }

  for (const smiles of [COBALT_MACROCYCLE_WITHOUT_CYANIDE, COBALT_MACROCYCLE_WITH_METHYL]) {
    it(`retains the clean nearby cobalt control ${smiles.includes('C#N') ? 'with cyanide' : smiles.includes('[Co]C') ? 'with methyl' : 'without an axial ligand'}`, () => {
      for (const bondLength of [0.75, 1.5, 3]) {
        const molecule = parseSMILES(smiles);
        const generated = generateCoords(molecule, { bondLength, auditTelemetry: true });
        assertCleanCompleteCobaltLayout(molecule, generated);
        const refined = refineCoords(parseSMILES(smiles), {
          bondLength,
          existingCoords: generated.coords,
          auditTelemetry: true
        });
        assertCleanCompleteCobaltLayout(molecule, refined);
      }
    });
  }

  it('is deterministic across fresh cobalt-macrocycle parses', () => {
    const first = generateCoords(parseSMILES(COBALT_MACROCYCLE));
    const second = generateCoords(parseSMILES(COBALT_MACROCYCLE));
    assert.deepEqual(second.coords, first.coords);
    assert.deepEqual(second.metadata.audit, first.metadata.audit);
  });
});

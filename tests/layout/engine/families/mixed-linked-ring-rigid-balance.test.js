import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { bugMolecules } from '../../../../examples/bug-molecules.js';
import { parseSMILES } from '../../../../src/io/smiles.js';
import { generateCoords, refineCoords } from '../../../../src/layout/engine/index.js';

const FUSED_IMIDE = 'CC(=C1[C@H]2C(=C(C1=O)c3ccccc3)CN4C(=O)N(CCc5ccccc5)C(=O)[C@]24Cc6ccc(cc6)C(F)(F)F)C';
const N_METHYL_FUSED_IMIDE = 'CC(=C1[C@H]2C(=C(C1=O)c3ccccc3)CN4C(=O)N(C)C(=O)[C@]24Cc5ccc(cc5)C(F)(F)F)C';
const SATURATED_CONTROL = 'CC1[C@H]2C(=C(C1=O)c3ccccc3)CN4C(=O)N(C)C(=O)[C@]24Cc5ccc(cc5)C(F)(F)F';
const TRIMMED_CONTROL = 'CC(=C1[C@H]2C(=C(C1=O)c3ccccc3)CN4C(=O)N(C)C(=O)[C@]24C)C';
const CASES = [FUSED_IMIDE, N_METHYL_FUSED_IMIDE, SATURATED_CONTROL, TRIMMED_CONTROL];
const HETEROARYL_BRIDGED_DIAMINE = 'CC1CCN2CCNC1C2C1=CN(C)C(C)=N1';
const ISOLATED_DIAMINE_CAGE = 'CC1CCN2CCNC1C2';
const ISOLATED_HETEROARYL_RING = 'C1=CN(C)C(C)=N1';
const ISOXAZOLE_BRIDGED_AMMONIUM = 'CC(C1=CN=NO1)C1(O)C2CC1(C)C[NH2+]2';
const ISOLATED_AMMONIUM_CAGE = 'C1(O)C2CC1(C)C[NH2+]2';
const ISOLATED_ISOXAZOLE_BRANCH = 'CC(C1=CN=NO1)C';
const DEHETERO_AMMONIUM_CONTROL = 'CC(C)C1(O)C2CC1(C)C[NH2+]2';

function assertCleanCompleteLayout(molecule, result) {
  assert.equal(result.metadata.audit.ok, true);
  assert.equal(result.metadata.audit.severeOverlapCount, 0);
  assert.equal(result.metadata.audit.visibleHeavyBondCrossingFailureCount, 0);
  assert.equal(result.metadata.audit.bondLengthFailureCount, 0);
  assert.equal(result.metadata.audit.ringSubstituentReadabilityFailureCount, 0);
  assert.equal(result.metadata.audit.stereoContradiction, false);
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

function assertBondLength(result, firstAtomId, secondAtomId, expectedLength) {
  const firstPosition = result.coords.get(firstAtomId);
  const secondPosition = result.coords.get(secondAtomId);
  assert.ok(firstPosition);
  assert.ok(secondPosition);
  assert.ok(Math.abs(Math.hypot(secondPosition.x - firstPosition.x, secondPosition.y - firstPosition.y) - expectedLength) < 1e-8);
}

describe('mixed linked-ring rigid placed-block balancing', () => {
  for (const smiles of CASES) {
    for (const bondLength of [0.75, 1.5, 3]) {
      it(`keeps ${smiles} sound at bond length ${bondLength} before and after refinement`, () => {
        const molecule = parseSMILES(smiles);
        const generated = generateCoords(molecule, { bondLength });
        const generatedCoordsBefore = structuredClone(generated.coords);
        assertCleanCompleteLayout(molecule, generated);

        const refined = refineCoords(molecule, {
          existingCoords: generated.coords,
          touchedAtoms: new Set(molecule.atoms.keys()),
          bondLength
        });
        assertCleanCompleteLayout(molecule, refined);
        assert.deepEqual(generated.coords, generatedCoordsBefore);

        if (smiles === FUSED_IMIDE) {
          assertBondLength(generated, 'C7', 'C10', bondLength);
          assertBondLength(generated, 'N20', 'C21', bondLength);
          assertBondLength(refined, 'C7', 'C10', bondLength);
          assertBondLength(refined, 'N20', 'C21', bondLength);
        }
      });
    }
  }

  it('preserves explicit fused-core anchors and does not mutate their input map', () => {
    const initial = generateCoords(parseSMILES(FUSED_IMIDE));
    const fixedCoords = new Map(['C7', 'N20'].map(atomId => [atomId, { ...initial.coords.get(atomId) }]));
    const fixedCoordsBefore = structuredClone(fixedCoords);
    const molecule = parseSMILES(FUSED_IMIDE);
    const result = generateCoords(molecule, { fixedCoords });

    assertCleanCompleteLayout(molecule, result);
    assert.deepEqual(fixedCoords, fixedCoordsBefore);
    for (const [atomId, position] of fixedCoords) {
      assert.deepEqual(result.coords.get(atomId), position);
    }
  });

  it('is deterministic for the substituted fused imide cage', () => {
    const first = generateCoords(parseSMILES(FUSED_IMIDE));
    const second = generateCoords(parseSMILES(FUSED_IMIDE));
    assert.deepEqual(first.coords, second.coords);
  });
});

describe('mixed two-ring bridged bond rescue', () => {
  for (const bondLength of [0.75, 1.5, 3]) {
    for (const suppressH of [true, false]) {
      it(`keeps the linked bridged cage sound through refinement at scale ${bondLength} with suppressH=${suppressH}`, () => {
        const molecule = parseSMILES(HETEROARYL_BRIDGED_DIAMINE);
        const moleculeBefore = [...molecule.atoms].map(([atomId, atom]) => [atomId, atom.x, atom.y]);
        const generated = generateCoords(molecule, { bondLength, suppressH, auditTelemetry: true });
        const generatedBefore = structuredClone(generated.coords);
        const refinedMolecule = parseSMILES(HETEROARYL_BRIDGED_DIAMINE);
        const refined = refineCoords(refinedMolecule, {
          bondLength,
          suppressH,
          existingCoords: generated.coords,
          auditTelemetry: true
        });

        assert.equal(generated.metadata.stageTelemetry.stageAudits.placement.bondLengthFailureCount, 0);
        assertCleanCompleteLayout(molecule, generated);
        assertCleanCompleteLayout(refinedMolecule, refined);
        assert.equal(generated.metadata.audit.visibleHeavyBondCrossingCount, 1);
        assert.equal(refined.metadata.audit.visibleHeavyBondCrossingCount, 1);
        assert.equal(generated.metadata.audit.fallback.mode, null);
        assert.equal(refined.metadata.audit.fallback.mode, null);
        assert.deepEqual(generated.coords, generatedBefore);
        assert.deepEqual(
          [...molecule.atoms].map(([atomId, atom]) => [atomId, atom.x, atom.y]),
          moleculeBefore
        );
      });
    }
  }

  it('keeps the isolated cage and heteroaryl controls clean across scales and hydrogen modes', () => {
    for (const smiles of [ISOLATED_DIAMINE_CAGE, ISOLATED_HETEROARYL_RING]) {
      for (const bondLength of [0.75, 1.5, 3]) {
        for (const suppressH of [true, false]) {
          const generatedMolecule = parseSMILES(smiles);
          const generated = generateCoords(generatedMolecule, { bondLength, suppressH, auditTelemetry: true });
          const refinedMolecule = parseSMILES(smiles);
          const refined = refineCoords(refinedMolecule, {
            bondLength,
            suppressH,
            existingCoords: generated.coords,
            auditTelemetry: true
          });

          assertCleanCompleteLayout(generatedMolecule, generated);
          assertCleanCompleteLayout(refinedMolecule, refined);
        }
      }
    }
  });

  it('is cataloged once and deterministic across fresh parses', () => {
    assert.equal(bugMolecules.filter(smiles => smiles === HETEROARYL_BRIDGED_DIAMINE).length, 1);
    const first = generateCoords(parseSMILES(HETEROARYL_BRIDGED_DIAMINE), { auditTelemetry: true });
    const second = generateCoords(parseSMILES(HETEROARYL_BRIDGED_DIAMINE), { auditTelemetry: true });

    assertCleanCompleteLayout(first.molecule, first);
    assert.deepEqual(second.coords, first.coords);
  });

  it('preserves an explicit cage anchor without mutating the constraint map', () => {
    const initial = generateCoords(parseSMILES(HETEROARYL_BRIDGED_DIAMINE));
    const fixedCoords = new Map([['C2', { ...initial.coords.get('C2') }]]);
    const before = structuredClone(fixedCoords);
    const molecule = parseSMILES(HETEROARYL_BRIDGED_DIAMINE);
    const anchored = generateCoords(molecule, { fixedCoords, auditTelemetry: true });

    assertCleanCompleteLayout(molecule, anchored);
    assert.deepEqual(fixedCoords, before);
    assert.deepEqual(anchored.layoutGraph.fixedCoords, before);
    assert.deepEqual(anchored.coords.get('C2'), before.get('C2'));
  });
});

describe('pending linked-ring resnap bond integrity', () => {
  for (const bondLength of [0.75, 1.5, 3]) {
    for (const suppressH of [true, false]) {
      it(`keeps the isoxazole-linked ammonium cage sound through refinement at scale ${bondLength} with suppressH=${suppressH}`, () => {
        const generatedMolecule = parseSMILES(ISOXAZOLE_BRIDGED_AMMONIUM);
        const generated = generateCoords(generatedMolecule, { bondLength, suppressH, auditTelemetry: true });
        const generatedBefore = structuredClone(generated.coords);
        const refinedMolecule = parseSMILES(ISOXAZOLE_BRIDGED_AMMONIUM);
        const refined = refineCoords(refinedMolecule, {
          bondLength,
          suppressH,
          existingCoords: generated.coords,
          auditTelemetry: true
        });

        assert.equal(generated.metadata.stageTelemetry.stageAudits.placement.bondLengthFailureCount, 0);
        assertCleanCompleteLayout(generatedMolecule, generated);
        assertCleanCompleteLayout(refinedMolecule, refined);
        assert.equal(generated.metadata.audit.fallback.mode, null);
        assert.equal(refined.metadata.audit.fallback.mode, null);
        assert.deepEqual(generated.coords, generatedBefore);
      });
    }
  }

  it('keeps the isolated and dehetero controls clean across scales and hydrogen modes', () => {
    for (const smiles of [ISOLATED_AMMONIUM_CAGE, ISOLATED_ISOXAZOLE_BRANCH, DEHETERO_AMMONIUM_CONTROL]) {
      for (const bondLength of [0.75, 1.5, 3]) {
        for (const suppressH of [true, false]) {
          const generatedMolecule = parseSMILES(smiles);
          const generated = generateCoords(generatedMolecule, { bondLength, suppressH, auditTelemetry: true });
          const refinedMolecule = parseSMILES(smiles);
          const refined = refineCoords(refinedMolecule, {
            bondLength,
            suppressH,
            existingCoords: generated.coords,
            auditTelemetry: true
          });

          assertCleanCompleteLayout(generatedMolecule, generated);
          assertCleanCompleteLayout(refinedMolecule, refined);
        }
      }
    }
  });

  it('is cataloged once and deterministic across fresh parses', () => {
    assert.equal(bugMolecules.filter(smiles => smiles === ISOXAZOLE_BRIDGED_AMMONIUM).length, 1);
    const first = generateCoords(parseSMILES(ISOXAZOLE_BRIDGED_AMMONIUM), { auditTelemetry: true });
    const second = generateCoords(parseSMILES(ISOXAZOLE_BRIDGED_AMMONIUM), { auditTelemetry: true });

    assertCleanCompleteLayout(first.molecule, first);
    assert.deepEqual(second.coords, first.coords);
  });

  it('preserves an explicit cage anchor without mutating the constraint map', () => {
    const initial = generateCoords(parseSMILES(ISOXAZOLE_BRIDGED_AMMONIUM));
    const fixedCoords = new Map([['C8', { ...initial.coords.get('C8') }]]);
    const before = structuredClone(fixedCoords);
    const molecule = parseSMILES(ISOXAZOLE_BRIDGED_AMMONIUM);
    const anchored = generateCoords(molecule, { fixedCoords, auditTelemetry: true });

    assertCleanCompleteLayout(molecule, anchored);
    assert.deepEqual(fixedCoords, before);
    assert.deepEqual(anchored.layoutGraph.fixedCoords, before);
    assert.deepEqual(anchored.coords.get('C8'), before.get('C8'));
  });
});

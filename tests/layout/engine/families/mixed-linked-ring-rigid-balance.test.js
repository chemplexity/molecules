import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseSMILES } from '../../../../src/io/smiles.js';
import { generateCoords, refineCoords } from '../../../../src/layout/engine/index.js';

const FUSED_IMIDE = 'CC(=C1[C@H]2C(=C(C1=O)c3ccccc3)CN4C(=O)N(CCc5ccccc5)C(=O)[C@]24Cc6ccc(cc6)C(F)(F)F)C';
const N_METHYL_FUSED_IMIDE = 'CC(=C1[C@H]2C(=C(C1=O)c3ccccc3)CN4C(=O)N(C)C(=O)[C@]24Cc5ccc(cc5)C(F)(F)F)C';
const SATURATED_CONTROL = 'CC1[C@H]2C(=C(C1=O)c3ccccc3)CN4C(=O)N(C)C(=O)[C@]24Cc5ccc(cc5)C(F)(F)F';
const TRIMMED_CONTROL = 'CC(=C1[C@H]2C(=C(C1=O)c3ccccc3)CN4C(=O)N(C)C(=O)[C@]24C)C';
const CASES = [FUSED_IMIDE, N_METHYL_FUSED_IMIDE, SATURATED_CONTROL, TRIMMED_CONTROL];

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

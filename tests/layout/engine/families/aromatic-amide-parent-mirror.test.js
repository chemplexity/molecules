import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseSMILES } from '../../../../src/io/smiles.js';
import { generateCoords, refineCoords } from '../../../../src/layout/engine/index.js';

const ORTHO_AROMATIC_AMIDE = 'COc1ccc(OC)c(CN(C(=O)CF)c2ccccc2OC(C)C)c1';
const CASES = [ORTHO_AROMATIC_AMIDE, 'COc1ccc(OC)c(CN(C(=O)CF)c2ccccc2)c1', 'COc1ccc(OC)c(CN(C(=O)CF)C)c1'];

function assertCompleteCleanLayout(molecule, result) {
  assert.equal(result.metadata.audit.ok, true);
  assert.equal(result.metadata.audit.ringSubstituentReadabilityFailureCount, 0);
  assert.equal(result.metadata.audit.outwardAxisRingSubstituentFailureCount, 0);
  assert.equal(result.metadata.audit.severeOverlapCount, 0);
  assert.equal(result.metadata.audit.visibleHeavyBondCrossingFailureCount, 0);
  assert.equal(result.metadata.audit.bondLengthFailureCount, 0);
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

describe('ortho aromatic amide parent-side mirrors', () => {
  for (const smiles of CASES) {
    for (const bondLength of [0.75, 1.5, 3]) {
      it(`keeps ${smiles} readable at bond length ${bondLength} before and after refinement`, () => {
        const molecule = parseSMILES(smiles);
        const generated = generateCoords(molecule, { bondLength });
        const existingCoordsBefore = structuredClone(generated.coords);
        assertCompleteCleanLayout(molecule, generated);

        const refined = refineCoords(molecule, {
          existingCoords: generated.coords,
          touchedAtoms: new Set(molecule.atoms.keys()),
          bondLength
        });
        assertCompleteCleanLayout(molecule, refined);
        assert.deepEqual(generated.coords, existingCoordsBefore);
      });
    }
  }

  it('preserves explicit benzyl-ring anchors without mutating their input map', () => {
    const initial = generateCoords(parseSMILES(ORTHO_AROMATIC_AMIDE));
    const fixedCoords = new Map(['C4', 'C5'].map(atomId => [atomId, { ...initial.coords.get(atomId) }]));
    const fixedCoordsBefore = structuredClone(fixedCoords);
    const molecule = parseSMILES(ORTHO_AROMATIC_AMIDE);
    const result = generateCoords(molecule, { fixedCoords });

    assertCompleteCleanLayout(molecule, result);
    assert.deepEqual(fixedCoords, fixedCoordsBefore);
    for (const [atomId, position] of fixedCoords) {
      assert.deepEqual(result.coords.get(atomId), position);
    }
  });

  it('is deterministic for the ortho-substituted aromatic amide', () => {
    const first = generateCoords(parseSMILES(ORTHO_AROMATIC_AMIDE));
    const second = generateCoords(parseSMILES(ORTHO_AROMATIC_AMIDE));
    assert.deepEqual(first.coords, second.coords);
  });
});

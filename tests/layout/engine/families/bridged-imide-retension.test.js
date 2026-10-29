import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseSMILES } from '../../../../src/io/smiles.js';
import { generateCoords, refineCoords } from '../../../../src/layout/engine/index.js';

const ATTACHED_BRIDGED_IMIDE = 'Cl.FC(F)(F)c1ccc(nc1)N2CCN(CCCCN3C(=O)C4C5CCCC(CC5)C4C3=O)CC2';
const BRIDGED_IMIDE_CASES = [ATTACHED_BRIDGED_IMIDE, 'FC(F)(F)c1ccc(nc1)N2CCN(CCCCN3C(=O)C4C5CCCC(CC5)C4C3=O)CC2', 'N1C(=O)C2C3CCCC(CC3)C2C1=O', 'N1C(=O)C2C3CCCC(C3)C2C1=O', 'N1C(=O)CCC1=O'];

function assertCompleteCleanLayout(molecule, result) {
  assert.equal(result.metadata.audit.ok, true);
  assert.equal(result.metadata.audit.bondLengthFailureCount, 0);
  assert.equal(result.metadata.audit.severeOverlapCount, 0);
  assert.equal(result.metadata.audit.visibleHeavyBondCrossingFailureCount, 0);
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

describe('compact bridged imide retension', () => {
  for (const smiles of BRIDGED_IMIDE_CASES) {
    for (const bondLength of [0.75, 1.5, 3]) {
      it(`keeps ${smiles} clean at bond length ${bondLength} before and after refinement`, () => {
        const molecule = parseSMILES(smiles);
        const generated = generateCoords(molecule, { bondLength });
        assertCompleteCleanLayout(molecule, generated);

        const refined = refineCoords(molecule, {
          existingCoords: generated.coords,
          touchedAtoms: new Set(molecule.atoms.keys()),
          bondLength
        });
        assertCompleteCleanLayout(molecule, refined);
      });
    }
  }

  it('preserves explicit cage anchors and does not mutate the fixed-coordinate map', () => {
    const smiles = 'N1C(=O)C2C3CCCC(CC3)C2C1=O';
    const initial = generateCoords(parseSMILES(smiles));
    const fixedCoords = new Map(['C10', 'C11'].map(atomId => [atomId, { ...initial.coords.get(atomId) }]));
    const before = structuredClone(fixedCoords);
    const molecule = parseSMILES(smiles);
    const result = generateCoords(molecule, { fixedCoords });

    assertCompleteCleanLayout(molecule, result);
    assert.deepEqual(fixedCoords, before);
    for (const [atomId, position] of fixedCoords) {
      assert.deepEqual(result.coords.get(atomId), position);
    }
  });

  it('is deterministic for the attached bridged imide', () => {
    const first = generateCoords(parseSMILES(ATTACHED_BRIDGED_IMIDE));
    const second = generateCoords(parseSMILES(ATTACHED_BRIDGED_IMIDE));
    assert.deepEqual(first.coords, second.coords);
  });
});

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseSMILES } from '../../../src/io/index.js';
import { generateCoords, refineCoords } from '../../../src/layout/engine/api.js';

const MACROCYCLE_MULTI_BRANCH_FIXTURES = [
  '[H][C@]12N=C(O)O[C@]1(C)[C@@]([H])(CC)OC(=O)[C@]([H])(C)C(=O)[C@]([H])(C)[C@@]([H])(O[C@]1([H])O[C@]([H])(C)C[C@]([H])(N(C)C)[C@@]1([H])O)[C@@](C)(C[C@@]([H])(C)C(=O)[C@]2([H])C)OCC=CC1=CC2=CC=CC=C2N=C1',
  '[H][C@@]12CCCCN1C(=O)C(=O)C(C)(C)COC(=O)CCCCCCCCCCCOC2=O',
  '[H][C@]12N(CCCCN3C=C(N=N3)C3=CC(N)=CC=C3)C(=O)O[C@]1(C)[C@@]([H])(CC)OC(=O)[C@@](C)(F)C(=O)[C@]([H])(C)[C@@]([H])(O[C@]1([H])O[C@]([H])(C)C[C@]([H])(N(C)C)[C@@]1([H])O)[C@@](C)(C[C@@]([H])(C)C(=O)[C@]2([H])C)OC'
];

const RING_OPENED_CONTROL = 'C1CCCCN1C(=O)C(=O)C(C)(C)COC(=O)CCCCCCCCCCCOCC=O';

/**
 * Verifies the layout contract for macrocycle branch-coverage fixtures.
 * @param {object} result - Layout API result.
 * @returns {void}
 */
function assertCompleteCleanLayout(result) {
  const audit = result.metadata.audit;
  assert.equal(audit.ok, true);
  assert.equal(audit.missingCoordinateCount, 0);
  assert.equal(audit.nonfiniteCoordinateCount, 0);
  assert.equal(audit.severeOverlapCount, 0);
  assert.equal(audit.bondLengthFailureCount, 0);
  assert.equal(audit.visibleHeavyBondCrossingFailureCount, 0);
  assert.equal(audit.stereoContradiction, false);
  for (const [atomId, atom] of result.layoutGraph.atoms) {
    if (atom.element === 'H') {
      continue;
    }
    const position = result.coords.get(atomId);
    assert.ok(Number.isFinite(position?.x) && Number.isFinite(position?.y), `missing heavy-atom coordinate for ${atomId}`);
  }
  for (const component of result.metadata.componentPlacements) {
    assert.equal(component.supported, true);
    assert.equal(component.placed, true);
  }
}

describe('macrocycle multi-branch coordinate coverage', () => {
  for (const [fixtureIndex, smiles] of MACROCYCLE_MULTI_BRANCH_FIXTURES.entries()) {
    for (const bondLength of [0.75, 1.5, 3]) {
      for (const suppressH of [true, false]) {
        it(`keeps fixture ${fixtureIndex + 1} complete through refinement at ${bondLength} with suppressH=${suppressH}`, () => {
          const options = { bondLength, suppressH, auditTelemetry: true };
          const generated = generateCoords(parseSMILES(smiles), options);
          const repeated = generateCoords(parseSMILES(smiles), options);
          assertCompleteCleanLayout(generated);
          assertCompleteCleanLayout(repeated);
          assert.deepEqual(repeated.coords, generated.coords);

          const existingCoords = structuredClone(generated.coords);
          const refined = refineCoords(parseSMILES(smiles), { ...options, existingCoords: generated.coords });
          assert.deepEqual(generated.coords, existingCoords);
          assertCompleteCleanLayout(refined);
        });
      }
    }
  }

  for (const bondLength of [0.75, 1.5, 3]) {
    for (const suppressH of [true, false]) {
      it(`keeps the ring-opened control clean at ${bondLength} with suppressH=${suppressH}`, () => {
        const options = { bondLength, suppressH, auditTelemetry: true };
        const generated = generateCoords(parseSMILES(RING_OPENED_CONTROL), options);
        assertCompleteCleanLayout(generated);

        const existingCoords = structuredClone(generated.coords);
        const refined = refineCoords(parseSMILES(RING_OPENED_CONTROL), { ...options, existingCoords: generated.coords });
        assert.deepEqual(generated.coords, existingCoords);
        assertCompleteCleanLayout(refined);
      });
    }
  }

  it('preserves explicit heavy-atom anchors while filling every macrocycle branch', () => {
    const smiles = MACROCYCLE_MULTI_BRANCH_FIXTURES[1];
    const baseline = generateCoords(parseSMILES(smiles), { suppressH: true });
    const heavyAtomIds = [...baseline.layoutGraph.atoms.values()].filter(atom => atom.element !== 'H').map(atom => atom.id);
    const fixedCoords = new Map([heavyAtomIds[0], heavyAtomIds[Math.floor(heavyAtomIds.length / 2)], heavyAtomIds.at(-1)].map(atomId => [atomId, { ...baseline.coords.get(atomId) }]));
    const fixedBefore = structuredClone(fixedCoords);
    const anchored = generateCoords(parseSMILES(smiles), { suppressH: true, fixedCoords, auditTelemetry: true });

    assert.deepEqual(fixedCoords, fixedBefore);
    assertCompleteCleanLayout(anchored);
    for (const [atomId, position] of fixedCoords) {
      const anchoredPosition = anchored.coords.get(atomId);
      assert.ok(Math.abs(anchoredPosition.x - position.x) < 1e-9);
      assert.ok(Math.abs(anchoredPosition.y - position.y) < 1e-9);
    }
  });
});

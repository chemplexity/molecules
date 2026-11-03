import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseSMILES } from '../../../../src/io/smiles.js';
import { generateCoords, refineCoords } from '../../../../src/layout/engine/api.js';
import { actualAlkeneStereo } from '../../../../src/layout/engine/stereo/ez.js';

const UNSATURATED_ACIDS = [String.raw`CCCCCCCC/C=C\CCCCCCCC(=O)O`, String.raw`CCCCC/C=C\C/C=C\CCCCCCCC(=O)O`];
const SATURATED_CONTROLS = ['CCCCCCCCCCCCCCCCCC(=O)O', 'CCCCCCCCCCCCCCCC(=O)O'];

function assertCleanCompleteLayout(result) {
  const audit = result.metadata.audit;
  assert.equal(audit.ok, true);
  assert.equal(audit.severeOverlapCount, 0);
  assert.equal(audit.bondLengthFailureCount, 0);
  assert.equal(audit.visibleHeavyBondCrossingFailureCount, 0);
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

function assertConfiguredAlkeneStereo(result) {
  let configuredBondCount = 0;
  for (const bond of result.layoutGraph.bonds.values()) {
    if ((bond.order ?? 1) !== 2) {
      continue;
    }
    const configured = result.layoutGraph.sourceMolecule.getEZStereo?.(bond.id);
    if (!configured) {
      continue;
    }
    configuredBondCount++;
    assert.equal(actualAlkeneStereo(result.layoutGraph, result.coords, bond), configured);
  }
  assert.ok(configuredBondCount > 0);
}

describe('acyclic refinement rigid alignment', () => {
  for (const smiles of UNSATURATED_ACIDS) {
    for (const bondLength of [0.75, 1.5, 3]) {
      it(`keeps unsaturated-acid bonds clean through repeated refinement at scale ${bondLength}: ${smiles}`, () => {
        const generated = generateCoords(parseSMILES(smiles), { bondLength, auditTelemetry: true });
        const existingCoords = structuredClone(generated.coords);
        const before = structuredClone(existingCoords);
        const first = refineCoords(parseSMILES(smiles), { bondLength, existingCoords, auditTelemetry: true });
        const repeated = refineCoords(parseSMILES(smiles), { bondLength, existingCoords: first.coords, auditTelemetry: true });
        const deterministic = refineCoords(parseSMILES(smiles), { bondLength, existingCoords, auditTelemetry: true });

        assertCleanCompleteLayout(generated);
        assertCleanCompleteLayout(first);
        assertCleanCompleteLayout(repeated);
        assertConfiguredAlkeneStereo(first);
        assertConfiguredAlkeneStereo(repeated);
        assert.deepEqual(deterministic.coords, first.coords);
        assert.deepEqual(existingCoords, before);
        assert.equal(first.metadata.preservedComponentCount, 0);
      });
    }
  }

  it('keeps saturated long-chain controls clean at each scale', () => {
    for (const smiles of SATURATED_CONTROLS) {
      for (const bondLength of [0.75, 1.5, 3]) {
        const generated = generateCoords(parseSMILES(smiles), { bondLength });
        assertCleanCompleteLayout(refineCoords(parseSMILES(smiles), { bondLength, existingCoords: generated.coords }));
      }
    }
  });

  it('keeps explicit-hydrogen layouts clean through refinement', () => {
    for (const smiles of UNSATURATED_ACIDS) {
      const generated = generateCoords(parseSMILES(smiles), { suppressH: false });
      const refined = refineCoords(parseSMILES(smiles), { suppressH: false, existingCoords: generated.coords });
      assertCleanCompleteLayout(refined);
      assertConfiguredAlkeneStereo(refined);
    }
  });

  it('preserves adjacent explicit anchors while rigidly aligning existing-coordinate hints', () => {
    const smiles = UNSATURATED_ACIDS[0];
    const generated = generateCoords(parseSMILES(smiles));
    const fixedCoords = new Map([
      ['C1', { ...generated.coords.get('C1') }],
      ['C2', { ...generated.coords.get('C2') }]
    ]);
    const before = structuredClone(fixedCoords);
    const refined = refineCoords(parseSMILES(smiles), { existingCoords: generated.coords, fixedCoords });

    assertCleanCompleteLayout(refined);
    assert.deepEqual(fixedCoords, before);
    for (const [atomId, position] of before) {
      const refinedPosition = refined.coords.get(atomId);
      assert.ok(Math.abs(refinedPosition.x - position.x) < 1e-9);
      assert.ok(Math.abs(refinedPosition.y - position.y) < 1e-9);
    }
  });
});

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseSMILES } from '../../../../src/io/index.js';
import { generateCoords, refineCoords } from '../../../../src/layout/engine/api.js';
import { enforceAcyclicEZStereo } from '../../../../src/layout/engine/stereo/enforcement.js';
import { bugMolecules } from '../../../../examples/bug-molecules.js';

describe('medium-ring E/Z closure', () => {
  for (const smiles of ['C1/C=C/CCCCC1', 'C1/C=C/CCCCCCC1']) {
    for (const bondLength of [0.75, 1.5, 3]) {
      it(`depicts ${smiles} without tearing ring closure at ${bondLength}`, () => {
        const molecule = parseSMILES(smiles);
        assert.ok(bugMolecules.includes(smiles));
        const generated = generateCoords(molecule, { bondLength });
        for (const result of [generated, refineCoords(molecule, { bondLength, existingCoords: generated.coords })]) {
          assert.equal(result.metadata.stereo.ezViolationCount, 0);
          assert.equal(result.metadata.stereo.ezSupportedBondCount, 1);
          assert.equal(result.metadata.stereo.ezChecks[0].actual, 'E');
          assert.equal(result.metadata.audit.ok, true);
          assert.equal(result.metadata.audit.visibleHeavyBondCrossingCount, 0);
          assert.equal(result.metadata.audit.missingCoordinateCount, 0);
          assert.equal(result.metadata.audit.nonfiniteCoordinateCount, 0);
        }
      });
    }
  }
  for (const smiles of ['C1/C=C/CCCCCC1', 'C1/C=C/CCCCCCCC1', 'CC1/C=C/CCCCC1', 'C1/C(C)=C/CCCCC1', 'C1/C=C\\CCCCC1']) {
    it(`keeps nearby ring and branch geometry clean for ${smiles}`, () => {
      const result = generateCoords(parseSMILES(smiles));
      assert.equal(result.metadata.audit.ok, true);
      assert.equal(result.metadata.stereo.ezSupportedBondCount, 1);
      assert.equal(result.metadata.stereo.ezViolationCount, 0);
    });
  }
  for (const smiles of ['C1/C=C/CCC1', 'C1/C=C/CCCCCCCCC1']) {
    it(`does not broaden cyclic support for ${smiles}`, () => {
      const result = generateCoords(parseSMILES(smiles));
      assert.equal(result.metadata.stereo.ezUnsupportedBondCount, 1);
      assert.equal(result.metadata.audit.bondLengthFailureCount, 0);
    });
  }
  for (const mode of ['fixed', 'frozen']) {
    it(`does not move ${mode} ring coordinates to satisfy E/Z`, () => {
      const seed = generateCoords(parseSMILES('C1/C=C\\CCCCC1'));
      const target = generateCoords(parseSMILES('C1/C=C/CCCCC1'));
      const graph = target.layoutGraph;
      const before = structuredClone(seed.coords);
      if (mode === 'fixed') {
        graph.fixedCoords = new Map(seed.coords);
      }
      const result = enforceAcyclicEZStereo(graph, seed.coords, { frozenAtomIds: mode === 'frozen' ? new Set(seed.coords.keys()) : new Set() });
      assert.deepEqual(result.coords, before);
      assert.deepEqual(seed.coords, before);
    });
  }
});

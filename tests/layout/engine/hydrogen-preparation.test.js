import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { generateCoords, refineCoords } from '../../../src/layout/engine/api.js';
import { generateCoords as publicGenerateCoords } from '../../../src/layout/public-api.js';
import { parseSMILES } from '../../../src/io/smiles.js';

describe('engine hydrogen preparation', () => {
  for (const entrypoint of [generateCoords, refineCoords]) {
    for (const smiles of ['[Fe][H]', 'CC', 'C[C@H](F)Cl']) {
      it(`${entrypoint.name} normalizes hidden hydrogen defaults for ${smiles} without mutation`, () => {
        const molecule = parseSMILES(smiles);
        molecule.hideHydrogens();
        const before = structuredClone([...molecule.atoms]);
        const defaults = entrypoint(molecule);
        const explicit = entrypoint(molecule, { suppressH: true });
        assert.deepEqual(defaults.coords, explicit.coords);
        assert.deepEqual(defaults.metadata.audit, explicit.metadata.audit);
        assert.deepEqual(structuredClone([...molecule.atoms]), before);
        for (const atom of molecule.atoms.values()) {
          if (atom.name === 'H') {
            assert.equal(defaults.coords.has(atom.id), smiles === '[Fe][H]');
          }
        }
        if (smiles === '[Fe][H]') {
          const hydrogen = [...molecule.atoms.values()].find(atom => atom.name === 'H');
          assert.equal(defaults.layoutGraph.atoms.get(hydrogen.id).visible, true);
        }
      });
    }

    it(`${entrypoint.name} validates options before changing hydride visibility`, () => {
      const molecule = parseSMILES('[Fe][H]');
      molecule.hideHydrogens();
      const before = structuredClone([...molecule.atoms]);
      assert.throws(() => entrypoint(molecule, { suppressH: true, bondLength: 0 }), RangeError);
      assert.deepEqual(structuredClone([...molecule.atoms]), before);
    });

    it(`${entrypoint.name} preserves explicit false and debug callbacks`, () => {
      const molecule = parseSMILES('[Fe][H]');
      molecule.hideHydrogens();
      const before = structuredClone([...molecule.atoms]);
      let steps = 0;
      const result = entrypoint(molecule, { suppressH: false, debug: { onStep: () => steps++ } });
      assert.equal(result.layoutGraph.options.suppressH, false);
      assert.ok(steps > 0);
      assert.deepEqual(structuredClone([...molecule.atoms]), before);
    });
  }

  it('keeps hydride visibility changes in the public mutating API', () => {
    const molecule = parseSMILES('[Fe][H]');
    molecule.hideHydrogens();
    const hydrogen = [...molecule.atoms.values()].find(atom => atom.name === 'H');
    const coords = publicGenerateCoords(molecule);
    assert.equal(hydrogen.visible, true);
    assert.equal(coords.has(hydrogen.id), true);
    assert.ok(Number.isFinite(hydrogen.x));
  });
});

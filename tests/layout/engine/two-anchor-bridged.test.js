import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseSMILES } from '../../../src/io/smiles.js';
import { generateCoords, refineCoords } from '../../../src/layout/engine/api.js';

describe('two-anchor bridged rings', () => {
  for (const smiles of ['C1CC2CCC1C2', 'C1CC2CCC1CC2', 'C1C2CC3CC1CC(C2)C3']) {
    for (const bondLength of [0.75, 1.5, 3]) {
      for (const entrypoint of [generateCoords, refineCoords]) {
        it(`${entrypoint.name} preserves two anchors and projected closure for ${smiles} at ${bondLength}`, () => {
          const molecule = parseSMILES(smiles);
          const fixedCoords = new Map([['C1', { x: 10, y: -4 }], ['C4', { x: 10, y: -4 + bondLength * 4 / 3 }]]);
          const before = structuredClone(fixedCoords);
          const options = entrypoint === refineCoords ? { existingCoords: generateCoords(molecule).coords, touchedAtoms: new Set(molecule.atoms.keys()) } : {};
          const result = entrypoint(molecule, { ...options, fixedCoords, bondLength });
          for (const [id, position] of fixedCoords) {
            assert.deepEqual(result.coords.get(id), position);
          }
          assert.deepEqual(fixedCoords, before);
          assert.equal(result.metadata.audit.ok, true);
          assert.equal(result.metadata.audit.severeOverlapCount, 0);
          assert.equal(result.metadata.audit.visibleHeavyBondCrossingFailureCount, 0);
          assert.equal(result.metadata.audit.bondLengthFailureCount, 0);
          for (const bond of molecule.bonds.values()) {
            if (bond.atoms.some(id => molecule.atoms.get(id).name === 'H')) {
              continue;
            }
            const [a, b] = bond.atoms.map(id => result.coords.get(id));
            const ratio = Math.hypot(a.x - b.x, a.y - b.y) / bondLength;
            assert.ok(ratio >= 0.7 - 1e-8 && ratio <= 1.4 + 1e-8);
          }
        });
      }
    }
  }

  for (const smiles of ['C1CC2CCC1C2', 'C1CC2CCC1CC2', 'C1CC2CCC1C2C', 'C1CC2CCC1C2.CC']) {
    it(`preserves horizontal anchors with clean geometry: ${smiles}`, () => {
      const fixedCoords = new Map([['C1', { x: 0, y: 0 }], ['C4', { x: 2, y: 0 }]]);
      const result = generateCoords(parseSMILES(smiles), { fixedCoords });
      for (const [id, position] of fixedCoords) {
        assert.deepEqual(result.coords.get(id), position);
      }
      assert.equal(result.metadata.audit.ok, true);
    });
  }

  it('is deterministic and leaves disabled preservation unchanged', () => {
    const molecule = parseSMILES('C1CC2CCC1C2');
    const fixedCoords = new Map([['C1', { x: 0, y: 0 }], ['C4', { x: 2, y: 0 }]]);
    assert.deepEqual(generateCoords(molecule, { fixedCoords }).coords, generateCoords(molecule, { fixedCoords }).coords);
    assert.deepEqual(generateCoords(molecule, { fixedCoords, preserveFixed: false }).coords, generateCoords(molecule).coords);
  });

  it('retains infeasible anchors and reports bad geometry', () => {
    const fixedCoords = new Map([['C1', { x: 0, y: 0 }], ['C4', { x: 20, y: 0 }]]);
    const result = generateCoords(parseSMILES('C1CC2CCC1C2'), { fixedCoords });
    for (const [id, position] of fixedCoords) {
      assert.deepEqual(result.coords.get(id), position);
    }
    assert.equal(result.metadata.audit.ok, false);
    assert.ok(result.metadata.audit.bondLengthFailureCount > 0);
  });
});

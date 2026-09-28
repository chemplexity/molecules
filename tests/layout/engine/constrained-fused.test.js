import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseSMILES } from '../../../src/io/smiles.js';
import { generateCoords, refineCoords } from '../../../src/layout/engine/api.js';

describe('partially fixed fused rings', () => {
  for (const smiles of ['C1CCC2CCCCC2C1', 'C1CC2CCCC2C1', 'C1CCC2CC3CCCCC3CC2C1']) {
    for (const bondLength of [0.75, 1.5, 3]) {
      for (const entrypoint of [generateCoords, refineCoords]) {
        it(`${entrypoint.name} closes shared edges for ${smiles} at scale ${bondLength}`, () => {
          const molecule = parseSMILES(smiles);
          const fixedCoords = new Map([
            ['C1', { x: 10, y: -4 }],
            ['C2', { x: 10 + bondLength, y: -4 }],
            ['C3', { x: 10 + bondLength, y: -4 + bondLength }]
          ]);
          const before = structuredClone(fixedCoords);
          const options = entrypoint === refineCoords ? { existingCoords: generateCoords(molecule).coords, touchedAtoms: new Set(molecule.atoms.keys()) } : {};
          const result = entrypoint(molecule, { ...options, fixedCoords, bondLength });
          for (const [id, position] of fixedCoords) {
            assert.deepEqual(result.coords.get(id), position);
          }
          assert.deepEqual(fixedCoords, before);
          assert.equal(result.metadata.audit.ok, true);
          assert.equal(result.metadata.audit.visibleHeavyBondCrossingCount, 0);
          assert.equal(result.metadata.audit.severeOverlapCount, 0);
          for (const bond of molecule.bonds.values()) {
            if (bond.atoms.some(id => molecule.atoms.get(id).name === 'H')) {
              continue;
            }
            const [a, b] = bond.atoms.map(id => result.coords.get(id));
            assert.ok(Math.abs(Math.hypot(a.x - b.x, a.y - b.y) - bondLength) < bondLength * 1e-7);
          }
        });
      }
    }
  }

  for (const smiles of ['C1CCC2CCCCC2C1C', 'C1CCC2CCCCC2C1.CC']) {
    it(`preserves anchors with branches or fragments: ${smiles}`, () => {
      const fixedCoords = new Map([['C1', { x: 0, y: 0 }], ['C2', { x: 1.5, y: 0 }], ['C3', { x: 1.5, y: 1.5 }]]);
      const result = generateCoords(parseSMILES(smiles), { fixedCoords });
      for (const [id, position] of fixedCoords) {
        assert.deepEqual(result.coords.get(id), position);
      }
      assert.equal(result.metadata.audit.ok, true);
      assert.equal(result.metadata.audit.visibleHeavyBondCrossingCount, 0);
    });
  }

  it('leaves disabled preservation unchanged and is deterministic', () => {
    const molecule = parseSMILES('C1CCC2CCCCC2C1');
    const fixedCoords = new Map([['C1', { x: 0, y: 0 }], ['C2', { x: 1.5, y: 0 }], ['C3', { x: 1.5, y: 1.5 }]]);
    assert.deepEqual(generateCoords(molecule, { fixedCoords, preserveFixed: false }).coords, generateCoords(molecule).coords);
    assert.deepEqual(generateCoords(molecule, { fixedCoords }).coords, generateCoords(molecule, { fixedCoords }).coords);
  });

  it('retains infeasible anchors and exposes bond failures', () => {
    const fixedCoords = new Map([['C1', { x: 0, y: 0 }], ['C2', { x: 5, y: 0 }], ['C3', { x: 5, y: 5 }]]);
    const result = generateCoords(parseSMILES('C1CCC2CCCCC2C1'), { fixedCoords });
    for (const [id, position] of fixedCoords) {
      assert.deepEqual(result.coords.get(id), position);
    }
    assert.equal(result.metadata.audit.ok, false);
    assert.ok(result.metadata.audit.bondLengthFailureCount > 0);
    assert.ok([...result.coords.values()].every(p => Number.isFinite(p.x) && Number.isFinite(p.y)));
  });
});

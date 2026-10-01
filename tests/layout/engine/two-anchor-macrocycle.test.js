import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseSMILES } from '../../../src/io/smiles.js';
import { generateCoords, refineCoords } from '../../../src/layout/engine/api.js';

describe('two-anchor macrocycles', () => {
  for (const [size, second, separation] of [[12, 4, 4 / 3], [12, 2, 1], [24, 12, 10 / 3]]) {
    for (const bondLength of [0.75, 1.5, 3]) {
      for (const entrypoint of [generateCoords, refineCoords]) {
        it(`${entrypoint.name} closes ${size}-ring with anchor ${second} at scale ${bondLength}`, () => {
          const molecule = parseSMILES(`C1${'C'.repeat(size - 1)}1`);
          const fixedCoords = new Map([['C1', { x: 10, y: -4 }], [`C${second}`, { x: 10, y: -4 + separation * bondLength }]]);
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
          for (let index = 1; index <= size; index++) {
            const a = result.coords.get(`C${index}`);
            const b = result.coords.get(`C${index % size + 1}`);
            assert.ok(Math.abs(Math.hypot(a.x - b.x, a.y - b.y) - bondLength) < bondLength * 1e-7);
          }
        });
      }
    }
  }

  for (const smiles of ['C1CCCCCCCCCCC1', 'C1CCCCCCCCCCC1C', 'C1CCCCCCCCCCC1.CC']) {
    it(`preserves the reproduced horizontal anchors for ${smiles}`, () => {
      const fixedCoords = new Map([['C1', { x: 0, y: 0 }], ['C4', { x: 2, y: 0 }]]);
      const result = generateCoords(parseSMILES(smiles), { fixedCoords });
      for (const [id, position] of fixedCoords) {
        assert.deepEqual(result.coords.get(id), position);
      }
      assert.equal(result.metadata.audit.ok, true);
      assert.equal(result.metadata.audit.visibleHeavyBondCrossingCount, 0);
    });
  }

  it('is deterministic and leaves disabled preservation unchanged', () => {
    const molecule = parseSMILES('C1CCCCCCCCCCC1');
    const fixedCoords = new Map([['C1', { x: 0, y: 0 }], ['C4', { x: 2, y: 0 }]]);
    assert.deepEqual(generateCoords(molecule, { fixedCoords }).coords, generateCoords(molecule, { fixedCoords }).coords);
    assert.deepEqual(generateCoords(molecule, { fixedCoords, preserveFixed: false }).coords, generateCoords(molecule).coords);
  });

  it('retains unreachable anchors and reports bad bonds', () => {
    const fixedCoords = new Map([['C1', { x: 0, y: 0 }], ['C4', { x: 20, y: 0 }]]);
    const result = generateCoords(parseSMILES('C1CCCCCCCCCCC1'), { fixedCoords });
    for (const [id, position] of fixedCoords) {
      assert.deepEqual(result.coords.get(id), position);
    }
    assert.equal(result.metadata.audit.ok, false);
    assert.ok(result.metadata.audit.bondLengthFailureCount > 0);
    assert.ok([...result.coords.values()].every(p => Number.isFinite(p.x) && Number.isFinite(p.y)));
  });
});

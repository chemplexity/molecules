import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { layoutKamadaKawai, isKamadaKawaiLayoutAcceptable } from '../../../src/layoutv2/geometry/kk-layout.js';
import { parseSMILES } from '../../../src/io/smiles.js';
import { makeUnmatchedBridgedCage } from '../support/molecules.js';

function averageDisplacement(firstCoords, secondCoords, atomIds) {
  return atomIds.reduce((sum, atomId) => {
    const first = firstCoords.get(atomId);
    const second = secondCoords.get(atomId);
    return sum + Math.hypot(first.x - second.x, first.y - second.y);
  }, 0) / Math.max(atomIds.length, 1);
}

describe('layoutv2/geometry/kk-layout', () => {
  it('lays out a small unmatched bridged cage with finite coordinates', () => {
    const molecule = makeUnmatchedBridgedCage();
    const atomIds = [...molecule.atoms.keys()];
    const result = layoutKamadaKawai(molecule, atomIds, { bondLength: 1.5 });
    assert.equal(result.coords.size, atomIds.length);
    assert.equal(result.skipped, false);
    assert.equal(result.ok, true);
  });

  it('flags obviously bad coordinate sets as unacceptable', () => {
    const molecule = makeUnmatchedBridgedCage();
    const coords = new Map([...molecule.atoms.keys()].map(atomId => [atomId, { x: 0, y: 0 }]));
    assert.equal(isKamadaKawaiLayoutAcceptable(molecule, [...molecule.atoms.keys()], coords, 1.5), false);
  });

  it('does not skip moderately large components under the default size cutoff', () => {
    const molecule = parseSMILES(`C1${'C'.repeat(31)}C1`);
    const atomIds = [...molecule.atoms.values()]
      .filter(atom => atom.name !== 'H')
      .map(atom => atom.id);
    const result = layoutKamadaKawai(molecule, atomIds, {
      bondLength: 1.5,
      maxIterations: 250,
      maxInnerIterations: 12
    });

    assert.equal(result.skipped, false);
    assert.equal(result.coords.size, atomIds.length);
  });

  it('uses seeded existing coordinates instead of restarting from the circular fallback', () => {
    const molecule = makeUnmatchedBridgedCage();
    const atomIds = [...molecule.atoms.keys()];
    const convergedSeed = layoutKamadaKawai(molecule, atomIds, {
      bondLength: 1.5,
      maxIterations: 250,
      maxInnerIterations: 12
    });
    const coldRestart = layoutKamadaKawai(molecule, atomIds, {
      bondLength: 1.5,
      maxIterations: 1,
      maxInnerIterations: 1
    });
    const seededRestart = layoutKamadaKawai(molecule, atomIds, {
      bondLength: 1.5,
      coords: convergedSeed.coords,
      maxIterations: 1,
      maxInnerIterations: 1
    });

    assert.ok(
      averageDisplacement(seededRestart.coords, convergedSeed.coords, atomIds)
      < averageDisplacement(coldRestart.coords, convergedSeed.coords, atomIds)
    );
  });
});
